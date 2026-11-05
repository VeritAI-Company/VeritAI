// 첫 화면의 분석 서버 연결 상태. 첫 화면을 열 때마다 다시 확인한다
import { checkServerStatus, serverHost } from '../api.js';
import { $ } from './state.js';

let checkSeq = 0;

function render(level, text) {
    $('server-status').className = `server-status${level ? ` is-${level}` : ''}`;
    $('server-text').textContent = text;
    $('server-retry').hidden = level === '' || level === 'ok';
}

export async function refreshServerStatus() {
    const seq = ++checkSeq;
    $('server-host').textContent = serverHost();
    render('', '분석 서버 확인 중');
    const { level, text } = await checkServerStatus();
    if (seq === checkSeq) render(level, text); // 다시 확인을 여러 번 눌러도 마지막 결과만 보여 준다
}
