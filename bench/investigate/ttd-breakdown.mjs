// Where does time-to-data go? 4x CPU, no network throttle. Logs long tasks and script timings. Usage: node investigate/ttd-breakdown.mjs <port>
import { chromium } from 'playwright-core';
const port = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } }); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
await page.goto(`http://localhost:${port}/dashboard`, { waitUntil: 'networkidle' }); await page.getByTestId('kpi-total').waitFor();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.addInitScript(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); });
const t0 = Date.now();
await page.reload({ waitUntil: 'commit' });
await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="kpi-total"]')?.textContent ?? ''), null, { polling: 16 });
const ttd = Date.now() - t0;
const info = await page.evaluate(() => ({
  fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0),
  dcl: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),
  longTasks: window.__lt,
  scripts: performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js') || r.name.endsWith('.mjs')).map((r) => [r.name.split('/').pop(), Math.round(r.responseEnd), Math.round(r.encodedBodySize / 1024) + 'KB']),
}));
console.log(JSON.stringify({ ttd, ...info }, null, 1));
await browser.close();
