// 앱 안에서 띄우는 리포트 화면 (앱이 검사 결과와 사진을 보내 준다)
import { drawCanvas, renderResult } from './result.js';
import { state } from './state.js';
import { setLoadingText, showError, showView } from './view.js';

// 앱이 이 시간 안에 결과를 보내지 않으면 멈춘 화면 대신 안내를 띄운다
const EMBED_WAIT_MS = 10000;

export function startEmbedReport() {
    document.body.classList.add('is-embed');

    // 앱(WebView) 밖에서 열린 경우에는 결과를 받지 않는다.
    // 다른 사이트가 이 주소를 iframe으로 넣고 꾸민 결과를 보내 VeritAI 화면처럼 보이게 하는 것을 막는다
    if (!window.ReactNativeWebView) {
        showError('이 화면은 VeritAI 앱 안에서만 열 수 있습니다.');
        return;
    }

    setLoadingText('리포트를 불러오는 중...');
    showView('loading');

    let received = false;
    const waitTimer = setTimeout(() => {
        if (!received) showError('리포트를 불러오지 못했습니다. 위의 "결과로 돌아가기"를 누른 뒤 다시 열어 주세요.');
    }, EMBED_WAIT_MS);

    const onMessage = async (event) => {
        // 앱이 보낸 메시지는 보낸 창(source)이 없다. 다른 창(부모 페이지, 팝업 등)이 보낸 메시지는 무시한다
        if (event.source && event.source !== window) return;
        if (received) return;
        let message;
        try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
        if (message?.type !== 'veritai-report' || !message.data?.result) return;
        // 사진은 앱이 만든 data URL만 받는다 (외부 주소를 불러오지 않게)
        if (typeof message.imageDataUrl !== 'string' || !message.imageDataUrl.startsWith('data:image/')) return;
        received = true;
        clearTimeout(waitTimer);
        state.image = { url: message.imageDataUrl };
        try {
            await renderResult(message.data);
            showView('result');
            drawCanvas();
        } catch {
            showError('리포트를 표시하지 못했습니다. 위의 "결과로 돌아가기"를 누른 뒤 다시 열어 주세요.');
        }
    };
    window.addEventListener('message', onMessage);   // iOS
    document.addEventListener('message', onMessage); // Android (react-native-webview)

    window.ReactNativeWebView.postMessage('veritai-report-ready');
}
