// 분석 서버 주소: 프로젝트 루트 .env 의 VITE_API_BASE (vite.portal.config.js 의 envDir). 없으면 내 컴퓨터(localhost:8080)
import { AI_STATUS_FRESH_MS, ANALYSIS_MODE, POLL_INITIAL_INTERVAL_MS, POLL_MAX_INTERVAL_MS, POLL_MAX_RETRIES, POLL_TIMEOUT_MS, SERVER_CHECK_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, apiUrls, clampPollDelay, describeServerStatus, isRetryablePollStatus, nextPollDelay } from '../shared/api.js';
import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_MESSAGE, INVALID_RESULT_CODE, INVALID_RESULT_MESSAGE, aiUnavailableDetail, isAiUnavailable, isValidResult } from '../shared/judgment.js';
import { clearMyRecords, getOwnerToken, rememberRequestId } from './records.js';

const API_BASE = import.meta.env?.VITE_API_BASE ?? 'http://localhost:8080';
const { detections: DETECTIONS_URL, feedback: FEEDBACK_URL, queue: QUEUE_URL } = apiUrls(API_BASE);

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
    formData.append('ownerToken', getOwnerToken()); // 나중에 내 기록을 지울 수 있도록 함께 보낸다

    const response = await fetchWithTimeout(DETECTIONS_URL, { method: 'POST', body: formData });
    const data = await readJson(response);

    if (!response.ok && response.status !== 202) {
        throw new ApiError(data?.message || '분석 요청에 실패했습니다.', response.status);
    }
    if (!data) throw new ApiError('서버 응답을 읽을 수 없습니다.', response.status);
    if (data.requestId != null) rememberRequestId(data.requestId);

    return ensureAiResult(await handleDetectionPayload(data, onStatus));
}

// AI 모델이 돌지 않은 결과는 서버가 '확률 0%, 정상'으로 채워 보내므로 결과로 쓰지 않고 오류로 바꾼다
function ensureAiResult(data) {
    rememberAiStatus(!isAiUnavailable(data?.result));
    if (isAiUnavailable(data?.result)) {
        const err = new ApiError(AI_UNAVAILABLE_MESSAGE, 503);
        err.code = AI_UNAVAILABLE_CODE;
        err.detail = aiUnavailableDetail(data.result);
        throw err;
    }
    if (!isValidResult(data?.result)) {
        const err = new ApiError(INVALID_RESULT_MESSAGE, 502);
        err.code = INVALID_RESULT_CODE;
        throw err;
    }
    return data;
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
    let failures = 0;

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await delay(delayMs);
        let data;
        try {
            const response = await fetchWithTimeout(`${DETECTIONS_URL}/${encodeURIComponent(requestId)}`);
            data = await readJson(response);
            if (!response.ok || !data) {
                throw new ApiError(data?.message || '분석 상태를 확인하지 못했습니다.', response.status);
            }
        } catch (err) {
            // 연결이 잠깐 끊기거나 서버가 잠시 오류를 내도 연속 POLL_MAX_RETRIES 번까지는 다시 묻는다
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

export async function clearMyDetectionRecords() {
    try {
        return await clearMyRecords(DETECTIONS_URL);
    } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(err?.message || '검사 기록을 삭제하지 못했습니다.', err?.status ?? 0);
    }
}

const AI_STATUS_KEY = 'veritai_ai_status';

function rememberAiStatus(ok) {
    try { localStorage.setItem(AI_STATUS_KEY, JSON.stringify({ ok, at: Date.now() })); } catch { /* 상태 표시만 못 할 뿐 검사에는 영향 없음 */ }
}

function hasRecentAiFailure() {
    try {
        const status = JSON.parse(localStorage.getItem(AI_STATUS_KEY) || 'null');
        return Boolean(status && status.ok === false && Date.now() - status.at < AI_STATUS_FRESH_MS);
    } catch {
        return false;
    }
}

export function serverHost() {
    try { return new URL(API_BASE).host; } catch { return ''; }
}

export async function checkServerStatus() {
    try {
        const response = await fetchWithTimeout(QUEUE_URL, { cache: 'no-store' }, SERVER_CHECK_TIMEOUT_MS);
        if (!response.ok) return describeServerStatus(null);
        return describeServerStatus(await readJson(response), hasRecentAiFailure());
    } catch {
        return describeServerStatus(null);
    }
}

export function toFriendlyMessage(err) {
    if (err?.code === INVALID_RESULT_CODE) return INVALID_RESULT_MESSAGE;
    if (err?.code === AI_UNAVAILABLE_CODE) {
        return import.meta.env?.DEV ? `${AI_UNAVAILABLE_MESSAGE} (개발용: AI 서버의 모델이 준비되지 않았습니다. ${err.detail})` : AI_UNAVAILABLE_MESSAGE;
    }
    const status = err?.status ?? 0;
    if (status === 0) return import.meta.env?.DEV ? '서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해 주세요.' : '서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.';
    if (status === 429) return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
    if (status === 408) return '응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.';
    if (status === 400 || status === 415) return '지원하지 않는 이미지입니다. 다른 사진으로 시도해 주세요.';
    if (status >= 500) return '서버에서 분석 중 오류가 발생했습니다.';
    return err?.message || '분석에 실패했습니다.';
}
