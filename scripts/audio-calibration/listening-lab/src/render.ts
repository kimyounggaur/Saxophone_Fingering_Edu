// Renders a phrase with the real SaxHands engine (lib/sax-synth.ts) into an AudioBuffer, offline, so that
// both engines go through exactly the same master chain (high-pass, compressor, room) as in the app.

import {
  SaxSynthEngine,
  type SaxSynthInstrument,
  type SaxSynthMode,
  type SaxToneControls,
} from "../../../../lib/sax-synth.ts";
import type { Phrase } from "./phrases.ts";

export const RENDER_SAMPLE_RATE = 48_000;
const LEAD_SECONDS = 0.3; // lets the engine's master-volume smoothing settle before the first note
const TAIL_SECONDS = 1.0; // room and release tail kept after the last note
const QUANTUM = 128;
const ENGINE_VOLUME = 0.6;

export interface RenderOptions {
  readonly mode: SaxSynthMode;
  readonly instrument: SaxSynthInstrument;
  readonly phrase: Phrase;
  readonly intensity: number;
  readonly controls: Partial<SaxToneControls>;
}

export interface RenderedClip {
  readonly mode: SaxSynthMode;
  /** Stereo, starts at the first note. */
  readonly buffer: AudioBuffer;
  readonly mono: Float32Array;
  readonly sampleRate: number;
  readonly durationSeconds: number;
  readonly renderMs: number;
  readonly peak: number;
}

function quantize(seconds: number): number {
  return (Math.ceil((seconds * RENDER_SAMPLE_RATE) / QUANTUM) * QUANTUM) / RENDER_SAMPLE_RATE;
}

export async function renderClip(options: RenderOptions): Promise<RenderedClip> {
  const started = performance.now();
  const sampleRate = RENDER_SAMPLE_RATE;
  const total = LEAD_SECONDS + options.phrase.length + TAIL_SECONDS;
  const length = Math.ceil((total * sampleRate) / QUANTUM) * QUANTUM;
  const context = new OfflineAudioContext(2, length, sampleRate);
  const engine = new SaxSynthEngine(context as unknown as AudioContext, {
    mode: options.mode,
    controls: options.mode === "model" ? options.controls : undefined,
  });
  // The app prepares the next variant of a note while it sounds.  An offline pass plays every note once,
  // so that look-ahead would only burn CPU.
  engine.prepare = async () => undefined;
  engine.setVolume(ENGINE_VOLUME);

  const scheduled = options.phrase.notes.map((note, index) =>
    context.suspend(quantize(LEAD_SECONDS + note.t)).then(() => {
      if (index > 0) engine.stopAll(); // one monophonic line: the previous note ends as the next begins
      engine.play({
        midi: note.midi,
        instrument: options.instrument,
        duration: Math.max(0.72, note.len + 0.12),
        intensity: options.intensity,
        mode: options.mode,
      });
      return context.resume();
    }),
  );
  const rendered = await context.startRendering();
  await Promise.all(scheduled);

  // Both engines start a note 6 ms after it is requested; keep 4 ms of lead-in before the first attack.
  const skip = Math.round((quantize(LEAD_SECONDS) + 0.006) * sampleRate) - Math.round(0.004 * sampleRate);
  const frames = rendered.length - skip;
  const buffer = new AudioBuffer({ length: frames, numberOfChannels: 2, sampleRate });
  const mono = new Float32Array(frames);
  let peak = 0;
  for (let channel = 0; channel < 2; channel += 1) {
    const source = rendered.getChannelData(channel);
    const target = buffer.getChannelData(channel);
    for (let index = 0; index < frames; index += 1) {
      const value = source[index + skip];
      if (!Number.isFinite(value)) throw new Error("render produced a non-finite sample");
      target[index] = value;
      mono[index] += value * 0.5;
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return {
    mode: options.mode,
    buffer,
    mono,
    sampleRate,
    durationSeconds: frames / sampleRate,
    renderMs: performance.now() - started,
    peak,
  };
}

/** True when two clips are sample-identical, which means the 3.0 renderer fell back to 2.0. */
export function clipsIdentical(a: RenderedClip, b: RenderedClip): boolean {
  if (a.mono.length !== b.mono.length) return false;
  const step = Math.max(1, Math.floor(a.mono.length / 4096));
  for (let index = 0; index < a.mono.length; index += step) {
    if (a.mono[index] !== b.mono[index]) return false;
  }
  return true;
}
