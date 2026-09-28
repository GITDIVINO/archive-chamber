/**
 * The galleries: two tiers of walkways round every chamber, and the spiral
 * stairs that climb to them.
 *
 * A wall fourteen metres high used to carry one course of shelving at its foot
 * and nothing above, so a chamber read as a hall with books along the skirting.
 * The library in the story is shelves from floor to ceiling, and a library that
 * size is walked in tiers: a gallery on consoles at each third of the storey,
 * railed in iron, with a tier of cases standing on it. The walker can climb to
 * both, which is what makes the height a place rather than a backdrop.
 *
 * The galleries run round all six walls at the same depth, so from the floor
 * they are three rings one above another. They stop short of each doorway on
 * either side, and in that gap, against each doorway wall, a spiral stair rises
 * from the floor through the first gallery to the second. Four stairs to a
 * chamber, two either side of each opening, and each the mirror of its
 * neighbour across the doorway.
 *
 * Every course of cases is catalogued: the placement numbers a wall's shelves
 * 1-5 on the floor, 6-10 on the first gallery and 11-15 on the second, 11520
 * volumes to a chamber. The galleries' volumes carry no lettered spines, but
 * any of them can be taken down and read.
 *
 * Plain parts, as in well.js and columns.js, so the chamber and the shaft build
 * the same structure in their own batches.
 */

import * as THREE from 'three';
import {
  APOTHEM,
  PLAYER_RADIUS,
  STAIR_MOUNT_REACH,
  WALL_HEIGHT,
  WALL_THICKNESS,
} from '../constants.js';
import { pointOnWall, wallBasis } from './geometry.js';

/** Floor levels of the two galleries, a third and two thirds of the storey. */
export const GALLERY_LEVELS = Object.freeze([WALL_HEIGHT / 3, 2 * WALL_HEIGHT / 3]);
export const GALLERY_DEPTH = 2.6;
export const GALLERY_SLAB = 0.3;
const WALL_FACE = APOTHEM - WALL_THICKNESS / 2;
/** Distance from the centre to the inner edge of a gallery. */
export const GALLERY_EDGE = WALL_FACE - GALLERY_DEPTH;
const HALF_SIDE = distance => distance * Math.tan(Math.PI / 6);

// --- the spiral stairs ---------------------------------------------------------

export const SPIRAL_RADIUS = 1.5;
const SPIRAL_CORE = 0.16;
export const SPIRAL_STEPS_PER_TURN = 16;
// One turn per gallery, so a stair leaves each landing the way it arrived at
// it: facing the wall, where the gallery is.
const SPIRAL_TURN_RISE = GALLERY_LEVELS[0];
const SPIRAL_TURNS = GALLERY_LEVELS.length;
const SPIRAL_RISER = SPIRAL_TURN_RISE / SPIRAL_STEPS_PER_TURN;
// Against the doorway wall, out towards its corners, in the gap the galleries
// leave. Nearer the doorway they stood in the way of anybody stepping off the
// bridge, which lands in front of a doorway on every other floor, and walking
// on round the well.
export const SPIRAL_TANGENT = 20;
const SPIRAL_INWARD = WALL_THICKNESS / 2 + SPIRAL_RADIUS + 0.42;
// Where the galleries on a doorway wall stop, towards the opening: just past
// the stair, which meets each of them at that end.
export const GALLERY_DOOR_END = SPIRAL_TANGENT + SPIRAL_RADIUS + 0.05;
// The half-width of the gap left in a gallery's railing where a stair meets it.
const SPIRAL_LANDING_HALF = 0.8;
// How far round from the landing line the floor still runs under the first
// tread. Narrow, so that a walker stepping on is carried up by the treads
// rather than walking on along the floor beneath them.
const SPIRAL_FLOOR_ENTRY = 0.3;

/** Every spiral stair in a chamber whose doorways are on `doorWalls`. */
export function spiralsFor(doorWalls) {
  const spirals = [];
  for (const wall of doorWalls) {
    const basis = wallBasis(wall);
    for (const side of [-1, 1]) {
      const centre = pointOnWall(basis, side * SPIRAL_TANGENT, 0, SPIRAL_INWARD);
      spirals.push({
        wall,
        side,
        x: centre.x,
        z: centre.z,
        // Facing away from the doorway, along the wall to where the galleries
        // end: that is where each landing is.
        landingAngle: Math.atan2(side * basis.tz, side * basis.tx),
        inward: SPIRAL_INWARD,
        // Mirrored across the doorway: one turns left as it climbs, the other
        // right, so the pair is symmetric about the opening between them.
        hand: side,
      });
    }
  }
  return spirals;
}

// --- geometry ----------------------------------------------------------------

const BALUSTER_PITCH = 0.62;
const RAIL_HEIGHT = 1.02;
const CONSOLE_PITCH = 3.1;

function slabPart(basis, level, left, right) {
  return {
    slab: { left, right, depth: GALLERY_DEPTH, height: GALLERY_SLAB },
    position: pointOnWall(basis, 0, level - GALLERY_SLAB / 2, WALL_THICKNESS / 2 + GALLERY_DEPTH / 2),
    rotation: basis.rotation,
    kind: 'wood',
  };
}

// One run of railing along a gallery's inner edge, from tangent `from` to `to`,
// leaving out the stretches in `gaps`.
function railingParts(parts, basis, level, from, to, gaps, detailed) {
  const inward = WALL_THICKNESS / 2 + GALLERY_DEPTH - 0.05;
  const pieces = [];
  let start = from;
  for (const [gapFrom, gapTo] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (gapFrom > start) pieces.push([start, gapFrom]);
    start = Math.max(start, gapTo);
  }
  if (to > start) pieces.push([start, to]);
  for (const [a, b] of pieces) {
    const length = b - a;
    const middle = (a + b) / 2;
    parts.push({
      size: [length, 0.07, 0.09],
      position: pointOnWall(basis, middle, level + RAIL_HEIGHT, inward),
      rotation: basis.rotation,
      kind: 'wood',
    });
    if (!detailed) continue;
    parts.push({
      size: [length, 0.035, 0.035],
      position: pointOnWall(basis, middle, level + 0.12, inward),
      rotation: basis.rotation,
      kind: 'iron',
    });
    const count = Math.max(1, Math.round(length / BALUSTER_PITCH));
    for (let index = 0; index <= count; index++) {
      parts.push({
        size: [0.035, RAIL_HEIGHT, 0.035],
        position: pointOnWall(basis, a + length * index / count, level + RAIL_HEIGHT / 2, inward),
        rotation: basis.rotation,
        kind: 'iron',
      });
    }
  }
}

function consoleParts(parts, basis, level, from, to) {
  const count = Math.max(1, Math.floor((to - from) / CONSOLE_PITCH));
  for (let index = 0; index <= count; index++) {
    const tangent = from + (to - from) * index / count;
    // Set forward of the cases below, which stand 0.84 off the wall.
    parts.push({
      size: [0.24, 0.72, 1.5],
      position: pointOnWall(basis, tangent, level - GALLERY_SLAB - 0.36, WALL_THICKNESS / 2 + 1.0 + 0.75),
      rotation: basis.rotation,
      kind: 'wood',
    });
  }
}

function spiralParts(parts, spiral, detailed) {
  const { x, z, landingAngle, hand } = spiral;
  const top = GALLERY_LEVELS[GALLERY_LEVELS.length - 1];
  parts.push({
    size: [0.3, top + RAIL_HEIGHT + 0.3, 0.3],
    position: new THREE.Vector3(x, (top + RAIL_HEIGHT + 0.3) / 2, z),
    rotation: 0,
    kind: 'iron',
  });
  if (!detailed) return;
  const step = 2 * Math.PI / SPIRAL_STEPS_PER_TURN;
  const treadLength = SPIRAL_RADIUS - SPIRAL_CORE;
  const treadWidth = SPIRAL_RADIUS * step * 0.92;
  const railRadius = SPIRAL_RADIUS - 0.06;
  let previousTop = null;
  const total = SPIRAL_STEPS_PER_TURN * SPIRAL_TURNS;
  for (let index = 0; index < total; index++) {
    const angle = landingAngle + hand * (index + 0.5) * step;
    const topY = (index + 1) * SPIRAL_RISER;
    const reach = SPIRAL_CORE + treadLength / 2;
    parts.push({
      size: [treadLength, 0.07, treadWidth],
      position: new THREE.Vector3(x + Math.cos(angle) * reach, topY - 0.035, z + Math.sin(angle) * reach),
      rotation: -angle,
      kind: 'wood',
    });
    // A bracket under each tread's outer end, which is what makes a fan of
    // planks read as a stair hung off its newel rather than floating.
    parts.push({
      size: [treadLength * 0.8, 0.05, 0.05],
      position: new THREE.Vector3(
        x + Math.cos(angle) * (SPIRAL_CORE + treadLength * 0.45),
        topY - 0.1,
        z + Math.sin(angle) * (SPIRAL_CORE + treadLength * 0.45),
      ),
      rotation: -angle,
      kind: 'iron',
    });
    const railTop = new THREE.Vector3(
      x + Math.cos(angle) * railRadius,
      topY + RAIL_HEIGHT,
      z + Math.sin(angle) * railRadius,
    );
    // The landings are left open: a baluster there would stand in the way off.
    const atLanding = (index + 1) % SPIRAL_STEPS_PER_TURN === 0;
    if (!atLanding) {
      parts.push({
        size: [0.03, RAIL_HEIGHT, 0.03],
        position: new THREE.Vector3(railTop.x, topY + RAIL_HEIGHT / 2, railTop.z),
        rotation: 0,
        kind: 'iron',
      });
    }
    if (previousTop && !atLanding) {
      const dx = railTop.x - previousTop.x;
      const dy = railTop.y - previousTop.y;
      const dz = railTop.z - previousTop.z;
      const run = Math.hypot(dx, dz);
      parts.push({
        size: [Math.hypot(run, dy), 0.05, 0.05],
        position: new THREE.Vector3(
          (railTop.x + previousTop.x) / 2,
          (railTop.y + previousTop.y) / 2,
          (railTop.z + previousTop.z) / 2,
        ),
        rotation: Math.atan2(-dz, dx),
        rotationZ: Math.atan2(dy, run),
        kind: 'wood',
      });
    }
    previousTop = atLanding ? null : railTop;
  }
}

/**
 * The galleries, their railings and consoles, and the stairs, for a chamber
 * whose doorways are on `doorWalls`. `detailed` false is the shaft's version:
 * slabs, top rails and newels only.
 */
export function galleryParts(doorWalls, detailed = true) {
  const parts = [];
  for (let wall = 0; wall < 6; wall++) {
    const basis = wallBasis(wall);
    const inner = HALF_SIDE(GALLERY_EDGE);
    const outer = HALF_SIDE(WALL_FACE);
    const doorway = doorWalls.includes(wall);
    for (const level of GALLERY_LEVELS) {
      if (!doorway) {
        parts.push(slabPart(basis, level, [-inner, -outer], [inner, outer]));
        railingParts(parts, basis, level, -inner, inner, [], detailed);
        if (detailed) consoleParts(parts, basis, level, -inner + 1.2, inner - 1.2);
        continue;
      }
      for (const side of [-1, 1]) {
        // Local x runs against the wall's tangent; see mitredSlabFor.
        const end = GALLERY_DOOR_END;
        parts.push(side > 0
          ? slabPart(basis, level, [-inner, -outer], [-end, -end])
          : slabPart(basis, level, [end, end], [inner, outer]));
        const from = side > 0 ? end : -inner;
        const to = side > 0 ? inner : -end;
        railingParts(parts, basis, level, from, to, [], detailed);
        // The end of the gallery, railed across towards the doorway but for
        // the gap where the stair arrives.
        const gapFrom = SPIRAL_INWARD - SPIRAL_LANDING_HALF;
        const gapTo = SPIRAL_INWARD + SPIRAL_LANDING_HALF;
        const edge = WALL_THICKNESS / 2 + GALLERY_DEPTH - 0.05;
        for (const [a, b] of [[WALL_THICKNESS / 2, gapFrom], [gapTo, edge]]) {
          parts.push({
            size: [0.09, 0.07, b - a],
            position: pointOnWall(basis, side * end, level + RAIL_HEIGHT, (a + b) / 2),
            rotation: basis.rotation,
            kind: 'wood',
          });
        }
        if (detailed) {
          consoleParts(parts, basis, level, Math.min(side * (end + 0.6), side * (inner - 1.2)),
            Math.max(side * (end + 0.6), side * (inner - 1.2)));
        }
      }
    }
  }
  for (const spiral of spiralsFor(doorWalls)) spiralParts(parts, spiral, detailed);
  return parts;
}

// --- where a walker can stand ----------------------------------------------------

const EDGE_MARGIN = PLAYER_RADIUS;
const LANDING_REACH = GALLERY_DOOR_END - 0.12;

function onGallery(x, z, doorWalls) {
  for (let wall = 0; wall < 6; wall++) {
    const basis = wallBasis(wall);
    const normal = basis.nx * x + basis.nz * z;
    if (normal < GALLERY_EDGE - SPIRAL_RADIUS) continue;
    const tangent = basis.tx * x + basis.tz * z;
    if (doorWalls.includes(wall)) {
      if (normal < GALLERY_EDGE + EDGE_MARGIN) continue;
      // Stepping off a stair at a landing crosses the end railing's line.
      const atLanding = Math.abs(APOTHEM - SPIRAL_INWARD - normal) < SPIRAL_LANDING_HALF - EDGE_MARGIN;
      if (Math.abs(tangent) >= (atLanding ? LANDING_REACH : GALLERY_DOOR_END + EDGE_MARGIN)) return true;
      continue;
    }
    if (normal >= GALLERY_EDGE + EDGE_MARGIN) return true;
  }
  return false;
}

/**
 * The spiral a point is over, as its distance from the newel and the height of
 * each of its treads there, or null. The treads are one continuous helix, so
 * the same point carries one height per turn and which one is underfoot is
 * settled by where the feet already are.
 */
function spiralAt(x, z, doorWalls) {
  for (const spiral of spiralsFor(doorWalls)) {
    const dx = x - spiral.x;
    const dz = z - spiral.z;
    const radius = Math.hypot(dx, dz);
    if (radius > SPIRAL_RADIUS + EDGE_MARGIN) continue;
    const turn = spiral.hand * (Math.atan2(dz, dx) - spiral.landingAngle);
    const fraction = ((turn / (2 * Math.PI)) % 1 + 1) % 1;
    // Beside the landing line a walker is stepping on or off; elsewhere the
    // stair's own rail holds them a body's width inside its edge.
    const offLanding = Math.min(fraction, 1 - fraction) * 2 * Math.PI * radius;
    const edge = offLanding < SPIRAL_LANDING_HALF ? SPIRAL_RADIUS + EDGE_MARGIN : SPIRAL_RADIUS - EDGE_MARGIN;
    const heights = [];
    if (radius >= SPIRAL_CORE + EDGE_MARGIN && radius <= edge) {
      for (let lap = 0; lap <= SPIRAL_TURNS; lap++) {
        const height = (lap + fraction) * SPIRAL_TURN_RISE;
        if (height <= SPIRAL_TURNS * SPIRAL_TURN_RISE + 1e-6) heights.push(height);
      }
      // Exactly on the landing line the next lap starts where this one ends.
      if (fraction > 1 - 1e-6) heights.push(SPIRAL_TURNS * SPIRAL_TURN_RISE);
    }
    // The floor runs on into the stair only where its first tread is, at the
    // landing line; everywhere else inside it the treads, and the newel, are in
    // the way.
    const entering = offLanding < SPIRAL_FLOOR_ENTRY && radius >= SPIRAL_CORE + EDGE_MARGIN;
    return { radius, heights, blocksFloor: !entering };
  }
  return null;
}

// Below this a walker is on the floor or the well's flight, and the old rule —
// the floor, unless a flight is underfoot — still decides.
const FLOOR_BAND = GALLERY_LEVELS[0] / 2;

/**
 * The height of whatever holds a walker up at x/z, given where their feet were
 * (`footY`) and what the floor and the well's flight make of the point
 * (`ground`). Returns null where there is nothing within a step of their feet:
 * off the edge of a gallery, into the side of a stair, or into its newel.
 */
export function galleryHeightAt(x, z, doorWalls, footY, ground) {
  const spiral = spiralAt(x, z, doorWalls);
  const candidates = [];
  if (!spiral || !spiral.blocksFloor) candidates.push(ground);
  if (spiral) candidates.push(...spiral.heights);
  if (onGallery(x, z, doorWalls)) candidates.push(...GALLERY_LEVELS);
  let best = null;
  for (const height of candidates) {
    if (Math.abs(height - footY) > STAIR_MOUNT_REACH) continue;
    if (best === null || Math.abs(height - footY) < Math.abs(best - footY)) best = height;
  }
  if (best !== null) return best;
  // Nothing within a step. On the floor that has always meant the floor.
  if (!spiral && footY < FLOOR_BAND) return ground;
  return null;
}
