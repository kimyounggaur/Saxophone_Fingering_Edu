// Signal analysis used by the listening lab: FFT, spectrogram, A-weighted loudness matching and the
// harmonic profile.  The profile code is a port of analyze_ref.py (scripts/audio-calibration) so that a
// rendered note and the reference measurements from that script are measured the same way.

export interface FftPlan {
  readonly size: number;
  readonly cos: Float64Array;
  readonly sin: Float64Array;
  readonly reverse: Uint32Array;
}

export function createFftPlan(size: number): FftPlan {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    throw new RangeError("FFT size must be a power of two");
  }
  const half = size / 2;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let index = 0; index < half; index += 1) {
    const angle = (-2 * Math.PI * index) / size;
    cos[index] = Math.cos(angle);
    sin[index] = Math.sin(angle);
  }
  const bits = Math.round(Math.log2(size));
  const reverse = new Uint32Array(size);
  for (let index = 0; index < size; index += 1) {
    let value = 0;
    for (let bit = 0; bit < bits; bit += 1) value |= ((index >> bit) & 1) << (bits - 1 - bit);
    reverse[index] = value;
  }
  return { size, cos, sin, reverse };
}

const planCache = new Map<number, FftPlan>();

export function getFftPlan(size: number): FftPlan {
  let plan = planCache.get(size);
  if (!plan) {
    plan = createFftPlan(size);
    planCache.set(size, plan);
  }
  return plan;
}

/** In-place forward complex FFT (e^{-i...} convention). */
export function fftInPlace(plan: FftPlan, re: Float64Array, im: Float64Array): void {
  const n = plan.size;
  for (let index = 0; index < n; index += 1) {
    const other = plan.reverse[index];
    if (other > index) {
      const tr = re[index];
      re[index] = re[other];
      re[other] = tr;
      const ti = im[index];
      im[index] = im[other];
      im[other] = ti;
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const halfLength = length >> 1;
    const step = n / length;
    for (let start = 0; start < n; start += length) {
      for (let k = 0, twiddle = 0; k < halfLength; k += 1, twiddle += step) {
        const wr = plan.cos[twiddle];
        const wi = plan.sin[twiddle];
        const a = start + k;
        const b = a + halfLength;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** numpy.hanning: symmetric Hann window. */
export function hannSymmetric(length: number): Float64Array {
  const window = new Float64Array(length);
  if (length === 1) {
    window[0] = 1;
    return window;
  }
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (length - 1));
  }
  return window;
}

function hannPeriodic(length: number): Float64Array {
  const window = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length);
  }
  return window;
}

/**
 * Windowed, zero-padded FFT of `length` samples that start at `start` (samples outside the signal
 * count as silence).  Fills `re`/`im`, which must have the plan's size.
 */
export function windowedFft(
  plan: FftPlan,
  samples: ArrayLike<number>,
  start: number,
  length: number,
  window: Float64Array,
  re: Float64Array,
  im: Float64Array,
): void {
  re.fill(0);
  im.fill(0);
  const total = samples.length;
  for (let index = 0; index < length; index += 1) {
    const position = start + index;
    if (position >= 0 && position < total) re[index] = samples[position] * window[index];
  }
  fftInPlace(plan, re, im);
}

// ---------------------------------------------------------------------------------------------
// Loudness

const A_WEIGHT_1K = aWeightRaw(1000);

function aWeightRaw(frequency: number): number {
  const f2 = frequency * frequency;
  return (
    (12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
  );
}

/** A-weighting as a linear amplitude gain, 1 at 1 kHz. */
export function aWeightingGain(frequency: number): number {
  return aWeightRaw(frequency) / A_WEIGHT_1K;
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(1e-12, gain));
}

// ---------------------------------------------------------------------------------------------
// Spectrogram

export interface Spectrogram {
  readonly frames: number;
  /** Number of frequency bins that are kept (bin 0 is DC, bin `bins - 1` is just below `maxHz`). */
  readonly bins: number;
  readonly binHz: number;
  readonly hopSeconds: number;
  /** frames * bins values: 10 log10 of the per-bin mean-square power. */
  readonly db: Float32Array;
  /** Per-frame A-weighted mean square of the whole spectrum (all bins up to Nyquist). */
  readonly weightedPower: Float64Array;
  readonly maxDb: number;
}

export interface SpectrogramOptions {
  readonly fftSize?: number;
  readonly hopSeconds?: number;
  readonly maxHz?: number;
}

export function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  options: SpectrogramOptions = {},
): Spectrogram {
  const size = options.fftSize ?? 2048;
  const hop = Math.max(1, Math.round((options.hopSeconds ?? 0.01) * sampleRate));
  const maxHz = Math.min(options.maxHz ?? 10_000, sampleRate / 2);
  const plan = getFftPlan(size);
  const window = hannPeriodic(size);
  let windowPower = 0;
  for (let index = 0; index < size; index += 1) windowPower += window[index] * window[index];
  const scale = 2 / (size * windowPower);
  const binHz = sampleRate / size;
  const bins = Math.min(size / 2, Math.floor(maxHz / binHz));
  const weights = new Float64Array(size / 2);
  for (let bin = 0; bin < size / 2; bin += 1) weights[bin] = aWeightingGain(bin * binHz) ** 2;

  const frames = Math.max(1, Math.floor(samples.length / hop) + 1);
  const db = new Float32Array(frames * bins);
  const weightedPower = new Float64Array(frames);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let maxDb = -Infinity;

  for (let frame = 0; frame < frames; frame += 1) {
    windowedFft(plan, samples, frame * hop - size / 2, size, window, re, im);
    let weighted = 0;
    const base = frame * bins;
    for (let bin = 1; bin < size / 2; bin += 1) {
      const power = (re[bin] * re[bin] + im[bin] * im[bin]) * scale;
      weighted += weights[bin] * power;
      if (bin < bins) {
        const value = 10 * Math.log10(power + 1e-20);
        db[base + bin] = value;
        if (value > maxDb) maxDb = value;
      }
    }
    db[base] = -200;
    weightedPower[frame] = weighted;
  }
  return { frames, bins, binHz, hopSeconds: hop / sampleRate, db, weightedPower, maxDb };
}

/**
 * A-weighted level (dB re full scale, mean-square) of the sounding part: frames more than 30 dB below
 * the loudest frame (silence, the far end of the reverb tail) are not counted.
 */
export function gatedLoudnessDb(spectrogram: Spectrogram): number {
  let loudest = 0;
  for (const value of spectrogram.weightedPower) if (value > loudest) loudest = value;
  if (loudest <= 0) return -120;
  const threshold = loudest * 1e-3;
  let sum = 0;
  let count = 0;
  for (const value of spectrogram.weightedPower) {
    if (value >= threshold) {
      sum += value;
      count += 1;
    }
  }
  return 10 * Math.log10(sum / Math.max(1, count) + 1e-20);
}

export interface LoudnessMatch {
  /** Linear playback gain for each clip. */
  readonly gains: readonly number[];
  /** Level each clip reaches after its gain, dB (A-weighted, gated). */
  readonly matchedDb: number;
}

/**
 * Gains that bring every clip to the same A-weighted level (`targetDb`).  If the loudest peak would
 * pass `peakLimit`, all gains shrink together so the match is kept.
 */
export function matchLoudness(
  levelsDb: readonly number[],
  peaks: readonly number[],
  targetDb: number,
  peakLimit: number,
): LoudnessMatch {
  const gains = levelsDb.map((level) => dbToGain(targetDb - level));
  let loudestPeak = 0;
  gains.forEach((gain, index) => {
    loudestPeak = Math.max(loudestPeak, gain * peaks[index]);
  });
  const shrink = loudestPeak > peakLimit ? peakLimit / loudestPeak : 1;
  return { gains: gains.map((gain) => gain * shrink), matchedDb: targetDb + gainToDb(shrink) };
}

// ---------------------------------------------------------------------------------------------
// Harmonic profile (port of analyze_ref.py)

export interface HarmonicProfile {
  readonly f0: number;
  readonly centsFromNominal: number;
  /** Band power of harmonic k+1 relative to the strongest harmonic, dB. */
  readonly db: readonly number[];
}

function nextPowerOfTwo(value: number): number {
  return 1 << Math.ceil(Math.log2(value));
}

function refineF0(segment: Float32Array, sampleRate: number, nominal: number, harmonics = 12): number {
  const n = segment.length;
  const window = hannSymmetric(n);
  const nfft = nextPowerOfTwo(n * 4);
  const plan = getFftPlan(nfft);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  windowedFft(plan, segment, 0, n, window, re, im);
  const magnitude = new Float64Array(nfft / 2 + 1);
  for (let index = 0; index < magnitude.length; index += 1) magnitude[index] = Math.hypot(re[index], im[index]);
  const df = sampleRate / nfft;
  let best = -1;
  let bestF = nominal;
  for (let step = 0; step <= 280; step += 1) {
    const frequency = nominal * 2 ** ((-70 + 0.5 * step) / 1200);
    let score = 0;
    for (let k = 1; k <= harmonics; k += 1) {
      const fk = frequency * k;
      if (fk > sampleRate / 2 - 100) break;
      const centre = Math.round(fk / df);
      let peak = 0;
      for (let index = Math.max(0, centre - 2); index <= Math.min(magnitude.length - 1, centre + 2); index += 1) {
        if (magnitude[index] > peak) peak = magnitude[index];
      }
      score += peak / Math.sqrt(k);
    }
    if (score > best) {
      best = score;
      bestF = frequency;
    }
  }
  return bestF;
}

/**
 * Measures the harmonic levels of the steady part of a note: a 0.3 s Hann window centred on
 * `centreSeconds`, the pitch refined within +-70 cents, and the power in a +-0.3 f0 band around every
 * harmonic.  Returns null when there is not enough signal.
 */
export function measureHarmonics(
  samples: Float32Array,
  sampleRate: number,
  midi: number,
  centreSeconds: number,
  maxHarmonics = 48,
): HarmonicProfile | null {
  const windowLength = Math.round(0.3 * sampleRate);
  const centre = Math.round(centreSeconds * sampleRate);
  const start = Math.max(0, centre - (windowLength >> 1));
  const segment = samples.subarray(start, start + windowLength);
  if (segment.length < windowLength / 2) return null;
  let energy = 0;
  for (const value of segment) energy += value * value;
  if (Math.sqrt(energy / segment.length) < 1e-5) return null;

  const nominal = 440 * 2 ** ((midi - 69) / 12);
  const f0 = refineF0(segment, sampleRate, nominal);
  const count = Math.min(maxHarmonics, Math.floor((sampleRate / 2 - 200) / f0));

  const n = segment.length;
  const window = hannSymmetric(n);
  const nfft = nextPowerOfTwo(n * 2);
  const plan = getFftPlan(nfft);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  windowedFft(plan, segment, 0, n, window, re, im);
  const df = sampleRate / nfft;
  const half = 0.3 * f0;
  const power: number[] = [];
  for (let k = 1; k <= count; k += 1) {
    const fk = f0 * k;
    if (fk + half > sampleRate / 2) break;
    const lo = Math.floor((fk - half) / df);
    const hi = Math.floor((fk + half) / df) + 1;
    let sum = 0;
    for (let index = lo; index < hi; index += 1) sum += re[index] * re[index] + im[index] * im[index];
    power.push(sum);
  }
  if (power.length === 0) return null;
  const peak = Math.max(...power);
  return {
    f0,
    centsFromNominal: 1200 * Math.log2(f0 / nominal),
    db: power.map((value) => 10 * Math.log10(value / peak + 1e-12)),
  };
}

/** Harmonic levels as their share of the total harmonic power (dB), over the first `maxK` harmonics. */
export function profileShares(db: readonly number[], maxK = 30): number[] {
  const count = Math.min(maxK, db.length);
  const power: number[] = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const value = 10 ** (db[index] / 10);
    power.push(value);
    total += value;
  }
  return power.map((value) => 10 * Math.log10(value / total + 1e-14));
}

/**
 * Power-weighted RMS difference (dB) between a measured profile and a reference profile, the same
 * statistic as compare.py: both are turned into shares of their total power over the common first
 * `maxK` harmonics and the squared difference is weighted by the reference's share.
 */
export function weightedProfileError(measuredDb: readonly number[], referenceDb: readonly number[], maxK = 30): number {
  const count = Math.min(maxK, measuredDb.length, referenceDb.length);
  if (count === 0) return Number.NaN;
  const test = profileShares(measuredDb, count);
  const reference = profileShares(referenceDb, count);
  let weightSum = 0;
  const weights = reference.map((value) => {
    const weight = 10 ** (value / 10);
    weightSum += weight;
    return weight;
  });
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    sum += (weights[index] / weightSum) * (test[index] - reference[index]) ** 2;
  }
  return Math.sqrt(sum);
}
