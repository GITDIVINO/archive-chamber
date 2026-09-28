/**
 * The passages behind the free walls.
 *
 * A passage is not part of the hex plane. It has no length there and takes no
 * room on the map: two chambers stay exactly as far apart as they were, and a
 * passage between them can be as long as it likes. That is the whole trick,
 * and it is what lets a chamber keep four shelved walls and 11520 volumes while
 * still reaching every neighbour.
 *
 * On one level a chamber has two free walls, and they face each other. If a
 * passage only joined the two chambers it lies between, walking would trace a
 * line and never leave it — that is a property of the plane, and no
 * arrangement of two doorways escapes it. A passage that is not in the plane
 * has no such obligation: besides the chamber at its far end it opens on the
 * two that flank it, and two passages then reach all six neighbours.
 *
 * Leaving A by wall d, the passage offers:
 *   ahead  A + dir(d)
 *   left   A + dir(d - 1)
 *   right  A + dir(d + 1)
 *   back   A
 *
 * The two flanking chambers are exactly the ones adjacent to both ends, so a
 * passage is a property of the edge rather than of the doorway: entering from
 * either end finds the same four chambers.
 *
 * Turning round after taking a side exit does not lead back the way it came.
 * The doorway a walker arrives at belongs to the chamber they arrived in, and
 * behind it is that chamber's own passage. Every chamber reached this way can
 * still be returned from — the relation is mutual, and the tests check it — but
 * not by retracing. In a space that is admittedly not Euclidean this is left
 * as it is rather than papered over.
 */

import { freeWallsForLevel } from '../../world-engine.js';
import { WALL_DIRECTIONS } from '../../world-model.js';

/** The four ways out of a passage, in the order a walker meets them. */
export const PASSAGE_EXITS = Object.freeze(['back', 'left', 'right', 'ahead']);

function neighbour(hex, direction) {
  const [dq, dr] = WALL_DIRECTIONS[direction];
  return { q: hex.q + dq, r: hex.r + dr, level: hex.level };
}

function sameHex(a, b) {
  return a.q === b.q && a.r === b.r && a.level === b.level;
}

/**
 * Canonical identity of the passage behind a wall.
 *
 * Both ends name the same passage, so the end with the lower coordinates is
 * chosen and the wall is expressed from there.
 */
export function passageIdFor(hex, wall) {
  const far = neighbour(hex, wall);
  const nearIsLower = hex.q < far.q || (hex.q === far.q && hex.r < far.r);
  const from = nearIsLower ? hex : far;
  const direction = nearIsLower ? wall : (wall + 3) % 6;
  return { q: from.q, r: from.r, level: from.level, wall: direction };
}

export function passageKey(id) {
  return `${id.q},${id.r},${id.level},${id.wall}`;
}

/**
 * Where each exit of a passage leads, seen by somebody who entered from `hex`
 * through `wall`.
 */
export function passageExits(hex, wall) {
  return {
    back: { ...hex },
    ahead: neighbour(hex, wall),
    left: neighbour(hex, (wall + 5) % 6),
    right: neighbour(hex, (wall + 1) % 6),
  };
}

/**
 * The doorway a walker emerges from, arriving in `hex` out of a passage that
 * lies towards `from`.
 *
 * A flanking chamber has no wall facing the passage — its free walls point
 * along its own axis — so the nearest one in direction is used. This is the
 * visible face of the space not being Euclidean: a walker steps out of a
 * doorway that leads somewhere other than where they have just been.
 */
export function arrivalWallFor(hex, from, level) {
  const free = freeWallsForLevel(level);
  let towards = -1;
  for (let direction = 0; direction < WALL_DIRECTIONS.length; direction++) {
    if (sameHex(neighbour(hex, direction), from)) towards = direction;
  }
  if (towards < 0) return free[0];
  let best = free[0];
  let bestDistance = Infinity;
  for (const wall of free) {
    const raw = Math.abs(wall - towards);
    const distance = Math.min(raw, 6 - raw);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = wall;
    }
  }
  return best;
}

/**
 * The two chambers a passage runs between, in an order that does not depend on
 * which end somebody entered from.
 *
 * A passage is a property of the edge, so its name must read the same walking
 * either way — otherwise the same corridor would be called two things, and this
 * world's whole discipline is that a place has one name.
 */
export function passageEnds(hex, wall) {
  const id = passageIdFor(hex, wall);
  return [{ q: id.q, r: id.r, level: id.level }, neighbour(id, id.wall)];
}

/** Every chamber a passage touches: its two ends and the two that flank it. */
export function passageChambers(hex, wall) {
  const exits = passageExits(hex, wall);
  return [exits.back, exits.ahead, exits.left, exits.right];
}

/** Every chamber reachable from this one without passing through another. */
export function reachableChambers(hex, level) {
  const found = [];
  for (const wall of freeWallsForLevel(level)) {
    const exits = passageExits(hex, wall);
    for (const name of ['ahead', 'left', 'right']) found.push(exits[name]);
  }
  return found;
}
