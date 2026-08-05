/** Scene, camera and renderer: the pieces every other layer draws into. */

import * as THREE from 'three';

// A hidden or zero-height viewport would otherwise make the aspect NaN, which
// poisons the projection matrix and silently breaks picking as well as render.
export const viewportWidth = () => Math.max(1, innerWidth);
export const viewportHeight = () => Math.max(1, innerHeight);

export const scene = new THREE.Scene();
// The same colour as the fog, and it has to be: the background is drawn with no
// fog applied at all, so wherever the corridor runs out of geometry it showed
// as a bright square hanging in the grey — the one place the recession admitted
// it ended. Matched, the hole is indistinguishable from distance.
const DISTANCE = 0xd3cfc3;
scene.background = new THREE.Color(DISTANCE);
// Deliberately a shade darker than the paper. Fog the colour of the background
// made the corridor recede into glare, where nothing could be read; a drawing
// puts distance into grey instead, as lines crowd together. At room scale this
// is about one percent and invisible — it only tells in the passages.
//
// Thin enough that the corridor keeps its repeats: the recession is sold by how
// many chambers a walker can count before the grey takes them, and at 0.013 it
// took them by the third. The far plane is set past the last chamber the vista
// builds, allowing for a walker standing at the far end of a passage.
scene.fog = new THREE.FogExp2(DISTANCE, 0.0095);

export const camera = new THREE.PerspectiveCamera(70, viewportWidth() / viewportHeight(), 0.08, 260);
camera.position.set(0, 1.65, 5.2);

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.domElement.className = 'world-canvas';
renderer.setSize(viewportWidth(), viewportHeight());
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.prepend(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x9d9a94, 1.55));

export const renderedWorld = new THREE.Group();
scene.add(renderedWorld);

export function resizeView() {
  const width = viewportWidth();
  const height = viewportHeight();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

export function render() {
  renderer.render(scene, camera);
}
