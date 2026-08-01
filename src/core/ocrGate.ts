/**
 * OCR 리워드 광고 게이트 — 순수 함수.
 *
 * 규칙:
 * - pro 또는 광고 제거(noads) 활성 사용자는 광고 없이 바로 OCR 사용.
 * - 리워드 광고 ID가 미발급(빈 문자열)이면 광고 없이 통과(zero-footprint).
 * - 그 외에는 하루 첫 사용 시 리워드 광고 시청 → 그날 자정까지(날짜 키 동일) 무제한.
 * - 광고 로드/재생 실패 시에도 통과시킨다(사용자를 벌주지 않는다).
 */
import { adsRemoved, type Entitlements } from './limits';

/** localStorage `maemaelog.ocrPass`에 저장되는 값 = 날짜 키(YYYY-MM-DD) */
export type OcrPass = string | null;

export function hasValidPass(pass: OcrPass, todayKey: string): boolean {
  return pass === todayKey;
}

export type OcrGateDecision = 'allow' | 'need-ad';

export function decideOcrGate(
  pass: OcrPass,
  ent: Entitlements,
  now: Date,
  todayKey: string,
  rewardedAdId: string
): OcrGateDecision {
  if (adsRemoved(ent, now)) return 'allow';
  if (rewardedAdId === '') return 'allow';
  if (hasValidPass(pass, todayKey)) return 'allow';
  return 'need-ad';
}

/** 광고 시청 결과를 패스로 환산. 실패(failed)도 통과 패스를 발급한다. */
export function passAfterAd(result: 'completed' | 'failed', todayKey: string): string {
  void result;
  return todayKey;
}
