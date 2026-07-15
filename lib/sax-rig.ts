/**
 * Educational saxophone hand rig.
 *
 * The key geometry comes from 01 Source. The hand measurements below are a
 * deliberately new, provisional illustration calibration: they have not been
 * reviewed by a saxophone teacher or anatomy specialist and must not be
 * represented as an expert-approved physical model.
 */

import { SAX_KEYS as SOURCE_SAX_KEYS } from "./sax-data"

export const KEY_IDS = [
  "ok", "pD", "pEb", "pF", "frontF", "lh1", "bis", "lh2", "lh3",
  "gSharp", "lowCSharp", "lowB", "lowBb", "sideE", "sideC", "sideBb",
  "highFSharp", "rh1", "altFSharp", "rh2", "rh3", "lowEb", "lowC",
] as const

export const FINGER_IDS = [
  "LH-thumb", "LH-index", "LH-middle", "LH-ring", "LH-pinky",
  "RH-thumb", "RH-index", "RH-middle", "RH-ring", "RH-pinky",
] as const

export type KeyId = (typeof KEY_IDS)[number]
export type FingerId = (typeof FINGER_IDS)[number]
export type HandId = "LH" | "RH"
export type MotionClass = "press" | "roll" | "slide" | "reach"
export type ContactMode = "tip" | "knuckle"

export interface Point {
  x: number
  y: number
}

interface KeyBase {
  id: KeyId
  label: string
  spokenLabel: string
}

export type SaxKeySpec =
  | (KeyBase & { type: "circle"; x: number; y: number; r: number })
  | (KeyBase & { type: "pill"; x: number; y: number; w: number; h: number })

const SPOKEN_KEY_LABELS: Record<KeyId, string> = {
  ok: "옥타브 키", pD: "왼손 팜 D", pEb: "왼손 팜 E플랫", pF: "왼손 팜 F",
  frontF: "프런트 F", lh1: "왼손 1번", bis: "비스 B플랫", lh2: "왼손 2번",
  lh3: "왼손 3번", gSharp: "왼손 G샤프", lowCSharp: "낮은 C샤프",
  lowB: "낮은 B", lowBb: "낮은 B플랫", sideE: "오른손 사이드 E",
  sideC: "오른손 사이드 C", sideBb: "오른손 사이드 B플랫",
  highFSharp: "높은 F샤프", rh1: "오른손 1번", altFSharp: "대체 F샤프",
  rh2: "오른손 2번", rh3: "오른손 3번", lowEb: "낮은 E플랫", lowC: "낮은 C",
}

function sourceKeyToRigKey(key: (typeof SOURCE_SAX_KEYS)[number]): SaxKeySpec {
  const base = { id: key.id, label: key.label, spokenLabel: SPOKEN_KEY_LABELS[key.id], x: key.x, y: key.y }
  if (key.type === "circle") {
    if (typeof key.r !== "number") throw new Error(`Circle key ${key.id} is missing its radius.`)
    return { ...base, type: "circle", r: key.r }
  }
  if (typeof key.w !== "number" || typeof key.h !== "number") {
    throw new Error(`Pill key ${key.id} is missing its dimensions.`)
  }
  return { ...base, type: "pill", w: key.w, h: key.h }
}

/** The 23 key targets are consumed directly from the deterministic source catalog. */
export const SAX_KEYS: readonly SaxKeySpec[] = SOURCE_SAX_KEYS.map(sourceKeyToRigKey)

export const SAX_KEY_BY_ID = Object.fromEntries(
  SAX_KEYS.map((key) => [key.id, key]),
) as Record<KeyId, SaxKeySpec>

export const FINGER_MAP = {
  ok: { finger: "LH-thumb", motion: "press" },
  pD: { finger: "LH-index", motion: "roll" },
  pEb: { finger: "LH-middle", motion: "roll" },
  pF: { finger: "LH-ring", motion: "roll" },
  frontF: { finger: "LH-index", motion: "reach" },
  lh1: { finger: "LH-index", motion: "press" },
  bis: { finger: "LH-index", motion: "reach" },
  lh2: { finger: "LH-middle", motion: "press" },
  lh3: { finger: "LH-ring", motion: "press" },
  gSharp: { finger: "LH-pinky", motion: "slide" },
  lowCSharp: { finger: "LH-pinky", motion: "slide" },
  lowB: { finger: "LH-pinky", motion: "slide" },
  lowBb: { finger: "LH-pinky", motion: "slide" },
  sideE: { finger: "RH-index", motion: "reach" },
  sideC: { finger: "RH-index", motion: "reach" },
  sideBb: { finger: "RH-index", motion: "reach" },
  highFSharp: { finger: "RH-middle", motion: "reach" },
  rh1: { finger: "RH-index", motion: "press" },
  altFSharp: { finger: "RH-index", motion: "reach" },
  rh2: { finger: "RH-middle", motion: "press" },
  rh3: { finger: "RH-ring", motion: "press" },
  lowEb: { finger: "RH-pinky", motion: "slide" },
  lowC: { finger: "RH-pinky", motion: "slide" },
} as const satisfies Record<KeyId, { finger: FingerId; motion: MotionClass }>

interface FingerCalibration {
  hand: HandId
  pivot: Point
  rest: Point
  l1: number
  l2: number
  bend: -1 | 1
  jointLimit: { minFlexion: number; maxFlexion: number }
}

/** Provisional illustration values, not an expert-reviewed hand model. */
export const EDUCATIONAL_RIG_CALIBRATION = {
  schemaVersion: 1,
  status: "provisional-educational",
  expertReviewed: false,
  sourceNote: "Key positions derive from 01 Source; hand geometry was newly authored for this app.",
  handOrigins: { LH: { x: 72, y: 116 }, RH: { x: 134, y: 204 } },
  fingers: {
    "LH-thumb": { hand: "LH", pivot: { x: 77, y: 60 }, rest: { x: 98, y: 49 }, l1: 25, l2: 25, bend: 1, jointLimit: { minFlexion: 0, maxFlexion: 170 } },
    "LH-index": { hand: "LH", pivot: { x: 69, y: 89 }, rest: { x: 92, y: 80 }, l1: 28, l2: 24, bend: -1, jointLimit: { minFlexion: 0, maxFlexion: 170 } },
    "LH-middle": { hand: "LH", pivot: { x: 69, y: 113 }, rest: { x: 93, y: 106 }, l1: 28, l2: 24, bend: -1, jointLimit: { minFlexion: 0, maxFlexion: 170 } },
    "LH-ring": { hand: "LH", pivot: { x: 69, y: 137 }, rest: { x: 92, y: 132 }, l1: 27, l2: 23, bend: -1, jointLimit: { minFlexion: 0, maxFlexion: 170 } },
    "LH-pinky": { hand: "LH", pivot: { x: 69, y: 154 }, rest: { x: 61, y: 168 }, l1: 27, l2: 24, bend: 1, jointLimit: { minFlexion: 0, maxFlexion: 170 } },
    "RH-thumb": { hand: "RH", pivot: { x: 137, y: 224 }, rest: { x: 120, y: 229 }, l1: 20, l2: 18, bend: 1, jointLimit: { minFlexion: 0, maxFlexion: 170 } },
    "RH-index": { hand: "RH", pivot: { x: 132, y: 173 }, rest: { x: 107, y: 168 }, l1: 26, l2: 23, bend: 1, jointLimit: { minFlexion: 0, maxFlexion: 170 } },
    "RH-middle": { hand: "RH", pivot: { x: 132, y: 197 }, rest: { x: 106, y: 195 }, l1: 30, l2: 27, bend: 1, jointLimit: { minFlexion: 0, maxFlexion: 170 } },
    "RH-ring": { hand: "RH", pivot: { x: 132, y: 221 }, rest: { x: 106, y: 220 }, l1: 27, l2: 23, bend: 1, jointLimit: { minFlexion: 0, maxFlexion: 170 } },
    "RH-pinky": { hand: "RH", pivot: { x: 136, y: 237 }, rest: { x: 126, y: 247 }, l1: 24, l2: 21, bend: -1, jointLimit: { minFlexion: 0, maxFlexion: 170 } },
  } satisfies Record<FingerId, FingerCalibration>,
} as const

export interface HandRootPose {
  tx: number
  ty: number
  rotation: number
}

export interface TwoBoneSolution {
  elbow: Point
  tip: Point
  angle1: number
  angle2: number
  reachable: boolean
  clampedDistance: number
  error: number
}

export interface FingerPose extends TwoBoneSolution {
  pivot: Point
  activeKeyId: KeyId | null
  motion: MotionClass | "rest"
  contactMode: ContactMode | null
  contactProgress: number
}

export interface RigError {
  code: "unknown-key" | "duplicate-key" | "multi-contact" | "unreachable" | "joint-limit"
  message: string
  keyId?: string
  fingerId?: FingerId
}

export interface PoseFrame {
  hands: Record<HandId, HandRootPose>
  fingers: Record<FingerId, FingerPose>
  keys: Record<KeyId, number>
  errors: readonly RigError[]
}

export interface PressedNoteLike {
  pressed: readonly string[]
}

const KEY_ID_SET = new Set<string>(KEY_IDS)
const ROLL_CONTACT: Partial<Record<KeyId, Point>> = {
  pD: { x: 31.2, y: 86.7 },
  pEb: { x: 31.5, y: 107.4 },
  pF: { x: 34, y: 128.2 },
}

export function isKeyId(value: string): value is KeyId {
  return KEY_ID_SET.has(value)
}

export function keyCenter(key: SaxKeySpec): Point {
  return key.type === "circle"
    ? { x: key.x, y: key.y }
    : { x: key.x + key.w / 2, y: key.y + key.h / 2 }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

const SVG_COORDINATE_PRECISION = 10_000

function stableCoordinate(value: number): number {
  return Math.round(value * SVG_COORDINATE_PRECISION) / SVG_COORDINATE_PRECISION
}

function pointAt(origin: Point, angle: number, length: number): Point {
  return {
    x: stableCoordinate(origin.x + Math.cos(angle) * length),
    y: stableCoordinate(origin.y + Math.sin(angle) * length),
  }
}

export function solveTwoBone(
  pivot: Point,
  target: Point,
  l1: number,
  l2: number,
  bend: -1 | 1,
): TwoBoneSolution {
  const dx = target.x - pivot.x
  const dy = target.y - pivot.y
  const rawDistance = Math.hypot(dx, dy)
  const minimum = Math.abs(l1 - l2) + 0.001
  const maximum = l1 + l2 - 0.001
  const clampedDistance = Math.min(maximum, Math.max(minimum, rawDistance || minimum))
  const direction = rawDistance === 0 ? 0 : Math.atan2(dy, dx)
  const shoulderOffset = Math.acos(
    Math.max(-1, Math.min(1, (l1 * l1 + clampedDistance * clampedDistance - l2 * l2) / (2 * l1 * clampedDistance))),
  )
  const angle1 = direction + bend * shoulderOffset
  const elbow = pointAt(pivot, angle1, l1)
  const clampedTarget = pointAt(pivot, direction, clampedDistance)
  const angle2 = Math.atan2(clampedTarget.y - elbow.y, clampedTarget.x - elbow.x)
  const tip = pointAt(elbow, angle2, l2)
  const reachable = rawDistance >= minimum && rawDistance <= maximum

  return { elbow, tip, angle1, angle2, reachable, clampedDistance, error: distance(tip, target) }
}

function handRootsFor(keys: ReadonlySet<KeyId>): Record<HandId, HandRootPose> {
  const hasPalm = keys.has("pD") || keys.has("pEb") || keys.has("pF")
  const tableDepth = keys.has("lowBb") ? 12 : keys.has("lowB") ? 8 : keys.has("lowCSharp") ? 4 : 0
  const hasSide = keys.has("sideE") || keys.has("sideC") || keys.has("sideBb") || keys.has("highFSharp")
  return {
    LH: hasPalm ? { tx: -9, ty: -2, rotation: 0 } : { tx: 0, ty: tableDepth, rotation: 0 },
    RH: { tx: hasSide ? 6 : 0, ty: hasSide ? -2 : 0, rotation: 0 },
  }
}

function withRoot(point: Point, root: HandRootPose): Point {
  return { x: point.x + root.tx, y: point.y + root.ty }
}

function smallerAngle(a: number, b: number): number {
  let value = Math.abs(a - b) % (Math.PI * 2)
  if (value > Math.PI) value = Math.PI * 2 - value
  return value
}

function rollPose(
  pivot: Point,
  target: Point,
  calibration: FingerCalibration,
  keyId: KeyId,
): FingerPose {
  const direction = Math.atan2(target.y - pivot.y, target.x - pivot.x)
  const elbow = pointAt(pivot, direction, calibration.l1)
  const angle2 = -0.76
  const tip = pointAt(elbow, angle2, calibration.l2)
  const error = distance(elbow, target)
  return {
    pivot, elbow, tip, angle1: direction, angle2, reachable: error <= 1.5,
    clampedDistance: calibration.l1, error, activeKeyId: keyId, motion: "roll",
    contactMode: "knuckle", contactProgress: 1,
  }
}

function materializePose(pose: Omit<FingerPose, "elbow" | "tip">, fingerId: FingerId): FingerPose {
  const calibration = EDUCATIONAL_RIG_CALIBRATION.fingers[fingerId]
  const elbow = pointAt(pose.pivot, pose.angle1, calibration.l1)
  const tip = pointAt(elbow, pose.angle2, calibration.l2)
  return { ...pose, elbow, tip }
}

export function resolveTargetFrame(note: PressedNoteLike | readonly string[]): PoseFrame {
  const pressedInput = "pressed" in note ? note.pressed : note
  const errors: RigError[] = []
  const seen = new Set<KeyId>()
  for (const raw of pressedInput) {
    if (!isKeyId(raw)) {
      errors.push({ code: "unknown-key", keyId: raw, message: `Unknown saxophone key: ${raw}` })
    } else if (seen.has(raw)) {
      errors.push({ code: "duplicate-key", keyId: raw, message: `Duplicate pressed key: ${raw}` })
    } else {
      seen.add(raw)
    }
  }

  const roots = handRootsFor(seen)
  const activeByFinger = new Map<FingerId, KeyId[]>()
  for (const keyId of seen) {
    const finger = FINGER_MAP[keyId].finger
    const current = activeByFinger.get(finger) ?? []
    current.push(keyId)
    activeByFinger.set(finger, current)
  }

  const fingers = {} as Record<FingerId, FingerPose>
  for (const fingerId of FINGER_IDS) {
    const calibration = EDUCATIONAL_RIG_CALIBRATION.fingers[fingerId]
    const root = roots[calibration.hand]
    const pivot = withRoot(calibration.pivot, root)
    const active = activeByFinger.get(fingerId) ?? []
    if (active.length > 1) {
      errors.push({
        code: "multi-contact", fingerId,
        message: `${fingerId} cannot contact ${active.join(", ")} at the same time without an approved multi-contact pose.`,
      })
    }
    const keyId = active[0] ?? null
    if (!keyId) {
      const rest = withRoot(calibration.rest, root)
      const solution = solveTwoBone(pivot, rest, calibration.l1, calibration.l2, calibration.bend)
      fingers[fingerId] = {
        ...solution, pivot, activeKeyId: null, motion: "rest", contactMode: null, contactProgress: 0,
      }
      continue
    }

    const assignment = FINGER_MAP[keyId]
    const target = assignment.motion === "roll"
      ? (ROLL_CONTACT[keyId] ?? keyCenter(SAX_KEY_BY_ID[keyId]))
      : keyCenter(SAX_KEY_BY_ID[keyId])
    const pose = assignment.motion === "roll"
      ? rollPose(pivot, target, calibration, keyId)
      : (() => {
          const solution = solveTwoBone(pivot, target, calibration.l1, calibration.l2, calibration.bend)
          return {
            ...solution, pivot, activeKeyId: keyId, motion: assignment.motion,
            contactMode: "tip" as const, contactProgress: 1,
          }
        })()
    fingers[fingerId] = pose

    if (!pose.reachable) {
      errors.push({
        code: "unreachable", keyId, fingerId,
        message: `${fingerId} cannot reach ${keyId}; contact error is ${pose.error.toFixed(2)} SVG units.`,
      })
    }
    const flexion = smallerAngle(pose.angle1, pose.angle2) * 180 / Math.PI
    const { minFlexion, maxFlexion } = calibration.jointLimit
    if (flexion < minFlexion || flexion > maxFlexion) {
      errors.push({ code: "joint-limit", keyId, fingerId, message: `${fingerId} flexion ${flexion.toFixed(1)}° is outside the provisional illustration limit.` })
    }
  }

  const keys = {} as Record<KeyId, number>
  for (const keyId of KEY_IDS) keys[keyId] = seen.has(keyId) ? 1 : 0
  return { hands: roots, fingers, keys, errors }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return a + delta * t
}

export function interpolateFrame(from: PoseFrame, to: PoseFrame, t: number): PoseFrame {
  const progress = Math.max(0, Math.min(1, t))
  const hands = {
    LH: {
      tx: lerp(from.hands.LH.tx, to.hands.LH.tx, progress),
      ty: lerp(from.hands.LH.ty, to.hands.LH.ty, progress),
      rotation: lerpAngle(from.hands.LH.rotation, to.hands.LH.rotation, progress),
    },
    RH: {
      tx: lerp(from.hands.RH.tx, to.hands.RH.tx, progress),
      ty: lerp(from.hands.RH.ty, to.hands.RH.ty, progress),
      rotation: lerpAngle(from.hands.RH.rotation, to.hands.RH.rotation, progress),
    },
  }
  const fingers = {} as Record<FingerId, FingerPose>
  for (const fingerId of FINGER_IDS) {
    const a = from.fingers[fingerId]
    const b = to.fingers[fingerId]
    fingers[fingerId] = materializePose({
      pivot: { x: lerp(a.pivot.x, b.pivot.x, progress), y: lerp(a.pivot.y, b.pivot.y, progress) },
      angle1: lerpAngle(a.angle1, b.angle1, progress),
      angle2: lerpAngle(a.angle2, b.angle2, progress),
      reachable: b.reachable,
      clampedDistance: lerp(a.clampedDistance, b.clampedDistance, progress),
      error: lerp(a.error, b.error, progress),
      activeKeyId: progress < 0.5 ? a.activeKeyId : b.activeKeyId,
      motion: progress < 0.5 ? a.motion : b.motion,
      contactMode: progress < 0.5 ? a.contactMode : b.contactMode,
      contactProgress: lerp(a.contactProgress, b.contactProgress, progress),
    }, fingerId)
  }
  const keys = {} as Record<KeyId, number>
  for (const keyId of KEY_IDS) keys[keyId] = lerp(from.keys[keyId], to.keys[keyId], progress)
  return { hands, fingers, keys, errors: to.errors }
}

export function cloneFrame(frame: PoseFrame): PoseFrame {
  const fingers = {} as Record<FingerId, FingerPose>
  for (const id of FINGER_IDS) {
    const pose = frame.fingers[id]
    fingers[id] = {
      ...pose,
      pivot: { ...pose.pivot }, elbow: { ...pose.elbow }, tip: { ...pose.tip },
    }
  }
  return {
    hands: { LH: { ...frame.hands.LH }, RH: { ...frame.hands.RH } },
    fingers,
    keys: { ...frame.keys },
    errors: frame.errors.map((error) => ({ ...error })),
  }
}

export function changedFingers(previousPressed: readonly string[], pressed: readonly string[]): ReadonlySet<FingerId> {
  const previous = new Set(previousPressed.filter(isKeyId))
  const current = new Set(pressed.filter(isKeyId))
  const changed = new Set<FingerId>()
  for (const keyId of KEY_IDS) {
    if (previous.has(keyId) !== current.has(keyId)) changed.add(FINGER_MAP[keyId].finger)
  }
  return changed
}

export function contactPoint(pose: FingerPose): Point {
  return pose.contactMode === "knuckle" ? pose.elbow : pose.tip
}

export function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  return 1 - Math.pow(1 - clamped, 3)
}
