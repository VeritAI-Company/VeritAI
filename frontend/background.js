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

// 작업 창에서 사진을 못 가져왔을 때 쓰는 마지막 방법. 오류 페이지와 아주 큰 파일은 거른다
const FETCH_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const FETCH_IMAGE_TIMEOUT_MS = 15000;

async function fetchImageAsDataUrl(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_IMAGE_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = (res.headers.get('content-type') || '').toLowerCase();
        // 사진을 binary/octet-stream으로 보내는 서버(S3 등)도 있어 오류 페이지 형식만 막는다. 사진인지는 열 때 다시 확인된다
        if (/^(text\/|application\/json)/.test(type)) throw new Error(`사진이 아님 (${type})`);
        const declared = Number(res.headers.get('content-length'));
        if (declared > FETCH_IMAGE_MAX_BYTES) throw new Error('파일이 너무 큼');
        const blob = await res.blob();
        if (blob.size === 0) throw new Error('빈 파일');
        if (blob.size > FETCH_IMAGE_MAX_BYTES) throw new Error('파일이 너무 큼');
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => (reader.result ? resolve(reader.result) : reject(new Error('변환 실패')));
            reader.readAsDataURL(blob);
        });
    } catch (err) {
        if (err.name === 'AbortError') throw new Error('시간 초과');
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

// 오늘 통계는 백그라운드 한 곳에서 순서대로 더한다 (탭마다 읽고 쓰면 동시에 끝난 검사끼리 덮어써서 숫자가 빠진다)
let statQueue = Promise.resolve();
function recordInspectionStat(isFake) {
    statQueue = statQueue.then(async () => {
        const today = new Date().toLocaleDateString();
        const res = await chrome.storage.local.get(['veritai_stat_date', 'veritai_stat_scanned', 'veritai_stat_blocked']);
        const isToday = res.veritai_stat_date === today;
        await chrome.storage.local.set({
            veritai_stat_date: today,
            veritai_stat_scanned: (isToday ? res.veritai_stat_scanned || 0 : 0) + 1,
            veritai_stat_blocked: (isToday ? res.veritai_stat_blocked || 0 : 0) + (isFake ? 1 : 0),
        });
    }).catch(() => { /* 통계만 못 남길 뿐 검사에는 영향 없음 */ });
    return statQueue;
}

// 디시인사이드처럼 Referer가 없는 요청을 막는 사이트(외부 링크 차단)에서도 사진을 받을 수 있게,
// 확장이 사진을 받는 동안만 그 사진 서버로 가는 '확장 자신의 요청'에 원래 페이지 주소(origin)를 Referer로 붙인다.
// 사용자가 사이트를 볼 때의 요청은 건드리지 않는다 (initiatorDomains로 확장 요청만 고른다)
let nextRefererRuleId = 1;

async function clearRefererRules() {
    try {
        const rules = await chrome.declarativeNetRequest.getSessionRules();
        if (rules.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map(r => r.id) });
    } catch { /* 규칙이 없으면 할 일 없음 */ }
}
clearRefererRules(); // 백그라운드가 도중에 꺼졌다 켜졌을 때 남은 규칙 정리

async function withPageReferer(imageUrl, pageUrl, task) {
    let ruleId = null;
    try {
        const image = new URL(imageUrl);
        const page = new URL(pageUrl);
        if (/^https?:$/.test(image.protocol) && /^https?:$/.test(page.protocol)) {
            ruleId = nextRefererRuleId++;
            await chrome.declarativeNetRequest.updateSessionRules({
                addRules: [{
                    id: ruleId,
                    priority: 1,
                    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: `${page.origin}/` }] },
                    condition: { requestDomains: [image.hostname], initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest', 'other'] },
                }],
            });
        }
    } catch {
        ruleId = null; // 규칙을 못 만들어도 Referer 없이 시도한다
    }
    try {
        return await task();
    } finally {
        if (ruleId) chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const pageUrl = sender.tab?.url || sender.url || '';

    if (request.action === "record_stat") {
        recordInspectionStat(Boolean(request.isFake)).then(() => sendResponse({ ok: true }));
        return true;
    }

    else if (request.action === "fetch_image") {
        withPageReferer(request.url, pageUrl, () => fetchImageAsDataUrl(request.url))
            .then(dataUrl => sendResponse({ dataUrl }))
            .catch(err => sendResponse({ error: "CORS fetch 실패: " + err.message }));
        return true;
    }
    
    else if (request.action === "resize_image") {
        // 작업 창으로 넘긴 요청은 백그라운드가 다시 받지 않는다
        if (request.target === 'offscreen') return false;
        activeResizeCount += 1;
        setupOffscreen()
            .then(() => withPageReferer(request.url, pageUrl, () => resizeInOffscreen(request)))
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
        title: "VeritAI로 조작 정밀 검사",
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