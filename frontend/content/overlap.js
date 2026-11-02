// 겹친 사진, 가려진 사진 처리
import { clearMediaHighlight, getCheckButton, isVisibleMedia, removeMediaUI } from './dom.js';
import { autoScanObserver } from './observers.js';

function getOwnerMedia(ui) {
    const host = ui.classList.contains('veritai-check-btn') ? ui : ui.getRootNode()?.host;
    const id = host?.dataset?.veritaiFor;
    return id ? document.querySelector(`img[data-veritai-id="${id}"], video[data-veritai-id="${id}"]`) : null;
}

export function pickTopmostUI(hits, x, y) {
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

export function suppressOverlappingButtons(media) {
    document.querySelectorAll('.veritai-check-btn').forEach(btn => {
        const owner = getOwnerMedia(btn);
        if (!owner || owner === media || !isBehind(owner, media)) return;
        suppressMedia(owner);
    });
}

export function isCoveredByOtherMedia(media) {
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

export function hideMediaUI(media) {
    removeMediaUI(media);
    clearMediaHighlight(media);
    media.dataset.veritaiSuppressed = "true";
    autoScanObserver.unobserve(media);
}

export function hideCoveredUIs(topMedia) {
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

export function isBehindInspectedMedia(media) {
    return Array.from(document.querySelectorAll('veritai-host')).some(host => {
        const id = host.dataset.veritaiFor;
        if (!id || id === media.dataset.veritaiId) return false;
        const inspected = document.querySelector(`img[data-veritai-id="${id}"], video[data-veritai-id="${id}"]`);
        return Boolean(inspected && inspected.isConnected && isBehind(media, inspected));
    });
}
