import { describe, expect, it } from 'vitest';
import { buyCost, DEFAULT_FEES, EXAMPLE_FEES, feesEnabled, normalizeRates, sellProceeds, ZERO_FEES } from './fees';
import { computeStats, type Trade } from './journal';
import { buildRoundTrips, computeRoundTripStats, computeRStats } from './roundTrip';

let seq = 0;
function t(partial: Partial<Trade> & Pick<Trade, 'symbol' | 'side' | 'price' | 'qty' | 'date'>): Trade {
  seq += 1;
  return { id: `f${seq}`, memo: '', emotion: '', ...partial };
}

describe('수수료·세금 순수 함수', () => {
  it('요율 0이면 원금 그대로', () => {
    expect(buyCost(1000, 10, ZERO_FEES)).toBe(10000);
    expect(sellProceeds(1000, 10, ZERO_FEES)).toBe(10000);
    expect(feesEnabled(ZERO_FEES)).toBe(false);
  });

  it('기본값은 0 — 사용자가 자기 요율을 넣기 전에는 미반영', () => {
    expect(DEFAULT_FEES).toEqual(ZERO_FEES);
    expect(feesEnabled(DEFAULT_FEES)).toBe(false);
  });

  it('예시 요율: 매수 수수료만, 매도 수수료+세금', () => {
    expect(buyCost(1_000_000, 1, EXAMPLE_FEES)).toBeCloseTo(1_000_150, 3); // +0.015%
    expect(sellProceeds(1_000_000, 1, EXAMPLE_FEES)).toBeCloseTo(998_050, 3); // -0.195%
    expect(feesEnabled(EXAMPLE_FEES)).toBe(true);
  });

  it('요율 정규화: 음수·NaN·과도한 값 방어', () => {
    expect(normalizeRates({ commissionPct: -1, sellTaxPct: 'x' })).toEqual(ZERO_FEES);
    expect(normalizeRates({ commissionPct: 99, sellTaxPct: 0 })).toEqual({ commissionPct: 5, sellTaxPct: 0 });
    expect(normalizeRates(null)).toEqual(ZERO_FEES);
    expect(normalizeRates({ commissionPct: 0, sellTaxPct: 0 })).toEqual(ZERO_FEES);
  });
});

describe('수수료 반영 손익', () => {
  const trades = [
    t({ symbol: 'A', side: 'buy', price: 100000, qty: 10, date: '2026-07-01' }),
    t({ symbol: 'A', side: 'sell', price: 110000, qty: 10, date: '2026-07-05' }),
  ];

  it('요율 0이면 요율 도입 전과 동일한 실현손익', () => {
    expect(computeStats(trades).totalRealized).toBe(100000);
    expect(computeStats(trades, ZERO_FEES).totalRealized).toBe(100000);
    expect(buildRoundTrips(trades)[0].realized).toBe(100000);
  });

  it('요율을 적용하면 실현손익이 비용만큼 줄어든다', () => {
    const withFees = computeStats(trades, EXAMPLE_FEES).totalRealized;
    // 매수비용 1,000,150 / 매도실수령 1,097,855 → 97,705
    expect(withFees).toBe(97705);
    expect(buildRoundTrips(trades, EXAMPLE_FEES)[0].realized).toBe(97705);
  });

  it('매도세가 손익 부호를 뒤집는 경계: 명목 이익이 세금보다 작으면 손실이 된다', () => {
    const thin = [
      t({ symbol: 'B', side: 'buy', price: 100000, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'B', side: 'sell', price: 100100, qty: 10, date: '2026-07-02' }), // 명목 +1,000원
    ];
    expect(computeStats(thin).totalRealized).toBe(1000); // 요율 0이면 이익
    const withFees = computeStats(thin, EXAMPLE_FEES).totalRealized;
    expect(withFees).toBeLessThan(0); // 수수료·세금 반영 시 손실
    // 승률도 뒤집힌다(라운드트립 기준)
    expect(computeRoundTripStats(buildRoundTrips(thin, ZERO_FEES)).winRate).toBe(100);
    expect(computeRoundTripStats(buildRoundTrips(thin, EXAMPLE_FEES)).winRate).toBe(0);
  });

  it('소수 수량에도 요율이 정상 적용된다', () => {
    const frac = [
      t({ symbol: 'C', side: 'buy', price: 470163, qty: 1.071309, date: '2026-07-01' }),
      t({ symbol: 'C', side: 'sell', price: 500000, qty: 1.071309, date: '2026-07-05' }),
    ];
    const zero = buildRoundTrips(frac, ZERO_FEES)[0].realized;
    const fee = buildRoundTrips(frac, EXAMPLE_FEES)[0].realized;
    expect(fee).toBeLessThan(zero);
    expect(fee).toBeGreaterThan(0);
  });
});

describe('R-multiple', () => {
  it('R = (평균 청산단가 − 평균 진입단가) ÷ (평균 진입단가 − 손절가)', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 10000, qty: 10, date: '2026-07-01', stopPrice: 9000 }),
      t({ symbol: 'A', side: 'sell', price: 12000, qty: 10, date: '2026-07-05' }),
    ]);
    expect(rts[0].stopPrice).toBe(9000);
    expect(rts[0].rMultiple).toBe(2); // (12000-10000)/(10000-9000)
  });

  it('손실 매매는 음수 R', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 10000, qty: 10, date: '2026-07-01', stopPrice: 9000 }),
      t({ symbol: 'A', side: 'sell', price: 9500, qty: 10, date: '2026-07-02' }),
    ]);
    expect(rts[0].rMultiple).toBe(-0.5);
  });

  it('라운드트립의 손절가는 첫 진입 기록 기준', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 10000, qty: 10, date: '2026-07-01', stopPrice: 9000 }),
      t({ symbol: 'A', side: 'buy', price: 10000, qty: 10, date: '2026-07-02', stopPrice: 5000 }),
      t({ symbol: 'A', side: 'sell', price: 11000, qty: 20, date: '2026-07-03' }),
    ]);
    expect(rts[0].stopPrice).toBe(9000);
    expect(rts[0].rMultiple).toBe(1);
  });

  it('손절가가 없거나 진입가 이상이면 R은 null', () => {
    const noStop = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 10000, qty: 1, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 11000, qty: 1, date: '2026-07-02' }),
    ]);
    expect(noStop[0].rMultiple).toBeNull();
    const badStop = buildRoundTrips([
      t({ symbol: 'B', side: 'buy', price: 10000, qty: 1, date: '2026-07-01', stopPrice: 12000 }),
      t({ symbol: 'B', side: 'sell', price: 11000, qty: 1, date: '2026-07-02' }),
    ]);
    expect(badStop[0].rMultiple).toBeNull();
  });

  it('진행 중 포지션은 R을 계산하지 않는다', () => {
    const rts = buildRoundTrips([t({ symbol: 'A', side: 'buy', price: 10000, qty: 1, date: '2026-07-01', stopPrice: 9000 })]);
    expect(rts[0].rMultiple).toBeNull();
  });

  it('computeRStats: 평균 R(기대값)·최고·최저, 손절가 없는 건은 제외', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'A', side: 'buy', price: 10000, qty: 1, date: '2026-07-01', stopPrice: 9000 }),
      t({ symbol: 'A', side: 'sell', price: 12000, qty: 1, date: '2026-07-02' }), // +2R
      t({ symbol: 'B', side: 'buy', price: 10000, qty: 1, date: '2026-07-01', stopPrice: 9000 }),
      t({ symbol: 'B', side: 'sell', price: 9000, qty: 1, date: '2026-07-02' }), // -1R
      t({ symbol: 'C', side: 'buy', price: 10000, qty: 1, date: '2026-07-01' }), // 손절가 없음
      t({ symbol: 'C', side: 'sell', price: 30000, qty: 1, date: '2026-07-02' }),
    ]);
    const r = computeRStats(rts);
    expect(r.count).toBe(2);
    expect(r.avgR).toBe(0.5); // (2 + -1) / 2
    expect(r.bestR).toBe(2);
    expect(r.worstR).toBe(-1);
  });

  it('손절가 없는 매매도 실현손익·승률에는 정상 포함된다', () => {
    const rts = buildRoundTrips([
      t({ symbol: 'C', side: 'buy', price: 10000, qty: 1, date: '2026-07-01' }),
      t({ symbol: 'C', side: 'sell', price: 30000, qty: 1, date: '2026-07-02' }),
    ]);
    expect(computeRStats(rts).count).toBe(0);
    expect(computeRoundTripStats(rts).closedCount).toBe(1);
    expect(computeRoundTripStats(rts).totalRealized).toBe(20000);
  });

  it('R 계산 없는 빈 입력', () => {
    expect(computeRStats([])).toEqual({ count: 0, avgR: null, bestR: null, worstR: null });
  });
});
