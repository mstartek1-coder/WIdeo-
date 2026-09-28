import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScenePrompt, fixPrompt, refinePrompt, editPrompt, parseSceneReply, sanitizeShaderCode, mapCompileLog } from '../public/js/core/scene-agent.js';
import { createScene } from '../public/js/core/project.js';

const scene = createScene({ name: 'Latarnia', duration: 6, prompt: { subject: 'A lighthouse on a cliff during a storm', camera: 'drone-flyover', lighting: 'moonlight' } });

test('prompt agenta zawiera opis ujęcia, kamerę, bibliotekę i format odpowiedzi', () => {
  const p = createScenePrompt(scene);
  assert.match(p, /lighthouse on a cliff/);
  assert.match(p, /drone flyover/);
  assert.match(p, /moonlight/);
  assert.match(p, /fbm3\(vec3 p, int octaves\)/);
  assert.match(p, /AMBIENCE: <one of: none, waves, wind, night, space, rain>/);
  assert.match(fixPrompt(scene, 'void main(){}', "ERROR: line 3: 'x' : undeclared"), /undeclared/);
  assert.match(refinePrompt(scene, 'void main(){}', 2), /t=2\.0 s/);
  assert.match(editPrompt(scene, 'void main(){}', 'więcej mgły'), /więcej mgły/);
});

test('scena bez opisu korzysta z nazwy i tekstu lektora', () => {
  const s = createScene({ name: 'Świt', prompt: { subject: '' }, audio: { voice: { text: 'Mgła nad jeziorem.' } } });
  assert.match(createScenePrompt(s), /SHOT: Świt\. Mgła nad jeziorem\./);
});

test('parser wyciąga kod, tytuł i ambient z odpowiedzi', () => {
  const reply = 'Kilka uwag.\nTITLE: **Latarnia w sztormie**\nAMBIENCE: Rain\n```glsl\n#version 300 es\nprecision highp float;\nuniform float uTime;\nvoid main() {\n  vec3 col = vec3(0.1);\n  outColor = vec4(finish(col, gl_FragCoord.xy), 1.0);\n}\n```\nKoniec.';
  const r = parseSceneReply(reply);
  assert.equal(r.title, 'Latarnia w sztormie');
  assert.equal(r.ambience, 'rain');
  assert.doesNotMatch(r.code, /#version|precision|uniform float uTime/);
  assert.match(r.code, /^void main\(\)/);
});

test('parser radzi sobie z uciętym blokiem i brakiem metadanych', () => {
  const r = parseSceneReply('```glsl\nfloat f(){return 1.0;}\nvoid main(){ outColor = vec4(1.0); }');
  assert.ok(r && /void main/.test(r.code));
  assert.equal(r.title, 'Scena AI');
  assert.equal(r.ambience, null);
  assert.equal(parseSceneReply('Nie umiem.'), null);
  assert.equal(parseSceneReply('TITLE: x\nAMBIENCE: disco\nvoid main(){}').ambience, null);
});

test('sanitizeShaderCode usuwa zdublowane deklaracje silnika', () => {
  const code = sanitizeShaderCode('in vec2 vUv;\nout vec4 outColor;\n#define PI 3.14\nuniform vec2 uRes;\nuniform float uMine;\nvoid main(){}');
  assert.equal(code, 'uniform float uMine;\nvoid main(){}');
});

test('mapCompileLog przelicza numery linii', () => {
  assert.equal(mapCompileLog("ERROR: 0:130: 'foo' : undeclared identifier\nERROR: 0:131: '' : compilation terminated", 120), "ERROR: line 10: 'foo' : undeclared identifier\nERROR: line 11: '' : compilation terminated");
});
