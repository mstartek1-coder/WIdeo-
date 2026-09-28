// Eksport: film (MP4/WebM z dźwiękiem, nagrywany w czasie rzeczywistym), miks audio WAV, klatka PNG, projekt JSON.

import { encodeWav } from '../core/synth.js';

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640033,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function safeName(name) {
  return (
    String(name || 'film')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l')
      .replace(/Ł/g, 'L')
      .replace(/[^a-zA-Z0-9-_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'film'
  );
}

// Nagrywa film odtwarzając go w czasie rzeczywistym (obraz z canvasu + miks audio).
export async function exportVideo({ renderer, audio, project, onProgress = () => {}, onStatus = () => {}, shouldCancel = () => false }) {
  const mimeType = pickMimeType();
  if (mimeType === null) throw new Error('Ta przeglądarka nie obsługuje MediaRecorder – użyj Chrome lub Edge.');
  onStatus('Wczytuję klipy…');
  await renderer.waitForMedia();
  onStatus('Przygotowuję dźwięk…');
  await audio.prepare(project, onStatus);
  await audio.resume();
  renderer.resize(1);
  const total = renderer.total;
  const videoStream = renderer.canvas.captureStream(project.fps);
  const tracks = [...videoStream.getVideoTracks(), ...audio.recordStream().getAudioTracks()];
  const stream = new MediaStream(tracks);
  const bps = Math.min(80e6, Math.round(project.width * project.height * project.fps * 0.22));
  const rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: bps, audioBitsPerSecond: 256000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));

  // Pierwsza klatka zanim ruszy nagrywanie.
  await renderer.seekExact(0);
  renderer.render(0, { playing: false });
  rec.start(250);
  await audio.play(0);
  onStatus('Nagrywam…');
  let cancelled = false;
  await new Promise((resolve) => {
    const tick = () => {
      if (shouldCancel()) {
        cancelled = true;
        return resolve();
      }
      const t = audio.time;
      renderer.render(Math.min(t, total), { playing: true });
      onProgress(Math.min(1, t / total));
      if (t >= total + 0.15) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  audio.stop();
  rec.stop();
  await stopped;
  videoStream.getTracks().forEach((t) => t.stop());
  if (cancelled) return null;
  const type = (mimeType || 'video/webm').split(';')[0];
  return { blob: new Blob(chunks, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm' };
}

export async function exportWav(audio, project) {
  const buf = await audio.renderOffline(project);
  const chans = [buf.getChannelData(0), buf.getChannelData(1)];
  return new Blob([encodeWav(chans, buf.sampleRate)], { type: 'audio/wav' });
}

export function exportProjectJson(project) {
  return new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
}
