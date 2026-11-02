// 검사 결과 캐시와 이미 검사한 사진 기록
import { MAX_CACHE_SIZE } from '../config/constants';

export const scanCache = new Map();
export const scannedMediaKeys = new Set();

export function getFromCache(key) {
    if (!scanCache.has(key)) return null;
    const value = scanCache.get(key);
    scanCache.delete(key);
    scanCache.set(key, value);
    return value;
}

export function releaseFrameUrl(value) {
    if (value && value.frameUrl) URL.revokeObjectURL(value.frameUrl);
}

export function setToCache(key, value) {
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

export function manageMemoryCache() {
    if (scannedMediaKeys.size > MAX_CACHE_SIZE) scannedMediaKeys.delete(scannedMediaKeys.keys().next().value);
}

function getMediaSource(media) {
    if (!media) return "";
    return media.currentSrc || media.src || media.poster || "";
}

export function getMediaKey(media) {
    const source = getMediaSource(media);
    if (source) return `${media.tagName}:${source}`;
    const rect = media.getBoundingClientRect();
    return `${media.tagName}:${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
}
