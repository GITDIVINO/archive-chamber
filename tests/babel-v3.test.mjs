import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ALGORITHM_VERSION,
  ALPHABET,
  BOOK_SPACE_SIZE,
  HEX_COUNT,
  PAGE_LENGTH,
  PAGES_PER_VOLUME,
  V3_FINGERPRINT,
  VOLUMES_PER_HEX,
  addressForBook,
  bookIndexFor,
  canonicalAddressForPage,
  createPageAddress,
  createPageAddressForBookIndex,
  createVolumeAddress,
  createVolumeAddressForBookIndex,
  getPage,
  getPageForBookIndex,
  locationForBookIndex,
  pageValueForBookIndex,
  parsePageAddress,
  parseVolumeAddress,
  search,
  titleForBookIndex,
  titleForVolume,
} from '../babel-v3.js';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

assert.equal(ALGORITHM_VERSION, 'v3');
assert.equal(ALPHABET.length, 29);
assert.equal(PAGE_LENGTH, 3200);
assert.equal(PAGES_PER_VOLUME, 410);
assert.equal(VOLUMES_PER_HEX, 640n);
assert.equal(V3_FINGERPRINT, 'v3-book-block-affine-29-3200-410-20261003');

// The volume that stands at wall 2, shelf 2, volume 13 of the origin room.  It
// held the planted manifesto until that transposition was removed.
const ORIGIN_VOLUME = Object.freeze({ q: 362n, r: -419n, wall: 2, shelf: 2, volume: 13, page: 197 });
const WELCOME_TEXT = 'the library is larger than the universe.';

// These normal-book vectors freeze the published v3 universe.  A change here
// is a new algorithm and must not silently retain the v3 prefix.
const vectors = [
  [{ q: 0n, r: 0n, wall: 1, shelf: 1, volume: 1, page: 1 }, 'a91e5320198208a968ad6e10702b02c29a922e62d34391c25edda993bedf8fc1'],
  [{ q: 12n, r: -7n, wall: 4, shelf: 5, volume: 32, page: 410 }, '8a7d6209b6a44982a2735b72173bae0f09e812d7ffc597685a3a5f7e92d38418'],
  [ORIGIN_VOLUME, 'a0d21fc6b75c815964a88e6f4d104e5eb94a2b19fbf2d9a0555f4f0d1ee6cc84'],
];
for (const [location, expectedHash] of vectors) {
  const address = createPageAddress(location);
  assert.equal(sha256(getPage(address)), expectedHash, 'published page vector must stay immutable within v3');
  assert.equal(getPage(address).length, PAGE_LENGTH);
}

// No volume is planted: the one that held the manifesto is an ordinary book,
// keeps its wire records, and opens on its first page like every other.
const originAddress = 'v3;129d19;2;2;13;197';
const originVolume = 'v3;129d19;2;2;13';
assert.equal(createPageAddress(ORIGIN_VOLUME), originAddress);
assert.equal(createVolumeAddress(ORIGIN_VOLUME), originVolume);
const originIndex = bookIndexFor(ORIGIN_VOLUME);
assert.equal(createPageAddressForBookIndex(originIndex, 197), originAddress, 'book-index addresses must retain the published wire record');
assert.equal(createVolumeAddressForBookIndex(originIndex), originVolume);
assert.equal(getPageForBookIndex(originIndex, 197), getPage(originAddress));
for (let page = 1; page <= PAGES_PER_VOLUME; page++) {
  assert.equal(getPageForBookIndex(originIndex, page).includes(WELCOME_TEXT), false, 'no page of the origin volume carries a planted text');
}

// A valid v3 volume is atomic: every one of its 410 pages exists.
for (let page = 1; page <= PAGES_PER_VOLUME; page++) {
  const address = createPageAddress({ ...ORIGIN_VOLUME, page });
  assert.equal(parsePageAddress(address).page, page);
}
assert.equal(parseVolumeAddress(originVolume).page, 1);

const ordinary = { q: -12n, r: 42n, wall: 4, shelf: 5, volume: 32, page: 1 };
const ordinaryIndex = bookIndexFor(ordinary);
assert.equal(createPageAddressForBookIndex(ordinaryIndex), createPageAddress(ordinary), 'direct book-index formatting must match coordinate formatting');
assert.equal(createVolumeAddressForBookIndex(ordinaryIndex), createVolumeAddress(ordinary));
assert.equal(getPageForBookIndex(ordinaryIndex, 410), getPage({ ...ordinary, page: 410 }));
assert.equal(titleForBookIndex(ordinaryIndex), 'e esyowkndaj', 'the spine-title mixer must stay stable without changing page content');
assert.equal(titleForVolume(ordinary), titleForBookIndex(ordinaryIndex));
assert.notEqual(titleForBookIndex(ordinaryIndex), titleForBookIndex(ordinaryIndex + 1n), 'neighbouring book indices should not share a spine title');
const ordinaryPages = Array.from({ length: PAGES_PER_VOLUME }, (_, index) => getPage({ ...ordinary, page: index + 1 }));
const ordinaryRoundTrip = parsePageAddress(addressForBook(ordinaryPages));
assert.equal(bookIndexFor(ordinaryRoundTrip), ordinaryIndex, 'a complete ordinary book must round trip to its unique volume');

// The inverse is also exact for a book whose second base-page block is used.
const secondBlockLocation = locationForBookIndex((BigInt(ALPHABET.length) ** BigInt(PAGE_LENGTH)) + 7n);
const secondBlockPages = Array.from({ length: PAGES_PER_VOLUME }, (_, index) => getPage({ ...secondBlockLocation, page: index + 1 }));
assert.equal(bookIndexFor(parsePageAddress(addressForBook(secondBlockPages))), bookIndexFor(secondBlockLocation));

const exactPage = ('a, b. '.repeat(534)).slice(0, PAGE_LENGTH);
const canonical = canonicalAddressForPage(exactPage);
assert.equal(getPage(canonical), exactPage, 'a canonical page address must recover its exact page');

const query = '  a, b  ';
const found = search(query, 19);
assert.equal(getPage(found).slice(19, 19 + query.length), query, 'search must preserve every permitted space exactly');
assert.throws(() => search('A'), RangeError);
assert.throws(() => search('a\\nb'), RangeError);

// The final hex may have fewer volumes, but never a truncated one.
assert.equal(BOOK_SPACE_SIZE % VOLUMES_PER_HEX, 1n);
const lastBook = locationForBookIndex(BOOK_SPACE_SIZE - 1n, PAGES_PER_VOLUME);
assert.equal(getPage(lastBook).length, PAGE_LENGTH);
assert.throws(() => locationForBookIndex(BOOK_SPACE_SIZE), RangeError);
assert.throws(() => createPageAddressForBookIndex(BOOK_SPACE_SIZE), RangeError);
assert.throws(() => getPageForBookIndex(BOOK_SPACE_SIZE, 1), RangeError);
assert.equal(HEX_COUNT * VOLUMES_PER_HEX - BOOK_SPACE_SIZE, VOLUMES_PER_HEX - 1n);

// Page content is intentionally no longer a global identity in v3: it is the
// whole 410-page book that has a single address.
assert.notEqual(pageValueForBookIndex(ordinaryIndex, 1), pageValueForBookIndex(ordinaryIndex, 2));

console.log('babel-v3: all invariants passed');
