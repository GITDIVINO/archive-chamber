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
  HALL_SIDE_CENTRE,
  HALL_SIDE_HALF,
  WALL_THICKNESS,
} from '../constants.js';
import { ceilingMaterial, floorMaterial, trimMaterial, wallMaterial } from '../core/materials.js';
import { appendMergedEdges, appendMergedGeometry, boxGeometryFor } from './geometry.js';

const SLAB = 0.12;
const SEGMENT = (HALL_LENGTH - 2 * HALL_SIDE_HALF) / 2;
const ALCOVE_CENTRE = HALL_HALF_WIDTH + ALCOVE_DEPTH / 2;

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

function addBox(batches, outlines, material, size, x, y, z, shade = hallShade, outlined = true) {
  const entry = boxGeometryFor(size[0], size[1], size[2]);
  localMatrix.makeTranslation(x, y, z);
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
export function appendHall(batches, outlines, matrix) {
  hallMatrix = matrix;
  const centre = HALL_LENGTH / 2;

  addBox(batches, null, floorMaterial, [2 * HALL_HALF_WIDTH, SLAB, HALL_LENGTH],
    0, -SLAB / 2, centre, null, false);
  addBox(batches, null, ceilingMaterial, [2 * HALL_HALF_WIDTH, SLAB, HALL_LENGTH],
    0, DOOR_HEIGHT + SLAB / 2, centre, null, false);

  for (const side of [-1, 1]) {
    const wallX = side * (HALL_HALF_WIDTH + WALL_THICKNESS / 2);
    // Two lengths of wall with the opening between them.
    for (const segmentCentre of [SEGMENT / 2, HALL_LENGTH - SEGMENT / 2]) {
      addBox(batches, outlines, wallMaterial, [WALL_THICKNESS, DOOR_HEIGHT, SEGMENT],
        wallX, DOOR_HEIGHT / 2, segmentCentre);
    }

    // The alcove behind the opening: floor, ceiling, two jamb returns and the
    // blind end. Without it the opening is a hole onto nothing.
    const alcoveX = side * ALCOVE_CENTRE;
    addBox(batches, null, floorMaterial, [ALCOVE_DEPTH, SLAB, 2 * HALL_SIDE_HALF],
      alcoveX, -SLAB / 2, HALL_SIDE_CENTRE, null, false);
    addBox(batches, null, ceilingMaterial, [ALCOVE_DEPTH, SLAB, 2 * HALL_SIDE_HALF],
      alcoveX, DOOR_HEIGHT + SLAB / 2, HALL_SIDE_CENTRE, null, false);
    for (const jamb of [-1, 1]) {
      addBox(batches, outlines, wallMaterial, [ALCOVE_DEPTH, DOOR_HEIGHT, WALL_THICKNESS],
        alcoveX, DOOR_HEIGHT / 2, HALL_SIDE_CENTRE + jamb * (HALL_SIDE_HALF + WALL_THICKNESS / 2));
    }
    addBox(batches, outlines, wallMaterial,
      [WALL_THICKNESS, DOOR_HEIGHT, 2 * HALL_SIDE_HALF + 2 * WALL_THICKNESS],
      side * (ALCOVE_REACH + WALL_THICKNESS / 2), DOOR_HEIGHT / 2, HALL_SIDE_CENTRE);

    // A sill on the floor and a band overhead, framing the mouth of the alcove.
    // Fifteen metres of bare wall carries nothing else, so without a drawn
    // frame a walker is level with the turning before they notice it — and the
    // turning is the whole reason the passage is long enough to have a middle.
    addBox(batches, outlines, trimMaterial, [0.1, 0.05, 2 * HALL_SIDE_HALF],
      side * HALL_HALF_WIDTH, 0.025, HALL_SIDE_CENTRE, () => 0.5);
    addBox(batches, outlines, trimMaterial, [0.14, 0.09, 2 * HALL_SIDE_HALF + 0.28],
      side * HALL_HALF_WIDTH, DOOR_HEIGHT - 0.045, HALL_SIDE_CENTRE, () => 0.45);
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
