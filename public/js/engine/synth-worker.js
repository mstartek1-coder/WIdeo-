// Web Worker: synteza ambientów i muzyki poza głównym wątkiem (UI pozostaje płynne).
import { generateAmbience, generateMusic } from '../core/synth.js';

self.onmessage = (e) => {
  const { id, kind, type, duration, seed, sampleRate } = e.data;
  try {
    const out = kind === 'music' ? generateMusic(type, duration, { seed, sampleRate }) : generateAmbience(type, duration, { seed, sampleRate });
    self.postMessage({ id, left: out.left, right: out.right, sampleRate: out.sampleRate }, [out.left.buffer, out.right.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
