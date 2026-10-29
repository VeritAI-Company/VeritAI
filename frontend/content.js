import { FEEDBACK_URL, MAX_CONCURRENT_INSPECTIONS, MAX_CACHE_SIZE, GLOBAL_AD_SELECTOR } from './config/constants';
import { injectCSS, VERITAI_CORE_CSS, icon } from './ui/styles.js';
import { captureImageBlob, captureVideoBlob } from './core/capture.js';
import { sendToBackend, clearPendingPolls } from './core/network.js';

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
    media.style.outline = '';
    media.style.outlineOffset = '';
}

const FACE_MODE_LABELS = { frontal: '정면', 'profile-left': '왼쪽 옆모습', 'profile-right': '오른쪽 옆모습', eyes_closed: '눈 감음', occluded: '가려짐' };
const FACE_QUALITY_LABELS = { good: '좋음', usable: '보통', poor: '낮음' };

function faceModeLabel(value) {
    return FACE_MODE_LABELS[value] || value || '-';
}

function faceQualityLabel(value) {
    return FACE_QUALITY_LABELS[value] || value || '-';
}

function formatPercent(value, digits = 1) {
    return `${((Number(value) || 0) * 100).toFixed(digits)}%`;
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
    if (prob == null) return "#8b939c";
    if (prob >= FACE_FAKE_MIN) return "#ef6f72";
    if (prob >= FACE_CAUTION_MIN) return "#e2a64a";
    return "#52c08c";
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

// 새 AI 응답: cnn.views[].cam 에 영역별 히트맵 숫자 표(0~1, 조작 확률을 곱한 값)가 온다
const HEATMAP_WEAK_PROB = 0.3;

function getCamViews(result) {
    const views = Array.isArray(result?.cnn?.views) ? result.cnn.views : [];
    return views.filter(view => Array.isArray(view.cam) && view.cam.length > 0 && Array.isArray(view.cam[0]) && view.cam[0].length > 0);
}

function getHeatmapViewLabel(name) {
    if (name === 'full') return '사진 전체';
    const match = /^face_(\d+)$/.exec(name || '');
    return match ? `얼굴 ${match[1]}` : (name || '');
}

function pickDefaultCamView(result, camViews) {
    const named = camViews.find(view => view.name === result?.cnn?.heatmapView);
    if (named) return named;
    return camViews.reduce((a, b) => ((b.fakeProbability ?? 0) > (a.fakeProbability ?? 0) ? b : a), camViews[0]);
}

// 히트맵 표시 기준
const HEATMAP_TOP_RATIO = 0.2;       // 영역 안에서 값이 큰 상위 20% 칸만 칠한다
const HEATMAP_MIN_REL = 0.3;         // 상위 20%라도 최대값의 30% 미만이면 칠하지 않는다
const HEATMAP_DIM = 0.4;             // 색이 잘 보이도록 사진을 어둡게 까는 정도 (슬라이더 최대일 때)
const HEATMAP_HIDE_FULL_PROB = 0.01; // 사진 전체 확률이 1% 미만이면 탭을 숨긴다

// 0~1 강도를 주황 → 빨강으로 바꾼다 (피부색과 겹치는 노랑은 쓰지 않는다)
function heatColor(t) {
    return [Math.round(255 - 20 * t), Math.round(150 - 120 * t), Math.round(30 * t)];
}

// 숫자 표를 영역 크기로 늘려 그린다.
// 1) 영역 안에서 가장 강한 곳이 항상 빨강이 되도록 다시 맞춘다 (확률이 낮다는 건 탭 %와 안내 문구로 알린다)
// 2) 상위 20% 칸만 칠해서 AI가 특히 많이 본 곳만 남긴다
// 3) 사진을 살짝 어둡게 깔아 색이 피부색에 묻히지 않게 한다
function drawCamGrid(ctx, grid, box, opacity) {
    const rows = grid.length;
    const cols = grid[0].length;
    const values = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) values.push(Math.max(0, Number(grid[r][c]) || 0));
    }
    const sorted = [...values].sort((a, b) => b - a);
    const peak = sorted[0];
    if (!(peak > 0) || !(opacity > 0)) return;
    const cutIndex = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * HEATMAP_TOP_RATIO) - 1));
    const threshold = Math.min(0.95, Math.max(HEATMAP_MIN_REL, sorted[cutIndex] / peak));

    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${HEATMAP_DIM * opacity})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    const small = document.createElement('canvas');
    small.width = cols;
    small.height = rows;
    const sCtx = small.getContext('2d');
    const image = sCtx.createImageData(cols, rows);
    values.forEach((value, idx) => {
        const rel = value / peak;
        const t = rel < threshold ? 0 : (rel - threshold) / (1 - threshold);
        const [red, green, blue] = heatColor(t);
        const i = idx * 4;
        image.data[i] = red;
        image.data[i + 1] = green;
        image.data[i + 2] = blue;
        image.data[i + 3] = rel < threshold ? 0 : Math.round(255 * (0.3 + 0.7 * Math.pow(t, 1.2)));
    });
    sCtx.putImageData(image, 0, 0);

    // 두 단계로 늘려 계단 모양을 줄이고, 지원하는 브라우저에서는 가장자리만 살짝 흐리게 한다 (사파리는 흐림 없이 늘리기만 함)
    const w = Math.max(1, Math.round(box.w));
    const h = Math.max(1, Math.round(box.h));
    const mid = document.createElement('canvas');
    mid.width = cols * 4;
    mid.height = rows * 4;
    const mCtx = mid.getContext('2d');
    mCtx.imageSmoothingEnabled = true;
    mCtx.imageSmoothingQuality = 'high';
    mCtx.drawImage(small, 0, 0, mid.width, mid.height);

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const oCtx = out.getContext('2d');
    oCtx.imageSmoothingEnabled = true;
    oCtx.imageSmoothingQuality = 'high';
    if ('filter' in oCtx) oCtx.filter = `blur(${Math.max(1, Math.round(Math.max(w / cols, h / rows) * 0.15))}px)`;
    oCtx.drawImage(mid, 0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(out, box.x, box.y, w, h);
    ctx.restore();
}

// 히트맵을 계산한 얼굴 영역을 점선 네모로 표시한다
function drawViewOutline(ctx, box, displayScale) {
    const lineWidth = Math.max(1.5, 1.5 / displayScale);
    ctx.save();
    ctx.strokeStyle = 'rgba(143, 179, 240, 0.9)';
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
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
    badge.removeAttribute('style');
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
        const errorText = document.createElement('span');
        errorText.textContent = data?.message || "검사하지 못했습니다.";
        const retryText = document.createElement('span');
        retryText.className = 'vr-retry';
        retryText.textContent = '다시 시도';
        badge.append(errorText, retryText);
        
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
                if (box.dataset.targetMedia === reportKey) {
                    existingBox = box;
                }
            });

            if (existingBox) return existingBox;

            closeAllReportBoxes(false, reportKey);

            const result = data.result;
            const faces = result.faces || [];
            const isVideoMedia = media.tagName === "VIDEO";
            const camViews = getCamViews(result);
            const hasHeatmap = camViews.length > 0 || Boolean(result.heatmapBase64);

            let showAllFaces = false;
            const buildFaceListHTML = () => {
                if (faces.length === 0) {
                    return `<div class="vr-empty">얼굴을 찾지 못해 사진 전체로 판정했습니다.</div>`;
                }
                const { visible, hidden } = selectVisibleFaces(faces, showAllFaces);
                const cards = visible.map(({ face: f, index: i }) => {
                    const bbox = f.bbox || {};
                    const faceProb = getFaceFakeProb(f);
                    const level = faceProb == null ? '' : faceProb >= FACE_FAKE_MIN ? 'is-fake' : faceProb >= FACE_CAUTION_MIN ? 'is-warn' : 'is-real';
                    const info = [faceModeLabel(f.faceMode), `인식 신뢰도 ${formatPercent(f.detectionConfidence || f.score || 0, 0)}`, `화질 ${faceQualityLabel(f.quality?.label)}`, `${bbox.w ?? '-'}×${bbox.h ?? '-'}`];
                    return `
                    <div class="vr-face">
                        <div class="vr-face-head">
                            <span class="vr-face-name">얼굴 ${i + 1}</span>
                            <span class="vr-track"><span class="vr-fill ${level}" style="width:${Math.round((faceProb ?? 0) * 100)}%"></span></span>
                            <span class="vr-face-prob" style="color:${getFaceColor(faceProb)}">${faceProb == null ? '-' : formatPercent(faceProb, 0)}</span>
                        </div>
                        <div class="vr-face-info">${escapeHTML(info.join(' · '))}</div>
                    </div>`;
                }).join("");
                let toggle = '';
                if (hidden > 0) toggle = `<div class="veritai-face-toggle" role="button" tabindex="0">인식 신뢰도가 낮은 얼굴 ${hidden}개 더 보기</div>`;
                else if (showAllFaces && selectVisibleFaces(faces, false).hidden > 0) toggle = `<div class="veritai-face-toggle" role="button" tabindex="0">주요 얼굴만 보기</div>`;
                return cards + toggle;
            };

            const isFakeResult = readDeepfakeFlag(result);
            const faceCount = Number.isFinite(result.faceCount) ? result.faceCount : faces.length;
            const confidence = Number(result.confidence) || 0;
            const meterLevel = confidence >= FACE_FAKE_MIN ? 'is-fake' : confidence >= FACE_CAUTION_MIN ? 'is-warn' : 'is-real';
            const verdictDesc = isFakeResult
                ? '조작되었을 가능성이 높습니다.'
                : confidence >= FACE_CAUTION_MIN ? '조작 흔적이 약하게 보이지만 기준보다 낮습니다.' : '조작 흔적을 찾지 못했습니다.';
            const metaParts = [faceCount > 0 ? `얼굴 ${faceCount}개 검사` : '얼굴을 찾지 못해 사진 전체로 검사'];
            if (isVideoMedia && data.frameTime != null) metaParts.push(`영상 ${formatFrameTime(data.frameTime)} 장면`);

            const detailsBox = document.createElement('div');
            detailsBox.className = `veritai-details-box unpinned ${status === "fake" ? "fake-border" : "real-border"}`;
            detailsBox.dataset.targetMedia = reportKey;
            detailsBox.dataset.isFeedbackActive = "false"; 

            detailsBox.innerHTML = `
<div class="veritai-drag-handle">
    <span class="vr-head-title">${icon('shield')}VeritAI 검사 결과</span>
    <span class="veritai-close-btn" tabindex="0" role="button" aria-label="닫기">${icon('close')}</span>
</div>
<div class="vr-section">
    <div class="vr-verdict ${isFakeResult ? 'is-fake' : 'is-real'}">${isFakeResult ? '조작 의심' : '정상'}</div>
    <div class="vr-desc">${verdictDesc}</div>
    <div class="vr-meter" role="img" aria-label="조작 확률 ${formatPercent(confidence)}">
        <div class="vr-meter-row"><span>조작 확률</span><b>${formatPercent(confidence)}</b></div>
        <div class="vr-track"><span class="vr-fill ${meterLevel}" style="width:${Math.round(confidence * 100)}%"></span></div>
        <div class="vr-meter-scale"><span>0</span><span>판정 기준 50%</span><span>100</span></div>
    </div>
    <div class="vr-meta">${metaParts.join(' · ')}</div>
</div>
<div class="vr-section">
    <div class="vr-stage-head">
        <div class="vr-label" id="veritai-visual-title">감지된 얼굴</div>
        <button id="veritai-toggle-xai-btn" class="vr-btn is-accent" ${!hasHeatmap ? 'disabled' : ''}>${hasHeatmap ? '판단 근거 보기' : '히트맵 없음'}</button>
    </div>
    <div class="vr-stage">
        <canvas id="veritai-bbox-canvas" style="z-index: 2;"></canvas>
        <canvas id="veritai-heatmap-canvas" style="display: none; z-index: 1;"></canvas>
    </div>
    <div id="veritai-slider-container" class="vr-slider">
        <button id="veritai-heatmap-eye-btn" class="vr-icon-btn" title="히트맵 켜기/끄기" aria-label="히트맵 켜기/끄기">${icon('eye')}</button>
        <span>원본</span>
        <input type="range" id="veritai-heatmap-slider" min="0" max="100" value="85" aria-label="히트맵 진하기">
        <span>히트맵</span>
    </div>
    <div id="veritai-heatmap-views" class="vr-tabs"></div>
    <div id="veritai-heatmap-note" class="vr-note"></div>
    ${camViews.length > 0 ? '<div id="veritai-heatmap-legend" class="vr-legend"><span>약함</span><i></i><span>강함</span></div>' : ''}
</div>
<div class="vr-section">
    <div class="veritai-face-list">${buildFaceListHTML()}</div>
</div>
<div class="vr-section">
    <div class="vr-actions">
        <span class="vr-request-id">요청 번호 ${escapeHTML(data.requestId) || '-'}</span>
        <span class="vr-actions-right">
            ${isVideoMedia ? `<button class="veritai-reinspect-btn vr-btn">${icon('refresh')}지금 장면 검사</button>` : ''}
            <button class="veritai-feedback-btn vr-btn is-quiet">${icon('flag')}결과가 틀렸나요?</button>
        </span>
    </div>
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

            let isHeatmapMode = false;
            let refreshHeatmapPanel = () => {};
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

                let selectedCamView = camViews.length > 0 ? pickDefaultCamView(result, camViews) : null;
                let legacyHeatmapImg = null;
                let isOriginalView = false;
                const eyeBtn = detailsBox.querySelector('#veritai-heatmap-eye-btn');
                const viewTabsEl = detailsBox.querySelector('#veritai-heatmap-views');
                const heatmapNoteEl = detailsBox.querySelector('#veritai-heatmap-note');
                const visualTitleEl = detailsBox.querySelector('#veritai-visual-title');

                const drawHeatmap = () => {
                    if (!imgObj.complete || !imgObj.naturalWidth) return;
                    const opacity = isOriginalView || !slider ? 0 : slider.value / 100;
                    hCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
                    hCtx.drawImage(imgObj, 0, 0);
                    if (selectedCamView) {
                        const box = selectedCamView.bbox && selectedCamView.bbox.w > 0
                            ? selectedCamView.bbox
                            : { x: 0, y: 0, w: imgObj.width, h: imgObj.height };
                        drawCamGrid(hCtx, selectedCamView.cam, box, opacity);
                        if (selectedCamView.bbox && selectedCamView.bbox.w > 0) {
                            const stage = heatmapCanvas.parentElement;
                            const stageW = (stage && stage.clientWidth) || 230;
                            const stageH = (stage && stage.clientHeight) || 210;
                            const displayScale = Math.min(1, stageW / imgObj.width, stageH / imgObj.height);
                            drawViewOutline(hCtx, selectedCamView.bbox, displayScale);
                        }
                    } else if (legacyHeatmapImg) {
                        const bestFace = pickHeatmapFace(result, faces || []);
                        hCtx.globalAlpha = opacity;
                        hCtx.globalCompositeOperation = "screen";
                        if (bestFace && bestFace.bbox) {
                            hCtx.drawImage(legacyHeatmapImg, bestFace.bbox.x, bestFace.bbox.y, bestFace.bbox.w, bestFace.bbox.h);
                        } else {
                            hCtx.drawImage(legacyHeatmapImg, 0, 0, imgObj.width, imgObj.height);
                        }
                        hCtx.globalAlpha = 1.0;
                        hCtx.globalCompositeOperation = "source-over";
                    }
                };

                // 영역 탭과 안내 문구. 사진 전체, 화면에 보이는 얼굴, 지금 고른 영역만 탭으로 만든다
                refreshHeatmapPanel = () => {
                    if (!selectedCamView) {
                        if (viewTabsEl) viewTabsEl.innerHTML = '';
                        if (heatmapNoteEl) heatmapNoteEl.textContent = '조작 확률이 가장 높은 영역 기준입니다.';
                        if (visualTitleEl && isHeatmapMode) visualTitleEl.innerText = '판단 근거 (히트맵)';
                        return;
                    }
                    const visibleIndexes = new Set(selectVisibleFaces(faces, showAllFaces).visible.map(entry => entry.index));
                    const tabViews = camViews.filter(view => {
                        if (view === selectedCamView) return true;
                        if (view.name === 'full') return (view.fakeProbability ?? 0) >= HEATMAP_HIDE_FULL_PROB;
                        const match = /^face_(\d+)$/.exec(view.name || '');
                        return match ? visibleIndexes.has(Number(match[1]) - 1) : true;
                    });
                    if (viewTabsEl) {
                        viewTabsEl.innerHTML = tabViews.map(view => {
                            const active = view === selectedCamView;
                            const prob = ((view.fakeProbability ?? 0) * 100).toFixed(1);
                            return `<button class="veritai-heatmap-view-btn${active ? ' is-active' : ''}" data-view="${escapeHTML(view.name)}">${escapeHTML(getHeatmapViewLabel(view.name))} ${prob}%</button>`;
                        }).join('');
                    }
                    const prob = selectedCamView.fakeProbability ?? 0;
                    const label = getHeatmapViewLabel(selectedCamView.name);
                    if (visualTitleEl && isHeatmapMode) visualTitleEl.innerText = `히트맵 · ${label} 기준`;
                    if (heatmapNoteEl) {
                        const lines = [`${label} 영역의 조작 확률 ${(prob * 100).toFixed(1)}% 기준입니다. 이 영역 안에서 색이 진할수록 판단에 크게 기여한 곳입니다.`];
                        if (prob < HEATMAP_HIDE_FULL_PROB) lines.push('이 영역에서는 조작 근거를 찾지 못해 표시할 색이 없습니다.');
                        else if (prob < HEATMAP_WEAK_PROB) lines.push('조작 근거가 약한 영역이라 히트맵은 참고용입니다.');
                        heatmapNoteEl.textContent = lines.join(' ');
                    }
                };

                if (viewTabsEl) {
                    viewTabsEl.addEventListener('click', (evt) => {
                        const btn = evt.target.closest('.veritai-heatmap-view-btn');
                        if (!btn) return;
                        evt.preventDefault();
                        evt.stopPropagation();
                        const next = camViews.find(view => view.name === btn.dataset.view);
                        if (!next || next === selectedCamView) return;
                        selectedCamView = next;
                        refreshHeatmapPanel();
                        drawHeatmap();
                    });
                }

                if (slider) {
                    slider.addEventListener('input', () => {
                        isOriginalView = false;
                        if (eyeBtn) eyeBtn.classList.remove('is-off');
                        drawHeatmap();
                    });
                }

                if (eyeBtn) {
                    eyeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        isOriginalView = !isOriginalView;
                        eyeBtn.classList.toggle('is-off', isOriginalView);
                        drawHeatmap();
                    });
                    eyeBtn.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            eyeBtn.click();
                        }
                    });
                }

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
                        refreshHeatmapPanel();
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
                    drawHeatmap();

                    if (!selectedCamView && result.heatmapBase64) {
                        const hmImg = new Image();
                        hmImg.onload = () => {
                            legacyHeatmapImg = hmImg;
                            drawHeatmap();
                        };
                        hmImg.src = "data:image/jpeg;base64," + result.heatmapBase64;
                    }
                };
                imgObj.src = reportImageSrc;
            }

            const toggleBtn = detailsBox.querySelector('#veritai-toggle-xai-btn');
            const visualTitle = detailsBox.querySelector('#veritai-visual-title');
            const sliderContainer = detailsBox.querySelector('#veritai-slider-container');
            const heatmapViewsEl = detailsBox.querySelector('#veritai-heatmap-views');
            const heatmapNote = detailsBox.querySelector('#veritai-heatmap-note');
            const heatmapLegend = detailsBox.querySelector('#veritai-heatmap-legend');

            if (toggleBtn && hasHeatmap) {
                toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    isHeatmapMode = !isHeatmapMode;
                    if (isHeatmapMode) {
                        bboxCanvas.style.display = 'none';
                        heatmapCanvas.style.display = 'block';
                        sliderContainer.style.display = 'flex';
                        if (heatmapViewsEl) heatmapViewsEl.style.display = 'flex';
                        if (heatmapNote) heatmapNote.style.display = 'block';
                        if (heatmapLegend) heatmapLegend.style.display = 'flex';
                        toggleBtn.innerText = '얼굴 위치 보기';
                        visualTitle.innerText = '판단 근거 (히트맵)';
                        refreshHeatmapPanel();
                    } else {
                        bboxCanvas.style.display = 'block';
                        heatmapCanvas.style.display = 'none';
                        sliderContainer.style.display = 'none';
                        if (heatmapViewsEl) heatmapViewsEl.style.display = 'none';
                        if (heatmapNote) heatmapNote.style.display = 'none';
                        if (heatmapLegend) heatmapLegend.style.display = 'none';
                        toggleBtn.innerText = '판단 근거 보기';
                        visualTitle.innerText = '감지된 얼굴';
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
                    if (box.dataset.targetMedia === reportKey) existingBox = box; 
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

        let friendlyMessage = "검사하지 못했습니다.";
        if (isBlocked) friendlyMessage = media.tagName === "VIDEO" ? "이 사이트 영상은 검사할 수 없습니다." : "이 사이트 사진은 검사할 수 없습니다.";
        else if (err.status === 429) friendlyMessage = "요청이 많습니다.";
        else if (err.status === 408) friendlyMessage = "응답이 늦습니다.";
        else if (err.status >= 500) friendlyMessage = "서버 오류가 났습니다.";
        else if (err?.name === 'TypeError' && errMessage === 'Failed to fetch') {
            friendlyMessage = "서버에 연결할 수 없습니다.";
        }
        else if (err.status === 400 || err.status === 415) friendlyMessage = "지원하지 않는 형식입니다.";
        
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
        const isFake = readDeepfakeFlag(data.result);
        if (!isFake && isCleanUIMode) media.dataset.veritaiFadedOut = "true";
        updateStatusBadge(media, isFake ? "fake" : "real", data);
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

// 설정(전원, 자동 검사, 정상 숨기기) 변경을 화면에 반영한다
function applySettingChanges(changes) {
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

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') applySettingChanges(changes);
});

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
    isSystemOn = false;
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
function syncSettingsFromStorage() {
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
            const current = { isSystemOn, isAutoScanOn: isAutoScanMode, isCleanUIMode };
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

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncSettingsFromStorage();
});
window.addEventListener('focus', syncSettingsFromStorage);
orphanCheckTimer = setInterval(() => { if (!isExtensionAlive()) teardownOrphan(); }, 3000);

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
    wrapper.classList.remove('is-over');
    wrapper.style.opacity = '0';
    wrapper.style.transform = 'translateY(6px)';
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
    miniHint.innerHTML = `${icon('upload')}<span class="veritai-mini-text">사진을 끌어다 검사</span>`;
    document.body.appendChild(miniHint);

    const wrapper = document.createElement('div');
    wrapper.id = 'veritai-dropzone-wrapper';
    wrapper.style.cssText = 'position:fixed; bottom:20px; right:20px; width:240px; height:160px; z-index:2147483646; display:none; border-width: 1.5px; border-style: dashed; border-radius: 12px; align-items:center; justify-content:center; box-shadow: 0 10px 30px rgba(0,0,0,0.25); transition:all 0.2s ease; transform:translateY(6px); opacity:0;';

    const dz = document.createElement('div');
    dz.innerHTML = `<div class="vr-drop-inner">${icon('upload')}<div>여기에 사진을 놓으세요</div><div class="vr-drop-sub">놓으면 바로 검사합니다</div></div>`;
    wrapper.appendChild(dz);
    document.body.appendChild(wrapper);

    wrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        wrapper.classList.add('is-over');
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
    closeBtn.innerHTML = `${icon('close')}<span>닫기</span>`;
    closeBtn.className = 'vr-modal-close';

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
    wrapper.style.cssText = 'position:relative; display:inline-block; max-width:80vw; max-height:80vh; background:#000; border-radius:8px; overflow:visible;';
    
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