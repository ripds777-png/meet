import test, { beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import handler from '../api/openai.js';

const ENV_KEYS = ['OPENAI_API_KEY', 'APP_PASSWORD', 'OPENAI_MODEL', 'OPENAI_MODEL_FAST',
  'OPENAI_REASONING_EFFORT', 'OPENAI_REASONING_EFFORT_FAST'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  ENV_KEYS.forEach(k => delete process.env[k]);
  process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
  process.env.APP_PASSWORD = 'test-password';
  mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request'); });
});
afterEach(() => {
  mock.restoreAll();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const BASE = { societe: 'PWM', contexte: 'Projet hôtelier à qualifier, besoin de financement à préciser.', duree: 30 };
const USAGE = { input_tokens: 640, input_tokens_details: { cached_tokens: 512, cache_write_tokens: 32 }, output_tokens: 82 };
const SELECT = {
  phase: 'questions', intro: { advisorPresented: true, clientDescribed: true },
  posedId: 'q1', resolvedIds: ['q1', 'invented'], partialIds: ['q2', 'invented'],
  staleCurrent: true,
  intervention: { texte: 'Pourriez-vous préciser le calendrier prévu pour votre projet ?', categorie: 'strategique',
    objectif: 'Comprendre le calendrier', sourceCitation: 'Dans six mois', sourceHorodatage: '00:25',
    suites: [{ si: 'date ferme', alors: 'demander la pièce' }] },
  facts: [{ valeur: 'Projet prévu dans six mois', locuteur: 'client', categorie: 'strategique', citation: 'Dans six mois', certitude: 'déclaré' }]
};

function req(body = {}, options = {}) {
  return new Request('https://meeting.test/api/openai', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-app-password': 'test-password' },
    body: JSON.stringify({ ...BASE, ...body }), ...options
  });
}
function responseEvents(text, terminal = 'response.completed') {
  return [
    { type: 'response.created', response: { id: 'resp_test', status: 'in_progress' } },
    { type: 'response.output_text.delta', delta: text.slice(0, 13) },
    { type: 'response.output_text.delta', delta: text.slice(13) },
    { type: terminal, response: { status: terminal.slice(9), usage: USAGE,
      incomplete_details: { reason: 'max_output_tokens' }, error: { message: 'temporary failure', code: 'server_error' } } }
  ];
}
function wire(events, { crlf = false, noFinalNewline = false } = {}) {
  let text = events.map(e => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join('');
  if (noFinalNewline) text = text.trimEnd();
  if (crlf) text = text.replaceAll('\n', '\r\n');
  return text;
}
function upstream(raw, { byteByByte = false } = {}) {
  const bytes = new TextEncoder().encode(raw);
  let offset = 0;
  return new Response(new ReadableStream({
    pull(c) {
      if (offset === bytes.length) { c.close(); return; }
      const end = Math.min(bytes.length, offset + (byteByByte ? 1 : 37));
      c.enqueue(bytes.slice(offset, end)); offset = end;
    }
  }), { headers: { 'content-type': 'text/event-stream' } });
}
function useUpstream(events, wireOptions, streamOptions) {
  const calls = [];
  globalThis.fetch.mock.mockImplementation(async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return upstream(wire(events, wireOptions), streamOptions);
  });
  return calls;
}
async function eventsOf(response) {
  assert.equal(response.status, 200);
  const text = await response.text();
  return text.split('\n\n').filter(Boolean).map(block => ({
    event: block.match(/^event: (.+)$/m)[1], data: JSON.parse(block.match(/^data: (.+)$/m)[1])
  }));
}
const doneOf = events => events.find(e => e.event === 'done')?.data;
function assertFailed(events, pattern) {
  assert.equal(doneOf(events), undefined);
  assert.match(events.find(e => e.event === 'error')?.data.error || '', pattern);
}

test('authentication and validation stop requests before any provider call', async () => {
  assert.equal((await handler(req({ mode: 'ping' }, { headers: {} }))).status, 401);
  assert.equal((await handler(new Request('https://meeting.test/api/openai'))).status, 405);
  assert.equal((await handler(req({}, { body: '{broken' }))).status, 400);
  assert.equal((await handler(req({ mode: 'unknown' }))).status, 400);
  assert.equal((await handler(req({ mode: 'plan', contexte: 'short' }))).status, 400);
  assert.equal((await handler(req({ mode: 'plan', duree: 17 }))).status, 400);
  delete process.env.OPENAI_API_KEY;
  const missing = await handler(req({ mode: 'summary' }));
  assert.equal(missing.status, 500);
  assert.match((await missing.json()).error, /OPENAI_API_KEY/);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('ping works without consuming tokens', async () => {
  delete process.env.OPENAI_API_KEY;
  const result = await handler(req({ mode: 'ping', contexte: '' }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).ok, true);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('plan uses OpenAI credentials and preserves all supported durations and phase totals', async () => {
  const calls = useUpstream(responseEvents(JSON.stringify({
    phases: [{ key: 'introduction', minutes: 99 }, { key: 'strategie', minutes: 1 }],
    reserve: [{ sujet: 'Apports du sponsor', categorie: 'financier', pourquoi: 'Financement disponible' }]
  })));
  for (const duration of [20, 30, 45, 60, 90, 120]) {
    const data = doneOf(await eventsOf(await handler(req({ mode: 'plan', duree: duration }))));
    assert.equal(data.total, duration);
    assert.equal(data.phases.length, 5);
    assert.equal(data.phases.reduce((n, p) => n + p.minutes, 0), duration);
    assert.ok(data.phases.every(p => Number.isInteger(p.minutes) && p.minutes >= 1));
    assert.equal(data.reserve[0].categorie, 'financier');
  }
  const call = calls[0];
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal(call.options.headers.authorization, 'Bearer sk-test-not-a-real-key');
  assert.equal(call.options.headers['x-api-key'], undefined);
  assert.equal(call.body.model, 'gpt-6-sol');
  assert.equal(call.body.reasoning.effort, 'none');
  assert.equal(call.body.text.format.type, 'json_object');
  assert.equal(call.body.store, false);
  assert.equal(call.body.stream, true);
  assert.ok(call.body.max_output_tokens > 0);
  assert.match(call.body.instructions, /Swiss PWM AG/);
  assert.match(call.body.instructions, /AUCUNE règle validée/);
  assert.match(call.body.instructions, /RÉFÉRENTIEL MÉTIER/);
  assert.match(call.body.input[0].content, /objet JSON valide/);
  assert.equal(call.body.system, undefined);
  assert.equal(call.body.messages, undefined);
  assert.equal(call.body.max_tokens, undefined);
});

test('selector uses fast model, filters unknown question IDs and reports actual usage', async () => {
  const calls = useUpstream(responseEvents(JSON.stringify(SELECT)), { crlf: true, noFinalNewline: true }, { byteByByte: true });
  const events = await eventsOf(await handler(req({ mode: 'select', societe: 'ADM',
    questions: [{ id: 'q1' }, { id: 'q2' }], transcript: '[00:25] Client : Dans six mois.' })));
  const data = doneOf(events);
  assert.equal(data.phase, 'questions');
  assert.equal(data.intervention.texte, SELECT.intervention.texte);
  assert.equal(data.posedId, 'q1');
  assert.deepEqual(data.resolvedIds, ['q1']);
  assert.deepEqual(data.partialIds, ['q2']);
  assert.equal(data.facts[0].locuteur, 'client');
  assert.equal(data.staleCurrent, true);
  assert.equal(calls[0].body.model, 'gpt-6-luna');
  assert.match(calls[0].body.instructions, /Admiralty Capital Limited/);
  assert.deepEqual(events.find(e => e.event === 'usage').data, {
    cache_read: 512, cache_write: 32, input: 640, output: 82, model: 'gpt-6-luna'
  });
});

test('introduction gate blocks even a disobedient model, including streamed deltas', async () => {
  const bad = { ...SELECT, intro: { advisorPresented: true, clientDescribed: false } };
  useUpstream(responseEvents(JSON.stringify(bad)));
  const events = await eventsOf(await handler(req({ mode: 'select' })));
  assert.equal(doneOf(events).phase, 'intro');
  assert.equal(doneOf(events).intervention, null);
  assert.ok(events.filter(e => e.event === 'delta').every(e => e.data.t === ''));
  assert.ok(!JSON.stringify(events).includes(SELECT.intervention.texte));
});

test('preparer preserves memory, questions, branches, contradictions and document status', async () => {
  const preparation = { resume: 'Le sponsor attend une offre.',
    queue: [{ texte: 'Quels apports sont disponibles ?', categorie: 'financier', objectif: 'Vérifier les apports',
      pieceAttendue: 'Justificatif', suites: [{ si: 'apport annoncé', alors: 'demander une preuve' }] }],
    contradictions: [{ constat: 'Deux montants annoncés', formulation: 'Quel montant dois-je retenir ?' }],
    pieces: [{ libelle: 'Prévisionnel', statut: 'manquant' }] };
  const calls = useUpstream(responseEvents(JSON.stringify(preparation)));
  const data = doneOf(await eventsOf(await handler(req({ mode: 'prepare' }))));
  assert.deepEqual(data, preparation);
  assert.equal(calls[0].body.model, 'gpt-6-sol');
});

test('summary streams French text without losing split UTF-8 bytes', async () => {
  const text = 'COMPTE RENDU\nLe client a précisé son échéance : août. € 2,5 M.\nACTIONS\nÀ confirmer.';
  const calls = useUpstream(responseEvents(text), { crlf: true }, { byteByByte: true });
  const events = await eventsOf(await handler(req({ mode: 'summary' })));
  assert.equal(events.filter(e => e.event === 'delta').map(e => e.data.t).join(''), text);
  assert.equal(doneOf(events).text, text);
  assert.equal(calls[0].body.text.format.type, 'text');
});

test('model overrides stay independent and do not force reasoning on other models', async () => {
  process.env.OPENAI_MODEL = 'custom-responses-model';
  process.env.OPENAI_MODEL_FAST = 'custom-fast-model';
  process.env.OPENAI_REASONING_EFFORT_FAST = 'low';
  const calls = useUpstream(responseEvents(JSON.stringify(SELECT)));
  await eventsOf(await handler(req({ mode: 'prepare' })));
  await eventsOf(await handler(req({ mode: 'select' })));
  assert.equal(calls[0].body.model, 'custom-responses-model');
  assert.equal(calls[0].body.reasoning, undefined);
  assert.equal(calls[1].body.model, 'custom-fast-model');
  assert.deepEqual(calls[1].body.reasoning, { effort: 'low' });
});

test('provider HTTP errors distinguish key, quota, rate and model problems', async () => {
  const cases = [
    [401, 'invalid_api_key', 'Incorrect API key sk-secret-must-never-be-echoed', 502, /OPENAI_API_KEY invalide/],
    [403, 'permission_denied', 'Forbidden', 403, /droits de la clé/],
    [429, 'insufficient_quota', 'Quota', 429, /crédit ou quota/],
    [429, 'rate_limit_exceeded', 'Too many requests', 429, /limite de débit/],
    [404, 'model_not_found', 'No model', 404, /introuvable ou inaccessible/],
    [400, 'invalid_request_error', 'bad parameter sk-secret-must-never-be-echoed', 400, /clé masquée/]
  ];
  for (const [status, code, message, expectedStatus, pattern] of cases) {
    globalThis.fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ error: { code, message } }), { status }));
    const res = await handler(req({ mode: 'summary' }));
    assert.equal(res.status, expectedStatus);
    const error = (await res.json()).error;
    assert.match(error, pattern);
    assert.ok(!error.includes('sk-secret'));
  }
});

test('network failure and a missing response body return a useful gateway error', async () => {
  globalThis.fetch.mock.mockImplementation(async () => { throw new TypeError('network blocked'); });
  let res = await handler(req({ mode: 'summary' }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /joindre l’API OpenAI/);
  globalThis.fetch.mock.mockImplementation(async () => new Response(null));
  res = await handler(req({ mode: 'summary' }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /aucun flux/);
});

test('failed, incomplete, refused and disconnected streams never report success', async () => {
  const goodText = JSON.stringify(SELECT);
  const cases = [
    [responseEvents(goodText, 'response.incomplete'), /limite de tokens/],
    [responseEvents(goodText, 'response.failed'), /temporary failure/],
    [[{ type: 'error', code: 'insufficient_quota', message: 'Quota' }], /crédit ou quota/],
    [[{ type: 'response.refusal.delta', delta: 'Cannot comply' }], /pas pu répondre/],
    [responseEvents(goodText).slice(0, -1), /confirmation de fin/],
    [responseEvents(''), /Réponse OpenAI vide/],
    [responseEvents('Not JSON'), /objet JSON attendu/]
  ];
  for (const [fixture, pattern] of cases) {
    useUpstream(fixture);
    assertFailed(await eventsOf(await handler(req({ mode: 'select' }))), pattern);
  }
});

test('SSE multiline data and trailing event without a blank line are supported', async () => {
  const raw = 'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"Compte rendu terminé."}\r\n\r\n' +
    'event: response.completed\r\ndata: {"type":"response.completed","response":{"status":"completed"}}';
  globalThis.fetch.mock.mockImplementation(async () => upstream(raw, { byteByByte: true }));
  assert.equal(doneOf(await eventsOf(await handler(req({ mode: 'summary' })))).text, 'Compte rendu terminé.');
});

test('malformed SSE data is not converted to a successful empty result', async () => {
  globalThis.fetch.mock.mockImplementation(async () => upstream('event: response.output_text.delta\ndata: {broken}\n\n'));
  assertFailed(await eventsOf(await handler(req({ mode: 'summary' }))), /Événement OpenAI illisible/);
});

test('request abort propagates to the OpenAI request', { timeout: 2000 }, async () => {
  let providerSignal;
  globalThis.fetch.mock.mockImplementation(async (_url, options) => {
    providerSignal = options.signal;
    return new Response(new ReadableStream({
      start(c) { providerSignal.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')), { once: true }); }
    }));
  });
  const abort = new AbortController();
  const res = await handler(req({ mode: 'summary' }, { signal: abort.signal }));
  const reading = eventsOf(res);
  abort.abort();
  assert.equal(providerSignal.aborted, true);
  assert.equal(doneOf(await reading), undefined);
});

test('cancelling the browser response aborts upstream generation', { timeout: 2000 }, async () => {
  let providerSignal, wasCancelled = false;
  globalThis.fetch.mock.mockImplementation(async (_url, options) => {
    providerSignal = options.signal;
    return new Response(new ReadableStream({ cancel() { wasCancelled = true; } }));
  });
  const res = await handler(req({ mode: 'summary' }));
  await res.body.cancel();
  assert.equal(providerSignal.aborted, true);
  assert.equal(wasCancelled, true);
});

// Exécute le client SSE réellement livré dans index.html, sans dépendance navigateur.
test('manual button intentions and current question reach the model', async () => {
  for (const [intent, expected] of [['approfondir', /Approfondis/], ['avancer', /prochain point/],
    ['variantes', /3 formulations/], ['changer-categorie', /catégorie active demandée/], ['proposer-synthese', /synthèse fidèle/]]) {
    let body;
    globalThis.fetch.mock.mockImplementation(async (_url, options) => {
      body = JSON.parse(options.body);
      return upstream(wire(responseEvents(JSON.stringify(SELECT))));
    });
    await eventsOf(await handler(req({ mode: 'select', intent, current: { texte: 'Quel calendrier précis ?' } })));
    assert.match(body.input[0].content, expected);
    assert.match(body.input[0].content, /Quel calendrier précis/);
  }
});

test('variants are normalized and hidden during introduction', async () => {
  const fixture = { ...SELECT, variants: [SELECT.intervention, { texte: 'Quelle date avez-vous prévue ?' }, null, { texte: 'Extra' }] };
  useUpstream(responseEvents(JSON.stringify(fixture)));
  let done = doneOf(await eventsOf(await handler(req({ mode: 'select', intent: 'variantes' }))));
  assert.equal(done.variants.length, 2);
  fixture.intro = { advisorPresented: false, clientDescribed: false };
  useUpstream(responseEvents(JSON.stringify(fixture)));
  done = doneOf(await eventsOf(await handler(req({ mode: 'select' }))));
  assert.deepEqual(done.variants, []);
  assert.equal(done.intervention, null);
  useUpstream(responseEvents(JSON.stringify(fixture)));
  done = doneOf(await eventsOf(await handler(req({ mode: 'select', introForced: true }))));
  assert.equal(done.phase, 'questions');
  assert.ok(done.intervention);
});

function browserApi() {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const script = html.slice(html.indexOf('  async function api('), html.indexOf('  function ping()'));
  const state = { password: 'test-password', settings: {}, cfg: BASE };
  let route;
  const context = vm.createContext({
    S: state, LS: { pw: 'password' }, TextDecoder,
    lsDel() { throw new Error('Password must not be cleared'); },
    askPassword() { throw new Error('Unexpected password prompt'); },
    fetch: async (url, options) => { route = url; return handler(new Request('https://meeting.test' + url, options)); }
  });
  vm.runInContext(script + '\nthis.callApi = api;', context);
  return { call: context.callApi, state, route: () => route };
}

test('actual browser SSE client receives the migrated summary and usage', async () => {
  const text = 'COMPTE RENDU\nLe projet reste à qualifier.';
  useUpstream(responseEvents(text), { crlf: true }, { byteByByte: true });
  const client = browserApi();
  let streamed = '';
  const data = await client.call({ mode: 'summary' }, t => { streamed += t; });
  assert.equal(client.route(), '/api/openai');
  assert.equal(data.text, text);
  assert.equal(streamed, text);
  assert.equal(client.state.lastUsage.input, 640);
});

test('actual browser client surfaces OpenAI authentication errors without asking for the app password', async () => {
  globalThis.fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ error: { message: 'Bad key' } }), { status: 401 }));
  const client = browserApi();
  await assert.rejects(client.call({ mode: 'summary' }), /OPENAI_API_KEY invalide/);
  assert.equal(client.state.password, 'test-password');
});

test('actual browser client rejects a truncated report instead of enabling a partial export', async () => {
  useUpstream(responseEvents('COMPTE RENDU\nPartiel', 'response.incomplete'));
  await assert.rejects(browserApi().call({ mode: 'summary' }), /limite de tokens/);
});


test('document extraction validates sources server side and leaves approval unavailable',async()=>{
 const sources=[{id:'s1',text:'La société Exemple SAS demande 100 EUR.',role:'client'}];
 const facts=[{fieldId:'F07',sourceId:'s1',quote:sources[0].text,raw:'100 EUR',entity:'Exemple SAS',currency:'EUR'},{fieldId:'F21',sourceId:'s1',quote:sources[0].text,raw:'100 EUR'}];
 useUpstream(responseEvents(JSON.stringify({facts})));
 const events=await eventsOf(await handler(req({mode:'extract',sources})));
 assert.equal(doneOf(events).facts.length,1);assert.equal(doneOf(events).facts[0].raw,'100 EUR');
 const bad=await handler(req({mode:'extract',sources:[]}));assert.equal(bad.status,400);
});
