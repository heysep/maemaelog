import { loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';

/**
 * 토스 전면(영상) 광고. VITE_FULLSCREEN_AD_ID로 그룹 ID 주입.
 * ID 미발급/미지원/실패는 전부 흡수 — 광고 없이 그대로 진행한다.
 *
 * 빈도 정책: 사용자의 능동 액션 N회째에 1번, 세션당 최대 1회.
 * 진입 즉시 전면광고는 이탈·심사 리스크가 커서 쓰지 않는다.
 */
const FS_AD_ID = (import.meta.env.VITE_FULLSCREEN_AD_ID as string | undefined) ?? '';
const SESSION_CAP = 1;
let shownCount = 0;
let actionCount = 0;

function play(): void {
  if (!FS_AD_ID) return;
  try {
    loadFullScreenAd({
      options: { adGroupId: FS_AD_ID },
      onEvent: (e) => {
        if (e.type === 'loaded') {
          try {
            showFullScreenAd({
              options: { adGroupId: FS_AD_ID },
              onEvent: () => {},
              onError: (err) => console.error(err),
            });
          } catch (err) {
            console.error(err);
          }
        }
      },
      onError: (err) => console.error(err),
    });
  } catch (err) {
    console.error(err);
  }
}

/** 능동 액션마다 호출 — threshold회째에 전면광고 1번(세션 캡 적용). */
export function bumpInterstitial(threshold: number): void {
  actionCount++;
  if (shownCount >= SESSION_CAP || actionCount !== threshold) return;
  shownCount++;
  play();
}
