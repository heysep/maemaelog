import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT = 4741;
const BASE = `http://127.0.0.1:${PORT}`;
const ALLOWED = [/ReactNativeWebView is not available/, /Failed to load resource/];
let passed = 0;
const ok = (c, l) => { if (!c) throw new Error('FAIL: ' + l); passed++; console.log('  ok - ' + l); };
// 헤르메틱 빌드: AI 분석 엔드포인트를 비워 실서버 호출 경로를 차단(폴백/미설정 경로만 검증)
const { spawnSync } = await import('node:child_process');
const build = spawnSync('npx', ['vite', 'build'], {
  shell: true, stdio: 'ignore',
  env: { ...process.env, VITE_ANALYSIS_ENDPOINT: '', VITE_AD_GROUP_ID: '', VITE_REWARDED_AD_ID: '' },
});
if (build.status !== 0) { console.error('vite build 실패'); process.exit(1); }

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1×1 투명 PNG — 썸네일 저장 로직만 검증(OCR/tesseract 로드는 하지 않는다)
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const setInput = (page, sel, v) => page.evaluate(({ s, val }) => {
  const el = document.querySelector(s);
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, { s: sel, val: v });
const clickTab = (page, name) => page.evaluate((n) => {
  [...document.querySelectorAll('.tab')].find((t) => t.innerText.trim() === n)?.click();
}, name);
const clickBtn = (page, label) => page.evaluate((n) => {
  [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === n)?.click();
}, label);
const text = (page) => page.evaluate(() => document.body.innerText);

let browser;
try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { up = (await fetch(BASE)).ok; } catch { await wait(250); } }
  ok(up, 'preview 기동');
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  // 외부 네트워크 의존 금지: OCR(tesseract 언어 데이터 CDN) 경로 차단 → 우아한 실패 경로 검증
  await page.evaluateOnNewDocument(() => { window.__MAEMAE_DISABLE_OCR = true; });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !ALLOWED.some((re) => re.test(m.text()))) errs.push(m.text()); });
  page.on('pageerror', (e) => { if (!ALLOWED.some((re) => re.test(e.message))) errs.push(e.message); });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });

  ok((await text(page)).includes('주식 매매일지'), '홈 타이틀');
  {
    const t0 = await text(page);
    ok(t0.includes('첫 매매를 기록해보세요'), '빈 상태 카드');
    ok(t0.includes('+0원'), '빈 상태에도 수익 카드 +0원');
    ok(!t0.includes('-0원'), '"-0원" 노출 금지');
    ok(t0.includes('총 0건 · 수익 0건 · 손실 0건'), '빈 상태 건수 요약');
  }
  // "분석 보기 ›" 링크 → 통계 탭의 분석 화면
  await clickBtn(page, '분석 보기 ›'); await wait(200);
  ok((await text(page)).includes('습관 분석'), '분석 보기 링크 → 분석 화면');
  await clickTab(page, '홈'); await wait(150);
  // 빈 상태 카드 탭 → 입력 탭
  await page.click('.empty-card'); await wait(200);
  ok((await text(page)).includes('매매 기록 남기기'), '빈 상태 카드 탭 → 입력 탭');
  await clickTab(page, '홈'); await wait(150);

  // ---- 수동 입력 경로: 매수 기록 저장 (OCR·tesseract 로드 없음) ----
  await clickTab(page, '입력'); await wait(150);
  await setInput(page, '#f-symbol', '삼성전자');
  await setInput(page, '#f-price', '70000');
  await setInput(page, '#f-qty', '10');
  await setInput(page, '#f-date', '2026-08-01');
  await setInput(page, '#f-memo', '실적 기대 매수');
  await page.evaluate(() => { [...document.querySelectorAll('.chip')].find((c) => c.innerText === '확신')?.click(); });
  await wait(100);
  await clickBtn(page, '기록 저장'); await wait(200);
  ok((await text(page)).includes('삼성전자'), '저장 후 홈에 기록 표시');
  ok((await text(page)).includes('매수'), '매수 배지');

  // ---- 매도 기록 → 손익/통계 ----
  await clickTab(page, '입력'); await wait(150);
  await page.evaluate(() => { [...document.querySelectorAll('.seg-btn')].find((b) => b.innerText === '매도')?.click(); });
  await setInput(page, '#f-symbol', '삼성전자');
  await setInput(page, '#f-price', '75000');
  await setInput(page, '#f-qty', '10');
  await setInput(page, '#f-date', '2026-08-01');
  await clickBtn(page, '기록 저장'); await wait(200);
  ok((await text(page)).includes('+50,000원'), '홈 이번 달 실현손익 +50,000원');

  await clickTab(page, '통계'); await wait(200);
  await clickBtn(page, '통계'); await wait(200); // 세그먼트를 통계 뷰로(앞의 분석 보기 링크로 insight 상태일 수 있음)
  const st = await text(page);
  ok(st.includes('+50,000원'), '통계 실현손익');
  ok(st.includes('100%'), '승률 100%');
  ok(st.includes('2026-08'), '월별 손익');

  // 분석 세그먼트: 습관 분석 (무료 1회)
  await clickBtn(page, '분석'); await wait(200);
  await clickBtn(page, '습관 분석 보기'); await wait(200);
  ok((await text(page)).includes('한 줄 처방'), '습관 분석 리포트 표시');

  // ---- 이미지 업로드: 1×1 PNG 주입 → 썸네일 저장 확인 ----
  const dir = mkdtempSync(join(tmpdir(), 'maemae-'));
  const pngPath = join(dir, 'tiny.png');
  writeFileSync(pngPath, PNG_1x1);
  await clickTab(page, '입력'); await wait(150);
  const fileInput = await page.$('#f-image');
  await fileInput.uploadFile(pngPath);
  await wait(600);
  ok(await page.$('.ocr-thumb') !== null, '썸네일 미리보기 표시');
  // 이미지 선택 즉시 OCR 자동 시작 → (차단 환경) 우아한 실패 → 수동 입력으로 계속
  ok((await text(page)).includes('인식하지 못했어요'), 'OCR 실패 시 안내 후 수동 입력 유지');
  await setInput(page, '#f-symbol', '테스트종목');
  await setInput(page, '#f-price', '1000');
  await setInput(page, '#f-qty', '1');
  await setInput(page, '#f-date', '2026-08-01');
  await clickBtn(page, '기록 저장'); await wait(200);
  const thumbSaved = await page.evaluate(() => {
    const trades = JSON.parse(localStorage.getItem('maemaelog.trades') ?? '[]');
    const t = trades.find((x) => x.symbol === '테스트종목');
    return typeof t?.thumb === 'string' && t.thumb.startsWith('data:image/');
  });
  ok(thumbSaved, '512px 썸네일 dataURL이 기록에 저장됨');
  ok(await page.evaluate(() => document.body.innerText.includes('테스트종목')), '썸네일 기록 홈 표시');

  // ---- 리로드 영속성 ----
  await page.reload({ waitUntil: 'networkidle0' }); await wait(200);
  const after = await text(page);
  ok(after.includes('삼성전자') && after.includes('테스트종목'), '리로드 후 기록 유지');

  // ---- 내정보 탭: 미지원 환경 안내 + 이용 현황 ----
  await clickTab(page, '내정보'); await wait(200);
  const me = await text(page);
  ok(me.includes('토스 로그인은 토스 앱에서 이용 가능'), '내정보: 로그인 미지원 안내(브라우저)');
  ok(me.includes('이용 현황'), '내정보: 이용 현황 카드');
  ok(me.includes('이용권'), '내정보: 이용권 카드');
  ok(me.includes('토스 앱에서 이용 가능'), '내정보: IAP 미지원 안내(브라우저)');

  // ---- 회원탈퇴 플로우: 커스텀 확인 시트 → 전체 데이터 삭제 ----
  await clickBtn(page, '회원탈퇴'); await wait(200);
  ok((await text(page)).includes('모든 기록이 삭제됩니다'), '탈퇴 확인 시트 표시');
  await clickBtn(page, '취소'); await wait(150);
  ok(await page.$('.sheet') === null, '취소 시 시트 닫힘');
  await clickBtn(page, '회원탈퇴'); await wait(150);
  await clickBtn(page, '모든 기록 삭제하고 탈퇴'); await wait(250);
  const wiped = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i).startsWith('maemaelog.')) return false;
    }
    return true;
  });
  ok(wiped, '탈퇴 후 maemaelog.* 데이터 전부 삭제');
  ok((await text(page)).includes('첫 매매를 기록해보세요'), '탈퇴 후 초기 화면(홈)');

  // ---- 손상 localStorage 내성 ----
  await page.evaluate(() => {
    localStorage.setItem('maemaelog.trades', '{broken json!!');
    localStorage.setItem('maemaelog.ent.v1', '[1,2,3');
    localStorage.setItem('maemaelog.insight.uses', 'null');
    localStorage.setItem('maemaelog.ocrPass', '???');
  });
  await page.reload({ waitUntil: 'networkidle0' }); await wait(200);
  ok((await text(page)).includes('첫 매매를 기록해보세요'), '손상 데이터 → 초기 상태 복구');

  // ---- 금지 문자열/콘솔 에러 ----
  for (const nm of ['홈', '입력', '통계', '내정보']) {
    await clickTab(page, nm); await wait(150);
    const t = await text(page);
    for (const bad of ['NaN', 'undefined', 'Infinity', '[object', 'null원', '-0원']) ok(!t.includes(bad), `${nm}: 노출 없음 ${bad}`);
  }
  ok(errs.length === 0, '콘솔 에러 0건' + (errs.length ? ' — ' + errs[0] : ''));
  console.log(`\nE2E SMOKE PASS — ${passed} assertions`);
} finally { await browser?.close(); server.kill(); }
