/** Scene, camera and renderer: the pieces every other layer draws into. */

import * as THREE from 'three';
import {
  PLAYER_START_X,
  PLAYER_START_Z,
  WORLD_AMBIENT_COLOR,
  WORLD_DISTANCE_COLOR,
  WORLD_GROUND_FILL_COLOR,
  WORLD_SKY_FILL_COLOR,
} from '../constants.js';
import { composeFrame, resizeBloom, sceneTarget } from './bloom.js';
import { hazeBackground } from './haze.js';

// A hidden or zero-height viewport would otherwise make the aspect NaN, which
// poisons the projection matrix and silently breaks picking as well as render.
export const viewportWidth = () => Math.max(1, innerWidth);
export const viewportHeight = () => Math.max(1, innerHeight);

export const scene = new THREE.Scene();
// The same colour as the fog and every structural plane. The central well is a
// real opening, so a different clear colour showed through it as a vast beige
// panel when a chamber was viewed from its passage.
const DISTANCE = WORLD_DISTANCE_COLOR;
// Past the last storey there is only haze, in the colour the fog itself takes
// in that direction: pale overhead, near black underfoot, the distance tone
// level with the eye (core/haze.js). Distant floors fade into it without a seam.
scene.background = hazeBackground();
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
export const WORLD_FOG_DENSITY = 0.012;
scene.fog = new THREE.FogExp2(DISTANCE, WORLD_FOG_DENSITY);

// The portal stencil lies only a few centimetres behind a side threshold.  A
// human-scale near plane keeps that aperture alive until the exact crossing;
// at 0.08 it was clipped one step early and exposed the unrelated base vista.
export const camera = new THREE.PerspectiveCamera(70, viewportWidth() / viewportHeight(), 0.02, 320);
camera.position.set(PLAYER_START_X, 1.65, PLAYER_START_Z);

export const renderer = new THREE.WebGLRenderer({
  // The canvas only ever receives the finished frame, a single full-screen
  // quad, so smoothing it buys nothing. The world is smoothed where it is
  // drawn: in the multisampled frame buffer in bloom.js.
  antialias: false,
  powerPreference: 'high-performance',
  // Side destinations are true apertures. Their geometry is drawn only where
  // the corresponding doorway has written into this buffer.
  stencil: true,
});
renderer.domElement.className = 'world-canvas';
renderer.setSize(viewportWidth(), viewportHeight());
// A retina screen is drawn at its own resolution. Any fraction of it (the old
// cap was 1.7) has to be stretched back up to the screen's pixels, and that
// stretch is what made every edge and every spine soft. A chip that cannot
// afford the full resolution steps down on its own: see adaptResolution below.
const MAX_PIXEL_RATIO = Math.max(1, Math.min(devicePixelRatio, 2));
renderer.setPixelRatio(MAX_PIXEL_RATIO);
// The multisampled frame buffer is drawn into several times a frame (the
// world, then every doorway through its stencil), and three.js resolves it
// after each of those draws. After resolving it also tells the driver that the
// samples, depth and stencil may be thrown away, and on a tiled chip such as
// Apple's they are: the next doorway would be drawn over garbage and against a
// lost stencil. The hint is only an optimisation, so it is simply not given.
renderer.getContext().invalidateFramebuffer = () => {};
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
// Shadows are cast by the architecture alone: nothing that throws one ever
// moves, and a lantern hangs where it was built. Redrawing every lantern's
// cube map on every frame was nearly the whole cost of a frame (6.3 s of 6.35 s
// under software rendering, 290 of 422 draws), and it was the same picture
// each time. A scene's maps are therefore drawn again only when the set of
// lanterns that cast them, or the set of rooms in the world, has changed:
// entering a chamber, releasing one, or adopting a portal destination.
const drawShadows = renderer.shadowMap.render;
const shadowSignatures = new WeakMap();
renderer.shadowMap.render = function (lights, shadowScene, shadowCamera) {
  let signature = lights.map(light => light.id).join(',');
  if (shadowScene === scene) signature += '|' + renderedWorld.children.map(child => child.id).join(',');
  if (shadowSignatures.get(shadowScene) === signature) return;
  shadowSignatures.set(shadowScene, signature);
  drawShadows.call(this, lights, shadowScene, shadowCamera);
};
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 2.4;
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
scene.add(new THREE.HemisphereLight(WORLD_SKY_FILL_COLOR, WORLD_GROUND_FILL_COLOR, 1.6));
scene.add(new THREE.AmbientLight(WORLD_AMBIENT_COLOR, 0.5));
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
// Neutral to cold, like the haze it stands for: the warm tint it used to carry
// was laid over every surface in the building, lamp or no lamp.
export const keyLight = new THREE.DirectionalLight(0xe8edf2, 0.22);
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

// --- resolution that follows the chip ---------------------------------------
//
// render() below skips a tick whenever the last frame is still on the chip, so
// the share of ticks that actually drew says directly whether the graphics can
// keep up. When they plainly cannot for two seconds running, the frame is drawn
// at a quarter step fewer pixels per point; when they have kept up with room to
// spare for a while, a quarter step is tried back. A step that has just failed
// is not retried for a minute, so the resolution settles instead of hunting.
const PIXEL_RATIO_STEP = 0.25;
const MIN_PIXEL_RATIO = 1;
const resolution = {
  windowStart: 0,
  ticks: 0,
  drawn: 0,
  slow: 0,
  fast: 0,
  settleUntil: 0,
  failedAt: new Map(),
};

function setRenderPixelRatio(ratio) {
  renderer.setPixelRatio(ratio);
  resizeBloom(viewportWidth(), viewportHeight(), ratio);
  document.documentElement.dataset.pixelRatio = String(ratio);
}
document.documentElement.dataset.pixelRatio = String(MAX_PIXEL_RATIO);

function adaptResolution(drew) {
  if (MAX_PIXEL_RATIO <= MIN_PIXEL_RATIO) return;
  const now = performance.now();
  // The first frames compile every shader and draw the shadows; they are not
  // what walking costs.
  if (!resolution.settleUntil) resolution.settleUntil = now + 3000;
  if (now < resolution.settleUntil) return;
  if (!resolution.windowStart) resolution.windowStart = now;
  resolution.ticks++;
  if (drew) resolution.drawn++;
  const elapsed = now - resolution.windowStart;
  if (elapsed < 1000) return;
  const fps = resolution.drawn * 1000 / elapsed;
  const share = resolution.drawn / resolution.ticks;
  // A hidden tab, a panel or a long pause stops the ticks; such a window says
  // nothing about the chip.
  const meaningful = elapsed < 2000;
  resolution.windowStart = now;
  resolution.ticks = 0;
  resolution.drawn = 0;
  if (!meaningful) return;
  // Slow only if the chip is what held the frames back. A busy main thread
  // slows the ticks themselves, and fewer pixels would not help it.
  const slow = fps < 50 && share < 0.8;
  const fast = share > 0.95 && fps > 57;
  resolution.slow = slow ? resolution.slow + 1 : 0;
  resolution.fast = fast ? resolution.fast + 1 : 0;
  const ratio = renderer.getPixelRatio();
  let next = ratio;
  if (resolution.slow >= 2 && ratio > MIN_PIXEL_RATIO) {
    resolution.failedAt.set(ratio, now);
    next = Math.max(MIN_PIXEL_RATIO, ratio - PIXEL_RATIO_STEP);
  } else if (resolution.fast >= 8 && ratio < MAX_PIXEL_RATIO) {
    const up = Math.min(MAX_PIXEL_RATIO, ratio + PIXEL_RATIO_STEP);
    if (now - (resolution.failedAt.get(up) ?? -Infinity) > 60000) next = up;
  }
  if (next === ratio) return;
  resolution.slow = 0;
  resolution.fast = 0;
  // The first frames at a new size reallocate the buffers; judge after them.
  resolution.settleUntil = now + 1500;
  setRenderPixelRatio(next);
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
  const gl = renderer.getContext();
  // A slow graphics chip must not be handed a new frame before it has
  // finished the last one. Frames it cannot keep up with would queue behind
  // each other, and every step, click and page change would wait for the
  // whole queue: the walk would freeze for seconds at a time. Until the last
  // frame is done the screen simply keeps showing it.
  if (frameInFlight) {
    if (gl.getSyncParameter(frameInFlight, gl.SYNC_STATUS) === gl.SIGNALED) {
      gl.deleteSync(frameInFlight);
      frameInFlight = null;
      for (const shown of framesAwaited.splice(0)) shown();
    }
  }
  if (frameInFlight) {
    adaptResolution(false);
    return;
  }
  adaptResolution(true);
  if (portalRenderPass) portalRenderPass();
  else {
    renderer.setRenderTarget(sceneTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
  }
  composeFrame(renderer);
  frameInFlight = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  framesAwaited.push(...framesRequested.splice(0));
}

let frameInFlight = null;
const framesRequested = [];
const framesAwaited = [];

/** Resolves once a frame drawn from now on has reached the screen. */
export function nextFrameShown() {
  return new Promise(shown => framesRequested.push(shown));
}
