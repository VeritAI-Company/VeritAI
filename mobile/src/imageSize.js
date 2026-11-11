import { MIN_IMAGE_SIDE } from './api';

export const TOO_SMALL_MESSAGE = `사진이 너무 작습니다. 가로와 세로가 모두 ${MIN_IMAGE_SIDE}px 이상인 사진이나 영상으로 시도해 주세요.`;

// 크기를 알 수 없으면(0이거나 숫자가 아님) 거절하지 않고 뒤 단계에 맡긴다
export function isTooSmall(width, height) {
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Math.min(width, height) < MIN_IMAGE_SIDE;
}

export function assertNotTooSmall(width, height) {
    if (!isTooSmall(width, height)) return;
    const err = new Error(TOO_SMALL_MESSAGE);
    err.tooSmall = true;
    throw err;
}
