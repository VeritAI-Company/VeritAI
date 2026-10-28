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
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || tab.id === undefined) {
            showNotice("현재 탭을 찾을 수 없습니다.", true);
            return;
        }
        chrome.tabs.sendMessage(tab.id, { action: "clear_cache_and_rescan" }, (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
                showNotice("이 페이지에서는 사용할 수 없습니다.", true);
                return;
            }
            showNotice("캐시를 비웠습니다.");
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