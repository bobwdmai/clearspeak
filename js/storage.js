const STORAGE_KEY = 'speech-trainer:data';
const APP_ID = 'speech-trainer';
const SCHEMA_VERSION = 1;
const MAX_SESSIONS = 50;

function freshData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    appId: APP_ID,
    profile: { createdAt: new Date().toISOString(), placementCompleted: false, currentLevel: 1, passedLevels: [] },
    sessions: []
  };
}

function isValid(data) {
  return data && data.appId === APP_ID && data.schemaVersion === SCHEMA_VERSION && Array.isArray(data.sessions);
}

function normalize(data) {
  return {
    ...freshData(),
    ...data,
    profile: { ...freshData().profile, ...data.profile },
    sessions: [...data.sessions]
      .filter((session) => session && typeof session.id === 'string' && typeof session.timestamp === 'string')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, MAX_SESSIONS)
  };
}

export function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return isValid(parsed) ? normalize(parsed) : freshData();
  } catch {
    return freshData();
  }
}

export function saveSession(session) {
  const data = loadData();
  data.sessions = [session, ...data.sessions.filter(({ id }) => id !== session.id)].slice(0, MAX_SESSIONS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

export function setLevelProgress(patch) {
  const data = loadData();
  data.profile = { ...data.profile, ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

export function clearHistory() {
  const data = loadData();
  data.sessions = [];
  // A level/passedLevels without any session backing it is meaningless in
  // this app, so clearing history is a full reset back to the placement
  // test rather than an orphaned "Level 4" with no history to justify it.
  data.profile = { ...data.profile, placementCompleted: false, currentLevel: 1, passedLevels: [] };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function exportBackup() {
  const data = { ...loadData(), exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `speech-trainer-backup-${new Date().toISOString().slice(0, 10)}.voice`;
  // Some browsers only honor a synthetic download click reliably when the
  // anchor is actually in the document, and revoking the blob URL before
  // the download has started can cancel it — so attach, click, detach, and
  // revoke on a delay instead of immediately.
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importBackup(file, { replace = false } = {}) {
  let incoming;
  try {
    incoming = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON. Choose a ClearSpeak .voice backup.');
  }
  if (!isValid(incoming)) throw new Error('This is not a compatible ClearSpeak v1 backup.');

  const current = loadData();
  const sessions = replace
    ? incoming.sessions
    : [...incoming.sessions, ...current.sessions];
  const unique = [...new Map(sessions.map((session) => [session.id, session])).values()];
  const merged = normalize({
    ...current,
    profile: replace ? incoming.profile : current.profile,
    sessions: unique
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export const storageConfig = { APP_ID, SCHEMA_VERSION, MAX_SESSIONS, STORAGE_KEY };
