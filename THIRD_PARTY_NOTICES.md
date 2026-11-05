# 서드파티 고지

LGPL 라이선스 라이브러리를 쓰는 부분만 밝히는 문서입니다. 모든 의존성의 라이선스 목록이 아니므로, 나머지는 `package.json`과 각 패키지의 라이선스 파일을 보세요.

## @breezystack/lamejs 1.2.7 — LGPL-3.0

| 항목 | 내용 |
| --- | --- |
| 용도 | 합성음을 MP3로 저장 (`lib/mp3-encode.ts`) |
| 무엇인가 | [LAME](https://lame.sourceforge.io/) MP3 인코더(LGPL)를 순수 JavaScript로 옮긴 라이브러리. lamejs의 포크입니다. |
| 패키지 | https://www.npmjs.com/package/@breezystack/lamejs |
| 저장소 | https://github.com/shijinyu/lamejs (패키지 메타데이터 기준. 접속하면 `gideonstele/lamejs` 페이지로 이어지며, zhuker/lamejs의 포크로 소개됩니다.) |
| 라이선스 전문 | 설치된 패키지의 `node_modules/@breezystack/lamejs/LICENSE`, https://www.gnu.org/licenses/lgpl-3.0.html |

**사용 방식**

- 라이브러리를 **수정하지 않았습니다.** 앱 본체와 분리된 별도 파일(빌드 결과의 `assets/lamejs-*.js`)로 번들되며, MP3 저장 창이 열릴 때 또는 앱을 처음 터치한 뒤 백그라운드에서 불러옵니다.
- 다른 버전이나 자체 빌드로 바꾸려면 `package.json`의 `@breezystack/lamejs` 버전(또는 별칭)을 바꾸고 다시 빌드하면 됩니다. 앱 코드는 `Mp3Encoder`(`new Mp3Encoder(채널, 샘플레이트, kbps)`, `encodeBuffer`, `flush`)만 사용합니다.
- 사용자에게 보이는 고지: MP3 저장 창 아래쪽에 LAME 기반 라이브러리와 LGPL-3.0 사용 사실, LAME 사이트 링크를 표시합니다.

이 저장소나 빌드 결과를 외부에 배포할 때 LGPL 요건을 충족하는지는 배포하는 쪽이 확인해야 합니다. 이 문서는 법률 자문이 아닙니다.
