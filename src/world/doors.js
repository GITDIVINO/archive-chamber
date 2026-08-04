/**
 * Doorways between neighbouring hexes.
 *
 * A wall index is also its axial direction. In the plane hexes tile exactly and
 * two chambers are 2 x APOTHEM apart, but behind each free wall is a passage —
 * see passage.js — and a passage is not in the plane. So a doorway opens on a
 * corridor rather than straight into the neighbour, and this file is where the
 * two spaces meet: which one the player is in, what stops them in each, and
 * which of a passage's four exits they have stepped through.
 */

import { freeWallsForLevel } from '../../world-engine.js';
import {
  ALCOVE_REACH,
  APOTHEM,
  DOOR_HALF_WIDTH,
  HALL_HALF_WIDTH,
  HALL_LENGTH,
  HALL_SIDE_CENTRE,
  HALL_SIDE_HALF,
  HALL_START,
  PLAYER_BOUNDARY,
  PLAYER_RADIUS,
  SIDE_EXIT_REACH,
  STAIR_CENTRE,
  STAIR_EXIT_REACH,
  STAIR_HALF,
  DOOR_WALL_THICKNESS,
} from '../constants.js';
import { wallBasis } from './geometry.js';

// Half-width the player's centre may reach before the jambs stop them.
const DOOR_CLEAR_HALF_WIDTH = DOOR_HALF_WIDTH - PLAYER_RADIUS;

/** Which walls a level leaves open. The pair turns as the player climbs. */
export function doorWallsForLevel(level) {
  return freeWallsForLevel(level);
}

export function isDoorWall(index, level) {
  return freeWallsForLevel(level).includes(index);
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
export function isWithinDoorway(index, level, x, z) {
  if (!isDoorWall(index, level)) return false;
  return Math.abs(wallCoordinates(index, x, z).tangent) <= DOOR_CLEAR_HALF_WIDTH;
}

// Only somebody standing inside the opening can be this deep, because anywhere
// else the wall has already stopped them. Sliding along a jamb is gated on it:
// keyed on the player boundary instead, the test also passed in the corners of
// the room, where a player is exactly boundary-far from both adjacent walls but
// several units off to one side. It clamped that sideways offset to the width
// of the opening and threw them bodily into the doorway.
const DOOR_THRESHOLD_DEPTH = APOTHEM - DOOR_WALL_THICKNESS / 2;

/**
 * Keeps the player inside the room, letting them pass only where a doorway
 * actually is. Beyond the wall line the opening also acts as jambs, so stepping
 * sideways in the threshold cannot pop them back into the room.
 */
function constrainToRoom(position, level) {
  const free = freeWallsForLevel(level);
  for (let index = 0; index < 6; index++) {
    const { basis, normal, tangent } = wallCoordinates(index, position.x, position.z);
    if (normal <= PLAYER_BOUNDARY) continue;

    if (free.includes(index)) {
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

// Inside the hexagon no point is further than APOTHEM from a wall plane, and
// the walls stop the player well short of that, so being past the mouth of a
// passage is proof they went through a doorway rather than into a corner. The
// two free walls face each other, so at most one of them can be the passage.
function hallAt(position, level) {
  for (const wall of freeWallsForLevel(level)) {
    const { basis, normal, tangent } = wallCoordinates(wall, position.x, position.z);
    if (normal <= HALL_START) continue;
    return { wall, basis, normal, tangent, along: normal - HALL_START };
  }
  return null;
}

const HALL_CLEAR_HALF_WIDTH = HALL_HALF_WIDTH - PLAYER_RADIUS;
const ALCOVE_CLEAR_REACH = ALCOVE_REACH - PLAYER_RADIUS;
const OPENING_CLEAR_HALF = HALL_SIDE_HALF - PLAYER_RADIUS;

// Which bay a walker is level with, or null for blank wall. The stair is cut
// into the left side only — left being negative tangent, see hall.js — so the
// same point opposite it is wall.
function openingAt(along, tangent, margin) {
  if (Math.abs(along - HALL_SIDE_CENTRE) <= margin) return HALL_SIDE_CENTRE;
  if (tangent < 0 && Math.abs(along - STAIR_CENTRE) <= margin) return STAIR_CENTRE;
  return null;
}

function constrainToHall(position, hall) {
  const { basis, along, tangent } = hall;
  const opening = openingAt(along, tangent, OPENING_CLEAR_HALF);
  const reach = opening === null ? HALL_CLEAR_HALF_WIDTH : ALCOVE_CLEAR_REACH;
  const sideways = Math.min(Math.abs(tangent), reach) * Math.sign(tangent);

  if (Math.abs(sideways) > HALL_HALF_WIDTH) {
    // Inside a bay: its own jambs now bound how far along the passage the
    // player may drift, or they would walk out through the side wall.
    const limit = OPENING_CLEAR_HALF;
    const offset = along - opening;
    if (Math.abs(offset) > limit) {
      const correction = Math.sign(offset) * limit - offset;
      position.x += basis.nx * correction;
      position.z += basis.nz * correction;
    }
  }
  const correction = sideways - tangent;
  if (correction !== 0) {
    position.x += basis.tx * correction;
    position.z += basis.tz * correction;
  }
}

/**
 * Keeps the player inside whichever space they are actually in.
 *
 * A passage is not part of the hexagon, so the room's own walls must stop
 * applying the moment the player is inside one: several of them are edge-on to
 * a passage and would shove a walker sideways out of it.
 */
export function constrainToPlace(position, level) {
  const hall = hallAt(position, level);
  if (hall) constrainToHall(position, hall);
  else constrainToRoom(position, level);
}

/**
 * Where a walker stands as the hex plane sees it.
 *
 * A passage is not in the plane: it has no length there, and the two chambers
 * it joins are exactly as adjacent as they were. So walking fifteen units down
 * one moves nobody at all — on the map a walker leaves their chamber by a
 * doorway and stops dead against it, and stays there however far they go, until
 * they come out somewhere else entirely.
 *
 * Only the free walls can be passed at all, and they face each other, so at
 * most one of them can be the one a walker has gone through.
 */
export function planePosition(position, level) {
  let x = position.x;
  let z = position.z;
  for (const wall of freeWallsForLevel(level)) {
    const { basis, normal, tangent } = wallCoordinates(wall, x, z);
    if (normal <= APOTHEM) continue;
    const inward = APOTHEM - normal;
    // Sideways too: an alcove reaches past the width of the doorway, and in the
    // plane there is no doorway that wide.
    const limit = Math.min(Math.abs(tangent), DOOR_HALF_WIDTH) * Math.sign(tangent);
    x += basis.nx * inward + basis.tx * (limit - tangent);
    z += basis.nz * inward + basis.tz * (limit - tangent);
  }
  return { x, z };
}

/**
 * The exit a player has stepped through, or null.
 *
 * `back` is not reported: walking out of the near end of a passage is walking
 * into the chamber it belongs to, which needs no transition at all.
 */
export function crossedPassageExit(position, level) {
  const hall = hallAt(position, level);
  if (!hall) return null;
  if (hall.along > HALL_LENGTH + 0.05) return { wall: hall.wall, exit: 'ahead' };

  // The stair bay, on the left: the well is the half nearer the mouth of the
  // passage, the flight the half beyond it. Nobody climbs the flight — stepping
  // onto it is the transition, exactly as stepping into an alcove is.
  if (hall.tangent < -STAIR_EXIT_REACH && Math.abs(hall.along - STAIR_CENTRE) <= STAIR_HALF) {
    return { wall: hall.wall, exit: hall.along < STAIR_CENTRE ? 'down' : 'up' };
  }

  if (Math.abs(hall.along - HALL_SIDE_CENTRE) > HALL_SIDE_HALF) return null;
  // Facing along the passage, +tangent is the walker's right; see hall.js.
  if (hall.tangent > SIDE_EXIT_REACH) return { wall: hall.wall, exit: 'right' };
  if (hall.tangent < -SIDE_EXIT_REACH) return { wall: hall.wall, exit: 'left' };
  return null;
}
