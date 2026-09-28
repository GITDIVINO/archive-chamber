/**
 * How big the library is, said in a way a person can hold.
 *
 * The number itself cannot be shown. `HEX_COUNT` is a BigInt of some 1.9
 * million decimal digits — printing it would take a page of every book the
 * walker will ever open, and turning it into a string is real work for no
 * reading. What can be shown is its length, and the length is the point: the
 * catalogue is not large, it is large in a way that has no name.
 *
 * The count is derived rather than written down, so it cannot drift from the
 * catalogue it describes, and it is taken with logarithms rather than BigInt
 * for the same reason the number is not printed. A double carries about
 * sixteen significant figures and the answer needs seven, so the margin is
 * enormous.
 */

import { ALPHABET, PAGES_PER_VOLUME, PAGE_LENGTH } from '../../babel-v3.js';
import { WORLD_VOLUMES_PER_ROOM } from '../../world-engine.js';

function digitsOf(log10) {
  return Math.floor(log10) + 1;
}

const BOOK_SPACE_LOG10 = PAGES_PER_VOLUME * PAGE_LENGTH * Math.log10(ALPHABET.length);

/** Decimal digits in the number of chambers before the catalogue repeats. */
export const CATALOGUE_HEX_DIGITS = digitsOf(BOOK_SPACE_LOG10 - Math.log10(Number(WORLD_VOLUMES_PER_ROOM)));

const groups = value => value.toLocaleString('en-US').replace(/,/g, ' ');

/**
 * What to write under the register.
 *
 * The honest comparison is not against a total, because the world has none: it
 * is unbounded, and its chambers repeat the catalogue for ever. What is
 * finite is how far a walker would have to go before the books started again.
 */
export function scaleLine(entered) {
  const chambers = entered === 1 ? '1 chamber' : entered + ' chambers';
  return chambers + ' of a number with ' + groups(CATALOGUE_HEX_DIGITS)
    + ' digits, after which the catalogue begins again. the world does not.';
}
