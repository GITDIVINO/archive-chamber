/** Scene, camera and renderer: the pieces every other layer draws into. */

import * as THREE from 'three';

// A hidden or zero-height viewport would otherwise make the aspect NaN, which
// poisons the projection matrix and silently breaks picking as well as render.
export const viewportWidth = () => Math.max(1, innerWidth);
export const viewportHeight = () => Math.max(1, innerHeight);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f2ec);
scene.fog = new THREE.FogExp2(0xf4f2ec, 0.018);

export const camera = new THREE.PerspectiveCamera(70, viewportWidth() / viewportHeight(), 0.08, 170);
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
