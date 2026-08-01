/**
 * 엔타이틀먼트 저장소.
 *
 * ⚠️ 이 앱에는 결제 검증 서버가 없다. 엔타이틀먼트(구독 상태)는 결제 성공 콜백에서
 * localStorage(`maemaelog.ent.v1`)에 만료일과 함께 기록하는 클라이언트 저장 기반이다.
 * 기기 변경·초기화 시 복원되지 않으며, 위변조 방어도 하지 않는다(참고용 개인 기록 앱).
 */
import { STORAGE_PREFIX } from '../config';
import type { Entitlements, EntKey, InsightCounter } from '../core/limits';
import { ENTITLEMENT_DAYS } from './products';

const ENT_KEY = `${STORAGE_PREFIX}ent.v1`;
const COUNTER_KEY = `${STORAGE_PREFIX}insight.uses`;
const OCR_PASS_KEY = `${STORAGE_PREFIX}ocrPass`;

export function loadEntitlements(): Entitlements {
  try {
    const raw = localStorage.getItem(ENT_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Entitlements = {};
    for (const k of ['pro', 'records', 'noads'] as const) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 결제 성공 콜백에서 호출 — 지금부터 31일 뒤 만료로 기록 */
export function grantEntitlement(key: EntKey, now: Date): Entitlements {
  const ent = loadEntitlements();
  const exp = new Date(now.getTime() + ENTITLEMENT_DAYS * 24 * 60 * 60 * 1000);
  ent[key] = exp.toISOString();
  try {
    localStorage.setItem(ENT_KEY, JSON.stringify(ent));
  } catch {
    // 저장 실패 시에도 세션 내에서는 반환값으로 반영된다
  }
  return ent;
}

export function loadInsightCounter(): InsightCounter | null {
  try {
    const raw = localStorage.getItem(COUNTER_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const x = parsed as Record<string, unknown>;
    if (typeof x.date !== 'string' || typeof x.used !== 'number' || !Number.isFinite(x.used)) return null;
    return { date: x.date, used: x.used };
  } catch {
    return null;
  }
}

export function saveInsightCounter(counter: InsightCounter): void {
  try {
    localStorage.setItem(COUNTER_KEY, JSON.stringify(counter));
  } catch {
    // 무시 — 다음 실행에서 다시 카운트
  }
}

/** AI 정밀 인식 사용량(서버 응답 used/limit 동기화용) */
export interface AiParseUsage {
  date: string;
  used: number;
  limit: number;
}

const AI_PARSE_KEY = `${STORAGE_PREFIX}aiParse.uses`;

export function loadAiParseUsage(): AiParseUsage | null {
  try {
    const raw = localStorage.getItem(AI_PARSE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const x = parsed as Record<string, unknown>;
    if (typeof x.date !== 'string' || typeof x.used !== 'number' || typeof x.limit !== 'number') return null;
    if (!Number.isFinite(x.used) || !Number.isFinite(x.limit)) return null;
    return { date: x.date, used: x.used, limit: x.limit };
  } catch {
    return null;
  }
}

export function saveAiParseUsage(usage: AiParseUsage): void {
  try {
    localStorage.setItem(AI_PARSE_KEY, JSON.stringify(usage));
  } catch {
    // 무시 — 표시용 값이라 실패해도 기능에 지장 없음
  }
}

export function loadOcrPass(): string | null {
  try {
    return localStorage.getItem(OCR_PASS_KEY);
  } catch {
    return null;
  }
}

export function saveOcrPass(dateKey: string): void {
  try {
    localStorage.setItem(OCR_PASS_KEY, dateKey);
  } catch {
    // 무시
  }
}
