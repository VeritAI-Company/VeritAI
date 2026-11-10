import { UPLOAD_IMAGE_QUALITY, UPLOAD_IMAGE_TYPE, UPLOAD_MAX_SIDE } from '../../shared/api.js';

// 1280px 이하 원본은 다시 압축하지 않고 그대로 보낸다 (압축을 한 번 더 하면 흔적이 쌓인다)
const PASS_THROUGH_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function limitImageSize(blob) {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    const longSide = Math.max(width, height);
    if (longSide <= UPLOAD_MAX_SIDE && PASS_THROUGH_TYPES.includes(blob.type)) {
        bitmap.close();
        return blob;
    }
    const ratio = Math.min(1, UPLOAD_MAX_SIDE / longSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const resized = await new Promise(resolve => canvas.toBlob(resolve, UPLOAD_IMAGE_TYPE, UPLOAD_IMAGE_QUALITY));
    canvas.width = 0;
    canvas.height = 0;
    if (!resized) throw new Error("이미지 축소 실패");
    return resized;
}

export async function captureImageBlob(imageUrl) {
    if (!imageUrl) throw new Error("이미지 주소가 없습니다.");
    // 끌어다 놓은 파일은 이 페이지에서 만든 blob: 주소라 다른 출처인 확장(작업 창, 백그라운드)에서는 읽을 수 없다. 여기서 바로 읽는다
    if (imageUrl.startsWith("blob:")) {
        try {
            const res = await fetch(imageUrl);
            return await limitImageSize(await res.blob());
        } catch (e) {
            throw new Error("끌어다 놓은 사진을 읽지 못했습니다.");
        }
    }
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: "resize_image", url: imageUrl }, async (response) => {
            if (response && response.success && response.base64) {
                try {
                    const res = await fetch(response.base64);
                    resolve(await res.blob());
                } catch (e) { reject(new Error("이미지 변환 실패")); }
            } else {
                chrome.runtime.sendMessage({ action: "fetch_image", url: imageUrl }, async (fbResponse) => {
                    if (fbResponse && fbResponse.dataUrl) {
                        try {
                            const res = await fetch(fbResponse.dataUrl);
                            resolve(await limitImageSize(await res.blob()));
                        } catch (e) { reject(new Error("우회 캡처 실패")); }
                    } else {
                        const blockedErr = new Error("CORS 보안 차단됨");
                        blockedErr.detail = fbResponse?.error || response?.error || "";
                        console.warn("[VeritAI] 이미지를 가져오지 못했습니다:", blockedErr.detail);
                        reject(blockedErr);
                    }
                });
            }
        });
    });
}

export async function captureVideoBlob(video) {
    if (!video) throw new Error("영상 요소를 찾을 수 없습니다.");
    if (video.readyState < 2) { throw new Error("영상이 아직 로드되지 않았습니다."); }
    let width = video.videoWidth || video.clientWidth;
    let height = video.videoHeight || video.clientHeight;
    if (width === 0 || height === 0) throw new Error("영상 크기를 인식할 수 없습니다.");

    return new Promise((resolve, reject) => {
        try {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) return reject(new Error("캔버스 컨텍스트를 생성하지 못했습니다."));

            if (width > UPLOAD_MAX_SIDE || height > UPLOAD_MAX_SIDE) {
                const ratio = Math.min(UPLOAD_MAX_SIDE / width, UPLOAD_MAX_SIDE / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }
            canvas.width = width;
            canvas.height = height;

            if (!video.crossOrigin) video.crossOrigin = "anonymous";
            ctx.drawImage(video, 0, 0, width, height);

            canvas.toBlob((blob) => {
                canvas.width = 0;
                canvas.height = 0;
                if (!blob) return reject(new Error("영상 프레임 데이터를 생성하지 못했습니다."));
                resolve(blob);
            }, UPLOAD_IMAGE_TYPE, UPLOAD_IMAGE_QUALITY);
        } catch (error) {
            reject(new Error("비디오 프레임에 접근할 수 없습니다 (CORS 보안)."));
        }
    });
}
