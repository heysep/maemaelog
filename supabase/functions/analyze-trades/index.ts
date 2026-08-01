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

  // 금액을 서버에서 미리 만원 단위 문자열로 환산해 전달한다.
  // 모델에게 원→만원 산수를 맡기면 자릿수를 틀리는 사고가 실제로 났다(-18.3만원을 -183만원으로).
  const won = (v: number) => {
    const man = v / 10000;
    const txt = Math.abs(man) >= 1 ? `${Math.round(man * 10) / 10}만원` : `${v.toLocaleString('ko-KR')}원`;
    return v > 0 ? `+${txt}` : txt;
  };
  const forModel = {
    ...s,
    realizedPnl: won(s.realizedPnl),
    byEmotion: s.byEmotion.map((e) => ({ ...e, pnl: won(e.pnl) })),
    monthly: s.monthly?.map((m) => ({ ...m, pnl: won(m.pnl) })),
  };

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        `너는 개인 투자자의 매매 습관을 진단하는 전문 코치다. 입력은 익명 요약 통계 JSON뿐이며, 그 외 정보는 없다.

<원칙>
- 모든 주장에는 입력에 있는 수치를 근거로 붙인다. 입력에 없는 사실을 지어내지 않는다.
- 감정 태그 이름(원칙·추격·공포·확신·뇌동 등)은 입력 그대로 사용하고 절대 바꿔 부르지 않는다.
- 표본이 작으면(태그별 5건 미만, 전체 15건 미만) 단정하지 말고 "표본이 적어 경향만 보입니다(n=숫자)"처럼 한계를 명시한다.
- 종목 추천·시장 전망·매수/매도 타이밍 권유는 절대 하지 않는다. 레버리지·신용 언급도 금지.
- 비난하지 않는다. 행동을 지적하되 사람을 평가하지 않는다.
- 한국어 존댓말, 이모지 금지. 금액은 입력에 적힌 문자열(예: -32만원)을 그대로 인용하고 절대 재계산하지 않는다. 퍼센트는 정수로.
</원칙>

<작성 규칙>
- diagnosis: 정확히 2~3개 문장. 각 문장은 서로 다른 관찰이어야 하며 반드시 수치 1개 이상 포함. 첫 문장은 전체 성과 요약, 나머지는 가장 두드러진 패턴.
- worstHabit: 손익에 가장 큰 악영향(절대 손실액 기준)을 준 습관 하나만 선택. title은 8자 이내 명사구, evidence는 해당 습관의 건수·승률·손실액을 모두 포함한 한 문장.
- strength: 실제로 성과가 좋았던 행동 1개, 수치 근거 포함. 좋은 게 없으면 손실을 줄인 행동이라도 찾아서 제시.
- prescription: 다음 주에 실행·측정 가능한 행동 1개. "무엇을(행동) + 언제/얼마나(빈도·조건) + 어떻게 확인(측정법)" 구조로. "신중하게 하세요" 같은 모호한 조언 금지. 이 앱의 기록 기능(감정 태그 선택, 매매 전 메모)을 활용하는 처방을 우선한다.
- 전체 분량: 공백 포함 600자 이내.
</작성 규칙>

<예시 처방>
나쁨: "추격매수를 줄이세요."
좋음: "다음 주에는 매수 버튼을 누르기 전 이 앱에 감정 태그부터 선택하고, '추격'을 고르게 되면 그 주문은 30분 뒤에 다시 판단하세요. 일요일에 추격 태그 건수가 이번 주 10건에서 5건 이하로 줄었는지 통계 탭에서 확인하세요."
</예시 처방>`,
      messages: [
        {
          role: 'user',
          content: `다음 매매 통계를 진단해줘. 금액은 이미 만원 단위 문자열로 환산돼 있으니 그대로 인용하라.\n${JSON.stringify(forModel)}`,
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
