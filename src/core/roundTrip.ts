/**
 * 라운드트립(포지션) 집계 — 순수 함수.
 *
 * 왜 필요한가: 매도 1건을 1승부로 세면 분할 익절 시 승률이 부풀고 일괄 손절 시 깎인다.
 * Tradervue/TradeZella처럼 **보유수량 0 → 양수(진입) ~ 양수 → 0(청산)** 을 한 건으로 묶어
 * 승률·평균 보유기간·매매 건수를 라운드트립 단위로 정의한다.
 *
 * 규칙:
 * - 시간 제한(당일 청산 등) 규칙은 두지 않는다 — 스윙 매매에 해롭다.
 * - 부분 청산 후 보유수량이 0을 거치지 않고 재매수하면 같은 라운드트립을 이어간다.
 * - 청산되지 않은 포지션은 open=true("진행 중")로 승패 집계에서 제외한다.
 * - 보유수량을 초과한 매도는 보유분까지만 반영한다(방어).
 * - 수수료·세금은 설정 요율(FeeRates)을 받아 계산 시점에 반영한다(요율 0이면 미반영과 동일).
 */
import { isValidTrade, sortForCalc, type Trade } from './journal';
import { buyCost, sellProceeds, ZERO_FEES, type FeeRates } from './fees';

export interface RoundTrip {
  symbol: string;
  /** 첫 진입일 YYYY-MM-DD */
  entryDate: string;
  /** 최종 청산일. 진행 중이면 null */
  exitDate: string | null;
  /** 총 매수수량 */
  buyQty: number;
  /** 평균 진입단가 */
  avgEntry: number;
  /** 총 매도수량 */
  sellQty: number;
  /** 평균 청산단가. 매도가 없으면 null */
  avgExit: number | null;
  /** 실현손익(원) */
  realized: number;
  /** 수익률(%) = 실현손익 ÷ 청산분 진입원가. 청산 전이면 null */
  returnPct: number | null;
  /** 보유일수(진입일~청산일). 진행 중이면 null */
  holdDays: number | null;
  /** 진행 중 여부 */
  open: boolean;
  /** 남은 보유수량(진행 중일 때 > 0) */
  openQty: number;
  /** 포함된 기록 id */
  tradeIds: string[];
  /** 첫 진입 기록의 감정 태그 */
  entryEmotion: string;
  /** 마지막 청산 기록의 감정 태그 */
  exitEmotion: string;
  /** 첫 진입 기록의 손절가(선택 입력). 없으면 null */
  stopPrice: number | null;
  /**
   * R-multiple = (평균 청산단가 − 평균 진입단가) ÷ (평균 진입단가 − 손절가).
   * 손절가가 없거나 진입가 이상이면 null(계산 불가).
   */
  rMultiple: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EPS = 1e-9;

function dayDiff(a: string, b: string): number {
  const d = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(d) ? Math.max(0, d) : 0;
}

interface Draft {
  symbol: string;
  entryDate: string;
  exitDate: string | null;
  buyQty: number;
  entryCost: number;
  sellQty: number;
  exitProceeds: number;
  /** 청산된 수량의 진입원가 합(수익률 분모) */
  closedCost: number;
  realized: number;
  tradeIds: string[];
  entryEmotion: string;
  exitEmotion: string;
  stopPrice: number | null;
}

function finalize(d: Draft, openQty: number): RoundTrip {
  const open = openQty > EPS;
  const avgEntry = d.buyQty > 0 ? Math.round(d.entryCost / d.buyQty) : 0;
  const avgExit = d.sellQty > 0 ? Math.round(d.exitProceeds / d.sellQty) : null;
  const risk = d.stopPrice !== null ? avgEntry - d.stopPrice : 0;
  const rMultiple =
    !open && avgExit !== null && d.stopPrice !== null && risk > 0
      ? Math.round(((avgExit - avgEntry) / risk) * 100) / 100
      : null;
  return {
    symbol: d.symbol,
    entryDate: d.entryDate,
    exitDate: open ? null : d.exitDate,
    buyQty: Math.round(d.buyQty * 1e6) / 1e6,
    avgEntry,
    sellQty: Math.round(d.sellQty * 1e6) / 1e6,
    avgExit,
    realized: d.realized,
    returnPct: !open && d.closedCost > 0 ? Math.round((d.realized / d.closedCost) * 1000) / 10 : null,
    holdDays: !open && d.exitDate !== null ? dayDiff(d.entryDate, d.exitDate) : null,
    open,
    openQty: open ? Math.round(openQty * 1e6) / 1e6 : 0,
    tradeIds: d.tradeIds,
    entryEmotion: d.entryEmotion,
    exitEmotion: d.exitEmotion,
    stopPrice: d.stopPrice,
    rMultiple,
  };
}

export function buildRoundTrips(input: Trade[], rates: FeeRates = ZERO_FEES): RoundTrip[] {
  const trades = sortForCalc(input.filter(isValidTrade));
  const state = new Map<string, { qty: number; cost: number; draft: Draft | null }>();
  const out: RoundTrip[] = [];

  for (const t of trades) {
    let s = state.get(t.symbol);
    if (!s) {
      s = { qty: 0, cost: 0, draft: null };
      state.set(t.symbol, s);
    }
    if (t.side === 'buy') {
      if (s.draft === null) {
        // 보유 0 → 양수: 새 라운드트립 시작
        s.draft = {
          symbol: t.symbol,
          entryDate: t.date,
          exitDate: null,
          buyQty: 0,
          entryCost: 0,
          sellQty: 0,
          exitProceeds: 0,
          closedCost: 0,
          realized: 0,
          tradeIds: [],
          entryEmotion: t.emotion,
          exitEmotion: '',
          // 라운드트립의 손절가는 첫 진입 기록의 값을 쓴다
          stopPrice: typeof t.stopPrice === 'number' && Number.isFinite(t.stopPrice) && t.stopPrice > 0 ? t.stopPrice : null,
        };
      }
      const cost = buyCost(t.price, t.qty, rates);
      s.draft.buyQty += t.qty;
      s.draft.entryCost += cost;
      s.draft.tradeIds.push(t.id);
      s.qty += t.qty;
      s.cost += cost;
    } else {
      if (s.draft === null || s.qty <= EPS) continue; // 보유 없는 매도 — 손익 계산 불가
      const sellQty = Math.min(t.qty, s.qty); // 초과 매도 방어
      const avg = s.cost / s.qty; // 수수료 포함 평균단가
      const proceeds = sellProceeds(t.price, sellQty, rates);
      const pnl = Math.round(proceeds - avg * sellQty);
      s.draft.sellQty += sellQty;
      s.draft.exitProceeds += proceeds;
      s.draft.closedCost += avg * sellQty;
      s.draft.realized += pnl;
      s.draft.exitDate = t.date;
      s.draft.exitEmotion = t.emotion;
      s.draft.tradeIds.push(t.id);
      s.cost -= avg * sellQty;
      s.qty -= sellQty;
      if (s.qty <= EPS) {
        // 양수 → 0: 라운드트립 종료
        s.qty = 0;
        s.cost = 0;
        out.push(finalize(s.draft, 0));
        s.draft = null;
      }
    }
  }

  // 미청산 포지션(진행 중)
  for (const s of state.values()) {
    if (s.draft !== null) out.push(finalize(s.draft, s.qty));
  }

  // 진입일 오름차순 (동일 진입일이면 종목명)
  out.sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : a.symbol < b.symbol ? -1 : 1));
  return out;
}

export interface RoundTripStats {
  /** 청산 완료된 라운드트립 수 = 매매 건수 */
  closedCount: number;
  openCount: number;
  winCount: number;
  lossCount: number;
  /** 승률(%) — 청산 건이 없으면 null */
  winRate: number | null;
  /** 평균 이익(이익 라운드트립 평균) */
  avgWin: number;
  /** 평균 손실(절대값) */
  avgLoss: number;
  /** 손익비 = 평균이익 ÷ 평균손실. 손실 건 0이면 null(∞ 금지) */
  payoffRatio: number | null;
  grossProfit: number;
  /** 총손실(절대값) */
  grossLoss: number;
  /** Profit Factor = 총이익 ÷ 총손실. 총손실 0이면 null */
  profitFactor: number | null;
  /** 평균 보유일수(청산 건 기준) — 없으면 null */
  avgHoldDays: number | null;
  totalRealized: number;
}

export function computeRoundTripStats(rts: RoundTrip[]): RoundTripStats {
  const closed = rts.filter((r) => !r.open);
  const wins = closed.filter((r) => r.realized > 0);
  const losses = closed.filter((r) => r.realized < 0);
  const grossProfit = wins.reduce((s, r) => s + r.realized, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.realized, 0));
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const holdDays = closed.map((r) => r.holdDays).filter((d): d is number => d !== null);
  return {
    closedCount: closed.length,
    openCount: rts.length - closed.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: closed.length > 0 ? Math.round((wins.length / closed.length) * 1000) / 10 : null,
    avgWin: Math.round(avgWin),
    avgLoss: Math.round(avgLoss),
    payoffRatio: avgLoss > 0 ? Math.round((avgWin / avgLoss) * 100) / 100 : null,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : null,
    avgHoldDays:
      holdDays.length > 0 ? Math.round((holdDays.reduce((s, d) => s + d, 0) / holdDays.length) * 10) / 10 : null,
    totalRealized: closed.reduce((s, r) => s + r.realized, 0),
  };
}

export interface EmotionPerf {
  emotion: string;
  /** 라운드트립 수(청산 완료 기준) */
  trips: number;
  winCount: number;
  /** 승률(%) */
  winRate: number;
  realized: number;
}

function perfBy(rts: RoundTrip[], pick: (r: RoundTrip) => string): EmotionPerf[] {
  const map = new Map<string, EmotionPerf>();
  for (const r of rts) {
    if (r.open) continue;
    const tag = pick(r);
    if (tag === '') continue;
    let e = map.get(tag);
    if (!e) {
      e = { emotion: tag, trips: 0, winCount: 0, winRate: 0, realized: 0 };
      map.set(tag, e);
    }
    e.trips += 1;
    if (r.realized > 0) e.winCount += 1;
    e.realized += r.realized;
  }
  const out = [...map.values()];
  for (const e of out) e.winRate = e.trips > 0 ? Math.round((e.winCount / e.trips) * 100) : 0;
  out.sort((a, b) => b.trips - a.trips);
  return out;
}

/** 살 때 감정별 성과 — 라운드트립 손익을 첫 진입 감정에 귀속 */
export function entryEmotionPerf(rts: RoundTrip[]): EmotionPerf[] {
  return perfBy(rts, (r) => r.entryEmotion);
}

/** 팔 때 감정별 성과 — 마지막 청산 감정 기준 */
export function exitEmotionPerf(rts: RoundTrip[]): EmotionPerf[] {
  return perfBy(rts, (r) => r.exitEmotion);
}

export interface RStats {
  /** 손절가를 적어 R 계산이 가능한 라운드트립 수 */
  count: number;
  /** 평균 R = 기대값(Expectancy) */
  avgR: number | null;
  bestR: number | null;
  worstR: number | null;
}

/** R-multiple 통계. 손절가를 적은 청산 건만 대상(나머지 통계에는 영향 없음) */
export function computeRStats(rts: RoundTrip[]): RStats {
  const rs = rts.map((r) => r.rMultiple).filter((r): r is number => r !== null);
  if (rs.length === 0) return { count: 0, avgR: null, bestR: null, worstR: null };
  const avg = rs.reduce((s, r) => s + r, 0) / rs.length;
  return {
    count: rs.length,
    avgR: Math.round(avg * 100) / 100,
    bestR: Math.max(...rs),
    worstR: Math.min(...rs),
  };
}

/** R 카드 노출 최소 건수 — 반쪽 통계 노출 금지 */
export const MIN_R_TRIPS = 3;
/** 손익비·PF 카드 노출 최소 라운드트립 수 */
export const MIN_RATIO_TRIPS = 3;
