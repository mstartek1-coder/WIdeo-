// Model projektu: sceny (obraz + ruch kamery + korekcja barwna + dźwięk), napisy z animacją, muzyka i "look" filmowy.
// Moduł nie dotyka DOM – używają go zarówno przeglądarka, jak i testy w Node.

import { uid } from './random.js';

export const PROCEDURAL_PRESETS = {
  ocean: { label: 'Ocean o zachodzie słońca', ambience: 'waves' },
  clouds: { label: 'Lot nad morzem chmur', ambience: 'wind' },
  aurora: { label: 'Zorza polarna nad górami', ambience: 'night' },
  nebula: { label: 'Mgławica w głębokim kosmosie', ambience: 'space' },
  rain: { label: 'Nocny deszcz w mieście (bokeh)', ambience: 'rain' },
};

export const AMBIENCES = {
  none: 'Brak',
  waves: 'Fale oceanu',
  wind: 'Wiatr na wysokości',
  night: 'Noc (wiatr + świerszcze)',
  space: 'Kosmiczny dron',
  rain: 'Deszcz',
};

export const TRANSITIONS = {
  cut: 'Cięcie',
  crossfade: 'Przenikanie',
  'fade-black': 'Przez czerń',
  wipe: 'Kurtyna (wipe)',
  zoom: 'Najazd (zoom)',
};

export const MUSIC_MOODS = {
  none: 'Bez muzyki',
  epic: 'Epicka (orkiestrowe pady + bębny)',
  calm: 'Spokojna (ambient, pianino)',
  dark: 'Mroczna (napięcie, pulsy)',
  uplifting: 'Podnosząca na duchu (arpeggio)',
};

export const RESOLUTIONS = {
  '1280x720': 'HD 720p (16:9)',
  '1920x1080': 'Full HD 1080p (16:9)',
  '2560x1440': 'QHD 1440p (16:9)',
  '3840x2160': '4K UHD (16:9)',
  '1080x1920': 'Pionowe 9:16 (Reels/TikTok)',
  '1080x1080': 'Kwadrat 1:1',
};

export const OVERLAY_ANIMATIONS = {
  none: 'Brak',
  fade: 'Pojawienie',
  'fade-up': 'Wjazd od dołu',
  'zoom-in': 'Przybliżenie',
  'slide-left': 'Wjazd z prawej',
  typewriter: 'Maszyna do pisania',
  cinematic: 'Zwiastun kinowy (rozstrzelenie liter)',
};

export const FONTS = {
  serif: '"Cormorant Garamond", "Times New Roman", serif',
  sans: '"Inter", "Helvetica Neue", Arial, sans-serif',
  mono: '"JetBrains Mono", "Courier New", monospace',
};

export function createScene(overrides = {}) {
  const base = {
    id: uid('scene'),
    name: 'Nowa scena',
    duration: 5,
    prompt: {
      subject: '',
      camera: 'slow-dolly-in',
      lens: '35mm',
      lighting: 'golden-hour',
      film: 'arri-alexa',
      style: 'cinematic',
      audio: '',
    },
    source: { type: 'procedural', preset: 'ocean', seed: 1 },
    motion: {
      from: { zoom: 1.0, x: 0, y: 0 },
      to: { zoom: 1.12, x: 0.02, y: -0.01 },
      ease: 'cinematic',
    },
    grade: { exposure: 0, contrast: 1.05, saturation: 1.05, temperature: 0, tint: 0 },
    // Przejście DO NASTĘPNEJ sceny (w ostatniej scenie 'fade-black' = wyciemnienie na końcu filmu).
    transition: { type: 'crossfade', duration: 1 },
    audio: {
      ambience: 'waves',
      ambienceVolume: 0.6,
      clipVolume: 1,
      voice: { text: '', url: '', volume: 1 },
      sfx: { prompt: '', url: '', volume: 0.8, offset: 0 },
    },
  };
  return mergeDefaults(base, overrides);
}

export function createOverlay(overrides = {}) {
  const base = {
    id: uid('ovl'),
    type: 'text',
    text: 'TYTUŁ',
    start: 0.5,
    end: 4.5,
    position: { x: 0.5, y: 0.5 },
    animation: 'cinematic',
    style: {
      font: 'serif',
      size: 0.09,
      weight: 600,
      color: '#ffffff',
      align: 'center',
      tracking: 0.08,
      shadow: true,
      box: false,
    },
    customTracks: {},
  };
  return mergeDefaults(base, overrides);
}

export function createProject(overrides = {}) {
  const base = {
    version: 1,
    name: 'Mój film',
    width: 1920,
    height: 1080,
    fps: 30,
    renderScale: 1,
    scenes: [],
    overlays: [],
    audio: {
      master: 0.9,
      music: { mood: 'epic', volume: 0.45, url: '', seed: 7, duck: 0.35 },
    },
    look: {
      grain: 0.22,
      vignette: 0.35,
      aberration: 0.12,
      bloom: 0.3,
      letterbox: 0,
      sharpen: 0.2,
      fadeInOut: true,
    },
    subtitles: { enabled: true, size: 0.042 },
    ai: {
      videoProvider: 'replicate',
      videoModel: 'google/veo-3',
      imageModel: 'black-forest-labs/flux-1.1-pro-ultra',
      voiceId: '',
      language: 'polski',
    },
  };
  const project = mergeDefaults(base, overrides);
  project.scenes = (overrides.scenes || []).map((s) => createScene(s));
  project.overlays = (overrides.overlays || []).map((o) => createOverlay(o));
  return project;
}

// Wczytuje projekt z JSON (np. z pliku lub od reżysera AI), uzupełnia braki i przycina wartości do bezpiecznych zakresów.
export function normalizeProject(raw) {
  const p = createProject(raw && typeof raw === 'object' ? raw : {});
  p.width = clampInt(p.width, 256, 4096, 1920);
  p.height = clampInt(p.height, 256, 4096, 1080);
  p.fps = clampInt(p.fps, 12, 60, 30);
  p.renderScale = clampNum(p.renderScale, 0.25, 1, 1);
  for (const s of p.scenes) {
    s.duration = clampNum(s.duration, 0.5, 120, 5);
    s.transition.duration = s.transition.type === 'cut' ? 0 : clampNum(s.transition.duration, 0, 5, 1);
    if (!TRANSITIONS[s.transition.type]) s.transition.type = 'crossfade';
    if (s.source.type === 'procedural' && !PROCEDURAL_PRESETS[s.source.preset]) s.source.preset = 'ocean';
    if (!AMBIENCES[s.audio.ambience]) s.audio.ambience = 'none';
  }
  for (const o of p.overlays) {
    o.start = clampNum(o.start, 0, 3600, 0);
    o.end = Math.max(o.start + 0.1, clampNum(o.end, 0, 3600, o.start + 3));
    if (!OVERLAY_ANIMATIONS[o.animation]) o.animation = 'fade';
  }
  if (!MUSIC_MOODS[p.audio.music.mood]) p.audio.music.mood = 'none';
  return p;
}

export function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampInt(v, min, max, fallback) {
  return Math.round(clampNum(v, min, max, fallback));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Rekurencyjnie uzupełnia brakujące pola wartościami domyślnymi (tablice i wartości proste są brane w całości z `value`).
export function mergeDefaults(defaults, value) {
  if (!isPlainObject(defaults)) return value === undefined ? defaults : value;
  if (!isPlainObject(value)) return structuredClone(defaults);
  const out = {};
  for (const key of Object.keys(defaults)) {
    const d = defaults[key];
    const v = value[key];
    if (v === undefined || v === null) out[key] = structuredClone(d);
    else if (isPlainObject(d)) out[key] = mergeDefaults(d, v);
    else if (typeof d === 'number' && typeof v !== 'number') out[key] = Number.isFinite(Number(v)) ? Number(v) : d;
    else out[key] = structuredClone(v);
  }
  // Zachowaj pola, których nie ma w domyślnych (np. customTracks, dodatkowe metadane).
  for (const key of Object.keys(value)) {
    if (!(key in out)) out[key] = structuredClone(value[key]);
  }
  return out;
}

export function parseResolution(key) {
  const m = /^(\d+)x(\d+)$/.exec(key);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1920, height: 1080 };
}

export function aspectLabel(width, height) {
  const r = width / height;
  if (Math.abs(r - 16 / 9) < 0.02) return '16:9';
  if (Math.abs(r - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(r - 1) < 0.02) return '1:1';
  if (Math.abs(r - 4 / 3) < 0.02) return '4:3';
  return r > 1 ? '16:9' : '9:16';
}

// Przykładowy projekt startowy – działa bez żadnych kluczy API.
export function createDemoProject() {
  return createProject({
    name: 'Demo: Od oceanu do gwiazd',
    scenes: [
      {
        name: 'Ocean o zachodzie',
        duration: 7,
        source: { type: 'procedural', preset: 'ocean', seed: 3 },
        prompt: { subject: 'Endless ocean at sunset, gentle swells rolling towards the camera' },
        motion: { from: { zoom: 1.0, x: 0, y: 0 }, to: { zoom: 1.08, x: 0, y: -0.01 } },
        audio: { ambience: 'waves', voice: { text: 'Każda historia zaczyna się od horyzontu.' } },
        transition: { type: 'fade-black', duration: 1 },
      },
      {
        name: 'Nad chmurami',
        duration: 7,
        source: { type: 'procedural', preset: 'clouds', seed: 11 },
        prompt: { subject: 'Flying just above a sea of clouds at golden hour', camera: 'drone-flyover' },
        audio: { ambience: 'wind', voice: { text: 'Potem wznosimy się ponad chmury.' } },
        transition: { type: 'crossfade', duration: 1.5 },
      },
      {
        name: 'Zorza polarna',
        duration: 7,
        source: { type: 'procedural', preset: 'aurora', seed: 5 },
        prompt: { subject: 'Aurora borealis dancing above snowy mountains', lighting: 'moonlight' },
        grade: { temperature: -0.15 },
        audio: { ambience: 'night', voice: { text: 'Noc maluje niebo światłem.' } },
        transition: { type: 'zoom', duration: 1.2 },
      },
      {
        name: 'Mgławica',
        duration: 8,
        source: { type: 'procedural', preset: 'nebula', seed: 9 },
        prompt: { subject: 'Slow push through a colorful nebula, distant stars', camera: 'slow-dolly-in' },
        motion: { from: { zoom: 1.0, x: 0, y: 0 }, to: { zoom: 1.25, x: 0, y: 0 } },
        audio: { ambience: 'space', voice: { text: 'A na końcu – gwiazdy.' } },
        transition: { type: 'crossfade', duration: 1.5 },
      },
    ],
    overlays: [
      { text: 'WIDEO STUDIO', start: 1, end: 5.5, position: { x: 0.5, y: 0.45 }, animation: 'cinematic' },
      {
        text: 'hiperrealizm · dźwięk · animacja',
        start: 2, end: 5.5, position: { x: 0.5, y: 0.56 }, animation: 'fade-up',
        style: { font: 'sans', size: 0.03, weight: 400, tracking: 0.3 },
      },
      { text: 'KONIEC', start: 21.3, end: 25.3, position: { x: 0.5, y: 0.5 }, animation: 'zoom-in' },
    ],
  });
}
