import { renderSaxToneProgressive, type SaxToneControls, type SaxToneRender } from "./sax-model.ts";

export type { SaxToneControls } from "./sax-model.ts";
export type SaxSynthInstrument = "soprano" | "alto" | "tenor";

export interface SaxFormant {
  readonly frequency: number;
  readonly q: number;
  readonly gain: number;
}

export interface SaxVoiceProfile {
  readonly id: SaxSynthInstrument;
  readonly harmonicSlope: number;
  readonly evenHarmonicGain: number;
  readonly breathLevel: number;
  readonly brightness: number;
  readonly vibratoRate: number;
  readonly vibratoDepth: number;
  readonly formants: readonly SaxFormant[];
}

export interface SaxEnvelope {
  readonly attack: number;
  readonly decay: number;
  readonly sustainUntil: number;
  readonly release: number;
  readonly total: number;
}

/**
 * `model`   - SaxTone 3.0: notes are rendered once by `renderSaxTone` (lib/sax-model.ts), cached as
 *             AudioBuffers and played through the shared master chain.
 * `classic` - SaxTone 2.0: the original real-time oscillator graph.  It is also the automatic
 *             fallback when a model note cannot be rendered.
 */
export type SaxSynthMode = "model" | "classic";

export interface SaxSynthPlayOptions {
  readonly midi: number;
  readonly instrument: SaxSynthInstrument;
  readonly duration?: number;
  readonly intensity?: number;
  /** Overrides the engine mode for this note. */
  readonly mode?: SaxSynthMode;
  /** Tone controls for model notes (brightness, breath, vibrato, ...). */
  readonly controls?: Partial<SaxToneControls>;
  /**
   * Context time (seconds) at which a model note starts.  The default is a few milliseconds after
   * `currentTime`; an `OfflineAudioContext` that has not started rendering needs an explicit time
   * because its clock is still at zero.  Ignored by classic notes.
   */
  readonly startAt?: number;
}

export interface SaxSynthEngineOptions {
  readonly mode?: SaxSynthMode;
  /** Default tone controls for model notes. */
  readonly controls?: Partial<SaxToneControls>;
  /**
   * Render the alternate variant of a model note in the background after playing it (default
   * true), so that a repeated tap never waits.  Offline rendering plays one note and turns it off.
   */
  readonly prefetch?: boolean;
  /** Longest model note in seconds (default 3.2, at most 8, the renderer's limit).  MP3 export raises it. */
  readonly maxNoteSeconds?: number;
}

/** What `SaxSynthEngine` needs from a Web Audio context: live (`AudioContext`) or offline rendering. */
export type SaxSynthAudioContext = AudioContext | OfflineAudioContext;

interface ModelNoteRequest {
  readonly instrument: SaxSynthInstrument;
  readonly midi: number;
  readonly duration: number;
  readonly intensity: number;
  readonly controls: Partial<SaxToneControls>;
  readonly controlsKey: string;
}

/** A note that is being rendered in small slices (see `renderSaxToneProgressive`). */
interface ModelRenderJob {
  readonly generator: Generator<number, SaxToneRender, undefined>;
}

interface ActiveSaxVoice {
  readonly output: GainNode;
  readonly sources: readonly AudioScheduledSourceNode[];
  release: (releaseSeconds?: number) => void;
}

const MIN_GAIN = 0.0001;
const MAX_HARMONICS = 36;
const DEFAULT_NOTE_DURATION = 1.42;
/** Longest note the interactive engine renders (a 3.2 s mono note is about 570 KB). */
const DEFAULT_MAX_NOTE_SECONDS = 3.2;
/** The renderer's own limit (`renderSaxToneProgressive` clamps to 8 s). */
const ABSOLUTE_MAX_NOTE_SECONDS = 8;
const MAX_ACTIVE_VOICES = 2;
/** Rendered notes kept per engine (a 1.4 s mono note is about 250 KB). */
const MAX_CACHED_TONES = 48;
/** Alternate renderings per note so that repeated taps do not sound sample-identical. */
const MODEL_VARIANTS = 2;
/** Level of a model note relative to a classic note, calibrated through the shared master chain. */
const MODEL_OUTPUT_GAIN = 2.2;
/** Rendering jobs that may be in flight at once (fast stepping through notes cancels the oldest). */
const MAX_RENDER_JOBS = 4;
/** 64-sample blocks rendered per slice: about 2 ms of CPU on a desktop, a few ms on a phone. */
const RENDER_BLOCKS_PER_SLICE = 96;

export const SAX_SYNTH_VERSION = "SaxTone 3.0";
export const SAX_SYNTH_CLASSIC_VERSION = "SaxTone 2.0";

export function saxSynthVersionLabel(mode: SaxSynthMode): string {
  return mode === "classic" ? SAX_SYNTH_CLASSIC_VERSION : SAX_SYNTH_VERSION;
}

let modelWarmUp: Promise<void> | null = null;

/**
 * Runs one short throw-away render in small slices so that the JavaScript engine has compiled the
 * SaxTone 3.0 renderer before the first real note is needed.  Safe to call any number of times; it
 * does nothing after the first call and never throws.
 */
export function warmUpSaxModel(): Promise<void> {
  if (!modelWarmUp) {
    modelWarmUp = (async () => {
      try {
        const job = renderSaxToneProgressive(
          { midi: 57, instrument: "alto", duration: 0.4, sampleRate: 44_100, seed: 7 },
          48,
        );
        for (let step = job.next(); !step.done; step = job.next()) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      } catch {
        // Warming up is best-effort.
      }
    })();
  }
  return modelWarmUp;
}

export const SAX_VOICE_PROFILES: Readonly<Record<SaxSynthInstrument, SaxVoiceProfile>> = {
  tenor: {
    id: "tenor",
    harmonicSlope: 1.06,
    evenHarmonicGain: 0.9,
    breathLevel: 0.082,
    brightness: 4_400,
    vibratoRate: 5.05,
    vibratoDepth: 8.5,
    formants: [
      { frequency: 470, q: 1.05, gain: 3.1 },
      { frequency: 980, q: 1.25, gain: 3.7 },
      { frequency: 2_050, q: 1.05, gain: 2.2 },
    ],
  },
  alto: {
    id: "alto",
    harmonicSlope: 0.99,
    evenHarmonicGain: 0.84,
    breathLevel: 0.071,
    brightness: 5_300,
    vibratoRate: 5.25,
    vibratoDepth: 8,
    formants: [
      { frequency: 610, q: 1.05, gain: 2.9 },
      { frequency: 1_340, q: 1.3, gain: 3.8 },
      { frequency: 2_650, q: 1.08, gain: 2.3 },
    ],
  },
  soprano: {
    id: "soprano",
    harmonicSlope: 0.93,
    evenHarmonicGain: 0.78,
    breathLevel: 0.06,
    brightness: 6_400,
    vibratoRate: 5.5,
    vibratoDepth: 7.4,
    formants: [
      { frequency: 790, q: 1, gain: 2.5 },
      { frequency: 1_760, q: 1.22, gain: 3.4 },
      { frequency: 3_350, q: 1, gain: 1.9 },
    ],
  },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function dbToAmplitude(decibels: number): number {
  return 10 ** (decibels / 20);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

export function midiToFrequency(midi: number): number {
  if (!Number.isFinite(midi)) throw new TypeError("MIDI note must be finite.");
  return 440 * 2 ** ((midi - 69) / 12);
}

export function getSaxEnvelope(midi: number, requestedDuration = DEFAULT_NOTE_DURATION): SaxEnvelope {
  const register = clamp((midi - 46) / 58, 0, 1);
  const total = clamp(requestedDuration, 0.72, 3.2);
  const attack = 0.066 - register * 0.018;
  const decay = attack + 0.13;
  const release = clamp(0.2 + (1 - register) * 0.035, 0.18, total * 0.3);
  const sustainUntil = Math.max(decay + 0.12, total - release);
  return { attack, decay, sustainUntil, release, total };
}

export function buildSaxHarmonics(
  midi: number,
  instrument: SaxSynthInstrument,
  sampleRate = 48_000,
  harmonicCount = MAX_HARMONICS,
): Float32Array {
  const profile = SAX_VOICE_PROFILES[instrument];
  const fundamental = midiToFrequency(midi);
  const nyquist = sampleRate / 2;
  const length = Math.max(2, Math.floor(harmonicCount) + 1);
  const harmonics = new Float32Array(length);

  for (let harmonic = 1; harmonic < length; harmonic += 1) {
    const frequency = fundamental * harmonic;
    if (frequency >= nyquist * 0.48) break;

    const oddEvenShape = harmonic % 2 === 1 ? 1.08 : profile.evenHarmonicGain;
    let formantShape = 1;
    for (const formant of profile.formants) {
      const distanceInOctaves = Math.log2(Math.max(1, frequency) / formant.frequency);
      const width = 0.54 / Math.sqrt(formant.q);
      const resonance = Math.exp(-(distanceInOctaves ** 2) / (2 * width ** 2));
      formantShape += (dbToAmplitude(formant.gain) - 1) * resonance;
    }

    const nyquistFade = 1 - smoothstep(nyquist * 0.34, nyquist * 0.48, frequency);
    const registerDamping = 1 / (1 + Math.max(0, fundamental - 520) * harmonic * 0.000035);
    harmonics[harmonic] =
      (oddEvenShape * formantShape * nyquistFade * registerDamping) /
      harmonic ** profile.harmonicSlope;
  }

  return harmonics;
}

function createSaturationCurve(amount = 1.7): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2_048);
  const normalizer = Math.tanh(amount);
  for (let index = 0; index < curve.length; index += 1) {
    const input = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.tanh(input * amount) / normalizer;
  }
  return curve;
}

function createNoiseBuffer(context: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const frameCount = Math.ceil(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  const random = seededRandom(seed);
  let previous = 0;
  for (let index = 0; index < frameCount; index += 1) {
    const white = random() * 2 - 1;
    previous = previous * 0.22 + white * 0.78;
    channel[index] = previous;
  }
  return buffer;
}

function createRoomImpulse(context: BaseAudioContext): AudioBuffer {
  const duration = 0.48;
  const frameCount = Math.ceil(context.sampleRate * duration);
  const impulse = context.createBuffer(2, frameCount, context.sampleRate);

  for (let channelIndex = 0; channelIndex < impulse.numberOfChannels; channelIndex += 1) {
    const channel = impulse.getChannelData(channelIndex);
    const random = seededRandom(0x51a7 + channelIndex * 997);
    for (let index = 0; index < frameCount; index += 1) {
      const seconds = index / context.sampleRate;
      const decay = Math.exp(-seconds * 10.5);
      channel[index] = (random() * 2 - 1) * decay * (0.45 + seconds * 0.7);
    }
    const earlyReflections = [
      [0.012 + channelIndex * 0.0015, 0.62],
      [0.025 - channelIndex * 0.0012, 0.38],
      [0.041 + channelIndex * 0.0018, 0.24],
      [0.067 - channelIndex * 0.001, 0.14],
    ] as const;
    for (const [delay, gain] of earlyReflections) {
      const index = Math.min(channel.length - 1, Math.floor(delay * context.sampleRate));
      channel[index] += gain;
    }
  }

  return impulse;
}

function safeStop(source: AudioScheduledSourceNode, when?: number): void {
  try {
    source.stop(when);
  } catch {
    // A voice can be released more than once during rapid navigation or page hide.
  }
}

export class SaxSynthEngine {
  readonly context: SaxSynthAudioContext;

  private readonly input: GainNode;
  private readonly masterGain: GainNode;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly saturationCurve: Float32Array<ArrayBuffer>;
  private readonly noiseBuffer: AudioBuffer;
  private readonly voices: ActiveSaxVoice[] = [];
  private readonly toneCache = new Map<string, AudioBuffer>();
  private readonly playCounts = new Map<string, number>();
  private readonly jobs = new Map<string, ModelRenderJob>();
  private readonly preparations = new Map<string, Promise<void>>();
  private readonly defaultControls: Partial<SaxToneControls>;
  private readonly prefetchVariants: boolean;
  private readonly maxNoteSeconds: number;
  private engineMode: SaxSynthMode;
  private voiceSerial = 0;
  private disposed = false;

  /**
   * The constructor keeps the SaxTone 2.0 graph unless told otherwise, so existing callers do not
   * change; `createSaxSynthEngine()` (used by the app) opts into the 3.0 model.
   */
  constructor(context: SaxSynthAudioContext, options: SaxSynthEngineOptions = {}) {
    this.context = context;
    this.engineMode = options.mode ?? "classic";
    this.defaultControls = options.controls ?? {};
    this.prefetchVariants = options.prefetch !== false;
    this.maxNoteSeconds = clamp(
      Number.isFinite(options.maxNoteSeconds) ? (options.maxNoteSeconds as number) : DEFAULT_MAX_NOTE_SECONDS,
      0.72,
      ABSOLUTE_MAX_NOTE_SECONDS,
    );
    this.input = context.createGain();
    const highPass = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    this.dryGain = context.createGain();
    this.wetGain = context.createGain();
    this.convolver = context.createConvolver();
    this.masterGain = context.createGain();

    highPass.type = "highpass";
    highPass.frequency.value = 58;
    highPass.Q.value = 0.55;
    compressor.threshold.value = -15;
    compressor.knee.value = 14;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;
    this.dryGain.gain.value = 0.93;
    this.wetGain.gain.value = 0.075;
    this.masterGain.gain.value = 0.2;
    this.convolver.buffer = createRoomImpulse(context);
    this.convolver.normalize = true;

    this.input.connect(highPass).connect(compressor);
    compressor.connect(this.dryGain).connect(this.masterGain);
    compressor.connect(this.convolver).connect(this.wetGain).connect(this.masterGain);
    this.masterGain.connect(context.destination);

    this.saturationCurve = createSaturationCurve();
    this.noiseBuffer = createNoiseBuffer(context, 2.1, 0x5a4c);
  }

  get activeVoiceCount(): number {
    return this.voices.length;
  }

  get mode(): SaxSynthMode {
    return this.engineMode;
  }

  setMode(mode: SaxSynthMode): void {
    this.engineMode = mode === "classic" ? "classic" : "model";
  }

  async ensureRunning(): Promise<boolean> {
    if (this.disposed || this.context.state === "closed") return false;
    if (this.context.state !== "running") {
      try {
        await this.context.resume();
      } catch {
        return false;
      }
    }
    return this.context.state === "running";
  }

  setVolume(volume: number): void {
    if (this.disposed) return;
    const normalized = clamp(Number.isFinite(volume) ? volume : 0.18, 0, 1);
    const perceptual = normalized === 0 ? 0 : normalized ** 0.78;
    this.masterGain.gain.setTargetAtTime(perceptual * 0.82, this.context.currentTime, 0.018);
  }

  /**
   * Renders and caches the note that `play` would use next, without making any sound.  Call it a
   * moment before `play` (for example while the fingering animation runs) so that the tap itself
   * does not pay for the rendering.  The work is done in slices of a few milliseconds with a
   * hand-back to the browser in between, so animations and touch input stay smooth; if `play` needs
   * the note before it is finished, `play` completes the remaining slices itself.  Resolves
   * immediately in classic mode and never rejects.
   */
  async prepare(options: SaxSynthPlayOptions): Promise<void> {
    if (this.disposed || (options.mode ?? this.engineMode) !== "model") return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (this.disposed || this.context.state === "closed") return;

    const request = this.describeModelNote(options);
    const variant = this.peekVariant(request);
    const key = this.toneKey(request, variant);
    if (this.toneCache.has(key)) return;
    // Several callers may ask for the same note (the tap, the animation, the prefetch): share the work.
    const running = this.preparations.get(key);
    if (running) return running;
    const task = this.runPreparation(key, request, variant);
    this.preparations.set(key, task);
    try {
      await task;
    } finally {
      if (this.preparations.get(key) === task) this.preparations.delete(key);
    }
  }

  private async runPreparation(key: string, request: ModelNoteRequest, variant: number): Promise<void> {
    const job = this.startJob(key, request, variant);
    if (!job) return;
    while (this.jobs.get(key) === job) {
      let step: IteratorResult<number, SaxToneRender>;
      try {
        step = job.generator.next();
      } catch {
        this.jobs.delete(key);
        return;
      }
      if (step.done) {
        this.jobs.delete(key);
        if (!this.disposed) this.storeTone(key, step.value);
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (this.disposed) return;
    }
  }

  /**
   * Starts a note.  Returns the engine that actually sounded: `"model"` (SaxTone 3.0), `"classic"`
   * (SaxTone 2.0, also the fallback when a model note could not be rendered) or `null` when the
   * engine is disposed or its context is closed.  Callers that must not fall back (MP3 export)
   * check the result.
   */
  play(options: SaxSynthPlayOptions): SaxSynthMode | null {
    if (this.disposed || this.context.state === "closed") return null;

    while (this.voices.length >= MAX_ACTIVE_VOICES) {
      this.voices.shift()?.release(0.055);
    }

    if ((options.mode ?? this.engineMode) === "model" && this.playModel(options)) return "model";
    this.playClassic(options);
    return "classic";
  }

  private describeModelNote(options: SaxSynthPlayOptions): ModelNoteRequest {
    const controls = { ...this.defaultControls, ...options.controls };
    return {
      instrument: options.instrument,
      midi: clamp(options.midi, 24, 108),
      duration: clamp(options.duration ?? DEFAULT_NOTE_DURATION, 0.72, this.maxNoteSeconds),
      intensity: clamp(options.intensity ?? 0.72, 0.35, 1),
      controls,
      controlsKey: JSON.stringify(Object.entries(controls).sort(([a], [b]) => (a < b ? -1 : 1))),
    };
  }

  private noteKey(request: ModelNoteRequest): string {
    return `${request.instrument}|${request.midi}|${request.duration.toFixed(3)}|${request.intensity.toFixed(2)}|${this.context.sampleRate}|${request.controlsKey}`;
  }

  private toneKey(request: ModelNoteRequest, variant: number): string {
    return `${this.noteKey(request)}|${variant}`;
  }

  private peekVariant(request: ModelNoteRequest): number {
    return (this.playCounts.get(this.noteKey(request)) ?? 0) % MODEL_VARIANTS;
  }

  /** Creates the sliced render job for a note, or null when the renderer cannot even be started. */
  private startJob(key: string, request: ModelNoteRequest, variant: number): ModelRenderJob | null {
    try {
      const job: ModelRenderJob = {
        generator: renderSaxToneProgressive(
          {
            midi: request.midi,
            instrument: request.instrument,
            duration: request.duration,
            intensity: request.intensity,
            sampleRate: this.context.sampleRate,
            seed: variant,
            controls: request.controls,
          },
          RENDER_BLOCKS_PER_SLICE,
        ),
      };
      this.jobs.set(key, job);
      while (this.jobs.size > MAX_RENDER_JOBS) {
        const oldest = this.jobs.keys().next().value;
        if (oldest === undefined) break;
        this.jobs.delete(oldest);
      }
      return job;
    } catch {
      return null;
    }
  }

  /** Validates a finished render and keeps it as an AudioBuffer (least recently used eviction). */
  private storeTone(key: string, rendered: SaxToneRender): AudioBuffer | null {
    try {
      const samples = rendered.samples;
      for (let index = 0; index < samples.length; index += 1) {
        if (!Number.isFinite(samples[index])) return null;
      }
      const buffer = this.context.createBuffer(1, samples.length, rendered.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.toneCache.set(key, buffer);
      while (this.toneCache.size > MAX_CACHED_TONES) {
        const oldest = this.toneCache.keys().next().value;
        if (oldest === undefined) break;
        this.toneCache.delete(oldest);
      }
      return buffer;
    } catch {
      return null;
    }
  }

  /** Returns a note's buffer, finishing a half-done `prepare` job or rendering from scratch. */
  private getToneBuffer(request: ModelNoteRequest, variant: number): AudioBuffer | null {
    const key = this.toneKey(request, variant);
    const cached = this.toneCache.get(key);
    if (cached) {
      this.toneCache.delete(key);
      this.toneCache.set(key, cached);
      return cached;
    }
    const job = this.jobs.get(key) ?? this.startJob(key, request, variant);
    if (!job) return null;
    try {
      let step = job.generator.next();
      while (!step.done) step = job.generator.next();
      this.jobs.delete(key);
      return this.storeTone(key, step.value);
    } catch {
      this.jobs.delete(key);
      return null;
    }
  }

  /** Plays a rendered SaxTone 3.0 note.  Returns false when it could not be prepared. */
  private playModel(options: SaxSynthPlayOptions): boolean {
    const request = this.describeModelNote(options);
    const countKey = this.noteKey(request);
    const variant = this.peekVariant(request);
    const buffer = this.getToneBuffer(request, variant);
    if (!buffer) return false;
    this.playCounts.set(countKey, (this.playCounts.get(countKey) ?? 0) + 1);

    const voiceSerial = (this.voiceSerial += 1);
    const now = Number.isFinite(options.startAt)
      ? Math.max(this.context.currentTime, options.startAt as number)
      : this.context.currentTime + 0.006;
    const source = this.context.createBufferSource();
    const voiceGain = this.context.createGain();
    source.buffer = buffer;
    // +-0.08 % playback rate (about +-1.4 cents) and +-0.25 dB so that repeated taps are never identical.
    source.playbackRate.value = 1 + (((voiceSerial * 3 + request.midi) % 5) - 2) * 0.0004;
    voiceGain.gain.value = MODEL_OUTPUT_GAIN * (1 + (((voiceSerial * 7) % 5) - 2) * 0.014);
    source.connect(voiceGain).connect(this.input);

    let released = false;
    const voice: ActiveSaxVoice = {
      output: voiceGain,
      sources: [source],
      release: (releaseSeconds = 0.09) => {
        if (released) return;
        released = true;
        const releaseNow = this.context.currentTime;
        const safeRelease = clamp(releaseSeconds, 0.035, 0.2);
        voiceGain.gain.cancelScheduledValues(releaseNow);
        voiceGain.gain.setValueAtTime(Math.max(MIN_GAIN, voiceGain.gain.value), releaseNow);
        voiceGain.gain.exponentialRampToValueAtTime(MIN_GAIN, releaseNow + safeRelease);
        safeStop(source, releaseNow + safeRelease + 0.025);
        const index = this.voices.indexOf(voice);
        if (index >= 0) this.voices.splice(index, 1);
      },
    };
    this.voices.push(voice);

    source.onended = () => {
      const index = this.voices.indexOf(voice);
      if (index >= 0) this.voices.splice(index, 1);
      voiceGain.disconnect();
    };
    source.start(now);
    // Get the alternate rendering of this note ready while it sounds, so a repeated tap never waits.
    if (this.prefetchVariants) void this.prepare(options);
    return true;
  }

  private playClassic(options: SaxSynthPlayOptions): void {
    const profile = SAX_VOICE_PROFILES[options.instrument];
    const midi = clamp(options.midi, 24, 108);
    const voiceSerial = this.voiceSerial += 1;
    const intensity = clamp(options.intensity ?? 0.72, 0.35, 1);
    const envelope = getSaxEnvelope(midi, options.duration);
    const frequency = midiToFrequency(midi);
    const now = this.context.currentTime + 0.006;
    const finishAt = now + envelope.total;
    const sources: AudioScheduledSourceNode[] = [];

    const carrier = this.context.createOscillator();
    const real = new Float32Array(MAX_HARMONICS + 1);
    const imaginary = buildSaxHarmonics(midi, options.instrument, this.context.sampleRate);
    carrier.setPeriodicWave(this.context.createPeriodicWave(real, imaginary, { disableNormalization: false }));
    carrier.frequency.setValueAtTime(frequency, now);
    const attackPitch = -8 - clamp((midi - 55) * 0.18, 0, 8);
    carrier.detune.setValueAtTime(attackPitch, now);
    carrier.detune.linearRampToValueAtTime(1.6, now + envelope.attack * 0.9);
    carrier.detune.linearRampToValueAtTime(0, now + envelope.attack + 0.055);
    sources.push(carrier);

    const toneGain = this.context.createGain();
    const reedSaturation = this.context.createWaveShaper();
    const toneHighPass = this.context.createBiquadFilter();
    const toneLowPass = this.context.createBiquadFilter();
    const voiceBus = this.context.createGain();
    const voiceEnvelope = this.context.createGain();
    reedSaturation.curve = this.saturationCurve;
    reedSaturation.oversample = "4x";
    toneGain.gain.value = 0.66 + intensity * 0.2;
    toneHighPass.type = "highpass";
    toneHighPass.frequency.value = Math.max(70, frequency * 0.48);
    toneHighPass.Q.value = 0.42;
    toneLowPass.type = "lowpass";
    toneLowPass.Q.value = 0.72;
    const targetBrightness = Math.min(profile.brightness * (0.82 + intensity * 0.24), this.context.sampleRate * 0.4);
    toneLowPass.frequency.setValueAtTime(Math.max(900, targetBrightness * 0.42), now);
    toneLowPass.frequency.exponentialRampToValueAtTime(targetBrightness, now + envelope.attack * 1.15);
    toneLowPass.frequency.setTargetAtTime(targetBrightness * 0.88, now + envelope.decay, 0.2);

    carrier.connect(toneGain).connect(reedSaturation).connect(toneHighPass);
    let toneTail: AudioNode = toneHighPass;
    for (const formant of profile.formants) {
      const filter = this.context.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = Math.min(formant.frequency, this.context.sampleRate * 0.42);
      filter.Q.value = formant.q;
      filter.gain.value = formant.gain * (0.72 + intensity * 0.28);
      toneTail.connect(filter);
      toneTail = filter;
    }
    toneTail.connect(toneLowPass).connect(voiceBus);

    const breath = this.context.createBufferSource();
    const breathHighPass = this.context.createBiquadFilter();
    const breathBand = this.context.createBiquadFilter();
    const breathGain = this.context.createGain();
    breath.buffer = this.noiseBuffer;
    breath.loop = true;
    breathHighPass.type = "highpass";
    breathHighPass.frequency.value = Math.max(520, frequency * 1.3);
    breathHighPass.Q.value = 0.65;
    breathBand.type = "bandpass";
    breathBand.frequency.value = Math.min(profile.formants[1].frequency * 1.35, this.context.sampleRate * 0.38);
    breathBand.Q.value = 0.72;
    breathGain.gain.setValueAtTime(MIN_GAIN, now);
    breathGain.gain.exponentialRampToValueAtTime(profile.breathLevel * (0.7 + intensity * 0.3), now + envelope.attack * 0.7);
    breathGain.gain.setTargetAtTime(profile.breathLevel * 0.72, now + envelope.decay, 0.14);
    breathGain.gain.setValueAtTime(profile.breathLevel * 0.72, now + envelope.sustainUntil);
    breathGain.gain.exponentialRampToValueAtTime(MIN_GAIN, finishAt);
    breath.connect(breathHighPass).connect(breathBand).connect(breathGain).connect(voiceBus);
    sources.push(breath);

    const keyClick = this.context.createBufferSource();
    const clickBand = this.context.createBiquadFilter();
    const clickGain = this.context.createGain();
    keyClick.buffer = this.noiseBuffer;
    clickBand.type = "bandpass";
    clickBand.frequency.value = options.instrument === "tenor" ? 1_050 : options.instrument === "alto" ? 1_420 : 1_850;
    clickBand.Q.value = 1.8;
    clickGain.gain.setValueAtTime(0.045 * intensity, now);
    clickGain.gain.exponentialRampToValueAtTime(MIN_GAIN, now + 0.026);
    keyClick.connect(clickBand).connect(clickGain).connect(voiceBus);
    sources.push(keyClick);

    const vibrato = this.context.createOscillator();
    const vibratoDepth = this.context.createGain();
    vibrato.type = "sine";
    vibrato.frequency.value = profile.vibratoRate + (((midi + voiceSerial) % 5) - 2) * 0.035;
    vibratoDepth.gain.setValueAtTime(0, now);
    vibratoDepth.gain.setValueAtTime(0, now + Math.min(0.38, envelope.sustainUntil * 0.42));
    vibratoDepth.gain.linearRampToValueAtTime(profile.vibratoDepth * intensity, now + Math.min(0.7, envelope.sustainUntil * 0.68));
    vibrato.connect(vibratoDepth).connect(carrier.detune);
    sources.push(vibrato);

    const drift = this.context.createOscillator();
    const driftDepth = this.context.createGain();
    drift.type = "sine";
    drift.frequency.value = 0.63 + ((midi + voiceSerial) % 4) * 0.035;
    driftDepth.gain.value = 1.35 + intensity * 0.6;
    drift.connect(driftDepth).connect(carrier.detune);
    sources.push(drift);

    const sustainLevel = 0.47 + intensity * 0.13;
    voiceEnvelope.gain.setValueAtTime(MIN_GAIN, now);
    voiceEnvelope.gain.exponentialRampToValueAtTime(sustainLevel * 1.08, now + envelope.attack);
    voiceEnvelope.gain.setTargetAtTime(sustainLevel, now + envelope.attack, Math.max(0.035, envelope.decay - envelope.attack));
    voiceEnvelope.gain.setValueAtTime(sustainLevel, now + envelope.sustainUntil);
    voiceEnvelope.gain.exponentialRampToValueAtTime(MIN_GAIN, finishAt);
    voiceBus.connect(voiceEnvelope).connect(this.input);

    let released = false;
    const voice: ActiveSaxVoice = {
      output: voiceEnvelope,
      sources,
      release: (releaseSeconds = 0.09) => {
        if (released) return;
        released = true;
        const releaseNow = this.context.currentTime;
        const safeRelease = clamp(releaseSeconds, 0.035, 0.2);
        voiceEnvelope.gain.cancelScheduledValues(releaseNow);
        voiceEnvelope.gain.setValueAtTime(Math.max(MIN_GAIN, voiceEnvelope.gain.value), releaseNow);
        voiceEnvelope.gain.exponentialRampToValueAtTime(MIN_GAIN, releaseNow + safeRelease);
        for (const source of sources) safeStop(source, releaseNow + safeRelease + 0.025);
        const index = this.voices.indexOf(voice);
        if (index >= 0) this.voices.splice(index, 1);
      },
    };
    this.voices.push(voice);

    carrier.onended = () => {
      const index = this.voices.indexOf(voice);
      if (index >= 0) this.voices.splice(index, 1);
      voiceEnvelope.disconnect();
    };

    carrier.start(now);
    breath.start(now, ((midi * 7 + voiceSerial * 13) % 23) * 0.071);
    keyClick.start(now, ((midi * 5 + voiceSerial * 11) % 29) * 0.043);
    vibrato.start(now);
    drift.start(now);
    for (const source of sources) safeStop(source, finishAt + 0.035);
  }

  stopAll(): void {
    for (const voice of [...this.voices]) voice.release(0.065);
    this.voices.length = 0;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
    this.toneCache.clear();
    this.playCounts.clear();
    this.jobs.clear();
    this.preparations.clear();
    this.input.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    this.convolver.disconnect();
    this.masterGain.disconnect();
    // An OfflineAudioContext has no close(); it is released with the engine.
    if (this.context.state !== "closed" && "close" in this.context) {
      try {
        await this.context.close();
      } catch {
        // Closing is best-effort during React teardown and mobile page eviction.
      }
    }
  }
}

export function createSaxSynthEngine(options: SaxSynthEngineOptions = {}): SaxSynthEngine | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const AudioConstructor = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
  if (!AudioConstructor) return null;
  const engineOptions: SaxSynthEngineOptions = { ...options, mode: options.mode ?? "model" };

  try {
    return new SaxSynthEngine(new AudioConstructor({ latencyHint: "interactive" }), engineOptions);
  } catch {
    try {
      return new SaxSynthEngine(new AudioConstructor(), engineOptions);
    } catch {
      return null;
    }
  }
}
