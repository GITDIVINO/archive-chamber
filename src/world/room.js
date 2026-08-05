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
import { tracesFor } from './traces.js';
import {
  bookWallsForLevel,
  canonicalWallForWallIndex,
  catalogBookIndexFor,
  freeWallsForLevel,
  worldRoomIndexFor,
} from '../../world-engine.js';
import {
  BOOK_DEPTH,
  BOOK_FRONT_Z,
  BOOK_HEIGHT,
  BOOK_STEP,
  BOOK_WIDTH,
  CABINET_POST_WIDTH,
  CABINET_WIDTH,
  APOTHEM,
  DOOR_HALF_WIDTH,
  DOOR_HEIGHT,
  HALL_HALF_WIDTH,
  HALL_LENGTH,
  HALL_OPENING_HEIGHT,
  HALL_START,
  HALL_TRANSOM_DEPTH,
  ROOM_RADIUS,
  DOOR_WIDTH,
  SHELF_BASE_Y,
  SHELF_PITCH,
  SHELVED_WALLS_PER_ROOM,
  SPINES_PER_ATLAS,
  SPINE_ATLAS_COLUMNS,
  SPINE_ATLAS_SIZE,
  SPINE_CELL_HEIGHT,
  SPINE_CELL_WIDTH,
  SPINE_HEIGHT,
  SPINE_WIDTH,
  WALL_HEIGHT,
  DOOR_WALL_THICKNESS,
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
  drawDraftedLabel,
  hexCorners,
  mergedMesh,
  pointOnWall,
  sharedGeometries,
  wallBasis,
} from './geometry.js';

// Split up its height so the spine can carry a three-stop tone: a box corner
// only has vertices at top and bottom, which is not enough to darken a volume
// where it meets the board and again where the shelf overhangs it.
const bookGeometry = new THREE.BoxGeometry(BOOK_WIDTH, BOOK_HEIGHT, BOOK_DEPTH, 1, 2, 1);
sharedGeometries.add(bookGeometry);

// Every volume shares one geometry, so its faces are toned once here. Without
// this a book is a flat card: the spine faces the room and stays light, the
// head and sides fall away, and the board behind it is barely lit at all.
// Read from the normals rather than vertex ranges so it cannot silently
// mismatch if the box is ever rebuilt.
(function toneBookFaces() {
  const normal = bookGeometry.getAttribute('normal');
  const position = bookGeometry.getAttribute('position');
  const colors = new Float32Array(normal.count * 3);
  for (let vertex = 0; vertex < normal.count; vertex++) {
    const y = normal.getY(vertex);
    const z = normal.getZ(vertex);
    let tone = 0.78;
    if (z < -0.5) {
      // The spine, and the only face of a packed volume really on show. Two
      // shadows shape it: the shelf above overhangs and darkens its head, and
      // where it stands on the board there is contact shadow. Without that
      // second one the foot of the spine was the brightest thing on the shelf
      // and ran straight into the board it was standing on.
      const height = position.getY(vertex) / BOOK_HEIGHT + 0.5;
      tone = height < 0.5
        ? THREE.MathUtils.lerp(0.66, 1.06, height / 0.5)
        : THREE.MathUtils.lerp(1.06, 0.7, (height - 0.5) / 0.5);
    } else if (z > 0.5) tone = 0.46;
    else if (y > 0.5) tone = 0.72;
    else if (y < -0.5) tone = 0.6;
    colors[vertex * 3] = tone;
    colors[vertex * 3 + 1] = tone;
    colors[vertex * 3 + 2] = tone;
  }
  bookGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
})();

// A shelf of identical volumes reads as one printed band, so each copy is
// nudged a little lighter or darker. Derived from the catalogue index, so a
// given book looks the same in every room it repeats in.
const BOOK_TONE_STEPS = 7n;
function bookTone(bookIndex) {
  const step = Number(((bookIndex % BOOK_TONE_STEPS) + BOOK_TONE_STEPS) % BOOK_TONE_STEPS);
  const tone = 0.9 + step * 0.03;
  return [tone, tone, tone];
}

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
  // Queued rather than painted. Six hundred and forty rotated labels across
  // three 2048 canvases measured 7.6 ms of the 14 that building a room cost,
  // and none of it has to happen in the frame a walker crosses a threshold:
  // they arrive at the far doorway, where a spine is a smudge anyway.
  room.userData.pendingSpines.push({ atlas, column, row, label });
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
    batch = { material, positions: [], uvs: [], indices: [], colors: [] };
    room.userData.staticBatches.set(material, batch);
  }
  return batch;
}

const staticLocalMatrix = new THREE.Matrix4();
const staticBoxMatrix = new THREE.Matrix4();
function addBox(room, material, size, position, rotation = 0, parentMatrix = null, options = {}) {
  const { outlined = true, shade = null } = options;
  const entry = boxGeometryFor(size[0], size[1], size[2]);
  staticLocalMatrix.makeRotationY(rotation).setPosition(position.x, position.y, position.z);
  staticBoxMatrix.copy(staticLocalMatrix);
  if (parentMatrix) staticBoxMatrix.premultiply(parentMatrix);
  // The shade callback sees the vertex in cabinet space, before the wall
  // transform, so depth into the niche is simply its z.
  appendMergedGeometry(staticBatchFor(room, material), entry.geometry, staticBoxMatrix, shade, staticLocalMatrix);
  if (outlined) appendMergedEdges(room.userData.outlinePositions, entry.edges, staticBoxMatrix);
}

function addSolidWall(room, index) {
  const basis = wallBasis(index);
  addBox(room, wallMaterial, [WALL_WIDTH, WALL_HEIGHT, WALL_THICKNESS], pointOnWall(basis, 0, WALL_HEIGHT / 2), basis.rotation);
}

// The face of a wall, in room space, so a line can be drawn on it.
const wallFacePoint = new THREE.Vector3();
function faceOf(basis, tangent, height, inward) {
  const point = pointOnWall(basis, tangent, height, inward);
  return [point.x, point.y, point.z];
}
function drawOnWall(outlinePositions, basis, inward, edges) {
  for (const [fromT, fromY, toT, toY] of edges) {
    for (const [t, y] of [[fromT, fromY], [toT, toY]]) {
      const [x, height, z] = faceOf(basis, t, y, inward);
      wallFacePoint.set(x, height, z);
      outlinePositions.push(wallFacePoint.x, wallFacePoint.y, wallFacePoint.z);
    }
  }
}

// A doorway wall is the same surface with a hole in it: two jambs and a lintel.
// Everything above and beside the opening stays closed, so the room reads as
// sealed apart from the two passages.
/**
 * The beam across the far end of the passage behind a doorway.
 *
 * It exists to carry the name of the chamber at that end — see world/signs.js —
 * and it is built with the chamber rather than with the passage because only
 * the chamber knows which end is far. A passage is drawn once and serves both
 * directions, so a beam at each of its ends put one in the mouth of every
 * doorway, hanging in the opening a walker was looking out of.
 */
function addFarBeam(room, index) {
  const basis = wallBasis(index);
  const height = DOOR_HEIGHT - HALL_OPENING_HEIGHT;
  const centre = HALL_START + HALL_LENGTH - HALL_TRANSOM_DEPTH / 2;
  addBox(
    room,
    wallMaterial,
    [2 * HALL_HALF_WIDTH, height, HALL_TRANSOM_DEPTH],
    pointOnWall(basis, 0, HALL_OPENING_HEIGHT + height / 2, APOTHEM - centre),
    basis.rotation,
    null,
    { outlined: false },
  );
  // Its lower arris, which is the head of the opening into that chamber.
  drawOnWall(room.userData.outlinePositions, basis, APOTHEM - centre + HALL_TRANSOM_DEPTH / 2, [
    [-HALL_HALF_WIDTH, HALL_OPENING_HEIGHT, HALL_HALF_WIDTH, HALL_OPENING_HEIGHT],
  ]);
}

/**
 * A wall with a hole in it.
 *
 * Built from three pieces — two jambs and the lintel — but drawn as one. Each
 * piece outlined on its own put a line up from either corner of the opening to
 * the ceiling, and those lines are seams in a thing that has none: the walls
 * here are monolithic and have stood for as long as the library has. Only what
 * is really an edge is drawn, which is the wall's own frame and the opening
 * cut in it.
 */
function addDoorWall(room, index) {
  const basis = wallBasis(index);
  const jambWidth = (WALL_WIDTH - DOOR_WIDTH) / 2;
  const jambOffset = (DOOR_WIDTH + jambWidth) / 2;
  const lintelHeight = WALL_HEIGHT - DOOR_HEIGHT;
  const plain = { outlined: false };
  for (const side of [-1, 1]) {
    addBox(
      room,
      wallMaterial,
      [jambWidth, WALL_HEIGHT, DOOR_WALL_THICKNESS],
      pointOnWall(basis, side * jambOffset, WALL_HEIGHT / 2),
      basis.rotation,
      null,
      plain,
    );
  }
  addBox(
    room,
    wallMaterial,
    [DOOR_WIDTH, lintelHeight, DOOR_WALL_THICKNESS],
    pointOnWall(basis, 0, DOOR_HEIGHT + lintelHeight / 2),
    basis.rotation,
    null,
    plain,
  );

  const half = WALL_WIDTH / 2;
  const opening = DOOR_WIDTH / 2;
  drawOnWall(room.userData.outlinePositions, basis, DOOR_WALL_THICKNESS / 2, [
    // the wall itself
    [-half, WALL_HEIGHT, half, WALL_HEIGHT],
    [-half, 0, -half, WALL_HEIGHT],
    [half, 0, half, WALL_HEIGHT],
    // and the opening cut in it
    [-opening, 0, -opening, DOOR_HEIGHT],
    [opening, 0, opening, DOOR_HEIGHT],
    [-opening, DOOR_HEIGHT, opening, DOOR_HEIGHT],
  ]);
}

const frameMatrix = new THREE.Matrix4();
const bookMatrix = new THREE.Matrix4();
const spineMatrix = new THREE.Matrix4();
const outlineCorner = new THREE.Vector3();

// The shelf reads because its front face is drawn as a band, not because it
// juts out: a deep overhang hides the volumes on the shelf below whenever the
// player looks up, and thickening it eats the headroom above the books.
export const SHELF_THICKNESS = 0.11;
export const SHELF_DEPTH = 0.5;
export const SHELF_CENTRE_Z = -0.18;
export const SHELF_FRONT_Z = SHELF_CENTRE_Z - SHELF_DEPTH / 2;
export const SHELF_SURFACE_OFFSET = SHELF_THICKNESS / 2;

// The carcase is drawn as one body: its parts share a material and carry no
// edges of their own, and only this silhouette is outlined. Shelves therefore
// read as recesses cut into a solid block rather than boards stacked together.
export const RAIL_THICKNESS = 0.12;
// Clear air above the topmost row, so the head rail closes the case instead of
// resting on the books.
const TOP_HEADROOM = 0.05;

// Measured from the shelves it has to contain rather than chosen: a fixed 3.5
// left the top row standing 35mm inside the head rail, which is what made that
// shelf look wrong. Deriving it means changing the pitch, the book height or
// the board can never quietly push the volumes through the top of the case
// again.
export const CARCASE_HEIGHT = SHELF_BASE_Y
  + (SHELVES_PER_WALL - 1) * SHELF_PITCH
  + SHELF_SURFACE_OFFSET
  + BOOK_HEIGHT
  + TOP_HEADROOM
  + RAIL_THICKNESS;
export const CARCASE_DEPTH = 0.56;
export const CARCASE_CENTRE_Y = CARCASE_HEIGHT / 2;
export const CARCASE_CENTRE_Z = -0.15;
export const CARCASE_FRONT_Z = CARCASE_CENTRE_Z - CARCASE_DEPTH / 2;
export const CARCASE_BACK_THICKNESS = 0.06;
export const CARCASE_BACK_Z = CARCASE_CENTRE_Z + CARCASE_DEPTH / 2 - CARCASE_BACK_THICKNESS / 2;

// Depth has to be drawn, because the scene is unlit and nothing casts a shadow.
// Treating the room as the only light source, tone falls away with distance
// into the carcase: the front edges stay near paper white, the backing board
// sits darkest. This is the hatching of an architectural section rather than a
// rendered shadow, which is why it follows one consistent direction.
const CARCASE_BACK_FACE_Z = CARCASE_CENTRE_Z + CARCASE_DEPTH / 2;
const NICHE_FRONT_TONE = 1;
const NICHE_BACK_TONE = 0.44;

export function nicheShade(local) {
  const depth = THREE.MathUtils.clamp(
    (local.z - CARCASE_FRONT_Z) / (CARCASE_BACK_FACE_Z - CARCASE_FRONT_Z),
    0,
    1,
  );
  return THREE.MathUtils.lerp(NICHE_FRONT_TONE, NICHE_BACK_TONE, depth ** 0.8);
}

// The underside of a shelf is the ceiling of the niche below it and never
// catches the room, so it takes the darkest tone in the cabinet.
export function shelfBoardShade(shelfY) {
  return local => (local.y < shelfY ? nicheShade(local) * 0.74 : nicheShade(local));
}

// Each cabinet carries its canonical wall number on the wall above it. With the
// chamber tag overhead and the shelf and volume countable by eye, a reader can
// now read a whole address off the room itself instead of having to open a book
// to find out where they are standing.
// The ceiling tag is a long string in a 4:1 plate; a single digit needs a
// squarer one or the rules dwarf it. The lettering is sized from the plate's
// height, so this is also what makes the numeral legible across the room.
const WALL_NUMBER_CELL_WIDTH = 256;
const WALL_NUMBER_CELL_HEIGHT = 128;
const WALL_NUMBER_WIDTH = 1.6;
const WALL_NUMBER_HEIGHT = WALL_NUMBER_WIDTH * WALL_NUMBER_CELL_HEIGHT / WALL_NUMBER_CELL_WIDTH;
const WALL_NUMBER_CLEARANCE = 0.42;
// The cabinet frame stands this far off the wall plane, so the wall's inner
// face lies here in cabinet space. The numeral is painted onto it rather than
// hung in the air in front of the case.
// The base runs solid from the floor to the underside of the lowest board.
export const PLINTH_HEIGHT = SHELF_BASE_Y - SHELF_THICKNESS / 2;
const CABINET_WALL_INSET = 0.28;
const WALL_FACE_Z = CABINET_WALL_INSET - WALL_THICKNESS / 2;

// The four numerals are the same in every chamber, so one texture serves the
// whole world and is never rebuilt or disposed with a room.
let sharedWallNumberMaterial = null;
export function wallNumberMaterial() {
  if (sharedWallNumberMaterial) return sharedWallNumberMaterial;
  const canvas = document.createElement('canvas');
  canvas.width = WALL_NUMBER_CELL_WIDTH * SHELVED_WALLS_PER_ROOM;
  canvas.height = WALL_NUMBER_CELL_HEIGHT;
  const context = canvas.getContext('2d');
  for (let wall = 0; wall < SHELVED_WALLS_PER_ROOM; wall++) {
    drawDraftedLabel(
      context,
      {
        x: wall * WALL_NUMBER_CELL_WIDTH,
        y: 0,
        width: WALL_NUMBER_CELL_WIDTH,
        height: WALL_NUMBER_CELL_HEIGHT,
      },
      String(wall + 1),
    );
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  sharedWallNumberMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return sharedWallNumberMaterial;
}

const wallNumberCorner = new THREE.Vector3();
export function addWallNumber(batch, canonicalWall, parentMatrix) {
  const cell = canonicalWall - 1;
  const u0 = cell / SHELVED_WALLS_PER_ROOM;
  const u1 = (cell + 1) / SHELVED_WALLS_PER_ROOM;
  const halfWidth = WALL_NUMBER_WIDTH / 2;
  const halfHeight = WALL_NUMBER_HEIGHT / 2;
  const centreY = CARCASE_HEIGHT + WALL_NUMBER_CLEARANCE + halfHeight;
  // Painted on the wall behind the case, a hair proud of it so the two
  // surfaces never fight for depth.
  const z = WALL_FACE_Z - 0.006;
  const base = batch.positions.length / 3;
  // The cabinet's local -Z faces the room, so the numeral is read from behind
  // and the horizontal mapping has to be reversed or it comes out mirrored.
  const corners = [
    [-halfWidth, centreY + halfHeight, u1, 1],
    [halfWidth, centreY + halfHeight, u0, 1],
    [-halfWidth, centreY - halfHeight, u1, 0],
    [halfWidth, centreY - halfHeight, u0, 0],
  ];
  for (const [x, y, u, v] of corners) {
    wallNumberCorner.set(x, y, z).applyMatrix4(parentMatrix);
    batch.positions.push(wallNumberCorner.x, wallNumberCorner.y, wallNumberCorner.z);
    batch.uvs.push(u, v);
    batch.colors.push(1, 1, 1);
  }
  batch.indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
}

const framePoint = new THREE.Vector3();
function pushLine(outlinePositions, parentMatrix, from, to) {
  for (const point of [from, to]) {
    framePoint.set(point[0], point[1], point[2]).applyMatrix4(parentMatrix);
    outlinePositions.push(framePoint.x, framePoint.y, framePoint.z);
  }
}

// Only the front of the carcase is drawn. Its back and depth edges sat behind
// the volumes where they read as stray lines rather than structure.
export function addCarcaseOutline(outlinePositions, parentMatrix) {
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
  // The head rail closes the top niche, so its lower arris is drawn exactly as
  // a shelf's front is. A shelf reads as a shelf because of that line: with
  // tone alone the rail shaded the top row but nothing appeared to stand above
  // it. It lies in the same plane as the shelf edges, so it lands on the same
  // front face. The base needs no such line — it runs solid into the lowest
  // board, whose own edge already marks where it ends.
  pushLine(
    outlinePositions,
    parentMatrix,
    [-halfWidth, top - RAIL_THICKNESS, CARCASE_FRONT_Z],
    [halfWidth, top - RAIL_THICKNESS, CARCASE_FRONT_Z],
  );
}

const shelfEdgePoint = new THREE.Vector3();
// Only the front face of a shelf is drawn, as two horizontal lines running the
// full width with no end caps. That reads as a ledge cut into the carcase and
// gives the volumes something to visibly stand on, without turning the shelf
// back into a separate box.
export function addShelfEdge(outlinePositions, parentMatrix, shelfY) {
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
function collectBookWall(room, index, q, r, level, disturbed) {
  const basis = wallBasis(index);
  // On another level the same canonical wall faces a different way, so the
  // number comes from the placement rather than from a fixed list.
  const canonicalWall = canonicalWallForWallIndex(level, index);
  const frameOffset = pointOnWall(basis, 0, 0, CABINET_WALL_INSET);
  frameMatrix.makeRotationY(basis.rotation).setPosition(frameOffset.x, frameOffset.y, frameOffset.z);
  const postOffset = (CABINET_WIDTH - CABINET_POST_WIDTH) / 2;
  const postHeight = CARCASE_HEIGHT - 2 * RAIL_THICKNESS;
  const carcase = { outlined: false, shade: nicheShade };
  // The base is one block up to the underside of the lowest board. A 120mm
  // plinth left an 85mm void beneath that board with the backing showing
  // through it, so the foot of the case read as three stacked pieces.
  addBox(room, shelfMaterial, [CABINET_WIDTH, PLINTH_HEIGHT, CARCASE_DEPTH], new THREE.Vector3(0, PLINTH_HEIGHT / 2, CARCASE_CENTRE_Z), 0, frameMatrix, carcase);
  // The head rail is the ceiling of the topmost niche, so it takes the same
  // underside tone a shelf board does. Without it the top row was the one shelf
  // in the case with nothing shading it from above.
  const headRailY = CARCASE_HEIGHT - RAIL_THICKNESS / 2;
  addBox(room, shelfMaterial, [CABINET_WIDTH, RAIL_THICKNESS, CARCASE_DEPTH], new THREE.Vector3(0, headRailY, CARCASE_CENTRE_Z), 0, frameMatrix,
    { outlined: false, shade: shelfBoardShade(headRailY) });
  for (const side of [-1, 1]) {
    addBox(room, shelfMaterial, [CABINET_POST_WIDTH, postHeight, CARCASE_DEPTH], new THREE.Vector3(side * postOffset, CARCASE_CENTRE_Y, CARCASE_CENTRE_Z), 0, frameMatrix, carcase);
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
    carcase,
  );
  addCarcaseOutline(room.userData.outlinePositions, frameMatrix);
  addWallNumber(room.userData.wallNumbers, canonicalWall, frameMatrix);

  const { batches, outlinePositions } = room.userData;
  for (let shelfIndex = 0; shelfIndex < SHELVES_PER_WALL; shelfIndex++) {
    const shelfY = SHELF_BASE_Y + shelfIndex * SHELF_PITCH;
    addBox(room, shelfMaterial, [CABINET_WIDTH, SHELF_THICKNESS, SHELF_DEPTH], new THREE.Vector3(0, shelfY, SHELF_CENTRE_Z), 0, frameMatrix,
      { outlined: false, shade: shelfBoardShade(shelfY) });
    addShelfEdge(outlinePositions, frameMatrix, shelfY);
    for (let volumeIndex = 0; volumeIndex < VOLUMES_PER_SHELF; volumeIndex++) {
      const worldLocation = {
        q,
        r,
        level,
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

      // Somebody read this one and put it back badly. It is the same volume it
      // always was — same address, same text, same title; only its standing has
      // been disturbed, which is the whole of what a trace is allowed to be.
      const outOfPlace = disturbed
        && disturbed.wall === canonicalWall - 1
        && disturbed.shelf === shelfIndex
        && disturbed.volume === volumeIndex;
      // Cabinet space has the room at -z — BOOK_FRONT_Z is the spine face and
      // it is negative — so standing a volume out means subtracting the reach.
      bookMatrix.makeRotationY(outOfPlace ? disturbed.lean : 0)
        .setPosition(x, y, bookCenterZ - (outOfPlace ? disturbed.reach : 0))
        .premultiply(frameMatrix);
      batch.matrices.push(bookMatrix.clone());
      batch.tints.push(manifesto ? MANIFESTO_TINT : bookTone(bookIndex));
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
    const mesh = mergedMesh(atlas, atlas.material);
    mesh.renderOrder = 3;
    room.add(mesh);
    atlas.positions = atlas.uvs = atlas.indices = null;
  }

  const { wallNumbers } = room.userData;
  if (wallNumbers.positions.length) {
    const mesh = mergedMesh(wallNumbers, wallNumberMaterial());
    mesh.renderOrder = 3;
    room.add(mesh);
  }

  room.userData.batches = null;
  room.userData.outlinePositions = null;
  room.userData.staticBatches = null;
  room.userData.wallNumbers = null;
}

/**
 * Paints as many of a room's queued spine labels as the budget allows.
 *
 * Returns true once the room has none left. The texture is uploaded only when
 * the last one is painted: each atlas is sixteen megabytes, and flagging it
 * per chunk would trade a little painting for a great deal of upload.
 */
export function paintPendingSpines(room, budgetMs) {
  const pending = room.userData.pendingSpines;
  if (!pending || pending.length === 0) return true;
  const deadline = performance.now() + budgetMs;
  let painted = 0;
  while (painted < pending.length && performance.now() < deadline) {
    const { atlas, column, row, label } = pending[painted++];
    paintSpineLabel(atlas.context, column, row, label);
  }
  pending.splice(0, painted);
  if (pending.length) return false;
  for (const atlas of room.userData.spineAtlases) atlas.material.map.needsUpdate = true;
  return true;
}

// Somebody stood here and counted, exactly as the walker's register counts.
// Scratched, not drafted: every other marking in this world is in the
// architect's hand, and these are the only ones that are not.
const TALLY_HEIGHT = 1.34;
const TALLY_STROKE = 0.015;
const TALLY_LENGTH = 0.15;
const TALLY_GAP = 0.036;
// A tally is always beside a doorway, and a doorway wall is built deep, so its
// visible face is half that thickness in from the wall plane — scratching at
// the plane itself would bury the marks inside the jamb.
const TALLY_FACE = DOOR_WALL_THICKNESS / 2 + 0.004;
function addTally(room, tally) {
  const basis = wallBasis(tally.wall);
  const shade = () => 0.16;
  const strokes = tally.count;
  const groups = Math.ceil(strokes / 5);
  const start = tally.side * (DOOR_HALF_WIDTH + 0.34);
  for (let stroke = 0; stroke < strokes; stroke++) {
    const group = Math.floor(stroke / 5);
    const within = stroke % 5;
    const offset = tally.side * (group * (5 * TALLY_GAP + 0.05) + within * TALLY_GAP);
    addBox(room, trimMaterial, [TALLY_STROKE, TALLY_LENGTH, 0.006],
      pointOnWall(basis, start + offset, TALLY_HEIGHT, TALLY_FACE), basis.rotation, null,
      { outlined: false, shade });
  }
  // A stroke across each closed group of five, the way anybody tallies.
  for (let group = 0; group < groups; group++) {
    if ((group + 1) * 5 > strokes) continue;
    const centre = tally.side * (group * (5 * TALLY_GAP + 0.05) + 2 * TALLY_GAP);
    addBox(room, trimMaterial, [5.6 * TALLY_GAP, TALLY_STROKE, 0.006],
      pointOnWall(basis, start + centre, TALLY_HEIGHT, TALLY_FACE + 0.002), basis.rotation, null,
      { outlined: false, shade });
  }
}

export function makeRoom(q, r, level, roomTag) {
  const room = new THREE.Group();
  room.userData = {
    q,
    r,
    level,
    bookMeshes: [],
    spineAtlases: [],
    pendingSpines: [],
    disposableMaterials: [],
    outlinePositions: [],
    wallNumbers: { positions: [], uvs: [], indices: [], colors: [] },
    staticBatches: new Map(),
    batches: bookMaterials.map(material => ({ material, matrices: [], tints: [], records: [] })),
  };

  // Six-sided, and no larger than the room. As squares of 32 they reached
  // sixteen units out — past the mouth of both passages — and quietly floored
  // over the stair wells, so a shaft meant to fall away for storeys ended a
  // centimetre below its lip. A bounding square is not enough either: the
  // corridor leaves through a corner of one, which is exactly where a square
  // overhangs the hexagon it stands for.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ROOM_RADIUS, 6), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  room.add(floor);
  const ceiling = new THREE.Mesh(new THREE.CircleGeometry(ROOM_RADIUS, 6), ceilingMaterial);
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

  // What this chamber carries of the people who were here before. Derived from
  // its own index, so a trace is as real as its books: always there, findable
  // again, and nameable by an exact address.
  const traces = tracesFor(worldRoomIndexFor(q, r, level), level);

  const doorWalls = freeWallsForLevel(level);
  const shelvedWalls = bookWallsForLevel(level);
  for (let index = 0; index < 6; index++) {
    if (doorWalls.includes(index)) {
      addDoorWall(room, index);
      addFarBeam(room, index);
    } else {
      addSolidWall(room, index);
    }
    if (shelvedWalls.includes(index)) collectBookWall(room, index, q, r, level, traces.disturbed);
  }
  if (traces.tally) addTally(room, traces.tally);
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
