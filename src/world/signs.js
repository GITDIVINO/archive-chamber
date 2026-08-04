/**
 * The signs over the ways out of a passage.
 *
 * A passage is a junction of four chambers, and standing in the middle of one
 * a walker has three ways on and nothing to tell them apart: the openings are
 * identical, and so is every chamber behind them. These are the plaques that
 * say which is which, written in the same drafted hand as the chamber tag
 * overhead and the numbers on the cabinets.
 *
 * What a plaque says depends on whether the walker has been there:
 *
 *   been there   their own number for it — 7 — which is what they will
 *                recognise, and what the register decodes
 *   not been     the chamber's own name, h-2o0oe3xwz3fes, because that is the
 *                only thing about an unentered chamber that is knowable
 *
 * So a junction also reads at a glance as which ways are new. Nothing here is
 * an address; see register.js for why the two naming schemes sit side by side.
 *
 * Only the two passages of the chamber the player is standing in are signed.
 * The ones receding down the corridor share one merged geometry and could not
 * carry different text, and at that distance a plaque is a smudge anyway.
 */

import * as THREE from 'three';
import { freeWallsForLevel } from '../../world-engine.js';
import { roomTagFor } from '../../world-model.js';
import {
  HALL_HALF_WIDTH,
  HALL_LENGTH,
  HALL_LINTEL_HEIGHT,
  HALL_OPENING_HEIGHT,
  HALL_SIDE_CENTRE,
  HALL_START,
  HALL_TRANSOM_DEPTH,
} from '../constants.js';
import { drawDraftedLabel, wallBasis } from './geometry.js';
import { hallTransform } from './hall.js';
import { passageExits } from './passage.js';
import { ordinalFor } from './register.js';

const PLAQUE_WIDTH = 2.05;
const PLAQUE_HEIGHT = HALL_LINTEL_HEIGHT * 0.74;
const PLAQUE_Y = HALL_OPENING_HEIGHT + HALL_LINTEL_HEIGHT / 2;
// Just clear of the lintel it is painted on, so the two never z-fight.
const PROUD = 0.012;

const CELL_WIDTH = 640;
const CELL_HEIGHT = 128;
// A number is one or two characters and should read from the far end of the
// passage; a tag is fifteen and only has to be legible once a walker is under
// it. Both are set in the same hand, only at different sizes.
const ORDINAL_SCALE = 0.52;
const TAG_SCALE = 0.3;

const placeMatrix = new THREE.Matrix4();
const hallMatrix = new THREE.Matrix4();
const corner = new THREE.Vector3();

/**
 * Where each plaque hangs in a passage's own frame, and which way it faces.
 *
 * Rotating a quad about Y by θ sends its normal to (sin θ, 0, cos θ), so each
 * angle here is chosen to turn the face back towards somebody in the passage.
 */
const PLAQUE_PLACES = Object.freeze({
  ahead: { x: 0, z: HALL_LENGTH - HALL_TRANSOM_DEPTH - PROUD, turn: Math.PI },
  left: { x: HALL_HALF_WIDTH - PROUD, z: HALL_SIDE_CENTRE, turn: -Math.PI / 2 },
  right: { x: -(HALL_HALF_WIDTH - PROUD), z: HALL_SIDE_CENTRE, turn: Math.PI / 2 },
});

function legendFor(chamber) {
  const ordinal = ordinalFor(chamber);
  return ordinal === null
    ? { text: roomTagFor(chamber.q, chamber.r, chamber.level), scale: TAG_SCALE }
    : { text: String(ordinal), scale: ORDINAL_SCALE };
}

function appendPlaque(target, cell, cells, place) {
  placeMatrix.makeRotationY(place.turn)
    .setPosition(place.x, PLAQUE_Y, place.z)
    .premultiply(hallMatrix);

  // The canvas runs top to bottom and the texture bottom to top, so the first
  // cell is the highest strip.
  const top = 1 - cell / cells;
  const bottom = 1 - (cell + 1) / cells;
  const halfWidth = PLAQUE_WIDTH / 2;
  const halfHeight = PLAQUE_HEIGHT / 2;
  const base = target.positions.length / 3;
  for (const [x, y, u, v] of [
    [-halfWidth, halfHeight, 0, top],
    [halfWidth, halfHeight, 1, top],
    [-halfWidth, -halfHeight, 0, bottom],
    [halfWidth, -halfHeight, 1, bottom],
  ]) {
    corner.set(x, y, 0).applyMatrix4(placeMatrix);
    target.positions.push(corner.x, corner.y, corner.z);
    target.uvs.push(u, v);
  }
  target.indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
}

/**
 * Builds the six plaques of a chamber's two passages: three ways on from each.
 *
 * One canvas and one mesh, so the whole junction costs a single draw call.
 */
export function buildSigns(room) {
  const walls = freeWallsForLevel(room.level);
  const legends = [];
  const target = { positions: [], uvs: [], indices: [] };
  const cells = walls.length * 3;

  for (const wall of walls) {
    const exits = passageExits(room, wall);
    const basis = wallBasis(wall);
    hallTransform(hallMatrix, basis.nx, basis.nz, 0, 0, HALL_START);
    for (const way of ['ahead', 'left', 'right']) {
      appendPlaque(target, legends.length, cells, PLAQUE_PLACES[way]);
      legends.push(legendFor(exits[way]));
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = CELL_WIDTH;
  canvas.height = CELL_HEIGHT * cells;
  const context = canvas.getContext('2d');
  legends.forEach((legend, cell) => {
    drawDraftedLabel(
      context,
      { x: 0, y: cell * CELL_HEIGHT, width: CELL_WIDTH, height: CELL_HEIGHT },
      legend.text,
      legend.scale,
    );
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
  // What the plaques say, in the order they were placed. Text baked into a
  // canvas cannot be read back, and a sign naming the wrong chamber would look
  // perfectly correct, so the smoke test checks this against the topology.
  mesh.userData.plaques = legends.map(legend => legend.text);
  return mesh;
}

export function disposeSigns(mesh) {
  mesh.geometry.dispose();
  mesh.material.map.dispose();
  mesh.material.dispose();
}
