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

/** The short h-tag is decorative; the copyable value is the exact w1 address. */
export function setChamberLabel(tag, address) {
  cellElement.textContent = 'chamber ' + tag;
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
