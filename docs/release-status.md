# 출시 상태

현재 판정: **비공개 베타 기능 검증 완료 · 공개 교육 출시 차단**

## 자동 검증 완료

- 원본 SHA-256, 23키, 33음, MIDI 58–90 연속, 미사용 4키, 이조 9/14/2
- lint, TypeScript strict, 배포 빌드, 서버 렌더·메타데이터·PWA 자산 테스트
- 모바일 390×844, 데스크톱 1440×900, 가로 844×390 브라우저 smoke
- 탐색·악기 전환·키보드 반음 이동·6개 레슨·회상·인식·운지표·설정
- 정답 공개 전 시각·접근성 트리 answer hiding
- 연주자/거울 시점, reduced motion, dark mode, 44px 미만 터치 대상 없음
- 새 브라우저 세션의 error overlay 0, page error 0, hydration 경고 0

## 인간 승인 대기

| Gate | 대상 | 현재 candidate SHA-256 | 상태 |
|---|---|---|---|
| A | 33개 primary 운지와 authority source | generator `50ffcc418d9a9923a027187df36495e9c6931607e5f3ed57e3d5ea3c9d3ecbd4` | 대기 |
| B | 손 리그·접촉·시각 자연스러움 7장면×light/dark | `lib/sax-rig.ts` `df2ee4e2848b816b18317f7e4a2cfa93b0f9582905b8ff5e80fbe8fe2ae3561c` | 대기 |
| C | 6개 레슨 순서·문구·diff | `lib/learning.ts` `64c839d95711aced59d87426788a54d3e761a10abd542e686de03486e9a90177` | 대기 |
| D | 위촉 일러스트 무대: 손 포즈 33음 시각 자연스러움 light/dark·연주자/거울, seed 불일치 7음 결정, 추정 키 2개, 이용 허락 범위 | `lib/generated/illustration-data.ts` `b55139a9adf7468a1e3d3eab15a5e81cbb55cfb5f397e48e18bdac0ffe0c78e8` · `lib/illustration.ts` `0e4e94c8d5120fb602dd3ca3efc1c1e0c0c7e2ab33d1a0dd43660161ae2d4aa4` · `app/components/SaxophoneStage.tsx` `b83e1ef2ab931ca273296d20eb57acc3a2a938f215fae2aebe1614ee428536c9` | 대기 |

Gate D 메모: 일러스트 무대는 seed 운지를 기준으로 키를 강조하며, 작가의 마커와 seed가 다른 7개 음은 [data-review.md](data-review.md)에 기록하고 화면에서 경고합니다. `lib/sax-rig.ts`는 변경하지 않았고 일러스트가 다루지 못하는 음·키 조합의 대체 무대로만 남으므로 Gate B의 적용 범위는 담당자가 다시 정해야 합니다.

## 실제 기기·보조기술 대기

- iOS Safari/PWA: 주소창 펼침/접힘, safe-area, 회전, 오디오 제스처
- Android Chrome/PWA: 설치, 오프라인 재실행, 회전, 진동
- VoiceOver/TalkBack: 탐색 한 음, 레슨 한 묶음, 연습 10문제, 설정 닫기
- 흑백 실제 인쇄 또는 PDF preview의 33음 clipping·pattern 확인

위 기록이 제공되고 candidate hash와 일치할 때만 `release-ready` 재평가를 수행합니다. AI 자체 승인이나 자동 테스트 결과로 이 표를 승인 상태로 바꾸지 않습니다.
