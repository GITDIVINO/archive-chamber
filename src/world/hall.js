/**
 * The built passage.
 *
 * Geometry only; the topology it serves is in passage.js and the dimensions are
 * in constants.js. It is appended into whatever merged batches the caller is
 * filling, because the passages a player walks through and the passages seen
 * receding down the corridor are the same geometry and are drawn together.
 *
 * Local frame: the walker enters at z = 0 and leaves at z = HALL_LENGTH, with
 * the two side openings halfway along. Facing +z, +x is the walker's left —
 * forward × up is (-1, 0, 0) — so the opening at +x is the passage's left exit
 * and matches passageExits().left.
 *
 *          +z   ahead
 *           |
 *   [alcove]|[alcove]     the side openings, at HALL_SIDE_CENTRE
 *      +x   |   -x
 *      left | right
 *           0   back
 *
 * No shelves stand here. The story's hallway holds a mirror, a stair and two
 * closets but never books, and volumes here would need addresses the placement
 * does not issue: it gives 3840 to a chamber and none to the space between.
 */

import * as THREE from 'three';
import {
  ALCOVE_DEPTH,
  ALCOVE_REACH,
  APOTHEM,
  DOOR_HEIGHT,
  HALL_HALF_WIDTH,
  HALL_JUNCTION_CHAMFER,
  HALL_LENGTH,
  HALL_SIDE_CENTRE,
  HALL_SIDE_HALF,
  HALL_START,
  WALL_THICKNESS,
} from '../constants.js';
import { ceilingMaterial, floorMaterial, shelfMaterial, wallMaterial } from '../core/materials.js';
import { appendMergedEdges, appendMergedGeometry, boxGeometryFor } from './geometry.js';

const SLAB = 0.12;
const LIP = 0.004;

// How far a floor has to run past the mouth of a passage to reach the chamber
// on the other side of it.
//
// A chamber's floor is a hexagon and stops at its own wall line, APOTHEM from
// its centre, while a passage begins HALL_START out — so the two are exactly
// that far apart and a floor short of it leaves a strip of nothing, which is
// not dark but bright: the background is the colour of distance, and it shows
// through as a warm seam across the threshold. Meeting it exactly is no better,
// because two edges in one plane still crack along their whole length. So this
// carries a real overlap, and where the two overlap the passage's floor is the
// higher of them and wins.
const FLOOR_REACH = HALL_START - APOTHEM + 0.06;

// Where each side of the passage is cut: once, halfway along.
const OPENINGS = [HALL_SIDE_CENTRE];

// The lengths of wall between the openings, as [centre, length] pairs.
function wallRuns(openings) {
  const runs = [];
  let from = 0;
  for (const centre of openings) {
    const to = centre - HALL_SIDE_HALF - HALL_JUNCTION_CHAMFER;
    if (to > from) runs.push([(from + to) / 2, to - from]);
    from = centre + HALL_SIDE_HALF + HALL_JUNCTION_CHAMFER;
  }
  if (HALL_LENGTH > from) runs.push([(from + HALL_LENGTH) / 2, HALL_LENGTH - from]);
  return runs;
}

const localMatrix = new THREE.Matrix4();
const worldMatrix = new THREE.Matrix4();

function batchFor(batches, material) {
  let batch = batches.get(material);
  if (!batch) {
    batch = { material, positions: [], normals: [], uvs: [], indices: [], colors: [] };
    batches.set(material, batch);
  }
  return batch;
}

// Nothing in a passage is toned. It used to darken towards its middle and its
// arms darker still, from a time when it was a bare tube with nothing in it and
// needed the gradient to read as deep at all. It has a chamber at the end of
// every arm now, and fog, and its own converging lines — and the gradient only
// fought them, putting grey walls against a white ceiling and shifting as a
// walker moved, in a building whose surfaces are one material throughout. A
// chamber's walls carry no tone either. Depth into a shelf is a different
// matter: that is a real recess, and it keeps its shading.
function addBox(batches, outlines, material, size, x, y, z, shade = null, outlined = true, turn = 0) {
  const entry = boxGeometryFor(size[0], size[1], size[2]);
  localMatrix.makeRotationY(turn).setPosition(x, y, z);
  worldMatrix.copy(localMatrix).premultiply(hallMatrix);
  appendMergedGeometry(batchFor(batches, material), entry.geometry, worldMatrix, shade, localMatrix);
  if (outlined && outlines) appendMergedEdges(outlines, entry.edges, worldMatrix);
}

// Set for the duration of one appendHall call; addBox reads it rather than
// threading the transform through every call.
let hallMatrix = new THREE.Matrix4();

/**
 * Appends one passage, placed by `matrix`, into the caller's merged batches.
 *
 * `outlines` may be null for passages far enough down the corridor that their
 * arrises would be sub-pixel.
 */
/**
 * Only the edges that are edges.
 *
 * A passage is built from boxes because that is how a hole is made, but it is
 * not made of them: the walls are monolithic and have stood as long as the
 * library has. Outlining each box drew the seams between them — a line up from
 * either corner of every opening, another where one length of wall met the
 * next — and every one of those stood for a joint that is not there. What is
 * really an edge is where a surface turns: the floor and ceiling lines along
 * each wall, and the outline of each opening cut in it.
 */
const linePoint = new THREE.Vector3();
function line(outlines, from, to) {
  for (const point of [from, to]) {
    linePoint.set(point[0], point[1], point[2]).applyMatrix4(hallMatrix);
    outlines.push(linePoint.x, linePoint.y, linePoint.z);
  }
}

function surfaceTriangle(batches, material, points) {
  const batch = batchFor(batches, material);
  const base = batch.positions.length / 3;
  for (const point of points) {
    linePoint.set(point[0], point[1], point[2]).applyMatrix4(hallMatrix);
    batch.positions.push(linePoint.x, linePoint.y, linePoint.z);
    batch.uvs.push(point[0], point[2]);
    batch.colors.push(1, 1, 1);
  }
  batch.indices.push(base, base + 1, base + 2);
}

/**
 * The passage, drawn along the floor and up the corners, and not across the
 * ceiling.
 *
 * A ceiling here is not the same surface a floor is, however alike the two look
 * on paper. It hangs 1.4 above the eye where the floor lies 1.65 below, so it
 * is the nearer of them and its lines open much wider — and there are more of
 * them meeting overhead at a crossing than underfoot, because the arms cut
 * through the walls and not through the ground. Drawn, they carve the ceiling
 * of a passage into panels and read as coffering: joinery, in a building that
 * has none. Left off, the ceiling is one unbroken surface the length of the
 * corridor, which is what it is.
 *
 * What still says where a wall stands is its foot and its corners, and those
 * are drawn. A wall meeting a ceiling is the one arris this world can spare.
 */
function drawPassageEdges(outlines, openAlcoves) {
  for (const side of [-1, 1]) {
    const face = side * HALL_HALF_WIDTH;
    // Where a wall actually meets the floor. The old single full-length line
    // continued across the side opening even though the wall did not.
    for (const [runCentre, runLength] of wallRuns(OPENINGS)) {
      line(outlines,
        [face, 0, runCentre - runLength / 2],
        [face, 0, runCentre + runLength / 2]);
    }

    for (const opening of OPENINGS) {
      const reach = side * ALCOVE_REACH;
      for (const jamb of [-1, 1]) {
        const edge = opening + jamb * HALL_SIDE_HALF;
        const mainCorner = [face, 0, edge + jamb * HALL_JUNCTION_CHAMFER];
        const armCorner = [side * (HALL_HALF_WIDTH + HALL_JUNCTION_CHAMFER), 0, edge];
        // Two real turns replace one blind right-angle block: main wall to
        // diagonal, then diagonal to side arm.
        line(outlines, mainCorner, [mainCorner[0], DOOR_HEIGHT, mainCorner[2]]);
        line(outlines, armCorner, [armCorner[0], DOOR_HEIGHT, armCorner[2]]);
        line(outlines, mainCorner, armCorner);
        line(outlines, armCorner, [reach, 0, edge]);
      }
      // A blind arm has a back; a walkable one opens on a chamber, and that
      // chamber's own doorway is where the edge is.
      if (!openAlcoves) {
        for (const jamb of [-1, 1]) {
          const edge = opening + jamb * HALL_SIDE_HALF;
          line(outlines, [reach, 0, edge], [reach, DOOR_HEIGHT, edge]);
        }
      }
    }
  }
}

/**
 * Rails, pilasters, a dado and ceiling joists, the same in all four arms.
 *
 * A passage used to be three metres of wall between a doorway and a crossing,
 * and a blank face that size reads as a face. At a storey of fourteen metres it
 * is the largest unbroken surface a walker ever stands next to, and looking
 * sideways at the mouth it fills half the frame with nothing at all.
 *
 * The crossing is a junction of four identical arms, so the timber is too: it
 * was once only along the corridor axis, which left both side arms and the four
 * bevelled corners bare plaster and the passage lopsided from every angle but
 * straight ahead. Each arm is now set out the same way from the crossing's
 * centre, and each bevel carries the rails across the corner between them.
 *
 * Everything here is additive: boxes into the batches the caller is already
 * filling, in the materials already in use. No existing piece moves, so the
 * collision hull, the portal apertures and the drawn arrises are untouched.
 *
 * Depth is the one number that matters for safety. A walker is held a body's
 * radius off the wall line, at 1.97 from the axis, and the deepest thing here
 * reaches 2.18 — so nothing added can be walked into.
 *
 * The passages seen down the shaft end their arms on a blank wall a walker
 * never reaches and only ever see along the corridor, so they keep the timber
 * of that axis alone: the side arms' would cost the shaft's vertex budget
 * for a surface nobody looks at.
 */
const PILASTER_DEPTH = 0.14;
const PILASTER_WIDTH = 0.36;
const PILASTER_PITCH = 3.2;
const DADO_DEPTH = 0.07;
const DADO_HEIGHT = 1.02;
const DADO_THICKNESS = 0.13;
const JOIST_PITCH = 2.4;
const JOIST_DROP = 0.17;
const JOIST_WIDTH = 0.24;
const RAIL_DEPTH = 0.07;
const RAIL_HEIGHT = 0.1;
// The passage rises most of a storey now, so the rails climb it in courses: one
// a little over halfway, and one under the ceiling.
const RAIL_LEVELS = [0.18, 1.1, DOOR_HEIGHT / 2 + 1.2, DOOR_HEIGHT - 0.28];

// The four arms, as the direction each runs from the crossing and the turn that
// lays a box's length along it. Back and ahead are the corridor itself.
const ARMS = [
  { dx: 0, dz: -1, turn: 0 },
  { dx: 0, dz: 1, turn: 0 },
  { dx: 1, dz: 0, turn: Math.PI / 2 },
  { dx: -1, dz: 0, turn: Math.PI / 2 },
];

// Where each arm's walls begin, measured out from the crossing's centre: past
// the opening and the bevel beside it.
const ARM_CLEAR = HALL_SIDE_HALF + HALL_JUNCTION_CHAMFER;

// Joists stand at the corridor's own pitch, and at the same distances from the
// crossing in every arm, so the ceiling reads the same whichever way one looks.
function joistDistances() {
  const joists = Math.floor(HALL_LENGTH / JOIST_PITCH);
  const distances = [];
  for (let joist = 1; joist < joists; joist++) {
    const distance = HALL_SIDE_CENTRE - HALL_LENGTH * joist / joists;
    if (distance >= ARM_CLEAR) distances.push(distance);
  }
  return distances;
}
const JOIST_DISTANCES = joistDistances();

function addPassageJoinery(batches, sideArms) {
  const centre = HALL_SIDE_CENTRE;
  for (const arm of sideArms ? ARMS : ARMS.filter(arm => !arm.turn)) {
    const reach = arm.turn ? ALCOVE_REACH : HALL_SIDE_CENTRE;
    const runLength = reach - ARM_CLEAR;
    const runMiddle = (reach + ARM_CLEAR) / 2;
    // Across the arm: the corridor's x for back and ahead, its z for a side arm.
    const place = (along, across, size, y) => addBox(batches, null, size.material,
      size.box,
      arm.dx * along + (arm.turn ? 0 : across),
      y,
      centre + arm.dz * along + (arm.turn ? across : 0),
      null, false, arm.turn);

    for (const side of [-1, 1]) {
      const halfWidth = arm.turn ? HALL_SIDE_HALF : HALL_HALF_WIDTH;
      for (const y of RAIL_LEVELS) {
        place(runMiddle, side * (halfWidth - RAIL_DEPTH / 2),
          { material: shelfMaterial, box: [RAIL_DEPTH, RAIL_HEIGHT, runLength] }, y);
      }
      // A timber band at hand height, the length of each run of wall.
      place(runMiddle, side * (halfWidth - DADO_DEPTH),
        { material: shelfMaterial, box: [DADO_THICKNESS, DADO_THICKNESS, runLength] }, DADO_HEIGHT);
      // Pilasters set out from the run's own ends, so none lands in an opening.
      const bays = Math.max(1, Math.round(runLength / PILASTER_PITCH));
      for (let bay = 0; bay <= bays; bay++) {
        place(ARM_CLEAR + runLength * bay / bays, side * (halfWidth - PILASTER_DEPTH / 2),
          { material: wallMaterial, box: [PILASTER_DEPTH, DOOR_HEIGHT, PILASTER_WIDTH] }, DOOR_HEIGHT / 2);
      }
    }

    // Joists across the ceiling, none over the crossing, so nothing hangs over
    // an opening a walker is meant to see through.
    const span = 2 * (arm.turn ? HALL_SIDE_HALF : HALL_HALF_WIDTH);
    for (const distance of JOIST_DISTANCES) {
      place(distance, 0,
        { material: shelfMaterial, box: [span, JOIST_DROP, JOIST_WIDTH] }, DOOR_HEIGHT - JOIST_DROP / 2);
    }
  }

  if (!sideArms) return;

  // The bevels at the crossing's four corners carry the rails and the dado
  // round from one arm to the next. A bevel's wall is centred on its line, so
  // its face stands half a wall's thickness in towards the crossing.
  const bevel = HALL_JUNCTION_CHAMFER * Math.SQRT2;
  for (const side of [-1, 1]) {
    for (const jamb of [-1, 1]) {
      const edge = centre + jamb * HALL_SIDE_HALF;
      const turn = Math.atan2(side, -jamb);
      const lineX = side * (HALL_HALF_WIDTH + HALL_JUNCTION_CHAMFER / 2);
      const lineZ = edge + jamb * HALL_JUNCTION_CHAMFER / 2;
      const at = inset => [lineX - side * inset / Math.SQRT2, lineZ - jamb * inset / Math.SQRT2];
      for (const y of RAIL_LEVELS) {
        const [x, z] = at(WALL_THICKNESS / 2 + RAIL_DEPTH / 2);
        addBox(batches, null, shelfMaterial, [RAIL_DEPTH, RAIL_HEIGHT, bevel], x, y, z, null, false, turn);
      }
      const [x, z] = at(WALL_THICKNESS / 2 + DADO_DEPTH);
      addBox(batches, null, shelfMaterial, [DADO_THICKNESS, DADO_THICKNESS, bevel],
        x, DADO_HEIGHT, z, null, false, turn);
    }
  }
}

export function appendHall(batches, outlines, matrix, openAlcoves = false, surfaceMaterials = null) {
  hallMatrix = matrix;
  const centre = HALL_LENGTH / 2;
  const passageFloorMaterial = surfaceMaterials?.floor ?? floorMaterial;
  const passageCeilingMaterial = surfaceMaterials?.ceiling ?? ceilingMaterial;

  // Run back under the chamber at either end, far enough to overlap its floor
  // rather than stop against it. A hair above them too, so that where the two
  // overlap the passage wins and nothing is coplanar.
  const RUN = HALL_LENGTH + 2 * FLOOR_REACH;
  addBox(batches, null, passageFloorMaterial, [2 * HALL_HALF_WIDTH, SLAB, RUN],
    0, LIP - SLAB / 2, centre, null, false);
  addBox(batches, null, passageCeilingMaterial, [2 * HALL_HALF_WIDTH, SLAB, RUN],
    0, DOOR_HEIGHT + SLAB / 2, centre, null, false);
  for (const side of [-1, 1]) {
    const wallX = side * (HALL_HALF_WIDTH + WALL_THICKNESS / 2);
    for (const [runCentre, runLength] of wallRuns(OPENINGS)) {
      addBox(batches, null, wallMaterial, [WALL_THICKNESS, DOOR_HEIGHT, runLength],
        wallX, DOOR_HEIGHT / 2, runCentre, null, false);
    }

    for (const opening of OPENINGS) {
      // The side openings are cut the full height of the passage, so a walker
      // standing at the crossing has four mouths that are the same mouth: no
      // band overhead here, and none in the two along the corridor either. The
      // only band in a passage is at the far end of an arm, where a chamber's
      // doorway is lower than the corridor and the wall above it shows. That is
      // where the name of the chamber is written, and it is the same for all
      // four ways on.
      for (const jamb of [-1, 1]) {
        const edge = opening + jamb * HALL_SIDE_HALF;
        const straightDepth = ALCOVE_DEPTH - HALL_JUNCTION_CHAMFER;
        const straightX = side * (
          HALL_HALF_WIDTH + HALL_JUNCTION_CHAMFER + straightDepth / 2
        );
        addBox(batches, null, wallMaterial, [straightDepth, DOOR_HEIGHT, WALL_THICKNESS],
          straightX, DOOR_HEIGHT / 2, edge + jamb * WALL_THICKNESS / 2,
          null, false);

        const diagonalTurn = Math.atan2(side, -jamb);
        addBox(
          batches,
          null,
          wallMaterial,
          [WALL_THICKNESS, DOOR_HEIGHT, HALL_JUNCTION_CHAMFER * Math.SQRT2 + WALL_THICKNESS / 2],
          side * (HALL_HALF_WIDTH + HALL_JUNCTION_CHAMFER / 2),
          DOOR_HEIGHT / 2,
          edge + jamb * HALL_JUNCTION_CHAMFER / 2,
          null,
          false,
          diagonalTurn,
        );

        // The plus-shaped floor and side-arm floor meet at the old square
        // corner. The newly opened triangular bevel needs its own top and
        // ceiling underside or the background would shine through it.
        const corner = [side * HALL_HALF_WIDTH, LIP, edge];
        const mainPoint = [side * HALL_HALF_WIDTH, LIP, edge + jamb * HALL_JUNCTION_CHAMFER];
        const armPoint = [side * (HALL_HALF_WIDTH + HALL_JUNCTION_CHAMFER), LIP, edge];
        const floorPoints = side * jamb > 0
          ? [corner, mainPoint, armPoint]
          : [corner, armPoint, mainPoint];
        surfaceTriangle(batches, passageFloorMaterial, floorPoints);
        const ceilingPoints = floorPoints
          .map(point => [point[0], DOOR_HEIGHT, point[2]])
          .reverse();
        surfaceTriangle(batches, passageCeilingMaterial, ceilingPoints);
      }
      if (!openAlcoves) {
        addBox(batches, null, wallMaterial,
          [WALL_THICKNESS, DOOR_HEIGHT, 2 * HALL_SIDE_HALF + 2 * WALL_THICKNESS],
          side * (ALCOVE_REACH + WALL_THICKNESS / 2), DOOR_HEIGHT / 2, opening,
          null, false);
      }

      // An open arm ends on a chamber and its floor has the same threshold to
      // cross as the passage's own; a blind one ends on the wall just built,
      // and running past that would put a shelf of floor outside the passage
      // altogether, where another chamber down the corridor could see it.
      const armSurfaceDepth = ALCOVE_DEPTH + (openAlcoves ? FLOOR_REACH : 0);
      const armSurfaceX = side * (HALL_HALF_WIDTH + armSurfaceDepth / 2);
      addBox(batches, null, passageFloorMaterial, [armSurfaceDepth, SLAB, 2 * HALL_SIDE_HALF],
        armSurfaceX, LIP - SLAB / 2, opening, null, false);
      // The ceiling must overlap the destination chamber by the same amount as
      // the floor. Ending it at the mathematical threshold left a clear-colour
      // strip above side exits, exposing the portal world outside its opening
      // and making left/right arms visibly different from ahead/back.
      addBox(batches, null, passageCeilingMaterial, [armSurfaceDepth, SLAB, 2 * HALL_SIDE_HALF],
        armSurfaceX, DOOR_HEIGHT + SLAB / 2, opening, null, false);
    }
  }

  addPassageJoinery(batches, openAlcoves);
  if (outlines) drawPassageEdges(outlines, openAlcoves);
}

/**
 * The transform that puts a passage's local frame onto a wall of a chamber
 * whose centre is at `origin`.
 *
 * `nx, nz` is the outward normal of that wall. Rotating by atan2(nx, nz) sends
 * local +z along it, and local +x to (nz, -nx) — the walker's left.
 */
export function hallTransform(target, nx, nz, originX, originZ, start) {
  return target.makeRotationY(Math.atan2(nx, nz))
    .setPosition(originX + nx * start, 0, originZ + nz * start);
}
