// Heap snapshot after leaving the board; print retainer chains for a detached <li>. Usage: node investigate/retainers.mjs <port>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const port = process.argv[2]; const BASE = `http://localhost:${port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(`${BASE}/dashboard?seed=1000`, { waitUntil: 'networkidle' }); await page.getByTestId('kpi-total').waitFor(); await page.waitForTimeout(500);
await page.getByTestId('nav-board').click(); await page.locator('[data-testid="board-card"]:visible').first().waitFor(); await page.waitForTimeout(500);
await page.getByTestId('nav-dashboard').click(); await page.locator('[data-testid="chart-completed"]:visible').waitFor(); await page.waitForTimeout(1500);
await cdp.send('HeapProfiler.collectGarbage');
let chunks = []; cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
await browser.close();
const snap = JSON.parse(chunks.join('')); chunks = null;
const m = snap.snapshot.meta; const NF = m.node_fields.length, EF = m.edge_fields.length;
const nodeTypes = m.node_types[0], edgeTypes = m.edge_types[0];
const { nodes, edges, strings } = snap;
const N = nodes.length / NF;
const firstEdge = new Uint32Array(N + 1);
for (let i = 0, e = 0; i < N; i++) { firstEdge[i] = e; e += nodes[i * NF + m.node_fields.indexOf('edge_count')] * EF; firstEdge[N] = e; }
const name = (i) => strings[nodes[i * NF + 1]];
const type = (i) => nodeTypes[nodes[i * NF]];
// reverse edges
const ret = Array.from({ length: N }, () => []);
const toIdx = m.edge_fields.indexOf('to_node'), typeIdx = m.edge_fields.indexOf('type'), nameIdx = m.edge_fields.indexOf('name_or_index');
for (let i = 0; i < N; i++) for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) {
  const to = edges[e + toIdx] / NF; const et = edgeTypes[edges[e + typeIdx]];
  if (et === 'weak') continue;
  const en = (et === 'element' || et === 'hidden') ? edges[e + nameIdx] : strings[edges[e + nameIdx]];
  ret[to].push([i, et, en]);
}
const det = m.node_fields.indexOf('detachedness');
const counts = {}; const detached = [];
for (let i = 0; i < N; i++) { const nm = name(i); if (det >= 0 && nodes[i * NF + det] === 2) { counts[nm.slice(0, 40)] = (counts[nm.slice(0, 40)] || 0) + 1; if (/^<span _ngcontent/.test(nm)) detached.push(i); } }
console.log('top detached:', Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6));
console.log('detached li:', detached.length);
// BFS from one detached li toward a GC root-ish node, print shortest path
const start = detached[Math.floor(detached.length / 2)];
const prev = new Map([[start, null]]); const q = [start]; let hit = null;
while (q.length) { const n = q.shift(); if (type(n) === 'synthetic' || (name(n)||'').startsWith('Window') ) { hit = n; break; }
  for (const [r, et, en] of ret[n]) if (!prev.has(r)) { prev.set(r, [n, et, en]); q.push(r); } }
const path = []; for (let n = hit; n !== null && n !== undefined;) { const p = prev.get(n); path.push(`${type(n)}:${name(n).slice(0, 80)}${p ? `  --[${p[1]}:${String(p[2]).slice(0,40)}]-->` : ''}`); n = p ? p[0] : null; }
console.log(path.join('\n'));
