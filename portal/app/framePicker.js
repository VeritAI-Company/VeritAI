// 영상을 골랐을 때 미리보기 화면에서 검사할 장면을 고르는 부분 (슬라이더와 -5초/-1초/+1초/+5초)
import { captureFrame, formatTime } from '../video.js';
import { $, state } from './state.js';

const currentSec = () => (state.image?.frameTimeMs ?? 0) / 1000;
let pendingSec = null; // 장면을 가져오는 동안은 놓은 자리를 보여 준다 (끝나면 실제 지점으로 돌아감)
const shownSec = () => pendingSec ?? currentSec();

function showFrameError(message) {
    const box = $('frame-error');
    box.textContent = message || '';
    box.hidden = !message;
}

export function renderFramePicker() {
    const isVideo = Boolean(state.video);
    $('frame-picker').hidden = !isVideo;
    $('inspect-label').textContent = isVideo ? '이 장면 검사하기' : '검사하기';
    $('btn-preview-restart').textContent = isVideo ? '다른 영상·사진 선택' : '다른 사진 선택';
    $('preview-image').alt = isVideo ? '선택한 영상 장면 미리보기' : '선택한 사진 미리보기';
    $('btn-inspect').disabled = state.frameBusy;
    if (!isVideo) return;

    const { duration } = state.video;
    const slider = $('frame-slider');
    slider.hidden = !duration;
    slider.disabled = state.frameBusy;
    if (duration) {
        slider.max = String(duration);
        slider.value = String(shownSec());
    }
    $('frame-time').textContent = frameLabel(shownSec());
    document.querySelectorAll('[data-frame-delta]').forEach(btn => { btn.disabled = state.frameBusy; });
}

function frameLabel(sec) {
    const duration = state.video?.duration;
    return `영상 ${formatTime(sec)} 지점${duration ? ` / ${formatTime(duration)}` : ''}`;
}

// 슬라이더를 끄는 동안에는 시간 표시만 바꾸고, 손을 떼면 그 장면을 가져온다
export function onFrameSliderInput(event) {
    $('frame-time').textContent = frameLabel(Number(event.target.value));
}

export function onFrameSliderChange(event) {
    changeFrame(Number(event.target.value));
}

export function stepFrame(deltaSec) {
    changeFrame(currentSec() + deltaSec);
}

async function changeFrame(timeSec) {
    const video = state.video;
    if (!video || state.frameBusy || state.busy) return;
    state.frameBusy = true;
    pendingSec = timeSec;
    showFrameError('');
    renderFramePicker();
    try {
        const prepared = await captureFrame(video, timeSec);
        if (state.video !== video) { // 기다리는 동안 다른 파일을 골랐거나 처음으로 돌아갔다
            URL.revokeObjectURL(prepared.url);
            return;
        }
        if (state.image?.url) URL.revokeObjectURL(state.image.url);
        state.image = prepared;
        $('preview-image').src = prepared.url;
    } catch (err) {
        if (state.video === video) showFrameError(err.message);
    } finally {
        pendingSec = null;
        if (state.video === video) {
            state.frameBusy = false;
            renderFramePicker();
        }
    }
}
