import { registerSW } from 'virtual:pwa-register';
import { startEmbedReport } from './app/embed.js';
import { cancelFeedback, openFeedback, submitFeedback } from './app/feedback.js';
import { onFrameSliderChange, onFrameSliderInput, stepFrame } from './app/framePicker.js';
import { toggleHeatmap } from './app/heatmapPanel.js';
import { onClearRecordsClick } from './app/records.js';
import { refreshServerStatus } from './app/serverStatus.js';
import { handleFileSelected, inspect, resetAll } from './app/inspect.js';
import { drawCanvas } from './app/result.js';
import { $, IS_EMBED_REPORT, state } from './app/state.js';
import { showView } from './app/view.js';

if (import.meta.env?.DEV) {
    clearDevServiceWorker();
} else if (!IS_EMBED_REPORT) {
    registerSW({
        immediate: true,
        onNeedRefresh() { $('pwa-status').textContent = '새 버전이 있습니다. 앱을 다시 열면 적용됩니다.'; },
        onOfflineReady() { $('pwa-status').textContent = '오프라인에서도 앱을 열 수 있습니다.'; },
    });
}

$('input-camera').addEventListener('change', handleFileSelected);
$('input-gallery').addEventListener('change', handleFileSelected);
$('btn-inspect').addEventListener('click', inspect);
$('frame-slider').addEventListener('input', onFrameSliderInput);
$('frame-slider').addEventListener('change', onFrameSliderChange);
document.querySelectorAll('[data-frame-delta]').forEach(btn => btn.addEventListener('click', () => stepFrame(Number(btn.dataset.frameDelta))));
$('btn-retry').addEventListener('click', () => (state.image ? inspect() : resetAll()));
document.querySelectorAll('.js-restart').forEach(btn => btn.addEventListener('click', resetAll));
$('btn-heatmap').addEventListener('click', toggleHeatmap);
$('heatmap-opacity').addEventListener('input', drawCanvas);
$('btn-feedback-open').addEventListener('click', openFeedback);
$('btn-feedback-cancel').addEventListener('click', cancelFeedback);
$('feedback-form').addEventListener('submit', submitFeedback);
$('feedback-reason').addEventListener('input', (e) => e.target.classList.remove('is-invalid'));
$('btn-clear-records').addEventListener('click', onClearRecordsClick);
$('server-retry').addEventListener('click', refreshServerStatus);

// 개발 서버에서는 오프라인 저장을 쓰지 않는다. 예전에 설치된 것이 남아 있으면 지우고 한 번만 새로고침한다
async function clearDevServiceWorker() {
    try {
        const registrations = await navigator.serviceWorker?.getRegistrations() ?? [];
        if (registrations.length === 0) return;
        await Promise.all(registrations.map(r => r.unregister()));
        if (window.caches) await Promise.all((await caches.keys()).map(key => caches.delete(key)));
        location.reload();
    } catch { /* 지우지 못해도 화면은 그대로 쓸 수 있다 */ }
}

if (IS_EMBED_REPORT) startEmbedReport();
else showView('start');