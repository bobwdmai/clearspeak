import test from 'node:test';
import assert from 'node:assert/strict';
import { alignWords, tokenize } from '../js/scoring.js';

test('tokenize normalizes case, punctuation, and curly apostrophes', () => {
  assert.deepEqual(tokenize('Hello, WORLD! Don’t stop.'), ['hello', 'world', "don't", 'stop']);
});

test('a perfect reading receives 100 clarity', () => {
  const result = alignWords('Speak with purpose and clarity.', 'speak with purpose and clarity');
  assert.equal(result.clarityScore, 100);
  assert.ok(result.wordAlignment.every(({ op }) => op === 'match'));
});

test('aligns substitutions, deletions, and insertions', () => {
  const result = alignWords('the quick brown fox jumps', 'the slow brown jumps today');
  assert.equal(result.clarityScore, 60);
  assert.deepEqual(result.wordAlignment.map(({ op }) => op), ['match', 'sub', 'match', 'deletion', 'match']);
  assert.deepEqual(result.insertions, ['today']);
});

test('an empty transcript marks every target word as missing', () => {
  const result = alignWords('one two three', '');
  assert.equal(result.clarityScore, 0);
  assert.deepEqual(result.wordAlignment.map(({ op }) => op), ['deletion', 'deletion', 'deletion']);
});

test('extra words do not lower the explainable match-based v1 score', () => {
  const result = alignWords('clear speech matters', 'clear um speech really matters');
  assert.equal(result.clarityScore, 100);
  assert.deepEqual(result.insertions, ['um', 'really']);
});
