// PWA의 내 검사 기록: 소유자 토큰과 검사 번호를 이 브라우저(localStorage)에 저장하고, 서버 기록을 지운다
// 삭제 순서는 확장과 같은 shared/records.js 를 쓴다
import { STORED_REQUEST_IDS_MAX, createOwnerToken, deleteRecordsOnServer, isValidOwnerToken, normalizeRequestIds } from '../shared/records.js';

const OWNER_TOKEN_KEY = 'veritai_owner_token';
const REQUEST_IDS_KEY = 'veritai_detection_request_ids';

// 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서도 검사는 되도록 오류는 삼킨다
function read(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
    try { localStorage.setItem(key, value); } catch { /* 저장 못 해도 검사는 계속 */ }
}

let memoryToken = null; // 저장소를 못 쓰면 이번 실행 동안만 쓰는 토큰

export function getOwnerToken() {
    const stored = read(OWNER_TOKEN_KEY);
    if (isValidOwnerToken(stored)) return stored;
    if (!memoryToken) memoryToken = createOwnerToken();
    write(OWNER_TOKEN_KEY, memoryToken);
    return memoryToken;
}

export function getStoredRequestIds() {
    try { return normalizeRequestIds(JSON.parse(read(REQUEST_IDS_KEY) || '[]')); } catch { return []; }
}

export function rememberRequestId(requestId) {
    const ids = getStoredRequestIds();
    const id = Number(requestId);
    if (!Number.isSafeInteger(id) || id <= 0 || ids.includes(id)) return;
    ids.push(id);
    write(REQUEST_IDS_KEY, JSON.stringify(ids.slice(-STORED_REQUEST_IDS_MAX)));
}

function forgetRequestIds(handledIds) {
    const handled = new Set(handledIds.map(Number));
    write(REQUEST_IDS_KEY, JSON.stringify(getStoredRequestIds().filter(id => !handled.has(id))));
}

// 서버 기록을 지우고, 정리된 번호만 저장 목록에서 뺀다 (처리 중인 번호는 남겨서 다음에 다시 지운다)
export async function clearMyRecords(detectionsUrl) {
    const requestIds = getStoredRequestIds();
    if (requestIds.length === 0) return { requestedCount: 0, deletedRequestCount: 0, pendingIds: [], handledIds: [] };
    const summary = await deleteRecordsOnServer({ detectionsUrl, ownerToken: getOwnerToken(), requestIds });
    forgetRequestIds(summary.handledIds);
    return summary;
}
