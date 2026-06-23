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
  g.gain.exponentialRampToValueAtTime(0.12, now + 0.003);
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

// Portal formation sound — ancient-spooky: deep descending drone with
// reverb-ish decay and a high shimmer. Plays when a portal ring completes.
export function playPortalForm() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  // Deep drone — low frequency oscillator fading out over ~1.5s.
  const drone = c.createOscillator();
  drone.type = "sawtooth";
  drone.frequency.setValueAtTime(110, now);
  drone.frequency.exponentialRampToValueAtTime(40, now + 1.2);
  const droneGain = c.createGain();
  droneGain.gain.setValueAtTime(0.0001, now);
  droneGain.gain.exponentialRampToValueAtTime(0.2, now + 0.05);
  droneGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
  const droneFilter = c.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.setValueAtTime(400, now);
  drone.connect(droneFilter).connect(droneGain).connect(c.destination);
  drone.start(now);
  drone.stop(now + 1.6);
  // High shimmer — a high sine sweep that gives an eerie ring.
  const shimmer = c.createOscillator();
  shimmer.type = "sine";
  shimmer.frequency.setValueAtTime(1200, now);
  shimmer.frequency.exponentialRampToValueAtTime(2400, now + 0.8);
  const shimmerGain = c.createGain();
  shimmerGain.gain.setValueAtTime(0.0001, now);
  shimmerGain.gain.exponentialRampToValueAtTime(0.06, now + 0.1);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
  shimmer.connect(shimmerGain).connect(c.destination);
  shimmer.start(now);
  shimmer.stop(now + 1.1);
  // Noise wash — filtered noise for an ambient "whoosh" underneath.
  const noise = c.createBufferSource();
  noise.buffer = getNoiseBuffer(c);
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.1, now + 0.1);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
  const noiseFilter = c.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.setValueAtTime(300, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(800, now + 0.8);
  noise.connect(noiseFilter).connect(noiseGain).connect(c.destination);
  noise.start(now);
  noise.stop(now + 1.3);
}

// Portal ambient sound — a brief spooky whisper that plays occasionally
// when the player is near a portal block. Quieter and shorter than the
// formation sound, so it doesn't get annoying as a repeating ambient.
export function playPortalAmbient() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  // Low rumble — short.
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(80, now);
  osc.frequency.exponentialRampToValueAtTime(50, now + 0.4);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.08, now + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.55);
  // Faint noise breath.
  const noise = c.createBufferSource();
  noise.buffer = getNoiseBuffer(c);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, now);
  ng.gain.exponentialRampToValueAtTime(0.04, now + 0.05);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  const nf = c.createBiquadFilter();
  nf.type = "bandpass";
  nf.frequency.setValueAtTime(500, now);
  noise.connect(nf).connect(ng).connect(c.destination);
  noise.start(now);
  noise.stop(now + 0.45);
}

// Ultra-rare spooky glitchy sound — plays very occasionally at night or
// while mining deep underground. A disjointed, eerie texture: detuned
// oscillators, reversed-feeling noise sweeps, and random pitch jumps
// that feel "wrong". Designed to be unsettling without being jump-scare loud.
export function playSpookyGlitch() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  // Three detuned sine drones at dissonant intervals — creates an
  // unsettling "beating" pattern.
  const freqs = [73, 77, 83]; // slightly off from harmonic ratios
  for (let i = 0; i < freqs.length; i++) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freqs[i], now);
    // Random pitch jump mid-way — the "glitch".
    osc.frequency.setValueAtTime(freqs[i] * 1.5, now + 0.3 + Math.random() * 0.4);
    osc.frequency.exponentialRampToValueAtTime(freqs[i] * 0.5, now + 1.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.04, now + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    osc.connect(g).connect(c.destination);
    osc.start(now);
    osc.stop(now + 1.7);
  }
  // Reversed-feeling noise sweep — bandpass filter sweeping downward.
  const noise = c.createBufferSource();
  noise.buffer = getNoiseBuffer(c);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, now);
  ng.gain.exponentialRampToValueAtTime(0.05, now + 0.1);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
  const nf = c.createBiquadFilter();
  nf.type = "bandpass";
  nf.frequency.setValueAtTime(2000, now);
  nf.frequency.exponentialRampToValueAtTime(150, now + 1.0);
  nf.Q.value = 8; // sharp resonance for an eerie whistle
  noise.connect(nf).connect(ng).connect(c.destination);
  noise.start(now);
  noise.stop(now + 1.3);
  // A single high "ping" that decays slowly — like a distant bell.
  const ping = c.createOscillator();
  ping.type = "sine";
  ping.frequency.setValueAtTime(1800 + Math.random() * 400, now + 0.5);
  const pg = c.createGain();
  pg.gain.setValueAtTime(0.0001, now + 0.5);
  pg.gain.exponentialRampToValueAtTime(0.03, now + 0.55);
  pg.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
  ping.connect(pg).connect(c.destination);
  ping.start(now + 0.5);
  ping.stop(now + 1.5);
}
