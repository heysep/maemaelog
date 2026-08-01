import { useEffect, useRef, useState } from 'react';
import { TossAds } from '@apps-in-toss/web-framework';

type InitState = 'pending' | 'ready' | 'failed';

/**
 * TossAds.initialize는 앱 전체에서 한 번만. 모듈 스코프에 상태를 둬서
 * 배너가 화면마다 재마운트돼도 재초기화하지 않는다.
 */
let initStarted = false;
let initState: InitState = 'pending';
const initListeners = new Set<(state: InitState) => void>();

function notify(state: InitState): void {
  initState = state;
  initListeners.forEach((l) => l(state));
}

function ensureInitialized(): void {
  if (initStarted) return;
  initStarted = true;
  try {
    TossAds.initialize({
      callbacks: {
        onInitialized: () => notify('ready'),
        onInitializationFailed: (error: unknown) => {
          console.error(error);
          notify('failed');
        },
      },
    });
  } catch (error) {
    console.error(error);
    notify('failed');
  }
}

/**
 * 토스 네이티브 배너 광고. 다음 경우엔 자리를 차지하지 않고 사라진다.
 * - 광고 그룹 ID 미발급(빈 문자열)
 * - 구버전 토스 앱 등 미지원 환경(isSupported=false)
 * - 초기화 실패
 * 빈 회색 박스를 남기면 고장난 것처럼 보이므로 통째로 렌더하지 않는다.
 */
export function BannerAd({ adGroupId, label = '광고' }: { adGroupId: string; label?: string }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const supported = (() => {
    if (adGroupId === '') return false;
    try {
      return TossAds.attachBanner.isSupported() && TossAds.initialize.isSupported();
    } catch {
      // 토스 앱 밖(일반 브라우저)에서는 isSupported()가 동기로 throw한다
      return false;
    }
  })();
  const [state, setState] = useState<InitState>(initState);

  useEffect(() => {
    if (!supported) return;
    ensureInitialized();
    setState(initState);
    initListeners.add(setState);
    return () => {
      initListeners.delete(setState);
    };
  }, [supported]);

  useEffect(() => {
    if (!supported || state !== 'ready' || slotRef.current === null) return;
    // 앱인토스는 라이트 전용 → theme:'light' 고정(auto면 기기 다크모드 따라감)
    const banner = TossAds.attachBanner(adGroupId, slotRef.current, { theme: 'light' });
    return () => {
      banner.destroy();
    };
  }, [adGroupId, supported, state]);

  if (!supported || state !== 'ready') return null;

  return (
    <div className="ad-banner">
      <span className="ad-banner-label">{label}</span>
      <div ref={slotRef} />
    </div>
  );
}
