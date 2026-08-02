/**
 * Babel v3: a finite library of complete books.
 *
 * A v3 address identifies a whole 410-page volume.  Its pages are therefore
 * never independently allocated or truncated: every valid volume has exactly
 * PAGES_PER_VOLUME pages, and every possible complete volume occurs once.
 *
 * The canonical wire address is:
 *   v3;<room-index-in-lowercase-hex>;<wall>;<shelf>;<volume>;<page>
 *
 * The room index is used on the wire instead of a decimal q/r pair because a
 * full-book universe necessarily has extremely large exact identifiers.
 */

export const ALGORITHM_VERSION = 'v3';
export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz, .';
export const PAGE_LENGTH = 3200;
export const WALLS_PER_HEX = 4;
export const SHELVES_PER_WALL = 5;
export const VOLUMES_PER_SHELF = 32;
export const PAGES_PER_VOLUME = 410;
export const VOLUMES_PER_HEX = BigInt(WALLS_PER_HEX * SHELVES_PER_WALL * VOLUMES_PER_SHELF);
export const PAGE_SPACE_SIZE = BigInt(ALPHABET.length) ** BigInt(PAGE_LENGTH);
export const BOOK_SPACE_SIZE = PAGE_SPACE_SIZE ** BigInt(PAGES_PER_VOLUME);
export const HEX_COUNT = (BOOK_SPACE_SIZE + VOLUMES_PER_HEX - 1n) / VOLUMES_PER_HEX;

// This identifier, the three constants below, and the regression vectors in
// the test suite freeze the universe.  Changing any of them requires v4.
export const V3_FINGERPRINT = 'v3-book-block-affine-29-3200-410-20260802';

const BASE = BigInt(ALPHABET.length);
const ROOM_CACHE_LIMIT = 32;
const roomIndexCache = new Map();
const BOOK_BIT_LENGTH_CACHE_LIMIT = 32;
const bookBitLengthCache = new Map();
const PAGE_SPACE_BINARY_LOWER_BITS = PAGE_SPACE_SIZE.toString(2).length - 1;

// Spine labels are deliberately presentation metadata, not excerpts from a
// page.  SplitMix64's output permutation gives neighbouring book indices
// visibly different labels without coupling a shelf title to page content.
const SPINE_TITLE_MASK = (1n << 64n) - 1n;
const SPINE_TITLE_SPACE = BASE ** 12n;
const SPINE_TITLE_INCREMENT = 0x9e3779b97f4a7c15n;
const SPINE_TITLE_MULTIPLIER_A = 0xbf58476d1ce4e5b9n;
const SPINE_TITLE_MULTIPLIER_B = 0x94d049bb133111ebn;

function modulo(value, base) {
  return ((value % base) + base) % base;
}

function modularInverse(value, modulus) {
  let oldR = value;
  let r = modulus;
  let oldS = 1n;
  let s = 0n;
  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }
  if (oldR !== 1n) throw new Error('v3 multiplier must be coprime with the page space.');
  return modulo(oldS, modulus);
}

function xorshift32(state) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

function fixedPageValue(seed, unit = false) {
  let state = seed >>> 0;
  let value = 0n;
  for (let index = 0; index < PAGE_LENGTH; index++) {
    state = xorshift32(state);
    let digit = state % ALPHABET.length;
    if (unit && index === PAGE_LENGTH - 1 && digit === 0) digit = 1;
    value = value * BASE + BigInt(digit);
  }
  return value;
}

export const PAGE_BLOCK_MULTIPLIER = fixedPageValue(0x64f2a31d, true);
export const PAGE_BLOCK_INVERSE = modularInverse(PAGE_BLOCK_MULTIPLIER, PAGE_SPACE_SIZE);
export const PAGE_OFFSET = fixedPageValue(0x17c9e4b3);
export const PAGE_SPREAD = fixedPageValue(0xb5297a4d);

function asBigInt(value, name) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) return BigInt(value);
    throw new TypeError(name + ' must be a safe integer number, bigint, or integer string.');
  }
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value)) return BigInt(value);
  throw new TypeError(name + ' must be a safe integer number, bigint, or integer string.');
}

function assertBookIndex(value) {
  const book = asBigInt(value, 'book index');
  if (book < 0n || book >= BOOK_SPACE_SIZE) throw new RangeError('book index is outside the finite v3 library.');
  return book;
}

function bitLengthForBookIndex(bookIndex) {
  const cached = bookBitLengthCache.get(bookIndex);
  if (cached !== undefined) return cached;
  const length = bookIndex === 0n ? 0 : bookIndex.toString(2).length;
  if (bookBitLengthCache.size >= BOOK_BIT_LENGTH_CACHE_LIMIT) bookBitLengthCache.clear();
  bookBitLengthCache.set(bookIndex, length);
  return length;
}

function spineTitleValueForBookIndex(bookIndex) {
  // SplitMix64 is a permutation of the low 64 bits.  A spine title is not an
  // address, so this bounded visual label intentionally permits repetitions
  // in the astronomically larger book universe.
  let value = ((bookIndex & SPINE_TITLE_MASK) + SPINE_TITLE_INCREMENT) & SPINE_TITLE_MASK;
  value = ((value ^ (value >> 30n)) * SPINE_TITLE_MULTIPLIER_A) & SPINE_TITLE_MASK;
  value = ((value ^ (value >> 27n)) * SPINE_TITLE_MULTIPLIER_B) & SPINE_TITLE_MASK;
  value ^= value >> 31n;
  return value % SPINE_TITLE_SPACE;
}

function zigzag(value) {
  return value >= 0n ? value * 2n : -value * 2n - 1n;
}

function unzigzag(value) {
  return value % 2n === 0n ? value / 2n : -(value + 1n) / 2n;
}

export function roomIndexFor(q, r) {
  const a = zigzag(asBigInt(q, 'q'));
  const b = zigzag(asBigInt(r, 'r'));
  const sum = a + b;
  return sum * (sum + 1n) / 2n + a;
}

export function coordinatesForRoomIndex(index) {
  const value = asBigInt(index, 'room index');
  if (value < 0n) throw new RangeError('room index must not be negative.');
  if (value === 0n) return { q: 0n, r: 0n };
  const discriminant = 8n * value + 1n;
  let x = 1n << BigInt((discriminant.toString(2).length + 1) >> 1);
  let y = (x + discriminant / x) >> 1n;
  while (y < x) {
    x = y;
    y = (x + discriminant / x) >> 1n;
  }
  const w = (x - 1n) / 2n;
  const t = w * (w + 1n) / 2n;
  const a = value - t;
  return { q: unzigzag(a), r: unzigzag(w - a) };
}

function cachedRoomIndex(q, r) {
  const byR = roomIndexCache.get(q);
  if (byR?.has(r)) return byR.get(r);
  const room = roomIndexFor(q, r);
  if (roomIndexCache.size >= ROOM_CACHE_LIMIT && !byR) roomIndexCache.clear();
  const nextByR = byR || new Map();
  nextByR.set(r, room);
  roomIndexCache.set(q, nextByR);
  return room;
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

function normalizedLocation(location, page = 1) {
  if (!location || typeof location !== 'object') throw new TypeError('location must be an object.');
  let q;
  let r;
  let room;
  if (location.q !== undefined || location.r !== undefined) {
    q = asBigInt(location.q, 'q');
    r = asBigInt(location.r, 'r');
    room = cachedRoomIndex(q, r);
  } else if (location.room !== undefined) {
    room = asBigInt(location.room, 'room index');
    if (room < 0n) throw new RangeError('room index must not be negative.');
    ({ q, r } = coordinatesForRoomIndex(room));
  } else {
    throw new TypeError('location needs q/r coordinates or a room index.');
  }
  if (room >= HEX_COUNT) throw new RangeError('coordinates are outside the finite v3 library.');
  return {
    q,
    r,
    room,
    wall: positiveInteger(location.wall, WALLS_PER_HEX, 'wall'),
    shelf: positiveInteger(location.shelf, SHELVES_PER_WALL, 'shelf'),
    volume: positiveInteger(location.volume, VOLUMES_PER_SHELF, 'volume'),
    page: positiveInteger(location.page === undefined ? page : location.page, PAGES_PER_VOLUME, 'page'),
  };
}

function volumeSlotForNormalizedLocation(value) {
  return (BigInt(value.wall - 1) * BigInt(SHELVES_PER_WALL) + BigInt(value.shelf - 1)) * BigInt(VOLUMES_PER_SHELF) + BigInt(value.volume - 1);
}

function bookIndexForNormalizedLocation(value) {
  return value.room * VOLUMES_PER_HEX + volumeSlotForNormalizedLocation(value);
}

function assertAddressableVolume(value) {
  const index = bookIndexForNormalizedLocation(value);
  if (index >= BOOK_SPACE_SIZE) throw new RangeError('this volume is outside the finite v3 library.');
  return index;
}

export function bookIndexFor(location) {
  return assertAddressableVolume(normalizedLocation(location));
}

export function isAddressableVolume(location) {
  try {
    bookIndexFor(location);
    return true;
  } catch {
    return false;
  }
}

export function locationForBookIndex(index, page = 1) {
  const book = assertBookIndex(index);
  const room = book / VOLUMES_PER_HEX;
  const slot = book % VOLUMES_PER_HEX;
  const coordinates = coordinatesForRoomIndex(room);
  const volume = Number(slot % BigInt(VOLUMES_PER_SHELF)) + 1;
  const shelfSlot = slot / BigInt(VOLUMES_PER_SHELF);
  const shelf = Number(shelfSlot % BigInt(SHELVES_PER_WALL)) + 1;
  const wall = Number(shelfSlot / BigInt(SHELVES_PER_WALL)) + 1;
  return {
    q: coordinates.q,
    r: coordinates.r,
    room,
    wall,
    shelf,
    volume,
    page: positiveInteger(page, PAGES_PER_VOLUME, 'page'),
  };
}

function formatVolumeAddress(value) {
  return ALGORITHM_VERSION + ';' + value.room.toString(16) + ';' + value.wall + ';' + value.shelf + ';' + value.volume;
}

function formatPageAddress(value) {
  return formatVolumeAddress(value) + ';' + value.page;
}

function addressFieldsForBookIndex(index, page = 1) {
  const book = assertBookIndex(index);
  const room = book / VOLUMES_PER_HEX;
  const slot = book % VOLUMES_PER_HEX;
  const volume = Number(slot % BigInt(VOLUMES_PER_SHELF)) + 1;
  const shelfSlot = slot / BigInt(VOLUMES_PER_SHELF);
  const shelf = Number(shelfSlot % BigInt(SHELVES_PER_WALL)) + 1;
  const wall = Number(shelfSlot / BigInt(SHELVES_PER_WALL)) + 1;
  return {
    room,
    wall,
    shelf,
    volume,
    page: positiveInteger(page, PAGES_PER_VOLUME, 'page'),
  };
}

// These direct functions are deliberately room-index based.  They avoid the
// expensive room-index → q/r → room-index round trip when a renderer already
// has the physical book index for a spine.
export function createVolumeAddressForBookIndex(index) {
  return formatVolumeAddress(addressFieldsForBookIndex(index, 1));
}

export function createPageAddressForBookIndex(index, page = 1) {
  return formatPageAddress(addressFieldsForBookIndex(index, page));
}

const CANONICAL_HEX = /^(?:0|[1-9a-f][0-9a-f]*)$/;
const CANONICAL_POSITIVE_INTEGER = /^[1-9]\d*$/;

function parsedParts(address, length, kind) {
  if (typeof address !== 'string') throw new TypeError('expected a v3 ' + kind + ' address.');
  const parts = address.split(';');
  if (parts.length !== length || parts[0] !== ALGORITHM_VERSION) throw new TypeError('expected a v3 ' + kind + ' address.');
  if (!CANONICAL_HEX.test(parts[1])) throw new TypeError('room index must be canonical lowercase hexadecimal.');
  for (let index = 2; index < parts.length; index++) {
    if (!CANONICAL_POSITIVE_INTEGER.test(parts[index])) throw new TypeError('address fields must be canonical positive integers.');
  }
  return parts;
}

function locationForParsedParts(parts, page) {
  const room = BigInt('0x' + parts[1]);
  return normalizedLocation({
    room,
    wall: parts[2],
    shelf: parts[3],
    volume: parts[4],
    page,
  });
}

export function createVolumeAddress(location) {
  const value = normalizedLocation({ ...location, page: 1 });
  return createVolumeAddressForBookIndex(assertAddressableVolume(value));
}

export function createPageAddress(location) {
  const value = normalizedLocation(location);
  return createPageAddressForBookIndex(assertAddressableVolume(value), value.page);
}

export function parseVolumeAddress(address) {
  const parts = parsedParts(address, 5, 'volume');
  const value = locationForParsedParts(parts, 1);
  assertAddressableVolume(value);
  return value;
}

export function parsePageAddress(address) {
  const parts = parsedParts(address, 6, 'page');
  const value = locationForParsedParts(parts, parts[5]);
  assertAddressableVolume(value);
  return value;
}

export function pageValueForText(text) {
  if (typeof text !== 'string' || text.length !== PAGE_LENGTH) throw new RangeError('a page must contain exactly ' + PAGE_LENGTH + ' symbols.');
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new RangeError('unsupported page character: ' + JSON.stringify(char) + '.');
    value = value * BASE + BigInt(digit);
  }
  return value;
}

export function textForPageValue(value) {
  let current = asBigInt(value, 'page value');
  if (current < 0n || current >= PAGE_SPACE_SIZE) throw new RangeError('page value is outside the v3 page alphabet.');
  const chars = Array(PAGE_LENGTH);
  for (let index = PAGE_LENGTH - 1; index >= 0; index--) {
    chars[index] = ALPHABET[Number(current % BASE)];
    current /= BASE;
  }
  return chars.join('');
}

function deterministicFiller(length, seed) {
  let state = seed >>> 0;
  const chars = Array(length);
  for (let index = 0; index < length; index++) {
    state = xorshift32(state);
    chars[index] = ALPHABET[state % ALPHABET.length];
  }
  return chars.join('');
}

export const MANIFESTO_LOCATION = Object.freeze({ q: 362n, r: -419n, wall: 2, shelf: 2, volume: 13, page: 197 });
export const MANIFESTO_TEXT = 'the library is larger than the universe. somewhere inside it may be a sentence you have been looking for all your life. every book has a location. every page can be revisited. every discovery can be shared. explore the hexes. record the coordinates. compare your findings with people from around the world. we are not searching for one official answer. we are searching for the words that change the questions.';
export const MANIFESTO_TEXT_OFFSET = 1260;

const manifestoPrefix = deterministicFiller(MANIFESTO_TEXT_OFFSET, 0x6f1d2c93);
const manifestoSuffix = deterministicFiller(PAGE_LENGTH - MANIFESTO_TEXT_OFFSET - MANIFESTO_TEXT.length, 0x9a41e85d);
const MANIFESTO_PAGE_VALUE = pageValueForText(manifestoPrefix + MANIFESTO_TEXT + manifestoSuffix);
const MANIFESTO_TARGET_BOOK_INDEX = bookIndexFor(MANIFESTO_LOCATION);
const MANIFESTO_SOURCE_BLOCK = modulo((MANIFESTO_PAGE_VALUE - BigInt(MANIFESTO_LOCATION.page) * PAGE_OFFSET) * PAGE_BLOCK_INVERSE, PAGE_SPACE_SIZE);
const MANIFESTO_SOURCE_BOOK_INDEX = MANIFESTO_SOURCE_BLOCK * (PAGE_SPACE_SIZE ** BigInt(MANIFESTO_LOCATION.page - 1));

function physicalBookIndexForBaseBookIndex(baseIndex) {
  if (baseIndex === MANIFESTO_TARGET_BOOK_INDEX) return MANIFESTO_SOURCE_BOOK_INDEX;
  if (baseIndex === MANIFESTO_SOURCE_BOOK_INDEX) return MANIFESTO_TARGET_BOOK_INDEX;
  return baseIndex;
}

function baseBookIndexForPhysicalBookIndex(bookIndex) {
  return physicalBookIndexForBaseBookIndex(bookIndex);
}

function rawBlockForBaseBookIndex(bookIndex, pageIndex) {
  if (pageIndex < 0 || pageIndex >= PAGES_PER_VOLUME) throw new RangeError('page block is outside the book.');
  if (bookIndex === MANIFESTO_SOURCE_BOOK_INDEX) return pageIndex === MANIFESTO_LOCATION.page - 1 ? MANIFESTO_SOURCE_BLOCK : 0n;
  // A page block is a base-P digit of the whole-book index.  Extract it with
  // BigInt arithmetic instead of materialising the 1,312,000-digit base-29
  // representation.  This keeps an arbitrary exact v3 room cheap enough to
  // render as one room of 640 spine titles.
  if (pageIndex === 0) return bookIndex % PAGE_SPACE_SIZE;
  // P^pageIndex is at least 2^(pageIndex * floor(log2(P))).  This check is
  // conservative, exact, and skips giant exponentiation for the canonical
  // books used by search (and for most books near the origin).
  if (bitLengthForBookIndex(bookIndex) <= pageIndex * PAGE_SPACE_BINARY_LOWER_BITS) return 0n;
  const quotient = bookIndex / (PAGE_SPACE_SIZE ** BigInt(pageIndex));
  return quotient === 0n ? 0n : quotient % PAGE_SPACE_SIZE;
}

export function pageValueForBookIndex(bookIndex, page) {
  const physical = assertBookIndex(bookIndex);
  const pageNumber = positiveInteger(page, PAGES_PER_VOLUME, 'page');
  const baseBookIndex = baseBookIndexForPhysicalBookIndex(physical);
  const r0 = rawBlockForBaseBookIndex(baseBookIndex, 0);
  if (pageNumber === 1) return modulo(PAGE_BLOCK_MULTIPLIER * r0 + PAGE_OFFSET, PAGE_SPACE_SIZE);
  const rp = rawBlockForBaseBookIndex(baseBookIndex, pageNumber - 1);
  return modulo(
    PAGE_BLOCK_MULTIPLIER * rp
      + BigInt(pageNumber) * PAGE_SPREAD * r0
      + BigInt(pageNumber) * PAGE_OFFSET,
    PAGE_SPACE_SIZE,
  );
}

function locationFromInput(input) {
  if (typeof input === 'string') return parsePageAddress(input);
  return normalizedLocation(input);
}

export function getPageForBookIndex(bookIndex, page = 1) {
  return textForPageValue(pageValueForBookIndex(bookIndex, page));
}

export function getPage(addressOrLocation) {
  const location = locationFromInput(addressOrLocation);
  return getPageForBookIndex(bookIndexForNormalizedLocation(location), location.page);
}

function trailingTextForPageValue(value, length) {
  let current = value;
  const chars = Array(length);
  for (let index = length - 1; index >= 0; index--) {
    chars[index] = ALPHABET[Number(current % BASE)];
    current /= BASE;
  }
  return chars.join('');
}

export function titleForBookIndex(bookIndex) {
  const value = asBigInt(bookIndex, 'book index');
  if (value < 0n) throw new RangeError('book index must not be negative.');
  // This visual helper intentionally does not compare a multi-megabit value
  // with BOOK_SPACE_SIZE on every spine.  Callers that expose a physical slot
  // validate it through create/get APIs; the title mixer itself only consumes
  // the low 64 bits and is safe for a catalogue preview.
  return trailingTextForPageValue(spineTitleValueForBookIndex(value), 12).trim() || 'untitled';
}

export function isManifestoBookIndex(bookIndex) {
  return assertBookIndex(bookIndex) === MANIFESTO_TARGET_BOOK_INDEX;
}

export function initialPageForBookIndex(bookIndex) {
  return isManifestoBookIndex(bookIndex) ? MANIFESTO_LOCATION.page : 1;
}

export function isManifestoVolume(addressOrLocation) {
  const location = typeof addressOrLocation === 'string'
    ? parseVolumeAddress(addressOrLocation)
    : normalizedLocation({ ...addressOrLocation, page: 1 });
  return isManifestoBookIndex(bookIndexForNormalizedLocation(location));
}

export function titleForVolume(addressOrLocation) {
  const location = typeof addressOrLocation === 'string'
    ? parseVolumeAddress(addressOrLocation)
    : normalizedLocation({ ...addressOrLocation, page: 1 });
  return titleForBookIndex(bookIndexForNormalizedLocation(location));
}

export function initialPageForVolume(addressOrLocation) {
  const location = typeof addressOrLocation === 'string'
    ? parseVolumeAddress(addressOrLocation)
    : normalizedLocation({ ...addressOrLocation, page: 1 });
  return initialPageForBookIndex(bookIndexForNormalizedLocation(location));
}

function addressForPhysicalBookIndex(bookIndex, page = 1) {
  return createPageAddressForBookIndex(bookIndex, page);
}

export function canonicalAddressForPage(text) {
  const pageValue = pageValueForText(text);
  const baseBookIndex = modulo((pageValue - PAGE_OFFSET) * PAGE_BLOCK_INVERSE, PAGE_SPACE_SIZE);
  return addressForPhysicalBookIndex(physicalBookIndexForBaseBookIndex(baseBookIndex), 1);
}

export function search(text, depth = 0) {
  if (typeof text !== 'string' || !text.length || text.length > PAGE_LENGTH) throw new RangeError('search text must contain 1–' + PAGE_LENGTH + ' characters.');
  if (!Number.isInteger(depth) || depth < 0 || depth + text.length > PAGE_LENGTH) throw new RangeError('search depth is outside the first page.');
  for (const char of text) if (!ALPHABET.includes(char)) throw new RangeError('unsupported search character: ' + JSON.stringify(char) + '.');
  const filler = deterministicFiller(PAGE_LENGTH, 0x3b4f21a7);
  const page = filler.slice(0, depth) + text + filler.slice(depth + text.length);
  return canonicalAddressForPage(page);
}

export function addressForBook(pages) {
  if (!Array.isArray(pages) || pages.length !== PAGES_PER_VOLUME) throw new RangeError('a v3 book must contain exactly ' + PAGES_PER_VOLUME + ' pages.');
  const values = pages.map(pageValueForText);
  const raw = Array(PAGES_PER_VOLUME);
  raw[0] = modulo((values[0] - PAGE_OFFSET) * PAGE_BLOCK_INVERSE, PAGE_SPACE_SIZE);
  for (let index = 1; index < PAGES_PER_VOLUME; index++) {
    raw[index] = modulo(
      (values[index]
        - BigInt(index + 1) * PAGE_SPREAD * raw[0]
        - BigInt(index + 1) * PAGE_OFFSET) * PAGE_BLOCK_INVERSE,
      PAGE_SPACE_SIZE,
    );
  }
  let baseBookIndex = 0n;
  for (let index = raw.length - 1; index >= 0; index--) baseBookIndex = baseBookIndex * PAGE_SPACE_SIZE + raw[index];
  return addressForPhysicalBookIndex(physicalBookIndexForBaseBookIndex(baseBookIndex), 1);
}
