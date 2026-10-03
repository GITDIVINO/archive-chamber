/**
 * Builds one hexagonal chamber.
 *
 * A room holds 11520 volumes, 3840 of them on the floor. Giving each floor
 * volume a mesh, an outline and a spine quad cost roughly 1200 draw calls per
 * frame; instead the volumes become
 * three InstancedMeshes, their outlines one LineSegments, and their labels one
 * merged mesh per spine atlas.  A full room now costs under twenty calls.
 */

import * as THREE from 'three';
import { SHELVES_PER_WALL, VOLUMES_PER_SHELF, titleForBookIndex } from '../../babel-v3.js';
import { tracesFor } from './traces.js';
import {
  bookWallsForLevel,
  canonicalWallForWallIndex,
  catalogBookIndexFor,
  catalogBookIndexForWorldSlotIndex,
  freeWallsForLevel,
  WORLD_VOLUMES_PER_SHELF,
  worldRoomIndexFor,
  worldSlotIndexFor,
} from '../../world-engine.js';
import {
  BOOK_LETTER_COLOR,
  BOOK_DEPTH,
  BOOK_FRONT_Z,
  BOOK_HEIGHT,
  BOOK_WIDTH,
  CABINET_SECTIONS_PER_WALL,
  CABINET_RUN_WIDTH,
  CABINET_POST_WIDTH,
  DOOR_HALF_WIDTH,
  HALL_OPENING_HEIGHT,
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
  WALL_LAMP_HEIGHT,
  LAMP_INTENSITY,
  LAMP_LIGHT_COLOR,
  LAMP_RANGE,
  SCONCE_INTENSITY,
  SCONCE_RANGE,
  WELL_RADIUS,
  WELL_SLAB_THICKNESS,
  DOOR_WALL_OFFSET,
  DOOR_WALL_THICKNESS,
  WALL_THICKNESS,
  WALL_WIDTH,
} from '../constants.js';
import { renderer } from '../core/view.js';
import {
  bookMaterials,
  galleryBookMaterial,
  brassMaterial,
  ceilingMaterial,
  floorMaterial,
  lampMaterial,
  lampHaloMaterial,
  metalMaterial,
  outlineMaterial,
  roomLineMaterial,
  shelfMaterial,
  trimMaterial,
  wallMaterial,
} from '../core/materials.js';
import {
  appendMergedEdges,
  appendMergedGeometry,
  boxGeometryFor,
  drawDraftedLabel,
  hexCorners,
  mergedMesh,
  mitredSlabFor,
  pointOnWall,
  sharedGeometries,
  wallBasis,
} from './geometry.js';
import {
  WELL_BALUSTERS,
  WELL_BALUSTRADE_PARTS,
  WELL_BRIDGE_PARTS,
  WELL_LANTERN_POSITIONS,
  WELL_STAIR_LANTERNS,
  WELL_LIP_PARTS,
  WELL_STAIR_PARTS,
} from './well.js';
import { WELL_PIER_PARTS, doorColumnLanternPoints, doorColumnParts } from './columns.js';
import { GALLERY_LEVELS, galleryBalustrade, galleryParts } from './galleries.js';
import { LANTERN_GLOBE_SIZE, balusterGeometry, instancedBalusters, stoneShade } from './balustrade.js';

// Split up its height so the spine can carry a three-stop tone: a box corner
// only has vertices at top and bottom, which is not enough to darken a volume
// where it meets the board and again where the shelf overhangs it.
export const bookGeometry = new THREE.BoxGeometry(BOOK_WIDTH, BOOK_HEIGHT, BOOK_DEPTH, 1, 2, 1);
sharedGeometries.add(bookGeometry);
const lampGeometry = new THREE.SphereGeometry(0.17, 14, 10);
sharedGeometries.add(lampGeometry);
sharedGeometries.add(balusterGeometry);

// The catalogue still addresses six logical groups, but the furniture does not
// reveal them. All 192 volumes in a row share one even physical rhythm across
// the cabinet, with only a little breathing room inside the two end posts.
const VOLUMES_PER_WALL_SHELF = CABINET_SECTIONS_PER_WALL * VOLUMES_PER_SHELF;
const CABINET_BOOK_END_GAP = 0.12;
export const CABINET_BOOK_STEP = (
  CABINET_RUN_WIDTH - 2 * (CABINET_POST_WIDTH + CABINET_BOOK_END_GAP) - BOOK_WIDTH
) / (VOLUMES_PER_WALL_SHELF - 1);
export const CABINET_SECTION_PITCH = CABINET_BOOK_STEP * VOLUMES_PER_SHELF;
export const CABINET_UPRIGHTS_PER_WALL = 2;

// A wall of identical volumes read as a printed pattern. Real shelves hold sets
// bound alike and stood together, with a stray odd volume between them, so
// volumes come in runs of five sharing a binding and a height, and one in four
// breaks ranks. It is worked out from where the volume stands in its chamber
// and nothing else, so a doorway view of a neighbour and that neighbour once
// entered agree, and every storey of the shaft matches the walker's own.
const VOLUMES_PER_SET = 5;
const BINDING_TINTS = Object.freeze([
  [1, 1, 1],
  [1, 1, 1],
  [1.4, 0.62, 0.55],
  [1.4, 0.62, 0.55],
  [0.62, 1.02, 0.7],
  [0.62, 0.78, 1.3],
  [1.55, 1.32, 0.98],
  [0.5, 0.45, 0.42],
]);
const MIN_VOLUME_HEIGHT = 0.86;

function unitHash(a, b, c, salt) {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b) ^ Math.imul(c + 13, 0xc2b2ae35) ^ salt;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function volumeVariation(wallIndex, shelfIndex, volumeIndex) {
  const set = Math.floor(volumeIndex / VOLUMES_PER_SET);
  const odd = unitHash(wallIndex, shelfIndex, volumeIndex, 0x51) < 0.25;
  const bindingKey = odd ? volumeIndex + 4096 : set;
  const binding = BINDING_TINTS[Math.floor(unitHash(wallIndex, shelfIndex, bindingKey, 0x2b) * BINDING_TINTS.length)];
  const shade = 0.88 + 0.2 * unitHash(wallIndex, shelfIndex, volumeIndex, 0x77);
  const setHeight = MIN_VOLUME_HEIGHT + (1 - MIN_VOLUME_HEIGHT) * unitHash(wallIndex, shelfIndex, bindingKey, 0x3d);
  const height = Math.min(1, setHeight + 0.03 * unitHash(wallIndex, shelfIndex, volumeIndex, 0x19));
  return { height, tint: binding.map(channel => channel * shade) };
}

const volumeScale = new THREE.Vector3();
// A volume stands on its board, so a shorter one is lowered, not shrunk about
// its middle. The same placement serves the book and its lettered spine.
export function placeVolume(target, x, shelfY, z, height, turn = 0) {
  const y = shelfY + SHELF_SURFACE_OFFSET + BOOK_HEIGHT * height / 2;
  return target.makeRotationY(turn).scale(volumeScale.set(1, height, 1)).setPosition(x, y, z);
}

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

// The spine (-z) and top (+y) faces of bookGeometry, with its own normals,
// texture coordinates and three-stop tone, so a volume seen only from the
// front — down the shaft, or on a gallery tier — is shaded exactly as a near
// one wherever a near one could be seen, at a quarter of the vertices. Its
// sides face their neighbours across a three-centimetre gap.
// Cut only after the faces are toned: cut before, it had no colour attribute,
// a vertex-coloured material reads a missing one as black, and every volume
// drawn with it was a black slat.
const BOX_FACE_POSITIVE_Y = 2;
const BOX_FACE_NEGATIVE_Z = 5;
export const shelfFaceBookGeometry = (() => {
  const geometry = new THREE.BufferGeometry();
  const index = bookGeometry.getIndex();
  const attributes = Object.entries(bookGeometry.attributes);
  const values = Object.fromEntries(attributes.map(([name]) => [name, []]));
  const indices = [];
  const remap = new Map();
  for (const face of [BOX_FACE_POSITIVE_Y, BOX_FACE_NEGATIVE_Z]) {
    const group = bookGeometry.groups[face];
    for (let element = group.start; element < group.start + group.count; element++) {
      const vertex = index.getX(element);
      if (!remap.has(vertex)) {
        remap.set(vertex, remap.size);
        for (const [name, attribute] of attributes) {
          for (let component = 0; component < attribute.itemSize; component++) {
            values[name].push(attribute.array[vertex * attribute.itemSize + component]);
          }
        }
      }
      indices.push(remap.get(vertex));
    }
  }
  for (const [name, attribute] of attributes) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values[name], attribute.itemSize));
  }
  geometry.setIndex(indices);
  return geometry;
})();
sharedGeometries.add(shelfFaceBookGeometry);

export function shortSpineTitle(title) {
  const value = title.replace(/\s+/g, ' ').trim().slice(0, 9);
  return value || 'untitled';
}

function spineTitleFor(bookIndex) {
  return shortSpineTitle(titleForBookIndex(bookIndex));
}

// A spine is lettered with its shelfmark, wall, shelf and volume as the
// catalogue addresses them ("3·2" and "112"), on the floor and on the
// galleries alike. A title is a division of a very large number, and 11520 of
// them a chamber would cost more than building the chamber; a shelfmark costs
// nothing and is the same in every chamber. The title is what opening the
// volume shows.
const volumeMark = volume => String(volume).padStart(3, '0');
const shelfMark = (wall, shelf) => `${wall}\u00b7${shelf}`;
const shelfmark = ({ wall, shelf, volume }) => ({ lower: shelfMark(wall, shelf), upper: volumeMark(volume) });

// A volume's title is a dozen divisions of a very large number, and a room has
// 3840 volumes: working them all out was a sixth of building a room, for
// titles nobody reads until they pick the book up or its spine is lettered.
// So a record works its title out the first time it is asked for, and keeps it.
function bookRecord(bookIndex, worldLocation) {
  return {
    bookIndex,
    worldLocation,
    get volumeTitle() {
      const value = spineTitleFor(this.bookIndex);
      Object.defineProperty(this, 'volumeTitle', { value, enumerable: true });
      return value;
    },
  };
}

function createSpineAtlas(room) {
  const canvas = document.createElement('canvas');
  canvas.width = SPINE_ATLAS_SIZE;
  canvas.height = SPINE_ATLAS_SIZE;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  // A label is one flat quad, so its two faces never cover each other and the
  // back-then-front second pass three.js gives transparent double-sided
  // materials would only double the draw calls.
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true });
  const atlas = { context, material, next: 0, positions: [], uvs: [], indices: [] };
  room.userData.spineAtlases.push(atlas);
  room.userData.disposableMaterials.push(material);
  return atlas;
}

// A spine is dressed like a bound volume rather than stamped edge to edge: two
// pairs of gilt bands mark the raised cords at head and tail, and the title
// sits on a dark lettering piece between them with air all round. Lettered
// across the whole cell, a nine-character title ran into both ends of the
// spine and read as text overflowing the book.
const SPINE_BAND_INSET = 6;
const SPINE_LABEL_INSET = 17;
const SPINE_TITLE_FONT = 12;
function paintSpineLabel(context, column, row, { lower = '', upper = '' }, plateAlpha = 0.5) {
  const x = column * SPINE_CELL_WIDTH;
  const y = row * SPINE_CELL_HEIGHT;
  const left = x + 2;
  const width = SPINE_CELL_WIDTH - 4;
  context.save();
  context.beginPath();
  context.rect(x + 1, y + 1, SPINE_CELL_WIDTH - 2, SPINE_CELL_HEIGHT - 2);
  context.clip();

  context.fillStyle = BOOK_LETTER_COLOR;
  context.globalAlpha = 0.5;
  for (const edge of [y + SPINE_BAND_INSET, y + SPINE_CELL_HEIGHT - SPINE_BAND_INSET - 2]) {
    context.fillRect(left, edge, width, 2);
  }
  context.globalAlpha = 0.32;
  for (const edge of [y + SPINE_BAND_INSET + 4, y + SPINE_CELL_HEIGHT - SPINE_BAND_INSET - 5]) {
    context.fillRect(left, edge, width, 1);
  }

  const labelTop = y + SPINE_LABEL_INSET;
  const labelHeight = SPINE_CELL_HEIGHT - 2 * SPINE_LABEL_INSET;
  context.globalAlpha = plateAlpha;
  context.fillStyle = '#1a0f0a';
  context.fillRect(x + 3, labelTop, SPINE_CELL_WIDTH - 6, labelHeight);
  context.globalAlpha = 0.42;
  context.strokeStyle = BOOK_LETTER_COLOR;
  context.lineWidth = 1;
  context.strokeRect(x + 3.5, labelTop + 0.5, SPINE_CELL_WIDTH - 7, labelHeight - 1);

  // The address is lettered in two groups along the plate, wall and shelf
  // first, the volume after: the spine reads from its foot up. A group is
  // fitted to its half of the plate and condensed rather than allowed to run
  // past it.
  context.globalAlpha = 0.98;
  context.fillStyle = BOOK_LETTER_COLOR;
  context.font = `700 ${SPINE_TITLE_FONT}px "Courier New", monospace`;
  context.shadowColor = 'rgba(0, 0, 0, .72)';
  context.shadowBlur = 1;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const groups = [[lower, 0.75], [upper, 0.25]];
  for (const [text, at] of groups) {
    if (!text) continue;
    context.save();
    context.translate(x + SPINE_CELL_WIDTH / 2, labelTop + labelHeight * at);
    context.rotate(-Math.PI / 2);
    const room = labelHeight / 2 - 4;
    const measured = context.measureText(text).width;
    if (measured > room) context.scale(room / measured, 1);
    context.fillText(text, 0, 0.5);
    context.restore();
  }
  context.restore();
}

const spineCorner = new THREE.Vector3();
// Spine quads are baked into room space and merged per atlas, so a whole room
// of 3840 labels costs one draw call per atlas instead of one per volume.
function appendSpine(room, label, matrix) {
  let atlas = room.userData.spineAtlases.at(-1);
  if (!atlas || atlas.next === SPINES_PER_ATLAS) atlas = createSpineAtlas(room);
  const cell = atlas.next++;
  const column = cell % SPINE_ATLAS_COLUMNS;
  const row = Math.floor(cell / SPINE_ATLAS_COLUMNS);
  // Queued rather than painted. Six hundred and forty rotated labels across
  // three former 2048 canvases measured 7.6 ms of the 14 that building a room
  // cost. The current 1024 atlases keep the capacity at one quarter of the
  // upload size, and none of it belongs in the threshold frame:
  // they arrive at the far doorway, where a spine is a smudge anyway.
  // The title itself is worked out when the label is painted: see bookRecord.
  room.userData.pendingSpines.push({ atlas, column, row, label });
  const inset = 1;
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
    batch = { material, positions: [], normals: [], uvs: [], indices: [], colors: [] };
    room.userData.staticBatches.set(material, batch);
  }
  return batch;
}

const staticLocalMatrix = new THREE.Matrix4();
const staticBoxMatrix = new THREE.Matrix4();
const staticTiltMatrix = new THREE.Matrix4();
function addBox(room, material, size, position, rotation = 0, parentMatrix = null, options = {}) {
  const { outlined = true, rotationZ = 0, shade = null } = options;
  const entry = boxGeometryFor(size[0], size[1], size[2]);
  staticLocalMatrix.makeRotationY(rotation);
  if (rotationZ) staticLocalMatrix.multiply(staticTiltMatrix.makeRotationZ(rotationZ));
  staticLocalMatrix.setPosition(position.x, position.y, position.z);
  staticBoxMatrix.copy(staticLocalMatrix);
  if (parentMatrix) staticBoxMatrix.premultiply(parentMatrix);
  // The shade callback sees the vertex in cabinet space, before the wall
  // transform, so depth into the niche is simply its z.
  appendMergedGeometry(staticBatchFor(room, material), entry.geometry, staticBoxMatrix, shade, staticLocalMatrix);
  if (outlined) appendMergedEdges(room.userData.outlinePositions, entry.edges, staticBoxMatrix);
}

// The stone balustrade's plinths, rails, pillars and lantern fittings (see
// balustrade.js), merged into the batches the room already draws: the stone is
// the walls' own material, toned down through vertex colour, so it costs no
// draw call of its own. The lantern globes on the pillars are round here.
const BALUSTRADE_MATERIALS = { stone: wallMaterial, metal: metalMaterial };
const BALUSTRADE_GLOBE_SCALE = LANTERN_GLOBE_SIZE / 2 / 0.17;
function addBalustradeParts(room, parts) {
  for (const part of parts) {
    if (part.distantOnly) continue;
    if (part.kind === 'lamp') {
      staticLocalMatrix.makeScale(BALUSTRADE_GLOBE_SCALE, BALUSTRADE_GLOBE_SCALE, BALUSTRADE_GLOBE_SCALE)
        .setPosition(part.position.x, part.position.y, part.position.z);
      appendMergedGeometry(staticBatchFor(room, lampMaterial), lampGeometry, staticLocalMatrix);
      continue;
    }
    addBox(room, BALUSTRADE_MATERIALS[part.kind], part.size, part.position, part.rotation, null, {
      outlined: false,
      shade: part.kind === 'stone' ? stoneShade(part.tone, part.floor) : null,
    });
  }
}

// Toned a little below the walls, so the floor stays the darkest plane in the
// room rather than a lit sheet under the walker's feet.
const SHELL_RING_TONE = 0.75;
function litRing() {
  const ring = new THREE.RingGeometry(WELL_RADIUS, ROOM_RADIUS, 6);
  const count = ring.getAttribute('position').count;
  ring.setAttribute('color', new THREE.Float32BufferAttribute(new Array(count * 3).fill(SHELL_RING_TONE), 3));
  return ring;
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
// The reveals of a doorway are the full depth of a door wall, and bare they
// were two great flat planes of plaster lit square-on by the passage lamp. They
// are lined in the cabinets' timber instead: a thin board over each reveal and
// the soffit, framed by stiles at either arris and broken by three rails, and
// toned down so the opening reads as a deep, dark frame around the well rather
// than as two lit walls. It is the same material as the cabinets, so it joins a
// batch the room already draws. The vista builds exactly the same parts.
const REVEAL_LINING = 0.025;
const REVEAL_TONE = 0.55;
export const revealShade = () => REVEAL_TONE;
export function doorRevealParts(basis, detailed = true) {
  const seat = -DOOR_WALL_OFFSET;
  const face = DOOR_WIDTH / 2 - REVEAL_LINING / 2;
  const parts = [];
  const part = (size, tangent, height, inward = seat) => parts.push({
    size, position: pointOnWall(basis, tangent, height, inward), rotation: basis.rotation,
  });
  for (const side of [-1, 1]) {
    part([REVEAL_LINING, HALL_OPENING_HEIGHT, DOOR_WALL_THICKNESS], side * face, HALL_OPENING_HEIGHT / 2);
    if (!detailed) continue;
    const proud = side * (face - REVEAL_LINING);
    for (const edge of [-1, 1]) {
      part([REVEAL_LINING, HALL_OPENING_HEIGHT, 0.14], proud, HALL_OPENING_HEIGHT / 2,
        seat + edge * (DOOR_WALL_THICKNESS / 2 - 0.07));
    }
    for (const height of [0.12, HALL_OPENING_HEIGHT * 0.45, HALL_OPENING_HEIGHT - 0.12]) {
      part([REVEAL_LINING, 0.1, DOOR_WALL_THICKNESS - 0.28], proud, height);
    }
  }
  part([DOOR_WIDTH, REVEAL_LINING, DOOR_WALL_THICKNESS], 0, HALL_OPENING_HEIGHT - REVEAL_LINING / 2);
  return parts;
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
  // A doorway is cut to the same height as every other opening in the passage
  // behind it, so that the wall above it is what a walker in the corridor sees
  // as the band across either end. Cut to the full height of the passage there
  // was no band, and a beam hung in to make one stood in the opening whenever
  // it was looked at from the chamber side.
  const lintelHeight = WALL_HEIGHT - HALL_OPENING_HEIGHT;
  const plain = { outlined: false };
  // Built outward from the room's own wall line rather than centred on it, so
  // that its inner face is the same face every other wall presents and the
  // corner it shares with the cabinet beside it closes flush. See
  // DOOR_WALL_OFFSET in constants.js.
  const seat = -DOOR_WALL_OFFSET;
  for (const side of [-1, 1]) {
    addBox(
      room,
      wallMaterial,
      [jambWidth, WALL_HEIGHT, DOOR_WALL_THICKNESS],
      pointOnWall(basis, side * jambOffset, WALL_HEIGHT / 2, seat),
      basis.rotation,
      null,
      plain,
    );
  }
  addBox(
    room,
    wallMaterial,
    [DOOR_WIDTH, lintelHeight, DOOR_WALL_THICKNESS],
    pointOnWall(basis, 0, HALL_OPENING_HEIGHT + lintelHeight / 2, seat),
    basis.rotation,
    null,
    plain,
  );
  for (const { size, position, rotation } of doorRevealParts(basis)) {
    addBox(room, shelfMaterial, size, position, rotation, null, { outlined: false, shade: revealShade });
  }

  const half = WALL_WIDTH / 2;
  const opening = DOOR_WIDTH / 2;
  // The face this wall shows the room is now the plain walls' own face.
  drawOnWall(room.userData.outlinePositions, basis, WALL_THICKNESS / 2, [
    // the wall itself
    [-half, WALL_HEIGHT, half, WALL_HEIGHT],
    [-half, 0, -half, WALL_HEIGHT],
    [half, 0, half, WALL_HEIGHT],
    // and the opening cut in it
    [-opening, 0, -opening, HALL_OPENING_HEIGHT],
    [opening, 0, opening, HALL_OPENING_HEIGHT],
    [-opening, HALL_OPENING_HEIGHT, opening, HALL_OPENING_HEIGHT],
  ]);
}

const frameMatrix = new THREE.Matrix4();
const wallLabelMatrix = new THREE.Matrix4();
const bookMatrix = new THREE.Matrix4();
const spineMatrix = new THREE.Matrix4();

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

// Moulding is physical geometry, never an outline. These bands fill the dead
// strip above the human-reachable cabinet and catch the lanterns one profile at
// a time, adding the layered density of an old library without inventing more
// addressable shelves beyond a reader's reach.
export const WALL_CORNICE_BANDS = Object.freeze([
  { y: CARCASE_HEIGHT + 0.18, height: 0.12, depth: 0.22, inset: 0.2 },
  { y: WALL_HEIGHT - 0.56, height: 0.16, depth: 0.28, inset: 0.14 },
  { y: WALL_HEIGHT - 0.23, height: 0.09, depth: 0.18, inset: 0.1 },
]);
export const WALL_PILASTER_WIDTH = 0.18;

// Where a cornice band runs along a wall, as [tangent, width] pairs. On a
// doorway wall a band below the head of the opening stops either side of it
// rather than crossing it: the doorway is cut nearly to the storey above now,
// and a moulding run straight across would be a bar across the way through.
const CORNICE_RUN = WALL_WIDTH - 0.58;
const CORNICE_GAP_HALF = DOOR_WIDTH / 2 + 0.3;
export function corniceRuns(band, doorway) {
  if (!doorway || band.y - band.height / 2 > HALL_OPENING_HEIGHT) return [[0, CORNICE_RUN]];
  const width = CORNICE_RUN / 2 - CORNICE_GAP_HALF;
  const centre = CORNICE_GAP_HALF + width / 2;
  return [[-centre, width], [centre, width]];
}

function addWallJoinery(room, index, doorway = false) {
  const basis = wallBasis(index);
  for (const band of WALL_CORNICE_BANDS) {
    for (const [tangent, width] of corniceRuns(band, doorway)) {
      addBox(
        room,
        shelfMaterial,
        [width, band.height, band.depth],
        pointOnWall(basis, tangent, band.y, band.inset),
        basis.rotation,
        null,
        { outlined: false },
      );
    }
  }
  const tangent = WALL_WIDTH / 2 - WALL_PILASTER_WIDTH / 2 - 0.12;
  for (const side of [-1, 1]) {
    addBox(
      room,
      shelfMaterial,
      [WALL_PILASTER_WIDTH, WALL_HEIGHT - 0.3, 0.2],
      pointOnWall(basis, side * tangent, (WALL_HEIGHT - 0.3) / 2, 0.16),
      basis.rotation,
      null,
      { outlined: false },
    );
  }
}

// Real light supplies the broad form and the shelf frame casts a stable shadow.
// A shallow authored contact tone still falls into the carcase: without it the
// five recesses merge whenever a shelf faces away from the two doorway lamps.
// This is subtle material occlusion, not a camera-dependent lighting trick.
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
// The cabinet sits wholly inside the chamber, proud of the wall behind it.
// Keeping a real wall and a separate built-in case makes the six-sided shell
// explicit and prevents either object from masquerading as the other.
export const CABINET_WALL_INSET = 0.28;
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
    // Flat numerals: see the spine labels above.
    forceSinglePass: true,
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
export function addCarcaseOutline(outlinePositions, parentMatrix, width = CABINET_RUN_WIDTH) {
  const halfWidth = width / 2;
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
export function addShelfEdge(outlinePositions, parentMatrix, shelfY, width = CABINET_RUN_WIDTH) {
  const halfWidth = width / 2;
  for (const y of [shelfY + SHELF_SURFACE_OFFSET, shelfY - SHELF_SURFACE_OFFSET]) {
    for (const x of [-halfWidth, halfWidth]) {
      shelfEdgePoint.set(x, y, SHELF_FRONT_Z).applyMatrix4(parentMatrix);
      outlinePositions.push(shelfEdgePoint.x, shelfEdgePoint.y, shelfEdgePoint.z);
    }
  }
}

// The joinery that makes the case a piece of furniture rather than a box: a
// stepped cornice over the head rail, a moulded base, a lipped front on each
// board and a fluted pilaster over either end post. It is all the same timber
// as the carcase, so it merges into the batch the case already draws and costs
// no extra draw call. Every piece stands proud of the carcase front, so none of
// it reaches into the niches or across a spine.
const CORNICE_PROFILE = Object.freeze([
  // [height, depth, projection past the carcase front, extra run, centre above the case top]
  [0.05, 0.08, 0.03, 0.06, -0.03],
  [0.07, 0.16, 0.08, 0.16, 0.035],
  [0.03, 0.2, 0.11, 0.22, 0.085],
]);
const BASE_PROFILE = Object.freeze([
  [0.08, 0.12, 0.05, 0.08, 0.04],
  [0.035, 0.06, 0.025, 0.04, PLINTH_HEIGHT - 0.03],
]);
const SHELF_LIP_DEPTH = 0.03;
const SHELF_LIP_PROUD = 0.015;
const PILASTER_WIDTH = 0.2;
const PILASTER_DEPTH = 0.04;
const PILASTER_FLUTES = 3;

// A row of dentils under the cornice, a bead under every shelf lip and a brass
// label holder on each section of each shelf. Real library cases carry exactly
// these, and they break the long plain boards into something the eye can walk
// along. Brass and timber both already have a batch here, so none of it adds a
// draw call.
const DENTIL_WIDTH = 0.08;
const DENTIL_PITCH = 0.3;
const DENTIL_HEIGHT = 0.045;
const SHELF_BEAD_HEIGHT = 0.02;
const LABEL_HOLDER_SIZE = [0.13, 0.065, 0.012];
const LABEL_CARD_SIZE = [0.1, 0.04, 0.012];

function addProud(room, size, x, y, proud, shade, material = shelfMaterial) {
  const z = CARCASE_FRONT_Z - proud + size[2] / 2;
  addBox(room, material, size, new THREE.Vector3(x, y, z), 0, frameMatrix, { outlined: false, shade });
}

function addCabinetCarving(room, { labels = true, dentils = true } = {}) {
  for (const [height, depth, proud, extra, y] of CORNICE_PROFILE) {
    const centreY = CARCASE_HEIGHT + y;
    addProud(room, [CABINET_RUN_WIDTH + extra, height, depth], 0, centreY, proud, shelfBoardShade(centreY));
  }
  for (const [height, depth, proud, extra, y] of BASE_PROFILE) {
    addProud(room, [CABINET_RUN_WIDTH + extra, height, depth], 0, y, proud, shelfBoardShade(y));
  }

  const innerRun = CABINET_RUN_WIDTH - 2 * CABINET_POST_WIDTH;
  const lipHeight = SHELF_THICKNESS + 0.03;
  for (let shelfIndex = 0; shelfIndex < SHELVES_PER_WALL; shelfIndex++) {
    const shelfY = SHELF_BASE_Y + shelfIndex * SHELF_PITCH;
    addProud(room, [innerRun, lipHeight, SHELF_LIP_DEPTH], 0, shelfY, SHELF_LIP_PROUD,
      shelfBoardShade(shelfY));
    const beadY = shelfY - lipHeight / 2 - SHELF_BEAD_HEIGHT / 2;
    addProud(room, [innerRun, SHELF_BEAD_HEIGHT, 0.02], 0, beadY, SHELF_LIP_PROUD + 0.008, shelfBoardShade(shelfY));
    for (let section = 0; labels && section < CABINET_SECTIONS_PER_WALL; section++) {
      const x = (section - (CABINET_SECTIONS_PER_WALL - 1) / 2) * CABINET_SECTION_PITCH;
      addProud(room, LABEL_HOLDER_SIZE, x, shelfY, SHELF_LIP_PROUD + 0.012, null, brassMaterial);
      addProud(room, LABEL_CARD_SIZE, x, shelfY - 0.004, SHELF_LIP_PROUD + 0.016, () => 0.45);
    }
  }

  const dentilY = CARCASE_HEIGHT - 0.055 - DENTIL_HEIGHT / 2;
  const dentilCount = dentils ? Math.floor((innerRun - DENTIL_WIDTH) / DENTIL_PITCH) : -1;
  const firstDentil = -(dentilCount * DENTIL_PITCH) / 2;
  for (let dentil = 0; dentil <= dentilCount; dentil++) {
    addProud(room, [DENTIL_WIDTH, DENTIL_HEIGHT, 0.03], firstDentil + dentil * DENTIL_PITCH, dentilY, 0.03,
      shelfBoardShade(dentilY));
  }

  const bottom = PLINTH_HEIGHT + 0.02;
  const top = CARCASE_HEIGHT - 0.07;
  const shaftHeight = top - bottom;
  const shaftY = (top + bottom) / 2;
  const outerPost = (CABINET_RUN_WIDTH - CABINET_POST_WIDTH) / 2;
  for (const side of [-1, 1]) {
    const x = side * outerPost;
    addProud(room, [PILASTER_WIDTH, shaftHeight, PILASTER_DEPTH], x, shaftY, 0.03, nicheShade);
    // Raised reeds with dark hollows between them read as flutes by lantern light.
    const pitch = PILASTER_WIDTH / (PILASTER_FLUTES + 1);
    for (let flute = 1; flute <= PILASTER_FLUTES; flute++) {
      addProud(room, [0.028, shaftHeight - 0.36, 0.02], x - PILASTER_WIDTH / 2 + flute * pitch, shaftY, 0.045,
        nicheShade);
    }
    addProud(room, [PILASTER_WIDTH + 0.06, 0.09, 0.07], x, top - 0.02, 0.055, shelfBoardShade(top - 0.02));
    addProud(room, [PILASTER_WIDTH + 0.04, 0.12, 0.06], x, bottom + 0.06, 0.05, shelfBoardShade(bottom));
  }
}

// The carcase of one run of cases along a wall, its foot at `frame`'s origin.
function addCaseRun(room, frame) {
  const postHeight = CARCASE_HEIGHT - 2 * RAIL_THICKNESS;
  const carcase = { outlined: false, shade: nicheShade };
  const { outlinePositions } = room.userData;
  frameMatrix.copy(frame);
  addBox(room, shelfMaterial, [CABINET_RUN_WIDTH, PLINTH_HEIGHT, CARCASE_DEPTH],
    new THREE.Vector3(0, PLINTH_HEIGHT / 2, CARCASE_CENTRE_Z), 0, frameMatrix, carcase);
  const headRailY = CARCASE_HEIGHT - RAIL_THICKNESS / 2;
  addBox(room, shelfMaterial, [CABINET_RUN_WIDTH, RAIL_THICKNESS, CARCASE_DEPTH],
    new THREE.Vector3(0, headRailY, CARCASE_CENTRE_Z), 0, frameMatrix,
    { outlined: false, shade: shelfBoardShade(headRailY) });
  addBox(room, shelfMaterial, [CABINET_RUN_WIDTH, CARCASE_HEIGHT, CARCASE_BACK_THICKNESS],
    new THREE.Vector3(0, CARCASE_CENTRE_Y, CARCASE_BACK_Z), 0, frameMatrix, carcase);

  const outerPost = (CABINET_RUN_WIDTH - CABINET_POST_WIDTH) / 2;
  for (const x of [-outerPost, outerPost]) {
    addBox(room, shelfMaterial, [CABINET_POST_WIDTH, postHeight, CARCASE_DEPTH],
      new THREE.Vector3(x, CARCASE_CENTRE_Y, CARCASE_CENTRE_Z), 0, frameMatrix, carcase);
  }
  addCarcaseOutline(outlinePositions, frameMatrix, CABINET_RUN_WIDTH);
  for (let shelfIndex = 0; shelfIndex < SHELVES_PER_WALL; shelfIndex++) {
    const shelfY = SHELF_BASE_Y + shelfIndex * SHELF_PITCH;
    addBox(room, shelfMaterial, [CABINET_RUN_WIDTH, SHELF_THICKNESS, SHELF_DEPTH],
      new THREE.Vector3(0, shelfY, SHELF_CENTRE_Z), 0, frameMatrix,
      { outlined: false, shade: shelfBoardShade(shelfY) });
    addShelfEdge(outlinePositions, frameMatrix, shelfY, CABINET_RUN_WIDTH);
  }
}

// Gallery spines are lettered with their shelfmark, shelf and volume as the
// catalogue addresses them ("07·112"), not with a title. A title is a division
// of a very large number: 7680 of them a chamber would double what a chamber
// costs to build, and lettering them as the floor's are lettered would add
// nineteen draw calls. A shelfmark is the same in every chamber, so every
// label there is, 10 shelves of 192, is painted once on one atlas, and each
// volume of the gallery mesh picks its cell in the shader: no draw call more.
const GALLERY_SPINE_SHELVES = GALLERY_LEVELS.length * SHELVES_PER_WALL;
const GALLERY_MAX_WALLS = 6;
// Two kinds of cell: one for each volume of a shelf, lettered on the upper half
// of the plate, and one for each wall and shelf, lettered on the lower half.
// A volume of the gallery mesh wears the upper half of its volume's cell and
// the lower half of its wall and shelf's, and the plate joins between them.
const GALLERY_VOLUME_CELLS = VOLUMES_PER_WALL_SHELF;
const GALLERY_SPINE_LABELS = GALLERY_VOLUME_CELLS + GALLERY_MAX_WALLS * GALLERY_SPINE_SHELVES;
const GALLERY_ATLAS_WIDTH = 2048;
const GALLERY_ATLAS_COLUMNS = Math.floor(GALLERY_ATLAS_WIDTH / SPINE_CELL_WIDTH);
const GALLERY_ATLAS_ROWS = Math.ceil(GALLERY_SPINE_LABELS / GALLERY_ATLAS_COLUMNS);
const GALLERY_ATLAS_HEIGHT = GALLERY_ATLAS_ROWS * SPINE_CELL_HEIGHT;
// The floor's plates are laid over dark leather; a gallery volume glows, so its
// plate is deeper to read as the same dark lettering piece.
const GALLERY_PLATE_ALPHA = 0.8;
const GALLERY_FIRST_SHELF = SHELVES_PER_WALL + 1;

const galleryLabelAtlas = { texture: null };
function ensureGalleryLabelAtlas() {
  if (galleryLabelAtlas.texture) return galleryLabelAtlas.texture;
  const canvas = document.createElement('canvas');
  canvas.width = GALLERY_ATLAS_WIDTH;
  canvas.height = GALLERY_ATLAS_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  for (let cell = 0; cell < GALLERY_SPINE_LABELS; cell++) {
    const marks = {};
    if (cell < GALLERY_VOLUME_CELLS) marks.upper = volumeMark(cell + 1);
    else {
      const place = cell - GALLERY_VOLUME_CELLS;
      const wall = Math.floor(place / GALLERY_SPINE_SHELVES) + 1;
      marks.lower = shelfMark(wall, GALLERY_FIRST_SHELF + place % GALLERY_SPINE_SHELVES);
    }
    paintSpineLabel(context, cell % GALLERY_ATLAS_COLUMNS, Math.floor(cell / GALLERY_ATLAS_COLUMNS), marks,
      GALLERY_PLATE_ALPHA);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  galleryLabelAtlas.texture = texture;
  return texture;
}

// Which label a volume of the gallery mesh wears, from its place in the mesh:
// walls, then tiers, then sections, shelves and volumes, as they were placed.
const GALLERY_VOLUMES_PER_TIER = CABINET_SECTIONS_PER_WALL * SHELVES_PER_WALL * VOLUMES_PER_SHELF;
const GALLERY_VOLUMES_PER_SECTION = SHELVES_PER_WALL * VOLUMES_PER_SHELF;
const galleryLetteredGeometry = (() => {
  const geometry = shelfFaceBookGeometry.clone();
  const perWall = GALLERY_VOLUMES_PER_TIER * GALLERY_LEVELS.length;
  const cells = new Float32Array(perWall * GALLERY_MAX_WALLS * 2);
  for (let id = 0; id < perWall * GALLERY_MAX_WALLS; id++) {
    const wall = Math.floor(id / perWall);
    const tier = Math.floor((id % perWall) / GALLERY_VOLUMES_PER_TIER);
    const inTier = id % GALLERY_VOLUMES_PER_TIER;
    const section = Math.floor(inTier / GALLERY_VOLUMES_PER_SECTION);
    const shelf = Math.floor((inTier % GALLERY_VOLUMES_PER_SECTION) / VOLUMES_PER_SHELF);
    const volume = section * VOLUMES_PER_SHELF + (inTier % VOLUMES_PER_SHELF);
    cells[id * 2] = volume;
    cells[id * 2 + 1] = GALLERY_VOLUME_CELLS + wall * GALLERY_SPINE_SHELVES + tier * SHELVES_PER_WALL + shelf;
  }
  geometry.setAttribute('spineCell', new THREE.InstancedBufferAttribute(cells, 2));
  return geometry;
})();
sharedGeometries.add(galleryLetteredGeometry);

const galleryLetteredMaterial = galleryBookMaterial.clone();
galleryLetteredMaterial.onBeforeCompile = shader => {
  shader.uniforms.spineAtlas = { value: ensureGalleryLabelAtlas() };
  const declarations = `
    varying vec2 vSpineCell;
    varying float vSpineFace;
    varying vec2 vSpineUv;`;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec2 spineCell;${declarations}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vSpineCell = spineCell;
      vSpineFace = normal.z < -0.5 ? 1.0 : 0.0;
      vSpineUv = uv;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform sampler2D spineAtlas;${declarations}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      vec4 spineLabel = vec4(0.0);
      if (vSpineFace > 0.5) {
        float cell = vSpineUv.y >= 0.5 ? vSpineCell.x : vSpineCell.y;
        float column = mod(cell, ${GALLERY_ATLAS_COLUMNS}.0);
        float row = floor(cell / ${GALLERY_ATLAS_COLUMNS}.0);
        vec2 within = vSpineUv;
        vec2 at = vec2(
          (column * ${SPINE_CELL_WIDTH}.0 + 1.0 + within.x * ${SPINE_CELL_WIDTH - 2}.0) / ${GALLERY_ATLAS_WIDTH}.0,
          1.0 - (row * ${SPINE_CELL_HEIGHT}.0 + 1.0 + (1.0 - within.y) * ${SPINE_CELL_HEIGHT - 2}.0) / ${GALLERY_ATLAS_HEIGHT}.0);
        spineLabel = texture2D(spineAtlas, at);
        diffuseColor.rgb = mix(diffuseColor.rgb, spineLabel.rgb, spineLabel.a);
      }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= vColor.rgb * (1.0 - spineLabel.a);
      totalEmissiveRadiance += spineLabel.rgb * spineLabel.a * 0.4;`);
};

// The tiers of cases standing on the galleries: shelves 6-15 of each wall.
// Built as the course on the floor is built, and filled as it is. They are
// drawn apart from the floor's volumes, as spines and tops only: nobody on a
// gallery can see a volume's sides past its neighbours.
function addGalleryCases(room, index) {
  const basis = wallBasis(index);
  const batch = room.userData.galleryVolumes;
  for (const level of GALLERY_LEVELS) {
    const offset = pointOnWall(basis, 0, level, CABINET_WALL_INSET);
    const tierFrame = new THREE.Matrix4().makeRotationY(basis.rotation).setPosition(offset.x, offset.y, offset.z);
    addCaseRun(room, tierFrame);
    addCabinetCarving(room, { labels: false, dentils: false });
    for (let section = 0; section < CABINET_SECTIONS_PER_WALL; section++) {
      const tangent = (section - (CABINET_SECTIONS_PER_WALL - 1) / 2) * CABINET_SECTION_PITCH;
      const frameOffset = pointOnWall(basis, tangent, level, CABINET_WALL_INSET);
      frameMatrix.makeRotationY(basis.rotation).setPosition(frameOffset.x, frameOffset.y, frameOffset.z);
      for (let shelfIndex = 0; shelfIndex < SHELVES_PER_WALL; shelfIndex++) {
        const shelfY = SHELF_BASE_Y + shelfIndex * SHELF_PITCH;
        for (let localVolume = 0; localVolume < VOLUMES_PER_SHELF; localVolume++) {
          const x = -((VOLUMES_PER_SHELF - 1) * CABINET_BOOK_STEP) / 2 + localVolume * CABINET_BOOK_STEP;
          // Varied as the course below is, but offset by the tier so that no
          // two courses repeat the same pattern of heights and bindings.
          const { height, tint } = volumeVariation(index + 7 * (level > GALLERY_LEVELS[0] ? 2 : 1), shelfIndex,
            section * VOLUMES_PER_SHELF + localVolume);
          placeVolume(bookMatrix, x, shelfY, BOOK_FRONT_Z + BOOK_DEPTH / 2, height).premultiply(frameMatrix);
          batch.matrices.push(bookMatrix.clone());
          batch.tints.push(tint);
        }
      }
    }
    // Reading lamps along each tier, as along the floor; the bodies glow, and
    // the light comes from the three at the middle and the quarters.
    for (const ratio of [-0.39, -0.195, 0, 0.195, 0.39]) {
      const tangent = ratio * CABINET_RUN_WIDTH;
      addBox(room, brassMaterial, [0.44, 0.045, 0.045],
        pointOnWall(basis, tangent, level + CARCASE_HEIGHT - 0.04, 0.42), basis.rotation, null, { outlined: false });
      addBox(room, lampMaterial, [0.19, 0.13, 0.14],
        pointOnWall(basis, tangent, level + CARCASE_HEIGHT - 0.22, 0.62), basis.rotation, null, { outlined: false });
    }
  }
}

function addGalleries(room, doorWalls) {
  addBalustradeParts(room, galleryBalustrade(doorWalls).parts);
  for (const part of galleryParts(doorWalls)) {
    const material = part.kind === 'iron' ? metalMaterial : (part.kind === 'stone' ? wallMaterial : shelfMaterial);
    if (part.slab) {
      const { left, right, depth, height } = part.slab;
      const entry = mitredSlabFor(left, right, depth, height);
      staticLocalMatrix.makeRotationY(part.rotation).setPosition(part.position.x, part.position.y, part.position.z);
      appendMergedGeometry(staticBatchFor(room, material), entry.geometry, staticLocalMatrix);
      continue;
    }
    addBox(room, material, part.size, part.position, part.rotation, null,
      { outlined: false, rotationZ: part.rotationZ ?? 0 });
  }
}

// The galleries and everything on them are the same in every chamber whose
// doorways are on the same walls — and there are only three such
// arrangements, one per level of the cycle. So they are built once for each,
// kept as finished vertex arrays per material, and every chamber after that
// copies them into its own batches as it merges them: building them box by box
// doubled the time it took to put up a chamber, and drawing them as meshes of
// their own cost a draw call per material in every chamber on screen.
const galleryShells = new Map();
function galleryShellFor(doorWalls, shelvedWalls) {
  const key = doorWalls.join(',');
  let shell = galleryShells.get(key);
  if (shell) return shell;
  const scratch = {
    userData: {
      staticBatches: new Map(),
      outlinePositions: [],
      galleryVolumes: { matrices: [], tints: [] },
    },
  };
  for (const index of shelvedWalls) addGalleryCases(scratch, index);
  addGalleries(scratch, doorWalls);
  // The piers of the well and the columns at each doorway ride along: they
  // too are the same in every chamber of an orientation.
  for (const part of WELL_PIER_PARTS) {
    addBox(scratch, part.stone ? wallMaterial : shelfMaterial, part.size, part.position, part.rotation, null,
      { outlined: false });
  }
  for (const wall of doorWalls) {
    for (const { size, position, rotation, stone } of doorColumnParts(wall)) {
      addBox(scratch, stone ? wallMaterial : shelfMaterial, size, position, rotation, null, { outlined: false });
    }
  }
  // So does the stone balustrade round the well, and every baluster in the
  // chamber, round the well and along both galleries: those are one instanced
  // draw whose buffers every chamber of the orientation shares. Three thousand
  // faceted stones merged into the batches would be a quarter of a million
  // vertices.
  addBalustradeParts(scratch, WELL_BALUSTRADE_PARTS);
  const balusterTemplate = instancedBalusters(balusterGeometry, wallMaterial, [
    { balusters: WELL_BALUSTERS },
    { balusters: galleryBalustrade(doorWalls).balusters },
  ]);
  const batches = new Map();
  for (const [material, batch] of scratch.userData.staticBatches) {
    batches.set(material, {
      positions: new Float32Array(batch.positions),
      normals: new Float32Array(batch.normals),
      uvs: new Float32Array(batch.uvs),
      colors: new Float32Array(batch.colors),
      indices: new Uint32Array(batch.indices),
    });
  }
  const { matrices, tints } = scratch.userData.galleryVolumes;
  const matrixArray = new Float32Array(matrices.length * 16);
  const colorArray = new Float32Array(matrices.length * 3);
  matrices.forEach((matrix, index) => {
    matrix.toArray(matrixArray, index * 16);
    colorArray.set(tints[index], index * 3);
  });
  shell = {
    batches,
    outlines: new Float32Array(scratch.userData.outlinePositions),
    volumes: {
      count: matrices.length,
      matrix: new THREE.InstancedBufferAttribute(matrixArray, 16),
      color: new THREE.InstancedBufferAttribute(colorArray, 3),
      walls: Object.freeze([...shelvedWalls]),
      centres: Float32Array.from({ length: matrices.length * 3 }, (_, element) =>
        matrixArray[Math.floor(element / 3) * 16 + 12 + element % 3]),
    },
    balusters: {
      count: balusterTemplate.count,
      matrix: balusterTemplate.instanceMatrix,
      color: balusterTemplate.instanceColor,
      sphere: balusterTemplate.boundingSphere,
    },
  };
  galleryShells.set(key, shell);
  return shell;
}

const concatenated = (head, tail) => {
  const joined = new Float32Array(head.length + tail.length);
  joined.set(head);
  joined.set(tail, head.length);
  return joined;
};

// A chamber's own batch for a material with the shell's copy of it appended.
function mergedWithShell(batch, shellBatch) {
  if (!shellBatch) return mergedMesh(batch, batch.material);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(concatenated(batch.positions, shellBatch.positions), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(concatenated(batch.normals, shellBatch.normals), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(concatenated(batch.uvs, shellBatch.uvs), 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(concatenated(batch.colors, shellBatch.colors), 3));
  const base = batch.positions.length / 3;
  const indices = new Uint32Array(batch.indices.length + shellBatch.indices.length);
  indices.set(batch.indices);
  for (let element = 0; element < shellBatch.indices.length; element++) {
    indices[batch.indices.length + element] = base + shellBatch.indices[element];
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return new THREE.Mesh(geometry, batch.material);
}

// The gallery books: one instanced draw for every tier together, apart from
// the chamber's floor volumes because their buffers are shared by every
// chamber of an orientation. They are catalogue books all the same, on shelves
// 6-15 of their wall; working out 7680 records would double the cost of a
// chamber, so a record is worked out when a volume is first aimed at.
function addGalleryVolumes(room, shell) {
  // Painted with the first chamber, while the walker is still on the start
  // screen, not in the first frame that draws a gallery volume.
  ensureGalleryLabelAtlas();
  const volumes = new THREE.InstancedMesh(galleryLetteredGeometry, galleryLetteredMaterial, shell.volumes.count);
  volumes.instanceMatrix = shell.volumes.matrix;
  volumes.instanceColor = shell.volumes.color;
  volumes.userData.galleryVolumes = true;
  volumes.userData.shelvedWalls = shell.volumes.walls;
  volumes.userData.records = [];
  volumes.userData.centres = shell.volumes.centres;
  volumes.raycast = raycastGalleryVolumes;
  volumes.castShadow = false;
  volumes.receiveShadow = true;
  room.add(volumes);
  room.userData.galleryBooks = volumes;
}

// The chamber's balusters, on the buffers its orientation's shell holds.
function addBalusters(room, shell) {
  const { count, matrix, color, sphere } = shell.balusters;
  const balusters = new THREE.InstancedMesh(balusterGeometry, wallMaterial, count);
  balusters.instanceMatrix = matrix;
  balusters.instanceColor = color;
  balusters.boundingSphere = sphere.clone();
  balusters.userData.balusters = count;
  balusters.raycast = () => {};
  balusters.castShadow = true;
  balusters.receiveShadow = true;
  room.add(balusters);
}

// Picking runs every frame, and three.js tests every instance of a mesh
// against the ray: 7680 more a frame for volumes that are nearly all out of
// reach. Only those whose centre is within reach of the eye are tested.
const galleryRayOrigin = new THREE.Vector3();
const galleryInverse = new THREE.Matrix4();
const galleryInstanceMatrix = new THREE.Matrix4();
const galleryInstanceMesh = new THREE.Mesh();
const galleryHits = [];
const GALLERY_PICK_SLACK = 0.6;
function raycastGalleryVolumes(raycaster, intersects) {
  galleryInverse.copy(this.matrixWorld).invert();
  galleryRayOrigin.copy(raycaster.ray.origin).applyMatrix4(galleryInverse);
  const reach = Math.min(raycaster.far, 1e4) + GALLERY_PICK_SLACK;
  const reachSquared = reach * reach;
  const { centres } = this.userData;
  galleryInstanceMesh.geometry = this.geometry;
  galleryInstanceMesh.material = this.material;
  for (let instance = 0; instance < this.count; instance++) {
    const dx = centres[instance * 3] - galleryRayOrigin.x;
    const dy = centres[instance * 3 + 1] - galleryRayOrigin.y;
    const dz = centres[instance * 3 + 2] - galleryRayOrigin.z;
    if (dx * dx + dy * dy + dz * dz > reachSquared) continue;
    this.getMatrixAt(instance, galleryInstanceMatrix);
    galleryInstanceMesh.matrixWorld.multiplyMatrices(this.matrixWorld, galleryInstanceMatrix);
    galleryInstanceMesh.raycast(raycaster, galleryHits);
    for (const hit of galleryHits) {
      hit.instanceId = instance;
      hit.object = this;
      intersects.push(hit);
    }
    galleryHits.length = 0;
  }
}

/** The catalogue record of one gallery volume, in the order addGalleryCases lays them. */
export function galleryRecordFor(mesh, instanceId) {
  const cached = mesh.userData.records[instanceId];
  if (cached) return cached;
  const room = mesh.parent?.userData;
  if (!room || instanceId < 0 || instanceId >= mesh.count) return null;
  const perWall = GALLERY_VOLUMES_PER_TIER * GALLERY_LEVELS.length;
  const wallIndex = mesh.userData.shelvedWalls[Math.floor(instanceId / perWall)];
  const tier = Math.floor((instanceId % perWall) / GALLERY_VOLUMES_PER_TIER) + 1;
  const inTier = instanceId % GALLERY_VOLUMES_PER_TIER;
  const section = Math.floor(inTier / GALLERY_VOLUMES_PER_SECTION);
  const shelfIndex = Math.floor((inTier % GALLERY_VOLUMES_PER_SECTION) / VOLUMES_PER_SHELF);
  const worldLocation = {
    q: room.q,
    r: room.r,
    level: room.level,
    wall: canonicalWallForWallIndex(room.level, wallIndex),
    shelf: tier * SHELVES_PER_WALL + shelfIndex + 1,
    volume: section * VOLUMES_PER_SHELF + (inTier % VOLUMES_PER_SHELF) + 1,
    page: 1,
  };
  const record = bookRecord(catalogBookIndexFor(worldLocation), worldLocation);
  mesh.userData.records[instanceId] = record;
  return record;
}

// Collects one wall's volumes into the room-wide batches instead of adding a
// mesh per book.  Shelving itself stays merged too: there are only a handful
// of carcase pieces per wall, but they share two materials across four walls.
function collectBookWall(room, index, q, r, level, disturbed) {
  const basis = wallBasis(index);
  // On another level the same canonical wall faces a different way, so the
  // number comes from the placement rather than from a fixed list.
  const canonicalWall = canonicalWallForWallIndex(level, index);
  const { batches } = room.userData;

  const labelOffset = pointOnWall(basis, 0, 0, CABINET_WALL_INSET);
  wallLabelMatrix.makeRotationY(basis.rotation).setPosition(labelOffset.x, labelOffset.y, labelOffset.z);
  addWallNumber(room.userData.wallNumbers, canonicalWall, wallLabelMatrix);

  // One built-in case runs along the wall. The six catalogue sections remain
  // logical address groups only: the architecture has no internal partitions.
  addCaseRun(room, wallLabelMatrix);
  addCabinetCarving(room);

  // Every volume on a wall is the wall's first slot plus its place along the
  // shelves, so the address arithmetic is done once here rather than from
  // coordinates for each of the 960 volumes.
  const wallSlot = worldSlotIndexFor({ q, r, level, wall: canonicalWall, shelf: 1, volume: 1, page: 1 });
  for (let section = 0; section < CABINET_SECTIONS_PER_WALL; section++) {
    const tangent = (section - (CABINET_SECTIONS_PER_WALL - 1) / 2) * CABINET_SECTION_PITCH;
    const frameOffset = pointOnWall(basis, tangent, 0, CABINET_WALL_INSET);
    frameMatrix.makeRotationY(basis.rotation).setPosition(frameOffset.x, frameOffset.y, frameOffset.z);

    for (let shelfIndex = 0; shelfIndex < SHELVES_PER_WALL; shelfIndex++) {
      const shelfY = SHELF_BASE_Y + shelfIndex * SHELF_PITCH;
      for (let localVolume = 0; localVolume < VOLUMES_PER_SHELF; localVolume++) {
        const volumeIndex = section * VOLUMES_PER_SHELF + localVolume;
        const worldLocation = {
          q,
          r,
          level,
          wall: canonicalWall,
          shelf: shelfIndex + 1,
          volume: volumeIndex + 1,
          page: 1,
        };
        const bookIndex = catalogBookIndexForWorldSlotIndex(
          wallSlot + BigInt(shelfIndex * WORLD_VOLUMES_PER_SHELF + volumeIndex),
        );
        const batch = batches[0];
        const x = -((VOLUMES_PER_SHELF - 1) * CABINET_BOOK_STEP) / 2
          + localVolume * CABINET_BOOK_STEP;
        // Seated exactly on the shelf surface: the old constant left a 25mm gap
        // that read as books hovering once the shelf lost its outline.
        const bookCenterZ = BOOK_FRONT_Z + BOOK_DEPTH / 2;
        const { height, tint } = volumeVariation(index, shelfIndex, volumeIndex);

        // Somebody read this one and put it back badly. It is the same volume it
        // always was — same address, same text, same title; only its standing has
        // been disturbed, which is the whole of what a trace is allowed to be.
        const outOfPlace = disturbed
          && disturbed.wall === canonicalWall - 1
          && disturbed.shelf === shelfIndex
          && disturbed.volume === volumeIndex;
        // Cabinet space has the room at -z — BOOK_FRONT_Z is the spine face and
        // it is negative — so standing a volume out means subtracting the reach.
        placeVolume(bookMatrix, x, shelfY, bookCenterZ - (outOfPlace ? disturbed.reach : 0), height,
          outOfPlace ? disturbed.lean : 0).premultiply(frameMatrix);
        batch.matrices.push(bookMatrix.clone());
        batch.tints.push(tint);
        batch.records.push(bookRecord(bookIndex, worldLocation));
        // Thousands of rectangular ink frames flattened the wall into a
        // technical diagram. The binding itself now supplies the silhouette;
        // typography is the only mark drawn on its face.

        placeVolume(spineMatrix, x, shelfY, BOOK_FRONT_Z - 0.015, height, Math.PI).premultiply(frameMatrix);
        if (room.userData.deferSpines) {
          room.userData.deferredSpines.push({ label: shelfmark(worldLocation), matrix: spineMatrix.clone() });
        } else {
          appendSpine(room, shelfmark(worldLocation), spineMatrix);
        }
      }
    }
  }
}

function finalizeNextSpineAtlas(room) {
  const atlas = room.userData.spineAtlases.find(candidate => candidate.positions);
  if (!atlas) {
    room.userData.spinesFinalized = true;
    return true;
  }
  const mesh = mergedMesh(atlas, atlas.material);
  mesh.renderOrder = 3;
  mesh.userData.spineLabels = true;
  room.add(mesh);
  atlas.positions = atlas.uvs = atlas.indices = null;
  room.userData.spinesFinalized = room.userData.spineAtlases.every(candidate => !candidate.positions);
  return room.userData.spinesFinalized;
}

// Portal neighbours are geometrically identical on a level. Rebuilding 3840
// deterministic addresses, titles, outlines and merged cabinet buffers six
// times blocked the main thread even though none of those unique labels can be
// read from a corridor. One canonical visual shell per three-level orientation
// shares all immutable geometry; each neighbour owns only transforms and
// instance buffers. Exact records and labels are hydrated in bounded slices
// after that already-visible shell becomes current.
const portalVisualTemplates = new Map();

function levelOrientation(level) {
  const remainder = BigInt(level) % 3n;
  return Number(remainder < 0n ? remainder + 3n : remainder);
}

function copyVisualTransform(target, source) {
  target.name = source.name;
  target.position.copy(source.position);
  target.quaternion.copy(source.quaternion);
  target.scale.copy(source.scale);
  target.matrix.copy(source.matrix);
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.visible = source.visible;
  target.castShadow = source.castShadow;
  target.receiveShadow = source.receiveShadow;
  target.renderOrder = source.renderOrder;
  target.frustumCulled = source.frustumCulled;
  target.userData = { ...source.userData };
  if (source.raycast) target.raycast = source.raycast;
  return target;
}

function cloneVisualChild(source) {
  if (source.userData.spineLabels) return null;
  let clone;
  if (source.isInstancedMesh) {
    clone = new THREE.InstancedMesh(source.geometry, source.material, source.count);
    // Every portal shell has the same immutable physical arrangement until it
    // becomes the active room. Sharing these attributes keeps six copies of
    // 3840 book transforms from being uploaded the first time each doorway
    // enters the frustum. The adopted room detaches them before applying its
    // exact disturbed-volume trace below.
    clone.instanceMatrix = source.instanceMatrix;
    clone.instanceColor = source.instanceColor ?? null;
    clone.userData.records = [];
  } else if (source.isLineSegments) {
    clone = new THREE.LineSegments(source.geometry, source.material);
  } else if (source.isLine) {
    clone = new THREE.Line(source.geometry, source.material);
  } else if (source.isMesh) {
    clone = new THREE.Mesh(source.geometry, source.material);
  } else {
    clone = source.clone(false);
  }
  copyVisualTransform(clone, source);
  if (source.isInstancedMesh) clone.userData.records = [];
  if (source.geometry) sharedGeometries.add(source.geometry);
  return clone;
}

function cloneVisualRoom(source, q, r, level, template = false) {
  const room = new THREE.Group();
  const bookMeshes = [];
  let galleryBooks = null;
  for (const child of source.children) {
    const clone = cloneVisualChild(child);
    if (!clone) continue;
    room.add(clone);
    if (clone.isInstancedMesh && !clone.userData.galleryVolumes && !clone.userData.balusters) bookMeshes.push(clone);
    if (clone.userData.galleryVolumes) galleryBooks = clone;
  }
  const sourceDisturbed = source.userData.templateDisturbed
    ?? tracesFor(worldRoomIndexFor(source.userData.q, source.userData.r, source.userData.level), source.userData.level).disturbed;
  room.userData = {
    q,
    r,
    level,
    bookMeshes,
    galleryBooks,
    spineAtlases: [],
    pendingSpines: [],
    deferredSpines: [],
    deferSpines: true,
    spinesFinalized: false,
    disposableMaterials: [],
    doorWalls: [...freeWallsForLevel(level)],
    shelvedWalls: [...bookWallsForLevel(level)],
    bookWallCount: SHELVED_WALLS_PER_ROOM,
    lampCount: 2,
    wellBalustradeParts: WELL_BALUSTRADE_PARTS.length,
    cabinetRunWidth: CABINET_RUN_WIDTH,
    cabinetUprightsPerWall: CABINET_UPRIGHTS_PER_WALL,
    portalVisualShell: !template,
    portalMetadata: template ? null : {
      wall: 0,
      section: 0,
      shelf: 0,
      localVolume: 0,
      record: 0,
      disturbed: tracesFor(worldRoomIndexFor(q, r, level), level).disturbed,
      templateDisturbed: sourceDisturbed,
    },
    sharedInstanceBuffers: !template,
    templateDisturbed: sourceDisturbed,
  };
  return room;
}

/** Creates a complete visual neighbour without rebuilding its shared shell. */
export function makePortalRoom(source, q, r, level) {
  const orientation = levelOrientation(level);
  let template = portalVisualTemplates.get(orientation);
  if (!template) {
    template = cloneVisualRoom(source, source.userData.q, source.userData.r, source.userData.level, true);
    portalVisualTemplates.set(orientation, template);
  }
  return cloneVisualRoom(template, q, r, level);
}

const metadataFrameMatrix = new THREE.Matrix4();
const metadataBookMatrix = new THREE.Matrix4();
const metadataSpineMatrix = new THREE.Matrix4();

function sameDisturbedVolume(disturbed, canonicalWall, shelfIndex, volumeIndex) {
  return Boolean(
    disturbed
    && disturbed.wall === canonicalWall - 1
    && disturbed.shelf === shelfIndex
    && disturbed.volume === volumeIndex
  );
}

function detachPortalInstanceBuffers(room) {
  if (!room.userData.sharedInstanceBuffers) return;
  for (const mesh of room.userData.bookMeshes) {
    mesh.instanceMatrix = mesh.instanceMatrix.clone();
    mesh.instanceColor = mesh.instanceColor?.clone() ?? null;
  }
  room.userData.sharedInstanceBuffers = false;
}

function hydrateOnePortalVolume(room) {
  // This is the first operation that may alter a visual shell. Copy-on-write
  // means corridor views reuse already-uploaded buffers, while an adopted room
  // still owns the exact trace and metadata for its coordinates.
  detachPortalInstanceBuffers(room);
  const state = room.userData.portalMetadata;
  const wallIndex = room.userData.shelvedWalls[state.wall];
  const canonicalWall = canonicalWallForWallIndex(room.userData.level, wallIndex);
  const basis = wallBasis(wallIndex);
  const tangent = (state.section - (CABINET_SECTIONS_PER_WALL - 1) / 2) * CABINET_SECTION_PITCH;
  const frameOffset = pointOnWall(basis, tangent, 0, CABINET_WALL_INSET);
  metadataFrameMatrix.makeRotationY(basis.rotation).setPosition(
    frameOffset.x,
    frameOffset.y,
    frameOffset.z,
  );

  const volumeIndex = state.section * VOLUMES_PER_SHELF + state.localVolume;
  const worldLocation = {
    q: room.userData.q,
    r: room.userData.r,
    level: room.userData.level,
    wall: canonicalWall,
    shelf: state.shelf + 1,
    volume: volumeIndex + 1,
    page: 1,
  };
  const bookIndex = catalogBookIndexFor(worldLocation);
  const bookMesh = room.userData.bookMeshes[0];
  bookMesh.userData.records[state.record] = bookRecord(bookIndex, worldLocation);

  const x = -((VOLUMES_PER_SHELF - 1) * CABINET_BOOK_STEP) / 2
    + state.localVolume * CABINET_BOOK_STEP;
  const shelfY = SHELF_BASE_Y + state.shelf * SHELF_PITCH;
  const { height } = volumeVariation(wallIndex, state.shelf, volumeIndex);
  const templateWasDisturbed = sameDisturbedVolume(
    state.templateDisturbed,
    canonicalWall,
    state.shelf,
    volumeIndex,
  );
  const outOfPlace = sameDisturbedVolume(
    state.disturbed,
    canonicalWall,
    state.shelf,
    volumeIndex,
  );
  if (templateWasDisturbed || outOfPlace) {
    const bookCenterZ = BOOK_FRONT_Z + BOOK_DEPTH / 2;
    placeVolume(metadataBookMatrix, x, shelfY, bookCenterZ - (outOfPlace ? state.disturbed.reach : 0), height,
      outOfPlace ? state.disturbed.lean : 0).premultiply(metadataFrameMatrix);
    bookMesh.setMatrixAt(state.record, metadataBookMatrix);
    bookMesh.instanceMatrix.needsUpdate = true;
  }
  placeVolume(metadataSpineMatrix, x, shelfY, BOOK_FRONT_Z - 0.015, height, Math.PI)
    .premultiply(metadataFrameMatrix);
  appendSpine(room, shelfmark(worldLocation), metadataSpineMatrix);

  state.record++;
  state.localVolume++;
  if (state.localVolume === VOLUMES_PER_SHELF) {
    state.localVolume = 0;
    state.shelf++;
  }
  if (state.shelf === SHELVES_PER_WALL) {
    state.shelf = 0;
    state.section++;
  }
  if (state.section === CABINET_SECTIONS_PER_WALL) {
    state.section = 0;
    state.wall++;
  }
  return state.wall === room.userData.shelvedWalls.length;
}

function finalizeRoom(room, shell = null) {
  const { batches, outlinePositions, staticBatches } = room.userData;
  if (shell) for (const material of shell.batches.keys()) staticBatchFor(room, material);
  for (const batch of staticBatches.values()) {
    const mesh = mergedWithShell(batch, shell?.batches.get(batch.material));
    // The shell and timber carry the large architectural shadows. Tiny rails,
    // brass brackets and emissive lantern batches add several full shadow-map
    // submissions while changing no readable silhouette.
    mesh.castShadow = ![
      brassMaterial,
      lampMaterial,
      lampHaloMaterial,
      metalMaterial,
    ].includes(batch.material);
    mesh.receiveShadow = true;
    room.add(mesh);
  }

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
    // Thousands of individual book silhouettes make an unstable moire shadow.
    // The shelves and cabinet frame cast the architectural shadow; books only
    // receive it and retain their authored contact tone.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    room.add(mesh);
    room.userData.bookMeshes.push(mesh);
  }


  if (outlinePositions.length || shell?.outlines.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(
      shell ? concatenated(outlinePositions, shell.outlines) : new Float32Array(outlinePositions), 3,
    ));
    const outlines = new THREE.LineSegments(geometry, outlineMaterial);
    outlines.renderOrder = 2;
    room.add(outlines);
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
 * Returns true once the room has none left. Each finished 4 MiB atlas is added
 * only after all of its labels are painted, so it is uploaded once.
 */
export function paintPendingSpines(room, budgetMs) {
  const deadline = performance.now() + budgetMs;

  const metadata = room.userData.portalMetadata;
  if (metadata) {
    let complete = false;
    while (!complete && performance.now() < deadline) {
      complete = hydrateOnePortalVolume(room);
    }
    if (!complete) return false;
    room.userData.portalMetadata = null;
    room.userData.portalVisualShell = false;
    room.userData.deferSpines = false;
  }

  // Portal rooms carry the exact same books and cabinet geometry as an active
  // room, but their 3840 text quads and three 1024² canvases are invisible at
  // corridor distance. Build those only after the room becomes current. This
  // keeps the visible shell identical while removing the largest allocation
  // from corridor preparation.
  const deferred = room.userData.deferredSpines;
  while (deferred?.length && performance.now() < deadline) {
    // Order is immaterial because every quad carries its own world matrix. Pop
    // avoids repeatedly moving thousands of array entries while a newly
    // adopted portal room materialises its labels.
    const { label, matrix } = deferred.pop();
    appendSpine(room, label, matrix);
  }
  if (deferred?.length) return false;
  const pending = room.userData.pendingSpines;
  if (pending?.length) {
    let painted = 0;
    while (painted < pending.length && performance.now() < deadline) {
      const { atlas, column, row, label } = pending[painted++];
      paintSpineLabel(atlas.context, column, row, label);
    }
    pending.splice(0, painted);
    if (pending.length) return false;
  }
  // The canvases are fully painted before their meshes enter the scene, so a
  // CanvasTexture's first upload already carries final pixels. Attaching one
  // atlas per call spreads the three 4 MiB transfers over three frames.
  if (!room.userData.spinesFinalized) return finalizeNextSpineAtlas(room);
  return true;
}

// Somebody stood here and counted, exactly as the walker's register counts.
// Scratched, not drafted: every other marking in this world is in the
// architect's hand, and these are the only ones that are not.
const TALLY_HEIGHT = 1.34;
const TALLY_STROKE = 0.015;
const TALLY_LENGTH = 0.15;
const TALLY_GAP = 0.036;
// A tally is always beside a doorway, and a doorway wall now shows the room the
// same face every other wall does — scratching at the wall plane itself would
// bury the marks inside the jamb.
const TALLY_FACE = WALL_THICKNESS / 2 + 0.004;
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

export function makeRoom(q, r, level, { deferSpines = false } = {}) {
  const room = new THREE.Group();
  room.userData = {
    q,
    r,
    level,
    bookMeshes: [],
    spineAtlases: [],
    pendingSpines: [],
    deferredSpines: [],
    deferSpines,
    spinesFinalized: false,
    disposableMaterials: [],
    outlinePositions: [],
    wallNumbers: { positions: [], uvs: [], indices: [], colors: [] },
    staticBatches: new Map(),
    batches: bookMaterials.map(material => ({ material, matrices: [], tints: [], records: [] })),
    wellBalustradeParts: WELL_BALUSTRADE_PARTS.length,
    cabinetRunWidth: CABINET_RUN_WIDTH,
    cabinetUprightsPerWall: CABINET_UPRIGHTS_PER_WALL,
  };

  // Six-sided, and no larger than the room. As squares of 32 they reached
  // sixteen units out — past the mouth of both passages — and quietly floored
  // over the stair wells, so a shaft meant to fall away for storeys ended a
  // centimetre below its lip. A bounding square is not enough either: the
  // corridor leaves through a corner of one, which is exactly where a square
  // overhangs the hexagon it stands for.
  // The shell materials take vertex colour, and a mesh without a colour
  // attribute is read as black. That is what made the gallery between a
  // doorway and the rail a black pit however the room was lit.
  const floor = new THREE.Mesh(litRing(), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.userData.wellOpening = true;
  floor.receiveShadow = true;
  room.add(floor);
  const ceiling = new THREE.Mesh(litRing(), ceilingMaterial);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = WALL_HEIGHT - WELL_SLAB_THICKNESS;
  ceiling.userData.wellOpening = true;
  ceiling.receiveShadow = true;
  room.add(ceiling);

  // The guard is part of the room's structural batch, at no draw call of its
  // own. The stone balustrade on the lip rides with the gallery shell below:
  // it is the same in every chamber, so it is merged once, not per chamber.
  for (const part of WELL_LIP_PARTS) {
    addBox(room, wallMaterial, part.size, part.position, part.rotation, null, { outlined: false });
  }

  // The crossing and the one way between floors, and the only things in a
  // chamber that do not turn with the level. See well.js: a flight spans
  // exactly one storey, so this single object is both the way up out of here
  // and, one storey down, the way that arrives here.
  for (const part of [...WELL_BRIDGE_PARTS, ...WELL_STAIR_PARTS]) {
    addBox(
      room,
      part.trim ? metalMaterial : (part.wood ? shelfMaterial : wallMaterial),
      part.size,
      part.position,
      part.rotation,
      null,
      { outlined: false, rotationZ: part.rotationZ ?? 0 },
    );
  }

  const outerCorners = hexCorners();

  // The six arrises where the walls meet, one line set: as six lines they were
  // a draw call each in the chamber and again in every doorway that shows it.
  const cornerLines = new THREE.BufferGeometry().setFromPoints(outerCorners.flatMap(corner => [
    new THREE.Vector3(corner.x, 0.02, corner.z),
    new THREE.Vector3(corner.x, WALL_HEIGHT, corner.z),
  ]));
  room.add(new THREE.LineSegments(cornerLines, roomLineMaterial));

  // What this chamber carries of the people who were here before. Derived from
  // its own index, so a trace is as real as its books: always there, findable
  // again, and nameable by an exact address.
  const traces = tracesFor(worldRoomIndexFor(q, r, level), level);

  const doorWalls = freeWallsForLevel(level);
  const shelvedWalls = bookWallsForLevel(level);
  room.userData.doorWalls = [...doorWalls];
  room.userData.shelvedWalls = [...shelvedWalls];
  room.userData.bookWallCount = shelvedWalls.length;
  room.userData.lampCount = doorWalls.length;
  for (const wall of doorWalls) {
    const basis = wallBasis(wall);
    // The doorway is cut far above lantern height now, so the lantern that hung
    // over its head would hang in the opening. It is a pair instead, one on
    // each of the columns that flank the way through, and the light they cast
    // is still one source at the centre, as it always was.
    for (const globePosition of doorColumnLanternPoints(wall, WALL_LAMP_HEIGHT)) {
      // Merged like the rest of the lantern: a pair of globes on every
      // doorway would otherwise be a pair of draw calls in every chamber.
      staticLocalMatrix.makeTranslation(globePosition.x, globePosition.y, globePosition.z);
      appendMergedGeometry(staticBatchFor(room, lampMaterial), lampGeometry, staticLocalMatrix);
      // A short bracket and cage give the source a scale and a reason to hang
      // where it does.  All pieces join the room's static batches.
      const bracket = (size, rise, out, across = 0) => addBox(room, brassMaterial, size,
        globePosition.clone()
          .addScaledVector(new THREE.Vector3(basis.tx, 0, basis.tz), across)
          .addScaledVector(new THREE.Vector3(basis.nx, 0, basis.nz), out)
          .setY(globePosition.y + rise),
        basis.rotation, null, { outlined: false });
      bracket([0.08, 0.72, 0.08], 0.16, 0.24);
      bracket([0.08, 0.08, 0.3], 0.39, 0.12);
      for (const side of [-1, 1]) bracket([0.035, 0.5, 0.035], 0, 0, side * 0.2);
    }

    const light = new THREE.PointLight(LAMP_LIGHT_COLOR, LAMP_INTENSITY, LAMP_RANGE, 2);
    light.position.copy(pointOnWall(basis, 0, WALL_LAMP_HEIGHT, 1.05));
    // Point-light shadow maps render the room six times per lamp. The one
    // bounded architectural key supplies soft contact shadows; local lanterns
    // remain illumination-only so the shaft can afford many visible sources.
    light.castShadow = false;
    room.add(light);
  }

  // Five sconces to every cabinet wall, and every one of them a real light.
  //
  // They used to be emissive bodies only, on the reasoning that another twenty
  // point lights would cost thousands of fragment evaluations a frame. Measured
  // on this scene that reasoning is wrong: twenty extra non-shadowing lights
  // moved the frame by nothing at all, well inside the noise of the timing
  // itself. Without them the shelving is unlit, which means the books that fill
  // every wall of every floor of the shaft are there and cannot be seen.
  //
  // No shadow maps here. A shadow costs six cube faces and these are twenty; the
  // lanterns on the flight carry the shadows, and they are the ones with a
  // balustrade in front of them worth casting.
  room.userData.readingLampCount = 0;
  for (const wall of shelvedWalls) {
    const basis = wallBasis(wall);
    const lampTangents = [-0.39, -0.195, 0, 0.195, 0.39].map(ratio => ratio * CABINET_RUN_WIDTH);
    for (const tangent of lampTangents) {
      const globePosition = pointOnWall(basis, tangent, CARCASE_HEIGHT - 0.22, 0.62);
      addBox(room, brassMaterial, [0.44, 0.045, 0.045],
        pointOnWall(basis, tangent, CARCASE_HEIGHT - 0.04, 0.42), basis.rotation, null, { outlined: false });
      addBox(room, brassMaterial, [0.045, 0.3, 0.045],
        pointOnWall(basis, tangent, CARCASE_HEIGHT - 0.18, 0.43), basis.rotation, null, { outlined: false });
      addBox(room, lampMaterial, [0.19, 0.13, 0.14], globePosition, basis.rotation, null, { outlined: false });
      // No painted halo: see the note by the well lanterns. The bloom pass
      // takes the glow from the bright core and spreads it into the haze.
      const reading = new THREE.PointLight(LAMP_LIGHT_COLOR, SCONCE_INTENSITY, SCONCE_RANGE, 2);
      reading.position.copy(pointOnWall(basis, tangent, CARCASE_HEIGHT - 0.3, 0.95));
      reading.castShadow = false;
      room.add(reading);
      room.userData.readingLampCount++;
    }
  }

  // Two more on the crossing, at either end of the opening in its deck. These
  // are what put warmth on the treads and on the rails a walker has a hand on,
  // and they are the only light out in the middle of the shaft.
  // Every lantern in the well: the two flanking the opening in the deck, and
  // the ones standing on the newels up the flight. A body is built for all of
  // them; only some carry an actual light, because past a few metres a lantern
  // contributes nothing but its own brightness and there is no reason to pay a
  // shadow map to say so.
  const wellLanterns = [
    ...WELL_LANTERN_POSITIONS.map(position => ({ position, lit: true, shadowed: true })),
    ...WELL_STAIR_LANTERNS,
  ];
  room.userData.lanternCount = wellLanterns.length;
  room.userData.litLanternCount = wellLanterns.filter(lantern => lantern.lit).length;
  for (const { position, lit, shadowed } of wellLanterns) {
    // Dark frame plus a luminous core: the light is a recognisable lantern
    // rather than an unexplained cube hovering over the rail.
    addBox(room, brassMaterial, [0.34, 0.08, 0.34],
      new THREE.Vector3(position.x, position.y - 0.19, position.z), 0, null, { outlined: false });
    addBox(room, brassMaterial, [0.29, 0.07, 0.29],
      new THREE.Vector3(position.x, position.y + 0.19, position.z), 0, null, { outlined: false });
    for (const [dx, dz] of [[-0.13, -0.13], [-0.13, 0.13], [0.13, -0.13], [0.13, 0.13]]) {
      addBox(room, brassMaterial, [0.035, 0.34, 0.035],
        new THREE.Vector3(position.x + dx, position.y, position.z + dz), 0, null, { outlined: false });
    }
    // The glazing bar across the face, which is what makes it read as a lantern
    // and not a glowing block once a walker is close enough to see it at all.
    addBox(room, brassMaterial, [0.21, 0.022, 0.21], position, 0, null, { outlined: false });
    addBox(room, lampMaterial, [0.19, 0.28, 0.19], position, 0, null, { outlined: false });
    // No painted halo. There used to be a translucent additive cube here
    // standing in for a glow, and against real bloom it is worse than nothing:
    // it reads as exactly what it is, a square, hanging around every flame.
    // The glow belongs to the composite pass, which gets it from the bright
    // core above and spreads it into the haze the way light actually goes.
    if (!lit) continue;
    const light = new THREE.PointLight(LAMP_LIGHT_COLOR, LAMP_INTENSITY, LAMP_RANGE, 2);
    light.position.copy(position);
    // The pair on the deck throw the barred shadow of the balustrade across
    // the flight, which is most of what makes it look built. The lanterns up
    // the flight light it without a shadow of their own: every shadowing
    // lantern is a cube of six views of the chamber to draw on arrival and nine
    // shadow lookups in every pixel of every frame, and with all six of them
    // casting, the lamps and their shadows were close to half the frame.
    light.castShadow = Boolean(shadowed);
    if (!shadowed) {
      room.add(light);
      continue;
    }
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.far = LAMP_RANGE;
    light.shadow.bias = -0.004;
    light.shadow.normalBias = 0.03;
    room.add(light);
  }
  for (let index = 0; index < 6; index++) {
    if (doorWalls.includes(index)) {
      addDoorWall(room, index);
      continue;
    }
    addSolidWall(room, index);
    if (shelvedWalls.includes(index)) collectBookWall(room, index, q, r, level, traces.disturbed);
  }
  for (let index = 0; index < 6; index++) addWallJoinery(room, index, doorWalls.includes(index));
  // After every catalogued volume, so that theirs are the first records.
  if (traces.tally) addTally(room, traces.tally);
  const shell = galleryShellFor(doorWalls, shelvedWalls);
  finalizeRoom(room, shell);
  addGalleryVolumes(room, shell);
  addBalusters(room, shell);
  return room;
}

export function disposeRoom(room) {
  const geometries = new Set();
  room.traverse(object => {
    if (object.geometry && !sharedGeometries.has(object.geometry)) geometries.add(object.geometry);
    // Instanced volumes own their matrix and colour buffers even though the box
    // geometry itself is shared across every room.
    // The galleries' volumes share one buffer between every chamber of an
    // orientation; releasing it would only make the next chamber upload it.
    // So do the balusters.
    if (object.isInstancedMesh && !object.userData.galleryVolumes && !object.userData.balusters) object.dispose();
    // A lantern that casts shadows owns its shadow map, a render target the
    // renderer keeps until the light itself is disposed. Removing the room
    // from the scene does not release it, so without this every chamber
    // walked through left its lanterns' shadow maps behind.
    if (object.isLight) object.dispose();
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of room.userData.disposableMaterials) {
    material.map?.dispose();
    material.dispose();
  }
}
