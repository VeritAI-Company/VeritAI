import { icon } from '../ui/styles.js';
import { scanCache } from './cache.js';
import { getCheckButton } from './dom.js';
import { startInspection } from './inspect.js';

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
        // 파일이나 사진(링크)을 끌 때만 띄운다. 글자만 끌 때(text/html, text/plain)는 띄우지 않는다
        if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list")) {
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

export function injectDropzone() {
    attachDropzoneListeners();
    if (document.getElementById('veritai-mini-hint')) return;
    dragCounter = 0;

    const miniHint = document.createElement('div');
    miniHint.id = 'veritai-mini-hint';
    miniHint.innerHTML = `${icon('upload')}<span class="veritai-mini-text">사진을 끌어다 검사</span>`;
    // 클릭이 통과하는 안내라 마우스를 올려 펼칠 수 없으므로, 처음 3초만 글자를 보여 주고 아이콘으로 줄인다
    miniHint.classList.add('is-open');
    setTimeout(() => miniHint.classList.remove('is-open'), 3000);
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

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
                const note = files.length > 1 ? `파일 ${files.length}개 중 첫 번째만 검사합니다.` : null;
                analyzeStandaloneMedia(URL.createObjectURL(file), file.type.startsWith('video/'), note);
            } else {
                showDropNotice('사진이나 영상 파일만 검사할 수 있습니다.');
            }
        } else {
            const src = findDroppedImageUrl(e.dataTransfer);
            if (src) analyzeStandaloneMedia(src, false);
            else showDropNotice('끌어온 항목에서 사진을 찾지 못했습니다.');
        }
    });
}

// 다른 페이지에서 끌어온 사진의 주소. DOMParser로 img의 src만 꺼낸다 (만든 문서는 스크립트를 실행하거나 사진을 불러오지 않는다)
function findDroppedImageUrl(dataTransfer) {
    const toAbsolute = (value) => {
        try {
            const url = new URL(value, location.href);
            return ['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) ? url.href : null;
        } catch { return null; }
    };
    const html = dataTransfer.getData('text/html');
    if (html) {
        const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]');
        const src = img && toAbsolute(img.getAttribute('src'));
        if (src) return src;
    }
    // uri-list는 여러 줄일 수 있고 #으로 시작하는 줄은 설명이다
    const uri = (dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
    return uri ? toAbsolute(uri) : null;
}

// 모달은 같은 주소의 새 사진으로 검사하므로 결과가 모달 안의 사진에만 붙는다. 닫을 때 페이지에 있는 같은 주소의 사진에도 결과를 보여 준다
// (결과가 캐시에 있으면 서버에 다시 보내지 않는다)
function showCachedResultOnPage(src) {
    if (!scanCache.has(src)) return;
    document.querySelectorAll('img, video').forEach(el => {
        if ((el.currentSrc || el.src) !== src || el.closest('.veritai-standalone-modal') || !getCheckButton(el)) return;
        el.dataset.veritaiUserRequest = "true";
        startInspection(el);
    });
}

// 끌어다 놓기 모달의 틀: 닫기 버튼, Esc, 배경 클릭, 접근성. 이미 열린 모달이 있으면 먼저 닫아 겹치지 않게 한다
function openStandaloneModal(onClose) {
    document.querySelectorAll('.veritai-standalone-modal').forEach(m => (m.veritaiClose ? m.veritaiClose() : m.remove()));

    const modal = document.createElement('div');
    modal.className = 'veritai-standalone-modal';

    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = `${icon('close')}<span>닫기</span>`;
    closeBtn.className = 'vr-modal-close';

    closeBtn.tabIndex = 0;
    closeBtn.setAttribute('role', 'button');
    closeBtn.setAttribute('aria-label', '모달 닫기');
    const previousFocus = document.activeElement;

    // 모달 안을 클릭하면 포커스가 빠져나가므로 Esc는 문서 전체에서 받는다. 글을 쓰는 중(신고 입력 등)에는 닫지 않는다
    const onEscape = (e) => {
        if (e.key !== 'Escape') return;
        if (!modal.isConnected) { document.removeEventListener('keydown', onEscape, true); return; }
        const target = e.composedPath()[0];
        if (target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
        e.preventDefault();
        e.stopPropagation();
        closeModal();
    };
    const closeModal = () => {
        document.removeEventListener('keydown', onEscape, true);
        modal.remove();
        if (onClose) onClose();
        // 모달을 열기 전에 있던 곳으로 포커스를 돌려준다
        if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
    };
    document.addEventListener('keydown', onEscape, true);
    closeBtn.onclick = closeModal;
    modal.veritaiClose = closeModal;
    closeBtn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeModal(); } };

    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'VeritAI 사진 검사');
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); }); // 어두운 배경을 누르면 닫는다
    // 모달이 열려 있는 동안 뒤의 페이지가 스크롤되어 결과창이 닫히지 않게 한다 (Ctrl+휠 확대는 그대로 둔다)
    modal.addEventListener('wheel', (e) => { if (!e.ctrlKey) e.preventDefault(); }, { passive: false });
    modal.addEventListener('keydown', (e) => {
        // Tab으로 이동해도 포커스가 모달 밖 페이지로 나가지 않게 한다
        if (e.key === 'Tab') {
            const focusables = Array.from(modal.querySelectorAll('[tabindex="0"], button, video[controls]'));
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    });

    setTimeout(() => closeBtn.focus(), 100);
    modal.appendChild(closeBtn);
    document.body.appendChild(modal);
    return { modal, closeBtn };
}

function createModalMessage(text, className) {
    const box = document.createElement('div');
    box.className = className;
    box.setAttribute('role', 'alert');
    box.textContent = text;
    return box;
}

// 사진이나 영상이 아닌 것을 놓았을 때 알려 준다
export function showDropNotice(message) {
    const { modal } = openStandaloneModal();
    modal.appendChild(createModalMessage(message, 'vr-modal-error'));
}

export function analyzeStandaloneMedia(src, isVideo, note = null) {
    const { modal } = openStandaloneModal(() => {
        if (src.startsWith('blob:')) URL.revokeObjectURL(src);
        else showCachedResultOnPage(src);
    });

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative; display:inline-block; max-width:80vw; max-height:80vh; background:#000; border-radius:8px; overflow:visible;';

    const media = document.createElement(isVideo ? 'video' : 'img');
    media.src = src;
    media.style.cssText = 'max-width:80vw; max-height:80vh; display:block; border-radius:8px;';
    if (isVideo) { media.controls = true; media.autoplay = true; media.muted = true; }

    // 손상된 파일, 막힌 주소, 사진이 아닌 링크는 불러오지 못하므로 검사하지 않고 안내한다
    media.onerror = () => {
        wrapper.style.background = 'none';
        wrapper.replaceChildren(createModalMessage(isVideo ? '이 영상을 불러오지 못했습니다. 다른 영상으로 시도해 주세요.' : '이 사진을 불러오지 못했습니다. 사진 파일이 맞는지, 사이트에서 막지 않았는지 확인해 주세요.', 'vr-modal-error'));
    };

    wrapper.appendChild(media);
    modal.appendChild(wrapper);
    if (note) modal.appendChild(createModalMessage(note, 'vr-modal-note'));

    const initInspect = () => setTimeout(() => {
        if (!media.isConnected) return; // 그 사이 모달을 닫았으면 검사하지 않는다 (사진 주소도 이미 해제됨)
        media.dataset.forceInspect = "true";
        startInspection(media);
    }, 300);
    if (isVideo) media.onloadeddata = initInspect; else media.onload = initInspect;
}
