/**
 * 무료 티어 제한 + 엔타이틀먼트 판정 — 순수 함수.
 *
 * ⚠️ 결제 검증 서버가 없는 앱이므로 엔타이틀먼트는 클라이언트(localStorage) 저장 기반이다.
 * 결제 성공 콜백에서 만료일을 기록하고, 만료일이 지나면 무료 티어로 돌아간다.
 */

/** 무료 티어 기록 상한 */
export const FREE_RECORD_LIMIT = 30;
/** 무료 티어 습관 분석 횟수/일 */
export const FREE_INSIGHT_PER_DAY = 1;
/** 프로 습관 분석 횟수/일 */
export const PRO_INSIGHT_PER_DAY = 3;

export type EntKey = 'pro' | 'records' | 'noads';

/** 키 → 만료일 ISO 문자열 */
export type Entitlements = Partial<Record<EntKey, string>>;

export function isActive(ent: Entitlements, key: EntKey, now: Date): boolean {
  const exp = ent[key];
  if (typeof exp !== 'string') return false;
  const t = Date.parse(exp);
  return Number.isFinite(t) && t > now.getTime();
}

/** pro는 기록 무제한·광고 제거를 포함한다 */
export function hasUnlimitedRecords(ent: Entitlements, now: Date): boolean {
  return isActive(ent, 'pro', now) || isActive(ent, 'records', now);
}

export function adsRemoved(ent: Entitlements, now: Date): boolean {
  return isActive(ent, 'pro', now) || isActive(ent, 'noads', now);
}

export function canAddRecord(recordCount: number, ent: Entitlements, now: Date): boolean {
  return hasUnlimitedRecords(ent, now) || recordCount < FREE_RECORD_LIMIT;
}

export function dailyInsightLimit(ent: Entitlements, now: Date): number {
  return isActive(ent, 'pro', now) ? PRO_INSIGHT_PER_DAY : FREE_INSIGHT_PER_DAY;
}

/** 날짜 키(YYYY-MM-DD) 기준 리셋되는 사용 카운터 */
export interface InsightCounter {
  date: string;
  used: number;
}

export function remainingInsights(
  counter: InsightCounter | null,
  ent: Entitlements,
  now: Date,
  todayKey: string
): number {
  const limit = dailyInsightLimit(ent, now);
  const used = counter !== null && counter.date === todayKey ? counter.used : 0;
  return Math.max(0, limit - used);
}

export function consumeInsight(counter: InsightCounter | null, todayKey: string): InsightCounter {
  const used = counter !== null && counter.date === todayKey ? counter.used : 0;
  return { date: todayKey, used: used + 1 };
}
