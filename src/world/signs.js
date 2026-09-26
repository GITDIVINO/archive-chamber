/**
 * The names of the ways out of a passage.
 *
 * A passage is a junction of four, and standing in the middle of one a walker
 * has three ways on with nothing to tell them apart: the openings are
 * identical, and so is every chamber behind them.
 *
 * Every way out is named at the end of its own arm, on the wall above the
 * chamber's doorway there — the one band in a passage, and the same one for all
 * four ways on. From the crossing the four mouths are identical; what tells
 * them apart is at the far end of each, where a walker is looking as they walk
 * towards it.
 *
 * The ceiling is deliberately left unlettered. The open central well exposes
 * the vertical stack, and a label above it would become the loudest object in
 * that view. Exact room records remain in the interface; passages keep only
 * the signs needed to choose a way through them.
 */

import * as THREE from 'three';
import { freeWallsForLevel } from '../../world-engine.js';
import { roomTagFor } from '../../world-model.js';
import {
  ALCOVE_REACH,
  HALL_LENGTH,
  HALL_LINTEL_HEIGHT,
  HALL_OPENING_HEIGHT,
  HALL_SIDE_CENTRE,
  HALL_START,
} from '../constants.js';
import { drawDraftedLabel, wallBasis } from './geometry.js';
import { hallTransform } from './hall.js';
import { passageExits } from './passage.js';

// The plaque over an entrance, flat on the wall above it — the band a walker
// sees at the end of an arm.
const PLAQUE_WIDTH = 2.05;
const PLAQUE_HEIGHT = PLAQUE_WIDTH / 4;
const PLAQUE_Y = HALL_OPENING_HEIGHT + HALL_LINTEL_HEIGHT / 2;
// Just clear of the surface each is painted on, so the two never z-fight.
const PROUD = 0.012;
const PLAQUE_Z = HALL_LENGTH - PROUD;
const CELL_WIDTH = 640;
const CELL_HEIGHT = Math.round(CELL_WIDTH / 4);

const hallMatrix = new THREE.Matrix4();
const chamberMatrix = new THREE.Matrix4();
const corner = new THREE.Vector3();

/**
 * The plaque over one entrance, in world space.
 *
 * Rotating a quad about y by θ sends its normal to (sin θ, 0, cos θ), so each
 * angle here turns the face back towards somebody in the passage.
 */
function plaqueOver(way) {
  if (way === 'back') {
    // The arm a walker just came down. Its far end is not a distant chamber
    // built by this module but the room's own doorway, built once with the
    // room — so this plaque sits just proud of that real wall instead of a
    // vista one, facing the crossing the way the walker approaches it from.
    return chamberMatrix.makeRotationY(0)
      .setPosition(0, PLAQUE_Y, PROUD)
      .premultiply(hallMatrix);
  }
  const side = way === 'left' ? 1 : -1;
  if (way === 'ahead') {
    return chamberMatrix.makeRotationY(Math.PI)
      .setPosition(0, PLAQUE_Y, PLAQUE_Z)
      .premultiply(hallMatrix);
  }
  return chamberMatrix.makeRotationY(side * -Math.PI / 2)
    .setPosition(side * (ALCOVE_REACH - PROUD), PLAQUE_Y, HALL_SIDE_CENTRE)
    .premultiply(hallMatrix);
}

function appendMark(target, cell, cells, width, height, matrix) {
  // The canvas runs top to bottom and the texture bottom to top, so the first
  // cell is the highest strip.
  const top = 1 - cell / cells;
  const bottom = 1 - (cell + 1) / cells;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const base = target.positions.length / 3;
  for (const [x, y, u, v] of [
    [-halfWidth, halfHeight, 0, top],
    [halfWidth, halfHeight, 1, top],
    [-halfWidth, -halfHeight, 0, bottom],
    [halfWidth, -halfHeight, 1, bottom],
  ]) {
    corner.set(x, y, 0).applyMatrix4(matrix);
    target.positions.push(corner.x, corner.y, corner.z);
    target.uvs.push(u, v);
  }
  target.indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
}

/**
 * Names every way out of the player's two passages, and the corridors beyond.
 *
 * Four ways from each of two passages, all on one canvas and one mesh. A sign
 * names the choice the walker can make now; speculative labels in rooms beyond
 * that choice were visually louder than the architecture and depended on fake
 * Euclidean placement the world explicitly rejects.
 */
export function buildSigns(room) {
  const walls = freeWallsForLevel(room.level);
  const tags = [];
  const target = { positions: [], uvs: [], indices: [] };
  const cells = walls.length * 4;

  for (const wall of walls) {
    const exits = passageExits(room, wall);
    const basis = wallBasis(wall);
    hallTransform(hallMatrix, basis.nx, basis.nz, 0, 0, HALL_START);
    for (const way of ['ahead', 'left', 'right', 'back']) {
      const cell = tags.length;
      appendMark(target, cell, cells, PLAQUE_WIDTH, PLAQUE_HEIGHT, plaqueOver(way));
      const there = exits[way];
      tags.push(roomTagFor(there.q, there.r, there.level));
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = CELL_WIDTH;
  canvas.height = CELL_HEIGHT * cells;
  const context = canvas.getContext('2d');
  tags.forEach((tag, cell) => {
    drawDraftedLabel(context, { x: 0, y: cell * CELL_HEIGHT, width: CELL_WIDTH, height: CELL_HEIGHT }, tag);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(target.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(target.uvs, 2));
  geometry.setIndex(target.indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  }));
  mesh.renderOrder = 3;
  mesh.raycast = () => {};
  // What the markings say, in the order they were placed. Text baked into a
  // canvas cannot be read back, and one naming the wrong chamber would look
  // perfectly correct, so the smoke test checks this against the topology.
  mesh.userData.plaques = tags;
  return mesh;
}

export function disposeSigns(mesh) {
  mesh.geometry.dispose();
  mesh.material.map.dispose();
  mesh.material.dispose();
}
