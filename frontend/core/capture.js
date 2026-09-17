export async function captureImageBlob(imageUrl) {
    if (!imageUrl) throw new Error("이미지 주소가 없습니다.");
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
                            resolve(await res.blob());
                        } catch (e) { reject(new Error("우회 캡처 실패")); }
                    } else {
                        reject(new Error(response?.error || fbResponse?.error || "CORS 보안 차단됨"));
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

            const MAX_SIZE = 1280;
            if (width > MAX_SIZE || height > MAX_SIZE) {
                const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
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
            }, "image/webp", 0.7);
        } catch (error) {
            reject(new Error("비디오 프레임에 접근할 수 없습니다 (CORS 보안)."));
        }
    });
}