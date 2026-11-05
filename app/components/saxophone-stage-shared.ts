import type { FingerId } from "@/lib/sax-rig"

/** Shared by the illustrated stage and the procedural rig fallback. */
export type SaxophoneStageView = "player" | "mirror"
export type AnswerVisibility = "full" | "recall-hidden" | "recognition-blind"

export interface SaxophoneStageNote {
  pressed: readonly string[]
  id?: string
  label?: string
  writtenName?: string
}

export interface SaxophoneStageProps {
  note: SaxophoneStageNote
  previousPressed?: readonly string[]
  view?: SaxophoneStageView
  reducedMotion?: boolean
  answerVisibility?: AnswerVisibility
  replayToken?: string | number
  /** Scales hand-transition time ("slow" doubles it). Defaults to "normal". */
  animationSpeed?: "normal" | "slow"
  className?: string
}

export const FINGER_KOREAN: Record<FingerId, string> = {
  "LH-thumb": "왼손 엄지",
  "LH-index": "왼손 검지",
  "LH-middle": "왼손 중지",
  "LH-ring": "왼손 약지",
  "LH-pinky": "왼손 새끼손가락",
  "RH-thumb": "오른손 엄지",
  "RH-index": "오른손 검지",
  "RH-middle": "오른손 중지",
  "RH-ring": "오른손 약지",
  "RH-pinky": "오른손 새끼손가락",
}
