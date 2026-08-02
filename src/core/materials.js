/**
 * The pencil-drawing look: hatched canvas textures shared by every room.
 *
 * All of these are module-level singletons.  Rooms are built and torn down
 * constantly, so materials must outlive them; only per-room canvases such as
 * spine atlases and the ceiling mark are disposed with their room.
 */

import * as THREE from 'three';

function pencilTexture(base, ink, density = 130) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, 128, 128);
  context.strokeStyle = ink;
  context.lineWidth = 0.55;
  for (let index = 0; index < density; index++) {
    const x = (index * 31) % 128;
    const y = (index * 47) % 128;
    const length = 5 + (index % 17);
    context.globalAlpha = 0.045 + (index % 5) * 0.017;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y + length * 0.2);
    context.stroke();
  }
  for (let index = 0; index < density / 4; index++) {
    const x = (index * 53) % 128;
    const y = (index * 19) % 128;
    context.globalAlpha = 0.045;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - 11, y + 9);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

export function pencilMaterial(texture, color = 0xffffff) {
  return new THREE.MeshBasicMaterial({ color, map: texture });
}

// The scene is unlit, so depth cannot come from a light. Surfaces that need to
// read as recessed carry their tone in the vertex colour instead, in the spirit
// of an architectural drawing where a recess is darker hatching rather than a
// cast shadow. Only geometry that supplies a colour attribute may use these.
function shadedMaterial(texture, color = 0xffffff) {
  return new THREE.MeshBasicMaterial({ color, map: texture, vertexColors: true });
}

const paperTexture = pencilTexture('#ffffff', '#141414', 95);
const woodTexture = pencilTexture('#ffffff', '#141414', 105);
const graphiteTexture = pencilTexture('#ffffff', '#141414', 115);

export const floorMaterial = pencilMaterial(paperTexture, 0xc8c8c4);
export const ceilingMaterial = pencilMaterial(paperTexture, 0xd8d8d4);
// Everything below is built through the merged static batches, which always
// supply a colour attribute.
export const shelfMaterial = shadedMaterial(woodTexture);
export const trimMaterial = shadedMaterial(graphiteTexture);
export const wallMaterial = shadedMaterial(paperTexture, 0xdfdfdb);
export const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.82 });
export const roomLineMaterial = new THREE.LineBasicMaterial({ color: 0x242424, transparent: true, opacity: 0.7 });

// Volumes are instanced per texture, so this array also defines how many
// instanced draw calls a wall of books costs. The shared box geometry carries
// per-face tone so a volume reads as a solid rather than a flat card, and the
// instance colour tints each copy on top of that.
export const bookMaterials = [
  shadedMaterial(paperTexture),
  shadedMaterial(woodTexture),
  shadedMaterial(graphiteTexture),
];

// Physical copies of the manifesto keep the paper texture and are tinted gold
// through the instance colour, so they need no separate draw call.
export const MANIFESTO_TINT = new THREE.Color(0xd4af37).toArray();
