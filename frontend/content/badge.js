import { formatPercent } from '../../shared/judgment.js';
import { VERITAI_CORE_CSS, icon } from '../ui/styles.js';
import { clearMediaHighlight, ensureWrapper, getCheckButton, getMediaId, getShadowHost, positionOverlay } from './dom.js';
import { startInspection } from './inspect.js';
import { getReportBoxes, showReportBox as openReportBox } from './report/report.js';
import { settings } from './state.js';

export function updateStatusBadge(media, status, data = null) {
    if (!settings.isSystemOn && media.dataset.forceInspect !== "true") return;
    if (media.dataset.veritaiSuppressed === "true" && media.dataset.forceInspect !== "true") return;
    if (status === "real" && settings.isCleanUIMode && media.dataset.veritaiFadedOut === "true") return;
    const wrapper = ensureWrapper(media);
    if (!wrapper) return;
    if (!media.dataset.veritaiScanned && status !== "loading") return;

    const existingBtn = getCheckButton(media);
    if (existingBtn) existingBtn.remove();

    let shadowHost = getShadowHost(media);
    let shadowRoot;

    if (!shadowHost) {
        shadowHost = document.createElement('veritai-host');
        shadowHost.dataset.veritaiFor = getMediaId(media);
        shadowHost.style.cssText = 'position: absolute; top: 0; left: 0; z-index: 2147483647; display: block; overflow: visible;';
        wrapper.appendChild(shadowHost);

        shadowRoot = shadowHost.attachShadow({ mode: 'open' });

        const shadowStyle = document.createElement('style');
        shadowStyle.textContent = VERITAI_CORE_CSS;
        shadowRoot.appendChild(shadowStyle);
    } else {
        shadowRoot = shadowHost.shadowRoot;
    }
    positionOverlay(shadowHost, media);

    let uiContainer = shadowRoot.querySelector('.veritai-ui-container');
    if (!uiContainer) {
        uiContainer = document.createElement('div');
        uiContainer.className = 'veritai-ui-container';
        shadowRoot.appendChild(uiContainer);
    }

    let badge = uiContainer.querySelector('.veritai-status-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'veritai-status-badge';
        badge.tabIndex = 0;
        badge.setAttribute('role', 'button');
        uiContainer.appendChild(badge);
    }

    badge.onclick = null;
    badge.onmouseenter = null;
    badge.onmouseleave = null;
    badge.onkeydown = null;
    badge.removeAttribute('style');
    badge.removeAttribute('title');
    badge.removeAttribute('aria-label');
    badge.className = `veritai-status-badge is-${status}`;
    clearMediaHighlight(media);

    if (status === "loading") {
        uiContainer.style.display = 'flex';
        uiContainer.style.opacity = '1';
        badge.innerHTML = '<span class="veritai-spinner"></span><span>분석 중</span>';
    }
    else if (status === "waiting") {
        uiContainer.style.display = 'flex';
        uiContainer.style.opacity = '1';
        badge.innerHTML = '<span class="vr-dot"></span><span>대기 중</span>';
    }
    else if (status === "error") {
        uiContainer.style.display = 'flex';
        uiContainer.style.opacity = '1';
        badge.innerHTML = icon('alert');
        const message = data?.message || "검사하지 못했습니다.";
        const errorText = document.createElement('span');
        errorText.className = 'vr-error-text';
        errorText.textContent = message;
        const retryText = document.createElement('span');
        retryText.className = 'vr-retry';
        retryText.textContent = '다시 시도';
        badge.append(errorText, retryText);
        // 작은 사진에서는 문구를 '...'으로 줄이고, 마우스를 올리면 전체 문구가 보이게 한다
        badge.style.maxWidth = `${Math.max(90, (media.clientWidth || 0) - 16)}px`;
        badge.title = `${message} (누르면 다시 시도)`;
        badge.setAttribute('aria-label', `${message} 다시 시도`);

        const retryAction = (e) => {
            e.stopPropagation();
            if (uiContainer) uiContainer.remove();
            if (shadowHost) shadowHost.remove();
            delete media.dataset.veritaiScanned;
            media.dataset.veritaiUserRequest = "true";
            startInspection(media);
        };
        badge.onclick = retryAction;
        badge.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); retryAction(e); } };
    }
    else if (status === "fake" || status === "real") {
        const targetMediaSrc = media.currentSrc || media.src || "unknown_media";
        // 같은 주소의 사진이 여러 개여도 리포트가 섞이지 않도록 사진마다 고유 번호로 구분한다
        const reportKey = getMediaId(media);
        const reportImageSrc = data?.frameUrl || targetMediaSrc;

        if (status === "fake") {
            uiContainer.style.display = 'flex';
            uiContainer.style.opacity = '1';
            badge.innerHTML = `<span class="vr-dot"></span><span>조작 의심 ${formatPercent(data.result.confidence, 0)}</span>`;
            badge.setAttribute('aria-label', `조작 의심, 조작 확률 ${formatPercent(data.result.confidence)}. 결과 자세히 보기`);
            media.style.outline = "2px solid rgba(229, 72, 77, 0.9)";
            media.style.outlineOffset = "-2px";
        } else {
            uiContainer.style.display = 'flex';
            uiContainer.style.opacity = '1';
            badge.innerHTML = `${icon('check')}<span>정상</span>`;
            badge.setAttribute('aria-label', '정상. 결과 자세히 보기');

            if (settings.isCleanUIMode) {
                if (media.dataset.veritaiFadedOut === "true") {
                    uiContainer.style.opacity = "0";
                    uiContainer.style.display = "none";
                } else {
                    setTimeout(() => {
                        if (!settings.isCleanUIMode) return;
                        if (uiContainer && uiContainer.parentNode) {
                            uiContainer.style.transition = "opacity 0.5s ease-out";
                            uiContainer.style.opacity = "0";
                            setTimeout(() => {
                                if (uiContainer && uiContainer.parentNode && settings.isCleanUIMode) {
                                    uiContainer.style.display = "none";
                                    media.dataset.veritaiFadedOut = "true";
                                }
                            }, 500);
                        }
                    }, 1500);
                }
            } else {
                delete media.dataset.veritaiFadedOut;
            }
        }

        const showReportBox = (e) => openReportBox(e, { media, status, data, badge, reportKey, reportImageSrc });

        badge.onmouseenter = (e) => {
            badge.style.opacity = "1";
            badge.dataset.isHovered = "true";
            showReportBox(e);
        };

        badge.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                badge.style.opacity = "1";
                badge.dataset.isHovered = "true";
                const openedBox = showReportBox(e);

                setTimeout(() => {
                    if (!openedBox || !openedBox.isConnected) return;
                    const toggleBtn = openedBox.querySelector('#veritai-toggle-xai-btn');
                    const cBtn = openedBox.querySelector('.veritai-close-btn');
                    if (toggleBtn && !toggleBtn.disabled) toggleBtn.focus();
                    else if (cBtn) cBtn.focus();
                }, 50);
            }
        };

        badge.onmouseleave = () => {
            badge.dataset.isHovered = "false";
            setTimeout(() => {
                const existingBox = getReportBoxes().find(box => box.dataset.targetMedia === reportKey) || null;

                if (existingBox && existingBox.dataset.isHovered !== "true" && badge.dataset.isHovered !== "true" && existingBox.dataset.isDragged !== "true" && existingBox.dataset.isFeedbackActive !== "true") {
                    if (existingBox.cleanupListeners) existingBox.cleanupListeners();
                    existingBox.remove();
                }

                if (settings.isCleanUIMode && status === "real" && !existingBox && badge.dataset.isHovered !== "true") {
                    if (uiContainer && uiContainer.parentNode) {
                        uiContainer.style.transition = "opacity 0.5s ease-out";
                        uiContainer.style.opacity = "0";
                        setTimeout(() => {
                            if (uiContainer && uiContainer.parentNode && settings.isCleanUIMode && badge.dataset.isHovered !== "true") {
                                uiContainer.style.display = "none";
                            }
                        }, 1000);
                    }
                }
            }, 100);
        };

        badge.onclick = (e) => { e.preventDefault(); e.stopPropagation(); };
    }
}
