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
  HALL_TRANSOM_DEPTH,
  WALL_THICKNESS,
} from '../constants.js';
import { ceilingMaterial, floorMaterial, trimMaterial, wallMaterial } from '../core/materials.js';
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

// The scene is unlit, so the passage carries its depth in vertex colour like
// everything else. It darkens away from both open ends, which is what stops a
// bare tube from reading as one flat band, and the alcoves go darker still so a
// side opening looks like somewhere that continues rather than a niche.
function hallShade(local) {
  const fromEnd = Math.min(local.z, HALL_LENGTH - local.z);
  const depth = THREE.MathUtils.clamp(fromEnd / (HALL_LENGTH / 2), 0, 1);
  const sideways = THREE.MathUtils.clamp((Math.abs(local.x) - HALL_HALF_WIDTH) / ALCOVE_DEPTH, 0, 1);
  return THREE.MathUtils.lerp(1, 0.5, depth) * THREE.MathUtils.lerp(1, 0.42, sideways);
}

function addBox(batches, outlines, material, size, x, y, z, shade = hallShade, outlined = true, turn = 0) {
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
      addBox(batches, outlines, wallMaterial, [WALL_THICKNESS, DOOR_HEIGHT, runLength],
        wallX, DOOR_HEIGHT / 2, runCentre);
    }

    for (const opening of OPENINGS) {
      // Every opening is cut lower than the passage, leaving a lintel to write
      // on, and framed by a sill and a band so it reads from down the corridor.
      addBox(batches, outlines, wallMaterial, [WALL_THICKNESS, HALL_LINTEL_HEIGHT, 2 * HALL_SIDE_HALF],
        wallX, HALL_OPENING_HEIGHT + HALL_LINTEL_HEIGHT / 2, opening);
      addBox(batches, outlines, trimMaterial, [0.1, 0.05, 2 * HALL_SIDE_HALF],
        side * HALL_HALF_WIDTH, 0.025, opening, () => 0.5);
      addBox(batches, outlines, trimMaterial, [0.14, 0.07, 2 * HALL_SIDE_HALF + 0.28],
        side * HALL_HALF_WIDTH, HALL_OPENING_HEIGHT - 0.035, opening, () => 0.45);

      // The bay behind it: jamb returns and a blind end. Without one the
      // opening is a hole onto nothing.
      const bayX = side * ALCOVE_CENTRE;
      for (const jamb of [-1, 1]) {
        addBox(batches, outlines, wallMaterial, [ALCOVE_DEPTH, HALL_OPENING_HEIGHT, WALL_THICKNESS],
          bayX, HALL_OPENING_HEIGHT / 2, opening + jamb * (HALL_SIDE_HALF + WALL_THICKNESS / 2));
      }
      // Closed at the back only when nothing has been built behind it: for the
      // two passages the player can walk into, a chamber stands there instead —
      // see vista.js.
      if (!openAlcoves) {
        addBox(batches, outlines, wallMaterial,
          [WALL_THICKNESS, HALL_OPENING_HEIGHT, 2 * HALL_SIDE_HALF + 2 * WALL_THICKNESS],
          side * (ALCOVE_REACH + WALL_THICKNESS / 2), HALL_OPENING_HEIGHT / 2, opening);
      }

      addBox(batches, null, floorMaterial, [ALCOVE_DEPTH, SLAB, 2 * HALL_SIDE_HALF],
        bayX, -SLAB / 2, opening, null, false);
      addBox(batches, null, ceilingMaterial, [ALCOVE_DEPTH, SLAB, 2 * HALL_SIDE_HALF],
        bayX, HALL_OPENING_HEIGHT + SLAB / 2, opening, null, false);
    }
  }

  // A beam across each end, at the height of the side lintels. The far end has
  // no wall that could be lowered — it is the next chamber's doorway, and the
  // two meet flush — so the sign there needs a surface of its own. Both ends
  // carry one because a passage is the same passage from either side.
  for (const end of [HALL_TRANSOM_DEPTH / 2, HALL_LENGTH - HALL_TRANSOM_DEPTH / 2]) {
    addBox(batches, outlines, wallMaterial,
      [2 * HALL_HALF_WIDTH, HALL_LINTEL_HEIGHT, HALL_TRANSOM_DEPTH],
      0, HALL_OPENING_HEIGHT + HALL_LINTEL_HEIGHT / 2, end);
  }
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
