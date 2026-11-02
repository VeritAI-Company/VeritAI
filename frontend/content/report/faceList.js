// 결과창의 얼굴 목록 HTML (주요 얼굴만 보기 / 전체 보기 상태 포함)
import { NO_FACE_TEXT, faceModeLabel, faceQualityLabel, formatPercent, getFaceColor, getFaceFakeProb, getProbLevel, selectVisibleFaces } from '../../../shared/judgment.js';
import { escapeHTML } from '../format.js';

export function createFaceList(faces) {
    const faceList = { showAll: false, html: null };
    faceList.html = () => {
        if (faces.length === 0) {
            return `<div class="vr-empty">${NO_FACE_TEXT}</div>`;
        }
        const { visible, hidden } = selectVisibleFaces(faces, faceList.showAll);
        const cards = visible.map(({ face: f, index: i }) => {
            const bbox = f.bbox || {};
            const faceProb = getFaceFakeProb(f);
            const level = getProbLevel(faceProb);
            const info = [faceModeLabel(f.faceMode), `인식 신뢰도 ${formatPercent(f.detectionConfidence || f.score || 0, 0)}`, `화질 ${faceQualityLabel(f.quality?.label)}`, `${bbox.w ?? '-'}×${bbox.h ?? '-'}`];
            return `
            <div class="vr-face">
                <div class="vr-face-head">
                    <span class="vr-face-name">얼굴 ${i + 1}</span>
                    <span class="vr-track"><span class="vr-fill ${level}" style="width:${Math.round((faceProb ?? 0) * 100)}%"></span></span>
                    <span class="vr-face-prob" style="color:${getFaceColor(faceProb)}">${faceProb == null ? '-' : formatPercent(faceProb, 0)}</span>
                </div>
                <div class="vr-face-info">${escapeHTML(info.join(' · '))}</div>
            </div>`;
        }).join("");
        let toggle = '';
        if (hidden > 0) toggle = `<div class="veritai-face-toggle" role="button" tabindex="0">인식 신뢰도가 낮은 얼굴 ${hidden}개 더 보기</div>`;
        else if (faceList.showAll && selectVisibleFaces(faces, false).hidden > 0) toggle = `<div class="veritai-face-toggle" role="button" tabindex="0">주요 얼굴만 보기</div>`;
        return cards + toggle;
    };
    return faceList;
}
