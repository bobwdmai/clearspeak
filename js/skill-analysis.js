export const SKILL_LABELS = { clarity: 'Clarity', volume: 'Volume consistency', pitch: 'Pitch expressiveness' };
const SKILL_PRIORITY = ['clarity', 'volume', 'pitch'];

export function scoreVolumeLabel(label) {
  if (label === 'steady') return 90;
  if (label === 'somewhat variable') return 60;
  if (label === 'inconsistent') return 30;
  return null;
}

export function scorePitchLabel(label) {
  if (label === 'expressive') return 95;
  if (label === 'normal') return 75;
  if (label === 'monotone') return 35;
  return null;
}

export function levelForScore(score) {
  if (score === null || score === undefined) return null;
  if (score >= 80) return 'strong';
  if (score >= 55) return 'developing';
  return 'needs-work';
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function analyzeSkills(sessions = [], { windowSize = 10 } = {}) {
  const recent = sessions.slice(0, windowSize);

  const clarityScores = recent
    .filter((session) => session.meta?.recognitionSupported && typeof session.clarityScore === 'number')
    .map((session) => session.clarityScore);
  const volumeScores = recent
    .map((session) => scoreVolumeLabel(session.toneMetrics?.volumeConsistency?.label))
    .filter((score) => score !== null);
  const pitchScores = recent
    .map((session) => scorePitchLabel(session.toneMetrics?.pitchVariation?.label))
    .filter((score) => score !== null);

  const skills = {
    clarity: buildSkill('clarity', clarityScores),
    volume: buildSkill('volume', volumeScores),
    pitch: buildSkill('pitch', pitchScores)
  };

  const withData = SKILL_PRIORITY.filter((id) => skills[id].score !== null);
  const weakestSkill = withData.length
    ? withData.reduce((weakest, id) => (skills[id].score < skills[weakest].score ? id : weakest))
    : null;

  return {
    sessionsAnalyzed: recent.length,
    hasEnoughData: withData.length > 0,
    skills,
    weakestSkill: weakestSkill ? skills[weakestSkill] : null
  };
}

function buildSkill(id, scores) {
  const score = average(scores);
  const rounded = score === null ? null : Math.round(score);
  return {
    id,
    label: SKILL_LABELS[id],
    score: rounded,
    level: levelForScore(rounded),
    confidence: scores.length === 0 ? 'none' : scores.length < 3 ? 'low' : 'good',
    sampleSize: scores.length
  };
}

export function placementStartingLevel(diagnosis, maxLevel = 5) {
  const scores = SKILL_PRIORITY.map((id) => diagnosis.skills[id].score).filter((score) => score !== null);
  if (!scores.length) return 1;
  const composite = average(scores);
  const level = composite >= 90 ? 5 : composite >= 80 ? 4 : composite >= 65 ? 3 : composite >= 50 ? 2 : 1;
  return Math.min(level, maxLevel);
}

export function evaluateLevelAttempt(level, session) {
  const reasons = [];
  const recognitionSupported = Boolean(session.meta?.recognitionSupported);
  const threshold = level.passThreshold || {};

  if (threshold.clarity != null && recognitionSupported) {
    const clarity = session.clarityScore ?? 0;
    if (clarity < threshold.clarity) {
      reasons.push(`Clarity was ${clarity}% — aim for ${threshold.clarity}%+.`);
    }
  }

  if (threshold.volumeNotInconsistent) {
    const label = session.toneMetrics?.volumeConsistency?.label;
    if (label === 'inconsistent') {
      reasons.push('Volume was inconsistent — aim for steadier breath support.');
    }
  }

  if (threshold.pitchNotMonotone) {
    const label = session.toneMetrics?.pitchVariation?.label;
    if (label === 'monotone') {
      reasons.push('Pitch was monotone — try varying your intonation more.');
    }
  }

  return { passed: reasons.length === 0, reasons };
}
