import { describe, expect, it } from 'vitest';
import { buildStatsPayload } from './statsPayload';
import type { Trade } from './journal';

let seq = 0;
function t(partial: Partial<Trade> & Pick<Trade, 'symbol' | 'side' | 'price' | 'qty' | 'date'>): Trade {
  seq += 1;
  return { id: `s${seq}`, memo: '비밀 메모', emotion: '', ...partial };
}

const SAMPLE: Trade[] = [
  t({ symbol: '삼성전자', side: 'buy', price: 70000, qty: 10, date: '2026-07-01', emotion: '확신' }),
  t({ symbol: '삼성전자', side: 'sell', price: 75000, qty: 10, date: '2026-07-10', emotion: '원칙' }),
  t({ symbol: '카카오', side: 'buy', price: 50000, qty: 5, date: '2026-07-11', emotion: '추격' }),
  t({ symbol: '카카오', side: 'sell', price: 48000, qty: 5, date: '2026-07-12', emotion: '공포' }),
  t({ symbol: '카카오', side: 'buy', price: 47000, qty: 5, date: '2026-07-13', emotion: '뇌동' }),
];

describe('buildStatsPayload — 익명 요약 통계', () => {
  it('개인정보 필드(메모·종목명·개별 단가·수량·썸네일)가 어디에도 없다', () => {
    const s = JSON.stringify(buildStatsPayload(SAMPLE));
    expect(s).not.toContain('비밀 메모');
    expect(s).not.toContain('삼성전자');
    expect(s).not.toContain('카카오');
    expect(s).not.toContain('"memo"');
    expect(s).not.toContain('"symbol"');
    expect(s).not.toContain('"price"');
    expect(s).not.toContain('"qty"');
    expect(s).not.toContain('"thumb"');
    expect(s).not.toContain('70000');
  });

  it('총건수·승률·실현손익', () => {
    const p = buildStatsPayload(SAMPLE);
    expect(p.totalTrades).toBe(5);
    expect(p.winRate).toBe(50);
    expect(p.realizedPnl).toBe(50000 - 10000);
  });

  it('감정별 집계: 태그·건수·매도 승률·손익', () => {
    const p = buildStatsPayload(SAMPLE);
    const fear = p.byEmotion.find((e) => e.tag === '공포')!;
    expect(fear.trades).toBe(1);
    expect(fear.winRate).toBe(0);
    expect(fear.pnl).toBe(-10000);
    const principle = p.byEmotion.find((e) => e.tag === '원칙')!;
    expect(principle.pnl).toBe(50000);
    expect(principle.winRate).toBe(100);
  });

  it('손실 매도 후 1일 내 같은 종목 재매수를 센다', () => {
    const p = buildStatsPayload(SAMPLE);
    expect(p.reentryWithin1d).toBe(1); // 카카오 07-12 손절 → 07-13 재매수
  });

  it('이익 매도 후 재매수는 재진입으로 치지 않는다', () => {
    const p = buildStatsPayload([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 1, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 200, qty: 1, date: '2026-07-02' }),
      t({ symbol: 'A', side: 'buy', price: 210, qty: 1, date: '2026-07-03' }),
    ]);
    expect(p.reentryWithin1d).toBe(0);
  });

  it('추격 비중(%)과 평균 보유일', () => {
    const p = buildStatsPayload(SAMPLE);
    expect(p.chaseRatio).toBe(67); // 매수 3회 중 추격·뇌동 태그 2회
    expect(p.avgHoldDays).toBe(5); // (9 + 1) / 2
  });

  it('월별 손익', () => {
    const p = buildStatsPayload(SAMPLE);
    expect(p.monthly).toEqual([{ month: '2026-07', pnl: 40000 }]);
  });

  it('빈 기록이면 0 기본값, 선택 필드는 없음', () => {
    const p = buildStatsPayload([]);
    expect(p.totalTrades).toBe(0);
    expect(p.winRate).toBe(0);
    expect(p.byEmotion).toEqual([]);
    expect(p.chaseRatio).toBeUndefined();
    expect(p.avgHoldDays).toBeUndefined();
  });
});
