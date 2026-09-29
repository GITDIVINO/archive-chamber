/**
 * Librarians: the hooded readers who walk the chamber floor.
 *
 * The story is about the people who spend their lives in the library, and
 * until now the only sign of them was what they left behind (traces.js). These
 * are the people themselves: a figure in a long robe, hood drawn over a bowed
 * head, reading from an open book held low in both hands. They walk the floor
 * round the well slowly, stop to read, walk on. Nothing about them speaks or
 * turns to the walker; they are simply there, as the story says they are.
 *
 * Two rules keep them part of the world rather than decoration.
 *
 * They are **derived from the chamber's own index**, like the traces: how many
 * walk a chamber, which lane each keeps, which way it goes and when it stops
 * to read are all drawn from that number, so the same chamber is always kept
 * by the same readers. The walker's first chamber always has one: somebody
 * left the notebook there.
 *
 * They **cost one draw call**. Every reader is an instance of one merged,
 * vertex-coloured figure, so a chamber with three of them draws exactly what a
 * chamber with one does. They cast no shadow: the shadow maps are baked once
 * per chamber (view.js) and a moving caster would force them to be redrawn.
 *
 * The figure is symmetric about its own centre line, like everything else in
 * the building.
 */

import * as THREE from 'three';
import { worldRoomIndexFor } from '../../world-engine.js';
import { PLAYER_RADIUS } from '../constants.js';
import { draw, seedFor } from './traces.js';

// --- the figure ---------------------------------------------------------------

const ROBE = new THREE.Color(0x4a3a2d);
const ROBE_FOLD = new THREE.Color(0x1f1712);
const CAPE = new THREE.Color(0x3f3127);
const HOOD_SHADOW = new THREE.Color(0x0a0706);
const FACE = new THREE.Color(0x4a3428);
const SKIN = new THREE.Color(0x8c6a52);
const PAGE = new THREE.Color(0xe8dec6);
const COVER = new THREE.Color(0x3c2118);

// How far the reader stoops over the book: the top of the robe is carried this
// far forward of the hem, growing with height the way a bent back does.
const STOOP = 0.16;
const stoop = y => STOOP * Math.min(1, Math.max(0, y / 1.5)) ** 2;

function robeGeometry() {
  // Hem, knee, waist, chest, shoulder, neck: a bell that falls to the floor
  // and spreads a little on it, so there are no feet and no gait to animate.
  const profile = [
    [0.0, 0.0], [0.43, 0.0], [0.41, 0.06], [0.35, 0.35], [0.29, 0.75],
    [0.25, 1.05], [0.25, 1.25], [0.22, 1.38], [0.14, 1.47], [0.0, 1.5],
  ].map(([radius, height]) => new THREE.Vector2(radius, height));
  return folded(new THREE.LatheGeometry(profile, 40), 1.5);
}

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

function capeGeometry() {
  // The hood's cape, lying over the shoulders and falling to the upper arm.
  const profile = [
    [0.0, 1.2], [0.29, 1.2], [0.3, 1.26], [0.27, 1.38], [0.18, 1.49], [0.0, 1.52],
  ].map(([radius, height]) => new THREE.Vector2(radius, height));
  return folded(new THREE.LatheGeometry(profile, 40), 3);
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
function sleeve(side) {
  const shoulder = new THREE.Vector3(side * 0.23, 1.34, -0.02);
  const cuff = new THREE.Vector3(side * 0.12, 1.02, -0.3);
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

// The open book, held low in both hands and tipped up towards the face.
function bookPieces() {
  const tilt = new THREE.Matrix4().makeRotationX(0.85);
  const at = new THREE.Matrix4().makeTranslation(0, 1.04, -0.37);
  const toHands = at.multiply(tilt);
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

function figureGeometry() {
  const lean = geometry => {
    const position = geometry.getAttribute('position');
    for (let vertex = 0; vertex < position.count; vertex++) {
      position.setZ(vertex, position.getZ(vertex) - stoop(position.getY(vertex)));
    }
    return geometry;
  };

  // The cowl: a hood drawn forward over a bowed head. The part of it facing
  // forward and down is the opening, and inside it is dark.
  const opening = new THREE.Vector3(0, -0.45, -0.89).normalize();
  const hood = coloured(
    placed(
      new THREE.SphereGeometry(0.2, 18, 14),
      new THREE.Vector3(0, 1.6, -0.1),
      new THREE.Euler(0.35, 0, 0),
      new THREE.Vector3(0.95, 1.1, 1.18),
    ),
    null,
    (point, facing) => (facing.dot(opening) > 0.42 ? HOOD_SHADOW : ROBE),
  );
  // The point of the hood, falling back between the shoulders.
  const peak = coloured(
    placed(
      new THREE.ConeGeometry(0.1, 0.26, 12),
      new THREE.Vector3(0, 1.66, 0.06),
      new THREE.Euler(-1.0, 0, 0),
    ),
    ROBE,
  );
  // What little shows of a face, deep in the cowl.
  const face = coloured(
    placed(new THREE.SphereGeometry(0.085, 10, 8), new THREE.Vector3(0, 1.52, -0.2), new THREE.Euler(), new THREE.Vector3(0.9, 1.1, 0.8)),
    FACE,
  );

  const pieces = [
    lean(coloured(robeGeometry(), null, clothTint(ROBE))),
    lean(coloured(capeGeometry(), null, clothTint(CAPE))),
    hood,
    peak,
    face,
    sleeve(-1),
    sleeve(1),
    ...[-1, 1].map(side => coloured(
      placed(new THREE.SphereGeometry(0.045, 10, 8), new THREE.Vector3(side * 0.1, 1.02, -0.34)),
      SKIN,
    )),
    ...bookPieces(),
  ];
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

// --- where they walk ----------------------------------------------------------

// The floor round the well is a hexagonal ring whose walls face the directions
// π/6 + kπ/3, so the corners of any walk round it lie on the axes kπ/3. Between
// 39.6 and 43.2 from the centre (measured perpendicular to a wall) the whole
// ring is clear floor on every level: past the guard, short of the cabinets and
// clear of the spiral stairs. Each reader keeps its own lane inside that band,
// far enough from the others that two walking opposite ways pass cleanly.
const LANES = Object.freeze([40.2, 41.3, 42.4]);
const MAX_READERS = LANES.length;
const WALK_SPEED = 0.5;
// Readers turn corners the way a person does, not on the spot.
const TURN_RATE = 1.6;
// How near the walker may come before a reader stops rather than walk into
// them.
const KEEP_CLEAR = PLAYER_RADIUS + 1.1;

function lanePoint(apothem, distance) {
  const radius = apothem / Math.cos(Math.PI / 6);
  const side = radius;
  const perimeter = 6 * side;
  const along = ((distance % perimeter) + perimeter) % perimeter;
  const corner = Math.floor(along / side);
  const fraction = along / side - corner;
  const from = corner * Math.PI / 3;
  const to = from + Math.PI / 3;
  return {
    x: radius * (Math.cos(from) * (1 - fraction) + Math.cos(to) * fraction),
    z: radius * (Math.sin(from) * (1 - fraction) + Math.sin(to) * fraction),
    perimeter,
  };
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Who keeps a chamber: a pure function of its index. */
export function librariansFor(q, r, level) {
  const seed = seedFor(worldRoomIndexFor(q, r, level));
  // None in one chamber in six, then one, two or three, fewer more often.
  const roll = draw(seed, 21) % 6;
  let count = [0, 1, 1, 2, 2, 3][roll];
  if (q === 0n && r === 0n && level === 0n) count = Math.max(count, 1);
  const lanes = [...LANES];
  const readers = [];
  for (let index = 0; index < count; index++) {
    const lane = lanes.splice(draw(seed, 30 + index) % lanes.length, 1)[0];
    const perimeter = 6 * lane / Math.cos(Math.PI / 6);
    readers.push({
      lane,
      distance: (draw(seed, 40 + index) % 10000) / 10000 * perimeter,
      direction: draw(seed, 50 + index) % 2 === 0 ? 1 : -1,
      // Seconds walked before the first stop to read, and how long it lasts.
      walkFor: 8 + (draw(seed, 60 + index) % 1400) / 100,
      readFor: 0,
      seed: draw(seed, 70 + index),
      stops: 0,
      phase: (draw(seed, 80 + index) % 628) / 100,
    });
  }
  return readers;
}

// --- in the scene -------------------------------------------------------------

const figure = figureGeometry();
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
export const librarianMesh = new THREE.InstancedMesh(figure, material, MAX_READERS);
librarianMesh.name = 'librarians';
librarianMesh.userData.librarians = true;
librarianMesh.count = 0;
librarianMesh.castShadow = false;
librarianMesh.receiveShadow = false;
// The instances walk the whole ring, so the figure's own bounds say nothing
// about where they are.
librarianMesh.frustumCulled = false;

let readers = [];
const pose = new THREE.Object3D();

/** Puts the chamber's own readers on its floor. Call on every change of chamber. */
export function placeLibrarians(room) {
  readers = librariansFor(room.q, room.r, room.level).map(reader => {
    const start = lanePoint(reader.lane, reader.distance);
    const ahead = lanePoint(reader.lane, reader.distance + reader.direction * 0.5);
    return { ...reader, x: start.x, z: start.z, heading: Math.atan2(-(ahead.x - start.x), -(ahead.z - start.z)) };
  });
  librarianMesh.count = readers.length;
  updateLibrarians(0, null);
}

/**
 * Walks every reader on by `delta` seconds. `walker` is the camera position,
 * or null; a reader who would walk into the walker waits instead.
 */
export function updateLibrarians(delta, walker) {
  for (let index = 0; index < readers.length; index++) {
    const reader = readers[index];
    const walking = reader.readFor <= 0;
    if (walking) {
      const next = lanePoint(reader.lane, reader.distance + reader.direction * WALK_SPEED * delta);
      const blocked = walker && Math.hypot(next.x - walker.x, next.z - walker.z) < KEEP_CLEAR
        && Math.hypot(next.x - walker.x, next.z - walker.z) < Math.hypot(reader.x - walker.x, reader.z - walker.z);
      if (!blocked) {
        reader.distance += reader.direction * WALK_SPEED * delta;
        reader.walkFor -= delta;
        reader.phase += delta * 3.4;
        if (reader.walkFor <= 0) {
          reader.stops++;
          reader.readFor = 5 + (draw(reader.seed, reader.stops * 2) % 900) / 100;
          reader.walkFor = 10 + (draw(reader.seed, reader.stops * 2 + 1) % 1800) / 100;
        }
      }
    } else {
      reader.readFor -= delta;
    }
    const at = lanePoint(reader.lane, reader.distance);
    const ahead = lanePoint(reader.lane, reader.distance + reader.direction * 0.6);
    const target = Math.atan2(-(ahead.x - at.x), -(ahead.z - at.z));
    const turn = wrapAngle(target - reader.heading);
    reader.heading += Math.sign(turn) * Math.min(Math.abs(turn), TURN_RATE * delta);
    reader.x = at.x;
    reader.z = at.z;

    // A slow step shows only as a slight rise and a sway of the robe; a reader
    // standing still is still.
    const step = walking ? Math.abs(Math.sin(reader.phase)) : 0;
    pose.position.set(reader.x, 0.012 * step, reader.z);
    pose.rotation.set(0, reader.heading, walking ? 0.018 * Math.sin(reader.phase) : 0, 'YXZ');
    pose.updateMatrix();
    librarianMesh.setMatrixAt(index, pose.matrix);
  }
  librarianMesh.instanceMatrix.needsUpdate = true;
}
