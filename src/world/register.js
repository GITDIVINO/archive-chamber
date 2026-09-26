/**
 * The walker's own numbering of chambers.
 *
 * A chamber's name in the world is h-2o0obdq5191b3. That is a hash, and it is
 * the right thing to paint on a ceiling — every chamber has one, no two agree,
 * and none of them means anything. It is the wrong thing to ask a person to
 * hold in their head, or to say out loud, or to recognise on returning.
 *
 * So a walker numbers them instead, in the order they first walk in. The
 * chamber they woke in is 1. The numbering is theirs alone and would mean
 * nothing to anybody else, which is the honest position: an infinite library
 * has no numbering of its own, and any a reader makes is a private mark in a
 * private notebook.
 *
 * Nothing here is an address. The exact record is untouched and is still what
 * gets copied and shared; the register is only where the two are set side by
 * side, so that "chamber 7" can be turned back into a place in the world.
 */

import { WORLD_ALGORITHM_VERSION } from '../../world-engine.js';
import { exactWorldRoomAddressFor, roomKey, roomTagFor } from '../../world-model.js';

// Deliberately still the project's old name. This key is what a walker's
// notebook is saved under, and renaming it would not migrate their walk — it
// would silently hide it and start them at chamber 1 again. The name of the
// game is not the name of the thing it stores, and only one of them is allowed
// to change without asking.
const STORE_KEY = 'archive-chamber.register.' + WORLD_ALGORITHM_VERSION;

// Ordinal by room key, and the rooms in the order they were first entered, so
// that a room's ordinal is its position in the walk plus one.
const ordinals = new Map();
const walk = [];

// Storage is a convenience, never a requirement: private windows, file:// and a
// full quota all throw, and a walker who cannot save should still be able to
// count. Failures are recorded once so the register can say so rather than
// pretending the notebook is being kept.
let storageBroken = false;

function storage() {
  if (storageBroken) return null;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    storageBroken = true;
    return null;
  }
}

function restore() {
  const store = storage();
  if (!store) return;
  let saved;
  try {
    saved = JSON.parse(store.getItem(STORE_KEY) ?? '[]');
  } catch {
    return;
  }
  if (!Array.isArray(saved)) return;
  for (const entry of saved) {
    if (!Array.isArray(entry) || entry.length !== 3) continue;
    try {
      remember({ q: BigInt(entry[0]), r: BigInt(entry[1]), level: BigInt(entry[2]) }, false);
    } catch {
      // A malformed row is dropped rather than taking the whole notebook with it.
    }
  }
}

// Writing the whole notebook costs a pass over it, and entering a chamber is
// already the most expensive moment in the game, so the write waits until the
// walker has stopped crossing thresholds.
let pendingWrite = 0;
function scheduleWrite() {
  const store = storage();
  if (!store) return;
  clearTimeout(pendingWrite);
  pendingWrite = setTimeout(() => {
    try {
      store.setItem(STORE_KEY, JSON.stringify(
        walk.map(room => [String(room.q), String(room.r), String(room.level)]),
      ));
    } catch {
      // Out of quota, most likely after a very long walk. The numbering carries
      // on for this session; only its survival is lost.
      storageBroken = true;
    }
  }, 900);
}

function remember(room, persist) {
  const key = roomKey(room.q, room.r, room.level);
  const known = ordinals.get(key);
  if (known !== undefined) return known;
  walk.push({ q: room.q, r: room.r, level: room.level });
  const ordinal = walk.length;
  ordinals.set(key, ordinal);
  if (persist) scheduleWrite();
  return ordinal;
}

/** The walker's number for a chamber, assigning one if this is the first visit. */
export function noteChamber(room) {
  return remember(room, true);
}

/** The number already given to a chamber, or null if it has never been entered. */
export function ordinalFor(room) {
  return ordinals.get(roomKey(room.q, room.r, room.level)) ?? null;
}

/**
 * The whole notebook, newest first — which is the order a walker wants it in,
 * because the chamber they are looking for is usually one they left recently.
 */
export function registerEntries() {
  const entries = [];
  for (let index = walk.length - 1; index >= 0; index--) {
    const { q, r, level } = walk[index];
    entries.push({
      ordinal: index + 1,
      room: { q, r, level },
      tag: roomTagFor(q, r, level),
      address: exactWorldRoomAddressFor(q, r, level),
    });
  }
  return entries;
}

export function registerSize() {
  return walk.length;
}

export function isRegisterSaved() {
  return !storageBroken && Boolean(storage());
}

restore();
