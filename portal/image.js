const MAX_SIZE = 1280;

export async function prepareImage(file) {
    if (!file || !file.type.startsWith('image/')) {
        throw new Error('이미지 파일만 검사할 수 있습니다.');
    }

    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        throw new Error('이 사진 형식은 열 수 없습니다. JPG나 PNG로 바꿔서 다시 시도해 주세요.');
    }

    let width = bitmap.width;
    let height = bitmap.height;
    if (width > MAX_SIZE || height > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let blob = await toBlob(canvas, 'image/webp', 0.85);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.9);
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('사진을 변환하지 못했습니다.');

    return { blob, width, height, url: URL.createObjectURL(blob) };
}

function toBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}
