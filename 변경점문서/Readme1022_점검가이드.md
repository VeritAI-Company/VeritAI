# 10-22 점검 순서 (프론트엔드)

## 1. 준비
- [ ] VS Code를 껐다 켠다 (`ANDROID_HOME` 반영)
- [ ] 루트에서 설치, 빌드
  ```powershell
  cd C:\Users\VeritAI
  npm install
  npm run build
  ```
- [ ] `chrome://extensions`에서 확장 새로고침, 열어 둔 웹페이지도 새로고침

## 2. 서버
- [ ] AI 서버: `powershell -ExecutionPolicy Bypass -File scripts\run_ai_server_retention_v2.ps1` (이미 켜져 있으면 `netstat -ano | findstr :8000`으로 확인)
- [ ] 백엔드: `cd backend\backend_spring` 후 `.\gradlew.bat bootRun`
- [ ] 포털: `npm run dev:portal`, PC에서 `http://127.0.0.1:5173` 열리는지 확인

## 3. 크롬 확장
- [ ] 사진 검사 버튼: 대기 중, 분석 중, 결과 배지 순서로 바뀜
- [ ] 리포트: 얼굴 박스가 실제 얼굴 위치에 그려짐 (작은 사진, 큰 사진 2~3장)
- [ ] 히트맵: "AI 분석 근거 보기"로 얼굴 위에 겹치고 슬라이더로 투명도 조절됨
- [ ] 신고: 이유 입력 후 제출하면 접수 문구가 뜸
- [ ] 영상 검사: 리포트에 검사한 장면과 얼굴 박스, "검사 장면: 영상 0:03 지점" 표시
- [ ] 영상 다시 검사: 몇 초 뒤 "현재 장면 다시 검사"를 누르면 ID와 장면, 시간이 바뀜
- [ ] 영상 우클릭 "VeritAI로 조작 정밀 검사"도 같은 동작
- [ ] 드래그: 사진 파일을 오른쪽 아래 드래그 영역에 놓으면 큰 창에서 검사됨
- [ ] 자동 모드: 화면에 보이는 사진이 차례로 검사되고 버튼과 배지가 같이 뜨는 사진이 없음
- [ ] 클린 모드: 켜면 정상 배지가 사라지고, 끄면 다시 보임
- [ ] 캐시 비우기: 팝업에 안내 문구가 뜨고 드래그 영역이 그대로 남음, 드래그 다시 해 보기
- [ ] 캐시 비우기를 `chrome://extensions` 탭에서 누르면 "이 페이지에서는 사용할 수 없습니다."
- [ ] 백엔드를 잠깐 끄고 검사하면 오류 배지와 재시도, 백엔드를 켜고 재시도하면 정상 결과
- [ ] 팝업의 건의 및 버그 제보 버튼
- [ ] 조작 의심 배지가 있을 때 Alt+V로 이동, Esc로 리포트 닫힘

## 4. 모바일 웹 PWA
- [ ] 폰 연결 (USB 또는 무선 디버깅, `Readme1022.md` 5-3)
  ```powershell
  $adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
  & $adb devices
  & $adb reverse tcp:8080 tcp:8080
  & $adb reverse tcp:5173 tcp:5173
  ```
- [ ] 폰 크롬 `http://localhost:5173`에서 사진 선택, 미리보기, 검사, 결과
- [ ] 얼굴 박스, 히트맵, 신고
- [ ] 홈 화면에 추가 후 아이콘으로 실행

## 5. React Native 앱
- [ ] `cd mobile` 후 `npm start` (처음이거나 app.json, 라이브러리를 바꿨으면 `npm run android`)
- [ ] `npm run android`를 했으면 `adb reverse` 8080, 5173 다시
- [ ] 사진 찍기 또는 갤러리, 미리보기, 검사, 결과
- [ ] 분석 중에 뒤로 가기를 눌러도 앱이 꺼지지 않음
- [ ] 갤러리, 카톡 사진을 공유 버튼으로 VeritAI에 보내서 검사
- [ ] 갤러리 영상: 시간 버튼으로 장면을 바꿔 검사, 결과에서 "같은 영상의 다른 장면 검사"
- [ ] "자세한 리포트 보기"에서 얼굴 박스, 히트맵, 신고 (포털이 켜져 있어야 함)
- [ ] 홈 "최근 검사 기록"에 결과가 있고 누르면 다시 열림

## 6. 막히면
- 확장 수정이 반영 안 됨: `npm run build`, 확장 새로고침, 페이지 새로고침
- 앱만 서버 연결 안 됨: `adb reverse` 다시, `mobile/.env` 확인
- 폰에서 포털이 깨짐: 포털을 `npm run dev:portal`로 다시 실행
- 사진에 버튼이 안 뜸: 광고, 배너 영역일 수 있으니 다른 사진으로
