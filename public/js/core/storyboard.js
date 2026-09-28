// Reżyser offline: zamienia pomysł (kilka zdań) w scenopis bez użycia API.
// Dzieli tekst na ujęcia, prowadzi język kamery (plan ogólny → średni → zbliżenie → finał)
// i dobiera proceduralne tło + ambient na podstawie słów kluczowych (PL/EN).

import { createOverlay, createProject } from './project.js';
import { layoutScenes } from './timeline.js';
import { hashString } from './random.js';

const KEYWORDS = [
  { preset: 'ocean', ambience: 'waves', words: ['morze', 'morza', 'ocean', 'fale', 'fal', 'plaż', 'sea', 'wave', 'beach', 'zachód', 'sunset', 'wybrzeż', 'coast'] },
  { preset: 'clouds', ambience: 'wind', words: ['chmur', 'niebo', 'nieba', 'lot', 'lec', 'samolot', 'ptak', 'cloud', 'sky', 'fly', 'wznos', 'góry', 'szczyt'] },
  { preset: 'aurora', ambience: 'night', words: ['zorz', 'noc', 'gwiazd', 'śnieg', 'zim', 'aurora', 'night', 'snow', 'północ', 'księżyc', 'moon'] },
  { preset: 'nebula', ambience: 'space', words: ['kosmos', 'galakt', 'planet', 'mgławic', 'space', 'galaxy', 'nebula', 'wszechświat', 'universe', 'rakiet'] },
  { preset: 'rain', ambience: 'rain', words: ['deszcz', 'miast', 'ulic', 'neon', 'rain', 'city', 'street', 'burz', 'storm'] },
];

// Postęp języka kamery w opowieści.
const SHOT_PLAN = [
  { camera: 'drone-flyover', lens: '24mm', motion: { from: { zoom: 1.0, x: -0.02, y: 0 }, to: { zoom: 1.1, x: 0.02, y: 0 } } },
  { camera: 'slow-dolly-in', lens: '35mm', motion: { from: { zoom: 1.0, x: 0, y: 0 }, to: { zoom: 1.15, x: 0, y: -0.01 } } },
  { camera: 'tracking', lens: '50mm', motion: { from: { zoom: 1.08, x: 0.03, y: 0 }, to: { zoom: 1.08, x: -0.03, y: 0 } } },
  { camera: 'rack-focus', lens: '85mm', motion: { from: { zoom: 1.12, x: 0, y: 0 }, to: { zoom: 1.2, x: 0.01, y: 0.01 } } },
  { camera: 'orbit', lens: '35mm', motion: { from: { zoom: 1.05, x: -0.03, y: 0.01 }, to: { zoom: 1.12, x: 0.03, y: -0.01 } } },
  { camera: 'crane-up', lens: '24mm', motion: { from: { zoom: 1.15, x: 0, y: 0.03 }, to: { zoom: 1.0, x: 0, y: -0.02 } } },
];

const TRANSITION_PLAN = ['crossfade', 'crossfade', 'zoom', 'crossfade', 'wipe', 'fade-black'];

export function splitIdea(idea, maxScenes = 8) {
  const clean = String(idea || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  let parts = String(idea)
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) parts = clean.match(/[^.!?…]+[.!?…]*/g)?.map((s) => s.trim()).filter(Boolean) || [clean];
  if (parts.length > maxScenes) {
    // Scal nadmiarowe zdania w równe grupy.
    const per = Math.ceil(parts.length / maxScenes);
    const merged = [];
    for (let i = 0; i < parts.length; i += per) merged.push(parts.slice(i, i + per).join(' '));
    parts = merged;
  }
  return parts;
}

export function guessEnvironment(text) {
  const lower = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const k of KEYWORDS) {
    const score = k.words.reduce((a, w) => a + (lower.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      best = k;
      bestScore = score;
    }
  }
  return best || null;
}

export function offlineStoryboard(idea, { sceneCount = 0, style = 'cinematic', secondsPerScene = 6, name } = {}) {
  let beats = splitIdea(idea, sceneCount || 8);
  if (!beats.length) beats = ['Świt nad oceanem.', 'Lot nad chmurami.', 'Zorza nad górami.', 'Podróż w głąb kosmosu.'];
  if (sceneCount && beats.length === 1 && sceneCount > 1) {
    // Jedno zdanie – rozpisz je na kilka ujęć (plan ogólny, detale, finał) tego samego motywu.
    const base = beats[0];
    beats = Array.from({ length: sceneCount }, () => base);
  }
  const presetCycle = ['ocean', 'clouds', 'aurora', 'nebula', 'rain'];
  let lastPreset = null;
  const scenes = beats.map((beat, i) => {
    const env = guessEnvironment(beat) || guessEnvironment(idea);
    let preset = env?.preset || presetCycle[i % presetCycle.length];
    if (!env && preset === lastPreset) preset = presetCycle[(i + 1) % presetCycle.length];
    lastPreset = preset;
    const shot = i === 0 ? SHOT_PLAN[0] : i === beats.length - 1 ? SHOT_PLAN[5] : SHOT_PLAN[1 + ((i - 1) % 4)];
    const words = beat.split(/\s+/).length;
    const duration = Math.max(4, Math.min(12, Math.round(Math.max(secondsPerScene, words * 0.45 + 2))));
    const isLast = i === beats.length - 1;
    const repeat = i > 0 && beats[i - 1] === beat;
    return {
      name: `Scena ${i + 1}: ${beat.split(/\s+/).slice(0, 4).join(' ')}`,
      duration,
      prompt: {
        subject: beat,
        camera: shot.camera,
        lens: shot.lens,
        lighting: preset === 'aurora' || preset === 'nebula' ? 'moonlight' : preset === 'rain' ? 'neon' : 'golden-hour',
        film: 'arri-alexa',
        style,
        audio: '',
      },
      source: { type: 'procedural', preset, seed: (hashString(beat) % 997) + 1 },
      motion: { ...shot.motion, ease: 'cinematic' },
      transition: { type: isLast ? 'fade-black' : TRANSITION_PLAN[i % TRANSITION_PLAN.length], duration: isLast ? 1.5 : 1 },
      audio: { ambience: (env?.ambience) || { ocean: 'waves', clouds: 'wind', aurora: 'night', nebula: 'space', rain: 'rain' }[preset], voice: { text: repeat ? '' : beat } },
    };
  });
  const title = name || deriveTitle(idea);
  const mood = /mrok|strach|noc|dark|horror|napię/i.test(idea) ? 'dark' : /spok|relaks|calm|cisz/i.test(idea) ? 'calm' : /radoś|nadziej|happy|wschód|uplift/i.test(idea) ? 'uplifting' : 'epic';
  return createProject({
    name: title,
    scenes,
    audio: { music: { mood } },
    overlays: [
      { text: title.toUpperCase(), start: 0.8, end: Math.min(5.5, scenes[0].duration), position: { x: 0.5, y: 0.47 }, animation: 'cinematic' },
    ],
  });
}

export function deriveTitle(idea) {
  const first = String(idea || '').trim().split(/[.!?\n]/)[0] || 'Mój film';
  const words = first.split(/\s+/).slice(0, 5).join(' ');
  return words.length > 2 ? words : 'Mój film';
}

// Zamienia odpowiedź reżysera AI (schemat z serwera) w projekt.
export function projectFromDirector(plan, fallbackName = 'Mój film') {
  const scenes = (plan.scenes || []).map((s, i, arr) => ({
    name: s.name || `Scena ${i + 1}`,
    duration: Number(s.duration) || 6,
    prompt: {
      subject: s.visualPrompt || '',
      camera: s.camera,
      lens: s.lens,
      lighting: s.lighting,
      film: 'arri-alexa',
      style: plan.style || 'cinematic',
      audio: s.sfxPrompt || '',
    },
    source: { type: 'procedural', preset: s.proceduralPreset || 'ocean', seed: i * 7 + 3 },
    transition: { type: i === arr.length - 1 ? 'fade-black' : s.transition || 'crossfade', duration: 1.2 },
    audio: {
      ambience: s.ambience || 'none',
      voice: { text: s.voiceover || '' },
      sfx: { prompt: s.sfxPrompt || '' },
    },
    motion: SHOT_PLAN[i % SHOT_PLAN.length].motion,
  }));
  const project = createProject({
    name: plan.title || fallbackName,
    scenes,
    audio: { music: { mood: plan.musicMood || 'epic' } },
  });
  for (const entry of layoutScenes(project.scenes)) {
    const text = (plan.scenes[entry.index].overlayText || '').trim();
    if (!text) continue;
    const first = entry.index === 0;
    project.overlays.push(
      createOverlay({
        text,
        start: entry.start + 0.6,
        end: entry.start + Math.max(2, entry.scene.duration - 0.8),
        animation: first ? 'cinematic' : 'fade-up',
        position: { x: 0.5, y: first ? 0.47 : 0.8 },
        style: first ? {} : { font: 'sans', size: 0.045, weight: 500, tracking: 0.04 },
      }),
    );
  }
  return project;
}
