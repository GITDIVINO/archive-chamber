/**
 * The view through the doorways.
 *
 * Only the player's own hex is ever built in full. What lies beyond a doorway
 * is this: the same chamber repeated down the corridor axis, stripped to the
 * shapes that still read at distance — carcase, shelf ledges, and a solid band
 * where a row of volumes would be. Individual spines are illegible long before
 * the second room, so building them would cost memory for nothing.
 *
 * Walls 2 and 5 face each other, so the passages line up and the repetition
 * runs straight to the fog. The horror is meant to be that it is not a trick:
 * those rooms genuinely exist, hold their own 640 volumes, and can be walked
 * to one threshold at a time.
 */

import * as THREE from 'three';
import { SHELVES_PER_WALL, VOLUMES_PER_SHELF } from '../../babel-v3.js';
import { WALL_DIRECTIONS } from '../../world-model.js';
import {
  BOOK_DEPTH,
  BOOK_FRONT_Z,
  BOOK_HEIGHT,
  BOOK_STEP,
  BOOK_WALL_INDICES,
  CABINET_POST_WIDTH,
  CABINET_WIDTH,
  DOOR_HEIGHT,
  DOOR_WALL_INDICES,
  DOOR_WIDTH,
  SHELF_BASE_Y,
  SHELF_PITCH,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WALL_WIDTH,
} from '../constants.js';
import { ceilingMaterial, floorMaterial, shelfMaterial, trimMaterial, wallMaterial } from '../core/materials.js';
import { appendMergedGeometry, axialMapOffset, boxGeometryFor, mergedMesh, pointOnWall, wallBasis } from './geometry.js';
import {
  CARCASE_BACK_THICKNESS,
  CARCASE_BACK_Z,
  CARCASE_CENTRE_Y,
  CARCASE_CENTRE_Z,
  CARCASE_DEPTH,
  CARCASE_HEIGHT,
  RAIL_THICKNESS,
  SHELF_CENTRE_Z,
  SHELF_DEPTH,
  SHELF_SURFACE_OFFSET,
  SHELF_THICKNESS,
  nicheShade,
  shelfBoardShade,
} from './room.js';

// How many chambers are built in each direction. Ten reaches roughly 154
// units, inside the camera's far plane, by which point the fog has closed
// completely: the corridor ends out of sight rather than at a visible edge.
const VISTA_DEPTH = 10;
// The corridor runs along the axis shared by the two doorways.
const CORRIDOR_DIRECTION = DOOR_WALL_INDICES[0];

const localMatrix = new THREE.Matrix4();
const worldMatrix = new THREE.Matrix4();
const offsetMatrix = new THREE.Matrix4();

function batchFor(batches, material) {
  let batch = batches.get(material);
  if (!batch) {
    batch = { material, positions: [], uvs: [], indices: [], colors: [] };
    batches.set(material, batch);
  }
  return batch;
}

function addBox(batches, material, size, position, rotation, parentMatrix, roomOffset, shade) {
  const entry = boxGeometryFor(size[0], size[1], size[2]);
  localMatrix.makeRotationY(rotation).setPosition(position.x, position.y, position.z);
  worldMatrix.copy(localMatrix);
  if (parentMatrix) worldMatrix.premultiply(parentMatrix);
  worldMatrix.premultiply(roomOffset);
  appendMergedGeometry(batchFor(batches, material), entry.geometry, worldMatrix, shade, localMatrix);
}

// One slab for the whole corridor rather than a floor per chamber: a plane in
// every room would overlap its neighbours exactly, and coplanar faces fight for
// depth. It sits a little below the current room's own floor, so that floor
// always wins where the two meet.
function addCorridorSlab(batches, material, size, y, rotationX) {
  const geometry = new THREE.PlaneGeometry(size, size);
  worldMatrix.makeRotationX(rotationX).setPosition(0, y, 0);
  appendMergedGeometry(batchFor(batches, material), geometry, worldMatrix);
  geometry.dispose();
}

// The volumes on a distant shelf, toned like a real spine: the shelf above
// shadows their heads. Without this the band reads as a blank white rail.
function bandShade(bottomY) {
  return local => THREE.MathUtils.lerp(0.98, 0.6, THREE.MathUtils.clamp((local.y - bottomY) / BOOK_HEIGHT, 0, 1));
}

// One wall of shelving, reduced to what survives the distance: the carcase, the
// ledges, and a filled band per shelf standing in for its thirty-two volumes.
function addDistantBookWall(batches, index, roomOffset) {
  const basis = wallBasis(index);
  const frameOffset = pointOnWall(basis, 0, 0, 0.28);
  const frame = new THREE.Matrix4().makeRotationY(basis.rotation)
    .setPosition(frameOffset.x, frameOffset.y, frameOffset.z);
  const postOffset = (CABINET_WIDTH - CABINET_POST_WIDTH) / 2;
  const postHeight = CARCASE_HEIGHT - 2 * RAIL_THICKNESS;

  addBox(batches, shelfMaterial, [CABINET_WIDTH, RAIL_THICKNESS, CARCASE_DEPTH],
    new THREE.Vector3(0, RAIL_THICKNESS / 2, CARCASE_CENTRE_Z), 0, frame, roomOffset, nicheShade);
  addBox(batches, shelfMaterial, [CABINET_WIDTH, RAIL_THICKNESS, CARCASE_DEPTH],
    new THREE.Vector3(0, CARCASE_HEIGHT - RAIL_THICKNESS / 2, CARCASE_CENTRE_Z), 0, frame, roomOffset, nicheShade);
  for (const side of [-1, 1]) {
    addBox(batches, shelfMaterial, [CABINET_POST_WIDTH, postHeight, CARCASE_DEPTH],
      new THREE.Vector3(side * postOffset, CARCASE_CENTRE_Y, CARCASE_CENTRE_Z), 0, frame, roomOffset, nicheShade);
  }
  addBox(batches, shelfMaterial, [CABINET_WIDTH, CARCASE_HEIGHT, CARCASE_BACK_THICKNESS],
    new THREE.Vector3(0, CARCASE_CENTRE_Y, CARCASE_BACK_Z), 0, frame, roomOffset, nicheShade);

  const bandWidth = VOLUMES_PER_SHELF * BOOK_STEP;
  for (let shelfIndex = 0; shelfIndex < SHELVES_PER_WALL; shelfIndex++) {
    const shelfY = SHELF_BASE_Y + shelfIndex * SHELF_PITCH;
    addBox(batches, shelfMaterial, [CABINET_WIDTH, SHELF_THICKNESS, SHELF_DEPTH],
      new THREE.Vector3(0, shelfY, SHELF_CENTRE_Z), 0, frame, roomOffset, shelfBoardShade(shelfY));
    // The volumes. One band rather than thirty-two boxes: at this range the
    // spines have merged into a single tone anyway.
    const bandBottom = shelfY + SHELF_SURFACE_OFFSET;
    addBox(batches, trimMaterial, [bandWidth, BOOK_HEIGHT, BOOK_DEPTH],
      new THREE.Vector3(0, bandBottom + BOOK_HEIGHT / 2, BOOK_FRONT_Z + BOOK_DEPTH / 2),
      0, frame, roomOffset, bandShade(bandBottom));
  }
}

function addDistantDoorWall(batches, index, roomOffset) {
  const basis = wallBasis(index);
  const jambWidth = (WALL_WIDTH - DOOR_WIDTH) / 2;
  const jambOffset = (DOOR_WIDTH + jambWidth) / 2;
  const lintelHeight = WALL_HEIGHT - DOOR_HEIGHT;
  for (const side of [-1, 1]) {
    addBox(batches, wallMaterial, [jambWidth, WALL_HEIGHT, WALL_THICKNESS],
      pointOnWall(basis, side * jambOffset, WALL_HEIGHT / 2), basis.rotation, null, roomOffset, null);
  }
  addBox(batches, wallMaterial, [DOOR_WIDTH, lintelHeight, WALL_THICKNESS],
    pointOnWall(basis, 0, DOOR_HEIGHT + lintelHeight / 2), basis.rotation, null, roomOffset, null);
}

function addSolidWall(batches, index, roomOffset) {
  const basis = wallBasis(index);
  addBox(batches, wallMaterial, [WALL_WIDTH, WALL_HEIGHT, WALL_THICKNESS],
    pointOnWall(basis, 0, WALL_HEIGHT / 2), basis.rotation, null, roomOffset, null);
}

/**
 * Builds the corridor once.
 *
 * Rooms are geometrically identical and the player always stands at the origin
 * of their own, so this never needs rebuilding — walking through a doorway
 * leaves the view unchanged, which is exactly the point.
 */
export function buildVista() {
  const group = new THREE.Group();
  const batches = new Map();
  // A wall index is its own axial direction, so the corridor axis follows
  // straight from which wall carries a doorway.
  const step = axialMapOffset(...WALL_DIRECTIONS[CORRIDOR_DIRECTION]);

  const corridorLength = 2 * (VISTA_DEPTH + 1) * Math.hypot(step.x, step.z);
  addCorridorSlab(batches, floorMaterial, corridorLength, -0.06, -Math.PI / 2);
  addCorridorSlab(batches, ceilingMaterial, corridorLength, WALL_HEIGHT + 0.06, Math.PI / 2);

  for (let n = -VISTA_DEPTH; n <= VISTA_DEPTH; n++) {
    if (n === 0) continue;
    offsetMatrix.makeTranslation(step.x * n, 0, step.z * n);
    for (const index of BOOK_WALL_INDICES) addDistantBookWall(batches, index, offsetMatrix);
    // Each chamber closes only its far side, so the wall shared with the
    // chamber before it is drawn exactly once and never z-fights.
    const farWall = n > 0 ? CORRIDOR_DIRECTION : (CORRIDOR_DIRECTION + 3) % 6;
    addDistantDoorWall(batches, farWall, offsetMatrix);
    for (let index = 0; index < 6; index++) {
      if (DOOR_WALL_INDICES.includes(index) || BOOK_WALL_INDICES.includes(index)) continue;
      addSolidWall(batches, index, offsetMatrix);
    }
  }

  for (const batch of batches.values()) {
    const mesh = mergedMesh(batch, batch.material);
    // Never picked and never walked into; it exists only to be looked at.
    mesh.raycast = () => {};
    group.add(mesh);
  }
  return group;
}
