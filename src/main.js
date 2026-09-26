/**
 * Wiring.
 *
 * Every other module owns one concern and exports primitives; this file is the
 * only place that knows which key opens which panel and what happens on each
 * frame.  Keeping the bindings here is what stops input, world and interface
 * from importing one another in a circle.
 */

import { camera, render, renderer, resizeView } from './core/view.js';
import {
  PLAYER_START_PITCH,
  PLAYER_START_X,
  PLAYER_START_YAW,
  PLAYER_START_Z,
} from './constants.js';
import { isEngaged, keys, player } from './player.js';
import { startAudio, toggleAudio } from './audio.js';
import {
  buildCurrentRoom,
  onRoomChange,
  paintRoomLabels,
  syncDoorways,
  syncPassageDestinations,
  syncPlace,
  syncStair,
  world,
} from './world/rooms.js';
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
  closeRegisterButton,
  intro,
  registerButton,
  registerPanel,
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
import { copyExactRecord, setChamberLabel, setPlaceLabel, setStartupState, showNotice } from './ui/hud.js';
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
import {
  closeRegister,
  isRegisterOpen,
  setRegisterCallbacks,
  toggleRegister,
} from './ui/register.js';

// Opening a panel hands control back to the cursor; closing it returns to the
// chamber. On touch that means suspending the virtual stick instead.
const suspendChamber = () => {
  releasePointerLock();
  leaveChamber();
};
const resumeChamber = () => (isTouchDevice ? enterChamber() : requestPointerLock());

setReaderCallbacks({ open: suspendChamber, close: resumeChamber });
setCatalogueCallbacks({ open: suspendChamber, close: resumeChamber });
setRegisterCallbacks({ open: suspendChamber, close: resumeChamber });

onRoomChange(() => {
  setChamberLabel(world.ordinal, world.tag, world.address);
  syncPlace();
  setPlaceLabel(world.placeLabel);
  // The old room's volumes are gone; drop any aim held over from it.
  clearTarget();
  invalidateMap();
});

// Turning aside in a passage cannot be retraced: the flanking chamber has no
// wall facing the passage, so the walker comes out of one of its own doorways,
// and behind that is a different corridor. They can always get back, but not
// the way they came, and nothing else in the game would ever tell them.
function noticeForArrival() {
  return world.arrivedIndirectly
    ? 'chamber ' + world.ordinal + ' · the way back is not the way you came'
    : 'chamber ' + world.ordinal;
}

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
  intro.classList.toggle('gone', player.locked || bookPanel.classList.contains('visible') || searchPanel.classList.contains('visible') || registerPanel.classList.contains('visible'));
  reticle.style.display = player.locked ? 'block' : 'none';
  if (!player.locked) clearTarget();
  if (player.locked) startAudio();
});

document.addEventListener('pointerlockerror', () => {
  player.locked = false;
  reticle.style.display = 'none';
  if (!bookPanel.classList.contains('visible') && !searchPanel.classList.contains('visible') && !registerPanel.classList.contains('visible')) intro.classList.remove('gone');
});

document.addEventListener('mousemove', event => {
  if (!player.locked) return;
  applyLook(event.movementX, event.movementY);
});

addEventListener('keydown', event => {
  if (event.code === 'Escape' && isRegisterOpen()) {
    closeRegister();
    return;
  }
  if (event.code === 'Escape' && isCatalogueOpen()) {
    closeSearch();
    return;
  }
  if (event.code === 'KeyE' && player.locked) openBook();
  if (event.code === 'KeyF' && player.locked) openSearch();
  if (event.code === 'KeyR' && (player.locked || isRegisterOpen())) toggleRegister();
  if (event.code === 'KeyM') toggleAudio();
  keys[event.code] = true;
});
addEventListener('keyup', event => { keys[event.code] = false; });

// --- interface ---------------------------------------------------------------

function clearPointerFocus(event) {
  if (event.detail > 0) event.currentTarget.blur();
}

searchButton.addEventListener('click', openSearch);
registerButton.addEventListener('click', toggleRegister);
closeRegisterButton.addEventListener('click', closeRegister);
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
      else if (isRegisterOpen()) closeRegister();
    }
  }

  if (isEngaged() && player.ready) {
    const keyboard = keyboardAxes();
    const touch = isTouchDevice ? touchAxes() : null;
    const forward = keyboard.forward || pad?.forward || touch?.forward || 0;
    const strafe = keyboard.strafe || pad?.strafe || touch?.strafe || 0;
    movePlayer(delta, forward, strafe, keyboard.running || Boolean(pad?.running));
    // Reaching the head or the foot of the flight is a change of floor, and it
    // is the only one there is: no doorway leads up or down. The walker keeps
    // where they stand and only the storey under them changes.
    const climbed = syncStair();
    if (climbed) showNotice('chamber ' + world.ordinal);
    // Stepping over a threshold swaps the room under the player without
    // moving them: the neighbour is built and the old one released.
    const entered = syncDoorways();
    if (entered) showNotice(noticeForArrival());
    // Walking into or out of a passage is not a change of chamber, but it is a
    // change of place, and the status line has to say so.
    if (syncPlace()) setPlaceLabel(world.placeLabel);
    // Stick look is an angular velocity, so the frame time is the scale.
    if (pad) applyLook(pad.lookX, pad.lookY, delta);
    if (isTouchDevice) {
      const look = consumeTouchLook();
      applyLook(look.x, look.y, player.lookSensitivity * 1.6);
    }
  }
  // Destination preparation is independent of input and panels. Keeping it
  // outside the engaged branch lets the loading/intro frame and idle moments
  // prepare every neighbouring room before a corridor can be entered.
  syncPassageDestinations();
  // The room the walker just entered still owes its spine lettering. A slice a
  // frame keeps it off the frame that built the room, where it would show.
  paintRoomLabels(3);
  refreshTargetedVolume();
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  syncMap();
  render();
}

// --- boot --------------------------------------------------------------------

// A deterministic, input-free camera for visual regression and architectural
// review. It is opt-in through the URL and never changes ordinary play.
const previewParameters = new URLSearchParams(location.search);
const previewMode = previewParameters.has('preview');
function previewNumber(name, fallback) {
  const raw = previewParameters.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function initializeLibrary() {
  startButton.disabled = true;
  setStartupState('building chamber…');
  try {
    buildCurrentRoom();
    camera.position.set(
      previewMode ? previewNumber('x', PLAYER_START_X) : PLAYER_START_X,
      previewMode ? previewNumber('y', 1.65) : 1.65,
      previewMode ? previewNumber('z', PLAYER_START_Z) : PLAYER_START_Z,
    );
    if (previewMode) {
      player.yaw = previewNumber('yaw', PLAYER_START_YAW);
      player.pitch = previewNumber('pitch', PLAYER_START_PITCH);
      player.touchMode = true;
      intro.classList.add('gone');
      reticle.style.display = 'block';
    } else {
      player.yaw = PLAYER_START_YAW;
      player.pitch = PLAYER_START_PITCH;
    }
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
