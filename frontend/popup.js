const systemToggle = document.getElementById('system-toggle');
const autoToggle = document.getElementById('auto-toggle');
const cleanToggle = document.getElementById('clean-toggle');
const statusText = document.getElementById('status-text');

chrome.storage.local.get(['isSystemOn', 'isAutoScanOn', 'isCleanUIMode'], (res) => {
    const sysOn = res.isSystemOn !== false;
    const autoOn = !!res.isAutoScanOn;
    const cleanOn = !!res.isCleanUIMode;

    systemToggle.checked = sysOn;
    autoToggle.checked = autoOn;
    cleanToggle.checked = cleanOn;
    
    updateUI();
});

function updateUI() {
    const sysOn = systemToggle.checked;
    const autoOn = autoToggle.checked;

    autoToggle.disabled = !sysOn;
    cleanToggle.disabled = !sysOn;
    
    statusText.className = '';
    if (!sysOn) {
        statusText.innerText = "꺼져 있습니다. 사진에 아무것도 표시하지 않습니다.";
    } else {
        statusText.innerText = autoOn ? "보이는 사진을 자동으로 검사합니다." : "사진의 검사 버튼을 눌러 검사합니다.";
    }
}

function syncState() {
    updateUI();
    const state = { 
        isSystemOn: systemToggle.checked, 
        isAutoScanOn: autoToggle.checked,
        isCleanUIMode: cleanToggle.checked 
    };
    
    chrome.storage.local.set(state);
}

systemToggle.addEventListener('change', syncState);
autoToggle.addEventListener('change', syncState);
cleanToggle.addEventListener('change', syncState);

document.getElementById('feedback-link').addEventListener('click', () => {
    const feedbackUrl = "https://docs.google.com/forms/d/e/1FAIpQLSfi5Tz8hOC72142Mtl4entlFt6eG2QmnfwaPhxR7sXWcHV5IA/viewform?usp=pp_url&entry.608323805=%ED%81%AC%EB%A1%AC+%ED%99%95%EC%9E%A5+%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8";
    chrome.tabs.create({ url: feedbackUrl });
});

let noticeTimer = null;

function showNotice(message, isError = false) {
    clearTimeout(noticeTimer);
    statusText.innerText = message;
    statusText.className = isError ? 'is-error' : 'is-ok';
    noticeTimer = setTimeout(updateUI, 2500);
}

document.getElementById('clear-cache-btn').addEventListener('click', () => {
    const clearButton = document.getElementById('clear-cache-btn');
    clearButton.disabled = true;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || tab.id === undefined) {
            showNotice("현재 탭을 찾을 수 없습니다.", true);
            clearButton.disabled = false;
            return;
        }
        chrome.tabs.sendMessage(tab.id, { action: "clear_cache_and_rescan" }, (response) => {
            clearButton.disabled = false;
            if (chrome.runtime.lastError || !response) {
                showNotice("이 페이지에서는 사용할 수 없습니다.", true);
                return;
            }
            if (!response.success) {
                showNotice(response.message || "검사 기록을 삭제하지 못했습니다.", true);
                return;
            }
            const pendingCount = response.deletion?.pendingIds?.length || 0;
            showNotice(pendingCount > 0
                ? `검사 기록과 캐시를 비웠습니다. 처리 중인 검사 ${pendingCount}건은 끝난 뒤 다시 비우면 지워집니다.`
                : "검사 기록과 캐시를 비웠습니다.");
            loadStatistics();
        });
    });
});

function loadStatistics() {
    const today = new Date().toLocaleDateString(); 
    
    chrome.storage.local.get(['veritai_stat_date', 'veritai_stat_scanned', 'veritai_stat_blocked'], (res) => {
        let scanned = res.veritai_stat_scanned || 0;
        let blocked = res.veritai_stat_blocked || 0;
        
        if (res.veritai_stat_date !== today) {
            scanned = 0;
            blocked = 0;
            chrome.storage.local.set({
                veritai_stat_date: today,
                veritai_stat_scanned: 0,
                veritai_stat_blocked: 0
            });
        }
        
        document.getElementById('stat-scanned').innerText = scanned.toLocaleString();
        document.getElementById('stat-blocked').innerText = blocked.toLocaleString();
    });
}

document.addEventListener('DOMContentLoaded', loadStatistics);

// 분석 서버 연결 상태. 팝업은 content script와 모듈을 나눠 쓰면 빌드가 막히므로(vite.config.js) 이 파일 안에 둔다
const API_BASE = typeof __VERITAI_API_BASE__ !== 'undefined' ? __VERITAI_API_BASE__ : 'http://localhost:8080';
const SERVER_CHECK_TIMEOUT_MS = 4000;
const AI_STATUS_KEY = 'veritai_ai_status';
const AI_STATUS_FRESH_MS = 30 * 60 * 1000; // 30분이 지난 실패 기록은 지금 상태로 보지 않는다

function setServerStatus(level, text) {
    document.getElementById('server-status').className = `server${level ? ` is-${level}` : ''}`;
    document.getElementById('server-text').innerText = text;
    document.getElementById('server-retry').hidden = level === '' || level === 'ok';
}

async function readRecentAiFailure() {
    const res = await chrome.storage.local.get([AI_STATUS_KEY]);
    const status = res[AI_STATUS_KEY];
    return Boolean(status && status.ok === false && Date.now() - status.at < AI_STATUS_FRESH_MS);
}

async function checkServerStatus() {
    setServerStatus('', '분석 서버 확인 중');
    try { document.getElementById('server-host').innerText = new URL(API_BASE).host; } catch (_) { /* 주소 표시만 건너뛴다 */ }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVER_CHECK_TIMEOUT_MS);
    try {
        const response = await fetch(`${API_BASE.replace(/\/$/, '')}/api/detections/queue`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const metrics = await response.json();
        if (metrics.running === false) {
            setServerStatus('warn', '분석 서버가 검사를 멈췄습니다');
        } else if (await readRecentAiFailure()) {
            setServerStatus('warn', '서버 연결됨 · 최근 AI 판정 실패');
        } else {
            const queued = Number(metrics.queuedCount) || 0;
            setServerStatus('ok', queued > 0 ? `분석 서버 연결됨 · 대기 ${queued}건` : '분석 서버 연결됨');
        }
    } catch (_) {
        setServerStatus('error', '분석 서버에 연결할 수 없습니다');
    } finally {
        clearTimeout(timer);
    }
}

document.getElementById('server-retry').addEventListener('click', checkServerStatus);
checkServerStatus();
