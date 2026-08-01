/**
 * 매매 습관 AI 분석 프록시 (Supabase Edge Function).
 *
 * Anthropic API 키를 클라이언트에 두면 번들에 노출되므로 호출은 전부 여기서 한다.
 * 클라이언트는 개인정보 없는 익명 요약 통계만 보낸다(원본 기록·메모 전송 금지).
 *
 * 하는 일:
 *   1. userKey 기준 일일 호출 제한 (free 1회 / pro 3회 — analysis_usage 테이블)
 *      테이블이 없으면 제한 없이 통과(fail-open, 클라이언트 제한이 1차 방어)
 *   2. Claude API로 습관 진단 리포트 생성 (JSON 스키마 강제)
 *
 * 배포: npx supabase functions deploy analyze-trades --project-ref yppigalxoellkalweqqj --no-verify-jwt
 * 필요한 시크릿: ANTHROPIC_API_KEY (선택: ANALYSIS_MODEL, 기본 claude-haiku-4-5)
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = Deno.env.get('ANALYSIS_MODEL') ?? 'claude-haiku-4-5';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, accept, apikey, authorization, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
  'content-type': 'application/json; charset=utf-8',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

interface StatsPayload {
  userKey?: string; // 토스로그인 userKey 해시(클라이언트에서 sha256). 없으면 'anon'
  tier?: 'free' | 'pro';
  stats: {
    totalTrades: number;
    winRate: number; // 0~100
    realizedPnl: number; // 원
    byEmotion: Array<{ tag: string; trades: number; winRate: number; pnl: number }>;
    chaseRatio?: number; // 추격 태그 비중 0~100
    reentryWithin1d?: number; // 손실 후 1일 내 재진입 횟수
    avgHoldDays?: number;
    monthly?: Array<{ month: string; pnl: number }>;
  };
}

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['diagnosis', 'worstHabit', 'strength', 'prescription'],
  properties: {
    diagnosis: { type: 'array', items: { type: 'string' }, description: '이번 데이터 진단 2~3줄' },
    worstHabit: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'evidence'],
      properties: { title: { type: 'string' }, evidence: { type: 'string' } },
    },
    strength: { type: 'string' },
    prescription: { type: 'string', description: '다음 주 실행 처방 1개, 구체적으로' },
  },
} as const;

async function checkRateLimit(userKey: string, tier: string): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = tier === 'pro' ? 3 : 1;
  if (!SUPABASE_URL || !SERVICE_ROLE) return { ok: true, used: 0, limit };
  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE);
    const day = new Date().toISOString().slice(0, 10);
    const { data, error } = await db
      .from('analysis_usage')
      .select('count')
      .eq('user_key', userKey)
      .eq('day', day)
      .maybeSingle();
    if (error) return { ok: true, used: 0, limit }; // 테이블 없음 등 — fail-open
    const used = data?.count ?? 0;
    if (used >= limit) return { ok: false, used, limit };
    await db.from('analysis_usage').upsert({ user_key: userKey, day, count: used + 1 });
    return { ok: true, used: used + 1, limit };
  } catch {
    return { ok: true, used: 0, limit };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!ANTHROPIC_API_KEY) return json(503, { error: 'analysis_unavailable' });

  let payload: StatsPayload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const s = payload?.stats;
  if (!s || typeof s.totalTrades !== 'number' || !Array.isArray(s.byEmotion)) {
    return json(400, { error: 'invalid_stats' });
  }
  if (s.totalTrades < 3) return json(422, { error: 'not_enough_trades' });

  const userKey = (payload.userKey ?? 'anon').slice(0, 128);
  const tier = payload.tier === 'pro' ? 'pro' : 'free';
  const rl = await checkRateLimit(userKey, tier);
  if (!rl.ok) return json(429, { error: 'daily_limit', used: rl.used, limit: rl.limit });

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        '너는 개인 투자자의 매매 습관을 진단하는 코치다. 입력은 익명 요약 통계뿐이다. ' +
        '수치를 근거로 냉정하게 진단하되 비난하지 말고, 다음 주에 실행 가능한 처방 1개를 구체적으로 제시하라. ' +
        '감정 태그 이름(원칙·추격·공포·확신·뇌동 등)은 입력에 있는 그대로 사용하고 다른 말로 바꾸지 마라. ' +
        '종목 추천·시장 전망·매수/매도 권유는 절대 하지 마라. 모든 텍스트는 한국어 존댓말, 이모지 금지.',
      messages: [
        {
          role: 'user',
          content: `다음 매매 통계를 진단해줘.\n${JSON.stringify(s)}`,
        },
      ],
      output_config: { format: { type: 'json_schema', schema: REPORT_SCHEMA } },
    });
    if (response.stop_reason === 'refusal') return json(502, { error: 'analysis_refused' });
    const textBlock = response.content.find((b) => b.type === 'text');
    const report = textBlock && 'text' in textBlock ? JSON.parse(textBlock.text) : null;
    if (!report) return json(502, { error: 'empty_report' });
    return json(200, { report, used: rl.used, limit: rl.limit, model: MODEL });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 429) return json(503, { error: 'upstream_rate_limited' });
    return json(502, { error: 'analysis_failed' });
  }
});
