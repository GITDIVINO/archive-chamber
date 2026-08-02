import {
  createWorldRoomAddress,
  worldRoomIndexFor,
} from './world-engine.js';

export const WALL_DIRECTIONS = Object.freeze([
  [1n, 0n],
  [0n, 1n],
  [-1n, 1n],
  [-1n, 0n],
  [0n, -1n],
  [1n, -1n],
]);

const TAG_MASK = (1n << 64n) - 1n;
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function decorativeHashForRoomIndex(room) {
  let value = room;
  let hash = FNV_OFFSET_BASIS;
  do {
    hash ^= value & 0xffn;
    hash = (hash * FNV_PRIME) & TAG_MASK;
    value >>= 8n;
  } while (value !== 0n);
  return hash;
}

export function roomKey(q, r) {
  return worldRoomIndexFor(q, r);
}

export function roomTagFor(q, r) {
  // The tag is deliberately decorative, never an exact room identifier.  FNV
  // consumes every byte so arbitrarily high BigInt bits still affect it.
  const hash = decorativeHashForRoomIndex(worldRoomIndexFor(q, r));
  return 'h-' + hash.toString(36).padStart(13, '0');
}

export function exactWorldRoomAddressFor(q, r) {
  return createWorldRoomAddress({ q, r });
}

export function axialDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = dq + dr;
  const absolute = value => value < 0n ? -value : value;
  return (absolute(dq) + absolute(dr) + absolute(ds)) / 2n;
}

export function neighborFor(room, direction) {
  const offset = WALL_DIRECTIONS[direction];
  if (!offset) throw new RangeError('wall direction must be between 0 and 5.');
  const [dq, dr] = offset;
  return { q: room.q + dq, r: room.r + dr };
}

export function isAddressableHex(q, r) {
  try {
    worldRoomIndexFor(q, r);
    return true;
  } catch {
    return false;
  }
}

// w1 has no boundary: every axial neighbour is a complete world room.
export function catalogueCoordinates(center) {
  const result = [{ q: center.q, r: center.r }];
  for (let direction = 0; direction < WALL_DIRECTIONS.length; direction++) {
    result.push(neighborFor(center, direction));
  }
  return result;
}
