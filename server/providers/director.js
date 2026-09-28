// Reżyser AI (Claude): z krótkiego pomysłu tworzy pełny scenopis – prompty wizualne pod modele wideo,
// język kamery, światło, tekst lektora, opisy efektów dźwiękowych, przejścia i nastrój muzyki.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { CAMERA_MOVES, LENSES, LIGHTING, STYLES } from '../../public/js/core/prompt.js';
import { PROCEDURAL_PRESETS, AMBIENCES, TRANSITIONS, MUSIC_MOODS } from '../../public/js/core/project.js';

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

const SYSTEM = `You are an award-winning film director and director of photography who plans short films that will be generated shot-by-shot with state-of-the-art AI video models (Veo 3, Kling, Hailuo, Seedance). Your storyboards produce footage that is indistinguishable from real camera footage.

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

let client = null;
function getClient() {
  if (!config.anthropicKey) throw new Error('Brak ANTHROPIC_API_KEY w .env – użyj reżysera offline albo dodaj klucz.');
  if (!client) client = new Anthropic({ apiKey: config.anthropicKey });
  return client;
}

export async function directStoryboard({ idea, sceneCount = 6, style = 'cinematic', aspect = '16:9', language = 'polski' }, update = () => {}) {
  if (!idea || !String(idea).trim()) throw new Error('Opisz pomysł na film.');
  const n = Math.max(1, Math.min(20, Number(sceneCount) || 6));
  const model = config.directorModel;
  // Serwerowy fallback przy odmowie – zalecany dla Claude Opus 5 / Fable 5.1.
  const withFallback = /^claude-(opus-5|fable-5)/.test(model);
  update(`Reżyser (${model}) pisze scenopis…`);
  let response;
  try {
    response = await getClient().beta.messages.create({
      model,
      max_tokens: 16000,
      ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Film idea:\n${String(idea).trim()}\n\nNumber of scenes: ${n}\nVisual style: ${STYLES[style]?.text || style}\nAspect ratio: ${aspect}\nNarration language: ${language}`,
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('Claude: nieprawidłowy ANTHROPIC_API_KEY.');
    if (err instanceof Anthropic.NotFoundError) throw new Error(`Claude: model "${model}" jest niedostępny dla tego klucza (ustaw DIRECTOR_MODEL).`);
    if (err instanceof Anthropic.RateLimitError) throw new Error('Claude: przekroczono limit zapytań – spróbuj za chwilę.');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Claude: brak połączenia z API.');
    if (err instanceof Anthropic.APIError) throw new Error(`Claude: ${err.message}`);
    throw err;
  }
  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude odmówił przygotowania scenopisu${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'}`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('Claude: odpowiedź została ucięta – zmniejsz liczbę scen.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    throw new Error('Claude zwrócił nieprawidłowy JSON.');
  }
  plan.scenes = (plan.scenes || []).map((s) => ({ ...s, duration: Math.max(3, Math.min(12, Number(s.duration) || 6)) }));
  return { plan, model: response.model };
}
