import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function harness(api) {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', hidden: true,
      classList: { add() {}, remove() {}, toggle() {} }, listeners: {},
      addEventListener(event, fn) { this.listeners[event] = fn; } });
    return elements.get(id);
  };
  const S = { started: true, phase: 'questions', current: { texte: 'Quel est votre calendrier ?', qid: 'q0' },
    cfg: { duree: 30 }, questions: [], facts: [], history: [], variants: [], contexte: {},
    categorie: 'strategique', introState: {}, lastSelectAt: 0, qSeq: 0, selectInflight: null };
  const timers = new Map(), delays = new Map(); let seq = 0, now = 10000;
  const context = vm.createContext({ S, $, api, Date: { now: () => now }, AbortController, SELECT_MIN_GAP: 1500, LIVE_SELECT_GAP: 3000,
    setTimeout(fn, delay) { const id = ++seq; timers.set(id, fn); delays.set(id, delay); return id; }, clearTimeout(id) { timers.delete(id); },
    esc: String, CAT_LABEL: {}, elapsedNow: () => 0, nextQid: () => 'q' + (++S.qSeq),
    persist() {}, recentText: () => S.interim || 'Le client souhaite financer un hôtel.', currentPhaseLabel: () => 'strategie',
    whoOf: sp => sp === 0 ? 'me' : sp === 1 ? 'them' : 'unk', renderTranscript() {},
    renderIntro() {}, renderContexte() {}, maybeLeaveIntro() {}, recordLatency() {} });
  vm.runInContext(html.slice(html.indexOf('  function renderPrompter()'), html.indexOf('  function recordLatency(')) +
    '\nthis.run = runSelect; this.request = requestSelect; this.apply = applySelect; this.cancel = cancelSelect;', context);
  vm.runInContext(html.slice(html.indexOf('  function setInterim('), html.indexOf('  /* ══════════════ PHASE D')) + '\nthis.interim = setInterim;', context);
  const fire = id => { const fn = timers.get(id); timers.delete(id); now += delays.get(id) || 0; fn(); };
  return { S, $, context, timers, delays, fire };
}
const iv = texte => ({ texte, categorie: 'strategique' });

test('buttons send distinct intentions and the currently displayed question', async () => {
  for (const [button, intent] of [['btnDeeper', 'approfondir'], ['btnForward', 'avancer'], ['btnVariants', 'variantes']]) {
    let payload;
    const h = harness(async p => { payload = p; return { intervention: iv('Pourriez-vous préciser votre besoin ?') }; });
    h.$(button).listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(payload.intent, intent);
    assert.equal(payload.current.texte, 'Quel est votre calendrier ?');
  }
});

test('automatic events cannot cancel a manual request; provider errors stay visible', async () => {
  let reject; let calls = 0;
  const h = harness(() => { calls++; return new Promise((_, r) => { reject = r; }); });
  const running = h.context.run('approfondir', { intent: 'approfondir' });
  h.context.request('utterance');
  assert.equal(calls, 1);
  assert.equal(h.S.selectInflight.signal.aborted, false);
  reject(new Error('OPENAI_API_KEY est absente.'));
  await running;
  assert.match(h.$('aiStatus').textContent, /OPENAI_API_KEY/);
  assert.equal(h.S.selectInflight, null);
});

test('variants preserve the current question until explicitly selected', () => {
  const h = harness(async () => ({}));
  h.S.pausedAuto = true;
  h.context.apply({ variants: [iv('Première reformulation possible ?'), iv('Deuxième formulation possible ?')] }, 'variantes');
  assert.equal(h.S.current.qid, 'q0');
  assert.equal(h.S.variants.length, 2);
  assert.equal(h.$('variantBox').hidden, false);
  h.$('variantBox').listeners.click({ target: { closest: () => ({ dataset: { variant: '1' } }) } });
  assert.equal(h.S.current.texte, 'Deuxième formulation possible ?');
  assert.equal(h.S.variants.length, 0);
  assert.equal(h.S.history.length, 1);
});

test('previous clears stale pending suggestions and spontaneous answers remain accurate', () => {
  const h = harness(async () => ({}));
  h.S.history.push(iv('Question précédente ?'));
  h.S.pending = iv('Ancienne suggestion en attente ?');
  h.$('btnPrev').listeners.click();
  assert.equal(h.S.pending, null);
  assert.equal(h.S.current.texte, 'Question précédente ?');
  h.S.questions = [{ id: 'asked', statut: 'posée' }, { id: 'unasked', statut: 'affichée' }];
  h.context.apply({ resolvedIds: ['asked', 'unasked'] }, 'utterance');
  assert.equal(h.S.questions[0].spontanee, false);
  assert.equal(h.S.questions[1].spontanee, true);
});

test('Deepgram final results are split at each speaker change', () => {
  const segments = [];
  const context = vm.createContext({ S: {}, setInterim() {}, addSegment: (text, sp) => segments.push({ text, sp }) });
  vm.runInContext(html.slice(html.indexOf('  function onCallMsg('), html.indexOf('  /* -------- catégories')) + '\nthis.receive = onCallMsg;', context);
  context.receive({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'Bonjour. Bonjour !', words: [
    { punctuated_word: 'Bonjour.', speaker: 0 }, { punctuated_word: 'Bonjour', speaker: 1 }, { punctuated_word: '!', speaker: 1 }
  ] }] } });
  assert.deepEqual(segments, [{ text: 'Bonjour.', sp: 0 }, { text: 'Bonjour !', sp: 1 }]);
});

test('speaker identities remain distinct even before assigning the advisor role', () => {
  const context = vm.createContext({ S: { speakerMe: null } });
  vm.runInContext(html.slice(html.indexOf('  function whoOf('), html.indexOf('  function fullText(')) + '\nthis.label = sp => whoLabel(whoOf(sp));', context);
  assert.notEqual(context.label(0), context.label(1));
  assert.equal(context.label(null), 'Incertain');
});

test('interim speech starts suggestions without a final result or an utterance end', async () => {
  const calls = [];
  const h = harness(async payload => { calls.push(payload); return { intervention: iv('Pouvez-vous préciser le montant ?') }; });
  h.S.listening = true;
  h.context.interim('Je souhaite financer la rénovation', 1);
  const timer = h.S.liveTimer;
  h.context.interim('Je souhaite financer la rénovation de mon hôtel', 1);
  assert.equal(h.S.liveTimer, timer, 'continuous speech must not postpone the scheduled request');
  h.fire(timer);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.match(calls[0].transcript, /de mon hôtel/);
  assert.equal(h.S.current.texte, 'Pouvez-vous préciser le montant ?');
  h.context.interim('Je souhaite financer la rénovation de mon hôtel', 1);
  h.fire(h.S.liveTimer);
  assert.equal(calls.length, 1, 'unchanged speech must not repeat provider requests');
});

test('new speech is coalesced while a slow request completes, then latest text is processed', async () => {
  const calls = [], resolves = [];
  const h = harness(payload => { calls.push(payload); return new Promise(resolve => resolves.push(resolve)); });
  h.S.listening = true;
  h.context.interim('Nous avons un premier projet hôtelier', 1);
  h.fire(h.S.liveTimer);
  const firstController = h.S.selectInflight;
  h.context.interim('Nous avons un premier projet hôtelier et un budget de deux millions', 1);
  h.context.request('utterance');
  assert.equal(firstController.signal.aborted, false);
  assert.equal(calls.length, 1);
  resolves.shift()({ intervention: iv('Quelle est la nature du projet ?') });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.S.liveTimer);
  assert.ok(h.delays.get(h.S.liveTimer) >= 2800);
  h.fire(h.S.liveTimer);
  assert.equal(calls.length, 2);
  assert.match(calls[1].transcript, /deux millions/);
  resolves.shift()({ intervention: iv('Quelle part souhaitez-vous financer ?') });
  await new Promise(resolve => setImmediate(resolve));
});

test('live suggestions respect manual requests, pause, reading locks and stop', async () => {
  const h = harness(async () => ({ intervention: iv('Une nouvelle question pendant la parole ?') }));
  h.S.listening = true; h.S.pausedAuto = true; h.S.locked = true;
  h.context.interim('Je vous présente notre société', 0);
  assert.equal(h.S.liveTimer, undefined, 'advisor speech must not change their displayed question');
  h.context.interim('Je souhaite vous parler de mon projet', 1);
  assert.equal(h.S.locked, false, 'client speech releases the previous reading lock');
  h.fire(h.S.liveTimer);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.S.current.texte, 'Quel est votre calendrier ?');
  assert.ok(h.S.pending);
  h.context.interim('Je souhaite vous parler de mon nouveau budget', 1);
  const timer = h.S.liveTimer;
  h.context.cancel();
  assert.equal(h.timers.has(timer), false);
  h.S.listening = false;
  h.context.interim('Une phrase reçue après la fin', 1);
  assert.equal(h.S.liveTimer, null);
});

test('completed introduction can transition on live speech without waiting for a pause', () => {
  const h = harness(async () => ({}));
  h.context.awaitingPause = false;
  h.context.promote = () => {};
  vm.runInContext(html.slice(html.indexOf('  function maybeLeaveIntro('), html.indexOf("  $('btnStartQuestions')")) + '\nthis.leave = maybeLeaveIntro;', h.context);
  h.S.phase = 'intro'; h.S.introState = { advisorPresented: true, clientDescribed: true };
  h.S.pending = iv('Précisons votre projet ensemble ?');
  h.context.leave('live');
  assert.equal(h.S.phase, 'questions');
});
