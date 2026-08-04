/** Status line, transient notices and the copy-to-clipboard affordance. */

import { cellElement, noticeElement, startupElement } from './dom.js';

let noticeTimer = 0;

export function setStartupState(text, error = false) {
  startupElement.textContent = text;
  startupElement.classList.toggle('error', error);
}

export function showNotice(text) {
  noticeElement.textContent = text;
  noticeElement.classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => noticeElement.classList.remove('visible'), 1700);
}

/**
 * The status line carries the walker's own number, because that is the one a
 * person can hold. The world's h-tag and the exact w2 record are each one
 * gesture away — the tag in the register, the record in the clipboard.
 */
export function setChamberLabel(ordinal, tag, address) {
  cellElement.textContent = 'chamber ' + ordinal;
  cellElement.title = tag + ' — click to copy the exact record';
  cellElement.dataset.fullAddress = address;
}

export async function copyExactRecord(element, copiedText) {
  const address = element.dataset.fullAddress;
  if (!address) return;
  try {
    await navigator.clipboard.writeText(address);
  } catch {
    const area = document.createElement('textarea');
    area.value = address;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const previous = element.textContent;
  element.textContent = copiedText;
  setTimeout(() => { element.textContent = previous; }, 1400);
}
