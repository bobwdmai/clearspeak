// Offline passage generator, used when the AI Worker can't supply one
// (network failure, or the daily token budget is spent). Deliberately small
// machine learning, all in the browser:
//
//   1. "Train" a word-level Markov chain (which word tends to follow each
//      pair of words) on a built-in corpus, the preset passages, and the
//      passages the player has practiced before — so it picks up the style
//      and vocabulary of the AI-written ones too.
//   2. Aim at the player's trouble spots. Words they keep missing get
//      "anchor" sentences: a sentence containing the word (from their own
//      history, the presets or the corpus) is dropped into the passage as-is,
//      because re-drilling the exact context they stumbled on is the point.
//   3. Fill the rest of the level's word band with new sentences sampled from
//      the chain. Every one has to be new (never a verbatim training
//      sentence), and after a determiner or preposition ("the", "of", "with")
//      the chain may back off to any word seen after it, which is what lets
//      it recombine phrases instead of replaying them.
//   4. Sample many candidates, score each for how well it fits (trouble words
//      covered, and the weak skill's kind of practice), then pick randomly
//      among the best few so repeat requests still vary.
//
// The chain recombines existing phrasing, so its sentences can be quirky or
// slightly off-grammar — fine for a speaking drill.

import { PRACTICE_SCRIPTS } from './scripts-library.js';

const TERMINAL = /[.!?]$/;
const MAX_SENTENCE_TOKENS = 26;
const MIN_SENTENCE_TOKENS = 6;
const BACKOFF_CHANCE = 0.5;
const MAX_SPLICES = 1; // a sentence may branch off the chain at most once, to stay coherent
const TOP_CHOICES = 5;
const MAX_ANCHORS = 2;

export const CORPUS = {
  general: [
    'A calm voice carries further than a loud one.',
    'We meet again at the edge of the quiet town.',
    'Good speakers pause, breathe, and let each idea land.',
    'The morning light spilled across the old wooden table.',
    'She read the message twice before she answered.',
    'Small steady steps will take you a long way.',
    'The team gathered around the map and made a plan.',
    'He spoke slowly so that every word could be heard.',
    'Clear speech begins with a relaxed jaw and an open mind.',
    'The river bends where the tall grass meets the stones.'
  ],
  clarity: [
    'Sixty swift swimmers splashed through the shimmering shallows.',
    'The strict sergeant stressed the strengths of the street patrol.',
    'Crisp crackers crunched beneath the crooked crescent moon.',
    'Three thrushes thrust their throats through the thick thistle.',
    'Blustery breezes brushed the brittle branches of the birch.',
    'She sells sturdy sandals beside the seashore stalls.',
    'Prompt proctors praised the practical proposals of the private club.',
    'Quick clever clerks placed the plain blue plates on the black shelf.'
  ],
  volume: [
    'When the hall finally fell silent, she stepped forward, lifted her chin, and let her voice fill every corner of the room.',
    'Speak as though the person in the back row is a friend you are eager to reach, and your voice will grow to meet them.',
    'The crowd along the shore watched the ships drift out toward the horizon, and the whole harbor seemed to hold its breath.',
    'Thank you all for coming tonight, because your patience and your questions make this work worth doing.',
    'Across the wide green valley, the bells rang out, one after another, until the echo carried the news to every distant village.',
    'Steady breath, open shoulders, and a clear intention behind each phrase will carry your message farther than force ever could.'
  ],
  pitch: [
    'Can you believe how quickly the whole day flew by?',
    'It was quiet at first, but then the whole room burst into laughter!',
    'Wait, you mean it was there all along?',
    'Some people whisper their secrets, while others shout them from the rooftops.',
    'What a wonderful surprise, and what perfect timing!',
    'Was it courage, or was it simply curiosity that pushed her forward?',
    'Slowly, the door creaked open, and there stood our old friend!',
    'Not the red one, the blue one, the one beside the window!'
  ]
};

// Same word bands the Worker asks the AI for, so difficulty feels the same.
export function wordBand(level) {
  if (level <= 2) return { min: 10, max: 16 };
  if (level <= 5) return { min: 16, max: 24 };
  if (level <= 8) return { min: 24, max: 34 };
  return { min: 30, max: 45 };
}

const CONTRAST_WORDS = new Set(['but', 'yet', 'while', 'or', 'though', 'still']);
const COMMON_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'it', 'is', 'was', 'that',
  'for', 'with', 'as', 'by', 'her', 'his', 'she', 'he', 'they', 'we', 'you', 'i', 'each', 'every'
]);
// Words after which the next word starts a noun phrase, so swapping the
// continuation for any other seen after the same word still parses.
const BACKOFF_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'by', 'with', 'through', 'across', 'beneath',
  'every', 'each', 'her', 'his', 'their', 'your'
]);

function wordsOf(text) {
  return text.toLowerCase().match(/[a-z']+/g) || [];
}

// Which of the given words actually appear in a passage — used to tell the
// player what a passage is aimed at.
export function troubleWordsIn(text, troubleWords = []) {
  const present = new Set(wordsOf(text));
  return troubleWords.filter((word) => present.has(word.toLowerCase()));
}

// Repetition-heavy sentences ("Whether the weather... we will weather the
// weather together") send the chain round in circles, so they aren't used
// as training data.
function isLoopy(sentence) {
  const counts = new Map();
  for (const word of wordsOf(sentence)) {
    if (!COMMON_WORDS.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 3);
}

function tidy(text) {
  return String(text)
    .replace(/[“”"]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text, { keepLoopy = false } = {}) {
  return tidy(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => (TERMINAL.test(sentence) ? sentence : `${sentence}.`))
    .filter((sentence) => sentence.split(' ').length >= 4 && (keepLoopy || !isLoopy(sentence)));
}

function normalize(text) {
  return tidy(text).toLowerCase();
}

function pick(items, random) {
  return items[Math.floor(random() * items.length)];
}

function shuffled(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function buildChain(sentences) {
  const starts = [];
  const next = new Map(); // "w1 w2" -> words that followed that pair
  const next1 = new Map(); // "w" -> words that followed it anywhere (backoff)
  const remember = (map, key, token) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(token);
  };
  for (const sentence of sentences) {
    const tokens = sentence.split(' ');
    if (tokens.length < 3) continue;
    starts.push(`${tokens[0]} ${tokens[1]}`);
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      remember(next1, tokens[index], tokens[index + 1]);
      if (index + 2 < tokens.length) remember(next, `${tokens[index]} ${tokens[index + 1]}`, tokens[index + 2]);
    }
  }
  return { starts, next, next1 };
}

function sampleSentence(chain, random) {
  const tokens = pick(chain.starts, random).split(' ');
  let splices = 0;
  while (!TERMINAL.test(tokens[tokens.length - 1])) {
    if (tokens.length >= MAX_SENTENCE_TOKENS) return null;
    const last = tokens[tokens.length - 1];
    let options = chain.next.get(`${tokens[tokens.length - 2]} ${last}`);
    // Where the pair has only one known continuation the chain would just replay
    // a training sentence; after a determiner/preposition, sometimes branch off.
    const forced = !options || new Set(options).size === 1;
    if (forced && splices < MAX_SPLICES && BACKOFF_WORDS.has(last.toLowerCase()) && chain.next1.has(last) && (!options || random() < BACKOFF_CHANCE)) {
      options = chain.next1.get(last);
      splices += 1;
    }
    if (!options) return null;
    tokens.push(pick(options, random));
  }
  return tokens;
}

function isUsableSentence(tokens, known) {
  if (tokens.length < MIN_SENTENCE_TOKENS) return false;
  const text = tokens.join(' ');
  if (known.has(normalize(text)) || isLoopy(text)) return false;
  // A sentence that trails off on "the." or "and." isn't finished.
  return !COMMON_WORDS.has(wordsOf(tokens[tokens.length - 1])[0]);
}

// Sentences (new ones from the chain) totalling between `min` and `max` words.
function sampleFill(chain, { min, max }, known, random) {
  const sentences = [];
  let count = 0;
  for (let attempt = 0; attempt < 12 && count < min; attempt += 1) {
    const tokens = sampleSentence(chain, random);
    if (!tokens || !isUsableSentence(tokens, known)) continue;
    const text = tokens.join(' ');
    if (count + tokens.length > max || sentences.includes(text)) continue;
    sentences.push(text);
    count += tokens.length;
  }
  return count >= min && count <= max ? sentences : null;
}

// Up to MAX_ANCHORS sentences that between them contain as many of the
// trouble words as possible, without overrunning `budget` words.
function chooseAnchors(troubleWords, pool, budget, random) {
  const wanted = new Set(troubleWords.map((word) => word.toLowerCase()));
  const candidates = pool
    .map((sentence) => ({ sentence, words: wordsOf(sentence), length: sentence.split(' ').length }))
    .filter((candidate) => candidate.words.some((word) => wanted.has(word)));

  const anchors = [];
  const covered = new Set();
  let used = 0;
  while (anchors.length < MAX_ANCHORS) {
    let best = null;
    for (const candidate of candidates) {
      if (anchors.includes(candidate.sentence) || used + candidate.length > budget) continue;
      const gain = new Set(candidate.words.filter((word) => wanted.has(word) && !covered.has(word))).size;
      if (!gain) continue;
      // Most new trouble words first, then shorter (leaves room to fill), random among ties.
      const key = gain * 100 - candidate.length + random();
      if (!best || key > best.key) best = { ...candidate, key };
    }
    if (!best) break;
    anchors.push(best.sentence);
    best.words.forEach((word) => { if (wanted.has(word)) covered.add(word); });
    used += best.length;
  }
  return { anchors, used };
}

// How well a candidate suits this player. Higher is better.
export function scoreCandidate(text, { focus = 'general', troubleWords = [] } = {}) {
  const tokens = wordsOf(text);
  if (!tokens.length) return -Infinity;
  const sentenceCount = Math.max(1, (text.match(/[.!?]/g) || []).length);
  const commas = (text.match(/,/g) || []).length;
  let score = troubleWordsIn(text, troubleWords).length * 3;

  if (focus === 'clarity') {
    // Consonant clusters and sibilant/th/ch sounds are what clear articulation gets tested on.
    const demanding = tokens.filter((word) => /[bcdfghjklmnpqrstvwxyz]{3,}|sh|ch|th|ss/.test(word)).length;
    score += (demanding / tokens.length) * 6;
  } else if (focus === 'volume') {
    // Long, sustained phrases take breath support to project.
    score += Math.min(tokens.length / sentenceCount, 24) / 6 + commas * 0.3;
  } else if (focus === 'pitch') {
    // Questions, exclamations and contrast invite rising and falling intonation.
    score += (text.match(/[?!]/g) || []).length * 1.2 + commas * 0.3;
    score += tokens.filter((word) => CONTRAST_WORDS.has(word)).length * 0.8;
  }

  const repeats = new Map();
  for (const word of tokens) {
    if (!COMMON_WORDS.has(word)) repeats.set(word, (repeats.get(word) || 0) + 1);
  }
  score -= [...repeats.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0) * 1.5;

  return score;
}

// Last resort if no candidate fit: a sentence that contains a trouble word and
// fits the band, else the built-in sentence whose length is closest to it.
function lastResort(focus, band, troubleWords, pool, random) {
  const target = (band.min + band.max) / 2;
  const distance = (sentence) => Math.abs(sentence.split(' ').length - target);

  const aimed = pool.filter((sentence) => {
    const length = sentence.split(' ').length;
    return length >= band.min && length <= band.max && troubleWordsIn(sentence, troubleWords).length;
  });
  if (aimed.length) return pick(aimed, random);

  const corpus = CORPUS[focus] || CORPUS.general;
  const closest = Math.min(...corpus.map(distance));
  return pick(corpus.filter((sentence) => distance(sentence) === closest), random);
}

export function generatePassage({
  level = 1,
  focus = 'general',
  troubleWords = [],
  history = [],
  random = Math.random,
  candidates = 120
} = {}) {
  const band = wordBand(level);
  const presets = PRACTICE_SCRIPTS.map((script) => script.text);
  const focusSentences = (CORPUS[focus] || []).flatMap((text) => splitSentences(text));

  // The focus corpus is repeated so the chain leans toward that kind of phrasing.
  const training = [
    ...CORPUS.general.flatMap((text) => splitSentences(text)),
    ...presets.flatMap((text) => splitSentences(text)),
    ...history.flatMap((text) => splitSentences(text)),
    ...focusSentences, ...focusSentences, ...focusSentences
  ];
  const chain = buildChain(training);

  // Anchors may come from anywhere, including sentences too repetitive to train on.
  const anchorPool = [...new Set([
    ...history, ...presets, ...Object.values(CORPUS).flat()
  ].flatMap((text) => splitSentences(text, { keepLoopy: true })))];

  // Sentences it was trained on are off limits for generated text, and so are
  // whole passages that were practiced before.
  const knownSentences = new Set(training.map(normalize));
  const knownPassages = new Set([...presets, ...history].map(normalize));

  const scored = new Map();
  for (let attempt = 0; attempt < candidates; attempt += 1) {
    // Every other attempt keeps room for at least one new sentence beside the
    // anchors, so a trouble-word sentence never comes back as a bare repeat.
    const reserve = attempt % 2 === 1 ? MIN_SENTENCE_TOKENS : 0;
    const { anchors, used } = troubleWords.length
      ? chooseAnchors(troubleWords, anchorPool, band.max - reserve, random)
      : { anchors: [], used: 0 };

    const needsFill = used < band.min || reserve > 0;
    let fill = [];
    if (needsFill) {
      fill = sampleFill(chain, { min: Math.max(reserve, band.min - used), max: band.max - used }, knownSentences, random);
      if (!fill) continue;
    }

    const sentences = shuffled([...anchors, ...fill], random);
    const text = sentences.join(' ');
    if (knownPassages.has(normalize(text)) || scored.has(text)) continue;
    scored.set(text, scoreCandidate(text, { focus, troubleWords }));
  }
  if (!scored.size) return lastResort(focus, band, troubleWords, anchorPool, random);

  const best = [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_CHOICES);
  return pick(best, random)[0];
}
