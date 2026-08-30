export class AudioCapture {
  constructor() {
    this.stream = null;
    this.context = null;
    this.analyser = null;
    this.samples = null;
  }

  static isSupported() {
    return Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  }

  async start() {
    if (!AudioCapture.isSupported()) throw new Error('Microphone audio is not supported in this browser.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
    });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextClass();
    await this.context.resume();
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.35;
    this.samples = new Float32Array(this.analyser.fftSize);
    source.connect(this.analyser);
    return this.analyser;
  }

  currentRms() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const value of this.samples) sum += value * value;
    return Math.sqrt(sum / this.samples.length);
  }

  async stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.stream = null;
    this.context = null;
    this.analyser = null;
    this.samples = null;
  }
}
