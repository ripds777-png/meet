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
  const timers = new Map(); let seq = 0;
  const context = vm.createContext({ S, $, api, Date, AbortController, SELECT_MIN_GAP: 1500,
    setTimeout(fn) { const id = ++seq; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    esc: String, CAT_LABEL: {}, elapsedNow: () => 0, nextQid: () => 'q' + (++S.qSeq),
    persist() {}, recentText: () => 'Le client souhaite financer un hôtel.', currentPhaseLabel: () => 'strategie',
    renderIntro() {}, renderContexte() {}, maybeLeaveIntro() {}, recordLatency() {} });
  vm.runInContext(html.slice(html.indexOf('  function renderPrompter()'), html.indexOf('  function recordLatency(')) +
    '\nthis.run = runSelect; this.request = requestSelect; this.apply = applySelect;', context);
  return { S, $, context, timers };
}
const iv = texte => ({ texte, categorie: 'strategique' });

test('buttons send distinct intentions and the currently displayed question', async () => {
  for (const [button, intent] of [['btnDeeper', 'approfondir'], ['btnForward', 'avancer'], ['btnVariants', 'variantes']]) {
    let payload;
    const h = harness(async p => { payload = p; return { intervention: iv('Pourriez-vous préciser votre besoin ?') }; });
    h.$(button).listeners.click();
    await Promise.resolve();
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
