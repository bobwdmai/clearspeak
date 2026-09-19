import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevelRequirements, getPlacementBattery, progressAfterAttempt } from '../js/levels.js';

test('level requirements tighten with the level and cap out', () => {
  assert.equal(getLevelRequirements(1).passThreshold.clarity, 65);
  assert.equal(getLevelRequirements(1).passThreshold.volumeNotInconsistent, false);
  assert.equal(getLevelRequirements(2).passThreshold.volumeNotInconsistent, true);
  assert.equal(getLevelRequirements(50).passThreshold.clarity, 92);
});

test('placement battery is the three fixed passages', () => {
  assert.deepEqual(getPlacementBattery().map((script) => script.id), ['morning', 'seashells', 'presentation']);
});

const profile = { currentLevel: 3, passedLevels: [1, 2] };
const level3 = getLevelRequirements(3);

test('passing on an AI-written passage advances the level', () => {
  assert.deepEqual(
    progressAfterAttempt(profile, level3, { passed: true, passageSource: 'ai' }),
    { currentLevel: 4, passedLevels: [1, 2, 3] }
  );
});

test('passing on a device-generated practice passage does NOT level up', () => {
  assert.equal(progressAfterAttempt(profile, level3, { passed: true, passageSource: 'algorithm' }), null);
});

test('an unknown or missing passage source never levels up', () => {
  assert.equal(progressAfterAttempt(profile, level3, { passed: true, passageSource: undefined }), null);
  assert.equal(progressAfterAttempt(profile, level3, { passed: true, passageSource: 'preset' }), null);
});

test('failing never levels up, even on an AI-written passage', () => {
  assert.equal(progressAfterAttempt(profile, level3, { passed: false, passageSource: 'ai' }), null);
});

test('re-passing a level does not duplicate it in the passed list', () => {
  const again = progressAfterAttempt({ currentLevel: 3, passedLevels: [1, 2, 3] }, level3, { passed: true, passageSource: 'ai' });
  assert.deepEqual(again.passedLevels, [1, 2, 3]);
});
