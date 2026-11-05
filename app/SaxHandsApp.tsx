"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { SaxophoneStage, type AnswerVisibility, type SaxophoneStageView } from "./components/SaxophoneStage";
import { StaffNote } from "./components/StaffNote";
import { Mp3ExportSheet } from "./components/Mp3ExportSheet";
import {
  SAX_INSTRUMENTS,
  SAX_KEYS,
  SAX_NOTES,
  concertMidi,
  getNoteByWrittenMidi,
  getNoteSupport,
  getPrimaryVariant,
  getSupportedNotes,
  writtenMidiToFixedDo,
  writtenMidiToNames,
  type AccidentalPreference,
  type HighFSharpCapability,
  type InstrumentId,
  type SaxCapabilityProfile,
  type SaxNote,
} from "@/lib/sax-data";
import {
  SAX_SYNTH_CLASSIC_VERSION,
  SAX_SYNTH_VERSION,
  createSaxSynthEngine,
  saxSynthVersionLabel,
  warmUpSaxModel,
  type SaxSynthEngine,
  type SaxSynthMode,
} from "@/lib/sax-synth";
import { warmMp3Encoder } from "@/lib/mp3-encode";
import type { SaxExportLabels } from "@/lib/sax-export";

type AppMode = "explore" | "learn" | "practice" | "chart";
type ThemeChoice = "system" | "light" | "dark";
type PracticeKind = "recall" | "recognition";
type ReferenceBasis = "concert" | "written";
type SelectionSource = "keypad" | "previous" | "next" | "lesson" | "practice" | "autoplay" | "chart" | "restore";
type Grade = "again" | "hard" | "good";

interface AppSettings {
  instrument: InstrumentId;
  accidental: AccidentalPreference;
  view: SaxophoneStageView;
  theme: ThemeChoice;
  highFSharpKey: HighFSharpCapability;
  reducedMotion: boolean;
  haptics: boolean;
  autoTone: boolean;
  /** `model` = SaxTone 3.0 (rendered notes), `classic` = SaxTone 2.0 (real-time oscillators). */
  toneEngine: SaxSynthMode;
  referenceBasis: ReferenceBasis;
  volume: number;
  animationSpeed: "normal" | "slow";
}

interface PracticeProgress {
  box: number;
  seen: number;
  correct: number;
  again: number;
  lastSeen: string;
  nextDue: string;
}

interface ProgressState {
  schemaVersion: 1;
  completedLessonIds: string[];
  notes: Record<string, PracticeProgress>;
  updatedAt: string;
}

interface LessonDefinition {
  id: string;
  title: string;
  subtitle: string;
  midis: readonly number[];
  explanations: readonly string[];
}

const SETTINGS_KEY = "saxhands.settings.v1";
const PROGRESS_KEY = "saxhands.progress.v1";
const HAPTIC_MS = 10;

const DEFAULT_SETTINGS: AppSettings = {
  instrument: "alto",
  accidental: "flat",
  view: "player",
  theme: "system",
  highFSharpKey: "unknown",
  reducedMotion: false,
  haptics: false,
  autoTone: false,
  toneEngine: "model",
  referenceBasis: "concert",
  volume: 0.18,
  animationSpeed: "normal",
};

const EMPTY_PROGRESS: ProgressState = {
  schemaVersion: 1,
  completedLessonIds: [],
  notes: {},
  updatedAt: "",
};

const LESSONS: readonly LessonDefinition[] = [
  {
    id: "open-left",
    title: "열린 음과 왼손",
    subtitle: "Open · 왼손 1·2·3 · 새끼손가락 slide",
    midis: [73, 71, 69, 67, 68],
    explanations: [
      "C♯5는 모든 키를 연 상태에서 시작합니다. 손의 힘을 빼고 자연스러운 기준 자세를 확인해요.",
      "왼손 검지를 첫 번째 진주키에 얹어 B4를 만듭니다.",
      "왼손 중지를 더해 A4로 내려갑니다. 검지는 그대로 유지해요.",
      "왼손 약지를 더해 G4를 만듭니다. 세 손가락의 곡선을 고르게 유지해요.",
      "왼손 새끼손가락을 G♯ 테이블로 짧게 미끄러뜨립니다.",
    ],
  },
  {
    id: "right-basic",
    title: "오른손 기본",
    subtitle: "오른손 1·2·3 · low E♭",
    midis: [65, 64, 62, 63],
    explanations: [
      "왼손 세 키를 유지하고 오른손 검지를 더해 F4를 만듭니다.",
      "오른손 중지를 더해 E4로 이동합니다.",
      "오른손 약지까지 닫아 D4의 기본 여섯 손가락 모양을 만듭니다.",
      "오른손 새끼손가락을 low E♭ 키로 이동합니다. 손목은 꺾지 않아요.",
    ],
  },
  {
    id: "low-table",
    title: "가장 낮은 음",
    subtitle: "양손 협응 · 저음 테이블",
    midis: [60, 61, 59, 58],
    explanations: [
      "여섯 기본 키를 유지한 채 오른손 새끼손가락으로 low C를 누릅니다.",
      "왼손 새끼손가락을 low C♯ 테이블로 옮깁니다. 나머지 손가락은 유지해요.",
      "왼손 새끼손가락을 low B 키로 천천히 미끄러뜨립니다.",
      "low B♭로 한 칸 더 이동합니다. 두 새끼손가락의 협응을 느리게 반복해요.",
    ],
  },
  {
    id: "octave-key",
    title: "옥타브 키",
    subtitle: "같은 기본 운지에 엄지 OK 더하기",
    midis: [74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85],
    explanations: Array.from({ length: 12 }, (_, index) =>
      index === 0
        ? "왼손 엄지로 옥타브 키를 누르면서 D5를 만듭니다. 아래 D와 손 모양을 비교해요."
        : "옥타브 키는 유지하고 아래 음역에서 익힌 기본 손가락 순서를 반복합니다.",
    ),
  },
  {
    id: "side-key",
    title: "사이드 키",
    subtitle: "기본 B♭의 옆 키 reach",
    midis: [70, 82],
    explanations: [
      "왼손 검지를 유지하고 오른손 검지를 사이드 B♭ 키로 뻗습니다.",
      "옥타브 키를 더한 상태에서 같은 사이드 B♭ 동작을 반복합니다.",
    ],
  },
  {
    id: "palm-high",
    title: "팜키 고음",
    subtitle: "손끝 press와 첫마디 roll",
    midis: [86, 87, 88, 89, 90],
    explanations: [
      "왼손 검지 첫마디를 palm D에 굴려 닿게 합니다. 손가락 길이는 늘어나지 않아요.",
      "palm D를 유지하며 중지 첫마디로 palm E♭를 더합니다.",
      "오른손 검지를 side E로 뻗어 E6을 만듭니다.",
      "왼손 약지 첫마디로 palm F를 더해 F6을 만듭니다.",
      "High F♯ 키가 있는 악기에서 오른손 중지로 해당 키를 더합니다.",
    ],
  },
];

const PAD_DEFINITIONS = [
  { pitchClass: 0, token: "1", sharp: "도 · C", flat: "도 · C", code: "Digit1" },
  { pitchClass: 1, token: "#1", sharp: "도♯ · C♯", flat: "레♭ · D♭", code: "Shift+Digit1" },
  { pitchClass: 2, token: "2", sharp: "레 · D", flat: "레 · D", code: "Digit2" },
  { pitchClass: 3, token: "#2", sharp: "레♯ · D♯", flat: "미♭ · E♭", code: "Shift+Digit2" },
  { pitchClass: 4, token: "3", sharp: "미 · E", flat: "미 · E", code: "Digit3" },
  { pitchClass: 5, token: "4", sharp: "파 · F", flat: "파 · F", code: "Digit4" },
  { pitchClass: 6, token: "#4", sharp: "파♯ · F♯", flat: "솔♭ · G♭", code: "Shift+Digit4" },
  { pitchClass: 7, token: "5", sharp: "솔 · G", flat: "솔 · G", code: "Digit5" },
  { pitchClass: 8, token: "#5", sharp: "솔♯ · G♯", flat: "라♭ · A♭", code: "Shift+Digit5" },
  { pitchClass: 9, token: "6", sharp: "라 · A", flat: "라 · A", code: "Digit6" },
  { pitchClass: 10, token: "#6", sharp: "라♯ · A♯", flat: "시♭ · B♭", code: "Shift+Digit6" },
  { pitchClass: 11, token: "7", sharp: "시 · B", flat: "시 · B", code: "Digit7" },
] as const;

const KEY_KOREAN: Record<string, string> = {
  ok: "왼손 엄지 옥타브 키",
  pD: "왼손 검지 palm D",
  pEb: "왼손 중지 palm E♭",
  pF: "왼손 약지 palm F",
  frontF: "왼손 검지 front F",
  lh1: "왼손 검지 첫 번째 진주키",
  bis: "왼손 검지 bis B♭",
  lh2: "왼손 중지 두 번째 진주키",
  lh3: "왼손 약지 세 번째 진주키",
  gSharp: "왼손 새끼손가락 G♯",
  lowCSharp: "왼손 새끼손가락 low C♯",
  lowB: "왼손 새끼손가락 low B",
  lowBb: "왼손 새끼손가락 low B♭",
  sideE: "오른손 검지 side E",
  sideC: "오른손 검지 side C",
  sideBb: "오른손 검지 side B♭",
  highFSharp: "오른손 중지 high F♯",
  rh1: "오른손 검지 첫 번째 진주키",
  altFSharp: "오른손 검지 trill F♯",
  rh2: "오른손 중지 두 번째 진주키",
  rh3: "오른손 약지 세 번째 진주키",
  lowEb: "오른손 새끼손가락 low E♭",
  lowC: "오른손 새끼손가락 low C",
};

function pressedKeys(note: SaxNote): readonly string[] {
  return getPrimaryVariant(note).pressedKeyIds;
}

function nextDate(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function makePracticeQueue(notes: readonly SaxNote[], size = 10): number[] {
  if (!notes.length) return [];
  const seed = new Date().getFullYear() * 10000 + (new Date().getMonth() + 1) * 100 + new Date().getDate();
  const shuffled = seededShuffle(notes, seed);
  const queue: number[] = [];
  for (let index = 0; index < size; index += 1) {
    let midi = shuffled[index % shuffled.length].writtenMidi;
    if (queue.length >= 2 && queue.at(-1) === midi && queue.at(-2) === midi && shuffled.length > 1) {
      midi = shuffled[(index + 1) % shuffled.length].writtenMidi;
    }
    queue.push(midi);
  }
  return queue;
}

function makeChoices(answerMidi: number, notes: readonly SaxNote[], seed: number): number[] {
  const others = seededShuffle(notes.filter((note) => note.writtenMidi !== answerMidi), answerMidi * 97 + seed);
  const size = Math.min(4, notes.length);
  return seededShuffle([answerMidi, ...others.slice(0, Math.max(0, size - 1)).map((note) => note.writtenMidi)], seed + 17);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select, [contenteditable='true']") || Boolean(target.closest("[role='dialog']"));
}

export function SaxHandsApp() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [progress, setProgress] = useState<ProgressState>(EMPTY_PROGRESS);
  const [mode, setMode] = useState<AppMode>("explore");
  const [selectedMidi, setSelectedMidi] = useState(67);
  const [selectedOctave, setSelectedOctave] = useState(4);
  const [previousPressed, setPreviousPressed] = useState<readonly string[]>([]);
  const [replayToken, setReplayToken] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mp3Open, setMp3Open] = useState(false);
  const [announcement, setAnnouncement] = useState("G4 운지를 표시했습니다.");
  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(true);
  const [offlineReady, setOfflineReady] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [lessonStep, setLessonStep] = useState(0);
  const [practiceKind, setPracticeKind] = useState<PracticeKind>("recall");
  const [practiceQueue, setPracticeQueue] = useState<number[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceRevealed, setPracticeRevealed] = useState(false);
  const [practiceSelected, setPracticeSelected] = useState<number | null>(null);
  const [chartSearch, setChartSearch] = useState("");

  const appContentRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPanelRef = useRef<HTMLElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const mp3ButtonRef = useRef<HTMLButtonElement>(null);
  const currentPressedRef = useRef<readonly string[]>(pressedKeys(SAX_NOTES.find((note) => note.writtenMidi === 67) ?? SAX_NOTES[0]));
  const synthRef = useRef<SaxSynthEngine | null>(null);
  const toneEngineRef = useRef<SaxSynthMode>(DEFAULT_SETTINGS.toneEngine);
  const autoToneTimerRef = useRef<number | null>(null);
  const refreshingForUpdateRef = useRef(false);

  const capabilityProfile = useMemo<SaxCapabilityProfile>(
    () => ({ highFSharpKey: settings.highFSharpKey }),
    [settings.highFSharpKey],
  );
  const supportedNotes = useMemo(() => getSupportedNotes(capabilityProfile), [capabilityProfile]);
  const currentNote = getNoteByWrittenMidi(selectedMidi) ?? SAX_NOTES[0];
  const currentPressed = pressedKeys(currentNote);
  const writtenNames = writtenMidiToNames(currentNote.writtenMidi, settings.accidental);
  const soundingMidi = concertMidi(currentNote.writtenMidi, settings.instrument);
  const soundingNames = writtenMidiToNames(soundingMidi, settings.accidental);
  const instrument = SAX_INSTRUMENTS[settings.instrument];
  const currentLesson = LESSONS[lessonIndex];
  const lessonMidi = currentLesson.midis[lessonStep] ?? currentLesson.midis[0];
  const practiceAnswerMidi = practiceQueue[practiceIndex] ?? selectedMidi;
  const practiceDone = practiceQueue.length > 0 && practiceIndex >= practiceQueue.length;
  const recognitionProtected = mode === "practice" && practiceKind === "recognition" && !practiceRevealed && !practiceDone;
  const recallProtected = mode === "practice" && practiceKind === "recall" && !practiceRevealed && !practiceDone;
  const practiceAudioProtected = recognitionProtected || recallProtected;
  const answerVisibility: AnswerVisibility = recallProtected
    ? "recall-hidden"
    : recognitionProtected
      ? "recognition-blind"
      : "full";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedSettings = window.localStorage.getItem(SETTINGS_KEY);
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings) as Partial<AppSettings>;
          const instrument = parsed.instrument && parsed.instrument in SAX_INSTRUMENTS
            ? parsed.instrument
            : DEFAULT_SETTINGS.instrument;
          const volume = typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
            ? Math.min(1, Math.max(0, parsed.volume))
            : DEFAULT_SETTINGS.volume;
          const toneEngine: SaxSynthMode = parsed.toneEngine === "classic" ? "classic" : "model";
          setSettings({ ...DEFAULT_SETTINGS, ...parsed, instrument, volume, toneEngine });
        }
        else if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setSettings((current) => ({ ...current, reducedMotion: true }));
        }
        const savedProgress = window.localStorage.getItem(PROGRESS_KEY);
        if (savedProgress) {
          const parsed = JSON.parse(savedProgress) as Partial<ProgressState>;
          if (parsed.schemaVersion === 1) {
            setProgress({ ...EMPTY_PROGRESS, ...parsed, notes: parsed.notes ?? {} });
          }
        }
      } catch {
        setToast("저장된 설정을 읽지 못해 안전한 기본값으로 시작했습니다.");
      } finally {
        setSettingsReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
    const dark = settings.theme === "dark" || (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#171b1a" : "#f4efdf");
  }, [settings, settingsReady]);

  useEffect(() => {
    if (!settingsReady) return;
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  }, [progress, settingsReady]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);

    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    let updateFoundHandler: (() => void) | undefined;
    const controllerChangeHandler = () => {
      if (refreshingForUpdateRef.current) return;
      refreshingForUpdateRef.current = true;
      window.location.reload();
    };

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", controllerChangeHandler);
      navigator.serviceWorker.register("/sw.js").then((registered) => {
        if (cancelled) return;
        registration = registered;
        const watchInstallingWorker = () => {
          const installing = registered.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(installing);
              setAnnouncement("SaxHands 새 버전을 설치할 수 있습니다.");
            }
          });
        };
        updateFoundHandler = watchInstallingWorker;
        registered.addEventListener("updatefound", watchInstallingWorker);
        if (registered.waiting && navigator.serviceWorker.controller) setWaitingWorker(registered.waiting);
        navigator.serviceWorker.ready.then(() => {
          if (!cancelled) setOfflineReady(true);
        });
      }).catch(() => setOfflineReady(false));
    }
    return () => {
      cancelled = true;
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      navigator.serviceWorker?.removeEventListener("controllerchange", controllerChangeHandler);
      if (registration && updateFoundHandler) registration.removeEventListener("updatefound", updateFoundHandler);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const getOrCreateSynth = useCallback(() => {
    if (!synthRef.current) synthRef.current = createSaxSynthEngine({ mode: toneEngineRef.current });
    return synthRef.current;
  }, []);

  /** Pitch, instrument and length of the tone that belongs to a written (fingered) note. */
  const toneNote = useCallback(
    (writtenMidi: number) => ({
      midi: settings.referenceBasis === "concert" ? concertMidi(writtenMidi, settings.instrument) : writtenMidi,
      instrument: settings.instrument,
      duration: settings.animationSpeed === "slow" ? 1.72 : 1.42,
    }),
    [settings.animationSpeed, settings.instrument, settings.referenceBasis],
  );

  const stopVoices = useCallback(() => {
    if (autoToneTimerRef.current !== null) {
      window.clearTimeout(autoToneTimerRef.current);
      autoToneTimerRef.current = null;
    }
    synthRef.current?.stopAll();
  }, []);

  const playTone = useCallback(
    async (writtenMidi: number) => {
      const synth = getOrCreateSynth();
      if (!synth) {
        setToast("이 브라우저에서는 색소폰 합성음을 재생할 수 없습니다.");
        return;
      }
      synth.setMode(settings.toneEngine);
      synth.setVolume(settings.volume);
      if (!(await synth.ensureRunning())) {
        setToast("브라우저의 오디오 재생 허용 후 다시 눌러 주세요.");
        return;
      }
      try {
        synth.play(toneNote(writtenMidi));
      } catch {
        synth.stopAll();
        setToast("오디오 장치를 준비하지 못했습니다. 잠시 후 다시 눌러 주세요.");
      }
    },
    [getOrCreateSynth, settings.toneEngine, settings.volume, toneNote],
  );

  const selectNote = useCallback(
    (midi: number, source: SelectionSource) => {
      const note = getNoteByWrittenMidi(midi);
      if (!note) return false;
      const support = getNoteSupport(note, capabilityProfile);
      if (!support.supported) {
        setToast(settings.highFSharpKey === "no" ? "이 악기 설정에서는 High F♯ 키가 필요한 F♯6을 사용할 수 없습니다." : "F♯6을 보려면 악기에 High F♯ 키가 있는지 설정에서 확인해 주세요.");
        return false;
      }
      setPreviousPressed([...currentPressedRef.current]);
      const nextPressed = pressedKeys(note);
      currentPressedRef.current = nextPressed;
      setSelectedMidi(midi);
      setSelectedOctave(Math.floor(midi / 12) - 1);
      setReplayToken((token) => token + 1);
      if (source !== "autoplay") setAutoplay(false);
      const name = writtenMidiToNames(midi, settings.accidental).display;
      setAnnouncement(`${name}, ${writtenMidiToFixedDo(midi)} 운지를 표시했습니다.`);
      if (settings.haptics) navigator.vibrate?.(HAPTIC_MS);
      if (autoToneTimerRef.current !== null) {
        window.clearTimeout(autoToneTimerRef.current);
        autoToneTimerRef.current = null;
      }
      if (settings.autoTone && source !== "practice" && !practiceAudioProtected) {
        const synth = getOrCreateSynth();
        if (synth) {
          synth.setMode(settings.toneEngine);
          synth.setVolume(settings.volume);
          void synth.ensureRunning();
          // SaxTone 3.0 computes the note in small slices while the hand moves, so the tone starts on time.
          if (settings.volume > 0) void synth.prepare(toneNote(midi));
        }
        autoToneTimerRef.current = window.setTimeout(() => {
          autoToneTimerRef.current = null;
          void playTone(midi);
        }, settings.reducedMotion ? 0 : settings.animationSpeed === "slow" ? 620 : 430);
      } else if (synthRef.current && settings.volume > 0 && source !== "practice" && !practiceAudioProtected) {
        // The learner has used sound before: have the note ready for the listen button as well.
        void synthRef.current.prepare(toneNote(midi));
      }
      return true;
    },
    [capabilityProfile, getOrCreateSynth, playTone, practiceAudioProtected, settings.accidental, settings.animationSpeed, settings.autoTone, settings.highFSharpKey, settings.haptics, settings.reducedMotion, settings.toneEngine, settings.volume, toneNote],
  );

  const moveNote = useCallback(
    (delta: -1 | 1, source: "previous" | "next" | "autoplay") => {
      const index = supportedNotes.findIndex((note) => note.writtenMidi === selectedMidi);
      const start = index < 0 ? 0 : index;
      const next = supportedNotes[(start + delta + supportedNotes.length) % supportedNotes.length];
      if (next) selectNote(next.writtenMidi, source);
    },
    [selectNote, selectedMidi, supportedNotes],
  );

  useEffect(() => {
    if (!autoplay) return;
    const delay = settings.animationSpeed === "slow" ? 1250 : 820;
    const timer = window.setTimeout(() => moveNote(1, "autoplay"), delay);
    return () => window.clearTimeout(timer);
  }, [autoplay, moveNote, selectedMidi, settings.animationSpeed]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        setAutoplay(false);
        stopVoices();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stopVoices);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stopVoices);
    };
  }, [stopVoices]);

  useEffect(() => {
    synthRef.current?.setVolume(settings.volume);
  }, [settings.volume]);

  useEffect(() => {
    toneEngineRef.current = settings.toneEngine;
    synthRef.current?.setMode(settings.toneEngine);
  }, [settings.toneEngine]);

  useEffect(() => {
    if (settings.toneEngine !== "model") return;
    // The first touch is a good moment to compile the SaxTone 3.0 renderer in the background.
    const warmUp = () => void warmUpSaxModel();
    document.addEventListener("pointerdown", warmUp, { once: true, passive: true });
    return () => document.removeEventListener("pointerdown", warmUp);
  }, [settings.toneEngine]);

  useEffect(() => {
    // Same first touch: fetch the MP3 encoder quietly so the service worker can cache it for offline use.
    const warm = () => void warmMp3Encoder();
    document.addEventListener("pointerdown", warm, { once: true, passive: true });
    return () => document.removeEventListener("pointerdown", warm);
  }, []);

  useEffect(() => () => {
    if (autoToneTimerRef.current !== null) window.clearTimeout(autoToneTimerRef.current);
    const synth = synthRef.current;
    synthRef.current = null;
    void synth?.dispose();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isEditableTarget(event.target) || settingsOpen || mp3Open) return;
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        moveNote(-1, "previous");
        return;
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        moveNote(1, "next");
        return;
      }
      if (event.code === "BracketLeft" || event.code === "BracketRight") {
        const nextOctave = Math.min(6, Math.max(3, selectedOctave + (event.code === "BracketLeft" ? -1 : 1)));
        if (nextOctave !== selectedOctave) {
          event.preventDefault();
          setSelectedOctave(nextOctave);
        }
        return;
      }
      const digit = Number(event.code.replace("Digit", ""));
      if (!Number.isInteger(digit) || digit < 1 || digit > 7) return;
      const naturalPitchClasses: Record<number, number> = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
      const accidentalPitchClasses: Record<number, number> = { 1: 1, 2: 3, 4: 6, 5: 8, 6: 10 };
      const pitchClass = event.shiftKey ? accidentalPitchClasses[digit] : naturalPitchClasses[digit];
      if (pitchClass === undefined) return;
      const midi = 12 * (selectedOctave + 1) + pitchClass;
      if (getNoteByWrittenMidi(midi)) {
        event.preventDefault();
        selectNote(midi, "keypad");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveNote, mp3Open, selectNote, selectedOctave, settingsOpen]);

  useEffect(() => {
    const content = appContentRef.current;
    if (settingsOpen || mp3Open) {
      content?.setAttribute("inert", "");
      if (settingsOpen) settingsCloseRef.current?.focus();
    } else {
      content?.removeAttribute("inert");
    }
  }, [mp3Open, settingsOpen]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.setTimeout(() => settingsButtonRef.current?.focus(), 0);
  }, []);

  const openMp3 = useCallback(() => {
    // The live tone and the exported preview must never sound at the same time.
    setAutoplay(false);
    stopVoices();
    setMp3Open(true);
  }, [stopVoices]);

  const closeMp3 = useCallback(() => {
    setMp3Open(false);
    window.setTimeout(() => mp3ButtonRef.current?.focus(), 0);
  }, []);

  // What the MP3 sheet exports: the tone of the current note, with the names the sheet and the file show.
  const exportTone = mp3Open ? toneNote(currentNote.writtenMidi) : null;
  const exportPitchNames = exportTone ? writtenMidiToNames(exportTone.midi, settings.accidental) : null;
  const exportLabels: SaxExportLabels | null = exportPitchNames
    ? {
        instrumentKo: instrument.koreanName,
        fingeringDisplay: writtenNames.display,
        fingeringAscii: writtenNames.ascii,
        pitchDisplay: exportPitchNames.display,
        pitchAscii: exportPitchNames.ascii,
      }
    : null;

  const onSettingsKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSettings();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = settingsPanelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])");
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const openMode = (nextMode: AppMode) => {
    setMode(nextMode);
    setAutoplay(false);
    if (nextMode === "learn") selectNote(lessonMidi, "lesson");
    if (nextMode === "practice" && practiceQueue.length === 0) startPractice(practiceKind);
  };

  const chooseLesson = (index: number) => {
    setLessonIndex(index);
    setLessonStep(0);
    const firstSupported = LESSONS[index].midis.find((midi) => getNoteSupport(midi, capabilityProfile).supported);
    if (firstSupported !== undefined) selectNote(firstSupported, "lesson");
  };

  const moveLesson = (delta: -1 | 1) => {
    const candidate = Math.min(currentLesson.midis.length - 1, Math.max(0, lessonStep + delta));
    let next = candidate;
    while (next >= 0 && next < currentLesson.midis.length && !getNoteSupport(currentLesson.midis[next], capabilityProfile).supported) next += delta;
    if (next < 0 || next >= currentLesson.midis.length) {
      if (delta === 1) {
        setProgress((current) => ({
          ...current,
          completedLessonIds: [...new Set([...current.completedLessonIds, currentLesson.id])],
          updatedAt: new Date().toISOString(),
        }));
        setToast("레슨을 완료했습니다. 천천히 다시 반복해도 좋아요.");
      }
      return;
    }
    setLessonStep(next);
    selectNote(currentLesson.midis[next], "lesson");
  };

  function startPractice(kind: PracticeKind) {
    const queue = makePracticeQueue(supportedNotes, 10);
    setPracticeKind(kind);
    setPracticeQueue(queue);
    setPracticeIndex(0);
    setPracticeRevealed(false);
    setPracticeSelected(null);
    if (queue[0] !== undefined) selectNote(queue[0], "practice");
  }

  const revealPractice = () => {
    setPracticeRevealed(true);
    setAnnouncement(`${writtenMidiToNames(practiceAnswerMidi, settings.accidental).display} 정답 운지를 공개했습니다.`);
  };

  const chooseRecognition = (midi: number) => {
    setPracticeSelected(midi);
    setPracticeRevealed(true);
    const correct = midi === practiceAnswerMidi;
    setAnnouncement(correct ? "정답입니다. 손가락 변화를 확인하세요." : `다시 확인해 볼 음은 ${writtenMidiToNames(practiceAnswerMidi, settings.accidental).display}입니다.`);
    if (settings.haptics) navigator.vibrate?.(HAPTIC_MS);
  };

  const gradePractice = (grade: Grade) => {
    const noteId = `written-${practiceAnswerMidi}`;
    const now = new Date().toISOString();
    setProgress((current) => {
      const before = current.notes[noteId] ?? { box: 1, seen: 0, correct: 0, again: 0, lastSeen: "", nextDue: "" };
      const nextBox = grade === "again" ? 1 : grade === "hard" ? Math.max(1, before.box - 1) : Math.min(5, before.box + 1);
      const intervals = [0, 1, 3, 7, 14, 30];
      return {
        ...current,
        notes: {
          ...current.notes,
          [noteId]: {
            box: nextBox,
            seen: before.seen + 1,
            correct: before.correct + (grade === "good" ? 1 : 0),
            again: before.again + (grade === "again" ? 1 : 0),
            lastSeen: now,
            nextDue: nextDate(intervals[nextBox]),
          },
        },
        updatedAt: now,
      };
    });
    const nextIndex = practiceIndex + 1;
    setPracticeIndex(nextIndex);
    setPracticeRevealed(false);
    setPracticeSelected(null);
    if (nextIndex < practiceQueue.length) selectNote(practiceQueue[nextIndex], "practice");
  };

  const lessonPreviousMidi = lessonStep > 0 ? currentLesson.midis[lessonStep - 1] : null;
  const lessonPreviousPressed = lessonPreviousMidi === null ? [] : pressedKeys(getNoteByWrittenMidi(lessonPreviousMidi) ?? currentNote);
  const lessonPressedSet = new Set(currentPressed);
  const lessonPreviousSet = new Set(lessonPreviousPressed);
  const addedKeys = currentPressed.filter((key) => !lessonPreviousSet.has(key));
  const releasedKeys = lessonPreviousPressed.filter((key) => !lessonPressedSet.has(key));
  const practiceChoices = useMemo(
    () => makeChoices(practiceAnswerMidi, supportedNotes, practiceIndex),
    [practiceAnswerMidi, practiceIndex, supportedNotes],
  );
  const filteredChartNotes = useMemo(() => {
    const query = chartSearch.trim().toLocaleLowerCase("ko");
    if (!query) return SAX_NOTES;
    return SAX_NOTES.filter((note) => {
      const names = writtenMidiToNames(note.writtenMidi, settings.accidental);
      return `${names.display} ${writtenMidiToFixedDo(note.writtenMidi)} ${note.sourceSeed.short}`.toLocaleLowerCase("ko").includes(query);
    });
  }, [chartSearch, settings.accidental]);

  const stageTitle = recognitionProtected ? "이 손 모양은 어떤 음일까요?" : writtenNames.display;
  const stageFixedDo = recognitionProtected ? "운지 인식 문제" : `${writtenMidiToFixedDo(currentNote.writtenMidi)}${Math.floor(currentNote.writtenMidi / 12) - 1}`;
  const formula = currentPressed.length ? currentPressed.map((key) => KEY_KOREAN[key] ?? key).join(" · ") : "모든 키에서 손가락을 뗀 열린 운지";

  return (
    <>
      <div className="sax-app" data-theme={settings.theme}>
        <a className="skip-link" href="#main-content">주요 학습 화면으로 건너뛰기</a>
        <div ref={appContentRef}>
          <header className="app-header">
            <a className="brand" href="#main-content" aria-label="SaxHands 홈">
              <span className="brand-mark" aria-hidden="true">S</span>
              <span className="brand-copy">
                <span className="brand-name">SaxHands</span>
                <span className="brand-tagline">두 손으로 익히는 색소폰 운지</span>
              </span>
            </a>
            <div className="header-actions">
              <label className="sr-only" htmlFor="instrument-quick">색소폰 종류</label>
              <select
                id="instrument-quick"
                className="compact-select"
                value={settings.instrument}
                onChange={(event) => setSettings((current) => ({ ...current, instrument: event.target.value as InstrumentId }))}
              >
                {(Object.keys(SAX_INSTRUMENTS) as InstrumentId[]).map((id) => (
                  <option key={id} value={id}>{SAX_INSTRUMENTS[id].koreanName.replace(" 색소폰", "")}</option>
                ))}
              </select>
              <button ref={settingsButtonRef} className="icon-button" type="button" aria-label="설정 열기" onClick={() => setSettingsOpen(true)}>⚙</button>
            </div>
          </header>

          <main id="main-content" className="app-main">
            <div className="workspace">
              <article className="card stage-card" aria-labelledby="current-note-heading">
                <div className="readout">
                  <div>
                    <p className="eyebrow">{recognitionProtected ? "운지 인식" : "Written pitch · 기보음"}</p>
                    <div className="note-heading">
                      <h1 id="current-note-heading">{stageTitle}</h1>
                      <span className="fixed-do">{stageFixedDo}</span>
                    </div>
                    {!recognitionProtected && (
                      <p className="note-meta">
                        <span>실음 <strong>{soundingNames.display}</strong></span>
                        <span>{instrument.koreanName}</span>
                        <span>누른 키 <strong>{currentPressed.length}</strong>개</span>
                      </p>
                    )}
                  </div>
                  <div className="staff-wrap" aria-hidden={recognitionProtected || recallProtected ? "true" : undefined}>
                    {recognitionProtected || recallProtected ? <span aria-hidden="true">?</span> : <StaffNote writtenMidi={currentNote.writtenMidi} accidentalPreference={settings.accidental} />}
                  </div>
                </div>

                <div className="fingering-summary">
                  <p>{recognitionProtected ? "손가락과 눌린 키를 보고 음을 골라 보세요." : recallProtected ? "먼저 실제 악기로 손 모양을 떠올린 뒤 정답을 확인하세요." : formula}</p>
                  <span className="source-badge">원본 자료 기반</span>
                </div>

                <div className={answerVisibility === "recall-hidden" ? "stage-hidden" : "stage-shell"}>
                  {answerVisibility === "recall-hidden" ? (
                    <p><strong>운지를 떠올려 보세요</strong>준비가 되면 아래에서 정답을 확인합니다.</p>
                  ) : (
                    <SaxophoneStage
                      note={{ id: currentNote.id, writtenName: writtenNames.display, pressed: currentPressed }}
                      previousPressed={previousPressed}
                      view={settings.view}
                      reducedMotion={settings.reducedMotion}
                      answerVisibility={answerVisibility}
                      replayToken={replayToken}
                      animationSpeed={settings.animationSpeed}
                    />
                  )}
                  {answerVisibility !== "recall-hidden" && <span className="stage-caption">{settings.view === "player" ? "연주자 시점" : "거울 시점"} · {settings.reducedMotion ? "정적 전환" : settings.animationSpeed === "slow" ? "느리게" : "보통"}</span>}
                </div>

                <div className="transport" aria-label="운지 재생 조작">
                  <button type="button" disabled={practiceAudioProtected} onClick={() => moveNote(-1, "previous")} aria-label="이전 반음">← 이전</button>
                  <button type="button" onClick={() => setReplayToken((token) => token + 1)}>↻ 다시</button>
                  <button
                    type="button"
                    disabled={practiceAudioProtected}
                    onClick={() => void playTone(currentNote.writtenMidi)}
                    aria-label="고품질 색소폰 모델링 합성음 듣기"
                    title={practiceAudioProtected ? "정답을 확인한 뒤 들을 수 있습니다." : `${instrument.koreanName} 모델링 음색`}
                  >
                    ♪ 음색 듣기
                  </button>
                  <button type="button" disabled={practiceAudioProtected} aria-pressed={autoplay} onClick={() => setAutoplay((value) => !value)}>{autoplay ? "■ 정지" : "▶ 재생"}</button>
                </div>
                <div className="export-bar">
                  <button
                    ref={mp3ButtonRef}
                    className="secondary-button"
                    type="button"
                    disabled={practiceAudioProtected}
                    aria-haspopup="dialog"
                    onClick={openMp3}
                    title={practiceAudioProtected ? "정답을 확인한 뒤 저장할 수 있습니다." : `${SAX_SYNTH_VERSION} 합성음을 MP3 파일로 저장`}
                  >
                    ⬇ MP3로 저장
                  </button>
                </div>
              </article>

              <div className="right-column">
                <nav className="bottom-nav" aria-label="학습 모드">
                  {([
                    ["explore", "탐색"],
                    ["learn", "배우기"],
                    ["practice", "연습"],
                    ["chart", "운지표"],
                  ] as const).map(([id, label], index) => (
                    <button key={id} className="nav-button" type="button" data-index={`0${index + 1}`} aria-current={mode === id ? "page" : undefined} onClick={() => openMode(id)}>{label}</button>
                  ))}
                </nav>

                <section className="card mode-card" aria-live="off">
                  {mode === "explore" && (
                    <>
                      <header className="panel-header">
                        <div><h2>빠르게 찾기</h2><p>옥타브 한 번, 음 한 번 — 최대 두 번 탭합니다.</p></div>
                        <span className="status-badge">{supportedNotes.length}/33음</span>
                      </header>
                      <div className="octave-control" aria-label="기보 옥타브 선택">
                        {[3, 4, 5, 6].map((octave) => (
                          <button key={octave} type="button" aria-pressed={selectedOctave === octave} onClick={() => setSelectedOctave(octave)}>{octave}</button>
                        ))}
                      </div>
                      <p id="range-help" className="range-help">3옥타브는 B♭·B, 6옥타브는 C~F♯만 있습니다. {settings.highFSharpKey !== "yes" && "F♯6은 High F♯ 키 확인 전 비활성입니다."}</p>
                      <div className="chromatic-pad" aria-describedby="range-help">
                        {PAD_DEFINITIONS.map((pad) => {
                          const midi = 12 * (selectedOctave + 1) + pad.pitchClass;
                          const note = getNoteByWrittenMidi(midi);
                          const support = note ? getNoteSupport(note, capabilityProfile) : null;
                          const disabled = !note || !support?.supported;
                          const label = settings.accidental === "flat" ? pad.flat : pad.sharp;
                          return (
                            <button
                              key={pad.pitchClass}
                              className="pitch-pad"
                              type="button"
                              disabled={disabled}
                              aria-pressed={selectedMidi === midi}
                              aria-label={`${label}, ${selectedOctave}옥타브${disabled ? ", 지원 범위 밖 또는 악기 확인 필요" : ""}`}
                              onClick={() => selectNote(midi, "keypad")}
                            >
                              <span className="pad-token">{pad.token}</span>
                              <span className="pad-name">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {mode === "learn" && (
                    <div className="lesson-layout">
                      <header className="panel-header">
                        <div><h2>변화를 보며 배우기</h2><p>여섯 레슨을 작은 손가락 변화로 나눴습니다.</p></div>
                        <span className="status-badge">콘텐츠 검수 중</span>
                      </header>
                      <div className="lesson-list" aria-label="레슨 선택">
                        {LESSONS.map((lesson, index) => (
                          <button key={lesson.id} className="lesson-chip" type="button" aria-pressed={lessonIndex === index} onClick={() => chooseLesson(index)}>{index + 1}. {lesson.title}{progress.completedLessonIds.includes(lesson.id) ? " ✓" : ""}</button>
                        ))}
                      </div>
                      <article className="lesson-body">
                        <progress className="lesson-progress" max={currentLesson.midis.length} value={lessonStep + 1}>{lessonStep + 1}/{currentLesson.midis.length}</progress>
                        <p className="eyebrow">레슨 {lessonIndex + 1} · {lessonStep + 1}/{currentLesson.midis.length}</p>
                        <h3 className="lesson-title">{currentLesson.title}</h3>
                        <p className="lesson-copy">{currentLesson.explanations[lessonStep]}</p>
                        <ul className="change-list">
                          {addedKeys.map((key) => <li key={`add-${key}`}><span className="change-dot" />누르기 · {KEY_KOREAN[key] ?? key}</li>)}
                          {releasedKeys.map((key) => <li key={`release-${key}`}><span className="change-dot" />떼기 · {KEY_KOREAN[key] ?? key}</li>)}
                          {!addedKeys.length && !releasedKeys.length && <li><span className="change-dot" />기준 자세를 편안하게 확인합니다.</li>}
                        </ul>
                        {lessonMidi === 90 && settings.highFSharpKey !== "yes" && <p className="feedback">이 단계는 High F♯ 키가 있는 악기에서 사용할 수 있습니다. 설정에서 악기를 확인하거나 F6까지 완료하세요.</p>}
                        <div className="inline-actions">
                          <button className="secondary-button" type="button" disabled={lessonStep === 0} onClick={() => moveLesson(-1)}>이전 단계</button>
                          <button className="secondary-button" type="button" onClick={() => setReplayToken((token) => token + 1)}>느리게 다시</button>
                          <button className="primary-button" type="button" onClick={() => moveLesson(1)}>{lessonStep === currentLesson.midis.length - 1 ? "레슨 완료" : "다음 단계"}</button>
                        </div>
                      </article>
                    </div>
                  )}

                  {mode === "practice" && (
                    <div className="practice-layout">
                      <header className="panel-header">
                        <div><h2>부담 없이 회상하기</h2><p>정답을 보기 전 손 모양을 먼저 떠올립니다.</p></div>
                        <span className="status-badge">seed · {Math.min(practiceIndex + 1, 10)}/10</span>
                      </header>
                      <div className="segmented" aria-label="문제 유형">
                        <button type="button" aria-pressed={practiceKind === "recall"} onClick={() => startPractice("recall")}>운지 회상</button>
                        <button type="button" aria-pressed={practiceKind === "recognition"} onClick={() => startPractice("recognition")}>손 모양 인식</button>
                      </div>
                      {practiceDone ? (
                        <article className="practice-card">
                          <div className="practice-prompt"><div><span className="practice-note">완료</span><p className="practice-copy">열 문제를 끝냈습니다. 숙련도를 단정하지 않고, 다시 볼 음을 다음 세션에 섞어 드려요.</p></div></div>
                          <button className="primary-button" type="button" onClick={() => startPractice(practiceKind)}>새 10문제 시작</button>
                        </article>
                      ) : practiceQueue.length === 0 ? (
                        <article className="practice-card"><p className="practice-copy">현재 악기 설정에서 출제할 음이 없습니다. High F♯ 설정 또는 음역을 확인해 주세요.</p></article>
                      ) : (
                        <article className="practice-card">
                          {practiceKind === "recall" ? (
                            <div className="practice-prompt"><div><span className="practice-note">{writtenMidiToNames(practiceAnswerMidi, settings.accidental).display}</span><p className="practice-copy">{writtenMidiToFixedDo(practiceAnswerMidi)} 운지를 악기로 먼저 만들어 보세요.</p></div></div>
                          ) : (
                            <p className="practice-copy">위 손 모양과 눌린 키를 보고 같은 음을 고르세요. 화면 읽기에서도 정답 음명은 제출 전까지 숨겨집니다.</p>
                          )}
                          {!practiceRevealed && practiceKind === "recall" && <button className="primary-button" type="button" onClick={revealPractice}>정답 보기</button>}
                          {!practiceRevealed && practiceKind === "recognition" && (
                            <div className="choice-grid">
                              {practiceChoices.map((midi) => <button key={midi} className="choice-button" type="button" onClick={() => chooseRecognition(midi)}>{writtenMidiToNames(midi, settings.accidental).display}</button>)}
                            </div>
                          )}
                          {practiceRevealed && (
                            <>
                              {practiceKind === "recognition" && (
                                <div className="choice-grid">
                                  {practiceChoices.map((midi) => (
                                    <button key={midi} className={`choice-button ${midi === practiceAnswerMidi ? "is-correct" : practiceSelected === midi ? "is-wrong" : ""}`} type="button" disabled>{writtenMidiToNames(midi, settings.accidental).display}{midi === practiceAnswerMidi ? " ✓" : practiceSelected === midi ? " 다시 보기" : ""}</button>
                                  ))}
                                </div>
                              )}
                              <p className="feedback" role="status">정답은 {writtenMidiToNames(practiceAnswerMidi, settings.accidental).display}입니다. 위 운지와 손가락 변화를 천천히 확인하세요.</p>
                              <div className="inline-actions" aria-label="자기평가">
                                <button className="secondary-button" type="button" onClick={() => gradePractice("again")}>다시</button>
                                <button className="secondary-button" type="button" onClick={() => gradePractice("hard")}>어려움</button>
                                <button className="primary-button" type="button" onClick={() => gradePractice("good")}>알겠어요</button>
                              </div>
                            </>
                          )}
                        </article>
                      )}
                    </div>
                  )}

                  {mode === "chart" && (
                    <>
                      <header className="panel-header">
                        <div><h2>전체 운지표</h2><p>B♭3부터 F♯6까지 같은 원본 데이터로 표시합니다.</p></div>
                        <span className="status-badge">33음</span>
                      </header>
                      <div className="chart-toolbar">
                        <label className="sr-only" htmlFor="chart-search">운지표 검색</label>
                        <input id="chart-search" className="search-input" type="search" value={chartSearch} placeholder="음이름·계이름 검색" onChange={(event) => setChartSearch(event.target.value)} />
                        <button className="secondary-button" type="button" onClick={() => window.print()}>인쇄</button>
                      </div>
                      <div className="chart-grid">
                        {filteredChartNotes.map((note) => {
                          const names = writtenMidiToNames(note.writtenMidi, settings.accidental);
                          const supported = getNoteSupport(note, capabilityProfile).supported;
                          return (
                            <button
                              key={note.id}
                              className="chart-card"
                              type="button"
                              onClick={() => {
                                if (selectNote(note.writtenMidi, "chart")) setMode("explore");
                              }}
                            >
                              <span><span className="chart-note">{names.display}</span><span className="chart-meta">{writtenMidiToFixedDo(note.writtenMidi)} · {pressedKeys(note).length}키{supported ? "" : " · 악기 확인 필요"}</span></span>
                              <StaffNote className="staff-note staff-note--compact" writtenMidi={note.writtenMidi} accidentalPreference={settings.accidental} showPitchLabel={false} />
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </section>
              </div>
            </div>
          </main>
        </div>

        {settingsOpen && (
          <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSettings(); }}>
            <section ref={settingsPanelRef} className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={onSettingsKeyDown}>
              <header className="settings-header">
                <div><p className="eyebrow">앱 설정</p><h2 id="settings-title">내 악기와 학습 환경</h2></div>
                <button ref={settingsCloseRef} className="icon-button" type="button" aria-label="설정 닫기" onClick={closeSettings}>×</button>
              </header>
              <div className="settings-grid">
                <div className="setting-row"><label htmlFor="setting-instrument">악기<small>운지는 같고 실음만 달라집니다.</small></label><select id="setting-instrument" value={settings.instrument} onChange={(event) => setSettings((current) => ({ ...current, instrument: event.target.value as InstrumentId }))}>{(Object.keys(SAX_INSTRUMENTS) as InstrumentId[]).map((id) => <option key={id} value={id}>{SAX_INSTRUMENTS[id].koreanName}</option>)}</select></div>
                <div className="setting-row"><label htmlFor="setting-high-fsharp">High F♯ 키<small>없음/모름이면 F♯6을 출제하지 않습니다.</small></label><select id="setting-high-fsharp" value={settings.highFSharpKey} onChange={(event) => setSettings((current) => ({ ...current, highFSharpKey: event.target.value as HighFSharpCapability }))}><option value="unknown">모름</option><option value="yes">있음</option><option value="no">없음</option></select></div>
                <div className="setting-row"><label htmlFor="setting-spelling">음이름 표기</label><select id="setting-spelling" value={settings.accidental} onChange={(event) => setSettings((current) => ({ ...current, accidental: event.target.value as AccidentalPreference }))}><option value="flat">플랫 우선</option><option value="sharp">샵 우선</option></select></div>
                <div className="setting-row"><label htmlFor="setting-view">손 시점</label><select id="setting-view" value={settings.view} onChange={(event) => setSettings((current) => ({ ...current, view: event.target.value as SaxophoneStageView }))}><option value="player">연주자 시점</option><option value="mirror">거울 시점</option></select></div>
                <div className="setting-row"><label htmlFor="setting-theme">화면 테마</label><select id="setting-theme" value={settings.theme} onChange={(event) => setSettings((current) => ({ ...current, theme: event.target.value as ThemeChoice }))}><option value="system">기기 설정</option><option value="light">라이트</option><option value="dark">다크</option></select></div>
                <div className="setting-row"><span className="setting-label">동작 줄이기<small>애니메이션 없이 최종 자세를 즉시 표시합니다.</small></span><label className="switch"><input type="checkbox" aria-label="동작 줄이기" checked={settings.reducedMotion} onChange={(event) => setSettings((current) => ({ ...current, reducedMotion: event.target.checked }))} /><span /></label></div>
                <div className="setting-row"><label htmlFor="setting-tone-engine">음색 엔진<small>{SAX_SYNTH_VERSION}은 실제 알토 색소폰 녹음을 분석해 맞춘 모델이며, 마음에 들지 않으면 {SAX_SYNTH_CLASSIC_VERSION}으로 되돌릴 수 있습니다.</small></label><select id="setting-tone-engine" value={settings.toneEngine} onChange={(event) => {
                  const toneEngine: SaxSynthMode = event.target.value === "classic" ? "classic" : "model";
                  setSettings((current) => ({ ...current, toneEngine }));
                }}><option value="model">{saxSynthVersionLabel("model")} · 녹음 분석 모델</option><option value="classic">{saxSynthVersionLabel("classic")} · 이전 방식</option></select></div>
                <div className="setting-row"><span className="setting-label">선택 시 색소폰 음색<small>{saxSynthVersionLabel(settings.toneEngine)} · 실제 연주 녹음이 아닌 악기별 모델링 합성음입니다.</small></span><label className="switch"><input type="checkbox" aria-label="선택 시 색소폰 모델링 음색 자동 재생" checked={settings.autoTone} onChange={(event) => {
                  const checked = event.target.checked;
                  setSettings((current) => ({ ...current, autoTone: checked }));
                  if (checked) {
                    const synth = getOrCreateSynth();
                    if (synth) {
                      synth.setVolume(settings.volume);
                      void synth.ensureRunning();
                    }
                  } else {
                    stopVoices();
                  }
                }} /><span /></label></div>
                <div className="setting-row"><label htmlFor="setting-tone-basis">기준음 기준</label><select id="setting-tone-basis" value={settings.referenceBasis} onChange={(event) => setSettings((current) => ({ ...current, referenceBasis: event.target.value as ReferenceBasis }))}><option value="concert">실제로 들리는 실음</option><option value="written">악보의 기보음</option></select></div>
                <div className="setting-row"><label htmlFor="setting-volume">음색 음량<small>{Math.round(settings.volume * 100)}% · 0%에서는 완전히 음소거됩니다.</small></label><input id="setting-volume" type="range" min="0" max="1" step="0.01" value={settings.volume} aria-valuetext={`${Math.round(settings.volume * 100)}퍼센트`} onChange={(event) => setSettings((current) => ({ ...current, volume: Number(event.target.value) }))} /></div>
                <div className="setting-row"><span className="setting-label">짧은 진동<small>지원 기기에서만 10ms 사용합니다.</small></span><label className="switch"><input type="checkbox" aria-label="짧은 진동 피드백" checked={settings.haptics} onChange={(event) => setSettings((current) => ({ ...current, haptics: event.target.checked }))} /><span /></label></div>
                <div className="setting-row"><label htmlFor="setting-speed">손 이동 속도</label><select id="setting-speed" value={settings.animationSpeed} onChange={(event) => setSettings((current) => ({ ...current, animationSpeed: event.target.value as "normal" | "slow" }))}><option value="normal">보통</option><option value="slow">느리게</option></select></div>
              </div>
              <p className="keyboard-help">키보드 · ←/→ 반음 이동 · [ / ] 옥타브 · 숫자 1~7 자연음 · Shift+1/2/4/5/6 변화음</p>
              <div className="inline-actions">
                <button className="secondary-button" type="button" onClick={() => {
                  const blob = new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = "saxhands-progress.json";
                  anchor.click();
                  URL.revokeObjectURL(url);
                }}>진도 내보내기</button>
                <button className="danger-button" type="button" onClick={() => {
                  if (window.confirm("저장된 레슨과 연습 진도를 초기화할까요?")) {
                    setProgress({ ...EMPTY_PROGRESS, updatedAt: new Date().toISOString() });
                    setToast("기기에 저장된 진도를 초기화했습니다.");
                  }
                }}>진도 초기화</button>
              </div>
              <p className="range-help">{online ? `온라인 · ${offlineReady ? "오프라인 사용 준비됨" : "오프라인 사용 준비 중"}` : "오프라인 · 저장된 기능을 사용 중"} · 설정과 진도는 이 기기에만 저장되며 서버로 전송하지 않습니다.</p>
            </section>
          </div>
        )}

        {mp3Open && exportTone && exportLabels && (
          <Mp3ExportSheet
            midi={exportTone.midi}
            instrument={exportTone.instrument}
            labels={exportLabels}
            onClose={closeMp3}
            onNotify={setToast}
          />
        )}

        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
        {waitingWorker && (
          <div className="update-toast" role="status" aria-label="앱 업데이트">
            <p><strong>새 버전이 준비됐습니다.</strong><span>현재 연습을 마친 뒤 안전하게 갱신할 수 있습니다.</span></p>
            <button type="button" onClick={() => waitingWorker.postMessage({ type: "SKIP_WAITING" })}>업데이트</button>
            <button type="button" onClick={() => setWaitingWorker(null)}>나중에</button>
          </div>
        )}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>

      <section className="print-sheet" aria-label="인쇄용 전체 운지표">
        <h1 className="print-title">SaxHands · {instrument.koreanName} 기보 운지표</h1>
        <div className="print-grid">
          {SAX_NOTES.map((note) => (
            <article className="print-card" key={`print-${note.id}`}>
              <h2>{writtenMidiToNames(note.writtenMidi, settings.accidental).display} · {writtenMidiToFixedDo(note.writtenMidi)}</h2>
              <StaffNote className="staff-note" writtenMidi={note.writtenMidi} accidentalPreference={settings.accidental} showPitchLabel={false} />
              <p>실음 {writtenMidiToNames(concertMidi(note.writtenMidi, settings.instrument), settings.accidental).display}</p>
              <p>{pressedKeys(note).map((key) => SAX_KEYS.find((candidate) => candidate.id === key)?.label ?? key).join(" · ") || "Open"}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
