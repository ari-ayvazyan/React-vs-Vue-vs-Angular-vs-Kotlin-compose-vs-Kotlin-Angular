// Does visiting the board first make later actions slower? (hidden-but-mounted routes)
// Usage: node investigate/hidden-routes.mjs <port>
import { chromium } from 'playwright-core';
const port = process.argv[2]; const BASE = `http://localhost:${port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
async function run(visitBoard) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard?seed=5000`, { waitUntil: 'networkidle' });
  await page.getByTestId('kpi-total').waitFor(); await page.waitForTimeout(500);
  if (visitBoard) { await page.getByTestId('nav-board').click(); await page.locator('[data-testid="board-card"]:visible').first().waitFor(); await page.waitForTimeout(500); }
  await page.getByTestId('nav-dashboard').click(); await page.locator('[data-testid="chart-completed"]:visible').waitFor(); await page.waitForTimeout(500);
  const cardsInDom = await page.locator('[data-testid="board-card"]').count();
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
  const t0 = Date.now();
  await page.getByTestId('new-task-button').click();
  await page.locator('[data-testid="task-title-input"]:visible').fill('x');
  await page.locator('[data-testid="task-save-button"]:visible').click();
  await page.locator('[data-testid="task-modal"]').waitFor({ state: 'hidden' });
  const create = Date.now() - t0;
  const heap = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
  await ctx.close();
  return { visitBoard, cardsInDom, domNodes: nodes, create_ms: create, heapMB: heap };
}
for (let i = 0; i < 3; i++) for (const v of [false, true]) console.log(JSON.stringify(await run(v)));
await browser.close();
