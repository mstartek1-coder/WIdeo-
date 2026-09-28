// Funkcje wygładzania ruchu (easing) używane przez keyframe'y, przejścia i ruch kamery.
// Wszystkie przyjmują t ∈ [0,1] i zwracają postęp (może lekko wychodzić poza [0,1] dla "back"/"elastic").

const c1 = 1.70158;
const c3 = c1 + 1;

export const easings = {
  linear: (t) => t,
  step: (t) => (t < 1 ? 0 : 1),
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeOutBack: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  easeOutElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
};

// Krzywa Béziera jak w CSS cubic-bezier(x1,y1,x2,y2) – przydatna do "filmowych" krzywych ruchu kamery.
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s) => (3 * ax * s + 2 * bx) * s + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let s = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(s) - x;
      if (Math.abs(err) < 1e-6) return sampleY(s);
      const d = slopeX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    // Bisekcja jako zabezpieczenie, gdy Newton się nie zbiega.
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 30; i++) {
      const v = sampleX(s);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sampleY(s);
  };
}

// "Filmowy" ruch: miękki start i miękkie wyhamowanie, jak u operatora na slajderze.
easings.cinematic = cubicBezier(0.45, 0.05, 0.25, 1);

export const easingNames = Object.keys(easings);

export function ease(name, t) {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const fn = easings[name] || easings.linear;
  return fn(x);
}
