import {
  SAX_NOTES,
  type FingeringVariant,
  type SaxCapabilityProfile,
  type SaxNote,
} from "./sax-data";

export type LessonContentStatus = "draft-unreviewed" | "verified";
export type ReplaySpeed = "normal" | "slow" | "step";

export interface LessonStep {
  id: string;
  noteId: string;
  previousNoteId: string | null;
  title: string;
  explanationKo: string;
  focusFingerIds: readonly string[];
  replaySpeed: ReplaySpeed;
  prerequisite: string | null;
  requiresCapabilities?: readonly string[];
  optionalWhenUnsupported?: boolean;
}

export interface Lesson {
  id: string;
  order: number;
  title: string;
  summaryKo: string;
  contentStatus: LessonContentStatus;
  prerequisiteLessonId: string | null;
  steps: readonly LessonStep[];
}

const noteId = (writtenMidi: number) => `written-${writtenMidi}`;

/**
 * HUMAN GATE C 전까지는 모두 draft-unreviewed다. 설명과 focusFingerIds를
 * 검수된 교육 콘텐츠로 승격하려면 별도의 실제 검토 기록이 필요하다.
 */
export const LESSONS = [
  {
    id: "lesson-open-left-hand",
    order: 1,
    title: "열린 음과 왼손",
    summaryKo: "열린 C♯에서 시작해 왼손 세 손가락과 새끼손가락의 변화를 봅니다.",
    contentStatus: "draft-unreviewed",
    prerequisiteLessonId: null,
    steps: [
      {
        id: "open-cs5",
        noteId: noteId(73),
        previousNoteId: null,
        title: "열린 C♯5",
        explanationKo: "손가락을 누르지 않은 열린 운지에서 출발합니다.",
        focusFingerIds: [],
        replaySpeed: "slow",
        prerequisite: null,
      },
      {
        id: "left-b4",
        noteId: noteId(71),
        previousNoteId: noteId(73),
        title: "왼손 검지로 B4",
        explanationKo: "왼손 검지로 첫 번째 기본 키를 누릅니다.",
        focusFingerIds: ["lh-index"],
        replaySpeed: "slow",
        prerequisite: "open-cs5",
      },
      {
        id: "left-a4",
        noteId: noteId(69),
        previousNoteId: noteId(71),
        title: "왼손 중지를 더해 A4",
        explanationKo: "왼손 검지는 유지하고 중지를 더합니다.",
        focusFingerIds: ["lh-middle"],
        replaySpeed: "slow",
        prerequisite: "left-b4",
      },
      {
        id: "left-g4",
        noteId: noteId(67),
        previousNoteId: noteId(69),
        title: "왼손 약지를 더해 G4",
        explanationKo: "왼손 검지와 중지를 유지하고 약지를 더합니다.",
        focusFingerIds: ["lh-ring"],
        replaySpeed: "slow",
        prerequisite: "left-a4",
      },
      {
        id: "left-gs4",
        noteId: noteId(68),
        previousNoteId: noteId(67),
        title: "새끼손가락으로 G♯4",
        explanationKo: "세 기본 키는 유지하고 왼손 새끼손가락을 G♯ 키로 옮깁니다.",
        focusFingerIds: ["lh-pinky"],
        replaySpeed: "step",
        prerequisite: "left-g4",
      },
    ],
  },
  {
    id: "lesson-right-hand",
    order: 2,
    title: "오른손 기본",
    summaryKo: "오른손 검지·중지·약지와 저음 E♭ 키를 차례로 익힙니다.",
    contentStatus: "draft-unreviewed",
    prerequisiteLessonId: "lesson-open-left-hand",
    steps: [
      {
        id: "right-f4",
        noteId: noteId(65),
        previousNoteId: noteId(67),
        title: "오른손 검지로 F4",
        explanationKo: "왼손 세 손가락을 유지하고 오른손 검지를 누릅니다.",
        focusFingerIds: ["rh-index"],
        replaySpeed: "slow",
        prerequisite: null,
      },
      {
        id: "right-e4",
        noteId: noteId(64),
        previousNoteId: noteId(65),
        title: "오른손 중지를 더해 E4",
        explanationKo: "오른손 검지를 유지하고 중지를 더합니다.",
        focusFingerIds: ["rh-middle"],
        replaySpeed: "slow",
        prerequisite: "right-f4",
      },
      {
        id: "right-d4",
        noteId: noteId(62),
        previousNoteId: noteId(64),
        title: "오른손 약지를 더해 D4",
        explanationKo: "오른손 검지와 중지를 유지하고 약지를 더합니다.",
        focusFingerIds: ["rh-ring"],
        replaySpeed: "slow",
        prerequisite: "right-e4",
      },
      {
        id: "right-eb4",
        noteId: noteId(63),
        previousNoteId: noteId(62),
        title: "새끼손가락으로 E♭4",
        explanationKo: "양손 기본 키를 유지하고 오른손 새끼손가락으로 low E♭ 키를 누릅니다.",
        focusFingerIds: ["rh-pinky"],
        replaySpeed: "step",
        prerequisite: "right-d4",
      },
    ],
  },
  {
    id: "lesson-low-register",
    order: 3,
    title: "가장 낮은 음",
    summaryKo: "양손을 유지한 채 저음 테이블에서 새끼손가락을 천천히 이동합니다.",
    contentStatus: "draft-unreviewed",
    prerequisiteLessonId: "lesson-right-hand",
    steps: [
      {
        id: "low-c4",
        noteId: noteId(60),
        previousNoteId: noteId(62),
        title: "low C 키로 C4",
        explanationKo: "양손 기본 키를 유지하고 오른손 새끼손가락으로 low C 키를 누릅니다.",
        focusFingerIds: ["rh-pinky"],
        replaySpeed: "step",
        prerequisite: null,
      },
      {
        id: "low-cs4",
        noteId: noteId(61),
        previousNoteId: noteId(60),
        title: "왼손 테이블을 더해 C♯4",
        explanationKo: "오른손 low C를 유지하고 왼손 새끼손가락으로 low C♯ 키를 더합니다.",
        focusFingerIds: ["lh-pinky"],
        replaySpeed: "step",
        prerequisite: "low-c4",
      },
      {
        id: "low-b3",
        noteId: noteId(59),
        previousNoteId: noteId(61),
        title: "저음 테이블에서 B3",
        explanationKo: "왼손 새끼손가락을 low B 키로 이동합니다.",
        focusFingerIds: ["lh-pinky"],
        replaySpeed: "step",
        prerequisite: "low-cs4",
      },
      {
        id: "low-bb3",
        noteId: noteId(58),
        previousNoteId: noteId(59),
        title: "가장 낮은 B♭3",
        explanationKo: "오른손 low C는 유지하고 왼손 새끼손가락을 low B♭ 키로 이동합니다.",
        focusFingerIds: ["lh-pinky", "rh-pinky"],
        replaySpeed: "step",
        prerequisite: "low-b3",
      },
    ],
  },
  {
    id: "lesson-octave-key",
    order: 4,
    title: "옥타브 키",
    summaryKo: "D5부터 C♯6까지 기본 운지와 옥타브 키의 관계를 비교합니다.",
    contentStatus: "draft-unreviewed",
    prerequisiteLessonId: "lesson-low-register",
    steps: Array.from({ length: 12 }, (_, index): LessonStep => {
      const midi = 74 + index;
      const id = `octave-${midi}`;
      return {
        id,
        noteId: noteId(midi),
        previousNoteId: index === 0 ? noteId(62) : noteId(midi - 1),
        title: `${midi === 74 ? "D5에서 시작" : `기보 MIDI ${midi}`} · 옥타브 키`,
        explanationKo:
          index === 0
            ? "낮은 D의 기본 운지에 왼손 엄지 옥타브 키를 더해 비교합니다."
            : "직전 음에서 바뀐 기본 키를 확인하고 옥타브 키는 유지합니다.",
        focusFingerIds: index === 0 ? ["lh-thumb"] : [],
        replaySpeed: index === 0 ? "step" : "slow",
        prerequisite: index === 0 ? null : `octave-${midi - 1}`,
      };
    }),
  },
  {
    id: "lesson-side-key",
    order: 5,
    title: "사이드키와 variant 개념",
    summaryKo: "검수된 primary B♭ 운지의 사이드키 움직임을 두 음역에서 비교합니다.",
    contentStatus: "draft-unreviewed",
    prerequisiteLessonId: "lesson-octave-key",
    steps: [
      {
        id: "side-bb4",
        noteId: noteId(70),
        previousNoteId: noteId(71),
        title: "B4에서 B♭4로",
        explanationKo: "왼손 검지는 유지하고 오른손 검지를 사이드 B♭ 키에 접촉시킵니다.",
        focusFingerIds: ["rh-index"],
        replaySpeed: "step",
        prerequisite: null,
      },
      {
        id: "side-bb5",
        noteId: noteId(82),
        previousNoteId: noteId(83),
        title: "B5에서 B♭5로",
        explanationKo: "옥타브 키와 왼손 검지를 유지하고 같은 사이드키 동작을 비교합니다.",
        focusFingerIds: ["lh-thumb", "rh-index"],
        replaySpeed: "step",
        prerequisite: "side-bb4",
      },
    ],
  },
  {
    id: "lesson-palm-high",
    order: 6,
    title: "팜키 고음",
    summaryKo: "D6부터 F♯6까지 팜키·사이드키 접촉의 차이를 천천히 봅니다.",
    contentStatus: "draft-unreviewed",
    prerequisiteLessonId: "lesson-side-key",
    steps: [
      {
        id: "palm-d6",
        noteId: noteId(86),
        previousNoteId: noteId(85),
        title: "팜 D로 D6",
        explanationKo: "옥타브 키를 유지하고 왼손 팜 D 접촉을 더합니다.",
        focusFingerIds: ["lh-index"],
        replaySpeed: "step",
        prerequisite: null,
      },
      {
        id: "palm-eb6",
        noteId: noteId(87),
        previousNoteId: noteId(86),
        title: "팜 E♭를 더해 E♭6",
        explanationKo: "팜 D를 유지하고 팜 E♭ 접촉을 더합니다.",
        focusFingerIds: ["lh-middle"],
        replaySpeed: "step",
        prerequisite: "palm-d6",
      },
      {
        id: "palm-e6",
        noteId: noteId(88),
        previousNoteId: noteId(87),
        title: "사이드 E로 E6",
        explanationKo: "왼손 팜키를 유지하고 오른손 검지를 사이드 E 키로 이동합니다.",
        focusFingerIds: ["rh-index"],
        replaySpeed: "step",
        prerequisite: "palm-eb6",
      },
      {
        id: "palm-f6",
        noteId: noteId(89),
        previousNoteId: noteId(88),
        title: "팜 F를 더해 F6",
        explanationKo: "기존 접촉을 유지하고 왼손 팜 F 접촉을 더합니다.",
        focusFingerIds: ["lh-ring"],
        replaySpeed: "step",
        prerequisite: "palm-e6",
      },
      {
        id: "palm-fs6",
        noteId: noteId(90),
        previousNoteId: noteId(89),
        title: "High F♯ 키가 있는 경우",
        explanationKo: "High F♯ 키 장착 여부를 먼저 확인합니다. 없거나 모르면 F6까지로 이 레슨을 완료합니다.",
        focusFingerIds: ["rh-middle"],
        replaySpeed: "step",
        prerequisite: "palm-f6",
        requiresCapabilities: ["high-fsharp-key"],
        optionalWhenUnsupported: true,
      },
    ],
  },
] satisfies readonly Lesson[];

export const DEFAULT_KEY_FINGER_MAP: Readonly<Record<string, string>> = {
  ok: "lh-thumb",
  pD: "lh-index",
  pEb: "lh-middle",
  pF: "lh-ring",
  frontF: "lh-index",
  lh1: "lh-index",
  bis: "lh-index",
  lh2: "lh-middle",
  lh3: "lh-ring",
  gSharp: "lh-pinky",
  lowCSharp: "lh-pinky",
  lowB: "lh-pinky",
  lowBb: "lh-pinky",
  sideE: "rh-index",
  sideC: "rh-index",
  sideBb: "rh-index",
  highFSharp: "rh-middle",
  rh1: "rh-index",
  altFSharp: "rh-index",
  rh2: "rh-middle",
  rh3: "rh-ring",
  lowEb: "rh-pinky",
  lowC: "rh-pinky",
};

export interface FingeringLike {
  readonly pressedKeyIds: readonly string[];
}

export interface NoteDiff {
  pressedKeyIds: readonly string[];
  releasedKeyIds: readonly string[];
  unchangedKeyIds: readonly string[];
  movedFingerIds: readonly string[];
  unmappedChangedKeyIds: readonly string[];
}

const uniqueSorted = (values: Iterable<string>) => [...new Set(values)].sort();

export function diffFingerings(
  previous: FingeringLike | null | undefined,
  current: FingeringLike,
  keyFingerMap: Readonly<Record<string, string>> = DEFAULT_KEY_FINGER_MAP,
): NoteDiff {
  const previousKeys = new Set(previous?.pressedKeyIds ?? []);
  const currentKeys = new Set(current.pressedKeyIds);
  const pressedKeyIds = uniqueSorted([...currentKeys].filter((key) => !previousKeys.has(key)));
  const releasedKeyIds = uniqueSorted([...previousKeys].filter((key) => !currentKeys.has(key)));
  const unchangedKeyIds = uniqueSorted([...currentKeys].filter((key) => previousKeys.has(key)));
  const changedKeyIds = [...pressedKeyIds, ...releasedKeyIds];

  return {
    pressedKeyIds,
    releasedKeyIds,
    unchangedKeyIds,
    movedFingerIds: uniqueSorted(changedKeyIds.flatMap((key) => keyFingerMap[key] ?? [])),
    unmappedChangedKeyIds: uniqueSorted(changedKeyIds.filter((key) => !keyFingerMap[key])),
  };
}

export const getNoteDiff = diffFingerings;

const FINGER_NAMES_KO: Readonly<Record<string, string>> = {
  "lh-thumb": "왼손 엄지",
  "lh-index": "왼손 검지",
  "lh-middle": "왼손 중지",
  "lh-ring": "왼손 약지",
  "lh-pinky": "왼손 새끼손가락",
  "rh-index": "오른손 검지",
  "rh-middle": "오른손 중지",
  "rh-ring": "오른손 약지",
  "rh-pinky": "오른손 새끼손가락",
};

export function describeNoteDiffKo(
  diff: NoteDiff,
  keyFingerMap: Readonly<Record<string, string>> = DEFAULT_KEY_FINGER_MAP,
): string {
  if (diff.pressedKeyIds.length === 0 && diff.releasedKeyIds.length === 0) {
    return "바뀌는 키가 없습니다.";
  }

  return diff.movedFingerIds
    .map((fingerId) => {
      const presses = diff.pressedKeyIds.filter((key) => keyFingerMap[key] === fingerId);
      const releases = diff.releasedKeyIds.filter((key) => keyFingerMap[key] === fingerId);
      const finger = FINGER_NAMES_KO[fingerId] ?? fingerId;
      if (presses.length > 0 && releases.length > 0) return `${finger}을 다른 키로 이동합니다.`;
      if (presses.length > 0) return `${finger}으로 키를 누릅니다.`;
      return `${finger}을 키에서 뗍니다.`;
    })
    .join(" ");
}

export function getPrimaryVariant(note: SaxNote): FingeringVariant {
  const variant = note.variants.find((candidate) => candidate.id === note.primaryVariantId);
  if (!variant) throw new Error(`${note.id}: primary variant를 찾을 수 없습니다.`);
  return variant;
}

export function diffNotes(
  previous: SaxNote | null | undefined,
  current: SaxNote,
  keyFingerMap: Readonly<Record<string, string>> = DEFAULT_KEY_FINGER_MAP,
): NoteDiff {
  return diffFingerings(previous ? getPrimaryVariant(previous) : null, getPrimaryVariant(current), keyFingerMap);
}

export function validateLessonDefinitions(
  lessons: readonly Lesson[] = LESSONS,
  notes: readonly SaxNote[] = SAX_NOTES,
): readonly string[] {
  const errors: string[] = [];
  const validNoteIds = new Set<string>(notes.map((note) => note.id));
  const lessonIds = new Set<string>();
  const stepIds = new Set<string>();
  const prerequisiteByLesson = new Map<string, string | null>();
  const prerequisiteByStep = new Map<string, string | null>();

  if (lessons.length !== 6) errors.push(`레슨 수는 6개여야 합니다: ${lessons.length}`);

  for (const lesson of lessons) {
    if (lessonIds.has(lesson.id)) errors.push(`중복 lesson id: ${lesson.id}`);
    lessonIds.add(lesson.id);
    prerequisiteByLesson.set(lesson.id, lesson.prerequisiteLessonId);
    for (const step of lesson.steps) {
      if (stepIds.has(step.id)) errors.push(`중복 step id: ${step.id}`);
      stepIds.add(step.id);
      prerequisiteByStep.set(step.id, step.prerequisite);
      if (!validNoteIds.has(step.noteId)) errors.push(`${step.id}: 잘못된 noteId ${step.noteId}`);
      if (step.previousNoteId && !validNoteIds.has(step.previousNoteId)) {
        errors.push(`${step.id}: 잘못된 previousNoteId ${step.previousNoteId}`);
      }
    }
  }

  for (const lesson of lessons) {
    if (lesson.prerequisiteLessonId && !lessonIds.has(lesson.prerequisiteLessonId)) {
      errors.push(`${lesson.id}: 잘못된 prerequisiteLessonId ${lesson.prerequisiteLessonId}`);
    }
  }
  for (const [stepId, prerequisite] of prerequisiteByStep) {
    if (prerequisite && !stepIds.has(prerequisite)) {
      errors.push(`${stepId}: 잘못된 prerequisite ${prerequisite}`);
    }
  }

  for (const start of lessonIds) {
    const seen = new Set<string>();
    let cursor: string | null | undefined = start;
    while (cursor) {
      if (seen.has(cursor)) {
        errors.push(`lesson prerequisite 순환: ${[...seen, cursor].join(" -> ")}`);
        break;
      }
      seen.add(cursor);
      cursor = prerequisiteByLesson.get(cursor);
    }
  }

  for (const start of stepIds) {
    const seen = new Set<string>();
    let cursor: string | null | undefined = start;
    while (cursor) {
      if (seen.has(cursor)) {
        errors.push(`step prerequisite 순환: ${[...seen, cursor].join(" -> ")}`);
        break;
      }
      seen.add(cursor);
      cursor = prerequisiteByStep.get(cursor);
    }
  }
  return uniqueSorted(errors);
}

export type PracticeQuestionKind = "recall" | "recognition";
export type PracticeMode = PracticeQuestionKind | "mixed";
export type PracticeLength = 5 | 10 | 20;
export type PracticeOrder = "sequential" | "random";

export interface PracticeEligibilityFilter {
  minWrittenMidi?: number;
  maxWrittenMidi?: number;
  lessonId?: string;
  lessonNoteIds?: readonly string[];
  /** 공개 모드 기본값 false. seed/needs-expert-review를 넣으려면 명시적으로 true여야 한다. */
  includeUnreviewed?: boolean;
  /** 공개 모드 기본값 false. 현재 악기에서 지원하지 않는 variant를 넣으려면 명시적으로 true여야 한다. */
  includeUnsupported?: boolean;
  capabilityProfile?: SaxCapabilityProfile;
  isReviewed?: (note: SaxNote, variant: FingeringVariant) => boolean;
  isSupported?: (note: SaxNote, variant: FingeringVariant) => boolean;
  notePredicate?: (note: SaxNote) => boolean;
}

export interface EligiblePracticeItem {
  note: SaxNote;
  variant: FingeringVariant;
}

const DEFAULT_CAPABILITIES: SaxCapabilityProfile = {
  highFSharpKey: "unknown",
  verifiedNonCapabilityAlternates: [],
};

function variantHasSupportedCapabilities(
  note: SaxNote,
  variant: FingeringVariant,
  profile: SaxCapabilityProfile,
): boolean {
  for (const capability of variant.requiredCapabilities) {
    if (capability === "high-fsharp-key") {
      if (profile.highFSharpKey === "yes") continue;
      return false;
    }
    return false;
  }
  if (
    note.writtenMidi === 90 &&
    profile.highFSharpKey !== "yes" &&
    variant.id === note.primaryVariantId &&
    !profile.verifiedNonCapabilityAlternates?.includes(note.writtenMidi)
  ) {
    return false;
  }
  return true;
}

function reviewedByDefault(_note: SaxNote, variant: FingeringVariant): boolean {
  return (
    variant.reviewStatus === "verified" &&
    variant.reviews.some((review) => review.decision === "approved")
  );
}

function lessonNoteSet(filter: PracticeEligibilityFilter): ReadonlySet<string> | null {
  if (filter.lessonNoteIds) return new Set(filter.lessonNoteIds);
  if (!filter.lessonId) return null;
  const lesson = LESSONS.find((candidate) => candidate.id === filter.lessonId);
  return new Set(lesson?.steps.map((step) => step.noteId) ?? []);
}

export function getEligiblePracticeItems(
  notes: readonly SaxNote[] = SAX_NOTES,
  filter: PracticeEligibilityFilter = {},
): readonly EligiblePracticeItem[] {
  const lessonIds = lessonNoteSet(filter);
  const profile = filter.capabilityProfile ?? DEFAULT_CAPABILITIES;
  const reviewCheck = filter.isReviewed ?? reviewedByDefault;

  return notes
    .filter((note) => filter.minWrittenMidi === undefined || note.writtenMidi >= filter.minWrittenMidi)
    .filter((note) => filter.maxWrittenMidi === undefined || note.writtenMidi <= filter.maxWrittenMidi)
    .filter((note) => !lessonIds || lessonIds.has(note.id))
    .filter((note) => filter.notePredicate?.(note) ?? true)
    .flatMap((note): EligiblePracticeItem[] => {
      const primary = getPrimaryVariant(note);
      const ordered = [primary, ...note.variants.filter((variant) => variant.id !== primary.id)];
      const variant = ordered.find((candidate) => {
        const reviewed = filter.includeUnreviewed === true || reviewCheck(note, candidate);
        const supported =
          filter.includeUnsupported === true ||
          (filter.isSupported?.(note, candidate) ?? variantHasSupportedCapabilities(note, candidate, profile));
        return reviewed && supported;
      });
      return variant ? [{ note, variant }] : [];
    })
    .sort((a, b) => a.note.writtenMidi - b.note.writtenMidi);
}

export function buildEligiblePool(
  notes: readonly SaxNote[] = SAX_NOTES,
  filter: PracticeEligibilityFilter = {},
): readonly SaxNote[] {
  return getEligiblePracticeItems(notes, filter).map((item) => item.note);
}

function hashSeed(seed: number | string): number {
  if (typeof seed === "number") return seed >>> 0;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: number | string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: number | string): T[] {
  const random = createSeededRandom(seed);
  return shuffleWith(items, random);
}

function shuffleWith<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export interface PracticeQuestion {
  id: string;
  index: number;
  kind: PracticeQuestionKind;
  answerNoteId: string;
  choiceNoteIds: readonly string[];
}

export interface PracticeSessionOptions extends PracticeEligibilityFilter {
  length?: PracticeLength;
  mode?: PracticeMode;
  order?: PracticeOrder;
  seed?: number | string;
}

export type PracticeFallback = "empty" | "single-recall" | "reduced-choices" | "standard";

export interface EmptyPracticeSession {
  status: "empty";
  eligibleCount: 0;
  fallback: "empty";
  reasonKo: string;
  questions: readonly [];
}

export interface ReadyPracticeSession {
  status: "ready";
  eligibleCount: number;
  fallback: Exclude<PracticeFallback, "empty">;
  seed: number | string;
  questions: readonly PracticeQuestion[];
}

export type PracticeSession = EmptyPracticeSession | ReadyPracticeSession;

function buildAnswerSequence(
  pool: readonly SaxNote[],
  length: number,
  order: PracticeOrder,
  random: () => number,
): SaxNote[] {
  const answers: SaxNote[] = [];
  let bag: SaxNote[] = [];
  while (answers.length < length) {
    if (bag.length === 0) bag = order === "random" ? shuffleWith(pool, random) : [...pool];
    if (
      pool.length >= 2 &&
      answers.length >= 2 &&
      answers.at(-1)?.id === answers.at(-2)?.id &&
      bag[0]?.id === answers.at(-1)?.id
    ) {
      const replacementIndex = bag.findIndex((note) => note.id !== answers.at(-1)?.id);
      if (replacementIndex >= 0) [bag[0], bag[replacementIndex]] = [bag[replacementIndex], bag[0]];
    }
    const next = bag.shift();
    if (next) answers.push(next);
  }
  return answers;
}

export function buildPracticeSession(
  notes: readonly SaxNote[] = SAX_NOTES,
  options: PracticeSessionOptions = {},
): PracticeSession {
  const length = options.length ?? 10;
  const mode = options.mode ?? "mixed";
  const order = options.order ?? "random";
  const seed = options.seed ?? "saxhands-default-session";
  const pool = buildEligiblePool(notes, options);

  if (pool.length === 0) {
    return {
      status: "empty",
      eligibleCount: 0,
      fallback: "empty",
      reasonKo: "현재 범위에는 검수되고 지원되는 연습 음이 없습니다. 음역 또는 악기 설정을 확인해 주세요.",
      questions: [],
    };
  }

  const random = createSeededRandom(seed);
  const answers = buildAnswerSequence(pool, length, order, random);
  const questions = answers.map((answer, index): PracticeQuestion => {
    const requestedKind = mode === "mixed" ? (index % 2 === 0 ? "recall" : "recognition") : mode;
    const kind: PracticeQuestionKind = pool.length === 1 ? "recall" : requestedKind;
    if (kind === "recall") {
      return { id: `question-${index + 1}`, index, kind, answerNoteId: answer.id, choiceNoteIds: [] };
    }
    const distractors = shuffleWith(
      pool.filter((note) => note.id !== answer.id),
      random,
    ).slice(0, Math.min(3, pool.length - 1));
    const choices = shuffleWith([answer, ...distractors], random).map((note) => note.id);
    return { id: `question-${index + 1}`, index, kind, answerNoteId: answer.id, choiceNoteIds: choices };
  });

  return {
    status: "ready",
    eligibleCount: pool.length,
    fallback: pool.length === 1 ? "single-recall" : pool.length < 4 ? "reduced-choices" : "standard",
    seed,
    questions,
  };
}

export function createPracticeSession(
  options: PracticeSessionOptions = {},
  notes: readonly SaxNote[] = SAX_NOTES,
): PracticeSession {
  return buildPracticeSession(notes, options);
}

export type LeitnerBox = 1 | 2 | 3 | 4 | 5;
export type SelfGrade = "again" | "hard" | "good";

export const LEITNER_INTERVAL_DAYS: Readonly<Record<LeitnerBox, number>> = {
  1: 1,
  2: 3,
  3: 7,
  4: 14,
  5: 30,
};

export interface LeitnerCard {
  noteId: string;
  box: LeitnerBox;
  seen: number;
  correct: number;
  again: number;
  lastSeen: string | null;
  nextDue: string;
}

export interface LeitnerGradeResult {
  card: LeitnerCard;
  requeueInCurrentSession: boolean;
  requeueAfterQuestions: number | null;
}

export function toUtcDateKey(value: Date | string = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("유효하지 않은 날짜입니다.");
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new RangeError("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function gradeLeitnerCard(
  noteId: string,
  previous: LeitnerCard | undefined,
  grade: SelfGrade,
  now: Date | string = new Date(),
): LeitnerGradeResult {
  const today = toUtcDateKey(now);
  const currentBox: LeitnerBox = previous?.box ?? 1;
  const box: LeitnerBox =
    grade === "again"
      ? 1
      : grade === "hard"
        ? (Math.max(1, currentBox - 1) as LeitnerBox)
        : (Math.min(5, currentBox + 1) as LeitnerBox);
  const interval = grade === "again" ? 0 : LEITNER_INTERVAL_DAYS[box];
  const card: LeitnerCard = {
    noteId,
    box,
    seen: (previous?.seen ?? 0) + 1,
    correct: (previous?.correct ?? 0) + (grade === "again" ? 0 : 1),
    again: (previous?.again ?? 0) + (grade === "again" ? 1 : 0),
    lastSeen: today,
    nextDue: addUtcDays(today, interval),
  };
  return {
    card,
    requeueInCurrentSession: grade === "again",
    requeueAfterQuestions: grade === "again" ? 3 : null,
  };
}

export function updateLeitnerCard(
  noteId: string,
  previous: LeitnerCard | undefined,
  grade: SelfGrade,
  now: Date | string = new Date(),
): LeitnerCard {
  return gradeLeitnerCard(noteId, previous, grade, now).card;
}

export function isLeitnerCardDue(card: LeitnerCard, now: Date | string = new Date()): boolean {
  return card.nextDue <= toUtcDateKey(now);
}

export const LOCAL_PROGRESS_SCHEMA_VERSION = 2 as const;
export const LOCAL_PROGRESS_STORAGE_KEY = "saxhands.progress.v2";

export interface LocalProgressV2 {
  schemaVersion: typeof LOCAL_PROGRESS_SCHEMA_VERSION;
  completedStepIds: readonly string[];
  lastLessonId: string | null;
  cards: Readonly<Record<string, LeitnerCard>>;
  updatedAt: string;
}

export type LocalProgress = LocalProgressV2;

export interface ProgressMigrationResult {
  progress: LocalProgressV2;
  status: "empty" | "current" | "migrated" | "reset";
  warningsKo: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function validDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function sanitizeCard(noteId: string, raw: unknown, today: string): LeitnerCard | null {
  if (!isRecord(raw)) return null;
  const numericBox = typeof raw.box === "number" ? raw.box : 1;
  const box = Math.min(5, Math.max(1, Math.round(numericBox))) as LeitnerBox;
  return {
    noteId,
    box,
    seen: nonNegativeInteger(raw.seen),
    correct: nonNegativeInteger(raw.correct),
    again: nonNegativeInteger(raw.again),
    lastSeen: validDateKey(raw.lastSeen) ? raw.lastSeen : null,
    nextDue: validDateKey(raw.nextDue) ? raw.nextDue : today,
  };
}

export function createEmptyLocalProgress(now: Date | string = new Date()): LocalProgressV2 {
  return {
    schemaVersion: LOCAL_PROGRESS_SCHEMA_VERSION,
    completedStepIds: [],
    lastLessonId: null,
    cards: {},
    updatedAt: new Date(now).toISOString(),
  };
}

export function migrateLocalProgress(
  raw: unknown,
  now: Date | string = new Date(),
): ProgressMigrationResult {
  const empty = createEmptyLocalProgress(now);
  const today = toUtcDateKey(now);
  if (raw === null || raw === undefined) return { progress: empty, status: "empty", warningsKo: [] };
  if (!isRecord(raw)) {
    return { progress: empty, status: "reset", warningsKo: ["저장된 진도 형식을 읽을 수 없어 새 진도로 시작합니다."] };
  }

  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
  if (version > LOCAL_PROGRESS_SCHEMA_VERSION) {
    return {
      progress: empty,
      status: "reset",
      warningsKo: ["더 최신 버전의 진도 데이터여서 현재 앱에서 안전하게 불러오지 않았습니다."],
    };
  }

  const completedStepIds = Array.isArray(raw.completedStepIds)
    ? uniqueSorted(raw.completedStepIds.filter((value): value is string => typeof value === "string"))
    : [];
  const lastLessonId = typeof raw.lastLessonId === "string" ? raw.lastLessonId : null;
  const legacyCards = isRecord(raw.cards)
    ? raw.cards
    : isRecord(raw.noteProgress)
      ? raw.noteProgress
      : isRecord(raw.practice)
        ? raw.practice
        : {};
  const cards: Record<string, LeitnerCard> = {};
  for (const [id, value] of Object.entries(legacyCards)) {
    const card = sanitizeCard(id, value, today);
    if (card) cards[id] = card;
  }
  const updatedAt =
    typeof raw.updatedAt === "string" && !Number.isNaN(Date.parse(raw.updatedAt))
      ? new Date(raw.updatedAt).toISOString()
      : empty.updatedAt;

  return {
    progress: {
      schemaVersion: LOCAL_PROGRESS_SCHEMA_VERSION,
      completedStepIds,
      lastLessonId,
      cards,
      updatedAt,
    },
    status: version === LOCAL_PROGRESS_SCHEMA_VERSION ? "current" : "migrated",
    warningsKo: version === LOCAL_PROGRESS_SCHEMA_VERSION ? [] : ["이전 버전의 진도를 현재 형식으로 변환했습니다."],
  };
}

export function parseLocalProgress(
  serialized: string | null | undefined,
  now: Date | string = new Date(),
): ProgressMigrationResult {
  if (!serialized) return migrateLocalProgress(null, now);
  try {
    return migrateLocalProgress(JSON.parse(serialized) as unknown, now);
  } catch {
    return {
      progress: createEmptyLocalProgress(now),
      status: "reset",
      warningsKo: ["저장된 진도 JSON이 손상되어 새 진도로 시작합니다."],
    };
  }
}

export function exportLocalProgressJson(progress: LocalProgressV2): string {
  const normalized = migrateLocalProgress(progress, progress.updatedAt).progress;
  const sortedCards = Object.fromEntries(Object.entries(normalized.cards).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ ...normalized, cards: sortedCards }, null, 2)}\n`;
}

export const exportProgressJson = exportLocalProgressJson;

export function completeLessonStep(
  progress: LocalProgressV2,
  stepId: string,
  lessonId: string,
  now: Date | string = new Date(),
): LocalProgressV2 {
  return {
    ...progress,
    completedStepIds: uniqueSorted([...progress.completedStepIds, stepId]),
    lastLessonId: lessonId,
    updatedAt: new Date(now).toISOString(),
  };
}

export function saveLeitnerCard(
  progress: LocalProgressV2,
  card: LeitnerCard,
  now: Date | string = new Date(),
): LocalProgressV2 {
  return {
    ...progress,
    cards: { ...progress.cards, [card.noteId]: card },
    updatedAt: new Date(now).toISOString(),
  };
}
