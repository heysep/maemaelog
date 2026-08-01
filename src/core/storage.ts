import { STORAGE_PREFIX } from '../config';
import { isValidTrade, type Trade } from './journal';

const KEY = `${STORAGE_PREFIX}trades`;

/** 손상 데이터 내성: 파싱 실패·형식 불일치 항목은 조용히 버린다. */
export function loadTrades(): Trade[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTrade);
  } catch {
    return [];
  }
}

/**
 * 저장. 용량 초과(QuotaExceededError) 시 썸네일부터 제거하고 재시도한다.
 * 그래도 실패하면 false — 호출부에서 안내.
 */
export function saveTrades(trades: Trade[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(trades));
    return true;
  } catch {
    try {
      const slim = trades.map(({ thumb: _thumb, ...rest }) => rest);
      localStorage.setItem(KEY, JSON.stringify(slim));
      return true;
    } catch {
      return false;
    }
  }
}
