import assert from "node:assert/strict";
import test from "node:test";

import {
  SAX_MODEL_PROFILES,
  renderSaxTone,
  renderSaxToneProgressive,
  resolveSaxToneControls,
  saxAttackSeconds,
  saxBodyFilterDb,
  saxHarmonicLevelDb,
  saxToneLength,
} from "../lib/sax-model.ts";

const SAMPLE_RATE = 48_000;
const INSTRUMENTS = ["alto", "tenor", "soprano"];
const RANGES = { alto: [49, 80], tenor: [44, 76], soprano: [56, 88] };
const FFT_SIZE = 1 << 16;

function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += length) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < length / 2; k += 1) {
        const a = i + k;
        const b = a + length / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** Hann-windowed power spectrum of samples[from .. from + length). */
function powerSpectrum(samples, from, length) {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < length; i += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
    re[i] = samples[from + i] * window;
  }
  fft(re, im);
  const power = new Float64Array(FFT_SIZE / 2);
  for (let i = 0; i < power.length; i += 1) power[i] = re[i] * re[i] + im[i] * im[i];
  return power;
}

function sustainSpectrum(samples) {
  const from = Math.round(0.4 * SAMPLE_RATE);
  return powerSpectrum(samples, from, Math.round(0.8 * SAMPLE_RATE));
}

function binHz(bin) {
  return (bin * SAMPLE_RATE) / FFT_SIZE;
}

/** Frequency of the strongest peak within +-3 % of `expected`, with parabolic refinement. */
function peakNear(power, expected) {
  const lo = Math.floor((expected * 0.97 * FFT_SIZE) / SAMPLE_RATE);
  const hi = Math.ceil((expected * 1.03 * FFT_SIZE) / SAMPLE_RATE);
  let best = lo;
  for (let i = lo; i <= hi; i += 1) if (power[i] > power[best]) best = i;
  const a = Math.log(power[best - 1] + 1e-30);
  const b = Math.log(power[best] + 1e-30);
  const c = Math.log(power[best + 1] + 1e-30);
  const shift = (0.5 * (a - c)) / (a - 2 * b + c);
  return binHz(best + shift);
}

function aWeighting(frequency) {
  const f2 = frequency * frequency;
  const c = 12_194 ** 2;
  return (c * f2 * f2 * 1.2589) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + c));
}

function aLevelDb(power) {
  let sum = 0;
  for (let i = 1; i < power.length; i += 1) sum += power[i] * aWeighting(binHz(i)) ** 2;
  return 10 * Math.log10(sum + 1e-30);
}

function centroid(power, maxHz = 8000) {
  let weighted = 0;
  let total = 0;
  for (let i = 1; i < power.length && binHz(i) < maxHz; i += 1) {
    weighted += binHz(i) * power[i];
    total += power[i];
  }
  return weighted / total;
}

/** Power between the harmonics (midway between k and k+1) relative to the harmonics themselves, in dB. */
function noiseToHarmonicDb(power, f0) {
  let harmonics = 0;
  let between = 0;
  let count = 0;
  for (let k = 1; k <= 12; k += 1) {
    const low = Math.round(((k + 0.3) * f0 * FFT_SIZE) / SAMPLE_RATE);
    const high = Math.round(((k + 0.7) * f0 * FFT_SIZE) / SAMPLE_RATE);
    for (let i = low; i <= high; i += 1) {
      between += power[i];
      count += 1;
    }
    const centre = Math.round((k * f0 * FFT_SIZE) / SAMPLE_RATE);
    for (let i = centre - 40; i <= centre + 40; i += 1) harmonics += power[i];
  }
  return 10 * Math.log10(between / count / (harmonics / 12 / 81) + 1e-30);
}

function peakOf(samples) {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  return peak;
}

function render(overrides = {}) {
  return renderSaxTone({
    midi: 62,
    instrument: "alto",
    duration: 1.42,
    sampleRate: SAMPLE_RATE,
    ...overrides,
  }).samples;
}

test("renders finite, deterministic notes of exactly the requested length", () => {
  for (const instrument of INSTRUMENTS) {
    const [low, high] = RANGES[instrument];
    for (const midi of [low, Math.round((low + high) / 2), high]) {
      for (const sampleRate of [22_050, 44_100, 48_000]) {
        const options = { midi, instrument, duration: 1.1, sampleRate, seed: 3 };
        const first = renderSaxTone(options);
        const second = renderSaxTone(options);
        assert.equal(first.sampleRate, sampleRate);
        assert.equal(first.samples.length, saxToneLength(1.1, sampleRate));
        assert.ok(first.samples.every(Number.isFinite));
        assert.ok(peakOf(first.samples) > 0.02, `${instrument} ${midi} is audible`);
        assert.ok(peakOf(first.samples) < 0.95, `${instrument} ${midi} stays below the soft clip`);
        assert.ok(Math.abs(first.samples.at(-1)) < 1e-3, "ends in silence so playback cannot click");
        assert.deepEqual(first.samples, second.samples, "same seed -> same samples");
      }
    }
  }

  const a = render({ seed: 0 });
  const b = render({ seed: 1 });
  let differing = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) differing += 1;
  assert.ok(differing > a.length * 0.9, "another seed gives another realisation");
});

test("starts silent and rises smoothly instead of clicking", () => {
  for (const instrument of INSTRUMENTS) {
    const samples = render({ instrument, midi: RANGES[instrument][0] + 12 });
    assert.ok(Math.abs(samples[0]) < 1e-3);
    let largestStep = 0;
    for (let i = 1; i < samples.length; i += 1) largestStep = Math.max(largestStep, Math.abs(samples[i] - samples[i - 1]));
    assert.ok(largestStep < 0.25, `${instrument}: largest sample step ${largestStep}`);
  }
});

test("plays the requested pitch within a few cents in every register", () => {
  for (const instrument of INSTRUMENTS) {
    const [low, high] = RANGES[instrument];
    for (const midi of [low, low + 7, Math.round((low + high) / 2), high - 5, high]) {
      const f0 = midiToHz(midi);
      const harmonic = f0 > 600 ? 2 : f0 > 250 ? 3 : 4;
      const samples = render({ midi, instrument, controls: { vibratoDepth: 0 } });
      const measured = peakNear(sustainSpectrum(samples), f0 * harmonic) / harmonic;
      const cents = 1200 * Math.log2(measured / f0);
      assert.ok(Math.abs(cents) < 5, `${instrument} midi ${midi}: ${cents.toFixed(1)} cents`);
    }
  }
});

test("has a real harmonic structure: strong partials, weak aspiration between them", () => {
  for (const instrument of INSTRUMENTS) {
    const midi = RANGES[instrument][0] + 12;
    const f0 = midiToHz(midi);
    const power = sustainSpectrum(render({ midi, instrument, controls: { vibratoDepth: 0 } }));
    const floor = noiseToHarmonicDb(power, f0);
    assert.ok(floor < -36, `${instrument}: between-harmonic level ${floor.toFixed(1)} dB`);
    assert.ok(floor > -56, `${instrument}: some breath noise is present (${floor.toFixed(1)} dB)`);
    const fundamental = peakNear(power, f0);
    const fourth = peakNear(power, 4 * f0);
    assert.ok(Math.abs(fundamental / f0 - 1) < 0.01 && Math.abs(fourth / (4 * f0) - 1) < 0.01);
  }
});

test("equalises perceived loudness across the whole register", () => {
  for (const instrument of INSTRUMENTS) {
    const [low, high] = RANGES[instrument];
    const levels = [];
    for (let midi = low; midi <= high; midi += 1) {
      levels.push(aLevelDb(sustainSpectrum(render({ midi, instrument, controls: { vibratoDepth: 0 } }))));
    }
    const spread = Math.max(...levels) - Math.min(...levels);
    assert.ok(spread < 1.6, `${instrument}: A-weighted level spread ${spread.toFixed(2)} dB`);
  }
});

test("playing louder is louder and brighter but never clips", () => {
  for (const instrument of INSTRUMENTS) {
    const midi = RANGES[instrument][0] + 10;
    const results = [0.35, 0.72, 1].map((intensity) => {
      const samples = render({ midi, instrument, intensity, controls: { vibratoDepth: 0 } });
      const power = sustainSpectrum(samples);
      return { level: aLevelDb(power), centroid: centroid(power), peak: peakOf(samples) };
    });
    assert.ok(results[0].level + 3 < results[1].level, `${instrument}: soft -> reference`);
    assert.ok(results[1].level + 1 < results[2].level, `${instrument}: reference -> loud`);
    assert.ok(results[0].centroid < results[1].centroid && results[1].centroid < results[2].centroid);
    assert.ok(results[2].peak < 0.85, `${instrument}: loud peak ${results[2].peak.toFixed(2)}`);
  }
  // an extreme setting is bounded by the soft clipper rather than wrapping or exploding
  const extreme = render({ intensity: 1, controls: { brightness: 2, breath: 3, tongue: 3, life: 3 } });
  assert.ok(extreme.every(Number.isFinite));
  assert.ok(peakOf(extreme) < 1);
});

test("tone controls move the sound in the promised direction", () => {
  const f0 = midiToHz(62);
  const spectrum = (controls) => sustainSpectrum(render({ controls: { vibratoDepth: 0, ...controls } }));

  const dark = centroid(spectrum({ brightness: 0.6 }));
  const normal = centroid(spectrum({ brightness: 1 }));
  const bright = centroid(spectrum({ brightness: 1.5 }));
  assert.ok(dark < normal && normal < bright, `centroid ${dark.toFixed(0)} < ${normal.toFixed(0)} < ${bright.toFixed(0)}`);

  const none = noiseToHarmonicDb(spectrum({ breath: 0 }), f0);
  const some = noiseToHarmonicDb(spectrum({ breath: 1 }), f0);
  const lots = noiseToHarmonicDb(spectrum({ breath: 2.5 }), f0);
  assert.ok(none + 6 < some && some + 4 < lots, `noise ${none.toFixed(1)} < ${some.toFixed(1)} < ${lots.toFixed(1)} dB`);

  const rise = (attack) => {
    const samples = render({ midi: 66, controls: { attack, tongue: 0, vibratoDepth: 0 } });
    const window = Math.round(0.004 * SAMPLE_RATE);
    let sustain = 0;
    for (let i = Math.round(0.5 * SAMPLE_RATE); i < Math.round(0.9 * SAMPLE_RATE); i += 1) sustain = Math.max(sustain, Math.abs(samples[i]));
    for (let start = 0; start < samples.length - window; start += window) {
      let peak = 0;
      for (let i = start; i < start + window; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
      if (peak >= 0.9 * sustain) return start / SAMPLE_RATE;
    }
    return Number.POSITIVE_INFINITY;
  };
  const sharp = rise(0.5);
  const soft = rise(2);
  assert.ok(sharp < soft, `attack: ${sharp.toFixed(3)} s < ${soft.toFixed(3)} s`);
});

test("keeps the three saxophones spectrally distinct", () => {
  const centroids = INSTRUMENTS.map((instrument) =>
    centroid(sustainSpectrum(render({ midi: 64, instrument, controls: { vibratoDepth: 0 } }))),
  );
  for (let a = 0; a < centroids.length; a += 1) {
    for (let b = a + 1; b < centroids.length; b += 1) {
      assert.ok(Math.abs(centroids[a] / centroids[b] - 1) > 0.04, `${INSTRUMENTS[a]} vs ${INSTRUMENTS[b]}`);
    }
  }
  assert.deepEqual(Object.keys(SAX_MODEL_PROFILES).sort(), ["alto", "soprano", "tenor"]);
  for (const profile of Object.values(SAX_MODEL_PROFILES)) {
    assert.ok(profile.vibratoRate >= 4.5 && profile.vibratoRate <= 6);
    assert.ok(profile.vibratoDepth >= 8 && profile.vibratoDepth <= 16);
  }
});

test("exposes the fitted spectral model for inspection", () => {
  // body response is smooth and band-limited; level falls with harmonic number
  assert.ok(saxBodyFilterDb(1500) > saxBodyFilterDb(120));
  assert.ok(saxBodyFilterDb(1500) > saxBodyFilterDb(9000));
  assert.ok(Number.isFinite(saxBodyFilterDb(10)) && Number.isFinite(saxBodyFilterDb(30_000)));
  for (const instrument of INSTRUMENTS) {
    assert.ok(saxHarmonicLevelDb(instrument, 250, 12) < saxHarmonicLevelDb(instrument, 250, 3));
    assert.ok(saxHarmonicLevelDb(instrument, 250, 6, 1.4) > saxHarmonicLevelDb(instrument, 250, 6, 1));
  }
  // low notes speak slowly, the middle register quickly
  assert.ok(saxAttackSeconds(49) > saxAttackSeconds(66) * 1.5);
  assert.ok(saxAttackSeconds(66) >= saxAttackSeconds(80));
});

test("sanitises tone controls", () => {
  const defaults = resolveSaxToneControls("alto", undefined);
  assert.equal(defaults.brightness, 1);
  assert.equal(defaults.vibratoDepth, SAX_MODEL_PROFILES.alto.vibratoDepth);
  assert.equal(defaults.vibratoRate, SAX_MODEL_PROFILES.alto.vibratoRate);

  const messy = resolveSaxToneControls("tenor", {
    brightness: Number.NaN,
    breath: Number.POSITIVE_INFINITY,
    attack: -4,
    tongue: 99,
    vibratoDepth: 500,
    vibratoRate: 0,
    release: "loud",
  });
  assert.equal(messy.brightness, 1);
  assert.equal(messy.breath, 1);
  assert.equal(messy.attack, 0.3);
  assert.equal(messy.tongue, 3);
  assert.equal(messy.vibratoDepth, 60);
  assert.equal(messy.vibratoRate, 2);
  assert.equal(messy.release, 1);
  assert.equal(resolveSaxToneControls("tenor", undefined).vibratoDepth, SAX_MODEL_PROFILES.tenor.vibratoDepth);
});

test("rejects unusable sample rates and clamps absurd requests", () => {
  assert.throws(() => renderSaxTone({ midi: 60, instrument: "alto", duration: 1, sampleRate: 100 }), RangeError);
  assert.throws(() => renderSaxTone({ midi: 60, instrument: "alto", duration: 1, sampleRate: 1e9 }), RangeError);
  const clamped = renderSaxTone({ midi: 500, instrument: "soprano", duration: 0.001, sampleRate: 16_000 });
  assert.equal(clamped.samples.length, saxToneLength(0.2, 16_000));
  assert.ok(clamped.samples.every(Number.isFinite));
});

test("progressive rendering yields in slices and matches the synchronous render exactly", () => {
  const options = { midi: 57, instrument: "tenor", duration: 1.42, sampleRate: SAMPLE_RATE, seed: 5 };
  const job = renderSaxToneProgressive(options, 96);
  let slices = 0;
  let previous = 0;
  let step = job.next();
  while (!step.done) {
    assert.ok(step.value > previous && step.value < 1, "progress increases and stays below 1 until done");
    previous = step.value;
    slices += 1;
    step = job.next();
  }
  assert.ok(slices >= 8, `a 1.42 s note is rendered in ${slices} slices`);
  assert.deepEqual(step.value.samples, renderSaxTone(options).samples);
});

test("renders a note in a small fraction of its duration", () => {
  render(); // warm up the JIT
  const started = performance.now();
  for (const midi of [50, 62, 74]) render({ midi });
  const perNote = (performance.now() - started) / 3;
  // typically 15-40 ms; the generous bound only catches algorithmic regressions
  assert.ok(perNote < 600, `${perNote.toFixed(0)} ms per 1.42 s note`);
});
