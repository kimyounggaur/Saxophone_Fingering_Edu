# Saxophone Edu

알토·테너·소프라노 색소폰의 33개 기보음(B♭3-F♯6)을 계이름과 영어 음이름으로 익히는 정적 차트·PDF·양손 SVG 애니메이션 프로젝트입니다.

## 주요 산출물

- `index.html` - 전체 자료 랜딩 페이지
- `sax-fingering-animation.html` - 악기·음·표기 전환, 재생, 키 탭을 지원하는 양손 운지 애니메이션
- `sax-fingering-animation.svg` - 같은 런타임을 사용하는 단독 실행형 SVG 애니메이션
- `hand-preview.html` - 양손 리그의 33음 포즈와 MCP/PIP/DIP 각도를 조정하는 개발용 프리뷰
- `{alto|tenor|soprano}-sax-fingering-chart.html` - 오선보·양손·키 다이어그램 3열 차트
- `{alto|tenor|soprano}-sax-fingering-chart.svg` - 벡터 포스터
- `{alto|tenor|soprano}-sax-fingering-chart.pdf` - A4 가로 6페이지 인쇄본

## 손 리그 아키텍처

`generate-alto-sax-fingering-chart.mjs`의 `FINGER_MAP`이 23개 키를 왼손·오른손의 엄지/검지/중지/약지/소지/손바닥에 배정합니다. `derivePoses()`는 각 음의 기존 `pressed[]`를 3마디 손가락 포즈와 손바닥 이동으로 변환하고, `buildHand()`는 테이퍼 마디·손톱·관절 주름·그라데이션·엄지 물갈퀴·접점 그림자가 있는 SVG 리그를 만듭니다. 애니메이션은 같은 포즈를 430ms cubic ease-out으로 보간하고, 정적 차트는 동일 데이터를 인쇄 가능한 손 다이어그램으로 사용합니다.

## 재생성

PowerShell에서 HTML/SVG/PDF 3종을 모두 재생성합니다.

```powershell
foreach ($kind in "alto", "tenor", "soprano") { node .\generate-alto-sax-fingering-chart.mjs $kind }
```

반복 개발 중 PDF 생성을 건너뛰려면 `--no-pdf`를 붙입니다.

```powershell
node .\generate-alto-sax-fingering-chart.mjs alto --no-pdf
```

> [!WARNING]
> `*-sax-fingering-chart.html/svg/pdf`와 `sax-fingering-animation.html/svg`, `hand-preview.html`은 생성물입니다. 직접 수정하면 다음 실행에서 덮어써집니다. 기능·데이터·스타일 변경은 반드시 `generate-alto-sax-fingering-chart.mjs`에서 하세요.

## 불변 조건

- 원본 `notes[].pressed[]` 33개는 변경하지 않습니다.
- 생성기 실행 시 23키 `FINGER_MAP`, 모든 단일 키의 접점 오차(1.5 SVG 단위 이하), 33음 조합을 자동 검증합니다.
- PDF는 표지 1 + 운지 시트 4 + 출처 1, 총 6페이지를 유지합니다.
- 포스터 SVG는 400KB 이하를 목표로 압축 생성합니다.

## Live Site

https://saxophone-edu.vercel.app
