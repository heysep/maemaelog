/**
 * 한국 증권앱 체결내역 OCR 텍스트 → 매매 필드 자동 추출 (규칙 기반 순수 함수).
 *
 * 대상 패턴 예:
 *   "삼성전자 매수 체결 / 체결단가 72,000원 / 체결수량 10주"
 *   "[체결] SK하이닉스 1주 231,000원 매도"
 *   "매수주문 체결 안내 카카오 20주 48,500"
 *
 * 확신이 없는 필드는 값을 비워 두고(undefined) confident=false로 표시한다 —
 * UI는 확신 필드는 자동 채움, 나머지는 후보 칩으로 보정하게 한다.
 */
import type { Side } from './journal';

export interface ParsedTrade {
  symbol?: string;
  side?: Side;
  price?: number;
  qty?: number;
  confident: { symbol: boolean; side: boolean; price: boolean; qty: boolean };
}

const NOISE_WORDS = new Set([
  '매수', '매도', '체결', '주문', '수량', '단가', '가격', '금액', '체결가', '체결량',
  '체결단가', '체결수량', '주식', '현금', '계좌', '잔고', '수수료', '세금', '정정',
  '취소', '접수', '완료', '안내', '알림', '내역', '국내', '해외', '보통', '지정가',
  '시장가', '일반', '위탁', '증권', '종목', '종목명',
]);

function toNum(s: string): number {
  return Number(s.replace(/,/g, ''));
}

/** OCR 흔들림 정규화: 숫자 사이 공백 낀 쉼표("72, 400")·쉼표 대신 마침표("72.400원") 보정 */
export function normalizeOcrText(raw: string): string {
  return raw
    .replace(/(\d)\s*,\s*(\d)/g, '$1,$2')
    .replace(/(\d)\.(\d{3})(?=\D|$)/g, '$1,$2');
}

export function parseTradeText(rawText: string): ParsedTrade {
  const text = normalizeOcrText(rawText);
  const result: ParsedTrade = { confident: { symbol: false, side: false, price: false, qty: false } };

  // ---- 매수/매도 ----
  const hasBuy = /매수/.test(text);
  const hasSell = /매도/.test(text);
  if (hasBuy !== hasSell) {
    result.side = hasBuy ? 'buy' : 'sell';
    result.confident.side = true;
  }

  // ---- 단가: "단가/체결가/가격" 근처 숫자. OCR이 '체'를 '제'로 읽는 혼동([체제]) 허용 ----
  const priceMatch = /(?:[체제]결\s*단가|[체제]결가|단가|가격)\s*[:\s]*([\d,]+)\s*원?/.exec(text);
  if (priceMatch) {
    const n = toNum(priceMatch[1]);
    if (Number.isFinite(n) && n > 0) {
      result.price = n;
      result.confident.price = true;
    }
  }

  // ---- 수량: "수량 N" 또는 "N주" ----
  const qtyMatch =
    /(?:[체제]결\s*수량|[체제]결량|수량)\s*[:\s]*([\d,]+)\s*주?/.exec(text) ?? /([\d,]+)\s*주(?!문|식|간)/.exec(text);
  if (qtyMatch) {
    const n = toNum(qtyMatch[1]);
    if (Number.isFinite(n) && n > 0 && n < 1_000_000) {
      result.qty = n;
      result.confident.qty = true;
    }
  }

  // ---- 보정: 단가 라벨이 없을 때 "N주 M원" / "M원 N주" 페어에서 단가 추출 ----
  if (result.price === undefined) {
    const pair =
      /([\d,]+)\s*주\D{0,8}?([\d,]+)\s*원/.exec(text) ?? // "10주 72,000원"
      /([\d,]+)\s*원\D{0,8}?([\d,]+)\s*주/.exec(text); // "72,000원 10주"
    if (pair) {
      const a = toNum(pair[1]);
      const b = toNum(pair[2]);
      const [q, p] = pair[0].indexOf('주') < pair[0].indexOf('원') ? [a, b] : [b, a];
      if (p > 0) result.price = p;
      if (result.qty === undefined && q > 0 && q < 1_000_000) result.qty = q;
      // 라벨 없는 추출은 확신 낮음 → confident 유지(false)
    }
  }

  // ---- 보정: 수량 라벨이 OCR로 깨졌을 때(예: "MZ E  3") 숫자만 남은 줄에서 수량 추출 ----
  if (result.qty === undefined) {
    for (const line of text.split('\n')) {
      const m = /^\D*?(\d{1,5})\s*$/.exec(line);
      if (!m) continue;
      const n = toNum(m[1]);
      if (n > 0 && n !== result.price) {
        result.qty = n; // 라벨 없는 추출 — 확신 낮음(confident 유지)
        break;
      }
    }
  }

  // ---- 종목명: 한글 2~10자 또는 영대문자 토큰 중 상용어 제외 첫 후보 ----
  // "종목명 XXX" 라벨이 있으면 그 값을 확신으로 사용
  const labeled = /종목(?:명)?\s*[:\s]*([가-힣A-Za-z0-9&]{2,15})/.exec(text);
  if (labeled && !NOISE_WORDS.has(labeled[1])) {
    result.symbol = labeled[1];
    result.confident.symbol = true;
  } else {
    // 상용어를 먼저 지운다 — 공백 없이 붙은 "매수주문" 같은 결합어 오인 방지
    const stripped = text.replace(
      /체결\s*단가|체결\s*수량|체결가|체결량|종목명|종목|매수|매도|체결|주문|접수|완료|안내|알림|내역|수량|단가|가격|금액|주식|증권|계좌|잔고|수수료|세금|정정|취소|지정가|시장가/g,
      ' '
    );
    // 혼합 표기(SK하이닉스, LG에너지솔루션)를 한 토큰으로 잡는다
    for (const m of stripped.matchAll(/[A-Z]{1,6}[가-힣]{2,10}|[가-힣]{2,10}|[A-Z]{2,6}/g)) {
      if (NOISE_WORDS.has(m[0])) continue;
      result.symbol = m[0];
      break;
    }
  }

  return result;
}
