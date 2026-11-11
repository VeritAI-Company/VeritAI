# VeritAI

웹과 모바일에서 접한 이미지와 영상 장면의 딥페이크 가능성을 확인하는 서비스 (캡스톤 디자인 프로젝트)

- 크롬 확장: 보던 페이지에서 사진과 영상 장면을 바로 검사
- PWA와 안드로이드 앱: 모바일에서 사진을 고르거나 찍고, 영상은 장면을 골라 검사
- 결과: 판정, 조작 확률, 얼굴 위치 박스, 모델이 반응한 위치(히트맵), 오답 신고

## 폴더 구성

| 폴더 | 내용 |
|---|---|
| `frontend/` | 크롬 확장 (Manifest V3) |
| `portal/` | PWA (모바일 웹, 앱의 웹 리포트 화면) |
| `mobile/` | 안드로이드 앱 (Expo SDK 57, React Native) |
| `shared/` | 확장과 PWA가 함께 쓰는 판정 기준, API 값, 기록 삭제, 히트맵과 단위 테스트 |
| `backend/backend_spring/` | 백엔드 (Spring Boot, JDK 25): 접수 번호 발급, 작업 큐, 결과 조회, 기록 삭제 |
| `ai/` | AI 서버 (FastAPI): 얼굴 검출(YuNet, MediaPipe), 얼굴별 판별(EfficientNet-B4), 히트맵(Grad-CAM) |
| `test/e2e/` | 브라우저 테스트 (Playwright, 가짜 서버) |
| `scripts/` | 서버 실행과 점검 스크립트 |
| `변경점문서/` | 날짜별 변경 내용과 상세 설명 |

## 동작 흐름

1. 확장, PWA, 앱이 사진(영상은 고른 장면 한 장)을 긴 변 1280px, JPEG 0.92로 줄여 백엔드로 보낸다
2. 백엔드가 접수 번호를 먼저 돌려주고, 작업 큐에서 AI 서버를 호출한다
3. AI 서버가 얼굴을 찾아 얼굴별로 판별한다. 얼굴이 없거나 모두 분석에서 빠지면 전체 이미지 한 장으로 판정한다
4. 프론트가 접수 번호로 결과를 조회해 판정, 확률, 얼굴 박스, 히트맵을 보여 준다

## 실행 (Windows PowerShell, 저장소 루트 기준)

| 대상 | 명령 |
|---|---|
| AI 서버 (8000) | `cd ai`, `.\venv\Scripts\activate`, `python main.py` |
| 백엔드 (8080) | `cd backend\backend_spring`, `.\gradlew.bat bootRun` |
| 크롬 확장 | `npm run build` 후 `chrome://extensions`에서 `dist` 폴더 불러오기 |
| PWA (5173) | `npm run dev:portal` |
| 앱 | `cd mobile`, `npm run setup`, `adb reverse tcp:8081 tcp:8081`, `adb reverse tcp:8080 tcp:8080`, `adb reverse tcp:5173 tcp:5173`, `npm start` |

- 환경: Python 3.12, JDK 25, Node.js. 라이브러리는 `ai/requirements.txt`로만 설치한다
- 서버 주소는 루트 `.env`의 `VITE_API_BASE`와 `mobile/.env`로 정하며, 없으면 모두 `localhost`를 쓴다
- 앱 개발용 빌드는 PC의 Metro와 USB 연결이 필요하다. 자세한 내용은 `mobile/README.md`
- 처음 설치와 실행 순서, AI 모델이 안 돌 때(Visual C++ 확인)는 `변경점문서/프론트엔드 정리.md`의 10장

## 테스트

| 종류 | 명령 | 비고 |
|---|---|---|
| 단위 | `npm run test:frontend` | 웹과 앱의 판정 기준 일치, 확률 표시, 영상과 작은 사진 처리 등 |
| 브라우저 | `npm run test:e2e` | 확장과 PWA를 실제 브라우저로 실행. 8080과 8000 포트가 비어 있어야 함. 자세한 내용은 `test/e2e/README.md` |

## 문서

- `변경점문서/프론트엔드 정리.md`: 프론트 전체 구조와 채널별 기능
- `변경점문서/프론트엔드 핵심 기능.md`: 핵심 기능과 품질 검증 요약
- `변경점문서/Readme1029.md`: 히트맵 설명
- `변경점문서/Readme1111.md`: 가장 최근 변경 내용

## 협업 규칙

- 브랜치: `main`에는 직접 push하지 않는다. 작업은 `feature/이름` 브랜치에서 한다
- 순서: 최신 `main`에서 브랜치 생성, 커밋, push, PR 생성 후 팀원 2명을 리뷰어로 지정
- 병합: 본인을 뺀 팀원 2명이 Approve하면 PR 작성자가 병합한다. 충돌은 작업자가 해결한다
- 커밋 메시지: 아래 태그 뒤에 한국어로 요약한다

| 태그 | 설명 |
|---|---|
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서 수정 |
| `refactor` | 코드 정리 (동작 변경 없음) |
| `test` | 테스트 추가와 수정 |
