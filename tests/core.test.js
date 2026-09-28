import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ease, cubicBezier, easingNames } from '../public/js/core/easing.js';
import { sampleTrack, setKey, interpolateValue } from '../public/js/core/keyframes.js';
import { createProject, createScene, normalizeProject, createDemoProject, mergeDefaults } from '../public/js/core/project.js';
import { layoutScenes, totalDuration, compositeAt, cameraAt, overlaysAt, subtitleAt, splitSubtitle, formatTime, globalFade } from '../public/js/core/timeline.js';
import { buildVideoPrompt, buildImagePrompt, NEGATIVE_PROMPT } from '../public/js/core/prompt.js';
import { offlineStoryboard, splitIdea, guessEnvironment, projectFromDirector } from '../public/js/core/storyboard.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('easingi zaczynają w 0 i kończą w 1', () => {
  for (const name of easingNames) {
    close(ease(name, 0), name === 'step' ? 0 : 0, 1e-6);
    close(ease(name, 1), 1, 1e-6);
  }
  close(ease('linear', 0.25), 0.25);
  assert.ok(ease('easeInCubic', 0.5) < 0.5);
  assert.ok(ease('easeOutCubic', 0.5) > 0.5);
});

test('cubicBezier(0,0,1,1) jest liniowy', () => {
  const f = cubicBezier(0, 0, 1, 1);
  for (const x of [0.1, 0.3, 0.5, 0.9]) close(f(x), x, 1e-4);
});

test('keyframe: interpolacja liczb, wektorów i kolorów', () => {
  const tr = [{ t: 0, v: 0, ease: 'linear' }, { t: 2, v: 10 }];
  close(sampleTrack(tr, -1), 0);
  close(sampleTrack(tr, 1), 5);
  close(sampleTrack(tr, 5), 10);
  assert.deepEqual(interpolateValue([0, 10], [10, 20], 0.5), [5, 15]);
  assert.equal(interpolateValue('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(sampleTrack([], 1, 42), 42);
});

test('setKey nadpisuje klucz w tej samej chwili i sortuje', () => {
  let tr = setKey([], 2, 5);
  tr = setKey(tr, 0, 1);
  tr = setKey(tr, 2, 7);
  assert.deepEqual(tr.map((k) => [k.t, k.v]), [[0, 1], [2, 7]]);
});

test('mergeDefaults uzupełnia braki i zachowuje dodatkowe pola', () => {
  const m = mergeDefaults({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 5 }, extra: true });
  assert.deepEqual(m, { a: 1, b: { c: 5, d: 3 }, extra: true });
});

test('układ scen uwzględnia zakładki przejść', () => {
  const scenes = [
    createScene({ duration: 5, transition: { type: 'crossfade', duration: 1 } }),
    createScene({ duration: 4, transition: { type: 'cut', duration: 1 } }),
    createScene({ duration: 3, transition: { type: 'crossfade', duration: 10 } }),
  ];
  const layout = layoutScenes(scenes);
  assert.deepEqual(layout.map((e) => e.start), [0, 4, 8]);
  close(totalDuration(scenes), 11);
  // W połowie przenikania obie sceny są widoczne.
  const layers = compositeAt(layout, 4.5);
  assert.equal(layers.length, 2);
  close(layers[1].opacity, 0.5, 1e-6);
  // Cięcie – tylko jedna warstwa.
  assert.equal(compositeAt(layout, 8).length, 1);
  // Koniec filmu nadal zwraca ostatnią klatkę.
  assert.equal(compositeAt(layout, 11).length, 1);
});

test('zakładka nie przekracza połowy krótszej sceny', () => {
  const scenes = [createScene({ duration: 2, transition: { type: 'crossfade', duration: 5 } }), createScene({ duration: 6 })];
  const layout = layoutScenes(scenes);
  close(layout[0].overlapOut, 1);
});

test('przejście przez czerń gasi scenę wychodzącą', () => {
  const scenes = [createScene({ duration: 4, transition: { type: 'fade-black', duration: 2 } }), createScene({ duration: 4 })];
  const layout = layoutScenes(scenes);
  const mid = compositeAt(layout, 3); // p = 0.5
  close(mid[0].brightness, 0, 1e-6);
  const late = compositeAt(layout, 3.5);
  assert.ok(late[1].brightness > 0 && late[1].opacity === 1);
});

test('ruch kamery interpoluje od from do to', () => {
  const s = createScene({ duration: 4, motion: { from: { zoom: 1, x: 0, y: 0 }, to: { zoom: 2, x: 1, y: 0 }, ease: 'linear' } });
  const c = cameraAt(s, 2);
  close(c.zoom, 1.5);
  close(c.x, 0.5);
});

test('globalFade', () => {
  close(globalFade(0, 10), 0);
  close(globalFade(5, 10), 1);
  close(globalFade(10, 10), 0);
  close(globalFade(0, 10, false), 1);
});

test('napisy: animacje i napisy dialogowe', () => {
  const p = createDemoProject();
  const active = overlaysAt(p.overlays, 3);
  assert.ok(active.length >= 1);
  for (const a of active) assert.ok(a.opacity >= 0 && a.opacity <= 1);
  const layout = layoutScenes(p.scenes);
  assert.ok(typeof subtitleAt(layout, 3) === 'string');
  assert.equal(subtitleAt(layout, 0.05), null);
  const chunks = splitSubtitle('To jest bardzo długie zdanie, które zdecydowanie przekracza limit długości jednej linii napisów dialogowych w filmie.', 40);
  assert.ok(chunks.length >= 3 && chunks.every((c) => c.length <= 40));
});

test('normalizeProject przycina wartości i naprawia złe dane', () => {
  const p = normalizeProject({ width: 99999, fps: 'abc', scenes: [{ duration: -5, transition: { type: 'xyz' }, source: { type: 'procedural', preset: 'nope' } }] });
  assert.equal(p.width, 4096);
  assert.equal(p.fps, 30);
  assert.equal(p.scenes[0].duration, 0.5);
  assert.equal(p.scenes[0].transition.type, 'crossfade');
  assert.equal(p.scenes[0].source.preset, 'ocean');
});

test('projekt demo ma sensowną długość', () => {
  const p = createDemoProject();
  const total = totalDuration(p.scenes);
  assert.ok(total > 20 && total < 30, `total=${total}`);
  for (const o of p.overlays) assert.ok(o.end <= total + 1e-6, `${o.text} kończy się po filmie`);
});

test('prompt hiperrealistyczny zawiera kamerę, obiektyw, światło i dźwięk', () => {
  const s = buildVideoPrompt({ subject: 'A fisherman mending nets', camera: 'handheld', lens: '85mm', lighting: 'golden-hour', film: 'kodak-500t', style: 'documentary', audio: 'seagulls and waves' });
  assert.match(s, /fisherman/);
  assert.match(s, /handheld/);
  assert.match(s, /85mm/);
  assert.match(s, /golden hour/);
  assert.match(s, /Kodak/);
  assert.match(s, /Audio: seagulls and waves\./);
  assert.match(s, /Photorealistic/);
  assert.doesNotMatch(buildVideoPrompt({ subject: 'x', audio: 'y' }, { withAudio: false }), /Audio:/);
  assert.match(buildImagePrompt({ subject: 'a cat' }), /raw photo/);
  assert.match(NEGATIVE_PROMPT, /watermark/);
});

test('reżyser offline: podział pomysłu i dobór środowiska', () => {
  assert.deepEqual(splitIdea('Raz. Dwa! Trzy?'), ['Raz.', 'Dwa!', 'Trzy?']);
  assert.equal(splitIdea('a\nb\nc\nd', 2).length, 2);
  assert.equal(guessEnvironment('Fale uderzają o brzeg morza').preset, 'ocean');
  assert.equal(guessEnvironment('Nocne miasto w deszczu i neony').preset, 'rain');
  const p = offlineStoryboard('Samotny żeglarz płynie przez ocean. Nad nim przelatują chmury. Nocą pojawia się zorza. Na końcu patrzy w gwiazdy i kosmos.');
  assert.equal(p.scenes.length, 4);
  assert.equal(p.scenes[0].source.preset, 'ocean');
  assert.equal(p.scenes[2].source.preset, 'aurora');
  assert.equal(p.scenes.at(-1).transition.type, 'fade-black');
  assert.ok(p.scenes.every((s) => s.audio.voice.text.length > 0));
  const one = offlineStoryboard('Jedno zdanie.', { sceneCount: 3 });
  assert.equal(one.scenes.length, 3);
  assert.equal(one.scenes.filter((s) => s.audio.voice.text).length, 1);
  assert.equal(offlineStoryboard('Raz. Dwa.', { sceneCount: 5 }).scenes.length, 2);
});

test('projekt z planu reżysera AI', () => {
  const plan = {
    title: 'Test',
    musicMood: 'calm',
    style: 'documentary',
    scenes: [
      { name: 'A', duration: 6, visualPrompt: 'Forest at dawn', camera: 'drone-flyover', lens: '24mm', lighting: 'golden-hour', voiceover: 'Las budzi się.', sfxPrompt: 'birds', ambience: 'wind', proceduralPreset: 'clouds', transition: 'crossfade', overlayText: 'LAS' },
      { name: 'B', duration: 5, visualPrompt: 'Deer drinking', camera: 'static', lens: '85mm', lighting: 'overcast', voiceover: '', sfxPrompt: '', ambience: 'none', proceduralPreset: 'ocean', transition: 'wipe', overlayText: '' },
    ],
  };
  const p = projectFromDirector(plan);
  assert.equal(p.name, 'Test');
  assert.equal(p.audio.music.mood, 'calm');
  assert.equal(p.scenes.length, 2);
  assert.equal(p.scenes[1].transition.type, 'fade-black');
  assert.equal(p.overlays.length, 1);
  assert.equal(p.scenes[0].prompt.style, 'documentary');
});

test('formatTime', () => {
  assert.equal(formatTime(61.5, 30), '01:01:15');
});

test('createProject nie współdzieli obiektów między scenami', () => {
  const p = createProject({ scenes: [{}, {}] });
  p.scenes[0].grade.exposure = 1;
  assert.equal(p.scenes[1].grade.exposure, 0);
  assert.notEqual(p.scenes[0].id, p.scenes[1].id);
});

test('sanitizePlan naprawia odpowiedź modelu', async () => {
  const { sanitizePlan, directorPromptWithSchema } = await import('../public/js/core/director-prompt.js');
  const plan = sanitizePlan({ title: '', musicMood: 'disco', scenes: [{ duration: 99, camera: 'jetpack', ambience: 'waves', transition: 'wipe' }, null, 'x'] });
  assert.equal(plan.title, 'Mój film');
  assert.equal(plan.musicMood, 'epic');
  assert.equal(plan.scenes.length, 1);
  assert.equal(plan.scenes[0].duration, 12);
  assert.equal(plan.scenes[0].camera, 'slow-dolly-in');
  assert.equal(plan.scenes[0].ambience, 'waves');
  assert.equal(plan.scenes[0].transition, 'wipe');
  assert.deepEqual(sanitizePlan(null).scenes, []);
  const prompt = directorPromptWithSchema({ idea: 'Las o świcie', sceneCount: 3 });
  assert.match(prompt, /Las o świcie/);
  assert.match(prompt, /Number of scenes: 3/);
  assert.match(prompt, /"visualPrompt"/);
});
