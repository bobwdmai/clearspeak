import { PRACTICE_SCRIPTS } from './scripts-library.js';

// Level content is generated per attempt (see level-generator.js) instead of
// coming from a fixed table, so there's no level ceiling — only how the pass
// bar scales with the level number.
export function getLevelRequirements(level) {
  const clarity = Math.min(65 + (level - 1) * 3, 92);
  return {
    id: level,
    title: `Level ${level}`,
    passThreshold: {
      clarity,
      volumeNotInconsistent: level >= 2,
      pitchNotMonotone: level >= 2
    }
  };
}

export const PLACEMENT_SCRIPT_IDS = ['morning', 'seashells', 'presentation'];

export function getPlacementBattery() {
  return PLACEMENT_SCRIPT_IDS.map((id) => PRACTICE_SCRIPTS.find((script) => script.id === id));
}

// The progress an attempt earns, or null if it earns none. Only a passed
// attempt on an AI-written passage moves the level: a passage generated on the
// device (offline, or once the day's AI budget is spent) is practice only.
export function progressAfterAttempt(profile, level, { passed, passageSource }) {
  if (!passed || passageSource !== 'ai') return null;
  const passedLevels = Array.from(new Set([...(profile?.passedLevels || []), level.id]));
  return { currentLevel: level.id + 1, passedLevels };
}
