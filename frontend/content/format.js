// 확장 화면 전용 표시 도우미 (판정 기준과 공통 표시는 shared/judgment.js)

export function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

export function formatFrameTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(total / 60);
    const sec = String(total % 60).padStart(2, '0');
    return `${m}:${sec}`;
}
