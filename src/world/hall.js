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
  BOOK_DEPTH,
  BOOK_HEIGHT,
  BOOK_STEP,
  CABINET_POST_WIDTH,
  CABINET_WIDTH,
  DOOR_HEIGHT,
  SHELF_BASE_Y,
  SHELF_PITCH,
  WALL_HEIGHT,
  HALL_HALF_WIDTH,
  HALL_LENGTH,
  HALL_LINTEL_HEIGHT,
  HALL_OPENING_HEIGHT,
  HALL_SIDE_CENTRE,
  HALL_SIDE_HALF,
  DOOR_WALL_THICKNESS,
  HALL_TRANSOM_DEPTH,
  SHAFT_STOREYS,
  STAIR_CENTRE,
  STAIR_HALF,
  STOREY_HEIGHT,
  WALL_THICKNESS,
} from '../constants.js';
import { SHELVES_PER_WALL, VOLUMES_PER_SHELF } from '../../babel-v3.js';
import { ceilingMaterial, floorMaterial, shelfMaterial, trimMaterial, wallMaterial } from '../core/materials.js';
import { appendMergedEdges, appendMergedGeometry, boxGeometryFor } from './geometry.js';
import {
  CARCASE_BACK_THICKNESS,
  CARCASE_CENTRE_Y,
  CARCASE_DEPTH,
  CARCASE_HEIGHT,
  SHELF_DEPTH,
  SHELF_SURFACE_OFFSET,
  SHELF_THICKNESS,
  nicheShade,
  shelfBoardShade,
} from './room.js';

const SLAB = 0.12;
const LIP = 0.004;
const ALCOVE_CENTRE = HALL_HALF_WIDTH + ALCOVE_DEPTH / 2;
const TREADS = 6;
const RAIL_HEIGHT = 0.9;

// Where each side of the passage is cut. The stair bay is on the left only —
// local +x, the walker's left — because one stair serves a passage, and a bay
// facing it would only be a second way to the same place.
const LEFT_OPENINGS = [STAIR_CENTRE, HALL_SIDE_CENTRE];
const RIGHT_OPENINGS = [HALL_SIDE_CENTRE];

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
export function appendHall(batches, outlines, matrix) {
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
    // side +1 is the walker's left; see the frame at the top of the file.
    const openings = side > 0 ? LEFT_OPENINGS : RIGHT_OPENINGS;

    for (const [runCentre, runLength] of wallRuns(openings)) {
      addBox(batches, outlines, wallMaterial, [WALL_THICKNESS, DOOR_HEIGHT, runLength],
        wallX, DOOR_HEIGHT / 2, runCentre);
    }

    for (const opening of openings) {
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
      if (opening === STAIR_CENTRE) {
        addBox(batches, outlines, wallMaterial,
          [WALL_THICKNESS, HALL_OPENING_HEIGHT, 2 * HALL_SIDE_HALF + 2 * WALL_THICKNESS],
          side * (ALCOVE_REACH + WALL_THICKNESS / 2), HALL_OPENING_HEIGHT / 2, opening);
      }

      if (opening !== STAIR_CENTRE) {
        addBox(batches, null, floorMaterial, [ALCOVE_DEPTH, SLAB, 2 * HALL_SIDE_HALF],
          bayX, -SLAB / 2, opening, null, false);
        addBox(batches, null, ceilingMaterial, [ALCOVE_DEPTH, SLAB, 2 * HALL_SIDE_HALF],
          bayX, HALL_OPENING_HEIGHT + SLAB / 2, opening, null, false);
        addTemplateChamber(batches, outlines, side, opening);
        continue;
      }
      addStair(batches, outlines, side, bayX);
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

// --- what stands behind a side opening ---------------------------------------
// Not a wall. A walker facing a turning is about to enter a chamber, and the
// only honest thing to show them is the chamber. It is a stand-in, in the same
// spirit as the rooms receding down the corridor: shelves, ledges and bands of
// volumes, no catalogue consulted and no title read, because every chamber in
// this world looks alike and the real one is built when they walk in.
//
// A box rather than a hexagon. Through an opening 2.4 wide and 2.5 high, from
// the far side of a corridor, the corners of a hexagon are outside the cone of
// sight entirely, and three walls of shelving is what a person actually sees.
const TEMPLATE_DEPTH = 5.4;
const TEMPLATE_HALF_WIDTH = 3.1;
const TEMPLATE_START = ALCOVE_REACH + WALL_THICKNESS;

function addTemplateCabinet(batches, outlines, x, z, turn, faceAway) {
  const shade = local => nicheShade(local) * faceAway;
  const post = (CABINET_WIDTH - CABINET_POST_WIDTH) / 2;
  addBox(batches, null, shelfMaterial, [CABINET_WIDTH, CARCASE_HEIGHT, CARCASE_BACK_THICKNESS],
    x, CARCASE_CENTRE_Y, z, shade, false, turn);
  for (const side of [-1, 1]) {
    addBox(batches, null, shelfMaterial, [CABINET_POST_WIDTH, CARCASE_HEIGHT, CARCASE_DEPTH],
      x + Math.cos(turn) * side * post, CARCASE_CENTRE_Y, z - Math.sin(turn) * side * post,
      shade, false, turn);
  }
  for (let shelf = 0; shelf < SHELVES_PER_WALL; shelf++) {
    const shelfY = SHELF_BASE_Y + shelf * SHELF_PITCH;
    addBox(batches, null, shelfMaterial, [CABINET_WIDTH, SHELF_THICKNESS, SHELF_DEPTH],
      x, shelfY, z, local => shelfBoardShade(shelfY)(local) * faceAway, false, turn);
    // One filled band rather than thirty-two volumes: through an opening this
    // far off the gaps between spines are less than a pixel.
    const bottom = shelfY + SHELF_SURFACE_OFFSET;
    addBox(batches, null, trimMaterial, [VOLUMES_PER_SHELF * BOOK_STEP, BOOK_HEIGHT, BOOK_DEPTH],
      x, bottom + BOOK_HEIGHT / 2, z, () => 0.72 * faceAway, false, turn);
  }
}

function addTemplateChamber(batches, outlines, side, opening) {
  const near = side * TEMPLATE_START;
  const far = side * (TEMPLATE_START + TEMPLATE_DEPTH);
  const middle = side * (TEMPLATE_START + TEMPLATE_DEPTH / 2);
  const depth = TEMPLATE_DEPTH;

  addBox(batches, null, floorMaterial, [depth, SLAB, 2 * TEMPLATE_HALF_WIDTH],
    middle, -SLAB / 2, opening, null, false);
  addBox(batches, null, ceilingMaterial, [depth, SLAB, 2 * TEMPLATE_HALF_WIDTH],
    middle, WALL_HEIGHT + SLAB / 2, opening, null, false);

  // The three walls a walker can see through the opening, and the returns
  // beside it that make the opening read as a doorway into the chamber.
  addBox(batches, null, wallMaterial, [WALL_THICKNESS, WALL_HEIGHT, 2 * TEMPLATE_HALF_WIDTH],
    far, WALL_HEIGHT / 2, opening, () => 0.94, false);
  for (const flank of [-1, 1]) {
    addBox(batches, null, wallMaterial, [depth, WALL_HEIGHT, WALL_THICKNESS],
      middle, WALL_HEIGHT / 2, opening + flank * TEMPLATE_HALF_WIDTH, () => 0.86, false);
    addBox(batches, outlines, wallMaterial,
      [WALL_THICKNESS, WALL_HEIGHT, TEMPLATE_HALF_WIDTH - HALL_SIDE_HALF],
      near, WALL_HEIGHT / 2, opening + flank * (TEMPLATE_HALF_WIDTH + HALL_SIDE_HALF) / 2,
      () => 0.9, true);
  }
  // A lintel over the threshold, so the chamber is entered rather than fallen into.
  addBox(batches, outlines, wallMaterial,
    [WALL_THICKNESS, WALL_HEIGHT - HALL_OPENING_HEIGHT, 2 * HALL_SIDE_HALF],
    near, (WALL_HEIGHT + HALL_OPENING_HEIGHT) / 2, opening, () => 0.9, true);

  // Shelving on the far wall and both flanks. The tone drops with the turn away
  // from the opening, which is the only light this scene has.
  addTemplateCabinet(batches, outlines, far - side * (CARCASE_DEPTH / 2 + WALL_THICKNESS), opening,
    side > 0 ? -Math.PI / 2 : Math.PI / 2, 1);
  for (const flank of [-1, 1]) {
    addTemplateCabinet(batches, outlines, middle,
      opening + flank * (TEMPLATE_HALF_WIDTH - CARCASE_DEPTH / 2 - WALL_THICKNESS),
      flank > 0 ? Math.PI : 0, 0.82);
  }
}

/**
 * The stair bay.
 *
 * One shaft in two halves. The half nearer the mouth of the passage is a well
 * with its floor open, and the half beyond it is a flight climbing away from
 * the corridor and out through the ceiling. Both are drawn as one storey after
 * another receding — that is Borges's own device for infinity, and it is the
 * vertical one, which the horizontal corridor cannot give.
 *
 * The flight is steep, forty-five degrees. Nobody climbs it: stepping onto it
 * is the transition, exactly as stepping into an alcove is. It is drawn to be
 * read, not walked.
 */
function addStair(batches, outlines, side, bayX) {
  const farZ = STAIR_CENTRE + STAIR_HALF / 2;
  const top = SHAFT_STOREYS * STOREY_HEIGHT;

  // The shaft itself: the bay's four sides continued above the ceiling and
  // below the floor. Without them a well is a hole onto the background.
  const spans = [
    { centre: (DOOR_HEIGHT + SLAB + top) / 2, height: top - DOOR_HEIGHT - SLAB },
    { centre: (-SLAB - top) / 2, height: top - SLAB },
  ];
  // Falls off fast rather than evenly. Spread over the whole shaft the tone
  // stayed near white for the first storey, and a well that is white at the lip
  // does not read as a well — it reads as more floor.
  const shaftShade = local => THREE.MathUtils.lerp(
    0.34, 0.03, THREE.MathUtils.clamp(Math.abs(local.y) / STOREY_HEIGHT, 0, 1) ** 0.55,
  );
  // The floors themselves stay brighter than the wall beside them, or they
  // would not read as edges at all against it — and the edges are the point:
  // one storey after another is what makes a shaft say how far it goes.
  const storeyShade = local => Math.min(1, shaftShade(local) * 2.2 + 0.1);
  for (const { centre, height } of spans) {
    for (const wallX of [ALCOVE_REACH + WALL_THICKNESS / 2, HALL_HALF_WIDTH - WALL_THICKNESS / 2]) {
      addBox(batches, null, wallMaterial,
        [WALL_THICKNESS, height, 2 * STAIR_HALF + 2 * WALL_THICKNESS],
        side * wallX, centre, STAIR_CENTRE, shaftShade, false);
    }
    for (const jamb of [-1, 1]) {
      addBox(batches, null, wallMaterial, [ALCOVE_DEPTH, height, WALL_THICKNESS],
        bayX, centre, STAIR_CENTRE + jamb * (STAIR_HALF + WALL_THICKNESS / 2), shaftShade, false);
    }
  }

  // One floor after another, above and below, until the tone runs out. This is
  // Borges's own device for infinity, and it is the vertical one — the corridor
  // gives the horizontal, and no amount of it gives this.
  for (let storey = 1; storey <= SHAFT_STOREYS; storey++) {
    for (const sign of [1, -1]) {
      addBox(batches, storey <= 2 ? outlines : null, wallMaterial,
        [ALCOVE_DEPTH, SLAB, 2 * STAIR_HALF], bayX, sign * storey * STOREY_HEIGHT, STAIR_CENTRE,
        storeyShade, storey <= 2);
    }
  }

  // The flight, climbing away from the corridor and out through the ceiling.
  const rise = HALL_OPENING_HEIGHT / TREADS;
  const run = ALCOVE_DEPTH / TREADS;
  for (let tread = 0; tread < TREADS; tread++) {
    addBox(batches, outlines, trimMaterial, [run, rise, STAIR_HALF],
      side * (HALL_HALF_WIDTH + run * (tread + 0.5)), rise * (tread + 0.5), farZ,
      local => 1 - 0.42 * (local.y / HALL_OPENING_HEIGHT));
  }
  // Its underside, so the flight is a stair and not a stack of floating slabs.
  addBox(batches, null, wallMaterial, [ALCOVE_DEPTH, SLAB, STAIR_HALF],
    bayX, -SLAB / 2, farZ, () => 0.5, false);

  // A rail along the edge the well shares with the flight, and a post: nobody
  // should step into a shaft without having had to mean it.
  addBox(batches, outlines, trimMaterial, [ALCOVE_DEPTH, 0.07, 0.07],
    bayX, RAIL_HEIGHT, STAIR_CENTRE, () => 0.4);
  addBox(batches, outlines, trimMaterial, [0.07, RAIL_HEIGHT, 0.07],
    side * (ALCOVE_REACH - 0.1), RAIL_HEIGHT / 2, STAIR_CENTRE, () => 0.4);
  addBox(batches, outlines, trimMaterial, [0.07, RAIL_HEIGHT, 0.07],
    side * (HALL_HALF_WIDTH + 0.1), RAIL_HEIGHT / 2, STAIR_CENTRE, () => 0.4);
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
