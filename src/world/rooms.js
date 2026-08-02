/**
 * Which chamber currently exists in the scene.
 *
 * w1 is unbounded, but only the player's own hex is ever built: entering a new
 * room disposes the previous one.  This is a renderer limit, not a model one.
 */

import { WALL_DIRECTIONS, catalogueCoordinates, exactWorldRoomAddressFor, roomKey, roomTagFor } from '../../world-model.js';
import { camera, renderedWorld } from '../core/view.js';
import { player } from '../player.js';
import { crossedDoorway, hasClearedDoorway, oppositeWall } from './doors.js';
import { axialMapOffset } from './geometry.js';
import { disposeRoom, makeRoom } from './room.js';

const roomRegistry = new Map();

export const world = {
  room: { q: 0n, r: 0n },
  tag: '',
  address: '',
  mapCells: [],
};

let roomChangeListener = null;
export function onRoomChange(listener) {
  roomChangeListener = listener;
}

function refreshRoomRecord() {
  world.tag = roomTagFor(world.room.q, world.room.r);
  world.address = exactWorldRoomAddressFor(world.room.q, world.room.r);
  world.mapCells = catalogueCoordinates(world.room).map(cell => ({
    ...cell,
    tag: roomTagFor(cell.q, cell.r),
  }));
}

function refreshScene() {
  const activeKey = roomKey(world.room.q, world.room.r);
  for (const [loadedKey, room] of [...roomRegistry]) {
    if (loadedKey !== activeKey) {
      disposeRoom(room);
      renderedWorld.remove(room);
      roomRegistry.delete(loadedKey);
    }
  }
  if (!roomRegistry.has(activeKey)) {
    const room = makeRoom(world.room.q, world.room.r, world.tag);
    roomRegistry.set(activeKey, room);
    renderedWorld.add(room);
  }
  roomRegistry.get(activeKey).position.set(0, 0, 0);
}

export function buildCurrentRoom() {
  refreshRoomRecord();
  refreshScene();
  roomChangeListener?.();
}

/** Selects a different physical chamber; catalogue lookups never call this. */
export function moveToWorldHex(q, r) {
  world.room = { q: BigInt(q), r: BigInt(r) };
  camera.position.set(0, 1.65, 0);
  player.yaw = 0;
  player.pitch = 0;
  entryWall = null;
  buildCurrentRoom();
}

// The doorway the player arrived through, held inert until they step clear of
// it so that arriving does not immediately count as leaving again.
let entryWall = null;

/**
 * Walks the player into the neighbour behind a doorway.
 *
 * Because hexes tile exactly, subtracting the centre-to-centre offset leaves
 * the player at the very same point in space, now measured from the new room's
 * centre. Position, heading and sideways offset in the threshold all carry over
 * without a jump.
 */
function stepThroughDoorway(wall) {
  const [dq, dr] = WALL_DIRECTIONS[wall];
  world.room = { q: world.room.q + dq, r: world.room.r + dr };
  const offset = axialMapOffset(dq, dr);
  camera.position.x -= offset.x;
  camera.position.z -= offset.z;
  entryWall = oppositeWall(wall);
  buildCurrentRoom();
  return world.room;
}

/**
 * Called once a frame after movement. Returns the room entered, or null.
 */
export function syncDoorways() {
  if (entryWall !== null && hasClearedDoorway(entryWall, camera.position.x, camera.position.z)) {
    entryWall = null;
  }
  const wall = crossedDoorway(camera.position.x, camera.position.z, entryWall);
  return wall === null ? null : stepThroughDoorway(wall);
}

export function currentBookMeshes() {
  return roomRegistry.get(roomKey(world.room.q, world.room.r))?.userData.bookMeshes ?? [];
}
