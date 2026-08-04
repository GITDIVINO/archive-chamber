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

// --- the stair ---------------------------------------------------------------
// The level coordinate existed in the placement and nothing reached it: the
// axis of the free walls turned as you climbed, and there was no way to climb.
// The stair is in the passage, which is the only place it costs nothing — a
// passage is already outside the plane, so a bay off it takes no wall from any
// chamber and no cell from the map.
const stair = await page.evaluate(async () => {
  const { camera } = await import('./src/core/view.js');
  const { moveToWorldHex, syncDoorways, world } = await import('./src/world/rooms.js');
  const { freeWallsForLevel } = await import('./world-engine.js');
  const doors = await import('./src/world/doors.js');
  const c = await import('./src/constants.js');

  const intoBay = (half) => {
    const wall = freeWallsForLevel(world.room.level)[0];
    const { basis } = doors.wallCoordinates(wall, 0, 0);
    // The bay is on the walker's left, which is negative tangent; the well is
    // the half nearer the mouth and the flight the half beyond it.
    const normal = c.HALL_START + c.STAIR_CENTRE + half;
    const tangent = -(c.STAIR_EXIT_REACH + 0.1);
    camera.position.x = basis.nx * normal + basis.tx * tangent;
    camera.position.z = basis.nz * normal + basis.tz * tangent;
    return doors.crossedPassageExit(camera.position, world.room.level);
  };
  const record = () => ({
    q: String(world.room.q), r: String(world.room.r), level: String(world.room.level),
    depth: Math.hypot(camera.position.x, camera.position.z),
  });

  moveToWorldHex(3n, -2n, 0n);
  const home = record();
  const readsUp = intoBay(0.5);
  const readsDown = intoBay(-0.5);
  // Blank wall opposite the bay: the stair is cut into one side only.
  const wall = freeWallsForLevel(0n)[0];
  const { basis } = doors.wallCoordinates(wall, 0, 0);
  const mirroredNormal = c.HALL_START + c.STAIR_CENTRE;
  const mirroredTangent = c.STAIR_EXIT_REACH + 0.1;
  const opposite = doors.crossedPassageExit({
    x: basis.nx * mirroredNormal + basis.tx * mirroredTangent,
    y: 1.65,
    z: basis.nz * mirroredNormal + basis.tz * mirroredTangent,
  }, 0n);

  moveToWorldHex(3n, -2n, 0n);
  intoBay(0.5);
  const climbed = Boolean(syncDoorways());
  const above = record();
  // And back down, which is a different passage — the axis turned — but the
  // same chamber. Without that the stair would be a one-way door.
  intoBay(-0.5);
  const descended = Boolean(syncDoorways());
  const back = record();

  return {
    home, readsUp, readsDown, opposite, climbed, above, descended, back,
    axisBelow: freeWallsForLevel(0n), axisAbove: freeWallsForLevel(1n),
    roomRadius: c.ROOM_RADIUS,
  };
});

assert.equal(stair.readsUp.exit, 'up', 'the flight is the half beyond the middle of the bay');
assert.equal(stair.readsDown.exit, 'down', 'the well is the half nearer the mouth');
assert.equal(stair.opposite, null, 'the wall facing the stair is blank: one stair to a passage');

assert.equal(stair.climbed, true, 'stepping onto the flight climbs a storey');
assert.equal(stair.above.level, '1', 'and lands one level up');
assert.deepEqual(
  [stair.above.q, stair.above.r],
  [stair.home.q, stair.home.r],
  'directly above the chamber the passage belongs to, which is where the map says the walker stands',
);
assert.ok(stair.above.depth < stair.roomRadius, 'the walker arrives inside the chamber, not in a doorway');
assert.notDeepEqual(
  stair.axisAbove, stair.axisBelow,
  'the free walls turn with the level — otherwise there is nothing up there worth the climb',
);

assert.equal(stair.descended, true, 'and the well descends again');
assert.deepEqual(
  [stair.back.q, stair.back.r, stair.back.level],
  [stair.home.q, stair.home.r, stair.home.level],
  'up then down is the same chamber: the way back is another passage, but not another place',
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

// --- the signs over a passage's ways out ------------------------------------
// A junction offers three identical openings onto three identical chambers, so
// each carries a plaque. Lettering in this project has been built mirrored
// before — the cabinet numerals were, once — and an oblique view of a plaque is
// no way to tell, so the winding and the texture coordinates are checked
// against where a reader would actually stand.
const signs = await page.evaluate(async () => {
  const { moveToWorldHex, world } = await import('./src/world/rooms.js');
  const { renderedWorld } = await import('./src/core/view.js');
  const { passageExits } = await import('./src/world/passage.js');
  const { freeWallsForLevel } = await import('./world-engine.js');
  const { ordinalFor } = await import('./src/world/register.js');
  const { roomTagFor } = await import('./world-model.js');

  moveToWorldHex(0n, 0n, 0n);
  const mesh = renderedWorld.children.find(child => child.isMesh && child.userData.plaques);
  if (!mesh) return { error: 'no signs were built' };

  const position = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  const plaques = [];
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
    // The face normal as the winding declares it, so this fails if the quad is
    // ever wound the other way and the plaque faces into the wall.
    const down = { x: belowOrigin.x - origin.x, y: belowOrigin.y - origin.y, z: belowOrigin.z - origin.z };
    const across = { x: acrossTop.x - origin.x, y: acrossTop.y - origin.y, z: acrossTop.z - origin.z };
    const normal = {
      x: down.y * across.z - down.z * across.y,
      z: down.x * across.y - down.y * across.x,
    };
    // A reader faces the plaque, so they look along -normal, and their right
    // hand points forward x up. The lettering must run that way.
    const right = { x: normal.z, z: -normal.x };
    plaques.push({
      readsRightward: across.x * right.x + across.z * right.z,
      firstCornerIsTop: origin.y - belowOrigin.y,
      textureTopIsUp: origin.v - belowOrigin.v,
      height: origin.y,
    });
  }

  // And what each plaque says, in the order they were built.
  const said = [];
  for (const wall of freeWallsForLevel(world.room.level)) {
    const exits = passageExits(world.room, wall);
    for (const way of ['ahead', 'left', 'right']) {
      const there = exits[way];
      const ordinal = ordinalFor(there);
      said.push(ordinal === null ? roomTagFor(there.q, there.r, there.level) : String(ordinal));
    }
  }
  return { plaques, said, legends: mesh.userData.plaques };
});

assert.ok(!signs.error, signs.error ?? 'the passages are signed');
assert.equal(signs.plaques.length, 6, 'two passages, three ways on from each');
for (const [index, plaque] of signs.plaques.entries()) {
  assert.ok(plaque.readsRightward > 0, `plaque ${index}: the lettering must run to the reader's right, not away from it`);
  assert.ok(plaque.firstCornerIsTop > 0, `plaque ${index}: the plaque must not hang upside down`);
  assert.ok(plaque.textureTopIsUp > 0, `plaque ${index}: the top of the label must be at the top of the plaque`);
  assert.ok(plaque.height > 2.4 && plaque.height < 3.05, `plaque ${index}: a sign belongs on the lintel, not in the doorway`);
}
assert.deepEqual(signs.legends, signs.said, 'each plaque names the chamber that opening actually leads to');
assert.ok(
  signs.legends.some(text => /^\d+$/.test(text)),
  'a chamber already entered is signed with the number the walker gave it',
);
assert.ok(
  signs.legends.some(text => text.startsWith('h-')),
  'a chamber never entered is signed with the only name it has, its own',
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
