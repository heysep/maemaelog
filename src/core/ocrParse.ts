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
  // 거래내역/체결내역 리스트 화면의 표 헤더·필터·행 종류 (실물 캡처에서 종목명으로 오인되던 토큰)
  '거래', '매매', '거래내역', '체결내역', '주문내역', '일별주문내역', '수익률현황',
  '거래일자', '거래종류', '거래단가', '거래수량', '거래금액', '정산금액', '잔고금액',
  '처리시간', '적요명', '입출금', '이체입금', '지급결제', '환전', '외화매수', '외화매도',
  '조회기간', '조회구분', '조회순', '전체', '당일', '기간', '종합위탁', '위탁계좌',
  '예수금', '자동저금통', '내역제외', '미표시', '펀드가입번호', '신탁보수', '농특세',
  '코스피', '코스닥', '관심종목', '보유종목', '평균단가', '희망가격', '주문금액',
  '메뉴', '홈', '더보기', '검색', '차트', '주식', '계좌개설', '트레이딩', '순위', '종목순위', '일별',
  // 실기기 화면 UI 노이즈 (상태바·헤더·진행단계·버튼)
  '현재', '현재가격', '보기', '현재가격보기', '주문접수', '주문시간', '시간',
  '가능', '불가능', '취소가능', '취소불가능', '목표', '수익률', '설정', '출금', '구매완료', '판매완료',
  '조회', '체결내역', '체결내역조회',
  // OCR 쓰레기 토큰(로고·아이콘 오독)
  'Toss', 'TOSS', 'The', 'THE', 'BY', 'Mx', 've',
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
  // 환율 줄은 숫자 오인의 원인 — 파싱 본문에서는 제거하되, 교차검증용으로 원본은 남긴다
  const fullText = normalizeOcrText(rawText);
  const text = fullText
    .split('\n')
    .filter((l) => !l.includes('환율') && !/^\s*\$[\d,.]+\s*$/.test(l))
    .join('\n');
  /** 특정 인덱스가 속한 줄 */
  const lineAt = (idx: number): string => {
    const s = text.lastIndexOf('\n', idx) + 1;
    const e = text.indexOf('\n', idx);
    return text.slice(s, e === -1 ? undefined : e);
  };

  // ---- 매수/매도: 매수·구매 vs 매도·판매 ----
  const hasBuy = /매수|구매/.test(text);
  const hasSell = /매도|판매/.test(text);
  if (hasBuy !== hasSell) {
    result.side = hasBuy ? 'buy' : 'sell';
    result.confident.side = true;
  }

  // ---- 날짜/시각: 구분자·공백 흔들림 허용 ----
  // "2026.7.23", "2026-07-23", "2026/7/23", "2026, 7, 23", "2026 7 23", "20267.23", "2026723"
  /**
   * "2022.01.21 ~ 2023.01.20" / "2025/10/14 - 2025/10/14" 처럼 조회기간(범위)으로 쓰인 날짜는
   * 체결일이 아니다 — 범위 구분자에 맞닿은 날짜는 양쪽 모두 건너뛴다.
   */
  const isQueryRange = (start: number, end: number): boolean =>
    /^\s*[~\-–]\s*\d{4}\s*[.\-/,]/.test(text.slice(end)) ||
    /\d{4}\s*[.\-/,]\s*\d{1,2}\s*[.\-/,]\s*\d{1,2}\s*[~\-–]\s*$/.test(text.slice(0, start));

  const setDate = (y: number, mo: number, d: number, from: number, to?: number): boolean => {
    if (!(y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return false;
    if (to !== undefined && isQueryRange(from, to)) return false;
    // 출금(정산)일·결제일은 매매일이 아니다
    if (/출금|정산|결제/.test(lineAt(from))) return false;
    result.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    result.confident.date = true;
    const tm = /(\d{1,2}):(\d{2})/.exec(text.slice(from));
    if (tm && Number(tm[1]) <= 23 && Number(tm[2]) <= 59) {
      result.time = `${tm[1].padStart(2, '0')}:${tm[2]}`;
    }
    return true;
  };
  /** 붙어 있는 월일 문자열("724" → 7월 24일)을 유효 날짜가 되게 분해. 앞자리(짧은 월) 우선 */
  const splitMonthDay = (s: string): [number, number] | null => {
    for (const mLen of [1, 2]) {
      const dLen = s.length - mLen;
      if (dLen < 1 || dLen > 2) continue;
      const mo = Number(s.slice(0, mLen));
      const d = Number(s.slice(mLen));
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return [mo, d];
    }
    return null;
  };

  {
    let found = false;
    // 0) 날짜+시각이 통째로 붙은 경우 ("202672419:27" → 2026-07-24 19:27)
    for (const m of fullText.matchAll(/(20\d{2})(\d{3,6}):(\d{2})/g)) {
      const digits = m[2];
      const minute = Number(m[3]);
      if (minute > 59) continue;
      // 시각은 붙은 숫자의 끝 1~2자리 — 2자리 해석 우선
      for (const hLen of [2, 1]) {
        if (digits.length - hLen < 2) continue;
        const hour = Number(digits.slice(digits.length - hLen));
        if (hour > 23) continue;
        const md = splitMonthDay(digits.slice(0, digits.length - hLen));
        if (md === null) continue;
        const idx = text.indexOf(m[0]);
        if (setDate(Number(m[1]), md[0], md[1], idx === -1 ? 0 : idx)) {
          result.time = `${String(hour).padStart(2, '0')}:${m[3]}`;
          found = true;
        }
        break;
      }
      if (found) break;
    }
    // 1) 구두점 구분자 (앞뒤 공백 허용)
    if (!found) {
      for (const m of text.matchAll(/(\d{4})\s*[.\-/,]\s*(\d{1,2})\s*[.\-/,]\s*(\d{1,2})/g)) {
        if (setDate(Number(m[1]), Number(m[2]), Number(m[3]), m.index, m.index + m[0].length)) { found = true; break; }
      }
    }
    // 2) 공백만 구분자 ("2026 7 23")
    if (!found) {
      for (const m of text.matchAll(/(\d{4})\s+(\d{1,2})\s+(\d{1,2})(?!\d)/g)) {
        if (setDate(Number(m[1]), Number(m[2]), Number(m[3]), m.index, m.index + m[0].length)) { found = true; break; }
      }
    }
    // 3) 구분자 소실 ("2026723", "20267.23") — 연도 20xx 고정 후 월/일 분해
    if (!found) {
      for (const m of text.matchAll(/\b(20\d{2})\s*[.\-/,]?\s*(\d{1,2})\s*[.\-/,]?\s*(\d{2})\b/g)) {
        if (setDate(Number(m[1]), Number(m[2]), Number(m[3]), m.index, m.index + m[0].length)) { found = true; break; }
      }
    }
    if (!found) {
      for (const m of text.matchAll(/\b(20\d{2})(\d{3,4})\b/g)) {
        const rest = m[2];
        const [mo, d] = rest.length === 3 ? [Number(rest[0]), Number(rest.slice(1))] : [Number(rest.slice(0, 2)), Number(rest.slice(2))];
        if (setDate(Number(m[1]), mo, d, m.index, m.index + m[0].length)) break;
      }
    }
  }

  /**
   * ---- 리스트형 화면(한 화면에 여러 건): 가장 최근(=최상단) "매매" 행 1건만 쓴다 ----
   * 키움 영웅문S# 거래내역 등은 입출금·환전·이체 행이 섞여 최상단이 체결이 아닐 수 있으므로
   * "매매 {단가}" + 다음 줄 "{매수|매도} {수량}" 행만 골라 첫 건을 채택한다.
   * 라벨이 표 헤더에만 있어 값-라벨 인접이 없으므로 확신은 낮게 둔다(칩으로 보정).
   */
  const isLedgerList = /거래내역|거래단가|거래수량|적요명/.test(text);
  if (isLedgerList) {
    const row = new RegExp(`(?:^|\\n)\\s*매매\\s+(${NUM})[^\\n]*\\n\\s*(매수|매도)\\s+(${NUM})(?!\\d)`).exec(text);
    if (row) {
      const p = toNum(row[1]);
      const q = toNum(row[3]);
      if (Number.isFinite(p) && p > 0) result.price = p;
      if (Number.isFinite(q) && q > 0 && q < 1_000_000) result.qty = q;
      result.side = row[2] === '매수' ? 'buy' : 'sell';
      result.confident.side = true;
    }
  }

  /**
   * ---- 토스증권 주문 확인 모달: "{종목}을 N주" + 다음 줄 "구매할게요|판매할게요" ----
   * 조사(을/를)가 붙은 채 종목명으로 오인되던 케이스.
   */
  {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length - 1; i += 1) {
      const m = new RegExp(`^\\s*([A-Za-z가-힣0-9&.\\s]{2,20}?)\\s*(?:을|를)\\s*(${NUM})\\s*주\\s*$`).exec(lines[i]);
      if (!m) continue;
      if (!/^\s*(구매|판매)\s*할게요/.test(lines[i + 1] ?? '')) continue;
      const cand = m[1].trim();
      if (cand === '' || NOISE_WORDS.has(cand)) continue;
      result.symbol = cand;
      result.confident.symbol = true;
      const q = toNum(m[2]);
      if (Number.isFinite(q) && q > 0) {
        result.qty = q;
        result.confident.qty = true;
      }
      break;
    }
  }

  /**
   * ---- 해외주식(달러 표기) 화면: "1주당 가격  $319.97" + 다음 줄 원화(콤마 없음) ----
   * 원화 숫자는 OCR에서 자릿수가 흔들리므로(4707163 / 4701632) "기준 환율"과 교차검증해
   * 소수점 위치(÷1·÷10·÷100)를 보정한다. 기대값과 20% 넘게 벌어지면 채택하지 않는다
   * (틀린 단가보다 빈 값이 낫다). 달러만 있고 환율이 없으면 단가를 채우지 않는다.
   */
  if (result.price === undefined) {
    const lines = text.split('\n');
    const PRICE_LABEL = /1\s*주\s*당\s*가격|1\s*주\s*가격|주\s*당\s*가격|평균\s*단가/;
    let labelIdx = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (!PRICE_LABEL.test(lines[i])) continue;
      if (/현재\s*가격|목표/.test(lines[i])) continue; // "현재가격 보기"·"목표 수익률" 오인 방지
      labelIdx = i;
      break;
    }
    if (labelIdx >= 0) {
      const scope = [lines[labelIdx], lines[labelIdx + 1] ?? ''].join('\n');
      const usdM = /\$\s*([\d,]+(?:\.\d+)?)/.exec(scope);
      // 환율 줄은 본문에서 걸러지므로 원본에서 찾는다
      const rateM = /환율[^\n\d]*([\d,]+(?:\.\d+)?)/.exec(fullText);
      const usd = usdM ? toNum(usdM[1]) : NaN;
      const rate = rateM ? toNum(rateM[1]) : NaN;
      // 콤마 없는 원화 숫자도 후보로 인정("4707163원")
      const wonM = /(\d[\d,]{2,})\s*[원윈월]/.exec(scope);
      if (Number.isFinite(usd) && usd > 0 && Number.isFinite(rate) && rate > 100) {
        const expected = usd * rate;
        let best: number | null = null;
        let bestDiff = Infinity;
        for (const m of text.matchAll(/\d[\d,]{3,}/g)) {
          const raw = toNum(m[0]);
          if (!Number.isFinite(raw) || raw <= 0) continue;
          for (const div of [1, 10, 100]) {
            const diff = Math.abs(raw / div - expected);
            if (diff < bestDiff) {
              bestDiff = diff;
              best = Math.round(raw / div);
            }
          }
        }
        if (best !== null && bestDiff / expected <= 0.2) {
          result.price = best; // 환율 교차검증 보정값 — 확신 낮음
        }
      } else if (wonM) {
        const n = toNum(wonM[1]);
        if (Number.isFinite(n) && n > 0) {
          result.price = n;
          result.confident.price = true;
        }
      }
    }
  }

  // ---- 단가: "단가/체결가/가격" 근처 숫자. OCR '체'→'제' 혼동([체제]) 허용 ----
  const priceMatch =
    result.price === undefined
      ? new RegExp(`(?:[체제]결\\s*단가|[체제]결가|단가|가격)\\s*[:\\s]*(${NUM})\\s*원?`).exec(text)
      : null;
  if (priceMatch) {
    const n = toNum(priceMatch[1]);
    if (Number.isFinite(n) && n > 0) {
      result.price = n;
      result.confident.price = true;
    }
  }

  // ---- 수량: "수량 N" 또는 "N주" — 소수점 주식(1.071309주) 허용 ----
  const qtyMatch =
    result.qty !== undefined
      ? null
      : new RegExp(`(?:[체제]결\\s*수량|[체제]결량|주문\\s*수량|수량)\\s*[:\\s]*(${NUM})\\s*주?`).exec(text) ??
        new RegExp(`(${NUM})\\s*주(?!문|식|간)`).exec(text);
  if (qtyMatch) {
    const n = toNum(qtyMatch[1]);
    if (Number.isFinite(n) && n > 0 && n < 1_000_000) {
      result.qty = n;
      result.confident.qty = true;
    }
  }

  // ---- 토스증권형 보정: 단가 라벨 없음 → 단가 = 금액(원) ÷ 수량 (계산값 — 확신 낮음) ----
  if (result.price === undefined && result.qty !== undefined && result.qty > 0) {
    // "원"이 "윈/월/앤" 등으로 오독되는 경우 허용, 라벨-값이 줄로 갈라져도 \s가 개행을 넘는다
    const amountMatch =
      // 저품질 OCR에서 "원"이 윈/월/앤/!/|/I 등으로 오독된다.
      // '1'·'l'은 금액 끝자리를 통화 글자로 잡아먹어 값을 훼손하므로 넣지 않는다.
      new RegExp(`(?:구매|판매|매수|매도|주문|[체제]결)?\\s*금액\\s*[:\\s]*(${NUM})\\s*[원윈월앤!|I]`).exec(text) ??
      // 통화 글자가 아예 소실됐어도 콤마 숫자(천 단위 이상)면 후보
      /금액\s*[:\s]*(\d{1,3}(?:,\d{3})+)/.exec(text);
    if (amountMatch) {
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

  // ---- 단가 최후 폴백: 금액 라인을 못 찾으면 화면에서 가장 큰 콤마 숫자를 금액으로 (확신 최저) ----
  if (result.price === undefined && result.qty !== undefined && result.qty > 0) {
    let best = 0;
    for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+/g)) {
      const n = toNum(m[0]);
      if (Number.isFinite(n) && n > best) best = n;
    }
    if (best >= 1000) result.price = Math.round(best / result.qty);
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
  // 1순위: "종목명 XXX" 라벨. 앞에 한글이 붙은 "관심종목/보유종목/인기종목"은 라벨이 아니다.
  const labeled = result.symbol === undefined
    // "종목순위"처럼 뒤에 한글이 바로 붙는 합성어는 라벨이 아니다 — 구분자(공백/콜론)를 요구한다.
    // (구형 WebView에서 파스 에러를 내는 lookbehind 대신 문자 클래스 사용)
    ? /(?:^|[^가-힣])종목(?:명\s*[:\s]*|\s*[:\s]\s*)([가-힣A-Za-z0-9&]{2,15})/.exec(text)
    : null;
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
  if (result.symbol !== undefined) {
    // 이미 확정된 종목명(토스 주문 확인 모달 등)을 덮어쓰지 않는다
  } else if (labeled && !NOISE_WORDS.has(labeled[1])) {
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
      // 목적격 조사만 떼어낸다(을/를은 종목명 말미에 오지 않는다) — "대한항공을" → "대한항공"
      const cand = /[가-힣]{3,}[을를]$/.test(m[0]) ? m[0].slice(0, -1) : m[0];
      if (NOISE_WORDS.has(cand)) continue;
      // 표 헤더·UI 문구 오인 방지(제목 경로와 같은 기준)
      if (/현재|보기|가격|취소|접수|시간|내역|완료|출금|설정|수익률|조회|제외|합계|일자|구분/.test(cand)) continue;
      result.symbol = cand;
      break;
    }
  }

  return result;
}
