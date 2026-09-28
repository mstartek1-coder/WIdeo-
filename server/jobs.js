// Kolejka zadań generowania (wideo AI trwa od kilkudziesięciu sekund do kilku minut) + zapis plików do /media.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_DIR } from './config.js';

const jobs = new Map();
const MAX_JOBS = 500;

export function createJob(type, meta, run) {
  const job = { id: randomUUID(), type, meta, status: 'running', message: 'Start…', result: null, error: null, createdAt: Date.now(), updatedAt: Date.now() };
  jobs.set(job.id, job);
  if (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    jobs.delete(oldest.id);
  }
  const update = (message) => {
    job.message = message;
    job.updatedAt = Date.now();
  };
  Promise.resolve()
    .then(() => run(update))
    .then((result) => {
      job.status = 'done';
      job.result = result;
      job.message = 'Gotowe';
      job.updatedAt = Date.now();
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err?.message || String(err);
      job.message = 'Błąd';
      job.updatedAt = Date.now();
      console.error(`[job ${job.type}]`, job.error);
    });
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
}

const EXT_BY_TYPE = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
};

export function extensionFor(contentType, fallbackUrl = '', fallback = '.bin') {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (EXT_BY_TYPE[type]) return EXT_BY_TYPE[type];
  const m = /\.(mp4|webm|mov|png|jpe?g|webp|mp3|wav|ogg|m4a)(?:$|\?)/i.exec(fallbackUrl);
  return m ? `.${m[1].toLowerCase().replace('jpeg', 'jpg')}` : fallback;
}

export async function saveMedia(buffer, ext, prefix = 'gen') {
  await mkdir(MEDIA_DIR, { recursive: true });
  const name = `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}${ext}`;
  await writeFile(path.join(MEDIA_DIR, name), buffer);
  return { url: `/media/${name}`, file: name, bytes: buffer.length };
}

// Pobiera wynik z serwera dostawcy i zapisuje lokalnie (linki dostawców wygasają).
export async function downloadToMedia(url, { headers = {}, prefix = 'gen', fallbackExt = '.mp4' } = {}) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Pobieranie wyniku nie powiodło się (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  return saveMedia(buf, extensionFor(res.headers.get('content-type'), url, fallbackExt), prefix);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
