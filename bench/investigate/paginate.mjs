// Time 'next page' on the task list with 5,000 tasks, 5 runs. Usage: node investigate/paginate.mjs <port>
import { chromium } from 'playwright-core';
const port = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const page = await ctx.newPage();
await page.goto(`http://localhost:${port}/tasks?seed=5000`, { waitUntil: 'networkidle' });
await page.getByTestId('task-row').first().waitFor();
const runs = [];
for (let i = 0; i < 5; i++) {
  const before = await page.getByTestId('task-row').first().innerText();
  const t0 = Date.now();
  await page.getByTestId('pagination-next').click();
  await page.waitForFunction((b) => document.querySelector('[data-testid="task-row"]')?.innerText !== b, before);
  runs.push(Date.now() - t0);
}
console.log(JSON.stringify({ runs, url: page.url().replace(/^.*\/tasks/, '/tasks') }));
await browser.close();
