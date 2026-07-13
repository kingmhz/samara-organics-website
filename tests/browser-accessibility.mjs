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

const port = 9300 + Math.floor(Math.random() * 300);
const profile = await mkdtemp(join(tmpdir(), 'samara-chrome-'));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitForChrome() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch { /* Chrome is starting. */ }
    await delay(100);
  }
  throw new Error('Chrome DevTools did not become ready.');
}

let socket;
try {
  await waitForChrome();
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:4173/`, { method: 'PUT' })).json();
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

  await command('Runtime.enable');
  await waitFor('document.readyState === "complete" && Boolean(window.SamaraModal)');

  await evaluate('document.querySelector("#subscribe-header-btn").focus(); document.querySelector("#subscribe-header-btn").click(); true');
  try {
    await waitFor('document.querySelector("#subscribe-modal").classList.contains("open") && document.activeElement.id === "subscribe-modal-close"');
  } catch (error) {
    const state = await evaluate('(() => { const modal = document.querySelector("#subscribe-modal"), close = document.querySelector("#subscribe-modal-close"); const before = document.activeElement?.id || document.activeElement?.tagName; close.focus(); return { modalOpen: modal.classList.contains("open"), modalInert: modal.inert, modalParent: modal.parentElement?.tagName, modalParentInert: modal.parentElement?.inert, headerInert: document.querySelector("header").inert, activeBeforeManualFocus: before, activeAfterManualFocus: document.activeElement?.id || document.activeElement?.tagName, closeOffsetParent: Boolean(close.offsetParent), modalDisplay: getComputedStyle(modal).display, modalVisibility: getComputedStyle(modal).visibility, managerUsesTimeout: window.SamaraModal.open.toString().includes("setTimeout"), buttonDisabled: document.querySelector("#subscribe-header-btn").disabled }; })()');
    throw new Error(`${error.message}\nSubscription dialog state: ${JSON.stringify(state)}\nBrowser errors: ${browserErrors.join('; ')}`);
  }
  assert.equal(await evaluate('document.querySelector("header").inert && !document.querySelector("#subscribe-modal").inert'), true);
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

  assert.deepEqual(browserErrors, [], browserErrors.join('\n'));
  console.log('Real-browser modal keyboard accessibility tests passed.');
} finally {
  socket?.close();
  chrome.kill();
  await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), delay(2000)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }).catch(error => {
    console.warn(`Temporary Chrome profile cleanup was deferred: ${error.code || error.message}`);
  });
}
