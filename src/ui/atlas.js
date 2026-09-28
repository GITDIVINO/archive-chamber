/**
 * The atlas: the map opened over the whole screen.
 *
 * The corner map shows where the walker is. This one is for going somewhere:
 * one floor laid out four chambers deep in every direction, the floors above
 * and below it stacked through the well with every chamber the walker has
 * entered marked on them, and any chamber on the floor in view one click away.
 *
 * It is drawn the same way as the corner map — from above and a little to one
 * side, so the storeys read as storeys — on a 2D canvas that is only repainted
 * when something on it changes. While it is open the chamber is not drawn to
 * at all, so it costs the scene nothing.
 *
 * Going to a chamber is the same act as choosing a row in the register: the
 * walker is set down in it, beside the well, and it is numbered if it was new.
 */

import { APOTHEM, DOOR_HALF_WIDTH, EYE_HEIGHT, ROOM_RADIUS, WALL_HEIGHT, WELL_RADIUS } from '../constants.js';
import { camera } from '../core/view.js';
import { player } from '../player.js';
import { freeWallsForLevel } from '../../world-engine.js';
import { axialDistance } from '../../world-model.js';
import { planePosition } from '../world/doors.js';
import { axialMapOffset, wallBasis } from '../world/geometry.js';
import { ordinalFor, registerEntries } from '../world/register.js';
import { moveToWorldHex, world } from '../world/rooms.js';
import { atlasCanvas, atlasHint, atlasLevel, atlasPanel } from './dom.js';
import { showNotice } from './hud.js';

const context = atlasCanvas.getContext('2d');

// How many chambers out from the centre the floor in view is laid out.
const RINGS = 4;
// How many floors are stacked above and below the one in view.
const FLOORS_AROUND = 3;
const TILT = 0.5;
const AMBER = '211,184,140';
const FLAME = '255,209,138';
const amber = alpha => 'rgba(' + AMBER + ',' + alpha + ')';
const flame = alpha => 'rgba(' + FLAME + ',' + alpha + ')';

let callbacks = { open: () => {}, close: () => {} };
export function setAtlasCallbacks(next) {
  callbacks = next;
}

// What the atlas is looking at, which starts as where the walker is and then
// belongs to the reader: the floor, the chamber at the middle, and the heading.
const view = { level: 0n, q: 0n, r: 0n, yaw: 0, zoom: 1 };
let hovered = null;
let visited = [];

export function isAtlasOpen() {
  return atlasPanel.classList.contains('visible');
}

export function openAtlas() {
  view.level = world.room.level;
  view.q = world.room.q;
  view.r = world.room.r;
  view.yaw = player.yaw;
  hovered = null;
  visited = registerEntries().map(entry => entry.room);
  atlasPanel.classList.add('visible');
  resize();
  callbacks.open();
}

export function closeAtlas() {
  atlasPanel.classList.remove('visible');
  callbacks.close();
}

export function toggleAtlas() {
  if (isAtlasOpen()) closeAtlas();
  else openAtlas();
}

function resize() {
  const scale = Math.min(devicePixelRatio, 2);
  const rect = atlasCanvas.getBoundingClientRect();
  atlasCanvas.width = Math.round(rect.width * scale);
  atlasCanvas.height = Math.round(rect.height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  draw();
}

export function resizeAtlas() {
  if (isAtlasOpen()) resize();
}

// --- projection ----------------------------------------------------------------

function layout() {
  const rect = atlasCanvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const extent = RINGS * 2 * APOTHEM + ROOM_RADIUS;
  const scale = Math.min(width * 0.44 / extent, height * 0.3 / (extent * TILT)) * view.zoom;
  const storey = Math.max(46, height * 0.1);
  const cosine = Math.cos(-view.yaw);
  const sine = Math.sin(-view.yaw);
  const centerX = width / 2;
  const centerY = height * 0.54;
  return {
    width,
    height,
    scale,
    point(x, z, storeys) {
      const turnedX = x * cosine - z * sine;
      const turnedZ = x * sine + z * cosine;
      return { x: centerX + turnedX * scale, y: centerY + turnedZ * scale * TILT - storeys * storey };
    },
    // The inverse, on the floor in view only: a place on the screen back to a
    // place in the plan.
    unproject(sx, sy) {
      const turnedX = (sx - centerX) / scale;
      const turnedZ = (sy - centerY) / (scale * TILT);
      return { x: turnedX * cosine + turnedZ * sine, z: -turnedX * sine + turnedZ * cosine };
    },
  };
}

function offsetOf(q, r) {
  return axialMapOffset(q - view.q, r - view.r);
}

/** The chamber a plan position lies in, relative to the one at the centre. */
function cellAt(x, z) {
  // axialMapOffset turned back: undo its rotation, then its shear, then round
  // in cube coordinates so every point belongs to the nearest centre.
  const spacing = APOTHEM * 2;
  const rotation = -Math.PI / 6;
  const localX = x * Math.cos(rotation) - z * Math.sin(rotation);
  const localZ = x * Math.sin(rotation) + z * Math.cos(rotation);
  const r = localZ / (spacing * 0.8660254);
  const q = localX / spacing - r / 2;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: BigInt(rq), r: BigInt(rr) };
}

// --- drawing -------------------------------------------------------------------

function hexPath(projection, x, z, radius, storeys) {
  context.beginPath();
  for (let index = 0; index < 6; index++) {
    const angle = index * Math.PI / 3;
    const point = projection.point(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, storeys);
    if (index) context.lineTo(point.x, point.y);
    else context.moveTo(point.x, point.y);
  }
  context.closePath();
}

function segment(projection, from, to, fromStoreys, toStoreys = fromStoreys) {
  const a = projection.point(from.x, from.z, fromStoreys);
  const b = projection.point(to.x, to.z, toStoreys);
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
}

function isWalkerIn(q, r, level) {
  return q === world.room.q && r === world.room.r && level === world.room.level;
}

function inView(room) {
  return axialDistance(room, view) <= BigInt(RINGS);
}

/** A floor other than the one in view: its column, and where the walker has been. */
function drawGhostFloor(projection, storeys, level) {
  const fade = 1 - (Math.abs(storeys) - 1) / FLOORS_AROUND;
  hexPath(projection, 0, 0, ROOM_RADIUS, storeys);
  context.fillStyle = amber(0.04 * fade);
  context.fill();
  context.strokeStyle = amber(0.28 * fade);
  context.lineWidth = 1;
  context.stroke();
  for (const room of visited) {
    if (room.level !== level || !inView(room)) continue;
    const offset = offsetOf(room.q, room.r);
    hexPath(projection, offset.x, offset.z, ROOM_RADIUS * 0.8, storeys);
    context.fillStyle = flame(isWalkerIn(room.q, room.r, room.level) ? 0.4 : 0.14 * fade + 0.04);
    context.fill();
  }
  // Which floor it is, beside its own column.
  const label = projection.point(ROOM_RADIUS * 1.2, 0, storeys);
  context.fillStyle = amber(0.35 + 0.3 * fade);
  context.font = '600 11px "Courier New", monospace';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText('level ' + level, projection.width - 110, label.y);
}

function drawFloorInView(projection) {
  const level = view.level;
  const free = freeWallsForLevel(level);
  const radius = BigInt(RINGS);
  const cells = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = -radius; dr <= radius; dr++) {
      const ds = -dq - dr;
      if (ds < -radius || ds > radius) continue;
      cells.push({ q: view.q + dq, r: view.r + dr, level });
    }
  }
  // Nearest last, so a nearer chamber's outline is never crossed by a farther one.
  const placed = cells.map(cell => ({ cell, offset: offsetOf(cell.q, cell.r) }));
  placed.sort((a, b) => projection.point(a.offset.x, a.offset.z, 0).y - projection.point(b.offset.x, b.offset.z, 0).y);

  for (const { cell, offset } of placed) {
    const ordinal = ordinalFor(cell);
    const isHere = isWalkerIn(cell.q, cell.r, level);
    const isHovered = hovered && hovered.q === cell.q && hovered.r === cell.r;
    hexPath(projection, offset.x, offset.z, ROOM_RADIUS * 0.97, 0);
    context.fillStyle = isHovered ? flame(0.3) : isHere ? flame(0.22) : ordinal !== null ? flame(0.1) : amber(0.035);
    context.fill();
    context.strokeStyle = isHovered ? flame(0.95) : ordinal !== null ? amber(0.6) : amber(0.26);
    context.lineWidth = isHovered || isHere ? 1.6 : 1;
    context.stroke();
    // The well, and the two doorways, which say which way this floor's
    // corridors run.
    hexPath(projection, offset.x, offset.z, WELL_RADIUS, 0);
    context.fillStyle = 'rgba(6,4,2,.5)';
    context.fill();
    context.strokeStyle = flame(ordinal !== null ? 0.8 : 0.45);
    context.lineWidth = 2;
    for (const wall of free) {
      const basis = wallBasis(wall);
      const reach = DOOR_HALF_WIDTH * 3;
      const mouthX = offset.x + basis.nx * APOTHEM * 0.97;
      const mouthZ = offset.z + basis.nz * APOTHEM * 0.97;
      segment(projection,
        { x: mouthX - basis.tx * reach, z: mouthZ - basis.tz * reach },
        { x: mouthX + basis.tx * reach, z: mouthZ + basis.tz * reach }, 0);
    }
  }

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const { cell, offset } of placed) {
    const ordinal = ordinalFor(cell);
    if (ordinal === null) continue;
    const at = projection.point(offset.x, offset.z + (WELL_RADIUS + ROOM_RADIUS) / 2, 0);
    const isHere = isWalkerIn(cell.q, cell.r, level);
    context.fillStyle = isHere ? flame(1) : amber(0.85);
    context.font = (isHere ? '700 14px' : '600 12px') + ' "Courier New", monospace';
    context.fillText(String(ordinal), at.x, at.y);
  }
}

function drawWalker(projection) {
  const storeys = Number(world.room.level - view.level)
    + (camera.position.y - EYE_HEIGHT) / WALL_HEIGHT;
  if (Math.abs(storeys) > FLOORS_AROUND + 0.5 || !inView(world.room)) return;
  const offset = offsetOf(world.room.q, world.room.r);
  const stood = planePosition(camera.position, world.room.level);
  const x = offset.x + stood.x;
  const z = offset.z + stood.z;
  const at = projection.point(x, z, storeys);
  const reach = ROOM_RADIUS * 0.45;
  const tip = projection.point(x + Math.sin(player.yaw) * reach, z - Math.cos(player.yaw) * reach, storeys);
  context.strokeStyle = flame(1);
  context.lineWidth = 1.6;
  context.beginPath();
  context.arc(at.x, at.y, 7, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(at.x, at.y);
  context.lineTo(tip.x, tip.y);
  context.stroke();
}

function draw() {
  if (!isAtlasOpen()) return;
  const projection = layout();
  context.clearRect(0, 0, projection.width, projection.height);

  // The shaft through every floor shown, under all of them.
  context.strokeStyle = amber(0.14);
  context.lineWidth = 1;
  for (let index = 0; index < 6; index++) {
    const angle = index * Math.PI / 3;
    const corner = { x: Math.cos(angle) * WELL_RADIUS, z: Math.sin(angle) * WELL_RADIUS };
    segment(projection, corner, corner, -FLOORS_AROUND - 0.4, FLOORS_AROUND + 0.4);
  }

  // Below, then the floor in view, then above: each laid over what is under it.
  for (let storeys = -FLOORS_AROUND; storeys < 0; storeys++) {
    drawGhostFloor(projection, storeys, view.level + BigInt(storeys));
  }
  drawFloorInView(projection);
  for (let storeys = 1; storeys <= FLOORS_AROUND; storeys++) {
    drawGhostFloor(projection, storeys, view.level + BigInt(storeys));
  }
  drawWalker(projection);

  atlasLevel.textContent = 'level ' + view.level
    + (view.level === world.room.level ? ' · your floor' : '');
  atlasHint.textContent = hintFor(hovered);
}

function hintFor(cell) {
  if (!cell) return 'click a chamber to go there';
  if (isWalkerIn(cell.q, cell.r, view.level)) return 'you are here';
  const ordinal = ordinalFor({ ...cell, level: view.level });
  return (ordinal === null ? 'a chamber nobody has numbered' : 'chamber ' + ordinal) + ' · click to go there';
}

// --- interaction ---------------------------------------------------------------

function cellUnder(event) {
  const rect = atlasCanvas.getBoundingClientRect();
  const projection = layout();
  const plan = projection.unproject(event.clientX - rect.left, event.clientY - rect.top);
  const relative = cellAt(plan.x, plan.z);
  const cell = { q: view.q + relative.q, r: view.r + relative.r, level: view.level };
  return inView(cell) ? cell : null;
}

function go(cell) {
  if (isWalkerIn(cell.q, cell.r, cell.level)) {
    closeAtlas();
    return;
  }
  moveToWorldHex(cell.q, cell.r, cell.level);
  closeAtlas();
  showNotice('chamber ' + world.ordinal);
}

let drag = null;
atlasCanvas.addEventListener('pointerdown', event => {
  drag = { x: event.clientX, yaw: view.yaw, moved: false };
  atlasCanvas.setPointerCapture(event.pointerId);
});
atlasCanvas.addEventListener('pointermove', event => {
  if (drag) {
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (drag.moved) {
      view.yaw = drag.yaw - dx * 0.006;
      draw();
      return;
    }
  }
  const cell = cellUnder(event);
  const same = cell && hovered && cell.q === hovered.q && cell.r === hovered.r;
  if (same || (!cell && !hovered)) return;
  hovered = cell;
  draw();
});
atlasCanvas.addEventListener('pointerup', event => {
  const wasDrag = drag?.moved;
  drag = null;
  if (wasDrag) return;
  const cell = cellUnder(event);
  if (cell) go(cell);
});
atlasCanvas.addEventListener('pointerleave', () => {
  if (drag || !hovered) return;
  hovered = null;
  draw();
});
atlasCanvas.addEventListener('wheel', event => {
  event.preventDefault();
  if (event.ctrlKey) {
    view.zoom = Math.min(2.5, Math.max(0.6, view.zoom * Math.exp(-event.deltaY * 0.004)));
  } else {
    changeLevel(event.deltaY < 0 ? 1 : -1);
    return;
  }
  draw();
}, { passive: false });

export function changeLevel(delta) {
  view.level += BigInt(delta);
  hovered = null;
  draw();
}

/** Slides the map one chamber along, in the direction that is up on the screen. */
export function panAtlas(forward, right) {
  // Up the screen is -z after the view's own turn, the same way the walker's
  // heading is drawn; the step is one chamber, snapped to the nearest centre.
  const reach = APOTHEM * 2;
  const x = (Math.sin(view.yaw) * forward + Math.cos(view.yaw) * right) * reach;
  const z = (-Math.cos(view.yaw) * forward + Math.sin(view.yaw) * right) * reach;
  const step = cellAt(x, z);
  view.q += step.q;
  view.r += step.r;
  hovered = null;
  draw();
}

/** Keys while the atlas is open. Returns true when the key was the atlas's. */
export function atlasKey(event) {
  switch (event.code) {
    case 'KeyQ': case 'PageUp': changeLevel(1); return true;
    case 'KeyE': case 'PageDown': changeLevel(-1); return true;
    case 'KeyW': case 'ArrowUp': panAtlas(1, 0); return true;
    case 'KeyS': case 'ArrowDown': panAtlas(-1, 0); return true;
    case 'KeyA': case 'ArrowLeft': panAtlas(0, -1); return true;
    case 'KeyD': case 'ArrowRight': panAtlas(0, 1); return true;
    case 'KeyC': case 'Home':
      view.level = world.room.level;
      view.q = world.room.q;
      view.r = world.room.r;
      draw();
      return true;
    default: return false;
  }
}
