// 분석 서버 주소: 프로젝트 루트 .env 의 VITE_API_BASE (vite.portal.config.js 의 envDir). 없으면 내 컴퓨터(localhost:8080)
import { ANALYSIS_MODE, POLL_INITIAL_INTERVAL_MS, POLL_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, apiUrls, clampPollDelay, nextPollDelay } from '../shared/api.js';

const { detections: DETECTIONS_URL, feedback: FEEDBACK_URL } = apiUrls(import.meta.env?.VITE_API_BASE ?? 'http://localhost:8080');

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
        if (err.name === 'AbortError') throw new ApiError('응답 시간이 초과되었습니다.', 408);
        throw new ApiError('서버에 연결할 수 없습니다.', 0);
    } finally {
        clearTimeout(timer);
    }
}

async function readJson(response) {
    try { return await response.json(); } catch { return null; }
}

export async function requestDetection(blob, onStatus = () => {}) {
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const formData = new FormData();
    formData.append('file', blob, `capture.${ext}`);
    formData.append('mediaType', 'image');
    formData.append('clientType', 'pwa-portal');
    formData.append('analysisMode', ANALYSIS_MODE);

    const response = await fetchWithTimeout(DETECTIONS_URL, { method: 'POST', body: formData });
    const data = await readJson(response);

    if (!response.ok && response.status !== 202) {
        throw new ApiError(data?.message || '분석 요청에 실패했습니다.', response.status);
    }
    if (!data) throw new ApiError('서버 응답을 읽을 수 없습니다.', response.status);

    return handleDetectionPayload(data, onStatus);
}

async function handleDetectionPayload(data, onStatus) {
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
    let delayMs = clampPollDelay(firstDelayMs) ?? POLL_INITIAL_INTERVAL_MS;

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await delay(delayMs);
        const response = await fetchWithTimeout(`${DETECTIONS_URL}/${encodeURIComponent(requestId)}`);
        const data = await readJson(response);
        if (!response.ok || !data) {
            throw new ApiError(data?.message || '분석 상태를 확인하지 못했습니다.', response.status);
        }

        if (data.status === 'DONE' && data.result) return data;
        if (data.status === 'FAILED') throw new ApiError(data.message || '분석에 실패했습니다.', 500);

        onStatus(data.status);
        delayMs = clampPollDelay(data.retryAfterMs) ?? nextPollDelay(delayMs);
    }
    throw new ApiError('분석 시간이 너무 오래 걸립니다.', 408);
}

export async function sendFeedback(requestId, reason) {
    const response = await fetchWithTimeout(FEEDBACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, reportedAt: new Date().toISOString(), reason })
    });
    if (!response.ok) {
        const data = await readJson(response);
        throw new ApiError(data?.message || '신고 전송에 실패했습니다.', response.status);
    }
}

export function toFriendlyMessage(err) {
    const status = err?.status ?? 0;
    if (status === 0) return import.meta.env?.DEV ? '서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해 주세요.' : '서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.';
    if (status === 429) return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
    if (status === 408) return '응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.';
    if (status === 400 || status === 415) return '지원하지 않는 이미지입니다. 다른 사진으로 시도해 주세요.';
    if (status >= 500) return '서버에서 분석 중 오류가 발생했습니다.';
    return err?.message || '분석에 실패했습니다.';
}
