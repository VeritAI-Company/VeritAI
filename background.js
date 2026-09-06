async function setupOffscreen() {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'], 
        justification: '이미지 리사이징 및 처리 연산'
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
        setupOffscreen().then(() => {
            chrome.runtime.sendMessage(request, (response) => {
                sendResponse(response);
            });
        });
        return true; 
    }
    else if (request.action === "keep_alive") {
        sendResponse({ status: "alive" });
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