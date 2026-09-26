/**
 * Traces of librarians.
 *
 * The story is not about an infinite building. It is about the people who
 * spent their lives in one: the searchers, the purifiers, the men who threw
 * themselves down the shafts, the inscriptions left on walls. Until now every
 * surface here was untouched, which made the walker the first creature ever to
 * enter — and that is the one thing the text does not allow.
 *
 * So: traces, not people. Nothing speaks, nothing moves, nobody is met. A
 * volume put back badly. A tally scratched beside a doorway by somebody who
 * was counting chambers, exactly as the walker's own register counts them.
 *
 * Two rules make them part of the world rather than decoration.
 *
 * They are **derived from the chamber's own index**, so a trace is as real as
 * the books are: it is always there, it can be found again, and it can be
 * named by an exact address. Nothing is stored and nothing is random.
 *
 * They are **rare**, and rarest where they say most. A disturbed volume is
 * common enough to make the library feel walked in; a tally is scarce enough
 * that meeting one is an event, and a long tally scarcer still.
 *
 * The marks are scratched, never drafted. Every other marking in this world —
 * the tag overhead, the numbers on the cabinets, the plaques in the passages —
 * is in the architect's hand. These are the only ones that are not, and they
 * should not be mistaken for it.
 */

import { SHELVES_PER_WALL, WALLS_PER_HEX } from '../../babel-v3.js';
import { WORLD_VOLUMES_PER_SHELF, freeWallsForLevel } from '../../world-engine.js';

// One chamber in six has a volume out of place; one in forty-eight has a tally.
const DISTURBED_VOLUME_IN = 6;
const TALLY_IN = 48;
const LONGEST_TALLY = 17;

// A chamber index is a BigInt without an upper bound, so it is folded into the
// range a 32-bit mixer can take before anything else happens. The fold keeps
// every limb: taking the low bits alone would make whole regions of the plane
// share a trace.
function seedFor(roomIndex) {
  let seed = 0;
  let rest = roomIndex < 0n ? -roomIndex : roomIndex;
  while (rest > 0n) {
    seed = (seed ^ Number(rest & 0xffffffn)) * 16777619 % 4294967296;
    rest >>= 24n;
  }
  return seed >>> 0;
}

// Separate draws from one seed, so "is there a tally" and "how long is it" do
// not move together.
function draw(seed, salt) {
  let value = (seed ^ (salt * 2654435761)) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 2246822507) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 3266489909) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

/**
 * What a chamber carries, or nulls.
 *
 * `roomIndex` is the chamber's own index — the same number its exact record is
 * written from — so this is a property of the place and not of the visit.
 */
export function tracesFor(roomIndex, level) {
  const seed = seedFor(roomIndex);

  const disturbed = draw(seed, 1) % DISTURBED_VOLUME_IN === 0
    ? {
      wall: draw(seed, 2) % WALLS_PER_HEX,
      shelf: draw(seed, 3) % SHELVES_PER_WALL,
      volume: draw(seed, 4) % WORLD_VOLUMES_PER_SHELF,
      // How far it was left standing out, and how far it was left crooked.
      reach: 0.05 + (draw(seed, 5) % 100) / 100 * 0.07,
      lean: ((draw(seed, 6) % 100) / 100 - 0.5) * 0.16,
    }
    : null;

  const free = freeWallsForLevel(level);
  const tally = draw(seed, 7) % TALLY_IN === 0
    ? {
      wall: free[draw(seed, 8) % free.length],
      side: draw(seed, 9) % 2 === 0 ? 1 : -1,
      // Long tallies are rarer than short ones: most people who start counting
      // do not get far, and the ones who did are the ones worth finding.
      count: 1 + Math.floor(((draw(seed, 10) % 1000) / 1000) ** 2.2 * LONGEST_TALLY),
    }
    : null;

  return { disturbed, tally };
}
