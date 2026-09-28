// Reżyser AI (Claude): z krótkiego pomysłu tworzy pełny scenopis – prompty wizualne pod modele wideo,
// język kamery, światło, tekst lektora, opisy efektów dźwiękowych, przejścia i nastrój muzyki.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { PLAN_SCHEMA, DIRECTOR_INSTRUCTIONS, directorRequest, sanitizePlan } from '../../public/js/core/director-prompt.js';

export { PLAN_SCHEMA };

let client = null;
function getClient() {
  if (!config.anthropicKey) throw new Error('Brak ANTHROPIC_API_KEY w .env – użyj reżysera offline albo dodaj klucz.');
  if (!client) client = new Anthropic({ apiKey: config.anthropicKey });
  return client;
}

export async function directStoryboard({ idea, sceneCount = 6, style = 'cinematic', aspect = '16:9', language = 'polski' }, update = () => {}) {
  if (!idea || !String(idea).trim()) throw new Error('Opisz pomysł na film.');
  const n = Math.max(1, Math.min(20, Number(sceneCount) || 6));
  const model = config.directorModel;
  // Serwerowy fallback przy odmowie – zalecany dla Claude Opus 5 / Fable 5.1.
  const withFallback = /^claude-(opus-5|fable-5)/.test(model);
  update(`Reżyser (${model}) pisze scenopis…`);
  let response;
  try {
    response = await getClient().beta.messages.create({
      model,
      max_tokens: 16000,
      ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
      system: DIRECTOR_INSTRUCTIONS,
      messages: [{ role: 'user', content: directorRequest({ idea, sceneCount: n, style, aspect, language }) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('Claude: nieprawidłowy ANTHROPIC_API_KEY.');
    if (err instanceof Anthropic.NotFoundError) throw new Error(`Claude: model "${model}" jest niedostępny dla tego klucza (ustaw DIRECTOR_MODEL).`);
    if (err instanceof Anthropic.RateLimitError) throw new Error('Claude: przekroczono limit zapytań – spróbuj za chwilę.');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Claude: brak połączenia z API.');
    if (err instanceof Anthropic.APIError) throw new Error(`Claude: ${err.message}`);
    throw err;
  }
  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude odmówił przygotowania scenopisu${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'}`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('Claude: odpowiedź została ucięta – zmniejsz liczbę scen.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    throw new Error('Claude zwrócił nieprawidłowy JSON.');
  }
  return { plan: sanitizePlan(plan), model: response.model };
}
