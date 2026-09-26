/** Scene, camera and renderer: the pieces every other layer draws into. */

import * as THREE from 'three';
import { PLAYER_START_X, PLAYER_START_Z, WORLD_DISTANCE_COLOR } from '../constants.js';
import { composeFrame, resizeBloom, sceneTarget } from './bloom.js';

// A hidden or zero-height viewport would otherwise make the aspect NaN, which
// poisons the projection matrix and silently breaks picking as well as render.
export const viewportWidth = () => Math.max(1, innerWidth);
export const viewportHeight = () => Math.max(1, innerHeight);

export const scene = new THREE.Scene();
// The same colour as the fog and every structural plane. The central well is a
// real opening, so a different clear colour showed through it as a vast beige
// panel when a chamber was viewed from its passage.
const DISTANCE = WORLD_DISTANCE_COLOR;
scene.background = new THREE.Color(DISTANCE);
// Recession comes from the density of graphite lines rather than a second
// colour field. Keeping distance on the same paper tone prevents the open well
// from dividing a room into false foreground and background panels.
//
// Thin enough that the corridor keeps its repeats. Human-scale passages place
// the second lightweight chamber about 225 units away, safely inside the 320
// unit far plane while the last vertical floors dissolve before their cap.
// Thick enough to be air. At 0.0075 the whole ninety-unit well accumulated
// barely a third of a fog step, so nothing separated from anything behind it;
// the shaft was dark rather than deep. At this density the far side of the well
// is visibly hazed and the shaft fades out around nine floors, which is where
// the reference loses its own distance too.
export const WORLD_FOG_DENSITY = 0.016;
scene.fog = new THREE.FogExp2(DISTANCE, WORLD_FOG_DENSITY);

// The portal stencil lies only a few centimetres behind a side threshold.  A
// human-scale near plane keeps that aperture alive until the exact crossing;
// at 0.08 it was clipped one step early and exposed the unrelated base vista.
export const camera = new THREE.PerspectiveCamera(70, viewportWidth() / viewportHeight(), 0.02, 320);
camera.position.set(PLAYER_START_X, 1.65, PLAYER_START_Z);

export const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  // Side destinations are true apertures. Their geometry is drawn only where
  // the corresponding doorway has written into this buffer.
  stencil: true,
});
renderer.domElement.className = 'world-canvas';
renderer.setSize(viewportWidth(), viewportHeight());
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Highlights have to roll off rather than clip. Every vertex tone in this world
// — the shading down into a shelf, the contact shadow at the foot of a spine,
// the head of a volume under its board — was authored against a scene lit past
// one, where the bright end of each ramp was quietly cut off. Take the light
// down far enough for a lantern to register and all of that hidden range
// appears at once, and the room turns muddy. Neutral mapping keeps hue and
// saturation where filmic did not, and compresses only the top, so the room can
// be lit properly without the tones underneath it going to mud.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
document.body.prepend(renderer.domElement);

// Warmed, and left near its old strength rather than cut. A vertical wall takes
// nothing at all from a key pointing straight down, so the ambient is what
// carries every wall in the building; halving it turned the galleries to mud
// before a single lantern had been placed. The lantern earns its pool by being
// bright, not by the room being dark, and the tone mapping above is what keeps
// the top end from flattening into paper again.
// Darkness is the base state. A small neutral sky fill preserves the shape of
// an unlit wall; all warmth belongs to actual lanterns in the architecture.
// Nearly nothing, and nearly directionless. Almost three units of flat fill
// used to be poured in from here, which meant the darkness in this room was
// paint rather than light: every corner was already lit, so no lantern could
// carve anything out of it and no surface had a falloff. Sky and ground are
// held close together on purpose — a hemisphere with a bright sky lights every
// upward face at full strength, and that is what made the floor the brightest
// thing in the frame when it should be among the darkest.
scene.add(new THREE.HemisphereLight(0x3a2a1e, 0x1a120c, 0.5));
scene.add(new THREE.AmbientLight(0xffd9b0, 0.16));
// Straight down, and it has to be. A crossing is the same corridor four times
// and a chamber is the same wall six times, so the world claims two symmetries:
// a quarter turn about the passage axis and a sixth turn about the room. The
// only direction invariant under both is the vertical, and a key light with any
// horizontal component at all breaks them — measured from the middle of a
// passage, the old light at (-28, 42, 24) made the left and right arms differ
// over sixty percent of the frame, purely through N·L on walls that are
// architecturally identical. Pointing it down leaves three percent, and that
// three percent is edge rasterisation and the different chambers beyond.
//
// What is lost is directional modelling on the walls, and nothing is lost by
// it: the walls are one white paper surface whose planes are told apart by
// their arrises, never by their tone. What is kept is the separation of floor
// from wall from ceiling, which depends only on how far a surface is turned
// from the vertical, and the shadow the cabinets drop on the floor.
const keyLight = new THREE.DirectionalLight(0xffe8cc, 0.18);
keyLight.position.set(0, 72, 0);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1536, 1536);
keyLight.shadow.camera.left = -60;
keyLight.shadow.camera.right = 60;
keyLight.shadow.camera.top = 60;
keyLight.shadow.camera.bottom = -60;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 140;
keyLight.shadow.bias = -0.00035;
keyLight.shadow.normalBias = 0.025;
keyLight.shadow.radius = 4;
scene.add(keyLight);
scene.add(keyLight.target);

resizeBloom(viewportWidth(), viewportHeight(), renderer.getPixelRatio());

export const renderedWorld = new THREE.Group();
scene.add(renderedWorld);

// Non-Euclidean side exits need one additional render stage: the ordinary
// world is drawn first, then each destination is drawn through the stencil of
// its own doorway.  The view module owns the frame, while the world module owns
// what a portal means, so the latter registers the stage instead of making the
// two modules import one another in a circle.
let portalRenderPass = null;

export function setPortalRenderPass(pass) {
  portalRenderPass = pass;
}

export function resizeView() {
  const width = viewportWidth();
  const height = viewportHeight();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  resizeBloom(width, height, renderer.getPixelRatio());
}

/**
 * One frame: the world into the buffer, then the buffer through the glow.
 *
 * The portal pass owns the whole of the first half — it clears, draws the
 * ordinary world, then composes each destination through its own stencil — so
 * it is handed the buffer to draw into rather than the canvas.
 */
export function render() {
  if (portalRenderPass) portalRenderPass();
  else {
    renderer.setRenderTarget(sceneTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
  }
  composeFrame(renderer);
}
