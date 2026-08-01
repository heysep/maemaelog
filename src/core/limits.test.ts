import { describe, expect, it } from 'vitest';
import {
  adsRemoved,
  canAddRecord,
  consumeInsight,
  dailyInsightLimit,
  FREE_RECORD_LIMIT,
  isActive,
  remainingInsights,
  type Entitlements,
} from './limits';
import { decideOcrGate, hasValidPass, passAfterAd } from './ocrGate';

const NOW = new Date('2026-08-01T12:00:00+09:00');
const TODAY = '2026-08-01';
const FUTURE = '2026-09-01T00:00:00.000Z';
const PAST = '2026-07-01T00:00:00.000Z';

describe('entitlements / limits', () => {
  it('만료일이 지나면 비활성', () => {
    expect(isActive({ pro: FUTURE }, 'pro', NOW)).toBe(true);
    expect(isActive({ pro: PAST }, 'pro', NOW)).toBe(false);
    expect(isActive({}, 'pro', NOW)).toBe(false);
    expect(isActive({ pro: '쓰레기' } as Entitlements, 'pro', NOW)).toBe(false);
  });

  it('무료는 30건 제한, records 또는 pro면 무제한', () => {
    expect(canAddRecord(FREE_RECORD_LIMIT - 1, {}, NOW)).toBe(true);
    expect(canAddRecord(FREE_RECORD_LIMIT, {}, NOW)).toBe(false);
    expect(canAddRecord(999, { records: FUTURE }, NOW)).toBe(true);
    expect(canAddRecord(999, { pro: FUTURE }, NOW)).toBe(true);
    expect(canAddRecord(999, { pro: PAST }, NOW)).toBe(false);
  });

  it('광고 제거: noads 또는 pro', () => {
    expect(adsRemoved({}, NOW)).toBe(false);
    expect(adsRemoved({ noads: FUTURE }, NOW)).toBe(true);
    expect(adsRemoved({ pro: FUTURE }, NOW)).toBe(true);
    expect(adsRemoved({ records: FUTURE }, NOW)).toBe(false);
  });

  it('분석 한도: 무료 1회/일, pro 3회/일', () => {
    expect(dailyInsightLimit({}, NOW)).toBe(1);
    expect(dailyInsightLimit({ pro: FUTURE }, NOW)).toBe(3);
  });

  it('카운터: 날짜 키가 바뀌면 리셋', () => {
    expect(remainingInsights(null, {}, NOW, TODAY)).toBe(1);
    expect(remainingInsights({ date: TODAY, used: 1 }, {}, NOW, TODAY)).toBe(0);
    expect(remainingInsights({ date: '2026-07-31', used: 1 }, {}, NOW, TODAY)).toBe(1); // 어제 사용분 리셋
    expect(remainingInsights({ date: TODAY, used: 2 }, { pro: FUTURE }, NOW, TODAY)).toBe(1);
    expect(remainingInsights({ date: TODAY, used: 5 }, { pro: FUTURE }, NOW, TODAY)).toBe(0); // 음수 방지
  });

  it('consumeInsight는 날짜 경계에서 1부터 다시 센다', () => {
    expect(consumeInsight(null, TODAY)).toEqual({ date: TODAY, used: 1 });
    expect(consumeInsight({ date: TODAY, used: 1 }, TODAY)).toEqual({ date: TODAY, used: 2 });
    expect(consumeInsight({ date: '2026-07-31', used: 3 }, TODAY)).toEqual({ date: TODAY, used: 1 });
  });
});

describe('OCR 리워드 게이트', () => {
  const AD_ID = 'ait.v2.live.0123456789abcdef';

  it('패스는 오늘 날짜 키만 유효(자정 경계 리셋)', () => {
    expect(hasValidPass(TODAY, TODAY)).toBe(true);
    expect(hasValidPass('2026-07-31', TODAY)).toBe(false);
    expect(hasValidPass(null, TODAY)).toBe(false);
  });

  it('pro 또는 광고 제거 사용자는 광고 없이 통과', () => {
    expect(decideOcrGate(null, { pro: FUTURE }, NOW, TODAY, AD_ID)).toBe('allow');
    expect(decideOcrGate(null, { noads: FUTURE }, NOW, TODAY, AD_ID)).toBe('allow');
    expect(decideOcrGate(null, { pro: PAST }, NOW, TODAY, AD_ID)).toBe('need-ad');
  });

  it('리워드 광고 ID 미발급이면 광고 없이 통과(zero footprint)', () => {
    expect(decideOcrGate(null, {}, NOW, TODAY, '')).toBe('allow');
  });

  it('무료 사용자는 하루 첫 사용 시 광고, 패스가 있으면 통과', () => {
    expect(decideOcrGate(null, {}, NOW, TODAY, AD_ID)).toBe('need-ad');
    expect(decideOcrGate(TODAY, {}, NOW, TODAY, AD_ID)).toBe('allow');
    expect(decideOcrGate('2026-07-31', {}, NOW, TODAY, AD_ID)).toBe('need-ad'); // 날짜 바뀌면 다시
  });

  it('광고 실패도 패스를 발급한다(사용자 벌주지 않기)', () => {
    expect(passAfterAd('completed', TODAY)).toBe(TODAY);
    expect(passAfterAd('failed', TODAY)).toBe(TODAY);
  });
});
