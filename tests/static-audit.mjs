import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';

const root = process.cwd();
const htmlFiles = (await readdir(root)).filter(name => extname(name) === '.html');
const failures = [];
const exists = async path => { try { return (await stat(path)).isFile(); } catch { return false; } };
const localTarget = (from, target) => {
  const clean = target.split(/[?#]/, 1)[0];
  if (!clean || clean === '/' || /^(?:https?:|mailto:|tel:|data:|javascript:|#|%23)/i.test(target)) return clean === '/' ? join(root, 'index.html') : null;
  const decoded = decodeURIComponent(clean);
  const path = decoded.startsWith('/') ? resolve(root, `.${decoded}`) : resolve(dirname(from), decoded);
  return path.startsWith(root) ? normalize(path) : null;
};

for (const name of htmlFiles) {
  const path = join(root, name);
  const html = await readFile(path, 'utf8');
  if (/fonts\.(?:googleapis|gstatic)\.com/i.test(html)) failures.push(`${name}: third-party font request must be self-hosted`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) failures.push(`${name}: duplicate IDs: ${duplicates.join(', ')}`);

  for (const match of html.matchAll(/<(?:a|link|script|img|source)\b[^>]*?\b(?:href|src)="([^"]+)"[^>]*>/gi)) {
    const target = localTarget(path, match[1]);
    if (target && !(await exists(target))) failures.push(`${name}: missing local reference ${match[1]}`);
  }
  for (const style of html.matchAll(/\bstyle="([^"]*)"/gi)) for (const match of style[1].matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
    const target = localTarget(path, match[1]);
    if (target && !(await exists(target))) failures.push(`${name}: missing inline image ${match[1]}`);
  }
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) if (!/\balt="[^"]*"/i.test(match[0])) failures.push(`${name}: image missing alt text`);
  for (const match of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)) if (!/\brel="[^"]*noopener[^"]*"/i.test(match[0])) failures.push(`${name}: target=_blank link missing rel=noopener`);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=/i.test(match[1]) || /type="application\/ld\+json"/i.test(match[1]) || !match[2].trim()) continue;
    try { new Function(match[2]); } catch (error) { failures.push(`${name}: invalid inline script: ${error.message}`); }
  }
  for (const match of html.matchAll(/<(?:aside|div)\b[^>]*aria-hidden="true"[^>]*>/gi)) {
    if (/\bclass="[^"]*drawer[^"]*"/i.test(match[0]) && !/\binert(?:\s|>|=)/i.test(match[0])) failures.push(`${name}: closed drawer must be inert`);
    if (/\bclass="[^"]*page-modal[^"]*"/i.test(match[0]) && !/\binert(?:\s|>|=)/i.test(match[0])) failures.push(`${name}: closed modal must be inert`);
  }

  if (name !== 'admin.html') {
    for (const match of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gi)) {
      if (!/^assets\/build\/styles\.[a-f0-9]{10}\.min\.css$/.test(match[1]) && !/^https:\/\/fonts\.googleapis\.com\//.test(match[1])) failures.push(`${name}: non-fingerprinted stylesheet ${match[1]}`);
    }
    for (const match of html.matchAll(/<script\b[^>]*src="([^"]+)"/gi)) if (!/^assets\/build\/[a-z-]+\.[a-f0-9]{10}\.min\.js$/.test(match[1])) failures.push(`${name}: non-fingerprinted script ${match[1]}`);
  }
}

const homeHtml = await readFile(join(root, 'index.html'), 'utf8');
assert.match(homeHtml, /window\.SamaraModal\s*=\s*modalFocus/, 'Home page must expose the shared accessible modal lifecycle to lazy dialogs.');
assert.match(homeHtml, /event\.key\s*===\s*'Escape'/, 'Modal lifecycle must support Escape-to-close.');
assert.match(homeHtml, /isolateBackground/, 'Open dialogs must isolate background content from keyboard and assistive technology.');
const commerceSource = await readFile(join(root, 'commerce.js'), 'utf8');
assert.match(commerceSource, /drawerReturnFocus/, 'Cart drawer must retain its opening control for focus restoration.');
assert.match(commerceSource, /transitionend[\s\S]*restoreFocus/, 'Cart drawer must restore opener focus after its closing transition.');

for (const cssName of ['styles.css', ...(await readdir(join(root, 'assets', 'build'))).filter(name => name.endsWith('.css')).map(name => join('assets', 'build', name))]) {
  const path = join(root, cssName);
  const css = await readFile(path, 'utf8');
  for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
    const target = localTarget(path, match[1]);
    if (target && !(await exists(target))) failures.push(`${cssName}: missing CSS asset ${match[1]}`);
  }
}

const worker = await readFile(join(root, 'service-worker.js'), 'utf8');
for (const match of worker.matchAll(/'\.\/([^']+)'/g)) {
  const target = localTarget(join(root, 'service-worker.js'), match[1]);
  if (target && !(await exists(target))) failures.push(`service-worker.js: missing precache asset ${match[1]}`);
}
assert.doesNotMatch(worker, /'\.\/(?:track|support|manage-subscription|admin)\.html'/, 'Private portal shell must not be precached.');
const sourcePngs = (await readdir(join(root, 'assets'))).filter(name => name.toLowerCase().endsWith('.png'));
assert.deepEqual(sourcePngs, [], `Unused source PNG files must not ship from assets/: ${sourcePngs.join(', ')}`);
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`Static site audit passed for ${htmlFiles.length} HTML files.`);
