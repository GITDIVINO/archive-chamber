/**
 * Which chamber currently exists in the scene.
 *
 * w1 is unbounded, but only the player's own hex is ever built: entering a new
 * room disposes the previous one.  This is a renderer limit, not a model one.
 */

import { catalogueCoordinates, exactWorldRoomAddressFor, roomKey, roomTagFor } from '../../world-model.js';
import { camera, renderedWorld } from '../core/view.js';
import { player } from '../player.js';
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
  buildCurrentRoom();
}

export function currentBookMeshes() {
  return roomRegistry.get(roomKey(world.room.q, world.room.r))?.userData.bookMeshes ?? [];
}
