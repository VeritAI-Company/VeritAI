// 분석 서버 요청 공통 값과 도우미
// 크롬 확장(frontend)과 PWA(portal)가 함께 쓴다. 앱(mobile)은 빌드 구조상 이 파일을 가져올 수 없어 mobile/src/api.js에 같은 값을 둔다.

export const ANALYSIS_MODE = 'face_crop_only'; // 얼굴을 잘라서 검사하는 모드 (세 채널 모두 같은 값)

export const UPLOAD_TIMEOUT_MS = 20000;       // 사진 보내기 시간 제한
export const POLL_INITIAL_INTERVAL_MS = 300;  // 결과를 처음 물어보는 간격
export const POLL_MAX_INTERVAL_MS = 2000;     // 결과를 물어보는 가장 긴 간격
export const POLL_TIMEOUT_MS = 180000;        // 결과를 기다리는 최대 시간 (3분)
export const POLL_MAX_RETRIES = 3;            // 결과 조회가 연속으로 이만큼 실패하면 포기한다 (그 전에는 다시 묻는다)

// 결과 조회 실패 가운데 다시 물어볼 만한 것: 연결 실패(0), 응답은 왔지만 읽지 못함(2xx), 시간 초과, 요청 과다, 서버 오류.
// 404(서버 재시작으로 기록 없음) 같은 나머지 4xx는 다시 물어도 같으니 바로 실패로 본다
export function isRetryablePollStatus(status) {
    const value = Number(status) || 0;
    return value < 400 || value === 408 || value === 429 || value >= 500;
}

// 사진을 다시 압축할 때의 기준. 채널마다 압축 흔적이 달라지지 않게 세 채널이 같은 값을 쓴다
// mobile/src/api.js와 frontend/worker.js에도 같은 값이 있고, 테스트가 같은지 검사한다
export const UPLOAD_MAX_SIDE = 1280;           // 긴 변 최대 길이(px)
export const UPLOAD_IMAGE_TYPE = 'image/jpeg'; // 다시 압축할 때 형식
export const UPLOAD_IMAGE_QUALITY = 0.92;      // 다시 압축할 때 품질

export function apiUrls(base) {
    const root = String(base).replace(/\/$/, '');
    return { detections: `${root}/api/detections`, feedback: `${root}/api/feedback`, queue: `${root}/api/detections/queue` };
}

export const SERVER_CHECK_TIMEOUT_MS = 4000;
export const AI_STATUS_FRESH_MS = 30 * 60 * 1000; // 30분이 지난 AI 실패 기록은 지금 상태로 보지 않는다

// 서버 대기열 정보(/api/detections/queue)와 최근 AI 판정 실패 여부로 상태 문구를 정한다. metrics가 null이면 연결 실패
// 확장 팝업(frontend/popup.js)에도 같은 문구가 있다 (팝업은 빌드 구조상 이 파일을 가져오지 않는다)
export function describeServerStatus(metrics, recentAiFailure = false) {
    if (!metrics) return { level: 'error', text: '분석 서버에 연결할 수 없습니다' };
    if (metrics.running === false) return { level: 'warn', text: '분석 서버가 검사를 멈췄습니다' };
    if (recentAiFailure) return { level: 'warn', text: '서버 연결됨 · 최근 AI 판정 실패' };
    const queued = Number(metrics.queuedCount) || 0;
    return { level: 'ok', text: queued > 0 ? `분석 서버 연결됨 · 대기 ${queued}건` : '분석 서버 연결됨' };
}

// 서버가 알려 준 대기 시간을 허용 범위 안으로 맞춘다. 값이 없거나 잘못되면 null
export function clampPollDelay(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.min(POLL_MAX_INTERVAL_MS, Math.max(POLL_INITIAL_INTERVAL_MS, value));
}

// 결과가 아직이면 다음에 물어볼 때까지 조금씩 더 기다린다 (최대 POLL_MAX_INTERVAL_MS)
export function nextPollDelay(previousMs) {
    return Math.min(POLL_MAX_INTERVAL_MS, Math.round(previousMs * 1.25));
}
