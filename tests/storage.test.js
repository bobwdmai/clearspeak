import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();

const { clearHistory, importBackup, loadData, saveSession, setLevelProgress, storageConfig } = await import('../js/storage.js');

function makeSession(id, timestamp = new Date().toISOString()) {
  return { id, timestamp, targetScript: 'test', transcript: 'test' };
}

test.beforeEach(() => {
  localStorage = new MemoryStorage();
});

test('a fresh profile starts at level 1 with placement pending', () => {
  const data = loadData();
  assert.equal(data.profile.placementCompleted, false);
  assert.equal(data.profile.currentLevel, 1);
  assert.deepEqual(data.profile.passedLevels, []);
});

test('saves newest sessions first and caps history', () => {
  for (let index = 0; index < 55; index += 1) {
    saveSession(makeSession(`id-${index}`, new Date(2025, 0, index + 1).toISOString()));
  }
  const data = loadData();
  assert.equal(data.sessions.length, storageConfig.MAX_SESSIONS);
  assert.equal(data.sessions[0].id, 'id-54');
});

test('import merges by UUID without duplicates', async () => {
  saveSession(makeSession('local'));
  const backup = {
    schemaVersion: 1,
    appId: 'speech-trainer',
    profile: { createdAt: new Date().toISOString(), placementCompleted: true, currentLevel: 2, passedLevels: [1] },
    sessions: [makeSession('local'), makeSession('incoming')]
  };
  const file = { text: async () => JSON.stringify(backup) };
  await importBackup(file);
  await importBackup(file);
  assert.deepEqual(new Set(loadData().sessions.map(({ id }) => id)), new Set(['local', 'incoming']));
});

test('rejects an incompatible backup without changing history', async () => {
  saveSession(makeSession('safe'));
  const file = { text: async () => JSON.stringify({ appId: 'something-else', schemaVersion: 1, sessions: [] }) };
  await assert.rejects(() => importBackup(file), /not a compatible/);
  assert.equal(loadData().sessions[0].id, 'safe');
});

test('clear removes sessions while retaining the profile envelope', () => {
  saveSession(makeSession('one'));
  clearHistory();
  const data = loadData();
  assert.equal(data.sessions.length, 0);
  assert.equal(data.appId, 'speech-trainer');
});

test('level progress is stored inside the profile', () => {
  setLevelProgress({ placementCompleted: true, currentLevel: 3, passedLevels: [1, 2] });
  const data = loadData();
  assert.equal(data.profile.placementCompleted, true);
  assert.equal(data.profile.currentLevel, 3);
  assert.deepEqual(data.profile.passedLevels, [1, 2]);
});

test('level progress survives export/import round-trip', async () => {
  setLevelProgress({ placementCompleted: true, currentLevel: 4, passedLevels: [1, 2, 3] });
  saveSession({ ...makeSession('level-attempt'), meta: { levelId: 3 } });
  const backup = { ...loadData(), exportedAt: new Date().toISOString() };
  localStorage = new MemoryStorage();
  const file = { text: async () => JSON.stringify(backup) };
  await importBackup(file, { replace: true });
  const data = loadData();
  assert.equal(data.profile.currentLevel, 4);
  assert.deepEqual(data.profile.passedLevels, [1, 2, 3]);
  assert.equal(data.sessions[0].meta.levelId, 3);
});
