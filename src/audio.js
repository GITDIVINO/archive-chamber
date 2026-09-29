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

// --- whispers -------------------------------------------------------------------

// The librarians' murmur: breath through a narrow band that wanders like
// vowels, broken into syllables and phrases. Never words: the words are read,
// not heard. It is quiet, and silent while the sound is muted.
const WHISPER_GAIN = 0.07;
const voices = [];
let breath = null;

function noiseBuffer() {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  return buffer;
}

function buildVoice(buffer) {
  const source = context.createBufferSource();
  const band = context.createBiquadFilter();
  const syllable = context.createGain();
  const level = context.createGain();
  const panner = context.createStereoPanner();
  source.buffer = buffer;
  source.loop = true;
  band.type = 'bandpass';
  band.Q.value = 2.2;
  band.frequency.value = 1800;
  syllable.gain.value = 0;
  level.gain.value = 0;
  source.connect(band).connect(syllable).connect(level).connect(panner);
  panner.connect(context.destination);
  panner.connect(echo);
  source.start(context.currentTime + Math.random() * 2);
  const voice = { band, syllable, level, panner, timer: 0 };
  speak(voice);
  return voice;
}

// One phrase: a handful of syllables, each a short swell on a new vowel, then
// a breath of silence.
function speak(voice) {
  let time = context.currentTime + 0.05;
  const syllables = 4 + Math.floor(Math.random() * 9);
  for (let index = 0; index < syllables; index++) {
    const length = 0.08 + Math.random() * 0.16;
    voice.band.frequency.setValueAtTime(900 + Math.random() * 2200, time);
    voice.syllable.gain.setValueAtTime(0.0001, time);
    voice.syllable.gain.linearRampToValueAtTime(0.5 + Math.random() * 0.5, time + length * 0.3);
    voice.syllable.gain.linearRampToValueAtTime(0.0001, time + length);
    time += length + Math.random() * 0.06;
  }
  const phrase = time - context.currentTime;
  voice.timer = setTimeout(() => speak(voice), (phrase + 0.7 + Math.random() * 1.8) * 1000);
}

/**
 * Sets the murmur of the nearest librarians: `murmurs` is a list of
 * { level 0..1, pan −1..1 }, nearest first. Before the sound is started this
 * does nothing.
 */
export function setWhispers(murmurs) {
  if (!context) return;
  breath ??= noiseBuffer();
  while (voices.length < 2) voices.push(buildVoice(breath));
  const now = context.currentTime;
  voices.forEach((voice, index) => {
    const murmur = murmurs[index];
    const level = enabled && murmur ? murmur.level * WHISPER_GAIN : 0;
    voice.level.gain.setTargetAtTime(level, now, 0.25);
    if (murmur) voice.panner.pan.setTargetAtTime(murmur.pan * 0.8, now, 0.1);
  });
}
