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

// Used only when live generation fails or the daily budget is exhausted —
// a small pool to fall back on so the app stays usable.
export function getFallbackScript(focus) {
  const tagged = PRACTICE_SCRIPTS.find((script) => script.focus?.includes(focus));
  return tagged || PRACTICE_SCRIPTS[0];
}
