/**
 * 수수료·세금 — 설정에 요율을 1회 입력하면 전 거래에 일괄 적용한다(순수 함수).
 *
 * - 저장된 기록은 건드리지 않는다. 계산 시점에만 적용하므로 요율을 바꾸면 통계가 즉시 재계산된다.
 * - 매수 실비용   = 단가 × 수량 × (1 + 수수료율)
 * - 매도 실수령   = 단가 × 수량 × (1 − 수수료율 − 매도세율)
 * - 두 요율이 모두 0이면 요율 도입 전과 완전히 동일하게 동작한다.
 */

export interface FeeRates {
  /** 매매 수수료율(%) — 매수·매도 양쪽에 적용 */
  commissionPct: number;
  /** 매도 세율(%) — 매도에만 적용 */
  sellTaxPct: number;
}

/**
 * 기본값은 0 — 증권사·상품·우대 할인마다 요율이 달라, 추정치로 계산한 손익을
 * 정확한 값처럼 보여주지 않기 위해서다. 사용자가 자기 요율을 넣기 전까지는 "미반영"으로 둔다.
 */
export const ZERO_FEES: FeeRates = { commissionPct: 0, sellTaxPct: 0 };
export const DEFAULT_FEES: FeeRates = ZERO_FEES;
/** 입력 도움말용 참고 수치(미리 채우지 않는다) */
export const EXAMPLE_FEES: FeeRates = { commissionPct: 0.015, sellTaxPct: 0.18 };

/** 손상·범위 밖 값 방어 (0~5% 사이로 클램프) */
export function normalizeRates(input: unknown): FeeRates {
  const clamp = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(n, 5);
  };
  const x = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  return {
    commissionPct: clamp(x.commissionPct, ZERO_FEES.commissionPct),
    sellTaxPct: clamp(x.sellTaxPct, ZERO_FEES.sellTaxPct),
  };
}

export function feesEnabled(r: FeeRates): boolean {
  return r.commissionPct > 0 || r.sellTaxPct > 0;
}

/** 매수 실비용(수수료 포함) */
export function buyCost(price: number, qty: number, r: FeeRates): number {
  return price * qty * (1 + r.commissionPct / 100);
}

/** 매도 실수령(수수료·세금 차감) */
export function sellProceeds(price: number, qty: number, r: FeeRates): number {
  return price * qty * (1 - (r.commissionPct + r.sellTaxPct) / 100);
}
