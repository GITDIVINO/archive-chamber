/**
 * Builds one hexagonal chamber.
 *
 * A room holds 640 volumes.  Giving each one a mesh, an outline and a spine
 * quad cost roughly 1200 draw calls per frame; instead the volumes become
 * three InstancedMeshes, their outlines one LineSegments, and their labels one
 * merged mesh per spine atlas.  A full room now costs under twenty calls.
 */

import * as THREE from 'three';
import { SHELVES_PER_WALL, VOLUMES_PER_SHELF, isManifestoBookIndex, titleForBookIndex } from '../../babel-v3.js';
import { catalogBookIndexFor } from '../../world-engine.js';
import {
  BOOK_DEPTH,
  BOOK_FRONT_Z,
  BOOK_HEIGHT,
  BOOK_STEP,
  BOOK_WALLS,
  BOOK_WALL_INDICES,
  BOOK_WIDTH,
  CABINET_POST_WIDTH,
  CABINET_WIDTH,
  DOOR_HEIGHT,
  DOOR_WALLS,
  DOOR_WIDTH,
  SHELF_BASE_Y,
  SHELF_PITCH,
  SPINES_PER_ATLAS,
  SPINE_ATLAS_COLUMNS,
  SPINE_ATLAS_SIZE,
  SPINE_CELL_HEIGHT,
  SPINE_CELL_WIDTH,
  SPINE_HEIGHT,
  SPINE_WIDTH,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WALL_WIDTH,
} from '../constants.js';
import { renderer } from '../core/view.js';
import {
  bookMaterials,
  ceilingMaterial,
  floorMaterial,
  outlineMaterial,
  roomLineMaterial,
  shelfMaterial,
  trimMaterial,
  wallMaterial,
  MANIFESTO_TINT,
} from '../core/materials.js';
import {
  appendMergedEdges,
  appendMergedGeometry,
  boxGeometryFor,
  ceilingMark,
  hexCorners,
  mergedMesh,
  pointOnWall,
  sharedGeometries,
  wallBasis,
} from './geometry.js';

const bookGeometry = new THREE.BoxGeometry(BOOK_WIDTH, BOOK_HEIGHT, BOOK_DEPTH);
const bookEdgeGeometry = new THREE.EdgesGeometry(bookGeometry, 18);
sharedGeometries.add(bookGeometry).add(bookEdgeGeometry);

export function shortSpineTitle(title) {
  const value = title.replace(/\s+/g, ' ').trim().slice(0, 12);
  return value || 'untitled';
}

function createSpineAtlas(room) {
  const canvas = document.createElement('canvas');
  canvas.width = SPINE_ATLAS_SIZE;
  canvas.height = SPINE_ATLAS_SIZE;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const atlas = { context, material, next: 0, positions: [], uvs: [], indices: [] };
  room.userData.spineAtlases.push(atlas);
  room.userData.disposableMaterials.push(material);
  return atlas;
}

function paintSpineLabel(context, column, row, label) {
  const x = column * SPINE_CELL_WIDTH;
  const y = row * SPINE_CELL_HEIGHT;
  context.save();
  context.beginPath();
  context.rect(x + 2, y + 2, SPINE_CELL_WIDTH - 4, SPINE_CELL_HEIGHT - 4);
  context.clip();
  context.fillStyle = '#262626';
  context.globalAlpha = 0.88;
  context.translate(x + SPINE_CELL_WIDTH / 2, y + SPINE_CELL_HEIGHT / 2);
  context.rotate(-Math.PI / 2);
  context.font = '600 19px "Courier New", monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 0, 0);
  context.restore();
}

const spineCorner = new THREE.Vector3();
// Spine quads are baked into room space and merged per atlas, so a whole room
// of 640 labels costs one draw call per atlas instead of one per volume.
function appendSpine(room, label, matrix) {
  let atlas = room.userData.spineAtlases.at(-1);
  if (!atlas || atlas.next === SPINES_PER_ATLAS) atlas = createSpineAtlas(room);
  const cell = atlas.next++;
  const column = cell % SPINE_ATLAS_COLUMNS;
  const row = Math.floor(cell / SPINE_ATLAS_COLUMNS);
  paintSpineLabel(atlas.context, column, row, label);
  const inset = 2;
  const u0 = (column * SPINE_CELL_WIDTH + inset) / SPINE_ATLAS_SIZE;
  const u1 = ((column + 1) * SPINE_CELL_WIDTH - inset) / SPINE_ATLAS_SIZE;
  const vTop = 1 - (row * SPINE_CELL_HEIGHT + inset) / SPINE_ATLAS_SIZE;
  const vBottom = 1 - ((row + 1) * SPINE_CELL_HEIGHT - inset) / SPINE_ATLAS_SIZE;
  const halfWidth = SPINE_WIDTH / 2;
  const halfHeight = SPINE_HEIGHT / 2;
  const base = atlas.positions.length / 3;
  const corners = [
    [-halfWidth, halfHeight, u0, vTop],
    [halfWidth, halfHeight, u1, vTop],
    [-halfWidth, -halfHeight, u0, vBottom],
    [halfWidth, -halfHeight, u1, vBottom],
  ];
  for (const [cornerX, cornerY, u, v] of corners) {
    spineCorner.set(cornerX, cornerY, 0).applyMatrix4(matrix);
    atlas.positions.push(spineCorner.x, spineCorner.y, spineCorner.z);
    atlas.uvs.push(u, v);
  }
  atlas.indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
}

function staticBatchFor(room, material) {
  let batch = room.userData.staticBatches.get(material);
  if (!batch) {
    batch = { material, positions: [], uvs: [], indices: [] };
    room.userData.staticBatches.set(material, batch);
  }
  return batch;
}

const staticBoxMatrix = new THREE.Matrix4();
function addBox(room, material, size, position, rotation = 0, parentMatrix = null, outlined = true) {
  const entry = boxGeometryFor(size[0], size[1], size[2]);
  staticBoxMatrix.makeRotationY(rotation).setPosition(position.x, position.y, position.z);
  if (parentMatrix) staticBoxMatrix.premultiply(parentMatrix);
  appendMergedGeometry(staticBatchFor(room, material), entry.geometry, staticBoxMatrix);
  if (outlined) appendMergedEdges(room.userData.outlinePositions, entry.edges, staticBoxMatrix);
}

function addSolidWall(room, index) {
  const basis = wallBasis(index);
  addBox(room, wallMaterial, [WALL_WIDTH, WALL_HEIGHT, WALL_THICKNESS], pointOnWall(basis, 0, WALL_HEIGHT / 2), basis.rotation);
}

// A doorway wall is the same surface with a hole in it: two jambs and a lintel.
// Everything above and beside the opening stays closed, so the room reads as
// sealed apart from the two passages.
function addDoorWall(room, index) {
  const basis = wallBasis(index);
  const jambWidth = (WALL_WIDTH - DOOR_WIDTH) / 2;
  const jambOffset = (DOOR_WIDTH + jambWidth) / 2;
  const lintelHeight = WALL_HEIGHT - DOOR_HEIGHT;
  for (const side of [-1, 1]) {
    addBox(
      room,
      wallMaterial,
      [jambWidth, WALL_HEIGHT, WALL_THICKNESS],
      pointOnWall(basis, side * jambOffset, WALL_HEIGHT / 2),
      basis.rotation,
    );
  }
  addBox(
    room,
    wallMaterial,
    [DOOR_WIDTH, lintelHeight, WALL_THICKNESS],
    pointOnWall(basis, 0, DOOR_HEIGHT + lintelHeight / 2),
    basis.rotation,
  );
  // A shallow reveal around the opening so the threshold reads as cut stone
  // rather than a floating edge.
  addBox(
    room,
    trimMaterial,
    [DOOR_WIDTH + 0.18, 0.1, WALL_THICKNESS + 0.06],
    pointOnWall(basis, 0, DOOR_HEIGHT + 0.05),
    basis.rotation,
  );
}

const frameMatrix = new THREE.Matrix4();
const bookMatrix = new THREE.Matrix4();
const spineMatrix = new THREE.Matrix4();
const outlineCorner = new THREE.Vector3();

// The carcase is drawn as one body: its parts share a material and carry no
// edges of their own, and only this silhouette is outlined. Shelves therefore
// read as recesses cut into a solid block rather than boards stacked together.
// The carcase stands on the floor and stops short of the ceiling: a case that
// began at y=0.18 read as hanging in mid-air, and one reaching 4.6 put its top
// shelf out of arm's length.
const CARCASE_HEIGHT = 3.5;
const CARCASE_DEPTH = 0.56;
const CARCASE_CENTRE_Y = CARCASE_HEIGHT / 2;
const CARCASE_CENTRE_Z = -0.15;
const CARCASE_FRONT_Z = CARCASE_CENTRE_Z - CARCASE_DEPTH / 2;
const RAIL_THICKNESS = 0.12;
const CARCASE_BACK_THICKNESS = 0.06;
const CARCASE_BACK_Z = CARCASE_CENTRE_Z + CARCASE_DEPTH / 2 - CARCASE_BACK_THICKNESS / 2;

// The shelf reads because its front face is drawn as a band, not because it
// juts out: a deep overhang hides the volumes on the shelf below whenever the
// player looks up, and thickening it eats the headroom above the books.
const SHELF_THICKNESS = 0.11;
const SHELF_DEPTH = 0.5;
const SHELF_CENTRE_Z = -0.18;
const SHELF_FRONT_Z = SHELF_CENTRE_Z - SHELF_DEPTH / 2;
const SHELF_SURFACE_OFFSET = SHELF_THICKNESS / 2;

const framePoint = new THREE.Vector3();
function pushLine(outlinePositions, parentMatrix, from, to) {
  for (const point of [from, to]) {
    framePoint.set(point[0], point[1], point[2]).applyMatrix4(parentMatrix);
    outlinePositions.push(framePoint.x, framePoint.y, framePoint.z);
  }
}

// Only the front of the carcase is drawn. Its back and depth edges sat behind
// the volumes where they read as stray lines rather than structure.
function addCarcaseOutline(room, parentMatrix) {
  const { outlinePositions } = room.userData;
  const halfWidth = CABINET_WIDTH / 2;
  const top = CARCASE_HEIGHT;
  const bottom = 0;
  const frame = [
    [[-halfWidth, bottom], [halfWidth, bottom]],
    [[halfWidth, bottom], [halfWidth, top]],
    [[halfWidth, top], [-halfWidth, top]],
    [[-halfWidth, top], [-halfWidth, bottom]],
  ];
  for (const [from, to] of frame) {
    pushLine(outlinePositions, parentMatrix, [from[0], from[1], CARCASE_FRONT_Z], [to[0], to[1], CARCASE_FRONT_Z]);
  }
  // Inner edge of each upright, so the carcase reads as a frame with real
  // stiles rather than a flat rectangle.
  const innerX = halfWidth - CABINET_POST_WIDTH;
  for (const side of [-1, 1]) {
    pushLine(outlinePositions, parentMatrix, [side * innerX, bottom, CARCASE_FRONT_Z], [side * innerX, top, CARCASE_FRONT_Z]);
  }
}

const shelfEdgePoint = new THREE.Vector3();
// Only the front face of a shelf is drawn, as two horizontal lines running the
// full width with no end caps. That reads as a ledge cut into the carcase and
// gives the volumes something to visibly stand on, without turning the shelf
// back into a separate box.
function addShelfEdge(outlinePositions, parentMatrix, shelfY) {
  const halfWidth = CABINET_WIDTH / 2;
  for (const y of [shelfY + SHELF_SURFACE_OFFSET, shelfY - SHELF_SURFACE_OFFSET]) {
    for (const x of [-halfWidth, halfWidth]) {
      shelfEdgePoint.set(x, y, SHELF_FRONT_Z).applyMatrix4(parentMatrix);
      outlinePositions.push(shelfEdgePoint.x, shelfEdgePoint.y, shelfEdgePoint.z);
    }
  }
}

// Only the face of the spine is drawn. Outlining the whole box also drew each
// volume's back edges, which tripled the line count and left the books looking
// like crates trailing off into empty space behind the shelf.
const BOOK_FACE_SEGMENTS = (() => {
  const halfWidth = BOOK_WIDTH / 2;
  const halfHeight = BOOK_HEIGHT / 2;
  const faceZ = -BOOK_DEPTH / 2;
  const corners = [
    [-halfWidth, -halfHeight, faceZ],
    [halfWidth, -halfHeight, faceZ],
    [halfWidth, halfHeight, faceZ],
    [-halfWidth, halfHeight, faceZ],
  ];
  const segments = [];
  for (let index = 0; index < corners.length; index++) {
    segments.push(corners[index], corners[(index + 1) % corners.length]);
  }
  return segments;
})();

function appendBookOutline(outlinePositions, matrix) {
  for (const [x, y, z] of BOOK_FACE_SEGMENTS) {
    outlineCorner.set(x, y, z).applyMatrix4(matrix);
    outlinePositions.push(outlineCorner.x, outlineCorner.y, outlineCorner.z);
  }
}

// Collects one wall's volumes into the room-wide batches instead of adding a
// mesh per book.  Shelving itself stays merged too: there are only a handful
// of carcase pieces per wall, but they share two materials across four walls.
function collectBookWall(room, index, q, r) {
  const basis = wallBasis(index);
  const canonicalWall = BOOK_WALL_INDICES.indexOf(index) + 1;
  const frameOffset = pointOnWall(basis, 0, 0, 0.28);
  frameMatrix.makeRotationY(basis.rotation).setPosition(frameOffset.x, frameOffset.y, frameOffset.z);
  const postOffset = (CABINET_WIDTH - CABINET_POST_WIDTH) / 2;
  const postHeight = CARCASE_HEIGHT - 2 * RAIL_THICKNESS;
  addBox(room, shelfMaterial, [CABINET_WIDTH, RAIL_THICKNESS, CARCASE_DEPTH], new THREE.Vector3(0, RAIL_THICKNESS / 2, CARCASE_CENTRE_Z), 0, frameMatrix, false);
  addBox(room, shelfMaterial, [CABINET_WIDTH, RAIL_THICKNESS, CARCASE_DEPTH], new THREE.Vector3(0, CARCASE_HEIGHT - RAIL_THICKNESS / 2, CARCASE_CENTRE_Z), 0, frameMatrix, false);
  for (const side of [-1, 1]) {
    addBox(room, shelfMaterial, [CABINET_POST_WIDTH, postHeight, CARCASE_DEPTH], new THREE.Vector3(side * postOffset, CARCASE_CENTRE_Y, CARCASE_CENTRE_Z), 0, frameMatrix, false);
  }
  // Backing board: without it the volumes stood against open space and the
  // gaps between them showed straight through the cabinet.
  addBox(
    room,
    shelfMaterial,
    [CABINET_WIDTH, CARCASE_HEIGHT, CARCASE_BACK_THICKNESS],
    new THREE.Vector3(0, CARCASE_CENTRE_Y, CARCASE_BACK_Z),
    0,
    frameMatrix,
    false,
  );
  addCarcaseOutline(room, frameMatrix);

  const { batches, outlinePositions } = room.userData;
  for (let shelfIndex = 0; shelfIndex < SHELVES_PER_WALL; shelfIndex++) {
    const shelfY = SHELF_BASE_Y + shelfIndex * SHELF_PITCH;
    addBox(room, shelfMaterial, [CABINET_WIDTH, SHELF_THICKNESS, SHELF_DEPTH], new THREE.Vector3(0, shelfY, SHELF_CENTRE_Z), 0, frameMatrix, false);
    addShelfEdge(outlinePositions, frameMatrix, shelfY);
    for (let volumeIndex = 0; volumeIndex < VOLUMES_PER_SHELF; volumeIndex++) {
      const worldLocation = {
        q,
        r,
        wall: canonicalWall,
        shelf: shelfIndex + 1,
        volume: volumeIndex + 1,
        page: 1,
      };
      const bookIndex = catalogBookIndexFor(worldLocation);
      const manifesto = isManifestoBookIndex(bookIndex);
      const batch = manifesto ? batches[0] : batches[(shelfIndex + volumeIndex) % batches.length];
      const x = -((VOLUMES_PER_SHELF - 1) * BOOK_STEP) / 2 + volumeIndex * BOOK_STEP;
      // Seated exactly on the shelf surface: the old constant left a 25mm gap
      // that read as books hovering once the shelf lost its outline.
      const y = shelfY + SHELF_SURFACE_OFFSET + BOOK_HEIGHT / 2;
      const bookCenterZ = BOOK_FRONT_Z + BOOK_DEPTH / 2;

      bookMatrix.makeTranslation(x, y, bookCenterZ).premultiply(frameMatrix);
      batch.matrices.push(bookMatrix.clone());
      batch.tints.push(manifesto ? MANIFESTO_TINT : null);
      const title = shortSpineTitle(titleForBookIndex(bookIndex));
      batch.records.push({ bookIndex, worldLocation, volumeTitle: title });
      appendBookOutline(outlinePositions, bookMatrix);

      spineMatrix.makeRotationY(Math.PI).setPosition(x, y, BOOK_FRONT_Z - 0.015).premultiply(frameMatrix);
      appendSpine(room, title, spineMatrix);
    }
  }
}

function finalizeRoom(room) {
  const { batches, outlinePositions, staticBatches } = room.userData;
  for (const batch of staticBatches.values()) room.add(mergedMesh(batch, batch.material));

  for (const batch of batches) {
    if (!batch.matrices.length) continue;
    const mesh = new THREE.InstancedMesh(bookGeometry, batch.material, batch.matrices.length);
    const colors = new Float32Array(batch.matrices.length * 3).fill(1);
    for (let index = 0; index < batch.matrices.length; index++) {
      mesh.setMatrixAt(index, batch.matrices[index]);
      const tint = batch.tints[index];
      if (tint) colors.set(tint, index * 3);
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.records = batch.records;
    room.add(mesh);
    room.userData.bookMeshes.push(mesh);
  }

  if (outlinePositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));
    const outlines = new THREE.LineSegments(geometry, outlineMaterial);
    outlines.renderOrder = 2;
    room.add(outlines);
  }

  for (const atlas of room.userData.spineAtlases) {
    atlas.material.map.needsUpdate = true;
    const mesh = mergedMesh(atlas, atlas.material);
    mesh.renderOrder = 3;
    room.add(mesh);
    atlas.positions = atlas.uvs = atlas.indices = null;
  }

  room.userData.batches = null;
  room.userData.outlinePositions = null;
  room.userData.staticBatches = null;
}

export function makeRoom(q, r, roomTag) {
  const room = new THREE.Group();
  room.userData = {
    q,
    r,
    bookMeshes: [],
    spineAtlases: [],
    disposableMaterials: [],
    outlinePositions: [],
    staticBatches: new Map(),
    batches: bookMaterials.map(material => ({ material, matrices: [], tints: [], records: [] })),
  };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(32, 32), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  room.add(floor);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(32, 32), ceilingMaterial);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = WALL_HEIGHT + 0.01;
  room.add(ceiling);

  const markMaterial = ceilingMark(roomTag);
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 1.85), markMaterial);
  mark.rotation.x = Math.PI / 2;
  mark.position.set(0, WALL_HEIGHT, 0);
  room.add(mark);
  room.userData.disposableMaterials.push(markMaterial);

  for (const corner of hexCorners()) {
    const line = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(corner.x, 0.02, corner.z),
      new THREE.Vector3(corner.x, WALL_HEIGHT, corner.z),
    ]);
    room.add(new THREE.Line(line, roomLineMaterial));
  }

  for (let index = 0; index < 6; index++) {
    if (DOOR_WALLS.has(index)) addDoorWall(room, index);
    else addSolidWall(room, index);
    if (BOOK_WALLS.has(index)) collectBookWall(room, index, q, r);
  }
  finalizeRoom(room);
  return room;
}

export function disposeRoom(room) {
  const geometries = new Set();
  room.traverse(object => {
    if (object.geometry && !sharedGeometries.has(object.geometry)) geometries.add(object.geometry);
    // Instanced volumes own their matrix and colour buffers even though the box
    // geometry itself is shared across every room.
    if (object.isInstancedMesh) object.dispose();
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of room.userData.disposableMaterials) {
    material.map?.dispose();
    material.dispose();
  }
}
