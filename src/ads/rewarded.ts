/**
 * 리워드(영상) 광고 래퍼 — TossAds loadFullScreenAd 계열.
 * 모든 브리지 호출 try/catch. 실패는 'failed'로 돌려주고, 게이트 정책상 실패도 통과시킨다.
 */
import { TossAds } from '@apps-in-toss/web-framework';

export type RewardedResult = 'completed' | 'failed';

interface FullScreenAdApi {
  isSupported?: () => boolean;
  (options: {
    adGroupId: string;
    onEvent?: (event: { type: string }) => void;
    onError?: (error: unknown) => void;
  }): unknown;
}

function getLoader(): FullScreenAdApi | null {
  const ads = TossAds as unknown as Record<string, unknown>;
  const fn = ads['loadFullScreenAd'] ?? ads['loadRewardedAd'];
  return typeof fn === 'function' ? (fn as FullScreenAdApi) : null;
}

export function isRewardedSupported(): boolean {
  try {
    const loader = getLoader();
    if (loader === null) return false;
    if (typeof loader.isSupported === 'function') return loader.isSupported();
    return true;
  } catch {
    // 토스 앱 밖에서는 isSupported()가 동기로 throw한다
    return false;
  }
}

/** 리워드 광고 재생. 시청 완료 판단 이벤트를 받으면 completed, 그 외 전부 failed. */
export function showRewardedAd(adGroupId: string): Promise<RewardedResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: RewardedResult) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    try {
      if (!isRewardedSupported()) return finish('failed');
      const loader = getLoader();
      if (loader === null) return finish('failed');
      loader({
        adGroupId,
        onEvent: (event) => {
          const t = event?.type ?? '';
          if (t === 'rewarded' || t === 'userEarnedReward' || t === 'completed') finish('completed');
          if (t === 'dismissed' || t === 'closed' || t === 'clicked') {
            // 닫힘 이벤트가 리워드보다 늦게 올 수 있어 약간 유예
            setTimeout(() => finish('failed'), 300);
          }
        },
        onError: () => finish('failed'),
      });
      // 안전망: 30초 내 아무 이벤트도 없으면 실패 처리(게이트는 실패도 통과시킨다)
      setTimeout(() => finish('failed'), 30_000);
    } catch {
      finish('failed');
    }
  });
}
