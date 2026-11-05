// SaxTone listening lab: renders the same phrase with SaxTone 2.0 and 3.0 through the real engine,
// matches their loudness, and lets the listener switch between them (open or blind).

import { resolveSaxToneControls } from "../../../../lib/sax-model.ts";
import { SAX_SYNTH_CLASSIC_VERSION, SAX_SYNTH_VERSION, type SaxToneControls } from "../../../../lib/sax-synth.ts";
import {
  HarmonicChart,
  drawSpectrogram,
  legendSwatch,
  type HarmonicSeries,
  type PlotRect,
  type SeriesShape,
} from "./charts.ts";
import {
  computeSpectrogram,
  gatedLoudnessDb,
  matchLoudness,
  measureHarmonics,
  profileShares,
  weightedProfileError,
  type HarmonicProfile,
  type Spectrogram,
} from "./dsp.ts";
import {
  analysableNotes,
  analysisCentre,
  buildPhrase,
  clampRoot,
  midiName,
  rootBounds,
  writtenMidi,
  type Instrument,
  type Material,
  type Phrase,
} from "./phrases.ts";
import { ClipPlayer } from "./player.ts";
import { REFERENCE_ALTO_HARMONICS } from "./ref-alto.ts";
import { clipsIdentical, renderClip, type RenderedClip } from "./render.ts";

type Engine = "classic" | "model";
type Overrides = { -readonly [Key in keyof SaxToneControls]?: SaxToneControls[Key] };
type Criterion = "real" | "nice";
type Winner = Engine | "same";

const ENGINES: readonly Engine[] = ["classic", "model"];
const ENGINE_META: Readonly<Record<Engine, { name: string; sub: string; color: string; shape: SeriesShape; short: string }>> = {
  classic: { name: SAX_SYNTH_CLASSIC_VERSION, sub: "이전 엔진 · 실시간 합성", color: "var(--s1)", shape: "circle", short: "2.0" },
  model: { name: SAX_SYNTH_VERSION, sub: "새 모델 · 녹음 분석 기반", color: "var(--s2)", shape: "square", short: "3.0" },
};
const REFERENCE_META = { label: "녹음", legend: "실제 알토 녹음(측정값)", color: "var(--s3)", shape: "diamond" as SeriesShape };

/** A-weighted level the louder-matched pair is brought to (dB re full scale, mean square). */
const TARGET_LEVEL_DB = -20;
const PEAK_LIMIT = 0.9;
const SPECTROGRAM_RANGE_DB = 66;
const PROFILE_HARMONICS = 24;

interface LabState {
  instrument: Instrument;
  material: Material;
  root: number;
  intensity: number;
  volume: number;
  match: boolean;
  wide: boolean;
  mode: "ab" | "blind";
  overrides: Overrides;
  analysisIndex: number | null;
}

interface EngineView {
  readonly clip: RenderedClip;
  readonly spectrogram: Spectrogram;
  readonly levelDb: number;
}

interface BlindRound {
  order: [Engine, Engine];
  heard: [boolean, boolean];
  answer: { choice: 0 | 1 | "same"; winner: Winner; criterion: Criterion } | null;
}

interface Slot {
  readonly card: HTMLElement;
  readonly chip: HTMLElement;
  readonly title: HTMLElement;
  readonly sub: HTMLElement;
  readonly key: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly label: HTMLElement;
  readonly metrics: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly playhead: HTMLElement;
  readonly veil: HTMLElement;
  plot: PlotRect | null;
}

interface SliderDef {
  readonly key: keyof SaxToneControls;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly digits: number;
  readonly hint: string;
}

const SLIDERS: readonly SliderDef[] = [
  { key: "brightness", label: "밝기", min: 0, max: 2, step: 0.05, unit: "", digits: 2, hint: "높은 배음의 세기. 올리면 선명하고 날카로워집니다." },
  { key: "breath", label: "숨소리", min: 0, max: 2.5, step: 0.05, unit: "", digits: 2, hint: "음 사이를 채우는 바람 소리의 양." },
  { key: "attack", label: "어택 길이", min: 0.4, max: 2.5, step: 0.05, unit: "", digits: 2, hint: "소리가 올라오는 시간. 올리면 부드럽게 시작합니다." },
  { key: "tongue", label: "텅잉 소리", min: 0, max: 2.5, step: 0.05, unit: "", digits: 2, hint: "음을 시작할 때 혀가 닿는 소리." },
  { key: "life", label: "생동감", min: 0, max: 2.5, step: 0.05, unit: "", digits: 2, hint: "음량과 음정이 미세하게 흔들리는 정도." },
  { key: "vibratoDepth", label: "비브라토 깊이", min: 0, max: 40, step: 1, unit: " 센트", digits: 0, hint: "0이면 비브라토 없이 곧은 소리." },
  { key: "vibratoRate", label: "비브라토 속도", min: 3, max: 8, step: 0.1, unit: " Hz", digits: 1, hint: "초당 흔들리는 횟수." },
  { key: "vibratoDelay", label: "비브라토 시작", min: 0, max: 1.5, step: 0.05, unit: " 초", digits: 2, hint: "음이 나온 뒤 비브라토가 시작되기까지의 시간." },
  { key: "release", label: "끝맺음 길이", min: 0.4, max: 2.5, step: 0.05, unit: "", digits: 2, hint: "음이 끝날 때 줄어드는 시간." },
];

// ---------------------------------------------------------------------------------------------
// DOM helpers

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} is missing`);
  return element as T;
}

function inside<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`${selector} is missing`);
  return element as T;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

// ---------------------------------------------------------------------------------------------
// State

const state: LabState = {
  instrument: "alto",
  material: "note",
  root: 62,
  intensity: 0.72,
  volume: 0.85,
  match: true,
  wide: false,
  mode: "ab",
  overrides: {},
  analysisIndex: null,
};

const views: Partial<Record<Engine, EngineView>> = {};
const dirty: Record<Engine, boolean> = { classic: true, model: true };
let phrase: Phrase = buildPhrase(state.material, state.instrument, state.root);
let renderSeq = 0;
let renderTimer = 0;
let lastRenderInfo = "";
let identicalWarning = false;
let gains: Record<Engine, number> = { classic: 1, model: 1 };

const player = new ClipPlayer();
const tally: Record<Criterion, Record<Winner, number>> = {
  real: { model: 0, classic: 0, same: 0 },
  nice: { model: 0, classic: 0, same: 0 },
};
let criterion: Criterion = "real";
let round: BlindRound = newRound();

function newRound(): BlindRound {
  const flip = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 1;
  return { order: flip ? ["model", "classic"] : ["classic", "model"], heard: [false, false], answer: null };
}

function slotEngine(index: number): Engine {
  return state.mode === "blind" ? round.order[index] : ENGINES[index];
}

function isRevealed(): boolean {
  return state.mode === "ab" || round.answer !== null;
}

// ---------------------------------------------------------------------------------------------
// Elements

const statusEl = byId("status");
const clockEl = byId("clock");
const stopButton = byId<HTMLButtonElement>("stop");
const slots: Slot[] = [0, 1].map((index) => {
  const card = byId(`clip-${index}`);
  return {
    card,
    chip: inside(card, ".chip"),
    title: inside(card, ".clip-title"),
    sub: inside(card, ".clip-sub"),
    key: inside(card, "kbd.key"),
    button: inside<HTMLButtonElement>(card, ".play"),
    label: inside(card, ".play-label"),
    metrics: inside(card, ".metrics"),
    canvas: inside<HTMLCanvasElement>(card, "canvas.spec"),
    playhead: inside(card, ".playhead"),
    veil: inside(card, ".veil"),
    plot: null,
  };
});
const chart = new HarmonicChart(byId("hchart"));

// ---------------------------------------------------------------------------------------------
// Rendering

function setStatus(text: string, kind: "info" | "warn" | "error" = "info"): void {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function markDirty(which: "both" | "model"): void {
  dirty.model = true;
  if (which === "both") dirty.classic = true;
}

function scheduleRender(delay = 140): void {
  window.clearTimeout(renderTimer);
  renderSeq += 1; // anything still rendering is out of date from now on
  player.stop();
  setStatus("소리를 다시 만드는 중…");
  renderTimer = window.setTimeout(() => void flushRender(), delay);
}

async function renderEngine(engine: Engine, sequence: number): Promise<boolean> {
  const clip = await renderClip({
    mode: engine,
    instrument: state.instrument,
    phrase,
    intensity: state.intensity,
    controls: state.overrides,
  });
  if (sequence !== renderSeq) return false;
  await pause(0);
  if (sequence !== renderSeq) return false;
  const spectrogram = computeSpectrogram(clip.mono, clip.sampleRate, { maxHz: 10_000 });
  views[engine] = { clip, spectrogram, levelDb: gatedLoudnessDb(spectrogram) };
  return true;
}

async function flushRender(): Promise<void> {
  const sequence = renderSeq;
  document.body.removeAttribute("data-ready");
  try {
    for (const engine of ENGINES) {
      if (!dirty[engine]) continue;
      setStatus(`${ENGINE_META[engine].name} 소리를 만드는 중…`);
      await pause(16);
      if (sequence !== renderSeq) return;
      if (!(await renderEngine(engine, sequence))) return;
      dirty[engine] = false;
    }
  } catch (error) {
    setStatus(`소리를 만들지 못했습니다: ${error instanceof Error ? error.message : String(error)}`, "error");
    return;
  }
  if (sequence !== renderSeq) return;
  finishRender();
}

function finishRender(): void {
  const classic = views.classic;
  const model = views.model;
  if (!classic || !model) return;
  identicalWarning = clipsIdentical(classic.clip, model.clip);
  gains = computeGains() ?? gains;
  player.setClips([
    { key: "classic", buffer: classic.clip.buffer, gain: gains.classic },
    { key: "model", buffer: model.clip.buffer, gain: gains.model },
  ]);
  player.setVolume(state.volume);
  lastRenderInfo = `준비됨 · 2.0 ${Math.round(classic.clip.renderMs)} ms, 3.0 ${Math.round(model.clip.renderMs)} ms (구간 전체 렌더 시간)`;
  if (identicalWarning) setStatus("3.0이 만들어지지 않아 2.0 소리로 대체되었습니다. 두 소리가 같게 들립니다.", "warn");
  else setStatus(lastRenderInfo);
  redrawAll();
  document.body.dataset.ready = "1";
}

/** Linear playback gains: both clips at the same A-weighted level, or (match off) the same overall level with the engines' own balance. */
function computeGains(): Record<Engine, number> | null {
  const classic = views.classic;
  const model = views.model;
  if (!classic || !model) return null;
  const match = matchLoudness([classic.levelDb, model.levelDb], [classic.clip.peak, model.clip.peak], TARGET_LEVEL_DB, PEAK_LIMIT);
  if (state.match || state.mode === "blind") return { classic: match.gains[0], model: match.gains[1] };
  const common = Math.sqrt(match.gains[0] * match.gains[1]);
  return {
    classic: Math.min(common, PEAK_LIMIT / classic.clip.peak),
    model: Math.min(common, PEAK_LIMIT / model.clip.peak),
  };
}

function applyGains(): void {
  const next = computeGains();
  if (!next) return;
  gains = next;
  player.setGains(gains);
  renderSlots();
}

// ---------------------------------------------------------------------------------------------
// Drawing

function analysisNote(): { index: number; candidates: number[] } {
  const candidates = analysableNotes(phrase);
  const wanted = state.analysisIndex;
  const index = wanted !== null && candidates.includes(wanted) ? wanted : phrase.analysisIndex;
  return { index, candidates };
}

function redrawAll(): void {
  renderSlots();
  drawSpectrograms();
  updateProfile();
  updateTuningUi();
  updateSummary();
  updatePlayState();
}

function drawSpectrograms(): void {
  const classic = views.classic;
  const model = views.model;
  if (!classic || !model) return;
  const topDb = Math.max(classic.spectrogram.maxDb, model.spectrogram.maxDb);
  const duration = Math.max(classic.clip.durationSeconds, model.clip.durationSeconds);
  const notes = phrase.notes.map((note) => ({ t: note.t, label: midiName(note.midi) }));
  slots.forEach((slot, index) => {
    const view = views[slotEngine(index)];
    if (!view || !isRevealed()) return;
    slot.plot = drawSpectrogram(slot.canvas, view.spectrogram, {
      maxHz: state.wide ? 10_000 : 4_000,
      topDb,
      rangeDb: SPECTROGRAM_RANGE_DB,
      durationSeconds: duration,
      notes,
    });
    const meta = ENGINE_META[slotEngine(index)];
    slot.canvas.setAttribute("aria-label", `${meta.name} 스펙트로그램: 가로 시간, 세로 주파수`);
  });
}

function renderSlots(): void {
  const revealed = isRevealed();
  slots.forEach((slot, index) => {
    const engine = slotEngine(index);
    const meta = ENGINE_META[engine];
    const view = views[engine];
    slot.key.textContent = String(index + 1);
    if (revealed) {
      slot.title.textContent = meta.name;
      slot.sub.textContent = meta.sub;
      slot.chip.innerHTML = legendSwatch(meta);
      slot.card.style.setProperty("--identity", meta.color);
    } else {
      slot.title.textContent = `소리 ${index + 1}`;
      slot.sub.textContent = "";
      slot.chip.innerHTML = legendSwatch({ color: "var(--viz-muted)", shape: "circle" });
      slot.card.style.setProperty("--identity", "var(--viz-muted)");
    }
    slot.veil.hidden = revealed;
    slot.canvas.style.visibility = revealed ? "visible" : "hidden";
    if (!revealed) slot.canvas.setAttribute("aria-label", "스펙트로그램(답을 고르면 공개)");
    slot.button.disabled = !view;
    if (revealed && view) {
      const gainDb = 20 * Math.log10(Math.max(1e-9, gains[engine]));
      slot.metrics.innerHTML =
        `피크 ${view.clip.peak.toFixed(2)} · A가중 음량 ${view.levelDb.toFixed(1)} dB` +
        `<br>재생 이득 ${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB${state.match ? " (음량 맞춤)" : ""}`;
    } else {
      slot.metrics.textContent = revealed ? "" : "음량은 같은 수준으로 맞춰져 있습니다.";
    }
  });
  profileCard().hidden = !revealed;
  updateBlind();
}

function profileCard(): HTMLElement {
  return byId("profile-card");
}

function updateProfile(): void {
  const classic = views.classic;
  const model = views.model;
  if (!classic || !model) return;
  const { index, candidates } = analysisNote();
  const note = phrase.notes[index];

  const select = byId<HTMLSelectElement>("analysis-note");
  select.innerHTML = candidates
    .map((candidate) => {
      const item = phrase.notes[candidate];
      return `<option value="${candidate}"${candidate === index ? " selected" : ""}>${candidate + 1}번째 · ${midiName(item.midi)} (${item.t.toFixed(1)}초)</option>`;
    })
    .join("");
  select.disabled = candidates.length <= 1;

  const centre = analysisCentre(note);
  const measured: Record<Engine, HarmonicProfile | null> = {
    classic: measureHarmonics(classic.clip.mono, classic.clip.sampleRate, note.midi, centre),
    model: measureHarmonics(model.clip.mono, model.clip.sampleRate, note.midi, centre),
  };
  const reference = state.instrument === "alto" ? REFERENCE_ALTO_HARMONICS[note.midi] : undefined;

  const shares = (profile: HarmonicProfile | null): (number | null)[] =>
    profile ? profileShares(profile.db, 30).slice(0, PROFILE_HARMONICS) : [];
  const series: HarmonicSeries[] = ENGINES.map((engine) => ({
    id: engine,
    label: ENGINE_META[engine].short,
    color: ENGINE_META[engine].color,
    shape: ENGINE_META[engine].shape,
    values: shares(measured[engine]),
  }));
  if (reference) {
    series.push({
      id: "reference",
      label: REFERENCE_META.label,
      color: REFERENCE_META.color,
      shape: REFERENCE_META.shape,
      values: profileShares(reference, 30).slice(0, PROFILE_HARMONICS),
    });
  }

  byId("legend").innerHTML = series
    .map((item) => `<span>${legendSwatch(item)}${escapeHtml(item.id === "reference" ? REFERENCE_META.legend : ENGINE_META[item.id as Engine].name)}</span>`)
    .join("");
  const f0 = 440 * 2 ** ((note.midi - 69) / 12);
  chart.update(series, f0, PROFILE_HARMONICS, `${midiName(note.midi)}의 배음 프로필 그래프`);

  const takeaway = byId("takeaway");
  const fine = byId("profile-fine");
  if (reference && measured.classic && measured.model) {
    const errClassic = weightedProfileError(measured.classic.db, reference);
    const errModel = weightedProfileError(measured.model.db, reference);
    takeaway.textContent = `${midiName(note.midi)}에서 녹음과의 차이(가중 RMS): 2.0 ${errClassic.toFixed(1)} dB · 3.0 ${errModel.toFixed(1)} dB`;
    fine.textContent =
      "3.0은 이 녹음(편집을 거친 알토 한 대)에 맞춰 조정된 모델이라 3.0에 유리한 비교입니다. 다른 알토 녹음과도 이만큼 가깝다는 뜻은 아닙니다. 작은 차이는 귀로 구분되지 않을 수 있습니다.";
  } else if (state.instrument === "alto") {
    takeaway.textContent = "이 음에는 비교할 녹음 측정값이 없습니다(측정 범위: C♯3–G♯5).";
    fine.textContent = "";
  } else {
    takeaway.textContent = "테너·소프라노에는 비교할 실제 녹음 측정값이 없습니다.";
    fine.textContent = "테너와 소프라노의 3.0은 샘플러 소리 두 종류를 참고해 맞췄고 근거가 약합니다. 귀로 판단한 결과가 더 중요합니다.";
  }

  const rows: string[] = [];
  for (let k = 1; k <= PROFILE_HARMONICS; k += 1) {
    const cells = series.map((item) => {
      const value = item.values[k - 1];
      return `<td class="num">${value === null || value === undefined ? "–" : value.toFixed(1)}</td>`;
    });
    rows.push(`<tr><td>${k}</td><td class="num">${Math.round(f0 * k).toLocaleString("en-US")}</td>${cells.join("")}</tr>`);
  }
  byId("table-wrap").innerHTML =
    `<table aria-label="배음 크기 표"><thead><tr><th>배음</th><th class="num">Hz</th>${series.map((item) => `<th class="num">${escapeHtml(item.label)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

// ---------------------------------------------------------------------------------------------
// Tuning sliders

function buildSliders(): void {
  const host = byId("sliders");
  host.innerHTML = SLIDERS.map(
    (def) => `
    <div class="slider" id="slider-${def.key}">
      <div class="slider-top"><label for="ctl-${def.key}">${def.label}</label><output id="out-${def.key}" for="ctl-${def.key}"></output></div>
      <input type="range" id="ctl-${def.key}" min="${def.min}" max="${def.max}" step="${def.step}">
      <p class="hint">${def.hint}</p>
    </div>`,
  ).join("");
  for (const def of SLIDERS) {
    byId<HTMLInputElement>(`ctl-${def.key}`).addEventListener("input", (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      const defaults = resolveSaxToneControls(state.instrument, undefined);
      if (Math.abs(value - defaults[def.key]) < def.step / 2) delete state.overrides[def.key];
      else state.overrides[def.key] = value;
      updateTuningUi();
      markDirty("model");
      scheduleRender(260);
    });
  }
  byId("reset-controls").addEventListener("click", () => {
    state.overrides = {};
    updateTuningUi();
    markDirty("model");
    scheduleRender(60);
  });
}

function updateTuningUi(): void {
  const resolved = resolveSaxToneControls(state.instrument, state.overrides);
  const defaults = resolveSaxToneControls(state.instrument, undefined);
  let changed = 0;
  for (const def of SLIDERS) {
    const input = byId<HTMLInputElement>(`ctl-${def.key}`);
    input.value = String(resolved[def.key]);
    const isChanged = def.key in state.overrides;
    if (isChanged) changed += 1;
    byId(`slider-${def.key}`).classList.toggle("is-changed", isChanged);
    byId(`out-${def.key}`).textContent =
      `${resolved[def.key].toFixed(def.digits)}${def.unit}` + (isChanged ? ` (기본 ${defaults[def.key].toFixed(def.digits)})` : "");
    input.setAttribute("aria-valuetext", `${resolved[def.key].toFixed(def.digits)}${def.unit}`);
  }
  byId<HTMLButtonElement>("reset-controls").disabled = changed === 0;
  byId("tuning-note").textContent = changed === 0 ? "모두 기본값입니다." : `${changed}개 항목을 바꿨습니다.`;
}

// ---------------------------------------------------------------------------------------------
// Playback

function updatePlayState(): void {
  const playing = player.playingKey;
  slots.forEach((slot, index) => {
    const active = playing !== null && playing === slotEngine(index);
    slot.button.setAttribute("aria-pressed", String(active));
    slot.label.textContent = active ? "정지" : playing ? "이 소리로 바꾸기" : "재생";
    slot.card.classList.toggle("is-playing", active);
  });
  stopButton.disabled = playing === null;
  ensureFrameLoop();
  if (playing === null) updatePlayheads();
}

let frameHandle = 0;
function ensureFrameLoop(): void {
  if (frameHandle || player.playingKey === null) return;
  frameHandle = requestAnimationFrame(frame);
}
function frame(): void {
  frameHandle = 0;
  updatePlayheads();
  ensureFrameLoop();
}

function updatePlayheads(): void {
  const playing = player.playingKey !== null;
  const duration = player.duration;
  const position = playing ? player.position : 0;
  slots.forEach((slot) => {
    if (!playing || !slot.plot || duration <= 0 || !isRevealed()) {
      slot.playhead.hidden = true;
      return;
    }
    slot.playhead.hidden = false;
    slot.playhead.style.top = `${slot.plot.top}px`;
    slot.playhead.style.height = `${slot.plot.height}px`;
    slot.playhead.style.transform = `translateX(${slot.plot.left + (position / duration) * slot.plot.width - 1}px)`;
  });
  clockEl.textContent = `${formatClock(position)} / ${formatClock(duration)}`;
}

async function toggleSlot(index: number): Promise<void> {
  const engine = slotEngine(index);
  if (!views[engine]) return;
  if (player.playingKey === engine) {
    player.stop();
    return;
  }
  const started = await player.play(engine);
  if (!started) {
    setStatus("소리를 재생하지 못했습니다. 브라우저가 오디오를 막았는지 확인해 주세요.", "warn");
    return;
  }
  if (state.mode === "blind" && !round.answer) {
    round.heard[index] = true;
    updateBlind();
  }
}

// ---------------------------------------------------------------------------------------------
// Blind test

function updateBlind(): void {
  const blind = state.mode === "blind";
  byId("blind").hidden = !blind;
  // Moving a 3.0 slider would change only one of the two sounds and give away which is which.
  const tuningLocked = blind && round.answer === null;
  byId<HTMLFieldSetElement>("tuning-set").disabled = tuningLocked;
  byId("tuning-lock").hidden = !tuningLocked;
  if (!blind) return;
  const answered = round.answer !== null;
  const ready = round.heard[0] && round.heard[1];
  const buttons = [byId<HTMLButtonElement>("ans-0"), byId<HTMLButtonElement>("ans-1"), byId<HTMLButtonElement>("ans-same")];
  buttons.forEach((button) => {
    button.disabled = answered || !ready;
    button.setAttribute("aria-pressed", "false");
  });
  if (answered && round.answer) {
    const pressed = round.answer.choice === "same" ? 2 : round.answer.choice;
    buttons[pressed].setAttribute("aria-pressed", "true");
    buttons.forEach((button) => (button.disabled = true));
  }
  byId("blind-hint").textContent = answered
    ? ""
    : ready
      ? "두 소리를 모두 들었습니다. 고르면 어느 쪽이 어느 엔진이었는지 공개됩니다."
      : "1, 2 키나 위 버튼으로 두 소리를 모두 들은 뒤에 고를 수 있습니다. 재생 중에 바꾸면 같은 위치에서 이어집니다.";
  const reveal = byId("reveal");
  reveal.hidden = !answered;
  if (answered && round.answer) {
    const [first, second] = round.order;
    const picked = round.answer.winner === "same" ? "차이를 모르겠다고 하셨습니다." : `고른 쪽은 <b>${ENGINE_META[round.answer.winner].name}</b>입니다.`;
    byId("reveal-text").innerHTML = `소리 1은 <b>${ENGINE_META[first].name}</b>, 소리 2는 <b>${ENGINE_META[second].name}</b>였습니다. ${picked}`;
  }
  const label: Record<Criterion, string> = { real: "실제 색소폰 같음", nice: "듣기 좋음" };
  byId("tally-body").innerHTML = (["real", "nice"] as const)
    .map((key) => {
      const row = tally[key];
      const total = row.model + row.classic + row.same;
      return `<tr><td>${label[key]}</td><td class="num">${row.model}</td><td class="num">${row.classic}</td><td class="num">${row.same}</td><td class="num">${total}</td></tr>`;
    })
    .join("");
}

function answer(choice: 0 | 1 | "same"): void {
  if (round.answer || !(round.heard[0] && round.heard[1])) return;
  const winner: Winner = choice === "same" ? "same" : round.order[choice];
  round.answer = { choice, winner, criterion };
  tally[criterion][winner] += 1;
  renderSlots();
  drawSpectrograms();
  updateProfile();
  updateSummary();
}

function startRound(): void {
  player.stop();
  round = newRound();
  renderSlots();
  updatePlayState();
  updateSummary();
}

function setMode(mode: "ab" | "blind"): void {
  if (state.mode === mode) return;
  player.stop();
  state.mode = mode;
  byId<HTMLInputElement>("match").disabled = mode === "blind"; // blind rounds are always loudness matched
  applyGains();
  byId("tab-ab").setAttribute("aria-selected", String(mode === "ab"));
  byId("tab-blind").setAttribute("aria-selected", String(mode === "blind"));
  byId("tab-ab").tabIndex = mode === "ab" ? 0 : -1;
  byId("tab-blind").tabIndex = mode === "blind" ? 0 : -1;
  byId("stage").setAttribute("aria-labelledby", mode === "ab" ? "tab-ab" : "tab-blind");
  if (mode === "blind") round = newRound();
  redrawAll();
}

// ---------------------------------------------------------------------------------------------
// Setup controls

function fillRootSelect(): void {
  const select = byId<HTMLSelectElement>("root");
  const bounds = rootBounds(state.material, state.instrument);
  state.root = clampRoot(state.material, state.instrument, state.root);
  const options: string[] = [];
  for (let midi = bounds.min; midi <= bounds.max; midi += 1) {
    options.push(`<option value="${midi}"${midi === state.root ? " selected" : ""}>${midiName(midi)}</option>`);
  }
  select.innerHTML = options.join("");
  select.disabled = state.material === "range";
  const hint = byId("root-hint");
  hint.textContent =
    state.material === "range"
      ? "음역 전체를 훑습니다"
      : `악보 표기 ${midiName(writtenMidi(state.root, state.instrument))}`;
}

function setupChanged(): void {
  phrase = buildPhrase(state.material, state.instrument, state.root);
  state.analysisIndex = null;
  fillRootSelect();
  markDirty("both");
  if (state.mode === "blind") round = newRound();
  scheduleRender();
}

function checked(name: string): string {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return input ? input.value : "";
}

function wireSetup(): void {
  document.querySelectorAll<HTMLInputElement>('input[name="instrument"]').forEach((input) =>
    input.addEventListener("change", () => {
      state.instrument = checked("instrument") as Instrument;
      setupChanged();
      updateTuningUi();
    }),
  );
  document.querySelectorAll<HTMLInputElement>('input[name="material"]').forEach((input) =>
    input.addEventListener("change", () => {
      state.material = checked("material") as Material;
      setupChanged();
    }),
  );
  byId<HTMLSelectElement>("root").addEventListener("change", (event) => {
    state.root = Number((event.target as HTMLSelectElement).value);
    setupChanged();
  });
  const intensity = byId<HTMLInputElement>("intensity");
  intensity.addEventListener("input", () => {
    state.intensity = Number(intensity.value);
    byId("intensity-out").textContent = state.intensity.toFixed(2);
    markDirty("both");
    scheduleRender(260);
  });
  const volume = byId<HTMLInputElement>("volume");
  volume.addEventListener("input", () => {
    state.volume = Number(volume.value);
    byId("volume-out").textContent = `${Math.round(state.volume * 100)}%`;
    player.setVolume(state.volume);
  });
  byId<HTMLInputElement>("match").addEventListener("change", (event) => {
    state.match = (event.target as HTMLInputElement).checked;
    applyGains();
  });
  byId<HTMLInputElement>("loop").addEventListener("change", (event) => {
    player.setLoop((event.target as HTMLInputElement).checked);
  });
  byId<HTMLInputElement>("wide").addEventListener("change", (event) => {
    state.wide = (event.target as HTMLInputElement).checked;
    drawSpectrograms();
  });
  byId<HTMLSelectElement>("analysis-note").addEventListener("change", (event) => {
    state.analysisIndex = Number((event.target as HTMLSelectElement).value);
    updateProfile();
    updateSummary();
  });
  byId("toggle-table").addEventListener("click", () => {
    const wrap = byId("table-wrap");
    wrap.hidden = !wrap.hidden;
    byId("toggle-table").textContent = wrap.hidden ? "표로 보기" : "표 닫기";
    byId("toggle-table").setAttribute("aria-expanded", String(!wrap.hidden));
  });
}

function wirePlayback(): void {
  slots.forEach((slot, index) => slot.button.addEventListener("click", () => void toggleSlot(index)));
  stopButton.addEventListener("click", () => player.stop());
  player.onChange = updatePlayState;

  byId("tab-ab").addEventListener("click", () => setMode("ab"));
  byId("tab-blind").addEventListener("click", () => setMode("blind"));
  byId("tab-ab").addEventListener("keydown", tabKeys);
  byId("tab-blind").addEventListener("keydown", tabKeys);

  byId("ans-0").addEventListener("click", () => answer(0));
  byId("ans-1").addEventListener("click", () => answer(1));
  byId("ans-same").addEventListener("click", () => answer("same"));
  byId("next-round").addEventListener("click", startRound);
  byId("blind-reset").addEventListener("click", () => {
    for (const key of ["real", "nice"] as const) tally[key] = { model: 0, classic: 0, same: 0 };
    updateBlind();
    updateSummary();
  });
  document.querySelectorAll<HTMLInputElement>('input[name="criterion"]').forEach((input) =>
    input.addEventListener("change", () => {
      criterion = checked("criterion") as Criterion;
    }),
  );

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("textarea, select, input[type='text']")) return;
    if (event.key === "1" || event.key === "2") {
      event.preventDefault();
      void toggleSlot(event.key === "1" ? 0 : 1);
    } else if (event.key === "Escape") {
      player.stop();
    }
  });
}

function tabKeys(event: KeyboardEvent): void {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const next = state.mode === "ab" ? "blind" : "ab";
  setMode(next);
  byId(next === "ab" ? "tab-ab" : "tab-blind").focus();
}

// ---------------------------------------------------------------------------------------------
// Export

function updateSummary(): void {
  const classic = views.classic;
  const model = views.model;
  const resolved = resolveSaxToneControls(state.instrument, state.overrides);
  const { index } = analysisNote();
  const note = phrase.notes[index];
  const summary = {
    lab: "SaxTone 청음 랩",
    engines: { a: SAX_SYNTH_CLASSIC_VERSION, b: SAX_SYNTH_VERSION },
    instrument: state.instrument,
    material: state.material,
    notes: phrase.notes.map((item) => midiName(item.midi)).join(" "),
    intensity: Number(state.intensity.toFixed(2)),
    loudnessMatched: state.match,
    controls: Object.fromEntries(Object.entries(resolved).map(([key, value]) => [key, Number(Number(value).toFixed(3))])),
    changedControls: Object.keys(state.overrides),
    measured:
      classic && model
        ? {
            analysisNote: midiName(note.midi),
            loudnessDbA: { "2.0": Number(classic.levelDb.toFixed(1)), "3.0": Number(model.levelDb.toFixed(1)) },
            peak: { "2.0": Number(classic.clip.peak.toFixed(3)), "3.0": Number(model.clip.peak.toFixed(3)) },
          }
        : null,
    blindTest: {
      "실제 색소폰 같음": { "3.0": tally.real.model, "2.0": tally.real.classic, 구분못함: tally.real.same },
      "듣기 좋음": { "3.0": tally.nice.model, "2.0": tally.nice.classic, 구분못함: tally.nice.same },
    },
    memo: byId<HTMLTextAreaElement>("memo").value.trim(),
  };
  byId<HTMLTextAreaElement>("summary").value = JSON.stringify(summary, null, 2);
}

function wireExport(): void {
  byId<HTMLTextAreaElement>("memo").addEventListener("input", updateSummary);
  byId("copy").addEventListener("click", async () => {
    const field = byId<HTMLTextAreaElement>("summary");
    const status = byId("copy-status");
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = "복사했습니다.";
    } catch {
      field.focus();
      field.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      status.textContent = copied ? "복사했습니다." : "자동 복사가 막혀 있습니다. 선택된 내용을 직접 복사해 주세요.";
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Boot

function observeLayout(): void {
  let queued = 0;
  const redraw = (): void => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      drawSpectrograms();
      chart.resize();
      updatePlayheads();
    });
  };
  new ResizeObserver(redraw).observe(byId("stage"));
  new ResizeObserver(() => chart.resize()).observe(byId("hchart"));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function boot(): void {
  document.documentElement.lang = "ko";
  buildSliders();
  fillRootSelect();
  wireSetup();
  wirePlayback();
  wireExport();
  observeLayout();
  byId<HTMLInputElement>("loop").checked = player.loop;
  updateTuningUi();
  renderSlots();
  updatePlayState();
  updateSummary();
  void flushRender();
  (window as unknown as { __saxLab: unknown }).__saxLab = {
    state,
    views,
    player,
    get gains() {
      return gains;
    },
    get round() {
      return round;
    },
    get phrase() {
      return phrase;
    },
    get lastRenderInfo() {
      return lastRenderInfo;
    },
  };
}

boot();
