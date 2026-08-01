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

  // ---------------------------------------------------------------------------
  // 실물 토스증권 스크린샷을 해상도·압축률별로 재인코딩해 얻은 원시 OCR 텍스트(웹뷰 재압축 재현).
  // 저품질에서 ① 금액 라벨 소실 ② 통화 글자 오독 ③ 날짜 구분자 소실이 동시에 발생한다.
  // ---------------------------------------------------------------------------
  describe('실물 토스증권 — 해상도/압축률 열화 3단계', () => {
    const head = ['11:56 SM@ «                Ke il 9', '€                    현재가격 보기', '알파벳 A 구매', '구매 완료'];
    const expected = { symbol: '알파벳 A', side: 'buy', qty: 1.071309, price: 473239, date: '2026-07-23', time: '23:18' };

    it('2400px q0.92 / 2200px q0.8(양호): 라벨·날짜 모두 온전', () => {
      const p = parseTradeText([...head, '구매 금액   506,985원', '수량   1.071309주', '주문 시간  2026.7.23 23:18'].join('\n'));
      expect(p).toMatchObject(expected);
    });

    it('1600px q0.8: 날짜 구분자 1개 소실("2026.723")', () => {
      const p = parseTradeText([...head, '2026.723 23:18', '구매 금액   506,985원', '적용 환율 1,484.59원', '수량   1.071309주'].join('\n'));
      expect(p).toMatchObject(expected);
    });

    it('1080px q0.6(열화): 금액 라벨 소실 + "원"→"!" 오독 + 날짜 구분자 소실("20267.23")', () => {
      const p = parseTradeText([...head, '20267.23 23:18', '506,985!', '$341.49', '수량   1.071309주'].join('\n'));
      expect(p).toMatchObject(expected);
      expect(p.confident.price).toBe(false); // 계산값
    });

    it('통화 글자가 "!"로 오독돼도 금액 라벨이 남아 있으면 단가를 계산한다', () => {
      expect(parseTradeText('테슬라 구매\n구매 금액 1,152,300!\n수량 2.5주').price).toBe(460920);
      expect(parseTradeText('테슬라 구매\n구매 금액 1,152,300|\n수량 2.5주').price).toBe(460920);
    });

    it('통화 글자가 없어도 금액 끝자리를 통화로 잡아먹지 않는다', () => {
      // '1'·'l'을 통화 후보에 넣으면 506,981 → 50,698로 훼손된다
      expect(parseTradeText('테슬라 구매\n금액 506,981\n수량 1주').price).toBe(506981);
    });
  });

  // ---------------------------------------------------------------------------
  // 웹에서 수집한 실제 증권앱 스크린샷을 앱과 동일한 파이프라인
  // (2200px 리사이즈 → tesseract kor+eng 로컬 자산)에 통과시켜 얻은 원시 OCR 텍스트 박제.
  // ---------------------------------------------------------------------------
  describe('실물 스크린샷 원시 OCR — 플랫폼별', () => {
    it('키움 영웅문S# 거래내역(리스트형): 입출금·환전을 건너뛰고 최상단 매매 행 1건만', () => {
      const raw = [
        '<— 일별주문내역 | 거래내역 | 수익률현황  :',
        '전체      OQ 2022.01.21 ~',
        '  2023.01.20',
        '거래일자   거래종류 거래단가/환율  거래금액 른',
        '처리시간  적요명  거래수량  거래금액(외)',
        '입출금    0',
        '이체입금(지급결제)   0',
        '환전  1,324.73  는',
        '외화매수    0',
        '매매  522.4500',
        '매수    1    a |',
        '매매            148.1600                             J',
        '매수    1',
        '코스닥              71465 4 1.76         0.25%',
        ' 관심종목 put 주문 차트 계좌 -',
      ].join('\n');
      const p = parseTradeText(raw);
      expect(p.price).toBe(522.45); // 두 번째 행 148.16이 아니라 최상단 매매 행
      expect(p.qty).toBe(1);
      expect(p.side).toBe('buy');
      // 조회기간(2022.01.21 ~ 2023.01.20)은 체결일이 아니다 — 종목명 열도 화면에 없다
      expect(p.date).toBeUndefined();
      expect(p.confident.symbol).toBe(false);
    });

    it('"관심종목 put"을 종목명 라벨로 오인하지 않는다', () => {
      const p = parseTradeText('관심종목 put 주문 차트 계좌\n수량 3주');
      expect(p.confident.symbol).toBe(false);
      expect(p.symbol).not.toBe('put');
    });

    it('조회기간 범위 날짜("A ~ B")는 체결일로 쓰지 않는다', () => {
      expect(parseTradeText('조회기간 2022.01.21 ~ 2023.01.20').date).toBeUndefined();
      // 범위 아래에 실제 행 날짜가 따로 있으면 그 값을 쓴다
      expect(parseTradeText('2025/10/14 - 2025/10/14\n2025/10/14  54,550').date).toBe('2025-10-14');
    });

    it('KB증권 M-able 거래내역: 종목명 열이 없어 날짜만 확신', () => {
      const raw = [
        '<              거래내역',
        '종합위탁 a 6985 amy v',
        '전체 ~ 당일 ~            2025/10/14 - 2025/10/14',
        '[매매 내역제외          예수금 자동저금통 내역제외',
        '0 00000 거래금액 00 수스 eT',
        '새는  정산금액    편드가입번호/신탁보수  oat',
        '2025/10/14       0.00             :',
        '54,550            60',
        '2025/10/14          54,610',
      ].join('\n');
      const p = parseTradeText(raw);
      expect(p.date).toBe('2025-10-14');
      expect(p.confident.symbol).toBe(false);
    });

    it('나무증권 거래내역 엑셀 저장 행: 거래일자·거래유형(매수)', () => {
      const raw = [
        '1  일  | a     수량 |거래금액| 잔고 |이율 |수수료 |연체료 | 받는통장표시내용 |투자위험도| , .',
        '> 0, rae | BAe | zs 단가 |정산금액|잔고금액|이자| 세금 |변제금| 거래내역메모 | 비고 | -',
        '3 2021.10.25 매수',
        '4 .0118489 |',
      ].join('\n');
      const p = parseTradeText(raw);
      expect(p.date).toBe('2021-10-25');
      expect(p.side).toBe('buy');
      expect(p.confident.symbol).toBe(false); // 종목명 마스킹 — 표 헤더를 종목명으로 오인하지 않는다
    });

    it('토스증권 주문 확인 모달: 목적격 조사를 종목명에 붙이지 않는다', () => {
      const raw = ['대한항공을 1주', '구매할게요', '1주 희망가격                   27,950 원', '총 주문금액                   27,950 원', '='].join('\n');
      const p = parseTradeText(raw);
      expect(p.symbol).toBe('대한항공'); // "대한항공을" 아님
      expect(p.confident.symbol).toBe(true);
      expect(p.side).toBe('buy');
      expect(p.qty).toBe(1);
      expect(p.price).toBe(27950);
    });
  });

  it('빈 문자열 안전', () => {
    const p = parseTradeText('');
    expect(p.confident).toEqual({ symbol: false, side: false, price: false, qty: false, date: false });
  });
});
