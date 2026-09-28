// WIdeo Studio – serwer: statyczne studio, API generowania (wideo/obraz/głos/SFX/muzyka/scenopis) i media z obsługą Range.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, PUBLIC_DIR, MEDIA_DIR } from './config.js';
import { createJob, getJob, listJobs, saveMedia, extensionFor } from './jobs.js';
import * as replicate from './providers/replicate.js';
import * as veo from './providers/veo.js';
import * as eleven from './providers/elevenlabs.js';
import { directStoryboard } from './providers/director.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

const UPLOAD_EXT = new Set(['.mp4', '.webm', '.mov', '.png', '.jpg', '.jpeg', '.webp', '.mp3', '.wav', '.ogg', '.m4a']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Za duży plik/żądanie');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buf = await readBody(req, 2 * 1024 * 1024);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Nieprawidłowy JSON');
  }
}

// Bezpieczne rozwiązanie ścieżki w katalogu (bez wyjścia poza root).
export function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

async function serveFile(req, res, file, { cache = 'no-cache' } = {}) {
  let st;
  try {
    st = await stat(file);
  } catch {
    throw new HttpError(404, 'Nie znaleziono');
  }
  if (st.isDirectory()) return serveFile(req, res, path.join(file, 'index.html'), { cache });
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache };
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = m && m[1] !== '' ? Number(m[1]) : NaN;
    let end = m && m[2] !== '' ? Number(m[2]) : st.size - 1;
    if (m && m[1] === '' && m[2] !== '') {
      start = Math.max(0, st.size - Number(m[2]));
      end = st.size - 1;
    }
    if (!m || !Number.isFinite(start) || start > end || start >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

// Lokalny plik z /media jako data URI / base64 (np. zdjęcie jako pierwsza klatka image-to-video).
async function localMediaBase64(url) {
  if (!url || !url.startsWith('/media/')) return null;
  const file = safeJoin(MEDIA_DIR, url.slice('/media/'.length));
  if (!file) throw new HttpError(400, 'Nieprawidłowa ścieżka obrazu');
  const buf = await readFile(file);
  const mime = MIME[path.extname(file).toLowerCase()] || 'image/jpeg';
  return { base64: buf.toString('base64'), mime };
}

function status() {
  return {
    providers: {
      director: { available: !!config.anthropicKey, model: config.directorModel },
      replicate: { available: !!config.replicateToken, videoModels: labels(replicate.VIDEO_MODELS), imageModels: labels(replicate.IMAGE_MODELS) },
      veo: { available: !!config.geminiKey, model: config.veoModel },
      elevenlabs: { available: !!config.elevenKey, voice: config.elevenVoice, ttsModel: config.elevenTtsModel },
    },
  };
}

function labels(models) {
  return Object.entries(models).map(([id, m]) => ({ id, label: m.label, audio: !!m.audio }));
}

function jobResponse(job) {
  return { id: job.id, type: job.type, status: job.status, message: job.message, result: job.result, error: job.error };
}

const routes = {
  'GET /api/status': async () => status(),
  'GET /api/jobs': async () => ({ jobs: listJobs().map(jobResponse) }),

  'POST /api/director': async (req) => {
    const body = await readJson(req);
    const job = createJob('director', { idea: String(body.idea || '').slice(0, 200) }, (update) => directStoryboard(body, update));
    return jobResponse(job);
  },

  'POST /api/generate/video': async (req) => {
    const body = await readJson(req);
    if (!body.prompt) throw new HttpError(400, 'Brak promptu');
    const provider = body.provider === 'veo' ? 'veo' : 'replicate';
    const opts = {
      prompt: String(body.prompt),
      negativePrompt: body.negativePrompt ? String(body.negativePrompt) : undefined,
      aspectRatio: body.aspectRatio === '9:16' ? '9:16' : body.aspectRatio === '1:1' ? '1:1' : '16:9',
      duration: Number(body.duration) || 5,
      model: body.model ? String(body.model) : provider === 'veo' ? config.veoModel : 'google/veo-3',
      extraInput: body.extraInput && typeof body.extraInput === 'object' ? body.extraInput : undefined,
    };
    const img = await localMediaBase64(body.imageUrl);
    if (img) {
      opts.image = `data:${img.mime};base64,${img.base64}`;
      opts.imageBase64 = img.base64;
      opts.imageMime = img.mime;
    }
    const job = createJob('video', { provider, model: opts.model }, (update) => (provider === 'veo' ? veo.generateVideo(opts, update) : replicate.generateVideo(opts, update)));
    return jobResponse(job);
  },

  'POST /api/generate/image': async (req) => {
    const body = await readJson(req);
    if (!body.prompt) throw new HttpError(400, 'Brak promptu');
    const opts = {
      prompt: String(body.prompt),
      aspectRatio: ['9:16', '1:1', '16:9'].includes(body.aspectRatio) ? body.aspectRatio : '16:9',
      model: body.model ? String(body.model) : 'black-forest-labs/flux-1.1-pro-ultra',
      extraInput: body.extraInput && typeof body.extraInput === 'object' ? body.extraInput : undefined,
    };
    const job = createJob('image', { model: opts.model }, (update) => replicate.generateImage(opts, update));
    return jobResponse(job);
  },

  'POST /api/generate/voice': async (req) => {
    const body = await readJson(req);
    const job = createJob('voice', {}, (update) => eleven.textToSpeech({ text: String(body.text || ''), voiceId: body.voiceId, modelId: body.modelId }, update));
    return jobResponse(job);
  },

  'POST /api/generate/sfx': async (req) => {
    const body = await readJson(req);
    const job = createJob('sfx', {}, (update) => eleven.soundEffect({ prompt: String(body.prompt || ''), duration: body.duration }, update));
    return jobResponse(job);
  },

  'POST /api/generate/music': async (req) => {
    const body = await readJson(req);
    const job = createJob('music', {}, (update) => eleven.music({ prompt: String(body.prompt || ''), duration: body.duration }, update));
    return jobResponse(job);
  },

  'POST /api/upload': async (req) => {
    const name = String(req.headers['x-filename'] || 'plik');
    const ext = path.extname(decodeURIComponent(name)).toLowerCase();
    if (!UPLOAD_EXT.has(ext)) throw new HttpError(415, `Nieobsługiwany typ pliku: ${ext || 'brak rozszerzenia'}`);
    const buf = await readBody(req, config.maxUploadBytes);
    if (!buf.length) throw new HttpError(400, 'Pusty plik');
    const saved = await saveMedia(buf, extensionFor(MIME[ext], name, ext), 'upload');
    const kind = /^\.(png|jpe?g|webp)$/.test(ext) ? 'image' : /^\.(mp3|wav|ogg|m4a)$/.test(ext) ? 'audio' : 'video';
    return { ...saved, kind };
  },
};

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const jobMatch = /^\/api\/jobs\/([\w-]+)$/.exec(url.pathname);
        if (req.method === 'GET' && jobMatch) {
          const job = getJob(jobMatch[1]);
          if (!job) throw new HttpError(404, 'Nie ma takiego zadania');
          return sendJson(res, 200, jobResponse(job));
        }
        const handler = routes[`${req.method} ${url.pathname}`];
        if (!handler) throw new HttpError(404, 'Nieznany endpoint');
        return sendJson(res, 200, await handler(req));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Metoda niedozwolona');
      if (url.pathname.startsWith('/media/')) {
        const file = safeJoin(MEDIA_DIR, url.pathname.slice('/media/'.length));
        if (!file) throw new HttpError(400, 'Nieprawidłowa ścieżka');
        return await serveFile(req, res, file, { cache: 'public, max-age=31536000, immutable' });
      }
      const file = safeJoin(PUBLIC_DIR, url.pathname === '/' ? '/index.html' : url.pathname);
      if (!file) throw new HttpError(400, 'Nieprawidłowa ścieżka');
      return await serveFile(req, res, file);
    } catch (err) {
      const statusCode = err instanceof HttpError ? err.status : 500;
      if (statusCode === 500) console.error(err);
      if (!res.headersSent) sendJson(res, statusCode, { error: err.message || 'Błąd serwera' });
      else res.end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await mkdir(MEDIA_DIR, { recursive: true });
  const server = createServer();
  server.listen(config.port, config.host, () => {
    const s = status().providers;
    const on = (v) => (v ? '✔' : '–');
    console.log(`\n  🎬 WIdeo Studio działa: http://${config.host}:${config.port}\n`);
    console.log(`  ${on(s.director.available)} Reżyser AI (Claude, ${s.director.model})`);
    console.log(`  ${on(s.replicate.available)} Replicate (Veo 3, Kling, Hailuo, Seedance, Flux)`);
    console.log(`  ${on(s.veo.available)} Google Veo (Gemini API, ${s.veo.model})`);
    console.log(`  ${on(s.elevenlabs.available)} ElevenLabs (lektor, efekty, muzyka)`);
    console.log('  ✔ Silnik proceduralny WebGL + syntezator dźwięku (zawsze dostępny)\n');
  });
}
