import { getCamViews, getHeatmapNoteText, getHeatmapViewLabel, HEATMAP_HIDE_FULL_PROB } from '../../shared/heatmap.js';
import { selectVisibleFaces } from '../../shared/judgment.js';
import { drawCanvas } from './result.js';
import { $, state } from './state.js';

export function toggleHeatmap() {
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

export function renderHeatmapPanel() {
    const result = state.data?.result;
    const views = getCamViews(result);
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
        btn.textContent = `${getHeatmapViewLabel(view.name)} ${((view.fakeProbability ?? 0) * 100).toFixed(1)}%`;
        btn.addEventListener('click', () => {
            state.heatmapView = view.name;
            renderHeatmapPanel();
            drawCanvas();
        });
        tabs.append(btn);
    });
    const label = getHeatmapViewLabel(selected.name);
    const prob = selected.fakeProbability ?? 0;
    $('stage-title').textContent = `히트맵 · ${label} 기준`;
    note.textContent = getHeatmapNoteText(label, prob);
}
