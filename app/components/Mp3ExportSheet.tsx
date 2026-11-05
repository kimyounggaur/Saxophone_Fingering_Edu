"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Mp3EncoderUnavailableError, isAbortError, preloadMp3Encoder } from "@/lib/mp3-encode";
import {
  EXPORT_DEFAULT_SECONDS,
  EXPORT_LENGTHS_SECONDS,
  SaxExportError,
  createSaxMp3,
  describeSaxExport,
  type SaxExportDynamic,
  type SaxExportLabels,
  type SaxMp3Export,
} from "@/lib/sax-export";
import { SAX_SYNTH_VERSION, type SaxSynthInstrument } from "@/lib/sax-synth";

export interface Mp3ExportSheetProps {
  /** Sounding MIDI pitch of the audio in the file. */
  readonly midi: number;
  readonly instrument: SaxSynthInstrument;
  readonly labels: SaxExportLabels;
  readonly onClose: () => void;
  /** Short messages for the app's toast. */
  readonly onNotify: (message: string) => void;
}

type Phase = "idle" | "working" | "done" | "error";

interface Stage {
  readonly kind: "render" | "encode";
  readonly fraction: number | null;
}

interface ExportResult {
  readonly file: SaxMp3Export;
  readonly url: string;
  readonly shareable: boolean;
}

const LENGTH_LABEL: Readonly<Record<number, string>> = { 1.5: "짧게 1.5초", 3: "보통 3초", 6: "길게 6초" };
const DYNAMICS: readonly { readonly id: SaxExportDynamic; readonly label: string }[] = [
  { id: "soft", label: "약하게" },
  { id: "medium", label: "보통" },
  { id: "strong", label: "세게" },
];
const FOCUSABLE =
  "button:not(:disabled), a[href], select:not(:disabled), input:not(:disabled), audio[controls], [tabindex]:not([tabindex='-1'])";

function formatKilobytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function formatSeconds(seconds: number): string {
  return `${Number(seconds.toFixed(1))}초`;
}

function messageForError(error: unknown): string {
  if (error instanceof Mp3EncoderUnavailableError) {
    return "MP3 변환 모듈을 불러오지 못했습니다. 인터넷에 연결한 뒤 페이지를 새로고침해 주세요.";
  }
  if (error instanceof SaxExportError) {
    if (error.code === "unsupported") {
      return "이 브라우저는 MP3 만들기에 필요한 오디오 기능을 지원하지 않습니다. 최신 Chrome, Edge, Safari, Firefox에서 열어 주세요.";
    }
    if (error.code === "invalid-mp3") return "만든 MP3가 검사를 통과하지 못해 저장을 막았습니다. 다시 시도해 주세요.";
    return "합성음을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "MP3를 만드는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.";
}

export function Mp3ExportSheet({ midi, instrument, labels, onClose, onNotify }: Mp3ExportSheetProps) {
  const [seconds, setSeconds] = useState<number>(EXPORT_DEFAULT_SECONDS);
  const [dynamic, setDynamic] = useState<SaxExportDynamic>("medium");
  const [vibrato, setVibrato] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState<Stage>({ kind: "render", fraction: null });
  const [result, setResult] = useState<ExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  // A chunk that failed to load is remembered as failed by the browser, so only a page reload can recover from it.
  const [encoderFailed, setEncoderFailed] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");

  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const makeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLAnchorElement>(null);
  // Which control should take focus once the next render has replaced the one that was just used.
  const pendingFocus = useRef<"make" | "cancel" | "save" | null>(null);
  // Mutable bookkeeping that cleanup code must see in its latest state: the running job and the blob URL.
  const jobRef = useRef<{ controller: AbortController | null; url: string }>({ controller: null, url: "" });

  const request = useMemo(() => ({ midi, instrument, seconds, dynamic, vibrato }), [midi, instrument, seconds, dynamic, vibrato]);
  const estimate = useMemo(() => describeSaxExport(request), [request]);

  useEffect(() => {
    closeRef.current?.focus();
    // Fetch the encoder while the options are being chosen, so the service worker can cache it.
    preloadMp3Encoder();
    const job = jobRef.current;
    return () => {
      job.controller?.abort();
      if (job.url) URL.revokeObjectURL(job.url);
      job.url = "";
    };
  }, []);

  // The button that was pressed disappears when the phase changes. Without this, focus would drop to the page
  // behind the dialog and Escape / Tab would stop working for keyboard and screen-reader users.
  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === "cancel") cancelRef.current?.focus();
    else if (target === "save") saveRef.current?.focus();
    else if (target === "make") makeRef.current?.focus();
  }, [phase]);

  const discardResult = useCallback(() => {
    const job = jobRef.current;
    if (job.url) URL.revokeObjectURL(job.url);
    job.url = "";
    setResult(null);
  }, []);

  // Changing an option makes the finished file stale, so it is dropped.
  const changeOption = useCallback(
    (apply: () => void) => {
      apply();
      discardResult();
      setErrorMessage("");
      setPhase("idle");
      setLiveMessage("");
    },
    [discardResult],
  );

  const requestClose = useCallback(() => {
    jobRef.current.controller?.abort();
    onClose();
  }, [onClose]);

  const cancel = useCallback(() => {
    jobRef.current.controller?.abort();
    pendingFocus.current = "make";
    setPhase("idle");
    setLiveMessage("MP3 만들기를 취소했습니다.");
  }, []);

  const make = useCallback(async () => {
    const job = jobRef.current;
    if (job.controller) return;
    const controller = new AbortController();
    job.controller = controller;
    discardResult();
    setErrorMessage("");
    setEncoderFailed(false);
    pendingFocus.current = "cancel";
    setPhase("working");
    setStage({ kind: "render", fraction: null });
    setLiveMessage("MP3를 만들고 있습니다.");
    try {
      const file = await createSaxMp3(request, labels, {
        signal: controller.signal,
        onStage: (kind, fraction) => {
          if (!controller.signal.aborted) setStage({ kind, fraction });
        },
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(file.blob);
      job.url = url;
      let shareable = false;
      try {
        shareable =
          typeof navigator !== "undefined" &&
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [new File([file.blob], file.fileName, { type: "audio/mpeg" })] });
      } catch {
        shareable = false;
      }
      setResult({ file, url, shareable });
      pendingFocus.current = "save";
      setPhase("done");
      setLiveMessage(`MP3가 준비됐습니다. ${formatSeconds(file.seconds)}, ${formatKilobytes(file.bytes)}. 미리 듣거나 저장할 수 있습니다.`);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return;
      const message = messageForError(error);
      setEncoderFailed(error instanceof Mp3EncoderUnavailableError);
      setErrorMessage(message);
      pendingFocus.current = "make";
      setPhase("error");
      setLiveMessage(message);
    } finally {
      if (job.controller === controller) job.controller = null;
    }
  }, [discardResult, labels, request]);

  const share = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.share({
        files: [new File([result.file.blob], result.file.fileName, { type: "audio/mpeg" })],
        title: result.file.fileName,
      });
    } catch (error) {
      // Closing the share sheet is not an error.
      if (!(error instanceof Error && error.name === "AbortError")) onNotify("공유하지 못했습니다. MP3 저장을 사용해 주세요.");
    }
  }, [onNotify, result]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
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

  const working = phase === "working";
  const needsReload = phase === "error" && encoderFailed;
  const percent = stage.fraction === null ? null : Math.round(stage.fraction * 100);
  const progressStyle = { "--progress": `${percent ?? 0}%` } as CSSProperties;

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={panelRef}
        className="settings-sheet export-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mp3-title"
        aria-describedby="mp3-summary"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="settings-header">
          <div>
            <p className="eyebrow">MP3 저장</p>
            <h2 id="mp3-title">합성음을 MP3로 저장</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" aria-label="MP3 저장 닫기" onClick={requestClose}>
            ×
          </button>
        </header>

        <p id="mp3-summary" className="export-summary">
          <span className="status-badge">{labels.instrumentKo}</span>{" "}
          <span>
            <strong>{labels.pitchDisplay}</strong> 소리 · {labels.fingeringDisplay} 운지
          </span>
        </p>

        <fieldset className="export-field" disabled={working}>
          <legend>음 길이</legend>
          <div className="segmented">
            {EXPORT_LENGTHS_SECONDS.map((length) => (
              <button
                key={length}
                type="button"
                aria-pressed={seconds === length}
                onClick={() => changeOption(() => setSeconds(length))}
              >
                {LENGTH_LABEL[length] ?? formatSeconds(length)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="export-field" disabled={working}>
          <legend>세기</legend>
          <div className="segmented">
            {DYNAMICS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={dynamic === option.id}
                onClick={() => changeOption(() => setDynamic(option.id))}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="export-hint">세기는 음색의 밝기와 힘을 바꿉니다. 음량은 거의 같게 맞춰 두었습니다.</p>
        </fieldset>

        <fieldset className="export-field" disabled={working}>
          <legend>비브라토</legend>
          <div className="segmented">
            <button type="button" aria-pressed={vibrato} onClick={() => changeOption(() => setVibrato(true))}>
              있음
            </button>
            <button type="button" aria-pressed={!vibrato} onClick={() => changeOption(() => setVibrato(false))}>
              없음
            </button>
          </div>
          <p className="export-hint">{vibrato ? "앱의 음색 듣기와 같은 자연스러운 떨림이 들어갑니다." : "곧은 소리입니다. 튜닝 기준음이나 음정 연습에 알맞습니다."}</p>
        </fieldset>

        <p className="export-spec">
          256 kbps · 44.1 kHz · 스테레오 · 약 {formatSeconds(estimate.seconds)} · 약 {formatKilobytes(estimate.approxBytes)}{" "}
          <small>앱의 음량 설정과 관계없이 일정한 음량으로 만들며, 끝에 짧은 잔향이 붙습니다.</small>
        </p>

        {working && (
          <div className="export-progress-block">
            <div
              className="export-progress"
              role="progressbar"
              aria-label="MP3 만드는 중"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
              aria-valuetext={stage.kind === "render" ? "합성음을 만드는 중" : `MP3로 변환하는 중 ${percent ?? 0}퍼센트`}
              data-indeterminate={percent === null ? "true" : undefined}
              style={progressStyle}
            >
              <span />
            </div>
            <p className="export-progress-label">{stage.kind === "render" ? "합성음을 만드는 중…" : `MP3로 변환하는 중… ${percent ?? 0}%`}</p>
            <button ref={cancelRef} className="secondary-button" type="button" onClick={cancel}>
              취소
            </button>
          </div>
        )}

        {phase === "error" && (
          <p className="export-error" role="alert">
            <span aria-hidden="true">!</span> {errorMessage}
          </p>
        )}

        {!working && !result && (
          <button
            ref={makeRef}
            className="primary-button export-make"
            type="button"
            onClick={() => (needsReload ? window.location.reload() : void make())}
          >
            {needsReload ? "페이지 새로고침" : phase === "error" ? "다시 시도" : "MP3 만들기"}
          </button>
        )}

        {result && (
          <div className="export-result">
            <p className="export-result-title">
              <span aria-hidden="true">✓</span> MP3가 준비됐습니다
            </p>
            <audio className="export-audio" controls preload="auto" src={result.url} aria-label="만든 MP3 미리듣기" />
            <p className="export-file">{result.file.fileName}</p>
            <p className="export-meta">
              {formatSeconds(result.file.seconds)} · {formatKilobytes(result.file.bytes)} · {result.file.kbps} kbps · {(result.file.sampleRate / 1000).toFixed(1)} kHz 스테레오
            </p>
            <div className="inline-actions">
              <a
                ref={saveRef}
                className="primary-button export-save"
                href={result.url}
                download={result.file.fileName}
                onClick={() => onNotify("MP3 저장을 시작했습니다.")}
              >
                ⬇ MP3 저장
              </a>
              {result.shareable && (
                <button className="secondary-button" type="button" onClick={() => void share()}>
                  공유…
                </button>
              )}
            </div>
            <p className="export-hint">옵션을 바꾸면 새 파일을 만들 수 있습니다. 파일은 이 기기에서만 만들어지며 서버로 전송되지 않습니다.</p>
          </div>
        )}

        <p className="export-credit">
          실제 연주 녹음이 아닌 {SAX_SYNTH_VERSION} 컴퓨터 합성음입니다. MP3 변환은 LAME 인코더를 JavaScript로 옮긴 lamejs(LGPL-3.0)를 사용합니다 —{" "}
          <a href="https://lame.sourceforge.io/" target="_blank" rel="noopener noreferrer">
            lame.sourceforge.io
          </a>
        </p>

        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {liveMessage}
        </p>
      </section>
    </div>
  );
}
