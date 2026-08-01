/**
 * 국내 증권 플랫폼 체결내역 OCR 텍스트 → 매매 필드 자동 추출 (규칙 기반 순수 함수).
 *
 * 대상 패턴:
 *   - 라벨형: "체결단가 72,000원 / 체결수량 10주" (키움·미래에셋·NH 등)
 *   - 알림형: "[체결] SK하이닉스 1주 231,000원 매도"
 *   - 토스증권형: "{종목명} 구매|판매" 제목 + "구매 금액 506,985원" + "수량 1.071309주"(소수점 주식)
 *     → 단가 라벨이 없으므로 단가 = 금액 ÷ 수량 계산(확신 낮음), "적용 환율"·"$" 줄은 무시
 *
 * 확신이 없는 필드는 confident=false — UI는 확신 필드는 자동 채움, 나머지는 칩으로 보정.
 */
import type { Side } from './journal';

export interface ParsedTrade {
  symbol?: string;
  side?: Side;
  price?: number;
  qty?: number;
  /** YYYY-MM-DD */
  date?: string;
  /** HH:MM */
  time?: string;
  confident: { symbol: boolean; side: boolean; price: boolean; qty: boolean; date: boolean };
}

const NOISE_WORDS = new Set([
  '매수', '매도', '구매', '판매', '체결', '주문', '수량', '단가', '가격', '금액', '체결가', '체결량',
  '체결단가', '체결수량', '체결가격', '주식', '현금', '계좌', '잔고', '수수료', '세금', '정정',
  '취소', '접수', '완료', '안내', '알림', '내역', '국내', '해외', '보통', '지정가',
  '시장가', '일반', '위탁', '증권', '종목', '종목명', '환율', '적용',
  '구분', '매매구분', '거래구분', '주문구분',
  // 실기기 화면 UI 노이즈 (상태바·헤더·진행단계·버튼)
  '현재', '현재가격', '보기', '현재가격보기', '주문접수', '주문시간', '시간',
  '가능', '불가능', '취소가능', '취소불가능', '목표', '수익률', '설정', '출금', '구매완료', '판매완료',
  '조회', '체결내역', '체결내역조회',
]);

function toNum(s: string): number {
  return Number.parseFloat(s.replace(/,/g, ''));
}

/** OCR 흔들림 정규화: 숫자 사이 공백 낀 쉼표("72, 400")·쉼표 대신 마침표("72.400원") 보정 */
export function normalizeOcrText(raw: string): string {
  return raw
    .replace(/(\d)\s*,\s*(\d)/g, '$1,$2')
    .replace(/(\d)\.(\d{3})(?=원)/g, '$1,$2');
}

const NUM = '[\\d,]+(?:\\.\\d+)?';

export function parseTradeText(rawText: string): ParsedTrade {
  const result: ParsedTrade = {
    confident: { symbol: false, side: false, price: false, qty: false, date: false },
  };
  // "적용 환율"·달러 표기 줄은 숫자 오인의 원인 — 통째로 제거
  const text = normalizeOcrText(rawText)
    .split('\n')
    .filter((l) => !l.includes('환율') && !/^\s*\$[\d,.]+\s*$/.test(l))
    .join('\n');

  // ---- 매수/매도: 매수·구매 vs 매도·판매 ----
  const hasBuy = /매수|구매/.test(text);
  const hasSell = /매도|판매/.test(text);
  if (hasBuy !== hasSell) {
    result.side = hasBuy ? 'buy' : 'sell';
    result.confident.side = true;
  }

  // ---- 날짜/시각: "2026.7.23 23:18", "2026-07-23", "2026/7/23" ----
  const dm = /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/.exec(text);
  if (dm) {
    const y = Number(dm[1]);
    const mo = Number(dm[2]);
    const d = Number(dm[3]);
    if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      result.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      result.confident.date = true;
      const tm = /(\d{1,2}):(\d{2})/.exec(text.slice(dm.index));
      if (tm && Number(tm[1]) <= 23 && Number(tm[2]) <= 59) {
        result.time = `${tm[1].padStart(2, '0')}:${tm[2]}`;
      }
    }
  }

  // ---- 단가: "단가/체결가/가격" 근처 숫자. OCR '체'→'제' 혼동([체제]) 허용 ----
  const priceMatch = new RegExp(`(?:[체제]결\\s*단가|[체제]결가|단가|가격)\\s*[:\\s]*(${NUM})\\s*원?`).exec(text);
  if (priceMatch) {
    const n = toNum(priceMatch[1]);
    if (Number.isFinite(n) && n > 0) {
      result.price = n;
      result.confident.price = true;
    }
  }

  // ---- 수량: "수량 N" 또는 "N주" — 소수점 주식(1.071309주) 허용 ----
  const qtyMatch =
    new RegExp(`(?:[체제]결\\s*수량|[체제]결량|수량)\\s*[:\\s]*(${NUM})\\s*주?`).exec(text) ??
    new RegExp(`(${NUM})\\s*주(?!문|식|간)`).exec(text);
  if (qtyMatch) {
    const n = toNum(qtyMatch[1]);
    if (Number.isFinite(n) && n > 0 && n < 1_000_000) {
      result.qty = n;
      result.confident.qty = true;
    }
  }

  // ---- 토스증권형 보정: 단가 라벨 없음 → 단가 = 금액(원) ÷ 수량 (계산값 — 확신 낮음) ----
  if (result.price === undefined) {
    const amountMatch = new RegExp(`(?:구매|판매|매수|매도|주문|[체제]결)?\\s*금액\\s*[:\\s]*(${NUM})\\s*원`).exec(text);
    if (amountMatch && result.qty !== undefined && result.qty > 0) {
      const amount = toNum(amountMatch[1]);
      if (Number.isFinite(amount) && amount > 0) {
        result.price = Math.round(amount / result.qty);
        // 계산값 — confident.price는 false 유지
      }
    }
  }

  // ---- 보정: 단가 라벨이 없을 때 "N주 M원" / "M원 N주" 페어에서 단가 추출 ----
  if (result.price === undefined) {
    const pair =
      new RegExp(`(${NUM})\\s*주\\D{0,8}?(${NUM})\\s*원`).exec(text) ?? // "10주 72,000원"
      new RegExp(`(${NUM})\\s*원\\D{0,8}?(${NUM})\\s*주`).exec(text); // "72,000원 10주"
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

  // ---- 종목명 ----
  // 1순위: "종목명 XXX" 라벨
  const labeled = /종목(?:명)?\s*[:\s]*([가-힣A-Za-z0-9&]{2,15})/.exec(text);
  // 2순위: 토스증권형 제목 "{이름} 구매|판매( 완료)?" — "알파벳 A"처럼 공백 포함 이름 허용
  let titleSymbol: string | undefined;
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Za-z가-힣0-9&.\s]{2,20}?)\s*(?:구매|판매|매수|매도)\s*(?:주문|[체제]결)?\s*(?:완료)?\s*$/.exec(line);
    if (!m) continue;
    const cand = m[1].trim();
    if (cand === '' || NOISE_WORDS.has(cand) || !/[가-힣A-Za-z]/.test(cand)) continue;
    // "현재가격 보기"·"주문 취소 가능" 같은 UI 문구 오인 방지
    if (/현재|보기|가격|취소|접수|시간|내역|완료|출금|설정|수익률/.test(cand)) continue;
    titleSymbol = cand;
    break;
  }
  if (labeled && !NOISE_WORDS.has(labeled[1])) {
    result.symbol = labeled[1];
    result.confident.symbol = true;
  } else if (titleSymbol !== undefined) {
    result.symbol = titleSymbol;
    result.confident.symbol = true;
  } else {
    // 상용어를 먼저 지운다 — 공백 없이 붙은 "매수주문" 같은 결합어 오인 방지
    const stripped = text.replace(
      /체결\s*단가|체결\s*수량|체결가격|체결가|체결량|종목명|종목|매수|매도|구매|판매|체결|주문|접수|완료|안내|알림|내역|수량|단가|가격|금액|주식|증권|계좌|잔고|수수료|세금|정정|취소|지정가|시장가/g,
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
