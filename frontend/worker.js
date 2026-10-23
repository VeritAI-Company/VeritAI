const MAX_UPLOAD_SIZE = 1280;
const UPLOAD_QUALITY = 0.92;
const PASS_THROUGH_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 확장 화면이 보낸 요청은 백그라운드가 받아서 넘겨준다. 같은 사진을 두 번 처리하지 않도록 넘겨받은 요청만 처리한다
    if (request.action === "resize_image" && request.target === 'offscreen') {
        
        (async () => {
            try {
                const response = await fetch(request.url);
                const blob = await response.blob();
                const imageBitmap = await createImageBitmap(blob);
                const longSide = Math.max(imageBitmap.width, imageBitmap.height);
                let uploadBlob = blob;

                if (longSide > MAX_UPLOAD_SIZE || !PASS_THROUGH_TYPES.includes(blob.type)) {
                    const scale = Math.min(1, MAX_UPLOAD_SIZE / longSide);
                    const width = Math.max(1, Math.round(imageBitmap.width * scale));
                    const height = Math.max(1, Math.round(imageBitmap.height * scale));
                    const offscreen = new OffscreenCanvas(width, height);
                    offscreen.getContext('2d').drawImage(imageBitmap, 0, 0, width, height);
                    uploadBlob = await offscreen.convertToBlob({ type: 'image/webp', quality: UPLOAD_QUALITY });
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