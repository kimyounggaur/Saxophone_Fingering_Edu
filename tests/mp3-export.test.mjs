import assert from "node:assert/strict";
import test from "node:test";

import {
  MP3_BITRATES,
  MP3_FRAME_SAMPLES,
  MP3_SAMPLE_RATES,
  Mp3EncoderUnavailableError,
  buildId3v23Tag,
  encodeMp3,
  floatToInt16,
  inspectMp3,
  isAbortError,
  loadMp3Encoder,
  shouldWarmMp3Encoder,
  warmMp3Encoder,
} from "../lib/mp3-encode.ts";
import {
  EXPORT_LENGTHS_SECONDS,
  EXPORT_PEAK_CEILING,
  EXPORT_SAMPLE_RATE,
  EXPORT_TAIL_SECONDS,
  EXPORT_VOLUME,
  SAX_EXPORT_INTENSITY,
  SaxExportError,
  buildSaxExportFileName,
  buildSaxExportTag,
  createSaxMp3,
  describeSaxExport,
  exportPitchToken,
  finalizeExportPcm,
  normalizeSaxExportRequest,
  renderSaxExportPcm,
} from "../lib/sax-export.ts";

const LABELS = {
  instrumentKo: "알토 색소폰",
  fingeringDisplay: "B♭4",
  fingeringAscii: "Bb4",
  pitchDisplay: "D♭4",
  pitchAscii: "Db4",
};
const REQUEST = { midi: 61, instrument: "alto", seconds: 1.5, dynamic: "medium", vibrato: true };

function sine(seconds, frequency, amplitude, sampleRate = 44_100) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < out.length; index += 1) out[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  return out;
}

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------------------------------------------------------------------------------------------
// A tiny stand-in for OfflineAudioContext: it is a context the engine can build its graph on, and
// startRendering() "mixes" every scheduled buffer source into a stereo buffer the way the real master
// chain would at unit gain (voice gain only), so that timing and routing can be checked without a browser.

class Param {
  value = 0;
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}
class Node {
  connect(destination) { return destination; }
  disconnect() {}
}
class GainNode extends Node { gain = new Param(); }
class BiquadNode extends Node { frequency = new Param(); Q = new Param(); gain = new Param(); type = "lowpass"; }
class CompressorNode extends Node { threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param(); }
class SourceNode extends Node {
  buffer = null; loop = false; playbackRate = new Param(); starts = []; onended = null;
  frequency = new Param(); detune = new Param();
  setPeriodicWave() {}
  start(when) { this.starts.push(when); }
  stop() {}
}
class FakeBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels; this.length = length; this.sampleRate = sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel) { return this.channels[channel]; }
}
class FakeOfflineContext {
  state = "suspended";
  currentTime = 0;
  destination = new Node();
  sources = [];
  constructor(length, sampleRate) { this.length = length; this.sampleRate = sampleRate; }
  createGain() { return new GainNode(); }
  createBiquadFilter() { return new BiquadNode(); }
  createDynamicsCompressor() { return new CompressorNode(); }
  createConvolver() { return Object.assign(new Node(), { buffer: null, normalize: false }); }
  createWaveShaper() { return Object.assign(new Node(), { curve: null, oversample: "none" }); }
  createBuffer(channels, length, sampleRate) { return new FakeBuffer(channels, length, sampleRate); }
  createBufferSource() { const node = new SourceNode(); this.sources.push(node); return node; }
  createOscillator() { return new SourceNode(); }
  createPeriodicWave() { return {}; }
  async resume() { this.state = "running"; }
  async startRendering() {
    const out = new FakeBuffer(2, this.length, this.sampleRate);
    for (const source of this.sources) {
      if (!source.buffer || source.starts.length === 0) continue;
      const first = Math.round(source.starts[0] * this.sampleRate);
      const tone = source.buffer.getChannelData(0);
      for (let index = 0; index < tone.length && first + index < this.length; index += 1) {
        out.channels[0][first + index] += tone[index];
        out.channels[1][first + index] += tone[index];
      }
    }
    return out;
  }
}
const fakeHooks = (extra = {}) => {
  const created = [];
  return {
    created,
    hooks: {
      createContext: (length, sampleRate) => {
        const context = new FakeOfflineContext(length, sampleRate);
        created.push(context);
        return context;
      },
      ...extra,
    },
  };
};

// ---------------------------------------------------------------------------------------------
// mp3-encode

test("converts float samples to 16-bit PCM with rounding, clipping and NaN protection", () => {
  const pcm = floatToInt16(Float32Array.of(0, 1, -1, 0.5, -0.5, 2, -3, Number.NaN, Number.POSITIVE_INFINITY));
  assert.deepEqual([...pcm], [0, 32767, -32768, 16384, -16384, 32767, -32768, 0, 32767]);

  const into = new Int16Array(2);
  floatToInt16(Float32Array.of(0.25, -0.25, 0.9), into);
  assert.deepEqual([...into], [8192, -8192], "writes at most as many samples as the output holds");
});

test("writes an ID3v2.3 tag that parses back, Korean text included", () => {
  const tag = buildId3v23Tag({
    title: "알토 색소폰 D♭4 (B♭4 운지)",
    artist: "SaxHands",
    year: "2026",
    comment: "컴퓨터 합성음",
    software: "lamejs",
  });
  assert.deepEqual([...tag.subarray(0, 6)], [0x49, 0x44, 0x33, 3, 0, 0], "ID3, version 2.3.0, no flags");
  assert.ok([...tag.subarray(6, 10)].every((byte) => byte < 0x80), "the size is syncsafe");
  const bodyLength = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
  assert.equal(tag.length, 10 + bodyLength);

  const decode = (bytes) => new TextDecoder("utf-16le").decode(bytes.subarray(2)); // after the FF FE byte order mark
  const frames = {};
  for (let offset = 10; offset < tag.length; ) {
    const id = String.fromCharCode(...tag.subarray(offset, offset + 4));
    const size = new DataView(tag.buffer, tag.byteOffset + offset + 4, 4).getUint32(0);
    frames[id] = tag.subarray(offset + 10, offset + 10 + size);
    assert.deepEqual([...tag.subarray(offset + 8, offset + 10)], [0, 0], "no frame flags");
    offset += 10 + size;
  }
  assert.deepEqual(Object.keys(frames).sort(), ["COMM", "TIT2", "TPE1", "TSSE", "TYER"]);
  assert.equal(frames.TIT2[0], 1, "UTF-16 with byte order mark");
  assert.deepEqual([...frames.TIT2.subarray(1, 3)], [0xff, 0xfe]);
  assert.equal(decode(frames.TIT2.subarray(1)), "알토 색소폰 D♭4 (B♭4 운지)");
  assert.equal(decode(frames.TPE1.subarray(1)), "SaxHands");
  assert.deepEqual([...frames.TYER], [0, 0x32, 0x30, 0x32, 0x36], "the year is plain ISO-8859-1 text");
  assert.deepEqual([...frames.COMM.subarray(0, 4)], [1, 0x6b, 0x6f, 0x72], "UTF-16, language kor");
  assert.deepEqual([...frames.COMM.subarray(4, 8)], [0xff, 0xfe, 0, 0], "empty short description");
  assert.equal(decode(frames.COMM.subarray(8)), "컴퓨터 합성음");
});

test("skips empty tag fields and rejects a malformed year", () => {
  assert.equal(buildId3v23Tag({}).length, 10, "an empty tag is just the header");
  const tag = buildId3v23Tag({ title: "", year: "26" });
  assert.equal(tag.length, 10);
});

test("encodes a stereo MP3 that the frame walker accepts", async () => {
  const left = sine(2, 440, 0.5);
  const right = sine(2, 440, 0.5);
  const progress = [];
  const tag = { title: "test", artist: "unit test" };
  const blob = await encodeMp3(left, right, { sampleRate: 44_100, kbps: 256, tag, onProgress: (fraction) => progress.push(fraction) });
  assert.equal(blob.type, "audio/mpeg");

  const bytes = await bytesOf(blob);
  const info = inspectMp3(bytes);
  assert.ok(info, "a clean sequence of whole frames");
  assert.equal(info.sampleRate, 44_100);
  assert.equal(info.kbps, 256);
  assert.equal(info.channels, 2);
  assert.ok(info.tagBytes > 10, "the ID3 tag is skipped");
  assert.equal(info.audioBytes, bytes.length - info.tagBytes);
  assert.ok(Math.abs(info.seconds - 2) < 0.1, `about 2 s, got ${info.seconds}`);
  assert.ok(info.frameCount >= Math.floor((2 * 44_100) / MP3_FRAME_SAMPLES));
  // constant bit rate: 256 kbit/s = 32,000 bytes per second
  assert.ok(Math.abs(info.audioBytes - 2 * 32_000) < 4000, `size ${info.audioBytes}`);

  assert.equal(progress.at(-1), 1);
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b), "progress never goes backwards");
});

test("encodes mono and the other supported rates", async () => {
  const mono = await encodeMp3(sine(1, 220, 0.4, 48_000), null, { sampleRate: 48_000, kbps: 128 });
  const monoInfo = inspectMp3(await bytesOf(mono));
  assert.ok(monoInfo);
  assert.equal(monoInfo.channels, 1);
  assert.equal(monoInfo.sampleRate, 48_000);
  assert.equal(monoInfo.kbps, 128);

  // every offered combination comes out exactly as asked (LAME resamples at low bit rates, which is why they are not offered)
  for (const sampleRate of MP3_SAMPLE_RATES) {
    for (const kbps of MP3_BITRATES) {
      for (const channels of [1, 2]) {
        const tone = sine(0.4, 330, 0.3, sampleRate);
        const info = inspectMp3(await bytesOf(await encodeMp3(tone, channels === 2 ? tone : null, { sampleRate, kbps })));
        assert.deepEqual(info && { rate: info.sampleRate, kbps: info.kbps, channels: info.channels }, { rate: sampleRate, kbps, channels }, `${sampleRate} Hz, ${kbps} kbit/s, ${channels} ch`);
      }
    }
  }
});

test("rejects invalid encoder input", async () => {
  const one = new Float32Array(4608);
  await assert.rejects(encodeMp3(one, one, { sampleRate: 22_050 }), RangeError);
  await assert.rejects(encodeMp3(one, one, { sampleRate: 44_100, kbps: 100 }), RangeError);
  await assert.rejects(encodeMp3(one, one, { sampleRate: 44_100, kbps: 96 }), RangeError, "low rates would be silently resampled");
  await assert.rejects(encodeMp3(one, new Float32Array(10), { sampleRate: 44_100 }), RangeError);
  await assert.rejects(encodeMp3(new Float32Array(0), null, { sampleRate: 44_100 }), RangeError);
});

test("can be cancelled before and during encoding", async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(encodeMp3(sine(1, 440, 0.5), null, { sampleRate: 44_100, signal: before.signal }), (error) => isAbortError(error));

  const during = new AbortController();
  const long = sine(60, 440, 0.5); // far longer than one 20 ms slice
  let slices = 0;
  await assert.rejects(
    encodeMp3(long, null, {
      sampleRate: 44_100,
      signal: during.signal,
      onProgress: () => {
        slices += 1;
        during.abort();
      },
    }),
    (error) => isAbortError(error),
  );
  assert.equal(slices, 1, "stops at the first hand-back to the event loop");
});

test("the frame walker rejects anything that is not whole MPEG-1 Layer III frames", async () => {
  const good = await bytesOf(await encodeMp3(sine(0.5, 440, 0.5), null, { sampleRate: 44_100, kbps: 128 }));
  assert.ok(inspectMp3(good));
  assert.equal(inspectMp3(good.subarray(0, good.length - 7)), null, "a truncated last frame");
  assert.equal(inspectMp3(good.subarray(3)), null, "lost synchronisation");
  assert.equal(inspectMp3(new Uint8Array(0)), null);
  assert.equal(inspectMp3(new Uint8Array(500)), null);
  assert.equal(inspectMp3(Uint8Array.of(0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0)), null, "a tag and no audio");
  const appended = new Uint8Array(good.length + 4);
  appended.set(good);
  assert.equal(inspectMp3(appended), null, "trailing garbage");
});

test("loads the encoder lazily and reuses it", async () => {
  const first = loadMp3Encoder();
  assert.equal(loadMp3Encoder(), first);
  const lame = await first;
  assert.equal(typeof lame.Mp3Encoder, "function");
  assert.ok(new Mp3EncoderUnavailableError() instanceof Error);
});

// ---------------------------------------------------------------------------------------------
// sax-export: names, tags, request handling

test("turns pitch names into file-name tokens", () => {
  assert.equal(exportPitchToken("Bb4"), "Bflat4");
  assert.equal(exportPitchToken("C#5"), "Csharp5");
  assert.equal(exportPitchToken("A4"), "A4");
  assert.equal(exportPitchToken("g2"), "G2");
  assert.equal(exportPitchToken("B♭/A♯ 4"), "BA4", "unexpected characters are dropped");
  assert.equal(exportPitchToken("♭♯"), "note");
});

test("builds a descriptive, filesystem-safe file name", () => {
  assert.equal(
    buildSaxExportFileName({ ...REQUEST, seconds: 3, dynamic: "strong", vibrato: false }, LABELS),
    "saxtone3_alto_fingering-Bflat4_pitch-Dflat4_3s_strong_novib.mp3",
  );
  assert.equal(
    buildSaxExportFileName(REQUEST, { ...LABELS, fingeringAscii: "F#6", pitchAscii: "E6" }),
    "saxtone3_alto_fingering-Fsharp6_pitch-E6_1p5s_mid_vib.mp3",
  );
  assert.equal(buildSaxExportFileName({ ...REQUEST, dynamic: "soft", seconds: 6 }, LABELS), "saxtone3_alto_fingering-Bflat4_pitch-Dflat4_6s_soft_vib.mp3");
  for (const seconds of EXPORT_LENGTHS_SECONDS) {
    assert.match(buildSaxExportFileName({ ...REQUEST, seconds }, LABELS), /^[A-Za-z0-9_.-]+$/);
  }
});

test("normalises requests", () => {
  assert.deepEqual(normalizeSaxExportRequest({ ...REQUEST, midi: 200.4, seconds: 99 }), { ...REQUEST, midi: 108, seconds: 8 });
  assert.equal(normalizeSaxExportRequest({ ...REQUEST, seconds: 0.1 }).seconds, 0.72);
  assert.equal(normalizeSaxExportRequest({ ...REQUEST, seconds: Number.NaN }).seconds, 3);
  assert.equal(normalizeSaxExportRequest({ ...REQUEST, dynamic: "loud" }).dynamic, "medium");
  assert.equal(normalizeSaxExportRequest({ ...REQUEST, midi: 3 }).midi, 24);
});

test("announces length and size before encoding", () => {
  const { seconds, approxBytes } = describeSaxExport({ ...REQUEST, seconds: 3 });
  assert.equal(seconds, 3 + EXPORT_TAIL_SECONDS);
  assert.equal(approxBytes, Math.round(3.5 * 32_000));
});

test("tags the file as a synthesised, not recorded, SaxTone 3.0 note", () => {
  const tag = buildSaxExportTag({ ...REQUEST, seconds: 3, vibrato: false, dynamic: "strong" }, LABELS, 2026);
  assert.equal(tag.title, "알토 색소폰 D♭4 (B♭4 운지)");
  assert.equal(tag.year, "2026");
  assert.match(tag.artist, /SaxTone 3\.0/);
  assert.match(tag.comment, /실제 연주 녹음이 아닙니다/);
  assert.match(tag.comment, /음 길이 3초 · 세기 세게 · 비브라토 없음/);
  assert.match(tag.software, /256 kbps/);
  assert.ok(buildId3v23Tag(tag).length > 100);
});

test("keeps the export loudness policy in a safe range", () => {
  assert.ok(EXPORT_VOLUME > 0 && EXPORT_VOLUME <= 1);
  assert.ok(Math.abs(20 * Math.log10(EXPORT_PEAK_CEILING) + 1) < 1e-9, "the ceiling is -1 dBFS");
  assert.ok(SAX_EXPORT_INTENSITY.soft < SAX_EXPORT_INTENSITY.medium && SAX_EXPORT_INTENSITY.medium < SAX_EXPORT_INTENSITY.strong);
  assert.equal(SAX_EXPORT_INTENSITY.medium, 0.72, "medium is the intensity the model was calibrated at");
});

// ---------------------------------------------------------------------------------------------
// sax-export: post-processing

test("cuts the kept region and fades its edges", () => {
  const rate = 1000;
  const left = new Float32Array(2000).fill(0.5);
  const right = new Float32Array(2000).fill(-0.25);
  const pcm = finalizeExportPcm(left, right, rate, { startSeconds: 0.3, lengthSeconds: 1, fadeInSeconds: 0.01, fadeOutSeconds: 0.05 });
  assert.equal(pcm.left.length, 1000);
  assert.equal(pcm.right.length, 1000);
  assert.equal(pcm.sampleRate, rate);
  assert.equal(pcm.safetyScale, 1);
  assert.equal(pcm.left[0], 0, "starts from silence");
  assert.equal(pcm.left.at(-1), 0, "ends in silence");
  assert.equal(pcm.left[500], 0.5, "the middle is untouched");
  assert.equal(pcm.right[500], -0.25);
  assert.ok(pcm.left[5] > 0 && pcm.left[5] < 0.5, "fading in");
  assert.ok(pcm.left[980] > 0 && pcm.left[980] < 0.5, "fading out");
  assert.equal(pcm.peak, 0.5);
  assert.equal(left[1000], 0.5, "the rendered buffer itself is left alone");
});

test("scales a render that is too loud down to the ceiling, and never up", () => {
  const rate = 1000;
  const loud = new Float32Array(1000).fill(0.99);
  const quiet = new Float32Array(1000).fill(0.2);
  const scaled = finalizeExportPcm(loud, quiet, rate, { startSeconds: 0, lengthSeconds: 1, fadeInSeconds: 0, fadeOutSeconds: 0 });
  assert.ok(Math.abs(scaled.peak - EXPORT_PEAK_CEILING) < 1e-6);
  assert.ok(Math.abs(scaled.safetyScale - EXPORT_PEAK_CEILING / 0.99) < 1e-6);
  assert.ok(Math.abs(scaled.right[500] - 0.2 * scaled.safetyScale) < 1e-6, "both channels share one gain, so the stereo image is kept");

  const fine = finalizeExportPcm(quiet, quiet, rate, { startSeconds: 0, lengthSeconds: 1, fadeInSeconds: 0, fadeOutSeconds: 0 });
  assert.equal(fine.safetyScale, 1);
  assert.ok(Math.abs(fine.peak - 0.2) < 1e-6);
});

test("refuses renders that are empty, invalid or silent", () => {
  const rate = 1000;
  const code = (error) => error instanceof SaxExportError && error.code;
  assert.throws(() => finalizeExportPcm(new Float32Array(1000), new Float32Array(1000), rate, { startSeconds: 0, lengthSeconds: 1 }), (error) => code(error) === "silent");
  const nan = new Float32Array(1000).fill(0.3);
  nan[400] = Number.NaN;
  assert.throws(() => finalizeExportPcm(nan, new Float32Array(1000).fill(0.3), rate, { startSeconds: 0, lengthSeconds: 1 }), (error) => code(error) === "render-failed");
  assert.throws(() => finalizeExportPcm(new Float32Array(50).fill(0.3), new Float32Array(50).fill(0.3), rate, { startSeconds: 0, lengthSeconds: 1 }), (error) => code(error) === "render-failed");
  assert.throws(() => finalizeExportPcm(new Float32Array(1000).fill(0.3), new Float32Array(1000).fill(0.3), rate, { startSeconds: 5, lengthSeconds: 1 }), (error) => code(error) === "render-failed");
});

// ---------------------------------------------------------------------------------------------
// sax-export: rendering through the engine

test("renders a note through the SaxTone 3.0 engine and cuts it at the note start", async () => {
  const { hooks, created } = fakeHooks();
  const pcm = await renderSaxExportPcm(REQUEST, hooks);

  assert.equal(created.length, 1);
  const context = created[0];
  assert.equal(context.sampleRate, EXPORT_SAMPLE_RATE);
  assert.equal(context.sources.length, 1, "exactly one note is played");
  assert.equal(context.sources[0].starts[0], 0.3, "the note starts after the volume-smoothing lead-in");
  assert.equal(context.sources[0].buffer.length, Math.ceil(1.5 * EXPORT_SAMPLE_RATE), "the model renders the requested length");

  assert.equal(pcm.sampleRate, EXPORT_SAMPLE_RATE);
  assert.equal(pcm.left.length, Math.round((1.5 + EXPORT_TAIL_SECONDS) * EXPORT_SAMPLE_RATE));
  assert.equal(pcm.right.length, pcm.left.length);
  assert.equal(pcm.left[0], 0, "begins with a fade-in from silence");
  assert.ok(pcm.peak > 0.05 && pcm.peak <= EXPORT_PEAK_CEILING);
  const middle = pcm.left.subarray(Math.round(0.5 * EXPORT_SAMPLE_RATE), Math.round(0.6 * EXPORT_SAMPLE_RATE));
  assert.ok(middle.some((sample) => Math.abs(sample) > 0.02), "the note body is inside the kept region");
});

test("vibrato off renders a different, steadier tone and long notes are possible", async () => {
  const withVibrato = await renderSaxExportPcm({ ...REQUEST, seconds: 6 }, fakeHooks().hooks);
  const straight = await renderSaxExportPcm({ ...REQUEST, seconds: 6, vibrato: false }, fakeHooks().hooks);
  assert.equal(withVibrato.left.length, Math.round(6.5 * EXPORT_SAMPLE_RATE), "6 s notes are not capped at the interactive 3.2 s");
  assert.notDeepEqual(withVibrato.left.subarray(200_000, 200_100), straight.left.subarray(200_000, 200_100));
});

test("dynamics change the sound but not the length", async () => {
  const soft = await renderSaxExportPcm({ ...REQUEST, dynamic: "soft" }, fakeHooks().hooks);
  const strong = await renderSaxExportPcm({ ...REQUEST, dynamic: "strong" }, fakeHooks().hooks);
  assert.equal(soft.left.length, strong.left.length);
  assert.ok(strong.peak > soft.peak, `strong ${strong.peak} > soft ${soft.peak}`);
});

test("reports an unsupported browser, a failed render and a cancelled export", async () => {
  await assert.rejects(renderSaxExportPcm(REQUEST), (error) => error instanceof SaxExportError && error.code === "unsupported");

  const code = (error) => error instanceof SaxExportError && error.code;
  const failWhen = (isTooBig) =>
    fakeHooks({
      createContext: (length, sampleRate) => {
        const context = new FakeOfflineContext(length, sampleRate);
        context.createBuffer = (channels, size, rate) => {
          if (channels === 1 && isTooBig(size)) throw new Error("out of audio memory");
          return new FakeBuffer(channels, size, rate);
        };
        return context;
      },
    });
  // the engine cannot even be built
  await assert.rejects(renderSaxExportPcm(REQUEST, failWhen((size) => size > 90_000).hooks), (error) => code(error) === "render-failed");
  // the note cannot be rendered: the engine would quietly play SaxTone 2.0 instead, and the export refuses that
  await assert.rejects(renderSaxExportPcm(REQUEST, failWhen((size) => size > 30_000 && size < 90_000).hooks), (error) => code(error) === "render-failed");

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(renderSaxExportPcm(REQUEST, fakeHooks({ signal: controller.signal }).hooks), (error) => isAbortError(error));
});

test("a context that renders silence is reported, not exported", async () => {
  const silent = fakeHooks({
    createContext: (length, sampleRate) => {
      const context = new FakeOfflineContext(length, sampleRate);
      context.startRendering = async () => new FakeBuffer(2, length, sampleRate);
      return context;
    },
  });
  await assert.rejects(renderSaxExportPcm(REQUEST, silent.hooks), (error) => error instanceof SaxExportError && error.code === "silent");
});

test("creates a checked MP3 from a rendered note", async () => {
  const stages = [];
  const { hooks } = fakeHooks({ onStage: (stage, fraction) => stages.push([stage, fraction]) });
  const result = await createSaxMp3({ ...REQUEST, seconds: 3 }, LABELS, hooks);

  assert.equal(result.fileName, "saxtone3_alto_fingering-Bflat4_pitch-Dflat4_3s_mid_vib.mp3");
  assert.equal(result.blob.type, "audio/mpeg");
  assert.equal(result.bytes, result.blob.size);
  assert.equal(result.kbps, 256);
  assert.equal(result.sampleRate, 44_100);
  assert.ok(Math.abs(result.seconds - 3.5) < 0.001);
  assert.ok(result.peakDb < -1 + 1e-9 && result.peakDb > -40, `peak ${result.peakDb} dBFS`);
  assert.ok(Math.abs(result.bytes - 3.5 * 32_000) < 6000, `about 3.5 s of 256 kbit/s audio, got ${result.bytes} bytes`);

  const bytes = await bytesOf(result.blob);
  assert.deepEqual([...bytes.subarray(0, 3)], [0x49, 0x44, 0x33], "starts with the ID3 tag");
  const info = inspectMp3(bytes);
  assert.ok(info);
  assert.equal(info.channels, 2);
  assert.ok(Math.abs(info.seconds - 3.5) < 0.1);

  assert.deepEqual(stages[0], ["render", null]);
  assert.deepEqual(stages[1], ["encode", 0]);
  assert.deepEqual(stages.at(-1), ["encode", 1]);
});

test("an export can be cancelled while it is encoding", async () => {
  const controller = new AbortController();
  const { hooks } = fakeHooks({
    signal: controller.signal,
    onStage: (stage, fraction) => {
      if (stage === "encode" && fraction !== null && fraction > 0 && fraction < 1) controller.abort();
    },
  });
  await assert.rejects(createSaxMp3({ ...REQUEST, seconds: 6 }, LABELS, hooks), (error) => isAbortError(error));
});

test("the encoder is only fetched in the background when that is polite", () => {
  assert.equal(shouldWarmMp3Encoder({ online: true }), true, "online with no connection info");
  assert.equal(shouldWarmMp3Encoder({ online: true, effectiveType: "4g" }), true);
  assert.equal(shouldWarmMp3Encoder({ online: true, effectiveType: "3g" }), true);
  assert.equal(shouldWarmMp3Encoder({ online: false }), false, "offline");
  assert.equal(shouldWarmMp3Encoder({ online: true, saveData: true }), false, "data saver on");
  assert.equal(shouldWarmMp3Encoder({ online: true, effectiveType: "2g" }), false);
  assert.equal(shouldWarmMp3Encoder({ online: true, effectiveType: "slow-2g" }), false);
});

test("warming the encoder respects the browser's connection hints and never throws", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const withNavigator = (value, run) => {
    Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
    try {
      return run();
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete globalThis.navigator;
    }
  };
  assert.equal(withNavigator({ onLine: false }, () => warmMp3Encoder()), false, "offline");
  assert.equal(withNavigator({ onLine: true, connection: { saveData: true } }, () => warmMp3Encoder()), false, "data saver");
  assert.equal(withNavigator({ onLine: true, connection: { effectiveType: "slow-2g" } }, () => warmMp3Encoder()), false, "2G");
  assert.equal(withNavigator({ onLine: true, connection: { effectiveType: "4g", saveData: false } }, () => warmMp3Encoder()), true, "a normal connection starts the fetch");
});
