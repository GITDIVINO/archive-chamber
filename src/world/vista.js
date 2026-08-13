/**
 * The view through the doorways, and the passages themselves.
 *
 * The player's chamber and its six horizontal neighbours are exact room
 * objects owned by rooms.js. This module owns only the two walkable passages
 * attached to the current room and the vertically repeated shaft that can be
 * seen through the open floor and ceiling.
 *
 * The passages the player walks through are these same passages. A chamber's
 * two free walls face each other, so both of its passages lie on this axis and
 * are already drawn here — there is nothing extra to build when somebody steps
 * into one, and crossing a threshold leaves the view untouched, which is the
 * whole point.
 *
 * Vertical rooms repeat the same silhouette with a deliberately sparse book
 * rhythm and balustrade. They are never used behind a horizontal doorway, so
 * crossing a corridor threshold cannot swap between two levels of detail.
 */

import * as THREE from 'three';
import { SHELVES_PER_WALL, VOLUMES_PER_SHELF } from '../../babel-v3.js';
import { bookWallsForLevel, freeWallsForLevel } from '../../world-engine.js';
import { WALL_DIRECTIONS } from '../../world-model.js';
import {
  BOOK_DEPTH,
  BOOK_FRONT_Z,
  BOOK_HEIGHT,
  CABINET_RUN_WIDTH,
  CABINET_SECTIONS_PER_WALL,
  CABINET_POST_WIDTH,
  CHAMBER_STEP,
  DOOR_HEIGHT,
  HALL_OPENING_HEIGHT,
  HALL_HALF_WIDTH,
  HALL_LENGTH,
  HALL_START,
  DOOR_WIDTH,
  SHELF_BASE_Y,
  SHELF_PITCH,
  ROOM_RADIUS,
  WALL_HEIGHT,
  DOOR_WALL_OFFSET,
  DOOR_WALL_THICKNESS,
  WALL_THICKNESS,
  WALL_WIDTH,
  WELL_RADIUS,
  WELL_SLAB_THICKNESS,
} from '../constants.js';
import {
  bookMaterials,
  dustMaterial,
  distantFixtureMaterial,
  lampMaterial,
  metalMaterial,
  shelfMaterial,
  vistaCeilingMaterial,
  vistaFloorMaterial,
  vistaOutlineMaterial,
  wallMaterial,
} from '../core/materials.js';
import { appendMergedEdges, appendMergedGeometry, axialMapOffset, boxGeometryFor, mergedMesh, pointOnWall, wallBasis } from './geometry.js';
const SHELVED_WALLS = 4;
import { appendHall, hallTransform } from './hall.js';
import {
  PLINTH_HEIGHT,
  CABINET_WALL_INSET,
  CABINET_BOOK_STEP,
  CABINET_SECTION_PITCH,
  CABINET_UPRIGHTS_PER_WALL,
  CARCASE_BACK_THICKNESS,
  CARCASE_BACK_Z,
  CARCASE_CENTRE_Y,
  CARCASE_CENTRE_Z,
  CARCASE_DEPTH,
  CARCASE_HEIGHT,
  bookGeometry,
  RAIL_THICKNESS,
  SHELF_CENTRE_Z,
  SHELF_DEPTH,
  SHELF_SURFACE_OFFSET,
  SHELF_THICKNESS,
  WALL_CORNICE_BANDS,
  WALL_PILASTER_WIDTH,
  nicheShade,
  shelfBoardShade,
} from './room.js';
import {
  WELL_BALUSTRADE_PARTS,
  WELL_BRIDGE_PARTS,
  WELL_LANTERN_POSITIONS,
  WELL_LIP_PARTS,
  WELL_STAIR_LANTERNS,
  WELL_STAIR_PARTS,
} from './well.js';

// Looking straight up or down exposes a column of chambers. Twenty-eight in
// either direction reaches 134 metres; the existing fog has erased the last
// few before geometry ends, so the stack has no visible cap. Unlike the
// horizontal vista these rooms need no individual volumes: from one floor away
// a shelf band and its ruled edges already read as a wall of books.
// Fourteen, not twenty-eight. A storey is three times taller now, so fourteen
// floors reach 202 units — past the distance the fog has already erased and
// inside the 320 far plane. Keeping twenty-eight would build 400 units of
// chamber, half of it invisible, at twice the cost.
export const VERTICAL_VISTA_DEPTH = 14;
// The corridor runs along the axis shared by the two doorways, and that axis
// turns with the level: what shows through a doorway on the floor above runs a
// different way, which is the whole reason a stair is worth climbing.

const localMatrix = new THREE.Matrix4();
const worldMatrix = new THREE.Matrix4();
const tiltMatrix = new THREE.Matrix4();
const offsetMatrix = new THREE.Matrix4();
const verticalHallMatrix = new THREE.Matrix4();
const sectionFrame = new THREE.Matrix4();
const volumeMatrix = new THREE.Matrix4();
const VISTA_SURFACE_MATERIALS = Object.freeze({
  floor: vistaFloorMaterial,
  ceiling: vistaCeilingMaterial,
});

function finishVistaGeometry(group, batches, outlinePositions) {
  for (const batch of batches.values()) {
    const mesh = mergedMesh(batch, batch.material);
    // Never picked and never walked into; it exists only to be looked at.
    mesh.raycast = () => {};
    group.add(mesh);
  }
  if (!outlinePositions.length) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));
  const outlines = new THREE.LineSegments(geometry, vistaOutlineMaterial);
  outlines.renderOrder = 2;
  outlines.raycast = () => {};
  group.add(outlines);
}

function batchFor(batches, material) {
  let batch = batches.get(material);
  if (!batch) {
    batch = { material, positions: [], uvs: [], indices: [], colors: [] };
    batches.set(material, batch);
  }
  return batch;
}

function addBox(batches, material, size, position, rotation, parentMatrix, roomOffset, shade, outlines = null, rotationZ = 0) {
  const entry = boxGeometryFor(size[0], size[1], size[2]);
  localMatrix.makeRotationY(rotation);
  if (rotationZ) localMatrix.multiply(tiltMatrix.makeRotationZ(rotationZ));
  localMatrix.setPosition(position.x, position.y, position.z);
  worldMatrix.copy(localMatrix);
  if (parentMatrix) worldMatrix.premultiply(parentMatrix);
  worldMatrix.premultiply(roomOffset);
  appendMergedGeometry(batchFor(batches, material), entry.geometry, worldMatrix, shade, localMatrix);
  // A wall's arrises are where it meets the ceiling and the floor, and in a
  // drawing that line is the wall. Without them a chamber seen through a
  // doorway had no corners until the walker stepped into it.
  if (outlines) appendMergedEdges(outlines, entry.edges, worldMatrix);
}

// A floor and a ceiling per chamber rather than one slab down the whole
// corridor. The slab was cheaper, but it was also unbroken, and the stair bays
// need the floor to be genuinely absent where the well goes down — otherwise a
// shaft meant to fall away for storeys ends six centimetres below the tread.
// Each sits a hair below the passage's own floor and above its ceiling, so
// wherever the two meet the passage wins and nothing is coplanar.
function addChamberSlab(batches, material, roomOffset, y, rotationX) {
  const geometry = new THREE.RingGeometry(WELL_RADIUS, ROOM_RADIUS, 6);
  worldMatrix.makeRotationX(rotationX).setPosition(0, y, 0).premultiply(roomOffset);
  appendMergedGeometry(batchFor(batches, material), geometry, worldMatrix);
  geometry.dispose();
}

function addDistantBalustrade(batches, outlinePositions, roomOffset, simplified = false) {
  for (const part of WELL_BALUSTRADE_PARTS) {
    // At vertical vista distance the thin balusters collapse into a grey block
    // and account for most of the shaft geometry. Keep the two continuous rails
    // and the six corner posts; they preserve the exact hex without thousands
    // of sub-pixel boxes.
    if (simplified && part.size[0] < 0.08 && part.size[2] < 0.08) continue;
    addBox(
      batches,
      metalMaterial,
      part.size,
      part.position,
      part.rotation,
      null,
      roomOffset,
      null,
      null,
    );
  }
  for (const part of WELL_LIP_PARTS) {
    addBox(
      batches,
      wallMaterial,
      part.size,
      part.position,
      part.rotation,
      null,
      roomOffset,
      null,
      null,
    );
  }
}

// The real passage has a finite topological length, but a visible background
// immediately behind its far mouth reads as a coloured panel. For stacked
// floors only, continue its four surfaces far enough into the shared fog that
// the opening remains a corridor without spawning another chamber there.
const VERTICAL_TUNNEL_EXTENSION = 42;
const tunnelPoint = new THREE.Vector3();
function addTunnelLine(outlines, matrix, from, to) {
  if (!outlines) return;
  for (const point of [from, to]) {
    tunnelPoint.set(point[0], point[1], point[2]).applyMatrix4(matrix);
    outlines.push(tunnelPoint.x, tunnelPoint.y, tunnelPoint.z);
  }
}

function addVistaTunnel(batches, outlines, matrix, length, start = 0) {
  const centre = start + length / 2;
  const slab = 0.12;
  addBox(batches, vistaFloorMaterial, [2 * HALL_HALF_WIDTH, slab, length],
    new THREE.Vector3(0, -slab / 2, centre), 0, null, matrix, null);
  addBox(batches, vistaCeilingMaterial, [2 * HALL_HALF_WIDTH, slab, length],
    new THREE.Vector3(0, DOOR_HEIGHT + slab / 2, centre), 0, null, matrix, null);
  for (const side of [-1, 1]) {
    addBox(batches, wallMaterial, [WALL_THICKNESS, DOOR_HEIGHT, length],
      new THREE.Vector3(
        side * (HALL_HALF_WIDTH + WALL_THICKNESS / 2),
        DOOR_HEIGHT / 2,
        centre,
      ), 0, null, matrix, null);
    const face = side * HALL_HALF_WIDTH;
    addTunnelLine(outlines, matrix, [face, 0, start], [face, 0, start + length]);
    addTunnelLine(outlines, matrix, [face, DOOR_HEIGHT, start], [face, DOOR_HEIGHT, start + length]);
  }
}


// One wall of shelving in the vertical shaft. Horizontal neighbours never use
// this representation; they are exact portal rooms. That separation makes
// this deliberately cheap LOD safe: it cannot appear at a corridor threshold.
function addDistantBookWall(batches, volumes, index, roomOffset) {
  const basis = wallBasis(index);
  const postHeight = CARCASE_HEIGHT - 2 * RAIL_THICKNESS;
  const runOffset = pointOnWall(basis, 0, 0, CABINET_WALL_INSET);
  const runFrame = new THREE.Matrix4().makeRotationY(basis.rotation)
    .setPosition(runOffset.x, runOffset.y, runOffset.z);

  // The active and distant rooms share one architectural rule: one continuous
  // built-in bookcase from corner to corner. Sections divide the books and
  // their addresses, never the wall itself.
  addBox(batches, shelfMaterial, [CABINET_RUN_WIDTH, PLINTH_HEIGHT, CARCASE_DEPTH],
    new THREE.Vector3(0, PLINTH_HEIGHT / 2, CARCASE_CENTRE_Z), 0, runFrame, roomOffset, nicheShade);
  const headRailY = CARCASE_HEIGHT - RAIL_THICKNESS / 2;
  addBox(batches, shelfMaterial, [CABINET_RUN_WIDTH, RAIL_THICKNESS, CARCASE_DEPTH],
    new THREE.Vector3(0, headRailY, CARCASE_CENTRE_Z), 0, runFrame, roomOffset,
    shelfBoardShade(headRailY));
  addBox(batches, shelfMaterial, [CABINET_RUN_WIDTH, CARCASE_HEIGHT, CARCASE_BACK_THICKNESS],
    new THREE.Vector3(0, CARCASE_CENTRE_Y, CARCASE_BACK_Z), 0, runFrame, roomOffset, nicheShade);

  const outerPost = (CABINET_RUN_WIDTH - CABINET_POST_WIDTH) / 2;
  for (const x of [-outerPost, outerPost]) {
    addBox(batches, shelfMaterial, [CABINET_POST_WIDTH, postHeight, CARCASE_DEPTH],
      new THREE.Vector3(x, CARCASE_CENTRE_Y, CARCASE_CENTRE_Z), 0, runFrame, roomOffset, nicheShade);
  }

  for (let shelfIndex = 0; shelfIndex < SHELVES_PER_WALL; shelfIndex++) {
    const shelfY = SHELF_BASE_Y + shelfIndex * SHELF_PITCH;
    addBox(batches, shelfMaterial, [CABINET_RUN_WIDTH, SHELF_THICKNESS, SHELF_DEPTH],
      new THREE.Vector3(0, shelfY, SHELF_CENTRE_Z), 0, runFrame, roomOffset, shelfBoardShade(shelfY));
  }

  // Real volumes, one instance each, exactly as the walker's own chamber has
  // them. This used to be a ruled band per shelf — a stripe with twelve lines
  // ruled across it — which meant every floor of the shaft was a drawing of a
  // library rather than a library, and it showed the moment a walker looked
  // down. Instancing makes the honest version cost one draw call for the whole
  // stack, so there was never a reason to fake it.
  const basisFrame = wallBasis(index);
  for (let section = 0; section < CABINET_SECTIONS_PER_WALL; section++) {
    const tangent = (section - (CABINET_SECTIONS_PER_WALL - 1) / 2) * CABINET_SECTION_PITCH;
    const offset = pointOnWall(basisFrame, tangent, 0, CABINET_WALL_INSET);
    sectionFrame.makeRotationY(basisFrame.rotation)
      .setPosition(offset.x, offset.y, offset.z)
      .premultiply(roomOffset);
    for (let shelfIndex = 0; shelfIndex < SHELVES_PER_WALL; shelfIndex++) {
      const shelfY = SHELF_BASE_Y + shelfIndex * SHELF_PITCH;
      const centreY = shelfY + SHELF_SURFACE_OFFSET + BOOK_HEIGHT / 2;
      for (let volume = 0; volume < VOLUMES_PER_SHELF; volume++) {
        const x = -((VOLUMES_PER_SHELF - 1) * CABINET_BOOK_STEP) / 2 + volume * CABINET_BOOK_STEP;
        volumeMatrix.makeTranslation(x, centreY, BOOK_FRONT_Z + BOOK_DEPTH / 2)
          .premultiply(sectionFrame);
        volumeMatrix.toArray(volumes.matrices, volumes.count * 16);
        volumes.count++;
      }
    }
  }
}

// A wall with a hole in it, drawn as one thing. Outlining each of its three
// pieces put a seam from either corner of the opening up to the ceiling, and
// these walls are monolithic: only the wall's own frame and the opening cut in
// it are real edges. See addDoorWall in room.js, which does the same.
const facePoint = new THREE.Vector3();
function drawOnWall(outlines, basis, roomOffset, inward, edges) {
  for (const [fromT, fromY, toT, toY] of edges) {
    for (const [t, y] of [[fromT, fromY], [toT, toY]]) {
      const point = pointOnWall(basis, t, y, inward);
      facePoint.copy(point).applyMatrix4(roomOffset);
      outlines.push(facePoint.x, facePoint.y, facePoint.z);
    }
  }
}

function addDistantDoorWall(batches, index, roomOffset, outlines = null) {
  const basis = wallBasis(index);
  const jambWidth = (WALL_WIDTH - DOOR_WIDTH) / 2;
  const jambOffset = (DOOR_WIDTH + jambWidth) / 2;
  const lintelHeight = WALL_HEIGHT - HALL_OPENING_HEIGHT;
  // Seated outward from the wall line exactly as a built room seats it — see
  // addDoorWall in room.js — so that crossing a threshold changes nothing.
  const seat = -DOOR_WALL_OFFSET;
  for (const side of [-1, 1]) {
    addBox(batches, wallMaterial, [jambWidth, WALL_HEIGHT, DOOR_WALL_THICKNESS],
      pointOnWall(basis, side * jambOffset, WALL_HEIGHT / 2, seat), basis.rotation, null, roomOffset, null);
  }
  addBox(batches, wallMaterial, [DOOR_WIDTH, lintelHeight, DOOR_WALL_THICKNESS],
    pointOnWall(basis, 0, HALL_OPENING_HEIGHT + lintelHeight / 2, seat), basis.rotation, null, roomOffset, null);
  if (!outlines) return;
  const half = WALL_WIDTH / 2;
  const opening = DOOR_WIDTH / 2;
  drawOnWall(outlines, basis, roomOffset, WALL_THICKNESS / 2, [
    [-half, WALL_HEIGHT, half, WALL_HEIGHT],
    [-half, 0, -half, WALL_HEIGHT],
    [half, 0, half, WALL_HEIGHT],
    [-opening, 0, -opening, HALL_OPENING_HEIGHT],
    [opening, 0, opening, HALL_OPENING_HEIGHT],
    [-opening, HALL_OPENING_HEIGHT, opening, HALL_OPENING_HEIGHT],
  ]);
}

function addSolidWall(batches, index, roomOffset, outlines = null) {
  const basis = wallBasis(index);
  addBox(batches, wallMaterial, [WALL_WIDTH, WALL_HEIGHT, WALL_THICKNESS],
    pointOnWall(basis, 0, WALL_HEIGHT / 2), basis.rotation, null, roomOffset, null, outlines);
}

function addDistantWallJoinery(batches, index, roomOffset) {
  const basis = wallBasis(index);
  for (const band of WALL_CORNICE_BANDS) {
    addBox(
      batches,
      shelfMaterial,
      [WALL_WIDTH - 0.58, band.height, band.depth],
      pointOnWall(basis, 0, band.y, band.inset),
      basis.rotation,
      null,
      roomOffset,
      null,
    );
  }
  const tangent = WALL_WIDTH / 2 - WALL_PILASTER_WIDTH / 2 - 0.12;
  for (const side of [-1, 1]) {
    addBox(
      batches,
      shelfMaterial,
      [WALL_PILASTER_WIDTH, WALL_HEIGHT - 0.3, 0.2],
      pointOnWall(basis, side * tangent, (WALL_HEIGHT - 0.3) / 2, 0.16),
      basis.rotation,
      null,
      roomOffset,
      null,
    );
  }
}

// What a walker sees through a side opening of a passage: a chamber, and a
// real one — the same hexagon, the same four walls of shelving, the same two
// doorways as any other. A box would have been cheaper and it read as a
// closet; a gallery is what stands there, so a gallery is what is drawn.
//
// The chamber is placed so that one of its own doorways meets the mouth of the
// alcove. Its centre is therefore exactly HALL_START from that mouth: the
// distance from a chamber's centre to the outer face of a doorway built deep.
/**
 * Where the chamber behind a side opening stands, in the passage's own frame.
 *
 * Exported so that the signs — which are rebuilt with the room and therefore
 * know which chamber it is — can lay that chamber's tag on its ceiling at the
 * same orientation this builder gave it. Otherwise the marking would turn as
 * the walker stepped through.
 */
/** One chamber of the corridor, placed by `roomOffset`. */
/**
 * One chamber of the corridor, placed by `roomOffset`.
 *
 * Outlining and book detail remain separate concerns. Every chamber keeps the
 * same architectural outline; the current configuration deliberately gives
 * all vista chambers ruled bands instead of 3840 individual volumes.
 */
function addTemplateChamber(
  batches,
  outlinePositions,
  volumes,
  level,
  roomOffset,
) {
  const doorWalls = freeWallsForLevel(level);
  addDistantBalustrade(batches, outlinePositions, roomOffset, false);
  // The real lamps are point lights only in the active chamber.  Their distant
  // globes remain visible on every storey as a single batched constellation;
  // this is what lets darkness communicate scale instead of simply erasing it.
  for (const position of WELL_LANTERN_POSITIONS) {
    addBox(
      batches,
      lampMaterial,
      [0.18, 0.27, 0.18],
      position,
      0,
      null,
      roomOffset,
      null,
      null,
    );
    // No painted halo out here either: the bloom pass reaches the whole
    // shaft, and a translucent cube around every distant fixture was both a
    // visible square and thousands of overlapping transparent draws.
  }
  // The flight repeats on every floor of the shaft, and it has to: looking down
  // the well is the one place the stair can be seen as what it is — a single
  // diagonal running the whole height of a world otherwise built from nothing
  // but horizontals and verticals. A quarter of the treads and none of the
  // railing survives the distance, which is all that is wanted.
  // The same crossing and the same flight the walker is standing on, part for
  // part. There used to be a reduced copy out here — a quarter of the treads,
  // no balusters, no lanterns — and it read as exactly what it was: the floors
  // above and below were a cheaper building than this one. A shaft whose whole
  // subject is that every storey is the same storey cannot afford that.
  for (const part of [...WELL_BRIDGE_PARTS, ...WELL_STAIR_PARTS]) {
    addBox(
      batches,
      part.trim ? metalMaterial : (part.wood ? shelfMaterial : wallMaterial),
      part.size,
      part.position,
      part.rotation,
      null,
      roomOffset,
      null,
      null,
      part.rotationZ ?? 0,
    );
  }

  // Every lantern of the well, on every floor of the shaft. Bodies only: a
  // light thirty metres down contributes nothing but its own brightness, and
  // the bloom pass is what turns these into flames. All of them land in one
  // batch, so the whole constellation is two draw calls.
  for (const { position } of [
    ...WELL_LANTERN_POSITIONS.map(position => ({ position })),
    ...WELL_STAIR_LANTERNS,
  ]) {
    addBox(batches, metalMaterial, [0.34, 0.08, 0.34],
      new THREE.Vector3(position.x, position.y - 0.19, position.z), 0, null, roomOffset, null, null);
    addBox(batches, metalMaterial, [0.29, 0.07, 0.29],
      new THREE.Vector3(position.x, position.y + 0.19, position.z), 0, null, roomOffset, null, null);
    for (const [dx, dz] of [[-0.13, -0.13], [-0.13, 0.13], [0.13, -0.13], [0.13, 0.13]]) {
      addBox(batches, metalMaterial, [0.035, 0.34, 0.035],
        new THREE.Vector3(position.x + dx, position.y, position.z + dz), 0, null, roomOffset, null, null);
    }
    addBox(batches, lampMaterial, [0.19, 0.28, 0.19], position, 0, null, roomOffset, null, null);
  }
  // Repeated cabinet lights turn the shaft into a receding constellation. No
  // point lights are allocated here: these tiny emissive bodies are batched in
  // one material and disappear naturally into fog.
  for (const wall of bookWallsForLevel(level)) {
    const basis = wallBasis(wall);
    for (const ratio of [-0.39, -0.195, 0, 0.195, 0.39]) {
      const tangent = ratio * CABINET_RUN_WIDTH;
      const position = pointOnWall(basis, tangent, CARCASE_HEIGHT - 0.22, 0.62);
      addBox(batches, distantFixtureMaterial, [0.4, 0.045, 0.045],
        pointOnWall(basis, tangent, CARCASE_HEIGHT - 0.04, 0.42), basis.rotation, null, roomOffset, null);
      addBox(batches, lampMaterial, [0.16, 0.11, 0.12],
        position, basis.rotation, null, roomOffset, null);
    }
  }
  for (const index of bookWallsForLevel(level)) {
    addDistantBookWall(batches, volumes, index, roomOffset);
  }
  for (const index of doorWalls) addDistantDoorWall(batches, index, roomOffset, null);
  for (let index = 0; index < 6; index++) {
    if (!doorWalls.includes(index)) addSolidWall(batches, index, roomOffset, null);
    addDistantWallJoinery(batches, index, roomOffset);
  }
  // Physical shelf bands, slab lips and balustrades already describe every
  // repeated hexagon. Per-box edge lines accumulated into a black wireframe
  // when viewed along the shaft, so only the active room keeps drafted arrises.
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
  // Four shelved walls, six sections, five shelves, thirty-two volumes: 3840 a
  // chamber, for every floor of the shaft above and below.
  const stackedChambers = VERTICAL_VISTA_DEPTH * 2;
  const volumesPerChamber = SHELVED_WALLS * CABINET_SECTIONS_PER_WALL * SHELVES_PER_WALL * VOLUMES_PER_SHELF;
  const volumes = {
    matrices: new Float32Array(stackedChambers * volumesPerChamber * 16),
    count: 0,
  };
  let verticalPassages = 0;
  // A wall index is its own axial direction, so the corridor axis follows
  // straight from which wall carries a doorway.
  const doorWalls = freeWallsForLevel(level);
  const corridorDirection = doorWalls[0];
  const baseLevel = BigInt(level);
  // The axial offset gives the direction; the spacing along it is now set by
  // the passage, not by the tiling, because chambers no longer share a wall.
  const axis = axialMapOffset(...WALL_DIRECTIONS[corridorDirection]).normalize();

  // The rooms above and below occupy the same q/r column. Their logical level
  // still matters: it rotates the pair of door walls exactly as a real level
  // would. Each floor is a ring around the same opening, so its lip and guard
  // repeat all the way into the fog without ever capping the shaft.
  for (let delta = -VERTICAL_VISTA_DEPTH; delta <= VERTICAL_VISTA_DEPTH; delta++) {
    if (delta === 0) continue;
    const stackedLevel = baseLevel + BigInt(delta);
    offsetMatrix.makeTranslation(0, WALL_HEIGHT * delta, 0);
    addChamberSlab(batches, vistaFloorMaterial, offsetMatrix, -0.02, -Math.PI / 2);
    // The current room already owns the underside of the boundary directly
    // overhead. Every other boundary needs its own downward-facing plane.
    if (delta !== 1) {
      addChamberSlab(batches, vistaCeilingMaterial, offsetMatrix, -WELL_SLAB_THICKNESS, Math.PI / 2);
    }
    addTemplateChamber(batches, outlinePositions, volumes, stackedLevel, offsetMatrix);

    // One real passage begins behind each visible doorway. That is enough to
    // keep the background from reading as a coloured panel, without growing a
    // second horizontal library on every floor of the shaft.
    for (const wall of freeWallsForLevel(stackedLevel)) {
      const basis = wallBasis(wall);
      hallTransform(verticalHallMatrix, basis.nx, basis.nz, 0, 0, HALL_START)
        .premultiply(offsetMatrix);
      appendHall(batches, outlinePositions, verticalHallMatrix, false, VISTA_SURFACE_MATERIALS);
      addVistaTunnel(
        batches,
        outlinePositions,
        verticalHallMatrix,
        VERTICAL_TUNNEL_EXTENSION,
        HALL_LENGTH,
      );
      verticalPassages++;
    }
  }

  // Dust is not decoration here; it gives the light a medium and the well a
  // measurable depth. Positions are deterministic, sparse and concentrated
  // around the shaft so the same constellation is seen after every reload.
  const dustPositions = [];
  const dustCount = 720;
  for (let index = 0; index < dustCount; index++) {
    const angle = index * 2.399963229728653;
    const radius = WELL_RADIUS * (0.16 + ((index * 47) % 100) / 132);
    const y = ((index * 137) % 1000) / 1000
      * (VERTICAL_VISTA_DEPTH * WALL_HEIGHT * 1.8)
      - VERTICAL_VISTA_DEPTH * WALL_HEIGHT * 0.9;
    dustPositions.push(
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius,
    );
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.raycast = () => {};
  dust.userData.atmosphericDust = true;
  group.add(dust);

  // Finish the vertical shaft before adding the two walkable passages. Those
  // passages deliberately remain separate children: a portal destination must
  // omit the passage behind its arrival doorway. The base world already owns
  // that corridor up to the threshold; drawing the destination copy as well
  // lets its near wall cross the portal plane and hang inside the visible hex.
  // Once the threshold is crossed the ordinary vista, with both passages, is
  // still present and becomes canonical without a visual substitute.
  if (volumes.count) {
    const shelved = new THREE.InstancedMesh(bookGeometry, bookMaterials[0], volumes.count);
    shelved.instanceMatrix = new THREE.InstancedBufferAttribute(
      volumes.matrices.subarray(0, volumes.count * 16),
      16,
    );
    shelved.instanceMatrix.needsUpdate = true;
    shelved.castShadow = false;
    shelved.receiveShadow = true;
    shelved.frustumCulled = false;
    shelved.raycast = () => {};
    group.add(shelved);
  }
  finishVistaGeometry(group, batches, outlinePositions);

  for (let n = -1; n < 1; n++) {
    const base = CHAMBER_STEP * n;
    const passageWall = n === 0 ? doorWalls[0] : doorWalls[1];
    const passage = new THREE.Group();
    const passageBatches = new Map();
    const passageOutlines = [];
    passage.userData.vistaPassageWall = passageWall;
    hallTransform(offsetMatrix, axis.x, axis.z, axis.x * base, axis.z * base, HALL_START);
    appendHall(
      passageBatches,
      passageOutlines,
      offsetMatrix,
      true,
    );
    finishVistaGeometry(passage, passageBatches, passageOutlines);
    group.add(passage);
  }
  group.userData.verticalPassages = verticalPassages;
  group.userData.verticalChambers = VERTICAL_VISTA_DEPTH * 2;
  group.userData.cabinetRunWidth = CABINET_RUN_WIDTH;
  group.userData.cabinetUprightsPerWall = CABINET_UPRIGHTS_PER_WALL;
  return group;
}
