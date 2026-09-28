// Agent scen: Claude pisze animowaną, możliwie fotorealistyczną scenę jako shader GLSL.
// Ten moduł buduje polecenia dla Claude i przetwarza jego odpowiedzi (bez DOM – testowalny w Node).

import { CAMERA_MOVES, LENSES, LIGHTING, STYLES } from './prompt.js';
import { AMBIENCES } from './project.js';

export const AMBIENCE_KEYS = Object.keys(AMBIENCES);

const LIBRARY = `The engine prepends this code before yours (do NOT repeat, redeclare or #define any of it):
  #version 300 es / precision highp float;
  in vec2 vUv; out vec4 outColor;
  uniform float uTime;  // seconds since the shot started
  uniform float uSeed;  // 0..60, variation of the shot
  uniform vec2 uRes;    // render size in pixels
  #define PI 3.14159265359
Helper functions you can call:
  float hash12(vec2 p); float hash13(vec3 p); vec2 hash22(vec2 p);
  float noise2(vec2 p); float noise3(vec3 p);            // smooth value noise in [0,1]
  float fbm2(vec2 p);                                     // 6-octave fbm in [0,1]
  float fbm3(vec3 p, int octaves);                        // up to 6 octaves
  mat2 rot(float a); mat3 cameraMat(vec3 ro, vec3 ta, float roll);  // rd = cameraMat(ro, ta, 0.0) * normalize(vec3(uv, focal))
  vec3 aces(vec3 c);                                      // ACES filmic tone mapping
  vec3 finish(vec3 col, vec2 fragCoord);                  // ACES + gamma + dither: use it for the final colour`;

const RULES = `Requirements:
- Write only your own functions and void main(). Compute uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y. End main with: outColor = vec4(finish(col, gl_FragCoord.xy), 1.0);
- Photorealism first: work in linear HDR (sun and sky may exceed 1.0), physically plausible key light plus sky fill, soft shadows, ambient occlusion, atmospheric perspective and fog with distance, natural materials with roughness and micro-detail from noise, believable scale, realistic colour palette. No outlines, flat colours or text.
- Motion: a smooth, continuous camera move matching the requested camera direction, driven by uTime, plus natural secondary motion (wind, water, clouds, light flicker). The shot must look good for the whole duration and beyond it.
- Performance: 30 fps at 1280x720 on a laptop GPU. Raymarching at most 90 steps, shadow rays at most 24 steps, fbm at most 6 octaves, no heavy loops nested inside loops. Loops need constant bounds (use break for early exit).
- Strict GLSL ES 3.00: float literals with a decimal point (1.0, not 1), no implicit int-to-float conversion, declare functions before use, no recursion, no textures or samplers, no #version, precision or uniform lines.

Reply in exactly this format:
TITLE: <a 2-5 word title in Polish>
AMBIENCE: <one of: ${AMBIENCE_KEYS.join(', ')}>
\`\`\`glsl
<the complete shader code>
\`\`\``;

function shotDescription(scene) {
  const p = scene.prompt || {};
  const subject = (p.subject || '').trim() || [scene.name, scene.audio?.voice?.text].filter(Boolean).join('. ') || 'A breathtaking real-world landscape';
  return [
    `SHOT: ${subject}`,
    `Camera: ${CAMERA_MOVES[p.camera]?.text || 'slow cinematic dolly-in'}; lens: ${LENSES[p.lens]?.text || '35mm lens'}.`,
    `Lighting: ${LIGHTING[p.lighting]?.text || 'natural light'}. Style: ${STYLES[p.style]?.text || 'cinematic'}.`,
    `Duration: ${Number(scene.duration || 6).toFixed(1)} seconds.`,
  ].join('\n');
}

export function createScenePrompt(scene) {
  return `You are a world-class real-time graphics artist and cinematographer. Write a GLSL ES 3.00 fragment shader that renders the following shot as a moving image that looks as close as possible to real camera footage.

${shotDescription(scene)}

${LIBRARY}

${RULES}`;
}

export function fixPrompt(scene, code, log) {
  return `Your GLSL ES 3.00 fragment shader for this shot failed to compile.

${shotDescription(scene)}

Compiler log (line numbers refer to your code):
${log.slice(0, 4000)}

Your code:
\`\`\`glsl
${code}
\`\`\`

${LIBRARY}

Fix every error and return the complete corrected shader.

${RULES}`;
}

export function refinePrompt(scene, code, t) {
  return `The attached image is a frame at t=${t.toFixed(1)} s rendered from your GLSL shader for this shot:

${shotDescription(scene)}

First, in 3-6 short bullet points, compare the frame with real camera footage of this shot (lighting, materials, scale, composition, colour, detail, anything broken). Then return an improved complete shader that fixes those points and looks more photorealistic, without making it slower.

Your current code:
\`\`\`glsl
${code}
\`\`\`

${LIBRARY}

${RULES}`;
}

export function editPrompt(scene, code, instruction) {
  return `Modify this GLSL shot shader according to the director's note, keeping everything that already works.

Director's note: ${instruction.trim()}

${shotDescription(scene)}

Current code:
\`\`\`glsl
${code}
\`\`\`

${LIBRARY}

${RULES}`;
}

// Wyciąga kod, tytuł i ambient z odpowiedzi Claude.
export function parseSceneReply(text) {
  const reply = String(text || '');
  const fences = [...reply.matchAll(/```[a-zA-Z]*\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  let code = fences.filter((f) => /void\s+main\s*\(/.test(f)).sort((a, b) => b.length - a.length)[0];
  if (!code) {
    const open = reply.search(/```[a-zA-Z]*\s*\n/);
    if (open >= 0 && /void\s+main\s*\(/.test(reply.slice(open))) code = reply.slice(open).replace(/^```[a-zA-Z]*\s*\n/, '');
    else if (/void\s+main\s*\(/.test(reply)) code = reply;
  }
  if (!code) return null;
  const title = (/^\s*TITLE:\s*(.+)$/im.exec(reply)?.[1] || '').replace(/[*_`]/g, '').trim().slice(0, 60);
  const amb = (/^\s*AMBIENCE:\s*([a-z-]+)/im.exec(reply)?.[1] || '').toLowerCase();
  return { code: sanitizeShaderCode(code), title: title || 'Scena AI', ambience: AMBIENCE_KEYS.includes(amb) ? amb : null };
}

// Usuwa linie, które silnik dostarcza sam (Claude czasem je powtarza).
export function sanitizeShaderCode(code) {
  return String(code)
    .replace(/```/g, '')
    .split('\n')
    .filter((line) => {
      const l = line.trim();
      if (/^#\s*version\b/.test(l)) return false;
      if (/^precision\s+\w+\s+\w+\s*;/.test(l)) return false;
      if (/^#\s*define\s+PI\b/.test(l)) return false;
      if (/^uniform\s+\w+\s+(uTime|uSeed|uRes)\s*;/.test(l)) return false;
      if (/^in\s+vec2\s+vUv\s*;/.test(l)) return false;
      if (/^out\s+vec4\s+outColor\s*;/.test(l)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

// Przelicza numery linii z logu kompilatora (pełne źródło) na linie kodu Claude.
export function mapCompileLog(log, prefixLines) {
  return String(log || '')
    .replace(/(ERROR|WARNING):\s*(\d+):(\d+):/g, (_, kind, file, line) => `${kind}: line ${Math.max(1, Number(line) - prefixLines)}:`)
    .replace(/\u0000/g, '')
    .trim();
}
