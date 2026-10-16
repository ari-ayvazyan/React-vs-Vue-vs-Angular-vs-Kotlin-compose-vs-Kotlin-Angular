// Time to render the board with 5,000 tasks (median of 5) and heap on the board. Usage: node investigate/board-time.mjs <port>
import { chromium } from 'playwright-core';
const port = process.argv[2]; const BASE = `http://localhost:${port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const times = [], heaps = [];
for (let i = 0; i < 5; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await page.goto(`${BASE}/dashboard?seed=5000`, { waitUntil: 'networkidle' }); await page.getByTestId('kpi-total').waitFor(); await page.waitForTimeout(500);
  const t0 = Date.now(); await page.getByTestId('nav-board').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="board-card"]').length >= 5000);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  times.push(Date.now() - t0);
  await cdp.send('HeapProfiler.collectGarbage'); heaps.push(((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576) | 0);
  await ctx.close();
}
const med = (a) => [...a].sort((x, y) => x - y)[2];
console.log(JSON.stringify({ boardMs: med(times), heapMB: med(heaps), runs: times }));
await browser.close();
