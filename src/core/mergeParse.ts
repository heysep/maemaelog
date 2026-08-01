/**
 * 로컬 규칙 파서 결과 + 서버(AI) 파싱 결과 병합 — 순수 함수.
 *
 * 원칙:
 * - 로컬이 **확신(confident)** 으로 채운 값은 서버가 덮어쓰지 않는다(오프라인·무료에서도 같은 결과).
 * - 로컬이 비확신으로 채웠거나 비어 있으면 서버 값을 우선한다.
 * - 서버가 null로 준 필드는 "모름"이므로 무시한다(추측 금지 원칙).
 * - 어떤 필드를 서버가 채웠는지 filledByAi로 돌려줘 출처 배지에 쓴다.
 */
import type { ParsedTrade } from './ocrParse';
import type { Side } from './journal';

export interface ServerParsed {
  symbol?: string | null;
  side?: Side | string | null;
  price?: number | null;
  qty?: number | null;
  date?: string | null;
  time?: string | null;
  note?: string | null;
}

export interface MergeResult {
  merged: ParsedTrade;
  /** 서버 값으로 채워진 필드 이름들 */
  filledByAi: string[];
}

/** 핵심 필드(종목명·단가·수량·날짜) 중 비어 있는 게 있으면 true — 서버 호출 조건 */
export function hasMissingCoreFields(p: ParsedTrade): boolean {
  return p.symbol === undefined || p.price === undefined || p.qty === undefined || p.date === undefined;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isPositiveNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function mergeParsed(local: ParsedTrade, server: ServerParsed | null): MergeResult {
  const merged: ParsedTrade = { ...local, confident: { ...local.confident } };
  const filledByAi: string[] = [];
  if (server === null) return { merged, filledByAi };

  /** 로컬이 확신으로 채웠으면 유지, 아니면 서버 값 채택 */
  const take = (field: 'symbol' | 'side' | 'price' | 'qty' | 'date', ok: boolean): boolean =>
    ok && !(local[field] !== undefined && local.confident[field]);

  if (isNonEmptyString(server.symbol) && take('symbol', true)) {
    merged.symbol = server.symbol.trim();
    filledByAi.push('symbol');
  }
  if ((server.side === 'buy' || server.side === 'sell') && take('side', true)) {
    merged.side = server.side;
    filledByAi.push('side');
  }
  if (isPositiveNumber(server.price) && take('price', true)) {
    merged.price = Math.round(server.price);
    filledByAi.push('price');
  }
  if (isPositiveNumber(server.qty) && take('qty', true)) {
    merged.qty = server.qty;
    filledByAi.push('qty');
  }
  if (isNonEmptyString(server.date) && /^\d{4}-\d{2}-\d{2}$/.test(server.date) && take('date', true)) {
    merged.date = server.date;
    filledByAi.push('date');
  }
  // 시각은 보조 필드 — 로컬에 없을 때만 채운다
  if (isNonEmptyString(server.time) && /^\d{1,2}:\d{2}$/.test(server.time) && merged.time === undefined) {
    merged.time = server.time.padStart(5, '0');
    filledByAi.push('time');
  }
  return { merged, filledByAi };
}
