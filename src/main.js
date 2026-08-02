/**
 * Wiring.
 *
 * Every other module owns one concern and exports primitives; this file is the
 * only place that knows which key opens which panel and what happens on each
 * frame.  Keeping the bindings here is what stops input, world and interface
 * from importing one another in a circle.
 */

import { camera, render, renderer, resizeView } from './core/view.js';
import { isEngaged, keys, player } from './player.js';
import { startAudio, toggleAudio } from './audio.js';
import { buildCurrentRoom, onRoomChange, world } from './world/rooms.js';
import {
  applyLook,
  clearTarget,
  keyboardAxes,
  movePlayer,
  refreshTargetedVolume,
  releasePointerLock,
  requestPointerLock,
  targetedOrAimedVolume,
} from './input/controls.js';
import { pollGamepad } from './input/gamepad.js';
import { consumeTouchLook, isTouchDevice, resetTouchControls, setupTouchControls, touchAxes } from './input/touch.js';
import {
  addressInput,
  addressSubmit,
  bookPanel,
  catalogueRecord,
  closeBookButton,
  closeSearchButton,
  cellElement,
  intro,
  locationRecord,
  nextPage,
  previousPage,
  reticle,
  searchButton,
  searchInput,
  searchPanel,
  searchSubmit,
  startButton,
} from './ui/dom.js';
import { copyExactRecord, setChamberLabel, setStartupState, showNotice } from './ui/hud.js';
import { invalidateMap, resizeMapCanvas, syncMap } from './ui/map.js';
import { closeBook, isReaderOpen, renderPage, setReaderCallbacks, showCatalogueVolume, turnPage } from './ui/reader.js';
import {
  closeSearch,
  isCatalogueOpen,
  openExactAddress,
  openSearch,
  runSearch,
  setCatalogueCallbacks,
} from './ui/catalogue.js';

// Opening a panel hands control back to the cursor; closing it returns to the
// chamber. On touch that means suspending the virtual stick instead.
const suspendChamber = () => {
  releasePointerLock();
  leaveChamber();
};
const resumeChamber = () => (isTouchDevice ? enterChamber() : requestPointerLock());

setReaderCallbacks({ open: suspendChamber, close: resumeChamber });
setCatalogueCallbacks({ open: suspendChamber, close: resumeChamber });

onRoomChange(() => {
  setChamberLabel(world.tag, world.address);
  // The old room's volumes are gone; drop any aim held over from it.
  clearTarget();
  invalidateMap();
});

function openBook() {
  const hit = targetedOrAimedVolume();
  if (!hit) {
    showNotice('aim at a book');
    return;
  }
  showCatalogueVolume(hit.bookIndex, undefined, hit.volumeTitle, hit.worldLocation);
}

// --- input -------------------------------------------------------------------

// Touch devices have no pointer lock, so entering the chamber is a mode switch
// rather than a capture request.
function enterChamber() {
  if (isTouchDevice) {
    player.touchMode = true;
    intro.classList.add('gone');
    reticle.style.display = 'block';
    startAudio();
    return;
  }
  requestPointerLock();
}

function leaveChamber() {
  if (!isTouchDevice) return;
  player.touchMode = false;
  resetTouchControls();
  reticle.style.display = 'none';
  clearTarget();
}

startButton.addEventListener('click', enterChamber);

setupTouchControls(renderer.domElement, { onReadTap: () => openBook() });

document.addEventListener('pointerlockchange', () => {
  player.locked = document.pointerLockElement === renderer.domElement;
  intro.classList.toggle('gone', player.locked || bookPanel.classList.contains('visible') || searchPanel.classList.contains('visible'));
  reticle.style.display = player.locked ? 'block' : 'none';
  if (!player.locked) clearTarget();
  if (player.locked) startAudio();
});

document.addEventListener('pointerlockerror', () => {
  player.locked = false;
  reticle.style.display = 'none';
  if (!bookPanel.classList.contains('visible') && !searchPanel.classList.contains('visible')) intro.classList.remove('gone');
});

document.addEventListener('mousemove', event => {
  if (!player.locked) return;
  applyLook(event.movementX, event.movementY);
});

addEventListener('keydown', event => {
  if (event.code === 'Escape' && isCatalogueOpen()) {
    closeSearch();
    return;
  }
  if (event.code === 'KeyE' && player.locked) openBook();
  if (event.code === 'KeyF' && player.locked) openSearch();
  if (event.code === 'KeyM') toggleAudio();
  keys[event.code] = true;
});
addEventListener('keyup', event => { keys[event.code] = false; });

// --- interface ---------------------------------------------------------------

function clearPointerFocus(event) {
  if (event.detail > 0) event.currentTarget.blur();
}

searchButton.addEventListener('click', openSearch);
closeSearchButton.addEventListener('click', closeSearch);
searchSubmit.addEventListener('click', runSearch);
searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') runSearch(); });
addressSubmit.addEventListener('click', openExactAddress);
addressInput.addEventListener('keydown', event => { if (event.key === 'Enter') openExactAddress(); });
closeBookButton.addEventListener('click', closeBook);

for (const element of [locationRecord, catalogueRecord]) {
  element.addEventListener('click', () => copyExactRecord(element, 'record copied'));
  element.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      copyExactRecord(element, 'record copied');
    }
  });
}

cellElement.addEventListener('click', event => {
  copyExactRecord(cellElement, 'room copied');
  clearPointerFocus(event);
});

previousPage.addEventListener('click', event => {
  turnPage(-1);
  clearPointerFocus(event);
});
nextPage.addEventListener('click', event => {
  turnPage(1);
  clearPointerFocus(event);
});

addEventListener('resize', () => {
  resizeView();
  resizeMapCanvas();
  if (bookPanel.classList.contains('visible')) renderPage();
  invalidateMap();
});

// --- frame loop --------------------------------------------------------------

let lastFrame = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const delta = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  const pad = pollGamepad();
  if (pad) {
    if (pad.read && isEngaged()) openBook();
    if (pad.catalogue && isEngaged()) openSearch();
    if (pad.back) {
      if (isReaderOpen()) closeBook();
      else if (isCatalogueOpen()) closeSearch();
    }
  }

  if (isEngaged() && player.ready) {
    const keyboard = keyboardAxes();
    const touch = isTouchDevice ? touchAxes() : null;
    const forward = keyboard.forward || pad?.forward || touch?.forward || 0;
    const strafe = keyboard.strafe || pad?.strafe || touch?.strafe || 0;
    movePlayer(delta, forward, strafe, keyboard.running || Boolean(pad?.running));
    // Stick look is an angular velocity, so the frame time is the scale.
    if (pad) applyLook(pad.lookX, pad.lookY, delta);
    if (isTouchDevice) {
      const look = consumeTouchLook();
      applyLook(look.x, look.y, player.lookSensitivity * 1.6);
    }
  }
  refreshTargetedVolume();
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  syncMap();
  render();
}

// --- boot --------------------------------------------------------------------

function initializeLibrary() {
  startButton.disabled = true;
  setStartupState('building chamber…');
  try {
    buildCurrentRoom();
    camera.position.set(0, 1.65, 5.2);
    resizeMapCanvas();
    player.ready = true;
    startButton.disabled = false;
    setStartupState('ready');
  } catch (error) {
    console.error(error);
    setStartupState('library unavailable', true);
    showNotice('library unavailable');
  }
}

initializeLibrary();
requestAnimationFrame(animate);
