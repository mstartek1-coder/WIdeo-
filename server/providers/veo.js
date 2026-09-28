// Google Veo przez Gemini API – wideo z natywnie generowanym dźwiękiem (dialogi, efekty, ambient).
import { config } from '../config.js';
import { downloadToMedia, sleep } from '../jobs.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export async function generateVideo(opts, update) {
  if (!config.geminiKey) throw new Error('Brak GEMINI_API_KEY w .env');
  const model = opts.model || config.veoModel;
  if (!/^[\w.-]+$/.test(model)) throw new Error('Nieprawidłowa nazwa modelu Veo');
  const headers = { 'x-goog-api-key': config.geminiKey, 'Content-Type': 'application/json' };
  const instance = { prompt: opts.prompt };
  if (opts.imageBase64) instance.image = { bytesBase64Encoded: opts.imageBase64, mimeType: opts.imageMime || 'image/jpeg' };
  const parameters = { aspectRatio: opts.aspectRatio === '9:16' ? '9:16' : '16:9' };
  if (opts.negativePrompt) parameters.negativePrompt = opts.negativePrompt;
  Object.assign(parameters, opts.extraInput || {});
  update(`Wysyłam do ${model}…`);
  const res = await fetch(`${API}/models/${model}:predictLongRunning`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ instances: [instance], parameters }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Veo: ${body.error?.message || res.statusText} (HTTP ${res.status})`);
  let op = body;
  const started = Date.now();
  while (!op.done) {
    if (Date.now() - started > 15 * 60 * 1000) throw new Error('Veo: przekroczono czas oczekiwania');
    await sleep(5000);
    const r = await fetch(`${API}/${op.name}`, { headers });
    op = await r.json();
    if (op.error) break;
    update(`Generuję… ${Math.round((Date.now() - started) / 1000)}s`);
  }
  if (op.error) throw new Error(`Veo: ${op.error.message || 'błąd generowania'}`);
  const sample = op.response?.generateVideoResponse?.generatedSamples?.[0] || op.response?.generatedVideos?.[0];
  const uri = sample?.video?.uri;
  if (!uri) {
    const filtered = op.response?.generateVideoResponse?.raiMediaFilteredReasons;
    throw new Error(`Veo: brak wideo w odpowiedzi${filtered ? ` (filtr treści: ${filtered.join('; ')})` : ''}`);
  }
  update('Pobieram klip…');
  const saved = await downloadToMedia(uri, { headers: { 'x-goog-api-key': config.geminiKey }, prefix: 'veo', fallbackExt: '.mp4' });
  return { ...saved, kind: 'video', hasAudio: true };
}
