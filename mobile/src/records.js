// 앱의 내 검사 기록: 소유자 토큰과 검사 번호를 폰(AsyncStorage)에 저장하고, 서버 기록을 지운다
// 삭제 순서는 웹의 shared/records.js와 같다 (앱은 빌드 구조상 그 파일을 가져올 수 없어 여기에 같은 로직을 둔다)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from './config';

const DETECTIONS_URL = `${API_BASE}/api/detections`;
const OWNER_TOKEN_KEY = 'veritai_owner_token';
const REQUEST_IDS_KEY = 'veritai_detection_request_ids';
const OWNER_TOKEN_HEADER = 'X-VeritAI-Owner-Token';
const DELETE_BATCH_MAX = 100; // 서버가 한 번에 받는 최대 개수


function isValidOwnerToken(token) {
    return typeof token === 'string' && token.length >= 32 && token.length <= 256 && /^[A-Za-z0-9_-]+$/.test(token);
}


function createOwnerToken() {
    const bytes = new Uint8Array(32);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function normalizeRequestIds(requestIds) {
    return Array.from(new Set(
        (Array.isArray(requestIds) ? requestIds : [])
            .map(Number)
            .filter(id => Number.isSafeInteger(id) && id > 0)
    ));
}

let ownerTokenPromise = null;
export function getOwnerToken() {
    if (!ownerTokenPromise) {
        ownerTokenPromise = (async () => {
            try {
                const stored = await AsyncStorage.getItem(OWNER_TOKEN_KEY);
                if (isValidOwnerToken(stored)) return stored;
            } catch { /* 저장소를 못 읽으면 새로 만든다 */ }
            const token = createOwnerToken();
            try { await AsyncStorage.setItem(OWNER_TOKEN_KEY, token); } catch { /* 저장 못 해도 검사는 계속 */ }
            return token;
        })();
    }
    return ownerTokenPromise;
}

let idsQueue = Promise.resolve();
function updateStoredIds(update) {
    const run = idsQueue.then(async () => {
        const ids = await getStoredRequestIds();
        const next = update(ids);
        await AsyncStorage.setItem(REQUEST_IDS_KEY, JSON.stringify(next));
    });
    idsQueue = run.catch(() => {});
    return run;
}

export async function getStoredRequestIds() {
    try {
        return normalizeRequestIds(JSON.parse((await AsyncStorage.getItem(REQUEST_IDS_KEY)) || '[]'));
    } catch {
        return [];
    }
}

export async function rememberRequestId(requestId) {
    const id = Number(requestId);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    try { await updateStoredIds(ids => (ids.includes(id) ? ids : [...ids, id])); } catch { /* 저장 못 해도 검사는 계속 */ }
}

async function sendDeleteRequest(url, ownerToken, body) {
    const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', [OWNER_TOKEN_HEADER]: ownerToken },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    return { status: response.status, ok: response.ok, data };
}

function deletionError(status, data) {
    const error = new Error(data?.message || '검사 기록을 삭제하지 못했습니다.');
    error.status = status;
    return error;
}

async function deleteRecordsOnServer(ownerToken, ids) {
    const summary = { requestedCount: ids.length, deletedRequestCount: 0, alreadyMissingCount: 0, notOwnedCount: 0, pendingIds: [], handledIds: [] };
    for (let i = 0; i < ids.length; i += DELETE_BATCH_MAX) {
        const chunk = ids.slice(i, i + DELETE_BATCH_MAX);
        const batch = await sendDeleteRequest(DETECTIONS_URL, ownerToken, { requestIds: chunk });
        if (batch.ok) {
            summary.deletedRequestCount += Number(batch.data?.deletedRequestCount ?? chunk.length);
            summary.handledIds.push(...chunk);
            continue;
        }
        if (![403, 404, 409].includes(batch.status)) throw deletionError(batch.status, batch.data);

        for (const id of chunk) {
            const one = await sendDeleteRequest(`${DETECTIONS_URL}/${id}`, ownerToken);
            if (one.ok) { summary.deletedRequestCount += 1; summary.handledIds.push(id); }
            else if (one.status === 404) { summary.alreadyMissingCount += 1; summary.handledIds.push(id); }
            else if (one.status === 403) { summary.notOwnedCount += 1; summary.handledIds.push(id); }
            else if (one.status === 409) summary.pendingIds.push(id);
            else throw deletionError(one.status, one.data);
        }
    }
    return summary;
}

export async function clearMyRecords() {
    const ids = await getStoredRequestIds();
    if (ids.length === 0) return { requestedCount: 0, deletedRequestCount: 0, pendingIds: [], handledIds: [] };
    let summary;
    try {
        summary = await deleteRecordsOnServer(await getOwnerToken(), ids);
    } catch (err) {
        if (err?.status === undefined) err.status = 0; // 연결 실패
        throw err;
    }
    const handled = new Set(summary.handledIds);
    await updateStoredIds(current => current.filter(id => !handled.has(id)));
    return summary;
}
