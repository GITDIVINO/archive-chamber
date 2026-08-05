/**
 * The names of the ways out of a passage.
 *
 * A passage is a junction of four, and standing in the middle of one a walker
 * has three ways on with nothing to tell them apart: the openings are
 * identical, and so is every chamber behind them.
 *
 * Each is named once, in the place a walker is looking when they choose it. The
 * way ahead is named over its entrance, on the beam at the end of the passage,
 * because that is what somebody walking the corridor has in front of them. The
 * two at the sides are named on the ceiling of the chamber beyond — the same
 * marking a built room paints on its own — because to choose one of those a
 * walker turns and looks into it. Naming either of them twice put two copies of
 * one word in the same view, and neither could be read.
 *
 * Those chambers cannot paint their own. The builder that draws them is
 * deliberately position-independent — that is what lets a walker cross a
 * threshold without the corridor being rebuilt — so it does not know which
 * chamber it is standing in for. This module does: it is rebuilt with the room.
 *
 * It is the chamber's own tag, never the walker's number, because that is what
 * a built room paints and the two have to agree. Anything else would change
 * over their head as they stepped through.
 */

import * as THREE from 'three';
import { freeWallsForLevel } from '../../world-engine.js';
import { roomTagFor } from '../../world-model.js';
import {
  HALL_LENGTH,
  HALL_LINTEL_HEIGHT,
  HALL_OPENING_HEIGHT,
  HALL_START,
  HALL_TRANSOM_DEPTH,
  WALL_HEIGHT,
} from '../constants.js';
import { drawDraftedLabel, wallBasis } from './geometry.js';
import { hallTransform } from './hall.js';
import { passageExits } from './passage.js';
import { alcoveChamberMatrix } from './vista.js';

// The same plane a built room uses for its own marking.
const MARK_WIDTH = 7.4;
const MARK_HEIGHT = 1.85;
// The plaque over the far entrance, on the beam that crosses the end of the
// passage. Kept to the same proportion as a ceiling marking so both can share
// one canvas without either being stretched.
const PLAQUE_WIDTH = 2.05;
const PLAQUE_HEIGHT = PLAQUE_WIDTH * MARK_HEIGHT / MARK_WIDTH;
const PLAQUE_Y = HALL_OPENING_HEIGHT + HALL_LINTEL_HEIGHT / 2;
const PLAQUE_Z = HALL_LENGTH - HALL_TRANSOM_DEPTH - 0.012;
const CELL_WIDTH = 640;
const CELL_HEIGHT = Math.round(CELL_WIDTH * MARK_HEIGHT / MARK_WIDTH);

const hallMatrix = new THREE.Matrix4();
const chamberMatrix = new THREE.Matrix4();
const lift = new THREE.Matrix4().makeTranslation(0, WALL_HEIGHT, 0);
// A ceiling marking lies flat and is read from below, the way a built room lays
// it: a quad's normal is +z, and turning it a quarter about x sends that down.
const FACE_DOWN = new THREE.Matrix4().makeRotationX(Math.PI / 2);
const corner = new THREE.Vector3();

/** Where the name of one way out is written, in world space. */
function surfaceOf(way, level) {
  if (way === 'ahead') {
    // Flat against the beam, facing back down the passage: turning a quad about
    // y by pi sends its normal to -z, which is the way somebody arrives from.
    return chamberMatrix.makeRotationY(Math.PI)
      .setPosition(0, PLAQUE_Y, PLAQUE_Z)
      .premultiply(hallMatrix);
  }
  return alcoveChamberMatrix(chamberMatrix, level, way === 'left' ? 1 : -1)
    .premultiply(hallMatrix)
    .multiply(lift)
    .multiply(FACE_DOWN);
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
 * Names every way out of the player's two passages.
 *
 * Six of them — three from each — on one canvas and one mesh, so the whole
 * junction costs a single draw call.
 */
export function buildSigns(room) {
  const walls = freeWallsForLevel(room.level);
  const tags = [];
  const target = { positions: [], uvs: [], indices: [] };
  const cells = walls.length * 3;

  for (const wall of walls) {
    const exits = passageExits(room, wall);
    const basis = wallBasis(wall);
    hallTransform(hallMatrix, basis.nx, basis.nz, 0, 0, HALL_START);
    for (const way of ['ahead', 'left', 'right']) {
      const ahead = way === 'ahead';
      appendMark(
        target, tags.length, cells,
        ahead ? PLAQUE_WIDTH : MARK_WIDTH,
        ahead ? PLAQUE_HEIGHT : MARK_HEIGHT,
        surfaceOf(way, room.level),
      );
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
