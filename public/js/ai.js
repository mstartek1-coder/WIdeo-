// Jedno wejście do Claude dla przeglądarki: w aplikacji Claude – konto oglądającego (bez kluczy),
// lokalnie – serwer studia z ANTHROPIC_API_KEY.

import { platform } from './platform.js';
import { runJob } from './api.js';

export function claudeAvailable(providers) {
  return !!platform.sample || !!providers?.director?.available;
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function canSendImages() {
  if (platform.sample) {
    const limits = await platform.sample.limits().catch(() => null);
    return !!limits?.images;
  }
  return true;
}

// Zwraca pełny tekst odpowiedzi. Błędy aplikacji Claude mają pole `code` (np. 'cancelled').
export async function askClaude(prompt, { image, signal, onText } = {}) {
  if (platform.sample) {
    const res = await platform.sample(prompt, { modelTier: 'complex', cache: false, signal, onText, ...(image ? { images: image } : {}) });
    return res.text;
  }
  const body = { prompt };
  if (image) body.imageBase64 = await blobToBase64(image);
  const res = await runJob('/api/claude', body, () => {
    if (signal?.aborted) throw Object.assign(new Error('Przerwano'), { code: 'cancelled' });
  });
  return res.text;
}
