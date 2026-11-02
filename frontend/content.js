// VeritAI 크롬 확장 content script 시작점
// 실제 기능은 content/ 폴더의 각 파일에 있고, 여기서는 초기화와 페이지 이벤트, 확장 메시지만 연결한다
import { releaseFrameUrl, scanCache, scannedMediaKeys } from './content/cache.js';
import { getAllBadges, isVisibleMedia } from './content/dom.js';
import { analyzeStandaloneMedia, injectDropzone } from './content/dropzone.js';
import { reinspectMedia, startInspection } from './content/inspect.js';
import { DOM_OBSERVER_OPTIONS, attachUI, domObserver } from './content/observers.js';
import { pickTopmostUI } from './content/overlap.js';
import { closeAllReportBoxes } from './content/report/report.js';
import { applySettingChanges, clearAllUI, startOrphanWatch, syncSettingsFromStorage } from './content/settings.js';
import { SETTING_KEYS, settings } from './content/state.js';
import { injectCSS } from './ui/styles.js';
import { cacheDeletionErrorMessage, clearDetectionCacheFlow } from './core/cache-clear.js';
import { clearStoredDetectionRequestIds, deleteDetectionRecords, getStoredDetectionRequestIds } from './core/network.js';

injectCSS();

chrome.storage.local.get(SETTING_KEYS, (result) => {
    settings.isSystemOn = result.isSystemOn !== false;
    settings.isAutoScanMode = result.isAutoScanOn || false;
    settings.isCleanUIMode = result.isCleanUIMode || false;
    setTimeout(() => {
        if (settings.isSystemOn) {
            injectDropzone();
            document.querySelectorAll('img, video').forEach(media => attachUI(media));
            domObserver.observe(document.body, DOM_OBSERVER_OPTIONS);
        }
    }, 500);
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') applySettingChanges(changes);
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncSettingsFromStorage();
});
window.addEventListener('focus', syncSettingsFromStorage);
startOrphanWatch();

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAllReportBoxes(true);
    }

    if (e.altKey && e.key.toLowerCase() === 'v') {
        const badges = getAllBadges();
        const fakeBadges = badges.filter(badge => badge.innerText.includes('조작 의심'));

        if (fakeBadges.length === 0) {
            const hint = document.getElementById('veritai-mini-hint');
            if (hint) {
                hint.style.transform = 'scale(1.1)';
                setTimeout(() => hint.style.transform = 'scale(1)', 200);
            }
            return;
        }

        let targetBadge = fakeBadges[0];
        for (let badge of fakeBadges) {
            const rect = badge.getBoundingClientRect();
            if (rect.top >= 0) {
                targetBadge = badge;
                break;
            }
        }

        targetBadge.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => targetBadge.focus(), 300);
    }
});

document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const customUIs = [...document.querySelectorAll('.veritai-check-btn'), ...getAllBadges()];
    if (customUIs.length === 0) return;
    const hits = customUIs.filter(ui => {
        const rect = ui.getBoundingClientRect();
        return rect.width > 0 && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    });
    if (hits.length === 0) return;
    const ui = pickTopmostUI(hits, e.clientX, e.clientY);
    e.preventDefault();
    e.stopPropagation();
    if (ui.classList.contains('veritai-check-btn')) ui.click();
    else if (ui.classList.contains('veritai-status-badge') && ui.onclick) ui.onclick(e);
}, true);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "clear_cache_and_rescan") {
        // 서버의 내 검사 기록을 먼저 지우고, 성공했을 때만 이 탭의 캐시와 화면을 초기화한다
        (async () => {
            try {
                const today = new Date().toLocaleDateString();
                const deletion = await clearDetectionCacheFlow({
                    getStoredRequestIds: getStoredDetectionRequestIds,
                    deleteRecords: deleteDetectionRecords,
                    clearStoredRequestIds: clearStoredDetectionRequestIds,
                    clearMemoryCache: () => {
                        scanCache.forEach(releaseFrameUrl);
                        scanCache.clear();
                        scannedMediaKeys.clear();
                    },
                    clearUi: clearAllUI,
                    resetStatistics: () => chrome.storage.local.set({
                        veritai_stat_date: today,
                        veritai_stat_scanned: 0,
                        veritai_stat_blocked: 0,
                    }),
                    reattachUi: () => {
                        if (settings.isSystemOn) {
                            injectDropzone();
                            document.querySelectorAll('img, video').forEach(media => attachUI(media));
                        }
                    },
                });
                sendResponse({ success: true, deletion });
            } catch (error) {
                sendResponse({
                    success: false,
                    status: error?.status,
                    message: cacheDeletionErrorMessage(error),
                });
            }
        })();
        return true; // 답장을 비동기로 보낸다 (팝업이 결과를 기다림)
    }
    else if (request.action === "context_menu_inspect") {
        const targetSrc = request.srcUrl;
        const mediaElements = Array.from(document.querySelectorAll('img, video'));
        const foundMedia = mediaElements.find(m => m.src === targetSrc || m.currentSrc === targetSrc);

        if (foundMedia && isVisibleMedia(foundMedia)) {
            foundMedia.scrollIntoView({ behavior: 'smooth', block: 'center' });
            foundMedia.dataset.forceInspect = "true";
            const foundUrl = foundMedia.currentSrc || foundMedia.src;
            const isFinishedVideo = foundMedia.tagName === "VIDEO" && foundMedia.dataset.veritaiScanned === "true" && foundUrl && scanCache.has(foundUrl);
            if (isFinishedVideo) reinspectMedia(foundMedia);
            else startInspection(foundMedia);
        } else {
            analyzeStandaloneMedia(targetSrc, request.mediaType === "video");
        }
    }
    // 우클릭 검사는 답장이 없으므로 return true 를 하지 않는다 (하면 크롬이 '응답 없이 연결 닫힘' 오류를 남긴다)
});