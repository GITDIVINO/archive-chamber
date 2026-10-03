/**
 * World placement w4.
 *
 * Babel v3 remains a finite catalogue of every complete book.  w4 places that
 * catalogue in an unbounded world of stacked axial levels: every room has
 * 11520 physical slots, and catalogue books repeat after BOOK_SPACE_SIZE world
 * slots.
 *
 * w4 keeps w3's stacked coordinates and six cabinet bays to a wall, and counts
 * the galleries.  A wall carries three tiers of cases, one on the floor and one
 * on each gallery, of five shelves each: shelves 1-5 stand on the floor, 6-10
 * on the first gallery and 11-15 on the second.  Every volume a walker can see
 * on a wall is a catalogue book with an address of its own.
 *
 * The free walls are a proof rather than a preference.  A room has six walls,
 * four shelved and two free, and a doorway is a hole in a wall two rooms share
 * — so if a room has a door on wall d, its neighbour must have one on wall
 * d+3.  With exactly two free walls per room that forces them opposite, the
 * graph of passages is 2-regular, and a 2-regular graph is a disjoint union of
 * paths and cycles: on one level a walker can never leave their own corridor.
 * Adding doors would cost a shelved wall and with it 2880 volumes in w4.
 *
 * Levels dissolve it without touching the contract.  The free pair rotates with
 * the level, so corridors on adjacent levels run along different axes; two such
 * axes have determinant ±1 and therefore generate the whole lattice.  Climbing
 * one level, walking, and coming back down reaches any room in the plane, and
 * every room still has four shelved walls and 11520 volumes.
 *
 * Canonical wire addresses:
 *   w4;<world-room-index-in-lowercase-hex>
 *   w4;<world-room-index-in-lowercase-hex>;<wall>;<shelf>;<volume>
 *   w4;<world-room-index-in-lowercase-hex>;<wall>;<shelf>;<volume>;<page>
 *
 * Earlier world addresses (w3, w2, w1) are no longer read.
 */

import {
  BOOK_SPACE_SIZE,
  PAGES_PER_VOLUME,
  SHELVES_PER_WALL,
  VOLUMES_PER_SHELF,
  WALLS_PER_HEX,
  bookIndexFor,
} from './babel-v3.js';

export const WORLD_ALGORITHM_VERSION = 'w4';
export const WORLD_FINGERPRINT = 'w4-axial-level-zigzag-cantor-cycle-11520-780710720-20260928';
export const WORLD_BOOK_COUNT = BOOK_SPACE_SIZE;
export const WORLD_CABINET_SECTIONS_PER_WALL = 6;
/** Tiers of cases on a wall: the floor and the two galleries. */
export const WORLD_TIERS_PER_WALL = 3;
export const WORLD_SHELVES_PER_TIER = SHELVES_PER_WALL;
export const WORLD_SHELVES_PER_WALL = WORLD_SHELVES_PER_TIER * WORLD_TIERS_PER_WALL;
export const WORLD_VOLUMES_PER_SHELF = VOLUMES_PER_SHELF * WORLD_CABINET_SECTIONS_PER_WALL;
export const WORLD_VOLUMES_PER_ROOM = BigInt(WALLS_PER_HEX * WORLD_SHELVES_PER_WALL * WORLD_VOLUMES_PER_SHELF);

/**
 * Which two walls a level leaves free, and so which axis its corridors run
 * along.  Three axes, cycling with the level: no direction of the hexagon is
 * privileged, and any two consecutive axes span the lattice.
 */
export const LEVEL_FREE_WALL_AXES = Object.freeze([
  Object.freeze([2, 5]),
  Object.freeze([0, 3]),
  Object.freeze([1, 4]),
]);

const CANONICAL_HEX = /^(?:0|[1-9a-f][0-9a-f]*)$/;
const CANONICAL_POSITIVE_INTEGER = /^[1-9]\d*$/;

function modulo(value, base) {
  const remainder = value % base;
  return remainder < 0n ? remainder + base : remainder;
}

function asBigInt(value, name) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) return BigInt(value);
    throw new TypeError(name + ' must be a safe integer number, bigint, or integer string.');
  }
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value)) return BigInt(value);
  throw new TypeError(name + ' must be a safe integer number, bigint, or integer string.');
}

function nonNegativeBigInt(value, name) {
  const result = asBigInt(value, name);
  if (result < 0n) throw new RangeError(name + ' must not be negative.');
  return result;
}

function positiveInteger(value, maximum, name) {
  let result;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(name + ' must be an integer.');
    result = value;
  } else if (typeof value === 'bigint') {
    if (value < 1n || value > BigInt(maximum)) throw new RangeError(name + ' is outside its allowed range.');
    result = Number(value);
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = BigInt(value);
    if (parsed < 1n || parsed > BigInt(maximum)) throw new RangeError(name + ' is outside its allowed range.');
    result = Number(parsed);
  } else {
    throw new TypeError(name + ' must be an integer.');
  }
  if (result < 1 || result > maximum) throw new RangeError(name + ' is outside its allowed range.');
  return result;
}

function zigzag(value) {
  return value >= 0n ? value * 2n : -value * 2n - 1n;
}

function unzigzag(value) {
  return value % 2n === 0n ? value / 2n : -(value + 1n) / 2n;
}

function integerSquareRoot(value) {
  if (value < 0n) throw new RangeError('square root input must not be negative.');
  if (value < 2n) return value;
  let x = 1n << BigInt((value.toString(2).length + 1) >> 1);
  let y = (x + value / x) >> 1n;
  while (y < x) {
    x = y;
    y = (x + value / x) >> 1n;
  }
  return x;
}

function cantorPair(a, b) {
  const sum = a + b;
  return sum * (sum + 1n) / 2n + a;
}

function cantorUnpair(value) {
  if (value === 0n) return [0n, 0n];
  const w = (integerSquareRoot(8n * value + 1n) - 1n) / 2n;
  const a = value - w * (w + 1n) / 2n;
  return [a, w - a];
}

/**
 * The level a room sits on decides which pair of walls is free.  Negative
 * levels are as ordinary as positive ones, so the index is taken modulo the
 * axis count rather than truncated.
 */
export function freeWallsForLevel(level) {
  const axis = Number(modulo(asBigInt(level, 'level'), BigInt(LEVEL_FREE_WALL_AXES.length)));
  return LEVEL_FREE_WALL_AXES[axis];
}

/**
 * The four shelved walls of a level, ascending.  Their order is what canonical
 * wall numbers 1..4 in an address refer to, so on different levels the same
 * wall number faces a different way.
 */
export function bookWallsForLevel(level) {
  const free = freeWallsForLevel(level);
  const walls = [];
  for (let wall = 0; wall < 6; wall++) if (!free.includes(wall)) walls.push(wall);
  return walls;
}

/** The physical wall a canonical wall number occupies on a given level. */
export function wallIndexForCanonicalWall(level, canonicalWall) {
  return bookWallsForLevel(level)[positiveInteger(canonicalWall, WALLS_PER_HEX, 'wall') - 1];
}

/** The canonical wall number of a physical wall, or 0 if it carries no shelves. */
export function canonicalWallForWallIndex(level, wallIndex) {
  return bookWallsForLevel(level).indexOf(wallIndex) + 1;
}

export function worldRoomIndexFor(q, r, level = 0) {
  const plane = cantorPair(zigzag(asBigInt(q, 'q')), zigzag(asBigInt(r, 'r')));
  return cantorPair(plane, zigzag(asBigInt(level, 'level')));
}

export function worldCoordinatesForRoomIndex(index) {
  const room = nonNegativeBigInt(index, 'world room index');
  const [plane, encodedLevel] = cantorUnpair(room);
  const [encodedQ, encodedR] = cantorUnpair(plane);
  return { q: unzigzag(encodedQ), r: unzigzag(encodedR), level: unzigzag(encodedLevel) };
}

function worldRoomFromLocation(location) {
  if (!location || typeof location !== 'object') throw new TypeError('world location must be an object.');
  if (location.q !== undefined || location.r !== undefined) {
    const q = asBigInt(location.q, 'q');
    const r = asBigInt(location.r, 'r');
    const level = asBigInt(location.level === undefined ? 0 : location.level, 'level');
    return { q, r, level, worldRoom: worldRoomIndexFor(q, r, level) };
  }
  const source = location.worldRoom === undefined ? location.room : location.worldRoom;
  if (source === undefined) throw new TypeError('world location needs q/r coordinates or a world room index.');
  const worldRoom = nonNegativeBigInt(source, 'world room index');
  return { ...worldCoordinatesForRoomIndex(worldRoom), worldRoom };
}

function normalizedWorldLocation(location, defaultPage = 1) {
  return {
    ...worldRoomFromLocation(location),
    wall: positiveInteger(location.wall, WALLS_PER_HEX, 'wall'),
    shelf: positiveInteger(location.shelf, WORLD_SHELVES_PER_WALL, 'shelf'),
    volume: positiveInteger(location.volume, WORLD_VOLUMES_PER_SHELF, 'volume'),
    page: positiveInteger(location.page === undefined ? defaultPage : location.page, PAGES_PER_VOLUME, 'page'),
  };
}

function volumeSlotForNormalizedLocation(location) {
  return (BigInt(location.wall - 1) * BigInt(WORLD_SHELVES_PER_WALL) + BigInt(location.shelf - 1))
    * BigInt(WORLD_VOLUMES_PER_SHELF)
    + BigInt(location.volume - 1);
}

export function worldSlotIndexFor(location) {
  const value = normalizedWorldLocation(location);
  return value.worldRoom * WORLD_VOLUMES_PER_ROOM + volumeSlotForNormalizedLocation(value);
}

export function worldLocationForSlotIndex(index, page = 1) {
  const worldSlot = nonNegativeBigInt(index, 'world slot index');
  const worldRoom = worldSlot / WORLD_VOLUMES_PER_ROOM;
  const slot = worldSlot % WORLD_VOLUMES_PER_ROOM;
  const shelfSlot = slot / BigInt(WORLD_VOLUMES_PER_SHELF);
  return {
    ...worldCoordinatesForRoomIndex(worldRoom),
    worldRoom,
    wall: Number(shelfSlot / BigInt(WORLD_SHELVES_PER_WALL)) + 1,
    shelf: Number(shelfSlot % BigInt(WORLD_SHELVES_PER_WALL)) + 1,
    volume: Number(slot % BigInt(WORLD_VOLUMES_PER_SHELF)) + 1,
    page: positiveInteger(page, PAGES_PER_VOLUME, 'page'),
  };
}

// Room (0,0,0) still encodes to index 0. The offset puts catalogue volume
// v3;129d19;2;2;13 in the origin room at wall 2, shelf 2, volume 13. That
// volume held the manifesto until the transposition was removed from v3; the
// anchor stays so that every shelf of w4 keeps the books it already had.
const ORIGIN_CATALOG_BOOK_INDEX = bookIndexFor({ q: 362n, r: -419n, wall: 2, shelf: 2, volume: 13 });
export const WORLD_BOOK_OFFSET = modulo(
  ORIGIN_CATALOG_BOOK_INDEX - volumeSlotForNormalizedLocation({ wall: 2, shelf: 2, volume: 13 }),
  WORLD_BOOK_COUNT,
);

export function catalogBookIndexForWorldSlotIndex(index) {
  const worldSlot = nonNegativeBigInt(index, 'world slot index');
  return modulo(worldSlot + WORLD_BOOK_OFFSET, WORLD_BOOK_COUNT);
}

export function catalogBookIndexFor(location) {
  return catalogBookIndexForWorldSlotIndex(worldSlotIndexFor(location));
}

export function catalogPlacementForWorldSlotIndex(index) {
  const worldSlot = nonNegativeBigInt(index, 'world slot index');
  return {
    bookIndex: catalogBookIndexForWorldSlotIndex(worldSlot),
    occurrence: worldSlot / WORLD_BOOK_COUNT,
  };
}

export function worldSlotIndexForCatalogPlacement(bookIndex, occurrence = 0) {
  const book = nonNegativeBigInt(bookIndex, 'catalogue book index');
  if (book >= WORLD_BOOK_COUNT) throw new RangeError('catalogue book index is outside babel v3.');
  const cycle = nonNegativeBigInt(occurrence, 'catalogue occurrence');
  return modulo(book - WORLD_BOOK_OFFSET, WORLD_BOOK_COUNT) + cycle * WORLD_BOOK_COUNT;
}

export function worldLocationForCatalogPlacement(bookIndex, occurrence = 0, page = 1) {
  return worldLocationForSlotIndex(worldSlotIndexForCatalogPlacement(bookIndex, occurrence), page);
}

function formatRoomAddress(worldRoom) {
  return WORLD_ALGORITHM_VERSION + ';' + worldRoom.toString(16);
}

function parsedParts(address, length, kind) {
  if (typeof address !== 'string') throw new TypeError('expected a world ' + kind + ' address.');
  const parts = address.split(';');
  if (parts.length !== length || parts[0] !== WORLD_ALGORITHM_VERSION) {
    throw new TypeError('expected a world ' + kind + ' address.');
  }
  if (!CANONICAL_HEX.test(parts[1])) throw new TypeError('world room index must be canonical lowercase hexadecimal.');
  for (let index = 2; index < parts.length; index++) {
    if (!CANONICAL_POSITIVE_INTEGER.test(parts[index])) throw new TypeError('world address fields must be canonical positive integers.');
  }
  return parts;
}

function coordinatesForParsedRoom(parts) {
  return worldCoordinatesForRoomIndex(BigInt('0x' + parts[1]));
}

export function createWorldRoomAddress(location) {
  return formatRoomAddress(worldRoomFromLocation(location).worldRoom);
}

export function parseWorldRoomAddress(address) {
  const { q, r, level } = coordinatesForParsedRoom(parsedParts(address, 2, 'room'));
  return { q, r, level, worldRoom: worldRoomIndexFor(q, r, level) };
}

export function createWorldVolumeAddress(location) {
  const value = normalizedWorldLocation({ ...location, page: 1 });
  return formatRoomAddress(value.worldRoom) + ';' + value.wall + ';' + value.shelf + ';' + value.volume;
}

export function parseWorldVolumeAddress(address) {
  const parts = parsedParts(address, 5, 'volume');
  return normalizedWorldLocation({
    ...coordinatesForParsedRoom(parts),
    wall: parts[2],
    shelf: parts[3],
    volume: parts[4],
    page: 1,
  });
}

export function createWorldPageAddress(location) {
  const value = normalizedWorldLocation(location);
  return createWorldVolumeAddress(value) + ';' + value.page;
}

export function parseWorldPageAddress(address) {
  const parts = parsedParts(address, 6, 'page');
  return normalizedWorldLocation({
    ...coordinatesForParsedRoom(parts),
    wall: parts[2],
    shelf: parts[3],
    volume: parts[4],
    page: parts[5],
  });
}
