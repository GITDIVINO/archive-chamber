/**
 * The corner minimap, drawn as a column of floors.
 *
 * A flat hex map told the walker which chambers lay around them and nothing
 * about the one thing that makes this library a library: it goes up and down.
 * Every level is its own plane, joined to the next only by the stair in the
 * well, and the walls that open onto passages turn with the level. So the map
 * is seen from above and a little to one side, with the storeys stacked:
 *
 *   - the walker's own floor in full, the chamber and its six neighbours, its
 *     two doorways and the three chambers each passage opens on;
 *   - two floors above and two below, as the same chamber seen through the
 *     well, each with its own pair of doorways, so it is visible before
 *     climbing which way the corridors will run up there;
 *   - the shaft through all of them, the bridge on every floor and the flight
 *     from each floor to the next;
 *   - the walker's ring, which rises and falls with them on the stair rather
 *     than jumping a storey at the top.
 *
 * Every dimension in the plan comes from the same constants the chamber is
 * built from, and the height of the ring from the walker's own feet against
 * the height of a storey. Only the vertical spacing of the floors is chosen
 * for the screen: at true scale a storey would be a few pixels.
 *
 * It is a 2D canvas, so it costs the scene nothing, and it is only repainted
 * when the walker moved, turned, climbed, or the room changed.
 */

import {
  APOTHEM,
  DOOR_HALF_WIDTH,
  EYE_HEIGHT,
  ROOM_RADIUS,
  STAIR_HALF_RUN,
  STAIR_WELL_EDGE,
  WALL_HEIGHT,
  WELL_RADIUS,
} from '../constants.js';
import { camera } from '../core/view.js';
import { player } from '../player.js';
import { freeWallsForLevel } from '../../world-engine.js';
import { WALL_DIRECTIONS } from '../../world-model.js';
import { planePosition } from '../world/doors.js';
import { axialMapOffset, wallBasis } from '../world/geometry.js';
import { passageExits } from '../world/passage.js';
import { ordinalFor } from '../world/register.js';
import { world } from '../world/rooms.js';
import { mapCanvas } from './dom.js';

const mapContext = mapCanvas.getContext('2d');

// How many floors are shown on either side of the walker's own.
const FLOORS_AROUND = 2;
// The plan is foreshortened to this fraction of its depth, which is what makes
// the stack read as floors seen from above rather than as rings in a target.
const TILT = 0.36;
// The screen height of one storey, as a fraction of the canvas height.
const STOREY_SHARE = 0.18;
// Distance of a neighbour's centre, in units of ROOM_RADIUS: two apothems.
const NEIGHBOUR_REACH = 2 * APOTHEM / ROOM_RADIUS;
const LIP_APOTHEM = WELL_RADIUS * Math.cos(Math.PI / 6);

// The map is lit like the chamber: amber on the dark, brighter the nearer a
// thing is to where the walker stands.
const AMBER = '211,184,140';
const FLAME = '255,209,138';

// A canvas cannot inherit a custom property, so the ink is read from the
// document each time the map is drawn. That is also what carries
// prefers-contrast onto it.
function ink(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function amber(alpha) {
  return 'rgba(' + AMBER + ',' + alpha + ')';
}

let needsRedraw = true;
let lastYaw = Number.NaN;
let lastX = Number.NaN;
let lastZ = Number.NaN;
let lastY = Number.NaN;

export function invalidateMap() {
  needsRedraw = true;
}

export function resizeMapCanvas() {
  const scale = Math.min(devicePixelRatio, 2);
  const rect = mapCanvas.getBoundingClientRect();
  mapCanvas.width = Math.round(rect.width * scale);
  mapCanvas.height = Math.round(rect.height * scale);
  mapContext.setTransform(scale, 0, 0, scale, 0, 0);
  needsRedraw = true;
}

/**
 * The projection: a point in the plan of the current chamber, in world units,
 * on a floor `storeys` above the walker's own, to the canvas. The plan turns
 * with the walker so that ahead is always up the screen.
 */
function projection(width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  // The walker's floor, chamber and neighbours, has to fit at any heading, so
  // it is sized on the circle that holds all seven, leaving a margin for the
  // level numbers — and small enough that it clears the floors above and below.
  const scale = (width / 2 - 24) / ((NEIGHBOUR_REACH + 1) * ROOM_RADIUS);
  const storey = height * STOREY_SHARE;
  const cosine = Math.cos(-player.yaw);
  const sine = Math.sin(-player.yaw);
  return {
    scale,
    point(x, z, storeys) {
      const turnedX = x * cosine - z * sine;
      const turnedZ = x * sine + z * cosine;
      return {
        x: centerX + turnedX * scale,
        y: centerY + turnedZ * scale * TILT - storeys * storey,
      };
    },
  };
}

function hexPath(view, x, z, radius, storeys, rotation = 0) {
  mapContext.beginPath();
  for (let index = 0; index < 6; index++) {
    const angle = rotation + index * Math.PI / 3;
    const point = view.point(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, storeys);
    if (index) mapContext.lineTo(point.x, point.y);
    else mapContext.moveTo(point.x, point.y);
  }
  mapContext.closePath();
}

function line(view, from, to, fromStoreys, toStoreys = fromStoreys) {
  const a = view.point(from.x, from.z, fromStoreys);
  const b = view.point(to.x, to.z, toStoreys);
  mapContext.beginPath();
  mapContext.moveTo(a.x, a.y);
  mapContext.lineTo(b.x, b.y);
  mapContext.stroke();
}

function offsetFor(cell) {
  return axialMapOffset(cell.q - world.room.q, cell.r - world.room.r);
}

// The bridge crosses the well along the normal of the stair's edge, and the
// flight climbs along the same line; see world/well.js.
const bridge = wallBasis(STAIR_WELL_EDGE);
function alongBridge(u) {
  return { x: bridge.nx * u, z: bridge.nz * u };
}

/** A floor's doorway on wall `wall`, as the two ends of its opening. */
function doorway(wall) {
  const basis = wallBasis(wall);
  const reach = DOOR_HALF_WIDTH * 3;
  return [
    { x: basis.nx * APOTHEM - basis.tx * reach, z: basis.nz * APOTHEM - basis.tz * reach },
    { x: basis.nx * APOTHEM + basis.tx * reach, z: basis.nz * APOTHEM + basis.tz * reach },
  ];
}

function drawFloor(view, storeys, level, isOwn) {
  const distance = Math.abs(storeys);
  const fade = isOwn ? 1 : distance === 1 ? 0.55 : 0.3;
  const here = { q: world.room.q, r: world.room.r, level };

  // The neighbours, only on the walker's own floor: the others are shown as
  // what the well lets a walker see of them, which is their own chamber.
  if (isOwn) {
    for (let direction = 0; direction < WALL_DIRECTIONS.length; direction++) {
      const [dq, dr] = WALL_DIRECTIONS[direction];
      const offset = axialMapOffset(dq, dr);
      hexPath(view, offset.x, offset.z, ROOM_RADIUS, storeys);
      mapContext.fillStyle = amber(0.05);
      mapContext.fill();
      mapContext.strokeStyle = amber(0.34);
      mapContext.lineWidth = 1;
      mapContext.stroke();
    }
  }

  // The chamber itself, and the opening in its floor.
  hexPath(view, 0, 0, ROOM_RADIUS, storeys);
  mapContext.fillStyle = amber(isOwn ? 0.16 : 0.06 * fade);
  mapContext.fill();
  mapContext.strokeStyle = amber(isOwn ? 0.85 : 0.5 * fade);
  mapContext.lineWidth = isOwn ? 1.2 : 1;
  mapContext.stroke();
  hexPath(view, 0, 0, WELL_RADIUS, storeys);
  mapContext.fillStyle = 'rgba(8,5,3,' + (isOwn ? 0.55 : 0.3) + ')';
  mapContext.fill();
  mapContext.strokeStyle = amber(0.4 * fade);
  mapContext.lineWidth = 0.8;
  mapContext.stroke();

  // The bridge across the opening.
  mapContext.strokeStyle = amber(0.55 * fade);
  mapContext.lineWidth = isOwn ? 1.4 : 1;
  line(view, alongBridge(-LIP_APOTHEM), alongBridge(-STAIR_HALF_RUN), storeys);
  line(view, alongBridge(STAIR_HALF_RUN), alongBridge(LIP_APOTHEM), storeys);

  // The doorways, and on the walker's floor where each passage leads: ahead,
  // and the two chambers that flank it.
  for (const wall of freeWallsForLevel(level)) {
    const [from, to] = doorway(wall);
    if (isOwn) {
      const basis = wallBasis(wall);
      const mouth = { x: basis.nx * APOTHEM, z: basis.nz * APOTHEM };
      mapContext.strokeStyle = amber(0.3);
      mapContext.lineWidth = 1;
      mapContext.setLineDash([2, 3]);
      for (const end of Object.values(passageExits(here, wall))) {
        if (end.q === here.q && end.r === here.r) continue;
        const offset = offsetFor(end);
        line(view, mouth, { x: offset.x, z: offset.z }, storeys);
      }
      mapContext.setLineDash([]);
    }
    mapContext.strokeStyle = 'rgba(' + FLAME + ',' + (isOwn ? 0.95 : 0.6 * fade) + ')';
    mapContext.lineWidth = isOwn ? 2.6 : 1.6;
    line(view, from, to, storeys);
  }
}

function drawNumbers(view, floors) {
  const currentInk = ink('--map-ink', 'rgb(' + FLAME + ')');
  mapContext.textAlign = 'center';
  mapContext.textBaseline = 'middle';
  for (const { storeys, level, isOwn } of floors) {
    const cells = [{ q: world.room.q, r: world.room.r, level }];
    if (isOwn) {
      for (const [dq, dr] of WALL_DIRECTIONS) cells.push({ q: world.room.q + dq, r: world.room.r + dr, level });
    }
    for (const cell of cells) {
      const ordinal = ordinalFor(cell);
      if (ordinal === null) continue;
      const isCurrent = isOwn && cell.q === world.room.q && cell.r === world.room.r;
      const offset = offsetFor(cell);
      // A chamber's number is written beside its well rather than in it, where
      // the ring and the bridge would cross it out.
      const inside = isCurrent || cells.length === 1 ? (WELL_RADIUS + ROOM_RADIUS) / 2 : 0;
      const at = view.point(offset.x, offset.z + inside, storeys);
      mapContext.fillStyle = isCurrent ? currentInk : amber(isOwn ? 0.75 : 0.5);
      mapContext.font = (isCurrent ? '700 12px' : '600 10px') + ' "Courier New", monospace';
      mapContext.fillText(String(ordinal), at.x, at.y);
    }
  }
}

function drawMap() {
  const rect = mapCanvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  mapContext.clearRect(0, 0, width, height);
  const view = projection(width, height);
  const level = world.room.level;

  // A pool of dark behind the map, so it reads over a lit wall as well as over
  // the shaft. It has no edge, like everything else lit in this library.
  const backdrop = mapContext.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.min(width, height) / 2);
  backdrop.addColorStop(0, 'rgba(10,6,3,.72)');
  backdrop.addColorStop(0.7, 'rgba(10,6,3,.45)');
  backdrop.addColorStop(1, 'rgba(10,6,3,0)');
  mapContext.fillStyle = backdrop;
  mapContext.fillRect(0, 0, width, height);

  const floors = [];
  for (let storeys = -FLOORS_AROUND; storeys <= FLOORS_AROUND; storeys++) {
    floors.push({ storeys, level: level + BigInt(storeys), isOwn: storeys === 0 });
  }

  // The shaft: the six arrises of the well, from the lowest floor shown to the
  // highest, drawn first so every floor lies across it.
  mapContext.strokeStyle = amber(0.16);
  mapContext.lineWidth = 1;
  for (let index = 0; index < 6; index++) {
    const angle = index * Math.PI / 3;
    const corner = { x: Math.cos(angle) * WELL_RADIUS, z: Math.sin(angle) * WELL_RADIUS };
    line(view, corner, corner, -FLOORS_AROUND - 0.4, FLOORS_AROUND + 0.4);
  }

  // Lowest floor first, so each floor is laid over the ones beneath it.
  for (const floor of floors) {
    drawFloor(view, floor.storeys, floor.level, floor.isOwn);
    // The flight up to the next floor, from the foot on this one to the head
    // on the one above.
    if (floor.storeys < FLOORS_AROUND) {
      const near = Math.abs(floor.storeys + 0.5) < 1;
      mapContext.strokeStyle = 'rgba(' + FLAME + ',' + (near ? 0.8 : 0.35) + ')';
      mapContext.lineWidth = near ? 1.6 : 1;
      line(view, alongBridge(-STAIR_HALF_RUN), alongBridge(STAIR_HALF_RUN), floor.storeys, floor.storeys + 1);
    }
  }

  // The level each floor is, on the side the stair does not use.
  mapContext.font = '600 9px "Courier New", monospace';
  mapContext.textAlign = 'left';
  mapContext.textBaseline = 'middle';
  for (const floor of floors) {
    if (floor.isOwn) continue;
    const at = view.point(0, 0, floor.storeys);
    mapContext.fillStyle = amber(Math.abs(floor.storeys) === 1 ? 0.6 : 0.4);
    mapContext.fillText(String(floor.level), width - 22, at.y);
  }

  // The walker, at the height their feet are at, so the ring climbs the flight
  // with them instead of jumping a storey when they reach the top of it.
  const stood = planePosition(camera.position, level);
  const risen = (camera.position.y - EYE_HEIGHT) / WALL_HEIGHT;
  const walker = view.point(stood.x, stood.z, risen);
  mapContext.strokeStyle = 'rgb(' + FLAME + ')';
  mapContext.lineWidth = 1.3;
  mapContext.beginPath();
  mapContext.arc(walker.x, walker.y, 5.5, 0, Math.PI * 2);
  mapContext.stroke();
  // Which way they face, which is always up the screen.
  mapContext.fillStyle = 'rgb(' + FLAME + ')';
  mapContext.beginPath();
  mapContext.moveTo(walker.x, walker.y - 11);
  mapContext.lineTo(walker.x - 3.2, walker.y - 6);
  mapContext.lineTo(walker.x + 3.2, walker.y - 6);
  mapContext.closePath();
  mapContext.fill();

  drawNumbers(view, floors);

  // The walker's own level, where a reader looks for it.
  const own = view.point(0, 0, 0);
  mapContext.font = '700 10px "Courier New", monospace';
  mapContext.fillStyle = amber(0.9);
  mapContext.fillText(String(level), width - 22, own.y);
  mapContext.font = '600 8px "Courier New", monospace';
  mapContext.fillStyle = amber(0.55);
  mapContext.fillText('level', width - 22, own.y - 11);
}

export function syncMap() {
  // Keyed on the place in the plane rather than the camera, so a walker in a
  // passage — who is not moving here at all — costs no repaints either. Height
  // counts too, because on the stair it is the only thing that changes.
  const stood = planePosition(camera.position, world.room.level);
  const y = camera.position.y;
  if (!needsRedraw
    && Math.abs(player.yaw - lastYaw) < 0.004
    && Math.abs(stood.x - lastX) < 0.01
    && Math.abs(stood.z - lastZ) < 0.01
    && Math.abs(y - lastY) < 0.02) return;
  needsRedraw = false;
  lastYaw = player.yaw;
  lastX = stood.x;
  lastZ = stood.z;
  lastY = y;
  drawMap();
}
