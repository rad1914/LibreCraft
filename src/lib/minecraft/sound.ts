// Minimal procedural block-break sound via WebAudio. No asset files —
// sounds are synthesized at runtime. Different block types get
// slightly different timbres (pitch + noise color) so breaking stone
// sounds different from breaking wood, etc.
//
// Usage: call playBreak(BlockType.STONE) from the engine's doBreak().
// The AudioContext is created lazily on first use (must be triggered
// by a user gesture, which the "Tap to Play" button satisfies).

import { BlockType } from "./blocks";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
  }
  // Resume if suspended (autoplay policies can leave it suspended).
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Per-block sound profile: base frequency, duration, noise color mix.
interface BreakProfile {
  freq: number;       // Hz of the tonal component
  dur: number;        // seconds
  noise: number;      // 0..1 — how much white noise to mix in
  decay: number;      // envelope decay rate
  type: OscillatorType;
}

const PROFILES: Partial<Record<number, BreakProfile>> = {
  [BlockType.GRASS]: { freq: 180, dur: 0.18, noise: 0.7, decay: 6, type: "sine" },
  [BlockType.DIRT]:  { freq: 150, dur: 0.20, noise: 0.75, decay: 6, type: "sine" },
  [BlockType.STONE]: { freq: 110, dur: 0.22, noise: 0.55, decay: 8, type: "square" },
  [BlockType.COBBLE]:{ freq: 105, dur: 0.24, noise: 0.6, decay: 8, type: "square" },
  [BlockType.SAND]:  { freq: 220, dur: 0.18, noise: 0.85, decay: 7, type: "sine" },
  [BlockType.WOOD]:  { freq: 260, dur: 0.20, noise: 0.35, decay: 9, type: "triangle" },
  [BlockType.PLANKS]:{ freq: 280, dur: 0.18, noise: 0.30, decay: 9, type: "triangle" },
  [BlockType.LEAVES]:{ freq: 320, dur: 0.16, noise: 0.6, decay: 10, type: "sine" },
  [BlockType.BRICK]: { freq: 140, dur: 0.22, noise: 0.5, decay: 8, type: "square" },
  [BlockType.GLASS]: { freq: 900, dur: 0.30, noise: 0.4, decay: 4, type: "sine" },
  [BlockType.SNOW]:  { freq: 350, dur: 0.16, noise: 0.5, decay: 10, type: "sine" },
  [BlockType.BEDROCK]: { freq: 80, dur: 0.28, noise: 0.65, decay: 7, type: "square" },
  [BlockType.WATER]: { freq: 200, dur: 0.20, noise: 0.7, decay: 6, type: "sine" },
};

const DEFAULT_PROFILE: BreakProfile = { freq: 160, dur: 0.20, noise: 0.6, decay: 7, type: "sine" };

// Brief noise burst buffer (cached) — used as the noise source.
let noiseBuffer: AudioBuffer | null = null;
function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === c.sampleRate) return noiseBuffer;
  const len = Math.floor(c.sampleRate * 0.3);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

export function playBreak(blockId: number) {
  const c = getCtx();
  if (!c) return;
  const profile = PROFILES[blockId] ?? DEFAULT_PROFILE;
  const now = c.currentTime;

  // Tonal component: short oscillator with fast exponential decay.
  const osc = c.createOscillator();
  osc.type = profile.type;
  osc.frequency.setValueAtTime(profile.freq, now);
  osc.frequency.exponentialRampToValueAtTime(profile.freq * 0.5, now + profile.dur);
  const oscGain = c.createGain();
  oscGain.gain.setValueAtTime(0.0001, now);
  oscGain.gain.exponentialRampToValueAtTime(0.25, now + 0.005);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + profile.dur);
  osc.connect(oscGain).connect(c.destination);
  osc.start(now);
  osc.stop(now + profile.dur + 0.02);

  // Noise component: short burst through a low-pass filter for a
  // "thump" rather than full-band hiss.
  if (profile.noise > 0) {
    const noise = c.createBufferSource();
    noise.buffer = getNoiseBuffer(c);
    const noiseGain = c.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.18 * profile.noise, now + 0.005);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + profile.dur * 0.8);
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(profile.freq * 4, now);
    noise.connect(filter).connect(noiseGain).connect(c.destination);
    noise.start(now);
    noise.stop(now + profile.dur);
  }
}

// Light "click" for placing a block — higher, shorter, less noise.
export function playPlace(blockId: number) {
  const c = getCtx();
  if (!c) return;
  const profile = PROFILES[blockId] ?? DEFAULT_PROFILE;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = profile.type;
  osc.frequency.setValueAtTime(profile.freq * 1.6, now);
  osc.frequency.exponentialRampToValueAtTime(profile.freq * 0.9, now + 0.12);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.18, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.16);
}

// A subtle UI click for inventory / crafting interactions.
export function playUiClick() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(660, now + 0.05);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.08, now + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.08);
}

// Minimal footstep sound — short low thump. Called when the player
// takes a step while walking on the ground.
export function playStep() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const noise = c.createBufferSource();
  noise.buffer = getNoiseBuffer(c);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.06, now + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(300, now);
  noise.connect(filter).connect(g).connect(c.destination);
  noise.start(now);
  noise.stop(now + 0.1);
}

// Minimal "tick" sound during breaking — short click that plays
// periodically while the player is mining a block. Pitch rises with
// progress so you hear the block getting closer to breaking.
export function playBreakTick(progress: number) {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "square";
  const freq = 200 + progress * 400;
  osc.frequency.setValueAtTime(freq, now);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.04, now + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

// Player hurt sound — sharp descending tone.
export function playHurt() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(110, now + 0.2);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.3);
}

// Eating sound — two quick ascending chirps.
export function playEat() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  for (let i = 0; i < 2; i++) {
    const t = now + i * 0.1;
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(300 + i * 100, t);
    osc.frequency.exponentialRampToValueAtTime(500 + i * 100, t + 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

// --- Background music (file-based) ---
// Background music: plays audio files from /public/music/ in sequence.
// If no files are found, the game runs silently. startMusic() loads
// the track list on first call and cycles through them.

let musicAudio: HTMLAudioElement | null = null;
let musicTracks: string[] | null = null;
let musicIndex = 0;

const MUSIC_FILES = [
  "/music/track1.mp3",
  "/music/track2.mp3",
  "/music/track3.mp3",
];

export function startMusic() {
  if (musicAudio) return; // already playing
  if (musicTracks === null) {
    musicTracks = MUSIC_FILES;
    musicIndex = 0;
  }
  playCurrentTrack();
}

function playCurrentTrack() {
  if (!musicTracks || musicTracks.length === 0) return;
  const src = musicTracks[musicIndex];
  musicAudio = new Audio(src);
  musicAudio.volume = 0.3;
  musicAudio.loop = false;
  musicAudio.addEventListener("ended", () => {
    musicIndex = (musicIndex + 1) % musicTracks.length;
    musicAudio = null;
    playCurrentTrack();
  });
  musicAudio.addEventListener("error", () => {
    // File not found — skip to next track
    musicIndex = (musicIndex + 1) % musicTracks.length;
    musicAudio = null;
    // Only retry if we haven't cycled through all tracks
    playCurrentTrack();
  });
  musicAudio.play().catch(() => {
    // Autoplay blocked — will retry on next user interaction
    musicAudio = null;
  });
}

export function stopMusic() {
  if (musicAudio) {
    musicAudio.pause();
    musicAudio = null;
  }
}
