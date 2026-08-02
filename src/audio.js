/** A single low drone, started only after the player enters the chamber. */

import { soundElement } from './ui/dom.js';

let context = null;
let gain = null;
let enabled = false;

export function startAudio() {
  if (context) return;
  context = new AudioContext();
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = 48;
  filter.type = 'lowpass';
  filter.frequency.value = 150;
  gain.gain.value = 0.025;
  oscillator.connect(filter).connect(gain).connect(context.destination);
  oscillator.start();
  enabled = true;
  soundElement.textContent = 'sound: ambient';
}

export function toggleAudio() {
  if (!context) return;
  enabled = !enabled;
  gain.gain.setTargetAtTime(enabled ? 0.025 : 0, context.currentTime, 0.03);
  soundElement.textContent = enabled ? 'sound: ambient' : 'sound: muted';
}
