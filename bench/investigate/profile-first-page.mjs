// CPU-profile the first 'next page' click and print the hottest functions (self time). Usage: node investigate/profile-first-page.mjs <port>
import { chromium } from 'playwright-core';
const port = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
await page.goto(`http://localhost:${port}/tasks?seed=5000`, { waitUntil: 'networkidle' });
await page.getByTestId('task-row').first().waitFor();
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
const before = await page.getByTestId('task-row').first().innerText();
await page.getByTestId('pagination-next').click();
await page.waitForFunction((b) => document.querySelector('[data-testid="task-row"]')?.innerText !== b, before);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map();
const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} @ ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`).join('\n'));
await browser.close();
