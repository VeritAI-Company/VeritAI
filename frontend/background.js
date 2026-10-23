let offscreenTimeout = null;
let offscreenCreating = null;
let activeResizeCount = 0;
const OFFSCREEN_LIFETIME = 30000;
const RESIZE_TIMEOUT = 20000;

async function setupOffscreen() {
    if (offscreenTimeout) {
        clearTimeout(offscreenTimeout);
        offscreenTimeout = null;
    }
    if (await chrome.offscreen.hasDocument()) return;
    // 여러 사진이 동시에 요청해도 문서는 한 번만 만든다
    if (!offscreenCreating) {
        offscreenCreating = chrome.offscreen.createDocument({
            url: 'frontend/offscreen.html',
            reasons: ['WORKERS'],
            justification: '이미지 리사이징 및 처리 연산'
        }).finally(() => { offscreenCreating = null; });
    }
    await offscreenCreating;
}

function scheduleOffscreenClose() {
    if (offscreenTimeout) clearTimeout(offscreenTimeout);
    // 처리 중인 요청이 있으면 닫지 않는다
    if (activeResizeCount > 0) return;
    offscreenTimeout = setTimeout(async () => {
        offscreenTimeout = null;
        if (activeResizeCount > 0) return;
        if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    }, OFFSCREEN_LIFETIME);
}

function resizeInOffscreen(request) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ success: false, error: "축소 응답 시간 초과" }), RESIZE_TIMEOUT);
        chrome.runtime.sendMessage({ ...request, target: 'offscreen' }, (response) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
            else resolve(response || { success: false, error: "응답 없음" });
        });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    if (request.action === "fetch_image") {
        fetch(request.url)
            .then(res => res.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => sendResponse({ dataUrl: reader.result });
                reader.readAsDataURL(blob);
            })
            .catch(err => {
                sendResponse({ error: "CORS fetch 실패: " + err.message });
            });
        return true; 
    } 
    
    else if (request.action === "resize_image") {
        // 작업 창으로 넘긴 요청은 백그라운드가 다시 받지 않는다
        if (request.target === 'offscreen') return false;
        activeResizeCount += 1;
        setupOffscreen()
            .then(() => resizeInOffscreen(request))
            .catch(err => ({ success: false, error: err.message }))
            .then(response => {
                activeResizeCount -= 1;
                scheduleOffscreenClose();
                sendResponse(response);
            });
        return true; 
    }
    else {
        sendResponse({ error: "알 수 없는 요청입니다." });
    }
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "veritai_inspect",
        title: "🔍 VeritAI로 조작 정밀 검사",
        contexts: ["image", "video"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "veritai_inspect") {
        chrome.tabs.sendMessage(tab.id, {
            action: "context_menu_inspect",
            srcUrl: info.srcUrl,
            mediaType: info.mediaType 
        });
    }
});