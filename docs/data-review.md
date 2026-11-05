# 운지 데이터 인간 검수 대장

이 문서는 원본 생성기에서 추출한 seed를 전문가가 검수하기 위한 대장입니다. 빈 reviewer/date/model/decision 칸을 AI가 채우면 안 됩니다.

## 권위 후보 자료

- `YAMAHA-PLAY002` — Yamaha Musical Instrument Guide, Saxophone fingering: https://www.yamaha.com/en/musical_instrument_guide/saxophone/play/play002.html
- `WFG-SCHEME` — Woodwind Fingering Guide, Fingering Scheme for Saxophone: https://www.wfg.woodwind.org/sax/sax_fing.html
- `WFG-OCTAVE2` — Woodwind Fingering Guide, Second Octave: https://www.wfg.woodwind.org/sax/sax_alt_2.html
- `TAMING-CHART` — Taming The Saxophone, Fingering Charts: https://tamingthesaxophone.com/lessons/beginners/fingering-chart
- `SAXSCHOOL-HIGHF` — Sax School, High F: https://saxschoolonline.com/articles/high-f-on-saxophone-a-beginners-guide/

로컬 알토·테너·소프라노 HTML/SVG/PDF는 같은 생성기의 파생물이므로 독립 출처로 세지 않습니다. 현재 generator SHA-256은 `50ffcc418d9a9923a027187df36495e9c6931607e5f3ed57e3d5ea3c9d3ecbd4`입니다.

## 우선 검수

Low B♭/B/C/C♯, B♭ 기본 운지, palm E/F/F♯, High F♯ capability, side·trill·alternate 문구를 먼저 확인합니다. 검수 전 alternate/model-specific 운지는 정답으로 노출하지 않습니다.

## 33개 primary 검수표

| MIDI | seed label | 상태 | 권위 source ID | reviewer / 역할 | 악기·모델 | 날짜 | decision / 메모 |
|---:|---|---|---|---|---|---|---|
| 58 | B♭3 / A♯3 | seed·대기 | — | — | — | — | — |
| 59 | B3 / C♭4 | seed·대기 | — | — | — | — | — |
| 60 | C4 / B♯3 | seed·대기 | — | — | — | — | — |
| 61 | C♯4 / D♭4 | seed·대기 | — | — | — | — | — |
| 62 | D4 | seed·대기 | — | — | — | — | — |
| 63 | E♭4 / D♯4 | seed·대기 | — | — | — | — | — |
| 64 | E4 / F♭4 | seed·대기 | — | — | — | — | — |
| 65 | F4 / E♯4 | seed·대기 | — | — | — | — | — |
| 66 | F♯4 / G♭4 | seed·대기 | — | — | — | — | — |
| 67 | G4 | seed·대기 | — | — | — | — | — |
| 68 | G♯4 / A♭4 | seed·대기 | — | — | — | — | — |
| 69 | A4 | seed·대기 | — | — | — | — | — |
| 70 | B♭4 / A♯4 | seed·대기 | — | — | — | — | — |
| 71 | B4 / C♭5 | seed·대기 | — | — | — | — | — |
| 72 | C5 / B♯4 | seed·대기 | — | — | — | — | — |
| 73 | C♯5 / D♭5 | seed·대기 | — | — | — | — | — |
| 74 | D5 | seed·대기 | — | — | — | — | — |
| 75 | E♭5 / D♯5 | seed·대기 | — | — | — | — | — |
| 76 | E5 / F♭5 | seed·대기 | — | — | — | — | — |
| 77 | F5 / E♯5 | seed·대기 | — | — | — | — | — |
| 78 | F♯5 / G♭5 | seed·대기 | — | — | — | — | — |
| 79 | G5 | seed·대기 | — | — | — | — | — |
| 80 | G♯5 / A♭5 | seed·대기 | — | — | — | — | — |
| 81 | A5 | seed·대기 | — | — | — | — | — |
| 82 | B♭5 / A♯5 | seed·대기 | — | — | — | — | — |
| 83 | B5 / C♭6 | seed·대기 | — | — | — | — | — |
| 84 | C6 / B♯5 | seed·대기 | — | — | — | — | — |
| 85 | C♯6 / D♭6 | seed·대기 | — | — | — | — | — |
| 86 | D6 | seed·대기 | — | — | — | — | — |
| 87 | E♭6 / D♯6 | seed·대기 | — | — | — | — | — |
| 88 | E6 / F♭6 | seed·대기 | — | — | — | — | — |
| 89 | F6 / E♯6 | seed·대기 | — | — | — | — | — |
| 90 | F♯6 / G♭6 | seed·대기 | — | — | — | — | High F♯ 키 requirement 확인 필요 |

## 일러스트 ↔ seed 불일치 (Gate D 검수 항목)

위촉 일러스트(`lib/generated/illustration-data.ts`)에서 작가가 회색 마커로 표시한 눌린 키와 seed 운지(`lib/generated/source-data.ts`의 `pressed`)를 33개 음 전부 대조했습니다. 26개 음은 일치하고 아래 7개 음이 다릅니다. **어느 쪽이 맞는지는 AI가 판단하지 않았습니다.** 작가의 표기 오류인지, seed 오류인지, 대체 운지인지는 검수자가 정합니다.

앱은 이 음에서 seed 기준으로 키를 강조하고, 일러스트의 손은 그려진 그대로 보여 주며, "일러스트와 운지 데이터가 달라 검수가 필요합니다." 경고를 함께 표시합니다. 정답을 숨기는 손 모양 인식 연습에서는 경고를 숨깁니다. `tests/illustration-data.test.mjs`가 이 7개 목록과 아래 표의 일치를 검사하므로, 검수 결과로 seed나 일러스트가 바뀌면 테스트와 이 표를 함께 갱신해야 합니다.

| MIDI | seed label | seed에만 있는 키 | 일러스트에만 있는 키 | reviewer / 역할 | decision / 메모 |
|---:|---|---|---|---|---|
| 60 | C4 / B♯3 | `rh1` | — | — | — |
| 61 | C♯4 / D♭4 | `lowC`, `lowCSharp` | `lowEb` | — | — |
| 63 | E♭4 / D♯4 | `rh1` | — | — | — |
| 70 | B♭4 / A♯4 | — | `lh2` | — | 작가 표시: 왼손 1·2번 + 사이드 B♭. 왼손 2번 표시는 A4 셀과 같은 위치·크기 |
| 82 | B♭5 / A♯5 | — | `lh2` | — | B♭4와 같은 차이 |
| 88 | E6 / F♭6 | `pD`, `pEb` | — | — | — |
| 90 | F♯6 / G♭6 | `highFSharp`, `pD`, `pEb`, `pF`, `sideE` | `lh1`, `lh3`, `sideBb` | — | 공통 키는 옥타브 키뿐인 서로 다른 운지. 위 표의 High F♯ 키 requirement 확인과 함께 검수 |

일러스트 쪽 한계도 함께 확인해야 합니다.

- `lowCSharp`(로우 C♯)와 `highFSharp`(하이 F♯)는 33개 그림 어디에도 마커가 없어 위치를 그림에서 눈으로 읽어 추정했습니다. 화면에서는 점선 링과 점선 칩으로 구분해 표시합니다.
- 알티시모 G6–C7 6개 셀(G6, G♯6, A6, A♯6, B6, C7)은 앱에 대응하는 seed 음이 없어 사용하지 않았습니다.
- 손 모양은 B♭3–F♯6 33개 음의 작가 원화 그대로입니다. 손가락 접촉·자연스러움은 Gate B와 별개로 Gate D에서 사람이 확인합니다. 연주자 시점은 원화를 좌우 반전해서 만들기 때문에 해부학적으로 거울상인 손이 됩니다(원화는 마주 선 사람이 보는 방향, 앱의 거울 시점과 같은 방향).
- 일러스트의 저작권·이용 허락 범위(웹앱 내 벡터 변환, 배포, 파생 데이터 포함)는 확인되지 않았습니다. 원본 PDF는 저장소에 포함하지 않았습니다.

## 승인 규칙

각 행은 최소 1개 권위 자료, 식별 가능한 실제 검수자, 역할/자격, 악기 모델, 날짜, `approved`/`changes-requested`/`rejected`, 메모를 가져야 합니다. 33개가 모두 승인되기 전 공개 교육용 출시 상태는 `release-blocked`입니다.
