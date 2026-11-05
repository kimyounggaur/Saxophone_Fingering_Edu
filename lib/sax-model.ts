/**
 * SaxTone 3.0 note renderer.
 *
 * A pure, deterministic DSP module (no DOM, no Web Audio) that renders one saxophone note into a
 * Float32Array.  The engine in `sax-synth.ts` renders notes with it once, caches them as
 * AudioBuffers and plays them through the shared master chain.
 *
 * Model summary (numbers and measurements are documented in docs/audio-engine.md):
 *  - Harmonic source/filter: level(k, f) = slope * log2(k) + register term + even/odd offset
 *    + E(k * f), where E is a smooth band filter fitted to real alto-saxophone recordings.
 *  - Reed-like dynamics: harmonic k grows like envelope^(1 + delta*(k-1)), so higher partials arrive
 *    later than the fundamental during the attack and breathe with the vibrato.
 *  - Micro-variation measured from real recordings: per-partial amplitude wander that grows with
 *    partial number, about one cent of pitch jitter, slow drift.
 *  - Aspiration noise that follows the breath pressure, is modulated at the pitch period (so it fuses
 *    with the tone) and is coloured by a body band, plus a short tongue/air burst.
 *  - Attack time depends on register; the pitch starts a few cents flat and settles; the tone droops
 *    slightly while the breath dies away at the end of the note.
 *  - Loudness is equalised across the register with an A-weighted level so notes do not jump.
 *
 * Keep this file free of TypeScript-only runtime syntax (enums, parameter properties) so that the
 * Node test runner can import it directly with type stripping.
 */

export type SaxModelInstrument = "soprano" | "alto" | "tenor";

/** User-facing tone controls.  Every field is optional when rendering; `undefined` = default. */
export interface SaxToneControls {
  /** Spectral tilt. 1 = measured balance, > 1 brighter, < 1 darker. */
  readonly brightness: number;
  /** Aspiration noise amount. 1 = measured, 0 = none. */
  readonly breath: number;
  /** Attack time scale. 1 = measured, < 1 sharper, > 1 softer. */
  readonly attack: number;
  /** Tongue / air burst at the start of the note. 1 = default, 0 = none. */
  readonly tongue: number;
  /** Amplitude and pitch micro-variation. 1 = measured, 0 = perfectly steady. */
  readonly life: number;
  /** Vibrato depth in cents (peak). 0 = no vibrato. */
  readonly vibratoDepth: number;
  /** Vibrato rate in Hz. */
  readonly vibratoRate: number;
  /** Seconds of plain tone before the vibrato fades in. */
  readonly vibratoDelay: number;
  /** Release time scale. 1 = default. */
  readonly release: number;
}

export interface SaxToneRenderOptions {
  /** Sounding (concert) MIDI pitch. */
  readonly midi: number;
  readonly instrument: SaxModelInstrument;
  /** Total note length in seconds, release included. */
  readonly duration: number;
  /** Playing dynamic, 0.35 (soft) .. 1 (loud). 0.72 is the reference. */
  readonly intensity?: number;
  readonly sampleRate: number;
  /** Changes the random micro-variation and noise realisation. */
  readonly seed?: number;
  readonly controls?: Partial<SaxToneControls>;
}

export interface SaxToneRender {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

interface SaxModelProfile {
  /** dB per doubling of harmonic number. */
  readonly slopeDb: number;
  /** Extra slope per octave of fundamental above/below 311 Hz (dB per doubling of harmonic number). */
  readonly slopeRegister: number;
  readonly evenDb: number;
  /** Shift of the body filter along the frequency axis, in octaves. */
  readonly filterShiftOct: number;
  /** Centre of the body-coloured part of the breath noise, Hz. */
  readonly noiseCenter: number;
  readonly vibratoRate: number;
  readonly vibratoDepth: number;
  /** Multiplies attack times (a bigger horn speaks a little slower). */
  readonly attackScale: number;
}

export const SAX_MODEL_PROFILES: Readonly<Record<SaxModelInstrument, SaxModelProfile>> = {
  alto: {
    slopeDb: -6.58,
    slopeRegister: 1.0,
    evenDb: -0.3,
    filterShiftOct: 0,
    noiseCenter: 1500,
    vibratoRate: 5.3,
    vibratoDepth: 12,
    attackScale: 1,
  },
  tenor: {
    slopeDb: -6.5,
    slopeRegister: 3.0,
    evenDb: -0.5,
    filterShiftOct: 0.25,
    noiseCenter: 1250,
    vibratoRate: 5.0,
    vibratoDepth: 12.5,
    attackScale: 1.15,
  },
  soprano: {
    slopeDb: -6.6,
    slopeRegister: 1.0,
    evenDb: -0.5,
    filterShiftOct: 0.15,
    noiseCenter: 1900,
    vibratoRate: 5.6,
    vibratoDepth: 11,
    attackScale: 0.9,
  },
};

/**
 * Body/bell response in dB at half-octave knots starting at 100 Hz, from a smooth fit to real alto
 * saxophone recordings (zero mean, zero trend; the spectral slope is carried by `slopeDb`).
 */
const FILTER_START_LOG2 = Math.log2(100);
const FILTER_STEP_OCT = 0.5;
const FILTER_DB: readonly number[] = [
  -12.5, -7.6, -2.7, 1.9, 5.2, 6.9, 7.8, 7.9, 7.5, 6.3, 3.2, -2.0, -7.8, -14.1,
];

const TWO_PI = Math.PI * 2;
const BLOCK = 64;
const MAX_HARMONICS = 44;
const REFERENCE_INTENSITY = 0.72;
/** Output scale: A-weighted RMS of the sustained tone at the reference intensity. */
const TARGET_A_RMS = 0.085;
/** Strength of the amplitude -> brightness coupling (reed non-linearity). */
const NONLINEARITY = 0.34;
/** Loudness growth with playing dynamic (amplitude ~ drive^0.8). */
const LOUDNESS_PER_DRIVE = 0.8;

// Calibrated against the real recordings (docs/audio-engine.md, "측정과 보정").
const NOISE_DB = -32;
const BURST_RATIO = 0.6;
const NOISE_LOWPASS_HZ = 5500;
const NOISE_ENVELOPE_POWER = 0.7;
const BURST_LOWPASS_HZ = 2000;
const BURST_SECONDS = 0.24;
const BURST_DECAY_SECONDS = 0.03;
const PITCH_SYNC_DEPTH = 0.55;
const PITCH_SYNC_COS = Math.cos(0.8);
const PITCH_SYNC_SIN = Math.sin(0.8);
const PITCH_SYNC_NORM = 1 / 0.4244;
const JITTER_CENTS = 1.2;
/** Amplitude wander (rms %) of partial k = 1, 2, 3, ... measured on real alto saxophone notes. */
const PARTIAL_WANDER_PERCENT: readonly number[] = [1.4, 3.15, 5.0, 6.0, 7.2, 8.7, 9.1, 9.4, 9.5];
const DRIFT_CENTS = 0.5;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function softClip(x: number): number {
  const a = Math.abs(x);
  if (a < 0.8) return x;
  const y = 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2);
  return x < 0 ? -y : y;
}

/** Body filter in dB at `frequency` (linear extrapolation outside the fitted range). */
export function saxBodyFilterDb(frequency: number, shiftOctaves = 0): number {
  const x = (Math.log2(Math.max(20, frequency)) - shiftOctaves - FILTER_START_LOG2) / FILTER_STEP_OCT;
  const last = FILTER_DB.length - 1;
  if (x <= 0) return FILTER_DB[0] + x * (FILTER_DB[1] - FILTER_DB[0]);
  if (x >= last) return FILTER_DB[last] + (x - last) * (FILTER_DB[last] - FILTER_DB[last - 1]);
  const index = Math.floor(x);
  const fraction = x - index;
  return FILTER_DB[index] * (1 - fraction) + FILTER_DB[index + 1] * fraction;
}

/** Steady-state level of harmonic `k` (dB, arbitrary reference) for a note with fundamental `f0`. */
export function saxHarmonicLevelDb(
  instrument: SaxModelInstrument,
  f0: number,
  k: number,
  brightness = 1,
  frequency = f0 * k,
): number {
  const profile = SAX_MODEL_PROFILES[instrument];
  const log2k = Math.log2(k);
  const slope = profile.slopeDb + 3 * (brightness - 1);
  return (
    slope * log2k +
    profile.slopeRegister * log2k * (Math.log2(f0) - Math.log2(311)) +
    (k % 2 === 0 ? profile.evenDb : 0) +
    saxBodyFilterDb(frequency, profile.filterShiftOct)
  );
}

/** Linear gain of the A-weighting curve, 1.0 at 1 kHz. */
function aWeighting(frequency: number): number {
  const f2 = frequency * frequency;
  const c = 12_194 ** 2;
  const ra = (c * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + c));
  return ra * 1.2589;
}

// ---------------------------------------------------------------------------------------------
// Deterministic random numbers and small DSP helpers

class Rng {
  private state: number;
  private spare: number | null;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
    this.spare = null;
    for (let i = 0; i < 8; i += 1) this.uniform();
  }

  uniform(): number {
    let s = this.state;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.state = s >>> 0;
    return this.state / 4_294_967_296;
  }

  /** Zero-mean, unit-variance white noise (uniform distribution; cheap, used for audio-rate noise). */
  white(): number {
    return (this.uniform() - 0.5) * 3.4641016;
  }

  gauss(): number {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;
      return value;
    }
    const u = Math.max(1e-12, this.uniform());
    const v = this.uniform();
    const radius = Math.sqrt(-2 * Math.log(u));
    this.spare = radius * Math.sin(TWO_PI * v);
    return radius * Math.cos(TWO_PI * v);
  }
}

/** Unit-variance noise low-passed by two cascaded one-pole filters, evaluated at the block rate. */
class SlowNoise {
  private readonly rng: Rng;
  private readonly a: number;
  private readonly gain: number;
  private y1: number;
  private y2: number;

  constructor(rng: Rng, blockRate: number, cutoffHz: number) {
    const a = 1 - Math.exp((-TWO_PI * cutoffHz) / blockRate);
    const p = 1 - a;
    const q = p * p;
    this.rng = rng;
    this.a = a;
    this.gain = 1 / Math.sqrt((a ** 4 * (1 + q)) / (1 - q) ** 3);
    this.y1 = 0;
    this.y2 = 0;
    for (let i = 0; i < Math.ceil(8 / a); i += 1) this.next();
  }

  next(): number {
    this.y1 += this.a * (this.rng.gauss() - this.y1);
    this.y2 += this.a * (this.y1 - this.y2);
    return this.y2 * this.gain;
  }
}

class Biquad {
  private readonly b0: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  /** Constant-skirt band-pass (peak gain 1 at `frequency`). */
  constructor(sampleRate: number, frequency: number, q: number) {
    const w = (TWO_PI * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// ---------------------------------------------------------------------------------------------
// Note renderer

/** 10-90 % rise time of the amplitude envelope (seconds) for a sounding pitch, from real recordings. */
export function saxAttackSeconds(midi: number): number {
  // Low notes speak slowly (~60 ms); everything from about G3 up is quick (20-25 ms).
  const low = 1 - smoothstep(52, 57, midi);
  const high = smoothstep(62, 78, midi);
  return (0.025 - 0.005 * high) * (1 - low) + 0.06 * low;
}

export function saxToneLength(duration: number, sampleRate: number): number {
  return Math.ceil(clamp(duration, 0.2, 8) * sampleRate);
}

export function resolveSaxToneControls(
  instrument: SaxModelInstrument,
  partial: Partial<SaxToneControls> | undefined,
): SaxToneControls {
  const profile = SAX_MODEL_PROFILES[instrument];
  const pick = (value: number | undefined, fallback: number, lo: number, hi: number): number =>
    clamp(typeof value === "number" && Number.isFinite(value) ? value : fallback, lo, hi);
  return {
    brightness: pick(partial?.brightness, 1, 0, 2),
    breath: pick(partial?.breath, 1, 0, 3),
    attack: pick(partial?.attack, 1, 0.3, 3),
    tongue: pick(partial?.tongue, 1, 0, 3),
    life: pick(partial?.life, 1, 0, 3),
    vibratoDepth: pick(partial?.vibratoDepth, profile.vibratoDepth, 0, 60),
    vibratoRate: pick(partial?.vibratoRate, profile.vibratoRate, 2, 9),
    vibratoDelay: pick(partial?.vibratoDelay, 0.34, 0, 3),
    release: pick(partial?.release, 1, 0.3, 3),
  };
}

/** Renders a note synchronously (about 15-50 ms for 1.4 s of audio on a desktop CPU). */
export function renderSaxTone(options: SaxToneRenderOptions): SaxToneRender {
  const job = renderSaxToneProgressive(options, Number.POSITIVE_INFINITY);
  let step = job.next();
  while (!step.done) step = job.next();
  return step.value;
}

/**
 * Time-sliced version of `renderSaxTone`: the generator yields the finished fraction (0..1) every
 * `blocksPerSlice` blocks of 64 samples (about 2 ms of CPU on a desktop) so that the caller can hand
 * control back to the browser between slices and keep animations and touch input smooth.  The
 * generator's return value is the finished note.  Exceptions (invalid sample rate) surface on the
 * first `next()`.
 */
export function* renderSaxToneProgressive(
  options: SaxToneRenderOptions,
  blocksPerSlice = 96,
): Generator<number, SaxToneRender, undefined> {
  const sampleRate = options.sampleRate;
  if (!(sampleRate >= 8000 && sampleRate <= 192_000)) throw new RangeError("sampleRate out of range");
  const instrument = options.instrument;
  const profile = SAX_MODEL_PROFILES[instrument];
  const controls = resolveSaxToneControls(instrument, options.controls);
  const midi = clamp(options.midi, 24, 108);
  const f0 = midiToHz(midi);
  const intensity = clamp(options.intensity ?? REFERENCE_INTENSITY, 0.35, 1);
  const drive = intensity / REFERENCE_INTENSITY;
  const total = clamp(options.duration, 0.2, 8);
  const length = saxToneLength(total, sampleRate);
  const instrumentIndex = instrument === "alto" ? 1 : instrument === "tenor" ? 2 : 3;
  const seed = (Math.imul(options.seed ?? 0, 2_654_435_761) + midi * 40_503 + instrumentIndex * 977) >>> 0;

  const blockRate = sampleRate / BLOCK;
  const rngControl = new Rng(seed ^ 0x1234abcd);
  const rngNoise = new Rng(seed ^ 0x6d2b79f5);
  const rngBurst = new Rng(seed ^ 0x2545f491);

  // --- time constants -----------------------------------------------------------------------
  const rise = saxAttackSeconds(midi) * profile.attackScale * controls.attack; // 10-90 %
  const attackTime = rise / 0.59; // raised-cosine duration whose 10-90 % span equals `rise`
  const releaseTime = clamp(
    0.15 * controls.release * (1 + 0.5 * (1 - clamp((midi - 46) / 40, 0, 1))),
    0.04,
    total * 0.4,
  );
  const releaseStart = total - releaseTime;

  // --- harmonic bookkeeping -----------------------------------------------------------------
  const nyquist = sampleRate / 2;
  const fadeLo = nyquist * 0.34;
  const fadeHi = nyquist * 0.48;
  const log2f0 = Math.log2(f0);
  const maxPitchRatio = 2 ** ((controls.vibratoDepth + 40) / 1200);
  const harmonicCount = Math.max(1, Math.min(MAX_HARMONICS, Math.floor(fadeHi / (f0 * maxPitchRatio))));
  const log2k = new Float64Array(harmonicCount + 1);
  const exponent = new Float64Array(harmonicCount + 1);
  const wanderDepth = new Float64Array(harmonicCount + 1);
  for (let k = 1; k <= harmonicCount; k += 1) {
    log2k[k] = Math.log2(k);
    exponent[k] = Math.min(4.5, 1 + NONLINEARITY * (k - 1));
    // measured amplitude wander of real partials (fraction of the amplitude, rms)
    wanderDepth[k] = (controls.life * PARTIAL_WANDER_PERCENT[Math.min(k, PARTIAL_WANDER_PERCENT.length) - 1]) / 100;
  }
  const slopeTerm = profile.slopeDb + 3 * (controls.brightness - 1) + profile.slopeRegister * (log2f0 - Math.log2(311));

  const levelDb = (k: number, frequency: number): number =>
    slopeTerm * log2k[k] + (k % 2 === 0 ? profile.evenDb : 0) + saxBodyFilterDb(frequency, profile.filterShiftOct);

  // --- loudness normalisation (A-weighted steady state) ---------------------------------------
  let weightedPower = 0;
  let plainPower = 0;
  for (let k = 1; k <= harmonicCount; k += 1) {
    const frequency = f0 * k;
    if (frequency >= fadeHi) break;
    const fade = 1 - smoothstep(fadeLo, fadeHi, frequency);
    const amplitude = 10 ** (levelDb(k, frequency) / 20) * fade;
    plainPower += 0.5 * amplitude * amplitude;
    const weighted = amplitude * aWeighting(frequency);
    weightedPower += 0.5 * weighted * weighted;
  }
  // Playing louder makes the tone brighter (partial k scales with drive^exponent[k]) and louder, but
  // the loudness follows a gentle power law so that a hard blow can never clip.
  let weightedPowerAtDrive = 0;
  for (let k = 1; k <= harmonicCount; k += 1) {
    const frequency = f0 * k;
    if (frequency >= fadeHi) break;
    const fade = 1 - smoothstep(fadeLo, fadeHi, frequency);
    const weighted = 10 ** (levelDb(k, frequency) / 20) * fade * aWeighting(frequency) * drive ** exponent[k];
    weightedPowerAtDrive += 0.5 * weighted * weighted;
  }
  const driveCompensation = drive ** LOUDNESS_PER_DRIVE * Math.sqrt(weightedPower / Math.max(1e-12, weightedPowerAtDrive));
  const toneGain = (TARGET_A_RMS / Math.sqrt(Math.max(1e-12, weightedPower))) * driveCompensation;
  const toneRms = (Math.sqrt(plainPower) * TARGET_A_RMS) / Math.sqrt(Math.max(1e-12, weightedPower)) * drive ** LOUDNESS_PER_DRIVE;

  // --- noise ----------------------------------------------------------------------------------
  const noiseRms = toneRms * 10 ** (NOISE_DB / 20) * controls.breath;
  const bodyBand = new Biquad(sampleRate, profile.noiseCenter, 0.55);
  const burstBand = new Biquad(sampleRate, profile.noiseCenter * 0.5, 0.7);
  const burstLowpassCoeff = 1 - Math.exp((-TWO_PI * BURST_LOWPASS_HZ) / sampleRate);
  const burstHighpassCoeff = Math.exp((-TWO_PI * 350) / sampleRate);
  let burstLow1 = 0;
  let burstLow2 = 0;
  let burstHigh = 0;
  let burstHighPrev = 0;
  const highpassCoeff = Math.exp((-TWO_PI * 260) / sampleRate);
  const lowpassCoeff = 1 - Math.exp((-TWO_PI * NOISE_LOWPASS_HZ) / sampleRate);
  let highpassState = 0;
  let highpassPrev = 0;
  let lowpassState = 0;
  let lowpassState2 = 0;
  let lowpassState3 = 0;
  const burstRms = toneRms * BURST_RATIO * controls.tongue;

  // --- control noise sources -----------------------------------------------------------------
  const partialWander: SlowNoise[] = [];
  for (let k = 0; k <= harmonicCount; k += 1) partialWander.push(new SlowNoise(rngControl, blockRate, 5.5));
  const commonWander = new SlowNoise(rngControl, blockRate, 3);
  const jitterNoise = new SlowNoise(rngControl, blockRate, 40);
  const driftNoise = new SlowNoise(rngControl, blockRate, 0.6);
  const vibratoWander = new SlowNoise(rngControl, blockRate, 0.8);
  let vibratoPhase = rngControl.uniform() * TWO_PI;

  const envelopeAt = (t: number): number => {
    let e = 0;
    if (t >= attackTime) e = 1;
    else if (t > 0) e = 0.5 * (1 - Math.cos((Math.PI * t) / attackTime));
    // small overshoot shortly after the attack, as measured (~1 dB)
    const u = (t - attackTime * 0.6) / (attackTime * 1.6 + 0.02);
    if (u > 0) e += 0.1 * u * Math.exp(1 - u);
    if (t > releaseStart) {
      const r = clamp((t - releaseStart) / releaseTime, 0, 1);
      e *= 0.5 * (1 + Math.cos(Math.PI * r));
    }
    return e;
  };

  const lifeAmount = Math.min(1, controls.life + 0.35);
  const scoopCents = 9 + 12 * (1 - clamp((midi - 50) / 30, 0, 1));
  const centsAt = (t: number, jitter: number, drift: number, vibrato: number): number => {
    const scoop = -scoopCents * Math.exp(-t / 0.026) * lifeAmount;
    const droop = t > releaseStart ? -9 * smoothstep(0, 1, (t - releaseStart) / releaseTime) ** 2 : 0;
    return scoop + droop + jitter * JITTER_CENTS * controls.life + drift * DRIFT_CENTS * controls.life + vibrato;
  };

  // --- render ---------------------------------------------------------------------------------
  const out = new Float32Array(length);
  const ampNow = new Float64Array(harmonicCount + 1);
  const ampInc = new Float64Array(harmonicCount + 1);
  const omega0 = (TWO_PI * f0) / sampleRate;
  let theta = 0;
  let centsPrev = centsAt(0, 0, driftNoise.next(), 0);
  let noiseGainPrev = 0;
  const blocks = Math.ceil(length / BLOCK);

  for (let block = 0; block < blocks; block += 1) {
    const start = block * BLOCK;
    const count = Math.min(BLOCK, length - start);
    const tEnd = (start + count) / sampleRate;

    // control values at the end of this block
    const jitter = jitterNoise.next();
    const drift = driftNoise.next();
    const vibratoRamp = smoothstep(controls.vibratoDelay, controls.vibratoDelay + 0.38, tEnd);
    const vibratoDepth = controls.vibratoDepth * vibratoRamp * (1 + 0.1 * vibratoWander.next() * controls.life);
    const vibratoHz = controls.vibratoRate * (1 + 0.035 * vibratoWander.next() * controls.life);
    vibratoPhase += (TWO_PI * vibratoHz * count) / sampleRate;
    const centsNow = centsAt(tEnd, jitter, drift, vibratoDepth * Math.sin(vibratoPhase));
    const common = 1 + 0.008 * commonWander.next() * controls.life;
    // lip vibrato also breathes the loudness a little
    const vibratoAm = 1 + 0.045 * (vibratoDepth / 12) * Math.sin(vibratoPhase + 0.7);
    const envNow = Math.max(0, envelopeAt(tEnd) * common * vibratoAm * drive);
    const fInst = f0 * 2 ** (centsNow / 1200);

    for (let k = 1; k <= harmonicCount; k += 1) {
      const frequency = fInst * k;
      const wander = 1 + wanderDepth[k] * partialWander[k].next();
      let target = 0;
      if (frequency < fadeHi) {
        const fade = 1 - smoothstep(fadeLo, fadeHi, frequency);
        target = 10 ** (levelDb(k, frequency) / 20) * fade * toneGain * Math.max(0.2, wander) * envNow ** exponent[k];
      }
      ampInc[k] = (target - ampNow[k]) / count;
    }

    const noiseGainNow = noiseRms * driveCompensation * envNow ** NOISE_ENVELOPE_POWER;
    const noiseGainInc = (noiseGainNow - noiseGainPrev) / count;
    const centsInc = (centsNow - centsPrev) / count;
    let cents = centsPrev;
    let noiseGain = noiseGainPrev;

    for (let n = 0; n < count; n += 1) {
      cents += centsInc;
      noiseGain += noiseGainInc;
      theta += omega0 * 2 ** (cents / 1200);
      if (theta > TWO_PI) theta -= TWO_PI;

      // harmonics by Chebyshev recurrence: sin((k+1)t) = 2 cos(t) sin(kt) - sin((k-1)t)
      const s1 = Math.sin(theta);
      const c1 = Math.cos(theta);
      const twoC = 2 * c1;
      let sPrev = 0;
      let sCur = s1;
      ampNow[1] += ampInc[1];
      let tone = ampNow[1] * s1;
      for (let k = 2; k <= harmonicCount; k += 1) {
        const sNext = twoC * sCur - sPrev;
        sPrev = sCur;
        sCur = sNext;
        ampNow[k] += ampInc[k];
        tone += ampNow[k] * sNext;
      }

      // aspiration noise, modulated at the pitch period so that it fuses with the tone
      const white = rngNoise.white();
      highpassState = highpassCoeff * (highpassState + white - highpassPrev);
      highpassPrev = white;
      const shaped = 0.5 * highpassState + 1.15 * bodyBand.process(white);
      lowpassState += lowpassCoeff * (shaped - lowpassState);
      lowpassState2 += lowpassCoeff * (lowpassState - lowpassState2);
      lowpassState3 += lowpassCoeff * (lowpassState2 - lowpassState3);
      const coloured = lowpassState3;
      const reed = 0.5 * (1 + c1 * PITCH_SYNC_COS + s1 * PITCH_SYNC_SIN);
      const reedShape = reed * Math.sqrt(reed) * PITCH_SYNC_NORM;
      const noise = coloured * noiseGain * (1 - PITCH_SYNC_DEPTH + PITCH_SYNC_DEPTH * reedShape);

      // tongue / air burst: quick rise, then fades over ~60 ms; kept dark like the measured attacks
      const t = (start + n) / sampleRate;
      let burst = 0;
      if (t < BURST_SECONDS) {
        const shaped = burstBand.process(rngBurst.white());
        burstLow1 += burstLowpassCoeff * (shaped - burstLow1);
        burstLow2 += burstLowpassCoeff * (burstLow1 - burstLow2);
        burstHigh = burstHighpassCoeff * (burstHigh + burstLow2 - burstHighPrev);
        burstHighPrev = burstLow2;
        burst = burstHigh * burstRms * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / BURST_DECAY_SECONDS);
      }

      out[start + n] = softClip(tone + noise + burst);
    }

    centsPrev = centsNow;
    noiseGainPrev = noiseGainNow;
    if (block + 1 < blocks && (block + 1) % blocksPerSlice === 0) yield (block + 1) / blocks;
  }

  return { samples: out, sampleRate };
}
