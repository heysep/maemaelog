/**
 * 매매일지 순수 계산 로직 — UI/저장소와 분리.
 *
 * 실현손익 규칙(수수료·세금 없음 명시):
 * - 같은 종목의 매수를 이동평균 단가로 합산한다.
 * - 매도 시 실현손익 = (매도단가 - 평균단가) × 매도수량. 평균단가는 유지된다(부분매도).
 * - 보유수량을 초과한 매도수량은 보유분까지만 실현손익에 반영한다(초과분 무시).
 * - 거래 순서는 날짜 오름차순, 같은 날짜는 입력 순서.
 */

export type Side = 'buy' | 'sell';

export interface Trade {
  id: string;
  symbol: string;
  side: Side;
  /** 1주 단가(원, 정수) */
  price: number;
  /** 수량(주) */
  qty: number;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (선택) — 시간대 성향 분석용 */
  time?: string;
  memo: string;
  /** 감정 태그 */
  emotion: string;
  /** 512px 축소 썸네일 dataURL (선택) */
  thumb?: string;
}

export const EMOTIONS = ['확신', '원칙', '추격', '공포', '뇌동'] as const;

export interface SymbolStat {
  symbol: string;
  /** 실현손익(원) */
  realized: number;
  /** 매도(청산) 횟수 */
  sellCount: number;
  /** 이익 매도 횟수 */
  winCount: number;
  /** 현재 보유수량 */
  holdingQty: number;
  /** 현재 평균단가(보유 없으면 0) */
  avgPrice: number;
}

export interface JournalStats {
  totalRealized: number;
  sellCount: number;
  winCount: number;
  /** 승률(%) — 매도 없으면 null */
  winRate: number | null;
  /** 실현손익 내림차순 */
  bySymbol: SymbolStat[];
  /** 월(YYYY-MM) 오름차순 실현손익. costBasis = 그 달에 매도한 수량의 평균단가 원가 합 */
  byMonth: { month: string; realized: number; costBasis: number }[];
  /** 매도 거래 id → 그 거래의 실현손익 */
  pnlByTradeId: Record<string, number>;
}

/** 월 수익률(%) = 실현손익 / 매도 원가. 원가 0이면 null. 소수 1자리 반올림 */
export function monthReturnRate(m: { realized: number; costBasis: number }): number | null {
  if (m.costBasis <= 0) return null;
  return Math.round((m.realized / m.costBasis) * 1000) / 10;
}

/** 날짜 오름차순, 같은 날짜는 원래 순서 유지 */
export function sortForCalc(trades: Trade[]): Trade[] {
  return trades
    .map((t, i) => [t, i] as const)
    .sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1]))
    .map(([t]) => t);
}

export function computeStats(trades: Trade[]): JournalStats {
  const ordered = sortForCalc(trades.filter(isValidTrade));
  const map = new Map<string, { qty: number; cost: number; stat: SymbolStat }>();
  const monthMap = new Map<string, { realized: number; costBasis: number }>();
  const pnlByTradeId: Record<string, number> = {};

  for (const t of ordered) {
    let p = map.get(t.symbol);
    if (!p) {
      p = { qty: 0, cost: 0, stat: { symbol: t.symbol, realized: 0, sellCount: 0, winCount: 0, holdingQty: 0, avgPrice: 0 } };
      map.set(t.symbol, p);
    }
    if (t.side === 'buy') {
      p.qty += t.qty;
      p.cost += t.price * t.qty;
    } else {
      const sellQty = Math.min(t.qty, p.qty);
      if (sellQty <= 0) continue; // 보유 없는 매도 — 손익 계산 불가, 건너뜀
      const avg = p.cost / p.qty;
      const pnl = Math.round((t.price - avg) * sellQty);
      pnlByTradeId[t.id] = pnl;
      p.stat.realized += pnl;
      p.stat.sellCount += 1;
      if (pnl > 0) p.stat.winCount += 1;
      p.cost -= avg * sellQty;
      p.qty -= sellQty;
      if (p.qty === 0) p.cost = 0;
      const month = t.date.slice(0, 7);
      const m = monthMap.get(month) ?? { realized: 0, costBasis: 0 };
      m.realized += pnl;
      m.costBasis += Math.round(avg * sellQty);
      monthMap.set(month, m);
    }
  }

  const bySymbol: SymbolStat[] = [...map.values()].map((p) => {
    p.stat.holdingQty = p.qty;
    p.stat.avgPrice = p.qty > 0 ? Math.round(p.cost / p.qty) : 0;
    return p.stat;
  });
  bySymbol.sort((a, b) => b.realized - a.realized);

  const totalRealized = bySymbol.reduce((s, x) => s + x.realized, 0);
  const sellCount = bySymbol.reduce((s, x) => s + x.sellCount, 0);
  const winCount = bySymbol.reduce((s, x) => s + x.winCount, 0);
  const byMonth = [...monthMap.entries()]
    .map(([month, v]) => ({ month, realized: v.realized, costBasis: v.costBasis }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  return {
    totalRealized,
    sellCount,
    winCount,
    winRate: sellCount > 0 ? Math.round((winCount / sellCount) * 1000) / 10 : null,
    bySymbol,
    byMonth,
    pnlByTradeId,
  };
}

export function isValidTrade(t: unknown): t is Trade {
  if (typeof t !== 'object' || t === null) return false;
  const x = t as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    typeof x.symbol === 'string' &&
    x.symbol.trim() !== '' &&
    (x.side === 'buy' || x.side === 'sell') &&
    typeof x.price === 'number' &&
    Number.isFinite(x.price) &&
    x.price > 0 &&
    typeof x.qty === 'number' &&
    Number.isFinite(x.qty) &&
    x.qty > 0 &&
    typeof x.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.date)
  );
}

export function formatWon(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

export function formatSigned(n: number): string {
  if (n > 0) return `+${n.toLocaleString('ko-KR')}원`;
  return `${n.toLocaleString('ko-KR')}원`;
}

/** 손익 헤드라인 표기: 0(및 -0)은 "+0원", 양수 "+", 음수 "-". "-0원"·NaN 노출 금지 */
export function formatPnlHeadline(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '+0원';
  return formatSigned(n);
}

/**
 * OCR 텍스트에서 골라 넣기 칩 후보 추출.
 * - 숫자 후보: 콤마 포함 숫자(1 이상), 중복 제거, 등장 순서 유지, 최대 12개
 * - 종목명 후보: 한글 2자 이상 또는 영대문자 2자 이상 토큰, 흔한 명세서 단어 제외, 최대 8개
 */
const NOISE_WORDS = new Set([
  '매수', '매도', '체결', '주문', '수량', '단가', '가격', '금액', '체결가', '체결량',
  '주식', '현금', '계좌', '잔고', '수수료', '세금', '정정', '취소', '접수', '완료',
  'KRW', 'BUY', 'SELL',
]);

export interface OcrCandidates {
  numbers: number[];
  names: string[];
}

export function extractCandidates(text: string): OcrCandidates {
  const numbers: number[] = [];
  const seen = new Set<number>();
  for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+|\d+/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    numbers.push(n);
    if (numbers.length >= 12) break;
  }
  const names: string[] = [];
  const nameSeen = new Set<string>();
  for (const m of text.matchAll(/[가-힣]{2,10}|[A-Z]{2,6}/g)) {
    const w = m[0];
    if (NOISE_WORDS.has(w) || nameSeen.has(w)) continue;
    nameSeen.add(w);
    names.push(w);
    if (names.length >= 8) break;
  }
  return { numbers, names };
}
