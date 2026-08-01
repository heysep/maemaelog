/**
 * AI 분석 API 클라이언트 (supabase/functions/analyze-trades 프록시 호출).
 *
 * - 엔드포인트 미설정(빈 문자열)이면 호출하지 않는다 — 호출부는 규칙 엔진으로 폴백.
 * - 전송하는 것은 익명 요약 통계(statsPayload)뿐. 원본 기록·메모·종목명 전송 금지.
 * - userKey: 토스로그인 연결 시 기기 고유 랜덤 ID의 sha256 해시, 아니면 'anon'.
 */
import { STORAGE_PREFIX } from '../config';
import type { AnalysisStats } from '../core/statsPayload';

export const ANALYSIS_ENDPOINT = (import.meta.env.VITE_ANALYSIS_ENDPOINT as string | undefined) ?? '';

export interface AiReport {
  diagnosis: string[];
  worstHabit: { title: string; evidence: string };
  strength: string;
  prescription: string;
}

export type AnalysisResult =
  | { status: 'ok'; report: AiReport; used: number; limit: number }
  | { status: 'limit'; used: number; limit: number }
  | { status: 'few' }
  | { status: 'fail' };

const DEVICE_KEY = `${STORAGE_PREFIX}device`;

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (id === null || id === '') {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getUserKey(authConnected: boolean): Promise<string> {
  if (!authConnected) return 'anon';
  try {
    return await sha256Hex(`maemaelog:${getDeviceId()}`);
  } catch {
    return 'anon';
  }
}

function isAiReport(v: unknown): v is AiReport {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as Record<string, unknown>;
  const wh = x.worstHabit as Record<string, unknown> | undefined;
  return (
    Array.isArray(x.diagnosis) &&
    x.diagnosis.every((d) => typeof d === 'string') &&
    typeof wh === 'object' && wh !== null &&
    typeof wh.title === 'string' &&
    typeof wh.evidence === 'string' &&
    typeof x.strength === 'string' &&
    typeof x.prescription === 'string'
  );
}

export async function requestAiAnalysis(
  stats: AnalysisStats,
  options: { authConnected: boolean; tier: 'free' | 'pro' }
): Promise<AnalysisResult> {
  if (ANALYSIS_ENDPOINT === '') return { status: 'fail' };
  try {
    const userKey = await getUserKey(options.authConnected);
    const res = await fetch(ANALYSIS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userKey, tier: options.tier, stats }),
    });
    if (res.status === 422) return { status: 'few' };
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { used?: number; limit?: number };
      return { status: 'limit', used: body.used ?? 0, limit: body.limit ?? 1 };
    }
    if (!res.ok) return { status: 'fail' }; // 503/502 등 → 규칙 엔진 폴백
    const body = (await res.json()) as { report?: unknown; used?: number; limit?: number };
    if (!isAiReport(body.report)) return { status: 'fail' };
    return { status: 'ok', report: body.report, used: body.used ?? 1, limit: body.limit ?? 1 };
  } catch {
    return { status: 'fail' }; // 네트워크 오류 → 폴백
  }
}
