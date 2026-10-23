import { API_BASE, CLIENT_TYPE } from './config';

const DETECTIONS_URL = `${API_BASE}/api/detections`;
const UPLOAD_TIMEOUT_MS = 20000;
const POLL_INITIAL_INTERVAL_MS = 300;
const POLL_MAX_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180000;

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
    // React Native 의 FormData 는 { uri, name, type } 객체로 파일을 보냅니다.
    formData.append('file', { uri: media.uri, name: 'capture.jpg', type: 'image/jpeg' });
    formData.append('mediaType', media.mediaType || 'image');
    formData.append('clientType', CLIENT_TYPE);
    formData.append('analysisMode', 'face_crop_only');

    const response = await fetchWithTimeout(DETECTIONS_URL, { method: 'POST', body: formData });
    const data = await readJson(response);
    if (!response.ok && response.status !== 202) {
        const apiErr = new ApiError(data?.message || '분석 요청에 실패했습니다.', response.status);
        apiErr.detail = `HTTP ${response.status}${data?.message ? ` · ${data.message}` : ''}`;
        apiErr.url = DETECTIONS_URL;
        throw apiErr;
    }
    if (!data) throw new ApiError('서버 응답을 읽을 수 없습니다.', response.status);

    if (data.status === 'DONE' && data.result) return data;
    if (data.status === 'FAILED') throw new ApiError(data.message || '분석에 실패했습니다.', 500);
    if ((data.status === 'QUEUED' || data.status === 'PROCESSING') && data.requestId != null) {
        onStatus(data.status);
        return pollDetection(data.requestId, data.retryAfterMs, onStatus);
    }
    throw new ApiError(data.message || '분석이 정상적으로 완료되지 않았습니다.', 500);
}

async function pollDetection(requestId, firstDelayMs, onStatus) {
    const startedAt = Date.now();
    let delayMs = clampDelay(firstDelayMs) ?? POLL_INITIAL_INTERVAL_MS;
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await delay(delayMs);
        const data = await fetchDetection(requestId);
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
    const status = err?.status ?? 0;
    if (status === 0) return '서버에 연결할 수 없습니다.\nPC에서 백엔드가 켜져 있는지, adb reverse tcp:8080 tcp:8080 을 했는지 확인해 주세요.';
    if (status === 429) return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
    if (status === 408) return '응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.';
    if (status === 400 || status === 415) return '지원하지 않는 이미지입니다. 다른 사진으로 시도해 주세요.';
    if (status === 404) return '검사 기록을 서버에서 찾을 수 없습니다. (서버가 재시작되면 기록이 사라질 수 있습니다)';
    if (status >= 500) return '서버에서 분석 중 오류가 발생했습니다.';
    return err?.message || '분석에 실패했습니다.';
}
