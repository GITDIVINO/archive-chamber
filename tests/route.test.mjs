/**
 * A long walk out and the same walk home, in a real browser.
 *
 * The passage suite proves on paper that every step has a way back. This one
 * walks it: thirty thresholds out through whichever exits a fixed sequence
 * picks, then the same chambers in reverse, crossing each threshold the way a
 * player would, against the page's own camera, room registry and renderer.
 *
 * What it holds the walk to:
 * - every crossing lands in exactly the chamber the passage model names;
 * - only one chamber is ever in the scene, so the one left behind is released;
 * - the renderer holds no more geometry or textures in a chamber on the way
 *   home than it did in that chamber on the way out, so nothing leaks;
 * - every chamber shows the same 3840 volumes, tag and address both times.
 *
 * It runs apart from the smoke suite and touches no interface control, so it
 * says something about walking even while a click elsewhere is broken.
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

// Each crossing builds a whole chamber of 3840 volumes in a software renderer,
// so the walk is as long as it needs to be to wander, and no longer.
const STEPS = 30;

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

async function walk(level) {
  return page.evaluate(async ({ steps, level }) => {
    const { camera, render, renderer, renderedWorld } = await import('./src/core/view.js');
    const { moveToWorldHex, paintRoomLabels, syncDoorways, world } = await import('./src/world/rooms.js');
    const { freeWallsForLevel } = await import('./world-engine.js');
    const { passageExits } = await import('./src/world/passage.js');
    const doors = await import('./src/world/doors.js');
    const c = await import('./src/constants.js');

    const key = hex => `${hex.q},${hex.r},${hex.level}`;
    const same = (a, b) => key(a) === key(b);
    const chambersInScene = () => renderedWorld.children.filter(child => child.userData.q !== undefined);

    // Where to stand to cross each exit, measured from the current chamber's
    // centre: past the far end for ahead, at the side opening for a turn.
    const standAt = (wall, exit) => {
      const { basis } = doors.wallCoordinates(wall, 0, 0);
      const normal = exit === 'ahead' ? c.HALL_END + 0.2 : c.HALL_START + c.HALL_SIDE_CENTRE;
      const tangent = exit === 'ahead' ? 0 : (exit === 'right' ? 1 : -1) * (c.SIDE_EXIT_REACH + 0.1);
      camera.position.x = basis.nx * normal + basis.tx * tangent;
      camera.position.z = basis.nz * normal + basis.tz * tangent;
    };

    // Lettering is painted over several frames and uploaded as a texture, so
    // a chamber is measured only once it is finished and has been drawn. The
    // renderer uploads only what the camera can see, and the pose after a turn
    // aside differs from the pose after walking straight, so culling is lifted
    // for that one frame: otherwise the count would measure the view, not what
    // is still held. render() skips a frame while the last one is still on the
    // GPU, and a WebGL fence reports done only once the page yields, which this
    // walk never does. So the GPU is drained first and the fence is taken as
    // done for this one frame, and every measured frame is really drawn.
    const settle = () => {
      for (let pass = 0; pass < 50; pass++) paintRoomLabels(1000);
      const culled = [];
      renderedWorld.traverse(object => {
        if (object.frustumCulled) culled.push(object);
        object.frustumCulled = false;
      });
      const gl = renderer.getContext();
      const status = gl.getSyncParameter;
      gl.finish();
      gl.getSyncParameter = (sync, name) => (name === gl.SYNC_STATUS ? gl.SIGNALED : status.call(gl, sync, name));
      render();
      gl.getSyncParameter = status;
      for (const object of culled) object.frustumCulled = true;
    };

    // Every volume on the shelves, in order, reduced to one number.
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
      tag: world.tag,
      address: world.address,
      chambers: chambersInScene().length,
      sceneChildren: renderedWorld.children.length,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      ...layout(),
    });

    const cross = (wall, exit) => {
      const from = world.room;
      const expected = passageExits(from, wall)[exit];
      standAt(wall, exit);
      const entered = syncDoorways();
      settle();
      return { entered: Boolean(entered), expected: key(expected), ...observe() };
    };

    moveToWorldHex(0n, 0n, BigInt(level));
    settle();
    const start = observe();

    // A fixed sequence, so a failure names the same step on every run. It
    // leans towards turning aside: those are the crossings that rebuild the
    // pose rather than carry it, and the ones that cannot simply be retraced.
    const free = freeWallsForLevel(BigInt(level));
    const exits = ['left', 'right', 'ahead'];
    let seed = 0x5eed + level;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16;

    const route = [start.room];
    const out = [];
    const trail = [world.room];
    for (let step = 0; step < steps; step++) {
      const wall = free[next() % free.length];
      const exit = exits[next() % exits.length];
      out.push({ wall, exit, ...cross(wall, exit) });
      route.push(key(world.room));
      trail.push(world.room);
    }

    // Home by the same chambers in reverse. A straight crossing is undone by
    // the facing passage; a turn is not retraceable, so the one exit that
    // leads back is looked up — the passage suite proves there always is one.
    const back = [];
    for (let step = trail.length - 2; step >= 0; step--) {
      const target = trail[step];
      let way = null;
      for (const wall of free) {
        for (const exit of exits) {
          if (!way && same(passageExits(world.room, wall)[exit], target)) way = { wall, exit };
        }
      }
      if (!way) {
        back.push({ missing: true, from: key(world.room), to: key(target) });
        break;
      }
      back.push({ ...way, ...cross(way.wall, way.exit) });
    }

    return { start, out, back, route, end: observe() };
  }, { steps: STEPS, level });
}

for (const level of [0, 1]) {
  const { start, out, back, route, end } = await walk(level);
  const label = step => `level ${level}, step ${step}`;

  assert.equal(start.chambers, 1, `level ${level}: one chamber in the scene at the start`);
  assert.equal(start.volumes, 3840, `level ${level}: the starting chamber holds 3840 volumes`);

  for (const [index, step] of [...out, ...back].entries()) {
    assert.ok(!step.missing, `${label(index)}: no one-step way from ${step.from} back to ${step.to}`);
    assert.equal(step.entered, true, `${label(index)}: crossing by ${step.exit} of wall ${step.wall} enters a chamber`);
    assert.equal(step.room, step.expected, `${label(index)}: lands where the passage model says`);
    assert.equal(step.chambers, 1, `${label(index)}: the chamber left behind is released`);
    assert.equal(step.sceneChildren, start.sceneChildren, `${label(index)}: nothing else accumulates in the scene`);
    assert.equal(step.volumes, 3840, `${label(index)}: a whole chamber is built`);
  }

  // The route really goes somewhere, and not along one line.
  const visited = new Set(route);
  assert.ok(visited.size >= 12, `level ${level}: the walk reaches at least twelve chambers, reached ${visited.size}`);

  // Walking home passes the same chambers in the opposite order, and each
  // is exactly as it was: same name, same shelves, same cost in memory.
  assert.equal(back.length, out.length, `level ${level}: every step out has a step back`);
  // The last chamber out is where the way home begins, so it has no pair.
  for (let index = 0; index < out.length - 1; index++) {
    const going = out[index];
    const coming = back[out.length - 2 - index];
    const where = `level ${level}, chamber ${going.room}`;
    assert.equal(coming.room, going.room, `${where}: the way home passes the same chamber`);
    assert.equal(coming.tag, going.tag, `${where}: its tag is unchanged`);
    assert.equal(coming.address, going.address, `${where}: its address is unchanged`);
    assert.equal(coming.hash, going.hash, `${where}: its shelves hold the same volumes in the same places`);
    assert.equal(coming.geometries, going.geometries, `${where}: no geometry is left over from the walk`);
    assert.equal(coming.textures, going.textures, `${where}: no texture is left over from the walk`);
  }

  assert.equal(end.room, start.room, `level ${level}: the walk ends where it began`);
  assert.equal(end.address, start.address, `level ${level}: at the same address`);
  assert.equal(end.hash, start.hash, `level ${level}: with the same shelves`);
  assert.equal(end.geometries, start.geometries, `level ${level}: holding the same geometry as before the walk`);
  assert.equal(end.textures, start.textures, `level ${level}: and the same textures`);
}

assert.deepEqual(consoleErrors, [], 'the walk must not log an error');

await browser.close();
server.close();
console.log(`route: ${STEPS} crossings out and back on two levels, one chamber at a time, nothing retained`);
