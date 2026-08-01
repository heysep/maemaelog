import { describe, expect, it } from 'vitest';
import {
  computeStats,
  extractCandidates,
  formatPnlHeadline,
  formatSigned,
  isValidTrade,
  monthReturnRate,
  type Trade,
} from './journal';

let seq = 0;
function t(partial: Partial<Trade> & Pick<Trade, 'symbol' | 'side' | 'price' | 'qty' | 'date'>): Trade {
  seq += 1;
  return { id: `t${seq}`, memo: '', emotion: '', ...partial };
}

// 수수료·세금 없음 명시: 모든 실현손익은 (매도단가 - 평균단가) × 수량, 수수료 0 가정
describe('computeStats', () => {
  it('빈 배열이면 0/빈 결과, 승률 null', () => {
    const s = computeStats([]);
    expect(s.totalRealized).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.bySymbol).toEqual([]);
    expect(s.byMonth).toEqual([]);
  });

  it('매수만 있으면 실현손익 0, 보유수량·평균단가 계산', () => {
    const s = computeStats([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'buy', price: 200, qty: 10, date: '2026-07-02' }),
    ]);
    expect(s.totalRealized).toBe(0);
    expect(s.bySymbol[0].holdingQty).toBe(20);
    expect(s.bySymbol[0].avgPrice).toBe(150); // 이동평균 단가
  });

  it('평균단가 기준 실현손익: 100원·200원 각 10주 매수 후 180원 20주 매도 = +600', () => {
    const s = computeStats([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'buy', price: 200, qty: 10, date: '2026-07-02' }),
      t({ symbol: 'A', side: 'sell', price: 180, qty: 20, date: '2026-07-03' }),
    ]);
    expect(s.totalRealized).toBe(600); // (180-150)*20
    expect(s.bySymbol[0].holdingQty).toBe(0);
  });

  it('부분매도: 평균단가는 유지되고 잔여 수량만 줄어든다', () => {
    const s = computeStats([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 150, qty: 4, date: '2026-07-02' }),
    ]);
    expect(s.totalRealized).toBe(200); // (150-100)*4
    expect(s.bySymbol[0].holdingQty).toBe(6);
    expect(s.bySymbol[0].avgPrice).toBe(100);
  });

  it('보유수량 초과 매도는 보유분까지만 반영한다', () => {
    const s = computeStats([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 5, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 120, qty: 100, date: '2026-07-02' }),
    ]);
    expect(s.totalRealized).toBe(100); // (120-100)*5
  });

  it('보유가 전혀 없는 매도는 무시된다(손익·승률 미반영)', () => {
    const s = computeStats([t({ symbol: 'A', side: 'sell', price: 120, qty: 10, date: '2026-07-02' })]);
    expect(s.totalRealized).toBe(0);
    expect(s.winRate).toBeNull();
  });

  it('승률: 이익 매도만 승으로 센다(본전은 패 아님·승 아님 → 승 아님)', () => {
    const s = computeStats([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 30, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 150, qty: 10, date: '2026-07-02' }), // +
      t({ symbol: 'A', side: 'sell', price: 50, qty: 10, date: '2026-07-03' }), // -
      t({ symbol: 'A', side: 'sell', price: 100, qty: 10, date: '2026-07-04' }), // 0
    ]);
    expect(s.sellCount).toBe(3);
    expect(s.winCount).toBe(1);
    expect(s.winRate).toBeCloseTo(33.3);
  });

  it('종목별 순위는 실현손익 내림차순', () => {
    const s = computeStats([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'A', side: 'sell', price: 90, qty: 10, date: '2026-07-02' }),
      t({ symbol: 'B', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
      t({ symbol: 'B', side: 'sell', price: 200, qty: 10, date: '2026-07-02' }),
    ]);
    expect(s.bySymbol.map((x) => x.symbol)).toEqual(['B', 'A']);
    expect(s.bySymbol[0].realized).toBe(1000);
    expect(s.bySymbol[1].realized).toBe(-100);
  });

  it('월별 손익: 매도 날짜의 월로 집계되고 원가도 함께 쌓인다', () => {
    const s = computeStats([
      t({ symbol: 'A', side: 'buy', price: 100, qty: 20, date: '2026-06-10' }),
      t({ symbol: 'A', side: 'sell', price: 150, qty: 10, date: '2026-06-20' }),
      t({ symbol: 'A', side: 'sell', price: 80, qty: 10, date: '2026-07-05' }),
    ]);
    expect(s.byMonth).toEqual([
      { month: '2026-06', realized: 500, costBasis: 1000 },
      { month: '2026-07', realized: -200, costBasis: 1000 },
    ]);
    expect(monthReturnRate(s.byMonth[0])).toBe(50);
    expect(monthReturnRate({ realized: 0, costBasis: 0 })).toBeNull();
  });

  it('날짜가 뒤섞여 입력돼도 날짜순으로 계산한다', () => {
    const s = computeStats([
      t({ symbol: 'A', side: 'sell', price: 200, qty: 10, date: '2026-07-05' }),
      t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }),
    ]);
    expect(s.totalRealized).toBe(1000);
  });

  it('매도 거래별 손익이 pnlByTradeId로 노출된다', () => {
    const sell = t({ symbol: 'A', side: 'sell', price: 130, qty: 5, date: '2026-07-02' });
    const s = computeStats([t({ symbol: 'A', side: 'buy', price: 100, qty: 10, date: '2026-07-01' }), sell]);
    expect(s.pnlByTradeId[sell.id]).toBe(150);
  });

  it('손상 항목(형식 불일치)은 걸러진다', () => {
    const bad = [{ id: 'x' }, null, t({ symbol: 'A', side: 'buy', price: -5, qty: 1, date: '2026-07-01' })];
    const s = computeStats(bad as unknown as Trade[]);
    expect(s.bySymbol).toEqual([]);
  });
});

describe('isValidTrade / format', () => {
  it('유효성 검사 경계', () => {
    const base = t({ symbol: 'A', side: 'buy', price: 1, qty: 1, date: '2026-07-01' });
    expect(isValidTrade(base)).toBe(true);
    expect(isValidTrade({ ...base, price: 0 })).toBe(false);
    expect(isValidTrade({ ...base, qty: Infinity })).toBe(false);
    expect(isValidTrade({ ...base, symbol: '  ' })).toBe(false);
    expect(isValidTrade({ ...base, date: '2026-7-1' })).toBe(false);
  });

  it('부호 표기', () => {
    expect(formatSigned(1000)).toBe('+1,000원');
    expect(formatSigned(-1000)).toBe('-1,000원');
    expect(formatSigned(0)).toBe('0원');
  });

  it('손익 헤드라인: 0·-0은 "+0원", "-0원"·NaN 노출 금지', () => {
    expect(formatPnlHeadline(0)).toBe('+0원');
    expect(formatPnlHeadline(-0)).toBe('+0원');
    expect(formatPnlHeadline(NaN)).toBe('+0원');
    expect(formatPnlHeadline(50000)).toBe('+50,000원');
    expect(formatPnlHeadline(-500)).toBe('-500원');
  });
});

describe('extractCandidates (OCR 칩 후보)', () => {
  it('콤마 숫자·일반 숫자를 중복 없이 등장 순서로 뽑는다', () => {
    const c = extractCandidates('삼성전자 매수 체결 72,000원 10주 72,000 합계 720,000');
    expect(c.numbers).toEqual([72000, 10, 720000]);
    expect(c.names).toContain('삼성전자');
  });

  it('명세서 상용어는 종목명 후보에서 제외한다', () => {
    const c = extractCandidates('매수 체결 수량 단가 SK하이닉스');
    expect(c.names).toEqual(['SK', '하이닉스']);
  });

  it('빈 텍스트면 빈 후보', () => {
    expect(extractCandidates('')).toEqual({ numbers: [], names: [] });
  });
});
