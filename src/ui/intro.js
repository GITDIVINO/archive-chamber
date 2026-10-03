/**
 * The first page of the notebook found on the floor of the first chamber
 * (docs/IDEAS.md, variant 2), set on the start screen exactly as a page of a
 * book is set in the reader: the catalogue's 29 signs as one unbroken run of
 * text, cut into lines of equal width wherever the width falls, mid-word
 * included, in the reader's typewriter face, flush left.
 */

import { MAX_PAGE_COLUMNS } from '../constants.js';

export const NOTEBOOK_ENTRY = 'i came here looking for one sentence. i found it, or a book that taught me '
  + 'to wait for it. the library is larger than the universe. it holds words for everything that can be '
  + 'asked. i left the address, but not my name. if you find this page, do not believe me at once. '
  + 'first check who else has read it.';

const entryElement = document.querySelector('#notebook-entry');

// The same measure as the reader's page: a Courier New letter is 0.6 em wide.
function columns() {
  const style = getComputedStyle(entryElement);
  const fontSize = Number.parseFloat(style.fontSize) || 10;
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const usableWidth = Math.max(1, entryElement.clientWidth - padding);
  return Math.min(MAX_PAGE_COLUMNS, Math.max(24, Math.floor(usableWidth / (fontSize * 0.6))));
}

export function paintNotebookEntry() {
  if (!entryElement) return;
  const width = columns();
  const lines = [];
  for (let start = 0; start < NOTEBOOK_ENTRY.length; start += width) lines.push(NOTEBOOK_ENTRY.slice(start, start + width));
  entryElement.textContent = lines.join('\n');
}
