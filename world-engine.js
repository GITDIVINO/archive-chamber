/**
 * World placement w1.
 *
 * Babel v3 remains a finite catalogue of every complete book.  w1 places that
 * catalogue in an unbounded axial world: every room has 640 physical slots,
 * and catalogue books repeat after BOOK_SPACE_SIZE world slots.
 *
 * Canonical wire addresses:
 *   w1;<world-room-index-in-lowercase-hex>
 *   w1;<world-room-index-in-lowercase-hex>;<wall>;<shelf>;<volume>
 *   w1;<world-room-index-in-lowercase-hex>;<wall>;<shelf>;<volume>;<page>
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

export const WORLD_ALGORITHM_VERSION = 'w1';
export const WORLD_FINGERPRINT = 'w1-axial-zigzag-cantor-cycle-640-780713600-20260802';
export const WORLD_BOOK_COUNT = BOOK_SPACE_SIZE;
export const WORLD_VOLUMES_PER_ROOM = VOLUMES_PER_HEX;

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

export function worldRoomIndexFor(q, r) {
  const a = zigzag(asBigInt(q, 'q'));
  const b = zigzag(asBigInt(r, 'r'));
  const sum = a + b;
  return sum * (sum + 1n) / 2n + a;
}

export function worldCoordinatesForRoomIndex(index) {
  const room = nonNegativeBigInt(index, 'world room index');
  if (room === 0n) return { q: 0n, r: 0n };
  const w = (integerSquareRoot(8n * room + 1n) - 1n) / 2n;
  const diagonalStart = w * (w + 1n) / 2n;
  const a = room - diagonalStart;
  return { q: unzigzag(a), r: unzigzag(w - a) };
}

function worldRoomFromLocation(location) {
  if (!location || typeof location !== 'object') throw new TypeError('world location must be an object.');
  if (location.q !== undefined || location.r !== undefined) {
    const q = asBigInt(location.q, 'q');
    const r = asBigInt(location.r, 'r');
    return { q, r, worldRoom: worldRoomIndexFor(q, r) };
  }
  const source = location.worldRoom === undefined ? location.room : location.worldRoom;
  if (source === undefined) throw new TypeError('world location needs q/r coordinates or a world room index.');
  const worldRoom = nonNegativeBigInt(source, 'world room index');
  return { ...worldCoordinatesForRoomIndex(worldRoom), worldRoom };
}

function normalizedWorldLocation(location, defaultPage = 1) {
  const room = worldRoomFromLocation(location);
  return {
    ...room,
    wall: positiveInteger(location.wall, WALLS_PER_HEX, 'wall'),
    shelf: positiveInteger(location.shelf, SHELVES_PER_WALL, 'shelf'),
    volume: positiveInteger(location.volume, VOLUMES_PER_SHELF, 'volume'),
    page: positiveInteger(location.page === undefined ? defaultPage : location.page, PAGES_PER_VOLUME, 'page'),
  };
}

function volumeSlotForNormalizedLocation(location) {
  return (BigInt(location.wall - 1) * BigInt(SHELVES_PER_WALL) + BigInt(location.shelf - 1))
    * BigInt(VOLUMES_PER_SHELF)
    + BigInt(location.volume - 1);
}

export function worldVolumeSlotFor(location) {
  return volumeSlotForNormalizedLocation(normalizedWorldLocation(location));
}

export function worldSlotIndexFor(location) {
  const value = normalizedWorldLocation(location);
  return value.worldRoom * WORLD_VOLUMES_PER_ROOM + volumeSlotForNormalizedLocation(value);
}

export function worldLocationForSlotIndex(index, page = 1) {
  const worldSlot = nonNegativeBigInt(index, 'world slot index');
  const worldRoom = worldSlot / WORLD_VOLUMES_PER_ROOM;
  const slot = worldSlot % WORLD_VOLUMES_PER_ROOM;
  const shelfSlot = slot / BigInt(VOLUMES_PER_SHELF);
  return {
    ...worldCoordinatesForRoomIndex(worldRoom),
    worldRoom,
    wall: Number(shelfSlot / BigInt(SHELVES_PER_WALL)) + 1,
    shelf: Number(shelfSlot % BigInt(SHELVES_PER_WALL)) + 1,
    volume: Number(slot % BigInt(VOLUMES_PER_SHELF)) + 1,
    page: positiveInteger(page, PAGES_PER_VOLUME, 'page'),
  };
}

const MANIFESTO_CATALOG_BOOK_INDEX = bookIndexFor(MANIFESTO_LOCATION);
const ORIGIN_MANIFESTO_SLOT = (BigInt(2 - 1) * BigInt(SHELVES_PER_WALL) + BigInt(2 - 1))
  * BigInt(VOLUMES_PER_SHELF)
  + BigInt(13 - 1);

export const WORLD_BOOK_OFFSET = modulo(MANIFESTO_CATALOG_BOOK_INDEX - ORIGIN_MANIFESTO_SLOT, WORLD_BOOK_COUNT);
export const WORLD_MANIFESTO_LOCATION = Object.freeze({
  q: 0n,
  r: 0n,
  worldRoom: 0n,
  wall: 2,
  shelf: 2,
  volume: 13,
  page: MANIFESTO_LOCATION.page,
});

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
  if (typeof address !== 'string') throw new TypeError('expected a w1 ' + kind + ' address.');
  const parts = address.split(';');
  if (parts.length !== length || parts[0] !== WORLD_ALGORITHM_VERSION) throw new TypeError('expected a w1 ' + kind + ' address.');
  if (!CANONICAL_HEX.test(parts[1])) throw new TypeError('world room index must be canonical lowercase hexadecimal.');
  for (let index = 2; index < parts.length; index++) {
    if (!CANONICAL_POSITIVE_INTEGER.test(parts[index])) throw new TypeError('world address fields must be canonical positive integers.');
  }
  return parts;
}

export function createWorldRoomAddress(location) {
  return formatRoomAddress(worldRoomFromLocation(location).worldRoom);
}

export function parseWorldRoomAddress(address) {
  const parts = parsedParts(address, 2, 'room');
  const worldRoom = BigInt('0x' + parts[1]);
  return { ...worldCoordinatesForRoomIndex(worldRoom), worldRoom };
}

export function createWorldVolumeAddress(location) {
  const value = normalizedWorldLocation({ ...location, page: 1 });
  return formatRoomAddress(value.worldRoom) + ';' + value.wall + ';' + value.shelf + ';' + value.volume;
}

export function parseWorldVolumeAddress(address) {
  const parts = parsedParts(address, 5, 'volume');
  return normalizedWorldLocation({
    worldRoom: BigInt('0x' + parts[1]),
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
    worldRoom: BigInt('0x' + parts[1]),
    wall: parts[2],
    shelf: parts[3],
    volume: parts[4],
    page: parts[5],
  });
}
