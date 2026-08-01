/**
 * 실물 스크린샷 디버그: 실제 파이프라인(리사이즈 1600px → tesseract 로컬 자산 → ocrParse) 통과.
 * 사용: node scripts/ocr-real.mjs <이미지경로>
 * ⚠️ 사용자 개인 스크린샷은 저장소에 커밋하지 않는다 — 로컬 실행 전용.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const imgPath = process.argv[2] ?? 'C:/Users/limyo/Downloads/KakaoTalk_20260801_115757079.jpg';
const dir = mkdtempSync(join(tmpdir(), 'ocr-real-'));

// 파서 번들
const parserOut = join(dir, 'ocrParse.mjs');
const es = spawnSync('npx', ['esbuild', 'src/core/ocrParse.ts', '--bundle', '--format=esm', `--outfile=${parserOut}`], { shell: true });
if (es.status !== 0) { console.error(String(es.stderr)); process.exit(1); }
const { parseTradeText } = await import(pathToFileURL(parserOut).href);

// 앱과 동일한 정규화: 브라우저 canvas로 최대 1600px JPEG
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await browser.newPage();
await p.goto(pathToFileURL(resolve(imgPath)).href);
const normalized = await p.evaluate(async () => {
  const img = document.querySelector('img');
  await img.decode();
  const MAX = 2200; // src/ocr/ocr.ts OCR_MAX_DIM과 동일하게 유지
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.92);
});
await browser.close();

const { createWorker } = await import('tesseract.js');
const worker = await createWorker(['kor', 'eng'], undefined, {
  langPath: resolve('public/ocr/lang'), gzip: true, cacheMethod: 'none',
});
const { data } = await worker.recognize(normalized);
await worker.terminate();

console.log('===== 원시 OCR 텍스트 =====');
console.log(data.text);
console.log('===== 파싱 결과 =====');
console.log(JSON.stringify(parseTradeText(data.text), null, 2));
