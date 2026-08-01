import { describe, expect, it } from 'vitest';
import { parseTradeText } from './ocrParse';

describe('parseTradeText — 증권앱 체결내역 패턴', () => {
  it('라벨형: 체결단가·체결수량·매수', () => {
    const p = parseTradeText('삼성전자 매수 체결\n체결단가 72,000원\n체결수량 10주');
    expect(p.symbol).toBe('삼성전자');
    expect(p.side).toBe('buy');
    expect(p.price).toBe(72000);
    expect(p.qty).toBe(10);
    // "삼성전자 매수 체결" 제목 줄에서 종목명을 확신으로 추출한다
    expect(p.confident).toEqual({ symbol: true, side: true, price: true, qty: true, date: false });
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
    expect(p.symbol).toBe('SK하이닉스');
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

  it('OCR 체→제 혼동: "제결가/제결량"도 라벨로 인식한다', () => {
    const p = parseTradeText('하이닉스 매도\n제결가 228,000\n제결량 2');
    expect(p.price).toBe(228000);
    expect(p.qty).toBe(2);
  });

  it('수량 라벨이 깨져도 숫자만 남은 줄에서 수량을 건진다(확신 낮음)', () => {
    const p = parseTradeText('하이닉스 매수\n제결가 231,500\nMZ E   3\n통화 KRW');
    expect(p.qty).toBe(3);
    expect(p.confident.qty).toBe(false);
  });

  it('숫자 사이 공백 낀 쉼표를 정규화한다("72, 400원")', () => {
    const p = parseTradeText('삼성전자 매수 단가 72, 400원 수량 10주');
    expect(p.price).toBe(72400);
  });

  it('토스증권형: "{이름} 구매" 제목 + 금액÷수량 단가 계산 + 소수 수량 + 날짜 + 환율 무시', () => {
    const p = parseTradeText(
      '알파벳 A 구매\n구매 완료\n2026.7.23 23:18\n구매 금액 506,985원\n$341.49\n적용 환율 1,484.59원\n수량 1.071309주'
    );
    expect(p.symbol).toBe('알파벳 A');
    expect(p.confident.symbol).toBe(true);
    expect(p.side).toBe('buy');
    expect(p.qty).toBe(1.071309);
    expect(p.price).toBe(Math.round(506985 / 1.071309)); // 계산값
    expect(p.confident.price).toBe(false); // 계산값은 확신 낮음
    expect(p.date).toBe('2026-07-23');
    expect(p.time).toBe('23:18');
  });

  it('토스증권형 판매: "테슬라 판매" → 매도', () => {
    const p = parseTradeText('테슬라 판매\n판매 완료\n판매 금액 1,152,300원\n수량 2.5주');
    expect(p.symbol).toBe('테슬라');
    expect(p.side).toBe('sell');
    expect(p.qty).toBe(2.5);
    expect(p.price).toBe(Math.round(1152300 / 2.5));
  });

  it('구매·판매 둘 다 있으면 구분 확신 없음', () => {
    const p = parseTradeText('구매 취소 후 판매 완료');
    expect(p.side).toBeUndefined();
  });

  it('날짜 형식 변형: 구두점·콤마·공백 구분자', () => {
    expect(parseTradeText('체결 2026-07-23').date).toBe('2026-07-23');
    expect(parseTradeText('체결 2026/7/3').date).toBe('2026-07-03');
    expect(parseTradeText('체결 2026, 7, 23').date).toBe('2026-07-23');
    expect(parseTradeText('체결 2026 7 23').date).toBe('2026-07-23');
    expect(parseTradeText('숫자없음').date).toBeUndefined();
  });

  it('날짜 구분자 소실: "2026723", "20267.23" (시각 없이도 인정)', () => {
    expect(parseTradeText('구매 완료\n2026723').date).toBe('2026-07-23');
    expect(parseTradeText('구매 완료\n20267.23').date).toBe('2026-07-23');
    expect(parseTradeText('구매 완료\n20261115').date).toBe('2026-11-15');
  });

  it('금액 라벨-값이 줄로 갈라져도, "원"이 "윈/월"로 오독돼도 단가를 계산한다', () => {
    const split = parseTradeText('테슬라 구매\n구매 금액\n1,152,300원\n수량 2.5주');
    expect(split.price).toBe(460920);
    const misread = parseTradeText('테슬라 구매\n구매금액 1,152,300윈\n수량 2.5주');
    expect(misread.price).toBe(460920);
    const noCurrency = parseTradeText('테슬라 구매\n금액 1,152,300\n수량 2.5주');
    expect(noCurrency.price).toBe(460920);
  });

  it('단가 최후 폴백: 금액 라벨이 전멸해도 가장 큰 콤마 숫자를 금액으로 쓴다', () => {
    const p = parseTradeText('알파벳 구매\nOO 506,985 XX\n수량 1.071309주');
    expect(p.price).toBe(Math.round(506985 / 1.071309));
    expect(p.confident.price).toBe(false);
  });

  it('실기기 토스증권 화면 OCR 원문(상태바·헤더·진행단계 노이즈 포함) 전체 파싱', () => {
    // 실물 스크린샷을 scripts/ocr-real.mjs로 돌려 얻은 원시 OCR 텍스트 구조 재현
    const raw = [
      '11:56 SM@ «                Ke il 9',
      '€                                       현재가격 보기',
      '알파벳 A 구매',
      '주문                  구매완료                  출금',
      '취소 가능                취소 불가능                7월 27일',
      '구매 완료',
      '목표 수의 류 설정',
      '2026723 23:18                         ana',
      '으',
      '구매 금액                                  506,985원',
      '$341.49',
      '적용 환율                                  1.484.59원',
      '수량                                        1.071309주',
      '주문접수 내역                                           ^',
      '주문 시간                          2026.7.23 23:18',
      'xo oa                 AAH KO /1IKIL',
      'III                 O                  <',
    ].join('\n');
    const p = parseTradeText(raw);
    expect(p.symbol).toBe('알파벳 A');
    expect(p.side).toBe('buy');
    expect(p.qty).toBe(1.071309);
    expect(p.price).toBe(473239); // 506,985 ÷ 1.071309 (±1원 기준 내)
    expect(p.date).toBe('2026-07-23');
    expect(p.time).toBe('23:18');
  });

  it('"현재가격 보기" 헤더를 종목명으로 오인하지 않는다', () => {
    const p = parseTradeText('현재가격 보기\n주문접수 내역\n수량 3주');
    expect(p.symbol).not.toBe('현재');
    expect(p.symbol).not.toBe('현재가격');
  });

  it('빈 문자열 안전', () => {
    const p = parseTradeText('');
    expect(p.confident).toEqual({ symbol: false, side: false, price: false, qty: false, date: false });
  });
});
