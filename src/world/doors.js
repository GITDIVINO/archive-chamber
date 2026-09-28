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
  HALL_JUNCTION_CHAMFER,
  HALL_LENGTH,
  HALL_SIDE_CENTRE,
  HALL_SIDE_HALF,
  HALL_START,
  PLAYER_BOUNDARY,
  PLAYER_RADIUS,
  SIDE_EXIT_REACH,
  STAIR_MOUNT_REACH,
  WALL_THICKNESS,
} from '../constants.js';
import { wallBasis } from './geometry.js';
import { constrainFromWell, stairSurfaceAt } from './well.js';
import { galleryHeightAt } from './galleries.js';

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
const DOOR_THRESHOLD_DEPTH = APOTHEM - WALL_THICKNESS / 2;

/**
 * Keeps the player inside the room, letting them pass only where a doorway
 * actually is. Beyond the wall line the opening also acts as jambs, so stepping
 * sideways in the threshold cannot pop them back into the room.
 */
function constrainToRoom(position, level, footY) {
  constrainFromWell(position, footY);
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

function constrainToHall(position, hall) {
  const { basis, along, tangent } = hall;
  const atCrossing = Math.abs(along - HALL_SIDE_CENTRE) <= OPENING_CLEAR_HALF;

  // Past the line of the passage wall, and level with the opening, there is
  // only one place to be: a side arm. Its own two walls bound how far along the
  // passage the walker may drift; sideways it is open at the far end, exactly
  // as the passage is at both of its own, and the crossing there hands them to
  // a chamber.
  //
  // The two questions are asked against different lines, and they have to be.
  // Being in an arm is measured against the arm's own walls; being held off
  // those walls is measured a body's radius inside them. Asked against the same
  // line, each condition became the other's negation: the correction below
  // could never run, and a walker who put a foot past it stopped counting as
  // being in an arm at all — falling to the rule for the corridor, which
  // measured them against a half-width of a metre and threw them the whole
  // depth of the arm back into the passage. Hugging an arm's wall is exactly
  // what sits a walker on that line, which is why it happened there and
  // nowhere else.
  //
  // The gap between the two lines is one PLAYER_RADIUS, 0.28, and it cannot be
  // stepped over: the fastest anybody moves is RUN_SPEED against a frame time
  // held to 0.05, which is 0.275 in total and less than that along any one
  // axis.
  const offset = along - HALL_SIDE_CENTRE;
  const tangentOverflow = Math.abs(tangent) - HALL_HALF_WIDTH;
  const offsetOverflow = Math.abs(offset) - HALL_SIDE_HALF;
  if (
    tangentOverflow > 0
    && offsetOverflow > 0
    && tangentOverflow < HALL_JUNCTION_CHAMFER
    && offsetOverflow < HALL_JUNCTION_CHAMFER
  ) {
    const centreLimit = HALL_JUNCTION_CHAMFER - PLAYER_RADIUS * Math.SQRT2;
    const correction = (centreLimit - tangentOverflow - offsetOverflow) / 2;
    if (correction < 0) {
      position.x += basis.tx * Math.sign(tangent) * correction;
      position.z += basis.tz * Math.sign(tangent) * correction;
      position.x += basis.nx * Math.sign(offset) * correction;
      position.z += basis.nz * Math.sign(offset) * correction;
    }
    return;
  }
  if (Math.abs(tangent) > HALL_HALF_WIDTH && Math.abs(offset) <= HALL_SIDE_HALF) {
    if (Math.abs(offset) > OPENING_CLEAR_HALF) {
      const correction = Math.sign(offset) * OPENING_CLEAR_HALF - offset;
      position.x += basis.nx * correction;
      position.z += basis.nz * correction;
    }
    return;
  }

  const reach = atCrossing ? ALCOVE_CLEAR_REACH : HALL_CLEAR_HALF_WIDTH;
  const correction = Math.min(Math.abs(tangent), reach) * Math.sign(tangent) - tangent;
  if (correction !== 0) {
    position.x += basis.tx * correction;
    position.z += basis.tz * correction;
  }
}

/** The free wall whose passage the walker is inside, or null for a chamber. */
export function passageWallAt(position, level) {
  return hallAt(position, level)?.wall ?? null;
}

/**
 * Keeps the player inside whichever space they are actually in.
 *
 * A passage is not part of the hexagon, so the room's own walls must stop
 * applying the moment the player is inside one: several of them are edge-on to
 * a passage and would shove a walker sideways out of it.
 */
/**
 * Keeps the player inside whichever space they are actually in, and reports how
 * high the ground under them now is.
 *
 * `footY` is where their feet were before this step, measured from the floor of
 * the chamber they are in. It is an input because the shaft carries a flight
 * every storey and the same x/z sits under two of them: which one is holding a
 * walker up cannot be read from the plan, only from where they already were.
 *
 * A passage has no well and no flight, so it always answers zero.
 */
export function constrainToPlace(position, level, footY = 0, from = null) {
  const height = settle(position, level, footY);
  if (height !== null) return height;
  // Nothing underfoot within a step: the edge of a gallery, the side of a
  // spiral stair. Slide along whichever axis still has ground, else stand.
  if (from) {
    for (const [x, z] of [[position.x, from.z], [from.x, position.z], [from.x, from.z]]) {
      position.x = x;
      position.z = z;
      const slid = settle(position, level, footY);
      if (slid !== null) return slid;
    }
  }
  return footY;
}

function settle(position, level, footY) {
  const hall = hallAt(position, level);
  if (hall) {
    constrainToHall(position, hall);
    return 0;
  }
  constrainToRoom(position, level, footY);
  const surface = stairSurfaceAt(position.x, position.z, footY);
  const ground = surface && Math.abs(surface.height - footY) <= STAIR_MOUNT_REACH ? surface.height : 0;
  // The flight in the well is the only thing that carries a walker above the
  // floor out there; the galleries and their stairs stand against the walls.
  if (ground !== 0) return ground;
  return galleryHeightAt(position.x, position.z, freeWallsForLevel(level), footY, ground);
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

  if (Math.abs(hall.along - HALL_SIDE_CENTRE) > HALL_SIDE_HALF) return null;
  // Facing along the passage, +tangent is the walker's right; see hall.js.
  if (hall.tangent > SIDE_EXIT_REACH) return { wall: hall.wall, exit: 'right' };
  if (hall.tangent < -SIDE_EXIT_REACH) return { wall: hall.wall, exit: 'left' };
  return null;
}
