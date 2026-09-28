import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateAmbience, generateMusic, encodeWav, noteToMidi, midiToFreq, Biquad, AMBIENCE_GENERATORS, MUSIC_STYLES } from '../public/js/core/synth.js';

const stats = (o) => {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < o.left.length; i++) {
    if (!Number.isFinite(o.left[i]) || !Number.isFinite(o.right[i])) return { bad: true };
    peak = Math.max(peak, Math.abs(o.left[i]), Math.abs(o.right[i]));
    sum += o.left[i] * o.left[i];
  }
  return { peak, rms: Math.sqrt(sum / o.left.length) };
};

test('nuty i częstotliwości', () => {
  assert.equal(noteToMidi('A4'), 69);
  assert.equal(noteToMidi('C4'), 60);
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-9);
});

test('filtr dolnoprzepustowy tłumi wysokie częstotliwości', () => {
  const sr = 44100;
  const run = (f) => {
    const lp = new Biquad('lowpass', 500, 0.707, sr);
    let e = 0;
    for (let i = 0; i < sr / 4; i++) {
      const y = lp.process(Math.sin((2 * Math.PI * f * i) / sr));
      if (i > sr / 8) e += y * y;
    }
    return e;
  };
  assert.ok(run(100) > 20 * run(8000));
});

for (const type of Object.keys(AMBIENCE_GENERATORS)) {
  test(`ambient "${type}" jest słyszalny, bez NaN i bez przesterowania`, () => {
    const o = generateAmbience(type, 3, { seed: 2, sampleRate: 22050 });
    const s = stats(o);
    assert.ok(!s.bad);
    assert.ok(s.rms > 0.01, `rms=${s.rms}`);
    assert.ok(s.peak <= 1);
  });
}

for (const mood of Object.keys(MUSIC_STYLES)) {
  test(`muzyka "${mood}" jest słyszalna i deterministyczna`, () => {
    const a = generateMusic(mood, 6, { seed: 3, sampleRate: 22050 });
    const b = generateMusic(mood, 6, { seed: 3, sampleRate: 22050 });
    const s = stats(a);
    assert.ok(!s.bad && s.rms > 0.02 && s.peak <= 1);
    assert.deepEqual(a.left.slice(5000, 5100), b.left.slice(5000, 5100));
  });
}

test('nieznany nastrój/ambient daje ciszę', () => {
  assert.equal(stats(generateMusic('none', 1, { sampleRate: 8000 })).rms, 0);
  assert.equal(stats(generateAmbience('none', 1, { sampleRate: 8000 })).rms, 0);
});

test('WAV ma poprawny nagłówek', () => {
  const wav = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0, 0.5, -0.5])], 8000);
  const txt = (o, n) => String.fromCharCode(...wav.slice(o, o + n));
  assert.equal(txt(0, 4), 'RIFF');
  assert.equal(txt(8, 4), 'WAVE');
  assert.equal(wav.length, 44 + 3 * 2 * 2);
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getInt16(48, true), 32767);
});
