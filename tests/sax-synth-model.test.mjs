import assert from "node:assert/strict";
import test from "node:test";

import {
  SAX_SYNTH_CLASSIC_VERSION,
  SAX_SYNTH_VERSION,
  SaxSynthEngine,
  createSaxSynthEngine,
  saxSynthVersionLabel,
  warmUpSaxModel,
} from "../lib/sax-synth.ts";

/**
 * Rendered notes are mono and 0.72-3.2 s long.  The engine's own helper buffers are told apart by
 * length: the 2.1 s breath-noise buffer (100,800 frames) and the stereo room impulse response.
 */
function isToneBuffer(buffer) {
  return buffer.numberOfChannels === 1 && buffer.length > 30_000 && buffer.length < 90_000;
}

class FakeAudioParam {
  value = 0;
  events = [];

  record(type, value, time) {
    this.value = value;
    this.events.push({ type, value, time });
  }

  setValueAtTime(value, time) {
    this.record("set", value, time);
  }

  linearRampToValueAtTime(value, time) {
    this.record("linear", value, time);
  }

  exponentialRampToValueAtTime(value, time) {
    this.record("exponential", value, time);
  }

  setTargetAtTime(value, time) {
    this.record("target", value, time);
  }

  cancelScheduledValues(time) {
    this.events.push({ type: "cancel", time });
  }
}

class FakeAudioNode {
  connections = [];

  connect(destination) {
    this.connections.push(destination);
    return destination;
  }

  disconnect() {
    this.connections.length = 0;
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakeBiquadNode extends FakeAudioNode {
  type = "lowpass";
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
  gain = new FakeAudioParam();
}

class FakeCompressorNode extends FakeAudioNode {
  threshold = new FakeAudioParam();
  knee = new FakeAudioParam();
  ratio = new FakeAudioParam();
  attack = new FakeAudioParam();
  release = new FakeAudioParam();
}

class FakeScheduledSource extends FakeAudioNode {
  starts = [];
  stops = [];
  onended = null;

  start(...args) {
    this.starts.push(args);
  }

  stop(when) {
    this.stops.push(when);
  }
}

class FakeOscillatorNode extends FakeScheduledSource {
  frequency = new FakeAudioParam();
  detune = new FakeAudioParam();
  setPeriodicWave() {}
}

class FakeBufferSourceNode extends FakeScheduledSource {
  buffer = null;
  loop = false;
  playbackRate = new FakeAudioParam();
  constructor() {
    super();
    this.playbackRate.value = 1;
  }
}

class FakeAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channel) {
    return this.channels[channel];
  }
}

class FakeAudioContext {
  sampleRate = 48_000;
  currentTime = 2;
  state = "suspended";
  destination = new FakeAudioNode();
  gains = [];
  oscillators = [];
  bufferSources = [];
  buffers = [];
  failMonoBuffers = false;
  closeCalls = 0;

  createGain() {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  createBiquadFilter() {
    return new FakeBiquadNode();
  }

  createDynamicsCompressor() {
    return new FakeCompressorNode();
  }

  createConvolver() {
    return Object.assign(new FakeAudioNode(), { buffer: null, normalize: false });
  }

  createBuffer(channels, length, sampleRate) {
    if (isToneBuffer({ numberOfChannels: channels, length }) && this.failMonoBuffers) throw new Error("out of audio memory");
    const buffer = new FakeAudioBuffer(channels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  createOscillator() {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node;
  }

  createBufferSource() {
    const node = new FakeBufferSourceNode();
    this.bufferSources.push(node);
    return node;
  }

  createWaveShaper() {
    return Object.assign(new FakeAudioNode(), { curve: null, oversample: "none" });
  }

  createPeriodicWave(real, imaginary) {
    return { real, imaginary };
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.closeCalls += 1;
    this.state = "closed";
  }

  get toneBuffers() {
    return this.buffers.filter(isToneBuffer);
  }
}

const settle = (milliseconds = 120) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const NOTE = { midi: 62, instrument: "alto" };

test("labels the two engine generations", () => {
  assert.equal(SAX_SYNTH_VERSION, "SaxTone 3.0");
  assert.equal(SAX_SYNTH_CLASSIC_VERSION, "SaxTone 2.0");
  assert.equal(saxSynthVersionLabel("model"), "SaxTone 3.0");
  assert.equal(saxSynthVersionLabel("classic"), "SaxTone 2.0");
  // outside a browser there is no AudioContext to create
  assert.equal(createSaxSynthEngine({ mode: "model" }), null);
});

test("model mode plays a rendered mono buffer through the shared master chain", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model" });
  assert.equal(engine.mode, "model");
  assert.equal(await engine.ensureRunning(), true);

  engine.play({ ...NOTE, duration: 1.42 });
  assert.equal(context.oscillators.length, 0, "no real-time oscillator graph is built");
  assert.equal(context.bufferSources.length, 1);
  const [source] = context.bufferSources;
  assert.equal(source.starts.length, 1);
  assert.equal(source.buffer.numberOfChannels, 1);
  assert.equal(source.buffer.length, Math.ceil(1.42 * 48_000));
  assert.equal(source.buffer.sampleRate, 48_000);
  assert.ok(source.buffer.getChannelData(0).some((sample) => Math.abs(sample) > 0.05), "the buffer holds audio");
  assert.ok(Math.abs(source.playbackRate.value - 1) <= 0.0009, "playback-rate jitter stays within 0.1 %");
  const [, voiceGain] = [null, context.gains.at(-1)];
  assert.ok(voiceGain.gain.value > 2 && voiceGain.gain.value < 2.4, `voice gain ${voiceGain.gain.value}`);
  assert.equal(engine.activeVoiceCount, 1);

  await settle();
  await engine.dispose();
});

test("keeps polyphony bounded and stops cleanly", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model" });
  await engine.ensureRunning();
  engine.play({ midi: 60, instrument: "tenor" });
  engine.play({ midi: 69, instrument: "alto" });
  engine.play({ midi: 81, instrument: "soprano" });
  assert.equal(engine.activeVoiceCount, 2);
  assert.equal(context.bufferSources.length, 3);
  assert.ok(context.bufferSources.every((source) => source.starts.length === 1));

  engine.stopAll();
  assert.equal(engine.activeVoiceCount, 0);
  assert.ok(context.bufferSources.every((source) => source.stops.length >= 1));

  await settle();
  await engine.dispose();
  assert.equal(context.state, "closed");
  assert.equal(context.closeCalls, 1);
});

test("volume 0 is silence for rendered notes as well", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model" });
  engine.setVolume(0);
  assert.equal(context.gains[3].gain.events.at(-1).value, 0);
  engine.setVolume(0.5);
  assert.ok(context.gains[3].gain.events.at(-1).value > 0.3);
  await engine.dispose();
});

test("alternates two renderings of a note and then reuses them from the cache", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model" });
  await engine.ensureRunning();

  engine.play(NOTE);
  engine.play(NOTE);
  engine.play(NOTE);
  engine.play(NOTE);
  const [first, second, third, fourth] = context.bufferSources.map((source) => source.buffer);
  assert.notEqual(first, second, "a repeated tap uses the other variant");
  assert.notDeepEqual(first.getChannelData(0), second.getChannelData(0));
  assert.equal(third, first, "the third tap reuses the first rendering");
  assert.equal(fourth, second);

  await settle(200);
  assert.equal(context.toneBuffers.length, 2, "no further renderings are made behind the player's back");
  await engine.dispose();
});

test("prepare() renders in the background and play() uses the result", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model" });
  await engine.ensureRunning();

  await engine.prepare(NOTE);
  assert.equal(context.toneBuffers.length, 1);
  assert.equal(context.bufferSources.length, 0, "preparing makes no sound");

  engine.play(NOTE);
  assert.equal(context.toneBuffers.length, 1, "the prepared rendering is played, not recomputed");
  assert.equal(context.bufferSources[0].buffer, context.toneBuffers[0]);

  await engine.prepare(NOTE);
  await engine.prepare(NOTE);
  assert.equal(context.toneBuffers.length, 2, "only the alternate variant is added, once");
  await engine.dispose();
});

test("play() can finish a note whose background preparation is only half done", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model" });
  await engine.ensureRunning();

  const preparing = engine.prepare(NOTE);
  await settle(3); // the job has started but cannot be finished yet
  engine.play(NOTE);
  assert.equal(context.bufferSources.length, 1);
  assert.ok(context.bufferSources[0].buffer.getChannelData(0).some((sample) => Math.abs(sample) > 0.05));
  await preparing;
  await settle(200);
  assert.equal(context.toneBuffers.length, 2, "one rendering per variant, never a duplicate");
  await engine.dispose();
});

test("tone controls are part of the cache key and engine defaults apply", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model", controls: { breath: 0 } });
  await engine.ensureRunning();

  const quiet = { ...NOTE };
  const breathy = { ...NOTE, controls: { breath: 1 } };
  engine.play(quiet);
  engine.play(breathy);
  engine.play(quiet);
  engine.play(breathy);
  const played = context.bufferSources.map((source) => source.buffer);
  assert.equal(new Set(played).size, 4, "each (controls, variant) pair has its own rendering");
  assert.notDeepEqual(played[0].getChannelData(0), played[1].getChannelData(0));

  // engine-level defaults behave exactly like the same controls passed with every note
  const explicit = new SaxSynthEngine(new FakeAudioContext(), { mode: "model" });
  explicit.play({ ...NOTE, controls: { breath: 0 } });
  assert.deepEqual(
    explicit.context.bufferSources[0].buffer.getChannelData(0),
    played[0].getChannelData(0),
  );

  await settle(250);
  await engine.dispose();
  await explicit.dispose();
});

test("can switch between SaxTone 3.0 and 2.0, per engine or per note", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context);
  assert.equal(engine.mode, "classic", "the constructor keeps the 2.0 graph unless asked otherwise");
  await engine.ensureRunning();

  engine.play(NOTE);
  assert.equal(context.oscillators.length, 3);
  assert.equal(context.toneBuffers.length, 0);

  engine.setMode("model");
  assert.equal(engine.mode, "model");
  engine.play(NOTE);
  assert.equal(context.toneBuffers.length, 1);
  assert.equal(context.oscillators.length, 3, "no new oscillators for a model note");

  engine.play({ ...NOTE, mode: "classic" });
  assert.equal(context.oscillators.length, 6, "a per-note mode overrides the engine mode");

  engine.setMode("classic");
  await engine.prepare(NOTE);
  assert.equal(context.toneBuffers.length, 1, "prepare() is a no-op in classic mode");
  await settle(150);
  await engine.dispose();
});

test("falls back to SaxTone 2.0 when a note cannot be rendered", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model" });
  await engine.ensureRunning();
  context.failMonoBuffers = true;

  assert.doesNotThrow(() => engine.play(NOTE));
  assert.equal(context.bufferSources.filter((source) => source.buffer && isToneBuffer(source.buffer)).length, 0);
  assert.equal(context.oscillators.length, 3, "the classic graph plays instead");
  assert.equal(engine.activeVoiceCount, 1);

  const brokenRate = new FakeAudioContext();
  brokenRate.sampleRate = 100;
  const other = new SaxSynthEngine(brokenRate, { mode: "model" });
  assert.doesNotThrow(() => other.play(NOTE));
  assert.equal(brokenRate.oscillators.length, 3);
  await engine.dispose();
  await other.dispose();
});

test("does nothing after dispose, including background work", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model" });
  await engine.ensureRunning();
  engine.play(NOTE);
  const rendered = context.buffers.length;
  await engine.dispose();
  await settle(200);
  assert.equal(context.buffers.length, rendered, "pending preparation does not run after dispose");
  engine.play(NOTE);
  await engine.prepare(NOTE);
  assert.equal(context.bufferSources.length, 1);
  assert.equal(context.buffers.length, rendered);
});

test("warms up the renderer once and never rejects", async () => {
  const first = warmUpSaxModel();
  assert.equal(warmUpSaxModel(), first);
  await first;
});

test("play() reports which engine sounded", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model" });
  await engine.ensureRunning();
  assert.equal(engine.play(NOTE), "model");
  assert.equal(engine.play({ ...NOTE, mode: "classic" }), "classic");

  context.failMonoBuffers = true;
  assert.equal(engine.play({ ...NOTE, midi: 70 }), "classic", "a note that cannot be rendered falls back, and says so");

  await settle(150);
  await engine.dispose();
  assert.equal(engine.play(NOTE), null, "a disposed engine plays nothing");
});

test("startAt places a model note on the context clock", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model" });
  await engine.ensureRunning();

  engine.play(NOTE);
  assert.ok(Math.abs(context.bufferSources[0].starts[0][0] - (context.currentTime + 0.006)) < 1e-9, "default: just after now");
  engine.play({ ...NOTE, startAt: 5.25 });
  assert.equal(context.bufferSources[1].starts[0][0], 5.25);
  engine.play({ ...NOTE, startAt: 0.5 });
  assert.equal(context.bufferSources[2].starts[0][0], context.currentTime, "a time in the past starts now");
  engine.play({ ...NOTE, startAt: Number.NaN });
  assert.ok(Math.abs(context.bufferSources[3].starts[0][0] - (context.currentTime + 0.006)) < 1e-9, "NaN falls back to the default");

  await settle(150);
  await engine.dispose();
});

test("prefetch: false renders only the requested variant", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context, { mode: "model", prefetch: false });
  await engine.ensureRunning();
  engine.play(NOTE);
  await settle(250);
  assert.equal(context.toneBuffers.length, 1, "nothing is rendered behind the caller's back");
  await engine.dispose();
});

test("maxNoteSeconds raises the note length limit for exports only", async () => {
  const sampleRate = 48_000;
  const normal = new FakeAudioContext();
  const normalEngine = new SaxSynthEngine(normal, { mode: "model", prefetch: false });
  normalEngine.play({ ...NOTE, duration: 6 });
  assert.equal(normal.bufferSources[0].buffer.length, Math.ceil(3.2 * sampleRate), "interactive notes stop at 3.2 s");

  const long = new FakeAudioContext();
  const longEngine = new SaxSynthEngine(long, { mode: "model", prefetch: false, maxNoteSeconds: 8 });
  longEngine.play({ ...NOTE, duration: 6 });
  assert.equal(long.bufferSources[0].buffer.length, 6 * sampleRate);
  longEngine.play({ ...NOTE, midi: 64, duration: 20 });
  assert.equal(long.bufferSources[1].buffer.length, 8 * sampleRate, "the renderer's own 8 s limit still applies");

  const silly = new FakeAudioContext();
  const sillyEngine = new SaxSynthEngine(silly, { mode: "model", prefetch: false, maxNoteSeconds: Number.NaN });
  sillyEngine.play({ ...NOTE, duration: 6 });
  assert.equal(silly.bufferSources[0].buffer.length, Math.ceil(3.2 * sampleRate), "an invalid limit keeps the default");

  await Promise.all([normalEngine.dispose(), longEngine.dispose(), sillyEngine.dispose()]);
});

test("an offline context has no close(); disposing still works", async () => {
  const context = new FakeAudioContext();
  Object.defineProperty(context, "close", { value: undefined });
  const engine = new SaxSynthEngine(context, { mode: "model", prefetch: false });
  engine.play(NOTE);
  await assert.doesNotReject(engine.dispose());
  assert.equal(context.closeCalls, 0);
});
