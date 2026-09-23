/**
 * Lightweight synthesized sound effects — native Web Audio API, zero assets,
 * zero dependencies. Every sound is generated on the fly (short filtered
 * noise bursts / oscillator blips), which keeps the bundle tiny and the
 * tactile feedback instant.
 *
 * Autoplay-safe: the AudioContext is created lazily on the first play or
 * toggle, and every trigger in the room is a user gesture (opening a
 * dossier, dropping a pin, filing an accusation, the header toggles).
 * The mute preference persists in localStorage.
 *
 * Effects:
 *  - "paper"   : warm brown-noise swish + sliding-friction "shh" + granular crinkles — opening an evidence dossier
 *  - "thud"    : low knock — dropping a corkboard pin
 *  - "bell"    : metallic ding — stage solved / case victory
 *  - "buzzer"  : dull square-wave throb — accusation rejected
 *  - "stamp"   : heavy double knock — filing an accusation
 *  - "pluck"   : damped string twang — connecting or cutting a yarn link
 * Ambient: optional looping rain (header toggle), a filtered noise bed.
 */

export type SfxName = "paper" | "thud" | "bell" | "buzzer" | "stamp" | "pluck";

const MUTE_KEY = "cca-sfx-muted";
const RAIN_KEY = "cca-rain";

const store =
  typeof localStorage !== "undefined"
    ? {
        get: (k: string) => {
          try {
            return localStorage.getItem(k);
          } catch {
            return null;
          }
        },
        set: (k: string, v: string | null) => {
          try {
            if (v === null) localStorage.removeItem(k);
            else localStorage.setItem(k, v);
          } catch {
            /* private mode etc. — prefs just won't persist */
          }
        },
      }
    : { get: () => null, set: () => {} };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let rainGain: GainNode | null = null;
let rainSrc: AudioBufferSourceNode | null = null;
let brownBuf: AudioBuffer | null = null;

let muted = store.get(MUTE_KEY) === "1";
let rainOn = store.get(RAIN_KEY) === "1";

function supported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return Boolean(w.AudioContext ?? w.webkitAudioContext);
}

/** Create the context + master gain on first use; resumes after a gesture. */
function ensure(): AudioContext | null {
  if (!supported()) return null;
  if (!ctx) {
    const w = window as unknown as {
      AudioContext: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext!;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/** Shared 1s white-noise buffer for paper / stamp / rain. */
function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/**
 * Shared 1s brown-noise buffer (integrated white). Brown's energy sits
 * low, which gives the paper layers a warm cardstock body instead of
 * static hiss.
 */
function brown(c: AudioContext): AudioBuffer {
  if (!brownBuf) {
    brownBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.75;
      d[i] = last * 3.5;
    }
  }
  return brownBuf;
}

/**
 * Band-passed noise swish with an asymmetric envelope (fast ~30ms bloom,
 * long tail) — the air displacement of a page or folder opening. With
 * `slideTo`, the cutoff glides down over `slideDur` to mimic a page
 * sliding across a surface.
 */
function swish(
  c: AudioContext,
  at: number,
  freq: number,
  q: number,
  peak: number,
  decay: number,
  buf: AudioBuffer,
  slideTo?: number,
  slideDur = 0.2,
): void {
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, at);
  if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, at + slideDur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  src.connect(f);
  f.connect(g);
  g.connect(master!);
  // Random offset, but always leave the full envelope inside the buffer.
  const off = Math.random() * Math.max(0, 1 - (decay + 0.1));
  src.start(at, off, decay + 0.1);
  src.stop(at + decay + 0.1);
}

/**
 * Chaotic fiber friction: 8–15 tiny white-noise ticks (5–15ms) scattered
 * over a ~200ms window, each high-passed bright (3–6kHz) at varying gain.
 */
function crinkle(c: AudioContext, at: number): void {
  const n = 8 + Math.floor(Math.random() * 8);
  for (let i = 0; i < n; i++) {
    const t = at + Math.random() * 0.2;
    const dur = 0.005 + Math.random() * 0.01;
    const peak = 0.04 + Math.random() * 0.06;
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const f = c.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 3000 + Math.random() * 3000;
    f.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master!);
    src.start(t, Math.random() * 0.5, dur + 0.02);
    src.stop(t + dur + 0.02);
  }
}

function burst(
  c: AudioContext,
  at: number,
  dur: number,
  peak: number,
  filterType: BiquadFilterType,
  freq: number,
  q = 0.8,
): void {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master!);
  src.start(at, Math.random(), dur + 0.05);
  src.stop(at + dur + 0.05);
}

function tone(
  c: AudioContext,
  at: number,
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  peak: number,
  cutoff?: number,
): void {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  let head: AudioNode = o;
  if (cutoff) {
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    o.connect(f);
    head = f;
  }
  head.connect(g);
  g.connect(master!);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** Synthesize one effect. No-op when muted or audio is unavailable. */
export function playSfx(name: SfxName): void {
  if (muted) return;
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  switch (name) {
    case "paper":
      // Cardstock body: brown noise through a soft 420Hz band-pass,
      // asymmetric decay (quick bloom, ~280ms tail).
      swish(c, t, 420, 1.0, 0.4, 0.28, brown(c));
      // Sliding friction: cutoff glides 2.8k → 1.2k across the stroke.
      swish(c, t, 2800, 1.1, 0.22, 0.24, brown(c), 1200, 0.22);
      // Chaotic crinkles: bright 3–6kHz micro-pops.
      crinkle(c, t + 0.02);
      break;
    case "thud":
      tone(c, t, "triangle", 110, 52, 0.14, 0.7);
      burst(c, t, 0.05, 0.25, "lowpass", 300);
      break;
    case "bell":
      tone(c, t, "sine", 2637, 2637, 0.55, 0.3);
      tone(c, t + 0.005, "sine", 3951, 3951, 0.35, 0.14);
      tone(c, t + 0.01, "sine", 5233, 5233, 0.18, 0.05);
      break;
    case "buzzer":
      tone(c, t, "square", 92, 92, 0.38, 0.4, 340);
      tone(c, t + 0.42, "square", 84, 84, 0.22, 0.3, 300);
      break;
    case "stamp":
      tone(c, t, "sine", 85, 42, 0.13, 0.9);
      burst(c, t, 0.08, 0.5, "lowpass", 260);
      tone(c, t + 0.16, "sine", 70, 38, 0.1, 0.5);
      burst(c, t + 0.16, 0.06, 0.35, "lowpass", 220);
      break;
    case "pluck":
      // Broadband snap, then a fast decaying fundamental + octave.
      burst(c, t, 0.03, 0.3, "bandpass", 900, 1.2);
      tone(c, t, "sawtooth", 185, 178, 0.26, 0.22, 1100);
      tone(c, t + 0.012, "triangle", 370, 356, 0.18, 0.07, 1400);
      break;
  }
}

// ---------------------------------------------------------------------------
// Toggles
// ---------------------------------------------------------------------------

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  store.set(MUTE_KEY, m ? "1" : null);
  if (ctx && master) {
    master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);
  }
  if (m) stopRainNodes();
  else if (rainOn) setRain(true);
}

export function isRainOn(): boolean {
  return rainOn;
}

/** Start/stop the ambient rain bed (only audible while unmuted). */
export function setRain(on: boolean): void {
  rainOn = on;
  store.set(RAIN_KEY, on ? "1" : null);
  if (!on) {
    stopRainNodes();
    return;
  }
  const c = ensure();
  if (!c) return;
  if (muted) return; // will start on unmute (see setMuted)
  if (rainSrc) return; // already running
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.loop = true;
  const low = c.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 1100;
  const high = c.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 300;
  const g = c.createGain();
  g.gain.value = 0.0001;
  g.gain.setTargetAtTime(muted ? 0.0001 : 0.05, c.currentTime, 0.5);
  src.connect(low);
  low.connect(high);
  high.connect(g);
  g.connect(master!);
  src.start();
  rainSrc = src;
  rainGain = g;
}

function stopRainNodes(): void {
  if (rainGain && ctx) {
    rainGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15);
  }
  if (rainSrc) {
    const src = rainSrc;
    rainSrc = null;
    rainGain = null;
    setTimeout(() => {
      try {
        src.stop();
        src.disconnect();
      } catch {
        /* already stopped */
      }
    }, 500);
  }
}