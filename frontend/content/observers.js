import { readDeepfakeFlag } from '../../shared/judgment.js';
import { icon } from '../ui/styles.js';
import { updateStatusBadge } from './badge.js';
import { getFromCache, getMediaKey, scanCache, scannedMediaKeys } from './cache.js';
import { clearMediaHighlight, ensureWrapper, getCheckButton, getMediaId, getShadowHost, positionOverlay, removeMediaUI, shouldInspectMedia } from './dom.js';
import { startInspection } from './inspect.js';
import { hideCoveredUIs, hideMediaUI, isBehindInspectedMedia, isCoveredByOtherMedia } from './overlap.js';
import { settings } from './state.js';

let mutationQueue = [];
let observerDebounceTimer = null;
let firstQueuedAt = 0;
const MUTATION_DEBOUNCE_MS = 150;
const MUTATION_MAX_WAIT_MS = 500; // 화면이 계속 바뀌는 페이지에서도 최소 0.5초마다 한 번은 처리한다

export const DOM_OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset']
};
const MUTATION_QUEUE_LIMIT = 2000;

export const autoScanObserver = new IntersectionObserver((entries) => {
    if (!settings.isSystemOn || !settings.isAutoScanMode) return;
    entries.forEach(entry => {
        if (entry.isIntersecting && entry.target.clientWidth > 80) {
            if (entry.target.dataset.scanTimer) clearTimeout(entry.target.dataset.scanTimer);
            entry.target.dataset.scanTimer = setTimeout(() => {
                if (!settings.isSystemOn || !settings.isAutoScanMode) return;
                const rect = entry.target.getBoundingClientRect();
                if (rect.top < window.innerHeight && rect.bottom > 0) {
                    startInspection(entry.target);
                    autoScanObserver.unobserve(entry.target);
                }
            }, 300);
        }
    });
}, { threshold: 0.3 });

export const domObserver = new MutationObserver((mutations) => {
    if (!settings.isSystemOn) return;

    mutationQueue.push(...mutations);
    if (mutationQueue.length > MUTATION_QUEUE_LIMIT) {
        mutationQueue = mutationQueue.slice(-MUTATION_QUEUE_LIMIT);
    }
    const now = Date.now();
    if (!observerDebounceTimer) firstQueuedAt = now;
    else clearTimeout(observerDebounceTimer);
    const wait = Math.max(0, Math.min(MUTATION_DEBOUNCE_MS, firstQueuedAt + MUTATION_MAX_WAIT_MS - now));
    observerDebounceTimer = setTimeout(() => {
        observerDebounceTimer = null;
        if (!settings.isSystemOn) { mutationQueue = []; return; }
        const mutationsToProcess = mutationQueue;
        mutationQueue = [];

        mutationsToProcess.forEach(mutation => {
            if (mutation.addedNodes) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && (node.tagName === 'IMG' || node.tagName === 'VIDEO')) attachUI(node);
                    else if (node.nodeType === 1 && node.querySelectorAll) node.querySelectorAll('img, video').forEach(media => attachUI(media));
                });
            }
            if (mutation.removedNodes) {
                mutation.removedNodes.forEach(node => {
                    if (node.nodeType === 1 && (node.tagName === 'IMG' || node.tagName === 'VIDEO')) {
                        const key = node.dataset.veritaiScanKey;
                        if (key) scannedMediaKeys.delete(key);
                    }
                });
            }

            if (mutation.type === 'attributes' && (mutation.attributeName === 'src' || mutation.attributeName === 'srcset')) {
                const target = mutation.target;
                if (target.tagName === 'IMG' || target.tagName === 'VIDEO') {
                    delete target.dataset.veritaiAttached;
                    delete target.dataset.veritaiScanned;
                    delete target.dataset.veritaiScanKey;
                    delete target.dataset.veritaiFadedOut;
                    delete target.dataset.veritaiSuppressed;
                    removeMediaUI(target);
                    clearMediaHighlight(target);
                    if (target.tagName === 'IMG' && !target.complete) target.addEventListener('load', () => attachUI(target), { once: true });
                    else attachUI(target);
                }
            }
        });
    }, wait);
});

// 사진마다 바로 처리하지 않고 모아서, 한 번에 12ms까지만 처리하고 브라우저에 차례를 넘긴다.
// 사진이 수백 장인 페이지에서 한 번에 몰아 처리하면 몇 초 동안 페이지가 멈추기 때문이다.
const attachQueue = new Map(); // 사진 -> 다시 시도한 횟수
let attachFlushScheduled = false;
const ATTACH_BUDGET_MS = 12;

export function attachUI(media, retryCount = 0) {
    if (!settings.isSystemOn || !media) return;
    attachQueue.set(media, Math.max(retryCount, attachQueue.get(media) ?? 0));
    if (!attachFlushScheduled) {
        attachFlushScheduled = true;
        setTimeout(flushAttachQueue, 0);
    }
}

function flushAttachQueue() {
    attachFlushScheduled = false;
    const startedAt = performance.now();
    for (const [media, retryCount] of attachQueue) {
        attachQueue.delete(media);
        attachUINow(media, retryCount);
        if (attachQueue.size > 0 && performance.now() - startedAt > ATTACH_BUDGET_MS) {
            attachFlushScheduled = true;
            setTimeout(flushAttachQueue, 0);
            return;
        }
    }
}

function attachUINow(media, retryCount = 0) {
    if (!settings.isSystemOn) return;
    if (media.tagName === 'IMG' && !media.complete) {
        media.addEventListener('load', () => attachUI(media, retryCount), { once: true });
        return;
    }

    if (!shouldInspectMedia(media)) {
        if (retryCount < 5) setTimeout(() => attachUI(media, retryCount + 1), 300);
        return;
    }

    if (media.dataset.veritaiSuppressed === "true" && media.dataset.forceInspect !== "true") return;
    if (media.dataset.forceInspect !== "true" && isCoveredByOtherMedia(media)) {
        hideMediaUI(media);
        return;
    }
    hideCoveredUIs(media);

    const wrapper = ensureWrapper(media);
    const hasUI = Boolean(getCheckButton(media) || getShadowHost(media));
    const mediaUrl = media.currentSrc || media.src;

    if (mediaUrl && scanCache.has(mediaUrl) && !hasUI) {
        media.dataset.veritaiAttached = "true";
        media.dataset.veritaiScanned = "true";
        media.dataset.veritaiScanKey = getMediaKey(media);
        const data = getFromCache(mediaUrl);
        const isFake = readDeepfakeFlag(data.result);
        if (!isFake && settings.isCleanUIMode) media.dataset.veritaiFadedOut = "true";
        updateStatusBadge(media, isFake ? "fake" : "real", data);
        return;
    }

    if (media.dataset.veritaiScanned === "true") return;
    if (media.dataset.veritaiAttached === "true" && hasUI) return;
    media.dataset.veritaiAttached = "true";
    delete media.dataset.veritaiScanned;

    if (settings.isAutoScanMode && media.tagName !== 'VIDEO') {
        autoScanObserver.observe(media);
    } else {
        if (wrapper && !getCheckButton(media) && isBehindInspectedMedia(media)) {
            media.dataset.veritaiSuppressed = "true";
            return;
        }
        if (wrapper && !getCheckButton(media)) {
            const btn = document.createElement("button");
            btn.innerHTML = `${icon('search')}<span>검사</span>`;
            btn.setAttribute('aria-label', '이 사진 조작 여부 검사');
            btn.className = "veritai-check-btn";
            btn.dataset.veritaiFor = getMediaId(media);
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                media.dataset.veritaiUserRequest = "true";
                startInspection(media);
            });
            wrapper.appendChild(btn);
            positionOverlay(btn, media, 8);
        }
    }
}
