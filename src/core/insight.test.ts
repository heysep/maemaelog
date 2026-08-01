import { describe, expect, it } from 'vitest';
import { analyzeHabits, hourBand } from './insight';
import type { Trade } from './journal';

let seq = 0;
function t(partial: Partial<Trade> & Pick<Trade, 'symbol' | 'side' | 'price' | 'qty' | 'date'>): Trade {
  seq += 1;
  return { id: `i${seq}`, memo: '', emotion: '', ...partial };
}

describe('analyzeHabits', () => {
  it('빈 기록이면 기본 처방만 나온다', () => {
    const r = analyzeHabits([]);
    expect(r.prescriptions.length).toBe(1);
    expect(r.emotionStats).toEqual([]);
    expect(r.peakWeekday).toBeNull();
  });

  it('감정 태그별 매도 손익·승률을 집계한다', () => {
    const r = analyzeHabits([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 20, date: '2026-07-01', emotion: '확신' }),
      t({ symbol: 'A', side: 'sell', price: 150, qty: 10, date: '2026-07-02', emotion: '원칙' }),
      t({ symbol: 'A', side: 'sell', price: 50, qty: 10, date: '2026-07-03', emotion: '공포' }),
    ]);
    const principle = r.emotionStats.find((e) => e.emotion === '원칙')!;
    expect(principle.realized).toBe(500);
    expect(principle.winCount).toBe(1);
    const fear = r.emotionStats.find((e) => e.emotion === '공포')!;
    expect(fear.realized).toBe(-500);
    expect(fear.winCount).toBe(0);
  });

  it('추격매수: 직전 매수보다 높은 단가 재매수 또는 추격·뇌동 태그', () => {
    const r = analyzeHabits([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 1, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'buy', price: 120, qty: 1, date: '2026-07-02' }), // 가격 추격
      t({ symbol: 'B', side: 'buy', price: 100, qty: 1, date: '2026-07-03', emotion: '뇌동' }), // 태그
      t({ symbol: 'C', side: 'buy', price: 100, qty: 1, date: '2026-07-04' }), // 정상
    ]);
    expect(r.chaseBuyCount).toBe(2);
    expect(r.buyCount).toBe(4);
  });

  it('물타기: 보유 평균단가보다 낮은 단가 추가 매수', () => {
    const r = analyzeHabits([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'buy', price: 80, qty: 10, date: '2026-07-02' }),
      t({ symbol: 'A', side: 'buy', price: 70, qty: 10, date: '2026-07-03' }),
    ]);
    expect(r.averagingDownCount).toBe(2);
  });

  it('전량 청산 후 재매수는 추격으로 치지 않는다', () => {
    const r = analyzeHabits([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 110, qty: 10, date: '2026-07-02' }),
      t({ symbol: 'A', side: 'buy', price: 200, qty: 10, date: '2026-07-03' }),
    ]);
    expect(r.chaseBuyCount).toBe(0);
  });

  it('요일 성향: 가장 몰린 요일을 찾는다 (2026-07-06은 월요일)', () => {
    const r = analyzeHabits([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 1, date: '2026-07-06' }),
      t({ symbol: 'B', side: 'buy', price: 100, qty: 1, date: '2026-07-13' }),
      t({ symbol: 'C', side: 'buy', price: 100, qty: 1, date: '2026-07-07' }),
    ]);
    expect(r.peakWeekday).toBe('월');
  });

  it('시간대 성향: time이 있는 기록만 집계', () => {
    const r = analyzeHabits([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 1, date: '2026-07-06', time: '09:10' }),
      t({ symbol: 'B', side: 'buy', price: 100, qty: 1, date: '2026-07-07', time: '09:40' }),
      t({ symbol: 'C', side: 'buy', price: 100, qty: 1, date: '2026-07-08' }),
    ]);
    expect(r.hourBandStats[0]).toEqual({ band: '개장 직후(9시대)', count: 2 });
  });

  it('추격 비중 30% 초과 시 추격 처방이 나온다', () => {
    const r = analyzeHabits([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 1, date: '2026-07-01', emotion: '추격' }),
      t({ symbol: 'B', side: 'buy', price: 100, qty: 1, date: '2026-07-02', emotion: '추격' }),
      t({ symbol: 'C', side: 'buy', price: 100, qty: 1, date: '2026-07-03' }),
    ]);
    expect(r.prescriptions.some((p) => p.includes('추격'))).toBe(true);
  });
});

describe('hourBand', () => {
  it('경계값', () => {
    expect(hourBand('08:59')).toBe('장 시작 전');
    expect(hourBand('09:00')).toBe('개장 직후(9시대)');
    expect(hourBand('12:00')).toBe('오후');
    expect(hourBand('15:30')).toBe('마감 무렵');
    expect(hourBand('16:00')).toBe('장 마감 후');
    expect(hourBand('없음')).toBeNull();
  });
});
