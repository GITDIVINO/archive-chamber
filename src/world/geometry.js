/**
 * Geometry helpers shared by the room builder.
 *
 * Everything here exists to keep a room's draw calls proportional to its
 * materials rather than to its 640 volumes: boxes are merged into per-material
 * buffers, outlines into one buffer, and spine labels into one buffer per
 * texture atlas.
 */

import * as THREE from 'three';
import { APOTHEM, ROOM_RADIUS } from '../constants.js';

export function wallBasis(index) {
  const angle = Math.PI / 6 + index * Math.PI / 3;
  return {
    nx: Math.cos(angle), nz: Math.sin(angle),
    tx: -Math.sin(angle), tz: Math.cos(angle),
    rotation: -angle + Math.PI / 2,
  };
}

export function pointOnWall(basis, tangent, height, inward = 0) {
  return new THREE.Vector3(
    basis.nx * (APOTHEM - inward) + basis.tx * tangent,
    height,
    basis.nz * (APOTHEM - inward) + basis.tz * tangent,
  );
}

export function axialMapOffset(q, r) {
  const spacing = APOTHEM * 2;
  const localX = spacing * (Number(q) + Number(r) / 2);
  const localZ = spacing * 0.8660254 * Number(r);
  const rotation = Math.PI / 6;
  return new THREE.Vector3(
    localX * Math.cos(rotation) - localZ * Math.sin(rotation),
    0,
    localX * Math.sin(rotation) + localZ * Math.cos(rotation),
  );
}

/**
 * The six vertical arrises of the room.
 *
 * A wall normal points at PI/6 + i*PI/3 and the wall spans thirty degrees to
 * either side, so the vertices lie between them, at multiples of PI/3. Using
 * the normal angles here put each line down the middle of a wall instead —
 * invisible until a doorway was cut and one appeared standing in the opening.
 */
export function hexCorners(scale = 0.975) {
  const corners = [];
  for (let index = 0; index < 6; index++) {
    const angle = index * Math.PI / 3;
    corners.push(new THREE.Vector3(
      Math.cos(angle) * ROOM_RADIUS * scale,
      0.01,
      Math.sin(angle) * ROOM_RADIUS * scale,
    ));
  }
  return corners;
}

export const DRAFTED_INK = '#69717b';

/**
 * The hand every marking in the room is written in: a drafted caption between
 * two ruled lines with ticks at their ends.
 *
 * Shared so that the chamber tag overhead and the wall numbers on the cabinets
 * cannot drift into different lettering. Proportions are given as fractions of
 * the box, so the same treatment scales from a long hex tag to a single digit.
 */
export function drawDraftedLabel(context, box, text) {
  const { x, y, width, height } = box;
  const inset = width * 0.083;
  const tick = width * 0.112;
  const ruleTop = y + height * 0.215;
  const ruleBottom = y + height * 0.785;
  const tickReach = height * 0.047;
  context.save();
  context.strokeStyle = DRAFTED_INK;
  context.fillStyle = DRAFTED_INK;
  context.globalAlpha = 0.8;
  context.lineWidth = Math.max(1, height * 0.0137);
  context.beginPath();
  context.moveTo(x + inset, ruleTop); context.lineTo(x + width - inset, ruleTop);
  context.moveTo(x + inset, ruleBottom); context.lineTo(x + width - inset, ruleBottom);
  context.stroke();
  for (const tickX of [x + inset, x + tick, x + width - tick, x + width - inset]) {
    context.beginPath();
    context.moveTo(tickX, ruleTop - tickReach); context.lineTo(tickX, ruleTop + tickReach);
    context.moveTo(tickX, ruleBottom - tickReach); context.lineTo(tickX, ruleBottom + tickReach);
    context.stroke();
  }
  context.font = '700 ' + Math.round(height * 0.344) + 'px "Courier New", monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, x + width / 2, y + height / 2);
  context.restore();
}

export function ceilingMark(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  drawDraftedLabel(context, { x: 0, y: 0, width: 2048, height: 512 }, text);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
}

// Geometries reused across every room must never be disposed with one.
export const sharedGeometries = new Set();

// Cabinet carcases repeat the same handful of box sizes in every room, so both
// the box and its outline are built once and reused for the merged batches.
const boxGeometryCache = new Map();
export function boxGeometryFor(width, height, depth) {
  const key = width + ':' + height + ':' + depth;
  let entry = boxGeometryCache.get(key);
  if (!entry) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    entry = { geometry, edges: new THREE.EdgesGeometry(geometry, 18) };
    sharedGeometries.add(geometry).add(entry.edges);
    boxGeometryCache.set(key, entry);
  }
  return entry;
}

const mergeVertex = new THREE.Vector3();
const shadeVertex = new THREE.Vector3();
/**
 * Merges a box into a batch.
 *
 * MeshBasicMaterial ignores normals, so only position, uv and colour are
 * carried over. `shade` receives the vertex in the parent's own space — the
 * cabinet interior, say — and returns a brightness, which is how depth is
 * expressed in a scene that has no lighting to cast it.
 */
export function appendMergedGeometry(batch, geometry, matrix, shade = null, localMatrix = null) {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const index = geometry.getIndex();
  const base = batch.positions.length / 3;
  for (let vertex = 0; vertex < position.count; vertex++) {
    mergeVertex.fromBufferAttribute(position, vertex);
    let brightness = 1;
    if (shade) {
      shadeVertex.copy(mergeVertex);
      if (localMatrix) shadeVertex.applyMatrix4(localMatrix);
      brightness = shade(shadeVertex);
    }
    mergeVertex.applyMatrix4(matrix);
    batch.positions.push(mergeVertex.x, mergeVertex.y, mergeVertex.z);
    batch.uvs.push(uv.getX(vertex), uv.getY(vertex));
    batch.colors.push(brightness, brightness, brightness);
  }
  for (let element = 0; element < index.count; element++) batch.indices.push(base + index.getX(element));
}

export function appendMergedEdges(target, edges, matrix) {
  const position = edges.getAttribute('position');
  for (let vertex = 0; vertex < position.count; vertex++) {
    mergeVertex.fromBufferAttribute(position, vertex).applyMatrix4(matrix);
    target.push(mergeVertex.x, mergeVertex.y, mergeVertex.z);
  }
}

export function mergedMesh(batch, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
  if (batch.colors?.length) geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
  geometry.setIndex(batch.indices);
  return new THREE.Mesh(geometry, material);
}
