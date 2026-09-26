/**
 * The glow around every light in the building.
 *
 * There is no post-processing library here — the project vendors the three core
 * and nothing else — so this is the whole chain, written out: render the world
 * into a buffer instead of onto the canvas, pull out the pixels brighter than a
 * threshold, blur them twice, and add them back.
 *
 * It is not decoration. Every light in this world is a small object seen from a
 * long way off: a lantern on a rail thirty metres down the shaft covers about a
 * pixel, and a pixel cannot look like a flame. Bloom is what turns those pixels
 * into sources — it is the difference between a dot and a light, and between a
 * dark room and a dark room with lamps in it.
 *
 * The blur runs at half resolution in two separable passes. Separable means a
 * 9-tap horizontal followed by a 9-tap vertical costs 18 samples for the same
 * result a 81-sample square kernel would give, and doing it at half resolution
 * quarters that again.
 */

import * as THREE from 'three';

const quadGeometry = new THREE.PlaneGeometry(2, 2);
const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// Every pass draws the same full-screen triangle pair; only the material differs.
function quadPass(material) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(quadGeometry, material));
  return scene;
}

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// A soft knee rather than a hard cut. A hard threshold makes a lantern pop into
// bloom the moment it crosses it, which reads as flicker when the walker moves.
const brightMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tScene: { value: null },
    threshold: { value: 0.52 },
    knee: { value: 0.28 },
  },
  vertexShader: VERTEX,
  fragmentShader: `
    uniform sampler2D tScene;
    uniform float threshold;
    uniform float knee;
    varying vec2 vUv;
    void main() {
      vec3 colour = texture2D(tScene, vUv).rgb;
      float brightest = max(colour.r, max(colour.g, colour.b));
      float weight = smoothstep(threshold, threshold + knee, brightest);
      gl_FragColor = vec4(colour * weight, 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
});

const blurMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tSource: { value: null },
    direction: { value: new THREE.Vector2(1, 0) },
    texel: { value: new THREE.Vector2() },
  },
  vertexShader: VERTEX,
  fragmentShader: `
    uniform sampler2D tSource;
    uniform vec2 direction;
    uniform vec2 texel;
    varying vec2 vUv;
    void main() {
      // A nine-tap gaussian, folded to five samples by reading between texels
      // and letting the hardware do half of the weighting.
      float w0 = 0.2270270270;
      float w1 = 0.3162162162;
      float w2 = 0.0702702703;
      vec2 off1 = direction * texel * 1.3846153846;
      vec2 off2 = direction * texel * 3.2307692308;
      vec3 sum = texture2D(tSource, vUv).rgb * w0;
      sum += texture2D(tSource, vUv + off1).rgb * w1;
      sum += texture2D(tSource, vUv - off1).rgb * w1;
      sum += texture2D(tSource, vUv + off2).rgb * w2;
      sum += texture2D(tSource, vUv - off2).rgb * w2;
      gl_FragColor = vec4(sum, 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
});

// The only pass that reaches the canvas, so it is the only one that owes the
// output an sRGB encode. The chunk is three's own, so this stays correct if the
// renderer's output colour space is ever changed.
const compositeMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tScene: { value: null },
    tBloom: { value: null },
    strength: { value: 1.35 },
  },
  vertexShader: VERTEX,
  fragmentShader: `
    uniform sampler2D tScene;
    uniform sampler2D tBloom;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec3 base = texture2D(tScene, vUv).rgb;
      vec3 glow = texture2D(tBloom, vUv).rgb;
      gl_FragColor = vec4(base + glow * strength, 1.0);
      #include <colorspace_fragment>
    }`,
  depthTest: false,
  depthWrite: false,
});

const brightScene = quadPass(brightMaterial);
const blurScene = quadPass(blurMaterial);
const compositeScene = quadPass(compositeMaterial);

// Half float, because the scene is tone-mapped but not clamped and a lantern
// core sits well above one. Stencil and depth are required: the whole portal
// composition happens inside this buffer.
export const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
  depthBuffer: true,
  stencilBuffer: true,
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
});

function blurTarget() {
  return new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
}

const bloomA = blurTarget();
const bloomB = blurTarget();

export function resizeBloom(width, height, pixelRatio) {
  const w = Math.max(1, Math.floor(width * pixelRatio));
  const h = Math.max(1, Math.floor(height * pixelRatio));
  sceneTarget.setSize(w, h);
  const halfW = Math.max(1, Math.floor(w / 2));
  const halfH = Math.max(1, Math.floor(h / 2));
  bloomA.setSize(halfW, halfH);
  bloomB.setSize(halfW, halfH);
  blurMaterial.uniforms.texel.value.set(1 / halfW, 1 / halfH);
}

/**
 * Turns the rendered frame in `sceneTarget` into the finished image on screen.
 *
 * Called after the world — including every portal pass — has been drawn into
 * the buffer.
 */
export function composeFrame(renderer) {
  const previousAutoClear = renderer.autoClear;
  renderer.autoClear = true;

  brightMaterial.uniforms.tScene.value = sceneTarget.texture;
  renderer.setRenderTarget(bloomA);
  renderer.render(brightScene, quadCamera);

  // Two full separable blurs. One is not enough: a lantern is a couple of
  // pixels across and a single nine-tap pass leaves it a slightly larger dot
  // rather than a halo that reaches into the haze around it.
  for (const [from, to, dx, dy] of [
    [bloomA, bloomB, 1, 0],
    [bloomB, bloomA, 0, 1],
    [bloomA, bloomB, 1, 0],
    [bloomB, bloomA, 0, 1],
  ]) {
    blurMaterial.uniforms.tSource.value = from.texture;
    blurMaterial.uniforms.direction.value.set(dx, dy);
    renderer.setRenderTarget(to);
    renderer.render(blurScene, quadCamera);
  }

  compositeMaterial.uniforms.tScene.value = sceneTarget.texture;
  compositeMaterial.uniforms.tBloom.value = bloomA.texture;
  renderer.setRenderTarget(null);
  renderer.render(compositeScene, quadCamera);

  renderer.autoClear = previousAutoClear;
}
