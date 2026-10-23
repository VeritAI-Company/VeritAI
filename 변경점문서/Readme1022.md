# 프론트엔드 총정리

## 목차
1. 프론트엔드 안정화
2. 멀티 플랫폼 확장 (크롬 확장, PWA, React Native 앱)
3. 실행 가이드
4. 자주 겪는 문제
5. 시연 방법
6. 남은 과제
7. 10-23 개선 (크롬 확장 위주)

---

# 1. 프론트엔드 안정화

## 1-1. 빌드 복구, PWA 포털 분리
- 문제: `vite.config.js`의 `writeBundle()` 안에서 `VitePWA()`를 호출만 하고 결과를 버려서 플러그인이 등록되지 않았다.
  그 상태에서 `content.js`가 `virtual:pwa-register`를 import해서 빌드가 실패했다.
  content script에서 `registerSW()`를 부르면 사용자가 보고 있는 사이트 도메인에 서비스 워커를 등록하려고 하는 문제도 있었다.
- 조치:
  - `content.js`에서 `registerSW` 제거
  - `vite.config.js`는 확장 전용으로 정리, content.js에 import/export가 남으면 빌드를 실패시키는 검사 추가
  - PWA 포털을 `portal/`, `vite.portal.config.js`로 분리 (VitePWA를 plugins에 정상 등록, 임시 아이콘 포함)
  - `manifest.json` content_scripts의 `"type": "module"` 제거 (지원 안 됨)
  - `package.json` 스크립트 정리: `dev`, `build`, `dev:portal`, `build:portal`, `build:all`

## 1-2. storage 변경 시 전체 재스캔 차단
- 문제: 검사가 끝날 때마다 통계(`veritai_stat_*`)를 저장하면서 `storage.onChanged`가 불렸고, 모든 탭에서 페이지 전체를 다시 스캔해서 정상 이미지 테두리가 계속 깜빡였다.
- 조치: 설정 키(`isSystemOn`, `isAutoScanOn`, `isCleanUIMode`)가 바뀔 때만 반응하게 했다. MutationObserver 옵션을 `DOM_OBSERVER_OPTIONS`(src, srcset)로 통일하고 큐 상한을 넣었다.

## 1-3. Shadow DOM 쿼리 정리
- 문제: 배지는 Shadow DOM 안에 있는데 일반 DOM에서 찾고 있었다. 그래서 이미지가 바뀌어도 옛 판정이 남고, 전원을 꺼도 배지가 남고, Alt+V 단축키가 동작하지 않았다.
- 조치: `getShadowHost`, `getBadge`, `getUIContainer`, `getAllBadges`, `removeMediaUI` 헬퍼로 통일했다.

## 1-4. 같은 부모 안 형제 이미지 UI 충돌
- 문제: 부모 요소 하나에 검사 버튼과 배지가 하나씩만 만들어져서 서로 덮어썼다.
- 조치: 미디어마다 `data-veritai-id`, UI에 `data-veritai-for`를 붙여 1:1로 연결하고 `positionOverlay()`로 각 미디어 위치에 배치했다.

## 1-5. 키보드(Enter)로 리포트 열 때 ReferenceError
- 조치: `showReportBox()`가 만든 박스(또는 이미 열린 박스)를 반환하고, 키보드 핸들러가 그 값을 쓰게 했다.

## 확인 결과 (브라우저 테스트)
- 형제 이미지 2장: 검사 버튼 1개였던 것이 2개로 정상 생성
- 두 번째 검사 후 첫 번째 이미지 테두리가 다시 깜빡이던 현상 없어짐
- 키보드 Enter로 리포트: `detailsBox is not defined` 에러 없어지고 닫기 버튼에 포커스
- 이미지 src 교체: 옛 배지가 지워지고 검사 버튼 다시 생성
- 전원 OFF: 남아 있던 UI 1개가 0개로
- 로컬 파일 드래그 검사: 기존처럼 정상

## 적용
```powershell
npm run build          # 확장 프로그램 -> dist/
npm run build:portal   # PWA 포털 -> dist-portal/
```

---

# 2. 멀티 플랫폼 확장

크롬 확장은 PC에서만 쓸 수 있어서, 폰으로 SNS를 보는 사용자를 위해 같은 분석 서버를 쓰는 채널을 3개로 늘렸다.

## 2-1. 구조
- 크롬 확장, PWA, React Native 앱이 모두 같은 백엔드(Spring Boot, 8080)로 요청하고, 백엔드가 AI 서버(FastAPI, 8000)를 호출한다.
- 앱의 자세한 리포트 화면은 PWA 화면을 WebView로 다시 쓴다.
- 백엔드와 AI 서버는 채널을 늘리면서 고친 곳이 없다. 기존 API와 CORS 설정을 그대로 쓴다.
- 채널마다 `clientType`을 다르게 보내서(`chrome-extension`, `pwa-portal`, `react-native-app`) 백엔드 기록에서 구분할 수 있다.

## 2-2. 채널별 역할

| 채널 | 입력 | 쓰는 상황 | 폴더 | 상태 |
|---|---|---|---|---|
| 크롬 확장 | 웹페이지 이미지, 재생 중 영상 프레임 | PC에서 보면서 바로 검사 | `frontend/` | 운영 버전 (MV3, Vite 빌드) |
| 모바일 웹 PWA | 카메라, 갤러리 사진, 스크린샷 | 폰에서 사진 한 장 검사 | `portal/` | 폰에서 동작 확인 |
| React Native 앱 | 다른 앱의 공유 버튼, 카메라, 갤러리(사진, 영상) | 인스타, 카톡, 갤러리에서 바로 검사 | `mobile/` | 갤럭시 S24에서 동작 확인 |

## 2-3. 폴더 구조 (프론트엔드만)

```
VeritAI/
├─ manifest.json            크롬 확장 설정 (MV3)
├─ package.json             확장, 포털 빌드 스크립트
├─ vite.config.js           확장 빌드 -> dist/
├─ vite.portal.config.js    PWA 포털 빌드 -> dist-portal/
├─ frontend/                크롬 확장
│  ├─ content.js            웹페이지에 붙는 메인 스크립트 (빌드하면 한 파일로 합쳐짐)
│  ├─ background.js         서비스 워커 (이미지 가져오기, 우클릭 메뉴, offscreen 관리)
│  ├─ offscreen.html, worker.js   이미지 리사이즈용 숨은 페이지
│  ├─ popup.html, popup.js  확장 아이콘 팝업
│  ├─ config/constants.js   서버 주소, 폴링 간격 등
│  ├─ core/network.js       업로드, 일괄 폴링
│  ├─ core/capture.js       이미지, 영상 캡처
│  └─ ui/styles.js          배지, 리포트 스타일
├─ portal/                  모바일 웹 PWA
│  ├─ index.html, style.css 화면 (시작, 미리보기, 분석 중, 결과, 오류)
│  ├─ main.js               화면 전환, 결과 그리기, 신고, 앱용 리포트 모드
│  ├─ api.js                업로드, 폴링, 신고, 오류 문구
│  ├─ image.js              1280px 축소, EXIF 회전 반영, WebP 변환
│  └─ public/               PWA 아이콘
└─ mobile/                  React Native 앱 (Expo SDK 57)
   ├─ App.js                화면 (홈, 미리보기, 분석 중, 결과, 웹 리포트)
   ├─ app.json              앱 이름, 권한, 공유받기 설정
   ├─ package.json          버전 고정한 라이브러리, 실행 스크립트
   ├─ setup.ps1             설치 스크립트 (npm run setup)
   ├─ .env                  EXPO_PUBLIC_USE_RN_FETCH=1 (지우면 안 됨, 4장 참고)
   └─ src/
      ├─ config.js          서버 주소 (API_BASE, PORTAL_URL)
      ├─ api.js             업로드, 폴링, 조회
      ├─ media.js           사진 축소, 처음엔 1초 지점, 미리보기에서 장면 선택
      ├─ history.js         검사 기록 (폰에 최대 50개)
      └─ theme.js           색상
```

## 2-4. 공통 검사 흐름
채널이 달라도 입력만 다르고 나머지는 같다.
1. 입력: 확장은 웹페이지 이미지와 영상 프레임, PWA는 카메라와 갤러리, 앱은 공유받은 파일과 카메라, 갤러리
2. 전처리: 긴 변 최대 1280px로 줄여 WebP 또는 JPEG로 변환, 영상은 프레임 1장만 뽑음
3. 업로드: `POST /api/detections` (multipart)
   - `file`, `mediaType`(`image` 또는 `video_frame`), `clientType`, `analysisMode=face_crop_only`
   - 백엔드는 바로 `202 QUEUED`와 `requestId`, `retryAfterMs`를 돌려줌
4. 결과 조회: `GET /api/detections/{id}` 또는 `GET /api/detections/status?ids=1,2,3`를 `retryAfterMs` 간격으로 반복
5. 표시: 판정, 조작 확률, 얼굴 박스, Grad-CAM 히트맵, 오탐 신고(`POST /api/feedback`)

결과에서 쓰는 필드: `isDeepfake`, `confidence`, `faceCount`, `faces[{ bbox, fakeProbability, detectionConfidence, quality }]`, `heatmapBase64`

## 2-5. 모바일 웹 PWA (`portal/`)
- 크롬 확장을 못 쓰는 폰 사용자가 앱 설치 없이 링크로 쓰는 검사 페이지다. 폰 크롬에서 "홈 화면에 추가"를 하면 앱처럼 열린다.
- 기능
  - 사진 입력: 후면 카메라 바로 열기, 갤러리 선택
  - 전처리: 긴 변 최대 1280px WebP, 세로 사진 회전 정보(EXIF) 반영
  - 결과: 판정과 조작 확률, 얼굴 박스, 히트맵과 투명도 슬라이더, 얼굴별 정보(최대 3명)
  - 오탐 신고: `/api/feedback` (확장과 같은 API)
  - 오류 안내: 요청 과다(429), 서버 꺼짐, 이미지가 아닌 파일
  - 시작 화면에 "사진을 줄여 분석 서버로만 전송" 안내
- 변경점
  - 확장(`vite.config.js`)과 포털(`vite.portal.config.js`) 빌드를 나눠서 서비스 워커가 섞이지 않게 했다.
  - 얼굴 박스는 서버로 보낸 이미지 위에 그려서 좌표가 어긋나지 않는다.
  - 서버에서 받은 값은 `textContent`로만 넣는다.
  - `?embed=report`로 열면 앱이 보낸 사진과 결과로 결과 화면만 보여 준다.
  - 서버 주소는 `portal/api.js`의 `VITE_API_BASE`로 관리한다. 배포할 때 `portal/.env.production`에 https 주소를 넣으면 된다.

## 2-6. React Native 앱 (`mobile/`)
- 인스타, 갤러리, 카카오톡의 공유 버튼으로 VeritAI를 골라 바로 검사하는 안드로이드 앱이다 (Expo).
- 기능
  - 공유받기(이미지, 영상, 링크): `expo-share-intent`, 안드로이드 공유 목록에 VeritAI가 뜸
  - 사진 찍기, 갤러리 사진과 영상 선택: `expo-image-picker`
  - 전처리: 사진은 최대 1280px JPEG, 영상은 처음엔 1초 지점이고 미리보기에서 장면을 골라 프레임 1장 추출 (`expo-image-manipulator`, `expo-video-thumbnails`)
  - 분석 요청과 결과 조회: PWA와 같은 업로드, 폴링 흐름
  - 검사 기록: 폰에 최대 50개, 사진은 저장하지 않고 판정과 요청 번호만 저장 (`AsyncStorage`)
  - 오류 처리: 서버 꺼짐, 요청 과다, 권한 거부, 링크 공유를 따로 안내하고 오류 화면 아래에 원래 오류와 요청 주소를 같이 표시
  - 자세한 리포트: 포털 `?embed=report`를 WebView로 열고 사진과 결과를 메시지로 넘김
- 변경점
  - 백엔드가 이미지만 받기 때문에 영상은 프레임 1장을 뽑아서 보낸다. 확장이 재생 중인 프레임 1장을 보내는 것과 같은 방식이다.
  - 인스타는 공유할 때 사진이 아니라 게시물 링크만 넘겨준다. 이 경우 스크린샷을 찍어 공유하라고 안내한다.
  - 결과 리포트는 PWA 화면을 그대로 써서 같은 화면을 두 번 만들지 않았다.
  - Expo SDK 57로 고정했다. `expo-share-intent`가 아직 SDK 58을 지원하지 않는다. `npx expo install expo@latest`로 올리면 안 된다.
  - SDK 57은 기본 `fetch`를 `expo/fetch`로 바꾸는데, 이 상태로는 사진 업로드가 "서버에 연결할 수 없습니다"로 실패했다. `mobile/.env`의 `EXPO_PUBLIC_USE_RN_FETCH=1`로 원래 fetch를 쓰게 했고, 이 파일은 `mobile/.gitignore`의 `!.env`로 저장소에 포함했다.

---

# 3. 실행 가이드

명령은 모두 Windows PowerShell 기준이고 `VeritAI` 폴더에서 시작한다. 서버, 포털, 앱은 터미널 창을 따로 열어서 켜 둔다.

## 3-0. 준비물
- 공통: Node.js(LTS), Git
- 백엔드: JDK 21 이상
- AI 서버: Python 3.10 이상, `ai\venv` 가상환경 (AI 쪽 안내대로 `pip install -r requirements.txt`)
- 폰 테스트: USB 데이터 케이블, 폰 개발자 옵션에서 USB 디버깅 켜기
- 앱 빌드: Android SDK와 platform-tools (Android Studio로 설치하는 게 제일 쉬움), 환경변수 `ANDROID_HOME`

`ANDROID_HOME` 설정 (한 번만, 설정 후 VS Code와 터미널을 다시 열어야 적용됨)
```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
```
새 창에서 `echo $env:ANDROID_HOME` 했을 때 경로가 나오면 된다.

## 3-1. 서버 켜기

AI 서버 (8000)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\run_ai_server_retention_v2.ps1
```
브라우저에서 `http://127.0.0.1:8000/`이 열리면 된다.

백엔드 (8080)
```powershell
cd backend\backend_spring
.\gradlew.bat bootRun
```
dev 프로필은 메모리 DB(H2)라서 껐다 켜면 기록이 없어진다.

## 3-2. 크롬 확장
```powershell
npm install          # 처음 한 번, package.json이 바뀌었을 때
npm run build        # dist/ 생성
```
1. 크롬에서 `chrome://extensions` 열기
2. 오른쪽 위 개발자 모드 켜기
3. "압축해제된 확장 프로그램을 로드"에서 `VeritAI\dist` 선택
4. 코드를 고친 뒤에는 `npm run build` 하고 확장 카드의 새로고침 버튼

`npm run dev`를 켜 두면 저장할 때마다 dist가 갱신된다. 확장 새로고침은 직접 해야 한다.

## 3-3. PWA 포털

PC
```powershell
npm run dev:portal
```
`http://127.0.0.1:5173`을 연다.

폰 (USB)
1. 폰을 USB로 연결하고 폰에 뜨는 "USB 디버깅 허용"에서 허용
2. 폰의 localhost를 PC로 연결
   ```powershell
   $adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
   & $adb devices                      # "device"로 떠야 함
   & $adb reverse tcp:8080 tcp:8080    # 백엔드
   & $adb reverse tcp:5173 tcp:5173    # 포털
   ```
3. 폰 크롬에서 `http://localhost:5173`을 열고 메뉴에서 "홈 화면에 추가"

## 3-4. React Native 앱

처음 한 번 설치
```powershell
cd mobile
npm run setup        # node_modules 정리, npm install, 버전 확인
```
마지막에 "설치 완료!"가 나오면 된다.

빌드와 설치 (폰 USB 연결 상태)
```powershell
cd mobile
npm run android      # 처음에는 몇 분 걸림
```

`npm run android`가 기존 `adb reverse`를 지우기 때문에 빌드가 끝나면 다시 연결한다.
```powershell
& $adb reverse tcp:8080 tcp:8080
& $adb reverse tcp:5173 tcp:5173
```

다음부터
- 코드만 고쳤으면 `cd mobile; npm start` 하고 폰에서 앱을 연다.
- 개발용 빌드라서 PC의 Metro(`npm start` 또는 `npm run android` 창)가 켜져 있어야 앱 화면이 뜬다.
- `app.json`이나 라이브러리를 바꿨을 때만 `npm run android`로 다시 빌드한다.

앱으로 검사
- 홈에서 사진 찍기 또는 갤러리 선택, 미리보기, 검사하기
- 갤러리, 카톡, 스크린샷에서 공유 버튼으로 VeritAI를 고르면 바로 미리보기
- "자세한 리포트 보기"는 포털이 켜져 있어야 열린다.
- 공유받기는 Expo Go에서는 안 된다. `npm run android`로 설치한 앱을 써야 한다.

## 3-5. 테스트별로 켜야 하는 것
- 크롬 확장: AI 서버, 백엔드, `npm run build` 후 확장 로드
- PWA(PC): AI 서버, 백엔드, `npm run dev:portal`
- PWA(폰): 위에 더해 폰 연결과 `adb reverse` 8080, 5173
- 앱: AI 서버, 백엔드, `npm run dev:portal`, `npm run android`, 그다음 `adb reverse` 8080, 5173

---

# 4. 자주 겪는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| `npm run setup`에서 `ERESOLVE` (expo-share-intent) | Expo SDK 58이 설치됨 | `mobile/package.json` 버전 그대로 두고 `npm run setup` 다시 |
| `Cannot find module './utils/autoAddConfigPlugins.js'` | 설치 중 라이브러리 버전이 섞임 | `npm run setup` 다시 |
| `npm run android`에서 SDK를 못 찾음, `ANDROID_HOME`이 비어 있음 | 환경변수 설정 후 터미널을 다시 안 엶 | VS Code를 완전히 껐다 켜기, 급하면 `$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"` |
| AI 서버 8000 포트 사용 중 | 이미 켜져 있음 | `netstat -ano \| findstr :8000`으로 확인, 켜져 있으면 그대로 사용 |
| `adb devices`에 `unauthorized` | 폰에서 허용을 안 누름 | 케이블을 다시 꽂고 폰에서 허용 |
| `adb devices`에 아무것도 안 뜸 | 충전 전용 케이블, USB 모드 | 데이터 케이블 사용, 폰 USB 설정을 "파일 전송"으로 |
| 앱만 "서버에 연결할 수 없습니다" (폰 크롬은 됨) | `expo/fetch` 문제 | `mobile/.env`에 `EXPO_PUBLIC_USE_RN_FETCH=1` 있는지 확인하고 `npm run android` 다시 |
| 앱과 폰 크롬 모두 서버 연결 안 됨 | `adb reverse`가 풀림 | `npm run android` 뒤에 `adb reverse` 8080, 5173 다시 |
| 폰에서 포털이 깨져 보이거나 안 열림 | 포털이 IPv6로만 열려서 adb가 못 붙음 | `npm run dev:portal`로 다시 실행 (`--host 127.0.0.1` 포함) |
| 앱 리포트에서 "웹 리포트를 열 수 없습니다" | 포털이 꺼졌거나 5173 reverse 안 됨 | `npm run dev:portal`, `adb reverse tcp:5173 tcp:5173` |
| 확장 수정이 반영 안 됨 | 빌드나 새로고침을 안 함 | `npm run build`, 확장 새로고침, 웹페이지 새로고침 |
| `mobile/.env` 만들기 | | `mobile` 폴더에서 `Set-Content -Path .env -Value "EXPO_PUBLIC_USE_RN_FETCH=1" -Encoding ascii` |

---

# 5. 시연 방법

크롬 확장은 PC에서 그대로 시연한다. 폰(PWA, 앱)을 PC 서버에 어떻게 연결할지만 정하면 된다. 아래 방법은 모두 추가 비용이 없다.

## 5-1. 방법
1. USB와 `adb reverse` (지금 방식): 추가 작업은 없지만 폰이 케이블에 묶이고 앱은 Metro도 켜 둬야 한다.
2. 무선 디버깅과 `adb reverse`: 코드 수정 없이 1번에서 케이블만 빠진다. PWA와 앱 모두 그대로 된다. 폰과 PC가 같은 와이파이(또는 PC 핫스팟)에 있어야 한다. (5-3)
3. 같은 와이파이, PC IP, 릴리스 APK: Metro와 adb가 필요 없지만 서버 주소를 PC IP로 바꾸고 릴리스 APK를 빌드해야 한다. PWA는 http라 홈 화면 정식 설치가 안 된다.
4. Tailscale(사설 VPN, 개인용 무료): 학교 와이파이가 기기 간 연결을 막아도 된다. PC와 폰에 앱을 깔고 3번처럼 주소를 바꿔야 한다.
5. PC 안드로이드 에뮬레이터: 폰 없이 PC 화면으로 시연할 수 있지만 공유 버튼 시연 느낌이 약하고 PC 사양이 필요하다.

## 5-2. 추천 구성
- 크롬 확장: PC에서 그대로
- PWA: 무선 디버깅, 폰 크롬에서 `http://localhost:5173`
- 앱: 무선 디버깅, 코드 수정이나 재빌드 없이 지금 방식 그대로

## 5-3. 무선 디버깅 연결
adb를 USB 대신 와이파이로 연결한다. 연결된 뒤는 3-3, 3-4와 같다. (안드로이드 11 이상)

폰과 PC를 같은 와이파이에 연결한다. 폰이 핫스팟을 켜는 쪽이면 무선 디버깅이 꺼질 수 있어서, PC의 모바일 핫스팟(윈도우 설정, 네트워크 및 인터넷, 모바일 핫스팟)에 폰을 붙이는 게 낫다.

페어링 (기기당 처음 한 번)
1. 폰: 설정, 개발자 옵션, 무선 디버깅 켜고 들어가기
2. "페어링 코드로 기기 페어링"을 누르면 `IP주소:포트`와 6자리 코드가 나온다.
3. PC
   ```powershell
   $adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
   & $adb pair 192.168.x.x:페어링포트     # 6자리 코드 입력
   ```
   `Successfully paired`가 나오면 된다.

연결 (시연할 때마다)
1. 무선 디버깅 화면 위쪽의 IP 주소와 포트를 확인한다. 페어링 포트와 다른 번호다.
2. PC
   ```powershell
   & $adb connect 192.168.x.x:포트
   & $adb devices          # 192.168.x.x:포트 device
   ```
3. 그다음은 USB와 같다.
   ```powershell
   cd mobile
   npm start                           # 또는 npm run android
   & $adb reverse tcp:8080 tcp:8080
   & $adb reverse tcp:5173 tcp:5173
   ```
4. PWA는 폰 크롬에서 `http://localhost:5173`, 앱은 설치된 VeritAI를 연다.

참고
- 폰 화면이 꺼지거나 와이파이가 바뀌면 끊길 수 있다. 그때는 `adb connect`부터 다시 한다. 포트 번호가 바뀌었을 수 있다.
- 처음 연결할 때 윈도우 방화벽 창이 뜨면 허용한다.

---

# 6. 남은 과제
- 시연 방식 최종 결정, 서버 주소 변경
- "공개 주소로 검사" (백엔드가 URL의 이미지를 받아오는 새 API)
- 배포: https 서버, PWA 정적 호스팅, 크롬 웹 스토어 등록

---

# 7. 10-23 개선

## 7-1. 얼굴별 조작 확률 표시
- 문제: 얼굴별 확률을 `face.fakeProbability`에서 읽었는데 AI는 `face.cnn.fakeProbability`에 담아 보낸다. 그래서 리포트에 "-"가 나오고 박스가 항상 초록이었다.
- 조치: `cnn.fakeProbability`를 먼저 읽게 했다. 확장, 포털, 앱 세 곳 모두 고쳤다.
- 색 기준: 30% 미만 초록, 30~50% 주황, 50% 이상 빨강, 값이 없으면 회색

## 7-2. 리포트 얼굴 박스 정리
- 박스는 테두리만 그리고 박스 왼쪽 위에 얼굴 번호를 붙인다. 번호는 아래 목록의 [얼굴 N]과 같다.
- 번호 크기는 화면 기준 9~11px로 박스 크기에 맞춘다. 박스가 작으면 번호를 박스 바깥 위(자리가 없으면 아래)에 둔다.
- 기본으로 검출 신뢰도 50% 이상인 얼굴과 조작 확률이 가장 높은 얼굴만 보여준다. 나머지는 "검출 신뢰도 낮은 얼굴 N개 숨김 · 모두 보기"로 펼친다. (포털, 앱도 같음)
- 히트맵은 AI가 가장 높게 본 영역(`cnn.views`)에 겹친다. 사진 전체가 가장 높으면 전체에 겹친다.
- 리포트에는 실제로 서버에 보낸 사진을 그려서 박스 위치가 어긋나지 않는다.

## 7-3. 업로드 이미지 크기
- 긴 변이 1280px보다 크면 1280px로 줄이고, 작은 사진은 키우지 않는다.
- 1280px 이하 JPEG, PNG, WebP는 원본 그대로 보내고, 그 외 형식만 WebP(품질 92%)로 바꾼다.
- 업로드 파일 확장자를 실제 형식에 맞춘다.
- 참고: 포털은 WebP 85%, 앱은 JPEG 85%로 항상 다시 저장한다(폰 사진 회전 정보 반영). 그래서 같은 사진도 채널마다 확률이 조금 다를 수 있다.

## 7-4. 영상 다시 검사
- 영상 리포트에 "검사 장면: 영상 m:ss 지점"을 표시한다.
- "현재 장면 다시 검사" 버튼으로 지금 재생 위치를 다시 검사한다. 우클릭 "VeritAI로 조작 정밀 검사"도 끝난 영상이면 다시 검사한다.

## 7-5. 자동 검사가 "분석 중"에서 멈추는 문제
- 문제: 사진을 줄이는 작업 창(offscreen 문서)이 닫힌 상태에서 여러 사진이 동시에 검사를 시작하면, 작업 창을 동시에 두 번 만들려다 오류("Only a single offscreen document may be created")가 났다. 그 사진은 응답을 계속 기다려서 "분석 중"에서 멈췄고, 동시 검사 칸(2~3개)을 차지해서 다음 검사도 밀렸다. 껐다 켜면 다시 되던 이유다.
- 조치 (`background.js`):
  - 작업 창은 한 번만 만든다. 만드는 중이면 다른 요청은 그걸 기다린다.
  - 처리 중인 요청이 있으면 30초 자동 닫기를 하지 않는다.
  - 20초 안에 응답이 없거나 오류가 나면 실패로 돌려보낸다. 그러면 우회 방법으로 다시 시도하고, 그래도 안 되면 오류 배지와 재시도 버튼이 뜬다.

## 7-6. 사진 줄이기 중복 처리
- 문제: 확장 화면의 "사진 줄여줘" 요청이 백그라운드와 작업 창 양쪽에 다 전달돼서, 작업 창이 열려 있으면 같은 사진을 두 번 내려받고 두 번 줄였다.
- 조치: 백그라운드가 작업 창에 넘길 때 표시(`target: 'offscreen'`)를 붙이고, 작업 창(`worker.js`)은 그 표시가 있는 요청만 처리한다.

## 7-7. 결과 확인 요청 시간 제한
- 문제: 처음 업로드에는 15초 제한이 있었지만, 결과를 반복해서 묻는 요청(`/api/detections/status`)에는 제한이 없었다. 백엔드가 응답을 안 주면 "분석 중"에서 멈출 수 있었다.
- 조치 (`core/network.js`): 15초 안에 응답이 없으면 그 요청만 포기하고 다시 묻는다. 전체 3분이 지나면 오류 배지가 뜬다.
