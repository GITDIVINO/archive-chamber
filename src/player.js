/**
 * Player state shared by input, rendering and the minimap.
 *
 * Kept as one mutable object rather than exported bindings so every module
 * observes the same values without a live-binding dance.
 */

export const player = {
  yaw: 0,
  pitch: 0,
  locked: false,
  ready: false,
  // Radians of rotation per pixel of mouse movement.
  lookSensitivity: 0.0021,
};

export const keys = {};
