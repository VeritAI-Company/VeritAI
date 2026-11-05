// 이 기기에서 검사한 기록이 있을 때만 보이고, 실수로 지우지 않도록 두 번 눌러야 지운다
import { clearMyDetectionRecords } from '../api.js';
import { getStoredRequestIds } from '../records.js';
import { $ } from './state.js';

const BUTTON_TEXT = '이 기기에서 검사한 기록 지우기';
const CONFIRM_TEXT = '한 번 더 누르면 서버 기록까지 지웁니다';
const CONFIRM_WAIT_MS = 4000;

let confirmTimer = null;
let busy = false;

function resetButton() {
    clearTimeout(confirmTimer);
    confirmTimer = null;
    const btn = $('btn-clear-records');
    btn.textContent = BUTTON_TEXT;
    btn.classList.remove('is-confirm');
}

function setStatus(message, isError = false) {
    const status = $('records-status');
    status.textContent = message;
    status.className = `records-status ${isError ? 'is-error' : 'is-ok'}`;
    status.hidden = !message;
}

export function refreshRecordsBox() {
    if (busy) return;
    resetButton();
    const count = getStoredRequestIds().length;
    $('btn-clear-records').hidden = count === 0;
    $('records-box').hidden = count === 0 && $('records-status').hidden;
}

export async function onClearRecordsClick() {
    if (busy) return;
    const btn = $('btn-clear-records');
    if (!confirmTimer) {
        btn.textContent = CONFIRM_TEXT;
        btn.classList.add('is-confirm');
        setStatus('');
        confirmTimer = setTimeout(resetButton, CONFIRM_WAIT_MS);
        return;
    }

    resetButton();
    busy = true;
    btn.disabled = true;
    btn.textContent = '지우는 중...';
    try {
        const summary = await clearMyDetectionRecords();
        const pending = summary.pendingIds?.length || 0;
        const cleared = summary.handledIds?.length || 0;
        setStatus(pending > 0
            ? `검사 기록 ${cleared}건을 지웠습니다. 처리 중인 ${pending}건은 끝난 뒤 다시 지워 주세요.`
            : `검사 기록 ${cleared}건을 지웠습니다.`);
    } catch (err) {
        setStatus(err?.status === 0
            ? '서버에 연결할 수 없어 기록을 지우지 못했습니다. 잠시 후 다시 시도해 주세요.'
            : '검사 기록을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', true);
    } finally {
        busy = false;
        btn.disabled = false;
        refreshRecordsBox();
    }
}
