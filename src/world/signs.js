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
  ALCOVE_REACH,
  CHAMBER_STEP,
  HALL_HALF_WIDTH,
  HALL_LENGTH,
  HALL_LINTEL_HEIGHT,
  HALL_OPENING_HEIGHT,
  HALL_SIDE_CENTRE,
  HALL_START,
  HALL_TRANSOM_DEPTH,
  WALL_HEIGHT,
} from '../constants.js';
import { drawDraftedLabel, wallBasis } from './geometry.js';
import { hallTransform } from './hall.js';
import { passageExits } from './passage.js';
import { ordinalFor } from './register.js';
import { alcoveChamberMatrix } from './vista.js';

const PLAQUE_WIDTH = 2.05;
const PLAQUE_HEIGHT = HALL_LINTEL_HEIGHT * 0.74;
const PLAQUE_Y = HALL_OPENING_HEIGHT + HALL_LINTEL_HEIGHT / 2;
// Just clear of the surface it is painted on, so the two never z-fight.
const PROUD = 0.012;
// A second copy hung across the threshold of the side opening. The lintel
// plaque is set for somebody walking past; standing in front of the turning,
// about to step through, it is edge-on and says nothing. This one faces them.
// It rides just under the head of the opening so it names the chamber without
// standing in front of its shelves.
const BLIND_WIDTH = 1.9;
const BLIND_HEIGHT = BLIND_WIDTH * (PLAQUE_HEIGHT / PLAQUE_WIDTH);
const BLIND_Y = HALL_OPENING_HEIGHT - 0.26;

// The tag on the ceiling of a chamber a walker is about to enter. A built room
// paints its own; the chambers drawn beyond a doorway cannot, because the
// builder that draws them is deliberately position-independent and does not
// know which chamber it is standing in for. The signs do know — they are
// rebuilt with the room — so the marking is laid here, at the size and shape a
// built room uses, and at the orientation vista.js gave that chamber, or it
// would turn as the walker stepped through.
const MARK_WIDTH = 7.4;
const MARK_HEIGHT = 1.85;

const CELL_WIDTH = 640;
// Cells are as tall as their quad is, in proportion, so a plaque and a ceiling
// mark can share one canvas without either being stretched.
const PLAQUE_CELL_HEIGHT = Math.round(CELL_WIDTH * PLAQUE_HEIGHT / PLAQUE_WIDTH);
const MARK_CELL_HEIGHT = Math.round(CELL_WIDTH * MARK_HEIGHT / MARK_WIDTH);
// A number is one or two characters and should read from the far end of the
// passage; a tag is fifteen and only has to be legible once a walker is under
// it. Both are set in the same hand, only at different sizes.
const ORDINAL_SCALE = 0.52;
const TAG_SCALE = 0.3;

const placeMatrix = new THREE.Matrix4();
const hallMatrix = new THREE.Matrix4();
const chamberMatrix = new THREE.Matrix4();
// A ceiling mark lies flat and is read from below, the way a built room lays it.
const FACE_DOWN = new THREE.Matrix4().makeRotationX(Math.PI / 2);
const corner = new THREE.Vector3();

/**
 * Where each plaque hangs in a passage's own frame, and which way it faces.
 *
 * Rotating a quad about Y by θ sends its normal to (sin θ, 0, cos θ), so each
 * angle here is chosen to turn the face back towards somebody in the passage.
 */
const PLAQUE_PLACES = Object.freeze({
  ahead: [
    { x: 0, y: PLAQUE_Y, z: HALL_LENGTH - HALL_TRANSOM_DEPTH - PROUD, turn: Math.PI,
      width: PLAQUE_WIDTH, height: PLAQUE_HEIGHT },
  ],
  left: [
    { x: HALL_HALF_WIDTH - PROUD, y: PLAQUE_Y, z: HALL_SIDE_CENTRE, turn: -Math.PI / 2,
      width: PLAQUE_WIDTH, height: PLAQUE_HEIGHT },
    { x: ALCOVE_REACH - PROUD, y: BLIND_Y, z: HALL_SIDE_CENTRE, turn: -Math.PI / 2,
      width: BLIND_WIDTH, height: BLIND_HEIGHT },
  ],
  right: [
    { x: -(HALL_HALF_WIDTH - PROUD), y: PLAQUE_Y, z: HALL_SIDE_CENTRE, turn: Math.PI / 2,
      width: PLAQUE_WIDTH, height: PLAQUE_HEIGHT },
    { x: -(ALCOVE_REACH - PROUD), y: BLIND_Y, z: HALL_SIDE_CENTRE, turn: Math.PI / 2,
      width: BLIND_WIDTH, height: BLIND_HEIGHT },
  ],
});

function legendFor(chamber) {
  const ordinal = ordinalFor(chamber);
  return ordinal === null
    ? { text: roomTagFor(chamber.q, chamber.r, chamber.level), scale: TAG_SCALE, height: PLAQUE_CELL_HEIGHT }
    : { text: String(ordinal), scale: ORDINAL_SCALE, height: PLAQUE_CELL_HEIGHT };
}

// A ceiling always carries the world's own name for the chamber, never the
// walker's number: that is what a built room paints, and the two must agree.
function markFor(chamber) {
  return {
    text: roomTagFor(chamber.q, chamber.r, chamber.level),
    scale: 0.344,
    height: MARK_CELL_HEIGHT,
  };
}

// Both plaques for one way out read the same words, so they share one cell of
// the atlas: two quads, one piece of lettering.
function appendQuad(target, rows, cell, width, height, matrix) {
  const total = rows.at(-1).end;
  // The canvas runs top to bottom and the texture bottom to top, so the first
  // row is the highest strip.
  const top = 1 - rows[cell].start / total;
  const bottom = 1 - rows[cell].end / total;
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

const lift = new THREE.Matrix4().makeTranslation(0, WALL_HEIGHT, 0);
/** The ceiling of the chamber behind one way out, in world space. */
function ceilingOf(way, level, basis) {
  if (way === 'ahead') {
    chamberMatrix.makeTranslation(basis.nx * CHAMBER_STEP, 0, basis.nz * CHAMBER_STEP);
  } else {
    alcoveChamberMatrix(chamberMatrix, level, way === 'left' ? 1 : -1).premultiply(hallMatrix);
  }
  return chamberMatrix.multiply(lift).multiply(FACE_DOWN);
}

/**
 * Builds the signs of a chamber's two passages.
 *
 * For each of the three ways on from each: a plaque naming where it leads, and
 * the chamber's own tag laid on the ceiling of the room drawn beyond it. One
 * canvas and one mesh, so the whole junction costs a single draw call.
 */
export function buildSigns(room) {
  const walls = freeWallsForLevel(room.level);
  const legends = [];
  const quads = [];
  const target = { positions: [], uvs: [], indices: [] };

  for (const wall of walls) {
    const exits = passageExits(room, wall);
    const basis = wallBasis(wall);
    hallTransform(hallMatrix, basis.nx, basis.nz, 0, 0, HALL_START);
    for (const way of ['ahead', 'left', 'right']) {
      const plaque = legends.push(legendFor(exits[way])) - 1;
      for (const place of PLAQUE_PLACES[way]) {
        quads.push({
          cell: plaque,
          width: place.width,
          height: place.height,
          matrix: placeMatrix.makeRotationY(place.turn)
            .setPosition(place.x, place.y, place.z)
            .premultiply(hallMatrix)
            .clone(),
        });
      }
      const mark = legends.push(markFor(exits[way])) - 1;
      quads.push({
        cell: mark,
        width: MARK_WIDTH,
        height: MARK_HEIGHT,
        matrix: ceilingOf(way, room.level, basis).clone(),
      });
    }
  }

  // Rows of different heights in one canvas, so a plaque and a ceiling mark can
  // share it without either being stretched.
  const rows = [];
  let cursor = 0;
  for (const legend of legends) {
    rows.push({ start: cursor, end: cursor + legend.height });
    cursor += legend.height;
  }
  for (const quad of quads) appendQuad(target, rows, quad.cell, quad.width, quad.height, quad.matrix);

  const canvas = document.createElement('canvas');
  canvas.width = CELL_WIDTH;
  canvas.height = cursor;
  const context = canvas.getContext('2d');
  legends.forEach((legend, cell) => {
    drawDraftedLabel(
      context,
      { x: 0, y: rows[cell].start, width: CELL_WIDTH, height: legend.height },
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
  // What the signs say, in the order they were placed. Text baked into a canvas
  // cannot be read back, and a sign naming the wrong chamber would look
  // perfectly correct, so the smoke test checks this against the topology.
  mesh.userData.plaques = legends.map(legend => legend.text);
  return mesh;
}

export function disposeSigns(mesh) {
  mesh.geometry.dispose();
  mesh.material.map.dispose();
  mesh.material.dispose();
}
