import { MIN_IMAGE_SIDE, UPLOAD_IMAGE_QUALITY, UPLOAD_IMAGE_TYPE, UPLOAD_MAX_SIDE } from '../shared/api.js';

export const NOT_MEDIA_MESSAGE = '사진이나 영상 파일만 검사할 수 있습니다.';
export const TOO_SMALL_MESSAGE = `사진이 너무 작습니다. 가로와 세로가 모두 ${MIN_IMAGE_SIDE}px 이상인 사진이나 영상으로 시도해 주세요.`;

export function isTooSmall(width, height) {
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Math.min(width, height) < MIN_IMAGE_SIDE;
}
export const CONVERT_ERROR = '사진을 변환하지 못했습니다.';

export async function prepareImage(file) {
    if (!file || !file.type.startsWith('image/')) {
        throw new Error(NOT_MEDIA_MESSAGE);
    }

    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        throw new Error('이 사진 형식은 열 수 없습니다. JPG나 PNG로 바꿔서 다시 시도해 주세요.');
    }

    try {
        if (isTooSmall(bitmap.width, bitmap.height)) throw new Error(TOO_SMALL_MESSAGE);
        return await encodeUpload(bitmap, bitmap.width, bitmap.height);
    } finally {
        bitmap.close();
    }
}

// 사진 비트맵이나 영상 화면 한 장을 업로드 기준(긴 변 1280px, JPEG)으로 줄여 만든다.
// 사진 방향(EXIF)을 바로잡아야 해서 PWA는 항상 다시 압축한다. 기준값은 확장, 앱과 같다 (shared/api.js)
export async function encodeUpload(source, sourceWidth, sourceHeight) {
    let width = sourceWidth;
    let height = sourceHeight;
    if (width > UPLOAD_MAX_SIDE || height > UPLOAD_MAX_SIDE) {
        const ratio = Math.min(UPLOAD_MAX_SIDE / width, UPLOAD_MAX_SIDE / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    try {
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(source, 0, 0, width, height);
        const blob = await toBlob(canvas, UPLOAD_IMAGE_TYPE, UPLOAD_IMAGE_QUALITY);
        if (!blob) throw new Error(CONVERT_ERROR);
        return { blob, width, height, url: URL.createObjectURL(blob) };
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}

function toBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}
