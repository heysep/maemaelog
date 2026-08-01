/**
 * AI 정밀 인식 API 클라이언트 (supabase/functions/parse-trade).
 *
 * - 무료도 하루 1회 체험, 프로는 하루 20회 — 한도 판정은 서버가 하고 클라이언트는 결과만 반영한다.
 * - 호출 조건은 호출부에서 판단: 로컬 규칙 파서가 핵심 필드를 못 채웠을 때만(비용 절약).
 * - 스크린샷 이미지는 전송하지 않는다 — 기기에서 인식된 텍스트만 보낸다.
 * - 실패(503/네트워크)는 조용히 'fail' — 로컬 규칙 파서 결과를 그대로 쓴다.
 */
import type { ServerParsed } from '../core/mergeParse';
import { getUserKey } from './analysis';

export const PARSE_ENDPOINT = (import.meta.env.VITE_PARSE_ENDPOINT as string | undefined) ?? '';

export type ParseTier = 'free' | 'pro';

/** 티어별 일일 한도 기본값(서버 응답이 없을 때의 표시용 폴백) */
export const PARSE_LIMIT: Record<ParseTier, number> = { free: 1, pro: 20 };

export type AiParseResult =
  | { status: 'ok'; parsed: ServerParsed; used: number; limit: number }
  | { status: 'limit'; used: number; limit: number; tier: ParseTier }
  | { status: 'fail' };

export function isAiParseAvailable(): boolean {
  return PARSE_ENDPOINT !== '';
}

export async function requestAiParse(
  text: string,
  options: { authConnected: boolean; tier: ParseTier }
): Promise<AiParseResult> {
  if (PARSE_ENDPOINT === '' || text.trim().length < 5) return { status: 'fail' };
  try {
    const userKey = await getUserKey(options.authConnected);
    const res = await fetch(PARSE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, userKey, tier: options.tier }),
    });
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { used?: number; limit?: number; tier?: ParseTier };
      const limit = body.limit ?? PARSE_LIMIT[options.tier];
      return {
        status: 'limit',
        used: body.used ?? limit,
        limit,
        tier: body.tier === 'pro' || body.tier === 'free' ? body.tier : options.tier,
      };
    }
    if (!res.ok) {
      console.error('[ai-parse] 서버 응답 실패:', res.status);
      return { status: 'fail' };
    }
    const body = (await res.json()) as { parsed?: unknown; used?: number; limit?: number };
    if (typeof body.parsed !== 'object' || body.parsed === null) return { status: 'fail' };
    return {
      status: 'ok',
      parsed: body.parsed as ServerParsed,
      used: body.used ?? 1,
      limit: body.limit ?? PARSE_LIMIT[options.tier],
    };
  } catch (e) {
    console.error('[ai-parse] 호출 실패:', e);
    return { status: 'fail' };
  }
}
