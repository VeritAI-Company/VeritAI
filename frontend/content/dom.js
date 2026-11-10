import { STRONG_AD_SELECTOR, WEAK_AD_MAX_DEPTH, WEAK_AD_SELECTOR } from '../config/constants';

let veritaiIdCounter = 0;
// 번호로 사진을 바로 찾기 위한 목록. 페이지 전체를 다시 뒤지지 않게 한다 (사진이 지워지면 WeakRef라 메모리에 남지 않는다)
const mediaById = new Map();

export function getMediaId(media) {
    if (!media.dataset.veritaiId) media.dataset.veritaiId = `v${++veritaiIdCounter}`;
    const id = media.dataset.veritaiId;
    if (mediaById.get(id)?.deref() !== media) mediaById.set(id, new WeakRef(media));
    return id;
}

export function findMediaById(id) {
    if (!id) return null;
    const media = mediaById.get(id)?.deref();
    if (media && media.isConnected && media.dataset.veritaiId === id) return media;
    mediaById.delete(id);
    const found = document.querySelector(`img[data-veritai-id="${id}"], video[data-veritai-id="${id}"]`);
    if (found) mediaById.set(id, new WeakRef(found));
    return found;
}

function findOwnedElement(media, selector) {
    const wrapper = ensureWrapper(media);
    if (!wrapper) return null;
    return wrapper.querySelector(`${selector}[data-veritai-for="${getMediaId(media)}"]`);
}

export function getShadowHost(media) {
    return findOwnedElement(media, 'veritai-host');
}

export function getCheckButton(media) {
    return findOwnedElement(media, '.veritai-check-btn');
}

export function getUIContainer(media) {
    const host = getShadowHost(media);
    return host && host.shadowRoot ? host.shadowRoot.querySelector('.veritai-ui-container') : null;
}

export function getBadge(media) {
    const host = getShadowHost(media);
    return host && host.shadowRoot ? host.shadowRoot.querySelector('.veritai-status-badge') : null;
}

export function getAllBadges() {
    return Array.from(document.querySelectorAll('veritai-host'))
        .map(host => host.shadowRoot && host.shadowRoot.querySelector('.veritai-status-badge'))
        .filter(Boolean);
}

export function positionOverlay(el, media, inset = 0) {
    const wrapper = el.parentElement;
    if (!wrapper || !media.isConnected) return;
    const mediaRect = media.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const top = mediaRect.top - wrapperRect.top - wrapper.clientTop + wrapper.scrollTop + inset;
    const left = mediaRect.left - wrapperRect.left - wrapper.clientLeft + wrapper.scrollLeft + inset;
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
}

export function removeMediaUI(media) {
    const host = getShadowHost(media);
    if (host) host.remove();
    const btn = getCheckButton(media);
    if (btn) btn.remove();
}

export function clearMediaHighlight(media) {
    media.style.outline = '';
    media.style.outlineOffset = '';
}

export function isVisibleMedia(media) {
    if (!media || !media.isConnected) return false;
    const rect = media.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) return false;
    const style = getComputedStyle(media);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

export function isInWeakAdArea(media) {
    let el = media;
    for (let depth = 0; el && depth <= WEAK_AD_MAX_DEPTH; depth += 1) {
        if (el.matches && el.matches(WEAK_AD_SELECTOR)) return true;
        el = el.parentElement;
    }
    return false;
}

// auto: 자동 검사인지. 애매한 광고 영역은 자동 검사에서만 뺀다
export function shouldInspectMedia(media, { auto = false } = {}) {
    if (media.closest('.veritai-details-box') || media.closest('.veritai-ui-container')) return false;
    if (window !== window.top) return false;
    if (media.closest(STRONG_AD_SELECTOR)) return false;
    if (auto && isInWeakAdArea(media)) return false;
    const url = (media.src || media.currentSrc || "").toLowerCase();
    const adUrls = ['/ads/', '/ad/', 'doubleclick.net', 'googlesyndication', 'adservice', 'adsystem'];
    if (adUrls.some(ad => url.includes(ad))) return false;
    return isVisibleMedia(media);
}

export function ensureWrapper(media) {
    let parent = media.parentElement;
    if (!parent) return null;
    if (parent.tagName === 'PICTURE' || parent.tagName === 'YT-IMAGE' || parent.tagName === 'YT-IMG-SHADOW') {
        parent = parent.parentElement;
        if (!parent) return null;
    }
    if (getComputedStyle(parent).position === "static") {
        // 버튼을 사진 위에 올리려고 바꾼 값이라, 전원을 끄면 원래 값으로 돌려놓는다 (restorePagePositions)
        if (parent.dataset.veritaiPrevPosition === undefined) parent.dataset.veritaiPrevPosition = parent.style.position;
        parent.style.position = "relative";
    }
    return parent;
}

export function restorePagePositions() {
    document.querySelectorAll('[data-veritai-prev-position]').forEach(el => {
        el.style.position = el.dataset.veritaiPrevPosition;
        delete el.dataset.veritaiPrevPosition;
    });
}
