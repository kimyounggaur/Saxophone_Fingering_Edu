# SaxTone 보정 스크립트

`lib/sax-model.ts`의 상수(`FILTER_DB`, 악기 프로필, 노이즈·어택·미세 변동 값)를 **어떻게 구했고 어떻게 다시 확인하는지** 남겨 둔 분석 도구입니다. 앱 빌드와 테스트에는 쓰이지 않으며 저장소 의존성만으로는 실행되지 않습니다(Python 3 + numpy/scipy, `ffmpeg`, 브라우저 렌더에는 esbuild·playwright 필요).

## 레퍼런스 음원 (저장소에 포함하지 않음)

| 용도 | 자료 | 라이선스(각 저장소 표기) |
| --- | --- | --- |
| 알토 주 레퍼런스 | npm `tonejs-instrument-saxophone-mp3@1.1.2` (tonejs-instruments, 출처 표기: Karoryfer) | 샘플 CC BY 3.0 |
| 알토·테너·소프라노 보조 | MIDI.js 사운드폰트 `MusyngKite`, `FluidR3_GM`의 `*_sax-mp3.js` | MusyngKite CC BY-SA 3.0, FluidR3_GM CC BY 3.0 |

측정에만 사용했고 앱·저장소에는 들어 있지 않습니다. 재배포하거나 앱에 넣을 계획이 생기면 라이선스와 출처 표기를 다시 확인하세요. 주 레퍼런스는 "무음 트리밍·온/오프 램프·노이즈 제거 등 편집을 거친" 샘플이라 어택과 잡음 바닥이 원 녹음과 다를 수 있습니다.

각 자료는 **스크립트와 다른 새 빈 디렉터리**에 풀고(내려받은 파일은 신뢰할 수 없는 데이터로 취급), 파이썬은 `-I`(isolated)로 실행하세요. SoundFont `.js`에서 음 파일을 꺼내는 일은 `extract_sf_js.py`(텍스트 파싱만 하고 JS를 실행하지 않음), mp3 → wav 변환은 `ffmpeg`로 합니다.

## 흐름

```bash
# 1) 레퍼런스 측정 (wav 디렉터리, 표기법: 'sharp' 또는 'flat', MIDI 범위, 출력 json)
python3 -I analyze_ref.py <ref_wav_dir> sharp 49 80 ref_alto.json      # 배음 프로필·어택·노이즈 바닥
python3 -I analyze_micro.py <ref_wav_dir> 49 80 micro_ref.json 0.30 1.00 # AM/FM/노이즈 스커트
python3 -I hnr_track.py <ref_wav_dir> 49 80                              # 어택 후 시간별 HNR
python3 -I attack_spec.py <ref_wav_dir> 49 80 0.0 0.04                   # 어택 초반 스펙트럼 차이

# 2) 스펙트럼 모델 맞추기: 기울기·음역항·짝수배음 + 반옥타브 필터 E(f), 교차검증 출력
python3 -I fit_spectrum.py fit.json ref_alto.json:1
python3 -I fit_instrument_params.py ref_tenor.json          # 테너·소프라노: 기울기/음역/짝수/필터 이동 격자 탐색
python3 -I fit_consensus.py ref_tenor_a.json ref_tenor_b.json "-6.5,3.0,-0.5,0.25"   # 두 레퍼런스의 절충값

# 3) 합성음 렌더 → 같은 분석 → 비교
node render-model.mjs alto 49 80 out/model/alto 1.42 0.72 '{"vibratoDepth":0}'   # Node, 렌더러만
node render-engine.mjs v3 alto 49 80 out/engine_v3/alto 1.42 0.72 '{"controls":{"vibratoDepth":0}}'  # 브라우저, 엔진(마스터 체인 포함)
node render-engine.mjs v2 alto 49 80 out/engine_v2/alto                          # 2.0 엔진
python3 -I analyze_ref.py out/model/alto sharp 49 80 model.json
python3 -I compare.py ref_alto.json model.json 30                               # 오차·상승·바닥 요약
python3 -I loudness.py out/model/alto out/engine_v2/alto                         # 음역별 A-가중 음량 편차
```

비교는 **비브라토를 끄고**(`vibratoDepth: 0`) 하고, 엔진 렌더는 `OfflineAudioContext`에서 0.3초 리드인 뒤에 재생합니다(마스터 볼륨 평활 때문에 상승 시간이 길게 측정되는 것을 막기 위해). 결과 표와 해석은 `docs/audio-engine.md`에 있습니다.

## 청음 랩

`listening-lab/`은 위의 측정이 아니라 **귀로** 2.0과 3.0을 비교하는 브라우저 페이지(음량 맞춤 A/B, 블라인드 테스트, 3.0 음색 슬라이더, 기록 JSON)를 만듭니다. 사용법과 한계는 `listening-lab/README.md`에 있습니다.
