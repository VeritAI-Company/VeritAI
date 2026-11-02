// 결과 화면: 판정, 확률 막대, 얼굴 위치와 히트맵 그리기, 얼굴 목록
import { drawCamGrid, drawViewOutline, getCamViews, pickDefaultCamView, pickHeatmapFace } from '../../shared/heatmap.js';
import { faceModeLabel, faceQualityLabel, formatPercent, getFaceColor, getFaceCountText, getFaceFakeProb, getProbLevel, getVerdictDescription, NO_FACE_TEXT, readDeepfakeFlag, selectVisibleFaces } from '../../shared/judgment.js';
import { resetFeedback } from './feedback.js';
import { renderHeatmapPanel } from './heatmapPanel.js';
import { $, state } from './state.js';
import { iconSvg, loadImage } from './view.js';

export async function renderResult(data) {
    state.data = data;
    const result = data.result || {};
    const faces = Array.isArray(result.faces) ? result.faces : [];
    const isFake = readDeepfakeFlag(result);
    const fakePercent = ((Number(result.confidence) || 0) * 100).toFixed(1);
    const faceCount = Number.isFinite(result.faceCount) ? result.faceCount : faces.length;

    const verdict = $('verdict');
    verdict.className = `verdict ${isFake ? 'is-fake' : 'is-real'}`;
    $('verdict-icon').innerHTML = iconSvg(isFake ? 'alert' : 'check');
    $('verdict-title').textContent = isFake ? '조작 의심' : '정상';
    const confidence = Number(result.confidence) || 0;
    const level = getProbLevel(confidence);
    $('verdict-desc').textContent = getVerdictDescription(isFake, confidence);
    $('verdict-percent').textContent = `${fakePercent}%`;
    $('verdict-fill').className = `fill ${level}`;
    $('verdict-fill').style.width = `${Math.round(confidence * 100)}%`;
    $('verdict-meter').setAttribute('aria-label', `조작 확률 ${fakePercent}%`);
    $('verdict-detail').textContent = getFaceCountText(faceCount);
    $('request-id').textContent = data.requestId != null ? `요청 번호 ${data.requestId}` : '';

    state.baseImg = await loadImage(state.image.url);
    state.heatmapImg = null;
    state.heatmapMode = false;
    state.showAllFaces = false;
    const views = getCamViews(result);
    state.heatmapView = views.length > 0 ? pickDefaultCamView(result, views).name : null;
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

export function drawCanvas() {
    const canvas = $('result-canvas');
    const img = state.baseImg;
    if (!img) return;
    const faces = state.data?.result?.faces || [];
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const selectedCam = state.heatmapMode ? getCamViews(state.data?.result).find(view => view.name === state.heatmapView) : null;
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
        const color = getFaceColor(getFaceFakeProb(face));
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

function renderFaceList(faces) {
    const list = $('face-list');
    list.replaceChildren();
    if (faces.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'face-empty';
        empty.textContent = NO_FACE_TEXT;
        list.append(empty);
        return;
    }
    const { visible, hidden } = selectVisibleFaces(faces, state.showAllFaces);
    visible.forEach(({ face, index: i }) => {
        const item = document.createElement('div');
        item.className = 'face-item';
        const probValue = getFaceFakeProb(face);
        const level = getProbLevel(probValue);

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
        prob.textContent = probValue != null ? formatPercent(probValue, 0) : '-';
        prob.style.color = getFaceColor(probValue);
        row.append(name, track, prob);

        const box = face.bbox || {};
        const info = document.createElement('div');
        info.className = 'face-info';
        info.textContent = [
            faceModeLabel(face.faceMode),
            `인식 신뢰도 ${formatPercent(face.detectionConfidence ?? face.score ?? 0, 0)}`,
            `화질 ${faceQualityLabel(face.quality?.label)}`,
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
