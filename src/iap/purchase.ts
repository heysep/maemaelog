/**
 * 인앱결제(IAP) 브리지 래퍼.
 * - 토스 앱 밖(일반 브라우저)에서는 브리지가 없거나 동기 throw하므로 모든 호출을 try/catch.
 * - 미지원이면 'unsupported' — UI는 결제 버튼 대신 "토스 앱에서 이용 가능" 안내를 보여준다.
 */
export type PurchaseResult = 'success' | 'unsupported' | 'failed';

interface IapApi {
  isSupported?: () => boolean;
  (options: { productId: string }): Promise<unknown>;
}

export function isIapSupported(): boolean {
  try {
    const mod = getModule();
    const api = mod?.createOneTimePurchaseOrder;
    if (typeof api !== 'function') return false;
    if (typeof api.isSupported === 'function') return api.isSupported();
    return true;
  } catch {
    return false;
  }
}

let cachedModule: Record<string, unknown> | null | undefined;

function getModule(): { createOneTimePurchaseOrder?: IapApi } | null {
  if (cachedModule === undefined) return null;
  return (cachedModule as { createOneTimePurchaseOrder?: IapApi } | null) ?? null;
}

/** 모듈 lazy 로드 — 프리뷰 환경에서 import 자체가 실패해도 죽지 않게 */
export async function ensureIapModule(): Promise<void> {
  if (cachedModule !== undefined) return;
  try {
    cachedModule = (await import('@apps-in-toss/web-framework')) as unknown as Record<string, unknown>;
  } catch {
    cachedModule = null;
  }
}

export async function purchase(sku: string): Promise<PurchaseResult> {
  try {
    await ensureIapModule();
    const api = getModule()?.createOneTimePurchaseOrder;
    if (typeof api !== 'function') return 'unsupported';
    try {
      if (typeof api.isSupported === 'function' && !api.isSupported()) return 'unsupported';
    } catch {
      return 'unsupported';
    }
    await api({ productId: sku });
    return 'success';
  } catch {
    return 'failed';
  }
}
