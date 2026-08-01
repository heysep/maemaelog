import { describe, expect, it } from 'vitest';
import { hasMissingCoreFields, mergeParsed } from './mergeParse';
import type { ParsedTrade } from './ocrParse';

type LocalInput = Omit<Partial<ParsedTrade>, 'confident'> & { confident?: Partial<ParsedTrade['confident']> };

function local(p: LocalInput = {}): ParsedTrade {
  const { confident, ...rest } = p;
  return {
    ...rest,
    confident: { symbol: false, side: false, price: false, qty: false, date: false, ...confident },
  };
}

describe('hasMissingCoreFields', () => {
  it('종목명·단가·수량·날짜 중 하나라도 비면 true', () => {
    expect(hasMissingCoreFields(local({ symbol: 'A', price: 1, qty: 1, date: '2026-07-24' }))).toBe(false);
    expect(hasMissingCoreFields(local({ symbol: 'A', qty: 1, date: '2026-07-24' }))).toBe(true);
    expect(hasMissingCoreFields(local({ symbol: 'A', price: 1, qty: 1 }))).toBe(true);
    expect(hasMissingCoreFields(local())).toBe(true);
  });

  it('시각은 핵심 필드가 아니다', () => {
    expect(hasMissingCoreFields(local({ symbol: 'A', price: 1, qty: 1, date: '2026-07-24' }))).toBe(false);
  });
});

describe('mergeParsed', () => {
  it('로컬이 확신으로 채운 값은 서버가 덮어쓰지 않는다', () => {
    const l = local({ symbol: '삼성전자', price: 72400, confident: { symbol: true, price: true } });
    const { merged, filledByAi } = mergeParsed(l, { symbol: '삼성', price: 999 });
    expect(merged.symbol).toBe('삼성전자');
    expect(merged.price).toBe(72400);
    expect(filledByAi).toEqual([]);
  });

  it('로컬이 비확신으로 채운 값은 서버 값이 우선한다', () => {
    const l = local({ price: 470716, confident: { price: false } });
    const { merged, filledByAi } = mergeParsed(l, { price: 469734 });
    expect(merged.price).toBe(469734);
    expect(filledByAi).toContain('price');
  });

  it('로컬이 비어 있는 필드를 서버가 채운다', () => {
    const { merged, filledByAi } = mergeParsed(local({ symbol: '알파벳 A', confident: { symbol: true } }), {
      side: 'buy', price: 469734, qty: 1, date: '2026-07-24', time: '19:27',
    });
    expect(merged.side).toBe('buy');
    expect(merged.price).toBe(469734);
    expect(merged.qty).toBe(1);
    expect(merged.date).toBe('2026-07-24');
    expect(merged.time).toBe('19:27');
    expect(filledByAi).toEqual(['side', 'price', 'qty', 'date', 'time']);
  });

  it('서버가 null로 준 필드는 무시한다(추측 금지)', () => {
    const l = local({ symbol: '카카오', confident: { symbol: true } });
    const { merged, filledByAi } = mergeParsed(l, { symbol: null, side: null, price: null, qty: null, date: null, time: null });
    expect(merged.symbol).toBe('카카오');
    expect(merged.price).toBeUndefined();
    expect(filledByAi).toEqual([]);
  });

  it('잘못된 형식의 서버 값은 무시한다', () => {
    const { merged } = mergeParsed(local(), {
      symbol: '   ', side: 'hold', price: -100, qty: 0, date: '2026/07/24', time: '늦은밤',
    });
    expect(merged.symbol).toBeUndefined();
    expect(merged.side).toBeUndefined();
    expect(merged.price).toBeUndefined();
    expect(merged.qty).toBeUndefined();
    expect(merged.date).toBeUndefined();
    expect(merged.time).toBeUndefined();
  });

  it('서버 응답이 없으면(null) 로컬 결과 그대로', () => {
    const l = local({ symbol: 'A', price: 100, confident: { symbol: true } });
    const { merged, filledByAi } = mergeParsed(l, null);
    expect(merged).toEqual(l);
    expect(filledByAi).toEqual([]);
  });

  it('소수점 주식 수량은 반올림하지 않는다', () => {
    const { merged } = mergeParsed(local(), { qty: 1.071309 });
    expect(merged.qty).toBe(1.071309);
  });

  it('단가는 원 단위 정수로 반올림한다', () => {
    const { merged } = mergeParsed(local(), { price: 469733.6 });
    expect(merged.price).toBe(469734);
  });
});
