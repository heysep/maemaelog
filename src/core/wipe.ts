/** 회원탈퇴(전체 데이터 삭제) — 순수 로직 + 얇은 IO */
import { STORAGE_PREFIX } from '../config';

/** 전체 키 목록에서 이 앱의 키(maemaelog.*)만 골라낸다 — 다른 앱 데이터는 건드리지 않는다 */
export function selectAppKeys(allKeys: string[], prefix: string = STORAGE_PREFIX): string[] {
  return allKeys.filter((k) => k.startsWith(prefix));
}

/** maemaelog.* localStorage 전부 삭제. 삭제한 키 수 반환 */
export function wipeAllData(): number {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== null) keys.push(k);
    }
    const targets = selectAppKeys(keys);
    for (const k of targets) localStorage.removeItem(k);
    return targets.length;
  } catch {
    return 0;
  }
}
