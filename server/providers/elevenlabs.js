// ElevenLabs: lektor (TTS, także po polsku), efekty dźwiękowe z opisu i muzyka.
import { config } from '../config.js';
import { saveMedia } from '../jobs.js';

const API = 'https://api.elevenlabs.io/v1';

async function post(pathname, body, update, prefix) {
  if (!config.elevenKey) throw new Error('Brak ELEVENLABS_API_KEY w .env');
  const res = await fetch(`${API}${pathname}`, {
    method: 'POST',
    headers: { 'xi-api-key': config.elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.detail?.message || j.detail || j.message || text;
    } catch {
      /* odpowiedź nie jest JSON-em */
    }
    throw new Error(`ElevenLabs: ${typeof msg === 'string' ? msg : JSON.stringify(msg)} (HTTP ${res.status})`);
  }
  update('Zapisuję audio…');
  const buf = Buffer.from(await res.arrayBuffer());
  return { ...(await saveMedia(buf, '.mp3', prefix)), kind: 'audio' };
}

export function textToSpeech({ text, voiceId, modelId, stability = 0.45, similarity = 0.8, style = 0.25 }, update) {
  if (!text || !text.trim()) throw new Error('Brak tekstu dla lektora');
  const voice = voiceId || config.elevenVoice;
  if (!/^[\w-]+$/.test(voice)) throw new Error('Nieprawidłowe ID głosu');
  update('Nagrywam lektora…');
  return post(
    `/text-to-speech/${voice}?output_format=mp3_44100_192`,
    { text: text.trim(), model_id: modelId || config.elevenTtsModel, voice_settings: { stability, similarity_boost: similarity, style, use_speaker_boost: true } },
    update,
    'voice',
  );
}

export function soundEffect({ prompt, duration }, update) {
  if (!prompt || !prompt.trim()) throw new Error('Brak opisu efektu dźwiękowego');
  update('Generuję efekt dźwiękowy…');
  const body = { text: prompt.trim(), prompt_influence: 0.4 };
  if (duration) body.duration_seconds = Math.max(0.5, Math.min(22, Number(duration)));
  return post('/sound-generation', body, update, 'sfx');
}

export function music({ prompt, duration }, update) {
  if (!prompt || !prompt.trim()) throw new Error('Brak opisu muzyki');
  update('Komponuję muzykę…');
  const ms = Math.round(Math.max(10, Math.min(300, Number(duration) || 30)) * 1000);
  return post('/music', { prompt: prompt.trim(), music_length_ms: ms }, update, 'music');
}
