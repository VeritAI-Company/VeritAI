// 분석 서버 요청 공통 값과 도우미
// 크롬 확장(frontend)과 PWA(portal)가 함께 쓴다. 앱(mobile)은 빌드 구조상 이 파일을 가져올 수 없어 mobile/src/api.js에 같은 값을 둔다.

export const ANALYSIS_MODE = 'face_crop_only'; // 얼굴을 잘라서 검사하는 모드 (세 채널 모두 같은 값)

export const UPLOAD_TIMEOUT_MS = 20000;       // 사진 보내기 시간 제한
export const POLL_INITIAL_INTERVAL_MS = 300;  // 결과를 처음 물어보는 간격
export const POLL_MAX_INTERVAL_MS = 2000;     // 결과를 물어보는 가장 긴 간격
export const POLL_TIMEOUT_MS = 180000;        // 결과를 기다리는 최대 시간 (3분)

// 서버 기본 주소로 API 주소 만들기
export function apiUrls(base) {
    const root = String(base).replace(/\/$/, '');
    return { detections: `${root}/api/detections`, feedback: `${root}/api/feedback` };
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
