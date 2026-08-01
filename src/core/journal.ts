/**
 * 매매일지 순수 계산 로직 — UI/저장소와 분리.
 *
 * 실현손익 규칙(수수료·세금 없음 명시):
 * - 같은 종목의 매수를 이동평균 단가로 합산한다.
 * - 매도 시 실현손익 = (매도단가 - 평균단가) × 매도수량. 평균단가는 유지된다(부분매도).
 * - 보유수량을 초과한 매도수량은 보유분까지만 실현손익에 반영한다(초과분 무시).
 * - 거래 순서는 날짜 오름차순, 같은 날짜는 입력 순서.
 */

import { buyCost, sellProceeds, ZERO_FEES, type FeeRates } from './fees';

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
  /** 손절가(선택, 매수 기록에만). R-multiple 계산에 쓰이며 없어도 동작한다 */
  stopPrice?: number;
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

export function computeStats(trades: Trade[], rates: FeeRates = ZERO_FEES): JournalStats {
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
      p.cost += buyCost(t.price, t.qty, rates);
    } else {
      const sellQty = Math.min(t.qty, p.qty);
      if (sellQty <= 0) continue; // 보유 없는 매도 — 손익 계산 불가, 건너뜀
      const avg = p.cost / p.qty; // 수수료 포함 평균단가
      const pnl = Math.round(sellProceeds(t.price, sellQty, rates) - avg * sellQty);
      pnlByTradeId[t.id] = pnl;
      p.stat.realized += pnl;
      p.stat.sellCount += 1;
      if (pnl > 0) p.stat.winCount += 1;
      p.cost -= avg * sellQty;
      p.qty -= sellQty;
      // 소수점 주식 부동소수점 잔여치 방어
      if (p.qty < 1e-9) {
        p.qty = 0;
        p.cost = 0;
      }
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

/** 수량 표기: 소수점 주식은 소수 6자리까지 */
export function formatQty(n: number): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}
