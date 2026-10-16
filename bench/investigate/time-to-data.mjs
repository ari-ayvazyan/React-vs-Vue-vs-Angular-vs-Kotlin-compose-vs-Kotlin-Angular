// Time until real data (KPI number) is visible, on throttled mobile (4x CPU, ~1.6 Mbps / 150 ms RTT). Median of 5.
// Usage: node investigate/time-to-data.mjs <port>
import { chromium } from 'playwright-core';
const port = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const res = [];
for (let i = 0; i < 5; i++) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } }); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  // warm localStorage with the 300-task demo data, then measure a cold-cache reload
  await page.goto(`http://localhost:${port}/dashboard`, { waitUntil: 'networkidle' }); await page.getByTestId('kpi-total').waitFor();
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const t0 = Date.now();
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="kpi-total"]')?.textContent ?? ''), null, { timeout: 30000, polling: 16 });
  res.push(Date.now() - t0);
  await ctx.close();
}
console.log(JSON.stringify({ dataVisibleMs: [...res].sort((a, b) => a - b)[2], runs: res }));
await browser.close();
