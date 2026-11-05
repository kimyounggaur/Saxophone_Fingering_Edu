"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import {
  EDUCATIONAL_RIG_CALIBRATION,
  FINGER_IDS,
  KEY_IDS,
  SAX_KEYS,
  SAX_KEY_BY_ID,
  changedFingers,
  cloneFrame,
  contactPoint,
  easeOutCubic,
  interpolateFrame,
  keyCenter,
  resolveTargetFrame,
  type FingerId,
  type HandId,
  type HandRootPose,
  type PoseFrame,
} from "@/lib/sax-rig"
import { FINGER_KOREAN, type SaxophoneStageProps, type SaxophoneStageView } from "./saxophone-stage-shared"

const VIEWBOX_WIDTH = 220
const VIEWBOX_HEIGHT = 292
const FRAME_DURATION_MS = 430
const REPLAY_DURATION_MS = 620

function pressedFromSignature(signature: string): readonly string[] {
  return signature ? signature.split("\u001f") : []
}

function palmTransform(root: HandRootPose, hand: HandId): string {
  const origin = EDUCATIONAL_RIG_CALIBRATION.handOrigins[hand]
  return `translate(${root.tx} ${root.ty}) rotate(${root.rotation} ${origin.x} ${origin.y})`
}

function geometryTransform(view: SaxophoneStageView): string | undefined {
  return view === "mirror" ? `translate(${VIEWBOX_WIDTH} 0) scale(-1 1)` : undefined
}

function labelX(x: number, view: SaxophoneStageView): number {
  return view === "mirror" ? VIEWBOX_WIDTH - x : x
}

function classes(...items: Array<string | false | null | undefined>): string {
  return items.filter(Boolean).join(" ")
}

function frameForPressed(pressed: readonly string[]): PoseFrame {
  return resolveTargetFrame({ pressed })
}

/**
 * Original procedural hand rig (two-bone IK fingers on a schematic instrument).
 *
 * Kept as the fallback for any note or key the commissioned illustration does not
 * cover (see `canIllustrate` in lib/illustration.ts) and as a reference rendering.
 */
export function SaxophoneRigStage({
  note,
  previousPressed = [],
  view = "player",
  reducedMotion = false,
  answerVisibility = "full",
  replayToken = 0,
  className,
}: SaxophoneStageProps) {
  const rawId = useId()
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "")
  const titleId = `sax-stage-title-${id}`
  const descriptionId = `sax-stage-description-${id}`
  const pressedSignature = note.pressed.join("\u001f")
  const previousSignature = previousPressed.join("\u001f")
  const pressed = useMemo(() => pressedFromSignature(pressedSignature), [pressedSignature])
  const previous = useMemo(() => pressedFromSignature(previousSignature), [previousSignature])
  const targetFrame = useMemo(() => frameForPressed(pressed), [pressed])
  const previousFrame = useMemo(() => frameForPressed(previous), [previous])
  const changed = useMemo(() => changedFingers(previous, pressed), [previous, pressed])

  const [frame, setFrame] = useState<PoseFrame>(() => cloneFrame(targetFrame))
  const currentFrameRef = useRef<PoseFrame>(cloneFrame(targetFrame))
  const animationFrameRef = useRef<number | null>(null)
  const tweenTokenRef = useRef(0)
  const replayTokenRef = useRef<string | number>(replayToken)
  const mountedRef = useRef(false)

  useEffect(() => {
    const token = ++tweenTokenRef.current
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)

    const from = cloneFrame(currentFrameRef.current)
    const replayRequested = mountedRef.current && replayTokenRef.current !== replayToken
    replayTokenRef.current = replayToken
    mountedRef.current = true

    if (reducedMotion) {
      const finalFrame = cloneFrame(targetFrame)
      currentFrameRef.current = finalFrame
      queueMicrotask(() => {
        if (token === tweenTokenRef.current) setFrame(finalFrame)
      })
      animationFrameRef.current = null
      return () => {
        tweenTokenRef.current += 1
      }
    }

    const duration = replayRequested ? REPLAY_DURATION_MS : FRAME_DURATION_MS
    const start = performance.now()
    const animate = (now: number) => {
      if (token !== tweenTokenRef.current) return
      const linear = Math.min(1, (now - start) / duration)
      let next: PoseFrame
      if (replayRequested) {
        const turn = 0.36
        next = linear < turn
          ? interpolateFrame(from, previousFrame, easeOutCubic(linear / turn))
          : interpolateFrame(previousFrame, targetFrame, easeOutCubic((linear - turn) / (1 - turn)))
      } else {
        next = interpolateFrame(from, targetFrame, easeOutCubic(linear))
      }

      // Keep an independent numeric snapshot after every rendered frame. A
      // rapid new input therefore starts from what is actually on screen.
      currentFrameRef.current = cloneFrame(next)
      setFrame(next)
      if (linear < 1) {
        animationFrameRef.current = requestAnimationFrame(animate)
      } else {
        animationFrameRef.current = null
      }
    }
    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      tweenTokenRef.current += 1
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [previousFrame, reducedMotion, replayToken, targetFrame])

  if (answerVisibility === "recall-hidden") {
    return (
      <div
        className={classes("sax-stage", "sax-stage--recall-hidden", className)}
        aria-hidden="true"
      />
    )
  }

  const viewName = view === "player" ? "연주자 시점" : "거울 시점"
  const pressedKeys = KEY_IDS.filter((keyId) => frame.keys[keyId] > 0.5)
  const pressedDescription = pressedKeys.length
    ? pressedKeys.map((keyId) => SAX_KEY_BY_ID[keyId].spokenLabel).join(", ")
    : "누른 키 없음"
  const activeFingerDescription = FINGER_IDS
    .filter((fingerId) => frame.fingers[fingerId].contactProgress > 0.5)
    .map((fingerId) => FINGER_KOREAN[fingerId])
    .join(", ")
  const changedDescription = [...changed].map((fingerId) => FINGER_KOREAN[fingerId]).join(", ")
  const noteName = note.writtenName ?? note.label ?? "선택한 음"
  const title = answerVisibility === "recognition-blind"
    ? `색소폰 운지 그림, ${viewName}`
    : `${noteName} 색소폰 운지, ${viewName}`
  const description = answerVisibility === "recognition-blind"
    ? `${pressedDescription}. 사용하는 손가락: ${activeFingerDescription || "없음"}.`
    : `${pressedDescription}. 사용하는 손가락: ${activeFingerDescription || "없음"}.${changedDescription ? ` 이전 운지에서 바뀐 손가락: ${changedDescription}.` : ""}`

  return (
    <figure
      className={classes(
        "sax-stage",
        `sax-stage--${view}`,
        reducedMotion && "sax-stage--reduced-motion",
        frame.errors.length > 0 && "sax-stage--rig-warning",
        className,
      )}
    >
      <figcaption className="sax-stage__view-label">{viewName}</figcaption>
      <svg
        className="sax-stage__svg saxophone-stage"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>{title}</title>
        <desc id={descriptionId}>{description}</desc>

        <g className="sax-stage__geometry" transform={geometryTransform(view)} aria-hidden="true">
          <path
            className="sax-stage__instrument-body"
            d="M87 18 C84 42 85 63 89 82 L89 239 C89 261 101 277 114 278 C128 277 135 266 133 252 L127 238 L113 237 L111 82 C115 56 112 33 106 18 Z"
          />
          <path className="sax-stage__instrument-highlight" d="M99 28 L99 238 C99 252 105 260 114 263" />
          <path className="sax-stage__hand-divider" d="M76 154 L126 154" />

          <g className="sax-stage__keys">
            {SAX_KEYS.map((key) => {
              const progress = frame.keys[key.id]
              const center = keyCenter(key)
              return (
                <g
                  key={key.id}
                  className={classes(
                    "sax-key",
                    "stage-key",
                    `sax-key--${key.type}`,
                    progress > 0.001 && progress < 0.999 && "sax-key--moving",
                    progress >= 0.999 && "sax-key--pressed",
                    progress >= 0.999 && "is-pressed",
                  )}
                  transform={`translate(0 ${1.8 * progress})`}
                >
                  {key.type === "circle" ? (
                    <circle className="sax-key__shape" cx={key.x} cy={key.y} r={key.r} />
                  ) : (
                    <rect className="sax-key__shape" x={key.x} y={key.y} width={key.w} height={key.h} rx="6" />
                  )}
                  <circle
                    className="sax-key__contact"
                    cx={center.x}
                    cy={center.y}
                    r={2.3 * progress}
                  />
                </g>
              )
            })}
          </g>

          <g className="sax-stage__palms">
            <path
              className="sax-palm sax-palm--left"
              transform={palmTransform(frame.hands.LH, "LH")}
              d="M55 67 C48 80 49 133 57 154 C62 166 78 170 86 158 C93 143 92 88 84 69 C78 57 62 56 55 67 Z"
            />
            <path
              className="sax-palm sax-palm--right"
              transform={palmTransform(frame.hands.RH, "RH")}
              d="M126 157 C119 171 119 220 125 244 C129 257 145 262 153 250 C160 232 160 181 153 161 C149 149 133 147 126 157 Z"
            />
          </g>

          <g className="sax-stage__fingers">
            {FINGER_IDS.map((fingerId) => {
              const pose = frame.fingers[fingerId]
              const contact = contactPoint(pose)
              const active = pose.contactProgress > 0.001
              const changedFinger = changed.has(fingerId)
              return (
                <g
                  key={fingerId}
                  className={classes(
                    "sax-finger",
                    `sax-finger--${fingerId.startsWith("LH") ? "left" : "right"}`,
                    active && "sax-finger--active",
                    active && `sax-finger--${pose.motion}`,
                    changedFinger && "sax-finger--changed",
                    !pose.reachable && "sax-finger--unreachable",
                  )}
                >
                  <line
                    className="sax-finger__segment sax-finger__segment--proximal"
                    x1={pose.pivot.x}
                    y1={pose.pivot.y}
                    x2={pose.elbow.x}
                    y2={pose.elbow.y}
                  />
                  <line
                    className="sax-finger__segment sax-finger__segment--distal"
                    x1={pose.elbow.x}
                    y1={pose.elbow.y}
                    x2={pose.tip.x}
                    y2={pose.tip.y}
                  />
                  <circle className="sax-finger__joint" cx={pose.elbow.x} cy={pose.elbow.y} r="3.1" />
                  <ellipse
                    className="sax-finger__tip"
                    cx={pose.tip.x}
                    cy={pose.tip.y}
                    rx="4.8"
                    ry="3.7"
                  />
                  {pose.contactMode === "knuckle" && (
                    <ellipse
                      className="sax-finger__knuckle-contact"
                      cx={pose.elbow.x}
                      cy={pose.elbow.y}
                      rx={5.3 * pose.contactProgress}
                      ry={3.5 * pose.contactProgress}
                    />
                  )}
                  {active && (
                    <circle
                      className="sax-finger__contact-marker"
                      cx={contact.x}
                      cy={contact.y}
                      r={2.5 * pose.contactProgress}
                    />
                  )}
                  {changedFinger && (
                    <circle
                      className="sax-finger__changed-marker"
                      cx={contact.x}
                      cy={contact.y}
                      r="7"
                    />
                  )}
                </g>
              )
            })}
          </g>
        </g>

        <g className="sax-stage__key-labels" aria-hidden="true">
          {SAX_KEYS.map((key) => {
            const center = keyCenter(key)
            return (
              <text
                key={key.id}
                className={classes("sax-key__label", frame.keys[key.id] > 0.5 && "sax-key__label--pressed")}
                x={labelX(center.x, view)}
                y={center.y + 3.4 + 1.8 * frame.keys[key.id]}
                textAnchor="middle"
              >
                {key.label}
              </text>
            )
          })}
        </g>

        {frame.errors.length > 0 && (
          <g className="sax-stage__warning" aria-hidden="true">
            <circle cx="207" cy="14" r="8" />
            <text x="207" y="18" textAnchor="middle">!</text>
          </g>
        )}
      </svg>
      {frame.errors.length > 0 && (
        <span className="sax-stage__warning-text">일부 손 위치는 추가 검수가 필요합니다.</span>
      )}
    </figure>
  )
}

export default SaxophoneRigStage
