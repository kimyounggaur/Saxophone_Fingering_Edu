import assert from "node:assert/strict";
import test from "node:test";

import {
  aWeightingGain,
  computeSpectrogram,
  createFftPlan,
  dbToGain,
  fftInPlace,
  gainToDb,
  gatedLoudnessDb,
  hannSymmetric,
  matchLoudness,
  measureHarmonics,
  profileShares,
  weightedProfileError,
} from "../scripts/audio-calibration/listening-lab/src/dsp.ts";
import {
  INSTRUMENT_RANGE,
  analysableNotes,
  analysisCentre,
  buildPhrase,
  clampRoot,
  midiName,
  rootBounds,
  writtenMidi,
} from "../scripts/audio-calibration/listening-lab/src/phrases.ts";
import { SAX_MODEL_PROFILES, renderSaxTone } from "../lib/sax-model.ts";

const INSTRUMENTS = ["alto", "tenor", "soprano"];
const MATERIALS = ["note", "scale", "melody", "range"];

function sine(frequency, seconds, sampleRate, amplitude = 0.5, phase = 0) {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin(2 * Math.PI * frequency * (index / sampleRate) + phase);
  }
  return samples;
}

/** Harmonic tone with amplitude 1/k per harmonic, optionally detuned by some cents. */
function harmonicTone(midi, detuneCents, seconds, sampleRate, harmonics = 10) {
  const f0 = 440 * 2 ** ((midi - 69) / 12) * 2 ** (detuneCents / 1200);
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let k = 1; k <= harmonics; k += 1) {
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] += (0.2 / k) * Math.sin(2 * Math.PI * f0 * k * (index / sampleRate) + k);
    }
  }
  return samples;
}

// ---------------------------------------------------------------------------------------------
// FFT

test("fftInPlace matches a direct DFT", () => {
  const size = 64;
  const plan = createFftPlan(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let seed = 12345;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  };
  for (let index = 0; index < size; index += 1) {
    re[index] = random();
    im[index] = random();
  }
  const inputRe = Float64Array.from(re);
  const inputIm = Float64Array.from(im);
  fftInPlace(plan, re, im);
  for (let k = 0; k < size; k += 1) {
    let expectedRe = 0;
    let expectedIm = 0;
    for (let n = 0; n < size; n += 1) {
      const angle = (-2 * Math.PI * k * n) / size;
      expectedRe += inputRe[n] * Math.cos(angle) - inputIm[n] * Math.sin(angle);
      expectedIm += inputRe[n] * Math.sin(angle) + inputIm[n] * Math.cos(angle);
    }
    assert.ok(Math.abs(re[k] - expectedRe) < 1e-9, `bin ${k} real part`);
    assert.ok(Math.abs(im[k] - expectedIm) < 1e-9, `bin ${k} imaginary part`);
  }
});

test("fftInPlace puts a bin-centred cosine into exactly one bin and rejects odd sizes", () => {
  const size = 256;
  const plan = createFftPlan(size);
  const re = Float64Array.from({ length: size }, (_, n) => Math.cos((2 * Math.PI * 9 * n) / size));
  const im = new Float64Array(size);
  fftInPlace(plan, re, im);
  assert.ok(Math.abs(Math.hypot(re[9], im[9]) - size / 2) < 1e-9);
  assert.ok(Math.abs(Math.hypot(re[size - 9], im[size - 9]) - size / 2) < 1e-9);
  assert.ok(Math.hypot(re[10], im[10]) < 1e-9);
  assert.throws(() => createFftPlan(100), RangeError);
  assert.throws(() => createFftPlan(1), RangeError);
});

test("hannSymmetric follows numpy.hanning", () => {
  const window = hannSymmetric(5);
  const expected = [0, 0.5, 1, 0.5, 0];
  expected.forEach((value, index) => assert.ok(Math.abs(window[index] - value) < 1e-12));
  assert.equal(hannSymmetric(1)[0], 1);
});

// ---------------------------------------------------------------------------------------------
// Loudness

test("A-weighting is 1 at 1 kHz and follows the IEC 61672 curve", () => {
  assert.equal(aWeightingGain(1000), 1);
  const iec = { 50: -30.2, 100: -19.1, 200: -10.9, 500: -3.2, 2000: 1.2, 4000: 1.0, 8000: -1.1, 10000: -2.5 };
  for (const [frequency, expected] of Object.entries(iec)) {
    const db = gainToDb(aWeightingGain(Number(frequency)));
    assert.ok(Math.abs(db - expected) < 0.15, `${frequency} Hz: ${db.toFixed(2)} dB vs ${expected} dB`);
  }
  assert.ok(Math.abs(gainToDb(dbToGain(-12.5)) + 12.5) < 1e-9);
});

test("spectrogram power follows mean-square, A-weighting and gating", () => {
  const sampleRate = 48_000;
  const tone = sine(1000, 1, sampleRate, 0.5);
  const spectrogram = computeSpectrogram(tone, sampleRate);
  const middle = spectrogram.weightedPower[Math.floor(spectrogram.frames / 2)];
  assert.ok(Math.abs(10 * Math.log10(middle / 0.125)) < 0.1, "a 0.5 amplitude sine has mean square 0.125");
  assert.ok(Math.abs(gatedLoudnessDb(spectrogram) - 10 * Math.log10(0.125)) < 0.2);

  // the same tone followed by silence is as loud, because silent frames are gated out
  const padded = new Float32Array(sampleRate * 3);
  padded.set(tone);
  assert.ok(Math.abs(gatedLoudnessDb(computeSpectrogram(padded, sampleRate)) - gatedLoudnessDb(spectrogram)) < 0.2);

  // the same amplitude at other frequencies reads as the A-weighting curve says
  const reference = gatedLoudnessDb(spectrogram);
  for (const [frequency, expected, tolerance] of [[100, -19.1, 0.5], [500, -3.2, 0.3], [2000, 1.2, 0.3]]) {
    const level = gatedLoudnessDb(computeSpectrogram(sine(frequency, 1, sampleRate, 0.5), sampleRate));
    assert.ok(Math.abs(level - reference - expected) < tolerance, `${frequency} Hz offset ${(level - reference).toFixed(2)} dB, expected ${expected}`);
  }

  assert.equal(gatedLoudnessDb(computeSpectrogram(new Float32Array(sampleRate), sampleRate)), -120);
});

test("spectrogram bins land where the frequencies are", () => {
  const sampleRate = 44_100;
  const spectrogram = computeSpectrogram(sine(2000, 0.6, sampleRate, 0.4), sampleRate, { fftSize: 4096 });
  const frame = Math.floor(spectrogram.frames / 2);
  let peakBin = 0;
  for (let bin = 1; bin < spectrogram.bins; bin += 1) {
    if (spectrogram.db[frame * spectrogram.bins + bin] > spectrogram.db[frame * spectrogram.bins + peakBin]) peakBin = bin;
  }
  assert.ok(Math.abs(peakBin * spectrogram.binHz - 2000) <= spectrogram.binHz, `peak at ${peakBin * spectrogram.binHz} Hz`);
  assert.ok(spectrogram.bins * spectrogram.binHz <= 10_000 + spectrogram.binHz);
  assert.ok(Math.abs(spectrogram.maxDb - Math.max(...spectrogram.db)) < 1e-3);
});

test("matchLoudness equalises levels and shrinks both gains together at the peak limit", () => {
  const free = matchLoudness([-20, -26], [0.3, 0.4], -20, 0.9);
  assert.ok(Math.abs(free.gains[0] - 1) < 1e-12);
  assert.ok(Math.abs(free.gains[1] - dbToGain(6)) < 1e-12);
  assert.equal(free.matchedDb, -20);

  const limited = matchLoudness([-20, -26], [0.3, 0.6], -20, 0.9);
  const after = [-20, -26].map((level, index) => level + gainToDb(limited.gains[index]));
  assert.ok(Math.abs(after[0] - after[1]) < 1e-9, "levels stay equal after shrinking");
  assert.ok(Math.abs(after[0] - limited.matchedDb) < 1e-9);
  assert.ok(limited.gains[1] * 0.6 <= 0.9 + 1e-12);
  assert.ok(Math.abs(limited.gains[1] * 0.6 - 0.9) < 1e-9, "the loudest peak lands on the limit");
});

// ---------------------------------------------------------------------------------------------
// Harmonic profile

test("measureHarmonics recovers the harmonic levels and the pitch of a detuned tone", () => {
  const sampleRate = 44_100;
  const tone = harmonicTone(57, 20, 1.2, sampleRate);
  const profile = measureHarmonics(tone, sampleRate, 57, 0.6);
  assert.ok(profile, "a profile is measured");
  assert.ok(Math.abs(profile.centsFromNominal - 20) < 3, `pitch ${profile.centsFromNominal.toFixed(1)} cents`);
  assert.ok(profile.db.length >= 10);
  assert.ok(Math.abs(profile.db[0]) < 0.3, "the strongest harmonic is the 0 dB reference");
  for (let k = 2; k <= 10; k += 1) {
    const expected = 20 * Math.log10(1 / k);
    assert.ok(Math.abs(profile.db[k - 1] - expected) < 0.7, `harmonic ${k}: ${profile.db[k - 1].toFixed(2)} vs ${expected.toFixed(2)} dB`);
  }
});

test("measureHarmonics refuses silence and clips that are too short", () => {
  const sampleRate = 44_100;
  assert.equal(measureHarmonics(new Float32Array(sampleRate), sampleRate, 57, 0.5), null);
  assert.equal(measureHarmonics(harmonicTone(57, 0, 0.05, sampleRate), sampleRate, 57, 0.03), null);
});

test("profile statistics: shares sum to one and the error ignores overall level", () => {
  const reference = [0, -6, -12, -18, -24, -30];
  const shares = profileShares(reference);
  const total = shares.reduce((sum, value) => sum + 10 ** (value / 10), 0);
  assert.ok(Math.abs(total - 1) < 1e-9);

  assert.equal(weightedProfileError(reference, reference), 0);
  const louder = reference.map((value) => value + 7);
  assert.ok(weightedProfileError(louder, reference) < 1e-9, "a constant offset is not a timbre difference");

  const brighter = reference.map((value, index) => (index === 2 ? value + 6 : value));
  const error = weightedProfileError(brighter, reference);
  assert.ok(error > 0.5 && error < 6, `one harmonic +6 dB gives ${error.toFixed(2)} dB`);
  assert.ok(Number.isNaN(weightedProfileError([], reference)));
});

// ---------------------------------------------------------------------------------------------
// Phrases

test("midiName and writtenMidi", () => {
  assert.equal(midiName(60), "C4");
  assert.equal(midiName(69), "A4");
  assert.equal(midiName(56), "G♯3");
  assert.equal(midiName(49), "C♯3");
  assert.equal(midiName(0), "C-1");
  assert.equal(writtenMidi(57, "alto"), 66);
  assert.equal(writtenMidi(57, "tenor"), 71);
  assert.equal(writtenMidi(57, "soprano"), 59);
});

test("the lab covers the instruments the model has profiles for, over renderable notes", () => {
  assert.deepEqual([...INSTRUMENTS].sort(), Object.keys(SAX_MODEL_PROFILES).sort());
  assert.deepEqual([...INSTRUMENTS].sort(), Object.keys(INSTRUMENT_RANGE).sort());
  for (const instrument of INSTRUMENTS) {
    const { lo, hi } = INSTRUMENT_RANGE[instrument];
    for (const midi of [lo, hi]) {
      const { samples } = renderSaxTone({ instrument, midi, duration: 0.8, sampleRate: 44_100 });
      let peak = 0;
      for (const value of samples) {
        assert.ok(Number.isFinite(value), `${instrument} ${midi}: finite samples`);
        peak = Math.max(peak, Math.abs(value));
      }
      assert.ok(peak > 0.05 && peak < 1, `${instrument} ${midi}: peak ${peak.toFixed(3)}`);
    }
  }
});

test("every phrase stays inside the instrument's range for every allowed root", () => {
  for (const instrument of INSTRUMENTS) {
    const { lo, hi } = INSTRUMENT_RANGE[instrument];
    for (const material of MATERIALS) {
      const { min, max } = rootBounds(material, instrument);
      assert.ok(min >= lo && max <= hi && min <= max, `${instrument} ${material} bounds`);
      for (let root = min; root <= max; root += 1) {
        const phrase = buildPhrase(material, instrument, root);
        for (const note of phrase.notes) {
          assert.ok(note.midi >= lo && note.midi <= hi, `${instrument} ${material} root ${root}: note ${note.midi}`);
        }
      }
    }
  }
});

test("roots are clamped into the allowed span", () => {
  assert.equal(clampRoot("note", "alto", 10), 49);
  assert.equal(clampRoot("note", "alto", 200), 80);
  assert.equal(clampRoot("scale", "alto", 200), 68, "an octave scale leaves room for its top note");
  assert.equal(clampRoot("melody", "tenor", 200), 76 - 9);
  assert.equal(clampRoot("range", "soprano", 70), 56, "the range walk has a fixed start");
  assert.equal(clampRoot("note", "tenor", 60.4), 60);
  assert.deepEqual(buildPhrase("note", "alto", 200).notes.map((note) => note.midi), [80]);
});

test("phrase timing is ordered, gap-free and consistent with its length", () => {
  for (const instrument of INSTRUMENTS) {
    for (const material of MATERIALS) {
      const phrase = buildPhrase(material, instrument, 60);
      assert.ok(phrase.notes.length >= 1);
      assert.equal(phrase.notes[0].t, 0);
      for (let index = 1; index < phrase.notes.length; index += 1) {
        const previous = phrase.notes[index - 1];
        assert.ok(Math.abs(previous.t + previous.len - phrase.notes[index].t) < 1e-9, `${material}: note ${index} follows the previous one`);
      }
      const last = phrase.notes[phrase.notes.length - 1];
      assert.ok(Math.abs(phrase.length - (last.t + last.len)) < 1e-9);
      assert.ok(phrase.length >= 2 && phrase.length <= 8, `${material} lasts ${phrase.length.toFixed(2)} s`);
      assert.ok(phrase.analysisIndex >= 0 && phrase.analysisIndex < phrase.notes.length);
    }
  }
});

test("the range walk climbs from the lowest to the highest note", () => {
  for (const instrument of INSTRUMENTS) {
    const { lo, hi } = INSTRUMENT_RANGE[instrument];
    const notes = buildPhrase("range", instrument, 99).notes;
    assert.equal(notes.length, 6);
    assert.equal(notes[0].midi, lo);
    assert.equal(notes[notes.length - 1].midi, hi);
    for (let index = 1; index < notes.length; index += 1) assert.ok(notes[index].midi > notes[index - 1].midi);
  }
});

test("scale and melody shapes", () => {
  const scale = buildPhrase("scale", "alto", 57);
  assert.deepEqual(scale.notes.map((note) => note.midi - 57), [0, 2, 4, 5, 7, 9, 11, 12]);
  const melody = buildPhrase("melody", "alto", 57);
  assert.deepEqual(melody.notes.map((note) => note.midi - 57), [0, 4, 7, 9, 7, 4, 2, 0]);
  assert.equal(melody.notes[melody.notes.length - 1].len, 3 * 0.68);
});

test("analysable notes are long enough and their centre lies inside the note", () => {
  for (const instrument of INSTRUMENTS) {
    for (const material of MATERIALS) {
      const phrase = buildPhrase(material, instrument, 58);
      const indices = analysableNotes(phrase);
      assert.ok(indices.includes(phrase.analysisIndex), `${material}: the default analysis note is analysable`);
      for (const index of indices) {
        const note = phrase.notes[index];
        assert.ok(note.len >= 0.6);
        const centre = analysisCentre(note);
        assert.ok(centre > note.t && centre < note.t + note.len);
      }
      for (let index = 0; index < phrase.notes.length; index += 1) {
        if (!indices.includes(index)) assert.ok(phrase.notes[index].len < 0.6);
      }
    }
  }
});
