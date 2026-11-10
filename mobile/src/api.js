import { API_BASE, CLIENT_TYPE } from './config';
import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_MESSAGE, INVALID_RESULT_CODE, INVALID_RESULT_MESSAGE, aiUnavailableDetail, isAiUnavailable, isValidResult } from './judgment';
import { getOwnerToken, rememberRequestId } from './records';

// 요청 간격과 시간 제한은 웹의 shared/api.js와 같은 값이다 (앱은 빌드 구조상 그 파일을 가져올 수 없다)

const DETECTIONS_URL = `${API_BASE}/api/detections`;
const UPLOAD_TIMEOUT_MS = 20000;
const POLL_INITIAL_INTERVAL_MS = 300;
const POLL_MAX_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180000;
export const POLL_MAX_RETRIES = 3;

// shared/api.js의 isRetryablePollStatus와 같다 (테스트가 검사)
export function isRetryablePollStatus(status) {
    const value = Number(status) || 0;
    return value < 400 || value === 408 || value === 429 || value >= 500;
}

// 사진을 다시 압축할 때의 기준 (shared/api.js의 UPLOAD_* 와 같은 값, 테스트가 검사)
export const UPLOAD_MAX_SIDE = 1280;
export const UPLOAD_IMAGE_TYPE = 'image/jpeg';
export const UPLOAD_IMAGE_QUALITY = 0.92;
export const MIN_IMAGE_SIDE = 80; // 짧은 변이 이보다 작은 사진은 검사하지 않는다 (shared/api.js와 같은 값, 테스트가 검사)

export class ApiError extends Error {
    constructor(message, status = 0) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithTimeout(url, options = {}, timeoutMs = UPLOAD_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        const detail = `${err?.name || 'Error'}: ${err?.message || String(err)}`;
        console.warn('[VeritAI] 요청 실패:', options.method || 'GET', url, detail);
        const apiErr = err?.name === 'AbortError'
            ? new ApiError('응답 시간이 초과되었습니다.', 408)
            : new ApiError('서버에 연결할 수 없습니다.', 0);
        apiErr.detail = detail;
        apiErr.url = url;
        throw apiErr;
    } finally {
        clearTimeout(timer);
    }
}

async function readJson(response) {
    try { return await response.json(); } catch { return null; }
}

export async function requestDetection(media, onStatus = () => {}) {
    const formData = new FormData();
    // React Native의 FormData는 { uri, name, type } 객체로 파일을 보낸다
    formData.append('file', { uri: media.uri, name: 'capture.jpg', type: 'image/jpeg' });
    formData.append('mediaType', media.mediaType || 'image');
    formData.append('clientType', CLIENT_TYPE);
    formData.append('analysisMode', 'face_crop_only');
    formData.append('ownerToken', await getOwnerToken()); // 나중에 내 기록을 지울 수 있도록 함께 보낸다

    const response = await fetchWithTimeout(DETECTIONS_URL, { method: 'POST', body: formData });
    const data = await readJson(response);
    if (!response.ok && response.status !== 202) {
        const apiErr = new ApiError(data?.message || '분석 요청에 실패했습니다.', response.status);
        apiErr.detail = `HTTP ${response.status}${data?.message ? ` · ${data.message}` : ''}`;
        apiErr.url = DETECTIONS_URL;
        throw apiErr;
    }
    if (!data) throw new ApiError('서버 응답을 읽을 수 없습니다.', response.status);
    if (data.requestId != null) await rememberRequestId(data.requestId);

    if (data.status === 'DONE' && data.result) return ensureAiResult(data);
    if (data.status === 'FAILED') throw new ApiError(data.message || '분석에 실패했습니다.', 500);
    if ((data.status === 'QUEUED' || data.status === 'PROCESSING') && data.requestId != null) {
        onStatus(data.status);
        return ensureAiResult(await pollDetection(data.requestId, data.retryAfterMs, onStatus));
    }
    throw new ApiError(data.message || '분석이 정상적으로 완료되지 않았습니다.', 500);
}

async function pollDetection(requestId, firstDelayMs, onStatus) {
    const startedAt = Date.now();
    let delayMs = clampDelay(firstDelayMs) ?? POLL_INITIAL_INTERVAL_MS;
    let failures = 0;
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await delay(delayMs);
        let data;
        try {
            data = await fetchDetection(requestId);
        } catch (err) {
            // 휴대폰 연결이 잠깐 끊겨도 연속 POLL_MAX_RETRIES 번까지는 다시 묻는다
            failures += 1;
            if (isRetryablePollStatus(err?.status) && failures < POLL_MAX_RETRIES) {
                delayMs = POLL_MAX_INTERVAL_MS;
                continue;
            }
            throw err;
        }
        failures = 0;
        if (data.status === 'DONE' && data.result) return data;
        if (data.status === 'FAILED') throw new ApiError(data.message || '분석에 실패했습니다.', 500);
        onStatus(data.status);
        delayMs = clampDelay(data.retryAfterMs) ?? Math.min(POLL_MAX_INTERVAL_MS, Math.round(delayMs * 1.25));
    }
    throw new ApiError('분석 시간이 너무 오래 걸립니다.', 408);
}

export async function fetchDetection(requestId) {
    const response = await fetchWithTimeout(`${DETECTIONS_URL}/${encodeURIComponent(requestId)}`);
    const data = await readJson(response);
    if (!response.ok || !data) {
        const apiErr = new ApiError(data?.message || '결과를 불러오지 못했습니다.', response.status);
        apiErr.detail = `HTTP ${response.status}${data?.message ? ` · ${data.message}` : ''}`;
        apiErr.url = `${DETECTIONS_URL}/${requestId}`;
        throw apiErr;
    }
    return data;
}

// AI 모델이 돌지 않은 결과는 서버가 '확률 0%, 정상'으로 채워 보내므로 결과로 쓰지 않고 오류로 바꾼다
export function ensureAiResult(data) {
    if (isAiUnavailable(data?.result)) {
        const apiErr = new ApiError(AI_UNAVAILABLE_MESSAGE, 503);
        apiErr.code = AI_UNAVAILABLE_CODE;
        apiErr.detail = `AI 서버의 모델이 준비되지 않았습니다 · ${aiUnavailableDetail(data.result)}`;
        throw apiErr;
    }
    if (!isValidResult(data?.result)) {
        const apiErr = new ApiError(INVALID_RESULT_MESSAGE, 502);
        apiErr.code = INVALID_RESULT_CODE;
        apiErr.detail = `결과 형식 오류 · ${JSON.stringify(data?.result ?? null).slice(0, 200)}`;
        throw apiErr;
    }
    return data;
}

function clampDelay(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.min(POLL_MAX_INTERVAL_MS, Math.max(POLL_INITIAL_INTERVAL_MS, value));
}

export function toErrorDetail(err) {
    if (!err) return '';
    const lines = [];
    if (err.detail) lines.push(err.detail);
    else if (err.message) lines.push(err.message);
    if (err.url) lines.push(err.url);
    return lines.join('\n');
}

export function toFriendlyMessage(err) {
    if (err?.code === AI_UNAVAILABLE_CODE) return AI_UNAVAILABLE_MESSAGE;
    if (err?.code === INVALID_RESULT_CODE) return INVALID_RESULT_MESSAGE;
    const status = err?.status ?? 0;
    if (status === 0) {
        // 개발용 안내(adb reverse)는 개발 빌드에서만 보여 준다
        return __DEV__
            ? '서버에 연결할 수 없습니다.\nPC에서 백엔드가 켜져 있는지, adb reverse tcp:8080 tcp:8080 을 했는지 확인해 주세요.'
            : '서버에 연결할 수 없습니다.\n인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.';
    }
    if (status === 429) return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
    if (status === 408) return '응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.';
    if (status === 400 || status === 415) return '지원하지 않는 이미지입니다. 다른 사진으로 시도해 주세요.';
    if (status === 404) return '검사 기록을 서버에서 찾을 수 없습니다. (서버가 재시작되면 기록이 사라질 수 있습니다)';
    if (status >= 500) return '서버에서 분석 중 오류가 발생했습니다.';
    return err?.message || '분석에 실패했습니다.';
}
