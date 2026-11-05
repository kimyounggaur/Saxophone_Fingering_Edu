/**
 * MP3 encoding for exported SaxTone notes.
 *
 * The encoder is `@breezystack/lamejs`, a JavaScript port of the LAME MP3 encoder (LGPL-3.0).  It is
 * loaded with a dynamic import, so it is shipped as its own file that is fetched only when someone
 * exports a note, and it is never modified or merged into the app code (see docs/audio-engine.md,
 * "MP3 내보내기", for the licence notes).
 *
 * This module also contains the small, dependency-free pieces around the encoder: float to 16-bit
 * conversion, an ID3v2.3 tag writer (UTF-16, so Korean titles work) and an MP3 frame walker that
 * checks what the encoder produced.
 *
 * Keep this file free of TypeScript-only runtime syntax (enums, parameter properties) so that the
 * Node test runner can import it directly with type stripping.
 */

export const MP3_SAMPLE_RATES = [32_000, 44_100, 48_000] as const;
/**
 * Bit rates (kbit/s) that the encoder accepts.  LAME quietly lowers the output sample rate (or switches
 * to MPEG-2) when the rate is low for the input, for example 44.1 kHz stereo at 96 kbit/s comes out at
 * 32 kHz, so only rates at which every supported sample rate and channel count was verified to come out
 * as asked are offered.  `inspectMp3` shows what an encode really produced.
 */
export const MP3_BITRATES = [128, 160, 192, 224, 256, 320] as const;
export const MP3_DEFAULT_KBPS = 256;

/** Samples per MP3 frame (MPEG-1 Layer III). */
export const MP3_FRAME_SAMPLES = 1152;
/**
 * The decoder delay of an MP3 without a LAME/Xing header: every player drops the first 1105 samples
 * (encoder delay 576 plus decoder delay 529), which is about 25 ms of silence at 44.1 kHz.
 */
export const MP3_DECODER_DELAY_SAMPLES = 1105;

/** Samples converted and encoded per call: about 100 ms of audio, a few milliseconds of CPU. */
const ENCODE_CHUNK_SAMPLES = MP3_FRAME_SAMPLES * 4;
/** The encode loop hands control back to the browser after this much CPU time. */
const ENCODE_SLICE_MS = 20;

export interface Id3Tag {
  readonly title?: string;
  readonly artist?: string;
  readonly album?: string;
  /** Four digits. */
  readonly year?: string;
  readonly comment?: string;
  /** Software and settings used for encoding. */
  readonly software?: string;
}

export interface Mp3EncodeOptions {
  readonly sampleRate: number;
  readonly kbps?: number;
  readonly tag?: Id3Tag;
  /** Called with the finished fraction (0..1) while encoding. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

export interface Mp3Info {
  readonly frameCount: number;
  readonly sampleRate: number;
  readonly kbps: number;
  readonly channels: 1 | 2;
  /** Length of the audio the frames carry, delay included. */
  readonly seconds: number;
  readonly audioBytes: number;
  readonly tagBytes: number;
}

type LameModule = typeof import("@breezystack/lamejs");

export class Mp3EncoderUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("The MP3 encoder could not be loaded.", { cause });
    this.name = "Mp3EncoderUnavailableError";
  }
}

let encoderLoad: Promise<LameModule> | null = null;

/** Loads the encoder chunk once; a failed load (for example offline) can be retried. */
export function loadMp3Encoder(): Promise<LameModule> {
  if (!encoderLoad) {
    encoderLoad = import("@breezystack/lamejs").catch((error: unknown) => {
      encoderLoad = null;
      throw new Mp3EncoderUnavailableError(error);
    });
  }
  return encoderLoad;
}

/** Starts fetching the encoder in the background so that the service worker can cache it. Never throws. */
export function preloadMp3Encoder(): void {
  loadMp3Encoder().catch(() => undefined);
}

export interface Mp3WarmEnvironment {
  readonly online: boolean;
  /** The browser's data-saver switch (`navigator.connection.saveData`). */
  readonly saveData?: boolean;
  /** `navigator.connection.effectiveType`, for example "4g" or "slow-2g". */
  readonly effectiveType?: string;
}

/** False when fetching the encoder unasked would be unkind: offline, data saver on, or a 2G link. */
export function shouldWarmMp3Encoder(environment: Mp3WarmEnvironment): boolean {
  if (!environment.online || environment.saveData) return false;
  return !/^(slow-)?2g$/.test(environment.effectiveType ?? "");
}

/**
 * Fetches the encoder quietly before anyone asks for an MP3, so the service worker has it cached the first time
 * the app is used offline. A chunk that failed to load cannot be retried in the same page (the browser remembers
 * the failure), so having it in the cache beforehand is the reliable path. Returns whether a fetch was started.
 */
export function warmMp3Encoder(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!shouldWarmMp3Encoder({ online: navigator.onLine !== false, saveData: connection?.saveData, effectiveType: connection?.effectiveType })) {
    return false;
  }
  preloadMp3Encoder();
  return true;
}

function abortError(): Error {
  const error = new Error("The MP3 export was cancelled.");
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function nextTask(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function clockMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Float samples (-1..1) to 16-bit PCM with rounding, clipping and NaN protection. */
export function floatToInt16(input: Float32Array, output: Int16Array = new Int16Array(input.length)): Int16Array {
  const count = Math.min(input.length, output.length);
  for (let index = 0; index < count; index += 1) {
    const value = input[index];
    const clipped = value > 1 ? 1 : value < -1 ? -1 : value !== value ? 0 : value;
    output[index] = Math.round(clipped < 0 ? clipped * 32_768 : clipped * 32_767);
  }
  return output;
}

// ---------------------------------------------------------------------------------------------
// ID3v2.3

function utf16Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff; // byte order mark, little endian
  bytes[1] = 0xfe;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    bytes[2 + index * 2] = unit & 0xff;
    bytes[3 + index * 2] = unit >> 8;
  }
  return bytes;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function id3Frame(id: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(10 + payload.length);
  for (let index = 0; index < 4; index += 1) out[index] = id.charCodeAt(index);
  const size = payload.length;
  out[4] = (size >>> 24) & 0xff; // ID3v2.3 frame sizes are plain big-endian integers
  out[5] = (size >>> 16) & 0xff;
  out[6] = (size >>> 8) & 0xff;
  out[7] = size & 0xff;
  out.set(payload, 10);
  return out;
}

function id3TextFrame(id: string, text: string): Uint8Array {
  return id3Frame(id, concatBytes([Uint8Array.of(0x01), utf16Bytes(text)]));
}

function id3CommentFrame(text: string): Uint8Array {
  // encoding (UTF-16), language, empty short description (BOM + terminator), text
  return id3Frame(
    "COMM",
    concatBytes([Uint8Array.of(0x01, 0x6b, 0x6f, 0x72), Uint8Array.of(0xff, 0xfe, 0x00, 0x00), utf16Bytes(text)]),
  );
}

/** Builds an ID3v2.3 tag (header + frames) for the fields that are present; empty fields are skipped. */
export function buildId3v23Tag(tag: Id3Tag): Uint8Array {
  const frames: Uint8Array[] = [];
  if (tag.title) frames.push(id3TextFrame("TIT2", tag.title));
  if (tag.artist) frames.push(id3TextFrame("TPE1", tag.artist));
  if (tag.album) frames.push(id3TextFrame("TALB", tag.album));
  if (tag.year && /^\d{4}$/.test(tag.year)) frames.push(id3Frame("TYER", concatBytes([Uint8Array.of(0x00), new TextEncoder().encode(tag.year)])));
  if (tag.software) frames.push(id3TextFrame("TSSE", tag.software));
  if (tag.comment) frames.push(id3CommentFrame(tag.comment));
  const body = concatBytes(frames);
  const header = new Uint8Array(10);
  header.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]); // "ID3", v2.3.0, no flags
  header[6] = (body.length >>> 21) & 0x7f; // tag size is "syncsafe": 7 bits per byte
  header[7] = (body.length >>> 14) & 0x7f;
  header[8] = (body.length >>> 7) & 0x7f;
  header[9] = body.length & 0x7f;
  return concatBytes([header, body]);
}

// ---------------------------------------------------------------------------------------------
// Frame walker

const BITRATE_TABLE_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0] as const;
const SAMPLE_RATE_TABLE_MPEG1 = [44_100, 48_000, 32_000, 0] as const;

/**
 * Walks an MPEG-1 Layer III stream (after an optional ID3v2 tag) and returns what it found, or
 * `null` when the bytes are not a clean sequence of whole frames with constant parameters.  The
 * export uses it to check the encoder's output before offering the file.
 */
export function inspectMp3(bytes: Uint8Array): Mp3Info | null {
  let position = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    position = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }
  const tagBytes = position;
  let frameCount = 0;
  let sampleRate = 0;
  let kbps = 0;
  let channels: 1 | 2 = 2;
  while (position + 4 <= bytes.length) {
    const b1 = bytes[position + 1];
    const b2 = bytes[position + 2];
    const b3 = bytes[position + 3];
    if (bytes[position] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
    if (((b1 >> 3) & 0x03) !== 3 || ((b1 >> 1) & 0x03) !== 1) return null; // MPEG-1, Layer III only
    const frameKbps = BITRATE_TABLE_MPEG1_L3[b2 >> 4];
    const frameRate = SAMPLE_RATE_TABLE_MPEG1[(b2 >> 2) & 0x03];
    if (!frameKbps || !frameRate) return null;
    const frameChannels: 1 | 2 = ((b3 >> 6) & 0x03) === 3 ? 1 : 2;
    if (frameCount === 0) {
      sampleRate = frameRate;
      kbps = frameKbps;
      channels = frameChannels;
    } else if (frameRate !== sampleRate || frameKbps !== kbps || frameChannels !== channels) {
      return null;
    }
    const length = Math.floor((144_000 * frameKbps) / frameRate) + ((b2 >> 1) & 0x01);
    if (position + length > bytes.length) return null;
    position += length;
    frameCount += 1;
  }
  if (frameCount === 0 || position !== bytes.length) return null;
  return {
    frameCount,
    sampleRate,
    kbps,
    channels,
    seconds: (frameCount * MP3_FRAME_SAMPLES) / sampleRate,
    audioBytes: bytes.length - tagBytes,
    tagBytes,
  };
}

// ---------------------------------------------------------------------------------------------
// Encoder

/**
 * Encodes 16-bit-range float PCM to a constant-bit-rate MP3 (stereo when `right` is given).  The work
 * is cut into slices of a few milliseconds with a hand-back to the browser in between, so that
 * progress bars and touch input stay smooth; `signal` cancels between slices.
 */
export async function encodeMp3(left: Float32Array, right: Float32Array | null, options: Mp3EncodeOptions): Promise<Blob> {
  const kbps = options.kbps ?? MP3_DEFAULT_KBPS;
  if (!(MP3_SAMPLE_RATES as readonly number[]).includes(options.sampleRate)) {
    throw new RangeError(`Unsupported MP3 sample rate: ${options.sampleRate}`);
  }
  if (!(MP3_BITRATES as readonly number[]).includes(kbps)) throw new RangeError(`Unsupported MP3 bit rate: ${kbps}`);
  if (right && right.length !== left.length) throw new RangeError("Both channels must have the same length.");
  if (left.length === 0) throw new RangeError("There is no audio to encode.");
  throwIfAborted(options.signal);

  const { Mp3Encoder } = await loadMp3Encoder();
  throwIfAborted(options.signal);

  const encoder = new Mp3Encoder(right ? 2 : 1, options.sampleRate, kbps);
  const parts: Uint8Array[] = [];
  if (options.tag) parts.push(buildId3v23Tag(options.tag));

  const leftPcm = new Int16Array(ENCODE_CHUNK_SAMPLES);
  const rightPcm = right ? new Int16Array(ENCODE_CHUNK_SAMPLES) : null;
  const total = left.length;
  let sliceStarted = clockMs();
  for (let offset = 0; offset < total; offset += ENCODE_CHUNK_SAMPLES) {
    const end = Math.min(total, offset + ENCODE_CHUNK_SAMPLES);
    const count = end - offset;
    const leftChunk = floatToInt16(left.subarray(offset, end), leftPcm.subarray(0, count));
    const encoded =
      right && rightPcm
        ? encoder.encodeBuffer(leftChunk, floatToInt16(right.subarray(offset, end), rightPcm.subarray(0, count)))
        : encoder.encodeBuffer(leftChunk);
    // lamejs returns an Int8Array (its typings say Uint8Array); copying turns the values into unsigned bytes.
    if (encoded.length > 0) parts.push(new Uint8Array(encoded));
    if (clockMs() - sliceStarted >= ENCODE_SLICE_MS) {
      options.onProgress?.(end / total);
      await nextTask();
      throwIfAborted(options.signal);
      sliceStarted = clockMs();
    }
  }
  const last = encoder.flush();
  if (last.length > 0) parts.push(new Uint8Array(last));
  options.onProgress?.(1);
  return new Blob(parts as BlobPart[], { type: "audio/mpeg" });
}
