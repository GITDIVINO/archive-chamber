/** Status line, transient notices and the copy-to-clipboard affordance. */

import { cellElement, noticeElement, startupElement, whisperElement } from './dom.js';

let noticeTimer = 0;

export function setStartupState(text, error = false) {
  startupElement.textContent = text;
  startupElement.classList.toggle('error', error);
  // Once the chamber is ready the button says so; the word stays in the
  // page for the tests but not in front of the notebook.
  startupElement.classList.toggle('ready', text === 'ready');
}

export function showNotice(text) {
  noticeElement.textContent = text;
  noticeElement.classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => noticeElement.classList.remove('visible'), 1700);
}

/**
 * A line a librarian is whispering, or null when none is near enough to make
 * one out. The line stays while it fades, so it does not vanish mid-word.
 */
export function setWhisper(text) {
  if (text && whisperElement.textContent !== text) whisperElement.textContent = text;
  whisperElement.classList.toggle('visible', Boolean(text));
}

/**
 * The status line carries the walker's own number, because that is the one a
 * person can hold. The world's h-tag and the exact world record are each one
 * gesture away — the tag in the register, the record in the clipboard.
 */
export function setChamberLabel(ordinal, tag, address) {
  cellElement.title = tag + ' — click to copy the exact record';
  cellElement.dataset.fullAddress = address;
}

/**
 * Where the walker is standing.
 *
 * In a chamber that is its number; in a passage it is the two chambers the
 * passage runs between. The record the button copies stays the chamber's
 * either way — a passage has no place in the plane, which is exactly why the
 * map leaves the walker standing at their doorway while they are in one.
 */
export function setPlaceLabel(label) {
  cellElement.textContent = label;
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
