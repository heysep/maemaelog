/**
 * 토스 로그인 연동 래퍼.
 * - clientId 미설정(빈 값) 또는 토스 앱 밖에서는 zero footprint — UI는 안내 문구만.
 * - 모든 브리지 호출 try/catch (토스 밖에서 동기 throw 가능).
 * - 저장은 연결 여부(boolean)만 — 개인정보(이름·토큰 등)는 저장하지 않는다.
 */
import { STORAGE_PREFIX } from '../config';

export const TOSS_LOGIN_CLIENT_ID = (import.meta.env.VITE_TOSS_LOGIN_CLIENT_ID as string | undefined) ?? '';

const AUTH_KEY = `${STORAGE_PREFIX}auth.v1`;

export function loadAuthConnected(): boolean {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (raw === null) return false;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && (parsed as Record<string, unknown>).connected === true;
  } catch {
    return false;
  }
}

function saveAuthConnected(connected: boolean): void {
  try {
    if (connected) localStorage.setItem(AUTH_KEY, JSON.stringify({ connected: true }));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    // 무시
  }
}

export function logout(): void {
  saveAuthConnected(false);
}

interface LoginApi {
  isSupported?: () => boolean;
  (options?: Record<string, unknown>): Promise<unknown>;
}

let mod: Record<string, unknown> | null | undefined;

async function ensureModule(): Promise<void> {
  if (mod !== undefined) return;
  try {
    mod = (await import('@apps-in-toss/web-framework')) as unknown as Record<string, unknown>;
  } catch {
    mod = null;
  }
}

function getLoginApi(): LoginApi | null {
  if (mod === undefined || mod === null) return null;
  const fn = mod['appLogin'] ?? mod['login'] ?? mod['requestAppLogin'];
  return typeof fn === 'function' ? (fn as LoginApi) : null;
}

/** 로그인 가능 환경인지 (clientId 설정 + 브리지 지원) */
export async function isLoginSupported(): Promise<boolean> {
  if (TOSS_LOGIN_CLIENT_ID === '') return false;
  await ensureModule();
  const api = getLoginApi();
  if (api === null) return false;
  try {
    if (typeof api.isSupported === 'function') return api.isSupported();
    return true;
  } catch {
    return false;
  }
}

export type LoginResult = 'success' | 'unsupported' | 'failed';

export async function loginWithToss(): Promise<LoginResult> {
  if (!(await isLoginSupported())) return 'unsupported';
  const api = getLoginApi();
  if (api === null) return 'unsupported';
  try {
    await api({ clientId: TOSS_LOGIN_CLIENT_ID });
    saveAuthConnected(true);
    return 'success';
  } catch {
    return 'failed';
  }
}
