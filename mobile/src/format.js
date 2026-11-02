// 날짜와 검사 경로 표시

export function sourceLabel(source) {
    return { share: '공유', gallery: '갤러리', camera: '카메라' }[source] || '';
}

export function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
