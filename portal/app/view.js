// 화면 전환, 불러오는 중, 오류 화면, 아이콘, 이미지 불러오기
import { $ } from './state.js';

const VIEWS = ['start', 'preview', 'loading', 'result', 'error'];

const ICONS = {
    alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.2"/><path d="M12 17.2h.01"/>',
    check: '<path d="M5 12.5 10 17l9-10"/>',
};

export function iconSvg(name) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function showView(name) {
    VIEWS.forEach(view => { $(`view-${view}`).hidden = view !== name; });
    window.scrollTo(0, 0);
}

export function setLoadingText(text) {
    $('loading-text').textContent = text;
}

export function showError(message) {
    $('error-text').textContent = message;
    showView('error');
}

export function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
        img.src = src;
    });
}
