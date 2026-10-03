/**
 * The pencil-drawing look: hatched canvas textures shared by every room.
 *
 * All of these are module-level singletons.  Rooms are built and torn down
 * constantly, so materials must outlive them; only per-room canvases such as
 * spine atlases are disposed with their room.
 */

import * as THREE from 'three';
import {
  BOOK_COLOR,
  LAMP_GLOBE_COLOR,
  TRIM_WOOD_COLOR,
  WOOD_COLOR,
  WORLD_CEILING_COLOR,
  WORLD_FLOOR_COLOR,
  WORLD_SURFACE_COLOR,
} from '../constants.js';

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

/** Neutral long grain and knots; tinting it happens exactly once in material. */
function timberTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#c9c9c9';
  context.fillRect(0, 0, 256, 256);
  for (let line = 0; line < 92; line++) {
    const y = (line * 37) % 256;
    const wave = 1.5 + (line % 5) * 0.7;
    context.strokeStyle = `rgba(18, 18, 18, ${0.065 + (line % 7) * 0.012})`;
    context.lineWidth = line % 9 === 0 ? 1.4 : 0.65;
    context.beginPath();
    for (let x = -8; x <= 264; x += 8) {
      const grainY = y + Math.sin((x + line * 11) * 0.045) * wave;
      if (x === -8) context.moveTo(x, grainY);
      else context.lineTo(x, grainY);
    }
    context.stroke();
  }
  // Board seams and a darker pore line along each: the casework in the
  // reference is built from separate boards, and a lantern glancing along a
  // shelf front only reads as timber when it has joints to catch on.
  for (let seam = 0; seam < 256; seam += 64) {
    context.fillStyle = 'rgba(10, 10, 10, 0.28)';
    context.fillRect(0, seam, 256, 2);
    context.fillStyle = 'rgba(255, 255, 255, 0.10)';
    context.fillRect(0, seam + 2, 256, 1);
  }
  for (let knot = 0; knot < 7; knot++) {
    const x = 24 + (knot * 83) % 214;
    const y = 18 + (knot * 47) % 220;
    for (let ring = 1; ring <= 4; ring++) {
      context.strokeStyle = `rgba(18, 18, 18, ${0.12 - ring * 0.015})`;
      context.beginPath();
      context.ellipse(x, y, ring * 4.5, ring * 1.9, 0.12, 0, Math.PI * 2);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 3);
  return texture;
}

// One paper colour is shared by the whole architecture. Soft scene lighting
// separates planes by direction, while vertex colour keeps the small recesses
// inside shelves legible without introducing differently coloured panels.
function shadedMaterial(texture, color = 0xffffff, roughness = 0.9) {
  return new THREE.MeshStandardMaterial({
    color,
    map: texture,
    vertexColors: true,
    roughness,
    metalness: 0,
  });
}

// The floor/ceiling/wall shell has no per-vertex authored recess tones, but it
// still needs the same broad material response as the built-ins. Using the
// unlit-looking colour multiplication of a plain textured material twice darkened the
// procedural texture; this neutral shell texture leaves the palette to the
// constants and the form to actual lighting.
function shellMaterial(color, roughness = 0.94) {
  return new THREE.MeshStandardMaterial({
    color,
    vertexColors: true,
    roughness,
    metalness: 0,
  });
}

const woodTexture = timberTexture();
const graphiteTexture = timberTexture();
const leatherTexture = pencilTexture('#c4c4c4', '#171717', 145);

// Floor, ceiling and wall are one continuous paper architecture. Their former
// three greys made the opening of the well and every change of plane read as
// inserted panels when seen from a passage.
export const floorMaterial = shellMaterial(WORLD_FLOOR_COLOR, 0.88);
export const ceilingMaterial = shellMaterial(WORLD_CEILING_COLOR);

// Distance may remove a floor through fog, but direction never may. Earlier
// vista shaders discarded horizontal surfaces at shallow viewing angles. That
// made the same slab appear and disappear as the player turned their head and
// broke the premise of one continuous architecture. Vista and active rooms now
// share the exact materials; thickness at the well lip supplies the edge-on
// reading instead of camera-dependent deletion.
export const vistaFloorMaterial = floorMaterial;
export const vistaCeilingMaterial = ceilingMaterial;
// Everything below is built through the merged static batches, which always
// supply a colour attribute.
// Casework, treads and rails are the warm half of the world. The hatching in
// the texture is unchanged and still does the drawing; only what it is drawn on
// has a colour now. Keeping the same texture is what stops the wood reading as
// a flat paint chip: the grain is the same pencil the rest of the room is in.
// Old varnish, not raw board: rough enough to stay wood, smooth enough that
// every lantern leaves a small warm glint along a rail or a shelf edge. Those
// glints are most of what draws the timber in the reference.
export const shelfMaterial = shadedMaterial(woodTexture, WOOD_COLOR, 0.68);
export const trimMaterial = shadedMaterial(graphiteTexture, TRIM_WOOD_COLOR, 0.6);
export const wallMaterial = shellMaterial(WORLD_SURFACE_COLOR);
export const metalMaterial = new THREE.MeshStandardMaterial({
  color: 0x171514,
  map: graphiteTexture,
  vertexColors: true,
  roughness: 0.66,
  metalness: 0.62,
});
export const brassMaterial = new THREE.MeshStandardMaterial({
  color: 0x7d4b22,
  map: woodTexture,
  vertexColors: true,
  roughness: 0.56,
  metalness: 0.45,
});
// An arris is drawn, not inked. At near-black the lines read as a border round
// every surface — a drawn outline of a room rather than the room itself — and
// in a passage, where the same few edges converge and repeat down the whole
// corridor, they were the loudest thing in view. Taken to graphite and let down
// in opacity, they do the one job they are actually for: telling a white wall
// from a white ceiling. They cannot go further than this. The world is white on
// white and these edges are the only thing separating one surface from another;
// without them a chamber is a set of shelves floating in a pale field, which is
// exactly what it looked like the one time they were dropped.
export const outlineMaterial = new THREE.LineBasicMaterial({
  color: 0x291b14,
  transparent: true,
  opacity: 0.11,
  depthWrite: false,
});
// The six vertical corners of the hexagon, and most of what says "hexagon" at
// all. Kept a touch lighter still: they are long, they run the full height, and
// they are the lines a walker sees edge-on from every position in the room.
export const roomLineMaterial = new THREE.LineBasicMaterial({
  color: 0x4a352b,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
});

// A lantern is the only thing here that emits rather than receives, so it is
// the only unlit material in the room: it must stay at its own brightness when
// everything around it has been let down far enough for its pool to show.
// Fog does not reach it. Haze swallows the timber a few floors down, but a
// flame is still a point of light at the bottom of the shaft: that is how the
// reference shows its depth, as hundreds of lanterns hanging in dark air.
export const lampMaterial = new THREE.MeshBasicMaterial({ color: LAMP_GLOBE_COLOR, toneMapped: false, fog: false });
// Distant fixtures occupy only a few pixels and receive no useful modelling
// from a lit metal shader. Sharing the emissive material with their flame keeps
// the constellation in one draw call. This alias belongs after lampMaterial:
// module initialisation must never read the binding before it exists.
export const distantFixtureMaterial = lampMaterial;
export const lampHaloMaterial = new THREE.MeshBasicMaterial({
  color: 0xffaa62,
  transparent: true,
  opacity: 0.05,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  toneMapped: false,
});

function dustTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 15);
  // Neutral: a mote's colour is its own (DUST_WARM_COLOR out in the shaft,
  // the column's inside it), carried by its vertex colour.
  gradient.addColorStop(0, 'rgba(255, 255, 255, .95)');
  gradient.addColorStop(0.18, 'rgba(255, 255, 255, .42)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255, 236, 196, 1)');
  gradient.addColorStop(0.08, 'rgba(255, 196, 112, .85)');
  gradient.addColorStop(0.3, 'rgba(255, 150, 64, .22)');
  gradient.addColorStop(1, 'rgba(255, 120, 40, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The halo a lantern makes in hazy air. Sized in world units so that a flame
// across the well is a soft bead of light and one forty floors down a spark.
export const lanternGlowMaterial = new THREE.PointsMaterial({
  color: 0xffb566,
  map: glowTexture(),
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  size: 2.6,
  sizeAttenuation: true,
  fog: false,
  toneMapped: false,
});

// Light falling down the axis of the well, the column every reference of the
// library shows coming through the haze from somewhere far above. It has no
// source: the shaft has no top. It is a glow drawn on an open cylinder, so what
// decides its brightness is how much lit air the eye looks through. A line of
// sight through the middle of the column crosses the most of it and a grazing
// one almost none, which is |normal · view| on the face behind. Only that far
// face is drawn: it is the one every line of sight meets, from outside the
// column or standing in it, and one face instead of two halves what the light
// costs to fill. The column thins out up and down the
// shaft over the same distance the fog takes the lanterns. It is pale and
// cold, the light of the haze overhead (core/haze.js) rather than of a flame,
// and it belongs to the shaft above the walker: below their storey it is
// almost gone, so the light is something one would have to climb towards.
export const lightShaftMaterial = new THREE.ShaderMaterial({
  uniforms: {
    color: { value: new THREE.Color(0xd3dbe1) },
    strength: { value: 0.24 },
    halfHeight: { value: 1 },
  },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vHeight;
    varying float vAngle;
    varying float vRise;
    uniform float halfHeight;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vAngle = atan(position.z, position.x);
      vNormal = normalize(mat3(modelMatrix) * normal);
      vView = cameraPosition - world.xyz;
      vHeight = position.y / halfHeight;
      // Height above the eye rather than above the storey's floor: the column
      // is re-centred on each new storey as a climb crosses it, and the eye
      // drops by the same storey in the same frame, so this does not jump.
      vRise = (world.y - cameraPosition.y) / halfHeight;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: `
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vHeight;
    varying float vAngle;
    varying float vRise;
    uniform vec3 color;
    uniform float strength;
    void main() {
      float facing = abs(dot(normalize(vNormal), normalize(vView)));
      float body = 0.4 * pow(facing, 2.2) + 0.6 * pow(facing, 9.0);
      // Rays, not a lit tube: brighter and darker streaks round the column,
      // in multiples of six so they repeat with the hexagon of the well and
      // every side of it sees the same light.
      float rays = 0.62
        + 0.22 * sin(vAngle * 18.0)
        + 0.16 * sin(vAngle * 30.0 + 1.3);
      body *= rays;
      float fade = 1.0 - smoothstep(0.35, 1.0, abs(vHeight));
      float source = mix(0.12, 1.3, smoothstep(-0.45, 0.7, vRise));
      gl_FragColor = vec4(color * body * fade * source * strength, 1.0);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.BackSide,
  fog: false,
  toneMapped: false,
});

// Dust out in the shaft is lit by the lanterns: amber, as it always was (the
// old texture's own tint is folded in, so these motes are unchanged).
export const DUST_WARM_COLOR = new THREE.Color(0xe4a361).multiply(new THREE.Color(1, 0.84, 0.6));
export const dustMaterial = new THREE.PointsMaterial({
  color: 0xffffff,
  map: dustTexture(),
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexColors: true,
  size: 0.18,
  sizeAttenuation: true,
  toneMapped: false,
});

export const vistaOutlineMaterial = new THREE.LineBasicMaterial({
  color: 0x4b3326,
  transparent: true,
  opacity: 0.035,
  depthWrite: false,
});

// Every volume is the same paper white. Shape comes from the shared face tones,
// outlines and spine lettering, never from alternating coloured materials.
export const bookMaterials = [shadedMaterial(leatherTexture, BOOK_COLOR)];

// The gallery tiers and the shaft's distant volumes stand far from any lamp,
// and a real light for every tier costs the whole frame (about 40% in
// software rendering). Their leather glows faintly of its own instead, as if
// lit by the lamps on the tier, at no cost per light.
export const galleryBookMaterial = shadedMaterial(leatherTexture, BOOK_COLOR);
galleryBookMaterial.emissive = new THREE.Color(0xa56a42);
galleryBookMaterial.emissiveMap = leatherTexture;
galleryBookMaterial.emissiveIntensity = 0.3;
// The glow takes each volume's own binding and shade, as its colour does, so a
// gallery reads as bound in many colours like the floor and not as one cream
// wash.
galleryBookMaterial.onBeforeCompile = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n      totalEmissiveRadiance *= vColor.rgb;');
};
