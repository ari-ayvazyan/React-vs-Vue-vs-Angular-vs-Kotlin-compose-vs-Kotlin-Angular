// What does the page show with JavaScript disabled (= the server HTML)? Usage: node investigate/ssr-text.mjs <port>
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } }); const page = await ctx.newPage();
await page.goto(`http://localhost:${process.argv[2]}/dashboard`);
const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').trim();
await page.screenshot({ path: `investigate/ssr-${process.argv[2]}.png` });
console.log(JSON.stringify({ visibleTextChars: text.length, sample: text.slice(0, 160) }));
await browser.close();
