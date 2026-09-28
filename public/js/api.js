// Klient API serwera studia: zadania generowania z odpytywaniem statusu i upload plików.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const isBinary = body instanceof Blob || body instanceof ArrayBuffer;
  const res = await fetch(path, {
    method,
    headers: body && !isBinary ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body && !isBinary ? JSON.stringify(body) : body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function getStatus() {
  try {
    return await api('/api/status');
  } catch {
    return { providers: {}, offline: true };
  }
}

// Uruchamia zadanie i czeka na wynik, raportując postęp.
export async function runJob(path, body, onUpdate = () => {}) {
  let job = await api(path, { method: 'POST', body });
  onUpdate(job);
  while (job.status === 'running') {
    await sleep(job.type === 'director' ? 1200 : 2000);
    job = await api(`/api/jobs/${job.id}`);
    onUpdate(job);
  }
  if (job.status === 'error') throw new Error(job.error || 'Zadanie nie powiodło się');
  return job.result;
}

export function upload(file) {
  return api('/api/upload', { method: 'POST', body: file, headers: { 'X-Filename': encodeURIComponent(file.name) } });
}

// Odczytuje długość pliku wideo/audio (do dopasowania długości sceny).
export function probeDuration(url, kind = 'video') {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata';
    const done = (v) => {
      el.removeAttribute('src');
      resolve(v);
    };
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    el.src = url;
  });
}
