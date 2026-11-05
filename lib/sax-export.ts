/**
 * MP3 export of SaxTone 3.0 notes.
 *
 * A note is rendered through exactly the same engine and master chain (high-pass, compressor, room,
 * master gain) that the app plays through, but into an `OfflineAudioContext`; the result is trimmed,
 * faded, kept below -1 dBFS and encoded to a 256 kbit/s stereo MP3 (see `mp3-encode.ts`).
 *
 * Loudness policy: every export uses the same fixed master volume, so the notes keep the relative
 * loudness that the model was calibrated for (an A-weighted level that is equal across the register).
 * Nothing is normalised per file; a peak that would exceed the ceiling is scaled down, never up.
 *
 * Keep this file free of TypeScript-only runtime syntax (enums, parameter properties) so that the
 * Node test runner can import it directly with type stripping.
 */

import { MP3_DEFAULT_KBPS, encodeMp3, inspectMp3, isAbortError, type Id3Tag } from "./mp3-encode.ts";
import { SAX_SYNTH_VERSION, SaxSynthEngine, type SaxSynthAudioContext, type SaxSynthInstrument } from "./sax-synth.ts";

export const EXPORT_SAMPLE_RATE = 44_100;
/** Note lengths offered in the app (seconds of tone; the file adds the room tail). */
export const EXPORT_LENGTHS_SECONDS = [1.5, 3, 6] as const;
export const EXPORT_DEFAULT_SECONDS = 3;
const EXPORT_MIN_SECONDS = 0.72;
const EXPORT_MAX_SECONDS = 8;
/** Room tail kept after the note: the room impulse is 0.48 s long and has decayed by more than 70 dB by then. */
export const EXPORT_TAIL_SECONDS = 0.5;
/**
 * Master volume of every export (the app's volume setting does not apply).  Measured over all 99 notes
 * of the three instruments (docs/audio-engine.md): at 0.88 the loudest note of the strongest dynamic
 * peaks at about -1.5 dBFS, a medium note at -2.5 dBFS or lower.
 */
export const EXPORT_VOLUME = 0.88;
/** Highest sample value of an export (-1 dBFS): lossy encoding can overshoot the PCM peak by a little. */
export const EXPORT_PEAK_CEILING = 10 ** (-1 / 20);

/** The master volume is smoothed with a 18 ms time constant; 0.3 s is 16 time constants. */
const LEAD_IN_SECONDS = 0.3;
/** Rendered beyond the kept tail so that the cut never touches the room decay. */
const RENDER_MARGIN_SECONDS = 0.1;
const FADE_IN_SECONDS = 0.002;
const FADE_OUT_SECONDS = 0.04;
/** An export whose highest sample is below this (about -80 dBFS) counts as silent. */
const SILENCE_PEAK = 1e-4;

export type SaxExportDynamic = "soft" | "medium" | "strong";

/** Playing dynamic -> model intensity (0.72 is the reference the model was calibrated at). */
export const SAX_EXPORT_INTENSITY: Readonly<Record<SaxExportDynamic, number>> = {
  soft: 0.5,
  medium: 0.72,
  strong: 0.95,
};

// Words, not p / mf / f: in SaxTone 3.0 the setting changes the brightness and effort of the tone while the
// loudness stays nearly constant (measured, see docs/audio-engine.md), so musical dynamic marks would over-promise.
const DYNAMIC_FILE_TOKEN: Readonly<Record<SaxExportDynamic, string>> = { soft: "soft", medium: "mid", strong: "strong" };

export interface SaxExportRequest {
  /** Sounding MIDI pitch of the audio. */
  readonly midi: number;
  readonly instrument: SaxSynthInstrument;
  /** Length of the note itself in seconds. */
  readonly seconds: number;
  readonly dynamic: SaxExportDynamic;
  readonly vibrato: boolean;
}

export interface SaxExportLabels {
  /** For example "알토 색소폰". */
  readonly instrumentKo: string;
  /** Written (fingered) note as shown in the app, for example "B♭4". */
  readonly fingeringDisplay: string;
  /** The same note in ASCII ("Bb4", "C#5"); used in the file name. */
  readonly fingeringAscii: string;
  /** Pitch of the audio, for example "D♭4". */
  readonly pitchDisplay: string;
  readonly pitchAscii: string;
}

export type SaxExportErrorCode = "unsupported" | "render-failed" | "silent" | "invalid-mp3";

export class SaxExportError extends Error {
  readonly code: SaxExportErrorCode;

  constructor(code: SaxExportErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "SaxExportError";
    this.code = code;
  }
}

export interface SaxExportHooks {
  readonly signal?: AbortSignal;
  /** `render` while the note is rendered (no fraction), `encode` with the finished fraction. */
  readonly onStage?: (stage: "render" | "encode", fraction: number | null) => void;
  /** Replaces `new OfflineAudioContext(2, length, sampleRate)`; for tests. */
  readonly createContext?: (length: number, sampleRate: number) => OfflineRenderContext;
}

/** The part of `OfflineAudioContext` that the export uses. */
export type OfflineRenderContext = SaxSynthAudioContext & { startRendering(): Promise<AudioBuffer> };

export interface SaxExportPcm {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
  /** Highest absolute sample after the safety scale. */
  readonly peak: number;
  /** 1 unless the render exceeded the ceiling and had to be scaled down. */
  readonly safetyScale: number;
}

export interface SaxMp3Export {
  readonly blob: Blob;
  readonly fileName: string;
  readonly bytes: number;
  /** Playing time of the file, decoder delay excluded. */
  readonly seconds: number;
  readonly kbps: number;
  readonly sampleRate: number;
  readonly peakDb: number;
}

function clampNumber(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function normalizeSaxExportRequest(request: SaxExportRequest): SaxExportRequest {
  const seconds = Number.isFinite(request.seconds) ? request.seconds : EXPORT_DEFAULT_SECONDS;
  return {
    midi: Math.round(clampNumber(request.midi, 24, 108)),
    instrument: request.instrument,
    seconds: clampNumber(seconds, EXPORT_MIN_SECONDS, EXPORT_MAX_SECONDS),
    dynamic: request.dynamic in SAX_EXPORT_INTENSITY ? request.dynamic : "medium",
    vibrato: request.vibrato !== false,
  };
}

/** Length and approximate size of the file an export will produce, for the app to show before encoding. */
export function describeSaxExport(request: SaxExportRequest): { seconds: number; approxBytes: number } {
  const normalized = normalizeSaxExportRequest(request);
  const seconds = normalized.seconds + EXPORT_TAIL_SECONDS;
  return { seconds, approxBytes: Math.round(seconds * MP3_DEFAULT_KBPS * 125) };
}

// ---------------------------------------------------------------------------------------------
// File name and tag

/** "Bb4" -> "Bflat4", "C#5" -> "Csharp5": no characters that are awkward in file names or URLs. */
export function exportPitchToken(ascii: string): string {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(ascii.trim());
  if (!match) return ascii.replace(/[^A-Za-z0-9]+/g, "") || "note";
  const accidental = match[2] === "#" ? "sharp" : match[2] === "b" ? "flat" : "";
  return `${match[1].toUpperCase()}${accidental}${match[3]}`;
}

function secondsToken(seconds: number): string {
  return `${Number(seconds.toFixed(1))}`.replace(".", "p") + "s";
}

export function buildSaxExportFileName(request: SaxExportRequest, labels: SaxExportLabels): string {
  const normalized = normalizeSaxExportRequest(request);
  return [
    "saxtone3",
    normalized.instrument,
    `fingering-${exportPitchToken(labels.fingeringAscii)}`,
    `pitch-${exportPitchToken(labels.pitchAscii)}`,
    secondsToken(normalized.seconds),
    DYNAMIC_FILE_TOKEN[normalized.dynamic],
    normalized.vibrato ? "vib" : "novib",
  ].join("_") + ".mp3";
}

const DYNAMIC_LABEL_KO: Readonly<Record<SaxExportDynamic, string>> = { soft: "약하게", medium: "보통", strong: "세게" };

export function buildSaxExportTag(request: SaxExportRequest, labels: SaxExportLabels, year: number): Id3Tag {
  const normalized = normalizeSaxExportRequest(request);
  return {
    title: `${labels.instrumentKo} ${labels.pitchDisplay} (${labels.fingeringDisplay} 운지)`,
    artist: `SaxHands · ${SAX_SYNTH_VERSION}`,
    album: "SaxHands 색소폰 운지 학습",
    year: String(year),
    software: `SaxHands ${SAX_SYNTH_VERSION} + LAME (lamejs), ${MP3_DEFAULT_KBPS} kbps CBR`,
    comment:
      `컴퓨터로 만든 ${SAX_SYNTH_VERSION} 색소폰 합성음입니다. 실제 연주 녹음이 아닙니다. ` +
      `음 길이 ${Number(normalized.seconds.toFixed(1))}초 · 세기 ${DYNAMIC_LABEL_KO[normalized.dynamic]} · 비브라토 ${normalized.vibrato ? "있음" : "없음"}.`,
  };
}

// ---------------------------------------------------------------------------------------------
// PCM post-processing

export interface FinalizeSpec {
  /** Start of the kept region in the rendered buffer (seconds). */
  readonly startSeconds: number;
  /** Length of the kept region (seconds). */
  readonly lengthSeconds: number;
  readonly fadeInSeconds?: number;
  readonly fadeOutSeconds?: number;
  readonly peakCeiling?: number;
}

function raisedCosine(position: number): number {
  return 0.5 * (1 - Math.cos(Math.PI * clampNumber(position, 0, 1)));
}

/**
 * Cuts the kept region out of a rendered stereo buffer, fades its edges and scales it down when its
 * highest sample would exceed the ceiling.  Throws `SaxExportError` when the region is empty,
 * contains non-finite samples or is silent.
 */
export function finalizeExportPcm(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  spec: FinalizeSpec,
): SaxExportPcm {
  const start = Math.max(0, Math.round(spec.startSeconds * sampleRate));
  const end = Math.min(left.length, right.length, start + Math.round(spec.lengthSeconds * sampleRate));
  const count = end - start;
  if (count < sampleRate * 0.1) throw new SaxExportError("render-failed", "The rendered audio is too short.");

  const outLeft = left.slice(start, end);
  const outRight = right.slice(start, end);
  let peak = 0;
  for (let index = 0; index < count; index += 1) {
    const a = outLeft[index];
    const b = outRight[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new SaxExportError("render-failed", "The rendered audio contains invalid samples.");
    const magnitude = Math.max(Math.abs(a), Math.abs(b));
    if (magnitude > peak) peak = magnitude;
  }
  if (peak < SILENCE_PEAK) throw new SaxExportError("silent", "The rendered audio is silent.");

  const ceiling = spec.peakCeiling ?? EXPORT_PEAK_CEILING;
  const safetyScale = peak > ceiling ? ceiling / peak : 1;
  const fadeIn = Math.min(Math.round((spec.fadeInSeconds ?? FADE_IN_SECONDS) * sampleRate), count >> 1);
  const fadeOut = Math.min(Math.round((spec.fadeOutSeconds ?? FADE_OUT_SECONDS) * sampleRate), count >> 1);
  for (let index = 0; index < count; index += 1) {
    let gain = safetyScale;
    if (index < fadeIn) gain *= raisedCosine(index / fadeIn);
    const fromEnd = count - 1 - index;
    if (fromEnd < fadeOut) gain *= raisedCosine(fromEnd / fadeOut);
    outLeft[index] *= gain;
    outRight[index] *= gain;
  }
  return { left: outLeft, right: outRight, sampleRate, peak: peak * safetyScale, safetyScale };
}

// ---------------------------------------------------------------------------------------------
// Rendering

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("The MP3 export was cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

function createOfflineContext(length: number, sampleRate: number): OfflineRenderContext {
  const Constructor = typeof OfflineAudioContext !== "undefined" ? OfflineAudioContext : undefined;
  if (!Constructor) throw new SaxExportError("unsupported", "OfflineAudioContext is not available in this browser.");
  try {
    return new Constructor(2, length, sampleRate);
  } catch (error) {
    throw new SaxExportError("unsupported", "The browser could not create an offline audio context.", error);
  }
}

/** Renders the note through the engine's master chain and returns the finished stereo PCM. */
export async function renderSaxExportPcm(request: SaxExportRequest, hooks: SaxExportHooks = {}): Promise<SaxExportPcm> {
  const note = normalizeSaxExportRequest(request);
  throwIfAborted(hooks.signal);
  hooks.onStage?.("render", null);

  const sampleRate = EXPORT_SAMPLE_RATE;
  const keptSeconds = note.seconds + EXPORT_TAIL_SECONDS;
  const length = Math.ceil((LEAD_IN_SECONDS + keptSeconds + RENDER_MARGIN_SECONDS) * sampleRate);
  let engine: SaxSynthEngine | null = null;
  try {
    const context = (hooks.createContext ?? createOfflineContext)(length, sampleRate);
    engine = new SaxSynthEngine(context, {
      mode: "model",
      prefetch: false,
      maxNoteSeconds: EXPORT_MAX_SECONDS,
    });
    engine.setVolume(EXPORT_VOLUME);
    const playOptions = {
      midi: note.midi,
      instrument: note.instrument,
      duration: note.seconds,
      intensity: SAX_EXPORT_INTENSITY[note.dynamic],
      mode: "model" as const,
      controls: note.vibrato ? undefined : { vibratoDepth: 0 },
    };
    // Render the note in small slices first (keeps the page responsive); `play` then finds it in the cache.
    await engine.prepare(playOptions);
    throwIfAborted(hooks.signal);
    const sounded = engine.play({ ...playOptions, startAt: LEAD_IN_SECONDS });
    if (sounded !== "model") throw new SaxExportError("render-failed", "The SaxTone 3.0 note could not be rendered.");
    const rendered = await context.startRendering();
    throwIfAborted(hooks.signal);
    return finalizeExportPcm(rendered.getChannelData(0), rendered.getChannelData(Math.min(1, rendered.numberOfChannels - 1)), rendered.sampleRate, {
      startSeconds: LEAD_IN_SECONDS,
      lengthSeconds: keptSeconds,
    });
  } catch (error) {
    if (error instanceof SaxExportError || isAbortError(error)) throw error;
    throw new SaxExportError("render-failed", "The SaxTone 3.0 note could not be rendered.", error);
  } finally {
    if (engine) void engine.dispose();
  }
}

/** Renders, encodes and checks one MP3. Rejects with an `AbortError` when `hooks.signal` is aborted. */
export async function createSaxMp3(
  request: SaxExportRequest,
  labels: SaxExportLabels,
  hooks: SaxExportHooks = {},
): Promise<SaxMp3Export> {
  const note = normalizeSaxExportRequest(request);
  const pcm = await renderSaxExportPcm(note, hooks);
  hooks.onStage?.("encode", 0);
  const blob = await encodeMp3(pcm.left, pcm.right, {
    sampleRate: pcm.sampleRate,
    kbps: MP3_DEFAULT_KBPS,
    tag: buildSaxExportTag(note, labels, new Date().getFullYear()),
    signal: hooks.signal,
    onProgress: (fraction) => hooks.onStage?.("encode", fraction),
  });
  const info = inspectMp3(new Uint8Array(await blob.arrayBuffer()));
  if (!info || info.sampleRate !== pcm.sampleRate || info.channels !== 2 || info.kbps !== MP3_DEFAULT_KBPS) {
    throw new SaxExportError("invalid-mp3", "The encoder produced an unexpected MP3 stream.");
  }
  return {
    blob,
    fileName: buildSaxExportFileName(note, labels),
    bytes: blob.size,
    seconds: pcm.left.length / pcm.sampleRate,
    kbps: info.kbps,
    sampleRate: info.sampleRate,
    peakDb: 20 * Math.log10(pcm.peak),
  };
}
