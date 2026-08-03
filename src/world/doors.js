/**
 * Doorways between neighbouring hexes.
 *
 * A wall index is also its axial direction, and hexes tile exactly: the centre
 * distance is 2 x APOTHEM, so adjacent walls touch with no gap. A doorway is
 * therefore a hole in a shared wall rather than a corridor, and crossing it
 * puts the player at the same physical point expressed relative to the new
 * room's centre.
 */

import {
  APOTHEM,
  DOOR_HALF_WIDTH,
  DOOR_WALLS,
  PLAYER_BOUNDARY,
  PLAYER_RADIUS,
  WALL_THICKNESS,
} from '../constants.js';
import { wallBasis } from './geometry.js';

// Crossing fires just past the mid-plane of the shared wall.
export const DOOR_CROSSING_DISTANCE = APOTHEM + 0.05;
// After arriving, the opposite doorway cannot send the player back until they
// have stepped this far inside.  Without it the entry point — which is exactly
// the crossing point — would immediately trigger a return.
const DOOR_REARM_DISTANCE = APOTHEM - 0.9;
// Half-width the player's centre may reach before the jambs stop them.
const DOOR_CLEAR_HALF_WIDTH = DOOR_HALF_WIDTH - PLAYER_RADIUS;

export function isDoorWall(index) {
  return DOOR_WALLS.has(index);
}

export function oppositeWall(index) {
  return (index + 3) % 6;
}

/** Signed distance along the wall normal, and sideways along the wall. */
export function wallCoordinates(index, x, z) {
  const basis = wallBasis(index);
  return {
    basis,
    normal: basis.nx * x + basis.nz * z,
    tangent: basis.tx * x + basis.tz * z,
  };
}

/** True while the player is lined up with the opening rather than the wall. */
export function isWithinDoorway(index, x, z) {
  if (!isDoorWall(index)) return false;
  return Math.abs(wallCoordinates(index, x, z).tangent) <= DOOR_CLEAR_HALF_WIDTH;
}

/**
 * The doorway a player at this position has stepped through, or null.
 * `blockedWall` is the wall they just arrived by; it stays inert until they
 * clear it, so a crossing never bounces straight back.
 */
export function crossedDoorway(x, z, blockedWall = null) {
  for (const index of DOOR_WALLS) {
    if (index === blockedWall) continue;
    const { normal, tangent } = wallCoordinates(index, x, z);
    if (normal < DOOR_CROSSING_DISTANCE) continue;
    if (Math.abs(tangent) > DOOR_CLEAR_HALF_WIDTH) continue;
    return index;
  }
  return null;
}

/** Whether the player has stepped far enough inside to re-arm a doorway. */
export function hasClearedDoorway(index, x, z) {
  return wallCoordinates(index, x, z).normal < DOOR_REARM_DISTANCE;
}

// Only somebody standing inside the opening can be this deep, because anywhere
// else the wall has already stopped them. Sliding along a jamb is gated on it:
// keyed on the player boundary instead, the test also passed in the corners of
// the room, where a player is exactly boundary-far from both adjacent walls but
// several units off to one side. It clamped that sideways offset to the width
// of the opening and threw them bodily into the doorway.
const DOOR_THRESHOLD_DEPTH = APOTHEM - WALL_THICKNESS / 2;

/**
 * Keeps the player inside the room, letting them pass only where a doorway
 * actually is. Beyond the wall line the opening also acts as jambs, so stepping
 * sideways in the threshold cannot pop them back into the room.
 */
export function constrainToRoom(position) {
  for (let index = 0; index < 6; index++) {
    const { basis, normal, tangent } = wallCoordinates(index, position.x, position.z);
    if (normal <= PLAYER_BOUNDARY) continue;

    if (isDoorWall(index)) {
      // Lined up with the opening: walk on through.
      if (Math.abs(tangent) <= DOOR_CLEAR_HALF_WIDTH) continue;
      // Past the wall's inner face, so they came through the opening and have
      // drifted into a jamb: slide them along it rather than back into the room.
      if (normal > DOOR_THRESHOLD_DEPTH) {
        const limit = Math.sign(tangent) * DOOR_CLEAR_HALF_WIDTH;
        const correction = limit - tangent;
        position.x += basis.tx * correction;
        position.z += basis.tz * correction;
        continue;
      }
    }

    const correction = PLAYER_BOUNDARY - normal;
    position.x += basis.nx * correction;
    position.z += basis.nz * correction;
  }
}
