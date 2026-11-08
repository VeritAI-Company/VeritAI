import { HEATMAP_HIDE_FULL_PROB, drawCamGrid, drawViewOutline, getHeatmapNoteText, getHeatmapViewLabel, pickDefaultCamView, pickHeatmapFace } from '../../../shared/heatmap.js';
import { NO_SCORE_TEXT, formatPercent, getFaceColor, getFaceFakeProb, selectVisibleFaces } from '../../../shared/judgment.js';
import { escapeHTML } from '../format.js';

export function setupReportVisual({ detailsBox, result, faces, camViews, hasHeatmap, reportImageSrc, faceList }) {
    let isHeatmapMode = false;
    let refreshHeatmapPanel = () => {};
    const bboxCanvas = detailsBox.querySelector('#veritai-bbox-canvas');
    const heatmapCanvas = detailsBox.querySelector('#veritai-heatmap-canvas');
    const slider = detailsBox.querySelector('#veritai-heatmap-slider');

    if (bboxCanvas && heatmapCanvas) {
        const bCtx = bboxCanvas.getContext('2d');
        const hCtx = heatmapCanvas.getContext('2d');
        const imgObj = new Image();

        imgObj.crossOrigin = "anonymous";
        imgObj.onerror = () => {
            imgObj.removeAttribute("crossOrigin");
            imgObj.onerror = null;
            imgObj.src = reportImageSrc;
        };

        const drawFaceBoxes = () => {
            bCtx.clearRect(0, 0, bboxCanvas.width, bboxCanvas.height);
            bCtx.drawImage(imgObj, 0, 0);
            if (faces && faces.length > 0) {
                const stage = bboxCanvas.parentElement;
                const stageW = (stage && stage.clientWidth) || 230;
                const stageH = (stage && stage.clientHeight) || 220;
                const displayScale = Math.min(1, stageW / imgObj.width, stageH / imgObj.height);
                const lineWidth = Math.max(2, 2 / displayScale);
                const maxFont = 11 / displayScale;
                const minFont = 9 / displayScale;
                selectVisibleFaces(faces, faceList.showAll).visible.forEach(({ face: f, index: i }) => {
                    if (f.bbox && f.bbox.w > 0) {
                        const faceProb = getFaceFakeProb(f);
                        const color = getFaceColor(faceProb);
                        bCtx.lineWidth = lineWidth;
                        bCtx.strokeStyle = color;
                        bCtx.strokeRect(f.bbox.x, f.bbox.y, f.bbox.w, f.bbox.h);

                        const label = faceProb == null ? `${i + 1} ${NO_SCORE_TEXT}` : String(i + 1);
                        const fontSize = Math.round(Math.min(maxFont, Math.max(minFont, Math.min(f.bbox.w, f.bbox.h) * 0.35)));
                        bCtx.font = `bold ${fontSize}px sans-serif`;
                        const padX = Math.round(fontSize * 0.3);
                        const badgeW = Math.round(bCtx.measureText(label).width + padX * 2);
                        const badgeH = Math.round(fontSize * 1.2);
                        const fitsInside = f.bbox.w >= badgeW * 2 && f.bbox.h >= badgeH * 2;
                        let badgeX = f.bbox.x + lineWidth / 2;
                        let badgeY = f.bbox.y + lineWidth / 2;
                        if (!fitsInside) {
                            badgeX = Math.min(Math.max(0, f.bbox.x - lineWidth / 2), imgObj.width - badgeW);
                            badgeY = f.bbox.y - lineWidth / 2 - badgeH >= 0
                                ? f.bbox.y - lineWidth / 2 - badgeH
                                : Math.min(imgObj.height - badgeH, f.bbox.y + f.bbox.h + lineWidth / 2);
                        }
                        bCtx.fillStyle = color;
                        bCtx.fillRect(badgeX, badgeY, badgeW, badgeH);
                        bCtx.fillStyle = "#ffffff";
                        bCtx.textBaseline = "middle";
                        bCtx.fillText(label, badgeX + padX, badgeY + badgeH / 2);
                        bCtx.textBaseline = "alphabetic";
                    }
                });
            }
        };

        let selectedCamView = camViews.length > 0 ? pickDefaultCamView(result, camViews) : null;
        let legacyHeatmapImg = null;
        let isOriginalView = false;
        const eyeBtn = detailsBox.querySelector('#veritai-heatmap-eye-btn');
        const viewTabsEl = detailsBox.querySelector('#veritai-heatmap-views');
        const heatmapNoteEl = detailsBox.querySelector('#veritai-heatmap-note');
        const visualTitleEl = detailsBox.querySelector('#veritai-visual-title');

        const drawHeatmap = () => {
            if (!imgObj.complete || !imgObj.naturalWidth) return;
            const opacity = isOriginalView || !slider ? 0 : slider.value / 100;
            hCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
            hCtx.drawImage(imgObj, 0, 0);
            if (selectedCamView) {
                const box = selectedCamView.bbox && selectedCamView.bbox.w > 0
                    ? selectedCamView.bbox
                    : { x: 0, y: 0, w: imgObj.width, h: imgObj.height };
                drawCamGrid(hCtx, selectedCamView.cam, box, opacity);
                if (selectedCamView.bbox && selectedCamView.bbox.w > 0) {
                    const stage = heatmapCanvas.parentElement;
                    const stageW = (stage && stage.clientWidth) || 230;
                    const stageH = (stage && stage.clientHeight) || 210;
                    const displayScale = Math.min(1, stageW / imgObj.width, stageH / imgObj.height);
                    drawViewOutline(hCtx, selectedCamView.bbox, displayScale);
                }
            } else if (legacyHeatmapImg) {
                const bestFace = pickHeatmapFace(result, faces || []);
                hCtx.globalAlpha = opacity;
                hCtx.globalCompositeOperation = "screen";
                if (bestFace && bestFace.bbox) {
                    hCtx.drawImage(legacyHeatmapImg, bestFace.bbox.x, bestFace.bbox.y, bestFace.bbox.w, bestFace.bbox.h);
                } else {
                    hCtx.drawImage(legacyHeatmapImg, 0, 0, imgObj.width, imgObj.height);
                }
                hCtx.globalAlpha = 1.0;
                hCtx.globalCompositeOperation = "source-over";
            }
        };

        // 영역 탭과 안내 문구. 사진 전체, 화면에 보이는 얼굴, 지금 고른 영역만 탭으로 만든다
        refreshHeatmapPanel = () => {
            if (!selectedCamView) {
                if (viewTabsEl) viewTabsEl.innerHTML = '';
                if (heatmapNoteEl) heatmapNoteEl.textContent = '조작 확률이 가장 높은 영역 기준입니다.';
                if (visualTitleEl && isHeatmapMode) visualTitleEl.innerText = '판단 근거 (히트맵)';
                return;
            }
            const visibleIndexes = new Set(selectVisibleFaces(faces, faceList.showAll).visible.map(entry => entry.index));
            const tabViews = camViews.filter(view => {
                if (view === selectedCamView) return true;
                if (view.name === 'full') return (view.fakeProbability ?? 0) >= HEATMAP_HIDE_FULL_PROB;
                const match = /^face_(\d+)$/.exec(view.name || '');
                return match ? visibleIndexes.has(Number(match[1]) - 1) : true;
            });
            if (viewTabsEl) {
                viewTabsEl.innerHTML = tabViews.map(view => {
                    const active = view === selectedCamView;
                    const prob = formatPercent(view.fakeProbability).slice(0, -1);
                    return `<button class="veritai-heatmap-view-btn${active ? ' is-active' : ''}" data-view="${escapeHTML(view.name)}">${escapeHTML(getHeatmapViewLabel(view.name))} ${prob}%</button>`;
                }).join('');
            }
            const prob = selectedCamView.fakeProbability ?? 0;
            const label = getHeatmapViewLabel(selectedCamView.name);
            if (visualTitleEl && isHeatmapMode) visualTitleEl.innerText = `히트맵 · ${label} 기준`;
            if (heatmapNoteEl) {
                heatmapNoteEl.textContent = getHeatmapNoteText(label, prob);
            }
        };

        if (viewTabsEl) {
            viewTabsEl.addEventListener('click', (evt) => {
                const btn = evt.target.closest('.veritai-heatmap-view-btn');
                if (!btn) return;
                evt.preventDefault();
                evt.stopPropagation();
                const next = camViews.find(view => view.name === btn.dataset.view);
                if (!next || next === selectedCamView) return;
                selectedCamView = next;
                refreshHeatmapPanel();
                drawHeatmap();
            });
        }

        if (slider) {
            slider.addEventListener('input', () => {
                isOriginalView = false;
                if (eyeBtn) eyeBtn.classList.remove('is-off');
                drawHeatmap();
            });
        }

        if (eyeBtn) {
            eyeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                isOriginalView = !isOriginalView;
                eyeBtn.classList.toggle('is-off', isOriginalView);
                drawHeatmap();
            });
            eyeBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    eyeBtn.click();
                }
            });
        }

        const faceListEl = detailsBox.querySelector('.veritai-face-list');
        if (faceListEl) {
            const onToggle = (evt) => {
                if (!evt.target.closest('.veritai-face-toggle')) return;
                if (evt.type === 'keydown' && evt.key !== 'Enter' && evt.key !== ' ') return;
                evt.preventDefault();
                evt.stopPropagation();
                faceList.showAll = !faceList.showAll;
                faceListEl.innerHTML = faceList.html();
                if (imgObj.complete && imgObj.naturalWidth) drawFaceBoxes();
                refreshHeatmapPanel();
            };
            faceListEl.addEventListener('click', onToggle);
            faceListEl.addEventListener('keydown', onToggle);
        }

        imgObj.onload = () => {
            bboxCanvas.width = imgObj.width;
            bboxCanvas.height = imgObj.height;
            heatmapCanvas.width = imgObj.width;
            heatmapCanvas.height = imgObj.height;
            drawFaceBoxes();
            drawHeatmap();

            if (!selectedCamView && result.heatmapBase64) {
                const hmImg = new Image();
                hmImg.onload = () => {
                    legacyHeatmapImg = hmImg;
                    drawHeatmap();
                };
                hmImg.src = "data:image/jpeg;base64," + result.heatmapBase64;
            }
        };
        imgObj.src = reportImageSrc;
    }

    const toggleBtn = detailsBox.querySelector('#veritai-toggle-xai-btn');
    const visualTitle = detailsBox.querySelector('#veritai-visual-title');
    const sliderContainer = detailsBox.querySelector('#veritai-slider-container');
    const heatmapViewsEl = detailsBox.querySelector('#veritai-heatmap-views');
    const heatmapNote = detailsBox.querySelector('#veritai-heatmap-note');
    const heatmapLegend = detailsBox.querySelector('#veritai-heatmap-legend');

    if (toggleBtn && hasHeatmap) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isHeatmapMode = !isHeatmapMode;
            if (isHeatmapMode) {
                bboxCanvas.style.display = 'none';
                heatmapCanvas.style.display = 'block';
                sliderContainer.style.display = 'flex';
                if (heatmapViewsEl) heatmapViewsEl.style.display = 'flex';
                if (heatmapNote) heatmapNote.style.display = 'block';
                if (heatmapLegend) heatmapLegend.style.display = 'flex';
                toggleBtn.innerText = '얼굴 위치 보기';
                visualTitle.innerText = '판단 근거 (히트맵)';
                refreshHeatmapPanel();
            } else {
                bboxCanvas.style.display = 'block';
                heatmapCanvas.style.display = 'none';
                sliderContainer.style.display = 'none';
                if (heatmapViewsEl) heatmapViewsEl.style.display = 'none';
                if (heatmapNote) heatmapNote.style.display = 'none';
                if (heatmapLegend) heatmapLegend.style.display = 'none';
                toggleBtn.innerText = '판단 근거 보기';
                visualTitle.innerText = '감지된 얼굴';
            }
        });
    }
}
