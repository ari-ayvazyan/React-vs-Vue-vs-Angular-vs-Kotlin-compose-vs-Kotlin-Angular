// Runtime benchmark: load metrics + interaction latency + memory, against production servers.
// Usage: node runtime.mjs <name> <port> [runs]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const [, , name, port, runsArg] = process.argv;
const RUNS = Number(runsArg ?? 5);
const BASE = `http://localhost:${port}`;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-precise-memory-info'] });

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || /hydrat/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

async function loadMetrics(path) {
  const { ctx, page, errors } = await newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  let bytes = 0, jsBytes = 0, requests = 0;
  const types = new Map();
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => { requests++; bytes += e.encodedDataLength; if (types.get(e.requestId) === 'Script') jsBytes += e.encodedDataLength; });
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
    return { ttfb: n.responseStart, fcp, lcp: window.__lcp, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null };
  });
  await ctx.close();
  return { ...m, transferKB: bytes / 1024, jsKB: jsBytes / 1024, requests, errors };
}

// Seed a dataset then measure navigations / interactions on a client-side warmed app.
async function interactions(seedN) {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${BASE}/dashboard?seed=${seedN}`, { waitUntil: 'networkidle' });
  await page.getByTestId('kpi-total').waitFor();
  await page.waitForTimeout(500);
  const out = {};
  const time = async (label, action, readyFn) => {
    const t0 = Date.now();
    await action();
    await readyFn();
    out[label] = Date.now() - t0;
  };
  await time('nav_tasks', () => page.getByTestId('nav-tasks').click(), () => page.getByTestId('task-row').first().waitFor());
  // search: debounce is 200ms, so subtract it
  const search = page.getByTestId('task-list-search');
  const firstBefore = await page.getByTestId('task-row').first().innerText();
  await time('search', () => search.fill('deploy invoice'), () => page.waitForFunction((b) => { const r = document.querySelector('[data-testid="task-row"]'); return !r || r.innerText !== b; }, firstBefore, { timeout: 10000 }));
  out.search -= 200;
  await search.fill('');
  await page.waitForTimeout(400);
  await time('paginate', () => page.getByTestId('pagination-next').click(), () => page.waitForTimeout(0).then(() => page.getByTestId('task-row').first().waitFor()));
  await time('nav_board', () => page.getByTestId('nav-board').click(), () => page.getByTestId('board-card').first().waitFor());
  out.board_cards = await page.getByTestId('board-card').count();
  await time('nav_calendar', () => page.getByTestId('nav-calendar').click(), () => page.getByTestId('calendar-grid').waitFor());
  await time('nav_dashboard', () => page.getByTestId('nav-dashboard').click(), () => page.getByTestId('chart-completed').waitFor());
  // create task via modal
  await time('create_task', async () => {
    await page.getByTestId('new-task-button').click();
    await page.getByTestId('task-title-input').fill('Benchmark task');
    await page.getByTestId('task-save-button').click();
  }, () => page.getByTestId('task-modal').waitFor({ state: 'hidden' }));
  out.heapMB = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null);
  out.errors = errors;
  await ctx.close();
  return out;
}

const result = { name, load: {}, interactions: {} };
for (const path of ['/dashboard', '/tasks', '/board']) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await loadMetrics(path));
  const keys = ['ttfb', 'fcp', 'lcp', 'dcl', 'load', 'heapMB', 'transferKB', 'jsKB', 'requests'];
  result.load[path] = Object.fromEntries(keys.map((k) => [k, +median(runs.map((r) => r[k] ?? 0)).toFixed(1)]));
  result.load[path].errors = [...new Set(runs.flatMap((r) => r.errors))];
}
for (const n of [300, 5000]) {
  const runs = [];
  for (let i = 0; i < Math.min(RUNS, 3); i++) {
    try { runs.push(await interactions(n)); } catch (e) { runs.push({ failed: String(e).slice(0, 300) }); }
  }
  const ok = runs.filter((r) => !r.failed);
  const keys = ok.length ? Object.keys(ok[0]).filter((k) => k !== 'errors') : [];
  result.interactions[n] = Object.fromEntries(keys.map((k) => [k, +median(ok.map((r) => r[k])).toFixed(1)]));
  result.interactions[n].failures = runs.filter((r) => r.failed).map((r) => r.failed);
  result.interactions[n].errors = [...new Set(ok.flatMap((r) => r.errors))].slice(0, 10);
}
await browser.close();
fs.mkdirSync('results', { recursive: true });
fs.writeFileSync(`results/runtime-${name}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
