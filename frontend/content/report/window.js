// 결과창 창 동작: 끌어서 옮기기, 배지 옆 위치 맞추기, 화면 밖으로 나가지 않게 하기, 스크롤과 바깥 클릭 시 닫기, 닫기 버튼

export function setupReportWindow(detailsBox, badge, e) {
    const dragHandle = detailsBox.querySelector('.veritai-drag-handle');
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    dragHandle.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('veritai-close-btn')) return;
        isDragging = true;
        detailsBox.dataset.isDragged = "true";
        dragHandle.style.cursor = 'grabbing';
        const rect = detailsBox.getBoundingClientRect();
        detailsBox.style.transform = 'none';
        detailsBox.style.left = (rect.left + window.scrollX) + 'px';
        detailsBox.style.top = (rect.top + window.scrollY) + 'px';
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = rect.left + window.scrollX;
        initialTop = rect.top + window.scrollY;
        e.preventDefault();
    });

    const onMouseMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        detailsBox.style.left = (initialLeft + dx) + 'px';
        detailsBox.style.top = (initialTop + dy) + 'px';
    };

    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            dragHandle.style.cursor = 'grab';
        }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    const updatePosition = () => {
        if (!document.body.contains(detailsBox)) return;
        if (detailsBox.dataset.isDragged === "true") return;

        const margin = 8;
        const viewW = document.documentElement.clientWidth || window.innerWidth;
        const viewH = window.innerHeight;
        detailsBox.style.maxHeight = `${Math.max(240, Math.min(500, viewH - margin * 2))}px`;
        const badgeRect = badge.getBoundingClientRect();
        const boxW = detailsBox.offsetWidth;
        const boxH = detailsBox.offsetHeight;
        let left = badgeRect.right + 10;
        if (left + boxW > viewW - margin) left = badgeRect.left - boxW - 10;
        if (left < margin) left = Math.max(margin, viewW - boxW - margin);
        let top = badgeRect.bottom + 5;
        if (top + boxH > viewH - margin) top = Math.max(margin, viewH - boxH - margin);

        detailsBox.style.transform = 'none';
        detailsBox.style.left = (left + window.scrollX) + 'px';
        detailsBox.style.top = (top + window.scrollY) + 'px';
    };

    updatePosition();

    const clampPosition = () => {
        if (detailsBox.dataset.isDragged === "true") return;
        updatePosition();
    };
    window.addEventListener('resize', clampPosition);

    const closeOnScroll = (evt) => {
        if (detailsBox.contains(evt.target)) return;
        if (detailsBox.dataset.isDragged !== "true" && detailsBox.dataset.isFeedbackActive !== "true") {
            if (detailsBox.cleanupListeners) detailsBox.cleanupListeners();
            detailsBox.remove();
        }
    };
    window.addEventListener('scroll', closeOnScroll, true);

    let closeDetails;
    detailsBox.cleanupListeners = () => {
        window.removeEventListener('resize', clampPosition);
        window.removeEventListener('scroll', closeOnScroll, true);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (closeDetails) document.removeEventListener('click', closeDetails);
    };

    const closeBtn = detailsBox.querySelector('.veritai-close-btn');
    if (closeBtn) {
        const closeAction = (evt) => {
            evt.preventDefault(); evt.stopImmediatePropagation();
            if (detailsBox.cleanupListeners) detailsBox.cleanupListeners();
            detailsBox.remove();
            badge.focus();
        };
        closeBtn.addEventListener('click', closeAction);
        closeBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') closeAction(e); });
    }

    setTimeout(() => {
        closeDetails = (evt) => {
            if (!detailsBox.contains(evt.target) && !badge.contains(evt.target)) {
                if (detailsBox.dataset.isDragged !== "true" && detailsBox.dataset.isFeedbackActive !== "true") {
                    if (detailsBox.cleanupListeners) detailsBox.cleanupListeners();
                    detailsBox.remove();
                }
            }
        };
        document.addEventListener('click', closeDetails);
    }, 10);
}
