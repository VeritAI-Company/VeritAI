// 사진 고르기, 검사 요청, 처음으로 돌아가기
import { requestDetection, toFriendlyMessage } from '../api.js';
import { prepareImage } from '../image.js';
import { drawCanvas, renderResult } from './result.js';
import { $, state } from './state.js';
import { setLoadingText, showError, showView } from './view.js';

export function resetAll() {
    if (state.image?.url) URL.revokeObjectURL(state.image.url);
    Object.assign(state, { image: null, data: null, baseImg: null, heatmapImg: null, heatmapMode: false, heatmapView: null, busy: false });
    $('input-camera').value = '';
    $('input-gallery').value = '';
    $('preview-image').removeAttribute('src');
    showView('start');
}

export async function handleFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setLoadingText('사진을 준비하는 중...');
    showView('loading');
    try {
        const prepared = await prepareImage(file);
        if (state.image?.url) URL.revokeObjectURL(state.image.url);
        state.image = prepared;
        $('preview-image').src = prepared.url;
        showView('preview');
    } catch (err) {
        state.image = null;
        showError(err.message);
    }
}

export async function inspect() {
    if (!state.image || state.busy) return;
    state.busy = true;
    setLoadingText('서버로 전송하는 중...');
    showView('loading');

    try {
        const data = await requestDetection(state.image.blob, (status) => {
            setLoadingText(status === 'PROCESSING' ? 'AI가 분석하는 중...' : '분석 대기 중...');
        });
        await renderResult(data);
        showView('result');
        drawCanvas();
    } catch (err) {
        showError(toFriendlyMessage(err));
    } finally {
        state.busy = false;
    }
}
