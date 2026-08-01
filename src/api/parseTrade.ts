/**
 * AI 정밀 인식 API 클라이언트 (supabase/functions/parse-trade).
 *
 * - 프로 구독자 전용. 무료 사용자는 호출하지 않는다(호출부에서 차단).
 * - 스크린샷 이미지는 전송하지 않는다 — 기기에서 인식된 텍스트만 보낸다.
 * - 실패(429/503/네트워크)는 조용히 null — 로컬 규칙 파서 결과를 그대로 쓴다.
 */
import type { ServerParsed } from '../core/mergeParse';
import { getUserKey } from './analysis';

export const PARSE_ENDPOINT = (import.meta.env.VITE_PARSE_ENDPOINT as string | undefined) ?? '';

export function isAiParseAvailable(): boolean {
  return PARSE_ENDPOINT !== '';
}

export async function requestAiParse(text: string, authConnected: boolean): Promise<ServerParsed | null> {
  if (PARSE_ENDPOINT === '' || text.trim().length < 5) return null;
  try {
    const userKey = await getUserKey(authConnected);
    const res = await fetch(PARSE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, userKey }),
    });
    if (!res.ok) {
      console.error('[ai-parse] 서버 응답 실패:', res.status);
      return null;
    }
    const body = (await res.json()) as { parsed?: unknown };
    if (typeof body.parsed !== 'object' || body.parsed === null) return null;
    return body.parsed as ServerParsed;
  } catch (e) {
    console.error('[ai-parse] 호출 실패:', e);
    return null;
  }
}
