/**
 * Player state shared by input, rendering and the minimap.
 *
 * Kept as one mutable object rather than exported bindings so every module
 * observes the same values without a live-binding dance.
 */

export const player = {
  yaw: 0,
  pitch: 0,
  // Pointer lock, which only exists on desktop.
  locked: false,
  // Touch devices enter the chamber without pointer lock instead.
  touchMode: false,
  ready: false,
  // Radians of rotation per pixel of mouse movement.
  lookSensitivity: 0.0021,
};

/** True whenever the player is walking the chamber rather than reading. */
export function isEngaged() {
  return player.locked || player.touchMode;
}

export const keys = {};
