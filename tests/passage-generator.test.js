import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS, generatePassage, scoreCandidate, troubleWordsIn, wordBand } from '../js/passage-generator.js';
import { PRACTICE_SCRIPTS } from '../js/scripts-library.js';

// Small seeded PRNG so every run of these tests sees the same "random" choices.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const countWords = (text) => text.split(/\s+/).length;
const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const sentencesOf = (text) => text.split(/(?<=[.!?])\s+/);

const HISTORY = [
  'The quiet lighthouse keeper polished the brass lantern every evening before the fog rolled in.',
  'Silence falls upon the city streets like a velvet shroud, a gentle haze of morning mist that slowly lifts to reveal the pulse of the city.'
];

test('passages land inside the word band for the level, for every focus', () => {
  for (const level of [1, 3, 6, 10]) {
    const { min, max } = wordBand(level);
    for (const focus of ['general', 'clarity', 'volume', 'pitch']) {
      for (let seed = 1; seed <= 8; seed += 1) {
        const text = generatePassage({ level, focus, random: seeded(seed) });
        const words = countWords(text);
        assert.ok(words >= min && words <= max, `L${level} ${focus} seed ${seed}: ${words} words in "${text}"`);
        assert.match(text, /[.!?]$/);
      }
    }
  }
});

test('output varies from run to run', () => {
  const texts = new Set();
  for (let seed = 1; seed <= 20; seed += 1) {
    texts.add(generatePassage({ level: 4, focus: 'clarity', random: seeded(seed) }));
  }
  assert.ok(texts.size >= 10, `only ${texts.size} distinct passages in 20 runs`);
});

test('without trouble words, no sentence is a verbatim copy of anything it was trained on', () => {
  const known = new Set([
    ...Object.values(CORPUS).flat(),
    ...PRACTICE_SCRIPTS.flatMap((script) => sentencesOf(script.text)),
    ...HISTORY.flatMap(sentencesOf)
  ].map(normalize));
  for (let seed = 1; seed <= 40; seed += 1) {
    const text = generatePassage({ level: 5, focus: 'clarity', history: HISTORY, random: seeded(seed) });
    for (const sentence of sentencesOf(text)) {
      assert.ok(!known.has(normalize(sentence)), `copied a training sentence: "${sentence}"`);
    }
  }
});

test('never hands back a whole passage that was practiced before', () => {
  const blocked = new Set([...PRACTICE_SCRIPTS.map((script) => script.text), ...HISTORY].map(normalize));
  for (let seed = 1; seed <= 40; seed += 1) {
    const text = generatePassage({ level: 3, focus: 'general', history: HISTORY, random: seeded(seed) });
    assert.ok(!blocked.has(normalize(text)), `repeated a known passage: ${text}`);
  }
});

test('trouble words are worked into the passage', () => {
  // The words come from HISTORY, i.e. from passages the player already met them in.
  for (const level of [3, 4, 5, 6, 7, 8, 9]) {
    for (let seed = 1; seed <= 12; seed += 1) {
      const text = generatePassage({ level, focus: 'clarity', troubleWords: ['lantern'], history: HISTORY, random: seeded(seed) });
      assert.ok(/lantern/i.test(text), `L${level} seed ${seed} missed the trouble word: "${text}"`);
    }
  }
});

test('with several trouble words, at least one always lands and often more', () => {
  const troubleWords = ['lantern', 'purpose', 'velvet'];
  let coveredMany = 0;
  for (let seed = 1; seed <= 30; seed += 1) {
    const text = generatePassage({ level: 7, focus: 'pitch', troubleWords, history: HISTORY, random: seeded(seed) });
    const hits = troubleWordsIn(text, troubleWords).length;
    assert.ok(hits >= 1, `no trouble word in "${text}"`);
    if (hits >= 2) coveredMany += 1;
  }
  assert.ok(coveredMany >= 20, `only ${coveredMany}/30 passages covered two or more trouble words`);
});

test('a trouble-word sentence is never served back as a bare repeat of a practiced passage', () => {
  const practiced = ['The quiet lighthouse keeper polished the brass lantern every evening before the fog rolled in.'];
  for (let seed = 1; seed <= 30; seed += 1) {
    const text = generatePassage({ level: 4, focus: 'general', troubleWords: ['lantern'], history: practiced, random: seeded(seed) });
    assert.notEqual(normalize(text), normalize(practiced[0]));
    assert.ok(/lantern/i.test(text));
  }
});

test('trouble words it has never seen a sentence for are simply ignored, not invented', () => {
  const text = generatePassage({ level: 4, focus: 'clarity', troubleWords: ['xylophone'], random: seeded(3) });
  const words = countWords(text);
  assert.ok(words >= wordBand(4).min && words <= wordBand(4).max);
  assert.equal(troubleWordsIn(text, ['xylophone']).length, 0);
});

test('troubleWordsIn reports which requested words a passage contains', () => {
  assert.deepEqual(troubleWordsIn('A thoughtful speaker, with purpose.', ['Thoughtful', 'lantern', 'purpose']), ['Thoughtful', 'purpose']);
  assert.deepEqual(troubleWordsIn('Nothing here.', ['lantern']), []);
});

test('scoring rewards the kind of practice each weak skill needs', () => {
  const plain = 'The team met at the old house on a warm day.';
  const twister = 'Sixty swift swimmers splashed through the shimmering shallows.';
  assert.ok(scoreCandidate(twister, { focus: 'clarity' }) > scoreCandidate(plain, { focus: 'clarity' }));

  const question = 'Can you believe how quickly the whole day flew by?';
  assert.ok(scoreCandidate(question, { focus: 'pitch' }) > scoreCandidate(plain, { focus: 'pitch' }));

  const sustained = 'When the hall finally fell silent, she stepped forward, lifted her chin, and let her voice fill every corner of the room.';
  const choppy = 'It was late. We left. She sat. He stood.';
  assert.ok(scoreCandidate(sustained, { focus: 'volume' }) > scoreCandidate(choppy, { focus: 'volume' }));
});

test('scoring rewards trouble words and penalises repeated words', () => {
  const base = 'The harbor lights glowed softly.';
  assert.ok(scoreCandidate(base, { troubleWords: ['harbor'] }) > scoreCandidate(base));
  assert.ok(scoreCandidate('Soft soft soft light.') < scoreCandidate('Soft warm golden light.'));
});
