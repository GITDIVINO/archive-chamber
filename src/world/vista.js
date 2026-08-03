/**
 * The view through the doorways.
 *
 * Only the player's own hex is ever built in full. What lies beyond a doorway
 * is this: the same chamber repeated down the corridor axis, stripped to the
 * shapes that still read at distance — carcase, shelf ledges, and volumes.
 * Nothing here is looked up in the catalogue and no spine is lettered: a title
 * is a smudge by the second room, and these chambers exist only to be seen
 * through a doorway. The books a player can actually open are built when they
 * walk in.
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
  BOOK_WIDTH,
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
import { ceilingMaterial, floorMaterial, outlineMaterial, shelfMaterial, trimMaterial, wallMaterial } from '../core/materials.js';
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
// Chambers this close still show individual volumes; past it a filled band is
// indistinguishable and far cheaper.
const VISTA_DETAIL_DEPTH = 3;
// The corridor runs along the axis shared by the two doorways.
const CORRIDOR_DIRECTION = DOOR_WALL_INDICES[0];

const localMatrix = new THREE.Matrix4();
const worldMatrix = new THREE.Matrix4();
const offsetMatrix = new THREE.Matrix4();
const outlineCorner = new THREE.Vector3();

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

// A volume through a doorway, toned like a real spine: the shelf above shadows
// its head. What actually makes a row read as books, though, is the shadowed
// gap between one volume and the next.
function volumeShade(bottomY) {
  return local => THREE.MathUtils.lerp(1.02, 0.66, THREE.MathUtils.clamp((local.y - bottomY) / BOOK_HEIGHT, 0, 1));
}

// Volumes are placed on the same grid the real room uses, but nothing is looked
// up in the catalogue and no spine is lettered: at this range a title is a
// smudge, and these chambers exist only to be seen through a doorway. The books
// a player actually opens are built when they walk into the room.
function addDistantVolumes(batches, outlinePositions, shelfY, frame, roomOffset) {
  const bottomY = shelfY + SHELF_SURFACE_OFFSET;
  const shade = volumeShade(bottomY);
  const centreY = bottomY + BOOK_HEIGHT / 2;
  const centreZ = BOOK_FRONT_Z + BOOK_DEPTH / 2;
  const halfWidth = BOOK_WIDTH / 2;
  const faceZ = BOOK_FRONT_Z;
  for (let volumeIndex = 0; volumeIndex < VOLUMES_PER_SHELF; volumeIndex++) {
    const x = -((VOLUMES_PER_SHELF - 1) * BOOK_STEP) / 2 + volumeIndex * BOOK_STEP;
    addBox(batches, trimMaterial, [BOOK_WIDTH, BOOK_HEIGHT, BOOK_DEPTH],
      new THREE.Vector3(x, centreY, centreZ), 0, frame, roomOffset, shade);
    // The 30mm gap between neighbours is barely a pixel from the next chamber,
    // so tone alone left the row a blank slab. Drawing each spine's front face
    // is what separates them, exactly as it does in the room the player is in.
    const corners = [
      [x - halfWidth, bottomY],
      [x + halfWidth, bottomY],
      [x + halfWidth, bottomY + BOOK_HEIGHT],
      [x - halfWidth, bottomY + BOOK_HEIGHT],
    ];
    for (let corner = 0; corner < corners.length; corner++) {
      for (const [cornerX, cornerY] of [corners[corner], corners[(corner + 1) % corners.length]]) {
        outlineCorner.set(cornerX, cornerY, faceZ).applyMatrix4(frame).applyMatrix4(roomOffset);
        outlinePositions.push(outlineCorner.x, outlineCorner.y, outlineCorner.z);
      }
    }
  }
}

// One wall of shelving, reduced to what survives the distance: the carcase, the
// ledges, and its volumes.
function addDistantBookWall(batches, outlinePositions, index, roomOffset, separateVolumes) {
  const basis = wallBasis(index);
  const frameOffset = pointOnWall(basis, 0, 0, 0.28);
  const frame = new THREE.Matrix4().makeRotationY(basis.rotation)
    .setPosition(frameOffset.x, frameOffset.y, frameOffset.z);
  const postOffset = (CABINET_WIDTH - CABINET_POST_WIDTH) / 2;
  const postHeight = CARCASE_HEIGHT - 2 * RAIL_THICKNESS;

  addBox(batches, shelfMaterial, [CABINET_WIDTH, RAIL_THICKNESS, CARCASE_DEPTH],
    new THREE.Vector3(0, RAIL_THICKNESS / 2, CARCASE_CENTRE_Z), 0, frame, roomOffset, nicheShade);
  addBox(batches, shelfMaterial, [CABINET_WIDTH, RAIL_THICKNESS, CARCASE_DEPTH],
    new THREE.Vector3(0, CARCASE_HEIGHT - RAIL_THICKNESS / 2, CARCASE_CENTRE_Z), 0, frame, roomOffset,
    shelfBoardShade(CARCASE_HEIGHT - RAIL_THICKNESS / 2));
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
    if (separateVolumes) {
      addDistantVolumes(batches, outlinePositions, shelfY, frame, roomOffset);
      continue;
    }
    // Further off, one filled band: the gaps between spines have closed to
    // less than a pixel, so thirty-two boxes would buy nothing.
    const bandBottom = shelfY + SHELF_SURFACE_OFFSET;
    addBox(batches, trimMaterial, [bandWidth, BOOK_HEIGHT, BOOK_DEPTH],
      new THREE.Vector3(0, bandBottom + BOOK_HEIGHT / 2, BOOK_FRONT_Z + BOOK_DEPTH / 2),
      0, frame, roomOffset, volumeShade(bandBottom));
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
  const outlinePositions = [];
  // A wall index is its own axial direction, so the corridor axis follows
  // straight from which wall carries a doorway.
  const step = axialMapOffset(...WALL_DIRECTIONS[CORRIDOR_DIRECTION]);

  const corridorLength = 2 * (VISTA_DEPTH + 1) * Math.hypot(step.x, step.z);
  addCorridorSlab(batches, floorMaterial, corridorLength, -0.06, -Math.PI / 2);
  addCorridorSlab(batches, ceilingMaterial, corridorLength, WALL_HEIGHT + 0.06, Math.PI / 2);

  for (let n = -VISTA_DEPTH; n <= VISTA_DEPTH; n++) {
    if (n === 0) continue;
    offsetMatrix.makeTranslation(step.x * n, 0, step.z * n);
    const separateVolumes = Math.abs(n) <= VISTA_DETAIL_DEPTH;
    for (const index of BOOK_WALL_INDICES) addDistantBookWall(batches, outlinePositions, index, offsetMatrix, separateVolumes);
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
  if (outlinePositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));
    const outlines = new THREE.LineSegments(geometry, outlineMaterial);
    outlines.renderOrder = 2;
    outlines.raycast = () => {};
    group.add(outlines);
  }
  return group;
}
