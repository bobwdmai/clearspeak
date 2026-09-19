import test from 'node:test';
import assert from 'node:assert/strict';
import { isSpeechSynthesisSupported, speak, stopSpeaking } from '../js/speech-synthesis.js';

class FakeUtterance {
  constructor(text) { this.text = text; }
}

function installFakes() {
  const fakes = { spoken: [], cancels: 0 };
  globalThis.SpeechSynthesisUtterance = FakeUtterance;
  globalThis.speechSynthesis = {
    speak: (utterance) => fakes.spoken.push(utterance),
    cancel: () => { fakes.cancels += 1; }
  };
  return fakes;
}

test.afterEach(() => {
  stopSpeaking();
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
});

test('reports unsupported, and speak() does nothing, without the browser API', () => {
  assert.equal(isSpeechSynthesisSupported(), false);
  assert.equal(speak('hello'), false);
});

test('speaks the text at the requested rate and cancels earlier speech first', () => {
  const fakes = installFakes();
  assert.equal(isSpeechSynthesisSupported(), true);
  assert.equal(speak('read this aloud', { rate: 0.7 }), true);
  assert.equal(fakes.cancels, 1);
  assert.equal(fakes.spoken.length, 1);
  assert.equal(fakes.spoken[0].text, 'read this aloud');
  assert.equal(fakes.spoken[0].rate, 0.7);
  assert.equal(fakes.spoken[0].lang, 'en-US');
});

test('onEnd fires for the current utterance but not for a superseded one', () => {
  const fakes = installFakes();
  const ended = [];
  speak('first', { onEnd: () => ended.push('first') });
  speak('second', { onEnd: () => ended.push('second') });

  fakes.spoken[0].onend(); // the cancelled first utterance reporting late
  assert.deepEqual(ended, []);
  fakes.spoken[1].onend();
  assert.deepEqual(ended, ['second']);
});

test('a speech error also releases the current utterance', () => {
  const fakes = installFakes();
  const ended = [];
  speak('oops', { onEnd: () => ended.push('done') });
  fakes.spoken[0].onerror();
  assert.deepEqual(ended, ['done']);
});

test('stopSpeaking cancels playback and suppresses the pending onEnd', () => {
  const fakes = installFakes();
  const ended = [];
  speak('stop me', { onEnd: () => ended.push('done') });
  const before = fakes.cancels;
  stopSpeaking();
  assert.equal(fakes.cancels, before + 1);
  fakes.spoken[0].onend();
  assert.deepEqual(ended, []);
});
