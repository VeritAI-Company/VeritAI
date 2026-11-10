export function setupReportWindow(detailsBox, badge, e) {
    const dragHandle = detailsBox.querySelector('.veritai-drag-handle');
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    // 터치와 펜으로도 끌 수 있게 pointer 이벤트를 쓰고, 끄는 동안 페이지가 스크롤되지 않게 한다
    dragHandle.style.touchAction = 'none';
    dragHandle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.veritai-close-btn')) return;
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

    window.addEventListener('pointermove', onMouseMove);
    window.addEventListener('pointerup', onMouseUp);
    window.addEventListener('pointercancel', onMouseUp);

    const updatePosition = () => {
        if (!detailsBox.isConnected) return; // Shadow DOM 안이라 document.body.contains로는 찾지 못한다
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

    // Shadow DOM 안의 이벤트는 페이지에서 보면 target이 바깥 상자로 바뀌므로, 지나온 경로(composedPath)로 판단한다
    const isInside = (evt, el) => evt.composedPath().includes(el);

    const closeOnScroll = (evt) => {
        if (isInside(evt, detailsBox)) return;
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
        window.removeEventListener('pointermove', onMouseMove);
        window.removeEventListener('pointerup', onMouseUp);
        window.removeEventListener('pointercancel', onMouseUp);
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
            if (!isInside(evt, detailsBox) && !isInside(evt, badge)) {
                if (detailsBox.dataset.isDragged !== "true" && detailsBox.dataset.isFeedbackActive !== "true") {
                    if (detailsBox.cleanupListeners) detailsBox.cleanupListeners();
                    detailsBox.remove();
                }
            }
        };
        document.addEventListener('click', closeDetails);
    }, 10);
}
