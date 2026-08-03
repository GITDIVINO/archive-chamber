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

await openAddress('w2;0;2;2;13;197');
await page.waitForSelector('#book-panel.visible');
assert.equal(await page.locator('.page-counter span').first().textContent(), '197');
assert.equal(await page.locator('#book-address').textContent(), 'w2;0;2;2;13;197');
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
assert.equal(await page.locator('#book-address').textContent(), 'w2;0;2;2;13;198');

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
await page.locator('#address-input').fill('w2;' + '1'.repeat(20000));
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
  input.value = 'w2;' + '1'.repeat(50000);
});
started = Date.now();
await page.locator('#address-submit').click();
assert.equal(await page.locator('#search-result').textContent(), 'record is too long for this client');
assert.ok(Date.now() - started < 2000, 'refusing an oversized address must be immediate');

assert.deepEqual(consoleErrors, [], 'the page must boot without console errors');

// --- the cabinet contains its shelves ----------------------------------------
// The carcase used to be a fixed height while the shelf pitch was tuned
// separately, so the top row stood 35mm inside the head rail. Deriving the
// height fixed it; this keeps the two from drifting apart again.
const cabinet = await page.evaluate(async () => {
  const room = await import('./src/world/room.js');
  const constants = await import('./src/constants.js');
  const babel = await import('./babel-v3.js');
  const topShelfY = constants.SHELF_BASE_Y + (babel.SHELVES_PER_WALL - 1) * constants.SHELF_PITCH;
  return {
    carcaseHeight: room.CARCASE_HEIGHT,
    railBottom: room.CARCASE_HEIGHT - room.RAIL_THICKNESS,
    topBooksReach: topShelfY + room.SHELF_SURFACE_OFFSET + constants.BOOK_HEIGHT,
    topBookCentre: topShelfY + room.SHELF_SURFACE_OFFSET + constants.BOOK_HEIGHT / 2,
    shelfPitch: constants.SHELF_PITCH,
    shelfThickness: room.SHELF_THICKNESS,
    bookHeight: constants.BOOK_HEIGHT,
    interaction: constants.INTERACTION_DISTANCE,
  };
});

assert.ok(
  cabinet.topBooksReach <= cabinet.railBottom,
  `the top row must sit under the head rail: books reach ${cabinet.topBooksReach}, rail starts ${cabinet.railBottom}`,
);
assert.ok(
  cabinet.shelfPitch >= cabinet.shelfThickness + cabinet.bookHeight,
  'each shelf needs room for its board and a volume, or every row pushes through the one above',
);
// Eye height 1.65, standing roughly 0.7 out from the shelf face.
assert.ok(
  Math.hypot(0.7, cabinet.topBookCentre - 1.65) < cabinet.interaction,
  'a volume on the top shelf must still be within reach, or it can be read but never opened',
);

// --- doorways ----------------------------------------------------------------
// Driven against the page's own module instances, so this exercises the same
// camera and room registry the player does rather than a copy.
await openCatalogue();
await page.locator('#address-input').fill('w2;0');
await page.locator('#address-submit').click();
await page.waitForFunction(() => document.querySelector('#search-result').textContent === 'world room opened');

const doorGeometry = await page.evaluate(async () => {
  const doors = await import('./src/world/doors.js');
  const { APOTHEM } = await import('./src/constants.js');
  const beyond = doors.DOOR_CROSSING_DISTANCE + 0.1;
  const at = (index, normal, tangent) => {
    const { basis } = doors.wallCoordinates(index, 0, 0);
    return {
      x: basis.nx * normal + basis.tx * tangent,
      z: basis.nz * normal + basis.tz * tangent,
    };
  };
  const centred = at(2, beyond, 0);
  const offCentre = at(2, beyond, 1.9);
  const bookWall = at(0, beyond, 0);
  return {
    apothem: APOTHEM,
    opposite: [doors.oppositeWall(2), doors.oppositeWall(5)],
    doorWalls: [0, 1, 2, 3, 4, 5].filter(index => doors.isDoorWall(index, 0n)),
    crossingCentred: doors.crossedDoorway(centred.x, centred.z, 0n),
    crossingOffCentre: doors.crossedDoorway(offCentre.x, offCentre.z, 0n),
    crossingThroughBookWall: doors.crossedDoorway(bookWall.x, bookWall.z, 0n),
    crossingWhileBlocked: doors.crossedDoorway(centred.x, centred.z, 0n, 2),
  };
});

assert.deepEqual(doorGeometry.doorWalls, [2, 5], 'only the two shelf-free walls carry doorways');
assert.deepEqual(doorGeometry.opposite, [5, 2], 'the doorways face each other');
assert.equal(doorGeometry.crossingCentred, 2, 'walking through the opening crosses');
assert.equal(doorGeometry.crossingOffCentre, null, 'the jambs block a crossing beside the opening');
assert.equal(doorGeometry.crossingThroughBookWall, null, 'a shelved wall is never a doorway');
assert.equal(doorGeometry.crossingWhileBlocked, null, 'the wall just entered by stays inert');

// Walking into a corner must not fling the player sideways into a doorway.
// Every corner of the room lies exactly the player boundary away from both
// walls that meet there, which is also the depth the jamb-slide used to test
// for — so approaching one clamped the player's sideways offset to the width
// of the opening and moved them bodily into it.
const corners = await page.evaluate(async () => {
  const doors = await import('./src/world/doors.js');
  const { PLAYER_BOUNDARY, ROOM_RADIUS } = await import('./src/constants.js');
  const results = [];
  // The six corners sit between the wall normals, at multiples of PI/3.
  for (let corner = 0; corner < 6; corner++) {
    const angle = corner * Math.PI / 3;
    // Just past the reachable corner, as a frame of movement would leave them.
    const reach = PLAYER_BOUNDARY / Math.cos(Math.PI / 6) + 0.25;
    const start = { x: Math.cos(angle) * reach, y: 0, z: Math.sin(angle) * reach };
    const moved = { ...start };
    doors.constrainToRoom(moved, 0n);
    results.push({
      corner,
      shift: Math.hypot(moved.x - start.x, moved.z - start.z),
      insideRoom: Math.hypot(moved.x, moved.z) <= ROOM_RADIUS,
    });
  }
  return results;
});

for (const { corner, shift, insideRoom } of corners) {
  assert.ok(insideRoom, `corner ${corner}: the player must stay inside the room`);
  assert.ok(
    shift < 0.6,
    `corner ${corner}: hitting a corner should nudge the player back, not carry them ${shift.toFixed(2)} units along the wall`,
  );
}

// A real crossing: place the player in the threshold and let the world react.
const walk = await page.evaluate(async () => {
  const { camera } = await import('./src/core/view.js');
  const { syncDoorways, world } = await import('./src/world/rooms.js');
  const doors = await import('./src/world/doors.js');
  const step = (index, normal) => {
    const { basis } = doors.wallCoordinates(index, 0, 0);
    camera.position.x = basis.nx * normal;
    camera.position.z = basis.nz * normal;
  };
  const record = () => ({
    q: String(world.room.q),
    r: String(world.room.r),
    tag: world.tag,
    x: Number(camera.position.x.toFixed(3)),
    z: Number(camera.position.z.toFixed(3)),
  });

  const before = record();
  step(2, doors.DOOR_CROSSING_DISTANCE + 0.1);
  const enteredForward = Boolean(syncDoorways());
  const afterForward = record();

  // Arriving must not immediately bounce back out of the opposite doorway.
  const bouncedStraightBack = Boolean(syncDoorways());

  // Step inside to re-arm, then walk back the way we came.
  step(5, 4);
  syncDoorways();
  step(5, doors.DOOR_CROSSING_DISTANCE + 0.1);
  const enteredBack = Boolean(syncDoorways());
  const afterBack = record();

  return { before, enteredForward, afterForward, bouncedStraightBack, enteredBack, afterBack };
});

assert.equal(walk.enteredForward, true, 'crossing the threshold enters the neighbour');
assert.deepEqual(
  [walk.afterForward.q, walk.afterForward.r],
  ['-1', '1'],
  'wall 2 leads to the axial neighbour [-1,+1]',
);
assert.notEqual(walk.afterForward.tag, walk.before.tag, 'the new chamber has its own tag');
assert.equal(walk.bouncedStraightBack, false, 'arriving does not immediately count as leaving');
assert.equal(walk.enteredBack, true, 'the opposite doorway leads home');
assert.deepEqual([walk.afterBack.q, walk.afterBack.r], ['0', '0'], 'walking back returns to w2;0');

// The corridor seen through the doorways is built once and left alone: walking
// a threshold must not rebuild or move it, or the repetition would visibly
// restart instead of continuing.
const vista = await page.evaluate(async () => {
  const { renderedWorld } = await import('./src/core/view.js');
  const { syncDoorways } = await import('./src/world/rooms.js');
  const groups = renderedWorld.children.filter(child => child.type === 'Group' && child.userData.q === undefined);
  const measure = () => {
    const group = renderedWorld.children.filter(c => c.type === 'Group' && c.userData.q === undefined)[0];
    if (!group) return null;
    let vertices = 0;
    for (const mesh of group.children) vertices += mesh.geometry.getAttribute('position').count;
    return { meshes: group.children.length, vertices, id: group.id };
  };
  const before = measure();
  syncDoorways();
  return { groups: groups.length, before, after: measure() };
});

assert.equal(vista.groups, 1, 'exactly one corridor group stands beside the built room');
assert.ok(vista.before.meshes > 0 && vista.before.vertices > 1000, 'the corridor carries real geometry');
assert.deepEqual(vista.after, vista.before, 'the corridor is never rebuilt as the player moves');

// Position carries across the threshold instead of snapping to the centre.
assert.ok(
  Math.hypot(walk.afterForward.x, walk.afterForward.z) > 5,
  'the player emerges at the doorway, not teleported to the middle of the room',
);

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
// Both events are queued without waiting for a round trip in between, so the
// measured press length is the client's, not the test harness's latency.
await Promise.all([
  cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400, id: 1 }] }),
  cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
]);
await touchPage.waitForFunction(() => document.querySelector('#notice').textContent !== '', null, { timeout: 5000 });
assert.equal(await touchPage.locator('#notice').textContent(), 'aim at a book', 'a tap triggers the read action');

assert.deepEqual(touchErrors, [], 'the touch client must run without errors');

await browser.close();
server.close();
console.log('smoke: room renders in ' + perFrame + ' draw calls/frame; reader, catalogue, search and touch paths pass');
