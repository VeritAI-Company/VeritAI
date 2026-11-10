import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_MESSAGE, INVALID_RESULT_CODE, INVALID_RESULT_MESSAGE, aiUnavailableDetail, isAiUnavailable, isValidResult, readDeepfakeFlag } from '../../shared/judgment.js';
import { GLOBAL_AD_SELECTOR } from '../config/constants';
import { captureImageBlob, captureVideoBlob } from '../core/capture.js';
import { sendToBackend } from '../core/network.js';
import { updateStatusBadge } from './badge.js';
import { getFromCache, getMediaKey, manageMemoryCache, releaseFrameUrl, scanCache, scannedMediaKeys, setToCache } from './cache.js';
import { clearMediaHighlight, getCheckButton, removeMediaUI, shouldInspectMedia } from './dom.js';
import { attachUI } from './observers.js';
import { hideMediaUI, isCoveredByOtherMedia, suppressOverlappingButtons } from './overlap.js';
import { isUserRequested, runWithInspectionLimit } from './queue.js';
import { settings } from './state.js';

export function reinspectMedia(media) {
    const mediaUrl = media.currentSrc || media.src;
    if (mediaUrl && scanCache.has(mediaUrl)) {
        releaseFrameUrl(scanCache.get(mediaUrl));
        scanCache.delete(mediaUrl);
    }
    if (media.dataset.veritaiScanKey) scannedMediaKeys.delete(media.dataset.veritaiScanKey);
    delete media.dataset.veritaiScanned;
    delete media.dataset.veritaiScanKey;
    delete media.dataset.veritaiFadedOut;
    removeMediaUI(media);
    clearMediaHighlight(media);
    media.dataset.veritaiUserRequest = "true";
    startInspection(media);
}

export async function startInspection(media) {
    if (!settings.isSystemOn && media.dataset.forceInspect !== "true") return;
    if (!isUserRequested(media) && !shouldInspectMedia(media, { auto: true })) return;
    if (!isUserRequested(media) && (media.dataset.veritaiSuppressed === "true" || isCoveredByOtherMedia(media))) {
        hideMediaUI(media);
        return;
    }
    if (media.dataset.veritaiScanned === "true") return;

    const mediaUrl = media.currentSrc || media.src;
    const scanKey = getMediaKey(media);

    if (mediaUrl && scanCache.has(mediaUrl)) {
        media.dataset.veritaiScanned = "true";
        media.dataset.veritaiScanKey = scanKey;
        scannedMediaKeys.add(scanKey);
        const cachedData = getFromCache(mediaUrl);
        updateStatusBadge(media, readDeepfakeFlag(cachedData.result) ? "fake" : "real", cachedData);
        return;
    }

    if (scannedMediaKeys.has(scanKey)) return;
    scannedMediaKeys.add(scanKey);
    manageMemoryCache();
    media.dataset.veritaiScanned = "true";
    media.dataset.veritaiScanKey = scanKey;

    const checkBtn = getCheckButton(media);
    if (checkBtn) checkBtn.remove();
    suppressOverlappingButtons(media);

    updateStatusBadge(media, "waiting");

    return runWithInspectionLimit(async () => {
        updateStatusBadge(media, "loading");

        if (mediaUrl && scanCache.has(mediaUrl)) {
            const cachedData = getFromCache(mediaUrl);
            if (readDeepfakeFlag(cachedData.result)) updateStatusBadge(media, "fake", cachedData);
            else updateStatusBadge(media, "real", cachedData);
            return;
        }

        let blob;
        let mediaType = "image";
        let frameTime = null;
        if (media.tagName === "VIDEO") {
            frameTime = media.currentTime;
            blob = await captureVideoBlob(media);
            mediaType = "video_frame";
        } else {
            blob = await captureImageBlob(mediaUrl);
        }

        const response = await sendToBackend(blob, mediaType);

        if (!media.dataset.veritaiScanned) return;

        rememberAiStatus(!isAiUnavailable(response.result));
        // AI 모델이 돌지 않은 결과는 '정상'으로 보여 주지 않고, 캐시와 통계에도 넣지 않는다 (오류로 처리해 다시 시도할 수 있게)
        if (isAiUnavailable(response.result)) {
            console.warn('[VeritAI] AI 모델이 동작하지 않아 판정하지 못했습니다:', aiUnavailableDetail(response.result));
            const aiError = new Error(AI_UNAVAILABLE_MESSAGE);
            aiError.code = AI_UNAVAILABLE_CODE;
            throw aiError;
        }
        if (!isValidResult(response.result)) {
            console.warn('[VeritAI] 결과 형식이 올바르지 않아 판정으로 쓰지 않았습니다:', response.result);
            const formatError = new Error(INVALID_RESULT_MESSAGE);
            formatError.code = INVALID_RESULT_CODE;
            throw formatError;
        }

        delete media.dataset.veritaiUserRequest;
        const data = { ...response, frameUrl: URL.createObjectURL(blob), frameTime };

        if (mediaUrl) setToCache(mediaUrl, data);

        const isFake = readDeepfakeFlag(data.result);

        recordInspectionStat(isFake);

        if (isFake) updateStatusBadge(media, "fake", data);
        else updateStatusBadge(media, "real", data);
    }, media).catch((err) => {
        const userRequested = media.dataset.veritaiUserRequest === "true" || media.dataset.forceInspect === "true";
        delete media.dataset.veritaiUserRequest;
        if (!settings.isSystemOn) return;

        if (err && err.isCancelled) {
            delete media.dataset.veritaiScanned;
            delete media.dataset.veritaiAttached;
            if (media.dataset.veritaiScanKey) {
                scannedMediaKeys.delete(media.dataset.veritaiScanKey);
                delete media.dataset.veritaiScanKey;
            }
            removeMediaUI(media);
            attachUI(media);
            return;
        }

        const isLikelyAd = (window !== window.top) || media.closest(GLOBAL_AD_SELECTOR);
        const errMessage = err?.message || "";
        const isBlocked = errMessage.includes("CORS") || errMessage.includes("보안 차단됨");

        if (!userRequested && (isBlocked || (err?.name === 'TypeError' && errMessage === 'Failed to fetch' && isLikelyAd))) {
            delete media.dataset.veritaiScanned;
            delete media.dataset.veritaiScanKey;
            removeMediaUI(media);
            return;
        }

        let friendlyMessage = "검사하지 못했습니다.";
        if (err?.code === AI_UNAVAILABLE_CODE) friendlyMessage = "AI 판정 실패";
        else if (err?.code === INVALID_RESULT_CODE) friendlyMessage = "결과를 읽을 수 없습니다.";
        else if (isBlocked) friendlyMessage = media.tagName === "VIDEO" ? "이 사이트 영상은 검사할 수 없습니다." : "이 사이트 사진은 검사할 수 없습니다.";
        else if (err?.status === 429) friendlyMessage = "요청이 많습니다.";
        else if (err?.status === 408) friendlyMessage = "응답이 늦습니다.";
        else if (err?.status >= 500) friendlyMessage = "서버 오류가 났습니다.";
        else if (err?.name === 'TypeError' && errMessage === 'Failed to fetch') {
            friendlyMessage = "서버에 연결할 수 없습니다.";
        }
        else if (err?.status === 400 || err?.status === 415) friendlyMessage = "지원하지 않는 형식입니다.";

        updateStatusBadge(media, "error", { message: friendlyMessage });
        delete media.dataset.veritaiScanned;
        if (media.dataset.veritaiScanKey) {
            scannedMediaKeys.delete(media.dataset.veritaiScanKey);
            delete media.dataset.veritaiScanKey;
        }
    });
}

// 팝업의 서버 상태 표시가 읽는 값. 상태가 바뀔 때만 저장한다 (저장할 때마다 모든 탭에 변경 알림이 가기 때문)
let lastAiOk = null;
function rememberAiStatus(ok) {
    if (lastAiOk === ok) return;
    lastAiOk = ok;
    chrome.storage.local.set({ veritai_ai_status: { ok, at: Date.now() } });
}

// 실제 더하기는 백그라운드가 순서대로 한다 (background.js의 recordInspectionStat)
function recordInspectionStat(isFake) {
    try {
        chrome.runtime.sendMessage({ action: "record_stat", isFake }, () => void chrome.runtime.lastError);
    } catch { /* 확장 연결이 끊긴 탭이면 통계만 건너뛴다 */ }
}
