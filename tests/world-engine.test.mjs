import assert from 'node:assert/strict';
import {
  BOOK_SPACE_SIZE,
  MANIFESTO_LOCATION,
  VOLUMES_PER_HEX,
  bookIndexFor,
} from '../babel-v3.js';
import {
  LEVEL_FREE_WALL_AXES,
  WORLD_ALGORITHM_VERSION,
  WORLD_BOOK_COUNT,
  WORLD_BOOK_OFFSET,
  WORLD_FINGERPRINT,
  WORLD_MANIFESTO_LOCATION,
  bookWallsForLevel,
  canonicalWallForWallIndex,
  catalogBookIndexFor,
  catalogBookIndexForWorldSlotIndex,
  catalogPlacementForWorldSlotIndex,
  createWorldPageAddress,
  createWorldRoomAddress,
  createWorldVolumeAddress,
  freeWallsForLevel,
  parseWorldPageAddress,
  parseWorldRoomAddress,
  parseWorldVolumeAddress,
  wallIndexForCanonicalWall,
  worldCoordinatesForRoomIndex,
  worldLocationForCatalogPlacement,
  worldLocationForSlotIndex,
  worldRoomIndexFor,
  worldSlotIndexFor,
  worldSlotIndexForCatalogPlacement,
} from '../world-engine.js';

assert.equal(WORLD_ALGORITHM_VERSION, 'w2');
assert.equal(WORLD_FINGERPRINT, 'w2-axial-level-zigzag-cantor-cycle-640-780713600-20260803');
assert.equal(WORLD_BOOK_COUNT, BOOK_SPACE_SIZE);
assert.equal(WORLD_BOOK_OFFSET, 780713600n);

// --- rooms are (q, r, level) and the encoding is reversible ------------------
const rooms = [
  [0n, 0n, 0n],
  [1n, 0n, 0n],
  [0n, 0n, 1n],
  [0n, 0n, -1n],
  [-7n, 4n, 3n],
  [12n, -30n, -9n],
  [10n ** 40n, -(10n ** 39n), 10n ** 12n],
  [-(10n ** 200n), 10n ** 199n, -(10n ** 30n)],
];
for (const [q, r, level] of rooms) {
  const index = worldRoomIndexFor(q, r, level);
  assert.ok(index >= 0n, 'a room index is never negative');
  const back = worldCoordinatesForRoomIndex(index);
  assert.equal(back.q, q);
  assert.equal(back.r, r);
  assert.equal(back.level, level, 'the level survives the round trip');
}

// Distinct rooms never share an index, levels included.
const indices = new Set(rooms.map(([q, r, level]) => worldRoomIndexFor(q, r, level).toString()));
assert.equal(indices.size, rooms.length);

// The origin keeps index 0, which is what lets the manifesto keep its address.
assert.equal(worldRoomIndexFor(0n, 0n, 0n), 0n);

// A level of its own is a different room from the plane below it.
assert.notEqual(worldRoomIndexFor(3n, -2n, 0n), worldRoomIndexFor(3n, -2n, 1n));

// --- free walls rotate with the level ---------------------------------------
assert.deepEqual(LEVEL_FREE_WALL_AXES.map(axis => [...axis]), [[2, 5], [0, 3], [1, 4]]);

// Every axis is a pair of opposite walls: a doorway is shared, so the far side
// must open too.
for (const [first, second] of LEVEL_FREE_WALL_AXES) {
  assert.equal((first + 3) % 6, second, 'the two free walls of a level face each other');
}

// Negative levels are as ordinary as positive ones.
assert.deepEqual([...freeWallsForLevel(-1n)], [...freeWallsForLevel(2n)]);
assert.deepEqual([...freeWallsForLevel(-3n)], [...freeWallsForLevel(0n)]);

// Adjacent levels never share an axis, or climbing would gain nothing.
for (let level = -4; level <= 4; level++) {
  const here = freeWallsForLevel(level);
  const above = freeWallsForLevel(level + 1);
  assert.notDeepEqual([...here], [...above], `levels ${level} and ${level + 1} must differ`);
}

// Four shelved walls on every level, so 640 volumes survives the change.
for (let level = -3; level <= 3; level++) {
  const walls = bookWallsForLevel(level);
  assert.equal(walls.length, 4);
  assert.equal(new Set(walls).size, 4);
  for (const wall of walls) assert.ok(!freeWallsForLevel(level).includes(wall));
  // Canonical wall numbers 1..4 name those walls in order, both ways.
  for (let canonical = 1; canonical <= 4; canonical++) {
    const wallIndex = wallIndexForCanonicalWall(level, canonical);
    assert.equal(canonicalWallForWallIndex(level, wallIndex), canonical);
  }
  for (const free of freeWallsForLevel(level)) {
    assert.equal(canonicalWallForWallIndex(level, free), 0, 'a free wall carries no shelves');
  }
}

// Level 0 keeps the walls the plane-only placement used.
assert.deepEqual(bookWallsForLevel(0), [0, 1, 3, 4]);

// --- two axes reach the whole plane -----------------------------------------
// This is the point of the whole change: walking one level, climbing, and
// walking the next must arrive at every neighbour, not just two.
const DIRECTIONS = [[1n, 0n], [0n, 1n], [-1n, 1n], [-1n, 0n], [0n, -1n], [1n, -1n]];
const reachable = new Set(['0,0']);
let frontier = [[0n, 0n, 0]];
for (let step = 0; step < 6; step++) {
  const next = [];
  for (const [q, r, level] of frontier) {
    for (const wall of freeWallsForLevel(level)) {
      const [dq, dr] = DIRECTIONS[wall];
      reachable.add(`${q + dq},${r + dr}`);
      next.push([q + dq, r + dr, level]);
    }
    next.push([q, r, level + 1]);
    next.push([q, r, level - 1]);
  }
  frontier = next;
}
for (const [dq, dr] of DIRECTIONS) {
  assert.ok(reachable.has(`${dq},${dr}`), `neighbour ${dq},${dr} must be reachable on foot`);
}

// --- every slot of a room exists, on any level ------------------------------
for (const [q, r, level] of [[0n, 0n, 0n], [5n, -3n, 2n], [-11n, 8n, -4n]]) {
  const slots = new Set();
  for (let wall = 1; wall <= 4; wall++) {
    for (let shelf = 1; shelf <= 5; shelf++) {
      for (let volume = 1; volume <= 32; volume++) {
        const slot = worldSlotIndexFor({ q, r, level, wall, shelf, volume, page: 1 });
        slots.add(slot.toString());
        const book = catalogBookIndexFor({ q, r, level, wall, shelf, volume, page: 1 });
        assert.ok(book >= 0n && book < BOOK_SPACE_SIZE);
      }
    }
  }
  assert.equal(slots.size, Number(VOLUMES_PER_HEX), 'a room holds exactly 640 volumes');
}

// --- the catalogue still cycles ---------------------------------------------
const someSlot = 123456789n;
assert.equal(
  catalogBookIndexForWorldSlotIndex(someSlot),
  catalogBookIndexForWorldSlotIndex(someSlot + WORLD_BOOK_COUNT),
);
assert.equal(catalogPlacementForWorldSlotIndex(someSlot).occurrence, 0n);
assert.equal(catalogPlacementForWorldSlotIndex(someSlot + WORLD_BOOK_COUNT).occurrence, 1n);
const placementSlot = worldSlotIndexForCatalogPlacement(4242n, 2);
assert.equal(catalogBookIndexForWorldSlotIndex(placementSlot), 4242n);
assert.equal(worldLocationForCatalogPlacement(4242n, 2).worldRoom >= 0n, true);
assert.equal(worldLocationForSlotIndex(someSlot).page, 1);

// --- the manifesto keeps its place ------------------------------------------
assert.equal(WORLD_MANIFESTO_LOCATION.level, 0n);
assert.equal(catalogBookIndexFor(WORLD_MANIFESTO_LOCATION), bookIndexFor(MANIFESTO_LOCATION));
assert.equal(createWorldPageAddress(WORLD_MANIFESTO_LOCATION), 'w2;0;2;2;13;197');
assert.equal(createWorldRoomAddress({ q: 0n, r: 0n, level: 0n }), 'w2;0');

// --- addresses -------------------------------------------------------------
for (const [q, r, level] of rooms) {
  const address = createWorldPageAddress({ q, r, level, wall: 3, shelf: 4, volume: 17, page: 200 });
  const parsed = parseWorldPageAddress(address);
  assert.equal(parsed.q, q);
  assert.equal(parsed.r, r);
  assert.equal(parsed.level, level);
  assert.equal(parsed.wall, 3);
  assert.equal(parsed.shelf, 4);
  assert.equal(parsed.volume, 17);
  assert.equal(parsed.page, 200);
  const volumeAddress = createWorldVolumeAddress({ q, r, level, wall: 3, shelf: 4, volume: 17 });
  assert.equal(parseWorldVolumeAddress(volumeAddress).page, 1);
  assert.equal(parseWorldRoomAddress(createWorldRoomAddress({ q, r, level })).level, level);
}

assert.throws(() => parseWorldPageAddress('w2;0;2;2;13;411'), RangeError);
assert.throws(() => parseWorldPageAddress('w2;0;5;2;13;197'), RangeError);
assert.throws(() => parseWorldPageAddress('w3;0;2;2;13;197'), TypeError);
assert.throws(() => parseWorldRoomAddress('w2;0A'), TypeError);
assert.throws(() => parseWorldRoomAddress('w2;007'), TypeError);

// --- a w1 address still means something -------------------------------------
// w1 enumerated the plane alone, so its indices name the level-0 rooms and are
// translated rather than rejected.
assert.equal(parseWorldRoomAddress('w1;0').level, 0n);
assert.deepEqual(
  [parseWorldRoomAddress('w1;0').q, parseWorldRoomAddress('w1;0').r],
  [0n, 0n],
);
const legacy = parseWorldPageAddress('w1;7;2;2;13;197');
assert.equal(legacy.level, 0n);
assert.deepEqual([legacy.q, legacy.r], [-1n, 1n], 'w1;7 was the neighbour through wall 2');
assert.throws(() => parseWorldRoomAddress('w1;0;'), TypeError);

// A w1 index and a w2 index are read differently, so the same digits name
// different rooms; only the origin is common to both.
assert.deepEqual(
  [parseWorldRoomAddress('w1;0').q, parseWorldRoomAddress('w1;0').r, parseWorldRoomAddress('w1;0').level],
  [parseWorldRoomAddress('w2;0').q, parseWorldRoomAddress('w2;0').r, parseWorldRoomAddress('w2;0').level],
);
assert.notDeepEqual(
  [parseWorldRoomAddress('w1;7').q, parseWorldRoomAddress('w1;7').r],
  [parseWorldRoomAddress('w2;7').q, parseWorldRoomAddress('w2;7').r],
);

console.log('world-engine: all stacked placement invariants passed');
