/**
 * 토스 개발자 콘솔에서 발급받는 광고 그룹 ID.
 * 빌드 시 환경변수로 주입(권장). 미주입 시 빈 문자열 →
 * BannerAd는 아무것도 렌더하지 않고, OCR 리워드 게이트는 광고 없이 통과한다(zero footprint).
 *
 * 예) VITE_AD_GROUP_ID=<배너ID> VITE_REWARDED_AD_ID=<리워드ID> npm run build
 */
export const AD_GROUP_ID = (import.meta.env.VITE_AD_GROUP_ID as string | undefined) ?? '';
export const REWARDED_AD_ID = (import.meta.env.VITE_REWARDED_AD_ID as string | undefined) ?? '';
