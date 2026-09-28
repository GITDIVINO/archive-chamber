/**
 * The head.
 *
 * In one chamber of the library, and only one, a stone head lies in the well:
 * a face as high as two storeys, tipped back against the shaft with its eyes
 * shut, as if it had been set down there before the shelves were built round
 * it and nobody had since found a way to move it. Nothing in the catalogue
 * mentions it.
 *
 * It lies beside the bridge, not under it, with the line of its face on the
 * chamber's cross-axis, so the chamber stays symmetric about that axis and the
 * flight still climbs clear past its brow. Walkers see it from the floor across
 * the guard, from the bridge a few metres from its nose, from the galleries
 * level with its eyes, and from the storeys above and below down the well.
 *
 * The shape is a sphere pressed into a head: the skull's proportions first,
 * then brow, sockets and lids, nose, lips and chin raised or cut as smooth
 * swellings, and a web of cracks dark in the stone.
 */

import * as THREE from 'three';
import { STAIR_WELL_EDGE, WALL_HEIGHT } from '../constants.js';
import { passageExits } from './passage.js';
import { sharedGeometries } from './geometry.js';

// The chamber it lies in: through the doorway beside which a walker first
// wakes, straight on across the passage.
const WAKING_CHAMBER = { q: 0n, r: 0n, level: 0n };
const WAKING_DOOR_WALL = 5;
export const HEAD_CHAMBER = Object.freeze(passageExits(WAKING_CHAMBER, WAKING_DOOR_WALL).ahead);

export function isHeadColumn(hex) {
  return hex.q === HEAD_CHAMBER.q && hex.r === HEAD_CHAMBER.r;
}

// Seen down the well from this many storeys away at most; the shaft itself
// ends there. See VERTICAL_VISTA_DEPTH.
const HEAD_VISIBLE_STOREYS = 8n;

/**
 * The head as seen from chamber `hex`, placed in that chamber's frame, or null
 * when it is not in view from there: only the chamber it lies in and those
 * stacked above and below it look into its well.
 */
export function headSeenFrom(hex) {
  if (!isHeadColumn(hex)) return null;
  const storeys = HEAD_CHAMBER.level - hex.level;
  if (storeys > HEAD_VISIBLE_STOREYS || storeys < -HEAD_VISIBLE_STOREYS) return null;
  const head = makeHead();
  head.position.y += Number(storeys) * WALL_HEIGHT;
  return head;
}

// Two and a half storeys from chin to crown.
const HEAD_HEIGHT = 2.5 * WALL_HEIGHT;
// Across the well from the bridge, its face turned to it. Its nose comes to
// within a few metres of the rail.
const HEAD_OFFSET = 21;
// Tipped back so the face looks up the shaft, and sunk so the chin is below
// this chamber's floor and the crown a storey under it.
const HEAD_TILT = 0.5;
const HEAD_CENTRE_Y = -0.15 * HEAD_HEIGHT;
// How strongly the features are cut. The swellings below are written at the
// scale of a face; the stone is carved deeper than a face is.
const RELIEF = 1.7;

const gauss = (distanceSquared, radius) => Math.exp(-distanceSquared / (radius * radius));
const smooth = (edge0, edge1, value) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// A few crossed sine waves, cheap and deterministic, whose zero lines wander
// over the stone like cracks.
function crackField(x, y, z) {
  return Math.sin(9.1 * x + 3.3 * y + 0.4)
    + Math.sin(7.7 * y - 5.1 * z + 1.3)
    + Math.sin(8.3 * z + 4.9 * x + 0.7)
    + 0.5 * Math.sin(21 * x - 17 * y + 13 * z);
}

function sculpt(direction, target) {
  let { x, y, z } = direction;
  // The skull: narrower than it is tall, deeper than it is wide, the jaw
  // narrowing below the cheekbones.
  x *= 0.76 * (1 - 0.2 * smooth(-0.05, -0.9, y));
  z *= 0.9;
  y *= 1.02;
  const front = smooth(0.25, 0.75, direction.z);
  let proud = 0;
  // The face is flatter than the rest of the head.
  proud -= 0.07 * front;
  // Brow ridge, and the sockets under it, and the shut lids in the sockets.
  proud += 0.055 * front * Math.exp(-(((y - 0.27) / 0.06) ** 2)) * smooth(0.62, 0.3, Math.abs(x));
  for (const side of [-1, 1]) {
    const socket = (x - side * 0.27) ** 2 + ((y - 0.13) * 1.25) ** 2;
    proud -= 0.12 * front * gauss(socket, 0.15);
    proud += 0.075 * front * gauss(socket, 0.1);
    // The fold of the lid across the eye.
    proud -= 0.018 * front * gauss((x - side * 0.27) ** 2 * 0.3 + (y - 0.1) ** 2, 0.018);
    // Cheekbones.
    proud += 0.05 * front * gauss((x - side * 0.38) ** 2 + (y + 0.1) ** 2, 0.15);
    // The wings of the nose, and the nostrils.
    proud += 0.05 * front * gauss((x - side * 0.075) ** 2 + (y + 0.2) ** 2, 0.05);
    proud -= 0.03 * front * gauss((x - side * 0.05) ** 2 + (y + 0.235) ** 2, 0.025);
  }
  // The nose: a ridge from between the eyes growing out to the tip.
  const along = smooth(0.14, -0.2, y) * smooth(-0.27, -0.2, y);
  proud += front * Math.exp(-((x / 0.07) ** 2)) * along * (0.04 + 0.2 * smooth(0.14, -0.19, y));
  proud += 0.05 * front * gauss(x * x + (y + 0.19) ** 2, 0.07);
  // The mouth: the upper lip, the line between, the lower lip; and the chin.
  proud += 0.04 * front * gauss((x / 1.8) ** 2 + (y + 0.35) ** 2, 0.04);
  proud -= 0.035 * front * gauss((x / 2.2) ** 2 + (y + 0.405) ** 2, 0.014);
  proud += 0.05 * front * gauss((x / 1.5) ** 2 + (y + 0.46) ** 2, 0.045);
  proud += 0.05 * front * gauss(x * x + (y + 0.66) ** 2, 0.12);

  const crack = Math.abs(crackField(direction.x, direction.y, direction.z));
  const inCrack = crack < 0.08 ? 1 - crack / 0.08 : 0;
  // Relief, not the face's general flattening, is what the hollows are: the
  // deeper a point is cut the less light reaches it.
  const hollow = Math.max(0, -(proud + 0.07 * front));
  proud = proud * RELIEF - 0.01 * inCrack;
  const length = 1 + proud;
  target.set(x * length, y * length, z * length);
  return (1 - 0.6 * inCrack) * (1 - Math.min(0.6, hollow * 7));
}

let headGeometry = null;
function buildHeadGeometry() {
  const geometry = new THREE.SphereGeometry(1, 180, 140);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const direction = new THREE.Vector3();
  const sculpted = new THREE.Vector3();
  for (let vertex = 0; vertex < position.count; vertex++) {
    // SphereGeometry's poles are on y, which is where a head's are too, and
    // its seam is at -z, which is the back of it.
    direction.fromBufferAttribute(position, vertex).normalize();
    const tone = sculpt(direction, sculpted);
    position.setXYZ(vertex, sculpted.x, sculpted.y, sculpted.z);
    // Weathered unevenly: paler on the brow and cheeks the drips run off,
    // darker in the hollows.
    const weather = 0.82 + 0.18 * Math.sin(3.1 * direction.x + 2.3 * direction.y) * Math.sin(2.7 * direction.z + 1.1);
    const shade = tone * weather;
    colors.set([shade, shade, shade], vertex * 3);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.scale(HEAD_HEIGHT / 2, HEAD_HEIGHT / 2, HEAD_HEIGHT / 2);
  return geometry;
}

const headMaterial = new THREE.MeshStandardMaterial({
  color: 0x6f6b62,
  vertexColors: true,
  roughness: 0.95,
  metalness: 0,
});

/**
 * The head, placed in its chamber's own frame: the chamber's centre at the
 * origin, its floor at y = 0.
 */
export function makeHead() {
  if (!headGeometry) {
    headGeometry = buildHeadGeometry();
    // Built once and kept: the chamber it rides in is released on leaving.
    sharedGeometries.add(headGeometry);
  }
  const head = new THREE.Mesh(headGeometry, headMaterial);
  // The bridge crosses along the stair edge's normal; the head lies off to one
  // side of it, on the cross-axis, face turned back towards it.
  const bridge = Math.PI / 6 + STAIR_WELL_EDGE * Math.PI / 3;
  const across = bridge + Math.PI / 2;
  head.position.set(Math.cos(across) * HEAD_OFFSET, HEAD_CENTRE_Y, Math.sin(across) * HEAD_OFFSET);
  // Face (+z) towards the bridge, then tipped back to look up the shaft.
  head.rotation.order = 'YXZ';
  head.rotation.y = Math.atan2(-Math.cos(across), -Math.sin(across));
  head.rotation.x = -HEAD_TILT;
  head.castShadow = false;
  head.receiveShadow = true;
  head.raycast = () => {};
  head.userData.landmark = 'head';
  return head;
}
