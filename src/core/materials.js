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
// An arris is drawn, not inked. At near-black the lines read as a border round
// every surface — a drawn outline of a room rather than the room itself — and
// in a passage, where the same few edges converge and repeat down the whole
// corridor, they were the loudest thing in view. Taken to graphite and let down
// in opacity, they do the one job they are actually for: telling a white wall
// from a white ceiling. They cannot go further than this. The world is white on
// white and these edges are the only thing separating one surface from another;
// without them a chamber is a set of shelves floating in a pale field, which is
// exactly what it looked like the one time they were dropped.
export const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x6f6f6a, transparent: true, opacity: 0.55 });
// The six vertical corners of the hexagon, and most of what says "hexagon" at
// all. Kept a touch lighter still: they are long, they run the full height, and
// they are the lines a walker sees edge-on from every position in the room.
export const roomLineMaterial = new THREE.LineBasicMaterial({ color: 0x7c7c77, transparent: true, opacity: 0.5 });

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
