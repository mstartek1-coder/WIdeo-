// WIdeo Studio – główny kontroler: stan projektu, historia, odtwarzanie, reżyser, generowanie AI i eksport.

import { h, toast, pickFile, select } from './dom.js';
import { TimelineView } from './timeline-view.js';
import { renderInspector } from './inspector.js';
import { Renderer } from '../engine/renderer.js';
import { AudioEngine } from '../engine/audio.js';
import { exportVideo, exportWav, exportProjectJson, saveFile, canSaveWav, safeName } from '../engine/exporter.js';
import { createProject, createScene, createOverlay, createDemoProject, normalizeProject, aspectLabel, PROCEDURAL_PRESETS } from '../core/project.js';
import { layoutScenes, totalDuration, formatTime } from '../core/timeline.js';
import { buildVideoPrompt, buildImagePrompt, buildSfxPrompt, NEGATIVE_PROMPT, STYLES } from '../core/prompt.js';
import { offlineStoryboard, projectFromDirector } from '../core/storyboard.js';
import { getStatus, runJob, upload, probeDuration } from '../api.js';
import { platform, platformReady, sampleErrorMessage } from '../platform.js';
import { directorPromptWithSchema, sanitizePlan } from '../core/director-prompt.js';

const STORAGE_KEY = 'wideo-studio-project-v1';
const $ = (id) => document.getElementById(id);

const state = {
  selection: { type: 'project', id: null },
  time: 0,
  playing: false,
  loop: false,
  exporting: false,
  previewScale: 0.5,
  idea: '',
  sceneCount: 5,
  style: 'cinematic',
};

let project = null;
let providers = {};
let offline = false;
let renderer = null;
let audio = null;
let timeline = null;
let needsRender = true;
let audioDirty = true;
let saveTimer = null;
let cancelExport = false;
const history = { past: [], future: [] };
const sceneJobs = new Map();
const jobLog = [];

// ------------------------------------------------------------------ Stan i historia

function layout() {
  return layoutScenes(project.scenes);
}

function total() {
  return totalDuration(project.scenes);
}

function snapshot() {
  return JSON.stringify(project);
}

function pushHistory() {
  history.past.push(snapshot());
  if (history.past.length > 120) history.past.shift();
  history.future = [];
}

// Zmiana z zapisem w historii. opts.refresh – przebuduj inspektor.
function change(fn, opts = {}) {
  pushHistory();
  fn(project);
  afterChange(opts);
}

// Zmiana "na żywo" (np. przeciąganie suwaka) – bez historii i bez przebudowy paneli.
function live(fn) {
  fn(project);
  renderer?.setProject(project);
  audioDirty = true;
  needsRender = true;
}

function replaceProject(next, { keepHistory = true } = {}) {
  if (keepHistory && project) pushHistory();
  project = next;
  state.time = Math.min(state.time, total());
  if (!findSelected()) state.selection = { type: 'project', id: null };
  afterChange({ refresh: true });
}

function afterChange(opts = {}) {
  renderer?.setProject(project);
  renderer?.resize(state.previewScale);
  audioDirty = true;
  needsRender = true;
  if (state.time > total()) state.time = total();
  scheduleSave();
  renderTopbar();
  renderScenes();
  renderTimeline();
  if (opts.refresh) renderInspectorPanel();
  if (state.playing) restartAudio();
}

function undo() {
  if (!history.past.length) return;
  history.future.push(snapshot());
  project = JSON.parse(history.past.pop());
  if (!findSelected()) state.selection = { type: 'project', id: null };
  afterChange({ refresh: true });
}

function redo() {
  if (!history.future.length) return;
  history.past.push(snapshot());
  project = JSON.parse(history.future.pop());
  if (!findSelected()) state.selection = { type: 'project', id: null };
  afterChange({ refresh: true });
}

function findSelected() {
  const sel = state.selection;
  if (sel.type === 'scene') return project.scenes.find((s) => s.id === sel.id);
  if (sel.type === 'overlay') return project.overlays.find((o) => o.id === sel.id);
  return project;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      /* brak dostępu do localStorage – projekt nadal można zapisać do pliku */
    }
  }, 400);
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? dropSessionFiles(normalizeProject(JSON.parse(raw))) : null;
  } catch {
    return null;
  }
}

// Pliki wgrane bez serwera żyją tylko do odświeżenia strony – po ponownym wczytaniu wracamy do tła proceduralnego.
function dropSessionFiles(p) {
  const isBlob = (u) => typeof u === 'string' && u.startsWith('blob:');
  for (const s of p.scenes) {
    if (s.source.type === 'media' && isBlob(s.source.url)) s.source = { type: 'procedural', preset: s.source.preset || 'ocean', seed: s.source.seed || 1 };
    for (const slot of ['voice', 'sfx']) if (isBlob(s.audio[slot].url)) s.audio[slot].url = '';
  }
  if (isBlob(p.audio.music.url)) p.audio.music.url = '';
  return p;
}

function select_(sel) {
  state.selection = sel;
  renderScenes();
  renderTimeline();
  renderInspectorPanel();
}

// ------------------------------------------------------------------ Odtwarzanie

async function play() {
  if (state.playing || state.exporting) return;
  if (state.time >= total() - 0.05) state.time = 0;
  if (audioDirty) {
    busy('Przygotowuję dźwięk…');
    try {
      await audio.prepare(project, (m) => m && busy(m));
      audioDirty = false;
    } finally {
      busy('');
    }
  }
  await audio.play(state.time);
  state.playing = true;
  $('btn-play').textContent = '❚❚';
}

function pause() {
  audio.stop();
  state.playing = false;
  $('btn-play').textContent = '▶';
  needsRender = true;
}

async function restartAudio() {
  if (!state.playing) return;
  const t = audio.time;
  await audio.prepare(project);
  audioDirty = false;
  if (state.playing) await audio.play(t);
}

function seek(t) {
  state.time = Math.max(0, Math.min(total(), t));
  if (state.playing) audio.play(state.time);
  needsRender = true;
}

function frame() {
  requestAnimationFrame(frame);
  if (state.exporting || !renderer) return;
  if (state.playing) {
    let t = audio.time;
    const end = total();
    if (t >= end) {
      if (state.loop) {
        audio.play(0);
        t = 0;
      } else {
        pause();
        t = end;
      }
    }
    state.time = t;
    needsRender = true;
  }
  if (needsRender) {
    needsRender = false;
    try {
      renderer.render(state.time, { playing: state.playing });
    } catch (err) {
      console.error(err);
    }
    $('tc-now').textContent = formatTime(state.time, project.fps);
    timeline.setTime(state.time);
    const cur = layout().filter((e) => state.time >= e.start && state.time < e.end).pop();
    $('hud').textContent = `${renderer.canvas.width}×${renderer.canvas.height} · ${renderer.fps.toFixed(0)} fps${cur ? ` · ${cur.index + 1}. ${cur.scene.name}` : ''}`;
  }
}

function busy(msg, onStop) {
  const el = $('busy');
  el.hidden = !msg;
  el.replaceChildren(msg || '');
  if (msg && onStop) el.append(h('button', { class: 'small', onclick: onStop }, 'Zatrzymaj'));
}

// ------------------------------------------------------------------ Panele

function renderTopbar() {
  const name = $('project-name');
  if (document.activeElement !== name) name.value = project.name;
  $('tc-total').textContent = formatTime(total(), project.fps);
  document.querySelector('[data-action=undo]').disabled = !history.past.length;
  document.querySelector('[data-action=redo]').disabled = !history.future.length;
}

function renderTimeline() {
  const busyIds = new Set([...sceneJobs.entries()].filter(([, j]) => !j.error).map(([id]) => id));
  timeline.render(project, layout(), total(), state.selection, busyIds);
  timeline.setTime(state.time);
}

function renderDirector() {
  const P = providers;
  const idea = h('textarea', { rows: 4, placeholder: 'Opisz pomysł na film – 2–6 zdań. Każde zdanie to potencjalna scena.\nnp. Samotna latarniczka zapala światło o zmierzchu. Sztorm uderza w skały. Rano na plaży znajduje butelkę z listem.', oninput: (e) => (state.idea = e.target.value) });
  idea.value = state.idea;
  const count = h('input', { type: 'number', min: 1, max: 20, value: state.sceneCount, style: { width: '64px' }, onchange: (e) => (state.sceneCount = Math.max(1, Math.min(20, Number(e.target.value) || 5))) });
  $('director').replaceChildren(
    h('h2', {}, 'Reżyser'),
    idea,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Scen'), count, select(null, state.style, STYLES, (v) => (state.style = v), { style: { flex: '1', width: 'auto' } })),
    h('div', { class: 'row fill' },
      h('button', { class: 'primary', disabled: !P.director?.available, title: P.director?.available ? `Claude (${P.director.model}) napisze scenopis z promptami i lektorem` : 'Dodaj ANTHROPIC_API_KEY w .env', onclick: () => runDirector(true) }, '✦ Reżyseruj z AI'),
      h('button', { title: 'Scenopis bez API – działa od razu', onclick: () => runDirector(false) }, 'Offline'),
    ),
    h('div', { class: 'row fill' },
      h('button', { disabled: !(P.replicate?.available || P.veo?.available || P.elevenlabs?.available), title: 'Wygeneruj wideo AI dla scen bez materiału i nagraj lektora', onclick: generateAll }, '⚡ Generuj wszystko AI'),
    ),
  );
}

function renderScenes() {
  const L = layout();
  const list = h('ol', { class: 'scene-list' },
    L.map((e) => {
      const s = e.scene;
      const job = sceneJobs.get(s.id);
      const kind = s.source.type === 'media' ? s.source.kind : 'proc';
      const selected = state.selection.type === 'scene' && state.selection.id === s.id;
      return h('li', {
        class: `scene-item ${selected ? 'selected' : ''}`,
        onclick: () => {
          select_({ type: 'scene', id: s.id });
          seek(e.start + 0.001);
        },
      },
      h('span', { class: 'scene-num' }, e.index + 1),
      h('div', {},
        h('div', { class: 'scene-name' }, s.name),
        h('div', { class: 'scene-meta' },
          h('span', {}, `${s.duration.toFixed(1)} s`),
          h('span', { class: `badge ${kind === 'proc' ? 'proc' : kind}` }, kind === 'proc' ? PROCEDURAL_PRESETS[s.source.preset]?.label.split(' ')[0] || 'proc' : kind === 'video' ? 'wideo' : 'zdjęcie'),
          s.audio.voice.url ? h('span', { class: 'badge' }, '🎙') : null,
          s.audio.sfx.url ? h('span', { class: 'badge' }, 'SFX') : null,
          job && !job.error ? h('span', { class: 'badge job' }, '⏳ AI') : null,
          job?.error ? h('span', { class: 'badge', title: job.text, style: { color: 'var(--err)' } }, 'błąd') : null,
        ),
      ),
      h('div', { class: 'scene-tools' },
        h('button', { title: 'W górę', onclick: (ev) => { ev.stopPropagation(); moveScene(s.id, -1); } }, '↑'),
        h('button', { title: 'W dół', onclick: (ev) => { ev.stopPropagation(); moveScene(s.id, 1); } }, '↓'),
        h('button', { title: 'Duplikuj', onclick: (ev) => { ev.stopPropagation(); duplicateScene(s.id); } }, '⧉'),
        h('button', { title: 'Usuń', class: 'danger', onclick: (ev) => { ev.stopPropagation(); deleteScene(s.id); } }, '✕'),
      ));
    }),
  );
  $('scenes').replaceChildren(
    h('h2', {}, `Sceny (${project.scenes.length})`, h('span', { class: 'spacer' }),
      h('button', { class: 'small', onclick: addScene, title: 'Dodaj scenę' }, '+ Scena'),
      h('button', { class: 'small', onclick: addOverlay, title: 'Dodaj napis w miejscu głowicy' }, '+ Napis')),
    project.scenes.length ? list : h('p', { class: 'hint' }, 'Brak scen. Dodaj scenę albo użyj reżysera.'),
  );
}

function renderJobs() {
  if (!jobLog.length) {
    $('jobs').replaceChildren(h('h2', {}, 'Zadania AI'), h('p', { class: 'hint' }, 'Tu pojawią się generowane klipy, głosy i efekty.'));
    return;
  }
  $('jobs').replaceChildren(
    h('h2', {}, 'Zadania AI'),
    h('ul', { class: 'jobs-list' }, jobLog.slice(0, 30).map((j) => h('li', {}, h('span', {}, j.label), h('span', { class: `st-${j.status}`, title: j.message }, j.status === 'running' ? j.message : j.status === 'done' ? '✔ gotowe' : '✕ błąd')))),
  );
}

function renderInspectorPanel() {
  const sel = state.selection;
  const tabs = [
    { type: 'scene', label: 'Scena', disabled: !project.scenes.length },
    { type: 'overlay', label: 'Napis', disabled: !project.overlays.length },
    { type: 'project', label: 'Projekt' },
  ];
  $('inspector-tabs').replaceChildren(...tabs.map((t) => h('button', {
    class: sel.type === t.type ? 'active' : '',
    disabled: t.disabled,
    role: 'tab',
    onclick: () => {
      if (t.type === 'project') return select_({ type: 'project', id: null });
      const pool = t.type === 'scene' ? project.scenes : project.overlays;
      const current = pool.find((x) => x.id === sel.id) || (t.type === 'scene' ? sceneAtTime() : pool[0]);
      if (current) select_({ type: t.type, id: current.id });
    },
  }, t.label)));
  renderInspector($('inspector'), {
    project,
    state,
    providers,
    offline,
    embedded: platform.embedded,
    jobs: sceneJobs,
    change,
    live,
    toast,
    actions,
  });
}

function sceneAtTime() {
  const e = layout().filter((x) => state.time >= x.start && state.time < x.end).pop();
  return e ? e.scene : project.scenes[0];
}

function renderAll() {
  renderTopbar();
  renderDirector();
  renderScenes();
  renderTimeline();
  renderInspectorPanel();
  renderJobs();
}

// ------------------------------------------------------------------ Operacje na scenach i napisach

const PRESET_CYCLE = Object.keys(PROCEDURAL_PRESETS);

function addScene() {
  const idx = state.selection.type === 'scene' ? project.scenes.findIndex((s) => s.id === state.selection.id) + 1 : project.scenes.length;
  const preset = PRESET_CYCLE[project.scenes.length % PRESET_CYCLE.length];
  const scene = createScene({ name: `Scena ${project.scenes.length + 1}`, source: { type: 'procedural', preset, seed: Math.floor(Math.random() * 90) + 1 }, audio: { ambience: PROCEDURAL_PRESETS[preset].ambience } });
  change((p) => p.scenes.splice(idx || p.scenes.length, 0, scene));
  select_({ type: 'scene', id: scene.id });
}

function duplicateScene(id) {
  const i = project.scenes.findIndex((s) => s.id === id);
  if (i < 0) return;
  const copy = createScene({ ...structuredClone(project.scenes[i]), id: undefined, name: `${project.scenes[i].name} (kopia)` });
  change((p) => p.scenes.splice(i + 1, 0, copy));
  select_({ type: 'scene', id: copy.id });
}

function deleteScene(id) {
  change((p) => (p.scenes = p.scenes.filter((s) => s.id !== id)));
  if (state.selection.id === id) select_({ type: 'project', id: null });
}

function moveScene(id, dir) {
  const i = project.scenes.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= project.scenes.length) return;
  change((p) => ([p.scenes[i], p.scenes[j]] = [p.scenes[j], p.scenes[i]]));
}

function addOverlay() {
  const start = Math.min(state.time, Math.max(0, total() - 1));
  const o = createOverlay({ text: 'Nowy napis', start, end: Math.min(start + 3.5, Math.max(start + 1, total())), animation: 'fade-up', position: { x: 0.5, y: 0.78 }, style: { font: 'sans', size: 0.05, weight: 600, tracking: 0.04 } });
  change((p) => p.overlays.push(o));
  select_({ type: 'overlay', id: o.id });
}

function deleteOverlay(id) {
  change((p) => (p.overlays = p.overlays.filter((o) => o.id !== id)));
  select_({ type: 'project', id: null });
}

function sceneById(id) {
  return project.scenes.find((s) => s.id === id);
}

// ------------------------------------------------------------------ Zadania AI

function setSceneJob(id, text, error = false) {
  if (text === null) sceneJobs.delete(id);
  else sceneJobs.set(id, { text, error });
  renderScenes();
  if (state.selection.type === 'scene' && state.selection.id === id) {
    const line = document.querySelector('#inspector .status-line');
    if (line && text !== null && !error) line.textContent = text;
    else renderInspectorPanel();
  }
}

async function tracked(label, sceneId, path, body) {
  const entry = { label, status: 'running', message: 'Start…' };
  jobLog.unshift(entry);
  renderJobs();
  if (sceneId) setSceneJob(sceneId, 'Wysyłam…');
  try {
    const result = await runJob(path, body, (job) => {
      entry.message = job.message;
      renderJobs();
      if (sceneId) setSceneJob(sceneId, job.message);
    });
    entry.status = 'done';
    renderJobs();
    if (sceneId) sceneJobs.delete(sceneId);
    return result;
  } catch (err) {
    entry.status = 'error';
    entry.message = err.message;
    renderJobs();
    if (sceneId) setSceneJob(sceneId, err.message, true);
    toast(`${label}: ${err.message}`, 'err', 8000);
    throw err;
  }
}

function applyToScene(id, fn, label) {
  const scene = sceneById(id);
  if (!scene) return toast(`${label}: scena została usunięta – wynik zachowano w folderze media/.`, 'err');
  change((p) => fn(p.scenes.find((s) => s.id === id)), { refresh: true });
}

async function fitSceneToAudio(id, url, extra = 0.8) {
  const d = await probeDuration(url, 'audio');
  if (!d) return 0;
  const scene = sceneById(id);
  if (scene && d + extra > scene.duration) live((p) => (p.scenes.find((s) => s.id === id).duration = Math.ceil((d + extra) * 10) / 10));
  return d;
}

let warnedSessionFiles = false;

// Bez serwera plik zostaje w pamięci przeglądarki (działa do odświeżenia strony).
async function uploadFile(file) {
  if (!offline) return upload(file);
  if (!warnedSessionFiles) {
    warnedSessionFiles = true;
    toast('Plik działa w tej sesji – po odświeżeniu strony trzeba go wgrać ponownie.', 'info', 7000);
  }
  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video';
  return { url: URL.createObjectURL(file), file: file.name, kind };
}

const actions = {
  deleteOverlay,

  async generateVideo(id, { animate = false } = {}) {
    const scene = sceneById(id);
    if (!scene) return;
    const ai = project.ai;
    const supportsAudio = ai.videoProvider === 'veo' || (providers.replicate?.videoModels || []).some((m) => m.id === ai.videoModel && m.audio);
    const body = {
      provider: ai.videoProvider,
      model: ai.videoModel,
      prompt: buildVideoPrompt(scene.prompt, { withAudio: supportsAudio }),
      negativePrompt: NEGATIVE_PROMPT,
      aspectRatio: aspectLabel(project.width, project.height),
      duration: scene.duration,
      imageUrl: animate && scene.source.kind === 'image' ? scene.source.url : undefined,
    };
    try {
      const res = await tracked(`Wideo: ${scene.name}`, id, '/api/generate/video', body);
      const dur = await probeDuration(res.url, 'video');
      applyToScene(id, (s) => {
        s.source = { type: 'media', kind: 'video', url: res.url, name: `${res.file}`, preset: s.source.preset, seed: s.source.seed };
        if (dur) s.duration = Math.round(dur * 10) / 10;
        if (res.hasAudio) s.audio.ambienceVolume = Math.min(s.audio.ambienceVolume, 0.2);
      }, 'Wideo');
      toast(`Klip gotowy: ${scene.name}`, 'ok');
    } catch {
      /* błąd pokazany w tracked() */
    }
  },

  async generateImage(id) {
    const scene = sceneById(id);
    if (!scene) return;
    try {
      const res = await tracked(`Zdjęcie: ${scene.name}`, id, '/api/generate/image', {
        model: project.ai.imageModel,
        prompt: buildImagePrompt(scene.prompt),
        aspectRatio: aspectLabel(project.width, project.height),
      });
      applyToScene(id, (s) => (s.source = { type: 'media', kind: 'image', url: res.url, name: res.file, preset: s.source.preset, seed: s.source.seed }), 'Zdjęcie');
      toast('Zdjęcie gotowe – ruch kamery ożywi je w montażu, a „Animuj” zamieni je w wideo.', 'ok', 6000);
    } catch {
      /* błąd pokazany w tracked() */
    }
  },

  async generateVoice(id) {
    const scene = sceneById(id);
    if (!scene || !scene.audio.voice.text.trim()) return;
    try {
      const res = await tracked(`Lektor: ${scene.name}`, id, '/api/generate/voice', { text: scene.audio.voice.text, voiceId: project.ai.voiceId || undefined });
      const d = await probeDuration(res.url, 'audio');
      applyToScene(id, (s) => {
        s.audio.voice.url = res.url;
        s.audio.voice.duration = d || 0;
        if (d && d + 0.8 > s.duration) s.duration = Math.ceil((d + 0.8) * 10) / 10;
      }, 'Lektor');
    } catch {
      /* błąd pokazany w tracked() */
    }
  },

  async generateSfx(id) {
    const scene = sceneById(id);
    if (!scene) return;
    try {
      const res = await tracked(`SFX: ${scene.name}`, id, '/api/generate/sfx', { prompt: buildSfxPrompt(scene), duration: Math.min(22, scene.duration) });
      const d = await probeDuration(res.url, 'audio');
      applyToScene(id, (s) => {
        s.audio.sfx.url = res.url;
        s.audio.sfx.duration = d || 0;
      }, 'SFX');
    } catch {
      /* błąd pokazany w tracked() */
    }
  },

  async generateMusic() {
    const m = project.audio.music;
    const prompt = (m.prompt || '').trim() || `Cinematic ${m.mood === 'none' ? 'emotional' : m.mood} film score for "${project.name}", orchestral, professional mix, no vocals`;
    try {
      const res = await tracked('Muzyka AI', null, '/api/generate/music', { prompt, duration: Math.ceil(total()) + 2 });
      change((p) => (p.audio.music.url = res.url), { refresh: true });
      toast('Muzyka gotowa', 'ok');
    } catch {
      /* błąd pokazany w tracked() */
    }
  },

  async uploadMedia(id) {
    const file = await pickFile('video/*,image/*');
    if (!file) return;
    busy(`Wgrywam ${file.name}…`);
    try {
      const res = await uploadFile(file);
      const dur = res.kind === 'video' ? await probeDuration(res.url, 'video') : null;
      applyToScene(id, (s) => {
        s.source = { type: 'media', kind: res.kind === 'image' ? 'image' : 'video', url: res.url, name: file.name, preset: s.source.preset, seed: s.source.seed };
        if (dur) s.duration = Math.round(dur * 10) / 10;
      }, 'Upload');
    } catch (err) {
      toast(`Upload: ${err.message}`, 'err');
    } finally {
      busy('');
    }
  },

  async uploadAudio(id, slot) {
    const file = await pickFile('audio/*');
    if (!file) return;
    busy(`Wgrywam ${file.name}…`);
    try {
      const res = await uploadFile(file);
      const d = await probeDuration(res.url, 'audio');
      applyToScene(id, (s) => {
        s.audio[slot].url = res.url;
        s.audio[slot].duration = d || 0;
        if (slot === 'voice' && d && d + 0.8 > s.duration) s.duration = Math.ceil((d + 0.8) * 10) / 10;
      }, 'Upload');
    } catch (err) {
      toast(`Upload: ${err.message}`, 'err');
    } finally {
      busy('');
    }
  },

  async uploadMusic() {
    const file = await pickFile('audio/*');
    if (!file) return;
    busy(`Wgrywam ${file.name}…`);
    try {
      const res = await uploadFile(file);
      change((p) => (p.audio.music.url = res.url), { refresh: true });
    } catch (err) {
      toast(`Upload: ${err.message}`, 'err');
    } finally {
      busy('');
    }
  },

  removeMedia(id) {
    change((p) => {
      const s = p.scenes.find((x) => x.id === id);
      s.source = { type: 'procedural', preset: s.source.preset && PROCEDURAL_PRESETS[s.source.preset] ? s.source.preset : 'ocean', seed: s.source.seed || 1 };
    }, { refresh: true });
  },

  async fitToClip(id) {
    const s = sceneById(id);
    if (!s || s.source.type !== 'media') return;
    const d = await probeDuration(s.source.url, 'video');
    if (d) change((p) => (p.scenes.find((x) => x.id === id).duration = Math.round(d * 10) / 10), { refresh: true });
  },
};

async function generateAll() {
  const canVideo = project.ai.videoProvider === 'veo' ? providers.veo?.available : providers.replicate?.available;
  const canVoice = providers.elevenlabs?.available;
  const tasks = [];
  for (const s of project.scenes) {
    if (canVideo && s.source.type !== 'media' && !sceneJobs.has(s.id)) tasks.push(() => actions.generateVideo(s.id));
  }
  for (const s of project.scenes) {
    if (canVoice && s.audio.voice.text.trim() && !s.audio.voice.url) tasks.push(() => actions.generateVoice(s.id));
  }
  if (!tasks.length) return toast('Nie ma nic do wygenerowania (wszystkie sceny mają materiał i nagranego lektora).');
  toast(`Startuję ${tasks.length} zadań AI – możesz dalej pracować.`, 'ok');
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]();
  };
  await Promise.all([worker(), worker(), worker()]);
  toast('Zadania AI zakończone.', 'ok');
}

async function runDirector(useAi) {
  const idea = state.idea.trim();
  if (!idea && useAi) return toast('Najpierw opisz pomysł na film.', 'err');
  const keep = { width: project.width, height: project.height, fps: project.fps, look: project.look, ai: project.ai, subtitles: project.subtitles, renderScale: project.renderScale };
  let next;
  if (useAi) {
    const request = { idea, sceneCount: state.sceneCount, style: state.style, aspect: aspectLabel(project.width, project.height), language: project.ai.language };
    let plan;
    if (providers.director?.viaApp) {
      const ctl = new AbortController();
      busy('Reżyser AI pisze scenopis… (zwykle do minuty)', () => ctl.abort());
      try {
        plan = sanitizePlan(await platform.sample.json(directorPromptWithSchema(request), { signal: ctl.signal, cache: false }));
        if (!plan.scenes.length) throw { code: 'invalid_json' };
      } catch (err) {
        if (err?.code !== 'cancelled') toast(sampleErrorMessage(err), 'err', 8000);
        if (['not_granted', 'sampling_disabled', 'capability_disabled', 'capability_removed', 'not_declared'].includes(err?.code)) {
          providers.director = { available: false };
          renderDirector();
        }
        return;
      } finally {
        busy('');
      }
    } else {
      busy('Reżyser AI pisze scenopis…');
      try {
        plan = (await tracked('Scenopis (Claude)', null, '/api/director', request)).plan;
      } catch {
        return;
      } finally {
        busy('');
      }
    }
    next = projectFromDirector(plan);
    if (plan.musicPrompt) next.audio.music.prompt = plan.musicPrompt;
    toast(`Scenopis gotowy: „${plan.title}”${plan.logline ? ` – ${plan.logline}` : ''}`, 'ok', 8000);
  } else {
    next = offlineStoryboard(idea, { sceneCount: state.sceneCount, style: state.style });
  }
  const music = next.audio.music;
  Object.assign(next, structuredClone(keep));
  next.audio.music = music;
  state.time = 0;
  replaceProject(next);
  select_({ type: 'scene', id: next.scenes[0]?.id });
}

// ------------------------------------------------------------------ Eksport

async function doExportVideo() {
  if (state.playing) pause();
  if (!project.scenes.length) return toast('Projekt nie ma scen.', 'err');
  const dlg = $('export-dialog');
  cancelExport = false;
  $('export-title').textContent = `Eksport: ${project.name}`;
  $('export-bar').style.width = '0%';
  dlg.showModal();
  state.exporting = true;
  try {
    const res = await exportVideo({
      renderer,
      audio,
      project,
      onProgress: (p) => ($('export-bar').style.width = `${(p * 100).toFixed(1)}%`),
      onStatus: (s) => ($('export-status').textContent = s),
      shouldCancel: () => cancelExport,
    });
    audioDirty = false;
    dlg.close();
    if (res && (await saveFile(res.blob, `${safeName(project.name)}.${res.ext}`)) === 'saved') {
      toast(`Film zapisany (${(res.blob.size / 1e6).toFixed(1)} MB, ${res.ext.toUpperCase()})`, 'ok', 6000);
    }
  } catch (err) {
    toast(`Eksport nie powiódł się: ${err.message}`, 'err', 8000);
  } finally {
    state.exporting = false;
    dlg.close();
    renderer.resize(state.previewScale);
    needsRender = true;
  }
}

async function doExportWav() {
  busy('Miksuję dźwięk…');
  try {
    const blob = await exportWav(audio, project);
    audioDirty = false;
    busy('');
    await saveFile(blob, `${safeName(project.name)}.wav`);
  } catch (err) {
    toast(`Eksport audio: ${err.message}`, 'err');
  } finally {
    busy('');
  }
}

async function doSnapshot() {
  if (state.playing) pause();
  renderer.resize(1);
  await renderer.seekExact(state.time);
  renderer.render(state.time);
  const blob = await renderer.snapshot();
  renderer.resize(state.previewScale);
  needsRender = true;
  if (!blob) return;
  try {
    await saveFile(blob, `${safeName(project.name)}_${state.time.toFixed(2).replace('.', '_')}s.png`);
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ------------------------------------------------------------------ Start

function bindUi() {
  document.querySelector('.actions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'undo') undo();
    else if (a === 'redo') redo();
    else if (a === 'new') replaceProject(createProject({ name: 'Nowy film', scenes: [{ name: 'Scena 1' }], ai: project.ai }));
    else if (a === 'demo') replaceProject(createDemoProject());
    else if (a === 'save') saveFile(exportProjectJson(project), `${safeName(project.name)}.wideo.json`).catch((err) => toast(err.message, 'err'));
    else if (a === 'snapshot') doSnapshot();
    else if (a === 'export-wav') doExportWav();
    else if (a === 'export-video') doExportVideo();
  });
  $('open-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      replaceProject(normalizeProject(JSON.parse(await file.text())));
      toast(`Wczytano „${project.name}”`, 'ok');
    } catch (err) {
      toast(`Nie udało się wczytać projektu: ${err.message}`, 'err');
    }
  });
  $('project-name').addEventListener('change', (e) => change((p) => (p.name = e.target.value.trim() || 'Mój film')));
  $('btn-play').addEventListener('click', () => (state.playing ? pause() : play()));
  $('btn-start').addEventListener('click', () => seek(0));
  $('chk-loop').addEventListener('change', (e) => (state.loop = e.target.checked));
  $('sel-quality').addEventListener('change', (e) => {
    state.previewScale = Number(e.target.value);
    renderer.resize(state.previewScale);
    needsRender = true;
  });
  $('export-cancel').addEventListener('click', () => (cancelExport = true));
  $('export-dialog').addEventListener('cancel', (e) => {
    e.preventDefault();
    cancelExport = true;
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y' && !typing) {
      e.preventDefault();
      redo();
      return;
    }
    if (typing || state.exporting) return;
    if (e.code === 'Space') {
      e.preventDefault();
      state.playing ? pause() : play();
    } else if (e.key === 'ArrowRight') seek(state.time + (e.shiftKey ? 1 : 1 / project.fps));
    else if (e.key === 'ArrowLeft') seek(state.time - (e.shiftKey ? 1 : 1 / project.fps));
    else if (e.key === 'Home') seek(0);
    else if (e.key === 'End') seek(total());
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selection.type === 'scene') deleteScene(state.selection.id);
      else if (state.selection.type === 'overlay') deleteOverlay(state.selection.id);
    }
  });
}

async function init() {
  project = loadSaved() || createDemoProject();
  audio = new AudioEngine();
  timeline = new TimelineView($('timeline'), {
    onSeek: seek,
    onSelect: (sel) => select_(sel),
    onZoom: () => renderTimeline(),
    onOverlayTime: (id, start, end, commit) => {
      if (commit) {
        // Wartości już ustawione na żywo – zapisz stan sprzed przeciągania do historii.
        const o = project.overlays.find((x) => x.id === id);
        const cur = { start: o.start, end: o.end };
        Object.assign(o, dragOrigin.overlay || cur);
        dragOrigin.overlay = null;
        change((p) => Object.assign(p.overlays.find((x) => x.id === id), cur), { refresh: true });
      } else {
        const o = project.overlays.find((x) => x.id === id);
        if (!dragOrigin.overlay) dragOrigin.overlay = { start: o.start, end: o.end };
        live((p) => Object.assign(p.overlays.find((x) => x.id === id), { start, end }));
      }
    },
    onSceneDuration: (id, duration, commit) => {
      const s = sceneById(id);
      if (!s) return;
      if (commit) {
        const cur = s.duration;
        s.duration = dragOrigin.scene ?? cur;
        dragOrigin.scene = null;
        change((p) => (p.scenes.find((x) => x.id === id).duration = cur), { refresh: true });
      } else {
        if (dragOrigin.scene == null) dragOrigin.scene = s.duration;
        live((p) => (p.scenes.find((x) => x.id === id).duration = duration));
        $('tc-total').textContent = formatTime(total(), project.fps);
      }
    },
  });
  try {
    renderer = new Renderer($('view'));
    renderer.onFrame = () => (needsRender = true);
    renderer.setProject(project);
    renderer.resize(state.previewScale);
  } catch (err) {
    $('viewer').append(h('div', { class: 'busy' }, err.message));
    console.error(err);
  }
  bindUi();
  renderAll();
  requestAnimationFrame(frame);
  const status = await getStatus();
  providers = status.providers || {};
  offline = !!status.offline;
  renderAll();
  await platformReady;
  if (!providers.director?.available && platform.sample) providers.director = { available: true, viaApp: true, model: 'Claude' };
  document.querySelector('[data-action=export-wav]').hidden = !(await canSaveWav());
  renderAll();
  // Kompilacja pozostałych shaderów w tle, żeby przełączanie scen było płynne.
  setTimeout(() => {
    try {
      renderer?.warmUp();
    } catch (err) {
      console.error(err);
      toast(err.message, 'err', 10000);
    }
  }, 300);
}

const dragOrigin = { overlay: null, scene: null };

init();
