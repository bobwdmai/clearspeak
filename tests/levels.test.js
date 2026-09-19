import test from 'node:test';
import assert from 'node:assert/strict';
import { getFallbackScript, getLevelRequirements } from '../js/levels.js';
import { PRACTICE_SCRIPTS } from '../js/scripts-library.js';

const byId = (id) => PRACTICE_SCRIPTS.find((script) => script.id === id);

test('fallback prefers a passage tagged for the focus when nothing is recent', () => {
  assert.ok(getFallbackScript('pitch').focus.includes('pitch'));
});

test('fallback moves on from a passage that was just practiced instead of repeating it', () => {
  const first = getFallbackScript('clarity');
  const second = getFallbackScript('clarity', [first.text]);
  assert.notEqual(second.id, first.id);
  assert.ok(second.focus.includes('clarity'));
});

test('fallback walks the whole tagged set before reusing anything', () => {
  const seen = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    seen.unshift(getFallbackScript('clarity', seen.map((script) => script.text)));
  }
  assert.equal(new Set(seen.map((script) => script.id)).size, 3);
});

test('fallback reaches outside the focus tag once every tagged passage is recent', () => {
  const recent = ['morning', 'seashells', 'weather'].map((id) => byId(id).text);
  const pick = getFallbackScript('clarity', recent);
  assert.ok(!recent.includes(pick.text));
});

test('when every passage is recent, fallback reuses the least recently used', () => {
  const newestFirst = ['presentation', 'thought', 'weather', 'seashells', 'morning'].map((id) => byId(id).text);
  assert.equal(getFallbackScript('clarity', newestFirst).id, 'morning');
});

test('level requirements tighten with the level and cap out', () => {
  assert.equal(getLevelRequirements(1).passThreshold.clarity, 65);
  assert.equal(getLevelRequirements(1).passThreshold.volumeNotInconsistent, false);
  assert.equal(getLevelRequirements(2).passThreshold.volumeNotInconsistent, true);
  assert.equal(getLevelRequirements(50).passThreshold.clarity, 92);
});
