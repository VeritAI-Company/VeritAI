# VeritAI 모바일 앱 (React Native, Expo)

설계서 5.1 채널 구성 중 React Native 앱 채널이다.

## 역할
- 공유받기: SNS, 갤러리, 파일 앱의 공유 버튼으로 VeritAI 선택 (expo-share-intent)
- 사진 찍기, 갤러리에서 사진과 영상 선택 (expo-image-picker)
- 사진은 최대 1280px JPEG로 축소, 처음엔 1초 지점, 미리보기에서 장면 선택 (src/media.js)
- 분석 API 호출, 상태 조회, 오류 처리 (src/api.js)
- 검사 기록: 폰에 최대 50개, 사진은 저장하지 않음 (src/history.js)
- 자세한 리포트(얼굴 영역, 히트맵, 신고)는 포털을 WebView로 다시 씀 (`portal/?embed=report`)

## 폴더 구조

```
mobile/
├─ App.js          화면과 동작 (홈, 미리보기, 분석 중, 결과, 웹 리포트)
├─ index.js        앱 진입점
├─ app.json        앱 이름, 아이콘, 권한, 공유받기 설정
├─ package.json    라이브러리 버전, 실행 스크립트
├─ setup.ps1       설치 스크립트
├─ assets/         앱 아이콘
└─ src/
   ├─ config.js    서버 주소 (API_BASE, PORTAL_URL)
   ├─ api.js       업로드, 폴링, 조회
   ├─ media.js     사진 축소, 영상 프레임 추출
   ├─ history.js   검사 기록 저장
   └─ theme.js     색상
```

## 처음 설치

준비물: Node.js, Android Studio(안드로이드 SDK, JDK), USB 디버깅을 켠 폰

```powershell
cd mobile
npm run setup
```

`setup.ps1`은 `node_modules`, `package-lock.json`을 지우고 `package.json`에 고정한 버전(Expo SDK 57)으로 `npm install` 한 뒤 `npx expo install --check`로 버전을 확인한다.
마지막에 "설치 완료!"가 나오면 된다. 설치가 꼬였을 때도 이 명령을 다시 실행한다.

- Expo SDK 58은 `expo-share-intent`가 아직 지원하지 않는다. `npx expo install expo@latest`로 올리면 안 된다.
- `mobile/.env`의 `EXPO_PUBLIC_USE_RN_FETCH=1`은 사진 업로드에 필요하니 지우면 안 된다.

## 실행

1. PC에서 서버 켜기 (VeritAI 폴더에서 창을 따로 연다)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run_ai_server_retention_v2.ps1   # AI 서버 (8000)
cd backend\backend_spring; .\gradlew.bat bootRun                                    # 백엔드 (8080)
npm run dev:portal                                                                  # 포털, 웹 리포트 (5173)
```

2. 앱 설치, 실행 (폰 USB 연결 상태)

```powershell
cd mobile
npm run android
```

처음에는 안드로이드 빌드 때문에 몇 분 걸린다. 다음부터는 `npm start`로 코드만 다시 불러오면 된다.
개발용 빌드라서 PC의 Metro(`npm run android` 또는 `npm start` 창)가 켜져 있어야 앱 화면이 뜬다.

3. 포트 연결 (`npm run android` 다음에 다시)

`npm run android`가 기존 포트 연결을 지우기 때문에 빌드가 끝나면 다시 실행한다.

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb reverse tcp:8080 tcp:8080
& $adb reverse tcp:5173 tcp:5173
```

케이블 없이 연결하는 방법은 `변경점문서/Readme1022.md` 5-3 무선 디버깅 참고.

공유받기는 네이티브 설정이 필요해서 Expo Go 앱에서는 안 된다. `npm run android`로 설치한 앱을 써야 한다.

## 공유로 검사
- 갤러리, 스크린샷, 카카오톡 사진에서 공유 버튼으로 VeritAI를 고르면 미리보기 후 검사
- 인스타그램 게시물은 사진이 아니라 링크만 넘어온다. 이 경우 스크린샷을 찍어 공유하라고 안내한다.

## 배포
`src/config.js`의 `API_BASE`, `PORTAL_URL`을 https 서버 주소로 바꾼다.
