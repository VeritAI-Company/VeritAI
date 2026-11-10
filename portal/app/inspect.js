import { requestDetection, toFriendlyMessage } from '../api.js';
import { prepareImage } from '../image.js';
import { DEFAULT_FRAME_SEC, captureFrame, closeVideo, isVideoFile, openVideo } from '../video.js';
import { renderFramePicker } from './framePicker.js';
import { drawCanvas, renderResult } from './result.js';
import { $, state } from './state.js';
import { setLoadingText, showError, showView } from './view.js';

function releaseMedia() {
    if (state.image?.url) URL.revokeObjectURL(state.image.url);
    closeVideo(state.video);
    state.image = null;
    state.video = null;
}

function setMedia(image, video = null) {
    releaseMedia();
    state.image = image;
    state.video = video;
    $('preview-image').src = image.url;
    $('frame-error').hidden = true;
    renderFramePicker();
    showView('preview');
}

export function resetAll() {
    releaseMedia();
    Object.assign(state, { data: null, baseImg: null, heatmapImg: null, heatmapMode: false, heatmapView: null, busy: false, frameBusy: false });
    $('input-camera').value = '';
    $('input-gallery').value = '';
    $('preview-image').removeAttribute('src');
    renderFramePicker();
    showView('start');
}

export async function handleFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const isVideo = isVideoFile(file);
    setLoadingText(isVideo ? '영상에서 장면을 가져오는 중...' : '사진을 준비하는 중...');
    showView('loading');
    try {
        if (isVideo) {
            await prepareVideo(file);
        } else {
            setMedia(await prepareImage(file));
        }
    } catch (err) {
        releaseMedia();
        showError(err.message);
    }
}

// 영상은 1초 지점(영상이 1초보다 짧으면 처음)의 장면을 먼저 보여 주고, 사용자가 다른 장면을 고를 수 있다
async function prepareVideo(file) {
    const video = await openVideo(file);
    try {
        const firstTime = video.duration && video.duration < DEFAULT_FRAME_SEC ? 0 : DEFAULT_FRAME_SEC;
        let frame;
        try {
            frame = await captureFrame(video, firstTime);
        } catch {
            frame = await captureFrame(video, 0);
        }
        setMedia(frame, video);
    } catch (err) {
        closeVideo(video);
        throw err;
    }
}

export async function inspect() {
    if (!state.image || state.busy || state.frameBusy) return;
    state.busy = true;
    setLoadingText('서버로 전송하는 중...');
    showView('loading');

    try {
        const data = await requestDetection(state.image.blob, (status) => {
            setLoadingText(status === 'PROCESSING' ? 'AI가 분석하는 중...' : '분석 대기 중...');
        }, state.image.mediaType || 'image');
        await renderResult(data);
        showView('result');
        drawCanvas();
    } catch (err) {
        showError(toFriendlyMessage(err));
    } finally {
        state.busy = false;
    }
}
