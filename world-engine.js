/**
 * World placement w3.
 *
 * Babel v3 remains a finite catalogue of every complete book.  w3 places that
 * catalogue in an unbounded world of stacked axial levels: every room has 3840
 * physical slots, and catalogue books repeat after BOOK_SPACE_SIZE world slots.
 *
 * w3 keeps w2's stacked coordinates but widens each wall to six cabinet bays.
 *
 * The reason is a proof rather than a preference.  A room has six walls, four
 * shelved and two free, and a doorway is a hole in a wall two rooms share — so
 * if a room has a door on wall d, its neighbour must have one on wall d+3.
 * With exactly two free walls per room that forces them opposite, the graph of
 * passages is 2-regular, and a 2-regular graph is a disjoint union of paths and
 * cycles: on one level a walker can never leave their own corridor.  Adding
 * doors would cost a shelved wall and with it 960 volumes in w3.
 *
 * Levels dissolve it without touching the contract.  The free pair rotates with
 * the level, so corridors on adjacent levels run along different axes; two such
 * axes have determinant ±1 and therefore generate the whole lattice.  Climbing
 * one level, walking, and coming back down reaches any room in the plane, and
 * every room still has four shelved walls and 3840 volumes.
 *
 * Canonical wire addresses:
 *   w3;<world-room-index-in-lowercase-hex>
 *   w3;<world-room-index-in-lowercase-hex>;<wall>;<shelf>;<volume>
 *   w3;<world-room-index-in-lowercase-hex>;<wall>;<shelf>;<volume>;<page>
 *
 * A w1 address still parses: w1 enumerated exactly the level-0 rooms, so it is
 * read as such and translated rather than rejected.
 */

import {
  BOOK_SPACE_SIZE,
  MANIFESTO_LOCATION,
  PAGES_PER_VOLUME,
  SHELVES_PER_WALL,
  VOLUMES_PER_HEX,
  VOLUMES_PER_SHELF,
  WALLS_PER_HEX,
  bookIndexFor,
} from './babel-v3.js';

export const WORLD_ALGORITHM_VERSION = 'w3';
export const PREVIOUS_WORLD_ALGORITHM_VERSION = 'w2';
export const LEGACY_WORLD_ALGORITHM_VERSION = 'w1';
export const WORLD_FINGERPRINT = 'w3-axial-level-zigzag-cantor-cycle-3840-780712640-20260809';
export const WORLD_BOOK_COUNT = BOOK_SPACE_SIZE;
export const WORLD_CABINET_SECTIONS_PER_WALL = 6;
export const WORLD_VOLUMES_PER_SHELF = VOLUMES_PER_SHELF * WORLD_CABINET_SECTIONS_PER_WALL;
export const WORLD_VOLUMES_PER_ROOM = BigInt(WALLS_PER_HEX * SHELVES_PER_WALL * WORLD_VOLUMES_PER_SHELF);
export const W2_VOLUMES_PER_ROOM = VOLUMES_PER_HEX;

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

// w1 enumerated the plane alone, so its indices decode with a single unpair and
// name exactly the rooms this placement calls level 0.
export function worldCoordinatesForLegacyRoomIndex(index) {
  const room = nonNegativeBigInt(index, 'world room index');
  const [encodedQ, encodedR] = cantorUnpair(room);
  return { q: unzigzag(encodedQ), r: unzigzag(encodedR), level: 0n };
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

function worldVersionFor(location) {
  return location.worldVersion === LEGACY_WORLD_ALGORITHM_VERSION
    ? LEGACY_WORLD_ALGORITHM_VERSION
    : location.worldVersion === PREVIOUS_WORLD_ALGORITHM_VERSION
      ? PREVIOUS_WORLD_ALGORITHM_VERSION
      : WORLD_ALGORITHM_VERSION;
}

function volumesPerShelfForVersion(version) {
  return version === WORLD_ALGORITHM_VERSION ? WORLD_VOLUMES_PER_SHELF : VOLUMES_PER_SHELF;
}

function volumesPerRoomForVersion(version) {
  return version === WORLD_ALGORITHM_VERSION ? WORLD_VOLUMES_PER_ROOM : W2_VOLUMES_PER_ROOM;
}

function normalizedWorldLocation(location, defaultPage = 1) {
  const room = worldRoomFromLocation(location);
  const worldVersion = worldVersionFor(location);
  return {
    ...room,
    worldVersion,
    wall: positiveInteger(location.wall, WALLS_PER_HEX, 'wall'),
    shelf: positiveInteger(location.shelf, SHELVES_PER_WALL, 'shelf'),
    volume: positiveInteger(location.volume, volumesPerShelfForVersion(worldVersion), 'volume'),
    page: positiveInteger(location.page === undefined ? defaultPage : location.page, PAGES_PER_VOLUME, 'page'),
  };
}

function volumeSlotForNormalizedLocation(location) {
  const volumesPerShelf = volumesPerShelfForVersion(location.worldVersion);
  return (BigInt(location.wall - 1) * BigInt(SHELVES_PER_WALL) + BigInt(location.shelf - 1))
    * BigInt(volumesPerShelf)
    + BigInt(location.volume - 1);
}

export function worldVolumeSlotFor(location) {
  return volumeSlotForNormalizedLocation(normalizedWorldLocation(location));
}

export function worldSlotIndexFor(location) {
  const value = normalizedWorldLocation(location);
  return value.worldRoom * volumesPerRoomForVersion(value.worldVersion) + volumeSlotForNormalizedLocation(value);
}

export function worldLocationForSlotIndex(index, page = 1) {
  const worldSlot = nonNegativeBigInt(index, 'world slot index');
  const worldRoom = worldSlot / WORLD_VOLUMES_PER_ROOM;
  const slot = worldSlot % WORLD_VOLUMES_PER_ROOM;
  const shelfSlot = slot / BigInt(WORLD_VOLUMES_PER_SHELF);
  return {
    ...worldCoordinatesForRoomIndex(worldRoom),
    worldRoom,
    wall: Number(shelfSlot / BigInt(SHELVES_PER_WALL)) + 1,
    shelf: Number(shelfSlot % BigInt(SHELVES_PER_WALL)) + 1,
    volume: Number(slot % BigInt(WORLD_VOLUMES_PER_SHELF)) + 1,
    worldVersion: WORLD_ALGORITHM_VERSION,
    page: positiveInteger(page, PAGES_PER_VOLUME, 'page'),
  };
}

const MANIFESTO_CATALOG_BOOK_INDEX = bookIndexFor(MANIFESTO_LOCATION);
const ORIGIN_MANIFESTO_SLOT = (BigInt(2 - 1) * BigInt(SHELVES_PER_WALL) + BigInt(2 - 1))
  * BigInt(WORLD_VOLUMES_PER_SHELF)
  + BigInt(13 - 1);
const W2_ORIGIN_MANIFESTO_SLOT = (BigInt(2 - 1) * BigInt(SHELVES_PER_WALL) + BigInt(2 - 1))
  * BigInt(VOLUMES_PER_SHELF)
  + BigInt(13 - 1);

// Room (0,0,0) still encodes to index 0. The w3 offset is adjusted so the
// manifesto also keeps its human-readable wall/shelf/volume address.
export const WORLD_BOOK_OFFSET = modulo(MANIFESTO_CATALOG_BOOK_INDEX - ORIGIN_MANIFESTO_SLOT, WORLD_BOOK_COUNT);
export const W2_WORLD_BOOK_OFFSET = modulo(MANIFESTO_CATALOG_BOOK_INDEX - W2_ORIGIN_MANIFESTO_SLOT, WORLD_BOOK_COUNT);
export const WORLD_MANIFESTO_LOCATION = Object.freeze({
  q: 0n,
  r: 0n,
  level: 0n,
  worldRoom: 0n,
  wall: 2,
  shelf: 2,
  volume: 13,
  page: MANIFESTO_LOCATION.page,
  worldVersion: WORLD_ALGORITHM_VERSION,
});

export function catalogBookIndexForWorldSlotIndex(index) {
  const worldSlot = nonNegativeBigInt(index, 'world slot index');
  return modulo(worldSlot + WORLD_BOOK_OFFSET, WORLD_BOOK_COUNT);
}

export function catalogBookIndexFor(location) {
  const value = normalizedWorldLocation(location);
  const offset = value.worldVersion === WORLD_ALGORITHM_VERSION ? WORLD_BOOK_OFFSET : W2_WORLD_BOOK_OFFSET;
  return modulo(worldSlotIndexFor(value) + offset, WORLD_BOOK_COUNT);
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

function formatRoomAddress(worldRoom, version = WORLD_ALGORITHM_VERSION) {
  return version + ';' + worldRoom.toString(16);
}

function parsedParts(address, length, kind) {
  if (typeof address !== 'string') throw new TypeError('expected a world ' + kind + ' address.');
  const parts = address.split(';');
  const version = parts[0];
  if (parts.length !== length) throw new TypeError('expected a world ' + kind + ' address.');
  if (version !== WORLD_ALGORITHM_VERSION
    && version !== PREVIOUS_WORLD_ALGORITHM_VERSION
    && version !== LEGACY_WORLD_ALGORITHM_VERSION) {
    throw new TypeError('expected a world ' + kind + ' address.');
  }
  if (!CANONICAL_HEX.test(parts[1])) throw new TypeError('world room index must be canonical lowercase hexadecimal.');
  for (let index = 2; index < parts.length; index++) {
    if (!CANONICAL_POSITIVE_INTEGER.test(parts[index])) throw new TypeError('world address fields must be canonical positive integers.');
  }
  return parts;
}

// A w1 index names a level-0 room; w2 and w3 indices name stacked rooms.
function coordinatesForParsedRoom(parts) {
  const index = BigInt('0x' + parts[1]);
  return parts[0] === LEGACY_WORLD_ALGORITHM_VERSION
    ? worldCoordinatesForLegacyRoomIndex(index)
    : worldCoordinatesForRoomIndex(index);
}

export function createWorldRoomAddress(location) {
  return formatRoomAddress(worldRoomFromLocation(location).worldRoom, worldVersionFor(location));
}

export function parseWorldRoomAddress(address) {
  const parts = parsedParts(address, 2, 'room');
  const { q, r, level } = coordinatesForParsedRoom(parts);
  return { q, r, level, worldRoom: worldRoomIndexFor(q, r, level), worldVersion: parts[0] };
}

export function createWorldVolumeAddress(location) {
  const value = normalizedWorldLocation({ ...location, page: 1 });
  return formatRoomAddress(value.worldRoom, value.worldVersion) + ';' + value.wall + ';' + value.shelf + ';' + value.volume;
}

export function parseWorldVolumeAddress(address) {
  const parts = parsedParts(address, 5, 'volume');
  return normalizedWorldLocation({
    ...coordinatesForParsedRoom(parts),
    worldVersion: parts[0],
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
    worldVersion: parts[0],
    wall: parts[2],
    shelf: parts[3],
    volume: parts[4],
    page: parts[5],
  });
}
