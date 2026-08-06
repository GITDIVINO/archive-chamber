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
 * Each of the three chambers beyond also carries the marking a built room paints
 * on its own ceiling, which is a different job: it is what a walker reads once
 * they have looked in, and it is what makes the chamber drawn beyond a doorway
 * look like the chamber they will be standing in a moment later. Leaving it off
 * the one ahead — as it was for a while, to keep it out of the same view as the
 * plaque on the beam — made a chamber's own name appear the instant a walker
 * stepped through, which is the pop the plaque was never worth.
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
  ALCOVE_REACH,
  CHAMBER_STEP,
  HALL_LENGTH,
  HALL_LINTEL_HEIGHT,
  HALL_OPENING_HEIGHT,
  HALL_SIDE_CENTRE,
  HALL_START,
  WALL_HEIGHT,
} from '../constants.js';
import { drawDraftedLabel, wallBasis } from './geometry.js';
import { hallTransform } from './hall.js';
import { passageExits } from './passage.js';
import { alcoveChamberMatrix } from './vista.js';

// The same plane a built room uses for its own marking.
const MARK_WIDTH = 7.4;
const MARK_HEIGHT = 1.85;
// The plaque over an entrance, flat on the wall above it — the band a walker
// sees at the end of an arm. Kept to the same proportion as a ceiling marking
// so both can share one canvas without either being stretched.
const PLAQUE_WIDTH = 2.05;
const PLAQUE_HEIGHT = PLAQUE_WIDTH * MARK_HEIGHT / MARK_WIDTH;
const PLAQUE_Y = HALL_OPENING_HEIGHT + HALL_LINTEL_HEIGHT / 2;
// Just clear of the surface each is painted on, so the two never z-fight.
const PROUD = 0.012;
const PLAQUE_Z = HALL_LENGTH - PROUD;
const CELL_WIDTH = 640;
const CELL_HEIGHT = Math.round(CELL_WIDTH * MARK_HEIGHT / MARK_WIDTH);

// How many further corridors along the same axis are named as well as the
// walker's own.
//
// A passage names the chamber at its far end, and until now that was the only
// one named: standing in a corridor a walker could read where it came out, look
// straight through that chamber to the next corridor behind it, and find its
// far end blank. The world named the place it was handing them to and then said
// nothing about the one after, which is the opposite of how it reads on a map.
//
// This costs nothing to know — the corridor runs straight, so the chamber two
// along is the same neighbour taken twice — and nothing to place, because the
// far end of every passage down the axis is already built. It only costs a cell
// on the canvas each. Two is where it stops being worth one: the second plaque
// stands 89 units off with the fog half closed over it, and the third would be
// at 122, where three quarters of it is gone.
const NAMED_CORRIDOR_DEPTH = 2;

const hallMatrix = new THREE.Matrix4();
const chamberMatrix = new THREE.Matrix4();
// One per arm, held while hallMatrix is rewritten for each corridor beyond it.
const armBases = [new THREE.Matrix4(), new THREE.Matrix4()];
const lift = new THREE.Matrix4().makeTranslation(0, WALL_HEIGHT, 0);
// A ceiling marking lies flat and is read from below, the way a built room lays
// it: a quad's normal is +z, and turning it a quarter about x sends that down.
const FACE_DOWN = new THREE.Matrix4().makeRotationX(Math.PI / 2);
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

/** The ceiling of the chamber behind one way out, in world space. */
function ceilingBeyond(way, level, basis) {
  if (way === 'ahead') {
    // Straight along the wall's normal and square to the world, exactly as the
    // corridor places it: a mark turned differently from the room it belongs to
    // would swing overhead as the walker crossed.
    chamberMatrix.makeTranslation(basis.nx * CHAMBER_STEP, 0, basis.nz * CHAMBER_STEP);
  } else {
    alcoveChamberMatrix(chamberMatrix, level, way === 'left' ? 1 : -1).premultiply(hallMatrix);
  }
  return chamberMatrix.multiply(lift).multiply(FACE_DOWN);
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
 * Four ways from each of two passages, plus NAMED_CORRIDOR_DEPTH more along
 * each axis — all on one canvas and one mesh, so the whole junction costs a
 * single draw call. Three of the four near ways are chambers this module builds
 * a vista for and so also letters on the ceiling beyond; the fourth, back, is
 * the room the walker is already standing in, which paints its own ceiling the
 * ordinary way and gets a plaque only. The further corridors get a plaque only
 * as well: a walker who reaches one of those chambers will have crossed a
 * threshold first, and the room they step into paints its own.
 */
export function buildSigns(room) {
  const walls = freeWallsForLevel(room.level);
  const tags = [];
  const target = { positions: [], uvs: [], indices: [] };
  // Four ways from each passage, and three corridors running on from it: the
  // one ahead and the one down either arm.
  const cells = walls.length * (4 + 3 * NAMED_CORRIDOR_DEPTH);

  for (const wall of walls) {
    const exits = passageExits(room, wall);
    const basis = wallBasis(wall);
    hallTransform(hallMatrix, basis.nx, basis.nz, 0, 0, HALL_START);
    for (const way of ['ahead', 'left', 'right', 'back']) {
      // The plaque over the entrance and the marking on the chamber's ceiling
      // are one piece of lettering, used twice — except for back, which has
      // no ceiling of its own to letter here.
      const cell = tags.length;
      appendMark(target, cell, cells, PLAQUE_WIDTH, PLAQUE_HEIGHT, plaqueOver(way));
      if (way !== 'back') {
        appendMark(target, cell, cells, MARK_WIDTH, MARK_HEIGHT, ceilingBeyond(way, room.level, basis));
      }
      const there = exits[way];
      tags.push(roomTagFor(there.q, there.r, there.level));
    }

    // Each arm's own frame, taken while hallMatrix is still this passage's:
    // everything below rewrites it.
    for (const [index, side] of [[0, 1], [1, -1]]) {
      alcoveChamberMatrix(armBases[index], room.level, side).premultiply(hallMatrix);
    }

    // The corridors behind the one ahead. A passage leaves a chamber by the
    // same wall it entered by, so the axis never turns and the chamber another
    // step along is the same neighbour taken again. Each plaque hangs over the
    // far end of its own passage, which stands one CHAMBER_STEP further out
    // than the last — exactly where the vista has already built it.
    let ahead = exits.ahead;
    for (let depth = 1; depth <= NAMED_CORRIDOR_DEPTH; depth++) {
      ahead = passageExits(ahead, wall).ahead;
      const along = CHAMBER_STEP * depth;
      hallTransform(hallMatrix, basis.nx, basis.nz, basis.nx * along, basis.nz * along, HALL_START);
      appendMark(target, tags.length, cells, PLAQUE_WIDTH, PLAQUE_HEIGHT, plaqueOver('ahead'));
      tags.push(roomTagFor(ahead.q, ahead.r, ahead.level));
    }

    // And the corridors behind either arm, which run on in the same sense.
    //
    // Where they lead is not guesswork about a drawn corridor, it is where the
    // walk goes. Taking a side exit puts somebody in the flanking chamber at
    // the doorway arrivalWallFor picks, and carrying straight on means crossing
    // that chamber and leaving by the opposite free wall — which, on every
    // level and from either side, is the very wall this passage runs along. So
    // an arm continues by the same neighbour the corridor ahead does, and the
    // plaques say what somebody would find by walking there.
    for (const [index, exit] of [[0, 'left'], [1, 'right']]) {
      let along = exits[exit];
      for (let depth = 1; depth <= NAMED_CORRIDOR_DEPTH; depth++) {
        along = passageExits(along, wall).ahead;
        const out = -CHAMBER_STEP * (depth - 1);
        hallTransform(hallMatrix, -basis.nx, -basis.nz, basis.nx * out, basis.nz * out, HALL_START)
          .premultiply(armBases[index]);
        appendMark(target, tags.length, cells, PLAQUE_WIDTH, PLAQUE_HEIGHT, plaqueOver('ahead'));
        tags.push(roomTagFor(along.q, along.r, along.level));
      }
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
