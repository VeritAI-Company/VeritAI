// 내 검사 기록 지우기 공통 로직 (소유자 토큰 만들기, 서버 기록 삭제)
// 크롬 확장(frontend)과 PWA(portal)가 함께 쓴다. 앱(mobile)은 빌드 구조상 이 파일을 가져올 수 없어 mobile/src/records.js에 같은 로직을 둔다.
// 토큰과 검사 번호를 어디에 저장할지는 채널마다 다르므로(확장: chrome.storage, PWA: localStorage, 앱: AsyncStorage) 여기서는 다루지 않는다.

export const OWNER_TOKEN_HEADER = 'X-VeritAI-Owner-Token';
export const DELETE_BATCH_MAX = 100; // 서버가 한 번에 받는 최대 개수 (batch-status-max-ids 기본값)

export function isValidOwnerToken(token) {
    return typeof token === 'string' && token.length >= 32 && token.length <= 256 && /^[A-Za-z0-9_-]+$/.test(token);
}

export function createOwnerToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export function normalizeRequestIds(requestIds) {
    return Array.from(new Set(
        (Array.isArray(requestIds) ? requestIds : [])
            .map(Number)
            .filter(id => Number.isSafeInteger(id) && id > 0)
    ));
}

async function sendDeleteRequest(url, ownerToken, body) {
    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            [OWNER_TOKEN_HEADER]: ownerToken,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
        data = await response.json();
    } catch (_) {
        data = null;
    }
    return { status: response.status, ok: response.ok, data };
}

function deletionError(status, data) {
    const error = new Error(data?.message || '검사 기록을 삭제하지 못했습니다.');
    error.status = status;
    return error;
}

export async function deleteRecordsOnServer({ detectionsUrl, ownerToken, requestIds }) {
    const ids = normalizeRequestIds(requestIds);
    const summary = { requestedCount: ids.length, deletedRequestCount: 0, alreadyMissingCount: 0, notOwnedCount: 0, pendingIds: [], handledIds: [] };
    if (ids.length === 0) return summary;

    for (let i = 0; i < ids.length; i += DELETE_BATCH_MAX) {
        const chunk = ids.slice(i, i + DELETE_BATCH_MAX);
        const batch = await sendDeleteRequest(detectionsUrl, ownerToken, { requestIds: chunk });
        if (batch.ok) {
            summary.deletedRequestCount += Number(batch.data?.deletedRequestCount ?? chunk.length);
            summary.handledIds.push(...chunk);
            continue;
        }
        if (![403, 404, 409].includes(batch.status)) throw deletionError(batch.status, batch.data);

        for (const id of chunk) {
            const one = await sendDeleteRequest(`${detectionsUrl}/${id}`, ownerToken);
            if (one.ok) { summary.deletedRequestCount += 1; summary.handledIds.push(id); }
            else if (one.status === 404) { summary.alreadyMissingCount += 1; summary.handledIds.push(id); }
            else if (one.status === 403) { summary.notOwnedCount += 1; summary.handledIds.push(id); }
            else if (one.status === 409) summary.pendingIds.push(id);
            else throw deletionError(one.status, one.data);
        }
    }
    return summary;
}
