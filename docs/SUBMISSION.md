# 제출 정보 — 주식 매매일지

| 항목 | 값 |
|---|---|
| appName | maemaelog |
| displayName | 주식 매매일지 |
| primaryColor | #143A5C |
| 아이콘 | assets/icon-600.png (다크: assets/icon-600-dark.png) — 콘솔 업로드 후 URL을 granite.config.ts brand.icon에 반영 |
| permissions | [] |
| 광고 | 배너 VITE_AD_GROUP_ID / 리워드 VITE_REWARDED_AD_ID (미주입 시 zero-footprint) |
| IAP SKU | maemaelog.pro.monthly 3,000원 / maemaelog.records.monthly 500원 / maemaelog.noads.monthly 500원 |

## 심사용 테스트 시나리오
1. 홈 → 빈 상태 확인 → 하단 "입력" 탭
2. 매수 선택, 종목명 "삼성전자", 단가 70000, 수량 10, 감정 "확신" 선택 → 기록 저장
3. 입력 탭에서 매도 선택, 같은 종목 75000 × 10 저장 → 홈에서 이번 달 실현손익 +50,000원 확인
4. 통계 탭 → [통계] 실현손익·승률·종목 순위·월별 손익 / [분석] 습관 분석 보기(무료 1일 1회)
5. 입력 탭에서 "체결 스크린샷 첨부" 후 "거래내역 넣으면 자동 입력" → 인식값 자동 채움(실패 시 수동 입력으로 동작)
6. 면책: 화면 하단에 참고용·투자 권유 아님 고지, 데이터는 기기에만 저장

## 최종 점검
- [ ] git status 비어 있음
- [ ] brand.icon = 콘솔 로고 URL (로컬 경로 금지)
- [ ] displayName = 콘솔 등록명과 문자 단위 동일
- [ ] tsc / vitest / e2e-smoke / vite build 통과
