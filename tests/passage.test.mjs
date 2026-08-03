import assert from 'node:assert/strict';
import { freeWallsForLevel } from '../world-engine.js';
import { WALL_DIRECTIONS } from '../world-model.js';
import {
  arrivalWallFor,
  passageChambers,
  passageExits,
  passageIdFor,
  passageKey,
  reachableChambers,
} from '../src/world/passage.js';

const at = (q, r, level = 0n) => ({ q: BigInt(q), r: BigInt(r), level: BigInt(level) });
const key = hex => `${hex.q},${hex.r},${hex.level}`;

// --- the example this was designed from -------------------------------------
// Leaving the origin by wall 2: ahead is the neighbour at dir 2, and the exits
// left and right are the chambers at dir 1 and dir 3 — the two that flank it.
const exits = passageExits(at(0, 0), 2);
assert.deepEqual([exits.ahead.q, exits.ahead.r], [-1n, 1n], 'ahead is the neighbour through wall 2');
assert.deepEqual([exits.left.q, exits.left.r], [0n, 1n], 'left is the chamber at dir 1');
assert.deepEqual([exits.right.q, exits.right.r], [-1n, 0n], 'right is the chamber at dir 3');
assert.deepEqual([exits.back.q, exits.back.r], [0n, 0n], 'back is where the walker came from');

// --- the flanking chambers are the ones adjacent to both ends ----------------
// This is what makes a passage a property of the edge: entering from either end
// finds the same four chambers.
for (let wall = 0; wall < 6; wall++) {
  const near = at(3, -2);
  const far = passageExits(near, wall).ahead;
  const fromNear = passageChambers(near, wall).map(key).sort();
  const fromFar = passageChambers(far, (wall + 3) % 6).map(key).sort();
  assert.deepEqual(fromFar, fromNear, `wall ${wall}: both ends see the same passage`);

  // and those flanks really are common neighbours of the two ends
  const neighboursOf = hex => new Set(WALL_DIRECTIONS.map(([dq, dr]) => key({
    q: hex.q + dq, r: hex.r + dr, level: hex.level,
  })));
  const nearNeighbours = neighboursOf(near);
  const farNeighbours = neighboursOf(far);
  for (const flank of [passageExits(near, wall).left, passageExits(near, wall).right]) {
    assert.ok(nearNeighbours.has(key(flank)) && farNeighbours.has(key(flank)),
      `wall ${wall}: a flank is adjacent to both ends`);
  }
}

// --- both ends name one passage ---------------------------------------------
for (let wall = 0; wall < 6; wall++) {
  const near = at(-4, 7);
  const far = passageExits(near, wall).ahead;
  assert.equal(
    passageKey(passageIdFor(near, wall)),
    passageKey(passageIdFor(far, (wall + 3) % 6)),
    `wall ${wall}: one passage, whichever end names it`,
  );
}
// Distinct edges are distinct passages.
const seen = new Set();
for (const wall of freeWallsForLevel(0n)) seen.add(passageKey(passageIdFor(at(0, 0), wall)));
assert.equal(seen.size, 2, 'a chamber stands between two different passages');

// --- two passages reach all six neighbours -----------------------------------
// The point of the whole arrangement. Two free walls, six neighbours.
for (let level = 0; level <= 2; level++) {
  const home = at(0, 0, level);
  const reached = new Set(reachableChambers(home, BigInt(level)).map(key));
  assert.equal(reached.size, 6, `level ${level}: six chambers, no repeats`);
  for (const [dq, dr] of WALL_DIRECTIONS) {
    assert.ok(reached.has(key(at(dq, dr, level))), `level ${level}: neighbour ${dq},${dr} is reachable`);
  }
}

// --- the relation is mutual --------------------------------------------------
// A walker cannot retrace a side exit, but every chamber reached can be
// returned from by some route of one step. Without this the world would have
// one-way doors.
for (let q = -4; q <= 4; q++) {
  for (let r = -4; r <= 4; r++) {
    const home = at(q, r);
    for (const there of reachableChambers(home, 0n)) {
      const back = new Set(reachableChambers(there, 0n).map(key));
      assert.ok(back.has(key(home)), `${q},${r} -> ${there.q},${there.r} must be mutual`);
    }
  }
}

// --- the plane is connected --------------------------------------------------
const RANGE = 7;
const visited = new Set([key(at(0, 0))]);
let frontier = [at(0, 0)];
for (let step = 0; step < 40 && frontier.length; step++) {
  const next = [];
  for (const hex of frontier) {
    for (const there of reachableChambers(hex, 0n)) {
      if (there.q < -RANGE || there.q > RANGE || there.r < -RANGE || there.r > RANGE) continue;
      if (visited.has(key(there))) continue;
      visited.add(key(there));
      next.push(there);
    }
  }
  frontier = next;
}
assert.equal(visited.size, (2 * RANGE + 1) ** 2, 'every chamber in the plane is reachable on foot');

// --- arriving in a flanking chamber -----------------------------------------
// It has no wall facing the passage, so a walker emerges from one of its own
// doorways. Which one is fixed, and it is always a free wall of that level.
for (let level = 0; level <= 2; level++) {
  const free = freeWallsForLevel(BigInt(level));
  const home = at(0, 0, level);
  for (const there of reachableChambers(home, BigInt(level))) {
    const wall = arrivalWallFor(there, home, BigInt(level));
    assert.ok(free.includes(wall), `level ${level}: a walker emerges from a doorway, not a bookcase`);
    assert.equal(wall, arrivalWallFor(there, home, BigInt(level)), 'the choice is deterministic');
  }
}

// --- a passage costs a chamber no wall ---------------------------------------
// Two doorways is the whole budget, and it is what keeps 640 volumes. Reaching
// six neighbours must not have quietly needed a third.
for (let level = 0; level <= 2; level++) {
  assert.equal(freeWallsForLevel(BigInt(level)).length, 2, 'still two free walls');
}

console.log('passage: side exits reach all six neighbours, mutually, across a connected plane');
