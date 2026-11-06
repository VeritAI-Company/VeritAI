// 앱 안에서 띄우는 리포트 화면 (앱이 검사 결과와 사진을 보내 준다)
import { drawCanvas, renderResult } from './result.js';
import { state } from './state.js';
import { setLoadingText, showError, showView } from './view.js';

export function startEmbedReport() {
    document.body.classList.add('is-embed');
    setLoadingText('리포트를 불러오는 중...');
    showView('loading');

    const onMessage = async (event) => {
        let message;
        try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
        if (message?.type !== 'veritai-report' || !message.data?.result || !message.imageDataUrl) return;
        state.image = { url: message.imageDataUrl };
        try {
            await renderResult(message.data);
            showView('result');
            drawCanvas();
        } catch {
            showError('리포트를 표시하지 못했습니다.');
        }
    };
    window.addEventListener('message', onMessage);   // iOS
    document.addEventListener('message', onMessage); // Android (react-native-webview)

    window.ReactNativeWebView?.postMessage('veritai-report-ready');
}
