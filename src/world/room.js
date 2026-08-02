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
  SPINES_PER_ATLAS,
  SPINE_ATLAS_COLUMNS,
  SPINE_ATLAS_SIZE,
  SPINE_CELL_HEIGHT,
  SPINE_CELL_WIDTH,
  SPINE_HEIGHT,
  SPINE_WIDTH,
  WALL_HEIGHT,
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
  addBox(room, wallMaterial, [WALL_WIDTH, WALL_HEIGHT, 0.2], pointOnWall(basis, 0, WALL_HEIGHT / 2), basis.rotation);
}

const frameMatrix = new THREE.Matrix4();
const bookMatrix = new THREE.Matrix4();
const spineMatrix = new THREE.Matrix4();
const outlineCorner = new THREE.Vector3();

function appendBookOutline(outlinePositions, matrix) {
  const source = bookEdgeGeometry.getAttribute('position');
  for (let index = 0; index < source.count; index++) {
    outlineCorner.fromBufferAttribute(source, index).applyMatrix4(matrix);
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
  addBox(room, trimMaterial, [CABINET_WIDTH, 0.12, 0.54], new THREE.Vector3(0, 0.24, -0.14), 0, frameMatrix);
  addBox(room, trimMaterial, [CABINET_WIDTH, 0.12, 0.54], new THREE.Vector3(0, 4.56, -0.14), 0, frameMatrix);
  addBox(room, shelfMaterial, [CABINET_POST_WIDTH, 4.38, 0.54], new THREE.Vector3(-postOffset, 2.4, -0.14), 0, frameMatrix);
  addBox(room, shelfMaterial, [CABINET_POST_WIDTH, 4.38, 0.54], new THREE.Vector3(postOffset, 2.4, -0.14), 0, frameMatrix);

  const { batches, outlinePositions } = room.userData;
  for (let shelfIndex = 0; shelfIndex < SHELVES_PER_WALL; shelfIndex++) {
    const shelfY = 0.32 + shelfIndex * 0.86;
    addBox(room, trimMaterial, [CABINET_WIDTH, 0.09, 0.5], new THREE.Vector3(0, shelfY, -0.18), 0, frameMatrix);
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
      const y = shelfY + 0.07 + BOOK_HEIGHT / 2;
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
    addSolidWall(room, index);
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
