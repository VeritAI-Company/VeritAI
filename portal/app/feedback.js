import { sendFeedback } from '../api.js';
import { $, state } from './state.js';

export function resetFeedback() {
    $('btn-feedback-open').hidden = false;
    $('btn-feedback-open').disabled = false;
    $('feedback-form').hidden = true;
    $('feedback-reason').value = '';
    $('feedback-reason').classList.remove('is-invalid');
    $('btn-feedback-submit').disabled = false;
    $('btn-feedback-submit').textContent = '제출';
    $('feedback-status').hidden = true;
}

export function openFeedback() {
    $('btn-feedback-open').hidden = true;
    $('feedback-form').hidden = false;
    $('feedback-status').hidden = true;
    $('feedback-reason').focus();
}

export async function submitFeedback(event) {
    event.preventDefault();
    const reasonInput = $('feedback-reason');
    const reason = reasonInput.value.trim();
    if (!reason) {
        reasonInput.classList.add('is-invalid');
        reasonInput.placeholder = '신고 이유를 적어 주세요.';
        reasonInput.focus();
        return;
    }
    if (state.data?.requestId == null) return;

    const submitBtn = $('btn-feedback-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = '전송 중...';
    const status = $('feedback-status');
    try {
        await sendFeedback(state.data.requestId, reason);
        $('feedback-form').hidden = true;
        status.textContent = '신고가 접수되었습니다. 모델 개선에 활용하겠습니다.';
        status.className = 'feedback-status is-ok';
        status.hidden = false;
    } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = '다시 제출';
        status.textContent = err.status === 0
            ? '서버에 연결할 수 없어 신고를 보내지 못했습니다.'
            : '신고를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.';
        status.className = 'feedback-status is-error';
        status.hidden = false;
    }
}

export function cancelFeedback() {
    $('feedback-form').hidden = true;
    $('btn-feedback-open').hidden = false;
    $('feedback-reason').classList.remove('is-invalid');
}
