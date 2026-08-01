/**
 * OCR 텍스트 → 매매 필드 파싱 (Claude 기반, Supabase Edge Function).
 *
 * 왜 서버에서 LLM으로 파싱하나:
 *   증권사·화면·통화(원/달러)·기기 화질에 따라 레이아웃이 수십 가지라 정규식으로는 끝없이 쫓아가야 한다.
 *   클라이언트는 먼저 로컬 규칙 파서로 시도하고(오프라인·무료·비전송), 필드가 비었을 때만 여기로 보낸다.
 *
 * 개인정보: 스크린샷 이미지는 절대 전송하지 않는다. 기기에서 인식된 텍스트만 받고 저장하지 않는다.
 *
 * 배포: npx supabase functions deploy parse-trade --project-ref azewobnvqlkxdkxwwatz --no-verify-jwt
 * 필요한 시크릿: ANTHROPIC_API_KEY (선택: PARSE_MODEL, 기본 claude-haiku-4-5)
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = Deno.env.get('PARSE_MODEL') ?? 'claude-haiku-4-5';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * 무료도 하루 1회는 AI로 체험시키고(전환 유도), 그 이후는 프로 구독자만.
 * 클라이언트 tier 주장은 위조 가능하므로 서버가 userKey 기준 하루 상한으로 비용을 봉인한다.
 */
const CAP = { free: 1, pro: 20 } as const;

async function checkCap(userKey: string, tier: 'free' | 'pro'): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = CAP[tier];
  if (!SUPABASE_URL || !SERVICE_ROLE) return { ok: true, used: 0, limit }; // 설정 전이면 통과(개발 편의)
  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE);
    const day = new Date().toISOString().slice(0, 10);
    const key = `parse:${userKey}`;
    const { data, error } = await db
      .from('analysis_usage')
      .select('count')
      .eq('user_key', key)
      .eq('day', day)
      .maybeSingle();
    if (error) return { ok: true, used: 0, limit }; // fail-open
    const used = data?.count ?? 0;
    if (used >= limit) return { ok: false, used, limit };
    await db.from('analysis_usage').upsert({ user_key: key, day, count: used + 1 });
    return { ok: true, used: used + 1, limit };
  } catch {
    return { ok: true, used: 0, limit };
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, accept, apikey, authorization, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
  'content-type': 'application/json; charset=utf-8',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

const TRADE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['symbol', 'side', 'price', 'qty', 'date', 'time', 'note'],
  // 구조화 출력은 type 배열 유니온을 지원하지 않는다 — anyOf로 "값 또는 null"을 표현한다.
  properties: {
    symbol: { anyOf: [{ type: 'string' }, { type: 'null' }], description: '종목명. 조사·"구매/판매" 같은 동사는 제거' },
    side: { anyOf: [{ type: 'string', enum: ['buy', 'sell'] }, { type: 'null' }] },
    price: { anyOf: [{ type: 'number' }, { type: 'null' }], description: '1주당 단가, 원 단위 정수' },
    qty: { anyOf: [{ type: 'number' }, { type: 'null' }], description: '수량. 소수점 주식 허용' },
    date: { anyOf: [{ type: 'string' }, { type: 'null' }], description: '매매 체결일 YYYY-MM-DD' },
    time: { anyOf: [{ type: 'string' }, { type: 'null' }], description: '체결 시각 HH:MM' },
    note: { anyOf: [{ type: 'string' }, { type: 'null' }], description: '판단 근거 한 줄(디버깅용, 사용자 비노출)' },
  },
} as const;

const SYSTEM = `너는 한국 증권사 앱 화면을 OCR한 지저분한 텍스트에서 매매 정보를 추출하는 파서다.

<입력 특성>
- 상태바(시각·배터리), 헤더("현재가격 보기"), 진행단계("주문/구매완료/출금"), 버튼("목표 수익률 설정") 같은 UI 노이즈가 섞여 있다.
- OCR 오독이 많다: 쉼표·마침표 소실("4707163원"은 470,716.3원일 수 있음), "원"이 "!"·"|"·"윈"으로, 글자가 깨진 토큰("ve", "Mx", "The", "BY").
- 날짜는 구분자가 사라지고 시각과 붙기도 한다("202672419:27" = 2026.7.24 19:27).
- 플랫폼: 토스증권, 키움 영웅문, 미래에셋 m.Stock, NH나무, 한국투자, 삼성 mPOP, KB M-able 등.
</입력 특성>

<추출 규칙>
- side: 매수/구매 → "buy", 매도/판매 → "sell".
- price는 **1주당 단가를 원 단위 정수**로. 화면에 단가가 없고 총 금액과 수량만 있으면 금액÷수량으로 계산.
- **달러 표시 해외주식**: 화면에 환율이 함께 있으면 (달러금액 × 환율)로 원화 기대값을 구하고, 쉼표·소수점이 소실된 원화 숫자는 자릿수를 그 기대값에 맞춰 해석하라. 환율이 없으면 price는 null.
- date는 **체결/주문일**이다. "출금"·"정산"·"결제일" 옆 날짜나 조회기간(예: 2022.01.21 ~ 2023.01.20)은 쓰지 마라.
- 거래내역 리스트처럼 여러 건이 보이면 **가장 최근(최상단) 매매 1건**만. 입출금·환전 행은 매매가 아니다.
- 확실하지 않은 필드는 **추측하지 말고 null**. 틀린 값보다 빈 값이 낫다.
- symbol에서 조사("을","를")와 "구매/판매/매수/매도"는 떼라. UI 문구(현재가격, 보기, 관심종목, 계좌명)는 종목명이 아니다.
</추출 규칙>

note에는 어떤 줄을 근거로 삼았는지 한 줄로 적어라.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!ANTHROPIC_API_KEY) return json(503, { error: 'parse_unavailable' });

  let body: { text?: string; userKey?: string; tier?: 'free' | 'pro' };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const text = (body?.text ?? '').slice(0, 8000); // 화면 한 장 분량 상한
  if (text.trim().length < 5) return json(400, { error: 'empty_text' });

  const userKey = (body?.userKey ?? 'anon').slice(0, 128);
  const tier = body?.tier === 'pro' ? 'pro' : 'free';
  const cap = await checkCap(userKey, tier);
  if (!cap.ok) return json(429, { error: 'daily_limit', used: cap.used, limit: cap.limit, tier });

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: 'user', content: `다음은 증권사 앱 화면의 OCR 결과다.\n---\n${text}\n---` }],
      output_config: { format: { type: 'json_schema', schema: TRADE_SCHEMA } },
    });
    if (response.stop_reason === 'refusal') return json(502, { error: 'parse_refused' });
    const block = response.content.find((b) => b.type === 'text');
    const parsed = block && 'text' in block ? JSON.parse(block.text) : null;
    if (!parsed) return json(502, { error: 'empty_parse' });
    return json(200, { parsed, model: MODEL, used: cap.used, limit: cap.limit });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 429) return json(503, { error: 'upstream_rate_limited' });
    return json(502, { error: 'parse_failed' });
  }
});
