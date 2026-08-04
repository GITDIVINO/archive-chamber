/**
 * The view through the doorways, and the passages themselves.
 *
 * Only the player's own hex is ever built in full. What lies beyond a doorway
 * is this: passage, chamber, passage, chamber, repeated down the corridor axis
 * and stripped to the shapes that still read at distance — carcase, shelf
 * ledges, and volumes. Nothing here is looked up in the catalogue: spines carry
 * stand-in markings from a fixed set, not titles, because a title is a smudge
 * by the second room and these chambers exist only to be seen through a
 * doorway. The books a player can actually open are built when they walk in.
 *
 * The passages the player walks through are these same passages. A chamber's
 * two free walls face each other, so both of its passages lie on this axis and
 * are already drawn here — there is nothing extra to build when somebody steps
 * into one, and crossing a threshold leaves the view untouched, which is the
 * whole point. Their side openings lead off the axis and so are not drawn
 * beyond the alcove behind each one.
 *
 * The horror is meant to be that it is not a trick: those rooms genuinely
 * exist, hold their own 640 volumes, and can be walked to one threshold at a
 * time.
 */

import * as THREE from 'three';
import { SHELVES_PER_WALL, VOLUMES_PER_SHELF } from '../../babel-v3.js';
import { bookWallsForLevel, freeWallsForLevel } from '../../world-engine.js';
import { WALL_DIRECTIONS } from '../../world-model.js';
import {
  BOOK_DEPTH,
  BOOK_FRONT_Z,
  BOOK_HEIGHT,
  BOOK_STEP,
  BOOK_WIDTH,
  CABINET_POST_WIDTH,
  CABINET_WIDTH,
  CHAMBER_STEP,
  DOOR_HEIGHT,
  HALL_START,
  DOOR_WIDTH,
  SHELF_BASE_Y,
  SHELF_PITCH,
  SPINE_HEIGHT,
  SPINE_WIDTH,
  ROOM_RADIUS,
  WALL_HEIGHT,
  DOOR_WALL_THICKNESS,
  WALL_THICKNESS,
  WALL_WIDTH,
} from '../constants.js';
import { ceilingMaterial, floorMaterial, outlineMaterial, shelfMaterial, trimMaterial, wallMaterial } from '../core/materials.js';
import { appendMergedGeometry, axialMapOffset, boxGeometryFor, mergedMesh, pointOnWall, wallBasis } from './geometry.js';
import { appendHall, hallTransform } from './hall.js';
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

// How many chambers are built in each direction. With a passage between each
// pair the corridor now covers roughly 32 units per chamber rather than 15, so
// five reaches about the same 158 units as ten did before: inside the camera's
// far plane, and far enough that the fog has closed completely — the corridor
// ends out of sight rather than at a visible edge.
const VISTA_DEPTH = 5;
// Chambers this close still show individual volumes; past it a filled band is
// indistinguishable and far cheaper. One nearer than before, because a chamber
// two along is now twice as far off as it used to be.
const VISTA_DETAIL_DEPTH = 2;
// The corridor runs along the axis shared by the two doorways, and that axis
// turns with the level: what shows through a doorway on the floor above runs a
// different way, which is the whole reason a stair is worth climbing.

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

// A floor and a ceiling per chamber rather than one slab down the whole
// corridor. The slab was cheaper, but it was also unbroken, and the stair bays
// need the floor to be genuinely absent where the well goes down — otherwise a
// shaft meant to fall away for storeys ends six centimetres below the tread.
// Each sits a hair below the passage's own floor and above its ceiling, so
// wherever the two meet the passage wins and nothing is coplanar.
function addChamberSlab(batches, material, centre, y, rotationX) {
  const geometry = new THREE.CircleGeometry(ROOM_RADIUS, 6);
  worldMatrix.makeRotationX(rotationX).setPosition(centre.x, y, centre.z);
  appendMergedGeometry(batchFor(batches, material), geometry, worldMatrix);
  geometry.dispose();
}

// A volume through a doorway, toned like a real spine: the shelf above shadows
// its head. What actually makes a row read as books, though, is the shadowed
// gap between one volume and the next.
function volumeShade(bottomY) {
  return local => THREE.MathUtils.lerp(1.02, 0.66, THREE.MathUtils.clamp((local.y - bottomY) / BOOK_HEIGHT, 0, 1));
}

// Volumes are placed on the same grid the real room uses, but none of them is
// a particular book: no catalogue index is computed and no title is read.
function addDistantVolumes(batches, outlinePositions, labels, seed, shelfY, frame, roomOffset) {
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
    // Cycled by position so neighbours never share a marking, which would make
    // the repetition look like a texture rather than a shelf.
    const cell = (seed + volumeIndex * 3) % SPINE_TEMPLATES.length;
    addSpineTemplate(labels, cell, x, centreY, frame, roomOffset);
  }
}

// One wall of shelving, reduced to what survives the distance: the carcase, the
// ledges, and its volumes.
function addDistantBookWall(batches, outlinePositions, labels, index, roomOffset, separateVolumes, roomSeed) {
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
      addDistantVolumes(batches, outlinePositions, labels, roomSeed + index * 5 + shelfIndex * 2, shelfY, frame, roomOffset);
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

// Stand-in spine markings. These are literals on purpose: they are not titles,
// they are not derived from any volume, and nothing addresses them. A spine
// this far off is a smudge with the shape of lettering, and that shape is the
// whole job — a shelf of blank spines reads as empty boxes.
const SPINE_TEMPLATES = Object.freeze([
  'ei.mrtqvlch',
  'nkbadu wsyf',
  'tqjr,plexn',
  'ozvghmd.ik',
  'wsfleun,ba',
  'jhrxmpo tdz',
  'cyunbil.gks',
  'rmatqwv,zeh',
]);
const TEMPLATE_CELL_WIDTH = 72;
const TEMPLATE_CELL_HEIGHT = 256;

let sharedTemplateMaterial = null;
function spineTemplateMaterial() {
  if (sharedTemplateMaterial) return sharedTemplateMaterial;
  const canvas = document.createElement('canvas');
  canvas.width = TEMPLATE_CELL_WIDTH * SPINE_TEMPLATES.length;
  canvas.height = TEMPLATE_CELL_HEIGHT;
  const context = canvas.getContext('2d');
  SPINE_TEMPLATES.forEach((label, cell) => {
    const x = cell * TEMPLATE_CELL_WIDTH;
    context.save();
    context.fillStyle = '#262626';
    context.globalAlpha = 0.88;
    context.translate(x + TEMPLATE_CELL_WIDTH / 2, TEMPLATE_CELL_HEIGHT / 2);
    context.rotate(-Math.PI / 2);
    context.font = '600 19px "Courier New", monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, 0, 0);
    context.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  sharedTemplateMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return sharedTemplateMaterial;
}

const templateCorner = new THREE.Vector3();
const templateMatrix = new THREE.Matrix4();
function addSpineTemplate(labels, cell, x, centreY, frame, roomOffset) {
  const inset = 2;
  const u0 = (cell * TEMPLATE_CELL_WIDTH + inset) / (TEMPLATE_CELL_WIDTH * SPINE_TEMPLATES.length);
  const u1 = ((cell + 1) * TEMPLATE_CELL_WIDTH - inset) / (TEMPLATE_CELL_WIDTH * SPINE_TEMPLATES.length);
  const halfWidth = SPINE_WIDTH / 2;
  const halfHeight = SPINE_HEIGHT / 2;
  templateMatrix.makeRotationY(Math.PI)
    .setPosition(x, centreY, BOOK_FRONT_Z - 0.015)
    .premultiply(frame)
    .premultiply(roomOffset);
  const base = labels.positions.length / 3;
  const corners = [
    [-halfWidth, halfHeight, u0, 1],
    [halfWidth, halfHeight, u1, 1],
    [-halfWidth, -halfHeight, u0, 0],
    [halfWidth, -halfHeight, u1, 0],
  ];
  for (const [cornerX, cornerY, u, v] of corners) {
    templateCorner.set(cornerX, cornerY, 0).applyMatrix4(templateMatrix);
    labels.positions.push(templateCorner.x, templateCorner.y, templateCorner.z);
    labels.uvs.push(u, v);
  }
  labels.indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
}

function addDistantDoorWall(batches, index, roomOffset) {
  const basis = wallBasis(index);
  const jambWidth = (WALL_WIDTH - DOOR_WIDTH) / 2;
  const jambOffset = (DOOR_WIDTH + jambWidth) / 2;
  const lintelHeight = WALL_HEIGHT - DOOR_HEIGHT;
  for (const side of [-1, 1]) {
    addBox(batches, wallMaterial, [jambWidth, WALL_HEIGHT, DOOR_WALL_THICKNESS],
      pointOnWall(basis, side * jambOffset, WALL_HEIGHT / 2), basis.rotation, null, roomOffset, null);
  }
  addBox(batches, wallMaterial, [DOOR_WIDTH, lintelHeight, DOOR_WALL_THICKNESS],
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
export function buildVista(level) {
  const group = new THREE.Group();
  const batches = new Map();
  const outlinePositions = [];
  const labels = { positions: [], uvs: [], indices: [], colors: [] };
  // A wall index is its own axial direction, so the corridor axis follows
  // straight from which wall carries a doorway.
  const doorWalls = freeWallsForLevel(level);
  const shelvedWalls = bookWallsForLevel(level);
  const corridorDirection = doorWalls[0];
  // The axial offset gives the direction; the spacing along it is now set by
  // the passage, not by the tiling, because chambers no longer share a wall.
  const axis = axialMapOffset(...WALL_DIRECTIONS[corridorDirection]).normalize();

  for (let n = -VISTA_DEPTH; n <= VISTA_DEPTH; n++) {
    if (n === 0) continue;
    const centre = { x: axis.x * CHAMBER_STEP * n, z: axis.z * CHAMBER_STEP * n };
    addChamberSlab(batches, floorMaterial, centre, -0.02, -Math.PI / 2);
    addChamberSlab(batches, ceilingMaterial, centre, WALL_HEIGHT + 0.02, Math.PI / 2);
    offsetMatrix.makeTranslation(centre.x, 0, centre.z);
    const separateVolumes = Math.abs(n) <= VISTA_DETAIL_DEPTH;
    const roomSeed = ((n % SPINE_TEMPLATES.length) + SPINE_TEMPLATES.length) % SPINE_TEMPLATES.length;
    for (const index of shelvedWalls) addDistantBookWall(batches, outlinePositions, labels, index, offsetMatrix, separateVolumes, roomSeed);
    // Both door walls now, one at each end: with a passage between them the
    // chambers no longer share a wall, so nothing is drawn twice.
    for (const index of doorWalls) addDistantDoorWall(batches, index, offsetMatrix);
    for (let index = 0; index < 6; index++) {
      if (doorWalls.includes(index) || shelvedWalls.includes(index)) continue;
      addSolidWall(batches, index, offsetMatrix);
    }
  }

  // A passage in every gap, including the two the player can walk into. Their
  // arrises are worth drawing only while the alcoves are still legible.
  for (let n = -VISTA_DEPTH; n < VISTA_DEPTH; n++) {
    const base = CHAMBER_STEP * n;
    hallTransform(offsetMatrix, axis.x, axis.z, axis.x * base, axis.z * base, HALL_START);
    appendHall(batches, Math.abs(n) <= VISTA_DETAIL_DEPTH ? outlinePositions : null, offsetMatrix);
  }

  for (const batch of batches.values()) {
    const mesh = mergedMesh(batch, batch.material);
    // Never picked and never walked into; it exists only to be looked at.
    mesh.raycast = () => {};
    group.add(mesh);
  }
  if (labels.positions.length) {
    const mesh = mergedMesh(labels, spineTemplateMaterial());
    mesh.renderOrder = 3;
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
