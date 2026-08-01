-- 분석 호출 일일 제한 카운터 (analyze-trades Edge Function 전용, service role만 접근)
create table if not exists public.analysis_usage (
  user_key text not null,
  day date not null,
  count int not null default 0,
  primary key (user_key, day)
);
alter table public.analysis_usage enable row level security;
-- RLS 정책 없음 = anon/authenticated 접근 불가, service role만 사용
