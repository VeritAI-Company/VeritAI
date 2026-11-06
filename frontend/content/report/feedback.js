import { FEEDBACK_URL } from '../../config/constants';

export function setupReportFeedback(detailsBox, data) {
    const feedbackBtn = detailsBox.querySelector('.veritai-feedback-btn');
    if (feedbackBtn) {
        feedbackBtn.onclick = (e) => {
            e.stopPropagation();
            if (feedbackBtn.disabled) return;

            detailsBox.dataset.isFeedbackActive = "true";

            feedbackBtn.style.display = 'none';

            const reasonContainer = document.createElement('div');
            reasonContainer.className = 'vr-feedback';
            const reasonInput = document.createElement('textarea');
            reasonInput.placeholder = "어떤 점이 틀렸는지 적어 주세요.";
            reasonInput.setAttribute('aria-label', '신고 이유');
            reasonInput.addEventListener('input', () => reasonInput.classList.remove('is-invalid'));
            reasonInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    cancelBtn.click();
                    }
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitBtn.click();
                }
            });
            const actionContainer = document.createElement('div');
            actionContainer.className = 'vr-feedback-actions';
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'vr-btn';
            cancelBtn.innerText = "취소";
            const submitBtn = document.createElement('button');
            submitBtn.className = 'vr-btn is-primary';
            submitBtn.innerText = "보내기";

            actionContainer.appendChild(cancelBtn);
            actionContainer.appendChild(submitBtn);
            reasonContainer.appendChild(reasonInput);
            reasonContainer.appendChild(actionContainer);
            (feedbackBtn.closest('.vr-section') || feedbackBtn.parentNode).appendChild(reasonContainer);
            setTimeout(() => reasonInput.focus(), 50);

            cancelBtn.onclick = (cancelEvent) => {
                cancelEvent.stopPropagation();
                reasonContainer.remove();
                feedbackBtn.style.display = '';
                detailsBox.dataset.isFeedbackActive = "false";
            };

            submitBtn.onclick = async (submitEvent) => {
                submitEvent.stopPropagation();
                const textReason = reasonInput.value.trim();
                if (!textReason) {
                    reasonInput.classList.add('is-invalid');
                    reasonInput.placeholder = "신고 이유를 적어 주세요.";
                    return;
                }
                submitBtn.innerText = "보내는 중";
                submitBtn.disabled = true;
                cancelBtn.disabled = true;

                try {
                    const response = await fetch(FEEDBACK_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            requestId: data.requestId,
                            reportedAt: new Date().toISOString(),
                            reason: textReason
                        })
                    });
                    if (!response.ok) throw new Error("전송 실패");
                    reasonContainer.innerHTML = "<span class='vr-feedback-done'>신고가 접수되었습니다. 모델 개선에 활용하겠습니다.</span>";
                    setTimeout(() => {
                        reasonContainer.remove();
                        feedbackBtn.style.display = '';
                        feedbackBtn.innerText = '신고 완료';
                        feedbackBtn.disabled = true;
                        detailsBox.dataset.isFeedbackActive = "false";
                    }, 1500);
                } catch (err) {
                    submitBtn.innerText = "다시 보내기";
                    submitBtn.disabled = false;
                    cancelBtn.disabled = false;
                }
            };
        };
    }
}
