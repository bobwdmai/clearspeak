export class SpeechRecognitionController {
  constructor({ onTranscript, onError } = {}) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(Recognition);
    this.Recognition = Recognition;
    this.onTranscript = onTranscript || (() => {});
    this.onError = onError || (() => {});
    this.active = false;
    this.finalParts = [];
    this.recognition = null;
    this.restartTimer = null;
  }

  start() {
    if (!this.supported) return false;
    this.active = true;
    this.finalParts = [];
    this.#createAndStart();
    return true;
  }

  #createAndStart() {
    if (!this.active) return;
    const recognition = new this.Recognition();
    this.recognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || 'en-US';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript.trim();
        if (event.results[i].isFinal) this.finalParts.push(text);
        else interim += `${text} `;
      }
      this.onTranscript({ final: this.finalParts.join(' ').trim(), interim: interim.trim() });
    };

    recognition.onerror = (event) => {
      if (!['no-speech', 'aborted'].includes(event.error)) this.onError(event.error);
      if (['not-allowed', 'service-not-allowed'].includes(event.error)) this.active = false;
    };

    // Chromium may end recognition after a pause even in continuous mode.
    // Restarting it keeps a single practice session alive until the user stops.
    recognition.onend = () => {
      if (this.active) this.restartTimer = window.setTimeout(() => this.#createAndStart(), 180);
    };

    try {
      recognition.start();
    } catch (error) {
      this.onError(error.message);
    }
  }

  stop() {
    this.active = false;
    window.clearTimeout(this.restartTimer);
    try { this.recognition?.stop(); } catch { /* already stopped */ }
    return this.finalParts.join(' ').trim();
  }

  get transcript() {
    return this.finalParts.join(' ').trim();
  }
}
