// Count <li> element objects alive in the JS heap (incl. detached) after leaving the board. Usage: node investigate/detached.mjs <port>
import { chromium } from 'playwright-core';
const port = process.argv[2]; const BASE = `http://localhost:${port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const countLi = async () => {
  await cdp.send('HeapProfiler.collectGarbage');
  const { result: proto } = await cdp.send('Runtime.evaluate', { expression: 'HTMLElement.prototype' });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId });
  const r = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function(){let n=0,d=0;for(const e of this){try{const c=e.isConnected;n++;if(!c)d++;}catch{}}return [n,d]}', returnByValue: true });
  if (r.exceptionDetails) console.error(JSON.stringify(r.exceptionDetails).slice(0,400)); return r.result.value;
};
await page.goto(`${BASE}/dashboard?seed=5000`, { waitUntil: 'networkidle' }); await page.getByTestId('kpi-total').waitFor(); await page.waitForTimeout(500);
await page.getByTestId('nav-board').click(); await page.locator('[data-testid="board-card"]:visible').first().waitFor(); await page.waitForTimeout(500);
await page.getByTestId('nav-dashboard').click(); await page.locator('[data-testid="chart-completed"]:visible').waitFor(); await page.waitForTimeout(1500);
const [all, detached] = await countLi();
console.log(JSON.stringify({ htmlElementsInHeap: all, detached, inDocument: await page.evaluate(() => document.querySelectorAll('*').length) }));
await browser.close();
