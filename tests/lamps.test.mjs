/**
 * Which lamps burn must not depend on where a storey is seen from: the
 * walker's own chamber and the same storey in the shaft above or below have to
 * agree, or a climb switches lamps on and off as it crosses a floor.
 */

import assert from 'node:assert/strict';
import { LAMP_SHARE, lampIsLit, storeyResidue } from '../src/world/lamps.js';

const samples = [];
for (let index = 0; index < 400; index++) {
  samples.push({ x: ((index * 37) % 101) * 0.37 - 18, y: ((index * 13) % 29) * 0.5, z: ((index * 61) % 97) * 0.41 - 20 });
}

for (const kind of Object.keys(LAMP_SHARE)) {
  for (const level of [-7n, -1n, 0n, 1n, 2n, 5n, 300n]) {
    for (const position of samples) {
      assert.equal(
        lampIsLit(kind, position, level),
        lampIsLit(kind, position, level + 3n),
        `${kind} lamps follow the three-level cycle the shaft is cached by`,
      );
      assert.equal(
        lampIsLit(kind, position, level),
        lampIsLit(kind, { ...position }, Number(level)),
        'a level given as a number or a BigInt is the same storey',
      );
    }
  }
  const share = samples.filter(position => lampIsLit(kind, position, 0n)).length / samples.length;
  if (LAMP_SHARE[kind] >= 1) assert.equal(share, 1, `every ${kind} lamp burns`);
  else assert.ok(Math.abs(share - LAMP_SHARE[kind]) < 0.12, `about ${LAMP_SHARE[kind]} of ${kind} lamps burn, got ${share}`);
}
assert.deepEqual([-4n, -3n, -1n, 0n, 1n, 2n, 3n, 4n].map(storeyResidue), [2, 0, 2, 0, 1, 2, 0, 1]);

console.log('lamps: the same lamps burn on a storey from every view of it');
