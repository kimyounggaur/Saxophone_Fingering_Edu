/**
 * Helpers around the commissioned saxophone line art.
 *
 * The artwork itself lives in `lib/generated/illustration-data.ts` (generated from
 * the artist's PDF by `scripts/extract-illustration-data.py`).  This module adds the
 * parts that are app logic rather than artwork: which written notes can be drawn,
 * whether the artwork agrees with the app's seed fingering, how the stage frames the
 * figure, and where key-name chips go.
 *
 * Nothing here decides what the CORRECT fingering is.  The stage always highlights
 * keys from the app's own fingering data; the artwork's hands are shown as drawn.
 * When the two disagree for a note, `illustrationMismatch` says so and the stage
 * shows a review warning instead of silently trusting either side.
 */

import { ILLUSTRATION_DATA, type IllustrationKeyShape, type IllustrationPose } from "./generated/illustration-data"

export { ILLUSTRATION_DATA }
export type { IllustrationKeyShape, IllustrationPose }

/**
 * The stage "view" the artwork is natively drawn in.
 *
 * The art shows the instrument as an audience sees a player facing them (the
 * player's right hand appears on the left of the picture), which is what a mirror
 * shows — so it is native to the app's "mirror" view.  The "player" view is a
 * horizontal flip of the same drawing.  A flip is an anatomical mirror image, not a
 * true first-person drawing; changing this one constant swaps which view is flipped.
 */
export const ILLUSTRATION_NATIVE_VIEW = "mirror" as const

export type IllustrationZoom = "hands" | "left" | "right" | "full"

export interface ViewBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

const [, , FIGURE_MAX_X, FIGURE_MAX_Y] = ILLUSTRATION_DATA.bounds

/** Whole drawing plus the margins that hold key-name chips (native orientation). */
export const ILLUSTRATION_FRAME: ViewBox = Object.freeze({ x: -48, y: 0, w: FIGURE_MAX_X + 48 + 24, h: FIGURE_MAX_Y })

/** Framing presets in native orientation. */
export const ILLUSTRATION_VIEWS: Readonly<Record<IllustrationZoom, ViewBox>> = Object.freeze({
  hands: { x: ILLUSTRATION_FRAME.x, y: 44, w: ILLUSTRATION_FRAME.w, h: 222 },
  left: { x: 4, y: 50, w: ILLUSTRATION_FRAME.x + ILLUSTRATION_FRAME.w - 4, h: 84 },
  right: { x: ILLUSTRATION_FRAME.x, y: 150, w: 150, h: 116 },
  full: ILLUSTRATION_FRAME,
})

/** x' = pivot - x, where the pivot keeps the whole frame in place when mirrored. */
const MIRROR_PIVOT = 2 * ILLUSTRATION_FRAME.x + ILLUSTRATION_FRAME.w

export function mirrorX(x: number): number {
  return MIRROR_PIVOT - x
}

export function mirrorTransform(): string {
  return `translate(${MIRROR_PIVOT} 0) scale(-1 1)`
}

export function illustrationViewBox(zoom: IllustrationZoom, mirrored: boolean): ViewBox {
  const box = ILLUSTRATION_VIEWS[zoom]
  return mirrored ? { x: mirrorX(box.x + box.w), y: box.y, w: box.w, h: box.h } : box
}

/** Reference height the chip sizes are tuned for (the "hands" framing). */
const CHIP_REFERENCE_HEIGHT = ILLUSTRATION_VIEWS.hands.h

// ----------------------------------------------------------------------- notes
const NOTE_ID_PATTERN = /^written-(\d+)$/

export function writtenMidiFromNoteId(id: string | undefined): number | null {
  const match = id ? NOTE_ID_PATTERN.exec(id) : null
  return match ? Number(match[1]) : null
}

export function getIllustrationPose(midi: number): IllustrationPose | undefined {
  return ILLUSTRATION_DATA.poses[midi]
}

export function getIllustrationKey(keyId: string): IllustrationKeyShape | undefined {
  return ILLUSTRATION_DATA.keys[keyId]
}

/** True when the artwork has this note AND a position for every key the app presses. */
export function canIllustrate(midi: number | null, pressed: readonly string[]): midi is number {
  if (midi === null || !getIllustrationPose(midi)) return false
  return pressed.every((keyId) => Boolean(getIllustrationKey(keyId)))
}

export interface IllustrationMismatch {
  /** Keys the app's seed fingering presses but the artwork does not mark. */
  readonly seedOnly: readonly string[]
  /** Keys the artwork marks but the app's seed fingering does not press. */
  readonly artworkOnly: readonly string[]
}

/** Compares the app's pressed keys with the keys the artist marked for the same note. */
export function illustrationMismatch(midi: number, pressed: readonly string[]): IllustrationMismatch | null {
  const marked = ILLUSTRATION_DATA.markers[midi]
  if (!marked) return null
  const seed = new Set(pressed)
  const art = new Set(marked)
  const seedOnly = [...seed].filter((key) => !art.has(key)).sort()
  const artworkOnly = [...art].filter((key) => !seed.has(key)).sort()
  return seedOnly.length || artworkOnly.length ? { seedOnly, artworkOnly } : null
}

// ---------------------------------------------------------------------- styles
/** `l15` -> "sx-l sx-w15", `h60r` -> "sx-h sx-w60 sx-r" (CSS decides the colours and weights). */
export const STYLE_CLASSES: readonly string[] = Object.freeze(
  ILLUSTRATION_DATA.styles.map((style) => {
    const match = /^([lbh])(\d+)(r?)$/.exec(style)
    if (!match) throw new Error(`Unknown illustration style: ${style}`)
    return `sx-${match[1]} sx-w${match[2]}${match[3] ? " sx-r" : ""}`
  }),
)

// ---------------------------------------------------------------- octave arrow
export interface ArrowLabel {
  readonly x: number
  readonly y: number
  readonly fontSize: number
}

/** Where to letter "옥타브" on the artist's arrow: centred on its shaft, clear of the head. */
export const OCTAVE_ARROW_LABEL: ArrowLabel | null = (() => {
  const shape = ILLUSTRATION_DATA.keys.ok?.shape
  if (!shape) return null
  const numbers = (shape.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const xs = numbers.filter((_, index) => index % 2 === 0)
  const ys = numbers.filter((_, index) => index % 2 === 1)
  const minX = Math.min(...xs)
  const width = Math.max(...xs) - minX
  return { x: minX + width * 0.35, y: (Math.min(...ys) + Math.max(...ys)) / 2, fontSize: 5.2 }
})()

// ----------------------------------------------------------------------- chips
const LEFT_HAND_KEYS: ReadonlySet<string> = new Set([
  "ok", "pD", "pEb", "pF", "frontF", "lh1", "bis", "lh2", "lh3", "gSharp", "lowCSharp", "lowB", "lowBb",
])

export const KEY_CHIP_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ok: "옥타브",
  pD: "팜 D",
  pEb: "팜 E♭",
  pF: "팜 F",
  frontF: "프런트 F",
  lh1: "1",
  bis: "비스",
  lh2: "2",
  lh3: "3",
  gSharp: "G♯",
  lowCSharp: "C♯",
  lowB: "B",
  lowBb: "B♭",
  sideE: "사이드 E",
  sideC: "사이드 C",
  sideBb: "사이드 B♭",
  highFSharp: "하이 F♯",
  rh1: "1",
  altFSharp: "트릴 F♯",
  rh2: "2",
  rh3: "3",
  lowEb: "E♭",
  lowC: "C",
})

export interface KeyChip {
  readonly keyId: string
  readonly label: string
  /** Chip centre, native orientation. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly fontSize: number
  /** Where the leader line leaves the chip and where it meets the key ring. */
  readonly edgeX: number
  readonly anchorX: number
  readonly anchorY: number
  readonly estimate: boolean
}

const CHIP_FONT = 6.6
const CHIP_HEIGHT = 9.4
const CHIP_GAP = 1.6
const RIGHT_MARGIN_EDGE = ILLUSTRATION_DATA.bounds[2] - 14 // chips start right of the left hand
const LEFT_MARGIN_EDGE = -6 // chips end left of the right hand

function textWidth(label: string, fontSize: number): number {
  let width = 0
  for (const char of label) {
    if (/[ᄀ-ᇿ㄰-㆏가-힣]/.test(char)) width += fontSize
    else if (char === " ") width += fontSize * 0.3
    else if (char === "♯" || char === "♭") width += fontSize * 0.55
    else width += fontSize * 0.58
  }
  return width
}

/**
 * Lays out one chip per pressed key in the margin on the side of the hand that plays
 * it, spread vertically so chips never overlap.  `viewHeight` shrinks the chips when
 * the stage is zoomed in (they are meant to stay a constant size on screen).
 */
export function layoutKeyChips(pressed: readonly string[], viewHeight: number): KeyChip[] {
  const scale = Math.min(1, Math.max(0.5, viewHeight / CHIP_REFERENCE_HEIGHT))
  const fontSize = CHIP_FONT * scale
  const height = CHIP_HEIGHT * scale
  const chips: KeyChip[] = []

  // Right margin = keys played by the left hand; left margin = right hand (native orientation).
  // The octave key has no chip: the artist's own arrow points at it and is labelled in place.
  for (const margin of ["right", "left"] as const) {
    const keys = pressed
      .filter((keyId) => {
        if (keyId === "ok" || !getIllustrationKey(keyId)) return false
        return (margin === "right") === LEFT_HAND_KEYS.has(keyId)
      })
      .sort((a, b) => getIllustrationKey(a)!.y - getIllustrationKey(b)!.y)

    let previousY = -Infinity
    for (const keyId of keys) {
      const key = getIllustrationKey(keyId)!
      const label = KEY_CHIP_LABELS[keyId] ?? keyId
      const width = textWidth(label, fontSize) + 6 * scale
      const y = Math.max(key.y, previousY + height + CHIP_GAP * scale)
      previousY = y
      const edgeX = margin === "right" ? RIGHT_MARGIN_EDGE : LEFT_MARGIN_EDGE
      // stop the leader on the key ring instead of running through the key
      const dx = edgeX - key.x
      const dy = y - key.y
      const length = Math.hypot(dx, dy) || 1
      const pull = Math.min(key.r, length)
      chips.push({
        keyId,
        label,
        x: margin === "right" ? edgeX + width / 2 : edgeX - width / 2,
        y,
        width,
        height,
        fontSize,
        edgeX,
        anchorX: key.x + (dx / length) * pull,
        anchorY: key.y + (dy / length) * pull,
        estimate: key.source === "estimate",
      })
    }
  }
  return chips
}
