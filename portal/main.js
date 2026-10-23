import { registerSW } from 'virtual:pwa-register';
import { prepareImage } from './image.js';
import { requestDetection, sendFeedback, toFriendlyMessage } from './api.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['start', 'preview', 'loading', 'result', 'error'];

const state = {
    image: null,
    data: null,
    baseImg: null,
    heatmapImg: null,
    heatmapMode: false,
    showAllFaces: false,
    busy: false,
};

const IS_EMBED_REPORT = new URLSearchParams(location.search).get('embed') === 'report';

if (!IS_EMBED_REPORT) {
    registerSW({
        immediate: true,
        onNeedRefresh() { $('pwa-status').textContent = '새 버전이 있습니다. 앱을 다시 열면 적용됩니다.'; },
        onOfflineReady() { $('pwa-status').textContent = '오프라인에서도 앱을 열 수 있습니다.'; },
    });
}

function faceFakeProb(face) {
    const value = face?.cnn?.fakeProbability ?? face?.fakeProbability;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function faceColor(prob) {
    if (prob == null) return '#94A3B8';
    if (prob >= 0.5) return '#EF4444';
    if (prob >= 0.3) return '#F59E0B';
    return '#10B981';
}

function selectVisibleFaces(faces, showAll) {
    const entries = faces.map((face, index) => ({ face, index }));
    if (showAll) return { visible: entries, hidden: 0 };
    let top = null;
    entries.forEach(entry => {
        const prob = faceFakeProb(entry.face);
        if (prob != null && (!top || prob > faceFakeProb(top.face))) top = entry;
    });
    const visible = entries.filter(entry => {
        const det = entry.face.detectionConfidence;
        return entry === top || typeof det !== 'number' || det >= 0.5;
    });
    if (visible.length === 0 && entries.length > 0) visible.push(entries[0]);
    return { visible, hidden: entries.length - visible.length };
}

function showView(name) {
    VIEWS.forEach(view => { $(`view-${view}`).hidden = view !== name; });
    window.scrollTo(0, 0);
}

function setLoadingText(text) {
    $('loading-text').textContent = text;
}

function showError(message) {
    $('error-text').textContent = message;
    showView('error');
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
        img.src = src;
    });
}

function resetAll() {
    if (state.image?.url) URL.revokeObjectURL(state.image.url);
    Object.assign(state, { image: null, data: null, baseImg: null, heatmapImg: null, heatmapMode: false, busy: false });
    $('input-camera').value = '';
    $('input-gallery').value = '';
    $('preview-image').removeAttribute('src');
    showView('start');
}

async function handleFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setLoadingText('사진을 준비하는 중...');
    showView('loading');
    try {
        const prepared = await prepareImage(file);
        if (state.image?.url) URL.revokeObjectURL(state.image.url);
        state.image = prepared;
        $('preview-image').src = prepared.url;
        showView('preview');
    } catch (err) {
        state.image = null;
        showError(err.message);
    }
}

async function inspect() {
    if (!state.image || state.busy) return;
    state.busy = true;
    setLoadingText('서버로 전송하는 중...');
    showView('loading');

    try {
        const data = await requestDetection(state.image.blob, (status) => {
            setLoadingText(status === 'PROCESSING' ? 'AI가 분석하는 중...' : '분석 대기 중...');
        });
        await renderResult(data);
        showView('result');
    } catch (err) {
        showError(toFriendlyMessage(err));
    } finally {
        state.busy = false;
    }
}

async function renderResult(data) {
    state.data = data;
    const result = data.result || {};
    const faces = Array.isArray(result.faces) ? result.faces : [];
    const isFake = Boolean(result.isDeepfake ?? result.deepfake);
    const fakePercent = ((Number(result.confidence) || 0) * 100).toFixed(1);
    const faceCount = Number.isFinite(result.faceCount) ? result.faceCount : faces.length;

    const verdict = $('verdict');
    verdict.className = `verdict ${isFake ? 'is-fake' : 'is-real'}`;
    $('verdict-icon').textContent = isFake ? '🚨' : '✅';
    $('verdict-title').textContent = isFake ? '조작 의심' : '정상';
    $('verdict-detail').textContent = `조작 확률 ${fakePercent}% · 검출된 얼굴 ${faceCount}명`;
    $('request-id').textContent = data.requestId != null ? `요청 ID: ${data.requestId}` : '';

    state.baseImg = await loadImage(state.image.url);
    state.heatmapImg = null;
    state.heatmapMode = false;
    state.showAllFaces = false;
    if (result.heatmapBase64) {
        try { state.heatmapImg = await loadImage(`data:image/jpeg;base64,${result.heatmapBase64}`); }
        catch { state.heatmapImg = null; }
    }
    const heatmapBtn = $('btn-heatmap');
    heatmapBtn.disabled = !state.heatmapImg;
    heatmapBtn.textContent = state.heatmapImg ? 'AI 분석 근거 보기' : '히트맵 없음';
    heatmapBtn.classList.remove('is-active');
    $('heatmap-controls').hidden = true;
    $('stage-title').textContent = '감지 영역';
    drawCanvas();

    renderFaceList(faces);
    resetFeedback();
}

function drawCanvas() {
    const canvas = $('result-canvas');
    const img = state.baseImg;
    if (!img) return;
    const faces = state.data?.result?.faces || [];
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    if (state.heatmapMode && state.heatmapImg) {
        const opacity = Number($('heatmap-opacity').value) / 100;
        const target = pickHeatmapFace(state.data?.result, faces);
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = 'screen';
        if (target?.bbox) {
            ctx.drawImage(state.heatmapImg, target.bbox.x, target.bbox.y, target.bbox.w, target.bbox.h);
        } else {
            ctx.drawImage(state.heatmapImg, 0, 0, canvas.width, canvas.height);
        }
        ctx.restore();
        return;
    }

    const lineWidth = Math.max(3, canvas.width / 200);
    const fontSize = Math.max(16, Math.round(canvas.width / 28));
    selectVisibleFaces(faces, state.showAllFaces).visible.forEach(({ face, index: i }) => {
        const box = face.bbox;
        if (!box || !(box.w > 0)) return;
        const color = faceColor(faceFakeProb(face));
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(`얼굴 ${i + 1}`, box.x, Math.max(fontSize, box.y - 6));
    });
}

function pickHeatmapFace(result, faces) {
    const views = Array.isArray(result?.cnn?.views) ? result.cnn.views : [];
    if (views.length > 0) {
        const best = views.reduce((a, b) => ((b.fakeProbability ?? 0) > (a.fakeProbability ?? 0) ? b : a));
        if (best.name === 'full') return null;
        const match = /^face_(\d+)$/.exec(best.name || '');
        if (match && faces[Number(match[1]) - 1]) return faces[Number(match[1]) - 1];
    }
    let target = null;
    let maxScore = -1;
    faces.forEach(face => {
        const score = faceFakeProb(face) ?? -1;
        if (score > maxScore) { maxScore = score; target = face; }
    });
    if (target) return target;
    return faces.reduce((a, b) => ((b.detectionConfidence ?? 0) > (a?.detectionConfidence ?? -1) ? b : a), null);
}

function toggleHeatmap() {
    if (!state.heatmapImg) return;
    state.heatmapMode = !state.heatmapMode;
    const btn = $('btn-heatmap');
    btn.textContent = state.heatmapMode ? '감지 박스로 돌아가기' : 'AI 분석 근거 보기';
    btn.classList.toggle('is-active', state.heatmapMode);
    $('heatmap-controls').hidden = !state.heatmapMode;
    $('stage-title').textContent = state.heatmapMode ? 'AI 분석 근거 (히트맵)' : '감지 영역';
    drawCanvas();
}

function renderFaceList(faces) {
    const list = $('face-list');
    list.replaceChildren();
    const { visible, hidden } = selectVisibleFaces(faces, state.showAllFaces);
    visible.forEach(({ face, index: i }) => {
        const card = document.createElement('div');
        card.className = 'card face-item';

        const title = document.createElement('div');
        title.className = 'face-title';
        title.textContent = `얼굴 ${i + 1}`;
        title.style.color = faceColor(faceFakeProb(face));

        const grid = document.createElement('div');
        grid.className = 'face-grid';
        const box = face.bbox || {};
        const rows = [
            ['조작 확률', faceFakeProb(face) != null ? `${(faceFakeProb(face) * 100).toFixed(1)}%` : '-'],
            ['검출 신뢰도', `${((face.detectionConfidence ?? face.score ?? 0) * 100).toFixed(1)}%`],
            ['얼굴 크기', box.w ? `${box.w}×${box.h}` : '-'],
            ['품질', face.quality?.label ?? '-'],
        ];
        rows.forEach(([label, value]) => {
            const cell = document.createElement('div');
            const strong = document.createElement('b');
            strong.textContent = String(value);
            cell.append(`${label}: `, strong);
            grid.append(cell);
        });

        card.append(title, grid);
        list.append(card);
    });

    const hiddenWhenCollapsed = selectVisibleFaces(faces, false).hidden;
    if (hiddenWhenCollapsed > 0) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'face-toggle';
        toggle.textContent = state.showAllFaces ? '주요 얼굴만 보기' : `검출 신뢰도 낮은 얼굴 ${hidden}개 숨김 · 모두 보기`;
        toggle.addEventListener('click', () => {
            state.showAllFaces = !state.showAllFaces;
            renderFaceList(faces);
            drawCanvas();
        });
        list.append(toggle);
    }
}

function resetFeedback() {
    $('btn-feedback-open').hidden = false;
    $('btn-feedback-open').disabled = false;
    $('feedback-form').hidden = true;
    $('feedback-reason').value = '';
    $('feedback-reason').classList.remove('is-invalid');
    $('btn-feedback-submit').disabled = false;
    $('btn-feedback-submit').textContent = '제출';
    $('feedback-status').hidden = true;
}

function openFeedback() {
    $('btn-feedback-open').hidden = true;
    $('feedback-form').hidden = false;
    $('feedback-status').hidden = true;
    $('feedback-reason').focus();
}

async function submitFeedback(event) {
    event.preventDefault();
    const reasonInput = $('feedback-reason');
    const reason = reasonInput.value.trim();
    if (!reason) {
        reasonInput.classList.add('is-invalid');
        reasonInput.placeholder = '신고 이유를 적어 주세요.';
        reasonInput.focus();
        return;
    }
    if (state.data?.requestId == null) return;

    const submitBtn = $('btn-feedback-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = '전송 중...';
    const status = $('feedback-status');
    try {
        await sendFeedback(state.data.requestId, reason);
        $('feedback-form').hidden = true;
        status.textContent = '✓ 신고가 접수되었습니다. 모델 개선에 활용하겠습니다.';
        status.className = 'feedback-status is-ok';
        status.hidden = false;
    } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = '다시 제출';
        status.textContent = err.status === 0
            ? '서버에 연결할 수 없어 신고를 보내지 못했습니다.'
            : '신고를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.';
        status.className = 'feedback-status is-error';
        status.hidden = false;
    }
}

function cancelFeedback() {
    $('feedback-form').hidden = true;
    $('btn-feedback-open').hidden = false;
    $('feedback-reason').classList.remove('is-invalid');
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

function startEmbedReport() {
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
        } catch {
            showError('리포트를 표시하지 못했습니다.');
        }
    };
    window.addEventListener('message', onMessage);   // iOS
    document.addEventListener('message', onMessage); // Android (react-native-webview)

    window.ReactNativeWebView?.postMessage('veritai-report-ready');
}

if (IS_EMBED_REPORT) startEmbedReport();
else showView('start');
