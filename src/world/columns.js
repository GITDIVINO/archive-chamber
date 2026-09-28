/**
 * The load-bearing order: the piers that carry the shaft and the columns that
 * frame each doorway.
 *
 * Nothing in a chamber used to say how big it is. A wall fourteen metres high
 * with a band of shelving at its foot reads as a low room with a dark ceiling,
 * because the eye measures height by what stands in it, and nothing did. A
 * column the full height of the storey is that measure: it has a base a walker
 * can put a hand on and a capital lost in the haze overhead, and the distance
 * between the two is the size of the building.
 *
 * Two families, both symmetric about every axis the chamber has:
 *
 * - Six piers, one at each corner of the well. They stand just inside the
 *   guard, flush with it, so they need no collision of their own: the walker is
 *   already held off that line. The shaft repeats every storey, so a pier does
 *   too, and down the well the six become unbroken shafts of stone falling out
 *   of sight in both directions.
 * - A pair of columns either side of every doorway, which is now cut almost to
 *   the storey above. The columns turn with the doorways as the level turns.
 *
 * Plain box parts, like well.js, so the chamber and the vista build the same
 * structure in their own batches.
 */

import * as THREE from 'three';
import {
  DOOR_HALF_WIDTH,
  HALL_OPENING_HEIGHT,
  PLAYER_RADIUS,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WELL_GUARD_RADIUS,
  WELL_SLAB_THICKNESS,
} from '../constants.js';
import { pointOnWall, wallBasis } from './geometry.js';

// --- the piers of the well -----------------------------------------------------

export const PIER_WIDTH = 1.4;
const PIER_HALF = PIER_WIDTH / 2;
// The walker is held a body's radius outside the guard's six planes. Along a
// plane the limit recedes from the corner at tan(30°) per unit sideways, so a
// square pier whose outer corners sit on that line is as large as the corner
// can take without a collision rule of its own.
const CLEAR_CORNER_RADIUS = (WELL_GUARD_RADIUS * Math.cos(Math.PI / 6) + PLAYER_RADIUS) / Math.cos(Math.PI / 6);
export const PIER_CENTRE_RADIUS = CLEAR_CORNER_RADIUS - PIER_HALF - PIER_HALF * Math.tan(Math.PI / 6) - 0.02;
const PIER_TOP = WALL_HEIGHT - WELL_SLAB_THICKNESS;

// Mouldings in timber, the shaft in stone. The collar is where the floor slab
// passes the pier, so each storey is marked on it the way a floor line is
// marked on a tower.
const PIER_BASE = { width: PIER_WIDTH + 0.36, height: 0.7 };
const PIER_BASE_TORUS = { width: PIER_WIDTH + 0.2, height: 0.18 };
const PIER_CAPITAL = { width: PIER_WIDTH + 0.3, height: 0.55 };
const PIER_ABACUS = { width: PIER_WIDTH + 0.5, height: 0.22 };
const PIER_COLLAR = { width: PIER_WIDTH + 0.12, height: 0.32 };

function pierFrame(corner) {
  const angle = corner * Math.PI / 3;
  const x = Math.cos(angle) * PIER_CENTRE_RADIUS;
  const z = Math.sin(angle) * PIER_CENTRE_RADIUS;
  // Faces square to the radius: the pier presents a face, not an arris, to the
  // walker coming round the gallery and to the centre of the shaft.
  return { x, z, rotation: -angle + Math.PI / 2 };
}

function pierParts(detailed) {
  const parts = [];
  for (let corner = 0; corner < 6; corner++) {
    const { x, z, rotation } = pierFrame(corner);
    const at = y => new THREE.Vector3(x, y, z);
    const add = (width, height, y, stone) => parts.push({
      size: [width, height, width], position: at(y), rotation, stone,
    });
    // One unbroken shaft, floor to the underside of the slab above.
    add(PIER_WIDTH, PIER_TOP, PIER_TOP / 2, true);
    // Down the shaft the shaft is all that reads: storey on storey it is one
    // unbroken column, and a capital a storey off is under a pixel of fog.
    if (!detailed) continue;
    add(PIER_BASE.width, PIER_BASE.height, PIER_BASE.height / 2, false);
    add(PIER_BASE_TORUS.width, PIER_BASE_TORUS.height, PIER_BASE.height + PIER_BASE_TORUS.height / 2, false);
    add(PIER_CAPITAL.width, PIER_CAPITAL.height,
      PIER_TOP - PIER_ABACUS.height - PIER_CAPITAL.height / 2, false);
    add(PIER_ABACUS.width, PIER_ABACUS.height, PIER_TOP - PIER_ABACUS.height / 2, false);
    // Where the floor of this storey passes it.
    add(PIER_COLLAR.width, PIER_COLLAR.height, -WELL_SLAB_THICKNESS / 2, false);
  }
  return parts;
}

export const WELL_PIER_PARTS = Object.freeze(pierParts(true));
export const WELL_DISTANT_PIER_PARTS = Object.freeze(pierParts(false));

// --- the columns of a doorway ----------------------------------------------------

export const DOOR_COLUMN_WIDTH = 1.5;
export const DOOR_COLUMN_DEPTH = 0.9;
// Clear of the opening by enough for the reveal's lining to read between them.
export const DOOR_COLUMN_TANGENT = DOOR_HALF_WIDTH + 0.45 + DOOR_COLUMN_WIDTH / 2;
const FACE = WALL_THICKNESS / 2;
const COLUMN_BASE = { grow: 0.36, height: 0.9 };
const COLUMN_CAPITAL = { grow: 0.3, height: 0.7 };
const COLUMN_ABACUS = { grow: 0.5, height: 0.26 };
// A column is fluted in three: two shallow grooves cut by raising three strips
// on its face. Boxes cannot be cut, so the strips are what is built.
const FLUTES = 3;
const FLUTE_PROUD = 0.05;

export function doorColumnParts(wall, detailed = true) {
  const basis = wallBasis(wall);
  const parts = [];
  const top = WALL_HEIGHT - WELL_SLAB_THICKNESS;
  for (const side of [-1, 1]) {
    const tangent = side * DOOR_COLUMN_TANGENT;
    const add = (width, height, depth, y, stone) => parts.push({
      size: [width, height, depth],
      position: pointOnWall(basis, tangent, y, FACE + depth / 2),
      rotation: basis.rotation,
      stone,
    });
    add(DOOR_COLUMN_WIDTH, top, DOOR_COLUMN_DEPTH, top / 2, true);
    if (!detailed) continue;
    add(DOOR_COLUMN_WIDTH + COLUMN_BASE.grow, COLUMN_BASE.height,
      DOOR_COLUMN_DEPTH + COLUMN_BASE.grow / 2, COLUMN_BASE.height / 2, false);
    add(DOOR_COLUMN_WIDTH + COLUMN_CAPITAL.grow, COLUMN_CAPITAL.height,
      DOOR_COLUMN_DEPTH + COLUMN_CAPITAL.grow / 2,
      top - COLUMN_ABACUS.height - COLUMN_CAPITAL.height / 2, false);
    add(DOOR_COLUMN_WIDTH + COLUMN_ABACUS.grow, COLUMN_ABACUS.height,
      DOOR_COLUMN_DEPTH + COLUMN_ABACUS.grow / 2, top - COLUMN_ABACUS.height / 2, false);
    const fluteHeight = top - COLUMN_BASE.height - COLUMN_CAPITAL.height - COLUMN_ABACUS.height - 0.5;
    const fluteY = COLUMN_BASE.height + 0.25 + fluteHeight / 2;
    const fluteWidth = DOOR_COLUMN_WIDTH / (2 * FLUTES + 1);
    for (let flute = 0; flute < FLUTES; flute++) {
      const offset = (flute - (FLUTES - 1) / 2) * 2 * fluteWidth;
      parts.push({
        size: [fluteWidth, fluteHeight, FLUTE_PROUD],
        position: pointOnWall(basis, tangent + offset, fluteY, FACE + DOOR_COLUMN_DEPTH + FLUTE_PROUD / 2),
        rotation: basis.rotation,
        stone: true,
      });
    }
  }
  // An entablature across the head of the opening, column to column: the
  // doorway is a gate in an order now, not a hole in a wall.
  const span = 2 * DOOR_COLUMN_TANGENT + DOOR_COLUMN_WIDTH;
  const beamY = HALL_OPENING_HEIGHT + 0.45;
  parts.push({
    size: [span, 0.5, 0.5],
    position: pointOnWall(basis, 0, beamY, FACE + 0.25),
    rotation: basis.rotation,
    stone: false,
  });
  return parts;
}

/** Where a lantern hangs on each doorway column, facing into the chamber. */
export function doorColumnLanternPoints(wall, height) {
  const basis = wallBasis(wall);
  return [-1, 1].map(side => pointOnWall(
    basis, side * DOOR_COLUMN_TANGENT, height, FACE + DOOR_COLUMN_DEPTH + 0.34,
  ));
}
