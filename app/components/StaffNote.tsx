import { useId, type CSSProperties } from "react";
import {
  writtenMidiToSpelledPitch as spellWrittenMidi,
  type AccidentalPreference as DomainAccidentalPreference,
  type PitchAccidental as DomainPitchAccidental,
  type PitchLetter as DomainPitchLetter,
  type SpelledPitch as DomainSpelledPitch,
} from "../../lib/sax-data";

export type AccidentalPreference = DomainAccidentalPreference;
export type PitchLetter = DomainPitchLetter;
export type PitchAccidental = DomainPitchAccidental;

export interface SpelledPitch extends DomainSpelledPitch {
  displayName: string;
  accessibleNameKo: string;
}

export interface StaffNoteProps {
  /** 색소폰 기보음 MIDI. 실음 MIDI를 전달하지 않는다. */
  writtenMidi: number;
  accidentalPreference?: AccidentalPreference;
  className?: string;
  style?: CSSProperties;
  showPitchLabel?: boolean;
  titleKo?: string;
}

const LETTER_INDEX: Readonly<Record<PitchLetter, number>> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

const ACCIDENTAL_NAME_KO: Readonly<Record<PitchAccidental, string>> = {
  natural: "",
  sharp: " 샵",
  flat: " 플랫",
};

export function writtenMidiToSpelledPitch(
  writtenMidi: number,
  accidentalPreference: AccidentalPreference = "flat",
): SpelledPitch {
  const spelled = spellWrittenMidi(writtenMidi, accidentalPreference);
  return {
    ...spelled,
    displayName: `${spelled.letter}${spelled.accidentalSymbol}${spelled.octave}`,
    accessibleNameKo: `${spelled.letter}${ACCIDENTAL_NAME_KO[spelled.accidental]} ${spelled.octave}옥타브`,
  };
}

const STAFF_LEFT = 42;
const STAFF_RIGHT = 174;
const STAFF_BOTTOM_Y = 108;
const HALF_STEP_Y = 6;
const E4_STAFF_STEP = 4 * 7 + LETTER_INDEX.E;
const NOTE_X = 126;

export function staffYFromStep(staffStep: number): number {
  return STAFF_BOTTOM_Y - (staffStep - E4_STAFF_STEP) * HALF_STEP_Y;
}

/** 오선 바깥의 C4/A5부터 필요한 선만 반환한다. */
export function ledgerStaffSteps(staffStep: number): readonly number[] {
  const ledgerSteps: number[] = [];
  const belowFirst = 4 * 7 + LETTER_INDEX.C;
  const aboveFirst = 5 * 7 + LETTER_INDEX.A;
  if (staffStep <= belowFirst) {
    for (let step = belowFirst; step >= staffStep; step -= 2) ledgerSteps.push(step);
  }
  if (staffStep >= aboveFirst) {
    for (let step = aboveFirst; step <= staffStep; step += 2) ledgerSteps.push(step);
  }
  return ledgerSteps;
}

function SharpMark({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2">
      <path d={`M ${x - 5} ${y - 13} L ${x - 7} ${y + 11}`} />
      <path d={`M ${x + 5} ${y - 11} L ${x + 3} ${y + 13}`} />
      <path d={`M ${x - 10} ${y - 4} L ${x + 10} ${y - 7}`} />
      <path d={`M ${x - 10} ${y + 6} L ${x + 10} ${y + 3}`} />
    </g>
  );
}

function FlatMark({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2">
      <path d={`M ${x - 3} ${y - 17} L ${x - 3} ${y + 10}`} />
      <path d={`M ${x - 3} ${y - 1} C ${x + 12} ${y - 9}, ${x + 12} ${y + 7}, ${x - 3} ${y + 10}`} />
    </g>
  );
}

/**
 * written pitch 전용 오선 컴포넌트. 접근성 이름에도 기보음임을 명시하며,
 * 실음·MIDI·운지 정답은 포함하지 않는다.
 */
export function StaffNote({
  writtenMidi,
  accidentalPreference = "flat",
  className,
  style,
  showPitchLabel = true,
  titleKo,
}: StaffNoteProps) {
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const titleId = `staff-note-title-${safeId}`;
  const descriptionId = `staff-note-description-${safeId}`;
  const pitch = writtenMidiToSpelledPitch(writtenMidi, accidentalPreference);
  const noteY = staffYFromStep(pitch.staffStep);
  const ledgers = ledgerStaffSteps(pitch.staffStep);
  const stemDown = noteY < 84;
  const accessibleTitle = titleKo ?? `기보음 ${pitch.accessibleNameKo}`;

  return (
    <svg
      className={className}
      style={{ display: "block", width: "100%", maxWidth: 300, height: "auto", ...style }}
      viewBox="0 0 220 150"
      role="img"
      aria-labelledby={`${titleId} ${descriptionId}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id={titleId}>{accessibleTitle}</title>
      <desc id={descriptionId}>
        {`높은음자리표 오선에 표시한 색소폰 written pitch ${pitch.accessibleNameKo}.`}
      </desc>

      <g aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round">
        {[0, 1, 2, 3, 4].map((line) => (
          <line
            key={line}
            x1={STAFF_LEFT}
            x2={STAFF_RIGHT}
            y1={STAFF_BOTTOM_Y - line * 12}
            y2={STAFF_BOTTOM_Y - line * 12}
            strokeOpacity="0.72"
            strokeWidth="1.5"
          />
        ))}
        {ledgers.map((step) => (
          <line
            key={step}
            x1={NOTE_X - 15}
            x2={NOTE_X + 15}
            y1={staffYFromStep(step)}
            y2={staffYFromStep(step)}
            strokeWidth="1.8"
          />
        ))}
      </g>

      <text
        aria-hidden="true"
        x="47"
        y="106"
        fill="currentColor"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="66"
      >
        𝄞
      </text>

      {pitch.accidental === "sharp" ? <SharpMark x={103} y={noteY} /> : null}
      {pitch.accidental === "flat" ? <FlatMark x={103} y={noteY} /> : null}

      <g aria-hidden="true" fill="currentColor" stroke="currentColor">
        <ellipse cx={NOTE_X} cy={noteY} rx="10" ry="7" transform={`rotate(-17 ${NOTE_X} ${noteY})`} />
        {stemDown ? (
          <line x1={NOTE_X - 9} x2={NOTE_X - 9} y1={noteY} y2={noteY + 39} strokeWidth="2" />
        ) : (
          <line x1={NOTE_X + 9} x2={NOTE_X + 9} y1={noteY} y2={noteY - 39} strokeWidth="2" />
        )}
      </g>

      {showPitchLabel ? (
        <text
          aria-hidden="true"
          x="181"
          y="82"
          fill="currentColor"
          fontFamily="system-ui, sans-serif"
          fontSize="17"
          fontWeight="700"
          textAnchor="middle"
        >
          {pitch.displayName}
        </text>
      ) : null}
      <text
        aria-hidden="true"
        x="181"
        y="100"
        fill="currentColor"
        fontFamily="system-ui, sans-serif"
        fontSize="9"
        letterSpacing="0.8"
        textAnchor="middle"
      >
        WRITTEN
      </text>
    </svg>
  );
}

export default StaffNote;
