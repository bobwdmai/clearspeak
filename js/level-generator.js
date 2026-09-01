// A custom domain under bob-mai.com rather than *.workers.dev: some ISP
// DNS resolvers intercept workers.dev lookups with a redirect/landing page
// (observed with Comcast/Xfinity), breaking the TLS handshake and making
// every generation request fail as a network error.
const WORKER_URL = 'https://clearspeak-levels.bob-mai.com';

export class LevelGenerationError extends Error {
  constructor(reason) {
    super(`Level generation unavailable: ${reason}`);
    this.reason = reason;
  }
}

export async function generateLevelPassage(level, focus, troubleWords = []) {
  let response;
  try {
    response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level, focus, troubleWords })
    });
  } catch {
    throw new LevelGenerationError('network');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new LevelGenerationError(body.error || `http_${response.status}`);
  }

  const data = await response.json();
  if (!data.text) throw new LevelGenerationError('empty_response');
  return data;
}
