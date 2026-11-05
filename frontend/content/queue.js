import { MAX_CONCURRENT_INSPECTIONS } from '../config/constants';
import { shouldInspectMedia } from './dom.js';
import { settings } from './state.js';

let activeInspectionCount = 0;
export const pendingInspectionQueue = [];

export function isUserRequested(media) {
    return media.dataset.veritaiUserRequest === "true" || media.dataset.forceInspect === "true";
}

function getInspectionPriority(media) {
    if (!media || !media.isConnected) return -1;
    const rect = media.getBoundingClientRect();
    const viewportOverlap = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    return (viewportOverlap ? 1_000_000 : 0) + Math.min(area, 999_999);
}

export function runWithInspectionLimit(task, media = null) {
    return new Promise((resolve, reject) => {
        pendingInspectionQueue.push({ task, media, resolve, reject });
        if (settings.isAutoScanMode) {
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
