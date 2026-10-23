import * as Manipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';

const MAX_SIZE = 1280;
const JPEG_QUALITY = 0.85;
const DEFAULT_FRAME_MS = 1000;

export function toFileUri(path) {
    if (!path) return path;
    return /^[a-z]+:\/\//i.test(path) ? path : `file://${path}`;
}

export function isVideoMime(mimeType) {
    return typeof mimeType === 'string' && mimeType.startsWith('video/');
}

export function formatTime(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function clampFrameTime(ms, durationMs) {
    const value = Math.max(0, Math.round(Number(ms) || 0));
    if (!durationMs || durationMs <= 0) return value;
    return Math.min(value, Math.max(0, durationMs - 100));
}

export async function prepareMedia({ uri, isVideo = false, durationMs = null }) {
    if (!isVideo) {
        const prepared = await resizeToJpeg(uri);
        return { ...prepared, mediaType: 'image' };
    }
    const firstTime = durationMs && durationMs < DEFAULT_FRAME_MS ? 0 : DEFAULT_FRAME_MS;
    let frame;
    try {
        frame = await prepareVideoFrame({ uri, timeMs: firstTime, durationMs });
    } catch {
        try {
            frame = await prepareVideoFrame({ uri, timeMs: 0, durationMs });
        } catch {
            throw new Error('영상에서 화면을 가져오지 못했습니다. 다른 영상이나 스크린샷으로 시도해 주세요.');
        }
    }
    return frame;
}

export async function prepareVideoFrame({ uri, timeMs, durationMs = null }) {
    const time = clampFrameTime(timeMs, durationMs);
    const thumb = await VideoThumbnails.getThumbnailAsync(uri, { time, quality: 1 });
    const prepared = await resizeToJpeg(thumb.uri);
    return {
        ...prepared,
        mediaType: 'video_frame',
        sourceUri: uri,
        durationMs: durationMs || null,
        frameTimeMs: time,
    };
}

async function resizeToJpeg(uri) {
    try {
        if (Manipulator.ImageManipulator?.manipulate) {
            const probe = await Manipulator.ImageManipulator.manipulate(uri).renderAsync();
            const { width, height } = probe;
            const context = Manipulator.ImageManipulator.manipulate(uri);
            const resize = fitSize(width, height);
            if (resize) context.resize(resize);
            const image = await context.renderAsync();
            const saved = await image.saveAsync({ format: Manipulator.SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
            return { uri: saved.uri, width: saved.width, height: saved.height, base64: saved.base64 };
        }

        const probe = await Manipulator.manipulateAsync(uri, []);
        const resize = fitSize(probe.width, probe.height);
        const saved = await Manipulator.manipulateAsync(uri, resize ? [{ resize }] : [], {
            compress: JPEG_QUALITY, format: Manipulator.SaveFormat.JPEG, base64: true,
        });
        return { uri: saved.uri, width: saved.width, height: saved.height, base64: saved.base64 };
    } catch (err) {
        console.warn('[VeritAI] 사진 변환 실패:', uri, err?.message);
        const mediaErr = new Error('사진을 변환하지 못했습니다. 다른 사진으로 시도해 주세요.');
        mediaErr.detail = `${err?.name || 'Error'}: ${err?.message || String(err)}`;
        throw mediaErr;
    }
}

function fitSize(width, height) {
    if (!width || !height || Math.max(width, height) <= MAX_SIZE) return null;
    return width >= height ? { width: MAX_SIZE } : { height: MAX_SIZE };
}
