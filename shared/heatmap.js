// 크롬 확장(frontend)과 PWA(portal)가 함께 쓴다. 표시 기준을 바꾸면 두 곳에 같이 적용된다.
import { getFaceFakeProb } from './judgment.js';

export function pickHeatmapFace(result, faces) {
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
        const score = getFaceFakeProb(face) ?? -1;
        if (score > maxScore) { maxScore = score; target = face; }
    });
    if (target) return target;
    return faces.reduce((a, b) => ((b.detectionConfidence ?? 0) > (a?.detectionConfidence ?? -1) ? b : a), null);
}

export const HEATMAP_WEAK_PROB = 0.3;

export function getCamViews(result) {
    const views = Array.isArray(result?.cnn?.views) ? result.cnn.views : [];
    return views.filter(view => Array.isArray(view.cam) && view.cam.length > 0 && Array.isArray(view.cam[0]) && view.cam[0].length > 0);
}

export function getHeatmapViewLabel(name) {
    if (name === 'full') return '사진 전체';
    const match = /^face_(\d+)$/.exec(name || '');
    return match ? `얼굴 ${match[1]}` : (name || '');
}

export function pickDefaultCamView(result, camViews) {
    // 판정을 결정한 영역(winningView)을 먼저 보여 주고, 없으면 AI가 고른 히트맵 영역, 그것도 없으면 확률이 가장 높은 영역
    const preferred = result?.winningView ?? result?.cnn?.winningView ?? result?.cnn?.heatmapView;
    const named = camViews.find(view => view.name === preferred);
    if (named) return named;
    return camViews.reduce((a, b) => ((b.fakeProbability ?? 0) > (a.fakeProbability ?? 0) ? b : a), camViews[0]);
}

const HEATMAP_TOP_RATIO = 0.2;       // 영역 안에서 값이 큰 상위 20% 칸만 칠한다
const HEATMAP_MIN_REL = 0.3;         // 상위 20%라도 최대값의 30% 미만이면 칠하지 않는다
const HEATMAP_DIM = 0.4;             // 색이 잘 보이도록 사진을 어둡게 까는 정도 (슬라이더 최대일 때)
export const HEATMAP_HIDE_FULL_PROB = 0.01; // 사진 전체 확률이 1% 미만이면 탭을 숨긴다

export function getHeatmapNoteText(label, prob) {
    const lines = [`${label} 영역의 조작 확률은 ${(prob * 100).toFixed(1)}%입니다. 색은 이 영역 안에서 AI가 많이 본 곳이며, 진하기는 사진끼리 비교하는 값이 아닙니다.`];
    if (prob < HEATMAP_HIDE_FULL_PROB) lines.push('이 영역에서는 조작 근거를 찾지 못해 표시할 색이 없습니다.');
    else if (prob < HEATMAP_WEAK_PROB) lines.push('조작 근거가 약한 영역이라 히트맵은 참고용입니다.');
    return lines.join(' ');
}

function heatColor(t) {
    return [Math.round(255 - 20 * t), Math.round(150 - 120 * t), Math.round(30 * t)];
}

export function drawCamGrid(ctx, grid, box, opacity) {
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

export function drawViewOutline(ctx, box, displayScale) {
    const lineWidth = Math.max(1.5, 1.5 / displayScale);
    ctx.save();
    ctx.strokeStyle = 'rgba(143, 179, 240, 0.9)';
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
}
