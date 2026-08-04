/**
 * Which chamber currently exists in the scene.
 *
 * w2 is unbounded in the plane and in height, but only the player's own hex is
 * ever built: entering a new room disposes the previous one. This is a renderer
 * limit, not a model one.
 */

import { catalogueCoordinates, exactWorldRoomAddressFor, roomKey, roomTagFor } from '../../world-model.js';
import { APOTHEM, CHAMBER_STEP } from '../constants.js';
import { camera, renderedWorld } from '../core/view.js';
import { player } from '../player.js';
import { crossedPassageExit } from './doors.js';
import { wallBasis } from './geometry.js';
import { arrivalWallFor, passageExits } from './passage.js';
import { noteChamber, ordinalFor } from './register.js';
import { disposeRoom, makeRoom } from './room.js';
import { buildVista } from './vista.js';

const roomRegistry = new Map();

export const world = {
  room: { q: 0n, r: 0n, level: 0n },
  tag: '',
  // The walker's own number for this chamber. The tag above is the world's
  // name for it and is not one a person can carry; see world/register.js.
  ordinal: 1,
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
  world.ordinal = noteChamber(world.room);
  world.address = exactWorldRoomAddressFor(q, r, level);
  // Neighbours carry the number only if the walker has been in them. A chamber
  // nobody has entered has no number, because nobody has given it one.
  world.mapCells = catalogueCoordinates(world.room).map(cell => ({
    ...cell,
    tag: roomTagFor(cell.q, cell.r, cell.level),
    ordinal: ordinalFor(cell),
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
  buildCurrentRoom();
}

// Three's yaw convention: at yaw 0 the camera looks down -z, so forward is
// (-sin yaw, -cos yaw). Inverting that gives the heading for a direction.
function yawFacing(dx, dz) {
  return Math.atan2(-dx, -dz);
}

/**
 * Leaves a passage by its far end.
 *
 * The corridor is drawn straight, so the chamber ahead stands exactly
 * CHAMBER_STEP away along the wall normal. Subtracting that leaves the player
 * at the very same point in space, now measured from the new chamber's centre:
 * position, heading and sideways offset in the threshold all carry over with no
 * jump, and the corridor behind them does not move.
 */
function stepAhead(wall) {
  const there = passageExits(world.room, wall).ahead;
  const basis = wallBasis(wall);
  camera.position.x -= basis.nx * CHAMBER_STEP;
  camera.position.z -= basis.nz * CHAMBER_STEP;
  world.room = there;
  buildCurrentRoom();
  return world.room;
}

// A walker who arrives this far in stands inside the chamber rather than in the
// mouth of its doorway, which is where the passage they turned out of would be.
const ARRIVAL_DEPTH = APOTHEM - 1.7;

/**
 * Leaves a passage by one of its side openings.
 *
 * This cannot be continuous, and is not meant to be: the flanking chamber has
 * no wall facing the passage, because a passage is not in the plane at all. The
 * walker emerges from one of that chamber's own doorways — see arrivalWallFor —
 * so the pose is rebuilt rather than carried over. Their heading relative to
 * the way they were walking is preserved, so turning left still leaves them
 * walking the way a left turn points.
 */
function stepAside(wall, exit) {
  const from = world.room;
  const there = passageExits(from, wall)[exit];
  const arrival = arrivalWallFor(there, from, from.level);
  const exitBasis = wallBasis(wall);
  const arrivalBasis = wallBasis(arrival);

  const side = exit === 'right' ? 1 : -1;
  player.yaw += yawFacing(-arrivalBasis.nx, -arrivalBasis.nz)
    - yawFacing(side * exitBasis.tx, side * exitBasis.tz);

  camera.position.x = arrivalBasis.nx * ARRIVAL_DEPTH;
  camera.position.z = arrivalBasis.nz * ARRIVAL_DEPTH;
  world.room = there;
  buildCurrentRoom();
  return world.room;
}

/**
 * Called once a frame after movement. Returns the chamber entered, or null.
 *
 * Walking back out of the near end of a passage is not a transition: that end
 * belongs to the chamber the player is already in.
 */
export function syncDoorways() {
  const crossing = crossedPassageExit(camera.position, world.room.level);
  if (!crossing) return null;
  return crossing.exit === 'ahead'
    ? stepAhead(crossing.wall)
    : stepAside(crossing.wall, crossing.exit);
}

export function currentBookMeshes() {
  const { q, r, level } = world.room;
  return roomRegistry.get(roomKey(q, r, level))?.userData.bookMeshes ?? [];
}
