/**
 * OCR 실측 정확도 테스트 — 증권앱 체결내역 픽스처 3종(토스증권/키움 영웅문/삼성증권 스타일)
 * × 매수/매도 = 6케이스를 PNG로 렌더 → 실제 tesseract.js(kor+eng) OCR → ocrParse 파서 → 기대값 비교.
 *
 * 통과 기준: 단가 6/6, 수량 6/6, 종목명 ≥4/6.
 * 주의: 언어 데이터는 CDN에서 내려받으므로 네트워크 필요(실패 시 1회 재시도).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const dir = mkdtempSync(join(tmpdir(), 'ocr-acc-'));

// ---- 1) TS 파서를 esbuild로 번들해 그대로 사용 (재구현 금지 — 앱과 동일 코드 검증) ----
const parserOut = join(dir, 'ocrParse.mjs');
const es = spawnSync('npx', ['esbuild', 'src/core/ocrParse.ts', '--bundle', '--format=esm', `--outfile=${parserOut}`], { shell: true });
if (es.status !== 0) { console.error(String(es.stderr)); process.exit(1); }
const { parseTradeText } = await import(pathToFileURL(parserOut).href);

// ---- 2) 픽스처 ----
const page = (body, font) => `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#fff;color:#191f28;font-family:${font};-webkit-font-smoothing:antialiased}
</style><body>${body}</body>`;

/** 토스증권 스타일: 큰 타이포 카드 + label/value 행 */
const tossFixture = ({ symbol, sideKo, price, qty }) => page(`
  <div style="padding:28px 24px">
    <div style="font-size:20px;color:#6b7684">주식 ${sideKo} 체결 안내</div>
    <div style="font-size:38px;font-weight:800;margin-top:14px">${symbol}</div>
    <div style="margin-top:34px;border-top:2px solid #f2f4f6;padding-top:24px">
      <div style="display:flex;justify-content:space-between;font-size:26px;margin-bottom:22px">
        <span style="color:#6b7684">체결단가</span><span style="font-weight:700">${price.toLocaleString('ko-KR')}원</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:26px;margin-bottom:22px">
        <span style="color:#6b7684">체결수량</span><span style="font-weight:700">${qty}주</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:26px">
        <span style="color:#6b7684">구분</span><span style="font-weight:700;color:#3182f6">${sideKo}</span>
      </div>
    </div>
  </div>`, `'Malgun Gothic','Apple SD Gothic Neo',sans-serif`);

/** 키움 영웅문 스타일: 격자 표 + 진한 헤더 */
const kiwoomFixture = ({ symbol, sideKo, price, qty }) => page(`
  <div style="padding:20px 14px">
    <div style="background:#2d3a52;color:#fff;font-size:24px;font-weight:700;padding:14px 16px">체결 내역</div>
    <table style="width:100%;border-collapse:collapse;font-size:25px;margin-top:2px">
      ${[['종목명', symbol], ['구분', sideKo], ['체결가', price.toLocaleString('ko-KR')], ['체결량', String(qty)], ['통화', 'KRW']]
        .map(([k, v]) => `<tr>
          <td style="border:2px solid #c9d1de;background:#eef1f6;padding:16px;width:40%;font-weight:700">${k}</td>
          <td style="border:2px solid #c9d1de;padding:16px;text-align:right;font-weight:600">${v}</td>
        </tr>`).join('')}
    </table>
  </div>`, `'Gulim','Malgun Gothic',sans-serif`);

/** 삼성증권 스타일: 알림 문장형 카드 */
const samsungFixture = ({ symbol, sideKo, price, qty }) => page(`
  <div style="padding:30px 22px">
    <div style="border:2px solid #d7dce5;border-radius:16px;padding:26px 22px">
      <div style="font-size:22px;color:#5b6472">국내주식 체결알림</div>
      <div style="font-size:29px;font-weight:700;line-height:1.7;margin-top:18px">
        고객님의 ${sideKo} 주문이<br/>체결되었습니다.
      </div>
      <div style="font-size:27px;font-weight:800;margin-top:26px;line-height:1.8">
        종목명 : ${symbol}<br/>
        단가 : ${price.toLocaleString('ko-KR')}원<br/>
        수량 : ${qty}주
      </div>
    </div>
  </div>`, `'Batang','Malgun Gothic',serif`);

const CASES = [
  { name: 'toss-buy', html: tossFixture, symbol: '삼성전자', side: 'buy', sideKo: '매수', price: 72400, qty: 10 },
  { name: 'toss-sell', html: tossFixture, symbol: '삼성전자', side: 'sell', sideKo: '매도', price: 75800, qty: 7 },
  { name: 'kiwoom-buy', html: kiwoomFixture, symbol: 'SK하이닉스', side: 'buy', sideKo: '매수', price: 231500, qty: 3 },
  { name: 'kiwoom-sell', html: kiwoomFixture, symbol: 'SK하이닉스', side: 'sell', sideKo: '매도', price: 228000, qty: 2 },
  { name: 'samsung-buy', html: samsungFixture, symbol: '카카오', side: 'buy', sideKo: '매수', price: 48550, qty: 20 },
  { name: 'samsung-sell', html: samsungFixture, symbol: '카카오', side: 'sell', sideKo: '매도', price: 51200, qty: 15 },
];

// ---- 3) 렌더 ----
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await browser.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
for (const c of CASES) {
  const htmlPath = join(dir, `${c.name}.html`);
  writeFileSync(htmlPath, c.html(c));
  await p.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
  c.png = join(dir, `${c.name}.png`);
  await p.screenshot({ path: c.png });
}
await browser.close();

// ---- 4) OCR (CDN 언어 데이터 — 실패 시 1회 재시도) ----
const { createWorker } = await import('tesseract.js');
async function makeWorker() {
  try {
    return await createWorker(['kor', 'eng']);
  } catch (e) {
    console.error('worker 생성 실패, 재시도:', e?.message ?? e);
    return await createWorker(['kor', 'eng']);
  }
}
const worker = await makeWorker();

// ---- 5) 비교 ----
const score = { symbol: 0, side: 0, price: 0, qty: 0 };
const rows = [];
for (const c of CASES) {
  const { data } = await worker.recognize(c.png);
  if (process.env.OCR_DEBUG) console.log(`--- ${c.name} ---\n${JSON.stringify(data.text)}`);
  const parsed = parseTradeText(data.text);
  const okSymbol = parsed.symbol === c.symbol;
  const okSide = parsed.side === c.side;
  const okPrice = parsed.price === c.price;
  const okQty = parsed.qty === c.qty;
  if (okSymbol) score.symbol++;
  if (okSide) score.side++;
  if (okPrice) score.price++;
  if (okQty) score.qty++;
  rows.push({
    case: c.name,
    'symbol(기대/인식)': `${c.symbol} / ${parsed.symbol ?? '-'} ${okSymbol ? 'O' : 'X'}`,
    'side': `${c.side} / ${parsed.side ?? '-'} ${okSide ? 'O' : 'X'}`,
    'price': `${c.price} / ${parsed.price ?? '-'} ${okPrice ? 'O' : 'X'}`,
    'qty': `${c.qty} / ${parsed.qty ?? '-'} ${okQty ? 'O' : 'X'}`,
  });
}
await worker.terminate();

console.table(rows);
console.log(`정확도 — 종목명 ${score.symbol}/6, 구분 ${score.side}/6, 단가 ${score.price}/6, 수량 ${score.qty}/6`);

const pass = score.price === 6 && score.qty === 6 && score.symbol >= 4;
console.log(pass ? 'OCR ACCURACY PASS' : 'OCR ACCURACY FAIL (기준: 단가 6/6, 수량 6/6, 종목명 ≥4/6)');
process.exit(pass ? 0 : 1);
