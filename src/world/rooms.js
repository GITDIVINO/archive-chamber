/**
 * Which chamber currently exists in the scene.
 *
 * w2 is unbounded in the plane and in height, but only the player's own hex is
 * ever built: entering a new room disposes the previous one. This is a renderer
 * limit, not a model one.
 */

import { WALL_DIRECTIONS, catalogueCoordinates, exactWorldRoomAddressFor, roomKey, roomTagFor } from '../../world-model.js';
import { camera, renderedWorld } from '../core/view.js';
import { player } from '../player.js';
import { crossedDoorway, hasClearedDoorway, oppositeWall } from './doors.js';
import { axialMapOffset } from './geometry.js';
import { disposeRoom, makeRoom } from './room.js';
import { buildVista } from './vista.js';

const roomRegistry = new Map();

export const world = {
  room: { q: 0n, r: 0n, level: 0n },
  tag: '',
  address: '',
  mapCells: [],
};

let roomChangeListener = null;
export function onRoomChange(listener) {
  roomChangeListener = listener;
}

function refreshRoomRecord() {
  const { q, r, level } = world.room;
  world.tag = roomTagFor(q, r, level);
  world.address = exactWorldRoomAddressFor(q, r, level);
  world.mapCells = catalogueCoordinates(world.room).map(cell => ({
    ...cell,
    tag: roomTagFor(cell.q, cell.r, cell.level),
  }));
}

function refreshScene() {
  const { q, r, level } = world.room;
  const activeKey = roomKey(q, r, level);
  for (const [loadedKey, room] of [...roomRegistry]) {
    if (loadedKey !== activeKey) {
      disposeRoom(room);
      renderedWorld.remove(room);
      roomRegistry.delete(loadedKey);
    }
  }
  if (!roomRegistry.has(activeKey)) {
    const room = makeRoom(q, r, level, world.tag);
    roomRegistry.set(activeKey, room);
    renderedWorld.add(room);
  }
  roomRegistry.get(activeKey).position.set(0, 0, 0);
}

// What shows through the doorways depends only on the level, because every
// chamber on a level is identical and the player always stands at the origin of
// their own. So it is rebuilt when the player changes floor and left alone
// while they walk: crossing a threshold must not disturb it, or the corridor
// would visibly restart instead of continuing.
let vista = null;
let vistaLevel = null;

function refreshVista() {
  const level = world.room.level;
  if (vista && vistaLevel === level) return;
  if (vista) {
    renderedWorld.remove(vista);
    for (const mesh of vista.children) mesh.geometry.dispose();
  }
  vista = buildVista(level);
  vistaLevel = level;
  renderedWorld.add(vista);
}

export function buildCurrentRoom() {
  refreshRoomRecord();
  refreshScene();
  refreshVista();
  roomChangeListener?.();
}

/** Selects a different chamber outright; catalogue lookups never call this. */
export function moveToWorldHex(q, r, level = 0n) {
  world.room = { q: BigInt(q), r: BigInt(r), level: BigInt(level) };
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
  world.room = { q: world.room.q + dq, r: world.room.r + dr, level: world.room.level };
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
  const { x, z } = camera.position;
  const level = world.room.level;
  if (entryWall !== null && hasClearedDoorway(entryWall, x, z)) {
    entryWall = null;
  }
  const wall = crossedDoorway(x, z, level, entryWall);
  return wall === null ? null : stepThroughDoorway(wall);
}

export function currentBookMeshes() {
  const { q, r, level } = world.room;
  return roomRegistry.get(roomKey(q, r, level))?.userData.bookMeshes ?? [];
}
