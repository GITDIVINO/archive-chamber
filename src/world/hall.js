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
  DOOR_HEIGHT,
  HALL_HALF_WIDTH,
  HALL_LENGTH,
  HALL_LINTEL_HEIGHT,
  HALL_OPENING_HEIGHT,
  HALL_SIDE_CENTRE,
  HALL_SIDE_HALF,
  DOOR_WALL_THICKNESS,
  WALL_THICKNESS,
} from '../constants.js';
import { ceilingMaterial, floorMaterial, wallMaterial } from '../core/materials.js';
import { appendMergedEdges, appendMergedGeometry, boxGeometryFor } from './geometry.js';

const SLAB = 0.12;
const LIP = 0.004;
const ALCOVE_CENTRE = HALL_HALF_WIDTH + ALCOVE_DEPTH / 2;

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

function drawPassageEdges(outlines, openAlcoves) {
  for (const side of [-1, 1]) {
    const face = side * HALL_HALF_WIDTH;
    // Where the wall meets the floor and the ceiling, the length of the passage.
    line(outlines, [face, 0, 0], [face, 0, HALL_LENGTH]);
    line(outlines, [face, DOOR_HEIGHT, 0], [face, DOOR_HEIGHT, HALL_LENGTH]);

    for (const opening of OPENINGS) {
      const near = opening - HALL_SIDE_HALF;
      const far = opening + HALL_SIDE_HALF;
      line(outlines, [face, 0, near], [face, HALL_OPENING_HEIGHT, near]);
      line(outlines, [face, 0, far], [face, HALL_OPENING_HEIGHT, far]);
      line(outlines, [face, HALL_OPENING_HEIGHT, near], [face, HALL_OPENING_HEIGHT, far]);

      // The arm behind it: its own two walls meeting its floor and ceiling.
      const reach = side * ALCOVE_REACH;
      for (const jamb of [near, far]) {
        line(outlines, [face, 0, jamb], [reach, 0, jamb]);
        line(outlines, [face, HALL_OPENING_HEIGHT, jamb], [reach, HALL_OPENING_HEIGHT, jamb]);
      }
      // A blind arm has a back; a walkable one opens on a chamber, and that
      // chamber's own doorway is where the edge is.
      if (!openAlcoves) {
        line(outlines, [reach, 0, near], [reach, HALL_OPENING_HEIGHT, near]);
        line(outlines, [reach, 0, far], [reach, HALL_OPENING_HEIGHT, far]);
        line(outlines, [reach, HALL_OPENING_HEIGHT, near], [reach, HALL_OPENING_HEIGHT, far]);
      }
    }
  }
}

export function appendHall(batches, outlines, matrix, openAlcoves = false) {
  hallMatrix = matrix;
  const centre = HALL_LENGTH / 2;

  // Run back under both doorways: a chamber's own floor is a hexagon and stops
  // at its wall line, while the doorway is built deep and reaches past it. A
  // hair above them, so that where the two overlap the passage wins and nothing
  // is coplanar.
  const RUN = HALL_LENGTH + DOOR_WALL_THICKNESS;
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
      // Every opening is cut lower than the passage, leaving a lintel to write
      // on. Nothing is applied around it — no sill, no band: those read as
      // joinery, and there is none here.
      addBox(batches, null, wallMaterial, [WALL_THICKNESS, HALL_LINTEL_HEIGHT, 2 * HALL_SIDE_HALF],
        wallX, HALL_OPENING_HEIGHT + HALL_LINTEL_HEIGHT / 2, opening, null, false);
      // The arm behind it: its two walls, and a back when nothing stands there.
      const bayX = side * ALCOVE_CENTRE;
      for (const jamb of [-1, 1]) {
        addBox(batches, null, wallMaterial, [ALCOVE_DEPTH, HALL_OPENING_HEIGHT, WALL_THICKNESS],
          bayX, HALL_OPENING_HEIGHT / 2, opening + jamb * (HALL_SIDE_HALF + WALL_THICKNESS / 2),
          null, false);
      }
      if (!openAlcoves) {
        addBox(batches, null, wallMaterial,
          [WALL_THICKNESS, HALL_OPENING_HEIGHT, 2 * HALL_SIDE_HALF + 2 * WALL_THICKNESS],
          side * (ALCOVE_REACH + WALL_THICKNESS / 2), HALL_OPENING_HEIGHT / 2, opening,
          null, false);
      }

      addBox(batches, null, floorMaterial, [ALCOVE_DEPTH, SLAB, 2 * HALL_SIDE_HALF],
        bayX, -SLAB / 2, opening, null, false);
      addBox(batches, null, ceilingMaterial, [ALCOVE_DEPTH, SLAB, 2 * HALL_SIDE_HALF],
        bayX, HALL_OPENING_HEIGHT + SLAB / 2, opening, null, false);
    }
  }

  // The beam that carries the name of the chamber at the far end is not built
  // here. A passage is drawn once and serves both directions, so a beam at each
  // end meant one always stood in the mouth of the doorway a walker was looking
  // out of. It belongs to the chamber instead — see addFarBeam in room.js —
  // which knows which end is far.

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
