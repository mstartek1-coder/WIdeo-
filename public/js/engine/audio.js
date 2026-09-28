// Silnik dźwięku: miksuje ambient scen, dźwięk z klipów AI, lektora, efekty i muzykę
// z automatycznym przyciszaniem muzyki pod lektorem (ducking), crossfade'ami między scenami i limiterem.
// Ten sam harmonogram służy do odtwarzania na żywo i do renderu offline (eksport WAV).

import { layoutScenes, totalDuration } from '../core/timeline.js';
import { generateAmbience, generateMusic } from '../core/synth.js';

const SYNTH_SR = 44100;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.cache = new Map();
    this.pending = new Map();
    this.items = [];
    this.nodes = [];
    this.playing = false;
    this.from = 0;
    this.t0 = 0;
    this.total = 0;
    this.worker = null;
    this.workerJobs = new Map();
    this.workerSeq = 0;
    this.musicVolume = 1;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.15;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.recordDest = ctx.createMediaStreamDestination();
    this.limiter.connect(this.recordDest);
    return ctx;
  }

  async resume() {
    const ctx = this.ensure();
    if (ctx.state !== 'running') await ctx.resume();
  }

  recordStream() {
    this.ensure();
    return this.recordDest.stream;
  }

  // ---------------- Źródła ----------------

  async loadUrl(url) {
    const key = `url:${url}`;
    return this.cached(key, async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      return await this.ensure().decodeAudioData(data);
    });
  }

  async synth(kind, type, duration, seed) {
    const key = `${kind}:${type}:${duration.toFixed(2)}:${seed}`;
    return this.cached(key, async () => {
      const out = await this.runSynth({ kind, type, duration, seed, sampleRate: SYNTH_SR });
      const buf = this.ensure().createBuffer(2, out.left.length, out.sampleRate);
      buf.copyToChannel(out.left, 0);
      buf.copyToChannel(out.right, 1);
      return buf;
    });
  }

  async cached(key, fn) {
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    const p = fn()
      .then((v) => {
        this.cache.set(key, v);
        this.pending.delete(key);
        return v;
      })
      .catch((err) => {
        this.pending.delete(key);
        console.warn('Audio: nie udało się przygotować', key, err);
        this.cache.set(key, null);
        return null;
      });
    this.pending.set(key, p);
    return p;
  }

  runSynth(job) {
    if (!this.worker && this.worker !== false) {
      try {
        this.worker = new Worker(new URL('./synth-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
          const cb = this.workerJobs.get(e.data.id);
          if (!cb) return;
          this.workerJobs.delete(e.data.id);
          if (e.data.error) cb.reject(new Error(e.data.error));
          else cb.resolve(e.data);
        };
        this.worker.onerror = (e) => {
          e?.preventDefault?.();
          // Worker niedostępny (np. zablokowany) – dokończ zadania w głównym wątku.
          const pending = [...this.workerJobs.values()];
          this.workerJobs.clear();
          this.worker = false;
          for (const cb of pending) cb.resolve(synthOnMainThread(cb.job));
        };
      } catch {
        this.worker = false;
      }
    }
    if (this.worker) {
      const id = ++this.workerSeq;
      return new Promise((resolve, reject) => {
        this.workerJobs.set(id, { resolve, reject, job });
        this.worker.postMessage({ id, ...job });
      });
    }
    return Promise.resolve(synthOnMainThread(job));
  }

  // ---------------- Harmonogram ----------------

  async prepare(project, onStatus = () => {}) {
    const layout = layoutScenes(project.scenes);
    const total = totalDuration(layout);
    this.total = total;
    const tasks = [];
    const items = [];
    const add = (promise, meta) =>
      tasks.push(
        promise.then((buffer) => {
          if (buffer) items.push({ buffer, ...meta, duration: Math.min(meta.duration ?? buffer.duration, buffer.duration - (meta.offset || 0)) });
        }),
      );

    for (const e of layout) {
      const s = e.scene;
      const a = s.audio;
      const fadeIn = Math.max(0.25, e.overlapIn);
      const fadeOut = Math.max(0.35, e.overlapOut);
      if (a.ambience && a.ambience !== 'none' && a.ambienceVolume > 0) {
        add(this.synth('ambience', a.ambience, s.duration, Number(s.source.seed) || 1), { start: e.start, offset: 0, duration: s.duration, gain: a.ambienceVolume, fadeIn, fadeOut, bus: 'fx' });
      }
      if (s.source.type === 'media' && s.source.kind === 'video' && s.source.url && a.clipVolume > 0) {
        add(this.loadUrl(s.source.url), { start: e.start, offset: 0, duration: s.duration, gain: a.clipVolume, fadeIn: Math.max(0.05, e.overlapIn), fadeOut: Math.max(0.1, e.overlapOut), bus: 'fx' });
      }
      if (a.voice.url && a.voice.volume > 0) {
        add(this.loadUrl(a.voice.url), { start: e.start + 0.3, offset: 0, gain: a.voice.volume, fadeIn: 0.02, fadeOut: 0.05, bus: 'voice' });
      }
      if (a.sfx.url && a.sfx.volume > 0) {
        add(this.loadUrl(a.sfx.url), { start: e.start + (Number(a.sfx.offset) || 0), offset: 0, gain: a.sfx.volume, fadeIn: 0.05, fadeOut: 0.3, bus: 'fx' });
      }
    }
    const music = project.audio.music;
    if (music.url) {
      add(this.loadUrl(music.url), { start: 0, offset: 0, duration: total, gain: 1, fadeIn: 0.5, fadeOut: 2.5, bus: 'music' });
    } else if (music.mood && music.mood !== 'none' && total > 0) {
      onStatus('Komponuję muzykę…');
      add(this.synth('music', music.mood, total + 1, Number(music.seed) || 7), { start: 0, offset: 0, duration: total, gain: 1, fadeIn: 0.1, fadeOut: 2.5, bus: 'music' });
    }
    await Promise.all(tasks);
    this.items = items;
    this.project = project;
    onStatus('');
    return items.length;
  }

  // Buduje graf audio i planuje wszystkie źródła w kontekście `ctx` od chwili osi czasu `from`.
  schedule(ctx, output, from, now) {
    const project = this.project;
    const nodes = [];
    const master = ctx.createGain();
    master.gain.value = project.audio.master;
    master.connect(output);
    const buses = {
      fx: ctx.createGain(),
      voice: ctx.createGain(),
      music: ctx.createGain(),
    };
    buses.fx.connect(master);
    buses.voice.connect(master);
    const duck = ctx.createGain();
    buses.music.gain.value = project.audio.music.volume * this.musicVolume;
    buses.music.connect(duck);
    duck.connect(master);
    nodes.push(master, duck, ...Object.values(buses));

    // Ducking: przycisz muzykę, gdy mówi lektor.
    const amount = Math.min(0.95, Math.max(0, project.audio.music.duck));
    const voices = this.items.filter((i) => i.bus === 'voice').map((i) => [i.start - 0.25, i.start + i.duration + 0.35]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const v of voices) {
      if (merged.length && v[0] <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], v[1]);
      else merged.push([...v]);
    }
    const duckPts = [[0, 1]];
    for (const [a, b] of merged) duckPts.push([a, 1], [a + 0.25, 1 - amount], [b - 0.35, 1 - amount], [b, 1]);
    applyEnvelope(duck.gain, duckPts, from, now);

    for (const item of this.items) {
      const end = item.start + item.duration;
      if (end <= from + 0.01) continue;
      const src = ctx.createBufferSource();
      src.buffer = item.buffer;
      const g = ctx.createGain();
      src.connect(g);
      g.connect(buses[item.bus] || master);
      const skip = Math.max(0, from - item.start);
      const startAt = now + Math.max(0, item.start - from);
      const fi = Math.min(item.fadeIn, item.duration / 2);
      const fo = Math.min(item.fadeOut, item.duration / 2);
      applyEnvelope(g.gain, [[item.start, 0], [item.start + fi, item.gain], [end - fo, item.gain], [end, 0]], from, now);
      src.start(startAt, item.offset + skip, item.duration - skip);
      nodes.push(src, g);
    }
    return nodes;
  }

  async play(from = 0) {
    await this.resume();
    this.stop();
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.05;
    this.nodes = this.schedule(ctx, this.master, from, now);
    this.from = from;
    this.t0 = now;
    this.playing = true;
  }

  stop() {
    for (const n of this.nodes) {
      try {
        if (n.stop) n.stop();
        n.disconnect();
      } catch {
        /* węzeł już zatrzymany */
      }
    }
    this.nodes = [];
    if (this.playing) this.from = this.time;
    this.playing = false;
  }

  get time() {
    if (!this.playing || !this.ctx) return this.from;
    return this.from + Math.max(0, this.ctx.currentTime - this.t0);
  }

  // Miks offline całego filmu -> AudioBuffer (np. do eksportu WAV).
  async renderOffline(project, sampleRate = 48000) {
    await this.prepare(project);
    const length = Math.max(1, Math.ceil(this.total * sampleRate));
    const off = new OfflineAudioContext(2, length, sampleRate);
    const comp = off.createDynamicsCompressor();
    comp.threshold.value = -3;
    comp.knee.value = 3;
    comp.ratio.value = 20;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    comp.connect(off.destination);
    this.schedule(off, comp, 0, 0);
    return off.startRendering();
  }
}

function synthOnMainThread(job) {
  return job.kind === 'music'
    ? generateMusic(job.type, job.duration, { seed: job.seed, sampleRate: job.sampleRate })
    : generateAmbience(job.type, job.duration, { seed: job.seed, sampleRate: job.sampleRate });
}

// Planuje obwiednię zadaną punktami [czas osi, wartość] względem startu odtwarzania.
export function applyEnvelope(param, points, from, now) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const valueAt = (t) => {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i][0]) {
        const [t0, v0] = pts[i - 1];
        const [t1, v1] = pts[i];
        return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
      }
    }
    return pts[pts.length - 1][1];
  };
  param.cancelScheduledValues(0);
  param.setValueAtTime(valueAt(from), now);
  for (const [t, v] of pts) {
    if (t <= from) continue;
    param.linearRampToValueAtTime(v, now + (t - from));
  }
}
