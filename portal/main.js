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
    heatmapView: null,
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
    if (prob == null) return '#8b939c';
    if (prob >= 0.5) return '#ef6f72';
    if (prob >= 0.3) return '#e2a64a';
    return '#52c08c';
}

const FACE_MODE_LABELS = { frontal: '정면', 'profile-left': '왼쪽 옆모습', 'profile-right': '오른쪽 옆모습', eyes_closed: '눈 감음', occluded: '가려짐' };
const FACE_QUALITY_LABELS = { good: '좋음', usable: '보통', poor: '낮음' };

const ICONS = {
    alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.2"/><path d="M12 17.2h.01"/>',
    check: '<path d="M5 12.5 10 17l9-10"/>',
};

function iconSvg(name) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function percent(value, digits = 1) {
    return `${((Number(value) || 0) * 100).toFixed(digits)}%`;
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

const HEATMAP_WEAK_PROB = 0.3;

function camViews(result) {
    const views = Array.isArray(result?.cnn?.views) ? result.cnn.views : [];
    return views.filter(view => Array.isArray(view.cam) && view.cam.length > 0 && Array.isArray(view.cam[0]) && view.cam[0].length > 0);
}

function heatmapViewLabel(name) {
    if (name === 'full') return '사진 전체';
    const match = /^face_(\d+)$/.exec(name || '');
    return match ? `얼굴 ${match[1]}` : (name || '');
}

function defaultCamView(result, views) {
    const named = views.find(view => view.name === result?.cnn?.heatmapView);
    if (named) return named;
    return views.reduce((a, b) => ((b.fakeProbability ?? 0) > (a.fakeProbability ?? 0) ? b : a), views[0]);
}

// 히트맵 표시 기준
const HEATMAP_TOP_RATIO = 0.2;       // 영역 안에서 값이 큰 상위 20% 칸만 칠한다
const HEATMAP_MIN_REL = 0.3;         // 상위 20%라도 최대값의 30% 미만이면 칠하지 않는다
const HEATMAP_DIM = 0.4;             // 색이 잘 보이도록 사진을 어둡게 까는 정도 (슬라이더 최대일 때)
const HEATMAP_HIDE_FULL_PROB = 0.01; // 사진 전체 확률이 1% 미만이면 탭을 숨긴다

// 0~1 강도를 주황 → 빨강으로 바꾼다 (피부색과 겹치는 노랑은 쓰지 않는다)
function heatColor(t) {
    return [Math.round(255 - 20 * t), Math.round(150 - 120 * t), Math.round(30 * t)];
}

// 숫자 표를 영역 크기로 늘려 그린다.
// 1) 영역 안에서 가장 강한 곳이 항상 빨강이 되도록 다시 맞춘다 (확률이 낮다는 건 탭 %와 안내 문구로 알린다)
// 2) 상위 20% 칸만 칠해서 AI가 특히 많이 본 곳만 남긴다
// 3) 사진을 살짝 어둡게 깔아 색이 피부색에 묻히지 않게 한다
function drawCamGrid(ctx, grid, box, opacity) {
    const rows = grid.length;
    const cols = grid[0].length;
    const values = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) values.push(Math.max(0, Number(grid[r][c]) || 0));
    }
    const sorted = [...values].sort((a, b) => b - a);
    const peak = sorted[0];
    if (!(peak > 0) || !(opacity > 0)) return;
    const cutIndex = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * HEATMAP_TOP_RATIO) - 1));
    const threshold = Math.min(0.95, Math.max(HEATMAP_MIN_REL, sorted[cutIndex] / peak));

    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${HEATMAP_DIM * opacity})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    const small = document.createElement('canvas');
    small.width = cols;
    small.height = rows;
    const sCtx = small.getContext('2d');
    const image = sCtx.createImageData(cols, rows);
    values.forEach((value, idx) => {
        const rel = value / peak;
        const t = rel < threshold ? 0 : (rel - threshold) / (1 - threshold);
        const [red, green, blue] = heatColor(t);
        const i = idx * 4;
        image.data[i] = red;
        image.data[i + 1] = green;
        image.data[i + 2] = blue;
        image.data[i + 3] = rel < threshold ? 0 : Math.round(255 * (0.3 + 0.7 * Math.pow(t, 1.2)));
    });
    sCtx.putImageData(image, 0, 0);

    // 두 단계로 늘려 계단 모양을 줄이고, 지원하는 브라우저에서는 가장자리만 살짝 흐리게 한다 (사파리는 흐림 없이 늘리기만 함)
    const w = Math.max(1, Math.round(box.w));
    const h = Math.max(1, Math.round(box.h));
    const mid = document.createElement('canvas');
    mid.width = cols * 4;
    mid.height = rows * 4;
    const mCtx = mid.getContext('2d');
    mCtx.imageSmoothingEnabled = true;
    mCtx.imageSmoothingQuality = 'high';
    mCtx.drawImage(small, 0, 0, mid.width, mid.height);

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const oCtx = out.getContext('2d');
    oCtx.imageSmoothingEnabled = true;
    oCtx.imageSmoothingQuality = 'high';
    if ('filter' in oCtx) oCtx.filter = `blur(${Math.max(1, Math.round(Math.max(w / cols, h / rows) * 0.15))}px)`;
    oCtx.drawImage(mid, 0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(out, box.x, box.y, w, h);
    ctx.restore();
}

// 히트맵을 계산한 얼굴 영역을 점선 네모로 표시한다
function drawViewOutline(ctx, box, displayScale) {
    const lineWidth = Math.max(1.5, 1.5 / displayScale);
    ctx.save();
    ctx.strokeStyle = 'rgba(143, 179, 240, 0.9)';
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
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
    Object.assign(state, { image: null, data: null, baseImg: null, heatmapImg: null, heatmapMode: false, heatmapView: null, busy: false });
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
        drawCanvas(); 
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
    $('verdict-icon').innerHTML = iconSvg(isFake ? 'alert' : 'check');
    $('verdict-title').textContent = isFake ? '조작 의심' : '정상';
    const confidence = Number(result.confidence) || 0;
    const level = confidence >= 0.5 ? 'is-fake' : confidence >= 0.3 ? 'is-warn' : 'is-real';
    $('verdict-desc').textContent = isFake
        ? '조작되었을 가능성이 높습니다.'
        : confidence >= 0.3 ? '조작 흔적이 약하게 보이지만 기준보다 낮습니다.' : '조작 흔적을 찾지 못했습니다.';
    $('verdict-percent').textContent = `${fakePercent}%`;
    $('verdict-fill').className = `fill ${level}`;
    $('verdict-fill').style.width = `${Math.round(confidence * 100)}%`;
    $('verdict-meter').setAttribute('aria-label', `조작 확률 ${fakePercent}%`);
    $('verdict-detail').textContent = faceCount > 0 ? `얼굴 ${faceCount}개 검사` : '얼굴을 찾지 못해 사진 전체로 검사';
    $('request-id').textContent = data.requestId != null ? `요청 번호 ${data.requestId}` : '';

    state.baseImg = await loadImage(state.image.url);
    state.heatmapImg = null;
    state.heatmapMode = false;
    state.showAllFaces = false;
    const views = camViews(result);
    state.heatmapView = views.length > 0 ? defaultCamView(result, views).name : null;
    if (!state.heatmapView && result.heatmapBase64) {
        try { state.heatmapImg = await loadImage(`data:image/jpeg;base64,${result.heatmapBase64}`); }
        catch { state.heatmapImg = null; }
    }
    const hasHeatmap = Boolean(state.heatmapView || state.heatmapImg);
    const heatmapBtn = $('btn-heatmap');
    heatmapBtn.disabled = !hasHeatmap;
    heatmapBtn.textContent = hasHeatmap ? '판단 근거 보기' : '히트맵 없음';
    heatmapBtn.classList.remove('is-active');
    $('heatmap-controls').hidden = true;
    $('heatmap-views').hidden = true;
    $('heatmap-note').hidden = true;
    $('heatmap-legend').hidden = true;
    $('stage-title').textContent = '감지된 얼굴';
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

    const selectedCam = state.heatmapMode ? camViews(state.data?.result).find(view => view.name === state.heatmapView) : null;
    if (selectedCam) {
        const opacity = Number($('heatmap-opacity').value) / 100;
        const box = selectedCam.bbox && selectedCam.bbox.w > 0
            ? selectedCam.bbox
            : { x: 0, y: 0, w: canvas.width, h: canvas.height };
        drawCamGrid(ctx, selectedCam.cam, box, opacity);
        if (selectedCam.bbox && selectedCam.bbox.w > 0) {
            const shownWidth = canvas.clientWidth || Math.min(canvas.width, 448);
            drawViewOutline(ctx, selectedCam.bbox, Math.min(1, shownWidth / canvas.width));
        }
        return;
    }

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

    const shownWidth = canvas.clientWidth || Math.min(canvas.width, 448);
    const scale = Math.min(1, shownWidth / canvas.width);
    const lineWidth = Math.max(2, 2 / scale);
    const maxFont = 13 / scale;
    const minFont = 10 / scale;
    selectVisibleFaces(faces, state.showAllFaces).visible.forEach(({ face, index: i }) => {
        const box = face.bbox;
        if (!box || !(box.w > 0)) return;
        const color = faceColor(faceFakeProb(face));
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        ctx.strokeRect(box.x, box.y, box.w, box.h);

        const label = String(i + 1);
        const fontSize = Math.round(Math.min(maxFont, Math.max(minFont, Math.min(box.w, box.h) * 0.35)));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const padX = Math.round(fontSize * 0.3);
        const badgeW = Math.round(ctx.measureText(label).width + padX * 2);
        const badgeH = Math.round(fontSize * 1.2);
        const fitsInside = box.w >= badgeW * 2 && box.h >= badgeH * 2;
        let badgeX = box.x + lineWidth / 2;
        let badgeY = box.y + lineWidth / 2;
        if (!fitsInside) {
            badgeX = Math.min(Math.max(0, box.x - lineWidth / 2), canvas.width - badgeW);
            badgeY = box.y - lineWidth / 2 - badgeH >= 0
                ? box.y - lineWidth / 2 - badgeH
                : Math.min(canvas.height - badgeH, box.y + box.h + lineWidth / 2);
        }
        ctx.fillStyle = color;
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, badgeX + padX, badgeY + badgeH / 2);
        ctx.textBaseline = 'alphabetic';
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
    if (!state.heatmapImg && !state.heatmapView) return;
    state.heatmapMode = !state.heatmapMode;
    const btn = $('btn-heatmap');
    btn.textContent = state.heatmapMode ? '얼굴 위치 보기' : '판단 근거 보기';
    btn.classList.toggle('is-active', state.heatmapMode);
    $('heatmap-controls').hidden = !state.heatmapMode;
    $('heatmap-views').hidden = !state.heatmapMode;
    $('heatmap-note').hidden = !state.heatmapMode;
    $('heatmap-legend').hidden = !(state.heatmapMode && state.heatmapView);
    $('stage-title').textContent = state.heatmapMode ? '판단 근거 (히트맵)' : '감지된 얼굴';
    if (state.heatmapMode) renderHeatmapPanel();
    drawCanvas();
}

function renderHeatmapPanel() {
    const result = state.data?.result;
    const views = camViews(result);
    const tabs = $('heatmap-views');
    const note = $('heatmap-note');
    tabs.replaceChildren();
    const selected = views.find(view => view.name === state.heatmapView);
    if (!selected) {
        note.textContent = '조작 확률이 가장 높은 영역 기준입니다.';
        return;
    }
    const faces = Array.isArray(result?.faces) ? result.faces : [];
    const visibleIndexes = new Set(selectVisibleFaces(faces, state.showAllFaces).visible.map(entry => entry.index));
    views.forEach(view => {
        const match = /^face_(\d+)$/.exec(view.name || '');
        if (view !== selected && match && !visibleIndexes.has(Number(match[1]) - 1)) return;
        if (view !== selected && view.name === 'full' && (view.fakeProbability ?? 0) < HEATMAP_HIDE_FULL_PROB) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `heatmap-view-btn${view === selected ? ' is-active' : ''}`;
        btn.textContent = `${heatmapViewLabel(view.name)} ${((view.fakeProbability ?? 0) * 100).toFixed(1)}%`;
        btn.addEventListener('click', () => {
            state.heatmapView = view.name;
            renderHeatmapPanel();
            drawCanvas();
        });
        tabs.append(btn);
    });
    const label = heatmapViewLabel(selected.name);
    const prob = selected.fakeProbability ?? 0;
    $('stage-title').textContent = `히트맵 · ${label} 기준`;
    const lines = [`${label} 영역의 조작 확률 ${(prob * 100).toFixed(1)}% 기준입니다. 이 영역 안에서 색이 진할수록 판단에 크게 기여한 곳입니다.`];
    if (prob < HEATMAP_HIDE_FULL_PROB) lines.push('이 영역에서는 조작 근거를 찾지 못해 표시할 색이 없습니다.');
    else if (prob < HEATMAP_WEAK_PROB) lines.push('조작 근거가 약한 영역이라 히트맵은 참고용입니다.');
    note.textContent = lines.join(' ');
}

function renderFaceList(faces) {
    const list = $('face-list');
    list.replaceChildren();
    if (faces.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'face-empty';
        empty.textContent = '얼굴을 찾지 못해 사진 전체로 판정했습니다.';
        list.append(empty);
        return;
    }
    const { visible, hidden } = selectVisibleFaces(faces, state.showAllFaces);
    visible.forEach(({ face, index: i }) => {
        const item = document.createElement('div');
        item.className = 'face-item';
        const probValue = faceFakeProb(face);
        const level = probValue == null ? '' : probValue >= 0.5 ? 'is-fake' : probValue >= 0.3 ? 'is-warn' : 'is-real';

        const row = document.createElement('div');
        row.className = 'face-row';
        const name = document.createElement('span');
        name.className = 'face-name';
        name.textContent = `얼굴 ${i + 1}`;
        const track = document.createElement('span');
        track.className = 'track';
        const fill = document.createElement('span');
        fill.className = `fill ${level}`;
        fill.style.width = `${Math.round((probValue ?? 0) * 100)}%`;
        track.append(fill);
        const prob = document.createElement('span');
        prob.className = 'face-prob';
        prob.textContent = probValue != null ? percent(probValue, 0) : '-';
        prob.style.color = faceColor(probValue);
        row.append(name, track, prob);

        const box = face.bbox || {};
        const info = document.createElement('div');
        info.className = 'face-info';
        info.textContent = [
            FACE_MODE_LABELS[face.faceMode] || face.faceMode || '-',
            `인식 신뢰도 ${percent(face.detectionConfidence ?? face.score ?? 0, 0)}`,
            `화질 ${FACE_QUALITY_LABELS[face.quality?.label] || face.quality?.label || '-'}`,
            box.w ? `${box.w}×${box.h}` : '',
        ].filter(Boolean).join(' · ');

        item.append(row, info);
        list.append(item);
    });

    const hiddenWhenCollapsed = selectVisibleFaces(faces, false).hidden;
    if (hiddenWhenCollapsed > 0) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'face-toggle';
        toggle.textContent = state.showAllFaces ? '주요 얼굴만 보기' : `인식 신뢰도가 낮은 얼굴 ${hidden}개 더 보기`;
        toggle.addEventListener('click', () => {
            state.showAllFaces = !state.showAllFaces;
            renderFaceList(faces);
            if (state.heatmapMode) renderHeatmapPanel();
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
        status.textContent = '신고가 접수되었습니다. 모델 개선에 활용하겠습니다.';
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
            drawCanvas();
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
