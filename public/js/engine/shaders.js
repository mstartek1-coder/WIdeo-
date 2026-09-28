// Shadery GLSL ES 3.00 (WebGL2): proceduralne sceny "fotorealistyczne", kompozycja warstw i postprodukcja filmowa.
// Wszystkie sceny są napisane od zera dla tego projektu.

export const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform float uTime;
uniform float uSeed;
uniform vec2 uRes;
#define PI 3.14159265359
`;

const COMMON = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm2(vec2 p) {
  float a = 0.5, s = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) { s += a * noise2(p); p = m * p; a *= 0.5; }
  return s;
}
float fbm3(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * noise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
mat3 cameraMat(vec3 ro, vec3 ta, float roll) {
  vec3 cw = normalize(ta - ro);
  vec3 cp = vec3(sin(roll), cos(roll), 0.0);
  vec3 cu = normalize(cross(cw, cp));
  vec3 cv = cross(cu, cw);
  return mat3(cu, cv, cw);
}
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 finish(vec3 col, vec2 fc) {
  col = aces(max(col, 0.0));
  col = pow(col, vec3(1.0 / 2.2));
  return col + (hash12(fc + fract(uTime) * 91.0) - 0.5) / 255.0;
}
`;

// ---------------------------------------------------------------- OCEAN
const OCEAN = HEADER + COMMON + `
vec3 SUN;
vec3 skyCol(vec3 rd) {
  float y = max(rd.y, 0.0);
  vec3 zen = vec3(0.06, 0.13, 0.32);
  vec3 hor = vec3(0.92, 0.48, 0.26);
  vec3 col = mix(hor, zen, pow(y, 0.38));
  float s = max(dot(rd, SUN), 0.0);
  col += vec3(1.0, 0.42, 0.14) * pow(s, 8.0) * 0.3;
  col += vec3(1.0, 0.72, 0.42) * pow(s, 90.0) * 0.8;
  col += vec3(1.3, 1.0, 0.75) * smoothstep(0.99955, 0.9998, s) * 12.0;
  if (rd.y > 0.0) {
    vec2 cp = rd.xz / (rd.y + 0.07) * 0.8 + vec2(uTime * 0.012, uSeed * 3.0);
    float c = fbm2(cp * 1.2);
    c = smoothstep(0.5, 0.86, c) * smoothstep(0.0, 0.22, rd.y);
    vec3 cc = mix(vec3(0.32, 0.2, 0.27), vec3(1.25, 0.62, 0.34), pow(s, 3.0) * 0.9 + 0.1);
    col = mix(col, cc, c * 0.85);
  }
  return col;
}
float waveH(vec2 p, float t, int iters) {
  float h = 0.0, w = 1.0, f = 0.16, wsum = 0.0, ang = uSeed * 1.3;
  for (int i = 0; i < 26; i++) {
    if (i >= iters) break;
    vec2 d = vec2(cos(ang), sin(ang));
    float x = dot(d, p) * f + t * sqrt(9.81 * f) * 0.85;
    float wave = exp(sin(x) - 1.0);
    float dw = wave * cos(x);
    h += wave * w;
    p -= d * dw * w * 0.32;
    wsum += w;
    w *= 0.74;
    f *= 1.19;
    ang += 2.39996;
  }
  return h / wsum;
}
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  SUN = normalize(vec3(0.16 + 0.1 * sin(uSeed), 0.045 + 0.015 * cos(uSeed * 1.7), 1.0));
  vec3 ro = vec3(0.0, 2.2 + 0.15 * sin(t * 0.45), t * 1.6);
  vec3 ta = ro + vec3(0.0, -0.21 + 0.012 * sin(t * 0.33), 1.0);
  vec3 rd = cameraMat(ro, ta, 0.01 * sin(t * 0.5)) * normalize(vec3(uv, 1.7));
  vec3 col;
  if (rd.y >= -0.0005) {
    col = skyCol(rd);
  } else {
    float dist = -ro.y / rd.y;
    vec3 p = ro + rd * dist;
    int it = dist < 40.0 ? 24 : dist < 150.0 ? 16 : 9;
    float e = 0.015 + dist * 0.0015;
    float h0 = waveH(p.xz, t, it);
    float hx = waveH(p.xz + vec2(e, 0.0), t, it);
    float hz = waveH(p.xz + vec2(0.0, e), t, it);
    vec3 n = normalize(vec3(-(hx - h0) / e * 2.6, 1.0, -(hz - h0) / e * 2.6));
    n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(30.0, 500.0, dist) * 0.75));
    vec3 r = reflect(rd, n);
    r.y = abs(r.y);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
    vec3 refl = skyCol(r);
    vec3 deep = vec3(0.008, 0.04, 0.065);
    float toSun = pow(max(dot(rd, SUN), 0.0), 3.0);
    vec3 sss = vec3(0.05, 0.3, 0.26) * smoothstep(0.45, 0.95, h0) * (0.25 + 1.2 * toSun);
    col = mix(deep + sss, refl, fres);
    col += vec3(1.0, 0.78, 0.5) * pow(max(dot(r, SUN), 0.0), 420.0) * 7.0;
    float foam = smoothstep(0.8, 0.97, h0) * noise2(p.xz * 2.5 + t * 0.7);
    col = mix(col, vec3(0.95, 0.78, 0.68), foam * 0.55 * (1.0 - smoothstep(10.0, 70.0, dist)));
    vec3 fogC = skyCol(normalize(vec3(rd.x, 0.0, rd.z)));
    col = mix(col, fogC, 1.0 - exp(-dist * 0.0022));
  }
  outColor = vec4(finish(col * 0.9, fc), 1.0);
}`;

// ---------------------------------------------------------------- CLOUDS
const CLOUDS = HEADER + COMMON + `
vec3 SUN;
vec3 skyC(vec3 rd) {
  float y = max(rd.y, 0.0);
  vec3 col = mix(vec3(0.95, 0.66, 0.45), vec3(0.14, 0.27, 0.58), pow(y, 0.5));
  float s = max(dot(rd, SUN), 0.0);
  col += vec3(1.0, 0.55, 0.25) * pow(s, 8.0) * 0.35 + vec3(1.2, 0.95, 0.7) * pow(s, 120.0) * 0.9;
  col += vec3(1.4, 1.1, 0.85) * smoothstep(0.9995, 0.9998, s) * 12.0;
  return col;
}
float den(vec3 p, float t, int oct) {
  vec3 q = p * vec3(0.28, 0.5, 0.28) + vec3(uSeed * 3.1, 0.0, -t * 0.03);
  float n = fbm3(q, oct);
  float h = smoothstep(-2.4, 0.9, p.y);
  float d = (n - 0.33 - 0.36 * h) * 3.4;
  return clamp(d, 0.0, 1.0) * smoothstep(-2.8, -2.0, p.y);
}
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  SUN = normalize(vec3(-0.75 + 0.1 * sin(uSeed), 0.14, 0.65));
  vec3 ro = vec3(0.4 * sin(t * 0.05), 1.25 + 0.18 * sin(t * 0.21), t * 1.5);
  vec3 ta = ro + vec3(0.25 * sin(t * 0.06), -0.13, 1.0);
  vec3 rd = cameraMat(ro, ta, 0.03 * sin(t * 0.17)) * normalize(vec3(uv, 1.6));
  vec3 col = skyC(rd);
  if (rd.y < 0.0) {
    float top = 0.9, bottom = -2.8;
    float t0 = (top - ro.y) / rd.y;
    float t1 = min((bottom - ro.y) / rd.y, t0 + 45.0);
    const int STEPS = 44;
    float dt = (t1 - t0) / float(STEPS);
    float tt = t0 + dt * hash12(fc + fract(t) * 17.0);
    float T = 1.0;
    vec3 acc = vec3(0.0);
    float cosT = dot(rd, SUN);
    float phase = 0.75 + 1.6 * pow(max(cosT, 0.0), 8.0);
    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + rd * tt;
      float d = den(p, t, 5);
      if (d > 0.005) {
        float dl = den(p + SUN * 0.45, t, 3);
        float shadow = exp(-dl * 3.0);
        float powder = 1.0 - exp(-d * 5.0);
        vec3 sunL = vec3(1.0, 0.78, 0.55) * 0.95 * shadow * powder * phase;
        vec3 amb = mix(vec3(0.12, 0.13, 0.2), vec3(0.42, 0.47, 0.6), smoothstep(-2.8, 0.9, p.y));
        vec3 lit = sunL + amb * 0.55;
        float a = 1.0 - exp(-d * dt * 2.4);
        acc += T * a * lit;
        T *= 1.0 - a;
        if (T < 0.02) break;
      }
      tt += dt;
    }
    vec3 haze = skyC(normalize(vec3(rd.x, 0.02, rd.z)));
    col = acc + T * haze * 0.7;
    col = mix(col, haze, 1.0 - exp(-max(t0, 0.0) * 0.018));
  }
  outColor = vec4(finish(col, fc), 1.0);
}`;

// ---------------------------------------------------------------- AURORA
const AURORA = HEADER + COMMON + `
float mountain(float az, float seed, float scale, float amp, float base) {
  float x = az * scale + seed;
  float r = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < 6; i++) {
    r += a * (1.0 - abs(noise2(vec2(x * f, seed)) * 2.0 - 1.0));
    a *= 0.5;
    f *= 2.1;
  }
  return base + amp * r * r;
}
vec3 stars(vec3 rd, float t) {
  vec3 col = vec3(0.0);
  vec2 sc = vec2(atan(rd.x, rd.z), asin(clamp(rd.y, -1.0, 1.0)));
  for (int l = 0; l < 2; l++) {
    float dens = l == 0 ? 90.0 : 220.0;
    vec2 g = sc * dens;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash12(id + float(l) * 17.0);
    if (h > (l == 0 ? 0.965 : 0.93)) {
      vec2 o = (hash22(id) - 0.5) * 0.6;
      float d = length(f - o);
      float tw = 0.65 + 0.35 * sin(t * (2.0 + h * 5.0) + h * 40.0);
      vec3 sc2 = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash12(id + 3.3));
      col += sc2 * smoothstep(0.18, 0.0, d) * tw * (l == 0 ? 1.2 : 0.5);
    }
  }
  // Droga Mleczna – delikatne pasmo
  float band = exp(-pow((rd.y - 0.35 * rd.x - 0.35) * 3.5, 2.0));
  col += vec3(0.25, 0.26, 0.35) * band * fbm2(sc * 6.0) * 0.35;
  return col;
}
vec3 aurora(vec3 ro, vec3 rd, float t) {
  vec3 acc = vec3(0.0);
  if (rd.y <= 0.02) return acc;
  for (int i = 0; i < 44; i++) {
    float fi = float(i);
    float hgt = 1.0 + fi * 0.045;
    vec2 pt = ro.xz + rd.xz * (hgt / rd.y);
    float zl = 7.0 + 2.2 * sin(pt.x * 0.18 + t * 0.07 + uSeed) + 1.8 * (fbm2(vec2(pt.x * 0.12, t * 0.04 + uSeed)) - 0.5) * 4.0;
    float dz = pt.y - zl;
    float curtain = exp(-dz * dz * 1.6);
    float rays = 0.35 + 0.65 * pow(noise2(vec2(pt.x * 2.4 + t * 0.25, fi * 0.02 + t * 0.1)), 2.0);
    float fall = exp(-fi * 0.075);
    vec3 c = mix(vec3(0.15, 1.0, 0.45), vec3(0.65, 0.2, 0.95), smoothstep(8.0, 40.0, fi));
    c = mix(c, vec3(1.0, 0.25, 0.4), smoothstep(30.0, 44.0, fi) * 0.4);
    acc += c * curtain * rays * fall * 0.075;
  }
  return acc * smoothstep(0.02, 0.2, rd.y);
}
vec3 skyScene(vec3 ro, vec3 rd, float t) {
  vec3 col = mix(vec3(0.012, 0.02, 0.045), vec3(0.0, 0.004, 0.015), pow(max(rd.y, 0.0), 0.5));
  col += stars(rd, t);
  col += aurora(ro, rd, t) * 1.6;
  float az = atan(rd.x, rd.z);
  float far = mountain(az, uSeed, 3.0, 0.16, 0.015);
  float nearM = mountain(az + 0.7, uSeed + 11.0, 1.7, 0.12, -0.01);
  if (rd.y < max(far, nearM)) {
    vec3 glow = aurora(ro, normalize(vec3(rd.x, 0.25, rd.z)), t);
    if (rd.y < nearM) {
      col = vec3(0.004, 0.006, 0.012) + glow * 0.06;
    } else {
      float snow = smoothstep(far - 0.06, far, rd.y) * noise2(vec2(az * 60.0, rd.y * 80.0));
      col = vec3(0.012, 0.016, 0.03) + glow * 0.25 + vec3(0.18, 0.24, 0.3) * snow * 0.35;
    }
  }
  return col;
}
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  vec3 ro = vec3(0.0);
  vec3 rd = normalize(vec3(uv, 1.3));
  rd.yz *= rot(0.2);
  rd.xz *= rot(0.25 * sin(t * 0.025 + uSeed) + t * 0.008);
  vec3 col;
  if (rd.y > -0.02) {
    col = skyScene(ro, rd, t);
  } else {
    // Jezioro: odbicie nieba z drobnymi falkami.
    vec2 wp = rd.xz / rd.y;
    vec2 ripple = vec2(noise2(wp * 3.0 + t * 0.3), noise2(wp * 3.0 - t * 0.25)) - 0.5;
    vec3 rr = normalize(vec3(rd.x + ripple.x * 0.02, -rd.y, rd.z + ripple.y * 0.02));
    col = skyScene(ro, rr, t) * 0.55;
    col *= smoothstep(-0.9, -0.03, rd.y) * 0.8 + 0.2;
  }
  outColor = vec4(finish(col * 1.1, fc), 1.0);
}`;

// ---------------------------------------------------------------- NEBULA
const NEBULA = HEADER + COMMON + `
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  uv *= rot(t * 0.004 + uSeed);
  vec3 col = vec3(0.003, 0.005, 0.012);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float depth = fract(fi * 0.2 - t * 0.012);
    float scale = mix(3.2, 0.45, depth);
    float fade = smoothstep(0.0, 0.25, depth) * smoothstep(1.0, 0.7, depth);
    vec2 p = uv * scale + vec2(fi * 13.7 + uSeed * 5.0, fi * 7.3);
    vec2 q = vec2(fbm2(p + t * 0.01), fbm2(p + vec2(5.2, 1.3)));
    float d = smoothstep(0.35, 0.95, fbm2(p + 2.4 * q));
    vec3 c = mix(vec3(0.08, 0.14, 0.55), vec3(0.95, 0.18, 0.45), q.x);
    c = mix(c, vec3(1.0, 0.62, 0.28), q.y * q.y);
    float dust = smoothstep(0.52, 0.78, fbm2(p * 1.7 + 4.0));
    col = col * (1.0 - dust * 0.55 * fade) + c * d * fade * 0.42;
  }
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float sc = 36.0 + fl * 70.0;
    vec2 p = uv * sc;
    vec2 id = floor(p);
    vec2 f = fract(p) - 0.5;
    float h = hash12(id + fl * 31.0);
    if (h > 0.9) {
      vec2 o = (hash22(id + fl) - 0.5) * 0.7;
      float d = length(f - o);
      vec3 sc2 = mix(vec3(0.6, 0.75, 1.0), vec3(1.0, 0.8, 0.6), hash12(id * 1.7));
      float tw = 0.75 + 0.25 * sin(t * 3.0 + h * 50.0);
      col += sc2 * smoothstep(0.22, 0.0, d) * tw * (1.2 - fl * 0.3);
    }
  }
  for (int k = 0; k < 4; k++) {
    vec2 pos = (hash22(vec2(float(k) * 3.7, uSeed)) - 0.5) * vec2(1.5, 0.85);
    vec2 v = uv - pos;
    vec3 sc3 = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.75, 0.5), hash12(vec2(float(k), uSeed)));
    float glow = 0.00035 / dot(v, v);
    float spikes = exp(-abs(v.x) * 700.0) * exp(-abs(v.y) * 14.0) + exp(-abs(v.y) * 700.0) * exp(-abs(v.x) * 14.0);
    col += sc3 * (glow + spikes * 0.5);
  }
  outColor = vec4(finish(col * 1.2, fc), 1.0);
}`;

// ---------------------------------------------------------------- RAIN (nocne miasto za mokrą szybą)
const RAIN = HEADER + COMMON + `
vec3 bokeh(vec2 uv, float scale, float t, float seed) {
  vec2 p = uv * scale;
  vec2 id0 = floor(p);
  vec3 acc = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 id = id0 + vec2(x, y);
      vec2 h = hash22(id + seed);
      if (h.x < 0.8) continue;
      vec2 c = id + 0.5 + (h - 0.5) * 0.8 + vec2(sin(t * 0.15 + h.y * 6.0) * 0.12, 0.0);
      float r = 0.2 + 0.3 * h.y;
      float d = length(p - c);
      float disk = smoothstep(r, r * 0.88, d) * (0.65 + 0.35 * smoothstep(r * 0.4, r, d));
      float k = hash12(id + seed + 5.1);
      vec3 col = k < 0.35 ? vec3(1.0, 0.58, 0.18) : k < 0.55 ? vec3(1.0, 0.86, 0.62) : k < 0.7 ? vec3(1.0, 0.16, 0.12) : k < 0.85 ? vec3(0.2, 0.7, 1.0) : vec3(0.95, 0.3, 0.8);
      float flick = 0.85 + 0.15 * sin(t * (1.0 + k * 3.0) + k * 20.0);
      acc += col * disk * (0.2 + 0.55 * hash12(id + 3.1)) * flick;
    }
  }
  return acc;
}
vec3 background(vec2 uv, float t) {
  vec3 col = mix(vec3(0.03, 0.022, 0.03), vec3(0.008, 0.01, 0.022), smoothstep(-0.5, 0.5, uv.y));
  float street = smoothstep(0.5, -0.35, uv.y);
  col += bokeh(uv + vec2(t * 0.012, 0.0), 3.2, t, uSeed) * (0.25 + 0.5 * street);
  col += bokeh(uv + vec2(t * 0.02, 0.1), 6.0, t, uSeed + 7.0) * (0.12 + 0.35 * street);
  col += bokeh(uv + vec2(t * 0.035, 0.3), 11.0, t, uSeed + 13.0) * (0.08 + 0.2 * street);
  col += vec3(0.55, 0.3, 0.12) * exp(-pow(uv.y + 0.55, 2.0) * 6.0) * 0.28;
  vec2 rp = uv * vec2(110.0, 9.0) + vec2(0.0, t * 30.0);
  col += vec3(0.5, 0.55, 0.6) * step(0.988, hash12(floor(rp))) * 0.05;
  return col;
}
// Krople na szybie: xy = przesunięcie refrakcji, z = maska kropli.
vec3 drops(vec2 uv, float t) {
  vec2 p = uv * 26.0;
  vec2 id = floor(p);
  vec2 f = fract(p) - 0.5;
  vec2 h = hash22(id + uSeed);
  vec2 c = (h - 0.5) * 0.6;
  float r = 0.07 + 0.13 * hash12(id + 1.3);
  float life = fract(t * 0.06 + h.x);
  float d = length(f - c);
  float m = smoothstep(r, r * 0.35, d) * smoothstep(1.0, 0.85, life) * step(0.45, h.y);
  vec2 off = (f - c) * m * 3.0;
  float mask = m;
  // Spływające krople ze śladem.
  vec2 aspect = vec2(1.0, 3.2);
  vec2 q = uv * vec2(6.0, 6.0 / aspect.y);
  float colId = floor(q.x);
  float hc = hash12(vec2(colId, uSeed + 2.0));
  q.y += t * (0.08 + 0.12 * hc) + hc * 10.0;
  vec2 cell = vec2(colId, floor(q.y));
  vec2 g = fract(q) - 0.5;
  float hh = hash12(cell + 4.2);
  if (hh > 0.35) {
    float x = (hh - 0.5) * 0.5 + sin(q.y * 6.0 + hh * 6.0) * 0.04;
    vec2 dp = (g - vec2(x, -0.25)) * aspect;
    float head = smoothstep(0.22, 0.08, length(dp));
    float trail = smoothstep(0.06, 0.0, abs(g.x - x)) * smoothstep(-0.25, 0.45, g.y) * smoothstep(0.5, 0.2, g.y);
    float beads = smoothstep(0.12, 0.03, length((fract(vec2(g.x, g.y * 6.0)) - vec2(fract(x), 0.5)) * vec2(1.0, 0.8))) * trail;
    mask = max(mask, max(head, beads * 0.8));
    off += dp * head * 0.6 + vec2(g.x - x, 0.0) * beads;
  }
  return vec3(off, clamp(mask, 0.0, 1.0));
}
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  vec3 dr = drops(uv, t);
  vec3 bg = background(uv, t);
  vec3 refr = background(uv * 0.9 - dr.xy * 0.12, t) * 1.3;
  vec3 col = mix(bg * 0.8, refr, dr.z);
  float rim = dr.z * (1.0 - dr.z) * 4.0;
  col = col * (1.0 - rim * 0.35) + vec3(0.9, 0.95, 1.0) * pow(max(0.0, dr.z - 0.85), 2.0) * 0.6;
  col += vec3(0.012, 0.016, 0.025);
  outColor = vec4(finish(col * 1.2, fc), 1.0);
}`;

// Wspólny początek każdej sceny – sceny pisane przez agenta AI dostają ten sam nagłówek i bibliotekę funkcji.
export const SHADER_PREFIX = HEADER + COMMON;

// Rozdzielczość względna bufora sceny (chmury są miękkie – można renderować taniej i skalować).
export const PROCEDURAL_SHADERS = {
  ocean: { frag: OCEAN, scale: 1 },
  clouds: { frag: CLOUDS, scale: 0.5 },
  aurora: { frag: AURORA, scale: 0.75 },
  nebula: { frag: NEBULA, scale: 0.75 },
  rain: { frag: RAIN, scale: 0.75 },
};

// ---------------------------------------------------------------- Kompozycja warstw + korekcja barwna
export const LAYER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uSrcSize;
uniform vec2 uDstSize;
uniform vec3 uCam;
uniform float uOpacity;
uniform float uBrightness;
uniform float uWipe;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
void main() {
  float sA = uSrcSize.x / uSrcSize.y;
  float dA = uDstSize.x / uDstSize.y;
  vec2 fit = sA > dA ? vec2(dA / sA, 1.0) : vec2(1.0, sA / dA);
  vec2 uv = (vUv - 0.5) * fit / max(uCam.x, 0.01) + 0.5 + uCam.yz;
  uv = clamp(uv, vec2(0.0005), vec2(0.9995));
  vec3 c = texture(uTex, uv).rgb;
  c *= exp2(uExposure);
  c *= vec3(1.0 + 0.12 * uTemperature, 1.0 + 0.06 * uTint, 1.0 - 0.12 * uTemperature);
  c = mix(vec3(0.45), c, uContrast);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c *= uBrightness;
  float a = uOpacity;
  if (uWipe < 1.0) {
    float edge = mix(-0.05, 1.05, uWipe);
    a *= 1.0 - smoothstep(edge - 0.05, edge, vUv.x);
  }
  outColor = vec4(max(c, 0.0), a);
}`;

// ---------------------------------------------------------------- Bloom: wyciągnięcie jasnych partii + rozmycie
export const BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec3 c = vec3(0.0);
  c += texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(c * smoothstep(0.55, 0.95, l), 1.0);
}`;

export const BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  const float w0 = 0.2270270270, w1 = 0.3162162162, w2 = 0.0702702703;
  vec3 c = texture(uTex, vUv).rgb * w0;
  c += texture(uTex, vUv + uDir * 1.3846153846).rgb * w1;
  c += texture(uTex, vUv - uDir * 1.3846153846).rgb * w1;
  c += texture(uTex, vUv + uDir * 3.2307692308).rgb * w2;
  c += texture(uTex, vUv - uDir * 3.2307692308).rgb * w2;
  outColor = vec4(c, 1.0);
}`;

// ---------------------------------------------------------------- Postprodukcja filmowa
export const POST = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uBloomTex;
uniform sampler2D uOverlay;
uniform vec2 uRes;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uAberration;
uniform float uBloom;
uniform float uLetterbox;
uniform float uFade;
uniform float uSharpen;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  vec2 off = d * r2 * uAberration * 0.035;
  vec3 c;
  c.r = texture(uScene, uv + off).r;
  c.g = texture(uScene, uv).g;
  c.b = texture(uScene, uv - off).b;
  vec2 px = 1.0 / uRes;
  vec3 blur = (texture(uScene, uv + vec2(px.x, 0.0)).rgb + texture(uScene, uv - vec2(px.x, 0.0)).rgb +
               texture(uScene, uv + vec2(0.0, px.y)).rgb + texture(uScene, uv - vec2(0.0, px.y)).rgb) * 0.25;
  c += (c - blur) * uSharpen * 1.5;
  vec3 bl = texture(uBloomTex, uv).rgb;
  c += bl * uBloom * vec3(1.05, 0.88, 0.78) * 1.4;
  float aspect = uRes.x / uRes.y;
  float vig = smoothstep(0.95, 0.25, length(d * vec2(aspect / 1.7778, 1.0) * 1.15));
  c *= mix(1.0, vig, uVignette);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec2 gp = floor(uv * uRes / 1.35);
  float g = hash12(gp + fract(uTime * 23.17) * 713.0) + hash12(gp * 1.37 + fract(uTime * 11.3) * 331.0) - 1.0;
  c += g * uGrain * 0.09 * (1.0 - l * 0.55);
  if (uLetterbox > 0.0 && aspect < uLetterbox) {
    float bar = (1.0 - aspect / uLetterbox) * 0.5;
    if (uv.y < bar || uv.y > 1.0 - bar) c = vec3(0.0);
  }
  vec4 o = texture(uOverlay, uv);
  c = mix(c, o.rgb, o.a);
  c *= uFade;
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 57.0) - 0.5) / 255.0;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
