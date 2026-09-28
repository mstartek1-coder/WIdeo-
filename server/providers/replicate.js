// Replicate: jeden klucz, wiele najlepszych modeli wideo i obrazu (Veo 3, Kling, Hailuo, Seedance, Flux, Imagen).
// Schematy wejścia różnią się między modelami – każdy preset buduje własne wejście; `extraInput` pozwala dodać dowolne pola.
import { config } from '../config.js';
import { downloadToMedia, sleep } from '../jobs.js';

const API = 'https://api.replicate.com/v1';

const nearest = (value, allowed) => allowed.reduce((best, v) => (Math.abs(v - value) < Math.abs(best - value) ? v : best), allowed[0]);

export const VIDEO_MODELS = {
  'google/veo-3': {
    label: 'Google Veo 3 – najwyższy realizm + natywny dźwięk',
    audio: true,
    build: (o) => ({ prompt: o.prompt, negative_prompt: o.negativePrompt, aspect_ratio: o.aspectRatio, ...(o.image ? { image: o.image } : {}) }),
  },
  'google/veo-3-fast': {
    label: 'Google Veo 3 Fast – szybciej i taniej, z dźwiękiem',
    audio: true,
    build: (o) => ({ prompt: o.prompt, negative_prompt: o.negativePrompt, aspect_ratio: o.aspectRatio, ...(o.image ? { image: o.image } : {}) }),
  },
  'kwaivgi/kling-v2.1-master': {
    label: 'Kling 2.1 Master – świetna fizyka ruchu',
    audio: false,
    build: (o) => ({ prompt: o.prompt, negative_prompt: o.negativePrompt, aspect_ratio: o.aspectRatio, duration: nearest(o.duration, [5, 10]), ...(o.image ? { start_image: o.image } : {}) }),
  },
  'minimax/hailuo-02': {
    label: 'MiniMax Hailuo 02 – realistyczni ludzie, 1080p',
    audio: false,
    build: (o) => ({ prompt: o.prompt, duration: nearest(o.duration, [6, 10]), resolution: '1080p', prompt_optimizer: false, ...(o.image ? { first_frame_image: o.image } : {}) }),
  },
  'bytedance/seedance-1-pro': {
    label: 'Seedance 1 Pro – ujęcia wielokamerowe, 1080p',
    audio: false,
    build: (o) => ({ prompt: o.prompt, duration: Math.max(3, Math.min(12, Math.round(o.duration))), resolution: '1080p', aspect_ratio: o.aspectRatio, ...(o.image ? { image: o.image } : {}) }),
  },
};

export const IMAGE_MODELS = {
  'black-forest-labs/flux-1.1-pro-ultra': {
    label: 'Flux 1.1 Pro Ultra (tryb RAW – fotografia)',
    build: (o) => ({ prompt: o.prompt, aspect_ratio: o.aspectRatio, raw: true, output_format: 'jpg', safety_tolerance: 2 }),
  },
  'google/imagen-4': {
    label: 'Google Imagen 4',
    build: (o) => ({ prompt: o.prompt, aspect_ratio: o.aspectRatio }),
  },
};

function headers() {
  return { Authorization: `Bearer ${config.replicateToken}`, 'Content-Type': 'application/json' };
}

export function findUrl(output) {
  if (!output) return null;
  if (typeof output === 'string') return /^https?:\/\//.test(output) ? output : null;
  if (Array.isArray(output)) {
    for (const x of output) {
      const u = findUrl(x);
      if (u) return u;
    }
    return null;
  }
  if (typeof output === 'object') {
    for (const key of ['video', 'url', 'output', 'audio', 'image']) {
      const u = findUrl(output[key]);
      if (u) return u;
    }
    for (const v of Object.values(output)) {
      const u = findUrl(v);
      if (u) return u;
    }
  }
  return null;
}

export async function runPrediction(model, input, update = () => {}, { timeoutMs = 20 * 60 * 1000 } = {}) {
  if (!config.replicateToken) throw new Error('Brak REPLICATE_API_TOKEN w .env');
  if (!/^[\w.-]+\/[\w.-]+$/.test(model)) throw new Error('Nieprawidłowa nazwa modelu (oczekiwano "właściciel/model")');
  const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  update(`Wysyłam do ${model}…`);
  const res = await fetch(`${API}/models/${model}/predictions`, { method: 'POST', headers: headers(), body: JSON.stringify({ input: clean }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Replicate: ${body.detail || body.title || res.statusText} (HTTP ${res.status})`);
  let pred = body;
  const started = Date.now();
  while (!['succeeded', 'failed', 'canceled'].includes(pred.status)) {
    if (Date.now() - started > timeoutMs) throw new Error('Replicate: przekroczono czas oczekiwania');
    await sleep(3000);
    const r = await fetch(`${API}/predictions/${pred.id}`, { headers: headers() });
    pred = await r.json();
    const secs = Math.round((Date.now() - started) / 1000);
    update(`${pred.status === 'starting' ? 'Uruchamiam model' : 'Generuję'}… ${secs}s`);
  }
  if (pred.status !== 'succeeded') throw new Error(`Replicate: ${pred.error || pred.status}`);
  const url = findUrl(pred.output);
  if (!url) throw new Error('Replicate: model nie zwrócił pliku');
  return url;
}

export async function generateVideo(opts, update) {
  const preset = VIDEO_MODELS[opts.model];
  const input = { ...(preset ? preset.build(opts) : { prompt: opts.prompt }), ...(opts.extraInput || {}) };
  const url = await runPrediction(opts.model, input, update);
  update('Pobieram klip…');
  const saved = await downloadToMedia(url, { prefix: 'video', fallbackExt: '.mp4' });
  return { ...saved, kind: 'video', hasAudio: !!preset?.audio };
}

export async function generateImage(opts, update) {
  const preset = IMAGE_MODELS[opts.model];
  const input = { ...(preset ? preset.build(opts) : { prompt: opts.prompt }), ...(opts.extraInput || {}) };
  const url = await runPrediction(opts.model, input, update, { timeoutMs: 5 * 60 * 1000 });
  update('Pobieram obraz…');
  const saved = await downloadToMedia(url, { prefix: 'image', fallbackExt: '.jpg' });
  return { ...saved, kind: 'image' };
}
