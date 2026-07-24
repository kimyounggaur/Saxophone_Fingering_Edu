import assert from "node:assert/strict";
import test from "node:test";

import {
  SAX_VOICE_PROFILES,
  SaxSynthEngine,
  buildSaxHarmonics,
  getSaxEnvelope,
  midiToFrequency,
} from "../lib/sax-synth.ts";

class FakeAudioParam {
  value = 0;
  events = [];

  record(type, value, time, extra) {
    this.value = value;
    this.events.push({ type, value, time, extra });
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

  setTargetAtTime(value, time, timeConstant) {
    this.record("target", value, time, timeConstant);
  }

  cancelScheduledValues(time) {
    this.events.push({ type: "cancel", time });
  }
}

class FakeAudioNode {
  connections = [];
  disconnected = false;

  connect(destination) {
    this.connections.push(destination);
    return destination;
  }

  disconnect() {
    this.disconnected = true;
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
  type = "sine";
  frequency = new FakeAudioParam();
  detune = new FakeAudioParam();
  periodicWave = null;

  setPeriodicWave(wave) {
    this.periodicWave = wave;
  }
}

class FakeBufferSourceNode extends FakeScheduledSource {
  buffer = null;
  loop = false;
}

class FakeWaveShaperNode extends FakeAudioNode {
  curve = null;
  oversample = "none";
}

class FakeConvolverNode extends FakeAudioNode {
  buffer = null;
  normalize = false;
}

class FakeAudioBuffer {
  constructor(channels, frameCount, sampleRate) {
    this.numberOfChannels = channels;
    this.length = frameCount;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(frameCount));
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
  resumeCalls = 0;
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
    return new FakeConvolverNode();
  }

  createBuffer(channels, frameCount, sampleRate) {
    return new FakeAudioBuffer(channels, frameCount, sampleRate);
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
    return new FakeWaveShaperNode();
  }

  createPeriodicWave(real, imaginary, options) {
    return { real, imaginary, options };
  }

  async resume() {
    this.resumeCalls += 1;
    this.state = "running";
  }

  async close() {
    this.closeCalls += 1;
    this.state = "closed";
  }
}

function spectralCentroid(harmonics) {
  let weighted = 0;
  let energy = 0;
  for (let harmonic = 1; harmonic < harmonics.length; harmonic += 1) {
    const amplitude = harmonics[harmonic];
    const power = amplitude * amplitude;
    weighted += harmonic * power;
    energy += power;
  }
  return weighted / energy;
}

test("converts MIDI notes to concert frequency without tuning drift", () => {
  assert.equal(midiToFrequency(69), 440);
  assert.equal(midiToFrequency(81), 880);
  assert.equal(midiToFrequency(57), 220);
  assert.ok(Math.abs(midiToFrequency(60) - 261.625565) < 0.00001);
  assert.throws(() => midiToFrequency(Number.NaN), /finite/);
});

test("keeps distinct soprano, alto, and tenor acoustic profiles", () => {
  assert.deepEqual(Object.keys(SAX_VOICE_PROFILES).sort(), ["alto", "soprano", "tenor"]);
  assert.ok(SAX_VOICE_PROFILES.soprano.brightness > SAX_VOICE_PROFILES.alto.brightness);
  assert.ok(SAX_VOICE_PROFILES.alto.brightness > SAX_VOICE_PROFILES.tenor.brightness);
  assert.ok(SAX_VOICE_PROFILES.tenor.breathLevel > SAX_VOICE_PROFILES.soprano.breathLevel);
  for (const profile of Object.values(SAX_VOICE_PROFILES)) {
    assert.equal(profile.formants.length, 3);
    assert.ok(profile.vibratoRate >= 5 && profile.vibratoRate <= 5.6);
    assert.ok(profile.vibratoDepth > 0 && profile.vibratoDepth < 10);
  }
});

test("builds a finite, band-limited harmonic spectrum rather than a sine tone", () => {
  for (const instrument of ["soprano", "alto", "tenor"]) {
    for (const midi of [44, 60, 76, 88]) {
      const harmonics = buildSaxHarmonics(midi, instrument, 48_000);
      assert.equal(harmonics[0], 0);
      assert.ok(harmonics[1] > 0);
      assert.ok([...harmonics].every(Number.isFinite));
      assert.ok(harmonics.filter((amplitude) => amplitude > 0.001).length >= 8);
      for (let harmonic = 1; harmonic < harmonics.length; harmonic += 1) {
        if (midiToFrequency(midi) * harmonic >= 48_000 * 0.48) {
          assert.equal(harmonics[harmonic], 0);
        }
      }
    }
  }

  const soprano = buildSaxHarmonics(60, "soprano");
  const tenor = buildSaxHarmonics(60, "tenor");
  assert.ok(spectralCentroid(soprano) > spectralCentroid(tenor));
});

test("uses click-safe envelope timing across low and high registers", () => {
  for (const midi of [44, 69, 90]) {
    const envelope = getSaxEnvelope(midi);
    assert.ok(envelope.attack > 0);
    assert.ok(envelope.attack < envelope.decay);
    assert.ok(envelope.decay < envelope.sustainUntil);
    assert.ok(envelope.sustainUntil < envelope.total);
    assert.ok(envelope.release >= 0.18);
    assert.ok(Math.abs(envelope.total - envelope.sustainUntil - envelope.release) < 0.000001);
  }

  assert.equal(getSaxEnvelope(60, 0.1).total, 0.72);
  assert.equal(getSaxEnvelope(60, 9).total, 3.2);
  assert.ok(getSaxEnvelope(90).attack < getSaxEnvelope(44).attack);
});

test("constructs and cleans up a bounded polyphonic Web Audio graph", async () => {
  const context = new FakeAudioContext();
  const engine = new SaxSynthEngine(context);

  assert.equal(await engine.ensureRunning(), true);
  assert.equal(context.resumeCalls, 1);
  engine.setVolume(0);
  assert.equal(context.gains[3].gain.events.at(-1).value, 0);

  engine.play({ midi: 60, instrument: "tenor" });
  engine.play({ midi: 69, instrument: "alto" });
  engine.play({ midi: 81, instrument: "soprano" });

  assert.equal(engine.activeVoiceCount, 2);
  assert.equal(context.oscillators.length, 9);
  assert.equal(context.bufferSources.length, 6);
  assert.ok(context.oscillators.every((source) => source.starts.length === 1));
  assert.ok(context.bufferSources.every((source) => source.starts.length === 1));
  assert.ok(context.oscillators.some((source) => source.periodicWave?.imaginary?.[2] > 0));

  engine.stopAll();
  assert.equal(engine.activeVoiceCount, 0);
  assert.ok([...context.oscillators, ...context.bufferSources].every((source) => source.stops.length >= 1));

  await engine.dispose();
  assert.equal(context.state, "closed");
  assert.equal(context.closeCalls, 1);
  assert.equal(await engine.ensureRunning(), false);
});
