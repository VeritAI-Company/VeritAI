// VeritAI PWA 시작점: 화면 버튼과 이벤트를 연결하고 첫 화면(또는 앱 안 리포트 화면)을 연다
// 실제 기능은 portal/app/ 폴더의 각 파일에 있다
import { registerSW } from 'virtual:pwa-register';
import { startEmbedReport } from './app/embed.js';
import { cancelFeedback, openFeedback, submitFeedback } from './app/feedback.js';
import { toggleHeatmap } from './app/heatmapPanel.js';
import { handleFileSelected, inspect, resetAll } from './app/inspect.js';
import { drawCanvas } from './app/result.js';
import { $, IS_EMBED_REPORT, state } from './app/state.js';
import { showView } from './app/view.js';

if (!IS_EMBED_REPORT) {
    registerSW({
        immediate: true,
        onNeedRefresh() { $('pwa-status').textContent = '새 버전이 있습니다. 앱을 다시 열면 적용됩니다.'; },
        onOfflineReady() { $('pwa-status').textContent = '오프라인에서도 앱을 열 수 있습니다.'; },
    });
}

$('input-camera').addEventListener('change', handleFileSelected);
$('input-gallery').addEventListener('change', handleFileSelected);
$('btn-inspect').addEventListener('click', inspect);
$('btn-retry').addEventListener('click', () => (state.image ? inspect() : resetAll()));
document.querySelectorAll('.js-restart').forEach(btn => btn.addEventListener('click', resetAll));
$('btn-heatmap').addEventListener('click', toggleHeatmap);
$('heatmap-opacity').addEventListener('input', drawCanvas);
$('btn-feedback-open').addEventListener('click', openFeedback);
$('btn-feedback-cancel').addEventListener('click', cancelFeedback);
$('feedback-form').addEventListener('submit', submitFeedback);
$('feedback-reason').addEventListener('input', (e) => e.target.classList.remove('is-invalid'));

if (IS_EMBED_REPORT) startEmbedReport();
else showView('start');