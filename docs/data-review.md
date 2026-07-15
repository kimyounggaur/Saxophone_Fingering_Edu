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

## 승인 규칙

각 행은 최소 1개 권위 자료, 식별 가능한 실제 검수자, 역할/자격, 악기 모델, 날짜, `approved`/`changes-requested`/`rejected`, 메모를 가져야 합니다. 33개가 모두 승인되기 전 공개 교육용 출시 상태는 `release-blocked`입니다.
