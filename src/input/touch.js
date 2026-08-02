/**
 * Touch controls.
 *
 * Pointer lock does not exist on phones, so the chamber is driven by a virtual
 * stick on the left half of the screen and a look-drag on the right. A tap on
 * the right half that does not turn into a drag reads the aimed volume.
 *
 * Listeners are attached to the canvas only, so the reader and catalogue
 * panels keep their normal touch behaviour.
 */

import { player } from '../player.js';

const STICK_RADIUS = 56;
const TAP_MOVEMENT = 12;
// What makes a tap a tap here is that the finger did not travel; the time limit
// only separates a deliberate tap from a finger left resting on the screen.
// 500ms matches the usual platform long-press threshold, and no other gesture
// competes for it, so being generous costs nothing.
const TAP_DURATION = 500;

export const isTouchDevice = matchMedia('(hover: none) and (pointer: coarse)').matches;

const axes = { forward: 0, strafe: 0 };
let lookDeltaX = 0;
let lookDeltaY = 0;

let movePointer = null;
let lookPointer = null;
let stick = null;
let knob = null;
let onTap = null;

export function touchAxes() {
  return axes;
}

/** Look deltas accumulate between frames and are cleared once consumed. */
export function consumeTouchLook() {
  const delta = { x: lookDeltaX, y: lookDeltaY };
  lookDeltaX = 0;
  lookDeltaY = 0;
  return delta;
}

function showStick(x, y) {
  stick.style.left = x + 'px';
  stick.style.top = y + 'px';
  stick.classList.add('visible');
  knob.style.transform = 'translate(-50%, -50%)';
}

function hideStick() {
  stick.classList.remove('visible');
  axes.forward = 0;
  axes.strafe = 0;
}

function updateStick(pointer, x, y) {
  const dx = x - pointer.originX;
  const dy = y - pointer.originY;
  const distance = Math.hypot(dx, dy);
  const clamped = Math.min(distance, STICK_RADIUS);
  const angle = Math.atan2(dy, dx);
  const knobX = Math.cos(angle) * clamped;
  const knobY = Math.sin(angle) * clamped;
  knob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
  axes.strafe = knobX / STICK_RADIUS;
  axes.forward = -knobY / STICK_RADIUS;
}

export function setupTouchControls(canvas, { onReadTap }) {
  if (!isTouchDevice) return;
  onTap = onReadTap;

  stick = document.createElement('div');
  stick.id = 'touch-stick';
  knob = document.createElement('div');
  knob.id = 'touch-knob';
  stick.appendChild(knob);
  document.body.appendChild(stick);

  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || !player.touchMode) return;
    canvas.setPointerCapture(event.pointerId);
    if (event.clientX < innerWidth / 2) {
      if (movePointer) return;
      movePointer = { id: event.pointerId, originX: event.clientX, originY: event.clientY };
      showStick(event.clientX, event.clientY);
    } else {
      if (lookPointer) return;
      lookPointer = {
        id: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: performance.now(),
      };
    }
  });

  canvas.addEventListener('pointermove', event => {
    if (movePointer?.id === event.pointerId) {
      updateStick(movePointer, event.clientX, event.clientY);
      return;
    }
    if (lookPointer?.id === event.pointerId) {
      lookDeltaX += event.clientX - lookPointer.lastX;
      lookDeltaY += event.clientY - lookPointer.lastY;
      lookPointer.lastX = event.clientX;
      lookPointer.lastY = event.clientY;
    }
  });

  const endPointer = event => {
    if (movePointer?.id === event.pointerId) {
      movePointer = null;
      hideStick();
      return;
    }
    if (lookPointer?.id !== event.pointerId) return;
    const travelled = Math.hypot(event.clientX - lookPointer.startX, event.clientY - lookPointer.startY);
    const elapsed = performance.now() - lookPointer.startedAt;
    lookPointer = null;
    if (travelled <= TAP_MOVEMENT && elapsed <= TAP_DURATION) onTap?.();
  };

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
}

export function resetTouchControls() {
  movePointer = null;
  lookPointer = null;
  lookDeltaX = 0;
  lookDeltaY = 0;
  if (stick) hideStick();
}
