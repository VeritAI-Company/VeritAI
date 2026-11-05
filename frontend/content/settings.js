import { readDeepfakeFlag } from '../../shared/judgment.js';
import { clearPendingPolls } from '../core/network.js';
import { updateStatusBadge } from './badge.js';
import { scanCache, scannedMediaKeys } from './cache.js';
import { clearMediaHighlight, ensureWrapper, getBadge, getCheckButton, getShadowHost, getUIContainer, restorePagePositions } from './dom.js';
import { injectDropzone } from './dropzone.js';
import { DOM_OBSERVER_OPTIONS, attachUI, autoScanObserver, domObserver } from './observers.js';
import { pendingInspectionQueue } from './queue.js';
import { closeAllReportBoxes } from './report/report.js';
import { SETTING_KEYS, settings } from './state.js';

export function clearAllUI() {
    document.querySelectorAll('img, video').forEach(media => {
        if (media.dataset.veritaiId) clearMediaHighlight(media);
        delete media.dataset.veritaiScanned;
        delete media.dataset.veritaiAttached;
        delete media.dataset.veritaiScanKey;
        delete media.dataset.veritaiFadedOut;
        delete media.dataset.veritaiSuppressed;
    });
    document.querySelectorAll('veritai-host, .veritai-check-btn').forEach(el => el.remove());
    scannedMediaKeys.clear();
    closeAllReportBoxes(true);
    const hint = document.getElementById('veritai-mini-hint');
    if (hint) hint.remove();
    const wrapper = document.getElementById('veritai-dropzone-wrapper');
    if (wrapper) wrapper.remove();
    document.querySelectorAll('.veritai-standalone-modal').forEach(m => (m.veritaiClose ? m.veritaiClose() : m.remove()));
    restorePagePositions();
}

export function applySettingChanges(changes) {
    if (!SETTING_KEYS.some(key => key in changes)) return;

    let modeChanged = false;

    if (changes.isSystemOn) settings.isSystemOn = changes.isSystemOn.newValue;
    if (changes.isAutoScanOn) {
        settings.isAutoScanMode = changes.isAutoScanOn.newValue;
        modeChanged = true;
    }

    if (changes.isCleanUIMode) {
        settings.isCleanUIMode = changes.isCleanUIMode.newValue;
        document.querySelectorAll('img, video').forEach(media => {
            if (media.dataset.veritaiScanned === "true") {
                const mediaUrl = media.currentSrc || media.src;
                if (mediaUrl && scanCache.has(mediaUrl)) {
                    const data = scanCache.get(mediaUrl);
                    if (!readDeepfakeFlag(data.result)) {
                        const wrapper = ensureWrapper(media);
                        if (wrapper) {
                            const uiContainer = getUIContainer(media);

                            if (settings.isCleanUIMode) {
                                if (uiContainer) {
                                    uiContainer.style.transition = "opacity 0.5s ease-out";
                                    uiContainer.style.opacity = "0";
                                    setTimeout(() => { if (uiContainer && settings.isCleanUIMode) uiContainer.style.display = "none"; }, 300);
                                }
                            } else {
                                delete media.dataset.veritaiFadedOut;
                                if (uiContainer) {
                                    uiContainer.style.display = "flex";
                                    uiContainer.style.opacity = "1";
                                } else {
                                    updateStatusBadge(media, "real", data);
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    if (!settings.isSystemOn) {
        while (pendingInspectionQueue.length > 0) {
            pendingInspectionQueue.shift().reject(new Error("시스템 중지됨"));
        }
        clearPendingPolls();
        autoScanObserver.disconnect();
        domObserver.disconnect();
        clearAllUI();
    } else {
        injectDropzone();
        if (modeChanged) {
            if (!settings.isAutoScanMode) {
                while (pendingInspectionQueue.length > 0) {
                    const cancelErr = new Error("수동 모드 전환으로 인한 취소");
                    cancelErr.isCancelled = true;
                    pendingInspectionQueue.shift().reject(cancelErr);
                }
            }

            document.querySelectorAll('img, video').forEach(media => {
                if (!settings.isAutoScanMode && media.dataset.veritaiScanned === "true") {
                    const badge = getBadge(media);
                    if (badge && badge.innerHTML.includes("veritai-spin")) {
                        delete media.dataset.veritaiScanned;
                        if (media.dataset.veritaiScanKey) {
                            scannedMediaKeys.delete(media.dataset.veritaiScanKey);
                            delete media.dataset.veritaiScanKey;
                        }
                        const host = getShadowHost(media);
                        if (host) host.remove();
                    }
                }

                if (!media.dataset.veritaiScanned) {
                    const btn = getCheckButton(media);
                    if (btn) btn.remove();
                    autoScanObserver.unobserve(media);
                    delete media.dataset.veritaiAttached;
                }
            });
        }
        document.querySelectorAll('img, video').forEach(media => attachUI(media));
        domObserver.observe(document.body, DOM_OBSERVER_OPTIONS);
    }
}

// 확장을 새로고침하거나 업데이트하면, 이미 열려 있던 탭의 예전 스크립트는 확장과 연결이 끊겨 설정 변경을 받지 못한다.
// 그 상태로 버튼과 배지가 남지 않도록, 연결이 끊긴 것을 알아채면 화면을 정리하고 멈춘다
let isOrphaned = false;
let orphanCheckTimer = null;

function isExtensionAlive() {
    try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; }
}

function teardownOrphan() {
    if (isOrphaned) return;
    isOrphaned = true;
    settings.isSystemOn = false;
    if (orphanCheckTimer) clearInterval(orphanCheckTimer);
    while (pendingInspectionQueue.length > 0) {
        pendingInspectionQueue.shift().reject(new Error("확장 연결 끊김"));
    }
    try { clearPendingPolls(); } catch { /* 이미 끊긴 상태라 무시 */ }
    autoScanObserver.disconnect();
    domObserver.disconnect();
    clearAllUI();
}

// 탭을 다시 볼 때 저장된 설정과 화면 상태를 맞춘다 (백그라운드에서 놓친 변경이 있어도 바로잡는다)
export function startOrphanWatch() {
    orphanCheckTimer = setInterval(() => { if (!isExtensionAlive()) teardownOrphan(); }, 3000);
}

export function syncSettingsFromStorage() {
    if (isOrphaned) return;
    if (!isExtensionAlive()) { teardownOrphan(); return; }
    try {
        chrome.storage.local.get(SETTING_KEYS, (result) => {
            if (chrome.runtime.lastError || !result) return;
            const latest = {
                isSystemOn: result.isSystemOn !== false,
                isAutoScanOn: result.isAutoScanOn || false,
                isCleanUIMode: result.isCleanUIMode || false,
            };
            const current = { isSystemOn: settings.isSystemOn, isAutoScanOn: settings.isAutoScanMode, isCleanUIMode: settings.isCleanUIMode };
            const changes = {};
            SETTING_KEYS.forEach(key => {
                if (latest[key] !== current[key]) changes[key] = { newValue: latest[key] };
            });
            if (Object.keys(changes).length > 0) applySettingChanges(changes);
        });
    } catch {
        teardownOrphan();
    }
}
