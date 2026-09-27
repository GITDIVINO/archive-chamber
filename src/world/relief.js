/**
 * The ouroboros on the walls: the snake eating its tail and Sisyphus inside
 * its ring, set into the plain strip above every cabinet.
 *
 * Every relief in every chamber is the same drawing at the same moment, so they
 * all share one canvas, one texture and one material. The canvas is redrawn a
 * few times a second and uploaded once, however many rooms show it; each room
 * adds a single mesh, one draw call, holding a quad per cabinet wall.
 */

import * as THREE from 'three';
import { WALL_THICKNESS, WORLD_SURFACE_COLOR } from '../constants.js';
import { drawOuroboros, SIZE } from '../art/ouroboros.js';
import { pointOnWall, wallBasis } from './geometry.js';

// Pale stone set into the wall's own darker stone, with the lines sunk in. It
// is lit only by the lamps, like the wall round it, so it is kept pale enough
// to read in the dim strip above the sconces.
// `ground` fills the disc behind the carving with the wall's own colour, so the
// disc is opaque and needs no alpha test.
const STONE_PALETTE = Object.freeze({
  ground: `#${WORLD_SURFACE_COLOR.toString(16).padStart(6, '0')}`,
  ink: '#2b231e',
  farInk: '#4a3e36',
  paper: '#e2d6c8',
  skin: '#efe6da',
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
// The drawing's outer ring reaches 110 of its 120 half-units; the disc stops
// a little past it, in texture units from the centre.
const DISC_RADIUS = 0.475;
const DISC_SEGMENTS = 48;
// Just proud of the wall's inner face, so it never fights it for depth.
const INWARD = WALL_THICKNESS / 2 + 0.03;

let material = null;

function sharedMaterial() {
  if (material) return material;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Seen from across the chamber it is shrunk several times over, and without
  // mips the moving scales shimmer. The chain is built on the GPU per upload.
  texture.anisotropy = 4;
  // Exactly the features of the shelving's material (a map and vertex
  // colours, nothing else), so three.js reuses the shader program it has
  // already compiled for the shelves. A bump or emissive map, or an alpha
  // test, each made a new program, and compiling those under a software
  // renderer held up the first frames of the chamber.
  material = new THREE.MeshStandardMaterial({
    map: texture,
    vertexColors: true,
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
    if (still?.matches || now - last < FRAME_INTERVAL_MS) return;
    last = now;
    paint(now / 1000);
  };
  requestAnimationFrame(tick);
  return material;
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
    // A disc just past the drawing's outer ring, as a fan round its centre.
    // Seen from the room the tangent runs to the right, so u follows it.
    const rim = [[0, 0]];
    for (let step = 0; step < DISC_SEGMENTS; step++) {
      const angle = (step / DISC_SEGMENTS) * Math.PI * 2;
      rim.push([Math.cos(angle) * DISC_RADIUS, Math.sin(angle) * DISC_RADIUS]);
    }
    for (const [x, y] of rim) {
      const point = pointOnWall(basis, x * half * 2, centre + y * half * 2, INWARD);
      positions.push(point.x, point.y, point.z);
      normals.push(-basis.nx, 0, -basis.nz);
      uvs.push(0.5 + x, 0.5 + y);
    }
    for (let step = 0; step < DISC_SEGMENTS; step++) {
      indices.push(base, base + 1 + step, base + 1 + ((step + 1) % DISC_SEGMENTS));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(positions.length).fill(1), 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, sharedMaterial());
  mesh.name = 'relief';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  // Never in the way of a click on a book or the reader's aim.
  mesh.raycast = () => {};
  room.add(mesh);
}
