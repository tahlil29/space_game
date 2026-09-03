import { settings } from "./settings.js";

let ctx;
let master;
let started = false;
let timer;

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = settings.music ? 0.14 : 0;
  master.connect(ctx.destination);
}

export function resumeAudio() {
  initAudio();
  if (ctx?.state === "suspended") ctx.resume();
}

export function setMusicEnabled(on) {
  initAudio();
  if (master) master.gain.value = on ? 0.14 : 0;
  if (on) {
    resumeAudio();
    startLoop();
  } else {
    stopLoop();
  }
}

function startLoop() {
  if (!ctx || !settings.music || timer) return;
  playChord();
  timer = setInterval(playChord, 4200);
}

function stopLoop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function playChord() {
  if (!ctx || !master || !settings.music) return;
  const t = ctx.currentTime;
  [110, 165, 220].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.08 - i * 0.015, t + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 3.8);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 4);
  });
}

export function playShoot() {
  if (!settings.music) return;
  resumeAudio();
  initAudio();
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.06);
  gain.gain.setValueAtTime(0.04, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t);
  osc.stop(t + 0.08);
}

export function playExplosion() {
  if (!settings.music) return;
  resumeAudio();
  initAudio();
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const bufferSize = ctx.sampleRate * 0.12;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buffer;
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  src.connect(gain);
  gain.connect(master);
  src.start(t);
}
