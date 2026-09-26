/**
 * Headless smoke test.
 *
 * The unit suites cover the catalogue and placement mathematics.  This one
 * covers what they cannot: that the page actually boots, builds a room in
 * WebGL, opens the three reader paths, and does so without flooding the GPU
 * with draw calls or logging an error.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

// A draw call per volume is the regression this guards against: a room of 3840
// books once cost ~1200 calls, and instancing brought it under twenty.
const MAX_DRAW_CALLS_PER_FRAME = 60;
const MAX_VISTA_VERTICES = 350000;
const MAX_VISTA_TRIANGLES = 180000;

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
  /^w3;/,
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

// --- the chamber opens vertically -------------------------------------------
// The well is an actual hole through a solid floor, not transparent paint. It
// repeats with its balustrade far enough in both directions for fog to hide the
// ends, and collision keeps the walker on the safe side of the guard.
const vertical = await page.evaluate(async () => {
  const THREE = await import('three');
  const { renderedWorld, renderer, scene } = await import('./src/core/view.js');
  const {
    ceilingMaterial,
    floorMaterial,
    vistaCeilingMaterial,
    vistaFloorMaterial,
    wallMaterial,
  } = await import('./src/core/materials.js');
  const {
    STAIR_HALF_RUN,
    WELL_RADIUS,
    WORLD_CEILING_COLOR,
    WORLD_DISTANCE_COLOR,
    WORLD_FLOOR_COLOR,
    WORLD_SURFACE_COLOR,
  } = await import('./src/constants.js');
  const { VERTICAL_VISTA_DEPTH } = await import('./src/world/vista.js');
  const { constrainFromWell, WELL_BALUSTRADE_PARTS } = await import('./src/world/well.js');
  const vista = renderedWorld.children.find(child => child.userData.verticalChambers !== undefined);
  const room = renderedWorld.children.find(child => child.userData.q !== undefined);
  const bounds = new THREE.Box3().setFromObject(vista);
  const litVistaMeshes = [];
  vista.traverse(child => {
    if (child.isMesh && (child.material?.isMeshLambertMaterial || child.material?.isMeshStandardMaterial)) litVistaMeshes.push(child);
  });
  const openings = room.children.filter(child => child.userData.wellOpening);
  const centre = { x: 0, y: 0, z: 0 };
  const constrained = constrainFromWell(centre);
  let roomPointLights = 0;
  let shadowCasters = 0;
  let vistaShadowCasters = 0;
  room.traverse(child => {
    if (child.isPointLight) roomPointLights++;
    if (child.castShadow) shadowCasters++;
  });
  vista.traverse(child => { if (child.castShadow) vistaShadowCasters++; });
  return {
    minY: bounds.min.y,
    maxY: bounds.max.y,
    verticalPassages: vista.userData.verticalPassages,
    expectedVerticalPassages: VERTICAL_VISTA_DEPTH * 4,
    solidSlabs: !floorMaterial.transparent && !ceilingMaterial.transparent,
    structuralColours: [
      floorMaterial.color.getHex(),
      ceilingMaterial.color.getHex(),
      wallMaterial.color.getHex(),
      vistaFloorMaterial.color.getHex(),
      vistaCeilingMaterial.color.getHex(),
      scene.background.getHex(),
      scene.fog.color.getHex(),
    ],
    expectedStructuralColours: [
      WORLD_FLOOR_COLOR,
      WORLD_CEILING_COLOR,
      WORLD_SURFACE_COLOR,
      WORLD_FLOOR_COLOR,
      WORLD_CEILING_COLOR,
    ],
    expectedDistanceColour: WORLD_DISTANCE_COLOR,
    structuralMaterialsAreLit: [
      floorMaterial,
      ceilingMaterial,
      wallMaterial,
      vistaFloorMaterial,
      vistaCeilingMaterial,
    ].every(material => material.isMeshLambertMaterial || material.isMeshStandardMaterial),
    litVistaMeshCount: litVistaMeshes.length,
    litVistaMeshesHaveNormals: litVistaMeshes.every(
      mesh => Boolean(mesh.geometry.getAttribute('normal')),
    ),
    lightTypes: scene.children.filter(child => child.isLight).map(child => child.type),
    vistaPlaneMaterialsShared:
      vistaFloorMaterial === floorMaterial && vistaCeilingMaterial === ceilingMaterial,
    hasViewDependentCutoff: [vistaFloorMaterial, vistaCeilingMaterial]
      .some(material => material.userData.vistaViewCutoff !== undefined),
    shadowMapEnabled: renderer.shadowMap.enabled,
    shadowMapType: renderer.shadowMap.type,
    shadowLights: scene.children.filter(child => child.isLight && child.castShadow).length,
    shadowCasters,
    vistaShadowCasters,
    roomPointLights,
    lampCount: room.userData.lampCount,
    readingLampCount: room.userData.readingLampCount,
    openingCount: openings.length,
    openingRadii: openings.map(mesh => mesh.geometry.parameters.innerRadius),
    expectedRadius: WELL_RADIUS,
    expectedStairCut: STAIR_HALF_RUN,
    balustradeParts: room.userData.wellBalustradeParts,
    expectedParts: WELL_BALUSTRADE_PARTS.length,
    constrained,
    constrainedRadius: Math.hypot(centre.x, centre.z),
  };
});
assert.ok(vertical.minY < -100, `the chambers below must disappear into fog, ending at ${vertical.minY.toFixed(1)}`);
assert.ok(vertical.maxY > 100, `the chambers above must disappear into fog, ending at ${vertical.maxY.toFixed(1)}`);
assert.equal(
  vertical.verticalPassages,
  vertical.expectedVerticalPassages,
  'every stacked chamber carries exactly two passages and no repeated horizontal room chains',
);
assert.equal(vertical.solidSlabs, true, 'floor and ceiling around the well must be solid');
assert.ok(
  vertical.structuralColours.slice(0, 5).every(
    (colour, index) => colour === vertical.expectedStructuralColours[index],
  )
    && vertical.structuralColours.slice(5).every(colour => colour === vertical.expectedDistanceColour),
  'floor, ceiling and wall keep a stable material palette while fog and the open well share one darker distance colour',
);
assert.equal(vertical.structuralMaterialsAreLit, true, 'one paper colour must still respond to scene lighting');
assert.ok(vertical.litVistaMeshCount > 0, 'the vista must contain lit structural meshes');
assert.equal(vertical.litVistaMeshesHaveNormals, true, 'merged lit geometry must carry surface normals');
assert.deepEqual(
  vertical.lightTypes.sort(),
  ['AmbientLight', 'DirectionalLight', 'HemisphereLight'],
  'soft ambient, sky and directional light must separate floor, wall and ceiling',
);
assert.equal(vertical.vistaPlaneMaterialsShared, true, 'active and distant slabs must obey the same material rules');
assert.equal(vertical.hasViewDependentCutoff, false, 'no floor or ceiling may disappear because the camera turns');
assert.equal(vertical.shadowMapEnabled, true, 'the active room must render stable architectural shadows');
assert.equal(vertical.shadowLights, 1, 'one bounded key light supplies shadows without multiplying their cost');
assert.ok(vertical.shadowCasters > 0, 'the active room architecture must cast shadows');
assert.equal(vertical.vistaShadowCasters, 0, 'distant geometry must never spend the active shadow budget');
assert.equal(vertical.roomPointLights, 2, 'the two doorway lanterns supply the bounded local-light budget');
assert.equal(vertical.lampCount, 2, 'the room records one canonical lamp at each exit');
assert.equal(vertical.readingLampCount, 0, 'cabinet and stair lights stay emissive without multiplying point-light passes');
assert.equal(vertical.openingCount, 2, 'the current chamber needs the same opening in its floor and ceiling');
assert.ok(vertical.openingRadii.every(radius => radius === vertical.expectedRadius), 'both openings must follow the frozen well radius');
assert.equal(vertical.balustradeParts, vertical.expectedParts, 'the full balustrade must be built around the opening');
assert.equal(vertical.constrained, true, 'the well guard must stop a walker entering its centre');
assert.ok(
  vertical.constrainedRadius > vertical.expectedStairCut,
  'at the bridge centre collision must return the walker beyond the stair cut in the deck',
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
//
// Closing a panel returns the walker to the chamber, and on a desktop that
// means pointer lock on the world canvas. While the lock holds, every click
// goes to the canvas whatever is drawn over it; that is what "canvas intercepts
// pointer events" meant on Linux CI, where headless Chromium grants the lock
// (macOS headless does not, which is why it passed locally). A player gets the
// cursor back with Escape, which the browser handles itself and a synthetic key
// press never reaches, so release it the same way the browser would.
async function takeBackCursor() {
  const locked = await page.evaluate(() => document.pointerLockElement?.className ?? null);
  if (locked === null) return;
  assert.equal(locked, 'world-canvas', 'returning to the chamber locks the pointer to the world, not to a panel');
  await page.evaluate(() => new Promise(resolve => {
    document.addEventListener('pointerlockchange', resolve, { once: true });
    document.exitPointerLock();
  }));
}

async function openCatalogue() {
  if (await page.locator('#book-panel.visible').count()) {
    await page.locator('#close-book').click();
    await page.waitForSelector('#book-panel.visible', { state: 'detached' });
  }
  await takeBackCursor();
  await page.locator('#open-search').click();
}

async function openAddress(address) {
  await openCatalogue();
  await page.locator('#address-input').fill(address);
  await page.locator('#address-submit').click();
}

await openAddress('w3;0;2;2;13;197');
await page.waitForSelector('#book-panel.visible');
assert.equal(await page.locator('.page-counter span').first().textContent(), '197');
assert.equal(await page.locator('#book-address').textContent(), 'w3;0;2;2;13;197');
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
assert.equal(await page.locator('#book-address').textContent(), 'w3;0;2;2;13;198');

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
await page.locator('#address-input').focus();
await page.locator('#address-input').selectText();
// Playwright's `fill` deliberately refuses an overlong value in recent
// Chromium builds and leaves the previous address untouched. `insertText`
// follows the browser's real editing path, which is the contract exercised
// here: maxlength accepts the prefix and truncates the remainder.
await page.keyboard.insertText('w3;' + '1'.repeat(20000));
assert.equal(
  (await page.locator('#address-input').inputValue()).length,
  8192,
  'the field truncates to its maximum length',
);

// Even a maximal address must be answered promptly rather than blocking. Time
// the synchronous application handler inside the page; Playwright's action
// bookkeeping and a software WebGL renderer are not part of this contract.
const maximalResponse = await page.evaluate(() => {
  const started = performance.now();
  document.querySelector('#address-submit').click();
  return {
    elapsed: performance.now() - started,
    text: document.querySelector('#search-result').textContent,
  };
});
assert.notEqual(maximalResponse.text, '', 'a maximal address receives an immediate answer');
assert.ok(maximalResponse.elapsed < 100, `a maximum-length address took ${maximalResponse.elapsed.toFixed(1)} ms`);

// Second line of defence: a value set past the field limit is still refused.
await openCatalogue();
await page.evaluate(() => {
  const input = document.querySelector('#address-input');
  input.removeAttribute('maxlength');
  input.value = 'w3;' + '1'.repeat(50000);
});
const oversizedResponse = await page.evaluate(() => {
  const started = performance.now();
  document.querySelector('#address-submit').click();
  return {
    elapsed: performance.now() - started,
    text: document.querySelector('#search-result').textContent,
  };
});
assert.equal(oversizedResponse.text, 'record is too long for this client');
assert.ok(oversizedResponse.elapsed < 100, `refusing an oversized address took ${oversizedResponse.elapsed.toFixed(1)} ms`);

assert.deepEqual(consoleErrors, [], 'the page must boot without console errors');

// --- the cabinet contains its shelves ----------------------------------------
// The carcase used to be a fixed height while the shelf pitch was tuned
// separately, so the top row stood 35mm inside the head rail. Deriving the
// height fixed it; this keeps the two from drifting apart again.
const cabinet = await page.evaluate(async () => {
  const room = await import('./src/world/room.js');
  const constants = await import('./src/constants.js');
  const babel = await import('./babel-v3.js');
  const geometry = await import('./src/world/geometry.js');
  const topShelfY = constants.SHELF_BASE_Y + (babel.SHELVES_PER_WALL - 1) * constants.SHELF_PITCH;
  const corners = geometry.hexCorners();
  const basis = geometry.wallBasis(0);
  const wallStart = geometry.pointOnWall(basis, -constants.WALL_WIDTH / 2, 0);
  const wallEnd = geometry.pointOnWall(basis, constants.WALL_WIDTH / 2, 0);
  return {
    carcaseHeight: room.CARCASE_HEIGHT,
    railBottom: room.CARCASE_HEIGHT - room.RAIL_THICKNESS,
    topBooksReach: topShelfY + room.SHELF_SURFACE_OFFSET + constants.BOOK_HEIGHT,
    topBookCentre: topShelfY + room.SHELF_SURFACE_OFFSET + constants.BOOK_HEIGHT / 2,
    shelfPitch: constants.SHELF_PITCH,
    shelfThickness: room.SHELF_THICKNESS,
    bookHeight: constants.BOOK_HEIGHT,
    interaction: constants.INTERACTION_DISTANCE,
    roomRadius: constants.ROOM_RADIUS,
    wallWidth: constants.WALL_WIDTH,
    cabinetRunWidth: constants.CABINET_RUN_WIDTH,
    cabinetCornerClearance: constants.CABINET_CORNER_CLEARANCE,
    cabinetUprightsPerWall: room.CABINET_UPRIGHTS_PER_WALL,
    cabinetBookStep: room.CABINET_BOOK_STEP,
    bookWidth: constants.BOOK_WIDTH,
    cornerGap: Math.sqrt(3) * constants.CABINET_CORNER_CLEARANCE
      - (room.CABINET_WALL_INSET - (room.CARCASE_CENTRE_Z - room.CARCASE_DEPTH / 2)),
    wellRadius: constants.WELL_RADIUS,
    wellAreaRatio: constants.WELL_FLOOR_AREA_RATIO,
    wallCornerError: Math.max(
      Math.hypot(wallStart.x - corners[0].x, wallStart.z - corners[0].z),
      Math.hypot(wallEnd.x - corners[1].x, wallEnd.z - corners[1].z),
    ),
  };
});

assert.equal(cabinet.wallWidth, cabinet.roomRadius, 'a regular hex wall must end on the same six corners as its floor');
assert.ok(cabinet.wallCornerError < 1e-12, 'wall endpoints, floor vertices and visible corner arrises must be identical');
assert.equal(cabinet.cabinetUprightsPerWall, 2, 'one continuous cabinet has only its two end uprights');
assert.ok(cabinet.cornerGap > 0.25, 'neighbouring wall cabinets must leave visible air at the hex corner');
assert.ok(cabinet.cabinetBookStep > cabinet.bookWidth, 'individual books remain distinct within the continuous row');
assert.ok(
  Math.abs((cabinet.wellRadius / cabinet.roomRadius) ** 2 - cabinet.wellAreaRatio) < 1e-12,
  'the similar inner hex must occupy exactly seventy percent of the chamber area',
);

const chamberLayout = await page.evaluate(async () => {
  const { renderedWorld } = await import('./src/core/view.js');
  const {
    ALCOVE_REACH,
    APOTHEM,
    DOOR_HEIGHT,
    DOOR_WIDTH,
    HALL_HALF_WIDTH,
    HALL_JUNCTION_CHAMFER,
    HALL_LENGTH,
    HALL_SIDE_CENTRE,
    HALL_SIDE_HALF,
  } = await import('./src/constants.js');
  const { wallBasis } = await import('./src/world/geometry.js');
  const room = renderedWorld.children.find(child => child.userData.q !== undefined);
  const vista = renderedWorld.children.find(child => child.userData.q === undefined);
  const colours = room.userData.bookMeshes.flatMap(mesh => [...mesh.instanceColor.array]);

  // Cut every vista triangle at eye height and clip the resulting segment
  // against a slightly inset active hex. Floors may overlap at a threshold, but
  // no vertical piece of background geometry may enter the room: vista meshes
  // deliberately have no collision and would become walls the player can walk
  // through.
  const eyeY = 1.65;
  const hexLimit = APOTHEM - 0.35;
  const planes = Array.from({ length: 6 }, (_, index) => wallBasis(index));
  const insideHex = (point) => planes.every(
    plane => plane.nx * point.x + plane.nz * point.z <= hexLimit,
  );
  const segmentCrossesHex = (from, to) => {
    let enter = 0;
    let leave = 1;
    for (const plane of planes) {
      const start = plane.nx * from.x + plane.nz * from.z;
      const delta = plane.nx * (to.x - from.x) + plane.nz * (to.z - from.z);
      if (Math.abs(delta) < 1e-9) {
        if (start > hexLimit) return false;
        continue;
      }
      const crossing = (hexLimit - start) / delta;
      if (delta > 0) leave = Math.min(leave, crossing);
      else enter = Math.max(enter, crossing);
      if (enter > leave) return false;
    }
    return leave >= 0 && enter <= 1;
  };
  const point = (positions, index) => ({
    x: positions.getX(index), y: positions.getY(index), z: positions.getZ(index),
  });
  const cutAtEyeHeight = (vertices) => {
    const cuts = [];
    for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) {
      const a = vertices[from];
      const b = vertices[to];
      if ((a.y - eyeY) * (b.y - eyeY) > 0 || Math.abs(b.y - a.y) < 1e-9) continue;
      const amount = (eyeY - a.y) / (b.y - a.y);
      if (amount < 0 || amount > 1) continue;
      const cut = {
        x: a.x + (b.x - a.x) * amount,
        z: a.z + (b.z - a.z) * amount,
      };
      if (!cuts.some(existing => Math.hypot(existing.x - cut.x, existing.z - cut.z) < 1e-6)) cuts.push(cut);
    }
    return cuts;
  };
  let intrudingVistaTriangles = 0;
  const vistaMeshes = [];
  vista.traverse(child => { if (child.isMesh) vistaMeshes.push(child); });
  for (const mesh of vistaMeshes) {
    const positions = mesh.geometry.getAttribute('position');
    const indices = mesh.geometry.getIndex();
    if (!positions || !indices) continue;
    for (let cursor = 0; cursor < indices.count; cursor += 3) {
      const cuts = cutAtEyeHeight([
        point(positions, indices.getX(cursor)),
        point(positions, indices.getX(cursor + 1)),
        point(positions, indices.getX(cursor + 2)),
      ]);
      if (cuts.some(insideHex) || (cuts.length >= 2 && segmentCrossesHex(cuts[0], cuts[1]))) {
        intrudingVistaTriangles++;
      }
    }
  }
  return {
    doorWalls: room.userData.doorWalls,
    shelvedWalls: room.userData.shelvedWalls,
    bookWallCount: room.userData.bookWallCount,
    activeCabinetRunWidth: room.userData.cabinetRunWidth,
    distantCabinetRunWidth: vista.userData.cabinetRunWidth,
    activeCabinetUprightsPerWall: room.userData.cabinetUprightsPerWall,
    distantCabinetUprightsPerWall: vista.userData.cabinetUprightsPerWall,
    sideAndForwardReachDifference: Math.abs(ALCOVE_REACH - HALL_SIDE_CENTRE),
    doorWidth: DOOR_WIDTH,
    doorHeight: DOOR_HEIGHT,
    hallWidth: HALL_HALF_WIDTH * 2,
    junctionChamfer: HALL_JUNCTION_CHAMFER,
    junctionSideWidth: HALL_SIDE_HALF * 2,
    hallLength: HALL_LENGTH,
    intrudingVistaTriangles,
    vistaVertices: vistaMeshes.reduce(
      (total, child) => total + (child.geometry?.getAttribute('position')?.count ?? 0), 0,
    ),
    vistaTriangles: vistaMeshes.reduce(
      (total, child) => total + (child.geometry?.getIndex()?.count ?? 0) / 3, 0,
    ),
    bookMeshes: room.userData.bookMeshes.length,
    bookCount: room.userData.bookMeshes.reduce((total, mesh) => total + mesh.count, 0),
    allBooksWhite: colours.every(value => value === 1),
  };
});
assert.equal(chamberLayout.doorWalls.length, 2, 'a chamber has exactly two exit walls');
assert.equal(chamberLayout.bookWallCount, 4, 'the other four walls are book walls');
assert.equal(chamberLayout.shelvedWalls.length, 4, 'all four book walls are recorded by the room');
assert.equal(
  chamberLayout.activeCabinetRunWidth,
  chamberLayout.distantCabinetRunWidth,
  'active and distant floors use the same corner-to-corner bookcase run',
);
assert.equal(chamberLayout.activeCabinetUprightsPerWall, 2, 'the active cabinet has no internal partitions');
assert.equal(
  chamberLayout.distantCabinetUprightsPerWall,
  chamberLayout.activeCabinetUprightsPerWall,
  'distant floors use the same partition-free cabinet construction',
);
assert.ok(
  chamberLayout.sideAndForwardReachDifference < 1e-12,
  'side and forward exits must reach identical chamber doorways from the crossing',
);
assert.ok(chamberLayout.doorWidth <= 4.5, 'the doorway must remain human-scale inside the enlarged gallery');
assert.ok(chamberLayout.doorHeight >= 3.2 && chamberLayout.doorHeight <= 4.2, 'the doorway needs a legible human height');
assert.ok(chamberLayout.hallWidth <= 5, 'the passage must read as a corridor, not a low hall');
assert.equal(
  chamberLayout.junctionSideWidth,
  chamberLayout.hallWidth,
  'all four mouths of the junction must have exactly the same width',
);
assert.ok(
  chamberLayout.junctionChamfer >= chamberLayout.hallWidth / 4,
  'the inner corners must be cut back far enough not to dominate diagonal views',
);
assert.ok(chamberLayout.hallWidth / chamberLayout.doorHeight < 1.5, 'the corridor must not be wider than its height by a hangar-like ratio');
assert.ok(chamberLayout.hallLength <= 24, 'topological distance must not force a sixty-metre visible passage');
assert.equal(
  chamberLayout.intrudingVistaTriangles,
  0,
  'non-colliding vista geometry must never cross the interior of the active hex',
);
assert.equal(chamberLayout.bookMeshes, 1, 'all white books share one material batch');
assert.equal(chamberLayout.bookCount, 3840, 'all four book walls remain fully populated');
assert.equal(chamberLayout.allBooksWhite, true, 'every physical volume uses the same white tint');
assert.ok(
  chamberLayout.vistaVertices <= MAX_VISTA_VERTICES,
  `vista geometry must stay below ${MAX_VISTA_VERTICES} vertices, measured ${chamberLayout.vistaVertices}`,
);
assert.ok(
  chamberLayout.vistaTriangles <= MAX_VISTA_TRIANGLES,
  `vista geometry must stay below ${MAX_VISTA_TRIANGLES} triangles, measured ${chamberLayout.vistaTriangles}`,
);

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
await page.locator('#address-input').fill('w3;0');
await page.locator('#address-submit').click();
await page.waitForFunction(() => document.querySelector('#search-result').textContent === 'world room opened');

const doorGeometry = await page.evaluate(async () => {
  const doors = await import('./src/world/doors.js');
  const { APOTHEM, DOOR_HALF_WIDTH, HALL_START } = await import('./src/constants.js');
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
    besideOpening: doors.isWithinDoorway(2, 0n, ...on(APOTHEM, DOOR_HALF_WIDTH + 0.5)),
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
    const at = doors.wallCoordinates(2, point.x, point.z);
    return { ...at, along: at.normal - c.HALL_START };
  };
  const middle = c.HALL_START + c.HALL_SIDE_CENTRE;
  const diagonalInsideTarget = {
    normal: middle + c.HALL_SIDE_HALF + 0.2,
    tangent: c.HALL_HALF_WIDTH + 0.2,
  };
  const diagonalOutsideTarget = {
    normal: middle + c.HALL_SIDE_HALF + 0.7,
    tangent: c.HALL_HALF_WIDTH + 0.7,
  };
  const diagonalInside = held(diagonalInsideTarget.normal, diagonalInsideTarget.tangent);
  const diagonalOutside = held(diagonalOutsideTarget.normal, diagonalOutsideTarget.tangent);
  const cornerOverflow = sample => (
    Math.max(0, Math.abs(sample.tangent) - c.HALL_HALF_WIDTH)
    + Math.max(0, Math.abs(sample.along - c.HALL_SIDE_CENTRE) - c.HALL_SIDE_HALF)
  );
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
    // A side arm is a corridor, not a pocket: it is open at its far end, and
    // what bounds a walker there is its own two walls, not a wall across it.
    heldInArm: held(middle + 4, c.ALCOVE_REACH - 1).along ?? null,
    reachesDownArm: held(middle, c.ALCOVE_REACH - 0.4).tangent,
    diagonalInsideError: Math.hypot(
      diagonalInside.normal - diagonalInsideTarget.normal,
      diagonalInside.tangent - diagonalInsideTarget.tangent,
    ),
    diagonalOutsideOverflow: cornerOverflow(diagonalOutside),
    diagonalPlayerLimit: c.HALL_JUNCTION_CHAMFER - c.PLAYER_RADIUS * Math.SQRT2,
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
  Math.abs(passage.reachesDownArm) > passage.limits.half,
  'a walker must be able to walk down a side arm at all, or the turning is unreachable',
);
assert.ok(
  Math.abs(passage.reachesDownArm) > passage.limits.reach - 0.5,
  'and all the way to its far end, where the chamber takes over — an arm is a corridor, not a pocket',
);
assert.ok(
  passage.diagonalInsideError < 1e-6,
  `the open half of a chamfer must remain walkable (${passage.diagonalInsideError})`,
);
assert.ok(
  passage.diagonalOutsideOverflow <= passage.diagonalPlayerLimit + 1e-6,
  `the diagonal wall must hold the player to its visible plane (${passage.diagonalOutsideOverflow})`,
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

// A side threshold changes coordinates, not the image. Both apertures remain
// mounted together and the ordinary world never disappears when the camera
// turns. Each destination is rendered in a separate stencil pass, while the
// marker in renderedWorld carries only the exact rigid transform applied at the
// threshold — no foreign room geometry is allowed to leak into the base scene.
const sideContinuity = await page.evaluate(async () => {
  const THREE = await import('three');
  const { camera, renderedWorld, renderer } = await import('./src/core/view.js');
  const {
    moveToWorldHex,
    syncDoorways,
    syncPassageDestinations,
    world,
  } = await import('./src/world/rooms.js');
  const { player } = await import('./src/player.js');
  const doors = await import('./src/world/doors.js');
  const sharedMaterials = await import('./src/core/materials.js');
  const c = await import('./src/constants.js');

  moveToWorldHex(0n, 0n, 0n);
  const deadline = performance.now() + 15000;
  let portalGroup = null;
  while (performance.now() < deadline) {
    const ready = syncPassageDestinations();
    portalGroup = renderedWorld.children.find(child => child.userData.passageDestinations);
    if (ready === 6 && portalGroup?.userData.compiled === 6) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const preparation = {
    buildsTriggeredInPassage: portalGroup.userData.buildsTriggeredInPassage,
    compiled: portalGroup.userData.compiled,
    maxBuildMs: portalGroup.userData.maxBuildMs,
    ready: portalGroup.userData.ready,
    synchronousFallbacks: portalGroup.userData.synchronousFallbacks,
  };
  const { basis } = doors.wallCoordinates(2, 0, 0);
  const normal = c.HALL_START + c.HALL_SIDE_CENTRE;
  const place = tangent => {
    camera.position.set(
      basis.nx * normal + basis.tx * tangent,
      1.65,
      basis.nz * normal + basis.tz * tangent,
    );
  };
  place(c.SIDE_EXIT_REACH - 0.01);
  player.yaw = Math.atan2(-basis.tx, -basis.tz);
  const syncStarted = performance.now();
  syncPassageDestinations();
  const corridorEntrySyncMs = performance.now() - syncStarted;
  window.__draw.calls = 0;
  window.__draw.frames = 0;
  const sampleFrameGaps = () => new Promise(resolve => {
    const gaps = [];
    let previous = null;
    // Four frames are enough to catch the first upload and the settled render
    // without making the software-WebGL smoke monopolise the machine.
    let remaining = 4;
    const sample = now => {
      if (previous !== null) gaps.push(now - previous);
      previous = now;
      remaining--;
      if (remaining === 0) resolve(gaps);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  // The first sample includes any one-time shader/buffer work. The second
  // separates that cold cost from steady corridor rendering, which matters in
  // headless Chromium because its software WebGL exaggerates uploads by orders
  // of magnitude compared with a hardware browser.
  const coldFrameGaps = await sampleFrameGaps();
  const warmFrameGaps = await sampleFrameGaps();
  const portalDrawCallsPerFrame = Math.round(
    window.__draw.calls / Math.max(1, window.__draw.frames),
  );
  const portal = portalGroup.children.find(child => (
    child.userData.portalWall === 2 && child.userData.portalExit === 'right'
  ));
  if (!portal) {
    throw new Error('missing wall-2 right portal: ' + JSON.stringify(
      portalGroup.children.map(child => [child.userData.portalWall, child.userData.portalExit]),
    ));
  }
  const portalRoomId = portal.userData.portalRoomId;
  const mainVista = renderedWorld.children.find(child => (
    child.userData.verticalChambers !== undefined
  ));
  const activeRoomBefore = renderedWorld.children.find(child => child.userData.q !== undefined);
  const visibilityAt = yaw => {
    player.yaw = yaw;
    syncPassageDestinations();
    return {
      active: activeRoomBefore.visible,
      mainVista: mainVista.visible,
      portals: portalGroup.children.map(child => [
        child.userData.portalWall,
        child.userData.portalExit,
        child.visible,
      ]),
    };
  };
  const visibilityByYaw = [
    Math.atan2(-basis.nx, -basis.nz),
    Math.atan2(basis.tx, basis.tz),
    Math.atan2(-basis.tx, -basis.tz),
    Math.atan2(basis.nx, basis.nz),
  ].map(visibilityAt);
  player.yaw = Math.atan2(-basis.tx, -basis.tz);

  // Measure the pose for the first point that actually crosses the threshold.
  place(c.SIDE_EXIT_REACH + 0.01);
  portal.updateMatrixWorld(true);
  const expectedPosition = portal.worldToLocal(camera.position.clone());
  const expectedYaw = player.yaw - portal.rotation.y;
  const entered = Boolean(syncDoorways());
  const positionError = camera.position.distanceTo(expectedPosition);
  const yawError = Math.abs(player.yaw - expectedYaw);
  const oldPortalStillMounted = renderedWorld.children.some(child => child.id === portalGroup.id);
  const activeRoom = renderedWorld.children.find(child => child.userData.q !== undefined);
  const nextPortalGroup = renderedWorld.children.find(child => child.userData.passageDestinations);
  const singletonMaterials = Object.values(sharedMaterials).flat().filter(value => value?.isMaterial);
  return {
    activeOrigin: activeRoom.position.distanceTo(new THREE.Vector3()),
    adoptedExactRoom: activeRoom.id === portalRoomId,
    activeRoomVisibleBefore: activeRoomBefore.visible,
    baseMarkersCarryNoGeometry: portalGroup.children.every(child => child.children.length === 0),
    corridorEntrySyncMs,
    destinationScenes: preparation.ready,
    doorHeight: c.DOOR_HEIGHT,
    hallHalfWidth: c.HALL_HALF_WIDTH,
    entered,
    exactBookCounts: portalGroup.children.map(child => child.userData.bookCount),
    metadataDeferred: portalGroup.children.map(child => child.userData.metadataDeferred),
    allMasksDepthTest: portalGroup.children.every(child => child.userData.maskDepthTest),
    allCoreMasksIgnoreDepth: portalGroup.children.every(child => !child.userData.coreMaskDepthTest),
    maskHeights: portalGroup.children.map(child => child.userData.maskHeight),
    maskWidths: portalGroup.children.map(child => child.userData.maskWidth),
    portalPassageOwnership: portalGroup.children.map(child => ({
      omitted: child.userData.omittedArrivalPassage,
      remaining: child.userData.remainingPassageWalls,
    })),
    allLightingLocal: portalGroup.children.every(child => child.userData.localLighting),
    mainVistaVisibleBefore: mainVista.visible,
    allAperturesVisible: portalGroup.children.every(child => child.visible),
    oldPortalStillMounted,
    nextPortalPreparationStarted: Boolean(nextPortalGroup),
    portalDrawCallsPerFrame,
    portalColdMaxFrameGap: Math.max(...coldFrameGaps),
    portalWarmMaxFrameGap: Math.max(...warmFrameGaps),
    positionError,
    preparation,
    room: [String(world.room.q), String(world.room.r)],
    sharedStencilRestored: singletonMaterials.every(material => !material.stencilWrite),
    stencilBuffer: renderer.getContext().getContextAttributes().stencil,
    visibilityByYaw,
    yawError,
  };
});

assert.equal(sideContinuity.destinationScenes, 6, 'both corridors preload all six exact neighbouring rooms');
assert.equal(sideContinuity.preparation.compiled, 6, 'all portal shader variants compile before corridor entry');
assert.equal(sideContinuity.preparation.buildsTriggeredInPassage, 0, 'destination geometry must be prepared before corridor entry');
assert.equal(sideContinuity.preparation.synchronousFallbacks, 0, 'normal corridor entry needs no synchronous fallback build');
assert.ok(sideContinuity.corridorEntrySyncMs < 5, `corridor entry bookkeeping took ${sideContinuity.corridorEntrySyncMs.toFixed(2)} ms`);
assert.ok(
  sideContinuity.portalDrawCallsPerFrame <= MAX_DRAW_CALLS_PER_FRAME,
  `a corridor with exact neighbours cost ${sideContinuity.portalDrawCallsPerFrame} draw calls per frame`,
);
assert.equal(sideContinuity.stencilBuffer, true, 'portal apertures require a real stencil buffer');
assert.equal(sideContinuity.baseMarkersCarryNoGeometry, true, 'foreign destination geometry must not enter the base scene');
assert.equal(sideContinuity.sharedStencilRestored, true, 'portal rendering must restore every shared material stencil state');
assert.equal(sideContinuity.allAperturesVisible, true, 'all six apertures coexist instead of following the gaze');
assert.equal(sideContinuity.allMasksDepthTest, true, 'every aperture must be hidden by real corridor walls and lintels');
assert.equal(
  sideContinuity.allCoreMasksIgnoreDepth,
  true,
  'the exact doorway core must replace source-world depth instead of preserving a stale side wall',
);
assert.ok(
  sideContinuity.maskHeights.every(height => height > sideContinuity.doorHeight),
  'every portal mask must include the destination lintel up to the corridor ceiling',
);
assert.ok(
  sideContinuity.maskWidths.every(width => width > 2 * sideContinuity.hallHalfWidth),
  'every portal mask must overdraw the corridor mouth so oblique views cannot expose a clear-colour crack',
);
assert.ok(
  sideContinuity.portalPassageOwnership.every(({ omitted, remaining }) => (
    Number.isInteger(omitted)
    && remaining.length === 0
  )),
  'a portal destination owns the exact room and shaft, never rotated copies of horizontal corridors',
);
assert.equal(sideContinuity.allLightingLocal, true, 'every direction must carry the same room-relative lighting through its portal');
assert.ok(sideContinuity.exactBookCounts.every(count => count === 3840), 'every neighbour uses the full room book geometry');
assert.ok(sideContinuity.metadataDeferred.every(Boolean), 'only destination-specific records and invisible lettering are deferred before arrival');
assert.equal(sideContinuity.mainVistaVisibleBefore, true, 'the axial world must remain stable while a side portal is viewed');
assert.equal(sideContinuity.activeRoomVisibleBefore, true, 'turning in a passage must not remove the chamber behind the player');
assert.ok(
  sideContinuity.visibilityByYaw.every(state => JSON.stringify(state) === JSON.stringify(sideContinuity.visibilityByYaw[0])),
  'rotating in one place must not change any scene visibility',
);
assert.equal(sideContinuity.entered, true, 'the measured pose must cross a side threshold');
assert.equal(sideContinuity.adoptedExactRoom, true, 'the room visible through the portal becomes current without rebuilding');
assert.deepEqual(sideContinuity.room, ['-1', '0'], 'the continuous right portal still reaches the same logical hex');
assert.ok(sideContinuity.positionError < 1e-9, `portal position changed by ${sideContinuity.positionError}`);
assert.ok(sideContinuity.yawError < 1e-9, `portal heading changed by ${sideContinuity.yawError}`);
assert.equal(sideContinuity.oldPortalStillMounted, false, 'the old six-world set is released after one room becomes current');
assert.equal(sideContinuity.nextPortalPreparationStarted, true, 'the new chamber immediately begins preparing its own exact neighbours');
assert.ok(sideContinuity.activeOrigin < 1e-12, 'the destination becomes the canonical origin after the rigid transform');

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
  const groups = renderedWorld.children.filter(child => (
    child.userData.verticalChambers !== undefined
  ));
  const measure = () => {
    const group = renderedWorld.children.find(c => (
      c.userData.verticalChambers !== undefined
    ));
    if (!group) return null;
    let meshes = 0;
    let vertices = 0;
    group.traverse(object => {
      if (!object.geometry) return;
      meshes++;
      vertices += object.geometry.getAttribute('position')?.count ?? 0;
    });
    return { meshes, vertices, id: group.id };
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
assert.match(register.newest.address, /^w3;/, 'every row carries the exact record beside the number');
assert.ok(
  register.mapOrdinals.some(ordinal => ordinal === null),
  'the map leaves a chamber blank until it has been walked into, because until then nobody has named it',
);

// The panel decodes a number back into a place, and walks the player to it.
await takeBackCursor();
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
// the catalogue repeats has 1 918 663 digits, and the number itself cannot be
// shown — only its length, which is the point.
const scale = await page.locator('#register-count').textContent();
assert.match(scale, /^\d+ chambers? of a number with 1 918 663 digits/, 'the register says how big the library is');
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
  Math.abs(traces.standsOutBy - traces.reach) < 5e-6,
  `the disturbed volume must stand out by exactly the reach recorded, ${traces.standsOutBy} against ${traces.reach}`,
);
assert.ok(
  traces.shelfSpread < 1e-5,
  `and it must be the only one on its shelf that is out (undisturbed spread ${traces.shelfSpread})`,
);
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
// Building a room used to paint every rotated spine during the threshold frame.
// spine labels onto three atlases. None of that has to happen in the
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
    for (let slice = 0; slice < 240 && roomOf().userData.pendingSpines.length; slice++) paintRoomLabels(4);
  }
  builds.sort((a, b) => a - b);

  moveToWorldHex(7n, 7n, 0n);
  const queuedOnBuild = roomOf().userData.pendingSpines.length;
  let slices = 0;
  while (roomOf().userData.pendingSpines.length && slices < 240) {
    paintRoomLabels(4);
    slices++;
  }
  return { median: builds[4], queuedOnBuild, slices, drained: roomOf().userData.pendingSpines.length };
});

assert.ok(cost.queuedOnBuild > 3800, `a room's 3840 spine labels must be queued, not painted on the spot (${cost.queuedOnBuild})`);
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

// --- every way out is named over its own entrance -----------------------------
// A junction offers three identical openings onto three identical chambers.
// Each is named on the surface over its entrance, which is the sign somebody
// walking the corridor can read without stopping — a side opening is edge-on
// from down the passage, and anything written inside it cannot be seen until
// they turn. Lettering has been built mirrored in this project before, so the
// winding and the texture coordinates are checked directly. Chamber ceilings
// stay unlettered: they belong to the vertical view now.
const signs = await page.evaluate(async () => {
  const { moveToWorldHex, world } = await import('./src/world/rooms.js');
  const { renderedWorld } = await import('./src/core/view.js');
  const { passageExits } = await import('./src/world/passage.js');
  const { freeWallsForLevel } = await import('./world-engine.js');
  const { roomTagFor } = await import('./world-model.js');

  moveToWorldHex(0n, 0n, 0n);
  const mesh = renderedWorld.children.find(child => child.isMesh && child.userData.plaques);
  if (!mesh) return { error: 'no markings were built' };
  const roomMesh = renderedWorld.children.find(child => child.userData.q !== undefined);

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

  // Two passages, four immediate choices from each. Distant speculative signs
  // were removed with the overlapping side-room models: only a decision the
  // walker can make at this junction is named here.
  const said = [];
  for (const wall of freeWallsForLevel(world.room.level)) {
    const exits = passageExits(world.room, wall);
    for (const way of ['ahead', 'left', 'right', 'back']) {
      const there = exits[way];
      said.push(roomTagFor(there.q, there.r, there.level));
    }
  }
  return {
    marks,
    said,
    tags: mesh.userData.plaques,
    roomCeilingLabels: roomMesh.children.filter(child => child.geometry?.type === 'PlaneGeometry').length,
  };
});

assert.ok(!signs.error, signs.error ?? 'the ways out are named');
assert.equal(signs.marks.length, 8, 'every immediate way out is named once, over its entrance');
const flat = signs.marks.filter(mark => mark.lies < 1e-6);
const upright = signs.marks.filter(mark => mark.lies >= 1e-6);
assert.equal(upright.length, 8, 'every immediate way out is named over its own entrance');
assert.equal(flat.length, 0, 'no distant chamber carries a marking on its ceiling');
assert.equal(signs.roomCeilingLabels, 0, 'the current chamber carries no marking on its ceiling');
assert.equal(signs.tags.length, 8, 'eight immediate choices are named once');

for (const [index, mark] of signs.marks.entries()) {
  assert.ok(mark.textureTopIsUp > 0, `marking ${index}: the top of the label must be at the top of its cell`);
}
for (const mark of upright) {
  assert.ok(mark.hangs > 0, 'a plaque over an entrance must not hang upside down');
  assert.ok(mark.acrossIsLevel < 1e-6, 'and its lettering must run level, not up the beam');
  assert.ok(
    mark.height > 3.3 && mark.height < 3.7,
    `a plaque belongs on the beam over the entrance, found at ${mark.height}`,
  );
}
assert.deepEqual(signs.tags, signs.said, 'each marking names the chamber its way out actually leads to');
assert.ok(
  signs.tags.every(tag => tag.startsWith('h-')),
  'a passage sign carries the world\'s own name for a chamber, never the walker\'s number',
);

// --- critical-angle visual regression ---------------------------------------
// Mathematical geometry can pass while a shader or a distant proxy turns the
// scene into blank paper. Render the cardinal, diagonal, threshold and vertical
// views that previously failed and sample the composed WebGL canvas at low
// resolution. In particular, the four diagonals protect the crossing from
// regressing into four giant square blocks.
// The thresholds describe
// visual information rather than GPU-specific pixel-perfect antialiasing.
const visualQueries = await page.evaluate(async () => {
  const c = await import('./src/constants.js');
  const { wallBasis } = await import('./src/world/geometry.js');
  const basis = wallBasis(2);
  const normal = c.HALL_START + c.HALL_SIDE_CENTRE;
  const corridor = (yaw) => new URLSearchParams({
    preview: '1',
    x: String(basis.nx * normal),
    y: '1.65',
    z: String(basis.nz * normal),
    yaw: String(yaw),
    pitch: '-0.04',
  }).toString();
  const yawFacing = (dx, dz) => Math.atan2(-dx, -dz);
  const diagonalYaw = (aX, aZ, bX, bZ) => yawFacing(aX + bX, aZ + bZ);
  const threshold = (side, offset) => new URLSearchParams({
    preview: '1',
    x: String(basis.nx * normal + basis.tx * side * (c.SIDE_EXIT_REACH + offset)),
    y: '1.65',
    z: String(basis.nz * normal + basis.tz * side * (c.SIDE_EXIT_REACH + offset)),
    yaw: String(yawFacing(side * basis.tx, side * basis.tz)),
    pitch: '-0.04',
  }).toString();
  return {
    chamber: 'preview=1',
    corridorBack: corridor(yawFacing(-basis.nx, -basis.nz)),
    corridorAhead: corridor(yawFacing(basis.nx, basis.nz)),
    corridorLeft: corridor(yawFacing(-basis.tx, -basis.tz)),
    corridorRight: corridor(yawFacing(basis.tx, basis.tz)),
    corridorAheadRight: corridor(diagonalYaw(basis.nx, basis.nz, basis.tx, basis.tz)),
    corridorRightBack: corridor(diagonalYaw(basis.tx, basis.tz, -basis.nx, -basis.nz)),
    corridorBackLeft: corridor(diagonalYaw(-basis.nx, -basis.nz, -basis.tx, -basis.tz)),
    corridorLeftAhead: corridor(diagonalYaw(-basis.tx, -basis.tz, basis.nx, basis.nz)),
    thresholdRightBefore: threshold(1, -0.01),
    thresholdRightAfter: threshold(1, 0.01),
    thresholdLeftBefore: threshold(-1, -0.01),
    thresholdLeftAfter: threshold(-1, 0.01),
    up: 'preview=1&x=40&y=1.65&z=0&yaw=1.570796&pitch=0.9',
    down: 'preview=1&x=40&y=1.65&z=0&yaw=1.570796&pitch=-0.9',
  };
});

const visualMetrics = {};
for (const [name, query] of Object.entries(visualQueries)) {
  await page.goto(`${origin}/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#startup-state').textContent === 'ready', null, { timeout: 30000 });
  await page.waitForTimeout(350);
  const screenshot = await page.screenshot();
  const canvasSample = name.startsWith('threshold')
    ? await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
      const source = document.querySelector('canvas.world-canvas');
      const probe = document.createElement('canvas');
      probe.width = 64;
      probe.height = 40;
      const context = probe.getContext('2d', { willReadFrequently: true });
      context.drawImage(source, 0, 0, probe.width, probe.height);
      resolve(Array.from(context.getImageData(0, 0, probe.width, probe.height).data));
    })))
    : null;
  visualMetrics[name] = {
    canvasSample,
    pngBytes: screenshot.length,
    signature: createHash('sha256').update(screenshot).digest('hex'),
  };
}

for (const [name, metric] of Object.entries(visualMetrics)) {
  const evidence = JSON.stringify({ pngBytes: metric.pngBytes, signature: metric.signature });
  assert.ok(metric.pngBytes > 20000, `${name}: the rendered view must contain more than blank paper; ${evidence}`);
}
for (const side of ['Right', 'Left']) {
  const before = visualMetrics[`threshold${side}Before`].canvasSample;
  const after = visualMetrics[`threshold${side}After`].canvasSample;
  let pixelDelta = 0;
  for (let index = 0; index < before.length; index += 4) {
    pixelDelta += Math.abs(before[index] - after[index]);
    pixelDelta += Math.abs(before[index + 1] - after[index + 1]);
    pixelDelta += Math.abs(before[index + 2] - after[index + 2]);
  }
  pixelDelta /= (before.length / 4) * 3;
  assert.ok(
    pixelDelta < 8,
    `${side.toLowerCase()} portal changed by ${pixelDelta.toFixed(2)} levels across a two-centimetre threshold step`,
  );
}
assert.equal(
  new Set(Object.values(visualMetrics).map(metric => metric.signature)).size,
  Object.keys(visualMetrics).length,
  'room, corridor, upward shaft and downward shaft must remain visually distinct',
);
assert.deepEqual(consoleErrors, [], 'critical-angle views must boot without console errors');

// --- touch devices -----------------------------------------------------------
// Phones have no pointer lock, so entering the chamber is a mode switch driven
// by a virtual stick. Real touch events are dispatched through CDP so the
// client sees pointerType 'touch' exactly as it would on a device.
// The desktop path is complete; release its large WebGL scene before starting
// a second sixfold library. A phone loads one chamber, not two competing tabs.
await page.close();
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
console.log(
  'smoke: room renders in ' + perFrame
  + ' draw calls/frame, corridor portals in '
  + sideContinuity.portalDrawCallsPerFrame
  + ' draw calls/frame; corridor entry sync '
  + sideContinuity.corridorEntrySyncMs.toFixed(2)
  + ' ms, slowest background neighbour build '
  + sideContinuity.preparation.maxBuildMs.toFixed(1)
  + ' ms, sampled cold/warm max frame gaps '
  + sideContinuity.portalColdMaxFrameGap.toFixed(1)
  + '/'
  + sideContinuity.portalWarmMaxFrameGap.toFixed(1)
  + ' ms; reader, catalogue, search and touch paths pass',
);
