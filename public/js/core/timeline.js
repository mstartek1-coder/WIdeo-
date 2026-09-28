// Matematyka osi czasu: rozmieszczenie scen z nakładającymi się przejściami, warstwy do skomponowania w chwili t,
// animacje napisów i napisy dialogowe (z tekstu lektora).

import { ease } from './easing.js';
import { sampleTrack } from './keyframes.js';

// Długość zakładki między scenami i oraz i+1 (przejście należy do sceny wychodzącej).
export function overlapBetween(a, b) {
  if (!a || !b) return 0;
  const t = a.transition || {};
  if (t.type === 'cut') return 0;
  const d = Number(t.duration) || 0;
  return Math.max(0, Math.min(d, 0.5 * Math.min(a.duration, b.duration)));
}

export function layoutScenes(scenes) {
  const out = [];
  let start = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const end = start + scene.duration;
    const overlapOut = overlapBetween(scene, scenes[i + 1]);
    out.push({ index: i, scene, start, end, overlapIn: i > 0 ? out[i - 1].overlapOut : 0, overlapOut });
    start = end - overlapOut;
  }
  return out;
}

export function totalDuration(scenes) {
  const layout = Array.isArray(scenes) && scenes.length && scenes[0].index !== undefined ? scenes : layoutScenes(scenes || []);
  return layout.length ? layout[layout.length - 1].end : 0;
}

// Zwraca warstwy do narysowania w chwili t (od spodu do góry) wraz z parametrami przejścia.
// Każda warstwa: { index, local, progress, opacity, brightness, wipe, zoom }
export function compositeAt(layout, t) {
  const layers = [];
  for (const entry of layout) {
    if (t < entry.start || t >= entry.end) continue;
    layers.push({
      index: entry.index,
      local: t - entry.start,
      progress: entry.scene.duration > 0 ? (t - entry.start) / entry.scene.duration : 0,
      opacity: 1,
      brightness: 1,
      wipe: 1,
      zoom: 1,
    });
  }
  // Ostatnia klatka (t == koniec) – pokaż końcówkę ostatniej sceny.
  if (!layers.length && layout.length && t >= layout[layout.length - 1].end) {
    const last = layout[layout.length - 1];
    layers.push({ index: last.index, local: last.scene.duration, progress: 1, opacity: 1, brightness: 1, wipe: 1, zoom: 1 });
  }
  if (layers.length === 2) {
    const [outL, inL] = layers;
    const outEntry = layout[outL.index];
    const d = outEntry.overlapOut;
    const p = d > 0 ? Math.min(1, Math.max(0, (t - (outEntry.end - d)) / d)) : 1;
    applyTransition(outEntry.scene.transition?.type || 'crossfade', p, outL, inL);
  }
  // Wyciemnienie na końcu filmu, jeśli ostatnia scena ma przejście "przez czerń".
  if (layout.length) {
    const last = layout[layout.length - 1];
    const tr = last.scene.transition || {};
    if (tr.type === 'fade-black' && tr.duration > 0) {
      const d = Math.min(tr.duration, last.scene.duration * 0.5);
      const k = (last.end - t) / d;
      if (k < 1) for (const l of layers) if (l.index === last.index) l.brightness *= Math.max(0, k);
    }
  }
  return layers;
}

export function applyTransition(type, p, outL, inL) {
  switch (type) {
    case 'fade-black':
      outL.brightness = Math.max(0, 1 - 2 * p);
      inL.opacity = p >= 0.5 ? 1 : 0;
      inL.brightness = Math.max(0, 2 * p - 1);
      break;
    case 'wipe':
      inL.wipe = ease('easeInOutCubic', p);
      break;
    case 'zoom': {
      const e = ease('easeInOutCubic', p);
      outL.zoom = 1 + 0.35 * e;
      outL.opacity = 1;
      inL.opacity = e;
      inL.zoom = 1 + 0.25 * (1 - e);
      break;
    }
    case 'cut':
      inL.opacity = 1;
      break;
    case 'crossfade':
    default:
      inL.opacity = ease('easeInOutSine', p);
  }
}

// Ruch kamery (Ken Burns / dolly) sceny w chwili lokalnej.
export function cameraAt(scene, local) {
  const m = scene.motion || {};
  const from = m.from || { zoom: 1, x: 0, y: 0 };
  const to = m.to || from;
  const k = ease(m.ease || 'cinematic', scene.duration > 0 ? local / scene.duration : 0);
  return {
    zoom: from.zoom + (to.zoom - from.zoom) * k,
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
  };
}

// Globalne wejście/wyjście z czerni (miękki start i koniec filmu).
export function globalFade(t, total, enabled = true, d = 0.8) {
  if (!enabled || total <= 0) return 1;
  const a = Math.min(1, t / d);
  const b = Math.min(1, (total - t) / d);
  return Math.max(0, Math.min(a, b));
}

// ---------- Animacje napisów ----------

export function animationTracks(name, duration, position = { x: 0.5, y: 0.5 }, baseTracking = 0.08) {
  const { x, y } = position;
  const inT = Math.min(0.8, duration * 0.3);
  const outT = Math.min(0.6, duration * 0.25);
  const fadeOpacity = [
    { t: 0, v: 0, ease: 'easeOutCubic' },
    { t: inT, v: 1, ease: 'linear' },
    { t: Math.max(inT, duration - outT), v: 1, ease: 'easeInCubic' },
    { t: duration, v: 0 },
  ];
  const tracks = { x: [{ t: 0, v: x }], y: [{ t: 0, v: y }], opacity: fadeOpacity, scale: [{ t: 0, v: 1 }], rotation: [{ t: 0, v: 0 }], reveal: [{ t: 0, v: 1 }], tracking: [{ t: 0, v: baseTracking }] };
  switch (name) {
    case 'none':
      tracks.opacity = [{ t: 0, v: 1 }];
      break;
    case 'fade':
      break;
    case 'fade-up':
      tracks.y = [
        { t: 0, v: y + 0.04, ease: 'easeOutCubic' },
        { t: inT * 1.4, v: y },
      ];
      break;
    case 'zoom-in':
      tracks.scale = [
        { t: 0, v: 0.82, ease: 'easeOutBack' },
        { t: inT * 1.5, v: 1, ease: 'linear' },
        { t: duration, v: 1.06 },
      ];
      break;
    case 'slide-left':
      tracks.x = [
        { t: 0, v: x + 0.12, ease: 'easeOutExpo' },
        { t: inT * 1.5, v: x },
      ];
      break;
    case 'typewriter':
      tracks.reveal = [
        { t: 0, v: 0, ease: 'linear' },
        { t: Math.max(0.3, duration * 0.55), v: 1 },
      ];
      tracks.opacity = [
        { t: 0, v: 1 },
        { t: Math.max(0, duration - outT), v: 1, ease: 'easeInCubic' },
        { t: duration, v: 0 },
      ];
      break;
    case 'cinematic':
      tracks.tracking = [
        { t: 0, v: baseTracking + 0.35, ease: 'cinematic' },
        { t: duration, v: baseTracking },
      ];
      tracks.scale = [
        { t: 0, v: 1.04, ease: 'linear' },
        { t: duration, v: 1 },
      ];
      tracks.opacity = [
        { t: 0, v: 0, ease: 'easeInOutSine' },
        { t: Math.min(1.4, duration * 0.4), v: 1, ease: 'linear' },
        { t: Math.max(0, duration - outT * 1.5), v: 1, ease: 'easeInCubic' },
        { t: duration, v: 0 },
      ];
      break;
    default:
      break;
  }
  return tracks;
}

export function overlayTracks(overlay) {
  const duration = overlay.end - overlay.start;
  const base = animationTracks(overlay.animation, duration, overlay.position, overlay.style?.tracking ?? 0.08);
  const custom = overlay.customTracks || {};
  for (const key of Object.keys(custom)) if (Array.isArray(custom[key]) && custom[key].length) base[key] = custom[key];
  return base;
}

// Aktywne napisy w chwili t wraz z wyliczonymi właściwościami animacji.
export function overlaysAt(overlays, t) {
  const out = [];
  for (const o of overlays || []) {
    if (t < o.start || t > o.end) continue;
    const local = t - o.start;
    const tr = overlayTracks(o);
    out.push({
      overlay: o,
      local,
      x: sampleTrack(tr.x, local, 0.5),
      y: sampleTrack(tr.y, local, 0.5),
      opacity: Math.max(0, Math.min(1, sampleTrack(tr.opacity, local, 1))),
      scale: sampleTrack(tr.scale, local, 1),
      rotation: sampleTrack(tr.rotation, local, 0),
      reveal: Math.max(0, Math.min(1, sampleTrack(tr.reveal, local, 1))),
      tracking: sampleTrack(tr.tracking, local, 0.08),
    });
  }
  return out;
}

// Napisy dialogowe: tekst lektora danej sceny dzielony na zdania, rozłożone proporcjonalnie do długości.
export function subtitleAt(layout, t) {
  for (let i = layout.length - 1; i >= 0; i--) {
    const e = layout[i];
    if (t < e.start || t >= e.end) continue;
    const text = (e.scene.audio?.voice?.text || '').trim();
    if (!text) continue;
    const chunks = splitSubtitle(text);
    const lead = 0.3;
    const span = Math.max(0.5, e.scene.duration - lead - 0.4);
    const totalChars = chunks.reduce((a, c) => a + c.length, 0) || 1;
    let acc = e.start + lead;
    for (const c of chunks) {
      const d = (span * c.length) / totalChars;
      if (t >= acc && t < acc + d) return c;
      acc += d;
    }
    return null;
  }
  return null;
}

export function splitSubtitle(text, maxLen = 64) {
  const sentences = text.match(/[^.!?…]+[.!?…]*/g) || [text];
  const out = [];
  for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
    if (s.length <= maxLen) {
      out.push(s);
      continue;
    }
    let line = '';
    for (const w of s.split(/\s+/)) {
      if ((line + ' ' + w).trim().length > maxLen && line) {
        out.push(line);
        line = w;
      } else line = (line + ' ' + w).trim();
    }
    if (line) out.push(line);
  }
  return out;
}

export function formatTime(t, fps = 30) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}
