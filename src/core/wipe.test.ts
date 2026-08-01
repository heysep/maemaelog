import { describe, expect, it } from 'vitest';
import { selectAppKeys, wipeAllData } from './wipe';

describe('회원탈퇴 데이터 삭제', () => {
  it('maemaelog. 프리픽스 키만 골라낸다 — 다른 앱 키는 남긴다', () => {
    const keys = [
      'maemaelog.trades',
      'maemaelog.ent.v1',
      'maemaelog.insight.uses',
      'maemaelog.ocrPass',
      'maemaelog.auth.v1',
      'otherapp.data',
      'maemaelog', // 프리픽스(점 포함) 불일치 — 제외
      '',
    ];
    expect(selectAppKeys(keys)).toEqual([
      'maemaelog.trades',
      'maemaelog.ent.v1',
      'maemaelog.insight.uses',
      'maemaelog.ocrPass',
      'maemaelog.auth.v1',
    ]);
  });

  it('빈 목록이면 빈 배열', () => {
    expect(selectAppKeys([])).toEqual([]);
  });

  it('wipeAllData: localStorage에서 앱 키 전부 삭제, 삭제 수 반환 (jsdom 없으면 0 안전 반환)', () => {
    if (typeof localStorage === 'undefined') {
      expect(wipeAllData()).toBe(0);
      return;
    }
    localStorage.setItem('maemaelog.trades', '[]');
    localStorage.setItem('maemaelog.auth.v1', '{"connected":true}');
    localStorage.setItem('keep.me', '1');
    expect(wipeAllData()).toBe(2);
    expect(localStorage.getItem('maemaelog.trades')).toBeNull();
    expect(localStorage.getItem('keep.me')).toBe('1');
  });
});
