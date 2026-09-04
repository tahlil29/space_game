import { settings } from "./settings.js";

let ctx;
let master;
let timer;
let profile = {
  id: "classic",
  freqs: [110, 165, 220],
  interval: 4200,
  wave: "sine",
  volume: 0.14,
};

const PROFILES = {
  classic: {
    id: "classic",
    freqs: [110, 165, 220],
    interval: 4200,
    wave: "sine",
    volume: 0.14,
  },
  endless: {
    id: "endless",
    freqs: [98, 147, 196, 294],
    interval: 3200,
    wave: "triangle",
    volume: 0.12,
  },
  boss: {
    id: "boss",
    freqs: [82, 123, 164],
    interval: 2800,
    wave: "sawtooth",
    volume: 0.11,
  },
};

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = settings.music ? profile.volume : 0;
  master.connect(ctx.destination);
}

export function resumeAudio() {
  initAudio();
  if (ctx?.state === "suspended") ctx.resume();
}

export function setMusicProfile(modeId) {
  profile = PROFILES[modeId] || PROFILES.classic;
  if (master && settings.music) {
    master.gain.value = profile.volume;
  }
  if (settings.music) {
    stopLoop();
    startLoop();
  }
}

export function setMusicEnabled(on) {
  initAudio();
  if (master) master.gain.value = on ? profile.volume : 0;
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
  timer = setInterval(playChord, profile.interval);
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
  profile.freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = profile.wave;
    osc.frequency.value = freq;
    const peak = Math.max(0.02, 0.07 - i * 0.012);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, t + profile.interval / 1000 - 0.2);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + profile.interval / 1000);
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
  const startF = profile.id === "boss" ? 720 : profile.id === "endless" ? 980 : 880;
  osc.type = profile.id === "boss" ? "sawtooth" : "square";
  osc.frequency.setValueAtTime(startF, t);
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
  gain.gain.setValueAtTime(profile.id === "boss" ? 0.16 : 0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  src.connect(gain);
  gain.connect(master);
  src.start(t);
}
