// What the lab plays: a sustained note, a scale, a short original melody, or a walk through the range.
// All pitches are sounding (concert) MIDI numbers, which is what the synthesis engine expects.

export type Instrument = "alto" | "tenor" | "soprano";
export type Material = "note" | "scale" | "melody" | "range";

/** Sounding range the synthesis engine is used for in the app, and the written-minus-sounding offset. */
export const INSTRUMENT_RANGE: Readonly<Record<Instrument, { lo: number; hi: number; written: number }>> = {
  soprano: { lo: 56, hi: 88, written: 2 },
  alto: { lo: 49, hi: 80, written: 9 },
  tenor: { lo: 44, hi: 76, written: 14 },
};

export interface PhraseNote {
  /** Onset, seconds from the start of the phrase. */
  readonly t: number;
  readonly midi: number;
  /** How long the player holds the note, seconds. */
  readonly len: number;
}

export interface Phrase {
  readonly notes: readonly PhraseNote[];
  /** End of the last note, seconds. */
  readonly length: number;
  /** Note whose steady part is analysed by default. */
  readonly analysisIndex: number;
}

const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

export function midiName(midi: number): string {
  const rounded = Math.round(midi);
  return `${SHARP_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

export function writtenMidi(soundingMidi: number, instrument: Instrument): number {
  return soundingMidi + INSTRUMENT_RANGE[instrument].written;
}

const SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11, 12] as const;
/** [semitones above the root, beats] */
const MELODY: readonly (readonly [number, number])[] = [
  [0, 2],
  [4, 1],
  [7, 1],
  [9, 1.5],
  [7, 0.5],
  [4, 1],
  [2, 1],
  [0, 3],
];
const MELODY_BEAT_SECONDS = 0.68;
const SCALE_STEP_SECONDS = 0.62;
const RANGE_STEP_SECONDS = 1.15;
const NOTE_SECONDS = 2.6;

function span(material: Material): number {
  if (material === "scale") return 12;
  if (material === "melody") return Math.max(...MELODY.map(([semitones]) => semitones));
  return 0;
}

/** Lowest and highest root pitch that keeps the whole phrase inside the instrument's range. */
export function rootBounds(material: Material, instrument: Instrument): { min: number; max: number } {
  const { lo, hi } = INSTRUMENT_RANGE[instrument];
  if (material === "range") return { min: lo, max: lo };
  return { min: lo, max: hi - span(material) };
}

export function clampRoot(material: Material, instrument: Instrument, root: number): number {
  const { min, max } = rootBounds(material, instrument);
  return Math.min(max, Math.max(min, Math.round(root)));
}

export function buildPhrase(material: Material, instrument: Instrument, requestedRoot: number): Phrase {
  const root = clampRoot(material, instrument, requestedRoot);
  const { lo, hi } = INSTRUMENT_RANGE[instrument];

  if (material === "note") {
    return { notes: [{ t: 0, midi: root, len: NOTE_SECONDS }], length: NOTE_SECONDS, analysisIndex: 0 };
  }

  if (material === "scale") {
    const notes = SCALE_STEPS.map((step, index): PhraseNote => {
      const last = index === SCALE_STEPS.length - 1;
      return { t: index * SCALE_STEP_SECONDS, midi: root + step, len: last ? 1.9 : SCALE_STEP_SECONDS };
    });
    const end = notes[notes.length - 1];
    return { notes, length: end.t + end.len, analysisIndex: notes.length - 1 };
  }

  if (material === "melody") {
    let beat = 0;
    const notes = MELODY.map(([semitones, beats]): PhraseNote => {
      const note: PhraseNote = { t: beat * MELODY_BEAT_SECONDS, midi: root + semitones, len: beats * MELODY_BEAT_SECONDS };
      beat += beats;
      return note;
    });
    const end = notes[notes.length - 1];
    return { notes, length: end.t + end.len, analysisIndex: notes.length - 1 };
  }

  const count = 6;
  const notes = Array.from({ length: count }, (_, index): PhraseNote => {
    const last = index === count - 1;
    return {
      t: index * RANGE_STEP_SECONDS,
      midi: Math.round(lo + (index * (hi - lo)) / (count - 1)),
      len: last ? 2 : RANGE_STEP_SECONDS,
    };
  });
  const end = notes[notes.length - 1];
  return { notes, length: end.t + end.len, analysisIndex: 2 };
}

/** Notes long enough (0.6 s) for the harmonic analysis window. */
export function analysableNotes(phrase: Phrase): number[] {
  const indices: number[] = [];
  phrase.notes.forEach((note, index) => {
    if (note.len >= 0.6) indices.push(index);
  });
  return indices;
}

/** Centre of the analysis window inside a note: 0.65 s after the onset, earlier for short notes. */
export function analysisCentre(note: PhraseNote): number {
  return note.t + Math.min(0.65, 0.5 * note.len);
}
