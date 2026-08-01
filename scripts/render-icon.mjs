import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

mkdirSync('assets', { recursive: true });
const url = pathToFileURL(resolve('scripts/icon.html')).href;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 600, height: 600 });
await page.goto(url, { waitUntil: 'networkidle0' });
await page.screenshot({ path: 'assets/icon-600.png' });
await page.goto(url + '?dark=1', { waitUntil: 'networkidle0' });
await page.screenshot({ path: 'assets/icon-600-dark.png' });
await browser.close();
console.log('icons rendered');
