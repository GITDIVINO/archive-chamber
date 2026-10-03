/**
 * The reading corners: a desk, two stools and a lamp in every corner of a
 * chamber.
 *
 * The reference has one small warm thing in all that cold height, a person at
 * a table with a lamp, and it is what says the shaft is lived in. The six
 * corners are where it can stand: the cabinets stop short of them, the walker
 * cannot reach the last metre of them, and the librarians' rings turn well
 * inside. A desk there takes no one's way.
 *
 * Every corner gets the same set, laid out about its own axis, so the chamber
 * keeps the symmetry of its walls whichever two of them carry doorways. The
 * parts are plain boxes for the room's own merged batches, which is why the
 * desks cost no draw call: they only add to materials the chamber already has.
 */

import * as THREE from 'three';
import { PLAYER_RADIUS } from '../constants.js';

// Along the corner's axis from the centre of the chamber. The corner itself is
// at ROOM_RADIUS (53.4), and a walker's centre can come no nearer than 51.96,
// so the desk stands just inside the last place anyone can reach and the
// outermost librarian ring (corners at 49.9) passes its stools with room to
// spare.
export const READING_CORNER_RADIUS = 51.3;

const DESK_HEIGHT = 0.78;
const TOP_THICKNESS = 0.06;
const DESK_LENGTH = 1.4;
const DESK_DEPTH = 0.76;
const LEG = 0.07;
const STOOL_REACH = 0.95;
const STOOL_SEAT = 0.34;
const STOOL_HEIGHT = 0.46;

// Parts are given in the corner's own frame: x across the corner, y up, z
// outward along its axis towards the corner itself. kind picks the material.
const DESK_PARTS = [];
function part(kind, size, x, y, z) {
  DESK_PARTS.push({ kind, size, local: [x, y, z] });
}

// The top, and four legs set in from its corners.
part('wood', [DESK_LENGTH, TOP_THICKNESS, DESK_DEPTH], 0, DESK_HEIGHT - TOP_THICKNESS / 2, 0);
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    part('wood', [LEG, DESK_HEIGHT - TOP_THICKNESS, LEG],
      sx * (DESK_LENGTH / 2 - LEG), (DESK_HEIGHT - TOP_THICKNESS) / 2, sz * (DESK_DEPTH / 2 - LEG));
  }
}
// A stretcher low between the legs: what makes four sticks a table.
part('wood', [DESK_LENGTH - 2 * LEG, 0.04, 0.04], 0, 0.2, DESK_DEPTH / 2 - LEG);
part('wood', [DESK_LENGTH - 2 * LEG, 0.04, 0.04], 0, 0.2, -(DESK_DEPTH / 2 - LEG));

// What is on it, laid out about the axis: the book being read in the middle,
// a stack of closed volumes either side, the lamp at the back.
const TOP = DESK_HEIGHT;
part('dark', [0.5, 0.025, 0.34], 0, TOP + 0.0125, -0.08);
part('brass', [0.44, 0.03, 0.29], 0, TOP + 0.04, -0.08);
for (const side of [-1, 1]) {
  part('brass', [0.34, 0.07, 0.24], side * 0.5, TOP + 0.035, 0.08);
  part('dark', [0.3, 0.05, 0.22], side * 0.5, TOP + 0.095, 0.08);
}
part('brass', [0.17, 0.035, 0.17], 0, TOP + 0.0175, 0.2);
part('brass', [0.035, 0.26, 0.035], 0, TOP + 0.165, 0.2);
part('brass', [0.2, 0.03, 0.2], 0, TOP + 0.31, 0.2);
part('lamp', [0.17, 0.2, 0.17], 0, TOP + 0.425, 0.2);
part('brass', [0.2, 0.03, 0.2], 0, TOP + 0.54, 0.2);

// A stool at either end, pulled in: a seat on a post on a foot.
for (const side of [-1, 1]) {
  const x = side * STOOL_REACH;
  part('dark', [STOOL_SEAT, 0.05, STOOL_SEAT], x, STOOL_HEIGHT - 0.025, 0);
  part('dark', [0.06, STOOL_HEIGHT - 0.1, 0.06], x, (STOOL_HEIGHT - 0.1) / 2 + 0.04, 0);
  part('dark', [STOOL_SEAT * 0.9, 0.04, STOOL_SEAT * 0.9], x, 0.02, 0);
}

// Where the flame is, in the corner's own frame, and how far its light carries.
export const DESK_LAMP_LOCAL = Object.freeze([0, TOP + 0.425, 0.2]);
export const DESK_LIGHT_INTENSITY = 6;
export const DESK_LIGHT_RANGE = 9;

export const READING_CORNER_PARTS = Object.freeze(DESK_PARTS.map(entry => Object.freeze(entry)));

const CORNER_COUNT = 6;

/** The six corners: where each one is, and which way its axis points. */
export const READING_CORNERS = Object.freeze(
  Array.from({ length: CORNER_COUNT }, (_, index) => {
    const angle = index * Math.PI / 3;
    return Object.freeze({
      angle,
      x: Math.cos(angle) * READING_CORNER_RADIUS,
      z: Math.sin(angle) * READING_CORNER_RADIUS,
    });
  }),
);

/** A part's place in the chamber, for the corner at the given angle. */
export function readingPartPlacement(corner, local) {
  const cos = Math.cos(corner.angle);
  const sin = Math.sin(corner.angle);
  const [across, up, out] = local;
  return {
    position: new THREE.Vector3(
      corner.x + out * cos + across * sin,
      up,
      corner.z + out * sin - across * cos,
    ),
    // The part's own z axis runs along the corner's axis.
    rotation: Math.PI / 2 - corner.angle,
  };
}

// Desk and stools together are a bar along the corner's width, so the walker is
// held off the segment between the stools at the desk's depth and a body's width.
const KEEP_OFF = DESK_DEPTH / 2 + PLAYER_RADIUS;
// Anyone standing on a gallery is above the desk, not at it.
const FLOOR_REACH = 2;

/**
 * Pushes a walker out of the desks. Only the corners can matter, and a walker
 * can no more get behind a desk than into the cabinets beside it, so a push
 * out never has to choose between a desk and a wall.
 */
export function constrainFromReadingCorners(position, footY = 0) {
  if (footY > FLOOR_REACH) return;
  for (const corner of READING_CORNERS) {
    const sin = Math.sin(corner.angle);
    const cos = Math.cos(corner.angle);
    const dx = position.x - corner.x;
    const dz = position.z - corner.z;
    const across = dx * sin - dz * cos;
    const out = dx * cos + dz * sin;
    // The nearest point on the line between the stools.
    const along = Math.max(-STOOL_REACH, Math.min(STOOL_REACH, across));
    const gapAcross = across - along;
    const distance = Math.hypot(gapAcross, out);
    if (distance >= KEEP_OFF) continue;
    // Straight in from the middle of the line, where the direction is not defined,
    // goes back the way a walker comes: along the axis towards the room.
    const scale = distance > 1e-6 ? KEEP_OFF / distance : 1;
    const pushedAcross = along + (distance > 1e-6 ? gapAcross * scale : 0);
    const pushedOut = distance > 1e-6 ? out * scale : -KEEP_OFF;
    position.x = corner.x + pushedOut * cos + pushedAcross * sin;
    position.z = corner.z + pushedOut * sin - pushedAcross * cos;
  }
}
