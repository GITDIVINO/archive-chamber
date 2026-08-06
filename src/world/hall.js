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
 * does not issue: it gives 640 to a chamber and none to the space between.
 */

import * as THREE from 'three';
import {
  ALCOVE_DEPTH,
  ALCOVE_REACH,
  APOTHEM,
  DOOR_HEIGHT,
  HALL_HALF_WIDTH,
  HALL_LENGTH,
  HALL_SIDE_CENTRE,
  HALL_SIDE_HALF,
  HALL_START,
  WALL_THICKNESS,
} from '../constants.js';
import { ceilingMaterial, floorMaterial, wallMaterial } from '../core/materials.js';
import { appendMergedEdges, appendMergedGeometry, boxGeometryFor } from './geometry.js';

const SLAB = 0.12;
const LIP = 0.004;
const ALCOVE_CENTRE = HALL_HALF_WIDTH + ALCOVE_DEPTH / 2;

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
    const to = centre - HALL_SIDE_HALF;
    if (to > from) runs.push([(from + to) / 2, to - from]);
    from = centre + HALL_SIDE_HALF;
  }
  if (HALL_LENGTH > from) runs.push([(from + HALL_LENGTH) / 2, HALL_LENGTH - from]);
  return runs;
}

const localMatrix = new THREE.Matrix4();
const worldMatrix = new THREE.Matrix4();

function batchFor(batches, material) {
  let batch = batches.get(material);
  if (!batch) {
    batch = { material, positions: [], uvs: [], indices: [], colors: [] };
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
    // Where the wall meets the floor, the length of the passage.
    line(outlines, [face, 0, 0], [face, 0, HALL_LENGTH]);

    for (const opening of OPENINGS) {
      const near = opening - HALL_SIDE_HALF;
      const far = opening + HALL_SIDE_HALF;
      // The opening runs the full height, so the wall simply stops: two edges,
      // floor to ceiling, and nothing across the top.
      line(outlines, [face, 0, near], [face, DOOR_HEIGHT, near]);
      line(outlines, [face, 0, far], [face, DOOR_HEIGHT, far]);

      // The arm beyond: its own two walls meeting its floor.
      const reach = side * ALCOVE_REACH;
      for (const jamb of [near, far]) {
        line(outlines, [face, 0, jamb], [reach, 0, jamb]);
      }
      // A blind arm has a back; a walkable one opens on a chamber, and that
      // chamber's own doorway is where the edge is.
      if (!openAlcoves) {
        line(outlines, [reach, 0, near], [reach, DOOR_HEIGHT, near]);
        line(outlines, [reach, 0, far], [reach, DOOR_HEIGHT, far]);
      }
    }
  }
}

export function appendHall(batches, outlines, matrix, openAlcoves = false) {
  hallMatrix = matrix;
  const centre = HALL_LENGTH / 2;

  // Run back under the chamber at either end, far enough to overlap its floor
  // rather than stop against it. A hair above them too, so that where the two
  // overlap the passage wins and nothing is coplanar.
  const RUN = HALL_LENGTH + 2 * FLOOR_REACH;
  addBox(batches, null, floorMaterial, [2 * HALL_HALF_WIDTH, SLAB, RUN],
    0, LIP - SLAB / 2, centre, null, false);
  addBox(batches, null, ceilingMaterial, [2 * HALL_HALF_WIDTH, SLAB, RUN],
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
      const bayX = side * ALCOVE_CENTRE;
      for (const jamb of [-1, 1]) {
        addBox(batches, null, wallMaterial, [ALCOVE_DEPTH, DOOR_HEIGHT, WALL_THICKNESS],
          bayX, DOOR_HEIGHT / 2, opening + jamb * (HALL_SIDE_HALF + WALL_THICKNESS / 2),
          null, false);
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
      const armFloorDepth = ALCOVE_DEPTH + (openAlcoves ? FLOOR_REACH : 0);
      addBox(batches, null, floorMaterial, [armFloorDepth, SLAB, 2 * HALL_SIDE_HALF],
        side * (HALL_HALF_WIDTH + armFloorDepth / 2), LIP - SLAB / 2, opening, null, false);
      addBox(batches, null, ceilingMaterial, [ALCOVE_DEPTH, SLAB, 2 * HALL_SIDE_HALF],
        bayX, DOOR_HEIGHT + SLAB / 2, opening, null, false);
    }
  }

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
