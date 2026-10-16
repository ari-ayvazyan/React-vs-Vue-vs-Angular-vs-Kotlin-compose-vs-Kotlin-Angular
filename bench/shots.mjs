// Screenshots of every route, light & dark, desktop & mobile. Usage: node shots.mjs <name> <port>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [, , name, port] = process.argv;
const BASE = `http://localhost:${port}`;
const dir = `results/shots/${name}`; fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const scheme of ['light', 'dark']) {
  for (const [vp, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 375, height: 812 }]]) {
    const ctx = await browser.newContext({ viewport: size, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard?seed=300`, { waitUntil: 'networkidle' });
    for (const r of ['dashboard', 'tasks', 'board', 'calendar', 'projects', 'settings']) {
      await page.goto(`${BASE}/${r}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${dir}/${r}-${vp}-${scheme}.png` });
    }
    if (vp === 'desktop' && scheme === 'light') {
      await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' });
      await page.getByTestId('task-row').first().locator('a').first().click().catch(() => {});
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${dir}/detail-${vp}-${scheme}.png` });
      await page.getByTestId('new-task-button').click(); await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/modal-${vp}-${scheme}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
console.log('done', name);
