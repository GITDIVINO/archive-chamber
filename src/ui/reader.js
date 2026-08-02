/**
 * The reader panel.
 *
 * A volume is always identified by its catalogue book index.  When it was
 * opened from a shelf it also carries the w1 location it was found at, so the
 * panel can offer both the physical record and the catalogue record.
 */

import {
  PAGES_PER_VOLUME,
  createPageAddressForBookIndex,
  getPageForBookIndex,
  initialPageForBookIndex,
  titleForBookIndex,
} from '../../babel-v3.js';
import { createWorldPageAddress } from '../../world-engine.js';
import { MAX_PAGE_COLUMNS } from '../constants.js';
import { shortSpineTitle } from '../world/room.js';
import {
  bookAddress,
  bookPage,
  bookPanel,
  bookTitle,
  catalogueRecord,
  intro,
  locationRecord,
  nextPage,
  pageNumber,
  pageTotal,
  previousPage,
} from './dom.js';

pageTotal.textContent = String(PAGES_PER_VOLUME);

let activeVolume = null;
let currentPage = 1;
let pageRenderVersion = 0;
let onOpen = null;
let onClose = null;

export function setReaderCallbacks({ open, close }) {
  onOpen = open;
  onClose = close;
}

export function isReaderOpen() {
  return bookPanel.classList.contains('visible');
}

function columnsForReaderPage() {
  const style = getComputedStyle(bookPage);
  const fontSize = Number.parseFloat(style.fontSize) || 10;
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const usableWidth = Math.max(1, bookPage.clientWidth - padding);
  return Math.min(MAX_PAGE_COLUMNS, Math.max(24, Math.floor(usableWidth / (fontSize * 0.6))));
}

// Line breaks are presentation only; they are never part of the page text.
function formatPage(text) {
  const columns = columnsForReaderPage();
  const lines = Array.from(
    { length: Math.ceil(text.length / columns) },
    (_, index) => text.slice(index * columns, index * columns + columns),
  );
  return lines.join('\n');
}

function readerAddressLabel(kind, address) {
  if (address.length <= 180) return address;
  return kind + ' record · ' + address.length + ' characters';
}

function syncReaderAddress(page) {
  const catalogueAddress = createPageAddressForBookIndex(activeVolume.bookIndex, page);
  let primaryAddress;
  let primaryKind;
  if (activeVolume.worldLocation) {
    primaryAddress = createWorldPageAddress({ ...activeVolume.worldLocation, page });
    primaryKind = 'world';
    locationRecord.textContent = 'copy world record';
    catalogueRecord.hidden = false;
    catalogueRecord.textContent = 'copy catalogue record';
    catalogueRecord.dataset.fullAddress = catalogueAddress;
  } else {
    primaryAddress = catalogueAddress;
    primaryKind = 'catalogue';
    locationRecord.textContent = 'copy catalogue record';
    catalogueRecord.hidden = true;
    delete catalogueRecord.dataset.fullAddress;
  }
  bookAddress.textContent = readerAddressLabel(primaryKind, primaryAddress);
  bookAddress.title = 'exact ' + primaryKind + ' address';
  bookAddress.dataset.fullAddress = primaryAddress;
  locationRecord.dataset.fullAddress = primaryAddress;
}

function isPageAvailable(page) {
  return Number.isInteger(page) && page >= 1 && page <= PAGES_PER_VOLUME;
}

export function renderPage() {
  if (!activeVolume) return;
  const renderVersion = ++pageRenderVersion;
  const decoded = getPageForBookIndex(activeVolume.bookIndex, currentPage);
  if (renderVersion !== pageRenderVersion) return;
  pageNumber.textContent = String(currentPage).padStart(3, '0');
  bookPage.textContent = formatPage(decoded);
  syncReaderAddress(currentPage);
  previousPage.disabled = currentPage === 1;
  nextPage.disabled = !isPageAvailable(currentPage + 1);
}

export function showCatalogueVolume(bookIndex, initialPage, titleHint = null, worldLocation = null) {
  activeVolume = {
    bookIndex: BigInt(bookIndex),
    worldLocation: worldLocation ? { ...worldLocation, page: 1 } : null,
  };
  currentPage = initialPage ?? initialPageForBookIndex(activeVolume.bookIndex);
  bookPanel.classList.add('visible');
  intro.classList.add('gone');
  onOpen?.();
  bookTitle.textContent = titleHint || shortSpineTitle(titleForBookIndex(activeVolume.bookIndex));
  renderPage();
}

export function closeBook() {
  bookPanel.classList.remove('visible');
  onClose?.();
}

export function turnPage(delta) {
  const target = currentPage + delta;
  if (!isPageAvailable(target)) return;
  currentPage = target;
  renderPage();
}
