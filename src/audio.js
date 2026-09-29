/**
 * A single low drone, and now and then a drop of water falling somewhere far
 * down the well, with the long echo of a very tall room. Started only after
 * the player enters the chamber.
 */

import { soundElement } from './ui/dom.js';

const DRONE_GAIN = 0.025;
// The drone is the room; a drop is an event. Drops go straight to the output,
// not through the drone's gain, and stop when the sound is muted.
const DROP_GAIN = 0.04;

let context = null;
let gain = null;
let echo = null;
let enabled = false;
let dropTimer = 0;

// A feedback delay is the whole echo: 0.42 s between repeats, each a third the
// strength of the last and darker, so it dies away like sound in stone.
function buildEcho() {
  const delay = context.createDelay(1);
  const feedback = context.createGain();
  const tone = context.createBiquadFilter();
  delay.delayTime.value = 0.42;
  feedback.gain.value = 0.36;
  tone.type = 'lowpass';
  tone.frequency.value = 1400;
  delay.connect(tone).connect(feedback).connect(delay);
  tone.connect(context.destination);
  return delay;
}

function playDrop() {
  if (enabled) {
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    // A drop is a sine that falls in pitch almost at once.
    const pitch = 700 + Math.random() * 500;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(pitch, start);
    oscillator.frequency.exponentialRampToValueAtTime(pitch * 0.45, start + 0.09);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(DROP_GAIN, start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
    oscillator.connect(envelope);
    envelope.connect(context.destination);
    envelope.connect(echo);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  }
  dropTimer = setTimeout(playDrop, 3500 + Math.random() * 7500);
}

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
  gain.gain.value = DRONE_GAIN;
  oscillator.connect(filter).connect(gain).connect(context.destination);
  oscillator.start();
  echo = buildEcho();
  enabled = true;
  dropTimer = setTimeout(playDrop, 2500);
  soundElement.textContent = 'sound: ambient';
}

export function toggleAudio() {
  if (!context) return;
  enabled = !enabled;
  gain.gain.setTargetAtTime(enabled ? DRONE_GAIN : 0, context.currentTime, 0.03);
  if (!enabled) clearTimeout(dropTimer);
  else dropTimer = setTimeout(playDrop, 2500);
  soundElement.textContent = enabled ? 'sound: ambient' : 'sound: muted';
}
