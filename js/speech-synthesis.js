// Thin wrapper over the browser's built-in SpeechSynthesis, used to read a
// passage aloud before a recording starts. It reads its globals at call time
// (not import time) so it can be exercised with fakes outside a browser.
//
// Playback must never overlap a recording: the mic would pick the voice up
// and the transcript/clarity score would be scoring the synthesizer, not the
// speaker. Callers stop speech before opening the microphone.

let current = null;

export function isSpeechSynthesisSupported() {
  return Boolean(globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance);
}

export function speak(text, { rate = 1, onEnd } = {}) {
  if (!isSpeechSynthesisSupported()) return false;
  stopSpeaking();

  const utterance = new globalThis.SpeechSynthesisUtterance(text);
  utterance.lang = globalThis.document?.documentElement?.lang || 'en-US';
  utterance.rate = rate;

  // A cancelled utterance still fires its end/error event, later. Only the
  // utterance that is still current may report back, so a superseded one
  // can't reset the UI of whatever started after it.
  const finish = () => {
    if (current !== utterance) return;
    current = null;
    onEnd?.();
  };
  utterance.onend = finish;
  utterance.onerror = finish;

  current = utterance;
  globalThis.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  current = null;
  if (isSpeechSynthesisSupported()) globalThis.speechSynthesis.cancel();
}
