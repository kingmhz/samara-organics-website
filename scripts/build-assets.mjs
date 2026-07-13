import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'assets', 'build');
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const entries = [
  ['styles.css', 'css', 'styles'],
  ['farm-tour.js', 'js', 'farm-tour'],
  ['subscription-booking.js', 'js', 'subscription-booking'],
  ['commerce.js', 'js', 'commerce'],
  ['script.js', 'js', 'app'],
  ['page.js', 'js', 'page'],
  ['tracking.js', 'js', 'tracking'],
  ['support.js', 'js', 'support'],
  ['manage-subscription.js', 'js', 'subscription-manager']
];
const built = new Map();
for (const [sourceName, loader, outputName] of entries) {
  const source = await readFile(join(root, sourceName), 'utf8');
  const result = await transform(source, { loader, minify: true, target: loader === 'js' ? 'es2020' : undefined });
  let code = loader === 'css' ? result.code.replaceAll('url(assets/', 'url(../').replaceAll('url("assets/', 'url("../').replaceAll("url('assets/", "url('../") : result.code;
  if (sourceName === 'script.js') code = code
    .replace('__FARM_TOUR_MODULE__', `/${built.get('farm-tour.js')}`)
    .replace('__SUBSCRIPTION_MODULE__', `/${built.get('subscription-booking.js')}`)
    .replace('__COMMERCE_MODULE__', `/${built.get('commerce.js')}`);
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);
  const filename = `${outputName}.${hash}.min.${loader}`;
  await writeFile(join(outputDir, filename), code);
  built.set(sourceName, `assets/build/${filename}`);
}

const pages = ['index.html', 'products.html', 'about.html', 'track.html', 'support.html', 'manage-subscription.html', 'privacy.html', 'terms.html', 'shipping-refunds.html', '404.html'];
const pageScripts = { 'index.html': 'script.js', 'products.html': 'page.js', 'about.html': 'page.js', 'track.html': 'tracking.js', 'support.html': 'support.js', 'manage-subscription.html': 'manage-subscription.js' };
for (const page of pages) {
  const path = join(root, page);
  let html = await readFile(path, 'utf8');
  html = html.replace(/(<link rel="stylesheet" href=")(?:styles\.css|assets\/build\/[^" ]+)(")/i, `$1${built.get('styles.css')}$2`);
  if (pageScripts[page]) html = html.replace(/(<script src=")(?:script\.js|page\.js|tracking\.js|support\.js|manage-subscription\.js|assets\/build\/[^" ]+)(")/i, `$1${built.get(pageScripts[page])}$2`);
  await writeFile(path, html);
}
const workerPath = join(root, 'service-worker.js');
let worker = await readFile(workerPath, 'utf8');
worker = worker.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'samara-cache-${built.get('styles.css').match(/styles\.([a-f0-9]+)/)[1]}';`);
const workerNames = { 'styles.css': 'styles', 'farm-tour.js': 'farm-tour', 'subscription-booking.js': 'subscription-booking', 'commerce.js': 'commerce', 'script.js': 'app', 'page.js': 'page', 'tracking.js': 'tracking', 'support.js': 'support', 'manage-subscription.js': 'subscription-manager' };
for (const sourceName of Object.keys(workerNames)) {
  const output = `./${built.get(sourceName)}`;
  const pattern = new RegExp(`\\./(?:${sourceName.replace('.', '\\.')}|assets/build/${workerNames[sourceName]}\\.[a-f0-9]+\\.min\\.(?:css|js))`, 'g');
  worker = worker.replace(pattern, output);
}
await writeFile(workerPath, worker);
console.log(Object.fromEntries(built));
