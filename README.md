# 🛡️ Deepfake Detection System

> 최신 폴더 구조와 실행 방법(크롬 확장, PWA, 앱, 서버)은 `변경점문서/Readme1022.md`를 참고하세요.
> **Capstone Design Project** > 브라우저 기반의 실시간 딥페이크 탐지 시스템 (Chrome Extension, Spring Boot, FastAPI)

# 현재 이파일을 그대로 크롬원격으로 실행시키려면 frontend file에 있는 파일을 밖으로 뺴내야 실행이 가능합니다. 확인부탁드립니다
# 사용방법
## Fork: 본 레포지토리를 개인 계정으로 Fork 합니다.
## Clone: Fork한 레포지토리를 로컬 환경에 Clone 합니다.
## Push: 완료된 코드를 본인의 Fork된 레포지토리에 Push 합니다.
## PR: 원본 레포지토리로 **Pull Request(PR)**를 생성
---

## 🏗️ System Architecture
* **`/extension`**: 사용자 브라우저 인터페이스 및 데이터 수집 (JS/TS)
* **`/backend-spring`**: 백엔드 로직 및 AI 요청 대기열 관리 (Java 21+)
* **`/ai-fastapi`**: 고성능 AI 모델 추론 서버 (Python 3.10+)

---

## 🤝 GitHub 협업 규칙 (Team Workflow)
우리 팀은 코드 안정성을 위해 **과반수 승인제(2명 승인)**를 채택합니다.

# 🛡️ Deepfake Detection System
> **Capstone Design Project** — 브라우저 기반의 실시간 딥페이크 탐지 시스템 (Chrome Extension, Spring Boot, FastAPI)

---

## 🏗️ System Architecture
- **`/extension`**: 사용자 브라우저 인터페이스 및 데이터 수집 (JS/TS)
- **`/backend-spring`**: 백엔드 로직 및 AI 요청 대기열 관리 (Java 21+)
- **`/ai-fastapi`**: 고성능 AI 모델 추론 서버 (Python 3.10+)

> 참고: 현재 이 파일을 그대로 크롬 확장(원격)으로 실행하려면 `frontend` 관련 파일들을 루트(또는 확장 패키지 구조)에 맞게 옮겨야 합니다. 저장소 구조에 따라 경로를 조정해 주세요.

---

## 🤝 GitHub 협업 규칙 (Team Workflow)
우리 팀은 코드 안정성을 위해 **과반수 승인제(2명 승인)**를 채택합니다.

### 1. 브랜치 전략 (Branch Strategy)
- **`main`**: 최종 배포용 브랜치 (**직접 Push 절대 금지 ❌**)
- **`feature/#이슈번호-기능명`**: 기능 개발용 작업 브랜치
  - 예: `feature/#1-ai-model-api`, `feature/#5-extension-ui`

### 2. 작업 순서 (Git Flow)
1. **Issue 생성**: GitHub Issues에서 작업 등록 후 번호 할당
2. **Local 작업**: 최신 `main`에서 브랜치 생성
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/#이슈번호-기능명
   ```

3. Commit & Push: 커밋 메시지에 이슈 번호 포함
   ```bash
   git add .
   git commit -m "feat: 딥페이크 탐지 API 연동 (#이슈번호)"
   git push origin feature/#이슈번호-기능명
   ```

4. PR 생성: Reviewers로 팀원 2명 지정

### 3. 병합 규칙 (Merge Policy)
- 승인 조건: 본인 제외 팀원 2명의 'Approve' 필수
- 충돌 해결: Conflict 발생 시 작업자가 직접 해결 후 Push
- 최종 병합: 승인 완료 후 PR 작성자가 Merge pull request 실행

📝 커밋 메시지 컨벤션 (Commit Convention)
|태그|설명|
|---|---|
|feat|새로운 기능 추가|
|fix|버그 수정|
|docs|문서 수정 (README 등)|
|style|코드 포맷팅 (로직 변경 없음)|
|refactor|코드 리팩토링|
|test|테스트 코드 추가|

# 🛠️ 개발 환경 세팅 (Development Setup)
## 🐍 AI Server (FastAPI)
```bash
cd ai-fastapi
python -m venv venv

# Windows
.\venv\Scripts\activate
# Mac/Linux
source venv/bin/activate

pip install -r requirements.txt
python main.py
```
## ☕ Backend Server (Spring Boot)
```bash
cd backend-spring

# Windows
./gradlew.bat bootRun

# Mac/Linux
./gradlew bootRun
```

