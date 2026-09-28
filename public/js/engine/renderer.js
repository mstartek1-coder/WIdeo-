// Renderer WebGL2: rysuje sceny (proceduralne lub klipy/zdjęcia AI) z ruchem kamery i korekcją barwną,
// miesza je zgodnie z przejściami, dodaje bloom, ziarno, winietę, kasety kinowe i animowane napisy.

import { VERT, PROCEDURAL_SHADERS, LAYER, BRIGHT, BLUR, POST } from './shaders.js';
import { layoutScenes, totalDuration, compositeAt, cameraAt, overlaysAt, subtitleAt, globalFade } from '../core/timeline.js';
import { FONTS } from '../core/project.js';

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Błąd kompilacji shadera: ${log}`);
  }
  return sh;
}

function program(gl, fragSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Błąd linkowania: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

function makeTexture(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (w && h) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return tex;
}

function makeTarget(gl, w, h) {
  const tex = makeTexture(gl, w, h);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h };
}

function freeTarget(gl, t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fb);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('Twoja przeglądarka nie obsługuje WebGL2 – użyj aktualnego Chrome, Edge, Firefox lub Safari.');
    this.gl = gl;
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.programs = {};
    this.layerProg = program(gl, LAYER);
    this.brightProg = program(gl, BRIGHT);
    this.blurProg = program(gl, BLUR);
    this.postProg = program(gl, POST);
    this.sceneTargets = [];
    this.media = new Map();
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.overlayTex = makeTexture(gl);
    this.overlayDirty = true;
    this.scale = 1;
    this.project = null;
    this.layout = [];
    this.total = 0;
    this.stats = { fps: 0, frames: 0, last: performance.now() };
  }

  procProgram(preset) {
    if (!this.programs[preset]) {
      const def = PROCEDURAL_SHADERS[preset] || PROCEDURAL_SHADERS.ocean;
      this.programs[preset] = program(this.gl, def.frag);
    }
    return this.programs[preset];
  }

  // Kompiluje wszystkie shadery z góry – pierwsze odtworzenie nie "przycina".
  warmUp() {
    for (const key of Object.keys(PROCEDURAL_SHADERS)) this.procProgram(key);
  }

  setProject(project) {
    this.project = project;
    this.layout = layoutScenes(project.scenes);
    this.total = totalDuration(this.layout);
    this.resize(this.scale);
    this.syncMedia();
  }

  resize(scale = this.scale) {
    const gl = this.gl;
    const p = this.project;
    if (!p) return;
    this.scale = scale;
    const w = Math.max(16, Math.round(p.width * scale));
    const h = Math.max(16, Math.round(p.height * scale));
    if (this.canvas.width === w && this.canvas.height === h && this.composite) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.overlayCanvas.width = w;
    this.overlayCanvas.height = h;
    this.overlayDirty = true;
    freeTarget(gl, this.composite);
    freeTarget(gl, this.bloomA);
    freeTarget(gl, this.bloomB);
    this.composite = makeTarget(gl, w, h);
    const bw = Math.max(8, Math.round(w / 4));
    const bh = Math.max(8, Math.round(h / 4));
    this.bloomA = makeTarget(gl, bw, bh);
    this.bloomB = makeTarget(gl, bw, bh);
    for (const t of this.sceneTargets) freeTarget(gl, t);
    this.sceneTargets = [];
  }

  sceneTarget(slot, scale) {
    const w = Math.max(16, Math.round(this.canvas.width * scale));
    const h = Math.max(16, Math.round(this.canvas.height * scale));
    const cur = this.sceneTargets[slot];
    if (cur && cur.w === w && cur.h === h) return cur;
    freeTarget(this.gl, cur);
    this.sceneTargets[slot] = makeTarget(this.gl, w, h);
    return this.sceneTargets[slot];
  }

  // ---------------- Media (klipy i zdjęcia) ----------------

  mediaKey(scene) {
    return `${scene.id}|${scene.source.url}`;
  }

  syncMedia() {
    const wanted = new Set();
    for (const scene of this.project.scenes) {
      if (scene.source.type !== 'media' || !scene.source.url) continue;
      const key = this.mediaKey(scene);
      wanted.add(key);
      if (!this.media.has(key)) this.media.set(key, this.loadMedia(scene.source));
    }
    for (const [key, m] of this.media) {
      if (!wanted.has(key)) {
        if (m.el instanceof HTMLVideoElement) {
          m.el.pause();
          m.el.removeAttribute('src');
          m.el.load();
        }
        if (m.tex) this.gl.deleteTexture(m.tex);
        this.media.delete(key);
      }
    }
  }

  loadMedia(source) {
    const entry = { kind: source.kind, el: null, tex: makeTexture(this.gl), w: 16, h: 9, ready: false, error: null, uploaded: false };
    if (source.kind === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        entry.w = img.naturalWidth;
        entry.h = img.naturalHeight;
        entry.ready = true;
        entry.uploaded = false;
        this.onFrame?.();
      };
      img.onerror = () => (entry.error = 'Nie udało się wczytać obrazu');
      img.src = source.url;
      entry.el = img;
    } else {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      v.preload = 'auto';
      v.addEventListener('loadeddata', () => {
        entry.w = v.videoWidth || 16;
        entry.h = v.videoHeight || 9;
        entry.ready = true;
        this.onFrame?.();
      });
      v.addEventListener('seeked', () => this.onFrame?.());
      v.addEventListener('error', () => (entry.error = 'Nie udało się wczytać wideo'));
      v.src = source.url;
      entry.el = v;
    }
    return entry;
  }

  // Czeka, aż wszystkie klipy będą gotowe (przed eksportem).
  async waitForMedia(timeoutMs = 20000) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const pending = [...this.media.values()].filter((m) => !m.ready && !m.error);
      if (!pending.length) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  syncVideo(entry, scene, local, playing, fps) {
    const v = entry.el;
    const dur = v.duration && Number.isFinite(v.duration) ? v.duration : scene.duration;
    const target = dur > 0 ? local % dur : local;
    if (playing) {
      if (v.paused) {
        v.currentTime = target;
        v.play().catch(() => {});
      } else if (Math.abs(v.currentTime - target) > 0.3) {
        v.currentTime = target;
      }
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.5 / fps && !v.seeking) v.currentTime = target;
    }
  }

  // Dokładne ustawienie klatek wideo (zdjęcie klatki / render klatka po klatce).
  async seekExact(t) {
    const layers = compositeAt(this.layout, t);
    const waits = [];
    for (const layer of layers) {
      const scene = this.layout[layer.index].scene;
      if (scene.source.type !== 'media' || scene.source.kind !== 'video') continue;
      const entry = this.media.get(this.mediaKey(scene));
      if (!entry || !entry.ready) continue;
      const v = entry.el;
      v.pause();
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : scene.duration;
      const target = layer.local % dur;
      if (Math.abs(v.currentTime - target) < 1e-3) continue;
      waits.push(new Promise((res) => {
        const done = () => { v.removeEventListener('seeked', done); res(); };
        v.addEventListener('seeked', done);
        v.currentTime = target;
        setTimeout(done, 2000);
      }));
    }
    await Promise.all(waits);
  }

  // ---------------- Rysowanie ----------------

  draw(prog) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  bindTex(unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  renderProcedural(slot, scene, local) {
    const gl = this.gl;
    const preset = scene.source.preset;
    const def = PROCEDURAL_SHADERS[preset] || PROCEDURAL_SHADERS.ocean;
    const target = this.sceneTarget(slot, def.scale * (this.project.renderScale || 1));
    const prog = this.procProgram(preset);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.p);
    const seed = Number(scene.source.seed) || 1;
    gl.uniform1f(prog.u.uTime, local + (seed % 50) * 3.7);
    gl.uniform1f(prog.u.uSeed, (seed % 97) * 0.61);
    gl.uniform2f(prog.u.uRes, target.w, target.h);
    this.draw(prog);
    return { tex: target.tex, w: target.w, h: target.h };
  }

  mediaTexture(scene, local, playing) {
    const entry = this.media.get(this.mediaKey(scene));
    if (!entry || !entry.ready) return null;
    const gl = this.gl;
    if (entry.kind === 'video') {
      this.syncVideo(entry, scene, local, playing, this.project.fps);
      if (entry.el.readyState < 2) return entry.uploaded ? { tex: entry.tex, w: entry.w, h: entry.h } : null;
    } else if (entry.uploaded) {
      return { tex: entry.tex, w: entry.w, h: entry.h };
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, entry.el);
      entry.uploaded = true;
    } catch (err) {
      entry.error = String(err.message || err);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return entry.uploaded ? { tex: entry.tex, w: entry.w, h: entry.h } : null;
  }

  pauseInactiveVideos(activeKeys, t, playing) {
    for (const scene of this.project.scenes) {
      if (scene.source.type !== 'media' || scene.source.kind !== 'video') continue;
      const key = this.mediaKey(scene);
      if (activeKeys.has(key)) continue;
      const entry = this.media.get(key);
      if (!entry?.el) continue;
      if (!entry.el.paused) entry.el.pause();
      // Przygotuj klip, który za chwilę wejdzie na ekran.
      const e = this.layout.find((x) => x.scene === scene);
      if (playing && e && e.start - t > 0 && e.start - t < 1.2 && entry.el.currentTime > 0.05 && !entry.el.seeking) entry.el.currentTime = 0;
    }
  }

  render(t, { playing = false } = {}) {
    const gl = this.gl;
    const project = this.project;
    if (!project) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const layers = compositeAt(this.layout, Math.min(t, this.total));
    const activeKeys = new Set();

    // 1) Warstwy scen -> bufor kompozycji
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.composite.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    layers.forEach((layer, slot) => {
      const scene = this.layout[layer.index].scene;
      let src = null;
      if (scene.source.type === 'media' && scene.source.url) {
        activeKeys.add(this.mediaKey(scene));
        src = this.mediaTexture(scene, layer.local, playing);
      }
      if (!src) src = this.renderProcedural(slot, scene, layer.local);
      const cam = cameraAt(scene, layer.local);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.composite.fb);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const P = this.layerProg;
      gl.useProgram(P.p);
      this.bindTex(0, src.tex);
      gl.uniform1i(P.u.uTex, 0);
      gl.uniform2f(P.u.uSrcSize, src.w, src.h);
      gl.uniform2f(P.u.uDstSize, W, H);
      gl.uniform3f(P.u.uCam, cam.zoom * layer.zoom, cam.x, cam.y);
      gl.uniform1f(P.u.uOpacity, layer.opacity);
      gl.uniform1f(P.u.uBrightness, layer.brightness);
      gl.uniform1f(P.u.uWipe, layer.wipe);
      const g = scene.grade;
      gl.uniform1f(P.u.uExposure, g.exposure);
      gl.uniform1f(P.u.uContrast, g.contrast);
      gl.uniform1f(P.u.uSaturation, g.saturation);
      gl.uniform1f(P.u.uTemperature, g.temperature);
      gl.uniform1f(P.u.uTint, g.tint);
      this.draw(P);
    });
    gl.disable(gl.BLEND);
    this.pauseInactiveVideos(activeKeys, t, playing);

    // 2) Bloom w 1/4 rozdzielczości
    const look = project.look;
    if (look.bloom > 0.001) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fb);
      gl.viewport(0, 0, this.bloomA.w, this.bloomA.h);
      gl.useProgram(this.brightProg.p);
      this.bindTex(0, this.composite.tex);
      gl.uniform1i(this.brightProg.u.uTex, 0);
      gl.uniform2f(this.brightProg.u.uTexel, 1 / W, 1 / H);
      this.draw(this.brightProg);
      for (let i = 0; i < 2; i++) {
        const spread = 1 + i;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB.fb);
        gl.useProgram(this.blurProg.p);
        this.bindTex(0, this.bloomA.tex);
        gl.uniform1i(this.blurProg.u.uTex, 0);
        gl.uniform2f(this.blurProg.u.uDir, spread / this.bloomA.w, 0);
        this.draw(this.blurProg);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fb);
        this.bindTex(0, this.bloomB.tex);
        gl.uniform2f(this.blurProg.u.uDir, 0, spread / this.bloomA.h);
        this.draw(this.blurProg);
      }
    }

    // 3) Napisy (Canvas 2D -> tekstura)
    this.drawOverlays(t);

    // 4) Postprodukcja -> ekran
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const P = this.postProg;
    gl.useProgram(P.p);
    this.bindTex(0, this.composite.tex);
    this.bindTex(1, this.bloomA.tex);
    this.bindTex(2, this.overlayTex);
    gl.uniform1i(P.u.uScene, 0);
    gl.uniform1i(P.u.uBloomTex, 1);
    gl.uniform1i(P.u.uOverlay, 2);
    gl.uniform2f(P.u.uRes, W, H);
    gl.uniform1f(P.u.uTime, t);
    gl.uniform1f(P.u.uGrain, look.grain);
    gl.uniform1f(P.u.uVignette, look.vignette);
    gl.uniform1f(P.u.uAberration, look.aberration);
    gl.uniform1f(P.u.uBloom, look.bloom);
    gl.uniform1f(P.u.uLetterbox, look.letterbox || 0);
    gl.uniform1f(P.u.uFade, globalFade(t, this.total, look.fadeInOut !== false));
    gl.uniform1f(P.u.uSharpen, look.sharpen);
    this.draw(P);

    const now = performance.now();
    this.stats.frames++;
    if (now - this.stats.last > 500) {
      this.stats.fps = (this.stats.frames * 1000) / (now - this.stats.last);
      this.stats.frames = 0;
      this.stats.last = now;
    }
  }

  drawOverlays(t) {
    const ctx = this.overlayCtx;
    const W = this.overlayCanvas.width;
    const H = this.overlayCanvas.height;
    const active = overlaysAt(this.project.overlays, t);
    const sub = this.project.subtitles?.enabled ? subtitleAt(this.layout, t) : null;
    const signature = active.length || sub ? 'x' : '';
    if (!signature && !this.overlayDirty) return;
    ctx.clearRect(0, 0, W, H);
    for (const a of active) drawText(ctx, a, W, H);
    if (sub) drawSubtitle(ctx, sub, W, H, this.project);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.overlayCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.overlayDirty = !!signature;
  }

  snapshot(type = 'image/png') {
    return new Promise((res) => this.canvas.toBlob(res, type, 0.95));
  }

  get fps() {
    return this.stats.fps;
  }
}

// ---------------- Rysowanie tekstu ----------------

function drawText(ctx, a, W, H) {
  const o = a.overlay;
  const st = o.style;
  const size = Math.max(6, st.size * H);
  ctx.save();
  ctx.globalAlpha = a.opacity;
  ctx.translate(a.x * W, a.y * H);
  ctx.rotate((a.rotation * Math.PI) / 180);
  ctx.scale(a.scale, a.scale);
  ctx.font = `${st.weight} ${size}px ${FONTS[st.font] || FONTS.sans}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = st.color;
  const lines = String(o.text).split('\n');
  const totalChars = lines.reduce((n, l) => n + [...l].length, 0);
  let budget = Math.round(totalChars * a.reveal);
  const lineH = size * 1.18;
  const spacing = a.tracking * size;
  lines.forEach((line, li) => {
    const chars = [...line];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const width = widths.reduce((s, w) => s + w, 0) + spacing * Math.max(0, chars.length - 1);
    let x = st.align === 'left' ? 0 : st.align === 'right' ? -width : -width / 2;
    const y = (li - (lines.length - 1) / 2) * lineH;
    if (st.box) {
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      const pad = size * 0.35;
      ctx.fillRect(x - pad, y - lineH / 2, width + pad * 2, lineH);
      ctx.restore();
    }
    if (st.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = size * 0.35;
      ctx.shadowOffsetY = size * 0.04;
    }
    chars.forEach((c, i) => {
      if (budget <= 0) return;
      budget--;
      ctx.fillText(c, x, y);
      x += widths[i] + spacing;
    });
  });
  ctx.restore();
}

function drawSubtitle(ctx, text, W, H, project) {
  const size = Math.max(10, (project.subtitles.size || 0.042) * H);
  ctx.save();
  ctx.font = `500 ${size}px ${FONTS.sans}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const aspect = W / H;
  const lb = project.look.letterbox || 0;
  const bar = lb > 0 && aspect < lb ? (1 - aspect / lb) / 2 : 0;
  const y = bar > 0.04 ? H * (1 - bar / 2) : H * 0.9;
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(W / 2 - w / 2 - size * 0.5, y - size * 0.75, w + size, size * 1.5);
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = size * 0.2;
  ctx.fillStyle = '#f4f1ea';
  ctx.fillText(text, W / 2, y);
  ctx.restore();
}
