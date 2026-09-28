// Inspektor: edycja sceny (obraz AI, ruch kamery, kolor, dźwięk, przejście), napisu (animacja, keyframe'y) i projektu.

import { h, slider, select, textInput, numberInput, textArea, checkbox, colorInput, group } from './dom.js';
import { PROCEDURAL_PRESETS, AMBIENCES, TRANSITIONS, MUSIC_MOODS, RESOLUTIONS, OVERLAY_ANIMATIONS, parseResolution } from '../core/project.js';
import { CAMERA_MOVES, LENSES, LIGHTING, FILM_LOOKS, STYLES, buildVideoPrompt, buildSfxPrompt } from '../core/prompt.js';
import { easingNames } from '../core/easing.js';
import { layoutScenes } from '../core/timeline.js';
import { setKey } from '../core/keyframes.js';

const MOTION_PRESETS = {
  'Najazd': { from: { zoom: 1, x: 0, y: 0 }, to: { zoom: 1.18, x: 0, y: -0.01 } },
  'Odjazd': { from: { zoom: 1.2, x: 0, y: 0 }, to: { zoom: 1, x: 0, y: 0 } },
  'Panorama →': { from: { zoom: 1.14, x: -0.05, y: 0 }, to: { zoom: 1.14, x: 0.05, y: 0 } },
  'Panorama ←': { from: { zoom: 1.14, x: 0.05, y: 0 }, to: { zoom: 1.14, x: -0.05, y: 0 } },
  'W górę': { from: { zoom: 1.14, x: 0, y: -0.05 }, to: { zoom: 1.14, x: 0, y: 0.05 } },
  'Dryf (z ręki)': { from: { zoom: 1.06, x: -0.012, y: 0.006 }, to: { zoom: 1.08, x: 0.012, y: -0.006 } },
  'Statyczny': { from: { zoom: 1, x: 0, y: 0 }, to: { zoom: 1, x: 0, y: 0 } },
};

const GRADE_PRESETS = {
  'Naturalny': { exposure: 0, contrast: 1.05, saturation: 1.05, temperature: 0, tint: 0 },
  'Kinowy teal & orange': { exposure: 0.05, contrast: 1.15, saturation: 1.12, temperature: 0.3, tint: -0.15 },
  'Ciepły zachód': { exposure: 0.1, contrast: 1.08, saturation: 1.15, temperature: 0.55, tint: 0.05 },
  'Chłodny noir': { exposure: -0.15, contrast: 1.28, saturation: 0.35, temperature: -0.35, tint: 0 },
  'Wyblakły film': { exposure: 0.05, contrast: 0.86, saturation: 0.82, temperature: 0.12, tint: 0.05 },
  'Bleach bypass': { exposure: 0, contrast: 1.32, saturation: 0.55, temperature: 0, tint: 0 },
};

const fmt1 = (v) => (+v).toFixed(1);
const fmt2 = (v) => (+v).toFixed(2);

export function renderInspector(root, ctx) {
  const { selection } = ctx.state;
  if (selection.type === 'scene') {
    const scene = ctx.project.scenes.find((s) => s.id === selection.id);
    if (scene) return root.replaceChildren(...sceneInspector(scene, ctx));
  }
  if (selection.type === 'overlay') {
    const o = ctx.project.overlays.find((x) => x.id === selection.id);
    if (o) return root.replaceChildren(...overlayInspector(o, ctx));
  }
  root.replaceChildren(...projectInspector(ctx));
}

// ------------------------------------------------------------------ Scena

function sceneInspector(scene, ctx) {
  const id = scene.id;
  const edit = (fn, opts) => ctx.change((p) => fn(p.scenes.find((s) => s.id === id)), opts);
  const live = (fn) => ctx.live((p) => fn(p.scenes.find((s) => s.id === id)));
  const P = ctx.providers;
  const ai = ctx.project.ai;
  const aiVideoOk = ai.videoProvider === 'veo' ? P.veo?.available : P.replicate?.available;
  const jobMsg = ctx.jobs.get(id);
  const supportsAudio = ai.videoProvider === 'veo' || (P.replicate?.videoModels || []).some((m) => m.id === ai.videoModel && m.audio);
  const fullPrompt = buildVideoPrompt(scene.prompt, { withAudio: supportsAudio });
  const isImage = scene.source.type === 'media' && scene.source.kind === 'image';

  const header = group(
    'Scena',
    textInput('Nazwa', scene.name, (v) => edit((s) => (s.name = v), { lists: true })),
    numberInput('Długość (s)', scene.duration, (v) => edit((s) => (s.duration = Math.max(0.5, Math.min(120, v || 5))), { lists: true }), { min: 0.5, max: 120, step: 0.1 }),
  );

  // --- Obraz
  const media = scene.source.type === 'media'
    ? h('div', { class: 'media-card' },
      scene.source.kind === 'image' ? h('img', { src: scene.source.url, alt: '' }) : h('video', { src: scene.source.url, muted: true, preload: 'metadata' }),
      h('div', {},
        h('div', {}, scene.source.kind === 'image' ? 'Zdjęcie' : 'Klip wideo'),
        h('div', { class: 'name' }, scene.source.name || scene.source.url),
        h('div', { class: 'row' },
          scene.source.kind === 'video' ? h('button', { class: 'small', onclick: () => ctx.actions.fitToClip(id) }, 'Dopasuj długość') : null,
          h('button', { class: 'small danger', onclick: () => ctx.actions.removeMedia(id) }, 'Usuń'),
        ),
      ))
    : null;

  const visual = group(
    'Obraz',
    media,
    scene.source.type !== 'media'
      ? [
        select('Tło proceduralne', scene.source.preset, PROCEDURAL_PRESETS, (v) => edit((s) => {
          s.source.preset = v;
          const amb = PROCEDURAL_PRESETS[v].ambience;
          if (amb) s.audio.ambience = amb;
        }, { refresh: true })),
        slider('Wariant (seed)', scene.source.seed, { min: 1, max: 99, step: 1, format: (v) => String(v), onInput: (v) => live((s) => (s.source.seed = v)), onChange: (v) => edit((s) => (s.source.seed = v)) }),
        h('p', { class: 'hint' }, 'Tło proceduralne działa offline i zastępuje klip, dopóki nie wygenerujesz lub nie wgrasz materiału.'),
      ]
      : null,
    h('div', { class: 'row' },
      h('button', { onclick: () => ctx.actions.uploadMedia(id) }, '⤒ Wgraj wideo/zdjęcie'),
    ),
  );

  // --- Prompt AI
  const promptGroup = group(
    'Generowanie AI (hiperrealizm)',
    textArea('Co widać w ujęciu (najlepiej po angielsku)', scene.prompt.subject, (v) => edit((s) => (s.prompt.subject = v), { refresh: true }), { rows: 3, placeholder: 'np. An elderly fisherman mending nets on a wooden pier, weathered hands, morning mist over the harbour' }),
    select('Ruch kamery', scene.prompt.camera, CAMERA_MOVES, (v) => edit((s) => (s.prompt.camera = v), { refresh: true })),
    select('Obiektyw', scene.prompt.lens, LENSES, (v) => edit((s) => (s.prompt.lens = v), { refresh: true })),
    select('Światło', scene.prompt.lighting, LIGHTING, (v) => edit((s) => (s.prompt.lighting = v), { refresh: true })),
    select('Kamera / taśma', scene.prompt.film, FILM_LOOKS, (v) => edit((s) => (s.prompt.film = v), { refresh: true })),
    select('Styl', scene.prompt.style, STYLES, (v) => edit((s) => (s.prompt.style = v), { refresh: true })),
    supportsAudio ? textArea('Dźwięk w klipie (Veo 3 generuje go natywnie)', scene.prompt.audio, (v) => edit((s) => (s.prompt.audio = v), { refresh: true }), { rows: 2, placeholder: 'np. seagulls, creaking wood, soft waves; he mutters "almost done"' }) : null,
    h('details', {}, h('summary', { class: 'muted' }, 'Pełny prompt'), h('div', { class: 'prompt-preview' }, fullPrompt), h('div', { class: 'row' }, h('button', { class: 'small', onclick: () => {
      const done = () => ctx.toast('Skopiowano prompt', 'ok');
      const fallback = () => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('#inspector .prompt-preview'));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        ctx.toast('Prompt zaznaczony – skopiuj go skrótem Ctrl+C.');
      };
      try {
        navigator.clipboard.writeText(fullPrompt).then(done, fallback);
      } catch {
        fallback();
      }
    } }, 'Kopiuj'))),
    h('div', { class: 'row fill' },
      h('button', { class: 'primary', disabled: !aiVideoOk || !!jobMsg, title: aiVideoOk ? `${ai.videoProvider === 'veo' ? 'Veo' : ai.videoModel}` : 'Dodaj klucz API w .env', onclick: () => ctx.actions.generateVideo(id, { animate: false }) }, isImage ? '▶ Wideo z promptu' : '▶ Generuj wideo AI'),
      h('button', { disabled: !P.replicate?.available || !!jobMsg, title: 'Fotorealistyczne zdjęcie, które animujesz ruchem kamery lub modelem image→video', onclick: () => ctx.actions.generateImage(id) }, '▣ Zdjęcie AI'),
    ),
    isImage ? h('div', { class: 'row fill' }, h('button', { disabled: !aiVideoOk || !!jobMsg, onclick: () => ctx.actions.generateVideo(id, { animate: true }) }, '✦ Animuj to zdjęcie (image→video)')) : null,
    h('div', { class: `status-line ${jobMsg?.error ? 'err' : ''}` }, jobMsg ? jobMsg.text : ''),
    !aiVideoOk
      ? h('p', { class: 'hint' }, ctx.embedded
        ? 'W aplikacji Claude generowanie klipów jest wyłączone – skopiuj pełny prompt do Veo/Kling albo uruchom studio lokalnie z kluczami API (README). Wgrany klip od razu trafi do montażu.'
        : 'Generowanie wideo wymaga klucza REPLICATE_API_TOKEN lub GEMINI_API_KEY w pliku .env (zob. README). Model wybierzesz w zakładce Projekt.')
      : null,
  );

  // --- Ruch kamery
  const m = scene.motion;
  const motionSliders = (which) => [
    slider(`${which === 'from' ? 'Start' : 'Koniec'}: zoom`, m[which].zoom, { min: 1, max: 1.6, step: 0.01, onInput: (v) => live((s) => (s.motion[which].zoom = v)), onChange: (v) => edit((s) => (s.motion[which].zoom = v)) }),
    slider(`${which === 'from' ? 'Start' : 'Koniec'}: X`, m[which].x, { min: -0.15, max: 0.15, step: 0.005, format: fmt2, onInput: (v) => live((s) => (s.motion[which].x = v)), onChange: (v) => edit((s) => (s.motion[which].x = v)) }),
    slider(`${which === 'from' ? 'Start' : 'Koniec'}: Y`, m[which].y, { min: -0.15, max: 0.15, step: 0.005, format: fmt2, onInput: (v) => live((s) => (s.motion[which].y = v)), onChange: (v) => edit((s) => (s.motion[which].y = v)) }),
  ];
  const motion = group(
    'Ruch kamery w montażu',
    h('div', { class: 'chips' }, Object.entries(MOTION_PRESETS).map(([name, preset]) => h('button', { onclick: () => edit((s) => Object.assign(s.motion, structuredClone(preset)), { refresh: true }) }, name))),
    motionSliders('from'),
    motionSliders('to'),
    select('Krzywa ruchu', m.ease, easingNames.map((e) => ({ value: e, label: e })), (v) => edit((s) => (s.motion.ease = v))),
  );

  // --- Kolor
  const g = scene.grade;
  const gradeSlider = (label, key, min, max, step = 0.01) =>
    slider(label, g[key], { min, max, step, onInput: (v) => live((s) => (s.grade[key] = v)), onChange: (v) => edit((s) => (s.grade[key] = v)) });
  const color = group(
    'Korekcja barwna',
    h('div', { class: 'chips' }, Object.entries(GRADE_PRESETS).map(([name, preset]) => h('button', { onclick: () => edit((s) => Object.assign(s.grade, preset), { refresh: true }) }, name))),
    gradeSlider('Ekspozycja', 'exposure', -2, 2),
    gradeSlider('Kontrast', 'contrast', 0.5, 1.6),
    gradeSlider('Nasycenie', 'saturation', 0, 2),
    gradeSlider('Temperatura', 'temperature', -1, 1),
    gradeSlider('Odcień', 'tint', -1, 1),
  );

  // --- Dźwięk
  const a = scene.audio;
  const audioSlider = (label, get, set, max = 1.5) =>
    slider(label, get(scene), { min: 0, max, step: 0.01, onInput: (v) => live((s) => set(s, v)), onChange: (v) => edit((s) => set(s, v)) });
  const sound = group(
    'Dźwięk sceny',
    select('Ambient', a.ambience, AMBIENCES, (v) => edit((s) => (s.audio.ambience = v))),
    audioSlider('Głośność ambientu', (s) => s.audio.ambienceVolume, (s, v) => (s.audio.ambienceVolume = v)),
    scene.source.type === 'media' && scene.source.kind === 'video' ? audioSlider('Dźwięk klipu', (s) => s.audio.clipVolume, (s, v) => (s.audio.clipVolume = v)) : null,
    textArea('Lektor (tekst = także napisy)', a.voice.text, (v) => edit((s) => (s.audio.voice.text = v), { lists: true }), { rows: 3, placeholder: 'Tekst, który przeczyta lektor…' }),
    h('div', { class: 'row' },
      h('button', { disabled: !P.elevenlabs?.available || !a.voice.text.trim(), onclick: () => ctx.actions.generateVoice(id), title: P.elevenlabs?.available ? '' : 'Wymaga ELEVENLABS_API_KEY' }, '🎙 Nagraj lektora AI'),
      h('button', { onclick: () => ctx.actions.uploadAudio(id, 'voice') }, '⤒ Wgraj'),
      a.voice.url ? h('button', { class: 'small danger', onclick: () => edit((s) => { s.audio.voice.url = ''; s.audio.voice.duration = 0; }, { refresh: true }) }, 'Usuń nagranie') : null,
    ),
    a.voice.url ? h('audio', { src: a.voice.url, controls: true, style: { width: '100%', height: '32px' } }) : null,
    a.voice.url ? audioSlider('Głośność lektora', (s) => s.audio.voice.volume, (s, v) => (s.audio.voice.volume = v), 2) : null,
    textArea('Efekt dźwiękowy (opis)', a.sfx.prompt || '', (v) => edit((s) => (s.audio.sfx.prompt = v)), { rows: 2, placeholder: buildSfxPrompt(scene) }),
    h('div', { class: 'row' },
      h('button', { disabled: !P.elevenlabs?.available, onclick: () => ctx.actions.generateSfx(id) }, '🔊 Generuj efekt AI'),
      h('button', { onclick: () => ctx.actions.uploadAudio(id, 'sfx') }, '⤒ Wgraj'),
      a.sfx.url ? h('button', { class: 'small danger', onclick: () => edit((s) => (s.audio.sfx.url = ''), { refresh: true }) }, 'Usuń') : null,
    ),
    a.sfx.url ? [
      audioSlider('Głośność efektu', (s) => s.audio.sfx.volume, (s, v) => (s.audio.sfx.volume = v), 2),
      slider('Przesunięcie (s)', a.sfx.offset, { min: 0, max: scene.duration, step: 0.1, format: fmt1, onInput: (v) => live((s) => (s.audio.sfx.offset = v)), onChange: (v) => edit((s) => (s.audio.sfx.offset = v)) }),
    ] : null,
    jobMsg ? h('div', { class: `status-line ${jobMsg.error ? 'err' : ''}` }, jobMsg.text) : null,
  );

  // --- Przejście
  const isLast = ctx.project.scenes[ctx.project.scenes.length - 1]?.id === id;
  const trans = group(
    isLast ? 'Zakończenie filmu' : 'Przejście do następnej sceny',
    select('Typ', scene.transition.type, TRANSITIONS, (v) => edit((s) => { s.transition.type = v; if (v !== 'cut' && !s.transition.duration) s.transition.duration = 1; }, { refresh: true, lists: true })),
    scene.transition.type !== 'cut'
      ? slider('Czas (s)', scene.transition.duration, { min: 0.1, max: 4, step: 0.1, format: fmt1, onInput: (v) => live((s) => (s.transition.duration = v)), onChange: (v) => edit((s) => (s.transition.duration = v), { lists: true }) })
      : null,
    isLast ? h('p', { class: 'hint' }, '„Przez czerń” w ostatniej scenie = wyciemnienie na końcu filmu.') : null,
  );

  return [header, visual, promptGroup, motion, color, sound, trans];
}

// ------------------------------------------------------------------ Napis

function overlayInspector(o, ctx) {
  const id = o.id;
  const edit = (fn, opts) => ctx.change((p) => fn(p.overlays.find((x) => x.id === id)), opts);
  const live = (fn) => ctx.live((p) => fn(p.overlays.find((x) => x.id === id)));
  const st = o.style;
  const local = Math.max(0, Math.min(o.end - o.start, ctx.state.time - o.start));
  const keyProps = { x: 'Pozycja X', y: 'Pozycja Y', opacity: 'Krycie', scale: 'Skala', rotation: 'Obrót (°)', tracking: 'Rozstrzelenie', reveal: 'Odkrycie tekstu' };
  let keyProp = 'opacity';
  let keyEase = 'easeInOutCubic';
  const keyValue = h('input', { type: 'number', step: 0.01, value: 1 });

  const custom = Object.entries(o.customTracks || {}).filter(([, tr]) => Array.isArray(tr) && tr.length);
  return [
    group(
      'Napis',
      textArea('Tekst', o.text, (v) => edit((x) => (x.text = v), { lists: true }), { rows: 2 }),
      numberInput('Początek (s)', o.start, (v) => edit((x) => { x.start = Math.max(0, v); x.end = Math.max(x.start + 0.2, x.end); }, { lists: true }), { step: 0.1, min: 0 }),
      numberInput('Koniec (s)', o.end, (v) => edit((x) => (x.end = Math.max(x.start + 0.2, v)), { lists: true }), { step: 0.1, min: 0 }),
      select('Animacja', o.animation, OVERLAY_ANIMATIONS, (v) => edit((x) => (x.animation = v))),
      slider('Pozycja X', o.position.x, { min: 0, max: 1, onInput: (v) => live((x) => (x.position.x = v)), onChange: (v) => edit((x) => (x.position.x = v)) }),
      slider('Pozycja Y', o.position.y, { min: 0, max: 1, onInput: (v) => live((x) => (x.position.y = v)), onChange: (v) => edit((x) => (x.position.y = v)) }),
    ),
    group(
      'Typografia',
      select('Krój', st.font, { serif: 'Szeryfowy (kinowy)', sans: 'Bezszeryfowy', mono: 'Monospace' }, (v) => edit((x) => (x.style.font = v))),
      slider('Wielkość', st.size, { min: 0.015, max: 0.25, step: 0.001, format: (v) => `${Math.round(v * 1000) / 10}%`, onInput: (v) => live((x) => (x.style.size = v)), onChange: (v) => edit((x) => (x.style.size = v)) }),
      select('Grubość', st.weight, { 400: 'Normalna', 500: 'Średnia', 600: 'Półgruba', 700: 'Gruba' }, (v) => edit((x) => (x.style.weight = Number(v)))),
      slider('Rozstrzelenie', st.tracking, { min: 0, max: 0.6, onInput: (v) => live((x) => (x.style.tracking = v)), onChange: (v) => edit((x) => (x.style.tracking = v)) }),
      select('Wyrównanie', st.align, { center: 'Do środka', left: 'Do lewej', right: 'Do prawej' }, (v) => edit((x) => (x.style.align = v))),
      colorInput('Kolor', st.color, (v) => edit((x) => (x.style.color = v))),
      h('div', { class: 'row' }, checkbox('Cień', st.shadow, (v) => edit((x) => (x.style.shadow = v))), checkbox('Tło', st.box, (v) => edit((x) => (x.style.box = v)))),
    ),
    group(
      'Własne klucze animacji',
      h('p', { class: 'hint' }, `Klucz zostanie dodany w chwili ${local.toFixed(2)} s napisu (pozycja głowicy). Własne klucze zastępują daną właściwość z presetu animacji.`),
      select('Właściwość', keyProp, keyProps, (v) => (keyProp = v)),
      h('label', { class: 'field' }, h('span', {}, 'Wartość'), keyValue),
      select('Krzywa', keyEase, easingNames.map((e) => ({ value: e, label: e })), (v) => (keyEase = v)),
      h('div', { class: 'row' }, h('button', {
        onclick: () => edit((x) => {
          x.customTracks = x.customTracks || {};
          x.customTracks[keyProp] = setKey(x.customTracks[keyProp], Math.round(local * 100) / 100, Number(keyValue.value), keyEase);
        }, { refresh: true }),
      }, '◆ Dodaj klucz'),
      custom.length ? h('button', { class: 'small danger', onclick: () => edit((x) => (x.customTracks = {}), { refresh: true }) }, 'Wyczyść wszystkie') : null),
      custom.map(([prop, tr]) => h('div', {},
        h('div', { class: 'muted' }, keyProps[prop] || prop),
        h('ul', { class: 'keys' }, tr.map((k, i) => h('li', {}, `${k.t.toFixed(2)} s → ${k.v} (${k.ease || 'linear'})`, h('button', { class: 'small ghost', onclick: () => edit((x) => x.customTracks[prop].splice(i, 1), { refresh: true }) }, '✕')))),
      )),
    ),
    h('div', { class: 'row end' }, h('button', { class: 'danger', onclick: () => ctx.actions.deleteOverlay(id) }, 'Usuń napis')),
  ];
}

// ------------------------------------------------------------------ Projekt

function projectInspector(ctx) {
  const p = ctx.project;
  const edit = (fn, opts) => ctx.change(fn, opts);
  const live = (fn) => ctx.live(fn);
  const P = ctx.providers;
  const look = p.look;
  const lookSlider = (label, key, max = 1) =>
    slider(label, look[key], { min: 0, max, onInput: (v) => live((q) => (q.look[key] = v)), onChange: (v) => edit((q) => (q.look[key] = v)) });
  const resKey = `${p.width}x${p.height}`;
  const resOptions = { ...RESOLUTIONS };
  if (!resOptions[resKey]) resOptions[resKey] = `Własna ${resKey}`;
  const videoModels = [
    ...(P.replicate?.videoModels || []).map((m) => ({ value: `replicate|${m.id}`, label: `Replicate · ${m.label}` })),
    { value: `veo|${P.veo?.model || 'veo-3.0-generate-001'}`, label: `Gemini API · Google Veo (${P.veo?.model || 'veo'})` },
  ];
  const curModel = `${p.ai.videoProvider}|${p.ai.videoModel}`;
  if (!videoModels.some((m) => m.value === curModel)) videoModels.push({ value: curModel, label: `Własny: ${p.ai.videoModel}` });
  const provider = (name, ok, extra = '') => h('div', { class: 'provider' }, h('span', { class: `dot ${ok ? 'on' : ''}` }), name, extra ? h('span', { class: 'muted' }, extra) : null);

  return [
    group(
      'Dostawcy AI',
      provider('Reżyser – Claude', P.director?.available, P.director?.viaApp ? 'przez aplikację Claude' : P.director?.model),
      provider('Replicate – wideo i zdjęcia', P.replicate?.available),
      provider('Google Veo – wideo z dźwiękiem', P.veo?.available),
      provider('ElevenLabs – lektor, SFX, muzyka', P.elevenlabs?.available),
      provider('Silnik proceduralny + syntezator', true, 'offline'),
      ctx.offline
        ? h('p', { class: 'hint' }, ctx.embedded
          ? 'Wersja w aplikacji Claude: tła, dźwięk, montaż i eksport działają od razu. Klipy AI, lektor i efekty wymagają uruchomienia studia lokalnie z kluczami API (README w repozytorium).'
          : 'Brak połączenia z serwerem – uruchom „npm start”.')
        : null,
    ),
    group(
      'Modele AI',
      select('Model wideo', curModel, videoModels, (v) => {
        const [prov, ...rest] = v.split('|');
        edit((q) => { q.ai.videoProvider = prov; q.ai.videoModel = rest.join('|'); }, { refresh: true });
      }),
      textInput('Własny model', p.ai.videoProvider === 'replicate' ? p.ai.videoModel : '', (v) => v.trim() && edit((q) => { q.ai.videoProvider = 'replicate'; q.ai.videoModel = v.trim(); }, { refresh: true }), { placeholder: 'właściciel/model z Replicate' }),
      select('Model zdjęć', p.ai.imageModel, (P.replicate?.imageModels || [{ id: p.ai.imageModel, label: p.ai.imageModel }]).map((m) => ({ value: m.id, label: m.label })), (v) => edit((q) => (q.ai.imageModel = v))),
      textInput('Głos (ID)', p.ai.voiceId, (v) => edit((q) => (q.ai.voiceId = v.trim())), { placeholder: `domyślny: ${P.elevenlabs?.voice || '—'}` }),
      textInput('Język lektora', p.ai.language, (v) => edit((q) => (q.ai.language = v))),
    ),
    group(
      'Format',
      select('Rozdzielczość', resKey, resOptions, (v) => edit((q) => Object.assign(q, parseResolution(v)), { refresh: true, resize: true })),
      select('Klatki/s', p.fps, { 24: '24 (kino)', 25: '25 (PAL)', 30: '30', 50: '50', 60: '60' }, (v) => edit((q) => (q.fps = Number(v)))),
      select('Jakość tła proc.', p.renderScale, { 1: 'Pełna', 0.75: '75%', 0.5: '50% (szybciej)' }, (v) => edit((q) => (q.renderScale = Number(v)))),
    ),
    group(
      'Look filmowy',
      lookSlider('Ziarno', 'grain'),
      lookSlider('Winieta', 'vignette'),
      lookSlider('Aberracja', 'aberration'),
      lookSlider('Poświata (bloom)', 'bloom'),
      lookSlider('Wyostrzenie', 'sharpen'),
      select('Kasety kinowe', look.letterbox, { 0: 'Brak', 1.85: '1.85:1', 2: '2:1 (Univisium)', 2.39: '2.39:1 (anamorfot)' }, (v) => edit((q) => (q.look.letterbox = Number(v)))),
      checkbox('Wejście i wyjście z czerni', look.fadeInOut !== false, (v) => edit((q) => (q.look.fadeInOut = v))),
    ),
    group(
      'Muzyka i miks',
      select('Muzyka (syntezator)', p.audio.music.mood, MUSIC_MOODS, (v) => edit((q) => (q.audio.music.mood = v), { lists: true })),
      h('div', { class: 'row' },
        h('button', { onclick: () => edit((q) => (q.audio.music.seed = Math.floor(Math.random() * 9999) + 1)) }, '🎲 Nowa melodia'),
        h('button', { onclick: () => ctx.actions.uploadMusic() }, '⤒ Wgraj muzykę'),
        p.audio.music.url ? h('button', { class: 'small danger', onclick: () => edit((q) => (q.audio.music.url = ''), { refresh: true, lists: true }) }, 'Usuń plik') : null,
      ),
      p.audio.music.url ? h('audio', { src: p.audio.music.url, controls: true, style: { width: '100%', height: '32px' } }) : null,
      textArea('Muzyka AI – opis', p.audio.music.prompt || '', (v) => edit((q) => (q.audio.music.prompt = v)), { rows: 2, placeholder: 'np. slow cinematic orchestral score, warm strings, hopeful, builds to a gentle climax' }),
      h('div', { class: 'row' }, h('button', { disabled: !P.elevenlabs?.available, onclick: () => ctx.actions.generateMusic() }, '♫ Skomponuj muzykę AI')),
      slider('Głośność muzyki', p.audio.music.volume, { min: 0, max: 1.5, onInput: (v) => live((q) => (q.audio.music.volume = v)), onChange: (v) => edit((q) => (q.audio.music.volume = v)) }),
      slider('Ściszanie pod lektorem', p.audio.music.duck, { min: 0, max: 0.9, onChange: (v) => edit((q) => (q.audio.music.duck = v)) }),
      slider('Głośność całości', p.audio.master, { min: 0, max: 1.5, onChange: (v) => edit((q) => (q.audio.master = v)) }),
    ),
    group(
      'Napisy dialogowe',
      checkbox('Pokazuj tekst lektora jako napisy', p.subtitles.enabled, (v) => edit((q) => (q.subtitles.enabled = v))),
      slider('Wielkość', p.subtitles.size, { min: 0.02, max: 0.08, step: 0.001, onInput: (v) => live((q) => (q.subtitles.size = v)), onChange: (v) => edit((q) => (q.subtitles.size = v)) }),
    ),
    group(
      'Statystyki',
      h('p', { class: 'muted' }, `${p.scenes.length} scen · ${layoutScenes(p.scenes).reduce((a, e) => Math.max(a, e.end), 0).toFixed(1)} s · ${p.overlays.length} napisów`),
      h('p', { class: 'hint' }, 'Skróty: Spacja – odtwarzanie, ←/→ – klatka, Home – początek, Ctrl+Z / Ctrl+Shift+Z – cofnij/ponów, Delete – usuń zaznaczone, Ctrl+kółko na osi – zoom.'),
    ),
  ];
}

