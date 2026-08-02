import assert from 'node:assert/strict';
import {
  createWorldRoomAddress,
  worldCoordinatesForRoomIndex,
  worldRoomIndexFor,
} from '../world-engine.js';
import {
  WALL_DIRECTIONS,
  axialDistance,
  catalogueCoordinates,
  exactWorldRoomAddressFor,
  isAddressableHex,
  neighborFor,
  roomKey,
  roomTagFor,
} from '../world-model.js';

const origin = { q: 0n, r: 0n };
assert.equal(WALL_DIRECTIONS.length, 6);
assert.equal(new Set(WALL_DIRECTIONS.map(([q, r]) => q + ':' + r)).size, 6);

for (let index = 0; index < WALL_DIRECTIONS.length; index++) {
  const neighbor = neighborFor(origin, index);
  assert.equal(axialDistance(origin, neighbor), 1n);
  assert.ok(isAddressableHex(neighbor.q, neighbor.r));
}
assert.throws(() => neighborFor(origin, 6), RangeError);

const mapAtOrigin = catalogueCoordinates(origin);
assert.equal(mapAtOrigin.length, 7, 'an unbounded world map always shows the centre and six axial neighbours');
assert.equal(new Set(mapAtOrigin.map(room => roomKey(room.q, room.r))).size, 7);
assert.ok(mapAtOrigin.every(room => isAddressableHex(room.q, room.r)));

const farRoomIndex = (1n << 4096n) + (1n << 2048n) + 73n;
const farRoom = worldCoordinatesForRoomIndex(farRoomIndex);
const mapFarAway = catalogueCoordinates(farRoom);
assert.equal(mapFarAway.length, 7, 'there is no catalogue boundary at arbitrarily high room indices');
assert.ok(mapFarAway.every(room => isAddressableHex(room.q, room.r)));
assert.ok(mapFarAway.every(room => axialDistance(farRoom, room) <= 1n));
assert.equal(new Set(mapFarAway.map(room => roomKey(room.q, room.r))).size, 7);

assert.equal(roomKey(farRoom.q, farRoom.r), farRoomIndex);
assert.equal(roomKey(origin.q, origin.r), worldRoomIndexFor(origin.q, origin.r));
assert.equal(exactWorldRoomAddressFor(farRoom.q, farRoom.r), createWorldRoomAddress(farRoom));
assert.match(exactWorldRoomAddressFor(farRoom.q, farRoom.r), /^w1;[0-9a-f]+$/);

const originTag = roomTagFor(origin.q, origin.r);
const highBitsTag = roomTagFor(farRoom.q, farRoom.r);
assert.match(originTag, /^h-[0-9a-z]{13}$/);
assert.match(highBitsTag, /^h-[0-9a-z]{13}$/);
assert.notEqual(highBitsTag, originTag, 'arbitrarily high BigInt bits must influence the decorative room tag');
assert.ok(!/[A-Z]/.test(highBitsTag));

assert.equal(isAddressableHex(10n ** 10000n, -(10n ** 9999n)), true);
assert.equal(isAddressableHex(1.5, 0), false);

console.log('world-model: all unbounded map invariants passed');
