import { PRACTICE_SCRIPTS } from './scripts-library.js';

export const LEVELS = [
  {
    id: 1,
    scriptId: 'morning',
    title: 'Level 1 — Warm-up',
    focus: ['clarity'],
    passThreshold: { clarity: 65 }
  },
  {
    id: 2,
    scriptId: 'thought',
    title: 'Level 2 — Steady pacing',
    focus: ['pitch'],
    passThreshold: { clarity: 70, pitchNotMonotone: true }
  },
  {
    id: 3,
    scriptId: 'seashells',
    title: 'Level 3 — Crisp consonants',
    focus: ['clarity'],
    passThreshold: { clarity: 75 }
  },
  {
    id: 4,
    scriptId: 'weather',
    title: 'Level 4 — Rapid rhythm',
    focus: ['clarity'],
    passThreshold: { clarity: 80 }
  },
  {
    id: 5,
    scriptId: 'presentation',
    title: 'Level 5 — Full delivery',
    focus: ['volume', 'pitch'],
    passThreshold: { clarity: 85, volumeNotInconsistent: true, pitchNotMonotone: true }
  }
];

export const MAX_LEVEL = LEVELS.length;

export const PLACEMENT_SCRIPT_IDS = ['morning', 'seashells', 'presentation'];

export function getLevel(id) {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[0];
}

export function getLevelScript(level) {
  return PRACTICE_SCRIPTS.find((script) => script.id === level.scriptId);
}

export function getPlacementBattery() {
  return PLACEMENT_SCRIPT_IDS.map((id) => PRACTICE_SCRIPTS.find((script) => script.id === id));
}
