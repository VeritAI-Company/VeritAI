// 장면 고르기 막대: 막대 위의 위치(0~1)와 영상 시각(ms)을 서로 바꾼다
export function clamp01(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function ratioFromX(x, width) {
    return width > 0 ? clamp01(x / width) : 0;
}

export function ratioFromTime(timeMs, durationMs) {
    return durationMs > 0 ? clamp01(timeMs / durationMs) : 0;
}

export function timeFromRatio(ratio, durationMs) {
    return durationMs > 0 ? Math.round(clamp01(ratio) * durationMs) : 0;
}

// 영상 길이는 갤러리에서는 숫자, 공유받을 때는 문자열로 올 수 있다. 알 수 없으면 null
export function parseDurationMs(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}
