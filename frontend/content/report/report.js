import { getCamViews } from '../../../shared/heatmap.js';
import { formatPercent, getDecisionReasonText, getFaceCountText, getProbLevel, getVerdictDescription, readDeepfakeFlag } from '../../../shared/judgment.js';
import { icon } from '../../ui/styles.js';
import { escapeHTML, formatFrameTime } from '../format.js';
import { reinspectMedia } from '../inspect.js';
import { createFaceList } from './faceList.js';
import { setupReportFeedback } from './feedback.js';
import { setupReportVisual } from './visual.js';
import { setupReportWindow } from './window.js';

export function closeAllReportBoxes(force = false, exceptionSrc = null) {
    document.querySelectorAll('.veritai-details-box').forEach(box => {
        if (exceptionSrc && box.dataset.targetMedia === exceptionSrc) return;
        if (!force && (box.dataset.isDragged === "true" || box.dataset.isFeedbackActive === "true")) return;
        if (box.cleanupListeners) box.cleanupListeners();
        box.remove();
    });
}

// ctx: 배지 쪽에서 넘겨주는 값 (사진, 판정 상태, 검사 결과, 배지, 결과창 구분 키, 결과창에 보여줄 사진 주소)
export function showReportBox(e, { media, status, data, badge, reportKey, reportImageSrc }) {
    if (e) { e.preventDefault(); e.stopPropagation(); }

    let existingBox = null;
    document.querySelectorAll('.veritai-details-box').forEach(box => {
        if (box.dataset.targetMedia === reportKey) {
            existingBox = box;
        }
    });

    if (existingBox) return existingBox;

    closeAllReportBoxes(false, reportKey);

    const result = data.result;
    const faces = result.faces || [];
    const isVideoMedia = media.tagName === "VIDEO";
    const camViews = getCamViews(result);
    const hasHeatmap = camViews.length > 0 || Boolean(result.heatmapBase64);

    const faceList = createFaceList(faces);

    const isFakeResult = readDeepfakeFlag(result);
    const faceCount = Number.isFinite(result.faceCount) ? result.faceCount : faces.length;
    const confidence = Number(result.confidence) || 0;
    const meterLevel = getProbLevel(confidence);
    const verdictDesc = getVerdictDescription(isFakeResult, confidence);
    const reasonText = getDecisionReasonText(result);
    const metaParts = [getFaceCountText(faceCount)];
    if (isVideoMedia && data.frameTime != null) metaParts.push(`영상 ${formatFrameTime(data.frameTime)} 장면`);

    const detailsBox = document.createElement('div');
    detailsBox.className = `veritai-details-box unpinned ${status === "fake" ? "fake-border" : "real-border"}`;
    detailsBox.dataset.targetMedia = reportKey;
    detailsBox.dataset.isFeedbackActive = "false";

    detailsBox.innerHTML = `
<div class="veritai-drag-handle">
    <span class="vr-head-title">${icon('shield')}VeritAI 검사 결과</span>
    <span class="veritai-close-btn" tabindex="0" role="button" aria-label="닫기">${icon('close')}</span>
</div>
<div class="vr-section">
    <div class="vr-verdict ${isFakeResult ? 'is-fake' : 'is-real'}">${isFakeResult ? '조작 의심' : '정상'}</div>
    <div class="vr-desc">${verdictDesc}</div>
    ${reasonText ? `<div class="vr-reason">${escapeHTML(reasonText)}</div>` : ''}
    <div class="vr-meter" role="img" aria-label="조작 확률 ${formatPercent(confidence)}">
<div class="vr-meter-row"><span>조작 확률</span><b>${formatPercent(confidence)}</b></div>
<div class="vr-track"><span class="vr-fill ${meterLevel}" style="width:${Math.round(confidence * 100)}%"></span></div>
<div class="vr-meter-scale"><span>0</span><span>판정 기준 50%</span><span>100</span></div>
    </div>
    <div class="vr-meta">${metaParts.join(' · ')}</div>
</div>
<div class="vr-section">
    <div class="vr-stage-head">
<div class="vr-label" id="veritai-visual-title">감지된 얼굴</div>
<button id="veritai-toggle-xai-btn" class="vr-btn is-accent" ${!hasHeatmap ? 'disabled' : ''}>${hasHeatmap ? '판단 근거 보기' : '히트맵 없음'}</button>
    </div>
    <div class="vr-stage">
<canvas id="veritai-bbox-canvas" style="z-index: 2;"></canvas>
<canvas id="veritai-heatmap-canvas" style="display: none; z-index: 1;"></canvas>
    </div>
    <div id="veritai-slider-container" class="vr-slider">
<button id="veritai-heatmap-eye-btn" class="vr-icon-btn" title="히트맵 켜기/끄기" aria-label="히트맵 켜기/끄기">${icon('eye')}</button>
<span>원본</span>
<input type="range" id="veritai-heatmap-slider" min="0" max="100" value="85" aria-label="히트맵 진하기">
<span>히트맵</span>
    </div>
    <div id="veritai-heatmap-views" class="vr-tabs"></div>
    <div id="veritai-heatmap-note" class="vr-note"></div>
    ${camViews.length > 0 ? '<div id="veritai-heatmap-legend" class="vr-legend"><span>약함</span><i></i><span>강함</span></div>' : ''}
</div>
<div class="vr-section">
    <div class="veritai-face-list">${faceList.html()}</div>
</div>
<div class="vr-section">
    <div class="vr-actions">
<span class="vr-request-id">요청 번호 ${escapeHTML(data.requestId) || '-'}</span>
<span class="vr-actions-right">
    ${isVideoMedia ? `<button class="veritai-reinspect-btn vr-btn">${icon('refresh')}지금 장면 검사</button>` : ''}
    <button class="veritai-feedback-btn vr-btn is-quiet">${icon('flag')}결과가 틀렸나요?</button>
</span>
    </div>
</div>`.trim();

    detailsBox.onclick = (evt) => evt.stopPropagation();
    detailsBox.onmouseenter = () => { detailsBox.dataset.isHovered = "true"; };
    detailsBox.onmouseleave = () => {
        detailsBox.dataset.isHovered = "false";
        setTimeout(() => {
            if (detailsBox.dataset.isHovered !== "true" && badge.dataset.isHovered !== "true" && detailsBox.dataset.isDragged !== "true" && detailsBox.dataset.isFeedbackActive !== "true") {
                if (detailsBox.cleanupListeners) detailsBox.cleanupListeners();
                detailsBox.remove();
            }
        }, 100);
    };

    document.body.appendChild(detailsBox);

    setupReportVisual({ detailsBox, result, faces, camViews, hasHeatmap, reportImageSrc, faceList });
    setupReportWindow(detailsBox, badge, e);

    const reinspectBtn = detailsBox.querySelector('.veritai-reinspect-btn');
    if (reinspectBtn) {
        reinspectBtn.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            if (detailsBox.cleanupListeners) detailsBox.cleanupListeners();
            detailsBox.remove();
            reinspectMedia(media);
        });
    }

    setupReportFeedback(detailsBox, data);

    return detailsBox;
}
