/**
 * The catalogue panel: fragment search and exact address entry.
 *
 * Search and v3 addresses open a catalogue record and deliberately leave the
 * player where they are. Only an explicit world address, or a row of the register, selects another physical
 * chamber.
 */

import { ALPHABET, bookIndexFor, parsePageAddress, search } from '../../babel-v3.js';
import {
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

/**
 * What a walker typed, in the only alphabet the library has.
 *
 * The library holds 29 signs and a single case. Anything else does not exist
 * here, so it cannot be typed at all — and it is not translated into a nearest
 * equivalent on the way out, because there is no such thing: a question mark is
 * not a period, a dash is not a space, and an accented letter is not its bare
 * one. Whatever the alphabet has nothing to say for simply never lands.
 *
 * Case is the one thing folded rather than dropped. A capital is not another
 * sign, it is the same letter written larger, and the library has only the one
 * way of writing it — dropping those would turn a pasted sentence into holes.
 *
 * The dropping happens in place, in the field, as the text arrives, so that
 * what is on screen is exactly the fragment that will be looked for.
 */
function toLibraryAlphabet(raw) {
  let kept = '';
  for (const character of raw.toLowerCase()) {
    if (ALPHABET.includes(character)) kept += character;
  }
  return kept;
}

/**
 * Rewrites the field to what the library can hold, keeping the caret where the
 * walker left it.
 *
 * Every step of the conversion is per-character, so the text before the caret
 * converts on its own exactly as it does in place — which makes its converted
 * length the caret's new home. Without this, pasting into the middle of a
 * fragment threw the cursor to the end.
 */
function adaptSearchField() {
  const raw = searchInput.value;
  const adapted = toLibraryAlphabet(raw);
  if (adapted === raw) return { changed: false, adapted };
  const caret = searchInput.selectionStart ?? raw.length;
  const caretAfter = toLibraryAlphabet(raw.slice(0, caret)).length;
  searchInput.value = adapted;
  searchInput.setSelectionRange(caretAfter, caretAfter);
  return { changed: true, adapted };
}

searchInput.addEventListener('input', () => {
  const hadText = searchInput.value.length > 0;
  const { changed, adapted } = adaptSearchField();
  if (!changed) return;
  searchResult.textContent = adapted.length === 0 && hadText
    ? 'none of that text exists in the library alphabet'
    : 'the library has 29 signs and one case; the rest cannot be typed';
});

export function openSearch() {
  onOpen?.();
  intro.classList.add('gone');
  searchPanel.classList.add('visible');
  searchResult.textContent = '29 signs, one case: anything else cannot be typed here';
  setTimeout(() => searchInput.focus(), 0);
}

export function closeSearch() {
  searchPanel.classList.remove('visible');
  onClose?.();
}

export async function runSearch() {
  // Belt and braces: the field converts as it is typed into, but a fragment can
  // also arrive without an input event ever firing.
  const query = adaptSearchField().adapted;
  if (!query) {
    searchResult.textContent = 'enter a fragment to search';
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
    searchResult.textContent = 'enter a full v3 or world page address';
    return;
  }
  if (candidate.length > MAX_CLIENT_ADDRESS_LENGTH) {
    searchResult.textContent = 'record is too long for this client';
    return;
  }
  const candidateParts = candidate.split(';');
  const isWorldRecord = candidateParts[0] === WORLD_ALGORITHM_VERSION;
  // An exact world remains mathematically unbounded, but building thousands of
  // catalogue placements from a multi-kilobyte room index can monopolise the
  // browser. 1024 hexadecimal digits already name vastly more rooms than a
  // person could traverse; longer records are still valid in the model, just
  // deliberately not rendered by this client.
  if (isWorldRecord && candidateParts[1]?.length > 1024) {
    searchResult.textContent = 'world record is too long for this client';
    return;
  }
  try {
    if (isWorldRecord) {
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
    searchResult.textContent = 'enter a valid full v3 or world page address';
  }
}
