1. 메모리 누수 방지 및 아키텍처 최적화

1.1. 인라인 CSS 전면 분리 (성능/가독성 향상): 
자바스크립트 코드 내부에 btn.style.cssText, detailsBox.style.cssText 등 방대한 양의 CSS가 하드코딩되어 코드 용량이 크고 관리가 어려웠습니다.  
NEW: injectCSS() 함수를 신설하여 <style id="veritai-style-core"> 태그로 핵심 CSS를 document.head에 단 한 번만 주입하도록 분리했습니다. 
이후 UI 요소들은 className(veritai-check-btn, veritai-details-box 등)만 토글하도록 구조를 획기적으로 개선했습니다.  

1.2. DOM Observer 메모리 해제 로직 추가
화면에 새로운 이미지가 추가되는 것(addedNodes)만 감시하고, 화면에서 지워지는 이미지는 관리하지 않았습니다.  
NEW: domObserver에 removedNodes 감시 로직을 추가하여, 화면에서 미디어 노드가 삭제될 경우 scannedMediaKeys.delete(key)를 호출해 추적 메모리를 즉시 반환하도록 개선했습니다.  

1.3. 비디오 캡처 중복 코드 버그 수정 및 GC 유도
captureVideoBlob 함수 내에서 canvas.toBlob이 불필요하게 2번 연속 복사되어 실행되는 경우 존재했습니다.  
NEW: 중복 코드를 하나로 정리하고, 캡처 직후 canvas.width = 0; canvas.height = 0; 코드를 명시하여 브라우저 가비지 컬렉터(GC)가 즉시 캔버스 메모리를 청소할 수 있도록 유도했습니다.  

1.4. LRU 캐시 함수 실제 적용
getFromCache, setToCache 함수를 정의해두었으나, 정작 캐시를 쓰고 읽을 때는 기존의 scanCache.get(), scanCache.set()을 직접 호출해 LRU 최신화가 작동하지 않았습니다.  
NEW: startInspection과 attachUI 함수 내부에서 캐시를 다루는 모든 부분을 getFromCache와 setToCache로 교체하여 500개 초과 시 오래된 캐시가 정상적으로 삭제되도록 연동했습니다.  

2. UI/UX 및 상호작용 개선

2.1. 결과 판정 글로우(Glow) 효과 추가
딥페이크 의심 판정 시 단순한 붉은색 테두리(border)만 표시되었고, 정상 판정 뱃지는 투명도가 낮아 눈에 잘 띄지 않았습니다.  
NEW (조작 의심): 직관적인 🚨 이모지를 텍스트에 추가하고, 강렬한 붉은색 빛 번짐을 주어 경고 효과를 극대화했습니다.  
NEW (정상): 뱃지 투명도를 0.85로 올려 명시성을 높이고, 검사 완료 직후 1.5초 동안만 초록색 빛 번짐 효과가 나타났다 스르륵 사라지도록 전환 효과(transition)를 넣어 시청을 방해하지 않는 깔끔한 피드백을 완성했습니다.  



08.21 추가


1. CPU 부하 획기적 감소 (Debouncing 최적화)
`MutationObserver`에 150ms 디바운싱(Debouncing) 알고리즘을 도입. 변경된 DOM 노드들을 Queue에 모아두었다가 렌더링이 안정화되었을 때 일괄 처리(Batch Processing)하여 브라우저 버벅임 완화.

2. UI/UX 응답성 강화 및 렌더링 충돌 제거
'대기 중(Waiting)' 렌더링 분리: 대기열(Queue)에 들어간 미디어가 멈춘 것처럼 보이지 않도록 `대기 중...` 상태를 추가하여 사용자 인지성 강화.
Limbo State(좀비 배지) 해결: 스캔 도중 시스템 전원을 끄거나 모드를 전환할 경우, 기존에 실행 중이던 대기열을 즉시 `reject` 시키고 남은 렌더링 컴포넌트를 강제 초기화하여 UI 겹침 버그 차단.