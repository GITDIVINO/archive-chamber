/**
 * Librarians: the hooded readers who keep the chambers.
 *
 * The story is about the people who spend their lives in the library, and
 * until now the only sign of them was what they left behind (traces.js). These
 * are the people themselves: figures in long robes, hoods drawn over their
 * heads, each about some business of their own.
 *
 * - **Walkers** go round the well slowly, reading from an open book held low
 *   in both hands, stop to read, walk on.
 * - **Searchers** stand at the cabinets with a closed book at the chest,
 *   looking up the shelves, and now and then step along them.
 * - **Sitters** sit on the floor with their backs to the cabinets and an open
 *   book in the lap.
 * - **Travellers** come in from one passage, go half way round the well and
 *   leave by the passage opposite, on to the next chamber.
 * - **Watchers** stand at the railing and look up at the light over the well.
 *
 * All of them whisper. Coming close to one, the walker hears the murmur and
 * can make out a line from the notebook of the Ring (whispers.js).
 *
 * Two rules keep them part of the world rather than decoration.
 *
 * They are **derived from the chamber's own index**, like the traces: how many
 * keep a chamber (three to ten), what each does, where and when are all drawn
 * from that number, so the same chamber is always kept by the same people.
 *
 * They **cost three draw calls**, one per pose: every figure is an instance of
 * one of three merged, vertex-coloured figures (walking, standing, seated), so
 * a chamber with ten of them draws exactly what a chamber with three does.
 * They cast no shadow: the shadow maps are baked once per chamber (view.js)
 * and a moving caster would force them to be redrawn.
 *
 * Every figure is symmetric about its own centre line, like everything else in
 * the building.
 */

import * as THREE from 'three';
import { freeWallsForLevel, worldRoomIndexFor } from '../../world-engine.js';
import { HALL_END, PLAYER_RADIUS } from '../constants.js';
import { wallBasis } from './geometry.js';
import { draw, seedFor } from './traces.js';
import { RING_LINES } from './whispers.js';

// --- the figures ----------------------------------------------------------------

const ROBE = new THREE.Color(0x4a3a2d);
const ROBE_FOLD = new THREE.Color(0x1f1712);
const CAPE = new THREE.Color(0x3f3127);
const HOOD_SHADOW = new THREE.Color(0x0a0706);
const FACE = new THREE.Color(0x4a3428);
const SKIN = new THREE.Color(0x8c6a52);
const PAGE = new THREE.Color(0xe8dec6);
const COVER = new THREE.Color(0x3c2118);

const vector = (x, y, z) => new THREE.Vector3(x, y, z);

// Hem, knee, waist, chest, shoulder, neck: a bell that falls to the floor and
// spreads a little on it, so there are no feet and no gait to animate.
const STANDING_ROBE = [[0.0, 0.0], [0.43, 0.0], [0.41, 0.06], [0.35, 0.35], [0.29, 0.75],
  [0.25, 1.05], [0.25, 1.25], [0.22, 1.38], [0.14, 1.47], [0.0, 1.5]];

// Each pose is the same monk: the same robe, cowl, sleeves and book, set
// differently. Heights are metres above the floor; −z is the way they face.
const POSES = Object.freeze({
  // Stooped over an open book held low, as in the engraving.
  walking: {
    robe: STANDING_ROBE,
    top: 1.5,
    stoop: 0.16,
    hood: vector(0, 1.6, -0.1), hoodTilt: 0.35,
    opening: vector(0, -0.45, -0.89),
    face: vector(0, 1.52, -0.2),
    shoulder: vector(0.23, 1.34, -0.02), cuff: vector(0.12, 1.02, -0.3),
    hand: vector(0.1, 1.02, -0.34),
    book: { open: true, at: vector(0, 1.04, -0.37), tilt: 0.85 },
  },
  // Upright, head back, a closed book held to the chest: looking up the
  // shelves, or up the well at the light.
  standing: {
    robe: STANDING_ROBE,
    top: 1.5,
    stoop: 0.03,
    hood: vector(0, 1.64, -0.02), hoodTilt: -0.2,
    opening: vector(0, 0.2, -0.98),
    face: vector(0, 1.63, -0.12),
    shoulder: vector(0.23, 1.35, 0.0), cuff: vector(0.13, 1.13, -0.24),
    hand: vector(0.1, 1.13, -0.28),
    book: { open: false, at: vector(0, 1.16, -0.25), tilt: -0.18 },
  },
  // Sitting on the floor, the robe spread round the knees, bowed over a book
  // open in the lap.
  seated: {
    robe: [[0.0, 0.0], [0.44, 0.0], [0.45, 0.06], [0.38, 0.14], [0.29, 0.22],
      [0.25, 0.5], [0.25, 0.7], [0.22, 0.83], [0.14, 0.92], [0.0, 0.95]],
    top: 0.95,
    stoop: 0.1,
    lap: true,
    hood: vector(0, 1.03, -0.1), hoodTilt: 0.45,
    opening: vector(0, -0.62, -0.78),
    face: vector(0, 0.95, -0.19),
    shoulder: vector(0.23, 0.79, -0.02), cuff: vector(0.13, 0.44, -0.3),
    hand: vector(0.1, 0.42, -0.34),
    book: { open: true, at: vector(0, 0.4, -0.38), tilt: 0.45 },
  },
});

// Heavy cloth hangs in pleats, deepest at the hem and smoothed out where it
// is drawn over the shoulders. Ten of them, so the robe is the same all round
// and mirrors about its centre line.
const PLEATS = 10;
function pleat(x, z) {
  return Math.cos(PLEATS * Math.atan2(x, z));
}
function folded(geometry, top) {
  const position = geometry.getAttribute('position');
  for (let vertex = 0; vertex < position.count; vertex++) {
    const x = position.getX(vertex);
    const z = position.getZ(vertex);
    const depth = 0.05 * Math.max(0, 1 - position.getY(vertex) / top);
    const scale = 1 + depth * pleat(x, z);
    position.setX(vertex, x * scale);
    position.setZ(vertex, z * scale);
  }
  return geometry;
}
// The troughs of the pleats are in shadow, as in an engraving's hatching.
function clothTint(base) {
  const shade = new THREE.Color();
  return point => shade.copy(base).lerp(ROBE_FOLD, 0.45 * (1 - pleat(point.x, point.z)) / 2);
}

function lathe(profile) {
  return new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height)), 40);
}

function capeGeometry(top) {
  // The hood's cape, lying over the shoulders and falling to the upper arm.
  const lift = top - 1.5;
  return folded(lathe([
    [0.0, 1.2], [0.29, 1.2], [0.3, 1.26], [0.27, 1.38], [0.18, 1.49], [0.0, 1.52],
  ].map(([radius, height]) => [radius, height + lift])), 3);
}

// Colour every vertex of a piece one colour, or let `tint` decide per vertex.
function coloured(geometry, color, tint = null) {
  // Normals are taken while the piece is still indexed, so the cloth is
  // smooth rather than faceted.
  geometry.computeVertexNormals();
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  const point = new THREE.Vector3();
  const facing = new THREE.Vector3();
  for (let vertex = 0; vertex < position.count; vertex++) {
    point.fromBufferAttribute(position, vertex);
    facing.fromBufferAttribute(normal, vertex);
    const shade = tint ? tint(point, facing) : color;
    colors.set([shade.r, shade.g, shade.b], vertex * 3);
  }
  source.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return source;
}

function placed(geometry, position, rotation = new THREE.Euler(), scale = new THREE.Vector3(1, 1, 1)) {
  return geometry.applyMatrix4(new THREE.Matrix4().compose(
    position,
    new THREE.Quaternion().setFromEuler(rotation),
    scale,
  ));
}

// A sleeve from shoulder to cuff, widening towards the cuff as a monk's does.
function sleeve(pose, side) {
  const shoulder = pose.shoulder.clone().setX(side * pose.shoulder.x);
  const cuff = pose.cuff.clone().setX(side * pose.cuff.x);
  const length = shoulder.distanceTo(cuff);
  const geometry = new THREE.CylinderGeometry(0.075, 0.105, length, 12, 1);
  // Cylinder runs along +y from bottom (radiusBottom) to top (radiusTop); the
  // top is the shoulder, the wide bottom the cuff.
  const direction = shoulder.clone().sub(cuff).normalize();
  const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  geometry.applyQuaternion(orientation);
  geometry.translate((shoulder.x + cuff.x) / 2, (shoulder.y + cuff.y) / 2, (shoulder.z + cuff.z) / 2);
  return coloured(geometry, ROBE);
}

// The book in both hands: open and tipped up towards the face, or closed and
// held upright against the chest.
function bookPieces({ open, at, tilt }) {
  const toHands = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z)
    .multiply(new THREE.Matrix4().makeRotationX(open ? tilt : Math.PI / 2 + tilt));
  if (!open) return [coloured(new THREE.BoxGeometry(0.2, 0.05, 0.27).applyMatrix4(toHands), COVER)];
  const pieces = [];
  for (const side of [-1, 1]) {
    const leaf = new THREE.BoxGeometry(0.13, 0.024, 0.19);
    leaf.applyMatrix4(new THREE.Matrix4().makeRotationZ(-side * 0.2));
    leaf.translate(side * 0.066, 0.016, 0);
    pieces.push(coloured(leaf.applyMatrix4(toHands), PAGE));
  }
  const cover = new THREE.BoxGeometry(0.29, 0.012, 0.205);
  pieces.push(coloured(cover.applyMatrix4(toHands), COVER));
  return pieces;
}

function figureGeometry(pose) {
  // How far the monk bends: the top of the robe is carried forward of the
  // hem, growing with height the way a bent back does.
  const lean = geometry => {
    const position = geometry.getAttribute('position');
    for (let vertex = 0; vertex < position.count; vertex++) {
      const rise = Math.min(1, Math.max(0, position.getY(vertex) / pose.top));
      position.setZ(vertex, position.getZ(vertex) - pose.stoop * rise ** 2);
    }
    return geometry;
  };

  // The cowl. The part of it facing forward is the opening, and inside it is
  // dark.
  const opening = pose.opening.clone().normalize();
  const hood = coloured(
    placed(
      new THREE.SphereGeometry(0.2, 18, 14),
      pose.hood,
      new THREE.Euler(pose.hoodTilt, 0, 0),
      new THREE.Vector3(0.95, 1.1, 1.18),
    ),
    null,
    (point, facing) => (facing.dot(opening) > 0.42 ? HOOD_SHADOW : ROBE),
  );
  // The point of the hood, falling back between the shoulders.
  const peak = coloured(
    placed(
      new THREE.ConeGeometry(0.1, 0.26, 12),
      pose.hood.clone().add(vector(0, 0.06, 0.16)),
      new THREE.Euler(-1.0, 0, 0),
    ),
    ROBE,
  );
  // What little shows of a face, deep in the cowl.
  const face = coloured(
    placed(new THREE.SphereGeometry(0.085, 10, 8), pose.face, new THREE.Euler(), new THREE.Vector3(0.9, 1.1, 0.8)),
    FACE,
  );

  const pieces = [
    lean(coloured(folded(lathe(pose.robe), pose.top), null, clothTint(ROBE))),
    lean(coloured(capeGeometry(pose.top), null, clothTint(CAPE))),
    hood,
    peak,
    face,
    sleeve(pose, -1),
    sleeve(pose, 1),
    ...[-1, 1].map(side => coloured(
      placed(new THREE.SphereGeometry(0.045, 10, 8), pose.hand.clone().setX(side * pose.hand.x)),
      SKIN,
    )),
    ...bookPieces(pose.book),
  ];
  if (pose.lap) {
    // The knees under the robe, crossed in front of the sitter.
    pieces.push(coloured(
      placed(new THREE.SphereGeometry(1, 24, 12), vector(0, 0.1, -0.22), new THREE.Euler(), vector(0.37, 0.18, 0.31)),
      null,
      clothTint(ROBE),
    ));
  }
  return mergeNonIndexed(pieces);
}

function mergeNonIndexed(pieces) {
  const count = pieces.reduce((sum, piece) => sum + piece.getAttribute('position').count, 0);
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const array = new Float32Array(count * 3);
    let offset = 0;
    for (const piece of pieces) {
      const attribute = piece.getAttribute(name);
      array.set(attribute.array, offset);
      offset += attribute.array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, 3));
  }
  for (const piece of pieces) piece.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// --- where they are ---------------------------------------------------------------

// Distances below are measured from the centre of the chamber at right angles
// to a wall, in the frame of wallBasis(): `normal` outwards, `tangent` along it.
// Between 39.6 and 43.2 the whole floor round the well is clear on every
// level, past the guard, short of the cabinets and clear of the spiral stairs.
//
// Watchers stand just inside the railing, walkers and travellers each keep
// their own ring, and searchers and sitters are at the cabinets; every ring is
// far enough from the next that robes pass without touching.
const WATCH_AT = 39.55;
const WALK_LANES = Object.freeze([40.5, 42.4, 43.2]);
const TRAVEL_LANE = 41.45;
const SEARCH_AT = 44.5;
const SIT_AT = 44.3;
// Places along a shelved wall where a searcher or sitter may be, and where a
// watcher may stand at the railing in front of it.
const SHELF_PLACES = Object.freeze([-16, -8, 0, 8, 16]);
const WATCH_PLACES = Object.freeze([-8, 8]);
// A traveller keeps to one side of the passage going in and the other coming
// out, so two of them never meet head on in a doorway. Round the well, all the
// travellers of a chamber go the same way, so they never meet head on there
// either.
const KEEP_SIDE = 0.8;
// Where a traveller comes into view, and where it is last seen: near the far
// end of the passage, in the half dark.
const PASSAGE_END = HALL_END - 0.8;

const WALK_SPEED = 0.5;
// A traveller is going somewhere, and walks a little faster.
const TRAVEL_SPEED = 0.7;
const SEARCH_STEP = 0.7;
// Turning is the way a person does it, not on the spot.
const TURN_RATE = 1.6;
// How near the walker may come before a moving figure stops rather than walk
// into them, and how near two figures may come to each other.
const KEEP_CLEAR = PLAYER_RADIUS + 1.1;
const KEEP_APART = 0.95;
// Two figures that have waited on each other this long stop being polite.
const PATIENCE = 3;
// How much floor a figure takes up, for the walker bumping into one.
const BODY_RADIUS = 0.45;

const MOVERS = 5;
const STANDERS = 4;
const SITTERS = 3;

function hexCorner(apothem, corner) {
  const radius = apothem / Math.cos(Math.PI / 6);
  const angle = corner * Math.PI / 3;
  return { x: radius * Math.cos(angle), z: radius * Math.sin(angle) };
}

function onWall(wall, normal, tangent) {
  const basis = wallBasis(wall);
  return { x: basis.nx * normal + basis.tx * tangent, z: basis.nz * normal + basis.tz * tangent };
}

// A path is a list of points with the length walked to reach each one.
function pathFrom(points, closed) {
  const all = closed ? [...points, points[0]] : points;
  const lengths = [0];
  for (let index = 1; index < all.length; index++) {
    lengths.push(lengths[index - 1] + Math.hypot(all[index].x - all[index - 1].x, all[index].z - all[index - 1].z));
  }
  return { points: all, lengths, length: lengths[lengths.length - 1], closed };
}

function pointOn(path, distance) {
  const along = path.closed
    ? ((distance % path.length) + path.length) % path.length
    : Math.min(path.length, Math.max(0, distance));
  let index = 1;
  while (index < path.lengths.length - 1 && path.lengths[index] < along) index++;
  const from = path.points[index - 1];
  const to = path.points[index];
  const span = path.lengths[index] - path.lengths[index - 1] || 1;
  const fraction = (along - path.lengths[index - 1]) / span;
  return { x: from.x + (to.x - from.x) * fraction, z: from.z + (to.z - from.z) * fraction };
}

// The ring round the well at one distance, corners on the axes kπ/3.
function laneLoop(apothem) {
  return pathFrom([0, 1, 2, 3, 4, 5].map(corner => hexCorner(apothem, corner)), true);
}

// In from the far end of one passage, half way round the well and out by the
// passage opposite. The ends of the side facing wall k are corners k and k + 1.
function crossing(entry, turn) {
  const exit = (entry + 3) % 6;
  const corners = turn > 0 ? [entry + 1, entry + 2, entry + 3] : [entry, entry - 1, entry - 2];
  return pathFrom([
    onWall(entry, PASSAGE_END, KEEP_SIDE),
    onWall(entry, TRAVEL_LANE, KEEP_SIDE),
    ...corners.map(corner => hexCorner(TRAVEL_LANE, corner)),
    onWall(exit, TRAVEL_LANE, -KEEP_SIDE),
    onWall(exit, PASSAGE_END, -KEEP_SIDE),
  ], false);
}

function headingTowards(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function shuffled(items, seed, salt) {
  const bag = [...items];
  for (let index = bag.length - 1; index > 0; index--) {
    const other = draw(seed, salt + index) % (index + 1);
    [bag[index], bag[other]] = [bag[other], bag[index]];
  }
  return bag;
}

/**
 * Who keeps a chamber, and what each is doing: a pure function of its index.
 * Every chamber has a searcher, a sitter and a traveller; the rest are drawn
 * from a bag, so no pose ever has more figures than its mesh can hold.
 */
export function librariansFor(q, r, level) {
  const seed = seedFor(worldRoomIndexFor(q, r, level));
  let count = 3 + draw(seed, 21) % 8;
  // The first chamber shows the walker every kind of keeper at once.
  if (q === 0n && r === 0n && level === 0n) count = Math.max(count, 8);
  const bag = shuffled(
    ['walker', 'walker', 'walker', 'searcher', 'sitter', 'sitter', 'watcher', 'watcher', 'traveller'],
    seed,
    100,
  );
  const roles = ['searcher', 'sitter', 'traveller', ...bag.slice(0, count - 3)];

  const doors = freeWallsForLevel(level).map(Number);
  const shelved = [0, 1, 2, 3, 4, 5].filter(wall => !doors.includes(wall));
  const shelfPlaces = shuffled(shelved.flatMap(wall => SHELF_PLACES.map(tangent => ({ wall, tangent }))), seed, 200);
  const watchPlaces = shuffled(shelved.flatMap(wall => WATCH_PLACES.map(tangent => ({ wall, tangent }))), seed, 300);
  const lanes = shuffled(WALK_LANES, seed, 400);
  const turn = draw(seed, 450) % 2 === 0 ? 1 : -1;
  let travellers = 0;

  return roles.map((role, index) => {
    const own = draw(seed, 500 + index);
    const figure = {
      role,
      seed: own,
      // Which line of the notebook this one is on.
      line: own % RING_LINES.length,
      phase: (draw(own, 1) % 628) / 100,
      waited: 0,
      gone: 0,
    };
    if (role === 'walker') {
      const path = laneLoop(lanes.pop());
      return {
        ...figure,
        path,
        distance: (draw(own, 2) % 10000) / 10000 * path.length,
        direction: draw(own, 3) % 2 === 0 ? 1 : -1,
        walkFor: 8 + (draw(own, 4) % 1400) / 100,
        pauseFor: 0,
        stops: 0,
      };
    }
    if (role === 'traveller') {
      // A second traveller starts from the other passage, so the two go round
      // opposite halves of the well.
      const entry = doors[(draw(own, 2) + travellers++) % 2];
      const path = crossing(entry, turn);
      return {
        ...figure,
        doors,
        turn,
        path,
        distance: (draw(own, 3) % 10000) / 10000 * path.length,
        direction: 1,
        speed: TRAVEL_SPEED,
        trips: 0,
      };
    }
    if (role === 'watcher') {
      const { wall, tangent } = watchPlaces.pop();
      return { ...figure, wall, normal: WATCH_AT, tangent };
    }
    const { wall, tangent } = shelfPlaces.pop();
    return {
      ...figure,
      wall,
      normal: role === 'searcher' ? SEARCH_AT : SIT_AT,
      tangent,
      home: tangent,
      target: tangent,
      // A searcher looks for a while, then steps along the shelf.
      stayFor: 4 + (draw(own, 2) % 800) / 100,
      stops: 0,
    };
  });
}

// --- in the scene -------------------------------------------------------------------

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
function poseMesh(name, pose, capacity) {
  const mesh = new THREE.InstancedMesh(figureGeometry(pose), material, capacity);
  mesh.name = name;
  mesh.userData.librarians = true;
  mesh.count = 0;
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // The instances are spread round the whole chamber, so the figure's own
  // bounds say nothing about where they are.
  mesh.frustumCulled = false;
  return mesh;
}

const walkingMesh = poseMesh('librarians-walking', POSES.walking, MOVERS);
const standingMesh = poseMesh('librarians-standing', POSES.standing, STANDERS);
const seatedMesh = poseMesh('librarians-seated', POSES.seated, SITTERS);
export const librarianMeshes = Object.freeze([walkingMesh, standingMesh, seatedMesh]);

const MESH_FOR = Object.freeze({
  walker: walkingMesh, traveller: walkingMesh, searcher: standingMesh, watcher: standingMesh, sitter: seatedMesh,
});

let figures = [];
const pose = new THREE.Object3D();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

/** Puts the chamber's own librarians in it. Call on every change of chamber. */
export function placeLibrarians(room) {
  figures = librariansFor(room.q, room.r, room.level);
  for (const mesh of librarianMeshes) mesh.count = 0;
  for (const figure of figures) {
    const mesh = MESH_FOR[figure.role];
    figure.mesh = mesh;
    figure.slot = mesh.count++;
    if (figure.path) {
      const at = pointOn(figure.path, figure.distance);
      figure.x = at.x;
      figure.z = at.z;
      figure.heading = headingTowards(at, pointOn(figure.path, figure.distance + figure.direction * 0.6));
    } else {
      settle(figure);
    }
  }
  for (const mesh of librarianMeshes) mesh.visible = mesh.count > 0;
  updateLibrarians(0, null);
}

// Where a figure that keeps one place stands, and which way it faces: at the
// shelves, towards them; sitting, away from them; at the railing, to the well.
function settle(figure) {
  const at = onWall(figure.wall, figure.normal, figure.tangent);
  figure.x = at.x;
  figure.z = at.z;
  const outwards = onWall(figure.wall, figure.normal + 1, figure.tangent);
  const facing = figure.role === 'searcher' ? outwards : { x: 2 * at.x - outwards.x, z: 2 * at.z - outwards.z };
  figure.heading = headingTowards(at, facing);
}

function closing(next, from, other, limit) {
  const after = Math.hypot(next.x - other.x, next.z - other.z);
  return after < limit && after < Math.hypot(from.x - other.x, from.z - other.z);
}

function blocked(figure, next, walker) {
  if (walker && closing(next, figure, walker, KEEP_CLEAR)) return true;
  if (figure.waited > PATIENCE) return false;
  return figures.some(other => other !== figure && !(other.gone > 0) && closing(next, figure, other, KEEP_APART));
}

function walkOn(figure, delta, walker) {
  const step = figure.direction * (figure.speed ?? WALK_SPEED) * delta;
  const next = pointOn(figure.path, figure.distance + step);
  if (delta > 0 && blocked(figure, next, walker)) {
    figure.waited += delta;
    return false;
  }
  figure.waited = 0;
  figure.distance += step;
  figure.phase += delta * 3.4;
  figure.x = next.x;
  figure.z = next.z;
  return delta > 0;
}

function turnTowards(figure, target, delta) {
  const turn = wrapAngle(target - figure.heading);
  figure.heading += Math.sign(turn) * Math.min(Math.abs(turn), TURN_RATE * delta);
}

function updateWalker(figure, delta, walker) {
  let moving = false;
  if (figure.pauseFor > 0) {
    figure.pauseFor -= delta;
  } else if (walkOn(figure, delta, walker)) {
    moving = true;
    figure.walkFor -= delta;
    if (figure.walkFor <= 0) {
      figure.stops++;
      figure.pauseFor = 5 + (draw(figure.seed, 10 + figure.stops * 2) % 900) / 100;
      figure.walkFor = 10 + (draw(figure.seed, 11 + figure.stops * 2) % 1800) / 100;
    }
  }
  const ahead = pointOn(figure.path, figure.distance + figure.direction * 0.6);
  turnTowards(figure, headingTowards(figure, ahead), delta);
  return moving;
}

function updateTraveller(figure, delta, walker) {
  if (figure.gone > 0) {
    figure.gone -= delta;
    if (figure.gone > 0) return false;
    // Somebody else comes in, by either passage, unless someone else is
    // just coming in that way.
    const entry = figure.doors[draw(figure.seed, 20 + figure.trips + 1) % 2];
    const path = crossing(entry, figure.turn);
    const at = pointOn(path, 0);
    if (figures.some(other => other !== figure && !(other.gone > 0) && Math.hypot(other.x - at.x, other.z - at.z) < 3)) {
      figure.gone = 2;
      return false;
    }
    figure.trips++;
    figure.path = path;
    figure.distance = 0;
    figure.x = at.x;
    figure.z = at.z;
    figure.heading = headingTowards(at, pointOn(figure.path, 0.6));
  }
  const moving = walkOn(figure, delta, walker);
  if (figure.distance >= figure.path.length) {
    // Out of sight down the passage, on to the next chamber.
    figure.gone = 3 + (draw(figure.seed, 60 + figure.trips) % 900) / 100;
    return false;
  }
  const ahead = pointOn(figure.path, figure.distance + 0.6);
  turnTowards(figure, headingTowards(figure, ahead), delta);
  return moving;
}

function updateSearcher(figure, delta, walker) {
  if (figure.target === figure.tangent) {
    figure.stayFor -= delta;
    if (figure.stayFor <= 0) {
      figure.stops++;
      figure.target = figure.home + ((draw(figure.seed, 80 + figure.stops) % 5) - 2) * SEARCH_STEP;
      figure.stayFor = 5 + (draw(figure.seed, 90 + figure.stops) % 1000) / 100;
    }
    return false;
  }
  const gap = figure.target - figure.tangent;
  const step = Math.sign(gap) * Math.min(Math.abs(gap), 0.35 * delta);
  const next = onWall(figure.wall, figure.normal, figure.tangent + step);
  if (walker && closing(next, figure, walker, KEEP_CLEAR)) return false;
  figure.tangent += step;
  figure.phase += delta * 3.4;
  settle(figure);
  return true;
}

/**
 * Moves every librarian on by `delta` seconds. `walker` is the camera
 * position, or null; a figure that would walk into the walker waits instead.
 */
export function updateLibrarians(delta, walker) {
  const now = performance.now() / 1000;
  for (const figure of figures) {
    let moving = false;
    if (figure.role === 'walker') moving = updateWalker(figure, delta, walker);
    else if (figure.role === 'traveller') moving = updateTraveller(figure, delta, walker);
    else if (figure.role === 'searcher') moving = updateSearcher(figure, delta, walker);

    if (figure.gone > 0) {
      figure.mesh.setMatrixAt(figure.slot, hidden);
      continue;
    }
    // A slow step shows only as a slight rise and a sway of the robe; a figure
    // standing still is still, but for its breathing.
    const step = moving ? Math.abs(Math.sin(figure.phase)) : 0;
    const breath = moving ? 0 : 0.005 * Math.sin(figure.phase + now * 1.3);
    pose.position.set(figure.x, 0.012 * step, figure.z);
    pose.rotation.set(0, figure.heading, moving ? 0.018 * Math.sin(figure.phase) : 0, 'YXZ');
    pose.scale.set(1, 1 + breath, 1);
    pose.updateMatrix();
    figure.mesh.setMatrixAt(figure.slot, pose.matrix);
  }
  for (const mesh of librarianMeshes) mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Keeps the walker from passing through a librarian: a point on the floor
 * inside a figure is moved out to its edge. `position` is changed in place.
 */
export function keepOutOfLibrarians(position) {
  for (const figure of figures) {
    if (figure.gone > 0) continue;
    // A sitter's knees reach forward of where it sits.
    const reach = figure.role === 'sitter' ? 0.22 : 0;
    const cx = figure.x - Math.sin(figure.heading) * reach;
    const cz = figure.z - Math.cos(figure.heading) * reach;
    const dx = position.x - cx;
    const dz = position.z - cz;
    const distance = Math.hypot(dx, dz);
    const limit = BODY_RADIUS + PLAYER_RADIUS;
    if (distance >= limit || distance < 1e-6) continue;
    position.x = cx + dx / distance * limit;
    position.z = cz + dz / distance * limit;
  }
}

// --- what they whisper ------------------------------------------------------------

// Near enough to make out the words, and near enough to hear the murmur.
const WORDS_WITHIN = 3.2;
const MURMUR_WITHIN = 11;
// How long a line takes to whisper before the next one.
const LINE_SECONDS = 7;

let speaker = null;
let spokenFor = 0;

/**
 * What the walker at `listener`, looking along `yaw`, hears over `delta`
 * seconds: the line the nearest librarian is whispering if they are close
 * enough to make it out, and the murmur of the nearest two as
 * { level 0..1, pan −1..1 }. Staying by one librarian, the walker hears the
 * notebook line after line.
 */
export function listenToLibrarians(listener, yaw, delta) {
  const near = [];
  for (const figure of figures) {
    if (figure.gone > 0) continue;
    const dx = figure.x - listener.x;
    const dz = figure.z - listener.z;
    // Mouths are at head height; the walker may be up on a gallery.
    const dy = (figure.role === 'sitter' ? 0.95 : 1.5) - listener.y;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < MURMUR_WITHIN) near.push({ figure, distance, dx, dz });
  }
  near.sort((a, b) => a.distance - b.distance);

  let caption = null;
  const closest = near[0];
  if (closest && closest.distance < WORDS_WITHIN) {
    if (speaker !== closest.figure) {
      speaker = closest.figure;
      spokenFor = 0;
    }
    spokenFor += delta;
    if (spokenFor > LINE_SECONDS) {
      spokenFor = 0;
      speaker.line = (speaker.line + 1) % RING_LINES.length;
    }
    caption = RING_LINES[speaker.line];
  } else {
    speaker = null;
  }

  // The camera looks along −z turned by yaw, so its right is (cos yaw, −sin yaw).
  const murmurs = near.slice(0, 2).map(({ distance, dx, dz }) => ({
    level: (1 - distance / MURMUR_WITHIN) ** 2,
    pan: Math.max(-1, Math.min(1, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(distance, 0.5))),
  }));
  return { caption, murmurs };
}
