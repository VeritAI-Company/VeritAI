import { API_URL, POLL_INITIAL_INTERVAL_MS, POLL_MAX_INTERVAL_MS, POLL_TIMEOUT_MS, FACE_CROP_ANALYSIS_MODE } from '../config/constants.js';
import { POLL_MAX_RETRIES, UPLOAD_TIMEOUT_MS, clampPollDelay, isRetryablePollStatus, nextPollDelay } from '../../shared/api.js';
import { STORED_REQUEST_IDS_MAX, createOwnerToken, deleteRecordsOnServer, isValidOwnerToken, normalizeRequestIds } from '../../shared/records.js';

const pendingDetectionPolls = new Map();
let batchPollingActive = false;

const STATUS_TIMEOUT_MS = UPLOAD_TIMEOUT_MS;
const OWNER_TOKEN_STORAGE_KEY = 'veritai_owner_token';
const REQUEST_IDS_STORAGE_KEY = 'veritai_detection_request_ids';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 여러 사진을 동시에 검사해도 토큰을 한 번만 만들도록, 만드는 중인 작업을 함께 기다린다
let ownerTokenPromise = null;
function getOrCreateOwnerToken() {
    if (!ownerTokenPromise) {
        ownerTokenPromise = loadOrCreateOwnerToken().catch(error => {
            ownerTokenPromise = null;
            throw error;
        });
    }
    return ownerTokenPromise;
}

async function loadOrCreateOwnerToken() {
    const stored = await chrome.storage.local.get([OWNER_TOKEN_STORAGE_KEY]);
    if (isValidOwnerToken(stored[OWNER_TOKEN_STORAGE_KEY])) {
        return stored[OWNER_TOKEN_STORAGE_KEY];
    }
    const token = createOwnerToken();
    await chrome.storage.local.set({ [OWNER_TOKEN_STORAGE_KEY]: token });
    return token;
}

// 저장된 검사 번호 목록을 읽고 고치는 작업을 한 번에 하나씩 처리한다.
// 동시에 여러 사진을 검사하면 읽기와 쓰기가 겹쳐서 번호가 빠질 수 있기 때문이다.
let requestIdsQueue = Promise.resolve();
function updateStoredRequestIds(update) {
    const run = requestIdsQueue.then(async () => {
        const stored = await chrome.storage.local.get([REQUEST_IDS_STORAGE_KEY]);
        const ids = new Set(Array.isArray(stored[REQUEST_IDS_STORAGE_KEY]) ? stored[REQUEST_IDS_STORAGE_KEY].map(Number) : []);
        update(ids);
        await chrome.storage.local.set({ [REQUEST_IDS_STORAGE_KEY]: Array.from(ids).slice(-STORED_REQUEST_IDS_MAX) });
    });
    requestIdsQueue = run.catch(() => {});
    return run;
}

async function rememberDetectionRequestId(requestId) {
    if (!Number.isSafeInteger(Number(requestId)) || Number(requestId) <= 0) return;
    await updateStoredRequestIds(ids => ids.add(Number(requestId)));
}

export async function getStoredDetectionRequestIds() {
    const stored = await chrome.storage.local.get([REQUEST_IDS_STORAGE_KEY]);
    return normalizeRequestIds(stored[REQUEST_IDS_STORAGE_KEY]);
}

// handledIds: 이번에 정리한 번호 (삭제했거나 서버에 이미 없거나 내 기록이 아닌 것).
// 그 번호만 지우고, 처리 중이라 못 지운 번호와 그사이 새로 생긴 번호는 남긴다. 값이 없으면 전부 지운다.
export async function clearStoredDetectionRequestIds(handledIds) {
    if (!Array.isArray(handledIds)) {
        await chrome.storage.local.remove(REQUEST_IDS_STORAGE_KEY);
        return;
    }
    const handled = new Set(handledIds.map(Number));
    await updateStoredRequestIds(ids => handled.forEach(id => ids.delete(id)));
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
    const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

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

// 서버의 내 검사 기록을 지운다. 실제 삭제 순서(100개씩 나누기, 거절되면 한 개씩 다시 지우기)는 shared/records.js 에 있다
export async function deleteDetectionRecords(requestIds) {
    const ids = normalizeRequestIds(requestIds);
    const ownerToken = ids.length > 0 ? await getOrCreateOwnerToken() : ''; // 지울 게 없으면 토큰을 만들지 않는다
    return deleteRecordsOnServer({ detectionsUrl: API_URL, ownerToken, requestIds: ids });
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
    let consecutiveFailures = 0;
    // 네트워크가 잠깐 끊겨도 연속 POLL_MAX_RETRIES 번까지는 다시 묻는다. 그래도 안 되면 기다리던 검사를 모두 실패로 끝낸다 (true면 반복 종료)
    const handlePollFailure = (error) => {
        consecutiveFailures += 1;
        if (isRetryablePollStatus(error.status) && consecutiveFailures < POLL_MAX_RETRIES) {
            delayMs = POLL_MAX_INTERVAL_MS;
            return false;
        }
        pendingDetectionPolls.forEach(entry => entry.reject(error));
        pendingDetectionPolls.clear();
        return true;
    };

    while (pendingDetectionPolls.size > 0) {
        await delay(delayMs);
        const now = Date.now();
        const timedOut = [];
        pendingDetectionPolls.forEach((entry, key) => {
            if (now - entry.startedAt >= POLL_TIMEOUT_MS) timedOut.push(key);
        });
        timedOut.forEach(key => {
            const entry = pendingDetectionPolls.get(key);
            if (entry) {
                const timeoutErr = new Error("Analysis timed out.");
                timeoutErr.status = 408; // 배지에 '응답이 늦습니다'로 보이게 한다
                entry.reject(timeoutErr);
            }
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
            if (handlePollFailure(error)) break;
            continue;
        }
        clearTimeout(timeoutId);
        if (!response.ok) {
            const error = new Error(`Server response error: ${response.status}`);
            error.status = response.status;
            if (handlePollFailure(error)) break;
            continue;
        }

        let data;
        try {
            data = await response.json();
        } catch (error) {
            // 응답을 읽지 못하면 이번 조회만 실패로 보고 다시 묻는다
            if (handlePollFailure(error)) break;
            continue;
        }
        consecutiveFailures = 0;
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
        else if (maxRetryAfterMs > 0) delayMs = clampPollDelay(maxRetryAfterMs);
        else delayMs = nextPollDelay(delayMs);
    }
}

export function clearPendingPolls() {
    pendingDetectionPolls.forEach(entry => entry.reject(new Error("시스템 중지됨")));
    pendingDetectionPolls.clear();
}
