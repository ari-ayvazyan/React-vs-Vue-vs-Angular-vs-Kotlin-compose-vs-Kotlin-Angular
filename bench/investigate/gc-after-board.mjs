// Heap after leaving the board, before and after a forced GC. Usage: node investigate/gc-after-board.mjs <port>
import { chromium } from 'playwright-core';
const port = process.argv[2]; const BASE = `http://localhost:${port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576 | 0; };
await page.goto(`${BASE}/dashboard?seed=5000`, { waitUntil: 'networkidle' }); await page.getByTestId('kpi-total').waitFor(); await page.waitForTimeout(500);
const base = await heap();
await page.getByTestId('nav-board').click(); await page.locator('[data-testid="board-card"]:visible').first().waitFor(); await page.waitForTimeout(500);
const onBoard = await heap();
await page.getByTestId('nav-dashboard').click(); await page.locator('[data-testid="chart-completed"]:visible').waitFor(); await page.waitForTimeout(1000);
const after = await heap();
console.log(JSON.stringify({ dashboardMB: base, onBoardMB: onBoard, backOnDashboardAfterGcMB: after }));
await browser.close();
