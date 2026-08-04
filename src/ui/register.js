/**
 * The register: the walker's numbering set against the world's own names.
 *
 * This is the one place chamber 1 can be turned back into h-2o0obdq5191b3 and
 * into the exact record w2;0 — and back again, because a row is also the way
 * to return to the chamber it names. See world/register.js for why the two
 * naming schemes exist side by side.
 */

import { isRegisterSaved, registerEntries } from '../world/register.js';
import { moveToWorldHex, world } from '../world/rooms.js';
import {
  registerBody,
  registerCount,
  registerPanel,
  registerNote,
} from './dom.js';
import { copyExactRecord, showNotice } from './hud.js';
import { scaleLine } from './scale.js';

let callbacks = { open: () => {}, close: () => {} };
export function setRegisterCallbacks(next) {
  callbacks = next;
}

export function isRegisterOpen() {
  return registerPanel.classList.contains('visible');
}

// A very long walk would otherwise put thousands of rows into the document at
// once. The rest are still numbered and still saved; only the listing stops.
const LISTED = 200;

function rowFor(entry, isCurrent) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'register-row' + (isCurrent ? ' current' : '');
  row.dataset.fullAddress = entry.address;
  row.innerHTML = '';

  const ordinal = document.createElement('span');
  ordinal.className = 'register-ordinal';
  ordinal.textContent = String(entry.ordinal);
  const tag = document.createElement('span');
  tag.className = 'register-tag';
  tag.textContent = entry.tag;
  const address = document.createElement('span');
  address.className = 'register-address';
  address.textContent = entry.address;
  row.append(ordinal, tag, address);

  row.addEventListener('click', event => {
    // A modifier takes the record instead of the walk, so the exact address is
    // still reachable for every chamber and not only the current one.
    if (event.shiftKey || event.altKey) {
      copyExactRecord(row, 'record copied');
      return;
    }
    if (isCurrent) {
      closeRegister();
      return;
    }
    moveToWorldHex(entry.room.q, entry.room.r, entry.room.level);
    closeRegister();
    showNotice('chamber ' + entry.ordinal);
  });
  return row;
}

function renderRegister() {
  const entries = registerEntries();
  // Not "47 of 47". The world has no total — it is unbounded — so the only
  // honest measure is how far a walker would have to go before the books
  // started again, and that number is too long to print. Its length is not.
  registerCount.textContent = scaleLine(entries.length);
  registerBody.replaceChildren();
  for (const entry of entries.slice(0, LISTED)) {
    registerBody.append(rowFor(entry, entry.ordinal === world.ordinal));
  }
  const notes = [];
  if (entries.length > LISTED) notes.push('the most recent ' + LISTED + ' are listed.');
  if (!isRegisterSaved()) notes.push('this notebook cannot be saved in this browser and will be lost on reload.');
  registerNote.textContent = notes.join(' ');
  registerNote.hidden = notes.length === 0;
}

export function openRegister() {
  renderRegister();
  registerPanel.classList.add('visible');
  callbacks.open();
}

export function closeRegister() {
  registerPanel.classList.remove('visible');
  callbacks.close();
}

export function toggleRegister() {
  if (isRegisterOpen()) closeRegister();
  else openRegister();
}
