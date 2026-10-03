/**
 * Which lamps in the library are burning.
 *
 * Most are out. A flame at every lantern, sconce and newel of every storey
 * read as a string of fairy lights; a few lit lamps among many dark ones make
 * each flame an event, somebody somewhere still reading.
 *
 * The answer has to be the same wherever a storey is drawn from: as the
 * walker's own chamber, as a storey of the shaft above or below, and again
 * after a climb has made a shaft storey the chamber. So it depends only on
 * what kind of lamp it is, where it stands within its storey, and the storey's
 * level modulo three. Shafts are cached by that residue (rooms.js), and the
 * building's door walls already repeat with it, so nothing finer is known to
 * every view of the same storey.
 *
 * Plain numbers only, no three.js, so the rule can be tested under node.
 */

/** The share of each kind of lamp that burns. */
export const LAMP_SHARE = Object.freeze({
  // The pair on the deck at either end of the opening always burns: they cast
  // the barred shadow of the balustrade across the flight.
  deck: 1,
  stair: 0.35,
  balustrade: 0.35,
  sconce: 0.4,
  tier: 0.25,
  hanging: 0.5,
});

const KIND_SALT = Object.freeze({
  deck: 0x1b873593,
  stair: 0x68e31da4,
  balustrade: 0x3c6ef372,
  sconce: 0x5be0cd19,
  tier: 0x7137449,
  hanging: 0x2545f491,
});

/** A storey's level, BigInt or number, reduced to the residue every view shares. */
export function storeyResidue(level) {
  const value = BigInt(level);
  return Number(((value % 3n) + 3n) % 3n);
}

/**
 * Whether the lamp of `kind` at `position` (x, y, z within its own storey,
 * before any storey offset) burns on a storey of `level`.
 */
export function lampIsLit(kind, position, level) {
  const share = LAMP_SHARE[kind];
  if (share >= 1) return true;
  let hash = KIND_SALT[kind] ^ Math.imul(storeyResidue(level) + 1, 0x27d4eb2d);
  hash ^= Math.imul(Math.round(position.x * 8), 73856093);
  hash ^= Math.imul(Math.round(position.y * 8), 19349663);
  hash ^= Math.imul(Math.round(position.z * 8), 83492791);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
  hash = Math.imul(hash ^ (hash >>> 12), 0x297a2d39);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296 < share;
}
