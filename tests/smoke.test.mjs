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

// The status bar carries the walker's own number, not the world's hash: the
// hash is thirteen characters nobody can hold. The tag stays reachable as the
// button's title, and the exact record as the value it copies.
const roomTag = await page.locator('#cell').textContent();
assert.equal(roomTag, 'chamber 1', 'the chamber the walker wakes in is their first');
assert.match(
  await page.locator('#cell').getAttribute('title'),
  /^h-/,
  'the world\'s own name for the chamber is still one hover away',
);
assert.match(
  await page.locator('#cell').getAttribute('data-full-address'),
  /^w2;/,
  'and the exact record is still what the button copies',
);

// --- the room is drawn, and drawn cheaply ------------------------------------
await page.waitForFunction(() => window.__draw.frames > 4, null, { timeout: 15000 });
const perFrame = await page.evaluate(() => Math.round(window.__draw.calls / window.__draw.frames));
assert.ok(perFrame > 0, 'the room must actually render');
assert.ok(
  perFrame <= MAX_DRAW_CALLS_PER_FRAME,
  `a room should cost at most ${MAX_DRAW_CALLS_PER_FRAME} draw calls per frame, measured ${perFrame}`,
);

// --- the interface is on top of the canvas -----------------------------------
// The status bar is the only thing a player can click without first entering
// the chamber, and it sits over a full-screen canvas. If the stacking ever
// goes the other way the buttons become unreachable — which is a failure a
// click times out on thirty seconds later, saying nothing useful.
const reachable = await page.evaluate(() => {
  const report = {};
  for (const id of ['open-search', 'open-register', 'cell']) {
    const element = document.querySelector('#' + id);
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    report[id] = {
      box: [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)],
      onScreen: box.width > 0 && box.height > 0 && y >= 0 && y <= innerHeight && x >= 0 && x <= innerWidth,
      hit: hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : 'nothing',
      pointerEvents: getComputedStyle(element).pointerEvents,
    };
  }
  const canvas = document.querySelector('canvas');
  report.layers = {
    viewport: [innerWidth, innerHeight],
    uiZ: getComputedStyle(document.querySelector('#ui')).zIndex,
    uiPosition: getComputedStyle(document.querySelector('#ui')).position,
    canvasZ: getComputedStyle(canvas).zIndex,
    canvasPosition: getComputedStyle(canvas).position,
    canvasFilter: getComputedStyle(canvas).filter,
    statusHeight: Math.round(document.querySelector('#status').getBoundingClientRect().height),
    bodyOrder: [...document.body.children].map(child => child.tagName.toLowerCase() + (child.id ? '#' + child.id : '')),
  };
  return report;
});

for (const id of ['open-search', 'open-register', 'cell']) {
  assert.equal(
    reachable[id].hit,
    'button#' + id,
    `#${id} must be the topmost element at its own centre, found ${reachable[id].hit}. `
      + JSON.stringify({ ...reachable[id], layers: reachable.layers }),
  );
}

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
  const { APOTHEM, HALL_START } = await import('./src/constants.js');
  const { basis } = doors.wallCoordinates(2, 0, 0);
  const on = (normal, tangent) => [
    basis.nx * normal + basis.tx * tangent,
    basis.nz * normal + basis.tz * tangent,
  ];
  return {
    apothem: APOTHEM,
    hallStart: HALL_START,
    opposite: [doors.oppositeWall(2), doors.oppositeWall(5)],
    doorWalls: [0, 1, 2, 3, 4, 5].filter(index => doors.isDoorWall(index, 0n)),
    centredInOpening: doors.isWithinDoorway(2, 0n, ...on(APOTHEM, 0)),
    besideOpening: doors.isWithinDoorway(2, 0n, ...on(APOTHEM, 1.9)),
    throughBookWall: doors.isWithinDoorway(0, 0n, ...on(APOTHEM, 0)),
  };
});

assert.deepEqual(doorGeometry.doorWalls, [2, 5], 'only the two shelf-free walls carry doorways');
assert.deepEqual(doorGeometry.opposite, [5, 2], 'the doorways face each other');
assert.equal(doorGeometry.centredInOpening, true, 'the middle of a free wall is the opening');
assert.equal(doorGeometry.besideOpening, false, 'beside the opening is jamb, not doorway');
assert.equal(doorGeometry.throughBookWall, false, 'a shelved wall is never a doorway');
assert.ok(
  doorGeometry.hallStart > doorGeometry.apothem,
  'a passage starts beyond the wall plane, never inside the chamber',
);

// --- the passage -------------------------------------------------------------
// A doorway no longer opens into the neighbour: it opens onto a corridor that
// is not in the hex plane at all, with four ways out. See src/world/passage.js.
const passage = await page.evaluate(async () => {
  const doors = await import('./src/world/doors.js');
  const c = await import('./src/constants.js');
  const place = (index, normal, tangent) => {
    const { basis } = doors.wallCoordinates(index, 0, 0);
    return {
      x: basis.nx * normal + basis.tx * tangent,
      y: 1.65,
      z: basis.nz * normal + basis.tz * tangent,
    };
  };
  const exitAt = (normal, tangent) => doors.crossedPassageExit(place(2, normal, tangent), 0n);
  const held = (normal, tangent) => {
    const point = place(2, normal, tangent);
    doors.constrainToPlace(point, 0n);
    return doors.wallCoordinates(2, point.x, point.z);
  };
  const middle = c.HALL_START + c.HALL_SIDE_CENTRE;
  return {
    // Inside the chamber and inside the passage are different spaces.
    insideRoom: exitAt(c.APOTHEM - 1, 0),
    partway: exitAt(c.HALL_START + 2, 0),
    farEnd: exitAt(c.HALL_END + 0.2, 0),
    // The side openings, and the blank wall on either side of them.
    rightExit: exitAt(middle, c.SIDE_EXIT_REACH + 0.1),
    leftExit: exitAt(middle, -(c.SIDE_EXIT_REACH + 0.1)),
    noExitBefore: exitAt(c.HALL_START + 1, c.SIDE_EXIT_REACH + 0.1),
    noExitAfter: exitAt(c.HALL_END - 1, -(c.SIDE_EXIT_REACH + 0.1)),
    // Walls: the passage holds a walker in, except where it opens.
    heldAgainstSide: held(c.HALL_START + 2, 5).tangent,
    heldInAlcove: held(middle, 9).tangent,
    // A shelved wall has no passage behind it at all.
    throughBookWall: doors.crossedPassageExit(place(0, c.HALL_START + 2, 0), 0n),
    limits: { half: c.HALL_HALF_WIDTH, reach: c.ALCOVE_REACH, radius: c.PLAYER_RADIUS },
  };
});

assert.equal(passage.insideRoom, null, 'standing in the chamber is not standing in a passage');
assert.equal(passage.partway, null, 'walking down a passage is not yet leaving it');
assert.deepEqual(passage.farEnd, { wall: 2, exit: 'ahead' }, 'the far end leads to the chamber ahead');
assert.deepEqual(passage.rightExit, { wall: 2, exit: 'right' }, 'the opening on the right is the right exit');
assert.deepEqual(passage.leftExit, { wall: 2, exit: 'left' }, 'the opening on the left is the left exit');
assert.equal(passage.noExitBefore, null, 'there is only one opening a side, halfway along');
assert.equal(passage.noExitAfter, null, 'the wall past the opening is solid again');
assert.equal(passage.throughBookWall, null, 'a shelved wall has no passage behind it');
assert.ok(
  Math.abs(passage.heldAgainstSide) <= passage.limits.half - passage.limits.radius + 1e-6,
  `the passage wall must stop a walker, not let them through at ${passage.heldAgainstSide}`,
);
assert.ok(
  Math.abs(passage.heldInAlcove) <= passage.limits.reach - passage.limits.radius + 1e-6,
  'an alcove is blind: its back wall stops a walker',
);
assert.ok(
  Math.abs(passage.heldInAlcove) > passage.limits.half,
  'a walker must be able to step into the alcove at all, or the turning is unreachable',
);

// On the map a passage has no length, because in the plane it has none. A
// walker who steps into one leaves their chamber by a doorway and stops dead
// against it, and stays there however far down the corridor they go.
const inThePlane = await page.evaluate(async () => {
  const doors = await import('./src/world/doors.js');
  const c = await import('./src/constants.js');
  const { basis } = doors.wallCoordinates(2, 0, 0);
  const at = (normal, tangent = 0) => {
    const point = {
      x: basis.nx * normal + basis.tx * tangent,
      y: 1.65,
      z: basis.nz * normal + basis.tz * tangent,
    };
    const stood = doors.planePosition(point, 0n);
    let furthest = -Infinity;
    for (let wall = 0; wall < 6; wall++) {
      furthest = Math.max(furthest, doors.wallCoordinates(wall, stood.x, stood.z).normal);
    }
    return { stood: [stood.x, stood.z], furthest };
  };
  return {
    inRoom: at(3),
    mouth: at(c.HALL_START + 0.5),
    middle: at(c.HALL_START + c.HALL_SIDE_CENTRE),
    farEnd: at(c.HALL_END - 0.2),
    inAlcove: at(c.HALL_START + c.HALL_SIDE_CENTRE, c.ALCOVE_REACH - 0.4),
    apothem: c.APOTHEM,
    doorHalf: c.DOOR_HALF_WIDTH,
  };
});

assert.ok(inThePlane.inRoom.furthest < inThePlane.apothem, 'inside the chamber a walker moves on the map as they move');
for (const where of ['mouth', 'middle', 'farEnd', 'inAlcove']) {
  assert.ok(
    inThePlane[where].furthest <= inThePlane.apothem + 1e-9,
    `${where}: a walker in a passage must never be drawn outside their chamber`,
  );
}
assert.deepEqual(
  inThePlane.farEnd.stood.map(value => value.toFixed(4)),
  inThePlane.mouth.stood.map(value => value.toFixed(4)),
  'fifteen units of corridor move a walker nowhere at all in the plane',
);
assert.notDeepEqual(
  inThePlane.inAlcove.stood.map(value => value.toFixed(4)),
  inThePlane.middle.stood.map(value => value.toFixed(4)),
  'stepping into an alcove does slide them along the wall, to the edge of the opening',
);

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
    doors.constrainToPlace(moved, 0n);
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

// A real walk: down the passage and out of each of its three far exits, driven
// against the page's own camera and room registry.
const walk = await page.evaluate(async () => {
  const { camera } = await import('./src/core/view.js');
  const { moveToWorldHex, syncDoorways, world } = await import('./src/world/rooms.js');
  const doors = await import('./src/world/doors.js');
  const c = await import('./src/constants.js');

  const step = (index, normal, tangent = 0) => {
    const { basis } = doors.wallCoordinates(index, 0, 0);
    camera.position.x = basis.nx * normal + basis.tx * tangent;
    camera.position.z = basis.nz * normal + basis.tz * tangent;
  };
  const record = () => ({
    q: String(world.room.q),
    r: String(world.room.r),
    tag: world.tag,
    depth: Number(Math.hypot(camera.position.x, camera.position.z).toFixed(3)),
  });
  const leaveBy = (normal, tangent) => {
    moveToWorldHex(0n, 0n, 0n);
    step(2, normal, tangent);
    const entered = Boolean(syncDoorways());
    return { entered, ...record() };
  };

  moveToWorldHex(0n, 0n, 0n);
  const home = record();

  // Standing in the passage changes nothing until an exit is crossed.
  step(2, c.HALL_START + 3);
  const walking = { entered: Boolean(syncDoorways()), ...record() };

  const ahead = leaveBy(c.HALL_END + 0.2, 0);
  // Arriving must not immediately count as leaving again.
  const bouncedStraightBack = Boolean(syncDoorways());
  const right = leaveBy(c.HALL_START + c.HALL_SIDE_CENTRE, c.SIDE_EXIT_REACH + 0.1);
  const left = leaveBy(c.HALL_START + c.HALL_SIDE_CENTRE, -(c.SIDE_EXIT_REACH + 0.1));

  // And home again from the chamber ahead, by its own passage.
  moveToWorldHex(-1n, 1n, 0n);
  step(5, c.HALL_END + 0.2);
  const back = { entered: Boolean(syncDoorways()), ...record() };

  return { home, walking, ahead, right, left, back, bouncedStraightBack, radius: c.ROOM_RADIUS };
});

assert.equal(walk.walking.entered, false, 'walking down a passage does not change chamber');
assert.equal(walk.walking.q, '0', 'the chamber is still the one the passage was entered from');

assert.equal(walk.ahead.entered, true, 'the far end of a passage enters the chamber ahead');
assert.deepEqual([walk.ahead.q, walk.ahead.r], ['-1', '1'], 'wall 2 leads to the axial neighbour [-1,+1]');
assert.notEqual(walk.ahead.tag, walk.home.tag, 'the new chamber has its own tag');
assert.equal(walk.bouncedStraightBack, false, 'arriving does not immediately count as leaving');
assert.ok(
  walk.ahead.depth > 5,
  'walking straight through must be seamless: the player emerges in the far doorway, not at the centre',
);

// The side exits are the whole reason a passage is longer than a wall is thick:
// two doorways would otherwise reach two neighbours, and these reach four more.
assert.equal(walk.right.entered, true, 'the right-hand opening leads somewhere');
assert.deepEqual([walk.right.q, walk.right.r], ['-1', '0'], 'turning right out of wall 2 reaches the chamber at dir 3');
assert.equal(walk.left.entered, true, 'the left-hand opening leads somewhere');
assert.deepEqual([walk.left.q, walk.left.r], ['0', '1'], 'turning left out of wall 2 reaches the chamber at dir 1');
for (const turn of ['right', 'left']) {
  assert.ok(
    walk[turn].depth < walk.radius,
    `turning ${turn} must leave the player inside the chamber, not in its doorway`,
  );
}

assert.deepEqual([walk.back.q, walk.back.r], ['0', '0'], 'the passage the other way leads home');

// The corridor seen through the doorways is built once and left alone: walking
// a threshold must not rebuild or move it, or the repetition would visibly
// restart instead of continuing. The passages the player walks through are part
// of it, so this also proves they are not rebuilt per room.
const vista = await page.evaluate(async () => {
  const { renderedWorld } = await import('./src/core/view.js');
  const { camera } = await import('./src/core/view.js');
  const { syncDoorways } = await import('./src/world/rooms.js');
  const doors = await import('./src/world/doors.js');
  const { HALL_END } = await import('./src/constants.js');
  const groups = renderedWorld.children.filter(child => child.type === 'Group' && child.userData.q === undefined);
  const measure = () => {
    const group = renderedWorld.children.filter(c => c.type === 'Group' && c.userData.q === undefined)[0];
    if (!group) return null;
    let vertices = 0;
    for (const mesh of group.children) vertices += mesh.geometry.getAttribute('position').count;
    return { meshes: group.children.length, vertices, id: group.id };
  };
  const before = measure();
  const { basis } = doors.wallCoordinates(2, 0, 0);
  camera.position.x = basis.nx * (HALL_END + 0.2);
  camera.position.z = basis.nz * (HALL_END + 0.2);
  syncDoorways();
  return { groups: groups.length, before, after: measure() };
});

assert.equal(vista.groups, 1, 'exactly one corridor group stands beside the built room');
assert.ok(vista.before.meshes > 0 && vista.before.vertices > 1000, 'the corridor carries real geometry');
assert.deepEqual(vista.after, vista.before, 'the corridor is never rebuilt as the player moves');

// --- the register ------------------------------------------------------------
// A chamber's name in the world is a thirteen-character hash. The walker
// numbers them instead, in the order they first walk in, and the register is
// the one place the two can be set against each other. Several chambers have
// already been entered by the tests above, so this measures against that.
const register = await page.evaluate(async () => {
  const { moveToWorldHex, world } = await import('./src/world/rooms.js');
  const { registerEntries, registerSize } = await import('./src/world/register.js');

  moveToWorldHex(0n, 0n, 0n);
  const home = { ordinal: world.ordinal, tag: world.tag, address: world.address };

  const before = registerSize();
  const fresh = { q: 4104n, r: -7013n, level: 0n };
  moveToWorldHex(fresh.q, fresh.r, fresh.level);
  const freshOrdinal = world.ordinal;
  const mapOrdinals = world.mapCells.map(cell => cell.ordinal);

  moveToWorldHex(0n, 0n, 0n);
  const backHome = world.ordinal;
  moveToWorldHex(fresh.q, fresh.r, fresh.level);
  const backFresh = world.ordinal;

  return {
    home,
    before,
    freshOrdinal,
    backHome,
    backFresh,
    mapOrdinals,
    size: registerSize(),
    newest: registerEntries()[0],
    oldest: registerEntries().at(-1),
  };
});

assert.equal(register.home.ordinal, 1, 'the chamber the walker wakes in is chamber 1');
assert.match(register.home.tag, /^h-/, 'the world still has its own name for it');
assert.equal(register.freshOrdinal, register.before + 1, 'a chamber never entered takes the next number');
assert.equal(register.size, register.before + 1, 'and only one row is added for it');
assert.equal(register.backHome, 1, 'returning to a chamber returns its number, never a new one');
assert.equal(register.backFresh, register.freshOrdinal, 'and the same holds walking back again');
assert.equal(register.newest.ordinal, register.freshOrdinal, 'the notebook reads newest first: the way back is what is wanted most');
assert.equal(register.oldest.ordinal, 1, 'and the first chamber is at the bottom of it');
assert.match(register.newest.address, /^w2;/, 'every row carries the exact record beside the number');
assert.ok(
  register.mapOrdinals.some(ordinal => ordinal === null),
  'the map leaves a chamber blank until it has been walked into, because until then nobody has named it',
);

// The panel decodes a number back into a place, and walks the player to it.
await page.locator('#open-register').click();
await page.waitForSelector('#register-panel.visible');
const rows = page.locator('.register-row');
assert.equal(await rows.count(), register.size, 'the register lists every chamber entered');
assert.equal(
  (await rows.first().locator('.register-ordinal').textContent()).trim(),
  String(register.freshOrdinal),
  'the newest chamber is at the top',
);
// The scale, said where the walker can read it. The count of chambers before
// the catalogue repeats has 1 918 664 digits, and the number itself cannot be
// shown — only its length, which is the point.
const scale = await page.locator('#register-count').textContent();
assert.match(scale, /^\d+ chambers? of a number with 1 918 664 digits/, 'the register says how big the library is');
assert.match(scale, /the world does not/, 'and that the world, unlike the catalogue, does not begin again');

assert.match(
  await rows.last().locator('.register-tag').textContent(),
  /^h-/,
  'each row sets the number the walker gave against the name the world uses',
);
await rows.last().click();
await page.waitForFunction(() => !document.querySelector('#register-panel').classList.contains('visible'));
assert.equal(
  await page.locator('#cell').textContent(),
  'chamber 1',
  'selecting a row walks the player back to that chamber',
);

// --- traces of librarians ----------------------------------------------------
// The story is about the people who spent their lives in the building, and
// every surface here used to be untouched — which made the walker the first
// creature ever to enter. A trace is derived from the chamber's own index, so
// it is as real as the books: always there, findable again, nameable exactly.
const traces = await page.evaluate(async () => {
  const THREE = await import('three');
  const { tracesFor } = await import('./src/world/traces.js');
  const { bookWallsForLevel, catalogBookIndexFor, freeWallsForLevel, worldRoomIndexFor } = await import('./world-engine.js');
  const { moveToWorldHex } = await import('./src/world/rooms.js');
  const { renderedWorld } = await import('./src/core/view.js');
  const doors = await import('./src/world/doors.js');

  const at = q => tracesFor(worldRoomIndexFor(BigInt(q), 3n, 0n), 0n);

  let disturbed = 0, tally = 0, short = 0, long = 0, offFreeWall = 0, outOfRange = 0;
  const SAMPLE = 12000;
  for (let q = 0; q < SAMPLE; q++) {
    const trace = at(q);
    if (trace.disturbed) disturbed++;
    if (!trace.tally) continue;
    tally++;
    if (trace.tally.count <= 5) short++;
    if (trace.tally.count > 12) long++;
    if (!freeWallsForLevel(0n).includes(trace.tally.wall)) offFreeWall++;
    if (trace.tally.count < 1 || trace.tally.count > 17) outOfRange++;
  }

  // Nothing is stored: the same chamber gives the same trace, every time. And
  // the traces that exist are not all the same trace — four chambers in five
  // carry nothing at all, so this has to be measured on the ones that do.
  const repeated = JSON.stringify(at(7)) === JSON.stringify(at(7));
  const marks = new Set();
  for (let q = 0; q < SAMPLE && marks.size < 60; q++) {
    const trace = at(q);
    if (trace.disturbed) marks.add(JSON.stringify(trace.disturbed));
  }
  const distinct = marks.size;

  // And a disturbed volume really does stand out of its shelf — by the reach
  // the trace names, and without its address or its title changing.
  const shelfMates = [];
  let target = null, mark = null, home = 0;
  for (let q = 0; q < 400 && !target; q++) {
    const trace = tracesFor(worldRoomIndexFor(BigInt(q), 0n, 0n), 0n);
    if (!trace.disturbed) continue;
    home = q;
    mark = trace.disturbed;
    moveToWorldHex(BigInt(q), 0n, 0n);
    const room = renderedWorld.children.find(child => child.userData.q !== undefined);
    const wallIndex = bookWallsForLevel(0n)[mark.wall];
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    for (const mesh of room.userData.bookMeshes) {
      for (let i = 0; i < mesh.count; i++) {
        const record = mesh.userData.records[i];
        const where = record.worldLocation;
        if (where.wall !== mark.wall + 1 || where.shelf !== mark.shelf + 1) continue;
        mesh.getMatrixAt(i, matrix);
        point.setFromMatrixPosition(matrix);
        const normal = doors.wallCoordinates(wallIndex, point.x, point.z).normal;
        if (where.volume === mark.volume + 1) {
          target = {
            normal,
            addressed: String(record.bookIndex) === String(catalogBookIndexFor(where)),
            titled: typeof record.volumeTitle === 'string' && record.volumeTitle.length > 0,
          };
        } else shelfMates.push(normal);
      }
    }
  }

  return {
    SAMPLE, disturbed, tally, short, long, offFreeWall, outOfRange, repeated, distinct,
    home, reach: mark.reach,
    standsOutBy: Math.min(...shelfMates) - target.normal,
    shelfSpread: Math.max(...shelfMates) - Math.min(...shelfMates),
    addressed: target.addressed,
    titled: target.titled,
  };
});

// One chamber in six, one in forty-eight. Loose bounds: the point is the order
// of magnitude, not the constant.
const disturbedRate = traces.disturbed / traces.SAMPLE;
const tallyRate = traces.tally / traces.SAMPLE;
assert.ok(disturbedRate > 0.12 && disturbedRate < 0.22, `a volume out of place should be common but not the rule, measured ${(disturbedRate * 100).toFixed(1)}%`);
assert.ok(tallyRate > 0.012 && tallyRate < 0.032, `a tally should be scarce enough that meeting one is an event, measured ${(tallyRate * 100).toFixed(2)}%`);
assert.ok(traces.short > traces.long * 2, 'short tallies must outnumber long ones: most people who start counting do not get far');
assert.equal(traces.offFreeWall, 0, 'a tally is scratched beside a doorway, never on a bookcase');
assert.equal(traces.outOfRange, 0, 'and never longer than a person would keep up');

assert.equal(traces.repeated, true, 'a trace is derived, never stored: the same chamber gives the same answer');
assert.ok(traces.distinct >= 55, `and different chambers carry different ones, ${traces.distinct} distinct in the first sixty found`);

assert.ok(
  Math.abs(traces.standsOutBy - traces.reach) < 1e-6,
  `the disturbed volume must stand out by exactly the reach recorded, ${traces.standsOutBy} against ${traces.reach}`,
);
assert.ok(traces.shelfSpread < 1e-6, 'and it must be the only one on its shelf that is out');
assert.equal(traces.addressed, true, 'it is the same volume it always was: same address');
assert.equal(traces.titled, true, 'and the same title — only its standing has been disturbed');

// --- the small print can be read ---------------------------------------------
// The status line and the map carry the chamber number and both buttons, and
// they are the smallest type in the game. They were also the only text the
// high-contrast preference could not reach, because both were keyed off
// hard-coded values rather than the variable.
const contrast = await page.evaluate(() => {
  const channel = value => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = colour => {
    const [r, g, b] = colour.match(/\d+/g).map(Number);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (front, back) => {
    const [a, b] = [luminance(front), luminance(back)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };
  const root = getComputedStyle(document.documentElement);
  const paper = root.getPropertyValue('--paper').trim();
  const toRgb = hex => {
    const value = parseInt(hex.replace('#', ''), 16);
    return `rgb(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255})`;
  };
  return {
    status: ratio(getComputedStyle(document.querySelector('#status')).color, toRgb(paper)),
    searchButton: ratio(getComputedStyle(document.querySelector('#open-search')).color, toRgb(paper)),
    registerButton: ratio(getComputedStyle(document.querySelector('#open-register')).color, toRgb(paper)),
    muted: ratio(toRgb(root.getPropertyValue('--muted').trim()), toRgb(paper)),
  };
});

for (const [name, value] of Object.entries(contrast)) {
  assert.ok(
    value >= 4.5,
    `${name} is ten-pixel type and must clear WCAG AA on the paper, measured ${value.toFixed(2)}:1`,
  );
}

// --- entering a chamber is cheap ---------------------------------------------
// Building a room used to cost 18.5 ms, over half of it painting 640 rotated
// spine labels onto three 2048 canvases. None of that has to happen in the
// frame a walker crosses a threshold, so the lettering is queued and painted
// in slices afterwards. The structural half of this check is the one that
// matters; the time is a ceiling against gross regressions, not a benchmark,
// because CI runs on shared machines with a software rasteriser.
const cost = await page.evaluate(async () => {
  const { moveToWorldHex, paintRoomLabels } = await import('./src/world/rooms.js');
  const { renderedWorld } = await import('./src/core/view.js');
  const roomOf = () => renderedWorld.children.find(child => child.userData.q !== undefined);

  const builds = [];
  for (let index = 1; index <= 9; index++) {
    const start = performance.now();
    moveToWorldHex(BigInt(index * 13), 5n, 0n);
    builds.push(performance.now() - start);
    // Drain this room's lettering before timing the next, or the queue of one
    // room would be paid for by the next room's slices.
    for (let slice = 0; slice < 60 && roomOf().userData.pendingSpines.length; slice++) paintRoomLabels(4);
  }
  builds.sort((a, b) => a - b);

  moveToWorldHex(7n, 7n, 0n);
  const queuedOnBuild = roomOf().userData.pendingSpines.length;
  let slices = 0;
  while (roomOf().userData.pendingSpines.length && slices < 60) {
    paintRoomLabels(4);
    slices++;
  }
  return { median: builds[4], queuedOnBuild, slices, drained: roomOf().userData.pendingSpines.length };
});

assert.ok(cost.queuedOnBuild > 600, `a room's 640 spine labels must be queued, not painted on the spot (${cost.queuedOnBuild})`);
assert.ok(cost.slices >= 1, 'and painted afterwards rather than never');
assert.equal(cost.drained, 0, 'the queue must empty: a room left half-lettered would stay that way');
assert.ok(
  cost.median < 40,
  `building a chamber should stay well inside a couple of frames, measured ${cost.median.toFixed(1)} ms`,
);

// --- the passage is a place, and says so --------------------------------------
// Standing in the middle of a junction of four chambers, the status line used
// to read "chamber 1". That was the one thing in this interface that was not
// true, and the whole discipline of the project is that a place has one name.
const place = await page.evaluate(async () => {
  const { camera } = await import('./src/core/view.js');
  const { moveToWorldHex, syncDoorways, syncPlace, world } = await import('./src/world/rooms.js');
  const { freeWallsForLevel } = await import('./world-engine.js');
  const doors = await import('./src/world/doors.js');
  const c = await import('./src/constants.js');

  const standAt = (wall, normal, tangent = 0) => {
    const { basis } = doors.wallCoordinates(wall, 0, 0);
    camera.position.x = basis.nx * normal + basis.tx * tangent;
    camera.position.z = basis.nz * normal + basis.tz * tangent;
    syncPlace();
    return { place: world.place, label: world.placeLabel };
  };

  moveToWorldHex(0n, 0n, 0n);
  const [near, far] = freeWallsForLevel(0n);
  const inChamber = standAt(near, 2);
  const inPassage = standAt(near, c.HALL_START + 4);
  // The same corridor, entered from its other end, must read the same: a
  // passage belongs to the edge, not to the direction of travel.
  const fromNearEnd = inPassage.label;
  moveToWorldHex(...Object.values(await (async () => {
    const { passageExits } = await import('./src/world/passage.js');
    const there = passageExits({ q: 0n, r: 0n, level: 0n }, near).ahead;
    return [there.q, there.r, there.level];
  })()));
  const fromFarEnd = standAt(far, c.HALL_START + 4).label;

  // And turning aside marks the arrival as one that cannot be retraced.
  moveToWorldHex(0n, 0n, 0n);
  standAt(near, c.HALL_START + c.HALL_SIDE_CENTRE, -(c.SIDE_EXIT_REACH + 0.1));
  syncDoorways();
  const afterTurning = world.arrivedIndirectly;
  moveToWorldHex(0n, 0n, 0n);
  standAt(near, c.HALL_END + 0.2);
  syncDoorways();
  const afterWalkingThrough = world.arrivedIndirectly;

  return { inChamber, inPassage, fromNearEnd, fromFarEnd, afterTurning, afterWalkingThrough };
});

assert.equal(place.inChamber.place, 'chamber');
assert.equal(place.inChamber.label, 'chamber 1', 'in a chamber the status line is its number');
assert.equal(place.inPassage.place, 'passage', 'a walker in a corridor is not in a chamber');
assert.match(place.inPassage.label, /^passage \S+ – \S+$/, 'a passage is named by the two chambers it runs between');
assert.equal(
  place.fromFarEnd, place.fromNearEnd,
  'and by the same name from either end, because a passage belongs to the edge',
);
assert.equal(place.afterTurning, true, 'turning aside is marked: it cannot be retraced');
assert.equal(place.afterWalkingThrough, false, 'walking straight through can be, and is not marked');

// --- every way out is named exactly once -------------------------------------
// A junction offers three identical openings onto three identical chambers.
// The way ahead is named over its entrance, on the beam at the end of the
// passage, because that is what a walker down the corridor has in front of
// them; the two at the sides are named on the ceiling of the chamber beyond,
// because to choose one of those they turn and look into it. Lettering has been
// built mirrored in this project before, and neither a plaque seen at an angle
// nor a flat marking read from below is easy to judge from a screenshot, so the
// winding and the texture coordinates are checked directly.
const signs = await page.evaluate(async () => {
  const { moveToWorldHex, world } = await import('./src/world/rooms.js');
  const { renderedWorld } = await import('./src/core/view.js');
  const { passageExits } = await import('./src/world/passage.js');
  const { freeWallsForLevel } = await import('./world-engine.js');
  const { roomTagFor } = await import('./world-model.js');
  const { WALL_HEIGHT } = await import('./src/constants.js');

  moveToWorldHex(0n, 0n, 0n);
  const mesh = renderedWorld.children.find(child => child.isMesh && child.userData.plaques);
  if (!mesh) return { error: 'no markings were built' };

  const position = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  const marks = [];
  for (let quad = 0; quad < position.count / 4; quad++) {
    const at = index => ({
      x: position.getX(quad * 4 + index),
      y: position.getY(quad * 4 + index),
      z: position.getZ(quad * 4 + index),
      v: uv.getY(quad * 4 + index),
    });
    const origin = at(0);
    const acrossTop = at(1);
    const belowOrigin = at(2);
    // The face normal as the winding declares it: a marking that faced up would
    // be invisible from the floor and perfectly correct seen from above.
    const down = { x: belowOrigin.x - origin.x, z: belowOrigin.z - origin.z };
    const across = { x: acrossTop.x - origin.x, y: acrossTop.y - origin.y, z: acrossTop.z - origin.z };
    marks.push({
      facesDown: down.z * across.x - down.x * across.z,
      textureTopIsUp: origin.v - belowOrigin.v,
      lies: Math.abs(origin.y - belowOrigin.y),
      height: origin.y,
      width: Math.hypot(across.x, across.y, across.z),
      // A plaque hangs upright: its two upper corners are level with each other
      // and above the lower pair.
      hangs: origin.y - belowOrigin.y,
      acrossIsLevel: Math.abs(across.y),
    });
  }

  const said = [];
  for (const wall of freeWallsForLevel(world.room.level)) {
    const exits = passageExits(world.room, wall);
    for (const way of ['ahead', 'left', 'right']) {
      const there = exits[way];
      said.push(roomTagFor(there.q, there.r, there.level));
    }
  }
  return { marks, said, tags: mesh.userData.plaques, ceiling: WALL_HEIGHT };
});

assert.ok(!signs.error, signs.error ?? 'the ways out are named');
assert.equal(signs.marks.length, 6, 'two passages, three ways on from each');
const flat = signs.marks.filter(mark => mark.lies < 1e-6);
const upright = signs.marks.filter(mark => mark.lies >= 1e-6);
assert.equal(flat.length, 4, 'the two side openings of each passage are named on a ceiling');
assert.equal(upright.length, 2, 'and the way ahead over its own entrance');

for (const [index, mark] of signs.marks.entries()) {
  assert.ok(mark.textureTopIsUp > 0, `marking ${index}: the top of the label must be at the top of its cell`);
}
for (const mark of flat) {
  // A marking that faced up would be invisible from the floor and perfectly
  // correct seen from above, which no screenshot would catch.
  assert.ok(mark.facesDown !== 0, 'a ceiling marking must have a face, not lie edge-on');
  assert.ok(
    Math.abs(mark.height - signs.ceiling) < 1e-6,
    `a ceiling marking belongs on the ceiling, found at ${mark.height}`,
  );
  assert.ok(Math.abs(mark.width - 7.4) < 1e-6, 'and on the same plane a built room uses');
}
for (const mark of upright) {
  assert.ok(mark.hangs > 0, 'a plaque over an entrance must not hang upside down');
  assert.ok(mark.acrossIsLevel < 1e-6, 'and its lettering must run level, not up the beam');
  assert.ok(
    mark.height > 2.4 && mark.height < 3.05,
    `a plaque belongs on the beam over the entrance, found at ${mark.height}`,
  );
}
assert.deepEqual(signs.tags, signs.said, 'each marking names the chamber its way out actually leads to');
assert.ok(
  signs.tags.every(tag => tag.startsWith('h-')),
  'a ceiling carries the world\'s own name for a chamber, never the walker\'s number',
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
