/**
 * Two storeys up the flight and two back down, on foot, in a real browser.
 *
 * The stair is the only way between floors, so this walks it the way a player
 * does: steering by the walker's own movement and collision, one frame at a
 * time, with the storey change left to syncStair. To climb a second storey the
 * walker has to leave the bridge at its head, go round the well on the floor
 * above and come back onto the bridge at its foot, so the test also proves the
 * way between the two ends of a floor exists.
 *
 * What it holds the climb to:
 * - each flight changes the level by exactly one and nothing else: same q/r,
 *   same x/z at the crossing, feet back on the floor;
 * - the doorways turn with the level while the bridge stays put;
 * - only one chamber is ever in the scene;
 * - coming back down lands in the very chamber the climb started from, with
 *   the same address and the same volumes on its shelves.
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

function startServer() {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(request.url.split('?')[0]);
    // The page has no icon; a full browser asks for one anyway, and a 404 for
    // it would read as the page logging an error.
    if (path === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
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
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text() + ' ' + message.location().url); });
page.on('pageerror', error => consoleErrors.push(String(error)));

await page.goto(origin, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#startup-state').textContent === 'ready', null, { timeout: 30000 });

const climb = await page.evaluate(async () => {
  const { camera, renderedWorld } = await import('./src/core/view.js');
  const { moveToWorldHex, syncDoorways, syncStair, world } = await import('./src/world/rooms.js');
  const { movePlayer } = await import('./src/input/controls.js');
  const { bridgeCoordinates } = await import('./src/world/well.js');
  const { freeWallsForLevel } = await import('./world-engine.js');
  const { player } = await import('./src/player.js');
  const c = await import('./src/constants.js');

  const FRAME = 1 / 60;
  const key = hex => `${hex.q},${hex.r},${hex.level}`;
  const chambersInScene = () => renderedWorld.children.filter(child => child.userData.q !== undefined);

  // The bridge frame, recovered from the module's own projection so the test
  // does not restate the angle the bridge is built at.
  const ux = bridgeCoordinates(1, 0).u;
  const uz = bridgeCoordinates(0, 1).u;
  const onBridge = u => ({ x: ux * u, z: uz * u });

  // The walkable ring between the guard and the shelves, as points on its
  // midline. The guard and the room are hexagons with the same orientation,
  // so the ring is one width all round: its edge midpoints lie at `ring`
  // from the centre, its corners further out by 1 / cos 30°.
  const guard = c.WELL_GUARD_RADIUS * Math.cos(Math.PI / 6);
  const ring = (guard + c.APOTHEM) / 2 - 1;
  const ringPoint = (degrees, corner) => {
    const radius = corner ? ring / Math.cos(Math.PI / 6) : ring;
    const angle = degrees * Math.PI / 180;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
  };
  // The bridge meets the ring at the angle it leaves the centre by.
  const bridgeAngle = Math.atan2(uz, ux) * 180 / Math.PI;

  // The way round the ring between two angles, in steps of 30°: edge
  // midpoints and corners alternate, so the path never cuts across the guard.
  // A corner is a multiple of 60°, because that is where the hexagons have them.
  const roundTheWell = (from, to) => {
    const points = [];
    const direction = Math.sign(to - from);
    for (let degrees = from + direction * 30; direction * (to - degrees) >= 0; degrees += direction * 30) {
      const corner = Math.abs(Math.round(degrees / 30)) % 2 === 0;
      points.push(ringPoint(degrees, corner));
    }
    return points;
  };

  const climbs = [];
  const layout = () => {
    let hash = 0;
    let volumes = 0;
    for (const room of chambersInScene()) {
      for (const mesh of room.userData.bookMeshes) {
        for (const record of mesh.userData.records) {
          volumes++;
          const text = String(record.bookIndex) + '|' + record.worldLocation;
          for (let index = 0; index < text.length; index++) hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
        }
      }
    }
    return { hash, volumes };
  };
  const observe = () => ({
    room: key(world.room),
    address: world.address,
    x: camera.position.x,
    z: camera.position.z,
    footY: camera.position.y - c.EYE_HEIGHT,
    chambers: chambersInScene().length,
    freeWalls: [...freeWallsForLevel(world.room.level)],
    ...layout(),
  });

  let maxChambers = 0;
  let doorwaysCrossed = 0;

  // Walk at a point the way the loop does: movement and collision, then the
  // storey check, then the threshold check.
  const walkTo = (target, limit = 3000) => {
    for (let frame = 0; frame < limit; frame++) {
      const dx = target.x - camera.position.x;
      const dz = target.z - camera.position.z;
      if (Math.hypot(dx, dz) < 0.2) return true;
      player.yaw = Math.atan2(-dx, -dz);
      movePlayer(FRAME, 1, 0, false);
      const before = observe();
      const climbed = syncStair();
      if (climbed) climbs.push({ delta: climbed, before, after: observe() });
      if (syncDoorways()) doorwaysCrossed++;
      maxChambers = Math.max(maxChambers, chambersInScene().length);
    }
    return false;
  };

  const legs = [];
  const leg = (name, points) => {
    let missed = null;
    for (const point of points) {
      if (!walkTo(point) && !missed) missed = { x: point.x, z: point.z, atX: camera.position.x, atZ: camera.position.z };
    }
    legs.push({ name, missed, ...observe() });
  };

  moveToWorldHex(0n, 0n, 0n);
  const start = observe();
  const startPoint = { x: start.x, z: start.z };

  // Off the bridge's reach is the ring; well inside it is the deck.
  const foot = c.WELL_GUARD_RADIUS;
  const deck = c.STAIR_HALF_RUN + 4;

  // The walk begins on the ring; the foot of the bridge is half way round.
  const startAngle = Math.round(Math.atan2(start.z, start.x) * 180 / Math.PI / 30) * 30;
  const footAngle = bridgeAngle - 180;
  const toFoot = [...roundTheWell(startAngle, footAngle), onBridge(-foot), onBridge(-deck)];
  const headToFoot = [onBridge(foot), ...roundTheWell(bridgeAngle, bridgeAngle + 180), onBridge(-foot), onBridge(-deck)];
  const footToHead = [onBridge(-foot), ...roundTheWell(bridgeAngle + 180, bridgeAngle), onBridge(foot), onBridge(deck)];

  leg('to the foot of the bridge', toFoot);
  leg('up the first flight', [onBridge(deck)]);
  leg('round the well above', headToFoot);
  leg('up the second flight', [onBridge(deck)]);
  leg('down the second flight', [onBridge(-deck)]);
  leg('round the well below', footToHead);
  leg('down the first flight', [onBridge(-deck)]);
  leg('back to where the walk began', [onBridge(-foot), ...roundTheWell(footAngle, startAngle), startPoint]);

  return { start, legs, climbs, maxChambers, doorwaysCrossed, bridgeAngle };
});

const legNamed = name => climb.legs.find(leg => leg.name === name);
for (const leg of climb.legs) {
  const { missed } = leg;
  assert.equal(
    missed,
    null,
    missed && `${leg.name}: the walker cannot reach ${missed.x.toFixed(2)}, ${missed.z.toFixed(2)} on foot; stopped at ${missed.atX.toFixed(2)}, ${missed.atZ.toFixed(2)}`,
  );
}

assert.equal(climb.doorwaysCrossed, 0, 'going round the well never strays into a passage');
assert.equal(climb.maxChambers, 1, 'only one chamber is ever in the scene, whichever storey it is');

// Four crossings, in order: up, up, down, down.
assert.deepEqual(climb.climbs.map(entry => entry.delta), [1, 1, -1, -1], 'two storeys up and two down, one at a time');
assert.deepEqual(
  climb.climbs.map(entry => entry.after.room),
  ['0,0,1', '0,0,2', '0,0,1', '0,0,0'],
  'each flight leads to the chamber directly above or below, never beside',
);
for (const [index, entry] of climb.climbs.entries()) {
  const where = `crossing ${index + 1}`;
  assert.equal(entry.after.x, entry.before.x, `${where}: the walker keeps their x`);
  assert.equal(entry.after.z, entry.before.z, `${where}: and their z`);
  assert.equal(entry.after.footY, 0, `${where}: with their feet on the new floor`);
  assert.equal(entry.after.volumes, 3840, `${where}: in a whole chamber`);
  assert.notDeepEqual(entry.after.freeWalls, entry.before.freeWalls, `${where}: whose doorways have turned with the level`);
}

assert.equal(legNamed('up the first flight').room, '0,0,1', 'the first flight ends on the floor above');
assert.equal(legNamed('up the second flight').room, '0,0,2', 'and the second on the floor above that');
assert.equal(legNamed('down the first flight').room, '0,0,0', 'the way down ends where the way up began');

const end = climb.legs.at(-1);
assert.equal(end.room, climb.start.room, 'the walk ends in the chamber it began in');
assert.equal(end.address, climb.start.address, 'at the same address');
assert.equal(end.hash, climb.start.hash, 'with the same volumes in the same places');
assert.equal(end.footY, 0, 'standing on its floor');
assert.ok(Math.hypot(end.x - climb.start.x, end.z - climb.start.z) < 0.2, 'where the walk began');

assert.deepEqual(consoleErrors, [], 'the climb must not log an error');

await browser.close();
server.close();
console.log('stairs: two storeys up and two down on foot, one chamber at a time, back to the same shelves');
