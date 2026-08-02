import assert from 'node:assert/strict';
import {
  BOOK_SPACE_SIZE,
  MANIFESTO_LOCATION,
  PAGES_PER_VOLUME,
  VOLUMES_PER_HEX,
  bookIndexFor,
} from '../babel-v3.js';
import {
  WORLD_ALGORITHM_VERSION,
  WORLD_BOOK_COUNT,
  WORLD_BOOK_OFFSET,
  WORLD_FINGERPRINT,
  WORLD_MANIFESTO_LOCATION,
  catalogBookIndexFor,
  catalogBookIndexForWorldSlotIndex,
  catalogPlacementForWorldSlotIndex,
  createWorldPageAddress,
  createWorldRoomAddress,
  createWorldVolumeAddress,
  parseWorldPageAddress,
  parseWorldRoomAddress,
  parseWorldVolumeAddress,
  worldCoordinatesForRoomIndex,
  worldLocationForCatalogPlacement,
  worldLocationForSlotIndex,
  worldRoomIndexFor,
  worldSlotIndexFor,
  worldSlotIndexForCatalogPlacement,
} from '../world-engine.js';

assert.equal(WORLD_ALGORITHM_VERSION, 'w1');
assert.equal(WORLD_FINGERPRINT, 'w1-axial-zigzag-cantor-cycle-640-780713600-20260802');
assert.equal(WORLD_BOOK_COUNT, BOOK_SPACE_SIZE);
assert.equal(VOLUMES_PER_HEX, 640n);
assert.equal(WORLD_BOOK_OFFSET, 780713600n);
assert.ok(WORLD_BOOK_OFFSET >= 0n && WORLD_BOOK_OFFSET < WORLD_BOOK_COUNT);

// Axial coordinates and world room indices are exact inverses without a
// finite boundary.
for (let q = -24; q <= 24; q++) {
  for (let r = -24; r <= 24; r++) {
    const room = worldRoomIndexFor(q, r);
    assert.deepEqual(worldCoordinatesForRoomIndex(room), { q: BigInt(q), r: BigInt(r) });
  }
}
const farCoordinates = {
  q: 10n ** 1000n + 987654321n,
  r: -(10n ** 999n) - 123456789n,
};
const farRoom = worldRoomIndexFor(farCoordinates.q, farCoordinates.r);
assert.deepEqual(worldCoordinatesForRoomIndex(farRoom), farCoordinates);

// The chosen offset puts the existing v3 manifesto book at the requested
// physical position in world room (0, 0).
const manifestoBook = bookIndexFor(MANIFESTO_LOCATION);
assert.equal(worldRoomIndexFor(0n, 0n), 0n);
assert.equal(catalogBookIndexFor(WORLD_MANIFESTO_LOCATION), manifestoBook);
assert.equal(createWorldPageAddress(WORLD_MANIFESTO_LOCATION), 'w1;0;2;2;13;197');
assert.deepEqual(parseWorldPageAddress('w1;0;2;2;13;197'), WORLD_MANIFESTO_LOCATION);

// Every room contains all 640 slots.  No slot is truncated at the catalogue
// boundary, and page selection does not change the underlying book.
function allRoomBooks(q, r) {
  const books = [];
  for (let wall = 1; wall <= 4; wall++) {
    for (let shelf = 1; shelf <= 5; shelf++) {
      for (let volume = 1; volume <= 32; volume++) {
        const location = { q, r, wall, shelf, volume, page: 1 };
        const firstPageBook = catalogBookIndexFor(location);
        assert.equal(catalogBookIndexFor({ ...location, page: PAGES_PER_VOLUME }), firstPageBook);
        books.push(firstPageBook);
      }
    }
  }
  return books;
}

const originBooks = allRoomBooks(0n, 0n);
assert.equal(originBooks.length, 640);
assert.equal(new Set(originBooks).size, 640);
assert.equal(originBooks[0], WORLD_BOOK_OFFSET);
assert.equal(originBooks[204], manifestoBook);

const farBooks = allRoomBooks(farCoordinates.q, farCoordinates.r);
assert.equal(farBooks.length, 640);
assert.equal(new Set(farBooks).size, 640);
assert.ok(farBooks.every(book => book >= 0n && book < WORLD_BOOK_COUNT));

// The finite catalogue repeats exactly every B world slots, including the
// explicit wrap from B - 1 to 0.
const wrapSlot = WORLD_BOOK_COUNT - WORLD_BOOK_OFFSET;
assert.equal(catalogBookIndexForWorldSlotIndex(wrapSlot - 1n), WORLD_BOOK_COUNT - 1n);
assert.equal(catalogBookIndexForWorldSlotIndex(wrapSlot), 0n);
for (const slot of [0n, 204n, wrapSlot, WORLD_BOOK_COUNT + 17n, 3n * WORLD_BOOK_COUNT + 901n]) {
  assert.equal(
    catalogBookIndexForWorldSlotIndex(slot + WORLD_BOOK_COUNT),
    catalogBookIndexForWorldSlotIndex(slot),
  );
  const placement = catalogPlacementForWorldSlotIndex(slot);
  assert.equal(worldSlotIndexForCatalogPlacement(placement.bookIndex, placement.occurrence), slot);
}
for (const slot of [0n, 204n, 901n, 1000000n]) {
  assert.equal(worldSlotIndexFor(worldLocationForSlotIndex(slot)), slot);
}

const firstManifestoPlacement = worldLocationForCatalogPlacement(manifestoBook, 0n, 197);
assert.equal(catalogBookIndexFor(firstManifestoPlacement), manifestoBook);
assert.equal(worldSlotIndexFor(firstManifestoPlacement), worldSlotIndexFor(WORLD_MANIFESTO_LOCATION));
const repeatedManifestoSlot = worldSlotIndexForCatalogPlacement(manifestoBook, 3n);
assert.equal(catalogBookIndexForWorldSlotIndex(repeatedManifestoSlot), manifestoBook);
assert.equal(repeatedManifestoSlot, worldSlotIndexFor(WORLD_MANIFESTO_LOCATION) + 3n * WORLD_BOOK_COUNT);

// Wire forms are lowercase and canonical, while exact room, volume, and page
// addresses all recover the same unbounded world location.
const farPageAddress = createWorldPageAddress({ ...farCoordinates, wall: 4, shelf: 5, volume: 32, page: 410 });
assert.match(farPageAddress, /^w1;[0-9a-f]+;4;5;32;410$/);
assert.deepEqual(
  parseWorldPageAddress(farPageAddress),
  { ...farCoordinates, worldRoom: farRoom, wall: 4, shelf: 5, volume: 32, page: 410 },
);

const farRoomAddress = createWorldRoomAddress(farCoordinates);
assert.deepEqual(parseWorldRoomAddress(farRoomAddress), { ...farCoordinates, worldRoom: farRoom });
const farVolumeAddress = createWorldVolumeAddress({ ...farCoordinates, wall: 4, shelf: 5, volume: 32 });
assert.deepEqual(
  parseWorldVolumeAddress(farVolumeAddress),
  { ...farCoordinates, worldRoom: farRoom, wall: 4, shelf: 5, volume: 32, page: 1 },
);

for (const invalid of [
  'w1;00;1;1;1;1',
  'w1;A;1;1;1;1',
  'W1;0;1;1;1;1',
  'w1;0;01;1;1;1',
  'w1;0;0;1;1;1',
  'w1;0;5;1;1;1',
  'w1;0;1;6;1;1',
  'w1;0;1;1;33;1',
  'w1;0;1;1;1;411',
  'w1;0;1;1;1;1;1',
]) assert.throws(() => parseWorldPageAddress(invalid));
assert.throws(() => parseWorldRoomAddress('w1;00'));
assert.throws(() => parseWorldVolumeAddress('w1;0;1;1;0'));
assert.throws(() => worldCoordinatesForRoomIndex(-1n), RangeError);
assert.throws(() => worldSlotIndexForCatalogPlacement(WORLD_BOOK_COUNT), RangeError);

console.log('world-engine: all unbounded placement invariants passed');
