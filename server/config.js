// Konfiguracja z pliku .env (bez zależności) + zmienne środowiskowe.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const MEDIA_DIR = process.env.MEDIA_DIR ? path.resolve(process.env.MEDIA_DIR) : path.join(ROOT, 'media');

export function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined && value !== '') process.env[m[1]] = value;
  }
}

loadDotEnv();

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 5173,
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  directorModel: process.env.DIRECTOR_MODEL || 'claude-opus-5',
  replicateToken: process.env.REPLICATE_API_TOKEN || '',
  geminiKey: process.env.GEMINI_API_KEY || '',
  veoModel: process.env.VEO_MODEL || 'veo-3.0-generate-001',
  elevenKey: process.env.ELEVENLABS_API_KEY || '',
  elevenVoice: process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb',
  elevenTtsModel: process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 1024) * 1024 * 1024,
};
