/**
 * The catalogue panel: fragment search and exact address entry.
 *
 * Search and v3 addresses open a catalogue record and deliberately leave the
 * player where they are.  Only an explicit w2 address, or a row of the register, selects another physical
 * chamber.
 */

import { ALPHABET, bookIndexFor, parsePageAddress, search } from '../../babel-v3.js';
import {
  LEGACY_WORLD_ALGORITHM_VERSION,
  WORLD_ALGORITHM_VERSION,
  catalogBookIndexFor,
  parseWorldPageAddress,
  parseWorldRoomAddress,
} from '../../world-engine.js';
import { MAX_CLIENT_ADDRESS_LENGTH } from '../constants.js';
import { moveToWorldHex } from '../world/rooms.js';
import {
  addressInput,
  intro,
  searchInput,
  searchPanel,
  searchResult,
  searchSubmit,
} from './dom.js';
import { showNotice } from './hud.js';
import { showCatalogueVolume } from './reader.js';

let onOpen = null;
let onClose = null;

export function setCatalogueCallbacks({ open, close }) {
  onOpen = open;
  onClose = close;
}

export function isCatalogueOpen() {
  return searchPanel.classList.contains('visible');
}

export function openSearch() {
  onOpen?.();
  intro.classList.add('gone');
  searchPanel.classList.add('visible');
  searchResult.textContent = 'enter lower-case text using letters, spaces, commas, and periods';
  setTimeout(() => searchInput.focus(), 0);
}

export function closeSearch() {
  searchPanel.classList.remove('visible');
  onClose?.();
}

export async function runSearch() {
  const query = searchInput.value;
  if (!query) {
    searchResult.textContent = 'enter a fragment to search';
    return;
  }
  if ([...query].some(char => !ALPHABET.includes(char))) {
    searchResult.textContent = 'use only lower-case letters, spaces, commas, and periods';
    return;
  }
  searchSubmit.disabled = true;
  searchResult.textContent = 'locating an exact volume…';
  try {
    // Yield a frame so the pending label paints before the BigInt work starts.
    await new Promise(resolve => requestAnimationFrame(resolve));
    const pageAddress = search(query);
    const location = parsePageAddress(pageAddress);
    searchResult.textContent = 'one catalogue occurrence opened';
    showCatalogueVolume(bookIndexFor(location), location.page);
    searchPanel.classList.remove('visible');
  } catch (error) {
    searchResult.textContent = String(error.message).toLowerCase();
  } finally {
    searchSubmit.disabled = false;
  }
}

export function openExactAddress() {
  const candidate = addressInput.value.trim();
  if (!candidate) {
    searchResult.textContent = 'enter a full v3 or w2 page address';
    return;
  }
  if (candidate.length > MAX_CLIENT_ADDRESS_LENGTH) {
    searchResult.textContent = 'record is too long for this client';
    return;
  }
  try {
    if (candidate.startsWith(WORLD_ALGORITHM_VERSION + ';') || candidate.startsWith(LEGACY_WORLD_ALGORITHM_VERSION + ';')) {
      if (candidate.split(';').length === 2) {
        const worldRoom = parseWorldRoomAddress(candidate);
        moveToWorldHex(worldRoom.q, worldRoom.r, worldRoom.level);
        searchResult.textContent = 'world room opened';
        closeSearch();
        showNotice('world room opened');
        return;
      }
      const worldLocation = parseWorldPageAddress(candidate);
      const bookIndex = catalogBookIndexFor(worldLocation);
      moveToWorldHex(worldLocation.q, worldLocation.r, worldLocation.level);
      showCatalogueVolume(bookIndex, worldLocation.page, null, worldLocation);
    } else {
      const location = parsePageAddress(candidate);
      showCatalogueVolume(bookIndexFor(location), location.page);
    }
    searchResult.textContent = 'exact record opened';
    searchPanel.classList.remove('visible');
  } catch {
    searchResult.textContent = 'enter a valid full v3 or w2 page address';
  }
}
