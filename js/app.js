import { AudioCapture } from './audio-capture.js';
import { SpeechRecognitionController } from './speech-recognition.js';
import { VoiceMetricsTracker } from './volume-pitch.js';
import { alignWords } from './scoring.js';
import { analyzeSkills, evaluateLevelAttempt, frequentMissWords, placementStartingLevel } from './skill-analysis.js';
import { getFallbackScript, getLevelRequirements, getPlacementBattery } from './levels.js';
import { generateLevelPassage, LevelGenerationError } from './level-generator.js';
import { clearHistory, exportBackup, importBackup, loadData, saveSession, setLevelProgress } from './storage.js';

const MAX_DURATION_MS = 120_000;
const view = document.querySelector('#app-view');
const historyCount = document.querySelector('#history-count');
let activeSession = null;
let currentResult = null;
let setupMessage = '';
let placementMessage = '';
let placement = null; // { batchId, index, retake, battery } while a placement run is in progress
let toastTimer = null;

const SKILL_COPY = {
  clarity: { label: 'Clarity', icon: 'Aa', description: 'How accurately your words matched the passage.' },
  volume: { label: 'Volume', icon: '≋', description: 'How consistently your voice carried throughout.' },
  pitch: { label: 'Pitch', icon: '⌁', description: 'How much vocal expression and variation you used.' }
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(new Date(timestamp));
}

function createId() {
  return crypto.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clearActiveNav() {
  document.querySelectorAll('[data-route]').forEach((button) => button.classList.remove('is-active'));
}

function setRoute(route) {
  placement = null;
  document.querySelectorAll('[data-route]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.route === route);
  });
  if (route === 'history') renderHistory();
  else renderPracticeRoute();
  view.focus({ preventScroll: true });
}

function renderPracticeRoute() {
  const data = loadData();
  data.profile?.placementCompleted ? renderLevelHome(data) : renderPlacementIntro();
}

function refreshHistoryCount() {
  historyCount.textContent = loadData().sessions.length;
}

function showToast(message) {
  document.querySelector('.st-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'st-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.querySelector('.st-app').append(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.remove(), 3000);
}

function capabilityBanner() {
  if (!AudioCapture.isSupported()) {
    return `<div class="st-banner is-error" role="alert"><span aria-hidden="true">!</span><div><strong>Microphone access is unavailable</strong>This browser cannot provide the audio tools ClearSpeak needs. Try a current version of Chrome, Edge, Firefox, or Safari over HTTPS or localhost.</div></div>`;
  }
  const recognitionSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!recognitionSupported) {
    return `<div class="st-banner" role="status"><span aria-hidden="true">△</span><div><strong>Clarity scoring is unavailable in this browser</strong>You can still record a session for volume and pitch feedback. For word-by-word transcription, use Chrome or Edge.</div></div>`;
  }
  return '';
}

// --- Level home -----------------------------------------------------------

function renderLevelHome(data = loadData()) {
  const currentLevelId = data.profile?.currentLevel || 1;
  const passedCount = (data.profile?.passedLevels || []).length;
  const diagnosis = analyzeSkills(data.sessions);
  const focus = diagnosis.weakestSkill?.id || 'general';
  const troubleWords = frequentMissWords(data.sessions);
  const message = setupMessage
    ? `<div class="st-banner is-error" role="alert"><span aria-hidden="true">!</span><div><strong>Could not start the session</strong>${escapeHtml(setupMessage)}</div></div>`
    : capabilityBanner();

  view.innerHTML = `
    <section aria-labelledby="setup-title">
      <p class="st-kicker">Your private speaking studio</p>
      <h1 class="st-title" id="setup-title">Say it with <em>clarity.</em></h1>
      <p class="st-lead">Clear one level at a time. Each passage is written fresh for wherever you need the most work, and has its own bar to hit before the next one unlocks.</p>
      ${message}
      <div class="st-card st-level-card">
        <p class="st-card-label">Level ${currentLevelId}</p>
        <p class="st-level-focus">Focus: ${SKILL_COPY[focus]?.label || 'General warm-up'}${passedCount ? ` · ${passedCount} level${passedCount === 1 ? '' : 's'} cleared` : ''}</p>
        ${troubleWords.length ? `<p class="st-microcopy">Targeting recent trouble spots: ${troubleWords.map((word) => escapeHtml(word)).join(', ')}.</p>` : ''}
        <p class="st-microcopy">Your passage is generated when you start, so you won't see it until then.</p>
        <div class="st-editor-actions">
          <span class="st-microcopy">Clear this level to unlock Level ${currentLevelId + 1}.</span>
          <button class="st-primary" id="start-level" type="button" ${AudioCapture.isSupported() ? '' : 'disabled'}>
            Start Level ${currentLevelId} <span class="st-primary-arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>`;

  document.querySelector('#start-level')?.addEventListener('click', () => beginLevelAttempt(currentLevelId, focus, troubleWords));
}

async function beginLevelAttempt(levelId, focus, troubleWords = []) {
  const startButton = document.querySelector('#start-level');
  if (startButton) {
    startButton.disabled = true;
    startButton.textContent = 'Writing your passage…';
  }

  let text;
  try {
    const generated = await generateLevelPassage(levelId, focus, troubleWords);
    text = generated.text;
  } catch (error) {
    text = getFallbackScript(focus).text;
    showToast(
      error instanceof LevelGenerationError && error.reason === 'budget_exceeded'
        ? "Today's AI passage budget is used up — using a preset passage instead."
        : "Couldn't reach the passage generator — using a preset passage instead."
    );
  }
  startSession(text, { levelAttempt: true, levelId, focus });
}

// --- Placement test ---------------------------------------------------------

function renderPlacementIntro({ retake = false } = {}) {
  clearActiveNav();
  const battery = getPlacementBattery();
  const error = placementMessage
    ? `<div class="st-banner is-error" role="alert"><span aria-hidden="true">!</span><div><strong>Could not start the placement test</strong>${escapeHtml(placementMessage)}</div></div>`
    : capabilityBanner();
  view.innerHTML = `
    <section class="st-assessment" aria-labelledby="placement-title">
      <div class="st-assessment-hero">
        <p class="st-kicker">${retake ? 'Retake the placement test' : 'Before you start'}</p>
        <h1 class="st-title" id="placement-title">Let's find your <em>level.</em></h1>
        <p class="st-lead">Read three short passages so ClearSpeak can place you at the right starting level. It takes about two minutes.</p>
      </div>
      ${error}
      <div class="st-assessment-layout">
        <div class="st-card st-assessment-card">
          <div class="st-assessment-time"><span aria-hidden="true">◷</span><div><strong>About 2 minutes</strong><small>Three short passages · no pressure</small></div></div>
          <div class="st-assessment-battery">
            ${battery.map((script, index) => `
              <div class="st-battery-item"><span>${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(script.title)}</strong></div></div>
            `).join('')}
          </div>
          <div class="st-assessment-actions">
            <button class="st-primary" id="placement-start" type="button" ${AudioCapture.isSupported() ? '' : 'disabled'}>Begin placement test <span aria-hidden="true">→</span></button>
            <button class="st-text-button" id="placement-skip" type="button">${retake ? 'Cancel' : 'Skip and start at Level 1'}</button>
          </div>
        </div>
        <aside class="st-card st-assessment-privacy">
          <span class="st-focus-symbol" aria-hidden="true">◇</span>
          <h2>A useful signal, privately.</h2>
          <p>The placement test uses the same on-device session tools as every level. ClearSpeak stores scores and text, never raw audio.</p>
          <ul><li>Word clarity</li><li>Volume consistency</li><li>Pitch variation</li></ul>
        </aside>
      </div>
    </section>`;

  document.querySelector('#placement-start')?.addEventListener('click', () => beginPlacement(retake));
  document.querySelector('#placement-skip').addEventListener('click', () => {
    placementMessage = '';
    if (!retake) setLevelProgress({ placementCompleted: true, currentLevel: 1, passedLevels: [] });
    setRoute('practice');
  });
}

function beginPlacement(retake = false) {
  placementMessage = '';
  const battery = getPlacementBattery();
  placement = { batchId: createId(), index: 0, retake, battery };
  startSession(battery[0].text, {
    placement: true,
    placementIndex: 0,
    placementTotal: battery.length,
    placementBatchId: placement.batchId
  });
}

function renderPlacementInterstitial(completedSession) {
  clearActiveNav();
  const nextScript = placement.battery[placement.index];
  const completed = placement.index;
  const clarity = completedSession.clarityScore === null ? 'Tone captured' : `${completedSession.clarityScore}% clarity`;
  view.innerHTML = `
    <section class="st-assessment st-interstitial" aria-labelledby="interstitial-title">
      <div class="st-progress-dots" aria-label="${completed} of ${placement.battery.length} passages complete">
        ${placement.battery.map((_, index) => `<span class="${index < completed ? 'is-complete' : index === completed ? 'is-current' : ''}"></span>`).join('')}
      </div>
      <div class="st-card st-interstitial-card">
        <span class="st-checkmark" aria-hidden="true">✓</span>
        <p class="st-kicker">Passage ${completed} complete · ${clarity}</p>
        <h1 class="st-results-title" id="interstitial-title">Nice. One signal captured.</h1>
        <div class="st-next-preview"><span>Up next</span><p>${escapeHtml(nextScript.text)}</p></div>
        <div class="st-assessment-actions is-centered">
          <button class="st-primary" id="placement-next" type="button">Start passage ${completed + 1} <span aria-hidden="true">→</span></button>
          <button class="st-text-button" id="placement-leave" type="button">Finish later</button>
        </div>
      </div>
    </section>`;
  document.querySelector('#placement-next').addEventListener('click', () => startSession(nextScript.text, {
    placement: true,
    placementIndex: placement.index,
    placementTotal: placement.battery.length,
    placementBatchId: placement.batchId
  }));
  document.querySelector('#placement-leave').addEventListener('click', () => finishPlacement(placement.batchId));
}

function finishPlacement(batchId) {
  const data = loadData();
  const batchSessions = data.sessions.filter((session) => session.meta?.placementBatchId === batchId);
  const diagnosis = analyzeSkills(batchSessions);
  const startingLevel = placementStartingLevel(diagnosis);
  setLevelProgress({ placementCompleted: true, currentLevel: startingLevel, passedLevels: [] });
  placement = null;
  renderPlacementResults(diagnosis, startingLevel);
}

function diagnosticMetric(result) {
  const copy = SKILL_COPY[result.id];
  const unavailable = result.score === null;
  const level = unavailable ? 'unavailable' : result.level;
  return `
    <article class="st-card st-metric st-diagnostic-metric is-${level}">
      <div class="st-diagnostic-top"><span class="st-metric-icon" aria-hidden="true">${copy.icon}</span><span class="st-level-pill is-${level}">${unavailable ? 'unavailable' : result.level.replace('-', ' ')}</span></div>
      <p class="st-metric-label">${copy.label}</p>
      <p class="st-diagnostic-score">${unavailable ? '—' : result.score}<small>${unavailable ? '' : '/100'}</small></p>
      <p class="st-metric-note">${unavailable ? 'Not measured in this browser' : `${result.sampleSize} usable ${result.sampleSize === 1 ? 'sample' : 'samples'}`}</p>
    </article>`;
}

function renderPlacementResults(diagnosis, startingLevel) {
  clearActiveNav();
  const weakest = diagnosis.weakestSkill;
  const skillCards = ['clarity', 'volume', 'pitch'].map((id) => diagnosticMetric(diagnosis.skills[id])).join('');
  view.innerHTML = `
    <section class="st-results st-assessment-results" aria-labelledby="placement-results-title">
      <div class="st-results-head">
        <div><p class="st-kicker">Placement complete</p><h1 class="st-results-title" id="placement-results-title">You're starting at Level ${startingLevel}.</h1></div>
      </div>
      <div class="st-diagnostic-grid">${skillCards}</div>
      ${weakest ? `
      <div class="st-card st-recommendation-card">
        <div class="st-recommendation-mark" aria-hidden="true">↗</div>
        <div><p class="st-focus-eyebrow">Where to focus first</p><h2>${SKILL_COPY[weakest.id].label}</h2><p>${SKILL_COPY[weakest.id].description}</p></div>
      </div>` : ''}
      <div class="st-assessment-actions is-centered">
        <button class="st-primary" id="placement-continue" type="button">Go to Level ${startingLevel} <span aria-hidden="true">→</span></button>
        <button class="st-text-button" id="placement-history" type="button">Review these passages in History</button>
      </div>
    </section>`;
  document.querySelector('#placement-continue').addEventListener('click', () => setRoute('practice'));
  document.querySelector('#placement-history').addEventListener('click', () => setRoute('history'));
}

// --- Recording (shared by placement passages and level attempts) ----------

async function startSession(targetScript, options = {}) {
  const startButton = document.querySelector('#start-level, #placement-start, #placement-next');
  if (startButton) {
    startButton.disabled = true;
    startButton.textContent = 'Opening microphone…';
  }

  const audio = new AudioCapture();
  try {
    const analyser = await audio.start();
    const recognition = new SpeechRecognitionController({
      onTranscript: updateLiveTranscript,
      onError: (error) => showToast(`Transcription notice: ${error}`)
    });
    const metrics = new VoiceMetricsTracker(analyser, audio.context.sampleRate);
    activeSession = {
      targetScript,
      audio,
      recognition,
      metrics,
      recognitionSupported: recognition.supported,
      startedAt: performance.now(),
      latestTranscript: '',
      frameId: null,
      timeoutId: null,
      stopping: false,
      options
    };
    renderRecording();
    metrics.start();

    // SpeechRecognition cannot consume our MediaStream; the browser independently
    // taps the same microphone after the single permission grant.
    recognition.start();
    activeSession.timeoutId = window.setTimeout(() => stopSession(), MAX_DURATION_MS);
    updateRecordingFrame();
  } catch (error) {
    await audio.stop();
    activeSession = null;
    const message = error.name === 'NotAllowedError'
      ? 'Microphone permission was denied. Allow microphone access in your browser settings and try again.'
      : error.message;
    if (options.placement) {
      placementMessage = message;
      renderPlacementIntro({ retake: placement?.retake });
    } else {
      setupMessage = message;
      renderLevelHome();
    }
  }
}

function renderRecording() {
  clearActiveNav();
  const kicker = activeSession.options.placement
    ? `Placement · Passage ${activeSession.options.placementIndex + 1} of ${activeSession.options.placementTotal}`
    : `Level ${activeSession.options.levelId} · ${SKILL_COPY[activeSession.options.focus]?.label || 'Warm-up'}`;
  view.innerHTML = `
    <section class="st-recording" aria-labelledby="recording-title">
      <div class="st-session-top">
        <span class="st-live-pill"><span class="st-live-dot"></span> Recording</span>
        <span class="st-timer" id="session-timer">00:00 / 02:00</span>
      </div>
      <div class="st-card st-record-card">
        <p class="st-kicker">${kicker}</p>
        <h1 class="st-target" id="recording-title">${escapeHtml(activeSession.targetScript)}</h1>
        <div class="st-transcript-wrap">
          <p class="st-transcript-label">${activeSession.recognitionSupported ? 'Listening' : 'Voice analysis'}</p>
          <p class="st-live-transcript is-placeholder" id="live-transcript">${activeSession.recognitionSupported ? 'Your words will appear here…' : 'Word transcription is not supported here. Keep speaking…'}</p>
        </div>
        <div class="st-meter-shell" role="meter" aria-label="Microphone volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="st-meter-fill" id="volume-meter"></div>
        </div>
      </div>
      <div class="st-record-actions">
        <button class="st-primary st-stop" id="stop-session" type="button"><span aria-hidden="true">■</span> Finish</button>
      </div>
    </section>`;
  document.querySelector('#stop-session').addEventListener('click', () => stopSession());
}

function updateLiveTranscript({ final, interim }) {
  if (!activeSession) return;
  const combined = [final, interim].filter(Boolean).join(' ').trim();
  activeSession.latestTranscript = combined;
  const transcript = document.querySelector('#live-transcript');
  if (transcript && combined) {
    transcript.textContent = combined;
    transcript.classList.remove('is-placeholder');
  }
}

function updateRecordingFrame() {
  if (!activeSession || activeSession.stopping) return;
  const elapsed = performance.now() - activeSession.startedAt;
  const timer = document.querySelector('#session-timer');
  const meter = document.querySelector('#volume-meter');
  if (timer) timer.textContent = `${formatTime(elapsed)} / 02:00`;
  if (meter) {
    const level = Math.min(100, Math.max(1, activeSession.audio.currentRms() * 520));
    meter.style.width = `${level}%`;
    meter.parentElement.setAttribute('aria-valuenow', String(Math.round(level)));
  }
  activeSession.frameId = requestAnimationFrame(updateRecordingFrame);
}

async function stopSession() {
  if (!activeSession || activeSession.stopping) return;
  activeSession.stopping = true;
  const session = activeSession;
  window.clearTimeout(session.timeoutId);
  cancelAnimationFrame(session.frameId);
  const stopButton = document.querySelector('#stop-session');
  if (stopButton) {
    stopButton.disabled = true;
    stopButton.textContent = 'Analyzing…';
  }
  session.recognition.stop();
  const duration = performance.now() - session.startedAt;
  const toneMetrics = session.metrics.finish(duration);
  await session.audio.stop();
  await new Promise((resolve) => window.setTimeout(resolve, 220));

  const transcript = session.latestTranscript || session.recognition.transcript;
  const score = session.recognitionSupported
    ? alignWords(session.targetScript, transcript)
    : { clarityScore: null, wordAlignment: [], insertions: [] };
  currentResult = {
    id: createId(),
    timestamp: new Date().toISOString(),
    targetScript: session.targetScript,
    transcript,
    clarityScore: score.clarityScore,
    wordAlignment: score.wordAlignment,
    insertions: score.insertions,
    toneMetrics,
    meta: {
      recognitionSupported: session.recognitionSupported,
      userAgent: navigator.userAgent,
      ...(session.options.placement ? { placementBatchId: session.options.placementBatchId } : {}),
      ...(session.options.levelAttempt ? { levelId: session.options.levelId, focus: session.options.focus } : {})
    }
  };
  saveSession(currentResult);
  activeSession = null;
  refreshHistoryCount();

  if (session.options.placement) {
    placement.index = session.options.placementIndex + 1;
    if (placement.index < session.options.placementTotal) {
      renderPlacementInterstitial(currentResult);
    } else {
      finishPlacement(session.options.placementBatchId);
    }
  } else {
    const level = getLevelRequirements(session.options.levelId);
    const { passed, reasons } = evaluateLevelAttempt(level, currentResult);
    if (passed) {
      const data = loadData();
      const passedLevels = Array.from(new Set([...(data.profile?.passedLevels || []), level.id]));
      setLevelProgress({ currentLevel: level.id + 1, passedLevels });
    }
    renderLevelResult(currentResult, level, passed, reasons);
  }
}

// --- Results ----------------------------------------------------------------

function renderWordDiff(session) {
  if (!session.meta?.recognitionSupported || session.clarityScore === null) {
    return '<p class="st-live-transcript">Word-by-word feedback was unavailable in this browser.</p>';
  }
  const words = (session.wordAlignment || []).map(({ op, targetWord, heardWord }) => {
    const title = op === 'sub' ? `Heard “${escapeHtml(heardWord)}”` : op === 'deletion' ? 'Not heard' : 'Matched';
    return `<span class="st-word st-word-${op}" title="${title}">${escapeHtml(targetWord)}</span>`;
  }).join(' ');
  const extras = session.insertions?.length
    ? `<p class="st-extra-words">Extra words heard: ${session.insertions.map((word) => `<span class="st-extra-chip">${escapeHtml(word)}</span>`).join('')}</p>`
    : '';
  return `${words}${extras}`;
}

function metricNote(session, metric) {
  if (metric === 'volume') {
    const cv = session.toneMetrics?.volumeConsistency?.coefficientOfVariation;
    return cv ? `Variation index ${cv}` : 'Based on voiced moments';
  }
  const spread = session.toneMetrics?.pitchVariation?.semitoneStdDev;
  return spread ? `${spread} semitone spread` : 'Based on detected pitch';
}

function renderLevelResult(session, level, passed, reasons) {
  clearActiveNav();
  const clarity = session.clarityScore === null ? '—' : session.clarityScore;
  const volume = session.toneMetrics?.volumeConsistency?.label || 'not enough data';
  const pitch = session.toneMetrics?.pitchVariation?.label || 'not enough data';
  const heading = passed ? `Level ${level.id} passed` : `Not quite — Level ${level.id} needs another pass`;
  const continueLabel = passed ? 'Next level' : 'Try again';

  view.innerHTML = `
    <section class="st-results" aria-labelledby="results-title">
      <div class="st-level-banner ${passed ? 'is-pass' : 'is-fail'}">
        <span aria-hidden="true">${passed ? '✓' : '↺'}</span>
        <div>
          <h2>${heading}</h2>
          ${reasons.length ? `<ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : passed ? '<p>Nice work — keep that consistency going.</p>' : ''}
        </div>
      </div>
      <div class="st-results-head">
        <div><p class="st-kicker">${escapeHtml(level.title)}</p><h1 class="st-results-title" id="results-title">Your delivery, decoded.</h1></div>
        <div class="st-results-actions"><button class="st-secondary" id="view-history" type="button">View history</button><button class="st-primary" id="level-continue" type="button">${continueLabel}</button></div>
      </div>
      <div class="st-card st-score-card">
        <div class="st-score-main"><div><div class="st-score-number">${clarity}<small>${clarity === '—' ? '' : '%'}</small></div><div class="st-score-caption">Clarity score</div></div></div>
        <div class="st-score-detail">
          <h2>${session.clarityScore === null ? 'Tone feedback only' : session.clarityScore >= 85 ? 'Clear and confident' : session.clarityScore >= 60 ? 'A solid foundation' : 'Keep shaping each word'}</h2>
          <div class="st-word-diff">${renderWordDiff(session)}</div>
          ${session.clarityScore === null ? '' : `<div class="st-diff-legend"><span><i class="st-legend-dot" style="background:#2c685b"></i>Matched</span><span><i class="st-legend-dot" style="background:#d7a05d"></i>Different word</span><span><i class="st-legend-dot" style="background:#c56c60"></i>Missed</span></div>`}
        </div>
      </div>
      <div class="st-tone-grid" aria-label="Supporting voice metrics">
        <article class="st-card st-metric"><span class="st-metric-icon" aria-hidden="true">≋</span><p class="st-metric-label">Volume consistency</p><p class="st-metric-value">${escapeHtml(volume)}</p><p class="st-metric-note">${metricNote(session, 'volume')}</p></article>
        <article class="st-card st-metric"><span class="st-metric-icon" aria-hidden="true">⌁</span><p class="st-metric-label">Pitch variation</p><p class="st-metric-value">${escapeHtml(pitch)}</p><p class="st-metric-note">${metricNote(session, 'pitch')}</p></article>
        <article class="st-card st-metric"><span class="st-metric-icon" aria-hidden="true">◷</span><p class="st-metric-label">Speaking time</p><p class="st-metric-value">${formatTime(session.toneMetrics?.durationMs || 0)}</p><p class="st-metric-note">Maximum session length 02:00</p></article>
      </div>
      <details class="st-card st-transcript-card"><summary>Full transcript</summary><p>${escapeHtml(session.transcript || 'No words were transcribed.')}</p></details>
    </section>`;
  document.querySelector('#level-continue').addEventListener('click', () => setRoute('practice'));
  document.querySelector('#view-history').addEventListener('click', () => setRoute('history'));
}

// --- History ------------------------------------------------------------

function renderHistory() {
  const sessions = loadData().sessions;
  const content = sessions.length
    ? `<div class="st-history-list">${sessions.map(renderHistoryItem).join('')}</div>`
    : `<div class="st-card st-empty"><span class="st-empty-icon" aria-hidden="true">⌁</span><h2>No sessions yet</h2><p>Your completed practice sessions will appear here.</p><button class="st-primary" id="empty-practice" type="button">Start practicing</button></div>`;
  view.innerHTML = `
    <section aria-labelledby="history-title">
      <div class="st-history-header">
        <div><p class="st-kicker">Saved in this browser</p><h1 class="st-page-title" id="history-title">Practice history</h1></div>
        <div class="st-history-tools">
          <button class="st-secondary" id="export-history" type="button" ${sessions.length ? '' : 'disabled'}>Export .voice</button>
          <label class="st-secondary st-import-label">Import .voice<input id="import-history" type="file" accept=".voice,application/json"></label>
          <button class="st-danger" id="clear-history" type="button" ${sessions.length ? '' : 'disabled'}>Clear history</button>
          <label class="st-replace"><input id="replace-import" type="checkbox"> Replace history when importing</label>
        </div>
      </div>
      ${content}
    </section>`;

  document.querySelector('#empty-practice')?.addEventListener('click', () => setRoute('practice'));
  document.querySelector('#export-history').addEventListener('click', () => {
    exportBackup();
    showToast('Backup exported');
  });
  document.querySelector('#import-history').addEventListener('change', handleImport);
  document.querySelector('#clear-history').addEventListener('click', () => {
    if (window.confirm('Clear every saved practice session and reset your level progress? Export a backup first if you may need them later.')) {
      clearHistory();
      refreshHistoryCount();
      renderHistory();
      showToast('History cleared');
    }
  });
}

function renderHistoryItem(session) {
  const clarity = session.clarityScore === null ? '—' : session.clarityScore;
  const volume = session.toneMetrics?.volumeConsistency?.label || 'unavailable';
  const pitch = session.toneMetrics?.pitchVariation?.label || 'unavailable';
  const badge = session.meta?.levelId
    ? `<span class="st-history-badge">Level ${session.meta.levelId}</span>`
    : session.meta?.placementBatchId
      ? `<span class="st-history-badge is-placement">Placement</span>`
      : '';
  return `
    <details class="st-card st-history-item">
      <summary class="st-history-summary">
        <span class="st-history-score">${clarity}<small>${clarity === '—' ? '' : '%'}</small></span>
        <time class="st-history-date" datetime="${escapeHtml(session.timestamp)}">${formatDate(session.timestamp)}</time>
        <span class="st-history-snippet">${badge}${escapeHtml(session.targetScript)}</span>
        <span class="st-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="st-history-body">
        <div class="st-word-diff">${renderWordDiff(session)}</div>
        <div class="st-history-meta"><span>Volume: ${escapeHtml(volume)}</span><span>Pitch: ${escapeHtml(pitch)}</span><span>Time: ${formatTime(session.toneMetrics?.durationMs || 0)}</span></div>
      </div>
    </details>`;
}

async function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const replace = document.querySelector('#replace-import').checked;
  try {
    const before = loadData().sessions.length;
    const data = await importBackup(file, { replace });
    refreshHistoryCount();
    renderHistory();
    const added = Math.max(0, data.sessions.length - (replace ? 0 : before));
    showToast(replace ? `Imported ${data.sessions.length} sessions` : added ? `Added ${added} sessions` : 'Already up to date — no duplicates added');
  } catch (error) {
    showToast(error.message);
    event.target.value = '';
  }
}

document.querySelectorAll('[data-route]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (activeSession && !window.confirm('End the current recording and leave this session?')) return;
    if (activeSession) await stopSession();
    setRoute(button.dataset.route);
  });
});

refreshHistoryCount();
renderPracticeRoute();
