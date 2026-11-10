// 영상은 서버로 보내지 않는다. 브라우저에서 영상을 열어 고른 장면 한 장만 사진으로 만들어 기존 사진 검사 흐름에 넣는다.
// (확장의 영상 검사, 앱의 영상 검사와 같은 방식이다)
import { CONVERT_ERROR, TOO_SMALL_MESSAGE, encodeUpload, isTooSmall } from './image.js';

export const DEFAULT_FRAME_SEC = 1;
const OPEN_TIMEOUT_MS = 10000;
const SEEK_TIMEOUT_MS = 8000;
export const OPEN_ERROR = '이 영상 형식은 열 수 없습니다. MP4로 바꾸거나 스크린샷으로 시도해 주세요.';
export const FRAME_ERROR = '영상에서 화면을 가져오지 못했습니다. 다른 영상이나 스크린샷으로 시도해 주세요.';

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|wmv)$/i;

export function isVideoFile(file) {
    if (!file) return false;
    if (file.type) return file.type.startsWith('video/');
    return VIDEO_EXTENSIONS.test(file.name || ''); // 일부 브라우저는 영상 형식을 비워서 보낸다
}

export function formatTime(sec) {
    const total = Math.max(0, Math.floor(Number(sec) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// 영상 길이를 알면 끝에서 0.1초 안쪽으로 자른다 (끝 지점은 화면이 비는 경우가 있다)
export function clampFrameTime(sec, duration) {
    const value = Math.max(0, Number(sec) || 0);
    if (!Number.isFinite(duration) || duration <= 0) return value;
    return Math.min(value, Math.max(0, duration - 0.1));
}

function waitFor(target, eventName, timeoutMs, message) {
    return new Promise((resolve, reject) => {
        const finish = (error) => {
            clearTimeout(timer);
            target.removeEventListener(eventName, onDone);
            target.removeEventListener('error', onError);
            if (error) reject(error); else resolve();
        };
        const onDone = () => finish(null);
        const onError = () => finish(new Error(message));
        const timer = setTimeout(() => finish(new Error(message)), timeoutMs);
        target.addEventListener(eventName, onDone);
        target.addEventListener('error', onError);
    });
}

// 길이를 알 수 없는 영상(스트림 형식 등)은 duration이 null이다
export async function openVideo(file) {
    const url = URL.createObjectURL(file);
    const element = document.createElement('video');
    element.muted = true;
    element.playsInline = true;
    element.preload = 'auto';
    element.src = url;
    const video = { element, url, duration: null };
    try {
        await waitFor(element, 'loadedmetadata', OPEN_TIMEOUT_MS, OPEN_ERROR);
        if (!element.videoWidth || !element.videoHeight) throw new Error(OPEN_ERROR); // 소리만 있는 파일 등
        if (isTooSmall(element.videoWidth, element.videoHeight)) throw new Error(TOO_SMALL_MESSAGE);
    } catch (err) {
        closeVideo(video);
        throw err;
    }
    video.duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null;
    return video;
}

export function closeVideo(video) {
    if (!video) return;
    video.element.removeAttribute('src');
    video.element.load();
    URL.revokeObjectURL(video.url);
}

export async function captureFrame(video, timeSec) {
    const element = video.element;
    const time = clampFrameTime(timeSec, video.duration);
    try {
        if (Math.abs(element.currentTime - time) > 0.01) {
            const seeked = waitFor(element, 'seeked', SEEK_TIMEOUT_MS, FRAME_ERROR);
            element.currentTime = time;
            await seeked;
        }
        if (element.readyState < 2) await waitFor(element, 'loadeddata', SEEK_TIMEOUT_MS, FRAME_ERROR);
        const frame = await encodeUpload(element, element.videoWidth, element.videoHeight);
        return {
            ...frame,
            mediaType: 'video_frame',
            frameTimeMs: Math.round(time * 1000),
            durationMs: video.duration ? Math.round(video.duration * 1000) : null,
        };
    } catch (err) {
        throw err?.message === CONVERT_ERROR ? err : new Error(FRAME_ERROR);
    }
}
