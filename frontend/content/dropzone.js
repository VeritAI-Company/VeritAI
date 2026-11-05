import { icon } from '../ui/styles.js';
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

export function injectDropzone() {
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

export function analyzeStandaloneMedia(src, isVideo) {
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
    modal.veritaiClose = closeModal;
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
