"use client"

import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react"
import { FINGER_IDS, FINGER_MAP, SAX_KEY_BY_ID, changedFingers, easeOutCubic, type FingerId } from "@/lib/sax-rig"
import {
  ILLUSTRATION_DATA,
  ILLUSTRATION_NATIVE_VIEW,
  OCTAVE_ARROW_LABEL,
  STYLE_CLASSES,
  canIllustrate,
  getIllustrationKey,
  getIllustrationPose,
  illustrationMismatch,
  illustrationViewBox,
  layoutKeyChips,
  mirrorTransform,
  mirrorX,
  writtenMidiFromNoteId,
  type IllustrationZoom,
  type ViewBox,
} from "@/lib/illustration"
import { SaxophoneRigStage } from "./SaxophoneRigStage"
import {
  FINGER_KOREAN,
  type AnswerVisibility,
  type SaxophoneStageNote,
  type SaxophoneStageProps,
  type SaxophoneStageView,
} from "./saxophone-stage-shared"

export type { AnswerVisibility, SaxophoneStageNote, SaxophoneStageProps, SaxophoneStageView }

/** Hand crossfade / framing change time; "slow" (설정 > 손 이동 속도) doubles it. */
const FADE_MS = { normal: 430, slow: 860 } as const
const ZOOM_MS = { normal: 420, slow: 840 } as const

const ZOOM_OPTIONS: ReadonlyArray<{ id: IllustrationZoom; label: string; description: string }> = [
  { id: "hands", label: "두 손", description: "두 손 영역 보기" },
  { id: "left", label: "왼손", description: "왼손 영역 확대" },
  { id: "right", label: "오른손", description: "오른손 영역 확대" },
  { id: "full", label: "전체", description: "악기 전체 보기" },
]

const REVIEW_WARNING = "일러스트와 운지 데이터가 달라 검수가 필요합니다."

/** Large enough to cover any framing and the letterbox around it. */
const SHEET_EXTENT = 1200
/** The drawing cuts the right arm off at x = 0; fade it in over the first 18 pt. */
const WRIST_FADE = { from: 0, to: 18 } as const

function classes(...items: Array<string | false | null | undefined>): string {
  return items.filter(Boolean).join(" ")
}

function pressedFromSignature(signature: string): readonly string[] {
  return signature ? signature.split("\u001f") : []
}

const spokenLabel = (keyId: string): string =>
  (SAX_KEY_BY_ID as Record<string, { spokenLabel: string } | undefined>)[keyId]?.spokenLabel ?? keyId

const fingerOf = (keyId: string): FingerId | undefined =>
  (FINGER_MAP as Record<string, { finger: FingerId } | undefined>)[keyId]?.finger

/**
 * Saxophone fingering stage drawn from the commissioned line art.
 *
 * Falls back to the procedural rig for any note/key the artwork does not cover, so a
 * data change can never leave the stage blank.
 */
export function SaxophoneStage(props: SaxophoneStageProps) {
  const midi = writtenMidiFromNoteId(props.note.id)
  if (!canIllustrate(midi, props.note.pressed)) return <SaxophoneRigStage {...props} />
  return <IllustratedSaxophoneStage {...props} midi={midi} />
}

interface PoseTransition {
  /** The pose on screen now. */
  shown: number
  /** The pose shown before it (what "↻ 다시" replays from). */
  prior: number | null
  /** A pose that is fading out. */
  outgoing: number | null
  /** Bumps on every transition so animations restart. */
  key: number
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/** Eases the SVG viewBox between framings; a flip of the whole figure snaps instead of sliding. */
function useAnimatedViewBox(target: ViewBox, snapKey: string, durationMs: number, animate: boolean): ViewBox {
  const [box, setBox] = useState<ViewBox>(target)
  const boxRef = useRef<ViewBox>(target)
  const snapKeyRef = useRef(snapKey)
  const frameRef = useRef<number | null>(null)
  const { x, y, w, h } = target

  useEffect(() => {
    const to: ViewBox = { x, y, w, h }
    const snap = !animate || snapKeyRef.current !== snapKey
    snapKeyRef.current = snapKey
    const from = boxRef.current
    if (from.x === to.x && from.y === to.y && from.w === to.w && from.h === to.h) return undefined

    const start = performance.now()
    const step = (now: number) => {
      const linear = snap ? 1 : Math.min(1, (now - start) / durationMs)
      const eased = easeOutCubic(linear)
      const next: ViewBox = linear >= 1
        ? to
        : { x: lerp(from.x, to.x, eased), y: lerp(from.y, to.y, eased), w: lerp(from.w, to.w, eased), h: lerp(from.h, to.h, eased) }
      boxRef.current = next
      setBox(next)
      frameRef.current = linear < 1 ? requestAnimationFrame(step) : null
    }
    frameRef.current = requestAnimationFrame(step)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [animate, durationMs, h, snapKey, w, x, y])

  return box
}

type PoseLayer = "bottom" | "top"
type PosePhase = "in" | "out" | "static"

const PoseGroup = memo(function PoseGroup({ midi, layer, phase }: { midi: number; layer: PoseLayer; phase: PosePhase }) {
  const pose = getIllustrationPose(midi)
  if (!pose) return null
  const items = layer === "bottom" ? pose.bottom : pose.top
  return (
    <g className={`sx-pose sx-pose--${phase}`}>
      {items.map(([style, path], index) => (
        <path key={index} className={STYLE_CLASSES[style]} d={ILLUSTRATION_DATA.paths[path]} />
      ))}
    </g>
  )
})

const BodyLayer = memo(function BodyLayer() {
  return (
    <g className="sx-body">
      {ILLUSTRATION_DATA.body.map(([style, d], index) => (
        <path key={index} className={STYLE_CLASSES[style]} d={d} />
      ))}
    </g>
  )
})

function IllustratedSaxophoneStage({
  note,
  previousPressed = [],
  view = "player",
  reducedMotion = false,
  answerVisibility = "full",
  replayToken = 0,
  animationSpeed = "normal",
  className,
  midi,
}: SaxophoneStageProps & { midi: number }) {
  const rawId = useId()
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "")
  const titleId = `sax-stage-title-${id}`
  const descriptionId = `sax-stage-description-${id}`
  const fadeGradientId = `sax-wrist-gradient-${id}`
  const fadeMaskId = `sax-wrist-mask-${id}`
  const pressedSignature = note.pressed.join("\u001f")
  const previousSignature = previousPressed.join("\u001f")
  const pressed = useMemo(() => pressedFromSignature(pressedSignature), [pressedSignature])
  const previous = useMemo(() => pressedFromSignature(previousSignature), [previousSignature])
  const changed = useMemo(() => changedFingers(previous, pressed), [previous, pressed])
  const mismatch = useMemo(() => illustrationMismatch(midi, pressed), [midi, pressed])

  const mirrored = view !== ILLUSTRATION_NATIVE_VIEW
  const animate = !reducedMotion
  const fadeMs = FADE_MS[animationSpeed]

  // ---- hand pose transition, derived from props during render (no effect needed)
  const [transition, setTransition] = useState<PoseTransition>({ shown: midi, prior: null, outgoing: null, key: 0 })
  const [seenReplayToken, setSeenReplayToken] = useState(replayToken)
  if (transition.shown !== midi || seenReplayToken !== replayToken) {
    const moved = transition.shown !== midi
    const from = moved ? transition.shown : transition.prior
    setSeenReplayToken(replayToken)
    setTransition({ shown: midi, prior: from, outgoing: animate ? from : null, key: transition.key + 1 })
  }

  useEffect(() => {
    if (transition.outgoing === null) return undefined
    const key = transition.key
    const timer = window.setTimeout(() => {
      setTransition((current) => (current.key === key ? { ...current, outgoing: null } : current))
    }, fadeMs + 60)
    return () => window.clearTimeout(timer)
  }, [fadeMs, transition.key, transition.outgoing])

  // ---- framing (local UI state: 두 손 / 왼손 / 오른손 / 전체)
  const [zoom, setZoom] = useState<IllustrationZoom>("hands")
  const targetBox = useMemo(() => illustrationViewBox(zoom, mirrored), [mirrored, zoom])
  const box = useAnimatedViewBox(targetBox, mirrored ? "mirrored" : "native", ZOOM_MS[animationSpeed], animate)
  const chips = useMemo(() => layoutKeyChips(pressed, box.h), [box.h, pressed])

  if (answerVisibility === "recall-hidden") {
    return (
      <div
        className={classes("sax-stage", "sax-stage--recall-hidden", className)}
        aria-hidden="true"
      />
    )
  }

  const showChange = transition.key > 0
  const previousSet = new Set(previous)
  const pressedSet = new Set(pressed)
  const added = showChange ? pressed.filter((keyId) => !previousSet.has(keyId)) : []
  const released = showChange ? previous.filter((keyId) => !pressedSet.has(keyId) && getIllustrationKey(keyId)) : []
  const showWarning = Boolean(mismatch) && answerVisibility !== "recognition-blind"

  const viewName = view === "player" ? "연주자 시점" : "거울 시점"
  const pressedDescription = pressed.length ? pressed.map(spokenLabel).join(", ") : "누른 키 없음"
  const activeFingers = new Set(pressed.map(fingerOf))
  const activeFingerDescription = FINGER_IDS.filter((fingerId) => activeFingers.has(fingerId)).map((fingerId) => FINGER_KOREAN[fingerId]).join(", ")
  const changedDescription = [...changed].map((fingerId) => FINGER_KOREAN[fingerId]).join(", ")
  const noteName = note.writtenName ?? note.label ?? "선택한 음"
  const title = answerVisibility === "recognition-blind"
    ? `색소폰 운지 그림, ${viewName}`
    : `${noteName} 색소폰 운지, ${viewName}`
  const description = answerVisibility === "recognition-blind"
    ? `${pressedDescription}. 사용하는 손가락: ${activeFingerDescription || "없음"}.`
    : `${pressedDescription}. 사용하는 손가락: ${activeFingerDescription || "없음"}.${changedDescription ? ` 이전 운지에서 바뀐 손가락: ${changedDescription}.` : ""}${showWarning ? ` ${REVIEW_WARNING}` : ""}`

  const poseKey = `${transition.shown}-${transition.key}`
  const currentPhase: PosePhase = showChange && animate ? "in" : "static"
  const outgoing = transition.outgoing
  const mapX = (x: number) => (mirrored ? mirrorX(x) : x)
  const style = { "--sx-fade": `${fadeMs}ms` } as CSSProperties

  return (
    <figure
      className={classes(
        "sax-stage",
        "sax-stage--illustrated",
        `sax-stage--${view}`,
        reducedMotion && "sax-stage--reduced-motion",
        showWarning && "sax-stage--review-warning",
        className,
      )}
      style={style}
    >
      <figcaption className="sax-stage__view-label">{viewName}</figcaption>
      <div className="sax-stage__zoom" role="group" aria-label="확대 범위">
        {ZOOM_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={zoom === option.id}
            aria-label={option.description}
            onClick={() => setZoom(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <svg
        className="sax-stage__svg saxophone-stage sx-art"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
        data-illustration-pose={answerVisibility === "full" ? midi : undefined}
      >
        <title id={titleId}>{title}</title>
        <desc id={descriptionId}>{description}</desc>

        <defs>
          {/* the artist's right arm is cut off at the drawing edge; fade it out instead of showing a hard edge */}
          <linearGradient id={fadeGradientId} gradientUnits="userSpaceOnUse" x1={WRIST_FADE.from} y1="0" x2={WRIST_FADE.to} y2="0">
            <stop offset="0" stopColor="#000" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
          <mask id={fadeMaskId} maskUnits="userSpaceOnUse" x={-SHEET_EXTENT} y={-SHEET_EXTENT} width={2 * SHEET_EXTENT} height={2 * SHEET_EXTENT}>
            <rect x={-SHEET_EXTENT} y={-SHEET_EXTENT} width={2 * SHEET_EXTENT} height={2 * SHEET_EXTENT} fill={`url(#${fadeGradientId})`} />
          </mask>
        </defs>

        <g aria-hidden="true">
          <g transform={mirrored ? mirrorTransform() : undefined}>
            {/* the sheet is larger than any framing, so it also fills letterbox margins */}
            <rect className="sx-sheet" x={-SHEET_EXTENT} y={-SHEET_EXTENT} width={2 * SHEET_EXTENT} height={2 * SHEET_EXTENT} />

            {/* painter's order of the artwork: pose-below, shared body, key highlights, pose-above */}
            <g className="sx-layer sx-layer--bottom">
              {outgoing !== null && <PoseGroup key={`out-${outgoing}-${transition.key}`} midi={outgoing} layer="bottom" phase="out" />}
              <PoseGroup key={poseKey} midi={transition.shown} layer="bottom" phase={currentPhase} />
            </g>

            <BodyLayer />

            <g className="sx-highlights">
              {pressed.map((keyId) => {
                const key = getIllustrationKey(keyId)
                if (!key) return null
                return key.shape
                  ? <path key={keyId} className="sx-hl" d={key.shape} />
                  : <circle key={keyId} className="sx-hl sx-hl--estimate" cx={key.x} cy={key.y} r={Math.max(key.r - 1.2, 1)} />
              })}
            </g>

            <g className="sx-layer sx-layer--top" mask={`url(#${fadeMaskId})`}>
              {outgoing !== null && <PoseGroup key={`out-${outgoing}-${transition.key}`} midi={outgoing} layer="top" phase="out" />}
              <PoseGroup key={poseKey} midi={transition.shown} layer="top" phase={currentPhase} />
            </g>

            {/* rings sit above the hands so a pressed key stays visible under a fingertip */}
            <g className="sx-rings">
              {released.map((keyId) => {
                const key = getIllustrationKey(keyId)
                return key ? <circle key={`release-${keyId}-${transition.key}`} className="sx-release" cx={key.x} cy={key.y} r={key.r} /> : null
              })}
              {pressed.map((keyId) => {
                const key = getIllustrationKey(keyId)
                if (!key) return null
                return (
                  <g key={keyId}>
                    <circle className={classes("sx-ring", key.source === "estimate" && "sx-ring--estimate")} cx={key.x} cy={key.y} r={key.r} />
                    {added.includes(keyId) && <circle key={`pulse-${transition.key}`} className="sx-pulse" cx={key.x} cy={key.y} r={key.r} />}
                  </g>
                )
              })}
            </g>
          </g>

          {/* chips and labels stay un-mirrored so text never reads backwards */}
          <g className="sx-chips">
            {pressedSet.has("ok") && OCTAVE_ARROW_LABEL && (
              <text
                className="sx-arrow-label"
                x={mapX(OCTAVE_ARROW_LABEL.x)}
                y={OCTAVE_ARROW_LABEL.y + OCTAVE_ARROW_LABEL.fontSize * 0.35}
                textAnchor="middle"
                fontSize={OCTAVE_ARROW_LABEL.fontSize}
              >
                옥타브
              </text>
            )}
            {chips.map((chip) => (
              <g key={chip.keyId} className={classes("sx-chip", chip.estimate && "sx-chip--estimate")}>
                <line className="sx-chip__leader" x1={mapX(chip.edgeX)} y1={chip.y} x2={mapX(chip.anchorX)} y2={chip.anchorY} />
                <rect className="sx-chip__box" x={mapX(chip.x) - chip.width / 2} y={chip.y - chip.height / 2} width={chip.width} height={chip.height} rx={chip.height / 2} />
                <text className="sx-chip__text" x={mapX(chip.x)} y={chip.y + chip.fontSize * 0.35} textAnchor="middle" fontSize={chip.fontSize}>
                  {chip.label}
                </text>
              </g>
            ))}
          </g>
        </g>
      </svg>
      {showWarning && (
        <p className="sax-stage__warning-text" role="note">
          <span aria-hidden="true">!</span>
          {REVIEW_WARNING}
        </p>
      )}
    </figure>
  )
}

export default SaxophoneStage
