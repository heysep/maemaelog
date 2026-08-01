import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const [dir, port] = [process.argv[2], Number(process.argv[3])];
process.chdir(dir);
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { shell: true, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 3000));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
const audit = async (label, vw) => {
  const res = await page.evaluate((vw) => {
    const out = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push(`PAGE hscroll ${document.documentElement.scrollWidth}`);
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1 && getComputedStyle(el).overflowX !== 'hidden')
        out.push(`OVER <${el.tagName.toLowerCase()} class=${el.className && el.className.slice ? el.className.slice(0,30) : ''}> right=${Math.round(r.right)}`);
    }
    return [...new Set(out)].slice(0, 12);
  }, vw);
  if (res.length) console.log(`[${label} ${vw}px]`, res.join(' | '));
};
for (const vw of [320, 360]) {
  await page.setViewport({ width: vw, height: 800 });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));
  // 탭 전부 순회
  const tabs = await page.$$('nav.tabs button');
  let i = 0;
  for (const t of tabs) {
    const name = (await t.evaluate(e => e.textContent.trim())) || `tab${i}`;
    try { await t.click(); } catch { continue; }
    await new Promise(r => setTimeout(r, 500));
    await audit(name, vw);
    await page.screenshot({ path: `${process.env.SHOTDIR}/${port}-${vw}-${i}.png` });
    i++;
  }
}
await browser.close(); server.kill(); console.log('DONE');
