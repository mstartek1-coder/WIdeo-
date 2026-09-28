// Integracja z aplikacją Claude: gdy studio działa jako strona w aplikacji (bez własnego serwera),
// pliki zapisuje przez okno potwierdzenia aplikacji, a reżyser AI korzysta z konta Claude oglądającego.

const hasRuntime = () => typeof window !== 'undefined' && !!window.claude && typeof window.claude.use === 'function';

export const platform = {
  embedded: hasRuntime(),
  downloads: null,
  sample: null,
};

export const platformReady = (async () => {
  if (!platform.embedded) return platform;
  const [downloads, sample] = await Promise.all([
    window.claude.use('downloads').catch(() => null),
    window.claude.use('sample').catch(() => null),
  ]);
  platform.downloads = downloads;
  platform.sample = sample;
  return platform;
})();

const SAMPLE_ERRORS = {
  not_granted: 'Nie pozwolono tej stronie korzystać z Claude.',
  sampling_disabled: 'Claude nie jest dostępny dla tego konta.',
  rate_limited: 'Za dużo zapytań do Claude – spróbuj ponownie za chwilę.',
  session_expired: 'Sesja wygasła – zaloguj się ponownie w aplikacji Claude.',
  refused: 'Claude odmówił wykonania tego zadania – zmień opis.',
  invalid_json: 'Odpowiedź Claude miała zły format – spróbuj ponownie.',
  empty_completion: 'Claude nie zwrócił odpowiedzi – spróbuj krótszego opisu.',
  prompt_too_large: 'Zapytanie jest za długie – skróć opis.',
};

export function sampleErrorMessage(err) {
  return SAMPLE_ERRORS[err?.code] || 'Nie udało się połączyć z Claude – spróbuj ponownie.';
}
