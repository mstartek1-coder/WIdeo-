// Wspólne instrukcje i schemat reżysera AI – używane przez serwer (API Claude) i przez wersję w aplikacji Claude.

import { CAMERA_MOVES, LENSES, LIGHTING, STYLES } from './prompt.js';
import { PROCEDURAL_PRESETS, AMBIENCES, TRANSITIONS, MUSIC_MOODS } from './project.js';

const keys = (o) => Object.keys(o);

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    logline: { type: 'string' },
    style: { type: 'string', enum: keys(STYLES) },
    musicMood: { type: 'string', enum: keys(MUSIC_MOODS) },
    musicPrompt: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          duration: { type: 'number' },
          visualPrompt: { type: 'string' },
          camera: { type: 'string', enum: keys(CAMERA_MOVES) },
          lens: { type: 'string', enum: keys(LENSES) },
          lighting: { type: 'string', enum: keys(LIGHTING) },
          voiceover: { type: 'string' },
          sfxPrompt: { type: 'string' },
          ambience: { type: 'string', enum: keys(AMBIENCES) },
          proceduralPreset: { type: 'string', enum: keys(PROCEDURAL_PRESETS) },
          transition: { type: 'string', enum: keys(TRANSITIONS) },
          overlayText: { type: 'string' },
        },
        required: ['name', 'duration', 'visualPrompt', 'camera', 'lens', 'lighting', 'voiceover', 'sfxPrompt', 'ambience', 'proceduralPreset', 'transition', 'overlayText'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'logline', 'style', 'musicMood', 'musicPrompt', 'scenes'],
  additionalProperties: false,
};

export const DIRECTOR_INSTRUCTIONS = `You are an award-winning film director and director of photography who plans short films that will be generated shot-by-shot with state-of-the-art AI video models (Veo 3, Kling, Hailuo, Seedance). Your storyboards produce footage that is indistinguishable from real camera footage.

For every scene:
- visualPrompt (English): one continuous shot with a single clear action. Describe the subject, what physically happens, the environment, weather, time of day, materials and textures, and small real-world details (dust, condensation, wind in hair, skin texture). Camera, lens and lighting have their own fields, so do not repeat them here. Never ask for on-screen text, logos or subtitles.
- Recurring characters and places must be re-described with the same explicit details (age, clothing, hair, colours) in every scene where they appear, because each shot is generated independently.
- duration: 4-10 seconds; AI models handle one action per shot best.
- voiceover: in the requested narration language, natural and concise, about 2.3 words per second of the scene duration, or an empty string when the shot should breathe without narration.
- sfxPrompt (English): the realistic diegetic sound of the shot (e.g. "gravel crunching under slow footsteps, distant dog barking, light wind").
- ambience: the closest background soundscape; proceduralPreset: the closest offline placeholder visual.
- transition: how this scene leads into the next one; use cuts for energy, crossfades for time passing, fade-black for chapter breaks.
- overlayText: a short title only for the opening or closing shot, otherwise an empty string.

Build a clear dramatic arc (establishing shot, development, climax, resolution) and vary shot sizes and camera movement like a real editor would.`;

export function directorRequest({ idea, sceneCount = 6, style = 'cinematic', aspect = '16:9', language = 'polski' }) {
  const n = Math.max(1, Math.min(20, Number(sceneCount) || 6));
  return `Film idea:\n${String(idea).trim()}\n\nNumber of scenes: ${n}\nVisual style: ${STYLES[style]?.text || style}\nAspect ratio: ${aspect}\nNarration language: ${language}`;
}

// Pełny prompt dla trybu bez structured outputs (np. Claude w aplikacji): instrukcje + zadanie + schemat JSON.
export function directorPromptWithSchema(opts) {
  return `${DIRECTOR_INSTRUCTIONS}\n\n${directorRequest(opts)}\n\nReply with only one JSON object that matches this JSON Schema exactly. Every field is required and enum fields must use one of the listed values:\n${JSON.stringify(PLAN_SCHEMA)}`;
}

// Porządkuje plan z modelu: poprawne enumy, długości w zakresie, brakujące pola uzupełnione.
export function sanitizePlan(raw) {
  const plan = raw && typeof raw === 'object' ? raw : {};
  const pick = (value, table, fallback) => (Object.prototype.hasOwnProperty.call(table, value) ? value : fallback);
  const str = (v) => (typeof v === 'string' ? v : '');
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  return {
    title: str(plan.title).trim() || 'Mój film',
    logline: str(plan.logline),
    style: pick(plan.style, STYLES, 'cinematic'),
    musicMood: pick(plan.musicMood, MUSIC_MOODS, 'epic'),
    musicPrompt: str(plan.musicPrompt),
    scenes: scenes
      .filter((s) => s && typeof s === 'object')
      .map((s, i) => ({
        name: str(s.name).trim() || `Scena ${i + 1}`,
        duration: Math.max(3, Math.min(12, Number(s.duration) || 6)),
        visualPrompt: str(s.visualPrompt),
        camera: pick(s.camera, CAMERA_MOVES, 'slow-dolly-in'),
        lens: pick(s.lens, LENSES, '35mm'),
        lighting: pick(s.lighting, LIGHTING, 'golden-hour'),
        voiceover: str(s.voiceover),
        sfxPrompt: str(s.sfxPrompt),
        ambience: pick(s.ambience, AMBIENCES, 'none'),
        proceduralPreset: pick(s.proceduralPreset, PROCEDURAL_PRESETS, 'ocean'),
        transition: pick(s.transition, TRANSITIONS, 'crossfade'),
        overlayText: str(s.overlayText),
      })),
  };
}
