import { describe, expect, it } from 'vitest';
import { parseTradeText } from './ocrParse';

describe('parseTradeText — 증권앱 체결내역 패턴', () => {
  it('라벨형: 체결단가·체결수량·매수', () => {
    const p = parseTradeText('삼성전자 매수 체결\n체결단가 72,000원\n체결수량 10주');
    expect(p.symbol).toBe('삼성전자');
    expect(p.side).toBe('buy');
    expect(p.price).toBe(72000);
    expect(p.qty).toBe(10);
    expect(p.confident).toEqual({ symbol: false, side: true, price: true, qty: true });
  });

  it('종목명 라벨이 있으면 확신 종목명', () => {
    const p = parseTradeText('종목명 카카오\n단가 48,500 수량 20');
    expect(p.symbol).toBe('카카오');
    expect(p.confident.symbol).toBe(true);
    expect(p.price).toBe(48500);
    expect(p.qty).toBe(20);
  });

  it('알림형: "[체결] SK하이닉스 3주 231,000원 매도"', () => {
    const p = parseTradeText('[체결] SK하이닉스 3주 231,000원 매도');
    expect(p.side).toBe('sell');
    expect(p.symbol).toBe('SK');
    expect(p.price).toBe(231000);
    expect(p.qty).toBe(3);
  });

  it('원-주 순서 페어: "72,000원 10주"', () => {
    const p = parseTradeText('매수 체결 완료 삼성전자 72,000원 10주');
    expect(p.price).toBe(72000);
    expect(p.qty).toBe(10);
    expect(p.confident.price).toBe(false); // 라벨 없는 추출은 확신 낮음
  });

  it('매수·매도 둘 다 있으면 구분 확신 없음', () => {
    const p = parseTradeText('매수 취소 후 매도 체결');
    expect(p.side).toBeUndefined();
    expect(p.confident.side).toBe(false);
  });

  it('가격 라벨: "체결가 15,300"', () => {
    const p = parseTradeText('네이버 매도 체결가 15,300 체결량 5');
    expect(p.price).toBe(15300);
    expect(p.side).toBe('sell');
  });

  it('"주문"의 주는 수량으로 오인하지 않는다', () => {
    const p = parseTradeText('매수주문 접수 카카오 수량 7');
    expect(p.qty).toBe(7);
    expect(p.symbol).toBe('카카오');
  });

  it('상용어(체결·주문 등)는 종목명이 되지 않는다', () => {
    const p = parseTradeText('주식 체결 안내 매수 완료 에코프로 100주');
    expect(p.symbol).toBe('에코프로');
  });

  it('숫자·종목 정보가 없으면 전부 undefined', () => {
    const p = parseTradeText('오늘도 좋은 하루');
    expect(p.price).toBeUndefined();
    expect(p.qty).toBeUndefined();
    expect(p.side).toBeUndefined();
  });

  it('빈 문자열 안전', () => {
    const p = parseTradeText('');
    expect(p.confident).toEqual({ symbol: false, side: false, price: false, qty: false });
  });
});
