import { SOURCE_DATA } from "./generated/source-data";

export { SOURCE_DATA } from "./generated/source-data";

export type InstrumentId = keyof typeof SOURCE_DATA.chartConfigs;
export type KeyId = (typeof SOURCE_DATA.keys)[number]["id"];
export type NoteId = `written-${number}`;
export type ReviewStatus = "seed" | "needs-expert-review" | "verified" | "rejected";
export type FingeringKind = "primary" | "alternate" | "trill" | "model-specific";
export type AccidentalPreference = "sharp" | "flat";
export type PitchLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type PitchAccidental = "natural" | "sharp" | "flat";
export type HighFSharpCapability = "unknown" | "yes" | "no";
export type RequiredCapability = "high-fsharp-key";

export interface SourceRef {
  readonly id: string;
  readonly title: string;
  readonly url?: string;
  readonly localPath?: string;
  readonly locator: string;
  readonly evidenceKind: "manufacturer" | "independent-guide" | "local-derived" | "other";
  readonly authorityLevel: "authoritative" | "supporting" | "derived";
  readonly derivedFromSourceId?: string;
  readonly checkedAt?: string;
}

export interface ReviewRecord {
  readonly reviewerName: string;
  readonly reviewerRole: string;
  readonly instrument: "all" | InstrumentId;
  readonly instrumentModel?: string;
  readonly reviewedAt: string;
  readonly decision: "approved" | "changes-requested" | "rejected";
  readonly notes: string;
}

export interface SaxKey {
  readonly id: KeyId;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly r?: number;
  readonly w?: number;
  readonly h?: number;
  readonly type: "circle" | "pill";
  readonly group: string;
}

export interface InstrumentDefinition {
  readonly id: InstrumentId;
  readonly prefix: string;
  readonly englishName: string;
  readonly koreanName: string;
  readonly instrumentTag: string;
  readonly sheetMark: string;
  readonly transpositionSemitones: number;
  readonly transpositionText: string;
  readonly concertLead: string;
}

export interface FingeringVariant {
  readonly id: string;
  readonly labelKo: string;
  readonly kind: FingeringKind;
  readonly pressedKeyIds: readonly KeyId[];
  readonly useCases: readonly string[];
  readonly cautions: readonly string[];
  readonly compatibleModels: readonly string[];
  readonly requiredCapabilities: readonly RequiredCapability[];
  readonly reviewStatus: ReviewStatus;
  readonly sources: readonly SourceRef[];
  readonly reviews: readonly ReviewRecord[];
}

export interface SaxNote {
  readonly id: NoteId;
  readonly writtenMidi: number;
  /** Raw legacy copy for review/auditing. Never render `note` directly as trusted guidance. */
  readonly sourceSeed: {
    readonly label: string;
    readonly short: string;
    readonly formula: string;
    readonly note: string;
  };
  readonly primaryVariantId: string;
  readonly variants: readonly FingeringVariant[];
}

export interface SpelledPitch {
  readonly midi: number;
  readonly letter: PitchLetter;
  readonly accidental: PitchAccidental;
  readonly accidentalSymbol: "" | "♯" | "♭";
  readonly octave: number;
  /** Diatonic staff index where C0 is 0; enharmonic spelling intentionally changes this value. */
  readonly staffStep: number;
}

export interface PitchNames {
  readonly display: string;
  readonly unicode: string;
  readonly ascii: string;
  readonly accessibleText: string;
  readonly accessibleTextKo: string;
  readonly sharp: string;
  readonly flat: string;
  readonly spelled: SpelledPitch;
}

export interface SaxCapabilityProfile {
  readonly highFSharpKey: HighFSharpCapability;
  /** Written MIDI values whose expert-verified alternate needs no high-F# key. */
  readonly verifiedNonCapabilityAlternates?: readonly number[];
}

export type NoteSupportReason =
  | "supported"
  | "high-fsharp-key-present"
  | "verified-alternate"
  | "high-fsharp-key-required"
  | "note-not-found";

export interface NoteSupport {
  readonly supported: boolean;
  readonly reason: NoteSupportReason;
  readonly note?: SaxNote;
}

export const EXPECTED_SOURCE_SHA256 =
  "50ffcc418d9a9923a027187df36495e9c6931607e5f3ed57e3d5ea3c9d3ecbd4" as const;
export const HIGH_FSHARP_CAPABILITY_ID = "high-fsharp-key" as const;
export const HIGH_FSHARP_WRITTEN_MIDI = 90 as const;
export const WRITTEN_MIDI_MIN = 58 as const;
export const WRITTEN_MIDI_MAX = 90 as const;
export const UNUSED_KEY_IDS = Object.freeze([
  "frontF",
  "bis",
  "sideC",
  "altFSharp",
] as const);

const EMPTY_STRINGS = Object.freeze([]) as readonly string[];
const EMPTY_SOURCES = Object.freeze([]) as readonly SourceRef[];
const EMPTY_REVIEWS = Object.freeze([]) as readonly ReviewRecord[];
const EMPTY_CAPABILITIES = Object.freeze([]) as readonly RequiredCapability[];
const HIGH_FSHARP_CAPABILITIES = Object.freeze([
  HIGH_FSHARP_CAPABILITY_ID,
]) as readonly RequiredCapability[];

export const SAX_KEYS: readonly SaxKey[] = Object.freeze(
  SOURCE_DATA.keys.map((key) => Object.freeze({ ...key }) as SaxKey),
);

export const SAX_INSTRUMENTS: Readonly<Record<InstrumentId, InstrumentDefinition>> =
  Object.freeze(
    Object.fromEntries(
      (Object.keys(SOURCE_DATA.chartConfigs) as InstrumentId[]).map((id) => [
        id,
        Object.freeze({ id, ...SOURCE_DATA.chartConfigs[id] }),
      ]),
    ),
  ) as Readonly<Record<InstrumentId, InstrumentDefinition>>;

export const SAX_NOTES: readonly SaxNote[] = Object.freeze(
  SOURCE_DATA.notes.map((rawNote) => {
    const id = `written-${rawNote.midi}` as NoteId;
    const primaryVariantId = `${id}-seed-primary`;
    const pressedKeyIds = Object.freeze([...rawNote.pressed]) as readonly KeyId[];
    const requiredCapabilities =
      rawNote.midi === HIGH_FSHARP_WRITTEN_MIDI
        ? HIGH_FSHARP_CAPABILITIES
        : EMPTY_CAPABILITIES;
    const variant: FingeringVariant = Object.freeze({
      id: primaryVariantId,
      labelKo: rawNote.short,
      kind: "primary",
      pressedKeyIds,
      useCases: EMPTY_STRINGS,
      cautions: EMPTY_STRINGS,
      compatibleModels: EMPTY_STRINGS,
      requiredCapabilities,
      reviewStatus: "seed",
      sources: EMPTY_SOURCES,
      reviews: EMPTY_REVIEWS,
    });

    return Object.freeze({
      id,
      writtenMidi: rawNote.midi,
      sourceSeed: Object.freeze({
        label: rawNote.label,
        short: rawNote.short,
        formula: rawNote.formula,
        note: rawNote.note,
      }),
      primaryVariantId,
      variants: Object.freeze([variant]),
    });
  }),
);

// Short aliases keep consumers independent of the source module's generated naming.
export const KEYS = SAX_KEYS;
export const NOTES = SAX_NOTES;
export const INSTRUMENTS = SAX_INSTRUMENTS;
export const SOURCE_SHA256 = SOURCE_DATA.source.sha256;

const NOTES_BY_MIDI = new Map(SAX_NOTES.map((note) => [note.writtenMidi, note]));
const NOTES_BY_ID = new Map(SAX_NOTES.map((note) => [note.id, note]));

const LETTER_STAFF_INDEX: Readonly<Record<PitchLetter, number>> = Object.freeze({
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
});

interface PitchSpellingTemplate {
  readonly letter: PitchLetter;
  readonly accidental: PitchAccidental;
  readonly octaveOffset?: number;
}

// UI spellings follow conventional chromatic notation. The raw source still
// preserves uncommon enharmonics such as B/Cb and F/E# in `sourceSeed.label`,
// but those alternates must not replace the natural note in the learner UI.
const SHARP_SPELLINGS: readonly PitchSpellingTemplate[] = Object.freeze([
  { letter: "C", accidental: "natural" },
  { letter: "C", accidental: "sharp" },
  { letter: "D", accidental: "natural" },
  { letter: "D", accidental: "sharp" },
  { letter: "E", accidental: "natural" },
  { letter: "F", accidental: "natural" },
  { letter: "F", accidental: "sharp" },
  { letter: "G", accidental: "natural" },
  { letter: "G", accidental: "sharp" },
  { letter: "A", accidental: "natural" },
  { letter: "A", accidental: "sharp" },
  { letter: "B", accidental: "natural" },
]);

const FLAT_SPELLINGS: readonly PitchSpellingTemplate[] = Object.freeze([
  { letter: "C", accidental: "natural" },
  { letter: "D", accidental: "flat" },
  { letter: "D", accidental: "natural" },
  { letter: "E", accidental: "flat" },
  { letter: "E", accidental: "natural" },
  { letter: "F", accidental: "natural" },
  { letter: "G", accidental: "flat" },
  { letter: "G", accidental: "natural" },
  { letter: "A", accidental: "flat" },
  { letter: "A", accidental: "natural" },
  { letter: "B", accidental: "flat" },
  { letter: "B", accidental: "natural" },
]);

const FIXED_DO_BY_PITCH_CLASS = Object.freeze([
  "도",
  "도♯",
  "레",
  "레♯",
  "미",
  "파",
  "파♯",
  "솔",
  "솔♯",
  "라",
  "라♯",
  "시",
] as const);

function assertMidi(midi: number, context = "MIDI"): void {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new RangeError(`${context} must be an integer from 0 to 127; received ${midi}`);
  }
}

function accidentalSymbol(accidental: PitchAccidental): "" | "♯" | "♭" {
  if (accidental === "sharp") return "♯";
  if (accidental === "flat") return "♭";
  return "";
}

function formatPitch(pitch: SpelledPitch, style: "unicode" | "ascii"): string {
  const symbol =
    pitch.accidental === "natural"
      ? ""
      : style === "unicode"
        ? pitch.accidentalSymbol
        : pitch.accidental === "sharp"
          ? "#"
          : "b";
  return `${pitch.letter}${symbol}${pitch.octave}`;
}

export function writtenMidiToSpelledPitch(
  midi: number,
  accidentalPreference: AccidentalPreference,
): SpelledPitch {
  assertMidi(midi, "written MIDI");
  if (accidentalPreference !== "sharp" && accidentalPreference !== "flat") {
    throw new TypeError(`accidentalPreference must be sharp or flat`);
  }

  const pitchClass = ((midi % 12) + 12) % 12;
  const chromaticOctave = Math.floor(midi / 12) - 1;
  const template =
    accidentalPreference === "sharp"
      ? SHARP_SPELLINGS[pitchClass]
      : FLAT_SPELLINGS[pitchClass];
  const octave = chromaticOctave + (template.octaveOffset ?? 0);
  const symbol = accidentalSymbol(template.accidental);

  return Object.freeze({
    midi,
    letter: template.letter,
    accidental: template.accidental,
    accidentalSymbol: symbol,
    octave,
    staffStep: octave * 7 + LETTER_STAFF_INDEX[template.letter],
  });
}

export function writtenMidiToNames(
  midi: number,
  accidentalPreference: AccidentalPreference,
): PitchNames {
  const spelled = writtenMidiToSpelledPitch(midi, accidentalPreference);
  const sharpPitch = writtenMidiToSpelledPitch(midi, "sharp");
  const flatPitch = writtenMidiToSpelledPitch(midi, "flat");
  const unicode = formatPitch(spelled, "unicode");
  const accidentalEnglish =
    spelled.accidental === "natural" ? "" : ` ${spelled.accidental}`;
  const accidentalKorean =
    spelled.accidental === "sharp" ? " 올림" : spelled.accidental === "flat" ? " 내림" : "";

  return Object.freeze({
    display: unicode,
    unicode,
    ascii: formatPitch(spelled, "ascii"),
    accessibleText: `${spelled.letter}${accidentalEnglish} ${spelled.octave}`,
    accessibleTextKo: `${spelled.letter}${accidentalKorean} ${spelled.octave}`,
    sharp: formatPitch(sharpPitch, "unicode"),
    flat: formatPitch(flatPitch, "unicode"),
    spelled,
  });
}

/** Fixed-do is pitch-class based and deliberately stable across display spelling. */
export function writtenMidiToFixedDo(midi: number): string {
  assertMidi(midi, "written MIDI");
  return FIXED_DO_BY_PITCH_CLASS[((midi % 12) + 12) % 12];
}

export function concertMidi(writtenMidi: number, instrument: InstrumentId): number {
  assertMidi(writtenMidi, "written MIDI");
  const definition = SAX_INSTRUMENTS[instrument];
  if (!definition) throw new TypeError(`unknown saxophone instrument: ${instrument}`);
  return writtenMidi - definition.transpositionSemitones;
}

export function getNoteByWrittenMidi(writtenMidi: number): SaxNote | undefined {
  return NOTES_BY_MIDI.get(writtenMidi);
}

export function getNoteById(noteId: NoteId | string): SaxNote | undefined {
  return NOTES_BY_ID.get(noteId as NoteId);
}

function resolveNote(noteOrWrittenMidi: SaxNote | number): SaxNote | undefined {
  return typeof noteOrWrittenMidi === "number"
    ? getNoteByWrittenMidi(noteOrWrittenMidi)
    : noteOrWrittenMidi;
}

export function getPrimaryVariant(note: SaxNote): FingeringVariant {
  const variant = note.variants.find((candidate) => candidate.id === note.primaryVariantId);
  if (!variant) throw new Error(`${note.id} has no matching primary variant`);
  return variant;
}

export function getNoteSupport(
  noteOrWrittenMidi: SaxNote | number,
  profile: SaxCapabilityProfile,
): NoteSupport {
  const note = resolveNote(noteOrWrittenMidi);
  if (!note) return Object.freeze({ supported: false, reason: "note-not-found" });

  const primary = getPrimaryVariant(note);
  if (!primary.requiredCapabilities.includes(HIGH_FSHARP_CAPABILITY_ID)) {
    return Object.freeze({ supported: true, reason: "supported", note });
  }
  if (profile.highFSharpKey === "yes") {
    return Object.freeze({ supported: true, reason: "high-fsharp-key-present", note });
  }
  if (profile.verifiedNonCapabilityAlternates?.includes(note.writtenMidi)) {
    return Object.freeze({ supported: true, reason: "verified-alternate", note });
  }
  return Object.freeze({ supported: false, reason: "high-fsharp-key-required", note });
}

export function isNoteSupported(
  noteOrWrittenMidi: SaxNote | number,
  profile: SaxCapabilityProfile,
): boolean {
  return getNoteSupport(noteOrWrittenMidi, profile).supported;
}

export function filterSupportedNotes(
  notes: readonly SaxNote[],
  profile: SaxCapabilityProfile,
): readonly SaxNote[] {
  return Object.freeze(notes.filter((note) => isNoteSupported(note, profile)));
}

export function getSupportedNotes(profile: SaxCapabilityProfile): readonly SaxNote[] {
  return filterSupportedNotes(SAX_NOTES, profile);
}

/** Returns every invariant violation; an empty result means the generated seed is coherent. */
export function validateSaxData(): readonly string[] {
  const errors: string[] = [];
  const keyIds = SAX_KEYS.map((key) => key.id);
  const keyIdSet = new Set(keyIds);
  const midiValues = SAX_NOTES.map((note) => note.writtenMidi);

  if (SOURCE_SHA256 !== EXPECTED_SOURCE_SHA256) errors.push("source SHA-256 mismatch");
  if (SAX_KEYS.length !== 23) errors.push(`expected 23 keys; found ${SAX_KEYS.length}`);
  if (SAX_NOTES.length !== 33) errors.push(`expected 33 notes; found ${SAX_NOTES.length}`);
  if (new Set(keyIds).size !== keyIds.length) errors.push("duplicate key id");
  if (new Set(midiValues).size !== midiValues.length) errors.push("duplicate written MIDI");

  for (let index = 0; index < 33; index += 1) {
    const expectedMidi = WRITTEN_MIDI_MIN + index;
    if (midiValues[index] !== expectedMidi) {
      errors.push(`MIDI sequence differs at index ${index}: expected ${expectedMidi}`);
      break;
    }
  }

  const usedKeyIds = new Set<KeyId>();
  for (const note of SAX_NOTES) {
    const primaryMatches = note.variants.filter(
      (variant) => variant.id === note.primaryVariantId,
    );
    if (primaryMatches.length !== 1) errors.push(`${note.id}: invalid primaryVariantId`);
    for (const variant of note.variants) {
      if (new Set(variant.pressedKeyIds).size !== variant.pressedKeyIds.length) {
        errors.push(`${variant.id}: duplicate pressed key id`);
      }
      for (const keyId of variant.pressedKeyIds) {
        if (!keyIdSet.has(keyId)) errors.push(`${variant.id}: unknown key ${keyId}`);
        usedKeyIds.add(keyId);
      }
    }
  }

  const unused = keyIds.filter((keyId) => !usedKeyIds.has(keyId)).sort();
  const expectedUnused = [...UNUSED_KEY_IDS].sort();
  if (unused.join("|") !== expectedUnused.join("|")) {
    errors.push(`unused keys mismatch: ${unused.join(",")}`);
  }

  const expectedTranspositions: Readonly<Record<InstrumentId, number>> = {
    alto: 9,
    tenor: 14,
    soprano: 2,
  };
  for (const instrument of Object.keys(expectedTranspositions) as InstrumentId[]) {
    if (
      SAX_INSTRUMENTS[instrument].transpositionSemitones !== expectedTranspositions[instrument]
    ) {
      errors.push(`${instrument}: transposition mismatch`);
    }
  }

  const highFSharp = getNoteByWrittenMidi(HIGH_FSHARP_WRITTEN_MIDI);
  if (
    !highFSharp ||
    !getPrimaryVariant(highFSharp).requiredCapabilities.includes(HIGH_FSHARP_CAPABILITY_ID)
  ) {
    errors.push("F#6 must require high-fsharp-key");
  }

  return Object.freeze(errors);
}

export function assertSaxDataIntegrity(): void {
  const errors = validateSaxData();
  if (errors.length > 0) throw new Error(`Sax data validation failed: ${errors.join("; ")}`);
}

assertSaxDataIntegrity();
