// Oś czasu: ścieżki obrazu, napisów, lektora/SFX i muzyki; przewijanie, przeciąganie napisów, zmiana długości scen.

import { h } from './dom.js';

const GUTTER = 78;

export class TimelineView {
  constructor(el, handlers) {
    this.el = el;
    this.handlers = handlers;
    this.zoom = 1;
    this.pps = 40;
    this.total = 0;
    this.el.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.zoom = Math.min(12, Math.max(0.5, this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      this.handlers.onZoom?.();
    }, { passive: false });
    new ResizeObserver(() => this.handlers.onZoom?.()).observe(el);
  }

  x(t) {
    return GUTTER + t * this.pps;
  }

  render(project, layout, total, selection, busyScenes = new Set()) {
    this.total = total;
    const width = this.el.clientWidth || 800;
    this.pps = Math.max(12, (width - GUTTER - 24) / Math.max(total, 1)) * this.zoom;
    const inner = h('div', { class: 'tl-inner', style: { width: `${this.x(total) + 40}px` } });

    // Linijka czasu
    const ruler = h('div', { class: 'tl-ruler' });
    const step = pickStep(this.pps);
    for (let t = 0; t <= total + 1e-6; t += step) {
      ruler.append(h('div', { class: 'tl-tick', style: { left: `${this.x(t)}px` } }, formatTick(t)));
    }
    this.bindSeek(ruler);
    inner.append(ruler);

    // Obraz
    const video = h('div', { class: 'tl-track' }, h('span', { class: 'tl-label' }, 'Obraz'));
    for (const e of layout) {
      const s = e.scene;
      const kind = s.source.type === 'media' ? (s.source.kind === 'image' ? 'image' : 'media') : s.source.type === 'shader' ? 'ai' : '';
      const selected = selection.type === 'scene' && selection.id === s.id;
      const clip = h(
        'div',
        {
          class: `tl-clip scene ${kind} ${selected ? 'selected' : ''}`,
          style: { left: `${this.x(e.start)}px`, width: `${Math.max(4, e.scene.duration * this.pps)}px` },
          title: `${s.name} · ${s.duration.toFixed(1)} s`,
          onpointerdown: (ev) => {
            if (ev.target.classList.contains('tl-handle')) return;
            this.handlers.onSelect({ type: 'scene', id: s.id });
            this.handlers.onSeek(e.start + 0.001);
          },
        },
        `${busyScenes.has(s.id) ? '⏳ ' : ''}${e.index + 1}. ${s.name}`,
        h('div', { class: 'tl-handle', title: 'Przeciągnij, aby zmienić długość sceny', onpointerdown: (ev) => this.dragSceneEdge(ev, s) }),
      );
      video.append(clip);
      if (e.overlapOut > 0) {
        video.append(h('div', { class: 'tl-trans', style: { left: `${this.x(e.end - e.overlapOut)}px`, width: `${e.overlapOut * this.pps}px` }, title: s.transition.type }));
      }
    }
    inner.append(video);

    // Napisy
    const ovl = h('div', { class: 'tl-track small' }, h('span', { class: 'tl-label' }, 'Napisy'));
    for (const o of project.overlays) {
      const selected = selection.type === 'overlay' && selection.id === o.id;
      ovl.append(
        h(
          'div',
          {
            class: `tl-clip overlay ${selected ? 'selected' : ''}`,
            style: { left: `${this.x(o.start)}px`, width: `${Math.max(6, (o.end - o.start) * this.pps)}px`, top: '3px', bottom: '3px', padding: '1px 6px' },
            title: 'Przeciągnij, aby przesunąć napis',
            onpointerdown: (ev) => this.dragOverlay(ev, o),
          },
          String(o.text).replace(/\n/g, ' '),
          h('div', { class: 'tl-handle', onpointerdown: (ev) => this.dragOverlay(ev, o, true) }),
        ),
      );
    }
    this.bindSeek(ovl, true);
    inner.append(ovl);

    // Lektor i efekty
    const vo = h('div', { class: 'tl-track small' }, h('span', { class: 'tl-label' }, 'Lektor'));
    for (const e of layout) {
      const a = e.scene.audio;
      if (a.voice.text || a.voice.url) {
        const est = a.voice.duration || Math.min(e.scene.duration - 0.3, Math.max(1, a.voice.text.length / 14));
        vo.append(h('div', { class: 'tl-clip voice', style: { left: `${this.x(e.start + 0.3)}px`, width: `${Math.max(4, est * this.pps)}px`, top: '3px', bottom: '3px', padding: '1px 6px', opacity: a.voice.url ? 1 : 0.45 }, title: a.voice.url ? 'Lektor (nagrany)' : 'Lektor – tylko tekst (napisy)' }, a.voice.url ? '🎙' : '✎', ' ', a.voice.text));
      }
      if (a.sfx.url) {
        vo.append(h('div', { class: 'tl-clip sfx', style: { left: `${this.x(e.start + (a.sfx.offset || 0))}px`, width: `${Math.max(4, Math.min(e.scene.duration, a.sfx.duration || 3) * this.pps)}px`, top: '14px', bottom: '2px', padding: '0 5px', fontSize: '9px' } }, 'SFX'));
      }
    }
    this.bindSeek(vo, true);
    inner.append(vo);

    // Muzyka
    const mu = h('div', { class: 'tl-track small' }, h('span', { class: 'tl-label' }, 'Muzyka'));
    const m = project.audio.music;
    if (m.url || (m.mood && m.mood !== 'none')) {
      mu.append(h('div', { class: 'tl-clip music', style: { left: `${this.x(0)}px`, width: `${total * this.pps}px`, top: '3px', bottom: '3px', padding: '1px 6px' } }, m.url ? '♫ plik muzyki' : `♫ ${m.mood}`));
    }
    this.bindSeek(mu, true);
    inner.append(mu);

    this.playhead = h('div', { class: 'tl-playhead' });
    inner.append(this.playhead);
    this.el.replaceChildren(inner);
  }

  setTime(t) {
    if (this.playhead) this.playhead.style.left = `${this.x(t)}px`;
  }

  timeFromEvent(ev) {
    const rect = this.el.getBoundingClientRect();
    const x = ev.clientX - rect.left + this.el.scrollLeft;
    return Math.max(0, Math.min(this.total, (x - GUTTER) / this.pps));
  }

  bindSeek(el, onlySelf = false) {
    el.addEventListener('pointerdown', (ev) => {
      if (onlySelf && ev.target !== el) return;
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      this.handlers.onSeek(this.timeFromEvent(ev));
      const move = (e) => this.handlers.onSeek(this.timeFromEvent(e));
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  dragOverlay(ev, o, resize = false) {
    ev.stopPropagation();
    ev.preventDefault();
    // Zaznaczenie dopiero po puszczeniu – przerysowanie osi w trakcie odłączyłoby przeciągany element.
    const target = ev.currentTarget;
    target.setPointerCapture(ev.pointerId);
    const x0 = ev.clientX;
    const s0 = o.start;
    const e0 = o.end;
    let moved = false;
    const clipEl = resize ? target.parentElement : target;
    const move = (e) => {
      const dt = (e.clientX - x0) / this.pps;
      if (Math.abs(e.clientX - x0) > 2) moved = true;
      const r2 = (v) => Math.round(v * 100) / 100;
      let start = s0;
      let end = r2(Math.max(s0 + 0.2, e0 + dt));
      if (!resize) {
        start = r2(Math.max(0, s0 + dt));
        end = r2(start + (e0 - s0));
      }
      // Na żywo przesuwamy tylko element – pełne przerysowanie osi dopiero po puszczeniu.
      clipEl.style.left = `${this.x(start)}px`;
      clipEl.style.width = `${Math.max(6, (end - start) * this.pps)}px`;
      this.handlers.onOverlayTime(o.id, start, end, false);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      if (moved) this.handlers.onOverlayTime(o.id, o.start, o.end, true);
      else this.handlers.onSeek(this.timeFromEvent(ev));
      this.handlers.onSelect({ type: 'overlay', id: o.id });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }

  dragSceneEdge(ev, scene) {
    ev.stopPropagation();
    ev.preventDefault();
    const target = ev.currentTarget;
    target.setPointerCapture(ev.pointerId);
    const x0 = ev.clientX;
    const d0 = scene.duration;
    const clipEl = target.parentElement;
    const move = (e) => {
      const d = Math.max(0.5, Math.round((d0 + (e.clientX - x0) / this.pps) * 10) / 10);
      clipEl.style.width = `${d * this.pps}px`;
      this.handlers.onSceneDuration(scene.id, d, false);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      this.handlers.onSceneDuration(scene.id, scene.duration, true);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }
}

function pickStep(pps) {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pps >= 55) return s;
  return 120;
}

function formatTick(t) {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return m ? `${m}:${String(Math.floor(s)).padStart(2, '0')}` : `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
}
