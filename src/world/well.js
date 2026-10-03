/**
 * Geometry and collision contract for the well through every chamber, for the
 * bridge that crosses it and for the one stair that hangs in the middle of it.
 *
 * The renderer consumes a list of plain box parts so the real room and the
 * lightweight vistas build exactly the same structures in their own batches.
 * Collision follows the six edge planes of the guard rather than approximating
 * it with a circle, which would hold the walker implausibly far from its
 * corners.
 *
 * Why a bridge exists at all. A storey is 4.8 and the well is 77 across, so a
 * single flight spanning the shaft would fall at three and a half degrees —
 * a ramp, not a stair. What crosses a void of that proportion is a walkway, and
 * what hangs off the middle of a walkway is a flight. So each floor carries one
 * bridge from the midpoint of one edge to the midpoint of the opposite one,
 * with a length of its deck left out in the centre, and the flight climbs
 * through that opening to the deck of the floor above.
 *
 * The bridge is fixed to the same axis on every floor while the doorways, the
 * corridor and the wall numbering all turn with the level beneath it. A walker
 * climbing the shaft sees the whole chamber rotate around a stair that does not
 * move, which is the difference between a hole in a floor and an axis.
 *
 * One flight spans exactly one storey, so the flight a walker climbs out of and
 * the flight they climb into are the same object one storey apart, and the
 * geometry is stated only once.
 */

import * as THREE from 'three';
import { addPillar, addRun, balustradeSet } from './balustrade.js';
import {
  LANTERN_HEIGHT,
  PLAYER_RADIUS,
  STAIR_GUARD_HALF_SPAN,
  STAIR_HALF_RUN,
  STAIR_MOUNT_REACH,
  STAIR_RISE,
  STAIR_RISER,
  STAIR_RUN,
  STAIR_SOFFIT_DEPTH,
  STAIR_STEPS,
  STAIR_TREAD,
  STAIR_WELL_EDGE,
  STAIR_WIDTH,
  WELL_GUARD_HEIGHT,
  WELL_GUARD_RADIUS,
  WELL_POST_WIDTH,
  WELL_RAIL_THICKNESS,
  WELL_RADIUS,
  WELL_SLAB_THICKNESS,
} from '../constants.js';

// A hexagon edge is the straight line at a fixed distance from the centre, so
// every part standing on one shares a single normal and differs only in how far
// along it sits. Working in that pair rather than in x/z is what lets a length
// of guard be left out where the bridge crosses it, without special-casing
// corners.
const GUARD_APOTHEM = WELL_GUARD_RADIUS * Math.cos(Math.PI / 6);
const LIP_APOTHEM = WELL_RADIUS * Math.cos(Math.PI / 6);

function edgeAngle(edge) {
  return Math.PI / 6 + edge * Math.PI / 3;
}

/** A point on an edge frame: `across` from the centre, `along` the edge. */
function edgePoint(angle, across, along, y) {
  return new THREE.Vector3(
    Math.cos(angle) * across - Math.sin(angle) * along,
    y,
    Math.sin(angle) * across + Math.cos(angle) * along,
  );
}

// Rotating a box by this maps its local x onto the edge and its local z onto
// the outward normal, which is the same convention wallBasis uses for walls.
function edgeRotation(angle) {
  return -angle + Math.PI / 2;
}

// --- the bridge frame ---------------------------------------------------------
// The bridge runs along the normal of one edge, so it leaves the lip at that
// edge's midpoint and arrives at the midpoint of the one opposite.
const BRIDGE_ANGLE = edgeAngle(STAIR_WELL_EDGE);
// Local x along the crossing, local z across its width.
const BRIDGE_ROTATION = -BRIDGE_ANGLE;
const UX = Math.cos(BRIDGE_ANGLE);
const UZ = Math.sin(BRIDGE_ANGLE);
const VX = -Math.sin(BRIDGE_ANGLE);
const VZ = Math.cos(BRIDGE_ANGLE);
const BRIDGE_HALF_WIDTH = STAIR_WIDTH / 2;
const BRIDGE_CLEAR_HALF_WIDTH = BRIDGE_HALF_WIDTH - PLAYER_RADIUS;
// Far enough past the lip to lap onto the floor rather than stop against it —
// two edges meeting in one plane crack along their whole length, and the crack
// shows the colour of distance.
const DECK_REACH = LIP_APOTHEM + 0.6;
const DECK_THICKNESS = WELL_SLAB_THICKNESS;
// Where the deck is left out for the flight to climb through.
const OPENING_HALF = STAIR_HALF_RUN;
// Past the head or the foot, the run still answers, because a step carries a
// walker 0.13 and the end is always overshot rather than landed on exactly.
const RUN_OVERRUN = STAIR_GUARD_HALF_SPAN;
// How far a lantern's centre stands above the rail it is mounted on.
const LANTERN_BODY_RISE = 0.26;

/** A point in the bridge's own frame: `u` along the crossing, `v` across it. */
function bridgePoint(u, v, y) {
  return new THREE.Vector3(UX * u + VX * v, y, UZ * u + VZ * v);
}

// --- the guard around the lip -------------------------------------------------
//
// The stone balustrade of balustrade.js, one run along each edge of the lip.
// Its centre line stands a little in from the guard plane, so its back is
// flush with the lip and its front, the side a walker leans on, is still short
// of where collision holds them.
const GUARD_LINE = GUARD_APOTHEM - 0.08;
const GUARD_HALF_EDGE = GUARD_LINE * Math.tan(Math.PI / 6);

// The bridge leaves through the middle of two opposite edges, so those two are
// the ones with a length of railing missing.
const BRIDGE_EDGES = [STAIR_WELL_EDGE, (STAIR_WELL_EDGE + 3) % 6];
const CROSSING_HALF = BRIDGE_HALF_WIDTH + 0.3;
// Every edge carries a pair of gate pillars at its middle, open between them
// where the bridge goes through and railed across where it does not, so all
// six edges are set out alike. From each gate pillar to the corner the edge is
// divided into equal bays.
const GUARD_BAYS_PER_HALF = 4;
// Lanterns stand on the gate pillars and on the pillar halfway to each
// corner: four to an edge, twenty-four round the well, every edge the same.
const GUARD_LANTERN_BAYS = [0, GUARD_BAYS_PER_HALF / 2];

function guardStations() {
  const stations = [];
  const bay = (GUARD_HALF_EDGE - CROSSING_HALF) / GUARD_BAYS_PER_HALF;
  for (const side of [-1, 1]) {
    for (let index = 0; index <= GUARD_BAYS_PER_HALF; index++) {
      stations.push({
        t: side * (CROSSING_HALF + index * bay),
        // The corners' pillars stand on the bisector, built once below.
        build: index < GUARD_BAYS_PER_HALF,
        lantern: GUARD_LANTERN_BAYS.includes(index),
      });
    }
  }
  return stations;
}

const guard = balustradeSet();
for (let edge = 0; edge < 6; edge++) {
  const angle = edgeAngle(edge);
  // Along the edge, the same direction edgePoint measures `along` in.
  const along = angle + Math.PI / 2;
  const origin = edgePoint(angle, GUARD_LINE, 0, 0);
  const stations = guardStations();
  const runs = BRIDGE_EDGES.includes(edge)
    ? [[-GUARD_HALF_EDGE, -CROSSING_HALF], [CROSSING_HALF, GUARD_HALF_EDGE]]
    : [[-GUARD_HALF_EDGE, GUARD_HALF_EDGE]];
  runs.forEach(([from, to], run) => {
    addRun(guard, {
      origin,
      angle: along,
      from,
      to,
      stations: stations.filter(station => station.t >= from - 1e-6 && station.t <= to + 1e-6),
      seed: edge * 2 + run + 1,
    });
  });
  // The corner at the end of this edge, square to the bisector so the two
  // runs meeting there are mirror images across it.
  const corner = edge * Math.PI / 3 + Math.PI / 3;
  const radius = GUARD_LINE / Math.cos(Math.PI / 6);
  addPillar(guard, Math.cos(corner) * radius, Math.sin(corner) * radius, 0, -corner,
    { seed: 100 + edge });
}

export const WELL_BALUSTRADE_PARTS = Object.freeze(guard.parts);
export const WELL_BALUSTERS = Object.freeze(guard.balusters);

// --- the bridge ---------------------------------------------------------------

const DECK_RUNS = [[-DECK_REACH, -OPENING_HALF], [OPENING_HALF, DECK_REACH]];
const bridgeParts = [];
const DECK_BOARD_WIDTH = 0.34;
const BRIDGE_BALUSTER_PITCH = 0.78;

for (const [from, to] of DECK_RUNS) {
  const length = to - from;
  const centre = (from + to) / 2;
  // The crossing is carpentry, not a plaster slab.  Individual transverse
  // boards catch a lantern one edge at a time and make the approach to the
  // stair readable even when most of the shaft is black.
  const boardCount = Math.max(1, Math.ceil(length / DECK_BOARD_WIDTH));
  const boardLength = length / boardCount;
  for (let board = 0; board < boardCount; board++) {
    const u = from + (board + 0.5) * boardLength;
    bridgeParts.push({
      size: [Math.max(0.05, boardLength - 0.025), DECK_THICKNESS, STAIR_WIDTH],
      position: bridgePoint(u, 0, -DECK_THICKNESS / 2),
      rotation: BRIDGE_ROTATION,
      wood: true,
    });
  }

  for (const side of [-1, 1]) {
    const v = side * (BRIDGE_HALF_WIDTH - WELL_POST_WIDTH / 2);
    for (const height of [WELL_GUARD_HEIGHT, WELL_GUARD_HEIGHT * 0.53]) {
      bridgeParts.push({
        size: [length, WELL_RAIL_THICKNESS, WELL_RAIL_THICKNESS],
        position: bridgePoint(centre, v, height),
        rotation: BRIDGE_ROTATION,
        wood: true,
      });
    }
    const count = Math.max(1, Math.round(length / BRIDGE_BALUSTER_PITCH));
    for (let index = 1; index < count; index++) {
      bridgeParts.push({
        size: [WELL_POST_WIDTH * 0.58, WELL_GUARD_HEIGHT - WELL_RAIL_THICKNESS, WELL_POST_WIDTH * 0.58],
        position: bridgePoint(
          from + length * index / count,
          v,
          (WELL_GUARD_HEIGHT - WELL_RAIL_THICKNESS) / 2,
        ),
        rotation: 0,
        wood: true,
      });
    }
  }
}

export const WELL_BRIDGE_PARTS = Object.freeze(bridgeParts);

// A lantern stands at either end of the opening, on the rail, where the deck
// gives out and the flight begins. That is the one place on the crossing where
// a walker has to see what is under their foot, and it is also the place a
// lantern would actually have been hung.
export const WELL_LANTERN_POSITIONS = Object.freeze([-1, 1].map(side => bridgePoint(
  side * (OPENING_HALF + 0.45),
  BRIDGE_HALF_WIDTH - WELL_POST_WIDTH / 2,
  LANTERN_HEIGHT,
)));

// --- the flight ---------------------------------------------------------------

/** The height of a tread above this chamber's floor, `u` along the crossing. */
function treadHeightAt(u) {
  const progress = (u + STAIR_HALF_RUN) / STAIR_RUN;
  return Math.min(1, Math.max(0, progress)) * STAIR_RISE;
}

const stairParts = [];

// Two continuous stringers carry the treads. Earlier the stair was only a row
// of floating rectangular blocks, so its silhouette read as a game prototype
// even after the timber palette arrived. A stringer is a single raked beam,
// expressed as a box with a real X tilt and consumed by the same batched
// builder as every other stair part.
const STAIR_SLOPE = Math.atan2(STAIR_RISE, STAIR_RUN);
const STAIR_STRINGER_LENGTH = Math.hypot(STAIR_RUN, STAIR_RISE);
for (const side of [-1, 1]) {
  stairParts.push({
    size: [STAIR_STRINGER_LENGTH, 0.18, 0.16],
    position: bridgePoint(0, side * (BRIDGE_HALF_WIDTH - 0.19), STAIR_RISE / 2 - 0.34),
    rotation: BRIDGE_ROTATION,
    rotationZ: STAIR_SLOPE,
    wood: true,
  });
}

// Boxes cannot be raked, so a step is a block hanging below its own tread and
// the soffit comes out serrated. From anywhere in the shaft that reads as the
// raking underside of a flight; from the tread itself it reads as steps. This
// is the only diagonal in a world built from nothing but horizontals and
// verticals, and it hangs over open shaft for its whole length.
for (let step = 0; step < STAIR_STEPS; step++) {
  const u = -STAIR_HALF_RUN + (step + 0.5) * STAIR_TREAD;
  const top = (step + 1) * STAIR_RISER;
  stairParts.push({
    size: [STAIR_TREAD, STAIR_SOFFIT_DEPTH, STAIR_WIDTH],
    position: bridgePoint(u, 0, top - STAIR_SOFFIT_DEPTH / 2),
    rotation: BRIDGE_ROTATION,
    wood: true,
  });
  // A rounded-over nose on every tread catches a lantern as one bright line,
  // the way a worn oak stair does. Only in the chamber itself: down the shaft
  // it is below a pixel.
  stairParts.push({
    size: [0.07, 0.045, STAIR_WIDTH + 0.04],
    position: bridgePoint(-STAIR_HALF_RUN + step * STAIR_TREAD - 0.015, 0, top - 0.0225),
    rotation: BRIDGE_ROTATION,
    wood: true,
    near: true,
  });
  if (step % 4 === 0) {
    // A darker riser every four steps breaks the flight into a readable human
    // cadence at medium distance without adding a line around each tread.
    stairParts.push({
      size: [0.08, STAIR_RISER * 4, STAIR_WIDTH - 0.1],
      position: bridgePoint(
        -STAIR_HALF_RUN + step * STAIR_TREAD,
        0,
        Math.max(STAIR_RISER, top - STAIR_RISER * 2),
      ),
      rotation: BRIDGE_ROTATION,
      trim: true,
    });
  }
}

// Both sides carry a railing, because both sides are the shaft.
//
// The handrail is one raked beam, not a staircase of short level segments. It
// is the heaviest member in the whole railing on purpose: on a real flight the
// top of the handrail catches an unbroken line of light for its entire length,
// and that continuous diagonal — read against the dotted comb of the tread
// noses — is what says "stair" from the far side of the shaft. Stepping it in
// four-tread jumps threw that line away, and a box can be raked: the stringers
// beside it already are.
const STAIR_NEWEL_INTERVAL = 6;
const STAIR_BALUSTER_INTERVAL = 2;
const STAIR_HANDRAIL_HEIGHT = WELL_GUARD_HEIGHT;
// Every raking member shares the line of the flight, so each is one box the
// length of the slope, centred on the middle of the run.
const STAIR_MIDPOINT_HEIGHT = treadHeightAt(0);

const stairNewels = [];
for (let step = 0; step <= STAIR_STEPS; step += STAIR_NEWEL_INTERVAL) {
  const u = -STAIR_HALF_RUN + step * STAIR_TREAD;
  stairNewels.push({ u, top: treadHeightAt(u), step });
}

const stairLanterns = [];
for (const side of [-1, 1]) {
  const v = side * (BRIDGE_HALF_WIDTH - WELL_POST_WIDTH / 2);

  // The handrail, and the thinner rail under it.
  stairParts.push({
    size: [STAIR_STRINGER_LENGTH, 0.15, 0.11],
    position: bridgePoint(0, v, STAIR_MIDPOINT_HEIGHT + STAIR_HANDRAIL_HEIGHT),
    rotation: BRIDGE_ROTATION,
    rotationZ: STAIR_SLOPE,
    wood: true,
  });
  stairParts.push({
    size: [STAIR_STRINGER_LENGTH, 0.06, 0.05],
    position: bridgePoint(0, v, STAIR_MIDPOINT_HEIGHT + STAIR_HANDRAIL_HEIGHT * 0.52),
    rotation: BRIDGE_ROTATION,
    rotationZ: STAIR_SLOPE,
    wood: true,
  });

  // Newels are vertical, not square to the slope — which is how a stair is
  // actually built, and it shows.
  for (const { u, top, step } of stairNewels) {
    const end = step === 0 || step === STAIR_STEPS;
    stairParts.push({
      size: [WELL_POST_WIDTH * (end ? 1.6 : 1.15), STAIR_HANDRAIL_HEIGHT, WELL_POST_WIDTH * (end ? 1.6 : 1.15)],
      position: bridgePoint(u, v, top + STAIR_HANDRAIL_HEIGHT / 2),
      rotation: 0,
      wood: true,
    });
    // A turned cap and a moulded base, as on the carved newels of the
    // reference. Chamber only, like the tread noses.
    const girth = WELL_POST_WIDTH * (end ? 2.1 : 1.6);
    stairParts.push({
      size: [girth, 0.08, girth],
      position: bridgePoint(u, v, top + STAIR_HANDRAIL_HEIGHT + 0.04),
      rotation: 0,
      wood: true,
      near: true,
    });
    stairParts.push({
      size: [girth, 0.14, girth],
      position: bridgePoint(u, v, top + 0.07),
      rotation: 0,
      wood: true,
      near: true,
    });
  }

  // Balusters between them, closer and thinner. This is the fine comb that
  // carries the flight at distance, and it is also what puts barred shadows
  // across the treads once a lantern is near enough to throw them.
  for (let step = 0; step <= STAIR_STEPS; step += STAIR_BALUSTER_INTERVAL) {
    if (step % STAIR_NEWEL_INTERVAL === 0) continue;
    const u = -STAIR_HALF_RUN + step * STAIR_TREAD;
    const top = treadHeightAt(u);
    stairParts.push({
      size: [WELL_POST_WIDTH * 0.55, STAIR_HANDRAIL_HEIGHT - 0.12, WELL_POST_WIDTH * 0.55],
      position: bridgePoint(u, v, top + (STAIR_HANDRAIL_HEIGHT - 0.12) / 2),
      rotation: 0,
      wood: true,
    });
    // Two collars make a square baluster read as a turned one.
    for (const height of [0.16, STAIR_HANDRAIL_HEIGHT - 0.3]) {
      stairParts.push({
        size: [WELL_POST_WIDTH * 0.9, 0.06, WELL_POST_WIDTH * 0.9],
        position: bridgePoint(u, v, top + height),
        rotation: 0,
        wood: true,
        near: true,
      });
    }
  }

  // A lantern every third newel, and the two sides offset from one another so
  // the flight is lit alternately rather than in matched pairs.
  for (let index = side > 0 ? 1 : 2; index < stairNewels.length - 1; index += 3) {
    const { u, top } = stairNewels[index];
    stairLanterns.push({
      position: bridgePoint(u, v, top + STAIR_HANDRAIL_HEIGHT + LANTERN_BODY_RISE),
      // Only some carry a real light. The rest are bodies that glow: past a
      // certain distance a lantern contributes nothing but its own brightness,
      // and there is no reason to pay for a shadow map to say so.
      lit: index % 2 === 1,
    });
  }
}

export const WELL_STAIR_LANTERNS = Object.freeze(stairLanterns);

export const WELL_STAIR_PARTS = Object.freeze(stairParts);

// --- where the crossing is, and what it holds up ------------------------------

/** A position resolved into the bridge's own frame. */
export function bridgeCoordinates(x, z) {
  return { u: x * UX + z * UZ, v: x * VX + z * VZ };
}

/**
 * The surface under a walker out over the shaft, or null where there is none.
 *
 * A flight spans one storey, so the same plan position carries the flight
 * rising out of this floor and the flight arriving from the one below. Which of
 * the two is underfoot cannot be read from x and z — only from how high the
 * walker already is, and the pair is a whole storey apart, so the nearer one is
 * never ambiguous at any speed a person can walk.
 *
 * Outside the opening the answer is the deck, which is simply the floor level:
 * treadHeightAt holds at the end it passed, so the deck on the low side reads
 * as zero and the deck on the high side as a storey, exactly as they are.
 */
export function stairSurfaceAt(x, z, footY) {
  const { u, v } = bridgeCoordinates(x, z);
  if (Math.abs(v) > BRIDGE_HALF_WIDTH + PLAYER_RADIUS) return null;
  if (Math.abs(u) > RUN_OVERRUN) return null;
  const rising = treadHeightAt(u);
  const height = Math.abs(rising - footY) <= Math.abs(rising - STAIR_RISE - footY)
    ? rising
    : rising - STAIR_RISE;
  return { height, u, v };
}

/** True while a walker is standing on the flight rather than beside it. */
export function isOnStair(x, z, footY) {
  const surface = stairSurfaceAt(x, z, footY);
  return surface !== null && Math.abs(surface.height - footY) <= STAIR_MOUNT_REACH;
}

// Distance from the centre to one side of the guard, expanded by the player's
// body. A point inside all six planes is inside the protected area; pushing it
// through the nearest plane returns it to the walkable floor in one step.
const CLEAR_APOTHEM = GUARD_APOTHEM + PLAYER_RADIUS;

function clampU(position, target, current) {
  const correction = target - current;
  position.x += UX * correction;
  position.z += UZ * correction;
}

function clampV(position, target, current) {
  const correction = target - current;
  position.x += VX * correction;
  position.z += VZ * correction;
}

/**
 * Keeps a walker out of the shaft, on the bridge where there is one, and on the
 * flight where the deck is open.
 *
 * `footY` is measured from the floor of the chamber they are in, so a walker
 * halfway up the stair is above it and one halfway down is below.
 */
export function constrainFromWell(position, footY = 0) {
  const { u, v } = bridgeCoordinates(position.x, position.z);

  // The crossing, and a body's width either side of it so that a walker who
  // clips its rail is returned to the deck rather than flung out to the guard
  // by the hexagon rule below.
  if (Math.abs(v) <= BRIDGE_HALF_WIDTH + PLAYER_RADIUS && Math.abs(u) <= DECK_REACH) {
    if (Math.abs(v) > BRIDGE_CLEAR_HALF_WIDTH) {
      clampV(position, Math.sign(v) * BRIDGE_CLEAR_HALF_WIDTH, v);
    }
    if (Math.abs(u) > OPENING_HALF) return true;
    if (isOnStair(position.x, position.z, footY)) {
      // Both ends of the run are closed. The foot, so that leaving the flight
      // downward means stepping off along the deck; the head, so that a walker
      // cannot overrun the top tread in one frame and leave the run behind —
      // past it there is no tread, and the storey change is keyed on reaching
      // exactly the top, which pinning here guarantees.
      if (u < -STAIR_HALF_RUN) clampU(position, -STAIR_HALF_RUN, u);
      else if (u > STAIR_HALF_RUN) clampU(position, STAIR_HALF_RUN, u);
      return true;
    }
    // Over the opening with the flight overhead or underfoot: the cut end of
    // the deck is what stops them.
    clampU(position, Math.sign(u || 1) * (OPENING_HALF + PLAYER_RADIUS), u);
    return true;
  }

  let nearest = null;
  for (let index = 0; index < 6; index++) {
    const angle = edgeAngle(index);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const distance = position.x * nx + position.z * nz;
    if (!nearest || distance > nearest.distance) nearest = { distance, nx, nz };
  }
  if (nearest.distance >= CLEAR_APOTHEM) return false;
  const correction = CLEAR_APOTHEM - nearest.distance;
  position.x += nearest.nx * correction;
  position.z += nearest.nz * correction;
  return true;
}

// Six shallow beams make the inner face of the floor slab. A single ring plane
// has no thickness and disappears when seen edge-on; these faces are what let
// somebody below read every upper floor as a floor rather than a floating
// railing.
const lipParts = [];
for (let edge = 0; edge < 6; edge++) {
  const angle = edgeAngle(edge);
  lipParts.push({
    size: [WELL_RADIUS + 0.02, WELL_SLAB_THICKNESS, 0.1],
    position: edgePoint(angle, LIP_APOTHEM, 0, -WELL_SLAB_THICKNESS / 2),
    rotation: edgeRotation(angle),
  });
}
export const WELL_LIP_PARTS = Object.freeze(lipParts);
