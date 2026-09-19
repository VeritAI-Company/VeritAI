import { API_URL, POLL_INITIAL_INTERVAL_MS, POLL_MAX_INTERVAL_MS, POLL_TIMEOUT_MS, FACE_CROP_ANALYSIS_MODE } from '../config/constants.js';

const pendingDetectionPolls = new Map();
let batchPollingActive = false;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function sendToBackend(blob, mediaType, analysisMode = FACE_CROP_ANALYSIS_MODE) {
    const formData = new FormData();
    formData.append("file", blob, "capture.webp"); 
    formData.append("sourceUrl", window.location.href);
    formData.append("mediaType", mediaType);
    formData.append("clientType", "chrome-extension");
    formData.append("analysisMode", analysisMode);

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
        chrome.runtime.sendMessage({ action: "keep_alive" }, () => { chrome.runtime.lastError; });
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
        try {
            response = await fetch(`${API_URL}/status?ids=${encodeURIComponent(ids)}`);
        } catch (error) {
            pendingDetectionPolls.forEach(entry => entry.reject(error));
            pendingDetectionPolls.clear();
            break;
        }
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