import { describe, expect, it } from 'vitest';
import {
  buildRoundTrips,
  computeRoundTripStats,
  entryEmotionPerf,
  exitEmotionPerf,
} from './roundTrip';
import type { Trade } from './journal';

let seq = 0;
function t(partial: Partial<Trade> & Pick<Trade, 'symbol' | 'side' | 'price' | 'qty' | 'date'>): Trade {
  seq += 1;
  return { id: `r${seq}`, memo: '', emotion: '', ...partial };
}

describe('buildRoundTrips', () => {
  it('단순 1매수 1매도 = 라운드트립 1건', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 150, qty: 10, date: '2026-07-11' }),
    ]);
    expect(rts).toHaveLength(1);
    expect(rts[0]).toMatchObject({
      symbol: 'A', entryDate: '2026-07-01', exitDate: '2026-07-11',
      buyQty: 10, avgEntry: 100, sellQty: 10, avgExit: 150,
      realized: 500, returnPct: 50, holdDays: 10, open: false,
    });
    expect(rts[0].tradeIds).toHaveLength(2);
  });

  it('분할매수 → 일괄매도 = 1건, 평균 진입단가 반영', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'buy', price: 200, qty: 10, date: '2026-07-05' }),
      t({ symbol: 'A', side: 'sell', price: 180, qty: 20, date: '2026-07-10' }),
    ]);
    expect(rts).toHaveLength(1);
    expect(rts[0].avgEntry).toBe(150);
    expect(rts[0].realized).toBe(600);
    expect(rts[0].buyQty).toBe(20);
  });

  it('일괄매수 → 분할매도 = 1건(분할 익절해도 승부는 1건)', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 150, qty: 5, date: '2026-07-05' }),
      t({ symbol: 'A', side: 'sell', price: 120, qty: 5, date: '2026-07-08' }),
    ]);
    expect(rts).toHaveLength(1);
    expect(rts[0].realized).toBe(350); // 250 + 100
    expect(rts[0].avgExit).toBe(135);
    expect(rts[0].exitDate).toBe('2026-07-08');
  });

  it('중간 재매수(보유 0 미경유)는 같은 라운드트립을 이어간다', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 150, qty: 5, date: '2026-07-03' }),
      t({ symbol: 'A', side: 'buy', price: 120, qty: 5, date: '2026-07-04' }),
      t({ symbol: 'A', side: 'sell', price: 160, qty: 10, date: '2026-07-09' }),
    ]);
    expect(rts).toHaveLength(1);
    expect(rts[0].buyQty).toBe(15);
    expect(rts[0].entryDate).toBe('2026-07-01');
    expect(rts[0].exitDate).toBe('2026-07-09');
  });

  it('전량 매도 후 재진입은 새 라운드트립', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 110, qty: 10, date: '2026-07-02' }),
      t({ symbol: 'A', side: 'buy', price: 200, qty: 10, date: '2026-07-03' }),
      t({ symbol: 'A', side: 'sell', price: 180, qty: 10, date: '2026-07-04' }),
    ]);
    expect(rts).toHaveLength(2);
    expect(rts[0].realized).toBe(100);
    expect(rts[1].realized).toBe(-200);
  });

  it('미청산 포지션은 open=true, 승패 집계에서 빠진다', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 150, qty: 4, date: '2026-07-02' }),
    ]);
    expect(rts).toHaveLength(1);
    expect(rts[0].open).toBe(true);
    expect(rts[0].openQty).toBe(6);
    expect(rts[0].exitDate).toBeNull();
    expect(rts[0].holdDays).toBeNull();
    expect(rts[0].returnPct).toBeNull();
    const s = computeRoundTripStats(rts);
    expect(s.closedCount).toBe(0);
    expect(s.openCount).toBe(1);
    expect(s.winRate).toBeNull();
  });

  it('보유수량 초과 매도는 보유분까지만 반영하고 라운드트립을 닫는다', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 5, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 120, qty: 100, date: '2026-07-02' }),
    ]);
    expect(rts).toHaveLength(1);
    expect(rts[0].sellQty).toBe(5);
    expect(rts[0].realized).toBe(100);
    expect(rts[0].open).toBe(false);
  });

  it('보유 없는 매도만 있으면 라운드트립이 생기지 않는다', () => {
    expect(buildRoundTrips([t({ symbol: 'A', side: 'sell', price: 100, qty: 5, date: '2026-07-01' })])).toEqual([]);
  });

  it('종목이 여러 개면 각각 독립적으로 묶인다', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'B', side: 'buy', price: 200, qty: 5, date: '2026-07-02' }),
      t({ symbol: 'A', side: 'sell', price: 130, qty: 10, date: '2026-07-03' }),
      t({ symbol: 'B', side: 'sell', price: 180, qty: 5, date: '2026-07-04' }),
    ]);
    expect(rts.map((r) => r.symbol)).toEqual(['A', 'B']);
    expect(rts[0].realized).toBe(300);
    expect(rts[1].realized).toBe(-100);
  });

  it('소수점 주식도 잔여치 없이 청산 처리된다', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 470163, qty: 1.071309, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 500000, qty: 1.071309, date: '2026-07-05' }),
    ]);
    expect(rts).toHaveLength(1);
    expect(rts[0].open).toBe(false);
    expect(rts[0].realized).toBe(Math.round((500000 - 470163) * 1.071309));
  });

  it('입력 순서가 뒤섞여도 날짜순으로 묶는다', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'sell', price: 150, qty: 10, date: '2026-07-10' }),
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
    ]);
    expect(rts).toHaveLength(1);
    expect(rts[0].realized).toBe(500);
  });
});

describe('computeRoundTripStats — 승률·손익비·Profit Factor', () => {
  const sample = () =>
    buildRoundTrips([
      // 이익 2건 (+500, +300), 손실 1건 (-400)
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 150, qty: 10, date: '2026-07-03' }),
      t({ symbol: 'B', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'B', side: 'sell', price: 130, qty: 10, date: '2026-07-06' }),
      t({ symbol: 'C', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'C', side: 'sell', price: 60, qty: 10, date: '2026-07-02' }),
    ]);

  it('승률·평균이익·평균손실·손익비·PF', () => {
    const s = computeRoundTripStats(sample());
    expect(s.closedCount).toBe(3);
    expect(s.winCount).toBe(2);
    expect(s.lossCount).toBe(1);
    expect(s.winRate).toBeCloseTo(66.7);
    expect(s.avgWin).toBe(400); // (500+300)/2
    expect(s.avgLoss).toBe(400);
    expect(s.payoffRatio).toBe(1); // 400/400
    expect(s.profitFactor).toBe(2); // 800/400
    expect(s.totalRealized).toBe(400);
  });

  it('평균 보유일수는 청산 건 기준', () => {
    const s = computeRoundTripStats(sample());
    expect(s.avgHoldDays).toBeCloseTo(2.7); // (2+5+1)/3
  });

  it('손실 건이 0이면 손익비·PF는 null(∞ 금지)', () => {
    const s = computeRoundTripStats(
      buildRoundTrips([
        t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
        t({ symbol: 'A', side: 'sell', price: 150, qty: 10, date: '2026-07-02' }),
      ])
    );
    expect(s.payoffRatio).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.winRate).toBe(100);
  });

  it('분할 매도가 승률을 부풀리지 않는다 (매도 2건이어도 라운드트립 1건)', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 150, qty: 5, date: '2026-07-02' }),
      t({ symbol: 'A', side: 'sell', price: 40, qty: 5, date: '2026-07-03' }),
      t({ symbol: 'B', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'B', side: 'sell', price: 50, qty: 10, date: '2026-07-02' }),
    ]);
    const s = computeRoundTripStats(rts);
    // A: +250 -300 = -50(손실), B: -500(손실) → 승률 0%
    expect(s.closedCount).toBe(2);
    expect(s.winRate).toBe(0);
  });

  it('빈 입력', () => {
    const s = computeRoundTripStats([]);
    expect(s).toMatchObject({ closedCount: 0, winRate: null, payoffRatio: null, profitFactor: null, avgHoldDays: null });
  });
});

describe('감정 귀속', () => {
  const rts = () =>
    buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01', emotion: '추격' }),
      t({ symbol: 'A', side: 'buy', price: 90, qty: 10, date: '2026-07-02', emotion: '확신' }),
      t({ symbol: 'A', side: 'sell', price: 80, qty: 20, date: '2026-07-03', emotion: '공포' }),
      t({ symbol: 'B', side: 'buy', price: 100, qty: 10, date: '2026-07-01', emotion: '원칙' }),
      t({ symbol: 'B', side: 'sell', price: 150, qty: 10, date: '2026-07-05', emotion: '원칙' }),
    ]);

  it('살 때 감정: 첫 진입 감정에 라운드트립 손익을 귀속한다', () => {
    const perf = entryEmotionPerf(rts());
    const chase = perf.find((e) => e.emotion === '추격')!;
    expect(chase.trips).toBe(1);
    expect(chase.realized).toBe(-300); // 평단 95 → 80 × 20주
    expect(chase.winRate).toBe(0);
    // 두 번째 매수 감정(확신)은 귀속되지 않는다
    expect(perf.find((e) => e.emotion === '확신')).toBeUndefined();
    const principle = perf.find((e) => e.emotion === '원칙')!;
    expect(principle.realized).toBe(500);
    expect(principle.winRate).toBe(100);
  });

  it('팔 때 감정: 마지막 청산 감정 기준', () => {
    const perf = exitEmotionPerf(rts());
    const fear = perf.find((e) => e.emotion === '공포')!;
    expect(fear.trips).toBe(1);
    expect(fear.realized).toBe(-300);
    expect(perf.find((e) => e.emotion === '추격')).toBeUndefined();
  });

  it('진행 중 라운드트립은 감정 성과에 포함하지 않는다', () => {
    const perf = entryEmotionPerf(
      buildRoundTrips([t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01', emotion: '확신' })])
    );
    expect(perf).toEqual([]);
  });
});
