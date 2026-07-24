# SaxHands

두 손의 움직임을 보며 색소폰 기보 운지를 익히는 모바일 우선 웹앱입니다. `01 Source`의 23개 키·33개 기보음(MIDI 58–90)을 안전하게 추출해 탐색, 6개 마이크로 레슨, 회상·인식 연습, 검색·인쇄 가능한 운지표에 함께 사용합니다.

## 현재 상태

- 기능 상태: 비공개 베타 구현 및 자동 검증 완료
- 콘텐츠 상태: `seed` / 인간 전문가 검수 대기
- 공개 출시 상태: `release-blocked`

기능이 동작한다는 사실을 음악적·교육적 승인으로 해석하면 안 됩니다. 인간 검수자 기록은 AI가 생성하지 않으며, 남은 게이트는 [data-review.md](docs/data-review.md)와 [release-status.md](docs/release-status.md)에 명시되어 있습니다.

## 주요 기능

- 알토·테너·소프라노 전환과 실음 자동 계산
- B♭3–F♯6 반음계 탐색, High F♯ 키 보유 여부에 따른 32/33음 지원
- 23키·10손가락 SVG 리그, 연주자/거울 시점, 중단 안전 애니메이션
- 6개 변화 중심 레슨과 `콘텐츠 검수 중` 상태
- 운지 회상·손 모양 인식·10문제 로컬 연습과 Leitner 진도 엔진
- SaxTone 2.0 악기별 모델링 합성음, 음량·실음/기보음 선택, 터치 진동
- 검색 가능한 운지표, 오선 음표, 인쇄 전용 33음 표
- PWA manifest, 로컬 설정·진도, 오프라인 폴백, 라이트/다크 테마
- 키보드·스크린리더·48px 터치 목표·safe-area 대응

## 실행

요구 환경은 Node.js `>=22.13.0`이며 검증 환경은 `.node-version`의 Node 24.18.0과 npm 11.16.0입니다.

```bash
npm install
npm run dev
npm run lint
npm exec tsc -- --noEmit
npm test
```

`npm test`는 배포 빌드, 서버 렌더링, 공유 메타데이터, 원본 지문·23키·33음·이조 불변식, SaxTone 배음·엔벌로프, 설치·오프라인 자산을 검사합니다. 브랜드 PNG를 다시 만들 때는 `node scripts/generate-brand-assets.mjs`를 실행합니다.

## 데이터 갱신 규칙

원본 생성기는 직접 수정하지 않습니다. 앱 데이터는 다음 명령으로 AST에서 재생성하거나 현재 지문과 대조합니다.

```bash
node scripts/extract-source-data.mjs
node scripts/extract-source-data.mjs --check
```

추출기는 `eval`이나 원본 실행을 사용하지 않습니다. 원본 SHA-256이 바뀌면 검토 없이 golden 데이터를 덮어쓰지 마세요.

## 구조

- `lib/generated/source-data.ts`: 원본에서 재현한 23키·33음 seed
- `lib/sax-data.ts`: 음이름·실음·악기 capability·검수 상태
- `lib/sax-rig.ts`: 고정 길이 손 리그와 운지 프레임
- `lib/sax-synth.ts`: 악기별 배음·관 공명·호흡·비브라토 합성 엔진
- `lib/learning.ts`: 레슨 diff, seeded 연습 큐, Leitner·migration
- `app/components/`: 색소폰 스테이지와 오선 음표
- `app/SaxHandsApp.tsx`: 탐색·배우기·연습·운지표·설정 UI
- `public/`: PWA, 오프라인, 아이콘, 공유 이미지

## 배포 전 필수 수동 검수

1. 33개 primary 운지의 권위 자료와 색소폰 전문가 ReviewRecord
2. 7개 핵심 장면 × light/dark 리그 스크린샷 및 RigApprovalRecord
3. 6개 레슨 순서·문구·diff의 LessonReviewRecord
4. 실제 iOS Safari·Android Chrome/PWA 세로·가로·safe-area smoke
5. VoiceOver/TalkBack 또는 동등한 실제 스크린리더 완주 검사

위 항목이 모두 충족되기 전에는 `release-ready`라고 표시하지 않습니다.
