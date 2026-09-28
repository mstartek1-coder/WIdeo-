// Kreator promptów "hiperrealizm": składa opis ujęcia w język, który modele wideo (Veo, Kling, Hailuo, Seedance...)
// rozumieją najlepiej – kamera, obiektyw, światło, materiał filmowy, fizyka ruchu i dźwięk.

export const CAMERA_MOVES = {
  static: { label: 'Statyw (bez ruchu)', text: 'locked-off tripod shot, perfectly stable frame' },
  'slow-dolly-in': { label: 'Powolny najazd (dolly in)', text: 'slow dolly-in towards the subject on a precision slider' },
  'dolly-out': { label: 'Odjazd (dolly out)', text: 'slow dolly-out revealing the surroundings' },
  handheld: { label: 'Z ręki (dokument)', text: 'handheld documentary camera with subtle natural shake' },
  'drone-flyover': { label: 'Przelot dronem', text: 'smooth cinematic drone flyover, high altitude, forward motion' },
  orbit: { label: 'Orbita wokół obiektu', text: 'slow 180-degree orbit around the subject' },
  tracking: { label: 'Tracking (za obiektem)', text: 'steadicam tracking shot following the subject' },
  'crane-up': { label: 'Wznoszenie (crane up)', text: 'crane shot rising up to reveal the landscape' },
  fpv: { label: 'FPV (dynamiczny dron)', text: 'fast FPV drone shot weaving through the scene' },
  'rack-focus': { label: 'Przeostrzenie (rack focus)', text: 'rack focus from foreground to background' },
};

export const LENSES = {
  '14mm': { label: '14 mm ultraszeroki', text: '14mm ultra-wide lens, expansive perspective' },
  '24mm': { label: '24 mm szeroki', text: '24mm wide-angle lens' },
  '35mm': { label: '35 mm (naturalny)', text: '35mm lens, natural perspective' },
  '50mm': { label: '50 mm', text: '50mm prime lens' },
  '85mm': { label: '85 mm portretowy', text: '85mm portrait lens at f/1.4, creamy shallow depth of field, soft bokeh' },
  '100mm-macro': { label: '100 mm makro', text: '100mm macro lens, extreme close-up detail, razor-thin focus plane' },
  anamorphic: { label: 'Anamorfotyczny 40 mm', text: '40mm anamorphic lens, oval bokeh, horizontal lens flares, 2.39:1 feel' },
  telephoto: { label: 'Teleobiektyw 200 mm', text: '200mm telephoto lens, compressed perspective, heat haze' },
};

export const LIGHTING = {
  'golden-hour': { label: 'Złota godzina', text: 'golden hour sunlight, warm low-angle key light, long soft shadows' },
  'blue-hour': { label: 'Niebieska godzina', text: 'blue hour ambience, cool diffuse skylight, first city lights' },
  overcast: { label: 'Pochmurno (miękkie)', text: 'overcast soft daylight, even diffused illumination' },
  'harsh-noon': { label: 'Ostre południe', text: 'harsh midday sun, crisp hard shadows, high contrast' },
  neon: { label: 'Neony nocą', text: 'neon-lit night, wet reflective surfaces, cyan and magenta practicals' },
  volumetric: { label: 'Promienie wolumetryczne', text: 'volumetric god rays through haze, atmospheric scattering' },
  moonlight: { label: 'Światło księżyca', text: 'cold moonlight, deep blue shadows, starry sky' },
  studio: { label: 'Studio (3 punkty)', text: 'three-point studio lighting, soft key, rim light separation' },
  candle: { label: 'Świece / ogień', text: 'flickering candle and firelight, warm practical light, deep blacks' },
};

export const FILM_LOOKS = {
  'arri-alexa': { label: 'ARRI Alexa 35', text: 'shot on ARRI Alexa 35, ARRI color science, 14 stops of dynamic range' },
  'red-raptor': { label: 'RED V-Raptor 8K', text: 'shot on RED V-Raptor 8K, ultra-sharp detail' },
  'sony-venice': { label: 'Sony Venice 2', text: 'shot on Sony Venice 2, rich natural skin tones' },
  'kodak-500t': { label: 'Kodak Vision3 500T (35 mm)', text: 'shot on Kodak Vision3 500T 35mm film, organic film grain, halation' },
  'kodak-portra': { label: 'Kodak Portra (ciepły)', text: 'Kodak Portra color palette, warm pastel tones' },
  iphone: { label: 'iPhone (UGC)', text: 'shot on iPhone 16 Pro, authentic user-generated look' },
  imax: { label: 'IMAX 70 mm', text: 'IMAX 70mm large format, immense clarity and scale' },
};

export const STYLES = {
  cinematic: { label: 'Kinowy blockbuster', text: 'cinematic blockbuster, professional color grading, epic composition' },
  documentary: { label: 'Dokument przyrodniczy', text: 'nature documentary in the style of BBC Earth, observational, real wildlife behaviour' },
  commercial: { label: 'Reklama produktowa', text: 'high-end commercial, pristine product cinematography, controlled reflections' },
  noir: { label: 'Neo-noir', text: 'neo-noir mood, deep shadows, moody contrast' },
  vlog: { label: 'Vlog / realne życie', text: 'authentic real-life footage, candid moment, natural imperfections' },
  music: { label: 'Teledysk', text: 'music video aesthetics, stylish rhythmic movement' },
};

export const REALISM_SUFFIX =
  'Photorealistic, indistinguishable from real footage. Physically accurate lighting and shadows, ' +
  'natural motion with real-world physics and inertia, realistic textures (skin pores, fabric weave, water, dust), ' +
  'correct scale and perspective, high dynamic range, subtle natural film grain, 24fps motion blur, sharp focus on subject.';

export const NEGATIVE_PROMPT =
  'cartoon, anime, 3d render, CGI look, video game, plastic skin, waxy faces, distorted hands, extra fingers, extra limbs, ' +
  'deformed anatomy, morphing, warping, flickering, jitter, text, subtitles, watermark, logo, low resolution, blurry, ' +
  'oversaturated, overexposed, unnatural motion, slow motion artifacts';

function pick(table, key) {
  return table[key]?.text || '';
}

// Buduje pełny prompt wideo z ustawień sceny.
export function buildVideoPrompt(prompt = {}, opts = {}) {
  const subject = (prompt.subject || '').trim() || 'A breathtaking real-world scene';
  const parts = [
    subject.replace(/\.*$/, '.'),
    capitalize(pick(CAMERA_MOVES, prompt.camera)) && `Camera: ${pick(CAMERA_MOVES, prompt.camera)}, ${pick(LENSES, prompt.lens) || '35mm lens'}.`,
    pick(LIGHTING, prompt.lighting) && `Lighting: ${pick(LIGHTING, prompt.lighting)}.`,
    [pick(FILM_LOOKS, prompt.film), pick(STYLES, prompt.style)].filter(Boolean).join(', ').replace(/^(.)/, (c) => c.toUpperCase()) + '.',
    REALISM_SUFFIX,
  ].filter((p) => p && p !== '.');
  if (opts.withAudio !== false && (prompt.audio || '').trim()) {
    parts.push(`Audio: ${prompt.audio.trim().replace(/\.*$/, '.')}`);
  }
  return parts.join(' ');
}

// Prompt dla generatora obrazu (fotografia jako materiał do animacji Ken Burns / image-to-video).
export function buildImagePrompt(prompt = {}) {
  const subject = (prompt.subject || '').trim() || 'A breathtaking real-world scene';
  return [
    subject.replace(/\.*$/, '.'),
    `${pick(LENSES, prompt.lens) || '35mm lens'}, ${pick(LIGHTING, prompt.lighting) || 'natural light'}.`,
    `${pick(FILM_LOOKS, prompt.film) || 'shot on a cinema camera'}.`,
    'Award-winning photograph, raw photo, ultra-detailed, true-to-life colors, natural imperfections, no text, no watermark.',
  ].join(' ');
}

// Prompt dźwiękowy (efekty/ambient) na podstawie sceny – dla generatorów SFX.
export function buildSfxPrompt(scene) {
  const explicit = (scene.audio?.sfx?.prompt || '').trim();
  if (explicit) return explicit;
  const fromPrompt = (scene.prompt?.audio || '').trim();
  if (fromPrompt) return fromPrompt;
  return `Realistic ambient soundscape for: ${(scene.prompt?.subject || scene.name || 'a cinematic scene').trim()}. High fidelity field recording, stereo.`;
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function optionsOf(table) {
  return Object.entries(table).map(([value, def]) => ({ value, label: def.label }));
}
