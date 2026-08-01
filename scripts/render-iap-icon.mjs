// IAP 상품 아이콘 1024×1024 래스터화 (render-icon.mjs 변형)
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const chromes = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
];
const chrome = chromes.find(existsSync);
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: 1024, height: 1024 });
await p.goto('file:///' + resolve('scripts/icon.html').replaceAll('\\', '/'));
await p.screenshot({ path: 'assets/iap-icon-1024.png' });
await b.close();
console.log('rendered 1024');
