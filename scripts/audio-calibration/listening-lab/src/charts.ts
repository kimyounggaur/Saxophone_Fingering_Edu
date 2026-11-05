// Canvas spectrogram and SVG harmonic-profile chart.  Colours come from CSS variables so that both
// themes work; the heat map ramp is the one-hue sequential blue of the data-viz palette.

import type { Spectrogram } from "./dsp.ts";

export function isDarkTheme(): boolean {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function cssVar(element: Element, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value || fallback;
}

// Sequential blue (steps 100..700).  Light mode: more energy = darker.  Dark mode: more energy = lighter.
const LIGHT_STOPS: readonly (readonly [number, string])[] = [
  [0, "#fcfcfb"],
  [0.1, "#cde2fb"],
  [0.25, "#9ec5f4"],
  [0.4, "#6da7ec"],
  [0.55, "#3987e5"],
  [0.7, "#256abf"],
  [0.85, "#184f95"],
  [1, "#0d366b"],
];
const DARK_STOPS: readonly (readonly [number, string])[] = [
  [0, "#1a1a19"],
  [0.1, "#0d366b"],
  [0.25, "#104281"],
  [0.4, "#1c5cab"],
  [0.55, "#2a78d6"],
  [0.7, "#5598e7"],
  [0.85, "#9ec5f4"],
  [1, "#cde2fb"],
];

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function buildRamp(dark: boolean): Uint8ClampedArray {
  const stops = (dark ? DARK_STOPS : LIGHT_STOPS).map(([position, hex]) => [position, hexToRgb(hex)] as const);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let index = 0; index < 256; index += 1) {
    const t = index / 255;
    let upper = 1;
    while (upper < stops.length - 1 && stops[upper][0] < t) upper += 1;
    const [t0, c0] = stops[upper - 1];
    const [t1, c1] = stops[upper];
    const mix = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let channel = 0; channel < 3; channel += 1) lut[index * 3 + channel] = c0[channel] + (c1[channel] - c0[channel]) * mix;
  }
  return lut;
}

export interface SpectrogramView {
  readonly maxHz: number;
  /** Level (dB) that gets the strongest colour. */
  readonly topDb: number;
  readonly rangeDb: number;
  readonly durationSeconds: number;
  readonly notes: readonly { readonly t: number; readonly label: string }[];
}

export interface PlotRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const MARGIN = { left: 36, top: 17, right: 8, bottom: 20 } as const;

export function drawSpectrogram(canvas: HTMLCanvasElement, spectrogram: Spectrogram | null, view: SpectrogramView): PlotRect {
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const plot: PlotRect = {
    left: MARGIN.left,
    top: MARGIN.top,
    width: Math.max(10, cssWidth - MARGIN.left - MARGIN.right),
    height: Math.max(10, cssHeight - MARGIN.top - MARGIN.bottom),
  };
  if (cssWidth === 0 || cssHeight === 0) return plot;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  const context = canvas.getContext("2d");
  if (!context) return plot;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  const dark = isDarkTheme();
  const surface = cssVar(canvas, "--viz-surface", dark ? "#1a1a19" : "#fcfcfb");
  const ink = cssVar(canvas, "--viz-ink-2", dark ? "#c3c2b7" : "#52514e");
  const axis = cssVar(canvas, "--viz-axis", dark ? "#383835" : "#c3c2b7");
  context.fillStyle = surface;
  context.fillRect(0, 0, cssWidth, cssHeight);

  if (spectrogram) {
    const shownBins = Math.max(2, Math.min(spectrogram.bins, Math.floor(view.maxHz / spectrogram.binHz)));
    const image = document.createElement("canvas");
    image.width = spectrogram.frames;
    image.height = shownBins;
    const imageContext = image.getContext("2d");
    if (imageContext) {
      const data = imageContext.createImageData(spectrogram.frames, shownBins);
      const ramp = buildRamp(dark);
      const floor = view.topDb - view.rangeDb;
      for (let frame = 0; frame < spectrogram.frames; frame += 1) {
        for (let bin = 0; bin < shownBins; bin += 1) {
          const level = spectrogram.db[frame * spectrogram.bins + bin];
          const t = Math.min(1, Math.max(0, (level - floor) / view.rangeDb));
          const lutIndex = Math.round(t * 255) * 3;
          const offset = ((shownBins - 1 - bin) * spectrogram.frames + frame) * 4;
          data.data[offset] = ramp[lutIndex];
          data.data[offset + 1] = ramp[lutIndex + 1];
          data.data[offset + 2] = ramp[lutIndex + 2];
          data.data[offset + 3] = 255;
        }
      }
      imageContext.putImageData(data, 0, 0);
      context.save();
      context.beginPath();
      context.rect(plot.left, plot.top, plot.width, plot.height);
      context.clip();
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      const secondsPerPixel = view.durationSeconds / plot.width;
      const x0 = plot.left - (spectrogram.hopSeconds / 2) / secondsPerPixel;
      const width = (spectrogram.frames * spectrogram.hopSeconds) / secondsPerPixel;
      // The image only covers 0..shownBins*binHz; stretch that to the plot height (the top edge is maxHz).
      const coveredHz = shownBins * spectrogram.binHz;
      const height = plot.height * (coveredHz / view.maxHz);
      context.drawImage(image, x0, plot.top + plot.height - height, width, height);
      context.restore();
    }
  }

  context.strokeStyle = axis;
  context.lineWidth = 1;
  context.strokeRect(plot.left + 0.5, plot.top + 0.5, plot.width - 1, plot.height - 1);

  context.fillStyle = ink;
  context.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.textBaseline = "middle";
  context.textAlign = "right";
  const hzStep = view.maxHz > 5000 ? 2000 : 1000;
  for (let hz = 0; hz <= view.maxHz + 1; hz += hzStep) {
    const y = plot.top + plot.height - (hz / view.maxHz) * plot.height;
    context.beginPath();
    context.moveTo(plot.left - 4, Math.round(y) + 0.5);
    context.lineTo(plot.left, Math.round(y) + 0.5);
    context.stroke();
    context.fillText(hz === 0 ? "0" : `${hz / 1000}k`, plot.left - 7, Math.min(plot.top + plot.height - 5, Math.max(plot.top + 5, y)));
  }

  context.textAlign = "center";
  context.textBaseline = "top";
  const secondStep = view.durationSeconds > 9 ? 2 : 1;
  for (let second = 0; second <= view.durationSeconds; second += secondStep) {
    const x = plot.left + (second / view.durationSeconds) * plot.width;
    context.beginPath();
    context.moveTo(Math.round(x) + 0.5, plot.top + plot.height);
    context.lineTo(Math.round(x) + 0.5, plot.top + plot.height + 4);
    context.stroke();
    context.fillText(`${second}s`, Math.min(plot.left + plot.width - 8, Math.max(plot.left + 8, x)), plot.top + plot.height + 6);
  }

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.font = '600 10px system-ui, -apple-system, "Segoe UI", sans-serif';
  let labelEnd = -Infinity;
  for (const note of view.notes) {
    const x = plot.left + (note.t / view.durationSeconds) * plot.width;
    context.strokeStyle = ink;
    context.beginPath();
    context.moveTo(Math.round(x) + 0.5, plot.top - 5);
    context.lineTo(Math.round(x) + 0.5, plot.top);
    context.stroke();
    const textWidth = context.measureText(note.label).width;
    if (x + 3 > labelEnd + 4 && x + 3 + textWidth < cssWidth - 2) {
      context.fillStyle = ink;
      context.fillText(note.label, x + 3, plot.top - 6);
      labelEnd = x + 3 + textWidth;
    }
  }
  return plot;
}

// ---------------------------------------------------------------------------------------------
// Harmonic profile

export type SeriesShape = "circle" | "square" | "diamond";

export interface HarmonicSeries {
  readonly id: string;
  readonly label: string;
  /** CSS colour, normally a var(--s1) style reference. */
  readonly color: string;
  readonly shape: SeriesShape;
  /** Level of harmonic k+1 in dB (null = not available). */
  readonly values: readonly (number | null)[];
}

const CHART = { left: 40, right: 54, top: 10, bottom: 26, height: 244 } as const;

function markerPath(shape: SeriesShape, x: number, y: number): string {
  if (shape === "square") return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1"/>`;
  if (shape === "diamond") return `<path d="M${x} ${y - 5.5}L${x + 5.5} ${y}L${x} ${y + 5.5}L${x - 5.5} ${y}Z"/>`;
  return `<circle cx="${x}" cy="${y}" r="4.2"/>`;
}

export function legendSwatch(series: Pick<HarmonicSeries, "color" | "shape">): string {
  return `<svg class="swatch" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><g transform="translate(8 8)" fill="${series.color}">${markerPath(series.shape, 0, 0)}</g></svg>`;
}

export class HarmonicChart {
  private series: readonly HarmonicSeries[] = [];
  private f0 = 440;
  private floorDb = -60;
  private maxHarmonic = 24;
  private width = 0;
  private readonly svg: SVGSVGElement;
  private readonly tip: HTMLElement;
  private readonly guide: SVGLineElement;

  constructor(private readonly container: HTMLElement) {
    container.classList.add("hchart");
    container.innerHTML =
      '<svg role="img" focusable="false"><g class="plot"></g><line class="guide" hidden></line></svg><div class="tip" hidden></div>';
    this.svg = container.querySelector("svg") as SVGSVGElement;
    this.tip = container.querySelector(".tip") as HTMLElement;
    this.guide = container.querySelector(".guide") as unknown as SVGLineElement;
    container.addEventListener("pointermove", (event) => this.onPointer(event));
    container.addEventListener("pointerleave", () => this.hideTip());
    container.addEventListener("pointerdown", (event) => this.onPointer(event));
  }

  private x(harmonic: number): number {
    const plotWidth = this.width - CHART.left - CHART.right;
    return CHART.left + ((harmonic - 1) / (this.maxHarmonic - 1)) * plotWidth;
  }

  private y(db: number): number {
    const plotHeight = CHART.height - CHART.top - CHART.bottom;
    return CHART.top + (Math.min(0, Math.max(this.floorDb, db)) / this.floorDb) * plotHeight;
  }

  update(series: readonly HarmonicSeries[], f0: number, maxHarmonic = 24, label = ""): void {
    this.series = series;
    this.f0 = f0;
    this.maxHarmonic = maxHarmonic;
    this.svg.setAttribute("aria-label", label);
    this.render();
  }

  resize(): void {
    if (this.container.clientWidth !== this.width) this.render();
  }

  private render(): void {
    this.width = Math.max(240, this.container.clientWidth);
    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${CHART.height}`);
    this.svg.setAttribute("width", String(this.width));
    this.svg.setAttribute("height", String(CHART.height));
    const plotRight = this.width - CHART.right;
    const plotBottom = CHART.height - CHART.bottom;
    const parts: string[] = [];

    for (let db = 0; db >= this.floorDb; db -= 20) {
      const y = Math.round(this.y(db)) + 0.5;
      parts.push(`<line class="grid" x1="${CHART.left}" x2="${plotRight}" y1="${y}" y2="${y}"/>`);
      parts.push(`<text class="tick" x="${CHART.left - 6}" y="${y + 4}" text-anchor="end">${db}</text>`);
    }
    parts.push(`<line class="axis" x1="${CHART.left}" x2="${plotRight}" y1="${plotBottom + 0.5}" y2="${plotBottom + 0.5}"/>`);
    const ticks = [1];
    for (let k = 4; k <= this.maxHarmonic; k += 4) ticks.push(k);
    for (const k of ticks) {
      const x = Math.round(this.x(k)) + 0.5;
      parts.push(`<line class="axis" x1="${x}" x2="${x}" y1="${plotBottom}" y2="${plotBottom + 4}"/>`);
      parts.push(`<text class="tick" x="${x}" y="${plotBottom + 17}" text-anchor="middle">${k}</text>`);
    }

    const labelSlots: { y: number; text: string; color: string }[] = [];
    for (const series of this.series) {
      let path = "";
      let drawing = false;
      let last: { x: number; y: number } | null = null;
      series.values.forEach((value, index) => {
        if (index + 1 > this.maxHarmonic) return;
        if (value === null || !Number.isFinite(value)) {
          drawing = false;
          return;
        }
        const x = this.x(index + 1);
        const y = this.y(value);
        path += `${drawing ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
        drawing = true;
        last = { x, y };
      });
      parts.push(`<path class="line" d="${path}" style="stroke:${series.color}"/>`);
      parts.push(`<g class="markers" style="fill:${series.color}">`);
      series.values.forEach((value, index) => {
        if (index + 1 > this.maxHarmonic || value === null || !Number.isFinite(value)) return;
        parts.push(markerPath(series.shape, this.x(index + 1), this.y(value)));
      });
      parts.push("</g>");
      if (last) labelSlots.push({ y: (last as { x: number; y: number }).y, text: series.label, color: series.color });
    }

    // Direct labels at the right end, pushed apart so they never overlap.
    labelSlots.sort((a, b) => a.y - b.y);
    for (let index = 1; index < labelSlots.length; index += 1) {
      if (labelSlots[index].y - labelSlots[index - 1].y < 14) labelSlots[index].y = labelSlots[index - 1].y + 14;
    }
    for (const slot of labelSlots) {
      parts.push(`<text class="direct" x="${plotRight + 8}" y="${slot.y + 4}">${slot.text}</text>`);
    }

    (this.svg.querySelector(".plot") as SVGGElement).innerHTML = parts.join("");
  }

  private onPointer(event: PointerEvent): void {
    if (this.series.length === 0) return;
    const rect = this.container.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const plotWidth = this.width - CHART.left - CHART.right;
    const harmonic = Math.round(1 + ((px - CHART.left) / plotWidth) * (this.maxHarmonic - 1));
    if (harmonic < 1 || harmonic > this.maxHarmonic) {
      this.hideTip();
      return;
    }
    const x = this.x(harmonic);
    this.guide.setAttribute("x1", String(x));
    this.guide.setAttribute("x2", String(x));
    this.guide.setAttribute("y1", String(CHART.top));
    this.guide.setAttribute("y2", String(CHART.height - CHART.bottom));
    this.guide.removeAttribute("hidden");
    const rows = this.series
      .map((series) => {
        const value = series.values[harmonic - 1];
        const text = value === null || value === undefined || !Number.isFinite(value) ? "–" : `${value.toFixed(1)} dB`;
        return `<div class="tip-row">${legendSwatch(series)}<span>${series.label}</span><b>${text}</b></div>`;
      })
      .join("");
    this.tip.innerHTML = `<div class="tip-head">배음 ${harmonic} · ${Math.round(this.f0 * harmonic).toLocaleString("en-US")} Hz</div>${rows}`;
    this.tip.removeAttribute("hidden");
    const tipWidth = this.tip.offsetWidth;
    const left = x + 14 + tipWidth > this.width ? x - 14 - tipWidth : x + 14;
    this.tip.style.left = `${Math.max(0, left)}px`;
    this.tip.style.top = `${CHART.top + 4}px`;
  }

  private hideTip(): void {
    this.tip.setAttribute("hidden", "");
    this.guide.setAttribute("hidden", "");
  }
}
