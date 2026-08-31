import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeSkills,
  evaluateLevelAttempt,
  frequentMissWords,
  levelForScore,
  placementStartingLevel,
  scorePitchLabel,
  scoreVolumeLabel
} from '../js/skill-analysis.js';

function session({
  clarity = 80,
  recognitionSupported = true,
  volume = 'steady',
  pitch = 'normal',
  wordAlignment = []
} = {}) {
  return {
    clarityScore: clarity,
    wordAlignment,
    toneMetrics: {
      volumeConsistency: { label: volume },
      pitchVariation: { label: pitch }
    },
    meta: { recognitionSupported }
  };
}

test('maps volume and pitch labels to scores', () => {
  assert.equal(scoreVolumeLabel('steady'), 90);
  assert.equal(scoreVolumeLabel('somewhat variable'), 60);
  assert.equal(scoreVolumeLabel('inconsistent'), 30);
  assert.equal(scoreVolumeLabel('not enough data'), null);
  assert.equal(scorePitchLabel('expressive'), 95);
  assert.equal(scorePitchLabel('normal'), 75);
  assert.equal(scorePitchLabel('monotone'), 35);
  assert.equal(scorePitchLabel('not enough data'), null);
});

test('buckets scores into levels at the documented boundaries', () => {
  assert.equal(levelForScore(80), 'strong');
  assert.equal(levelForScore(79), 'developing');
  assert.equal(levelForScore(55), 'developing');
  assert.equal(levelForScore(54), 'needs-work');
  assert.equal(levelForScore(null), null);
});

test('reports no data with an empty session list', () => {
  const diagnosis = analyzeSkills([]);
  assert.equal(diagnosis.hasEnoughData, false);
  assert.equal(diagnosis.weakestSkill, null);
  assert.equal(diagnosis.skills.clarity.score, null);
});

test('only considers the newest sessions up to the window size', () => {
  // analyzeSkills trusts the caller's ordering (newest-first, as loadData() returns) —
  // the first 10 entries here stand in for the newest sessions, the trailing 2 for older ones.
  const sessions = Array.from({ length: 12 }, (_, index) => session({ clarity: index >= 10 ? 0 : 80 }));
  const diagnosis = analyzeSkills(sessions, { windowSize: 10 });
  assert.equal(diagnosis.skills.clarity.sampleSize, 10);
  assert.equal(diagnosis.skills.clarity.score, 80);
});

test('breaks ties in clarity, volume, pitch order', () => {
  const diagnosis = analyzeSkills([session({ clarity: 60, volume: 'somewhat variable', pitch: 'normal' })]);
  assert.equal(diagnosis.weakestSkill.id, 'clarity');
});

test('excludes clarity when speech recognition is unsupported, still diagnosing tone', () => {
  const diagnosis = analyzeSkills([session({ clarity: 0, recognitionSupported: false, volume: 'steady', pitch: 'monotone' })]);
  assert.equal(diagnosis.skills.clarity.score, null);
  assert.equal(diagnosis.skills.clarity.sampleSize, 0);
  assert.equal(diagnosis.weakestSkill.id, 'pitch');
});

test('places strong performers higher and clamps to the max level', () => {
  const strong = analyzeSkills([session({ clarity: 95, volume: 'steady', pitch: 'expressive' })]);
  assert.equal(placementStartingLevel(strong, 5), 5);
  const weak = analyzeSkills([session({ clarity: 20, volume: 'inconsistent', pitch: 'monotone' })]);
  assert.equal(placementStartingLevel(weak, 5), 1);
  const noData = analyzeSkills([]);
  assert.equal(placementStartingLevel(noData, 5), 1);
});

test('evaluateLevelAttempt passes only when every threshold is met', () => {
  const level = { id: 5, passThreshold: { clarity: 85, volumeNotInconsistent: true, pitchNotMonotone: true } };
  const good = evaluateLevelAttempt(level, session({ clarity: 90, volume: 'steady', pitch: 'normal' }));
  assert.equal(good.passed, true);
  assert.deepEqual(good.reasons, []);

  const short = evaluateLevelAttempt(level, session({ clarity: 60, volume: 'inconsistent', pitch: 'monotone' }));
  assert.equal(short.passed, false);
  assert.equal(short.reasons.length, 3);
});

test('evaluateLevelAttempt skips the clarity bar without speech recognition', () => {
  const level = { id: 1, passThreshold: { clarity: 65 } };
  const result = evaluateLevelAttempt(level, session({ clarity: 0, recognitionSupported: false }));
  assert.equal(result.passed, true);
});

test('frequentMissWords surfaces words missed at least twice, most frequent first', () => {
  const sessions = [
    session({ wordAlignment: [{ op: 'sub', targetWord: 'thoughtful', heardWord: 'thoughtless' }, { op: 'match', targetWord: 'speaker' }] }),
    session({ wordAlignment: [{ op: 'deletion', targetWord: 'thoughtful' }, { op: 'sub', targetWord: 'purpose', heardWord: 'porpoise' }] }),
    session({ wordAlignment: [{ op: 'deletion', targetWord: 'purpose' }] }),
    session({ wordAlignment: [{ op: 'match', targetWord: 'clarity' }] })
  ];
  assert.deepEqual(frequentMissWords(sessions), ['thoughtful', 'purpose']);
});

test('frequentMissWords ignores sessions without speech recognition and respects minCount/maxWords', () => {
  const sessions = [
    session({ recognitionSupported: false, wordAlignment: [{ op: 'sub', targetWord: 'ignored', heardWord: 'x' }] }),
    session({ wordAlignment: [{ op: 'sub', targetWord: 'once', heardWord: 'x' }] })
  ];
  assert.deepEqual(frequentMissWords(sessions), []);
  assert.deepEqual(frequentMissWords(sessions, { minCount: 1 }), ['once']);
});
