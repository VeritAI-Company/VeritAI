const systemToggle = document.getElementById('system-toggle');
const autoToggle = document.getElementById('auto-toggle');
const statusText = document.getElementById('status-text');

chrome.storage.local.get(['isSystemOn', 'isAutoScanOn'], (res) => {
    const sysOn = res.isSystemOn !== false;
    const autoOn = !!res.isAutoScanOn;

    systemToggle.checked = sysOn;
    autoToggle.checked = autoOn;
    
    updateUI();
});

function updateUI() {
    const sysOn = systemToggle.checked;
    const autoOn = autoToggle.checked;

    autoToggle.disabled = !sysOn;
    
    if (!sysOn) {
        statusText.innerText = "시스템이 중지되었습니다";
        statusText.style.color = "#94A3B8"; 
        statusText.style.background = "transparent";
    } else {
        statusText.innerText = autoOn ? "자동 스캔 모드" : "수동 스캔 모드";
        statusText.style.color = "#3B82F6"; 
        statusText.style.background = "rgba(59, 130, 246, 0.1)";
    }
}

function syncState() {
    updateUI();
    const state = { 
        isSystemOn: systemToggle.checked, 
        isAutoScanOn: autoToggle.checked 
    };
    
    chrome.storage.local.set(state);
}

systemToggle.addEventListener('change', syncState);
autoToggle.addEventListener('change', syncState);

document.getElementById('feedback-link').addEventListener('click', () => {
    const feedbackUrl = "https://forms.gle/실제_주소"; 
    chrome.tabs.create({ url: feedbackUrl });
});

document.getElementById('clear-cache-btn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: "clear_cache_and_rescan" }, (response) => {
            if (response && response.success) {
                alert("결과 캐시가 삭제되고 화면을 재검사합니다.");
            }
        });
    });
});