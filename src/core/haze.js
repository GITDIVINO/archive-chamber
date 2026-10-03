/**
 * Haze that is lit from above.
 *
 * The references never show where the shaft ends. Upward it dissolves into a
 * pale, cold glow, as if there were sky somewhere past the last storey;
 * downward it goes to black. Both say the same thing about the library: the
 * truth is out of sight, and there is light somewhere above it.
 *
 * The fog colour therefore depends on the direction it is seen in, not on a
 * height: the building repeats without end, so "above" can only mean above
 * the walker. Level with the eye it is exactly WORLD_DISTANCE_COLOR, so every
 * view along a gallery or a corridor is as it was. Looking up, distant floors
 * fade into WORLD_HAZE_ABOVE_COLOR; looking down, into WORLD_HAZE_BELOW_COLOR.
 *
 * A direction is the same from every chamber and every storey, so the haze
 * keeps both symmetries the key light keeps (see view.js), and a portal scene,
 * which shares the shader chunks, sees exactly the same air through a doorway.
 */

import * as THREE from 'three';
import {
  WORLD_DISTANCE_COLOR,
  WORLD_HAZE_ABOVE_COLOR,
  WORLD_HAZE_BELOW_COLOR,
} from '../constants.js';

// The steepness at which each tint is fully reached, as the sine of the angle
// above or below the horizon. Haze barely changes until the eye is well off
// level, so a walker looking along a gallery sees the room as before.
// Downward the ramp is short: the level slate is paler than lit stone, and
// while it reached all the way to the floors three storeys down it lightened
// them instead of letting them sink.
const ABOVE_FROM = 0.08;
const ABOVE_TO = 0.92;
const BELOW_FROM = 0.04;
const BELOW_TO = 0.55;
// How much thicker the haze is looking straight down than looking level. With
// the same density in every direction a floor eight storeys below was still
// a seventh visible; this lets the shaft go to black a few storeys down while
// the first storey below stays a shape, and every view along a gallery or a
// corridor keeps the density it was tuned with (view.js).
const BELOW_THICKENING = 0.6;

const level = new THREE.Color(WORLD_DISTANCE_COLOR);
const above = new THREE.Color(WORLD_HAZE_ABOVE_COLOR);
const below = new THREE.Color(WORLD_HAZE_BELOW_COLOR);

// Colours are spelled out in linear space, which is where three.js applies fog,
// so the shader's mix and the background's gradient below are the same curve.
const glsl = color => `vec3(${color.r.toFixed(5)}, ${color.g.toFixed(5)}, ${color.b.toFixed(5)})`;

// The world-space offset from the eye to the fragment. `mvPosition` is in view
// space; multiplying by the view matrix from the left applies its transpose,
// which for the rotation part is its inverse. No extra uniform is needed.
THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogOffset;
#endif`;

THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogOffset = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif`;

THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogOffset;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  vec3 hazeColor( float rise ) {
    vec3 tint = mix( fogColor, ${glsl(above)}, smoothstep( ${ABOVE_FROM.toFixed(3)}, ${ABOVE_TO.toFixed(3)}, rise ) );
    return mix( tint, ${glsl(below)}, smoothstep( ${BELOW_FROM.toFixed(3)}, ${BELOW_TO.toFixed(3)}, - rise ) );
  }
#endif`;

THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  float fogRise = vFogOffset.y / max( length( vFogOffset ), 1e-4 );
  #ifdef FOG_EXP2
    float fogThickness = fogDensity * ( 1.0 + ${BELOW_THICKENING.toFixed(3)}
      * smoothstep( ${BELOW_FROM.toFixed(3)}, ${BELOW_TO.toFixed(3)}, - fogRise ) );
    float fogFactor = 1.0 - exp( - fogThickness * fogThickness * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeColor( fogRise ), fogFactor );
#endif`;

function smoothstep(from, to, value) {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** The haze colour seen in a direction whose vertical component is `rise`. */
export function hazeColorAt(rise, target = new THREE.Color()) {
  target.copy(level).lerp(above, smoothstep(ABOVE_FROM, ABOVE_TO, rise));
  return target.lerp(below, smoothstep(BELOW_FROM, BELOW_TO, -rise));
}

/**
 * What lies past the last storey in every direction: the same haze, fully
 * thick. An equirectangular strip, one pixel wide and a row per latitude, so
 * the background behind the fog is the colour the fog itself fades into.
 */
export function hazeBackground() {
  const rows = 256;
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = rows;
  const context = canvas.getContext('2d');
  const color = new THREE.Color();
  for (let row = 0; row < rows; row++) {
    // Row 0 is straight up, the last row straight down.
    const latitude = Math.PI / 2 - ((row + 0.5) / rows) * Math.PI;
    context.fillStyle = '#' + hazeColorAt(Math.sin(latitude), color).getHexString();
    context.fillRect(0, row, 2, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.userData.haze = true;
  return texture;
}
