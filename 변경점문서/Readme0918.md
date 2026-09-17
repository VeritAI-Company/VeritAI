## 2026-09-18 프론트엔드 모듈화 및 최적화 요약

## 1. 기존 구조의 한계 (Baseline Limitations)

기존 확장 프로그램은 단일 content.js 파일에 모든 로직이 집중된 구조로 다음과 같은 한계가 있었다.
유지보수성 저하: 네트워크 통신, 화면 캡처, DOM 조작, UI 스타일링 로직이 한 곳에 섞여 있어 코드 가독성과 확장성이 떨어짐.
스타일 충돌 위험: 호스트 웹페이지의 CSS 규칙이 확장 프로그램 뱃지 UI에 영향을 줄 수 있는 잠재적 위험 존재.
모듈 번들러 부재: 최신 ES Modules 문법 활용 및 코드 압축(Minify), 난독화 적용이 어려움.

## 2. 주요 개선 및 모듈화 내역

아키텍처를 기능 단위로 분리하고, 안정성과 사용자 경험을 높이는 신규 기능들을 추가했다.
Vite 번들링 파이프라인 도입:
vite.config.js를 구성하여 ES Modules 환경 구축.
빌드 시 manifest.json 및 worker.js, offscreen.html을 dist/ 폴더로 자동 복사 및 압축(Minification) 적용.
관심사 분리 (모듈화):
config/constants.js: 환경변수 및 전역 상수 통합.
core/network.js: 백엔드 폴링 로직 및 Fetch API 캡슐화.
core/capture.js: Offscreen API 및 캔버스 기반 미디어 캡처 로직 분리.
ui/styles.js: 뱃지 및 모달 UI 스타일시트 격리.
Shadow DOM 기반 UI 격리:
veritai-host 커스텀 태그와 Shadow DOM을 도입하여 호스트 페이지의 CSS와 완벽히 독립된 렌더링 환경 구축.


## 3. 확장 프로그램 Smoke 검증

모듈화된 프론트엔드 단독 기능 및 백엔드 연동에 대한 Smoke 테스트를 진행했다.
Vite 프로덕션 빌드 산출물 생성 (dist/): OK
Offscreen API 기반 백그라운드 이미지 캡처/리사이징: OK
Shadow DOM 렌더링 및 클린 모드 상태 동기화: OK
Spring -> FastAPI 연동 결과 수신 후 폴링(Polling) UI 반영: OK
결과적으로 번들링 에러나 모듈 간 참조 오류 없이 안정적으로 구동됨을 확인했다.
결론
ES 모듈 기반으로 분리된 프론트엔드 코드베이스와 Vite 번들러 파이프라인은 즉시 운영(Production) 적용 가능한 상태로 판단한다.


## 적용 방법 (Vite 기반 빌드)
프론트엔드 적용 및 실행은 로컬 코드베이스 변경이 수반되므로 아래의 Vite 빌드 파이프라인을 거쳐 크롬 브라우저에 적용한다.

# 1. 의존성 패키지 설치 (최초 1회)
npm install

# 2. Vite 프로덕션 빌드 실행 (dist 폴더 생성)
npm run build

## 크롬 브라우저 로드 방법:
크롬 주소창에 chrome://extensions/ 입력.
우측 상단 [개발자 모드] 활성화.
좌측 상단 [압축 해제된 확장 프로그램을 로드합니다] 클릭.
빌드된 프로젝트 내의 dist 폴더 선택.

## 롤백
문제가 발생할 경우, 빌드 디렉토리를 삭제하고 이전 커밋 상태로 되돌린다.

# 1. 이전 안정화 커밋(단일 스크립트 버전)으로 하드 리셋
git reset --hard <이전_단일스크립트_커밋_해시>

# 2. 캐시 및 빌드 폴더 정리
rm -rf dist node_modules
