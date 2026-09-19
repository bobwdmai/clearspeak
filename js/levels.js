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
//
// `recentTexts` is the newest-first list of passages practiced lately. The
// pick avoids them so the fallback doesn't serve the same passage over and
// over: prefer an unused script tagged for the focus, then any unused one,
// and only when everything was used recently, the least recently used.
export function getFallbackScript(focus, recentTexts = []) {
  const tagged = PRACTICE_SCRIPTS.filter((script) => script.focus?.includes(focus));
  const unused = (script) => !recentTexts.includes(script.text);

  const fresh = tagged.find(unused) || PRACTICE_SCRIPTS.find(unused);
  if (fresh) return fresh;

  return PRACTICE_SCRIPTS.reduce((oldest, script) =>
    recentTexts.indexOf(script.text) > recentTexts.indexOf(oldest.text) ? script : oldest
  );
}
