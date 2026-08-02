/**
 * AI 분석용 익명 요약 통계 생성 — 순수 함수.
 *
 * ⚠️ 개인정보 보호 원칙: 원본 기록·메모·종목명·개별 단가/수량은 절대 포함하지 않는다.
 * 서버(supabase/functions/analyze-trades)의 StatsPayload.stats 스키마와 1:1.
 */
import { computeStats, isValidTrade, sortForCalc, type Trade } from './journal';
import { analyzeHabits } from './insight';
import { buildRoundTrips, computeRoundTripStats, computeRStats, entryEmotionPerf, exitEmotionPerf } from './roundTrip';
import { ZERO_FEES, type FeeRates } from './fees';

export interface AnalysisStats {
  totalTrades: number;
  winRate: number; // 0~100
  realizedPnl: number; // 원
  byEmotion: Array<{ tag: string; trades: number; winRate: number; pnl: number }>;
  chaseRatio?: number; // 추격성 매수 비중 0~100
  reentryWithin1d?: number; // 손실 매도 후 1일 내 같은 종목 재매수 횟수
  avgHoldDays?: number;
  monthly?: Array<{ month: string; pnl: number }>;
  /** 라운드트립(진입~청산) 기준 지표 — 매도 건수가 아니라 매매 1건 기준 */
  roundTrips?: {
    closed: number;
    open: number;
    winRate: number | null;
    payoffRatio: number | null;
    profitFactor: number | null;
    avgHoldDays: number | null;
    avgR: number | null;
    rCount: number;
  };
  /** 살 때 감정별 성과(라운드트립 손익을 첫 진입 감정에 귀속) */
  byEntryEmotion?: Array<{ tag: string; trips: number; winRate: number; pnl: number }>;
  /** 팔 때 감정별 성과 */
  byExitEmotion?: Array<{ tag: string; trips: number; winRate: number; pnl: number }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function buildStatsPayload(input: Trade[], rates: FeeRates = ZERO_FEES): AnalysisStats {
  const trades = sortForCalc(input.filter(isValidTrade));
  const stats = computeStats(trades, rates);
  const rts = buildRoundTrips(trades, rates);
  const rtStats = computeRoundTripStats(rts);
  const rStats = computeRStats(rts);
  const habits = analyzeHabits(trades, rates);

  const byEmotion = habits.emotionStats.map((e) => ({
    tag: e.emotion,
    trades: e.count,
    winRate: e.sellCount > 0 ? Math.round((e.winCount / e.sellCount) * 100) : 0,
    pnl: e.realized,
  }));

  // 손실 매도 후 1일 내 같은 종목 재매수 + 평균 보유일(직전 매수→매도 간격)
  let reentryWithin1d = 0;
  const holdSpans: number[] = [];
  const lastLossSell = new Map<string, string>();
  const lastBuy = new Map<string, string>();
  for (const t of trades) {
    if (t.side === 'buy') {
      const loss = lastLossSell.get(t.symbol);
      if (loss !== undefined && dayDiff(loss, t.date) <= 1 && dayDiff(loss, t.date) >= 0) reentryWithin1d += 1;
      lastBuy.set(t.symbol, t.date);
    } else {
      const buy = lastBuy.get(t.symbol);
      if (buy !== undefined) {
        const d = dayDiff(buy, t.date);
        if (d >= 0) holdSpans.push(d);
      }
      const pnl = stats.pnlByTradeId[t.id];
      if (pnl !== undefined && pnl < 0) lastLossSell.set(t.symbol, t.date);
      else lastLossSell.delete(t.symbol);
    }
  }

  const out: AnalysisStats = {
    totalTrades: trades.length,
    winRate: stats.winRate ?? 0,
    realizedPnl: stats.totalRealized,
    byEmotion,
    reentryWithin1d,
    monthly: stats.byMonth.map((m) => ({ month: m.month, pnl: m.realized })),
    roundTrips: {
      closed: rtStats.closedCount,
      open: rtStats.openCount,
      winRate: rtStats.winRate,
      payoffRatio: rtStats.payoffRatio,
      profitFactor: rtStats.profitFactor,
      avgHoldDays: rtStats.avgHoldDays,
      avgR: rStats.avgR,
      rCount: rStats.count,
    },
    byEntryEmotion: entryEmotionPerf(rts).map((e) => ({ tag: e.emotion, trips: e.trips, winRate: e.winRate, pnl: e.realized })),
    byExitEmotion: exitEmotionPerf(rts).map((e) => ({ tag: e.emotion, trips: e.trips, winRate: e.winRate, pnl: e.realized })),
  };
  if (habits.buyCount > 0) out.chaseRatio = Math.round((habits.chaseBuyCount / habits.buyCount) * 100);
  if (holdSpans.length > 0) {
    out.avgHoldDays = Math.round((holdSpans.reduce((s, x) => s + x, 0) / holdSpans.length) * 10) / 10;
  }
  return out;
}
