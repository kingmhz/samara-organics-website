import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run the accessibility browser test.');

const externalBaseUrl = String(process.env.SAMARA_TEST_BASE_URL || '').replace(/\/$/, '');
const applicationPort = 9600 + Math.floor(Math.random() * 300);
const baseUrl = externalBaseUrl || `http://127.0.0.1:${applicationPort}`;
const application = externalBaseUrl ? null : spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(applicationPort), DATABASE_PATH: ':memory:' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let applicationOutput = '';
application?.stdout.on('data', chunk => { applicationOutput += chunk; });
application?.stderr.on('data', chunk => { applicationOutput += chunk; });
let applicationExit;
application?.once('exit', (code, signal) => { applicationExit = { code, signal }; });

const profile = await mkdtemp(join(tmpdir(), 'samara-chrome-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-background-networking',
  '--disable-breakpad',
  '--disable-crash-reporter',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--no-sandbox',
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });
let chromeOutput = '';
chrome.stdout.on('data', chunk => { chromeOutput += chunk; });
chrome.stderr.on('data', chunk => { chromeOutput += chunk; });
let chromeExit;
chrome.once('exit', (code, signal) => { chromeExit = { code, signal }; });

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitForChrome() {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (chromeExit) throw new Error(`Chrome exited before DevTools became ready (${JSON.stringify(chromeExit)}).\n${chromeOutput}`);
    const match = chromeOutput.match(/DevTools listening on ws:\/\/(?:127\.0\.0\.1|\[::1\]):(\d+)\//);
    if (match) {
      const debuggingPort = Number(match[1]);
      try {
        const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
        if (response.ok) return debuggingPort;
      } catch { /* DevTools printed its address before accepting requests. */ }
    }
    await delay(100);
  }
  throw new Error(`Chrome DevTools did not become ready.\n${chromeOutput}`);
}

async function waitForApplication() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (applicationExit) throw new Error(`Application exited before readiness (${JSON.stringify(applicationExit)}).\n${applicationOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/ready`);
      if (response.ok) return;
    } catch { /* Application is starting. */ }
    await delay(100);
  }
  throw new Error(`Application did not become ready.\n${applicationOutput}`);
}

let socket;
try {
  await waitForApplication();
  const debuggingPort = await waitForChrome();
  const target = await (await fetch(`http://127.0.0.1:${debuggingPort}/json/new?${baseUrl}/`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  const browserErrors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text || 'Uncaught browser exception');
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => (await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };
  const key = async (keyName, modifiers = 0) => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName, modifiers });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, modifiers });
  };
  const assertHeaderDoesNotOverlap = async width => {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    const collisions = await evaluate('(() => { const children = [...document.querySelector("header").children].filter(element => { const style = getComputedStyle(element); return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().width > 0; }); const boxes = children.map(element => ({ name: element.className || element.tagName, box: element.getBoundingClientRect() })); const collisions = []; for (let a = 0; a < boxes.length; a += 1) for (let b = a + 1; b < boxes.length; b += 1) { const x = Math.min(boxes[a].box.right, boxes[b].box.right) - Math.max(boxes[a].box.left, boxes[b].box.left); const y = Math.min(boxes[a].box.bottom, boxes[b].box.bottom) - Math.max(boxes[a].box.top, boxes[b].box.top); if (x > 2 && y > 2) collisions.push(`${boxes[a].name} overlaps ${boxes[b].name}`); } return collisions; })()');
    assert.deepEqual(collisions, [], `Header controls overlap at ${width}px: ${collisions.join(', ')}`);
  };

  await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor('document.readyState === "complete" && Boolean(window.SamaraModal)');

  await evaluate('document.querySelector("#subscribe-header-btn").focus(); document.querySelector("#subscribe-header-btn").click(); true');
  try {
    await waitFor('document.querySelector("#subscribe-modal").classList.contains("open") && document.activeElement.id === "subscribe-modal-close"');
  } catch (error) {
    const state = await evaluate('(() => { const modal = document.querySelector("#subscribe-modal"), close = document.querySelector("#subscribe-modal-close"); const before = document.activeElement?.id || document.activeElement?.tagName; close.focus(); return { modalOpen: modal.classList.contains("open"), modalInert: modal.inert, modalParent: modal.parentElement?.tagName, modalParentInert: modal.parentElement?.inert, headerInert: document.querySelector("header").inert, activeBeforeManualFocus: before, activeAfterManualFocus: document.activeElement?.id || document.activeElement?.tagName, closeOffsetParent: Boolean(close.offsetParent), modalDisplay: getComputedStyle(modal).display, modalVisibility: getComputedStyle(modal).visibility, managerUsesTimeout: window.SamaraModal.open.toString().includes("setTimeout"), buttonDisabled: document.querySelector("#subscribe-header-btn").disabled }; })()');
    throw new Error(`${error.message}\nSubscription dialog state: ${JSON.stringify(state)}\nBrowser errors: ${browserErrors.join('; ')}`);
  }
  assert.equal(await evaluate('document.querySelector("header").inert && !document.querySelector("#subscribe-modal").inert'), true);
  const calendarSemantics = await evaluate('(() => { const cells = [...document.querySelectorAll("#sub-calendar-grid button.day-active")]; return { cells: cells.length, tabbable: cells.filter(cell => cell.tabIndex === 0).length, pressed: cells.every(cell => ["true", "false"].includes(cell.getAttribute("aria-pressed"))), labels: cells.every(cell => /selected/.test(cell.getAttribute("aria-label") || "")) }; })()');
  assert.ok(calendarSemantics.cells > 0, 'Subscription calendar must render interactive date buttons.');
  assert.deepEqual({ tabbable: calendarSemantics.tabbable, pressed: calendarSemantics.pressed, labels: calendarSemantics.labels }, { tabbable: 1, pressed: true, labels: true }, 'Subscription calendar must use roving focus and announced selection states.');
  const calendarDateBeforeArrow = await evaluate('(() => { const target = [...document.querySelectorAll("#sub-calendar-grid button.day-active")].find(cell => cell.tabIndex === 0); target?.focus(); return document.activeElement?.dataset?.date || null; })()');
  assert.ok(calendarDateBeforeArrow, 'The calendar roving-tabindex cell must receive keyboard focus.');
  await key('ArrowRight');
  await waitFor(`document.activeElement?.dataset?.date && document.activeElement.dataset.date !== ${JSON.stringify(calendarDateBeforeArrow)}`);
  const calendarDateAfterArrow = await evaluate('document.activeElement.dataset.date');
  assert.notEqual(calendarDateAfterArrow, calendarDateBeforeArrow, 'ArrowRight must move calendar focus to the next available date.');
  await command('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: false });
  await delay(100);
  const compactCalendar = await evaluate('(() => { const wrapper = document.querySelector(".calendar-wrapper"), grid = document.querySelector("#sub-calendar-grid"); const escaped = [...grid.children].some(cell => { const cellBox = cell.getBoundingClientRect(), gridBox = grid.getBoundingClientRect(); return cellBox.left < gridBox.left - 1 || cellBox.right > gridBox.right + 1; }); return { overflow: wrapper.scrollWidth > wrapper.clientWidth + 1, escaped }; })()');
  assert.deepEqual(compactCalendar, { overflow: false, escaped: false }, 'Subscription calendar cells must not overlap or overflow at 320px.');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await key('Tab', 8);
  assert.equal(await evaluate('document.querySelector("#subscribe-modal").contains(document.activeElement)'), true, 'Shift+Tab must remain inside the subscription dialog.');
  await key('Escape');
  await waitFor('document.querySelector("#subscribe-modal").inert && document.activeElement.id === "subscribe-header-btn"');

  await evaluate('document.querySelector("#tour-header-btn").focus(); document.querySelector("#tour-header-btn").click(); true');
  try {
    await waitFor('document.querySelector("#tour-modal").classList.contains("open") && document.activeElement.id === "tour-modal-close"');
  } catch (error) {
    const state = await evaluate('({ modalOpen: document.querySelector("#tour-modal").classList.contains("open"), modalInert: document.querySelector("#tour-modal").inert, headerInert: document.querySelector("header").inert, activeElement: document.activeElement?.id || document.activeElement?.tagName })');
    throw new Error(`${error.message}\nFarm-tour dialog state: ${JSON.stringify(state)}\nBrowser errors: ${browserErrors.join('; ')}`);
  }
  await key('Escape');
  await waitFor('document.querySelector("#tour-modal").inert && document.activeElement.id === "tour-header-btn"');

  await evaluate('document.querySelector(".enquiry-fab").focus(); document.querySelector(".enquiry-fab").click(); true');
  await waitFor('document.querySelector(".drawer").classList.contains("open") && document.activeElement.classList.contains("drawer-close")');
  assert.equal(await evaluate('document.querySelector("header").inert'), true);
  await key('Escape');
  await waitFor('document.querySelector(".drawer").inert && !document.querySelector("header").inert');

  await evaluate('[...document.querySelectorAll(".product-action")].forEach(button => button.click()); true');
  await waitFor('document.querySelectorAll(".drawer-item").length === 3 && document.querySelector(".drawer").classList.contains("open")');
  for (const width of [390, 320]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 720, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    const cartLayout = await evaluate('(() => { const drawer = document.querySelector(".drawer"); const rows = [...document.querySelectorAll(".drawer-item")]; const escaped = rows.flatMap(row => { const box = row.getBoundingClientRect(); return [...row.children].filter(child => { const childBox = child.getBoundingClientRect(); return childBox.left < box.left - 1 || childBox.right > box.right + 1; }).map(child => child.className); }); return { escaped, horizontal: drawer.scrollWidth > drawer.clientWidth + 1, itemScroll: document.querySelector(".drawer-items").scrollHeight >= document.querySelector(".drawer-items").clientHeight }; })()');
    assert.deepEqual(cartLayout.escaped, [], `Basket controls must remain inside their rows at ${width}px.`);
    assert.equal(cartLayout.horizontal, false, `Basket drawer must not overflow horizontally at ${width}px.`);
    assert.equal(cartLayout.itemScroll, true, 'Basket items must retain an independent scroll region.');
  }
  await evaluate('document.querySelector(".drawer-close").click(); true');
  await waitFor('document.querySelector(".drawer").inert');
  await evaluate('document.querySelector(".back-to-top").classList.add("visible"); true');
  const floatingCollisions = await evaluate('(() => { const controls = [...document.querySelectorAll(".enquiry-fab,.whatsapp-fab,.back-to-top")].map(element => ({ name: element.className, box: element.getBoundingClientRect() })); const collisions = []; for (let a = 0; a < controls.length; a += 1) for (let b = a + 1; b < controls.length; b += 1) { const x = Math.min(controls[a].box.right, controls[b].box.right) - Math.max(controls[a].box.left, controls[b].box.left); const y = Math.min(controls[a].box.bottom, controls[b].box.bottom) - Math.max(controls[a].box.top, controls[b].box.top); if (x > 1 && y > 1) collisions.push(`${controls[a].name} overlaps ${controls[b].name}`); } return collisions; })()');
  assert.deepEqual(floatingCollisions, [], `Floating action controls overlap at 320px: ${floatingCollisions.join(', ')}`);
  await evaluate('document.querySelector(".back-to-top").classList.remove("visible"); true');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  for (const width of [1440, 1024, 768, 390]) await assertHeaderDoesNotOverlap(width);
  await evaluate('document.querySelector(".menu").click(); true');
  await waitFor('document.querySelector("header").classList.contains("open") && document.activeElement === document.querySelector("header nav a")');
  const openMobileNavigation = await evaluate('({ expanded: document.querySelector(".menu").getAttribute("aria-expanded"), label: document.querySelector(".menu").getAttribute("aria-label"), scrollLocked: document.documentElement.classList.contains("nav-open"), controls: document.querySelector(".menu").getAttribute("aria-controls") === document.querySelector("header nav").id })');
  assert.deepEqual(openMobileNavigation, { expanded: 'true', label: 'Close navigation', scrollLocked: true, controls: true }, 'Mobile navigation must expose its state, relationship and background lock.');
  await key('Escape');
  await waitFor('!document.querySelector("header").classList.contains("open") && document.activeElement === document.querySelector(".menu")');
  assert.equal(await evaluate('document.querySelector(".menu").getAttribute("aria-expanded") === "false" && !document.documentElement.classList.contains("nav-open")'), true, 'Escape must close mobile navigation, unlock scrolling and restore menu focus.');
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  await command('Page.navigate', { url: `${baseUrl}/about.html#promise` });
  await waitFor('document.readyState === "complete" && !document.body.classList.contains("loading") && Boolean(document.querySelector("#story")) && Boolean(document.querySelector("#promise"))');
  await delay(220);
  const promiseLanding = await evaluate('(() => { const target = document.querySelector("#promise"); const headerHeight = document.querySelector("header").getBoundingClientRect().height; return { targetTop: target.getBoundingClientRect().top, headerHeight, hash: location.hash, storyHref: document.querySelector(`header a[href="about.html#story"]`)?.getAttribute("href"), promiseHref: document.querySelector(`header a[href="about.html#promise"]`)?.getAttribute("href") }; })()');
  assert.equal(promiseLanding.hash, '#promise', 'Our promise must update the combined page URL to its promise section.');
  assert.ok(promiseLanding.targetTop >= promiseLanding.headerHeight - 2 && promiseLanding.targetTop <= promiseLanding.headerHeight + 30, `Our promise must align below the fixed header, received top=${promiseLanding.targetTop} header=${promiseLanding.headerHeight}.`);
  assert.deepEqual([promiseLanding.storyHref, promiseLanding.promiseHref], ['about.html#story', 'about.html#promise'], 'Story and Promise must remain destinations on the same page.');
  assert.equal(await evaluate('document.querySelector(`header a[href="about.html#promise"]`).getAttribute("aria-current")'), 'location', 'The combined page header must announce Our promise as the current scrolling location.');

  await command('Page.navigate', { url: `${baseUrl}/products.html#ghee` });
  await waitFor('document.readyState === "complete" && !document.body.classList.contains("loading") && Boolean(document.querySelector("#ghee")) && [...document.querySelectorAll(".detail-commerce")].every(panel => panel.dataset.catalogState !== "loading")');
  await delay(250);
  const collectionComposition = await evaluate('(() => { const scene = document.querySelector(".heritage-collection").getBoundingClientRect(); const frames = [...document.querySelectorAll(".heritage-collection .pack-frame")].map(frame => { const box = frame.getBoundingClientRect(); return { ratio: box.width / box.height, escaped: box.left < scene.left - 2 || box.right > scene.right + 2 }; }); return { count: frames.length, ratios: frames.map(frame => frame.ratio), escaped: frames.some(frame => frame.escaped), podium: Boolean(document.querySelector(".collection-podium")), orbits: document.querySelectorAll(".collection-orbit").length }; })()');
  assert.equal(collectionComposition.count, 3, 'The collection hero must show all three product portraits.');
  assert.equal(collectionComposition.escaped, false, 'Collection portraits must remain inside their visual stage.');
  assert.ok(collectionComposition.ratios.every(ratio => ratio > .85 && ratio < 1.15), `Collection portraits must remain complete square compositions, received ratios ${collectionComposition.ratios.join(', ')}.`);
  assert.deepEqual([collectionComposition.podium, collectionComposition.orbits], [true, 2], 'The premium collection podium and both orbit layers must render.');
  const productScroll = await evaluate('(() => { const section = document.querySelector("#ghee"); const headerHeight = document.querySelector("header").getBoundingClientRect().height; const top = section.getBoundingClientRect().top; scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }); return { top, headerHeight, pageScrollable: document.documentElement.scrollHeight > innerHeight + 500, reachedBottom: Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 2 }; })()');
  assert.equal(productScroll.pageScrollable, true, 'The full product catalogue must remain vertically scrollable.');
  assert.equal(productScroll.reachedBottom, true, 'Customers must be able to reach the bottom of the product catalogue.');
  assert.ok(productScroll.top >= productScroll.headerHeight - 2 && productScroll.top <= productScroll.headerHeight + 28, `The linked product must align below the fixed header, received top=${productScroll.top} header=${productScroll.headerHeight}.`);
  const liveCataloguePanel = await evaluate('(() => { const panel = document.querySelector("#ghee .detail-commerce"); return { state: panel.dataset.catalogState, price: panel.querySelector("[data-live-price]").textContent, status: panel.querySelector("[data-live-stock]").textContent.trim(), disabled: document.querySelector("#ghee .detail-cart-cta").getAttribute("aria-disabled") }; })()');
  assert.equal(liveCataloguePanel.state, 'available', 'The full product page must render the live active catalogue state.');
  assert.match(liveCataloguePanel.price, /₹[\d,]+ \/ 500 ML/, 'The live ghee price and unit must be visible before ordering.');
  assert.match(liveCataloguePanel.status, /AVAILABLE TO ORDER/, 'The live ordering status must be explicit.');
  assert.equal(liveCataloguePanel.disabled, 'false', 'An active product basket action must remain enabled.');
  for (const width of [768, 390]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    const catalogueOverflow = await evaluate('(() => { const panels = [...document.querySelectorAll(".detail-commerce")]; const collisions = panels.flatMap(panel => { const children = [...panel.children].filter(child => child.getBoundingClientRect().width > 0); if (children.length < 2) return []; const a = children[0].getBoundingClientRect(), b = children[1].getBoundingClientRect(); const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left); const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return overlapX > 2 && overlapY > 2 ? [panel.closest(".product-detail").id] : []; }); return { horizontal: document.documentElement.scrollWidth > innerWidth + 1, collisions }; })()');
    assert.equal(catalogueOverflow.horizontal, false, `Live product panels must not create horizontal overflow at ${width}px.`);
    assert.deepEqual(catalogueOverflow.collisions, [], `Live price and status must not overlap at ${width}px.`);
    const compactCollection = await evaluate('(() => { const scene = document.querySelector(".heritage-collection").getBoundingClientRect(); const frames = [...document.querySelectorAll(".heritage-collection .pack-frame")].map(frame => frame.getBoundingClientRect()); return { escaped: frames.some(box => box.left < scene.left - 2 || box.right > scene.right + 2), square: frames.every(box => box.width / box.height > .84 && box.width / box.height < 1.16) }; })()');
    assert.equal(compactCollection.escaped, false, `Collection portraits must remain inside the stage at ${width}px.`);
    assert.equal(compactCollection.square, true, `Collection portraits must avoid tall cropped strips at ${width}px.`);
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(120);
  const catalogueHeader = await evaluate('({ links: [...document.querySelectorAll("header nav a")].map(link => link.textContent.trim()), duplicateHome: Boolean(document.querySelector("header .inner-back")), utilities: [".nav-subscribe-btn", ".nav-tour-btn", ".nav-cart-btn"].every(selector => Boolean(document.querySelector(`header ${selector}`))), progress: Number.parseFloat(getComputedStyle(document.querySelector("header")).getPropertyValue("--catalogue-progress")) })');
  assert.deepEqual(catalogueHeader.links, ['Products', 'Our story', 'Our promise', 'Contact'], 'Secondary pages must use the same navigation order as the homepage.');
  assert.equal(catalogueHeader.duplicateHome, false, 'The Products header must not add a duplicate HOME button.');
  assert.equal(catalogueHeader.utilities, true, 'The Products header must retain Subscribe, Farm Tour and cart utilities.');
  assert.ok(catalogueHeader.progress > 0.5, 'The catalogue progress indicator must reflect page scrolling.');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".heritage-collection .collection-pack")).animationName === "heritagePackReveal" && getComputedStyle(document.querySelector(".pack-frame")).animationName === "collectionPackFloat" && getComputedStyle(document.querySelector(".detail-art"), "::after").display !== "none"'), true, 'Premium pack reveal, floating podium and product-lighting treatments must be active.');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".heritage-collection .collection-pack")).animationName === "none" && getComputedStyle(document.querySelector(".pack-frame")).animationName === "none" && getComputedStyle(document.querySelector(".detail-art"), "::after").display === "none"'), true, 'Premium motion must disable itself when reduced motion is requested.');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  const productHandoff = await evaluate('({ href: document.querySelector("#ghee .detail-cart-cta")?.getAttribute("href"), questionLink: Boolean(document.querySelector("#ghee .detail-enquire[target=_blank]")) })');
  assert.equal(productHandoff.href, 'index.html?add=Bilona%20Desi%20Ghee', 'The full ghee page must offer a direct basket handoff.');
  assert.equal(productHandoff.questionLink, true, 'The direct basket action must retain a separate product-question route.');

  await evaluate('localStorage.removeItem("samara-cart"); true');
  await command('Page.navigate', { url: `${baseUrl}/index.html?add=Traditional%20Dahi` });
  await waitFor('document.readyState === "complete" && !document.body.classList.contains("loading") && document.querySelector(".drawer")?.classList.contains("open")');
  const addedProduct = await evaluate('(() => { const cart = JSON.parse(localStorage.getItem("samara-cart") || "{}"); return { cleanUrl: location.search === "", quantity: cart["Traditional Dahi"]?.qty, drawerText: document.querySelector(".drawer-items")?.textContent || "", termsSize: parseFloat(getComputedStyle(document.querySelector("#checkout-terms")).fontSize) }; })()');
  assert.equal(addedProduct.cleanUrl, true, 'The product handoff must clean its temporary query parameter.');
  assert.equal(addedProduct.quantity, 1, 'The product handoff must add exactly one item through the live cart flow.');
  assert.match(addedProduct.drawerText, /Traditional Dahi/, 'The basket must show the requested product.');
  assert.ok(addedProduct.termsSize >= 11, `Checkout policy text must remain readable, received ${addedProduct.termsSize}px.`);

  await command('Page.navigate', { url: `${baseUrl}/index.html?open=subscribe` });
  await waitFor('document.readyState === "complete" && !document.body.classList.contains("loading") && document.querySelector("#subscribe-modal")?.classList.contains("open")');
  assert.equal(await evaluate('location.search === "" && document.querySelector("#subscribe-modal").getAttribute("aria-hidden") === "false"'), true, 'Secondary-page utility handoff must open the requested panel and clean the URL.');

  await command('Page.navigate', { url: `${baseUrl}/track.html` });
  await waitFor('document.readyState === "complete" && !document.body.classList.contains("loading")');
  const trackingTextSizes = await evaluate('[document.querySelector(".tracking-intro label"), document.querySelector(".tracking-intro button")].map(element => parseFloat(getComputedStyle(element).fontSize))');
  assert.ok(trackingTextSizes.every(size => size >= 10), `Tracking controls must not use 6–8px text, received ${trackingTextSizes.join(", ")}px.`);

  const customerPages = [
    '/',
    '/about.html',
    '/products.html',
    '/track.html',
    '/manage-subscription.html',
    '/support.html',
    '/privacy.html',
    '/terms.html',
    '/shipping-refunds.html',
    '/404.html'
  ];
  for (const path of customerPages) {
    await command('Page.navigate', { url: `${baseUrl}${path}` });
    await waitFor('document.readyState === "complete" && !document.body.classList.contains("loading")');
    for (const width of [640, 390, 320]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await delay(100);
      const layout = await evaluate(`(() => {
        const visible = element => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
        };
        const viewportEscapes = [...document.querySelectorAll('main input, main select, main textarea, main button, main a, main h1, main h2, main h3, main p, footer a')]
          .filter(visible)
          .filter(element => {
            const box = element.getBoundingClientRect();
            return box.left < -1 || box.right > innerWidth + 1;
          })
          .map(element => ({ tag: element.tagName, id: element.id, className: element.className, text: (element.textContent || element.value || '').trim().slice(0, 45) }));
        const unwrappedControls = [...document.querySelectorAll('main input, main select, main textarea, main button')]
          .filter(visible)
          .filter(element => element.scrollWidth > element.clientWidth + 2)
          .map(element => ({ tag: element.tagName, id: element.id, className: element.className, text: (element.textContent || element.value || '').trim().slice(0, 45) }));
        return {
          documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          scrollWidth: document.documentElement.scrollWidth,
          overflowSources: [...document.querySelectorAll('body *')]
            .filter(visible)
            .filter(element => {
              const box = element.getBoundingClientRect();
              return box.left < -1 || box.right > innerWidth + 1;
            })
            .slice(0, 12)
            .map(element => ({ tag: element.tagName, id: element.id, className: element.className, box: (() => { const rect = element.getBoundingClientRect(); return [Math.round(rect.left), Math.round(rect.right), Math.round(rect.width)]; })() })),
          viewportEscapes,
          unwrappedControls
        };
      })()`);
      assert.equal(layout.documentOverflow, false, `${path} must not create horizontal page overflow at ${width}px: scrollWidth=${layout.scrollWidth}, sources=${JSON.stringify(layout.overflowSources)}`);
      assert.deepEqual(layout.viewportEscapes, [], `${path} content must remain inside the viewport at ${width}px: ${JSON.stringify(layout.viewportEscapes)}`);
      assert.deepEqual(layout.unwrappedControls, [], `${path} controls must not clip their labels at ${width}px: ${JSON.stringify(layout.unwrappedControls)}`);
    }
  }

  assert.deepEqual(browserErrors, [], browserErrors.join('\n'));
  console.log('Real-browser header continuity, modal, product navigation and scrolling tests passed.');
} finally {
  socket?.close();
  chrome.kill();
  application?.kill('SIGTERM');
  await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), delay(2000)]);
  if (application) await Promise.race([new Promise(resolve => application.once('exit', resolve)), delay(3000)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }).catch(error => {
    console.warn(`Temporary Chrome profile cleanup was deferred: ${error.code || error.message}`);
  });
}
