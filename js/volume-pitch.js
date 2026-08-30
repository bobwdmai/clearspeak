function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export function detectPitch(buffer, sampleRate) {
  let rms = 0;
  for (const value of buffer) rms += value * value;
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.012) return null;

  const minOffset = Math.floor(sampleRate / 400);
  const maxOffset = Math.min(Math.floor(sampleRate / 75), Math.floor(buffer.length / 2));
  let bestOffset = -1;
  let bestCorrelation = 0;

  for (let offset = minOffset; offset <= maxOffset; offset += 1) {
    let correlation = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < buffer.length - offset; i += 1) {
      correlation += buffer[i] * buffer[i + offset];
      normA += buffer[i] * buffer[i];
      normB += buffer[i + offset] * buffer[i + offset];
    }
    correlation /= Math.sqrt(normA * normB) || 1;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  return bestCorrelation > 0.55 && bestOffset > 0 ? sampleRate / bestOffset : null;
}

export class VoiceMetricsTracker {
  constructor(analyser, sampleRate) {
    this.analyser = analyser;
    this.sampleRate = sampleRate;
    this.buffer = new Float32Array(analyser.fftSize);
    this.volumes = [];
    this.pitches = [];
    this.interval = null;
    this.startedAt = 0;
  }

  start() {
    this.startedAt = performance.now();
    this.sample();
    this.interval = window.setInterval(() => this.sample(), 100);
  }

  sample() {
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (const value of this.buffer) sum += value * value;
    const rms = Math.sqrt(sum / this.buffer.length);
    this.volumes.push(rms);
    const pitch = detectPitch(this.buffer, this.sampleRate);
    if (pitch) this.pitches.push(pitch);
  }

  finish(durationMs = performance.now() - this.startedAt) {
    window.clearInterval(this.interval);
    const voicedVolumes = this.volumes.filter((value) => value > 0.012);
    const usefulVolumes = voicedVolumes.length >= 4 ? voicedVolumes : this.volumes.filter((value) => value > 0.002);
    const meanVolume = usefulVolumes.length
      ? usefulVolumes.reduce((sum, value) => sum + value, 0) / usefulVolumes.length
      : 0;
    const cv = meanVolume ? standardDeviation(usefulVolumes) / meanVolume : 0;
    const volumeLabel = usefulVolumes.length < 3 ? 'not enough data' : cv <= 0.34 ? 'steady' : cv <= 0.62 ? 'somewhat variable' : 'inconsistent';

    const pitchMedian = median(this.pitches);
    const semitones = pitchMedian
      ? this.pitches.map((pitch) => 12 * Math.log2(pitch / pitchMedian)).filter((value) => Math.abs(value) < 12)
      : [];
    const pitchStdDev = standardDeviation(semitones);
    const pitchLabel = semitones.length < 4 ? 'not enough data' : pitchStdDev < 1.35 ? 'monotone' : pitchStdDev <= 3.5 ? 'normal' : 'expressive';

    return {
      volumeConsistency: { label: volumeLabel, coefficientOfVariation: Number(cv.toFixed(3)) },
      pitchVariation: { label: pitchLabel, semitoneStdDev: Number(pitchStdDev.toFixed(2)) },
      durationMs: Math.round(durationMs)
    };
  }
}
