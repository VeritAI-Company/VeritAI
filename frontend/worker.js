// 이 파일은 빌드 때 그대로 복사되어 shared/를 가져올 수 없다. shared/api.js의 UPLOAD_* 값과 같아야 한다 (테스트가 검사)
const MAX_UPLOAD_SIZE = 1280;
const UPLOAD_TYPE = 'image/jpeg';
const UPLOAD_QUALITY = 0.92;
const PASS_THROUGH_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 확장 화면이 보낸 요청은 백그라운드가 받아서 넘겨준다. 같은 사진을 두 번 처리하지 않도록 넘겨받은 요청만 처리한다
    if (request.action === "resize_image" && request.target === 'offscreen') {
        
        (async () => {
            try {
                const response = await fetch(request.url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                // 아주 큰 파일은 줄이기 전에 메모리를 많이 쓰므로 받지 않는다 (background.js의 FETCH_IMAGE_MAX_BYTES와 같은 값)
                if (blob.size > 15 * 1024 * 1024) throw new Error('파일이 너무 큼');
                const imageBitmap = await createImageBitmap(blob);
                const longSide = Math.max(imageBitmap.width, imageBitmap.height);
                let uploadBlob = blob;

                if (longSide > MAX_UPLOAD_SIZE || !PASS_THROUGH_TYPES.includes(blob.type)) {
                    const scale = Math.min(1, MAX_UPLOAD_SIZE / longSide);
                    const width = Math.max(1, Math.round(imageBitmap.width * scale));
                    const height = Math.max(1, Math.round(imageBitmap.height * scale));
                    const offscreen = new OffscreenCanvas(width, height);
                    offscreen.getContext('2d').drawImage(imageBitmap, 0, 0, width, height);
                    uploadBlob = await offscreen.convertToBlob({ type: UPLOAD_TYPE, quality: UPLOAD_QUALITY });
                }
                imageBitmap.close();

                const reader = new FileReader();
                reader.readAsDataURL(uploadBlob);
                reader.onloadend = () => {
                    sendResponse({ success: true, base64: reader.result });
                };

            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; 
    }
});