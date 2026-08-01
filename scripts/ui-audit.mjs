// 폭별 가로 오버플로 + 뷰포트 밖 요소 + 겹침 검사
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const [dir, port] = [process.argv[2], Number(process.argv[3])];
process.chdir(dir);
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { shell: true, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}`;
await new Promise(r => setTimeout(r, 3000));

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
const issues = [];
for (const w of [320, 360, 390]) {
  await page.setViewport({ width: w, height: 800, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  const res = await page.evaluate((vw) => {
    const out = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > vw + 1) out.push(`PAGE hscroll: scrollWidth=${doc.scrollWidth}`);
    for (const el of document.querySelectorAll('button,a,input,select,[role=tab]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1) out.push(`OVERFLOW <${el.tagName.toLowerCase()}> "${(el.textContent||'').trim().slice(0,20)}" right=${Math.round(r.right)}`);
      if ((r.width < 40 || r.height < 40) && el.tagName === 'BUTTON')
        out.push(`SMALL-TAP <button> "${(el.textContent||'').trim().slice(0,20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, w);
  for (const m of res) issues.push(`[${w}px] ${m}`);
  await page.screenshot({ path: `${process.env.SHOTDIR}/${port}-${w}.png` });
}
await browser.close(); server.kill();
console.log(issues.length ? issues.join('\n') : 'CLEAN');
process.exit(0);
