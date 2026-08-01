import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const PORT = 4742;
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync('store-assets', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SEED = [
  { symbol: '삼성전자', side: 'buy', price: 70200, qty: 10, date: '2026-07-06', time: '09:20', memo: '2분기 실적 기대. 외국인 순매수 전환 확인 후 진입', emotion: '확신' },
  { symbol: '삼성전자', side: 'sell', price: 75600, qty: 10, date: new Date().toISOString().slice(0, 10), time: '10:05', memo: '목표가 도달, 원칙대로 익절', emotion: '원칙' },
  { symbol: 'SK하이닉스', side: 'buy', price: 231000, qty: 3, date: '2026-07-10', time: '13:40', memo: '급등 중 따라 삼. 뉴스 보고 진입', emotion: '추격' },
  { symbol: 'SK하이닉스', side: 'sell', price: 224500, qty: 3, date: '2026-07-15', time: '14:55', memo: '더 빠질까봐 손절', emotion: '공포' },
  { symbol: '카카오', side: 'buy', price: 48500, qty: 20, date: '2026-07-28', time: '09:45', memo: '지지선 반등 노림', emotion: '확신' },
].map((t, i) => ({ id: `seed-${i}`, ...t }));

const clickTab = (page, name) => page.evaluate((n) => {
  [...document.querySelectorAll('.tab')].find((t) => t.innerText.trim() === n)?.click();
}, name);
const setInput = (page, sel, v) => page.evaluate(({ s, val }) => {
  const el = document.querySelector(s);
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, { s: sel, val: v });

/** 상단 카피 문구 배너 주입 */
const setCopy = (page, copy) => page.evaluate((c) => {
  let el = document.getElementById('store-copy');
  if (!el) {
    el = document.createElement('div');
    el.id = 'store-copy';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99;background:#143A5C;color:#fff;font-weight:800;font-size:15px;line-height:1.45;padding:14px 20px;letter-spacing:-0.2px;word-break:keep-all;';
    document.body.prepend(el);
  }
  el.textContent = c;
}, copy);

let browser;
try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { up = (await fetch(BASE)).ok; } catch { await wait(250); } }
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 318, height: 524, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate((seed) => {
    localStorage.setItem('maemaelog.trades', JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(300);

  // shot1 — 홈: 이번 달 요약 + 최근 매매
  await setCopy(page, '이번 달 손익·승률이 한눈에');
  await page.evaluate(() => { document.body.style.paddingTop = '52px'; window.scrollTo(0, 0); });
  await page.screenshot({ path: 'store-assets/shot1.png' });

  // shot2 — 입력: 폼 + 감정 태그 + 스크린샷 골라 넣기
  await clickTab(page, '입력'); await wait(250);
  await setInput(page, '#f-symbol', '삼성전자');
  await setInput(page, '#f-price', '70200');
  await setInput(page, '#f-qty', '10');
  await page.evaluate(() => { [...document.querySelectorAll('.chip')].find((c) => c.innerText === '확신')?.click(); });
  await setInput(page, '#f-memo', '실적 기대. 외국인 순매수 확인 후 진입');
  await wait(200);
  await setCopy(page, '체결 스크린샷 속 숫자를 탭해서 입력 끝');
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.screenshot({ path: 'store-assets/shot2.png' });

  // shot3 — 통계: 습관 분석
  await clickTab(page, '통계'); await wait(250);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '분석')?.click(); });
  await wait(200);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '습관 분석 보기')?.click(); });
  await wait(250);
  await setCopy(page, '감정 태그로 찾아내는 나의 매매 습관');
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('.panel-title')].find((x) => x.innerText.includes('습관 분석'));
    if (h) window.scrollTo(0, h.closest('.panel').offsetTop - 64);
  });
  await wait(200);
  await page.screenshot({ path: 'store-assets/shot3.png' });

  console.log('shots done');
} finally { await browser?.close(); server.kill(); }
