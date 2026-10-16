// Line counts split into styling / templates / logic / tests (non-blank, non-comment lines).
// Splits .vue <style>/<template>/<script> blocks and Angular inline `styles:` / `template:` literals.
// Leaves out package.json, lockfiles, other JSON, docs, build output.
// Usage: node loc-split.mjs <name> <app_dir>
import fs from 'node:fs';
import path from 'node:path';

const [, , name, appDir] = process.argv;
const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', '.next', 'dist', '.angular', 'out', 'coverage', 'public', '.git', 'build', '.gradle', '.kotlin', 'kotlin-js-store', 'generated']);
const STYLE_EXT = new Set(['.css', '.scss', '.sass', '.less']);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.kt']);
const isTest = (f) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)(tests?|__tests__|e2e|jsTest|commonTest|jvmTest)\//.test(f) || /Test\.kt$/.test(f);
const isConfig = (f) => /(^|\/)[^/]*\.config\.[cm]?[jt]s$/.test(f) || /(^|\/)(next-env\.d\.ts)$/.test(f) || /\.kts$/.test(f);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name)); }
    else yield path.join(dir, e.name);
  }
}

// Count non-blank lines, ignoring comment-only lines (// , /* */ , <!-- -->).
function count(text) {
  let n = 0, inBlock = false, inHtml = false;
  for (let line of text.split('\n')) {
    line = line.trim();
    if (inBlock) { if (line.includes('*/')) { inBlock = false; line = line.slice(line.indexOf('*/') + 2).trim(); } else continue; }
    if (inHtml) { if (line.includes('-->')) { inHtml = false; line = line.slice(line.indexOf('-->') + 3).trim(); } else continue; }
    if (line.startsWith('/*') && !line.includes('*/')) { inBlock = true; continue; }
    if (line.startsWith('<!--') && !line.includes('-->')) { inHtml = true; continue; }
    if (!line || line.startsWith('//') || /^\/\*.*\*\/$/.test(line) || /^<!--.*-->$/.test(line)) continue;
    n++;
  }
  return n;
}

// Pull out `styles: [`...`]` / `styles: `...`` and `template: `...`` literals from Angular components.
function splitAngularInline(src) {
  let styles = '', template = '';
  const take = (re, sink) => src.replace(re, (m, body) => { sink(body); return '\n'.repeat(0); });
  src = take(/styles\s*:\s*\[?\s*`([\s\S]*?)`\s*\]?/g, (b) => { styles += b + '\n'; });
  src = take(/template\s*:\s*`([\s\S]*?)`/g, (b) => { template += b + '\n'; });
  return { styles, template, rest: src };
}

const totals = { styling: 0, templates: 0, logic: 0, tests: 0, config: 0 };
const files = { styling: [], templates: [], logic: [], tests: [], config: [] };
const add = (cat, file, n) => { if (!n) return; totals[cat] += n; files[cat].push([path.relative(appDir, file), n]); };

for (const f of walk(appDir)) {
  const rel = path.relative(appDir, f);
  const ext = path.extname(f);
  if (/\.json$|\.lockb?$|\.lock$|\.ya?ml$|\.md$/.test(f)) continue;
  if (/\.kts$/.test(f)) { add('config', f, count(fs.readFileSync(f, 'utf8'))); continue; }
  const src = fs.readFileSync(f, 'utf8');
  if (isTest(rel)) { if (CODE_EXT.has(ext) || ext === '.vue') add('tests', f, count(src)); continue; }
  if (STYLE_EXT.has(ext)) { add('styling', f, count(src)); continue; }
  if (ext === '.vue') {
    let rest = src;
    for (const [m, body] of src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) { add('styling', f, count(body)); rest = rest.replace(m, ''); }
    for (const [m, body] of rest.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) { add('logic', f, count(body)); rest = rest.replace(m, ''); }
    // <template> blocks nest (slots), so take the outermost one
    const s = rest.indexOf('<template'), e = rest.lastIndexOf('</template>');
    if (s >= 0 && e > s) add('templates', f, count(rest.slice(rest.indexOf('>', s) + 1, e)));
    continue;
  }
  if (ext === '.html') { add('templates', f, count(src)); continue; }
  if (CODE_EXT.has(ext)) {
    if (isConfig(rel)) { add('config', f, count(src)); continue; }
    const { styles, template, rest } = splitAngularInline(src);
    add('styling', f, count(styles));
    add('templates', f, count(template));
    add('logic', f, count(rest)); // for .tsx this includes JSX markup (React has no separate template layer)
  }
}

const out = { name, totals, appTotalExclTests: totals.styling + totals.templates + totals.logic, files };
fs.mkdirSync('results', { recursive: true });
fs.writeFileSync(`results/loc-split-${name}.json`, JSON.stringify(out, null, 2));
console.log(name, JSON.stringify(totals), 'app total (no tests/config):', out.appTotalExclTests);
