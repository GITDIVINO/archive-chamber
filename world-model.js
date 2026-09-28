import {
  createWorldRoomAddress,
  freeWallsForLevel,
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

export function roomKey(q, r, level = 0n) {
  return worldRoomIndexFor(q, r, level);
}

export function roomTagFor(q, r, level = 0n) {
  // The tag is deliberately decorative, never an exact room identifier.  FNV
  // consumes every byte so arbitrarily high BigInt bits still affect it.
  const hash = decorativeHashForRoomIndex(worldRoomIndexFor(q, r, level));
  return 'h-' + hash.toString(36).padStart(13, '0');
}

export function exactWorldRoomAddressFor(q, r, level = 0n) {
  return createWorldRoomAddress({ q, r, level });
}

export function axialDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = dq + dr;
  const absolute = value => value < 0n ? -value : value;
  return (absolute(dq) + absolute(dr) + absolute(ds)) / 2n;
}

/** The room through a given wall.  Neighbours are always on the same level. */
export function neighborFor(room, direction) {
  const offset = WALL_DIRECTIONS[direction];
  if (!offset) throw new RangeError('wall direction must be between 0 and 5.');
  const [dq, dr] = offset;
  return { q: room.q + dq, r: room.r + dr, level: room.level ?? 0n };
}

/** The room directly above or below, which is what a stair connects. */
export function roomAtLevel(room, delta) {
  return { q: room.q, r: room.r, level: (room.level ?? 0n) + BigInt(delta) };
}

export function isAddressableHex(q, r, level = 0n) {
  try {
    worldRoomIndexFor(q, r, level);
    return true;
  } catch {
    return false;
  }
}

// The world has no boundary: every axial neighbour on every level is a complete room.
export function catalogueCoordinates(center) {
  const level = center.level ?? 0n;
  const result = [{ q: center.q, r: center.r, level }];
  for (let direction = 0; direction < WALL_DIRECTIONS.length; direction++) {
    result.push(neighborFor(center, direction));
  }
  return result;
}

/** Which of a room's neighbours can actually be walked to from this level. */
export function walkableDirections(level) {
  return freeWallsForLevel(level);
}
