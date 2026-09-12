유지하는 것:

바닐라 JS 기반의 돔(DOM) 변화 감지(MutationObserver) 및 상태 캐싱(scanCache) 아키텍처.
클린 모드(정상 배지 자동 숨김) 및 호버(Hover) 기반의 팝업 모달 UX.

변경점:

스텔스 판독 샌드박스: 평소엔 반투명 미니 로고로 숨겨두고, 파일을 드래그할 때만 전체 화면 방어막 샌드박스로 전환시켜 구글 렌즈 동작을 원천 차단한다.

우클릭 메뉴 & 독립 뷰어 탑재: 크롬 네이티브 우클릭 메뉴(Context Menu)를 추가하고, 웹페이지 돔 외곽에 있는 미디어(로컬/배경 파일)는 화면 중앙에 독립 모달(Standalone Modal) 시어터를 생성하여 검사한다.

강제 검사(Force Inspect) 권한 허용: 전원이 꺼져 있어도 수동으로 명령된 대상에는 dataset.forceInspect = "true"를 부여하여 전원 차단 방어막을 뚫고 즉시 검사를 진행하도록 허용한다.


manifest.json 변경점:

우클릭 메뉴 생성을 위해 permissions 배열에 "contextMenus" 권한을 추가했다.  

background.js 변경점:

chrome.runtime.onInstalled 이벤트에서 "contextMenus"를 생성("🔍 VeritAI로 조작 정밀 검사")했다.  
우클릭 메뉴 클릭 시 현재 탭의 content.js로 context_menu_inspect 메시지와 타겟 미디어의 srcUrl을 전송하도록 연동했다.  

content.js변경점: 

샌드박스 주입 (injectDropzone): 우측 하단 미니 힌트(#veritai-mini-hint)와 전체 화면 래퍼(#veritai-dropzone-wrapper)를 도입했다. e.stopPropagation()을 적용해 브라우저 드래그 이벤트를 독점한다.  

독립 모달 (analyzeStandaloneMedia): 화면 정중앙에 단독 영상/이미지를 띄우는 가상 컨테이너(.veritai-standalone-modal)를 생성하고 startInspection을 직접 트리거한다.  

전원 예외 처리 (startInspection, updateStatusBadge): !isSystemOn && media.dataset.forceInspect !== "true" 조건을 추가하여, 강제 검사 대상은 전원이 꺼져있어도 배지 업데이트와 서버 전송 로직이 돌게 변경했다.  

폴링 대기열 정리 (chrome.storage.onChanged): 전원 스위치가 꺼질 때 pendingDetectionPolls.forEach(entry => entry.reject(...))를 호출하여 불필요한 백엔드 API 상태 조회 낭비를 막았다.  