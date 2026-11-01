import { API_URL, POLL_INITIAL_INTERVAL_MS, POLL_MAX_INTERVAL_MS, POLL_TIMEOUT_MS, FACE_CROP_ANALYSIS_MODE } from '../config/constants.js';

const pendingDetectionPolls = new Map();
let batchPollingActive = false;

const STATUS_TIMEOUT_MS = 15000;
const OWNER_TOKEN_STORAGE_KEY = 'veritai_owner_token';
const REQUEST_IDS_STORAGE_KEY = 'veritai_detection_request_ids';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getOrCreateOwnerToken() {
    const stored = await chrome.storage.local.get([OWNER_TOKEN_STORAGE_KEY]);
    if (typeof stored[OWNER_TOKEN_STORAGE_KEY] === 'string' && stored[OWNER_TOKEN_STORAGE_KEY].length >= 32) {
        return stored[OWNER_TOKEN_STORAGE_KEY];
    }
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ [OWNER_TOKEN_STORAGE_KEY]: token });
    return token;
}

async function rememberDetectionRequestId(requestId) {
    if (!Number.isSafeInteger(Number(requestId)) || Number(requestId) <= 0) return;
    const stored = await chrome.storage.local.get([REQUEST_IDS_STORAGE_KEY]);
    const ids = new Set(Array.isArray(stored[REQUEST_IDS_STORAGE_KEY]) ? stored[REQUEST_IDS_STORAGE_KEY] : []);
    ids.add(Number(requestId));
    await chrome.storage.local.set({ [REQUEST_IDS_STORAGE_KEY]: Array.from(ids) });
}

export async function getStoredDetectionRequestIds() {
    const stored = await chrome.storage.local.get([REQUEST_IDS_STORAGE_KEY]);
    return Array.from(new Set(
        (Array.isArray(stored[REQUEST_IDS_STORAGE_KEY]) ? stored[REQUEST_IDS_STORAGE_KEY] : [])
            .map(Number)
            .filter(id => Number.isSafeInteger(id) && id > 0)
    ));
}

export async function clearStoredDetectionRequestIds() {
    await chrome.storage.local.remove(REQUEST_IDS_STORAGE_KEY);
}

export async function sendToBackend(blob, mediaType, analysisMode = FACE_CROP_ANALYSIS_MODE) {
    const formData = new FormData();
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[blob.type] || "webp";
    formData.append("file", blob, `capture.${ext}`);
    formData.append("sourceUrl", window.location.href);
    formData.append("mediaType", mediaType);
    formData.append("clientType", "chrome-extension");
    formData.append("analysisMode", analysisMode);
    formData.append("ownerToken", await getOrCreateOwnerToken());

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(API_URL, { method: "POST", body: formData, signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) {
            const error = new Error(`Server Error`);
            error.status = response.status;
            throw error;
        }
        const data = await response.json();
        if (!data) throw new Error("분석이 정상적으로 완료되지 않았습니다.");
        if (data.requestId) await rememberDetectionRequestId(data.requestId);
        if (data.status === "DONE" && data.result) return data;
        if ((data.status === "PROCESSING" || data.status === "QUEUED") && data.requestId) {
            return await pollDetectionResult(data.requestId);
        }
        if (data.status === "FAILED") throw new Error(data?.message || "Analysis failed");
        throw new Error(data?.message || "분석이 정상적으로 완료되지 않았습니다.");
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            const timeoutErr = new Error("Timeout");
            timeoutErr.status = 408;
            throw timeoutErr;
        }
        throw err;
    }
}

export async function deleteDetectionRecords(requestIds) {
    const ids = Array.from(new Set((requestIds || []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0)));
    if (ids.length === 0) return { requestedCount: 0, deletedRequestCount: 0 };
    const ownerToken = await getOrCreateOwnerToken();
    const response = await fetch(API_URL, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'X-VeritAI-Owner-Token': ownerToken,
        },
        body: JSON.stringify({ requestIds: ids }),
    });
    let body = null;
    try {
        body = await response.json();
    } catch (_) {
        body = null;
    }
    if (!response.ok) {
        const error = new Error(body?.message || '검사 기록을 삭제하지 못했습니다.');
        error.status = response.status;
        throw error;
    }
    return body;
}

async function pollDetectionResult(requestId) {
    return new Promise((resolve, reject) => {
        pendingDetectionPolls.set(String(requestId), {
            requestId,
            resolve,
            reject,
            startedAt: Date.now(),
        });
        ensureBatchPolling();
    });
}

function ensureBatchPolling() {
    if (batchPollingActive) return;
    batchPollingActive = true;
    runBatchPollingLoop().finally(() => {
        batchPollingActive = false;
        if (pendingDetectionPolls.size > 0) ensureBatchPolling();
    });
}

async function runBatchPollingLoop() {
    let delayMs = POLL_INITIAL_INTERVAL_MS;
    while (pendingDetectionPolls.size > 0) {
        await delay(delayMs);
        const now = Date.now();
        const timedOut = [];
        pendingDetectionPolls.forEach((entry, key) => {
            if (now - entry.startedAt >= POLL_TIMEOUT_MS) timedOut.push(key);
        });
        timedOut.forEach(key => {
            const entry = pendingDetectionPolls.get(key);
            if (entry) entry.reject(new Error("Analysis timed out."));
            pendingDetectionPolls.delete(key);
        });
        if (pendingDetectionPolls.size === 0) break;

        const ids = Array.from(pendingDetectionPolls.keys()).join(",");
        let response;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
        try {
            response = await fetch(`${API_URL}/status?ids=${encodeURIComponent(ids)}`, { signal: controller.signal });
        } catch (error) {
            clearTimeout(timeoutId);
            // 응답이 늦으면 이번 조회만 건너뛰고 다시 묻는다. 전체 대기 시간(POLL_TIMEOUT_MS)이 지나면 위에서 실패 처리된다
            if (error.name === 'AbortError') {
                delayMs = POLL_MAX_INTERVAL_MS;
                continue;
            }
            pendingDetectionPolls.forEach(entry => entry.reject(error));
            pendingDetectionPolls.clear();
            break;
        }
        clearTimeout(timeoutId);
        if (!response.ok) {
            const error = new Error(`Server response error: ${response.status}`);
            pendingDetectionPolls.forEach(entry => entry.reject(error));
            pendingDetectionPolls.clear();
            break;
        }

        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        let maxRetryAfterMs = 0;
        let completedCount = 0;
        items.forEach(item => {
            const key = String(item.requestId);
            const entry = pendingDetectionPolls.get(key);
            if (!entry) return;
            const retryAfterMs = Number(item.retryAfterMs);
            if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) maxRetryAfterMs = Math.max(maxRetryAfterMs, retryAfterMs);
            if (item.status === "DONE" && item.result) {
                entry.resolve(item);
                pendingDetectionPolls.delete(key);
                completedCount += 1;
            } else if (item.status === "FAILED") {
                entry.reject(new Error(item?.message || "Analysis failed"));
                pendingDetectionPolls.delete(key);
                completedCount += 1;
            }
        });
        if (completedCount > 0) delayMs = POLL_INITIAL_INTERVAL_MS;
        else if (maxRetryAfterMs > 0) delayMs = Math.min(POLL_MAX_INTERVAL_MS, Math.max(POLL_INITIAL_INTERVAL_MS, maxRetryAfterMs));
        else delayMs = Math.min(POLL_MAX_INTERVAL_MS, Math.round(delayMs * 1.25));
    }
}

export function clearPendingPolls() {
    pendingDetectionPolls.forEach(entry => entry.reject(new Error("시스템 중지됨")));
    pendingDetectionPolls.clear();
}
