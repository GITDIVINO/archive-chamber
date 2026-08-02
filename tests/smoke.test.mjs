/**
 * Headless smoke test.
 *
 * The unit suites cover the catalogue and placement mathematics.  This one
 * covers what they cannot: that the page actually boots, builds a room in
 * WebGL, opens the three reader paths, and does so without flooding the GPU
 * with draw calls or logging an error.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

// A draw call per volume is the regression this guards against: a room of 640
// books once cost ~1200 calls, and instancing brought it under twenty.
const MAX_DRAW_CALLS_PER_FRAME = 60;

function startServer() {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(request.url.split('?')[0]);
    const target = join(root, normalize(path === '/' ? '/index.html' : path));
    if (!target.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(target);
      response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(target)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const server = await startServer();
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => consoleErrors.push(String(error)));

// Count real GPU submissions rather than trusting three.js bookkeeping.
await page.addInitScript(() => {
  window.__draw = { calls: 0, frames: 0 };
  const patch = (proto) => {
    if (!proto) return;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const original = proto[name];
      if (!original) continue;
      proto[name] = function (...args) {
        window.__draw.calls++;
        return original.apply(this, args);
      };
    }
  };
  patch(window.WebGL2RenderingContext?.prototype);
  patch(window.WebGLRenderingContext?.prototype);
  const raf = window.requestAnimationFrame.bind(window);
  const tick = () => { window.__draw.frames++; raf(tick); };
  raf(tick);
});

await page.goto(origin, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#startup-state').textContent === 'ready', null, { timeout: 30000 });
assert.equal(await page.locator('#start').isDisabled(), false, 'the chamber must be enterable once ready');

const roomTag = await page.locator('#cell').textContent();
assert.match(roomTag, /^chamber h-/, 'the status bar shows the decorative room tag');

// --- the room is drawn, and drawn cheaply ------------------------------------
await page.waitForFunction(() => window.__draw.frames > 4, null, { timeout: 15000 });
const perFrame = await page.evaluate(() => Math.round(window.__draw.calls / window.__draw.frames));
assert.ok(perFrame > 0, 'the room must actually render');
assert.ok(
  perFrame <= MAX_DRAW_CALLS_PER_FRAME,
  `a room should cost at most ${MAX_DRAW_CALLS_PER_FRAME} draw calls per frame, measured ${perFrame}`,
);

// --- the physical manifesto opens on its fixed page --------------------------
// The reader covers the status bar, so it has to be dismissed the way a player
// would before the catalogue can be reached again.
async function openCatalogue() {
  if (await page.locator('#book-panel.visible').count()) {
    await page.locator('#close-book').click();
    await page.waitForSelector('#book-panel.visible', { state: 'detached' });
  }
  await page.locator('#open-search').click();
}

async function openAddress(address) {
  await openCatalogue();
  await page.locator('#address-input').fill(address);
  await page.locator('#address-submit').click();
}

await openAddress('w1;0;2;2;13;197');
await page.waitForSelector('#book-panel.visible');
assert.equal(await page.locator('.page-counter span').first().textContent(), '197');
assert.equal(await page.locator('#book-address').textContent(), 'w1;0;2;2;13;197');
assert.equal(await page.locator('#location-record').textContent(), 'copy world record');
assert.equal(await page.locator('#catalogue-record').isHidden(), false, 'a world record also exposes its catalogue address');
const manifestoPage = (await page.locator('#book-page').textContent()).replace(/\n/g, '');
assert.ok(
  manifestoPage.includes('the library is larger than the universe'),
  'the physical manifesto copy carries the manifesto text',
);

// paging keeps the address and the counter in step
await page.locator('#next-page').click();
assert.equal(await page.locator('.page-counter span').first().textContent(), '198');
assert.equal(await page.locator('#book-address').textContent(), 'w1;0;2;2;13;198');

// --- a catalogue address opens without a world record ------------------------
await openAddress('v3;129d19;2;2;13;197');
await page.waitForFunction(() => document.querySelector('#book-address').textContent.startsWith('v3;'));
assert.equal(await page.locator('.page-counter span').first().textContent(), '197');
assert.equal(await page.locator('#location-record').textContent(), 'copy catalogue record');
assert.equal(await page.locator('#catalogue-record').isHidden(), true, 'a pure catalogue record has no world address');

// --- search finds one occurrence and does not move the player ----------------
const roomBeforeSearch = await page.locator('#cell').textContent();
await openCatalogue();
await page.locator('#search-input').fill('the library is larger than the universe');
await page.locator('#search-submit').click();
await page.waitForFunction(
  () => document.querySelector('#search-result').textContent === 'one catalogue occurrence opened',
  null,
  { timeout: 30000 },
);
const foundPage = (await page.locator('#book-page').textContent()).replace(/\n/g, '');
assert.ok(
  foundPage.startsWith('the library is larger than the universe'),
  'the located page opens on the searched fragment',
);
assert.equal(await page.locator('#cell').textContent(), roomBeforeSearch, 'search must not teleport the player');

// --- oversized addresses cannot freeze the tab -------------------------------
// First line of defence: the field itself refuses to hold a huge value.
await openCatalogue();
assert.equal(await page.locator('#address-input').getAttribute('maxlength'), '8192');
await page.locator('#address-input').fill('w1;' + '1'.repeat(20000));
assert.equal(
  (await page.locator('#address-input').inputValue()).length,
  8192,
  'the field truncates to its maximum length',
);

// Even a maximal address must be answered promptly rather than blocking.
let started = Date.now();
await page.locator('#address-submit').click();
await page.waitForFunction(() => document.querySelector('#search-result').textContent !== '');
assert.ok(Date.now() - started < 3000, 'a maximum-length address must not stall the tab');

// Second line of defence: a value set past the field limit is still refused.
await openCatalogue();
await page.evaluate(() => {
  const input = document.querySelector('#address-input');
  input.removeAttribute('maxlength');
  input.value = 'w1;' + '1'.repeat(50000);
});
started = Date.now();
await page.locator('#address-submit').click();
assert.equal(await page.locator('#search-result').textContent(), 'record is too long for this client');
assert.ok(Date.now() - started < 2000, 'refusing an oversized address must be immediate');

assert.deepEqual(consoleErrors, [], 'the page must boot without console errors');

// --- touch devices -----------------------------------------------------------
// Phones have no pointer lock, so entering the chamber is a mode switch driven
// by a virtual stick. Real touch events are dispatched through CDP so the
// client sees pointerType 'touch' exactly as it would on a device.
const touchContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const touchPage = await touchContext.newPage();
const touchErrors = [];
touchPage.on('pageerror', error => touchErrors.push(String(error)));
await touchPage.goto(origin, { waitUntil: 'load' });
await touchPage.waitForFunction(() => document.querySelector('#startup-state').textContent === 'ready', null, { timeout: 30000 });

assert.equal(await touchPage.locator('.controls-touch').isVisible(), true, 'touch devices get gesture instructions');
assert.equal(await touchPage.locator('p.controls:not(.controls-touch)').isVisible(), false, 'keyboard instructions are hidden on touch');

await touchPage.locator('#start').click();
assert.equal(await touchPage.locator('#intro').getAttribute('class'), 'panel gone', 'entering hides the intro without pointer lock');
assert.equal(await touchPage.evaluate(() => document.querySelector('#reticle').style.display), 'block');

const cdp = await touchContext.newCDPSession(touchPage);
async function touchDrag(fromX, fromY, toX, toY, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fromX, y: fromY, id: 1 }],
  });
  for (let step = 1; step <= steps; step++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: fromX + (toX - fromX) * step / steps,
        y: fromY + (toY - fromY) * step / steps,
        id: 1,
      }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// The minimap only repaints when the player actually moved or turned, so a
// changed canvas is proof the input reached the world rather than the DOM.
const mapSnapshot = () => touchPage.evaluate(() => document.querySelector('#hex-map').toDataURL());

// Dragging the left half raises the stick and walks.
const beforeWalk = await mapSnapshot();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 600, id: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 540, id: 1 }] });
assert.equal(await touchPage.locator('#touch-stick.visible').count(), 1, 'the virtual stick follows the finger');
await touchPage.waitForTimeout(250);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
assert.equal(await touchPage.locator('#touch-stick.visible').count(), 0, 'the stick disappears on release');
assert.notEqual(await mapSnapshot(), beforeWalk, 'the stick moves the player');

// Dragging the right half turns the view.
const beforeLook = await mapSnapshot();
await touchDrag(300, 400, 180, 400);
await touchPage.waitForTimeout(120);
assert.notEqual(await mapSnapshot(), beforeLook, 'dragging the right half turns the view');

// A tap on the right half aims rather than turns; nothing is in reach at spawn.
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400, id: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await touchPage.waitForFunction(() => document.querySelector('#notice').textContent !== '', null, { timeout: 5000 });
assert.equal(await touchPage.locator('#notice').textContent(), 'aim at a book', 'a tap triggers the read action');

assert.deepEqual(touchErrors, [], 'the touch client must run without errors');

await browser.close();
server.close();
console.log('smoke: room renders in ' + perFrame + ' draw calls/frame; reader, catalogue, search and touch paths pass');
