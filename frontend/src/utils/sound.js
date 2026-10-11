// ---------------------------------------------------------------------------
// A tiny synthesized sound box. No audio files, no network requests: every
// effect is built on the fly from WebAudio oscillators and a noise buffer the
// first time it is played. This keeps the game fast to load and impossible to
// 404 on an asset. The AudioContext is created lazily and only ever unlocked
// from a real user gesture (the Start button), which browsers require.
// ---------------------------------------------------------------------------

const LS_MUTE_KEY = 'skyline-flight-sound-muted';

let audioCtx = null;
let master = null;
let muted = loadMutedFlag();

function loadMutedFlag() {
  try {
    return localStorage.getItem(LS_MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistMutedFlag() {
  try {
    localStorage.setItem(LS_MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode shrug */
  }
}

// Building the graph is a side effect of a user gesture, never of a render.
export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) {
    audioCtx = new AC();
    master = audioCtx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function setMuted(next) {
  muted = next;
  persistMutedFlag();
  if (master && audioCtx) {
    master.gain.setTargetAtTime(muted ? 0 : 0.8, audioCtx.currentTime, 0.02);
  }
}

export function isMuted() {
  return muted;
}

// A short pitched blip. `from`/`to` are frequencies in Hz and `dur` is how
// long the note rings for. Percussive: an instant attack, then exponential
// fade so nothing ever clicks.
function tone({ type = 'square', from, to, dur = 0.15, gain = 0.12, when = 0 }) {
  const ctx = unlockAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== undefined && to !== from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  }
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp);
  amp.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// A burst of filtered white noise. Great for explosions and whooshes.
// `filterFrom` -> `filterTo` sweeps the lowpass, which turns static into
// something that feels like an impact or a gust of wind.
function noise({ dur = 0.5, gain = 0.4, filterFrom = 4000, filterTo = 120, when = 0 }) {
  const ctx = unlockAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFrom, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t0 + dur);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter);
  filter.connect(amp);
  amp.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

export const sfx = {
  // Coin pickup: a cheerful two-note arpeggio. The more coins you string
  // together, the higher the starting pitch climbs, so a long coin run
  // sounds like an ascending musical scale instead of the same blip forever.
  coin(chain = 0) {
    const base = 660 * Math.pow(1.059, Math.min(chain, 10));
    tone({ from: base, to: base, dur: 0.08, gain: 0.1 });
    tone({ from: base * 1.5, to: base * 1.5, dur: 0.13, gain: 0.1, when: 0.06 });
  },

  // Round start: a short "ready-up" chirp.
  takeoff() {
    tone({ from: 420, to: 840, dur: 0.14, gain: 0.12 });
    noise({ dur: 0.22, gain: 0.08, filterFrom: 700, filterTo: 2400 });
  },

  // Passing close to an obstacle without hitting it.
  whoosh() {
    noise({ dur: 0.22, gain: 0.07, filterFrom: 500, filterTo: 2000 });
  },

  // The big one. Noise roar + a deep falling triangle thud.
  crash() {
    noise({ dur: 0.95, gain: 0.5, filterFrom: 3500, filterTo: 80 });
    tone({ type: 'triangle', from: 220, to: 38, dur: 0.85, gain: 0.32 });
  },

  // Picking up a good power-up: a bright three-note climb.
  power() {
    const notes = [523, 659, 784];
    notes.forEach((f, i) => tone({ from: f, to: f, dur: 0.1, gain: 0.1, when: i * 0.06 }));
  },

  // Touching a cursed power-down: a dirty descending buzz.
  curse() {
    tone({ from: 330, to: 220, dur: 0.22, gain: 0.13 });
    tone({ from: 262, to: 174, dur: 0.2, gain: 0.11, when: 0.1 });
    noise({ dur: 0.24, gain: 0.08, filterFrom: 2000, filterTo: 400 });
  },

  // Melancholy game-over sting: three descending notes.
  gameOver() {
    tone({ from: 523, to: 523, dur: 0.16, gain: 0.11 });
    tone({ from: 415, to: 415, dur: 0.16, gain: 0.11, when: 0.17 });
    tone({ from: 311, to: 311, dur: 0.34, gain: 0.11, when: 0.34 });
  },

  // Generic UI tick (menus, mute toggle).
  uiClick() {
    tone({ from: 880, to: 880, dur: 0.05, gain: 0.07 });
  },
};