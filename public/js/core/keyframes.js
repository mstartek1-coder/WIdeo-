// Interpolacja keyframe'ów: liczby, wektory (tablice liczb) i kolory "#rrggbb".
// Ścieżka (track) to tablica { t, v, ease } – ease dotyczy odcinka WYCHODZĄCEGO z danego klucza.

import { ease } from './easing.js';

export function parseHexColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHexColor(rgb) {
  return (
    '#' +
    rgb
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
      .join('')
  );
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function interpolateValue(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t);
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => lerp(x, b[i] ?? x, t));
  if (typeof a === 'string' && typeof b === 'string') {
    const ca = parseHexColor(a);
    const cb = parseHexColor(b);
    if (ca && cb) return toHexColor(ca.map((x, i) => lerp(x, cb[i], t)));
  }
  return t < 1 ? a : b;
}

export function sortTrack(track) {
  return [...track].sort((x, y) => x.t - y.t);
}

export function sampleTrack(track, t, fallback) {
  if (!Array.isArray(track) || track.length === 0) return fallback;
  if (track.length === 1 || t <= track[0].t) return track[0].v;
  const last = track[track.length - 1];
  if (t >= last.t) return last.v;
  // Wyszukiwanie binarne odcinka.
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const k0 = track[lo];
  const k1 = track[hi];
  const span = k1.t - k0.t;
  const local = span > 0 ? (t - k0.t) / span : 1;
  return interpolateValue(k0.v, k1.v, ease(k0.ease || 'linear', local));
}

// Próbkuje wszystkie ścieżki obiektu naraz: { x: [...], y: [...] } -> { x, y }.
export function sampleTracks(tracks, t, defaults = {}) {
  const out = { ...defaults };
  for (const key of Object.keys(tracks || {})) {
    out[key] = sampleTrack(tracks[key], t, defaults[key]);
  }
  return out;
}

// Wstawia lub nadpisuje klucz w chwili t (z tolerancją), zwraca nową posortowaną ścieżkę.
export function setKey(track, t, v, easeName = 'easeInOutCubic', epsilon = 1e-3) {
  const next = (track || []).filter((k) => Math.abs(k.t - t) > epsilon);
  next.push({ t, v, ease: easeName });
  return sortTrack(next);
}
