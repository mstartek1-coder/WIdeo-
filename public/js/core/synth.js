// Syntezator dźwięku w czystym JS (bez Web Audio) – deterministyczny, działa w przeglądarce i w Node.
// Generuje realistyczne ambienty (fale, wiatr, noc, kosmos, deszcz) oraz podkład muzyczny w kilku nastrojach.
// Wynik: { sampleRate, left: Float32Array, right: Float32Array }.

import { mulberry32 } from './random.js';

export const DEFAULT_SR = 44100;
const TAU = Math.PI * 2;

// ---------------- Podstawowe bloki DSP ----------------

export class Biquad {
  constructor(type = 'lowpass', freq = 1000, q = 0.707, sr = DEFAULT_SR, gainDb = 0) {
    this.type = type;
    this.sr = sr;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(freq, q, gainDb);
  }

  set(freq, q = this.q, gainDb = this.gainDb || 0) {
    this.freq = freq;
    this.q = q;
    this.gainDb = gainDb;
    const f = Math.min(Math.max(freq, 10), this.sr * 0.45);
    const w0 = (TAU * f) / this.sr;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case 'highpass':
        b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case 'peaking': {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
        break;
      }
      case 'lowpass':
      default:
        b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// Szum różowy (filtr Paula Kelleta) – naturalniejszy niż biały dla wiatru, fal i deszczu.
export function pinkNoise(rand) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return out * 0.11;
  };
}

export function brownNoise(rand) {
  let last = 0;
  return () => {
    last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
    return last * 3.5;
  };
}

// Gładki szum wartości (dla wolnych modulacji: podmuchy wiatru, falowanie).
export function smoothNoise(rand, rateHz) {
  const points = [];
  return (t) => {
    const x = t * rateHz;
    const i = Math.floor(x);
    while (points.length <= i + 1) points.push(rand());
    const f = x - i;
    const k = (1 - Math.cos(f * Math.PI)) / 2;
    return points[i] * (1 - k) + points[i + 1] * k;
  };
}

// Pogłos Freeverb (8 filtrów grzebieniowych + 4 wszechprzepustowe na kanał).
export function freeverb(left, right, sr, { room = 0.84, damp = 0.25, wet = 0.3, dry = 1 } = {}) {
  const scale = sr / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const spread = 23;
  const make = (off) => ({
    combs: combT.map((t) => ({ buf: new Float32Array(Math.round((t + off) * scale)), i: 0, store: 0 })),
    aps: apT.map((t) => ({ buf: new Float32Array(Math.round((t + off) * scale)), i: 0 })),
  });
  const chans = [make(0), make(spread)];
  const outs = [new Float32Array(left.length), new Float32Array(right.length)];
  const damp1 = damp;
  const damp2 = 1 - damp;
  for (let n = 0; n < left.length; n++) {
    const input = (left[n] + right[n]) * 0.015;
    for (let c = 0; c < 2; c++) {
      const ch = chans[c];
      let acc = 0;
      for (const cb of ch.combs) {
        const y = cb.buf[cb.i];
        cb.store = y * damp2 + cb.store * damp1;
        cb.buf[cb.i] = input + cb.store * room;
        if (++cb.i >= cb.buf.length) cb.i = 0;
        acc += y;
      }
      for (const ap of ch.aps) {
        const b = ap.buf[ap.i];
        const y = -acc + b;
        ap.buf[ap.i] = acc + b * 0.5;
        if (++ap.i >= ap.buf.length) ap.i = 0;
        acc = y;
      }
      outs[c][n] = acc;
    }
  }
  for (let n = 0; n < left.length; n++) {
    left[n] = left[n] * dry + outs[0][n] * wet * 3;
    right[n] = right[n] * dry + outs[1][n] * wet * 3;
  }
}

export function normalize(left, right, peak = 0.89) {
  let max = 1e-9;
  for (let i = 0; i < left.length; i++) max = Math.max(max, Math.abs(left[i]), Math.abs(right[i]));
  const g = peak / max;
  for (let i = 0; i < left.length; i++) {
    left[i] *= g;
    right[i] *= g;
  }
}

export function fadeEdges(left, right, sr, fadeIn = 0.5, fadeOut = 1) {
  const nIn = Math.min(left.length, Math.round(fadeIn * sr));
  const nOut = Math.min(left.length, Math.round(fadeOut * sr));
  for (let i = 0; i < nIn; i++) {
    const g = Math.sin((i / nIn) * Math.PI * 0.5) ** 2;
    left[i] *= g;
    right[i] *= g;
  }
  for (let i = 0; i < nOut; i++) {
    const idx = left.length - 1 - i;
    const g = Math.sin((i / nOut) * Math.PI * 0.5) ** 2;
    left[idx] *= g;
    right[idx] *= g;
  }
}

function softClip(left, right, drive = 1.2) {
  const norm = Math.tanh(drive);
  for (let i = 0; i < left.length; i++) {
    left[i] = Math.tanh(left[i] * drive) / norm;
    right[i] = Math.tanh(right[i] * drive) / norm;
  }
}

function buffers(duration, sr) {
  const n = Math.max(1, Math.ceil(duration * sr));
  return { sampleRate: sr, left: new Float32Array(n), right: new Float32Array(n) };
}

// ---------------- Ambienty ----------------

function ambWaves(out, rand) {
  const { left, right, sampleRate: sr } = out;
  const n = left.length;
  const duration = n / sr;
  // Harmonogram fal: narastanie, załamanie, szum wycofującej się wody.
  const waves = [];
  for (let t = -3 + rand() * 2; t < duration + 4; t += 5.5 + rand() * 4.5) waves.push({ t, amp: 0.6 + rand() * 0.4, rise: 2 + rand() * 1.5, fall: 3.5 + rand() * 2.5 });
  const env = (t) => {
    let e = 0;
    for (const w of waves) {
      const d = t - w.t;
      if (d < -w.rise || d > w.fall * 3) continue;
      e += d < 0 ? w.amp * Math.pow(1 + d / w.rise, 2.2) : w.amp * Math.exp(-d / w.fall);
    }
    return Math.min(1.4, e);
  };
  const nl = pinkNoise(rand);
  const nr = pinkNoise(rand);
  const lpL = new Biquad('lowpass', 800, 0.6, sr);
  const lpR = new Biquad('lowpass', 800, 0.6, sr);
  const hiss = new Biquad('highpass', 3000, 0.7, sr);
  const hissNoise = pinkNoise(rand);
  const rumble = new Biquad('lowpass', 120, 0.7, sr);
  const brown = brownNoise(rand);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 63) === 0) {
      const eL = env(t);
      const eR = env(t - 0.35);
      lpL.set(250 + 2600 * eL * eL);
      lpR.set(250 + 2600 * eR * eR);
      out._eL = eL;
      out._eR = eR;
    }
    const h = hiss.process(hissNoise()) * 0.5;
    const r = rumble.process(brown()) * 0.6;
    left[i] = lpL.process(nl()) * (0.18 + 0.9 * out._eL) + h * out._eL * out._eL + r;
    right[i] = lpR.process(nr()) * (0.18 + 0.9 * out._eR) + h * out._eR * out._eR + r;
  }
}

function ambWind(out, rand, gain = 1) {
  const { left, right, sampleRate: sr } = out;
  const n = left.length;
  const gust = smoothNoise(rand, 0.18);
  const gust2 = smoothNoise(rand, 0.07);
  const tone = smoothNoise(rand, 0.25);
  const bpL = new Biquad('bandpass', 500, 0.9, sr);
  const bpR = new Biquad('bandpass', 520, 0.9, sr);
  const low = new Biquad('lowpass', 160, 0.7, sr);
  const nl = pinkNoise(rand);
  const nr = pinkNoise(rand);
  const brown = brownNoise(rand);
  let g = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 63) === 0) {
      g = 0.25 + 0.75 * Math.pow(gust(t) * 0.7 + gust2(t) * 0.3, 1.6);
      const f = 280 + 900 * tone(t) * g;
      bpL.set(f, 0.8 + g);
      bpR.set(f * 1.07, 0.8 + g);
    }
    const lowPart = low.process(brown()) * 0.8 * g;
    left[i] += (bpL.process(nl()) * 2.2 * g + lowPart) * gain;
    right[i] += (bpR.process(nr()) * 2.2 * g + lowPart) * gain;
  }
}

function ambNight(out, rand) {
  ambWind(out, rand, 0.35);
  const { left, right, sampleRate: sr } = out;
  const n = left.length;
  const duration = n / sr;
  // Świerszcze: kilka osobników, każdy z własną częstotliwością, rytmem i pozycją w panoramie.
  const crickets = Array.from({ length: 3 }, () => ({ f: 4200 + rand() * 900, pan: rand(), period: 0.7 + rand() * 0.6, phase: rand(), amp: 0.03 + rand() * 0.03 }));
  for (const c of crickets) {
    for (let start = c.phase * c.period; start < duration; start += c.period * (0.85 + rand() * 0.3)) {
      if (rand() < 0.15) continue; // naturalne przerwy
      const pulses = 3 + Math.floor(rand() * 2);
      for (let p = 0; p < pulses; p++) {
        const s0 = Math.floor((start + p * 0.045) * sr);
        const len = Math.floor(0.028 * sr);
        for (let k = 0; k < len && s0 + k < n; k++) {
          const e = Math.sin((k / len) * Math.PI);
          const v = Math.sin((TAU * c.f * k) / sr) * e * c.amp;
          left[s0 + k] += v * (1 - c.pan);
          right[s0 + k] += v * c.pan;
        }
      }
    }
  }
}

function ambSpace(out, rand) {
  const { left, right, sampleRate: sr } = out;
  const n = left.length;
  const base = 55 * (1 + (rand() - 0.5) * 0.1);
  const partials = [1, 1.5, 2, 3.01, 4.02, 6.03].map((m, i) => ({ f: base * m, amp: 0.5 / (i + 1), lfo: smoothNoise(rand, 0.05 + rand() * 0.1), pan: rand() }));
  const breath = smoothNoise(rand, 0.1);
  const lp = new Biquad('lowpass', 400, 0.8, sr);
  const noise = pinkNoise(rand);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let l = 0;
    let r = 0;
    for (const p of partials) {
      const v = Math.sin(TAU * p.f * t) * p.amp * (0.3 + 0.7 * p.lfo(t));
      l += v * (1 - p.pan);
      r += v * p.pan;
    }
    if ((i & 63) === 0) lp.set(200 + 500 * breath(t));
    const b = lp.process(noise()) * 0.8;
    left[i] = l * 0.25 + b;
    right[i] = r * 0.25 + b;
  }
  freeverb(left, right, sr, { room: 0.9, damp: 0.4, wet: 0.6 });
}

function ambRain(out, rand) {
  const { left, right, sampleRate: sr } = out;
  const n = left.length;
  const duration = n / sr;
  const hpL = new Biquad('highpass', 900, 0.7, sr);
  const hpR = new Biquad('highpass', 900, 0.7, sr);
  const lpL = new Biquad('lowpass', 7000, 0.7, sr);
  const lpR = new Biquad('lowpass', 7000, 0.7, sr);
  const nl = pinkNoise(rand);
  const nr = pinkNoise(rand);
  const intensity = smoothNoise(rand, 0.08);
  for (let i = 0; i < n; i++) {
    const g = 0.5 + 0.5 * intensity(i / sr);
    left[i] = lpL.process(hpL.process(nl())) * 0.9 * g;
    right[i] = lpR.process(hpR.process(nr())) * 0.9 * g;
  }
  // Pojedyncze krople na parapecie i kałużach.
  const drops = Math.floor(duration * 35);
  for (let d = 0; d < drops; d++) {
    const s0 = Math.floor(rand() * n);
    const f = 1800 + rand() * 4200;
    const len = Math.floor(0.012 * sr);
    const amp = 0.02 + rand() * 0.08;
    const pan = rand();
    for (let k = 0; k < len && s0 + k < n; k++) {
      const v = Math.sin((TAU * f * k) / sr * (1 - k / len * 0.3)) * Math.exp((-k / len) * 6) * amp;
      left[s0 + k] += v * (1 - pan);
      right[s0 + k] += v * pan;
    }
  }
  // Odległy grzmot co jakiś czas.
  const brown = brownNoise(rand);
  const thunderLp = new Biquad('lowpass', 110, 0.7, sr);
  for (let t = 6 + rand() * 8; t < duration - 2; t += 14 + rand() * 12) {
    const s0 = Math.floor(t * sr);
    const len = Math.floor((4 + rand() * 3) * sr);
    for (let k = 0; k < len && s0 + k < n; k++) {
      const x = k / sr;
      const e = Math.min(1, x / 0.4) * Math.exp(-x / 1.6) * (0.7 + 0.3 * Math.sin(x * 9));
      const v = thunderLp.process(brown()) * e * 2.2;
      left[s0 + k] += v;
      right[s0 + k] += v;
    }
  }
  freeverb(left, right, sr, { room: 0.7, damp: 0.5, wet: 0.2 });
}

export const AMBIENCE_GENERATORS = { waves: ambWaves, wind: ambWind, night: ambNight, space: ambSpace, rain: ambRain };

export function generateAmbience(type, duration, { seed = 1, sampleRate = DEFAULT_SR } = {}) {
  const out = buffers(duration, sampleRate);
  const gen = AMBIENCE_GENERATORS[type];
  if (!gen) return out;
  gen(out, mulberry32(seed * 7919 + type.length));
  normalize(out.left, out.right, 0.7);
  fadeEdges(out.left, out.right, sampleRate, 0.8, 0.8);
  delete out._eL;
  delete out._eR;
  return out;
}

// ---------------- Muzyka ----------------

const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

export function noteToMidi(name) {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Zła nazwa nuty: ${name}`);
  return 12 * (Number(m[2]) + 1) + NOTE[m[1]];
}

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const chord = (...names) => names.map(noteToMidi);

export const MUSIC_STYLES = {
  epic: {
    bpm: 76,
    progression: [chord('D3', 'A3', 'D4', 'F4'), chord('A#2', 'F3', 'A#3', 'D4'), chord('F2', 'C3', 'F3', 'A3'), chord('C3', 'G3', 'C4', 'E4')],
    pad: 0.9, bass: 0.7, drums: 'taiko', plucks: 0.0, arp: 0, reverb: 0.45, brightness: 1600,
  },
  calm: {
    bpm: 66,
    progression: [chord('C3', 'G3', 'B3', 'E4'), chord('A2', 'E3', 'G3', 'C4'), chord('F2', 'C3', 'E3', 'A3'), chord('G2', 'D3', 'E3', 'B3')],
    pad: 0.6, bass: 0.35, drums: null, plucks: 0.8, arp: 0, reverb: 0.6, brightness: 1100,
  },
  dark: {
    bpm: 92,
    progression: [chord('A2', 'E3', 'A3', 'C4'), chord('F2', 'C3', 'F3', 'A3'), chord('D2', 'A2', 'D3', 'F3'), chord('E2', 'B2', 'E3', 'G#3')],
    pad: 0.7, bass: 0.9, drums: 'pulse', plucks: 0, arp: 0, reverb: 0.4, brightness: 900,
  },
  uplifting: {
    bpm: 112,
    progression: [chord('C3', 'G3', 'C4', 'E4'), chord('G2', 'D3', 'G3', 'B3'), chord('A2', 'E3', 'A3', 'C4'), chord('F2', 'C3', 'F3', 'A3')],
    pad: 0.6, bass: 0.6, drums: 'pop', plucks: 0, arp: 0.5, reverb: 0.35, brightness: 2200,
  },
};

function addPad(out, notes, t0, dur, amp, brightness, rand) {
  const { left, right, sampleRate: sr } = out;
  const attack = Math.min(1.4, dur * 0.4);
  const release = 1.6;
  const s0 = Math.max(0, Math.floor(t0 * sr));
  const s1 = Math.min(left.length, Math.floor((t0 + dur + release) * sr));
  const oscs = [];
  notes.forEach((m, ni) => {
    for (const cents of [-8, 0, 7]) {
      oscs.push({ f: midiToFreq(m) * Math.pow(2, cents / 1200), ph: rand(), pan: 0.5 + (cents / 16) * 0.6 * (ni % 2 ? 1 : -1) });
    }
  });
  const lpL = new Biquad('lowpass', brightness, 0.5, sr);
  const lpR = new Biquad('lowpass', brightness, 0.5, sr);
  const scale = amp / oscs.length;
  for (let i = s0; i < s1; i++) {
    const t = i / sr - t0;
    const env = t < attack ? t / attack : t < dur ? 1 : Math.max(0, 1 - (t - dur) / release);
    let l = 0;
    let r = 0;
    for (const o of oscs) {
      o.ph += o.f / sr;
      o.ph -= Math.floor(o.ph);
      const v = 2 * o.ph - 1;
      l += v * (1 - o.pan);
      r += v * o.pan;
    }
    left[i] += lpL.process(l * scale * env);
    right[i] += lpR.process(r * scale * env);
  }
}

function addBass(out, midi, t0, dur, amp) {
  const { left, right, sampleRate: sr } = out;
  const f = midiToFreq(midi);
  const s0 = Math.max(0, Math.floor(t0 * sr));
  const s1 = Math.min(left.length, Math.floor((t0 + dur + 0.4) * sr));
  for (let i = s0; i < s1; i++) {
    const t = i / sr - t0;
    const env = Math.min(1, t / 0.05) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.4));
    const x = Math.sin(TAU * f * t);
    const v = Math.tanh(x * 1.8) * 0.7 + Math.sin(TAU * f * 0.5 * t) * 0.4;
    left[i] += v * amp * env * 0.5;
    right[i] += v * amp * env * 0.5;
  }
}

function addPluck(out, midi, t0, amp, pan, decay = 2.5) {
  const { left, right, sampleRate: sr } = out;
  const f = midiToFreq(midi);
  const len = Math.floor(decay * 1.6 * sr);
  const s0 = Math.floor(t0 * sr);
  for (let k = 0; k < len && s0 + k < left.length; k++) {
    if (s0 + k < 0) continue;
    const t = k / sr;
    const env = Math.min(1, t / 0.004) * Math.exp(-t * (3 / decay));
    const v = (Math.sin(TAU * f * t) + 0.45 * Math.sin(TAU * 2 * f * t) * Math.exp(-t * 3) + 0.2 * Math.sin(TAU * 3 * f * t) * Math.exp(-t * 6)) * env * amp;
    left[s0 + k] += v * (1 - pan);
    right[s0 + k] += v * pan;
  }
}

function addDrum(out, kind, t0, amp, rand) {
  const { left, right, sampleRate: sr } = out;
  const s0 = Math.floor(t0 * sr);
  const len = Math.floor((kind === 'taiko' ? 1.4 : kind === 'kick' ? 0.6 : 0.3) * sr);
  const hp = new Biquad(kind === 'hat' ? 'highpass' : 'bandpass', kind === 'hat' ? 7000 : 1600, 0.8, sr);
  let phase = 0;
  for (let k = 0; k < len && s0 + k < left.length; k++) {
    if (s0 + k < 0) continue;
    const t = k / sr;
    let v = 0;
    if (kind === 'taiko' || kind === 'kick') {
      const f = kind === 'taiko' ? 42 + 110 * Math.exp(-t * 18) : 48 + 140 * Math.exp(-t * 30);
      phase += (TAU * f) / sr;
      const body = Math.sin(phase) * Math.exp(-t * (kind === 'taiko' ? 3.2 : 7));
      const skin = (rand() * 2 - 1) * Math.exp(-t * 60) * 0.35;
      v = Math.tanh((body + skin) * 1.6);
    } else if (kind === 'clap') {
      v = hp.process(rand() * 2 - 1) * Math.exp(-t * 16) * 1.6;
    } else {
      v = hp.process(rand() * 2 - 1) * Math.exp(-t * 55) * 0.8;
    }
    left[s0 + k] += v * amp;
    right[s0 + k] += v * amp;
  }
}

export function generateMusic(mood, duration, { seed = 7, sampleRate = DEFAULT_SR } = {}) {
  const out = buffers(duration, sampleRate);
  const style = MUSIC_STYLES[mood];
  if (!style) return out;
  const rand = mulberry32(seed * 104729 + mood.length);
  const beat = 60 / style.bpm;
  const bar = beat * 4;
  const chordLen = bar * 2;
  const prog = style.progression;
  const nChords = Math.ceil(duration / chordLen) + 1;
  for (let c = 0; c < nChords; c++) {
    const t0 = c * chordLen;
    if (t0 > duration) break;
    const notes = prog[c % prog.length];
    // Budowanie napięcia: pierwsze 2 akordy ciszej, potem pełny aranż.
    const intensity = c < 2 ? 0.55 : 1;
    addPad(out, notes, t0, chordLen, style.pad * intensity, style.brightness * (0.7 + 0.3 * intensity), rand);
    addBass(out, notes[0] - 12, t0, chordLen, style.bass * (c < 1 ? 0.4 : 1));
    if (style.plucks) {
      const count = 6 + Math.floor(rand() * 4);
      for (let p = 0; p < count; p++) {
        const m = notes[1 + Math.floor(rand() * (notes.length - 1))] + 12 * (rand() < 0.5 ? 1 : 0);
        const tt = t0 + Math.floor(rand() * 16) * (beat / 2);
        addPluck(out, m, tt, 0.12 * style.plucks, 0.3 + rand() * 0.4, 2.8);
      }
    }
    if (style.arp && c >= 1) {
      const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
      for (let s = 0; s < 32; s++) {
        const m = notes[pattern[s % pattern.length]] + 12;
        addPluck(out, m, t0 + s * (beat / 4), 0.07 * style.arp, s % 2 ? 0.65 : 0.35, 0.35);
      }
    }
    if (style.drums && c >= 1) {
      for (let b = 0; b < 8; b++) {
        const tb = t0 + b * beat;
        if (style.drums === 'taiko') {
          if (b % 4 === 0) addDrum(out, 'taiko', tb, 0.9, rand);
          if (b % 4 === 2) addDrum(out, 'taiko', tb, 0.55, rand);
          if (c % 4 === 3 && b >= 6) {
            addDrum(out, 'taiko', tb + beat / 2, 0.5, rand);
            addDrum(out, 'taiko', tb + (3 * beat) / 4, 0.4, rand);
          }
        } else if (style.drums === 'pulse') {
          if (b % 2 === 0) addDrum(out, 'kick', tb, 0.7, rand);
          if (b % 4 === 0) addDrum(out, 'kick', tb + beat * 0.28, 0.45, rand); // "bicie serca"
          addDrum(out, 'hat', tb + beat / 2, 0.15, rand);
        } else if (style.drums === 'pop') {
          addDrum(out, 'kick', tb, b % 2 === 0 ? 0.8 : 0.5, rand);
          if (b % 2 === 1) addDrum(out, 'clap', tb, 0.35, rand);
          addDrum(out, 'hat', tb + beat / 2, 0.2, rand);
        }
      }
    }
  }
  freeverb(out.left, out.right, sampleRate, { room: 0.86, damp: 0.3, wet: style.reverb, dry: 1 });
  softClip(out.left, out.right, 1.1);
  normalize(out.left, out.right, 0.85);
  fadeEdges(out.left, out.right, sampleRate, 1.5, Math.min(4, duration * 0.2));
  return out;
}

// ---------------- WAV ----------------

export function encodeWav(channels, sampleRate) {
  const numCh = channels.length;
  const len = channels[0].length;
  const bytes = 44 + len * numCh * 2;
  const buf = new ArrayBuffer(bytes);
  const view = new DataView(buf);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, len * numCh * 2, true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Uint8Array(buf);
}
