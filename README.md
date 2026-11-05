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
- 위촉 일러스트 기반 색소폰·손 무대: 33음 손 포즈 크로스페이드, 두 손/왼손/오른손/전체 확대, 키 이름 칩, 연주자/거울 시점
- 일러스트가 다루지 못하는 음·키 조합은 기존 23키·10손가락 SVG 리그로 자동 대체, 중단 안전 애니메이션
- 6개 변화 중심 레슨과 `콘텐츠 검수 중` 상태
- 운지 회상·손 모양 인식·10문제 로컬 연습과 Leitner 진도 엔진
- **운지가 바뀔 때마다 고른 악기(알토·테너·소프라노)의 소리가 기본으로 납니다**(화면의 `소리 켜짐/꺼짐` 버튼과 설정에서 끌 수 있고, 연습 문제는 정답을 확인한 뒤에 소리가 납니다)
- SaxTone 3.0 합성음: 실제 알토 녹음을 측정해 맞춘 모델 렌더러(기본)와 이전 SaxTone 2.0 실시간 합성을 설정에서 전환, 음량·실음/기보음 선택, 터치 진동
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

`npm test`는 배포 빌드, 서버 렌더링, 공유 메타데이터, 원본 지문·23키·33음·이조 불변식, 일러스트 데이터 무결성과 seed 대조, SaxTone 2.0·3.0 배음·엔벌로프·렌더러·캐시·폴백, 저장된 설정의 1회 이전, 청음 랩의 분석·악구 코드, 설치·오프라인 자산을 검사합니다. 브랜드 PNG를 다시 만들 때는 `node scripts/generate-brand-assets.mjs`를 실행합니다.

## 데이터 갱신 규칙

원본 생성기는 직접 수정하지 않습니다. 앱 데이터는 다음 명령으로 AST에서 재생성하거나 현재 지문과 대조합니다.

```bash
node scripts/extract-source-data.mjs
node scripts/extract-source-data.mjs --check
```

추출기는 `eval`이나 원본 실행을 사용하지 않습니다. 원본 SHA-256이 바뀌면 검토 없이 golden 데이터를 덮어쓰지 마세요.

위촉 일러스트(손·색소폰 라인아트)도 같은 방식으로 PDF의 벡터를 추출해 `lib/generated/illustration-data.ts`에 고정합니다. 원본 PDF(`../01 Source/illustrations/saxophone-fingering-line-art.pdf`)는 저장소에 포함하지 않으며, SHA-256이 다르면 중단합니다. PyMuPDF(`pip install pymupdf`)가 필요합니다.

```bash
python3 scripts/extract-illustration-data.py            # 재생성
python3 scripts/extract-illustration-data.py --check    # 커밋된 데이터와 대조
python3 scripts/extract-illustration-data.py --verify   # 생성 데이터를 원본 PDF와 픽셀 비교
```

이 데이터는 작가가 그린 손 모양과 눌린 키 표시일 뿐 운지 정답이 아닙니다. 화면의 키 강조는 항상 `source-data.ts`의 seed에서 오며, 둘이 다른 7개 음은 경고와 함께 [data-review.md](docs/data-review.md)에 기록되어 있습니다.

## 구조

- `lib/generated/source-data.ts`: 원본에서 재현한 23키·33음 seed
- `lib/sax-data.ts`: 음이름·실음·악기 capability·검수 상태
- `lib/generated/illustration-data.ts`: 위촉 일러스트에서 추출한 본체·33음 손 포즈·키 위치 (자동 생성)
- `lib/illustration.ts`: 일러스트 프레이밍·거울 변환·seed 대조·키 이름 칩 배치
- `lib/sax-rig.ts`: 고정 길이 손 리그와 운지 프레임 (일러스트 미지원 조합의 대체 무대)
- `lib/sax-model.ts`: SaxTone 3.0 오프라인 렌더러(배음 모델·리드 비선형·호흡/텅잉·미세 변동), 순수 JS·결정적
- `lib/sax-synth.ts`: Web Audio 엔진 — 3.0 음 캐시·미리 계산·재생, 2.0 실시간 합성(`classic`)과 자동 폴백, 마스터 체인
- `lib/settings-revision.ts`: 저장된 설정의 세대(`settingsRevision`)와 오래된 저장본을 한 번만 올리는 규칙(기본값이 바뀌어도 이미 쓴 브라우저에 닿게)
- `docs/audio-engine.md`: 두 엔진의 구조, 레퍼런스 보정 결과와 한계, 성능, 검증
- `scripts/audio-calibration/`: 3.0 상수를 실제 녹음에서 맞춘 분석 스크립트(앱·테스트와 무관, 음원은 포함하지 않음)
- `scripts/audio-calibration/listening-lab/`: 2.0·3.0을 음량을 맞춰 번갈아 듣고 블라인드로 비교하는 청음 랩 페이지 생성기(앱에는 포함되지 않음)
- `lib/learning.ts`: 레슨 diff, seeded 연습 큐, Leitner·migration
- `app/components/`: 색소폰 스테이지(`SaxophoneStage.tsx` 일러스트, `SaxophoneRigStage.tsx` 대체 리그)와 오선 음표
- `scripts/extract-illustration-data.py`: 일러스트 PDF → 데이터 추출·대조·픽셀 검증
- `app/SaxHandsApp.tsx`: 탐색·배우기·연습·운지표·설정 UI
- `public/`: PWA, 오프라인, 아이콘, 공유 이미지

## 배포 전 필수 수동 검수

1. 33개 primary 운지의 권위 자료와 색소폰 전문가 ReviewRecord
2. 7개 핵심 장면 × light/dark 리그 스크린샷 및 RigApprovalRecord
3. 6개 레슨 순서·문구·diff의 LessonReviewRecord
4. 실제 iOS Safari·Android Chrome/PWA 세로·가로·safe-area smoke
5. VoiceOver/TalkBack 또는 동등한 실제 스크린리더 완주 검사
6. 일러스트 ↔ seed 불일치 7개 음의 전문가 결정, 일러스트 손 모양 시각 승인, 일러스트 이용 허락 범위 확인(Gate D)

위 항목이 모두 충족되기 전에는 `release-ready`라고 표시하지 않습니다.
