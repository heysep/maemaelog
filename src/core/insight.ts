/**
 * 매매 습관 분석 — 규칙 엔진(순수 함수). 서버·외부 모델 호출 없음.
 * UI에서는 "습관 분석"으로만 표기한다(과장 표현 금지).
 */
import { computeStats, sortForCalc, isValidTrade, type Trade } from './journal';
import { ZERO_FEES, type FeeRates } from './fees';

export interface EmotionStat {
  emotion: string;
  /** 이 감정 태그가 붙은 기록 수 */
  count: number;
  /** 이 감정 태그가 붙은 매도 횟수 */
  sellCount: number;
  winCount: number;
  /** 이 감정 태그 매도의 실현손익 합 */
  realized: number;
}

export interface HabitReport {
  emotionStats: EmotionStat[];
  /** 추격매수 감지: 같은 종목 직전 매수보다 높은 단가로 재매수 or 추격·뇌동 태그 매수 */
  chaseBuyCount: number;
  /** 물타기 감지: 보유 평균단가보다 낮은 단가 추가 매수 */
  averagingDownCount: number;
  buyCount: number;
  /** 요일별 기록 수 (일~토 순, count>0만) */
  weekdayStats: { weekday: string; count: number }[];
  /** 가장 매매가 몰린 요일 */
  peakWeekday: string | null;
  /** 시간대별 기록 수 (time이 있는 기록만) */
  hourBandStats: { band: string; count: number }[];
  /** 한 줄 처방 */
  prescriptions: string[];
}

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function hourBand(time: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  if (h < 0 || h > 23) return null;
  if (h < 9) return '장 시작 전';
  if (h < 10) return '개장 직후(9시대)';
  if (h < 12) return '오전';
  if (h < 15) return '오후';
  if (h < 16) return '마감 무렵';
  return '장 마감 후';
}

export function analyzeHabits(input: Trade[], rates: FeeRates = ZERO_FEES): HabitReport {
  const trades = sortForCalc(input.filter(isValidTrade));
  // 요율을 함께 넘겨 감정별 실현손익이 다른 통계(총 실현손익·월별)와 같은 기준이 되게 한다.
  const stats = computeStats(trades, rates);

  // 감정 태그별
  const emoMap = new Map<string, EmotionStat>();
  for (const t of trades) {
    if (t.emotion === '') continue;
    let e = emoMap.get(t.emotion);
    if (!e) {
      e = { emotion: t.emotion, count: 0, sellCount: 0, winCount: 0, realized: 0 };
      emoMap.set(t.emotion, e);
    }
    e.count += 1;
    if (t.side === 'sell' && t.id in stats.pnlByTradeId) {
      const pnl = stats.pnlByTradeId[t.id];
      e.sellCount += 1;
      if (pnl > 0) e.winCount += 1;
      e.realized += pnl;
    }
  }
  const emotionStats = [...emoMap.values()].sort((a, b) => b.count - a.count);

  // 추격매수 / 물타기
  let chaseBuyCount = 0;
  let averagingDownCount = 0;
  let buyCount = 0;
  const pos = new Map<string, { qty: number; cost: number; lastBuyPrice: number | null }>();
  for (const t of trades) {
    let p = pos.get(t.symbol);
    if (!p) {
      p = { qty: 0, cost: 0, lastBuyPrice: null };
      pos.set(t.symbol, p);
    }
    if (t.side === 'buy') {
      buyCount += 1;
      const avg = p.qty > 0 ? p.cost / p.qty : null;
      const chaseTag = t.emotion === '추격' || t.emotion === '뇌동';
      const chasePrice = p.lastBuyPrice !== null && p.qty > 0 && t.price > p.lastBuyPrice;
      if (chaseTag || chasePrice) chaseBuyCount += 1;
      if (avg !== null && t.price < avg) averagingDownCount += 1;
      p.qty += t.qty;
      p.cost += t.price * t.qty; // 물타기 판정은 수수료 제외 순수 단가 기준
      p.lastBuyPrice = t.price;
    } else {
      const sellQty = Math.min(t.qty, p.qty);
      if (sellQty > 0) {
        const avg = p.cost / p.qty;
        p.cost -= avg * sellQty;
        p.qty -= sellQty;
        if (p.qty === 0) {
          p.cost = 0;
          p.lastBuyPrice = null;
        }
      }
    }
  }

  // 요일
  const wd = new Map<string, number>();
  for (const t of trades) {
    const d = new Date(`${t.date}T00:00:00`);
    if (Number.isNaN(d.getTime())) continue;
    const name = WEEKDAYS[d.getDay()];
    wd.set(name, (wd.get(name) ?? 0) + 1);
  }
  const weekdayStats = [...WEEKDAYS]
    .filter((w) => wd.has(w))
    .map((w) => ({ weekday: w, count: wd.get(w)! }));
  let peakWeekday: string | null = null;
  let peak = 0;
  for (const s of weekdayStats) {
    if (s.count > peak) {
      peak = s.count;
      peakWeekday = s.weekday;
    }
  }

  // 시간대
  const hb = new Map<string, number>();
  for (const t of trades) {
    if (!t.time) continue;
    const band = hourBand(t.time);
    if (band === null) continue;
    hb.set(band, (hb.get(band) ?? 0) + 1);
  }
  const hourBandStats = [...hb.entries()]
    .map(([band, count]) => ({ band, count }))
    .sort((a, b) => b.count - a.count);

  // 한 줄 처방 (규칙 기반)
  const prescriptions: string[] = [];
  if (buyCount >= 3 && chaseBuyCount / buyCount > 0.3) {
    prescriptions.push('매수의 30% 이상이 추격성이에요. 사기 전에 "지금 아니면 왜 안 되는가"를 메모로 먼저 적어 보세요.');
  }
  if (buyCount >= 3 && averagingDownCount / buyCount > 0.3) {
    prescriptions.push('물타기 비중이 높아요. 추가 매수 전, 처음 산 이유가 아직 유효한지부터 확인해 보세요.');
  }
  const fear = emoMap.get('공포');
  if (fear && fear.sellCount >= 2 && fear.realized < 0) {
    prescriptions.push('공포 상태의 매도가 손실로 이어지고 있어요. 손절 기준을 미리 숫자로 정해두면 감정 매도를 줄일 수 있어요.');
  }
  const principle = emoMap.get('원칙');
  if (principle && principle.sellCount >= 2 && principle.realized > 0) {
    prescriptions.push('원칙 매매의 성과가 좋아요. 그 원칙을 메모에 문장으로 남겨 반복하세요.');
  }
  if (stats.winRate !== null && stats.winRate < 40 && stats.sellCount >= 5) {
    prescriptions.push('승률이 40%를 밑돌아요. 이기는 매매의 공통점을 기록에서 찾아 매수 조건을 좁혀 보세요.');
  }
  if (prescriptions.length === 0) {
    prescriptions.push(
      trades.length < 5
        ? '아직 기록이 적어요. 5건 이상 쌓이면 습관이 또렷하게 보여요.'
        : '뚜렷한 나쁜 습관이 보이지 않아요. 지금처럼 이유와 감정을 함께 기록해 보세요.'
    );
  }

  return {
    emotionStats,
    chaseBuyCount,
    averagingDownCount,
    buyCount,
    weekdayStats,
    peakWeekday,
    hourBandStats,
    prescriptions,
  };
}
