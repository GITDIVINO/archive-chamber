/**
 * The ouroboros on the walls: the snake eating its tail and Sisyphus inside
 * its ring, set into the plain strip above every cabinet.
 *
 * Every relief in every chamber is the same drawing at the same moment, so they
 * all share one canvas, one texture and one material. The canvas is redrawn a
 * few times a second and uploaded once. Only the walker's own chamber shows it
 * (neighbours seen through doorways leave it out), as a single mesh, one draw
 * call, holding a quad per cabinet wall.
 */

import * as THREE from 'three';
import { WALL_THICKNESS } from '../constants.js';
import { drawOuroboros, SIZE } from '../art/ouroboros.js';
import { renderedWorld } from '../core/view.js';
import { pointOnWall, wallBasis } from './geometry.js';

// Pale stone cut into the wall's own darker stone, with the lines sunk in.
const STONE_PALETTE = Object.freeze({
  ink: '#2b231e',
  farInk: '#4a3e36',
  paper: '#b9ab9d',
  skin: '#cbbfb1',
});

// 512 square is under sixty texels a metre on a nine-metre medallion: sharp
// from the floor, and a quarter of what 1024 would cost to upload.
const TEXTURE_SIZE = 512;
// The snake completes a turn in about forty seconds, so eight frames a second
// is smooth motion and keeps the upload off most frames entirely.
const FRAME_INTERVAL_MS = 125;
// Diameter, and the gap left to the cornice bands above and below it.
const DIAMETER = 9;
const MARGIN = 0.4;
// Just proud of the wall's inner face, so it never fights it for depth.
const INWARD = WALL_THICKNESS / 2 + 0.03;

let material = null;

function sharedMaterial() {
  if (material) return material;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  // Kept in main memory. A GPU-backed 2D canvas has to be synchronised with
  // the WebGL context on every upload, and under a software renderer that
  // stall held back whole frames of the chamber; from plain memory an upload
  // is a copy.
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Seen from across the chamber it is shrunk several times over, and without
  // mips the moving scales shimmer. The chain is built on the GPU per upload.
  texture.anisotropy = 4;
  material = new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: texture,
    bumpScale: 2.5,
    // Cut out rather than blended: no sorting, no overdraw, and the lamps
    // light it exactly as they light the wall around it.
    alphaTest: 0.5,
    // The strip sits above the reach of the sconces, so without a little
    // light of its own the carving is lost in the dark of the upper wall.
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: 0.22,
    roughness: 0.92,
    metalness: 0,
  });

  const paint = seconds => {
    context.setTransform(TEXTURE_SIZE / SIZE, 0, 0, TEXTURE_SIZE / SIZE, 0, 0);
    drawOuroboros(context, seconds, STONE_PALETTE);
    texture.needsUpdate = true;
  };
  paint(0);
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let last = 0;
  const tick = now => {
    requestAnimationFrame(tick);
    showActiveReliefs();
    if (still?.matches || now - last < FRAME_INTERVAL_MS) return;
    last = now;
    paint(now / 1000);
  };
  requestAnimationFrame(tick);
  return material;
}

// The chambers directly under renderedWorld are the walker's own; portal
// copies live in their own scene. A handful of children, checked each tick.
function showActiveReliefs() {
  for (const room of renderedWorld.children) {
    for (const child of room.children) {
      if (child.userData.chamberOnly) child.visible = true;
    }
  }
}

/**
 * Adds the reliefs for `walls` to `room`, centred in the band between `bottom`
 * and `top` (metres above the floor).
 */
export function addRelief(room, walls, bottom, top) {
  const size = Math.min(DIAMETER, top - bottom - MARGIN * 2);
  if (!walls.length || size <= 0) return;
  const centre = (bottom + top) / 2;
  const half = size / 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (const wall of walls) {
    const basis = wallBasis(wall);
    const base = positions.length / 3;
    // Seen from the room the tangent runs to the right, so u follows it.
    for (const [t, y, u, v] of [[-half, -half, 0, 0], [half, -half, 1, 0], [half, half, 1, 1], [-half, half, 0, 1]]) {
      const point = pointOnWall(basis, t, centre + y, INWARD);
      positions.push(point.x, point.y, point.z);
      normals.push(-basis.nx, 0, -basis.nz);
      uvs.push(u, v);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, sharedMaterial());
  mesh.name = 'relief';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  // Never in the way of a click on a book or the reader's aim.
  mesh.raycast = () => {};
  // Only in the chamber the walker stands in. Through a doorway it is a few
  // pixels on a far wall, and a copy in every neighbour cost a draw call each:
  // room.js hides it in portal copies and showActiveReliefs brings it back
  // when the walker steps through and the copy becomes their chamber.
  mesh.userData.chamberOnly = true;
  room.add(mesh);
}
