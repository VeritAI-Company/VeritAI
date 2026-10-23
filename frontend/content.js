import { FEEDBACK_URL, MAX_CONCURRENT_INSPECTIONS, MAX_CACHE_SIZE, GLOBAL_AD_SELECTOR } from './config/constants';
import { injectCSS, VERITAI_CORE_CSS } from './ui/styles.js';
import { captureImageBlob, captureVideoBlob } from './core/capture.js';
import { sendToBackend, clearPendingPolls } from './core/network.js';

console.log("VeritAI content script loaded");

const scanCache = new Map();
let isSystemOn = true;
let isAutoScanMode = false;
let isCleanUIMode = false; 
const scannedMediaKeys = new Set();
let activeInspectionCount = 0;
const pendingInspectionQueue = [];
let mutationQueue = [];
let observerDebounceTimer = null;

const DOM_OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset']
};
const MUTATION_QUEUE_LIMIT = 2000;

const SETTING_KEYS = ['isSystemOn', 'isAutoScanOn', 'isCleanUIMode'];

injectCSS();

function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

function closeAllReportBoxes(force = false, exceptionSrc = null) {
    document.querySelectorAll('.veritai-details-box').forEach(box => {
        if (exceptionSrc && box.dataset.targetMedia === exceptionSrc) return;
        if (!force && (box.dataset.isDragged === "true" || box.dataset.isFeedbackActive === "true")) return;
        if (box.cleanupListeners) box.cleanupListeners();
        box.remove();
    });
}

function getFromCache(key) {
    if (!scanCache.has(key)) return null;
    const value = scanCache.get(key);
    scanCache.delete(key);
    scanCache.set(key, value); 
    return value;
}

function releaseFrameUrl(value) {
    if (value && value.frameUrl) URL.revokeObjectURL(value.frameUrl);
}

function setToCache(key, value) {
    if (scanCache.has(key)) {
        const prev = scanCache.get(key);
        if (prev !== value && prev?.frameUrl !== value?.frameUrl) releaseFrameUrl(prev);
        scanCache.delete(key);
    }
    scanCache.set(key, value);
    if (scanCache.size > MAX_CACHE_SIZE) {
        const oldestKey = scanCache.keys().next().value;
        releaseFrameUrl(scanCache.get(oldestKey));
        scanCache.delete(oldestKey);
    }
}

function manageMemoryCache() {
    if (scannedMediaKeys.size > MAX_CACHE_SIZE) scannedMediaKeys.delete(scannedMediaKeys.keys().next().value);
}

function getMediaSource(media) {
    if (!media) return "";
    return media.currentSrc || media.src || media.poster || "";
}

function getMediaKey(media) {
    const source = getMediaSource(media);
    if (source) return `${media.tagName}:${source}`;
    const rect = media.getBoundingClientRect();
    return `${media.tagName}:${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
}

let veritaiIdCounter = 0;

function getMediaId(media) {
    if (!media.dataset.veritaiId) media.dataset.veritaiId = `v${++veritaiIdCounter}`;
    return media.dataset.veritaiId;
}

function findOwnedElement(media, selector) {
    const wrapper = ensureWrapper(media);
    if (!wrapper) return null;
    return wrapper.querySelector(`${selector}[data-veritai-for="${getMediaId(media)}"]`);
}

function getShadowHost(media) {
    return findOwnedElement(media, 'veritai-host');
}

function getCheckButton(media) {
    return findOwnedElement(media, '.veritai-check-btn');
}

function getUIContainer(media) {
    const host = getShadowHost(media);
    return host && host.shadowRoot ? host.shadowRoot.querySelector('.veritai-ui-container') : null;
}

function getBadge(media) {
    const host = getShadowHost(media);
    return host && host.shadowRoot ? host.shadowRoot.querySelector('.veritai-status-badge') : null;
}

function getAllBadges() {
    return Array.from(document.querySelectorAll('veritai-host'))
        .map(host => host.shadowRoot && host.shadowRoot.querySelector('.veritai-status-badge'))
        .filter(Boolean);
}

function positionOverlay(el, media, inset = 0) {
    const wrapper = el.parentElement;
    if (!wrapper || !media.isConnected) return;
    const mediaRect = media.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const top = mediaRect.top - wrapperRect.top - wrapper.clientTop + wrapper.scrollTop + inset;
    const left = mediaRect.left - wrapperRect.left - wrapper.clientLeft + wrapper.scrollLeft + inset;
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
}

function removeMediaUI(media) {
    const host = getShadowHost(media);
    if (host) host.remove();
    const btn = getCheckButton(media);
    if (btn) btn.remove();
}

function clearMediaHighlight(media) {
    media.style.border = '';
    media.style.boxShadow = '';
}

function isVisibleMedia(media) {
    if (!media || !media.isConnected) return false;
    const rect = media.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) return false;
    const style = getComputedStyle(media);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function shouldInspectMedia(media) {
    if (media.closest('.veritai-details-box') || media.closest('.veritai-ui-container')) return false;
    if (window !== window.top) return false;
    if (media.closest(GLOBAL_AD_SELECTOR)) return false;
    const url = (media.src || media.currentSrc || "").toLowerCase();
    const adUrls = ['/ads/', '/ad/', 'doubleclick.net', 'googlesyndication', 'adservice', 'adsystem'];
    if (adUrls.some(ad => url.includes(ad))) return false;
    return isVisibleMedia(media);
}

function readDeepfakeFlag(result) {
    if (!result) return false;
    return Boolean(result.isDeepfake ?? result.deepfake);
}

function getFaceFakeProb(face) {
    const value = face?.cnn?.fakeProbability ?? face?.fakeProbability;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const FACE_CAUTION_MIN = 0.3;
const FACE_FAKE_MIN = 0.5;
const FACE_DETECTION_MIN = 0.5;

function getFaceColor(prob) {
    if (prob == null) return "#94a3b8";
    if (prob >= FACE_FAKE_MIN) return "#ef4444";
    if (prob >= FACE_CAUTION_MIN) return "#f59e0b";
    return "#10b981";
}

function selectVisibleFaces(faces, showAll) {
    const entries = faces.map((face, index) => ({ face, index }));
    if (showAll) return { visible: entries, hidden: 0 };
    let top = null;
    entries.forEach(entry => {
        const prob = getFaceFakeProb(entry.face);
        if (prob != null && (!top || prob > getFaceFakeProb(top.face))) top = entry;
    });
    const visible = entries.filter(entry => {
        const det = entry.face.detectionConfidence;
        return entry === top || typeof det !== 'number' || det >= FACE_DETECTION_MIN;
    });
    if (visible.length === 0 && entries.length > 0) visible.push(entries[0]);
    return { visible, hidden: entries.length - visible.length };
}

function pickHeatmapFace(result, faces) {
    const views = Array.isArray(result?.cnn?.views) ? result.cnn.views : [];
    if (views.length > 0) {
        const best = views.reduce((a, b) => ((b.fakeProbability ?? 0) > (a.fakeProbability ?? 0) ? b : a));
        if (best.name === 'full') return null;
        const match = /^face_(\d+)$/.exec(best.name || '');
        if (match && faces[Number(match[1]) - 1]) return faces[Number(match[1]) - 1];
    }
    let target = null;
    let maxScore = -1;
    faces.forEach(face => {
        const score = getFaceFakeProb(face) ?? -1;
        if (score > maxScore) { maxScore = score; target = face; }
    });
    if (target) return target;
    return faces.reduce((a, b) => ((b.detectionConfidence ?? 0) > (a?.detectionConfidence ?? -1) ? b : a), null);
}

function getOwnerMedia(ui) {
    const host = ui.classList.contains('veritai-check-btn') ? ui : ui.getRootNode()?.host;
    const id = host?.dataset?.veritaiFor;
    return id ? document.querySelector(`img[data-veritai-id="${id}"], video[data-veritai-id="${id}"]`) : null;
}

function pickTopmostUI(hits, x, y) {
    if (hits.length === 1) return hits[0];
    const stack = document.elementsFromPoint(x, y);
    let best = hits[hits.length - 1];
    let bestRank = Infinity;
    hits.forEach(ui => {
        const media = getOwnerMedia(ui);
        const rank = media ? stack.indexOf(media) : -1;
        if (rank >= 0 && rank < bestRank) { bestRank = rank; best = ui; }
    });
    return best;
}

function isSameSpot(a, b) {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    if (!ra.width || !rb.width) return false;
    return Math.abs(ra.left - rb.left) < 4 && Math.abs(ra.top - rb.top) < 4
        && Math.abs(ra.width - rb.width) < 4 && Math.abs(ra.height - rb.height) < 4;
}

function rectArea(rect) {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function isBehind(other, media) {
    const mr = media.getBoundingClientRect();
    const or = other.getBoundingClientRect();
    if (!mr.width || !or.width) return false;
    const sameSpot = isSameSpot(other, media);
    const cx = mr.left + mr.width / 2;
    const cy = mr.top + mr.height / 2;
    if (!sameSpot && (cx < or.left || cx > or.right || cy < or.top || cy > or.bottom)) return false;
    const inViewport = cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight;
    const stack = inViewport ? document.elementsFromPoint(cx, cy) : [];
    const mediaRank = stack.indexOf(media);
    const otherRank = stack.indexOf(other);
    if (mediaRank !== -1 && otherRank !== -1) return otherRank > mediaRank;
    if (mediaRank !== -1) return true;
    if (otherRank !== -1) return false;
    if (sameSpot) return Boolean(other.compareDocumentPosition(media) & Node.DOCUMENT_POSITION_FOLLOWING);
    return rectArea(or) > rectArea(mr);
}

function suppressMedia(owner) {
    const btn = getCheckButton(owner);
    if (btn) btn.remove();
    owner.dataset.veritaiSuppressed = "true";
    autoScanObserver.unobserve(owner);
}

function suppressOverlappingButtons(media) {
    document.querySelectorAll('.veritai-check-btn').forEach(btn => {
        const owner = getOwnerMedia(btn);
        if (!owner || owner === media || !isBehind(owner, media)) return;
        suppressMedia(owner);
    });
}

function isCoveredByOtherMedia(media) {
    const mr = media.getBoundingClientRect();
    if (!mr.width) return false;
    return Array.from(document.querySelectorAll('img, video')).some(other => {
        if (other === media || !other.isConnected) return false;
        const or = other.getBoundingClientRect();
        if (!or.width || or.right < mr.left || or.left > mr.right || or.bottom < mr.top || or.top > mr.bottom) return false;
        if (!isVisibleMedia(other)) return false;
        return isBehind(media, other);
    });
}

function hideMediaUI(media) {
    removeMediaUI(media);
    clearMediaHighlight(media);
    media.dataset.veritaiSuppressed = "true";
    autoScanObserver.unobserve(media);
}

function hideCoveredUIs(topMedia) {
    const owners = new Set();
    document.querySelectorAll('veritai-host, .veritai-check-btn').forEach(el => {
        const id = el.dataset.veritaiFor;
        if (!id || id === topMedia.dataset.veritaiId) return;
        const owner = document.querySelector(`img[data-veritai-id="${id}"], video[data-veritai-id="${id}"]`);
        if (owner) owners.add(owner);
    });
    owners.forEach(owner => {
        if (owner.dataset.forceInspect === "true") return;
        if (isBehind(owner, topMedia)) hideMediaUI(owner);
    });
}

function isBehindInspectedMedia(media) {
    return Array.from(document.querySelectorAll('veritai-host')).some(host => {
        const id = host.dataset.veritaiFor;
        if (!id || id === media.dataset.veritaiId) return false;
        const inspected = document.querySelector(`img[data-veritai-id="${id}"], video[data-veritai-id="${id}"]`);
        return Boolean(inspected && inspected.isConnected && isBehind(media, inspected));
    });
}

function isUserRequested(media) {
    return media.dataset.veritaiUserRequest === "true" || media.dataset.forceInspect === "true";
}

function getInspectionPriority(media) {
    if (!media || !media.isConnected) return -1;
    const rect = media.getBoundingClientRect();
    const viewportOverlap = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    return (viewportOverlap ? 1_000_000 : 0) + Math.min(area, 999_999);
}

function runWithInspectionLimit(task, media = null) {
    return new Promise((resolve, reject) => {
        pendingInspectionQueue.push({ task, media, resolve, reject });
        if (isAutoScanMode) {
            pendingInspectionQueue.sort((a, b) => getInspectionPriority(b.media) - getInspectionPriority(a.media));
        }
        drainInspectionQueue();
    });
}

function drainInspectionQueue() {
    while (activeInspectionCount < MAX_CONCURRENT_INSPECTIONS && pendingInspectionQueue.length > 0) {
        const next = pendingInspectionQueue.shift();
        if (next.media && (!next.media.isConnected || (!isUserRequested(next.media) && !shouldInspectMedia(next.media)))) {
            next.reject(new Error("검사 대상이 화면에서 사라졌습니다."));
            continue;
        }
        activeInspectionCount += 1;
        Promise.resolve().then(next.task).then(next.resolve, next.reject).finally(() => {
            activeInspectionCount -= 1;
            drainInspectionQueue();
        });
    }
}

function updateStatusBadge(media, status, data = null) {
    if (!isSystemOn && media.dataset.forceInspect !== "true") return; 
    if (media.dataset.veritaiSuppressed === "true" && media.dataset.forceInspect !== "true") return;
    if (status === "real" && isCleanUIMode && media.dataset.veritaiFadedOut === "true") return;
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
    media.style.border = "none";

    if (status === "loading") {
        uiContainer.style.display = 'flex';
        uiContainer.style.opacity = '1';
        badge.innerHTML = `
            <div style="display: inline-flex; align-items: center; gap: 6px; white-space: nowrap !important; flex-wrap: nowrap !important;">
                <div class="veritai-spinner" style="flex-shrink: 0; display: inline-block;"></div>
                <span style="font-family: sans-serif; font-size: 11px; font-weight: bold; color: white; white-space: nowrap !important;">분석 중...</span>
            </div>`;
        badge.style.background = "rgba(59, 130, 246, 0.9)";
        badge.style.whiteSpace = "nowrap";
    }
    else if (status === "waiting") {
        uiContainer.style.display = 'flex';
        uiContainer.style.opacity = '1';
        badge.innerHTML = '<span style="white-space: nowrap;">대기 중...</span>';
        badge.style.background = "rgba(100, 116, 139, 0.9)"; 
        badge.style.whiteSpace = "nowrap";
    }
    else if (status === "error") {
        uiContainer.style.display = 'flex';
        uiContainer.style.opacity = '1';
        badge.textContent = '';
        const errorText = document.createElement('span');
        errorText.textContent = data?.message || "분석 실패";
        const retryText = document.createElement('span');
        retryText.style.cssText = 'margin-left: 4px; font-size: 12px; cursor:pointer;';
        retryText.textContent = '🔄 재시도';
        badge.append(errorText, retryText);
        badge.style.background = "rgba(100, 116, 139, 0.9)";
        badge.style.cursor = "pointer";
        
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
        badge.style.cursor = "pointer";
        const targetMediaSrc = media.currentSrc || media.src || "unknown_media";
        const reportImageSrc = data?.frameUrl || targetMediaSrc;

        if (status === "fake") {
            uiContainer.style.display = 'flex';
            uiContainer.style.opacity = '1';
            const conf = ((data.result.confidence || 0) * 100).toFixed(1);
            badge.innerText = `🚨 조작 의심 (${conf}%)`;
            badge.style.background = "rgba(239, 68, 68, 0.95)";
            badge.style.whiteSpace = "nowrap";
            media.style.border = "2px solid rgba(239, 68, 68, 0.9)";
            media.style.boxShadow = "0 0 20px 5px rgba(239, 68, 68, 0.6)"; 
        } else {
            media.style.transition = "box-shadow 1s ease-out"; 
            media.style.boxShadow = "0 0 15px 3px rgba(16, 185, 129, 0.6)"; 
            setTimeout(() => { if(media.isConnected) media.style.boxShadow = "none"; }, 1500);

            uiContainer.style.display = 'flex';
            uiContainer.style.opacity = '1';
            badge.innerText = "✓";
            badge.style.background = "rgba(16, 185, 129, 0.8)";
            badge.style.width = "18px";
            badge.style.height = "18px";
            badge.style.borderRadius = "50%";
            badge.style.display = "flex";
            badge.style.justifyContent = "center";
            badge.style.alignItems = "center";
            badge.style.padding = "0";

            if (isCleanUIMode) {
                if (media.dataset.veritaiFadedOut === "true") {
                    uiContainer.style.opacity = "0";
                    uiContainer.style.display = "none";
                } else {
                    setTimeout(() => {
                        if (!isCleanUIMode) return; 
                        if (uiContainer && uiContainer.parentNode) {
                            uiContainer.style.transition = "opacity 0.5s ease-out";
                            uiContainer.style.opacity = "0";
                            setTimeout(() => { 
                                if (uiContainer && uiContainer.parentNode && isCleanUIMode) {
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
        
        const showReportBox = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            
            let existingBox = null;
            document.querySelectorAll('.veritai-details-box').forEach(box => {
                if (box.dataset.targetMedia === targetMediaSrc) {
                    existingBox = box;
                }
            });

            if (existingBox) return existingBox;

            closeAllReportBoxes(false, targetMediaSrc);

            const result = data.result;
            const faces = result.faces || [];
            const isVideoMedia = media.tagName === "VIDEO";

            let showAllFaces = false;
            const buildFaceListHTML = () => {
                if (faces.length === 0) {
                    return "<div style='text-align:center; color:#94a3b8; padding: 10px 0; font-size: 11px;'>전체 이미지 분석 완료</div>";
                }
                const { visible, hidden } = selectVisibleFaces(faces, showAllFaces);
                const cards = visible.map(({ face: f, index: i }) => {
                    const bbox = f.bbox || {};
                    const quality = f.quality || {};
                    const detConf = ((f.detectionConfidence || f.score || 0) * 100).toFixed(1);
                    const faceProb = getFaceFakeProb(f);
                    const faceColor = getFaceColor(faceProb);
                    const probText = faceProb == null ? '-' : `${(faceProb * 100).toFixed(1)}%`;
                    return `
                    <div style="background: rgba(0, 0, 0, 0.2); padding: 8px 10px; border-radius: 6px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                            <span style="color:${faceColor}; font-weight:bold; font-size: 11.5px;">[얼굴 ${i + 1}]</span>
                            <span style="color:${faceColor}; font-weight:bold; font-size: 11.5px;">조작 확률 ${probText}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; color: #cbd5e1; font-size: 11px; line-height: 1.3;">
                            <div>• 유형: <span style="color:#fff">${escapeHTML(f.faceMode) || '?'}</span></div>
                            <div>• 검출률: <span style="color:#fff">${detConf}%</span></div>
                            <div>• 크기: <span style="color:#fff">${bbox.w ?? '?'}x${bbox.h ?? '?'}</span></div>
                            <div>• 품질: <span style="color:#fff">${escapeHTML(quality.label) || '?'}</span></div>
                        </div>
                    </div>`;
                }).join("");
                let toggle = '';
                if (hidden > 0) toggle = `<div class="veritai-face-toggle" role="button" tabindex="0" style="text-align:center; color:#93c5fd; font-size: 11px; cursor:pointer; padding: 2px 0 6px;">검출 신뢰도 낮은 얼굴 ${hidden}개 숨김 · 모두 보기</div>`;
                else if (showAllFaces && selectVisibleFaces(faces, false).hidden > 0) toggle = `<div class="veritai-face-toggle" role="button" tabindex="0" style="text-align:center; color:#93c5fd; font-size: 11px; cursor:pointer; padding: 2px 0 6px;">주요 얼굴만 보기</div>`;
                return cards + toggle;
            };

            const detailsBox = document.createElement('div');
            detailsBox.className = `veritai-details-box unpinned ${status === "fake" ? "fake-border" : "real-border"}`;
            detailsBox.dataset.targetMedia = targetMediaSrc;
            detailsBox.dataset.isFeedbackActive = "false"; 

            detailsBox.innerHTML = `
<div class="veritai-drag-handle" style="color:lightskyblue; font-weight:bold; margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; font-size:14px; display:flex; justify-content:space-between; align-items: center; cursor: grab; user-select: none;">
    <span><span style="opacity: 0.4; margin-right: 6px; font-size: 12px; cursor: grab;">⋮⋮</span>🔍 분석 리포트</span>
    <span class="veritai-close-btn" tabindex="0" role="button" aria-label="닫기" style="cursor:pointer; color:#94a3b8; padding: 0 5px; font-size: 16px;">✕</span>
</div>
<div style="display: flex; flex-direction: column; gap: 6px;">
    <div><b>ID:</b> <span style="color:#e2e8f0;">${escapeHTML(data.requestId) || 'N/A'}</span></div>
    <div><b>판정:</b> ${readDeepfakeFlag(result) ? "<span style='color:#ef4444; font-weight:bold;'>조작 의심</span>" : "<span style='color:#10b981; font-weight:bold;'>정상</span>"}</div>
    ${isVideoMedia && data.frameTime != null ? `<div><b>검사 장면:</b> <span style="color:#e2e8f0;">영상 ${formatFrameTime(data.frameTime)} 지점</span></div>` : ''}
</div>
<div style="margin:12px 0; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 8px; background: rgba(0,0,0,0.2);">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="font-weight: bold; font-size: 11px; color: #94a3b8;" id="veritai-visual-title">감지 영역 (기본)</div>
        <button id="veritai-toggle-xai-btn" style="font-size: 10px; padding: 2px 6px; background: #3b82f6; color: white; border: none; border-radius: 3px; cursor: pointer;" ${!result.heatmapBase64 ? 'disabled' : ''}>
            ${result.heatmapBase64 ? 'AI 분석 근거 보기' : '정상 (조작 특이점 없음)'}
        </button>
    </div>
    <div style="position: relative; width: 100%; height: 220px; background: #0f172a; border-radius: 4px; overflow: hidden; border: 1px solid #333; display: flex; align-items: center; justify-content: center;">
        <canvas id="veritai-bbox-canvas" style="position: absolute; max-width: 100%; max-height: 100%; object-fit: contain; z-index: 2;"></canvas>
        <canvas id="veritai-heatmap-canvas" style="display: none; position: absolute; max-width: 100%; max-height: 100%; object-fit: contain; z-index: 1;"></canvas>
    </div>
    <div id="veritai-slider-container" style="display: none; margin-top: 8px; align-items: center; gap: 8px;">
        <button id="veritai-heatmap-eye-btn" title="원본/히트맵 끄기 켜기" style="background: none; border: none; cursor: pointer; padding: 0; font-size: 16px; transition: opacity 0.2s;">👁️</button>
        <span style="font-size: 10px; color: #64748b;">원본</span>
        <input type="range" id="veritai-heatmap-slider" min="0" max="100" value="70" style="flex: 1; accent-color: #ef4444; cursor: pointer;">
        <span style="font-size: 10px; color: #ef4444;">히트맵</span>
    </div>
</div>
<div style="margin:12px 0; border-top:1px dashed rgba(255,255,255,0.2);"></div>
<div class="veritai-face-list">${buildFaceListHTML()}</div>
<div style="margin-top: 15px; display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px;">
    ${isVideoMedia ? `<button class="veritai-reinspect-btn" style="font-size: 11px; padding: 4px 8px; cursor: pointer; background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 4px;">🔄 현재 장면 다시 검사</button>` : ''}
    <button class="veritai-feedback-btn" style="font-size: 11px; padding: 4px 8px; cursor: pointer; background: rgba(255, 60, 60, 0.1); color: #ff6b6b; border: 1px solid rgba(255, 60, 60, 0.3); border-radius: 4px; transition: all 0.2s;">🚨 신고</button>
</div>`.trim();

            detailsBox.onclick = (evt) => evt.stopPropagation();
            detailsBox.onmouseenter = () => { detailsBox.dataset.isHovered = "true"; };
            detailsBox.onmouseleave = () => {
                detailsBox.dataset.isHovered = "false";
                setTimeout(() => {
                    if (detailsBox.dataset.isHovered !== "true" && badge.dataset.isHovered !== "true" && detailsBox.dataset.isDragged !== "true" && detailsBox.dataset.isFeedbackActive !== "true") {
                        if (detailsBox.cleanupListeners) detailsBox.cleanupListeners();
                        detailsBox.remove();
                    }
                }, 100);
            };

            document.body.appendChild(detailsBox);

            const bboxCanvas = detailsBox.querySelector('#veritai-bbox-canvas');
            const heatmapCanvas = detailsBox.querySelector('#veritai-heatmap-canvas');
            const slider = detailsBox.querySelector('#veritai-heatmap-slider');

            if (bboxCanvas && heatmapCanvas) {
                const bCtx = bboxCanvas.getContext('2d');
                const hCtx = heatmapCanvas.getContext('2d');
                const imgObj = new Image();
                
                imgObj.crossOrigin = "anonymous";
                imgObj.onerror = () => {
                    imgObj.removeAttribute("crossOrigin");
                    imgObj.onerror = null;
                    imgObj.src = reportImageSrc; 
                };

                const drawFaceBoxes = () => {
                    bCtx.clearRect(0, 0, bboxCanvas.width, bboxCanvas.height);
                    bCtx.drawImage(imgObj, 0, 0);
                    if (faces && faces.length > 0) {
                        const stage = bboxCanvas.parentElement;
                        const stageW = (stage && stage.clientWidth) || 230;
                        const stageH = (stage && stage.clientHeight) || 220;
                        const displayScale = Math.min(1, stageW / imgObj.width, stageH / imgObj.height);
                        const lineWidth = Math.max(2, 2 / displayScale);
                        const maxFont = 11 / displayScale;
                        const minFont = 9 / displayScale;
                        selectVisibleFaces(faces, showAllFaces).visible.forEach(({ face: f, index: i }) => {
                            if (f.bbox && f.bbox.w > 0) {
                                const color = getFaceColor(getFaceFakeProb(f));
                                bCtx.lineWidth = lineWidth;
                                bCtx.strokeStyle = color;
                                bCtx.strokeRect(f.bbox.x, f.bbox.y, f.bbox.w, f.bbox.h);

                                const label = String(i + 1);
                                const fontSize = Math.round(Math.min(maxFont, Math.max(minFont, Math.min(f.bbox.w, f.bbox.h) * 0.35)));
                                bCtx.font = `bold ${fontSize}px sans-serif`;
                                const padX = Math.round(fontSize * 0.3);
                                const badgeW = Math.round(bCtx.measureText(label).width + padX * 2);
                                const badgeH = Math.round(fontSize * 1.2);
                                const fitsInside = f.bbox.w >= badgeW * 2 && f.bbox.h >= badgeH * 2;
                                let badgeX = f.bbox.x + lineWidth / 2;
                                let badgeY = f.bbox.y + lineWidth / 2;
                                if (!fitsInside) {
                                    badgeX = Math.min(Math.max(0, f.bbox.x - lineWidth / 2), imgObj.width - badgeW);
                                    badgeY = f.bbox.y - lineWidth / 2 - badgeH >= 0
                                        ? f.bbox.y - lineWidth / 2 - badgeH
                                        : Math.min(imgObj.height - badgeH, f.bbox.y + f.bbox.h + lineWidth / 2);
                                }
                                bCtx.fillStyle = color;
                                bCtx.fillRect(badgeX, badgeY, badgeW, badgeH);
                                bCtx.fillStyle = "#ffffff";
                                bCtx.textBaseline = "middle";
                                bCtx.fillText(label, badgeX + padX, badgeY + badgeH / 2);
                                bCtx.textBaseline = "alphabetic";
                            }
                        });
                    }
                };

                const faceListEl = detailsBox.querySelector('.veritai-face-list');
                if (faceListEl) {
                    const onToggle = (evt) => {
                        if (!evt.target.closest('.veritai-face-toggle')) return;
                        if (evt.type === 'keydown' && evt.key !== 'Enter' && evt.key !== ' ') return;
                        evt.preventDefault();
                        evt.stopPropagation();
                        showAllFaces = !showAllFaces;
                        faceListEl.innerHTML = buildFaceListHTML();
                        if (imgObj.complete && imgObj.naturalWidth) drawFaceBoxes();
                    };
                    faceListEl.addEventListener('click', onToggle);
                    faceListEl.addEventListener('keydown', onToggle);
                }

                imgObj.onload = () => {
                    bboxCanvas.width = imgObj.width;
                    bboxCanvas.height = imgObj.height;
                    heatmapCanvas.width = imgObj.width;
                    heatmapCanvas.height = imgObj.height;
                    drawFaceBoxes();

                    if (result.heatmapBase64) {
                        const bestFace = pickHeatmapFace(result, faces || []);
                        const hmImg = new Image();
                        hmImg.onload = () => {
                            const drawHeatmap = (opacity) => {
                                hCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
                                hCtx.drawImage(imgObj, 0, 0); 
                                hCtx.globalAlpha = opacity;
                                hCtx.globalCompositeOperation = "screen"; 
                                if (bestFace && bestFace.bbox) {
                                    hCtx.drawImage(hmImg, bestFace.bbox.x, bestFace.bbox.y, bestFace.bbox.w, bestFace.bbox.h);
                                } else {
                                    hCtx.drawImage(hmImg, 0, 0, imgObj.width, imgObj.height);
                                }
                                hCtx.globalAlpha = 1.0;
                                hCtx.globalCompositeOperation = "source-over";
                            };
                            
                            let isOriginalView = false;
                            const eyeBtn = detailsBox.querySelector('#veritai-heatmap-eye-btn');

                            drawHeatmap(slider.value / 100);
                            
                            if (slider) {
                                slider.addEventListener('input', (e) => {
                                    isOriginalView = false;
                                    if(eyeBtn) eyeBtn.style.opacity = "1";
                                    drawHeatmap(e.target.value / 100);
                                });
                            }

                            if (eyeBtn) {
                                eyeBtn.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    isOriginalView = !isOriginalView;
                                    
                                    if (isOriginalView) {
                                        eyeBtn.style.opacity = "0.3"; 
                                        drawHeatmap(0);
                                    } else {
                                        eyeBtn.style.opacity = "1";   
                                        drawHeatmap(slider.value / 100);
                                    }
                                });
                                eyeBtn.addEventListener('keydown', (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        eyeBtn.click();
                                    }
                                });
                            }
                        };
                        hmImg.src = "data:image/jpeg;base64," + result.heatmapBase64;
                    }
                };
                imgObj.src = reportImageSrc;
            }

            const toggleBtn = detailsBox.querySelector('#veritai-toggle-xai-btn');
            const visualTitle = detailsBox.querySelector('#veritai-visual-title');
            const sliderContainer = detailsBox.querySelector('#veritai-slider-container');
            let isHeatmapMode = false;

            if (toggleBtn && result.heatmapBase64) {
                toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    isHeatmapMode = !isHeatmapMode;
                    if (isHeatmapMode) {
                        bboxCanvas.style.display = 'none';
                        heatmapCanvas.style.display = 'block';
                        sliderContainer.style.display = 'flex';
                        toggleBtn.innerText = '감지 박스로 돌아가기';
                        toggleBtn.style.background = '#64748b';
                        visualTitle.innerText = 'XAI 분석 근거 (히트맵)';
                    } else {
                        bboxCanvas.style.display = 'block';
                        heatmapCanvas.style.display = 'none';
                        sliderContainer.style.display = 'none';
                        toggleBtn.innerText = 'AI 분석 근거 보기';
                        toggleBtn.style.background = '#3b82f6';
                        visualTitle.innerText = '감지 영역 (기본)';
                    }
                });
            }

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
                
                const badgeRect = badge.getBoundingClientRect();
                let leftPos = badgeRect.right + 10 + window.scrollX;
                let topPos = badgeRect.bottom + 5 + window.scrollY;
                
                detailsBox.style.transform = 'none'; 
                detailsBox.style.left = leftPos + 'px';
                detailsBox.style.top = topPos + 'px';
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

            const reinspectBtn = detailsBox.querySelector('.veritai-reinspect-btn');
            if (reinspectBtn) {
                reinspectBtn.addEventListener('click', (evt) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    if (detailsBox.cleanupListeners) detailsBox.cleanupListeners();
                    detailsBox.remove();
                    reinspectMedia(media);
                });
            }

            const feedbackBtn = detailsBox.querySelector('.veritai-feedback-btn');
            if (feedbackBtn) {
                feedbackBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (feedbackBtn.disabled) return;
                    
                    detailsBox.dataset.isFeedbackActive = "true";
                    
                    feedbackBtn.style.display = 'none';

                    const reasonContainer = document.createElement('div');
                    reasonContainer.style.cssText = 'display: flex; flex-direction: column; gap: 5px; margin-top: 5px; width: 100%;';
                    const reasonInput = document.createElement('textarea');
                    reasonInput.placeholder = "어떤 부분이 잘못되었나요?";
                    reasonInput.style.cssText = `font-size: 11px; padding: 5px; border-radius: 4px; border: 1px solid #555; background: #222; color: white; resize: none; height: 40px; font-family: sans-serif;`;
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
                    actionContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 5px;';
                    const cancelBtn = document.createElement('button');
                    cancelBtn.innerText = "취소";
                    cancelBtn.style.cssText = 'font-size: 11px; padding: 2px 8px; cursor: pointer; background: #444; color: white; border: none; border-radius: 3px;';
                    const submitBtn = document.createElement('button');
                    submitBtn.innerText = "제출";
                    submitBtn.style.cssText = 'font-size: 11px; padding: 2px 8px; cursor: pointer; background: #ff6b6b; color: white; border: none; border-radius: 3px; font-weight: bold;';

                    actionContainer.appendChild(cancelBtn);
                    actionContainer.appendChild(submitBtn);
                    reasonContainer.appendChild(reasonInput);
                    reasonContainer.appendChild(actionContainer);
                    feedbackBtn.parentNode.appendChild(reasonContainer);
                    setTimeout(() => reasonInput.focus(), 50);

                    cancelBtn.onclick = (cancelEvent) => {
                        cancelEvent.stopPropagation();
                        reasonContainer.remove();
                        feedbackBtn.style.display = 'flex';
                        detailsBox.dataset.isFeedbackActive = "false";
                    };

                    submitBtn.onclick = async (submitEvent) => {
                        submitEvent.stopPropagation();
                        const textReason = reasonInput.value.trim();
                        if (!textReason) {
                            reasonInput.style.border = "1px solid red";
                            reasonInput.placeholder = "신고 이유를 적어주세요.";
                            return;
                        }
                        submitBtn.innerText = "전송 중...";
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
                            reasonContainer.innerHTML = "<span style='color: lightgreen; font-size: 11px; text-align: right; padding-top: 5px;'>✓ 피드백이 성공적으로 접수되었습니다.</span>";
                            setTimeout(() => {
                                reasonContainer.remove();
                                feedbackBtn.style.display = 'flex';
                                feedbackBtn.style.opacity = '0.5'; 
                                feedbackBtn.innerText = '✓ 신고 완료';
                                feedbackBtn.disabled = true; 
                                detailsBox.dataset.isFeedbackActive = "false";
                            }, 1500);
                        } catch (err) {
                            submitBtn.innerText = "실패(재시도)";
                            submitBtn.disabled = false;
                            cancelBtn.disabled = false;
                        }
                    };
                };
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

            return detailsBox;
        };

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
                let existingBox = null;
                document.querySelectorAll('.veritai-details-box').forEach(box => {
                    if (box.dataset.targetMedia === targetMediaSrc) existingBox = box; 
                });
                
                if (existingBox && existingBox.dataset.isHovered !== "true" && badge.dataset.isHovered !== "true" && existingBox.dataset.isDragged !== "true" && existingBox.dataset.isFeedbackActive !== "true") {
                    if (existingBox.cleanupListeners) existingBox.cleanupListeners();
                    existingBox.remove();
                }

                if (isCleanUIMode && status === "real" && !existingBox && badge.dataset.isHovered !== "true") {
                    if (uiContainer && uiContainer.parentNode) {
                        uiContainer.style.transition = "opacity 0.5s ease-out";
                        uiContainer.style.opacity = "0";
                        setTimeout(() => {
                            if (uiContainer && uiContainer.parentNode && isCleanUIMode && badge.dataset.isHovered !== "true") {
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

function formatFrameTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(total / 60);
    const sec = String(total % 60).padStart(2, '0');
    return `${m}:${sec}`;
}

function reinspectMedia(media) {
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

async function startInspection(media) {
    if (!isSystemOn && media.dataset.forceInspect !== "true") return;
    if (!isUserRequested(media) && !shouldInspectMedia(media)) return;
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
        if (!isSystemOn) return;

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

        let friendlyMessage = "분석 오류";
        if (isBlocked) friendlyMessage = media.tagName === "VIDEO" ? "영상 접근 차단 (사이트 보안)" : "이미지 접근 차단 (사이트 보안)";
        else if (err.status === 429) friendlyMessage = "요청 과다 (잠시 후 시도)";
        else if (err.status === 408) friendlyMessage = "응답 지연 (서버 혼잡)";
        else if (err.status >= 500) friendlyMessage = "서버 내부 오류";
        else if (err?.name === 'TypeError' && errMessage === 'Failed to fetch') {
            friendlyMessage = "접근 불가 (보안차단/서버꺼짐)";
        }
        else if (err.status === 400 || err.status === 415) friendlyMessage = "지원하지 않는 이미지";
        else friendlyMessage = errMessage || "분석 실패";
        
        updateStatusBadge(media, "error", { message: friendlyMessage });
        delete media.dataset.veritaiScanned;
        if (media.dataset.veritaiScanKey) {
            scannedMediaKeys.delete(media.dataset.veritaiScanKey);
            delete media.dataset.veritaiScanKey;
        }
    });
}

const autoScanObserver = new IntersectionObserver((entries) => {
    if (!isSystemOn || !isAutoScanMode) return;
    entries.forEach(entry => {
        if (entry.isIntersecting && entry.target.clientWidth > 80) {
            if (entry.target.dataset.scanTimer) clearTimeout(entry.target.dataset.scanTimer);
            entry.target.dataset.scanTimer = setTimeout(() => {
                if (!isSystemOn || !isAutoScanMode) return;
                const rect = entry.target.getBoundingClientRect();
                if (rect.top < window.innerHeight && rect.bottom > 0) {
                    startInspection(entry.target);
                    autoScanObserver.unobserve(entry.target);
                }
            }, 300);
        }
    });
}, { threshold: 0.3 });

const domObserver = new MutationObserver((mutations) => {
    if (!isSystemOn) return;

    mutationQueue.push(...mutations);
    if (mutationQueue.length > MUTATION_QUEUE_LIMIT) {
        mutationQueue = mutationQueue.slice(-MUTATION_QUEUE_LIMIT);
    }
    if (observerDebounceTimer) clearTimeout(observerDebounceTimer);
    observerDebounceTimer = setTimeout(() => {
        if (!isSystemOn) { mutationQueue = []; return; }
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
    }, 150);
});

function ensureWrapper(media) {
    let parent = media.parentElement;
    if (!parent) return null;
    if (parent.tagName === 'PICTURE' || parent.tagName === 'YT-IMAGE' || parent.tagName === 'YT-IMG-SHADOW') {
        parent = parent.parentElement;
        if (!parent) return null;
    }
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    return parent;
}

function attachUI(media, retryCount = 0) {
    if (!isSystemOn) return;
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
        updateStatusBadge(media, readDeepfakeFlag(data.result) ? "fake" : "real", data);
        return;
    }

    if (media.dataset.veritaiScanned === "true") return;
    if (media.dataset.veritaiAttached === "true" && hasUI) return;
    media.dataset.veritaiAttached = "true";
    delete media.dataset.veritaiScanned;

    if (isAutoScanMode && media.tagName !== 'VIDEO') {
        autoScanObserver.observe(media); 
    } else {
        if (wrapper && !getCheckButton(media) && isBehindInspectedMedia(media)) {
            media.dataset.veritaiSuppressed = "true";
            return;
        }
        if (wrapper && !getCheckButton(media)) {
            const btn = document.createElement("button");
            btn.innerText = "🔍 검사";
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

function clearAllUI() {
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
    document.querySelectorAll('.veritai-standalone-modal').forEach(m => m.remove());
}

chrome.storage.local.get(SETTING_KEYS, (result) => {
    isSystemOn = result.isSystemOn !== false;
    isAutoScanMode = result.isAutoScanOn || false;
    isCleanUIMode = result.isCleanUIMode || false;
    setTimeout(() => {
        if (isSystemOn) {
            injectDropzone(); 
            document.querySelectorAll('img, video').forEach(media => attachUI(media));
            domObserver.observe(document.body, DOM_OBSERVER_OPTIONS);
        }
    }, 500);
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (!SETTING_KEYS.some(key => key in changes)) return;

        let modeChanged = false;
        
        if (changes.isSystemOn) isSystemOn = changes.isSystemOn.newValue;
        if (changes.isAutoScanOn) {
            isAutoScanMode = changes.isAutoScanOn.newValue;
            modeChanged = true;
        }
        
        if (changes.isCleanUIMode) {
            isCleanUIMode = changes.isCleanUIMode.newValue;
            document.querySelectorAll('img, video').forEach(media => {
                if (media.dataset.veritaiScanned === "true") {
                    const mediaUrl = media.currentSrc || media.src;
                    if (mediaUrl && scanCache.has(mediaUrl)) {
                        const data = scanCache.get(mediaUrl);
                        if (!readDeepfakeFlag(data.result)) {
                            const wrapper = ensureWrapper(media);
                            if (wrapper) {
                                const uiContainer = getUIContainer(media);

                                if (isCleanUIMode) {
                                    if (uiContainer) {
                                        uiContainer.style.transition = "opacity 0.5s ease-out";
                                        uiContainer.style.opacity = "0";
                                        setTimeout(() => { if (uiContainer && isCleanUIMode) uiContainer.style.display = "none"; }, 300);
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
        
        if (!isSystemOn) {
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
                if (!isAutoScanMode) {
                    while (pendingInspectionQueue.length > 0) {
                        const cancelErr = new Error("수동 모드 전환으로 인한 취소");
                        cancelErr.isCancelled = true;        
                        pendingInspectionQueue.shift().reject(cancelErr);
                    }
                }

                document.querySelectorAll('img, video').forEach(media => {
                    if (!isAutoScanMode && media.dataset.veritaiScanned === "true") {
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
});

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

let dragCounter = 0;
let dropzoneListenersAttached = false;

function getDropzoneElements() {
    return {
        miniHint: document.getElementById('veritai-mini-hint'),
        wrapper: document.getElementById('veritai-dropzone-wrapper'),
    };
}

function hideDropzoneUI() {
    const { miniHint, wrapper } = getDropzoneElements();
    if (!wrapper) return;
    wrapper.style.borderColor = '#3b82f6';
    wrapper.style.background = 'rgba(30, 41, 59, 0.95)';
    wrapper.style.opacity = '0';
    wrapper.style.transform = 'translateY(10px)';
    setTimeout(() => {
        if (dragCounter === 0) {
            wrapper.style.display = 'none';
            if (miniHint) miniHint.style.display = 'flex';
        }
    }, 200);
}

function attachDropzoneListeners() {
    if (dropzoneListenersAttached) return;
    dropzoneListenersAttached = true;

    window.addEventListener('dragenter', (e) => {
        const { miniHint, wrapper } = getDropzoneElements();
        if (!wrapper) return;
        if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list") || e.dataTransfer.types.includes("text/html")) {
            e.preventDefault();
            dragCounter++;
            if (dragCounter === 1) {
                if (miniHint) miniHint.style.display = 'none';
                wrapper.style.display = 'flex';
                requestAnimationFrame(() => {
                    wrapper.style.opacity = '1';
                    wrapper.style.transform = 'translateY(0)';
                });
            }
        }
    });

    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        if (dragCounter === 0) return;
        dragCounter--;
        if (dragCounter === 0) hideDropzoneUI();
    });
}

function injectDropzone() {
    attachDropzoneListeners();
    if (document.getElementById('veritai-mini-hint')) return;
    dragCounter = 0;

    const miniHint = document.createElement('div');
    miniHint.id = 'veritai-mini-hint';
    miniHint.innerHTML = `<span style="font-size:18px;">📥</span><span class="veritai-mini-text">사진 드래그 검사</span>`;
    document.body.appendChild(miniHint);

    const wrapper = document.createElement('div');
    wrapper.id = 'veritai-dropzone-wrapper';
    wrapper.style.cssText = 'position:fixed; bottom:24px; right:24px; width:240px; height:180px; z-index:2147483646; display:none; background:rgba(30, 41, 59, 0.95); border: 3px dashed #3b82f6; border-radius: 16px; align-items:center; justify-content:center; box-shadow: 0 10px 40px rgba(0,0,0,0.5); transition:all 0.2s ease; transform:translateY(10px); opacity:0;';

    const dz = document.createElement('div');
    dz.innerHTML = `<div style="text-align:center; pointer-events:none;"><div style="font-size:36px; margin-bottom:12px;">📥</div><div style="font-size:14px; font-weight:bold; color:white;">여기로 사진을 놓으세요</div></div>`;
    wrapper.appendChild(dz);
    document.body.appendChild(wrapper);

    wrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        wrapper.style.borderColor = '#10b981';
        wrapper.style.background = 'rgba(16, 185, 129, 0.15)';
    });

    wrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        hideDropzoneUI();

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
                analyzeStandaloneMedia(URL.createObjectURL(file), file.type.startsWith('video/'));
            }
        } else {
            const html = e.dataTransfer.getData('text/html');
            const srcMatch = html && html.match(/src\s*=\s*['"]([^'"]+)['"]/);
            if (srcMatch) analyzeStandaloneMedia(srcMatch[1], false);
            else {
                const uri = e.dataTransfer.getData('text/uri-list');
                if (uri) analyzeStandaloneMedia(uri, false);
            }
        }
    });
}

function analyzeStandaloneMedia(src, isVideo) {
    const modal = document.createElement('div');
    modal.className = 'veritai-standalone-modal';
    
    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '✕ 닫기';
    closeBtn.style.cssText = 'position:absolute; top:20px; right:30px; color:white; font-size:16px; cursor:pointer; font-weight:bold; background:rgba(255,255,255,0.2); padding:5px 10px; border-radius:8px; z-index:10; transition:0.2s;';

    closeBtn.tabIndex = 0;
    closeBtn.setAttribute('role', 'button');
    closeBtn.setAttribute('aria-label', '모달 닫기');
    const closeModal = () => {
        modal.remove();
        if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    };
    closeBtn.onclick = closeModal;
    closeBtn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') closeModal(); };

    setTimeout(() => closeBtn.focus(), 100);
    
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative; display:inline-block; max-width:80vw; max-height:80vh; background:black; border-radius:8px; box-shadow: 0 0 30px rgba(0,0,0,0.8);';
    
    const media = document.createElement(isVideo ? 'video' : 'img');
    media.src = src;
    media.style.cssText = 'max-width:80vw; max-height:80vh; display:block; border-radius:8px;';
    if (isVideo) { media.controls = true; media.autoplay = true; media.muted = true; }
    
    wrapper.appendChild(media);
    modal.appendChild(closeBtn);
    modal.appendChild(wrapper);
    document.body.appendChild(modal);

    const initInspect = () => setTimeout(() => { 
        media.dataset.forceInspect = "true"; 
        startInspection(media); 
    }, 300);
    if (isVideo) media.onloadeddata = initInspect; else media.onload = initInspect;
}

function recordInspectionStat(isFake) {
    const today = new Date().toLocaleDateString();
    
    chrome.storage.local.get(['veritai_stat_date', 'veritai_stat_scanned', 'veritai_stat_blocked'], (res) => {
        let scanned = res.veritai_stat_scanned || 0;
        let blocked = res.veritai_stat_blocked || 0;
        
        if (res.veritai_stat_date !== today) {
            scanned = 0; 
            blocked = 0;
        }
        
        scanned++; 
        if (isFake) blocked++; 
        
        chrome.storage.local.set({
            veritai_stat_date: today,
            veritai_stat_scanned: scanned,
            veritai_stat_blocked: blocked
        });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "clear_cache_and_rescan") {
        scanCache.forEach(releaseFrameUrl);
        scanCache.clear();      
        scannedMediaKeys.clear(); 
        clearAllUI();            
        if (isSystemOn) {
            injectDropzone();
            document.querySelectorAll('img, video').forEach(media => attachUI(media));
        }
        sendResponse({ success: true });
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
    return true;
});