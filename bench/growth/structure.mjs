// Structural metrics for one app: file sizes, import graph (fan-in/out, cycles), Nuxt auto-import edges.
// Usage: node growth/structure.mjs <name> <app_dir> <out.json>
import fs from 'node:fs';
import path from 'node:path';

const [, , name, appDirArg, outFile] = process.argv;
const appDir = path.resolve(appDirArg);
const SKIP = new Set(['node_modules', '.nuxt', '.output', '.next', 'dist', '.angular', 'out', 'coverage', 'public', '.git', 'tests', 'test', '__tests__', 'e2e', 'build', '.gradle', '.kotlin', 'kotlin-js-store', 'generated', 'jsTest', 'commonTest', 'jvmTest']);
const EXT = ['.ts', '.tsx', '.vue', '.js', '.mjs', '.html', '.css', '.scss', '.kt'];
const isTest = (f) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(f) || /Test\.kt$/.test(f);
const isConfig = (f) => /(^|\/)[^/]*\.config\.[cm]?[jt]s$/.test(f) || /next-env\.d\.ts$/.test(f) || /\.d\.ts$/.test(f);

function* walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(path.join(d, e.name)); }
    else yield path.join(d, e.name);
  }
}
const files = [...walk(appDir)].filter((f) => EXT.includes(path.extname(f)) && !isTest(f) && !isConfig(path.relative(appDir, f)));
const rel = (f) => path.relative(appDir, f);

// non-blank, non-comment-only lines
function loc(text) {
  let n = 0, block = false;
  for (let l of text.split('\n')) {
    l = l.trim();
    if (block) { if (l.includes('*/')) block = false; continue; }
    if (l.startsWith('/*') && !l.includes('*/')) { block = true; continue; }
    if (!l || l.startsWith('//') || /^\/\*.*\*\/$/.test(l) || /^<!--.*-->$/.test(l)) continue;
    n++;
  }
  return n;
}

const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const sizes = files.map((f) => ({ file: rel(f), loc: loc(src[f]) })).sort((a, b) => b.loc - a.loc);

// ---------- import graph ----------
const codeFiles = files.filter((f) => ['.ts', '.tsx', '.vue', '.js', '.mjs', '.kt'].includes(path.extname(f)));
const aliasRoots = [path.join(appDir, 'app'), path.join(appDir, 'src'), appDir].filter((d) => fs.existsSync(d));
function resolve(from, spec) {
  let base;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else if (/^[~@]\//.test(spec)) base = path.join(aliasRoots[0], spec.slice(2));
  else if (spec.startsWith('~~/') || spec.startsWith('@@/')) base = path.join(appDir, spec.slice(3));
  else return null; // package import
  const cands = [base, ...['.ts', '.tsx', '.vue', '.js', '.mjs'].map((e) => base + e), ...['.ts', '.tsx', '.js'].map((e) => path.join(base, 'index' + e))];
  return cands.find((c) => src[c] !== undefined && codeFiles.includes(c)) ?? null;
}
const edges = new Map(codeFiles.map((f) => [f, new Set()]));
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|templateUrl\s*:\s*['"]([^'"]+)['"]/g;
for (const f of codeFiles) {
  for (const m of src[f].matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (/^import\s+type\b/.test(m[0]) || /^export\s+type\b/.test(m[0])) { /* type-only edges still couple code */ }
    const t = resolve(f, spec);
    if (t && t !== f) edges.get(f).add(t);
  }
}

// Nuxt auto-imports: components used as tags, composables/stores/utils used by name.
const autoEdges = { components: 0, functions: 0 };
const nuxtApp = path.join(appDir, 'app');
if (fs.existsSync(path.join(appDir, 'nuxt.config.ts'))) {
  const compDir = path.join(nuxtApp, 'components');
  const compNames = new Map();
  for (const f of codeFiles.filter((f) => f.startsWith(compDir + path.sep) && f.endsWith('.vue'))) {
    const parts = path.relative(compDir, f).replace(/\.vue$/, '').split(path.sep);
    const pascal = parts.map((p) => p.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase()));
    // Nuxt names nested components by path (charts/LineChart.vue -> ChartsLineChart) and drops a repeated prefix
    const deduped = pascal.reduce((acc, p) => (acc && p.startsWith(acc.split(/(?=[A-Z])/).pop()) ? acc.slice(0, acc.length - acc.split(/(?=[A-Z])/).pop().length) + p : acc + p), '');
    for (const n of new Set([pascal.join(''), deduped])) compNames.set(n, f);
  }
  const fnNames = new Map();
  for (const dir of ['composables', 'stores', 'utils']) {
    const d = path.join(nuxtApp, dir);
    for (const f of codeFiles.filter((f) => f.startsWith(d + path.sep))) {
      for (const m of src[f].matchAll(/export\s+(?:const|function|async function)\s+(\w+)/g)) fnNames.set(m[1], f);
    }
  }
  for (const f of codeFiles.filter((f) => f.endsWith('.vue') || f.endsWith('.ts'))) {
    const text = src[f];
    for (const [n, target] of compNames) {
      const kebab = n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      if (target !== f && (new RegExp(`<${n}[\\s/>]`).test(text) || new RegExp(`<${kebab}[\\s/>]`).test(text)) && !edges.get(f).has(target)) { edges.get(f).add(target); autoEdges.components++; }
    }
    for (const [n, target] of fnNames) {
      if (target !== f && new RegExp(`\\b${n}\\(`).test(text) && !edges.get(f).has(target)) { edges.get(f).add(target); autoEdges.functions++; }
    }
  }
}

// Kotlin: no file-level imports, so link a file to every other Kotlin file whose top-level declarations it uses.
const ktFiles = codeFiles.filter((f) => f.endsWith('.kt'));
const ktDecl = new Map();
for (const f of ktFiles) {
  for (const m of src[f].matchAll(/^(?:(?:public|internal|private|data|sealed|enum|abstract|open|inline|value|annotation|fun|external|@\w+(?:\([^)]*\))?)\s+)*(?:class|object|interface|fun|val|var|typealias)\s+(?:<[^>]+>\s*)?(?:[A-Za-z_][\w.]*\.)?([A-Za-z_]\w*)/gm)) {
    if (m[1].length > 2) ktDecl.set(m[1], f);
  }
}
const ktEdges = { count: 0 };
for (const f of ktFiles) {
  const text = src[f].replace(/\/\/.*$/gm, '').replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (const [n, target] of ktDecl) if (target !== f && new RegExp(`\\b${n}\\b`).test(text) && !edges.get(f).has(target)) { edges.get(f).add(target); ktEdges.count++; }
}
// TypeScript importing the compiled Kotlin module counts as one edge to the Kotlin side (rough).
const fanOut = codeFiles.map((f) => edges.get(f).size);
const fanInMap = new Map(codeFiles.map((f) => [f, 0]));
for (const s of edges.values()) for (const t of s) fanInMap.set(t, fanInMap.get(t) + 1);
const fanIn = [...fanInMap.values()];

// Tarjan SCC for cycles
let idx = 0; const stack = [], on = new Set(), index = new Map(), low = new Map(), sccs = [];
function strong(v) {
  index.set(v, idx); low.set(v, idx); idx++; stack.push(v); on.add(v);
  for (const w of edges.get(v)) {
    if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) { const c = []; let w; do { w = stack.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1) sccs.push(c.map(rel)); }
}
for (const v of codeFiles) if (!index.has(v)) strong(v);

const avg = (a) => +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const locs = sizes.map((s) => s.loc);
const edgeCount = [...edges.values()].reduce((n, s) => n + s.size, 0);
const out = {
  name,
  files: files.length,
  codeFiles: codeFiles.length,
  totalLoc: locs.reduce((a, b) => a + b, 0),
  fileLoc: { avg: avg(locs), p90: pct(locs, 0.9), max: locs[0], over300: locs.filter((l) => l > 300).length, over500: locs.filter((l) => l > 500).length },
  largestFiles: sizes.slice(0, 5),
  fileList: files.map(rel),
  imports: {
    edges: edgeCount,
    edgesPerFile: avg(fanOut),
    maxFanOut: Math.max(...fanOut), maxFanIn: Math.max(...fanIn),
    topFanOut: codeFiles.map((f) => [rel(f), edges.get(f).size]).sort((a, b) => b[1] - a[1]).slice(0, 3),
    fanInAll: Object.fromEntries(codeFiles.map((f) => [rel(f), fanInMap.get(f)])),
    topFanIn: codeFiles.map((f) => [rel(f), fanInMap.get(f)]).sort((a, b) => b[1] - a[1]).slice(0, 3),
    cycles: sccs.length, filesInCycles: sccs.reduce((n, c) => n + c.length, 0), largestCycle: Math.max(0, ...sccs.map((c) => c.length)),
    nuxtAutoImportEdges: autoEdges,
    kotlinEdges: ktEdges.count,
  },
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(name, JSON.stringify({ files: out.files, totalLoc: out.totalLoc, fileLoc: out.fileLoc, edges: edgeCount, maxFanIn: out.imports.maxFanIn, maxFanOut: out.imports.maxFanOut, cycles: out.imports.cycles, filesInCycles: out.imports.filesInCycles, auto: autoEdges }));
