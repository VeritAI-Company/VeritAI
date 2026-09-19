import { API_URL, FEEDBACK_URL, MAX_CONCURRENT_INSPECTIONS, MAX_CACHE_SIZE, GLOBAL_AD_SELECTOR } from './config/constants';
import { injectCSS, VERITAI_CORE_CSS } from './ui/styles.js';
import { captureImageBlob, captureVideoBlob } from './core/capture.js';
import { sendToBackend, clearPendingPolls } from './core/network.js';

console.log("VeritAI content script loaded");

const scanCache = new Map();
let isSystemOn = true;
let isAutoScanMode = false;
let isCleanUIMode = false; 
const scannedMediaKeys = new Set();
let activeInspectionCount = 0;
const pendingInspectionQueue = [];
let mutationQueue = [];
let observerDebounceTimer = null;

injectCSS();

function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

function closeAllReportBoxes(force = false, exceptionSrc = null) {
    document.querySelectorAll('.veritai-details-box').forEach(box => {
        if (exceptionSrc && box.dataset.targetMedia === exceptionSrc) return;
        if (!force && (box.dataset.isDragged === "true" || box.dataset.isFeedbackActive === "true")) return;
        if (box.cleanupListeners) box.cleanupListeners();
        box.remove();
    });
}

function getFromCache(key) {
    if (!scanCache.has(key)) return null;
    const value = scanCache.get(key);
    scanCache.delete(key);
    scanCache.set(key, value); 
    return value;
}

function setToCache(key, value) {
    if (scanCache.has(key)) scanCache.delete(key);
    scanCache.set(key, value);
    if (scanCache.size > MAX_CACHE_SIZE) scanCache.delete(scanCache.keys().next().value);
}

function manageMemoryCache() {
    if (scannedMediaKeys.size > MAX_CACHE_SIZE) scannedMediaKeys.delete(scannedMediaKeys.keys().next().value);
}

function getMediaSource(media) {
    if (!media) return "";
    return media.currentSrc || media.src || media.poster || "";
}

function getMediaKey(media) {
    const source = getMediaSource(media);
    if (source) return `${media.tagName}:${source}`;
    const rect = media.getBoundingClientRect();
    return `${media.tagName}:${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
}

function isVisibleMedia(media) {
    if (!media || !media.isConnected) return false;
    const rect = media.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) return false;
    const style = getComputedStyle(media);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function shouldInspectMedia(media) {
    if (media.closest('.veritai-details-box') || media.closest('.veritai-ui-container')) return false;
    if (window !== window.top) return false;
    if (media.closest(GLOBAL_AD_SELECTOR)) return false;
    const url = (media.src || media.currentSrc || "").toLowerCase();
    const adUrls = ['/ads/', '/ad/', 'doubleclick.net', 'googlesyndication', 'adservice', 'adsystem'];
    if (adUrls.some(ad => url.includes(ad))) return false;
    return isVisibleMedia(media);
}

function readDeepfakeFlag(result) {
    if (!result) return false;
    return Boolean(result.isDeepfake ?? result.deepfake);
}

function getInspectionPriority(media) {
    if (!media || !media.isConnected) return -1;
    const rect = media.getBoundingClientRect();
    const viewportOverlap = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    return (viewportOverlap ? 1_000_000 : 0) + Math.min(area, 999_999);
}

function runWithInspectionLimit(task, media = null) {
    return new Promise((resolve, reject) => {
        pendingInspectionQueue.push({ task, media, resolve, reject });
        if (isAutoScanMode) {
            pendingInspectionQueue.sort((a, b) => getInspectionPriority(b.media) - getInspectionPriority(a.media));
        }
        drainInspectionQueue();
    });
}

function drainInspectionQueue() {
    while (activeInspectionCount < MAX_CONCURRENT_INSPECTIONS && pendingInspectionQueue.length > 0) {
        const next = pendingInspectionQueue.shift();
        if (next.media && (!next.media.isConnected || !shouldInspectMedia(next.media))) {
            next.reject(new Error("검사 대상이 화면에서 사라졌습니다."));
            continue;
        }
        activeInspectionCount += 1;
        Promise.resolve().then(next.task).then(next.resolve, next.reject).finally(() => {
            activeInspectionCount -= 1;
            drainInspectionQueue();
        });
    }
}

function updateStatusBadge(media, status, data = null) {
    if (!isSystemOn && media.dataset.forceInspect !== "true") return; 
    if (status === "real" && isCleanUIMode && media.dataset.veritaiFadedOut === "true") return;
    const wrapper = ensureWrapper(media);
    if (!wrapper) return;
    if (!media.dataset.veritaiScanned && status !== "loading") return;

    const existingBtn = wrapper.querySelector('.veritai-check-btn');
    if (existingBtn) existingBtn.remove();

    let shadowHost = wrapper.querySelector('veritai-host');
    let shadowRoot;
    
    if (!shadowHost) {
        shadowHost = document.createElement('veritai-host');
        shadowHost.style.cssText = 'position: absolute; top: 0; left: 0; z-index: 2147483647; display: block; overflow: visible;';
        wrapper.appendChild(shadowHost);
        
        shadowRoot = shadowHost.attachShadow({ mode: 'open' });
        
        const shadowStyle = document.createElement('style');
        shadowStyle.textContent = VERITAI_CORE_CSS; 
        shadowRoot.appendChild(shadowStyle);
    } else {
        shadowRoot = shadowHost.shadowRoot;
    }

    let uiContainer = shadowRoot.querySelector('.veritai-ui-container');
    if (!uiContainer) {
        uiContainer = document.createElement('div');
        uiContainer.className = 'veritai-ui-container';
        shadowRoot.appendChild(uiContainer);
    }

    let badge = uiContainer.querySelector('.veritai-status-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'veritai-status-badge';
        badge.tabIndex = 0; 
        badge.setAttribute('role', 'button'); 
        uiContainer.appendChild(badge);
    }

    badge.onclick = null;
    badge.onmouseenter = null;
    badge.onmouseleave = null;
    badge.onkeydown = null;
    media.style.border = "none";

    if (status === "loading") {
        uiContainer.style.display = 'flex';
        uiContainer.style.opacity = '1';
        badge.innerHTML = `
            <div style="display: inline-flex; align-items: center; gap: 6px; white-space: nowrap !important; flex-wrap: nowrap !important;">
                <div class="veritai-spinner" style="flex-shrink: 0; display: inline-block;"></div>
                <span style="font-family: sans-serif; font-size: 11px; font-weight: bold; color: white; white-space: nowrap !important;">분석 중...</span>
            </div>`;
        badge.style.background = "rgba(59, 130, 246, 0.9)";
        badge.style.whiteSpace = "nowrap";
    }
    else if (status === "waiting") {
        uiContainer.style.display = 'flex';
        uiContainer.style.opacity = '1';
        badge.innerHTML = '<span style="white-space: nowrap;">대기 중...</span>';
        badge.style.background = "rgba(100, 116, 139, 0.9)"; 
        badge.style.whiteSpace = "nowrap";
    }
    else if (status === "error") {
        uiContainer.style.display = 'flex';
        uiContainer.style.opacity = '1';
        badge.innerHTML = `${data?.message || "분석 실패"} <span style="margin-left: 4px; font-size: 12px; cursor:pointer;">🔄 재시도</span>`;
        badge.style.background = "rgba(100, 116, 139, 0.9)";
        badge.style.cursor = "pointer";
        
        const retryAction = (e) => {
            e.stopPropagation();
            if (uiContainer) uiContainer.remove();
            if (shadowHost) shadowHost.remove();
            delete media.dataset.veritaiScanned;
            startInspection(media);
        };
        badge.onclick = retryAction;
        badge.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); retryAction(e); } };
    }
    else if (status === "fake" || status === "real") {
        badge.style.cursor = "pointer";
        const targetMediaSrc = media.currentSrc || media.src || "unknown_media";

        if (status === "fake") {
            uiContainer.style.display = 'flex';
            uiContainer.style.opacity = '1';
            const conf = ((data.result.confidence || 0) * 100).toFixed(1);
            badge.innerText = `🚨 조작 의심 (${conf}%)`;
            badge.style.background = "rgba(239, 68, 68, 0.95)";
            badge.style.whiteSpace = "nowrap";
            media.style.border = "2px solid rgba(239, 68, 68, 0.9)";
            media.style.boxShadow = "0 0 20px 5px rgba(239, 68, 68, 0.6)"; 
        } else {
            media.style.transition = "box-shadow 1s ease-out"; 
            media.style.boxShadow = "0 0 15px 3px rgba(16, 185, 129, 0.6)"; 
            setTimeout(() => { if(media.isConnected) media.style.boxShadow = "none"; }, 1500);

            uiContainer.style.display = 'flex';
            uiContainer.style.opacity = '1';
            badge.innerText = "✓";
            badge.style.background = "rgba(16, 185, 129, 0.8)";
            badge.style.width = "18px";
            badge.style.height = "18px";
            badge.style.borderRadius = "50%";
            badge.style.display = "flex";
            badge.style.justifyContent = "center";
            badge.style.alignItems = "center";
            badge.style.padding = "0";

            if (isCleanUIMode) {
                if (media.dataset.veritaiFadedOut === "true") {
                    uiContainer.style.opacity = "0";
                    uiContainer.style.display = "none";
                } else {
                    setTimeout(() => {
                        if (!isCleanUIMode) return; 
                        if (uiContainer && uiContainer.parentNode) {
                            uiContainer.style.transition = "opacity 0.5s ease-out";
                            uiContainer.style.opacity = "0";
                            setTimeout(() => { 
                                if (uiContainer && uiContainer.parentNode && isCleanUIMode) {
                                    uiContainer.style.display = "none"; 
                                    media.dataset.veritaiFadedOut = "true"; 
                                }
                            }, 500); 
                        }
                    }, 1500);
                }
            } else {
                delete media.dataset.veritaiFadedOut;
            }
        }
        
        const showReportBox = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            
            let existingBox = null;
            document.querySelectorAll('.veritai-details-box').forEach(box => {
                if (box.dataset.targetMedia === targetMediaSrc) {
                    existingBox = box;
                }
            });

            if (existingBox) return; 

            closeAllReportBoxes(false, targetMediaSrc); 

            const result = data.result;
            const faces = result.faces || [];

            const faceText = faces.length === 0 ?
                "<div style='text-align:center; color:#94a3b8; padding: 10px 0; font-size: 11px;'>전체 이미지 분석 완료</div>" :
                faces.slice(0, 3).map((f, i) => {
                    const bbox = f.bbox || {};
                    const quality = f.quality || {};
                    const detConf = ((f.detectionConfidence || f.score || 0) * 100).toFixed(1);
                    return `
                    <div style="background: rgba(0, 0, 0, 0.2); padding: 8px 10px; border-radius: 6px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="color:#fbbf24; font-weight:bold; margin-bottom: 6px; font-size: 11.5px;">[얼굴 ${i + 1}]</div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; color: #cbd5e1; font-size: 11px; line-height: 1.3;">
                            <div>• 유형: <span style="color:#fff">${escapeHTML(f.faceMode) || '?'}</span></div>
                            <div>• 검출률: <span style="color:#fff">${detConf}%</span></div>
                            <div>• 크기: <span style="color:#fff">${bbox.w ?? '?'}x${bbox.h ?? '?'}</span></div>
                            <div>• 품질: <span style="color:#fff">${escapeHTML(quality.label) || '?'}</span></div>
                        </div>
                    </div>`;
                }).join("");

            const detailsBox = document.createElement('div');
            detailsBox.className = `veritai-details-box unpinned ${status === "fake" ? "fake-border" : "real-border"}`;
            detailsBox.dataset.targetMedia = targetMediaSrc;
            detailsBox.dataset.isFeedbackActive = "false"; 

            detailsBox.innerHTML = `
<div class="veritai-drag-handle" style="color:lightskyblue; font-weight:bold; margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; font-size:14px; display:flex; justify-content:space-between; align-items: center; cursor: grab; user-select: none;">
    <span><span style="opacity: 0.4; margin-right: 6px; font-size: 12px; cursor: grab;">⋮⋮</span>🔍 분석 리포트</span>
    <span class="veritai-close-btn" tabindex="0" role="button" aria-label="닫기" style="cursor:pointer; color:#94a3b8; padding: 0 5px; font-size: 16px;">✕</span>
</div>
<div style="display: flex; flex-direction: column; gap: 6px;">
    <div><b>ID:</b> <span style="color:#e2e8f0;">${escapeHTML(data.requestId) || 'N/A'}</span></div>
    <div><b>판정:</b> ${readDeepfakeFlag(result) ? "<span style='color:#ef4444; font-weight:bold;'>조작 의심</span>" : "<span style='color:#10b981; font-weight:bold;'>정상</span>"}</div>
</div>
<div style="margin:12px 0; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 8px; background: rgba(0,0,0,0.2);">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="font-weight: bold; font-size: 11px; color: #94a3b8;" id="veritai-visual-title">감지 영역 (기본)</div>
        <button id="veritai-toggle-xai-btn" style="font-size: 10px; padding: 2px 6px; background: #3b82f6; color: white; border: none; border-radius: 3px; cursor: pointer;" ${!result.heatmapBase64 ? 'disabled' : ''}>
            ${result.heatmapBase64 ? 'AI 분석 근거 보기' : '정상 (조작 특이점 없음)'}
        </button>
    </div>
    <div style="position: relative; width: 100%; height: 160px; background: #0f172a; border-radius: 4px; overflow: hidden; border: 1px solid #333; display: flex; align-items: center; justify-content: center;">
        <canvas id="veritai-bbox-canvas" style="position: absolute; max-width: 100%; max-height: 100%; object-fit: contain; z-index: 2;"></canvas>
        <canvas id="veritai-heatmap-canvas" style="display: none; position: absolute; max-width: 100%; max-height: 100%; object-fit: contain; z-index: 1;"></canvas>
    </div>
    <div id="veritai-slider-container" style="display: none; margin-top: 8px; align-items: center; gap: 8px;">
        <button id="veritai-heatmap-eye-btn" title="원본/히트맵 끄기 켜기" style="background: none; border: none; cursor: pointer; padding: 0; font-size: 16px; transition: opacity 0.2s;">👁️</button>
        <span style="font-size: 10px; color: #64748b;">원본</span>
        <input type="range" id="veritai-heatmap-slider" min="0" max="100" value="70" style="flex: 1; accent-color: #ef4444; cursor: pointer;">
        <span style="font-size: 10px; color: #ef4444;">히트맵</span>
    </div>
</div>
<div style="margin:12px 0; border-top:1px dashed rgba(255,255,255,0.2);"></div>
${faceText}
<div style="margin-top: 15px; display: flex; justify-content: flex-end;">
    <button class="veritai-feedback-btn" style="font-size: 11px; padding: 4px 8px; cursor: pointer; background: rgba(255, 60, 60, 0.1); color: #ff6b6b; border: 1px solid rgba(255, 60, 60, 0.3); border-radius: 4px; transition: all 0.2s;">🚨 신고</button>
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
                    imgObj.src = targetMediaSrc; 
                };

                imgObj.onload = () => {
                    bboxCanvas.width = imgObj.width;
                    bboxCanvas.height = imgObj.height;
                    heatmapCanvas.width = imgObj.width;
                    heatmapCanvas.height = imgObj.height;
                    bCtx.drawImage(imgObj, 0, 0);
                    
                    if (faces && faces.length > 0) {
                        faces.forEach((f, i) => {
                            if (f.bbox && f.bbox.w > 0) {
                                bCtx.lineWidth = Math.max(3, imgObj.width / 150);
                                const isFake = (f.fakeProbability || f.confidence || 0) >= 0.5;
                                bCtx.strokeStyle = isFake ? "#ef4444" : "#10b981"; 
                                bCtx.fillStyle = isFake ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)";
                                bCtx.strokeRect(f.bbox.x, f.bbox.y, f.bbox.w, f.bbox.h);
                                bCtx.fillRect(f.bbox.x, f.bbox.y, f.bbox.w, f.bbox.h);
                                bCtx.font = `${Math.max(16, imgObj.width / 25)}px sans-serif`;
                                bCtx.fillStyle = bCtx.strokeStyle;
                                bCtx.fillText(`얼굴 ${i + 1}`, f.bbox.x, f.bbox.y - 5);
                            }
                        });
                    }

                    if (result.heatmapBase64) {
                        let bestFace = faces && faces.length > 0 ? faces[0] : null;
                        let maxScore = -1;
                        if (faces) {
                            faces.forEach(f => {
                                const score = f.fakeProbability || f.confidence || (f.detectionConfidence || 0);
                                if (score > maxScore) { maxScore = score; bestFace = f; }
                            });
                        }
                        const hmImg = new Image();
                        hmImg.onload = () => {
                            const drawHeatmap = (opacity) => {
                                hCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
                                hCtx.drawImage(imgObj, 0, 0); 
                                hCtx.globalAlpha = opacity;
                                hCtx.globalCompositeOperation = "screen"; 
                                if (bestFace && bestFace.bbox) {
                                    hCtx.drawImage(hmImg, bestFace.bbox.x, bestFace.bbox.y, bestFace.bbox.w, bestFace.bbox.h);
                                } else {
                                    hCtx.drawImage(hmImg, 0, 0, imgObj.width, imgObj.height);
                                }
                                hCtx.globalAlpha = 1.0;
                                hCtx.globalCompositeOperation = "source-over";
                            };
                            
                            let isOriginalView = false;
                            const eyeBtn = detailsBox.querySelector('#veritai-heatmap-eye-btn');

                            drawHeatmap(slider.value / 100);
                            
                            if (slider) {
                                slider.addEventListener('input', (e) => {
                                    isOriginalView = false;
                                    if(eyeBtn) eyeBtn.style.opacity = "1";
                                    drawHeatmap(e.target.value / 100);
                                });
                            }

                            if (eyeBtn) {
                                eyeBtn.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    isOriginalView = !isOriginalView;
                                    
                                    if (isOriginalView) {
                                        eyeBtn.style.opacity = "0.3"; 
                                        drawHeatmap(0);
                                    } else {
                                        eyeBtn.style.opacity = "1";   
                                        drawHeatmap(slider.value / 100);
                                    }
                                });
                                eyeBtn.addEventListener('keydown', (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        eyeBtn.click();
                                    }
                                });
                            }
                        };
                        hmImg.src = "data:image/jpeg;base64," + result.heatmapBase64;
                    }
                };
                imgObj.src = targetMediaSrc;
            }

            const toggleBtn = detailsBox.querySelector('#veritai-toggle-xai-btn');
            const visualTitle = detailsBox.querySelector('#veritai-visual-title');
            const sliderContainer = detailsBox.querySelector('#veritai-slider-container');
            let isHeatmapMode = false;

            if (toggleBtn && result.heatmapBase64) {
                toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    isHeatmapMode = !isHeatmapMode;
                    if (isHeatmapMode) {
                        bboxCanvas.style.display = 'none';
                        heatmapCanvas.style.display = 'block';
                        sliderContainer.style.display = 'flex';
                        toggleBtn.innerText = '감지 박스로 돌아가기';
                        toggleBtn.style.background = '#64748b';
                        visualTitle.innerText = 'XAI 분석 근거 (히트맵)';
                    } else {
                        bboxCanvas.style.display = 'block';
                        heatmapCanvas.style.display = 'none';
                        sliderContainer.style.display = 'none';
                        toggleBtn.innerText = 'AI 분석 근거 보기';
                        toggleBtn.style.background = '#3b82f6';
                        visualTitle.innerText = '감지 영역 (기본)';
                    }
                });
            }

            const dragHandle = detailsBox.querySelector('.veritai-drag-handle');
            let isDragging = false;
            let startX, startY, initialLeft, initialTop;

            dragHandle.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('veritai-close-btn')) return;
                isDragging = true;
                detailsBox.dataset.isDragged = "true";
                dragHandle.style.cursor = 'grabbing';
                const rect = detailsBox.getBoundingClientRect();
                detailsBox.style.transform = 'none'; 
                detailsBox.style.left = (rect.left + window.scrollX) + 'px'; 
                detailsBox.style.top = (rect.top + window.scrollY) + 'px';
                startX = e.clientX;
                startY = e.clientY;
                initialLeft = rect.left + window.scrollX;
                initialTop = rect.top + window.scrollY;
                e.preventDefault();
            });

            const onMouseMove = (e) => {
                if (!isDragging) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                detailsBox.style.left = (initialLeft + dx) + 'px';
                detailsBox.style.top = (initialTop + dy) + 'px';
            };

            const onMouseUp = () => {
                if (isDragging) {
                    isDragging = false;
                    dragHandle.style.cursor = 'grab';
                }
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);

            const updatePosition = () => {
                if (!document.body.contains(detailsBox)) return;
                if (detailsBox.dataset.isDragged === "true") return;
                
                const badgeRect = badge.getBoundingClientRect();
                let leftPos = badgeRect.right + 10 + window.scrollX;
                let topPos = badgeRect.bottom + 5 + window.scrollY;
                
                detailsBox.style.transform = 'none'; 
                detailsBox.style.left = leftPos + 'px';
                detailsBox.style.top = topPos + 'px';
            };

            updatePosition(); 

            const clampPosition = () => {
                if (detailsBox.dataset.isDragged === "true") return;
                updatePosition(); 
            };
            window.addEventListener('resize', clampPosition);

            const closeOnScroll = (evt) => {
                if (detailsBox.contains(evt.target)) return;
                if (detailsBox.dataset.isDragged !== "true" && detailsBox.dataset.isFeedbackActive !== "true") {
                    if (detailsBox.cleanupListeners) detailsBox.cleanupListeners();
                    detailsBox.remove();
                }
            };
            window.addEventListener('scroll', closeOnScroll, true);

            let closeDetails;
            detailsBox.cleanupListeners = () => {
                window.removeEventListener('resize', clampPosition);
                window.removeEventListener('scroll', closeOnScroll, true); 
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                if (closeDetails) document.removeEventListener('click', closeDetails);
            };

            const closeBtn = detailsBox.querySelector('.veritai-close-btn');
            if (closeBtn) {
                const closeAction = (evt) => {
                    evt.preventDefault(); evt.stopImmediatePropagation();
                    if (detailsBox.cleanupListeners) detailsBox.cleanupListeners();
                    detailsBox.remove();
                    badge.focus(); 
                };
                closeBtn.addEventListener('click', closeAction);
                closeBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') closeAction(e); });
            }

            const feedbackBtn = detailsBox.querySelector('.veritai-feedback-btn');
            if (feedbackBtn) {
                feedbackBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (feedbackBtn.disabled) return;
                    
                    detailsBox.dataset.isFeedbackActive = "true";
                    
                    feedbackBtn.style.display = 'none';

                    const reasonContainer = document.createElement('div');
                    reasonContainer.style.cssText = 'display: flex; flex-direction: column; gap: 5px; margin-top: 5px; width: 100%;';
                    const reasonInput = document.createElement('textarea');
                    reasonInput.placeholder = "어떤 부분이 잘못되었나요?";
                    reasonInput.style.cssText = `font-size: 11px; padding: 5px; border-radius: 4px; border: 1px solid #555; background: #222; color: white; resize: none; height: 40px; font-family: sans-serif;`;
                    reasonInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            e.stopPropagation();
                            cancelBtn.click(); 
                            }
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault(); 
                            submitBtn.click(); 
                        }
                    });
                    const actionContainer = document.createElement('div');
                    actionContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 5px;';
                    const cancelBtn = document.createElement('button');
                    cancelBtn.innerText = "취소";
                    cancelBtn.style.cssText = 'font-size: 11px; padding: 2px 8px; cursor: pointer; background: #444; color: white; border: none; border-radius: 3px;';
                    const submitBtn = document.createElement('button');
                    submitBtn.innerText = "제출";
                    submitBtn.style.cssText = 'font-size: 11px; padding: 2px 8px; cursor: pointer; background: #ff6b6b; color: white; border: none; border-radius: 3px; font-weight: bold;';

                    actionContainer.appendChild(cancelBtn);
                    actionContainer.appendChild(submitBtn);
                    reasonContainer.appendChild(reasonInput);
                    reasonContainer.appendChild(actionContainer);
                    feedbackBtn.parentNode.appendChild(reasonContainer);
                    setTimeout(() => reasonInput.focus(), 50);

                    cancelBtn.onclick = (cancelEvent) => {
                        cancelEvent.stopPropagation();
                        reasonContainer.remove();
                        feedbackBtn.style.display = 'flex';
                        detailsBox.dataset.isFeedbackActive = "false";
                    };

                    submitBtn.onclick = async (submitEvent) => {
                        submitEvent.stopPropagation();
                        const textReason = reasonInput.value.trim();
                        if (!textReason) {
                            reasonInput.style.border = "1px solid red";
                            reasonInput.placeholder = "신고 이유를 적어주세요.";
                            return;
                        }
                        submitBtn.innerText = "전송 중...";
                        submitBtn.disabled = true;
                        cancelBtn.disabled = true;

                        try {
                            const response = await fetch(FEEDBACK_URL, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    requestId: data.requestId,
                                    reportedAt: new Date().toISOString(),
                                    reason: textReason
                                })
                            });
                            if (!response.ok) throw new Error("전송 실패");
                            reasonContainer.innerHTML = "<span style='color: lightgreen; font-size: 11px; text-align: right; padding-top: 5px;'>✓ 피드백이 성공적으로 접수되었습니다.</span>";
                            setTimeout(() => {
                                reasonContainer.remove();
                                feedbackBtn.style.display = 'flex';
                                feedbackBtn.style.opacity = '0.5'; 
                                feedbackBtn.innerText = '✓ 신고 완료';
                                feedbackBtn.disabled = true; 
                                detailsBox.dataset.isFeedbackActive = "false";
                            }, 1500);
                        } catch (err) {
                            submitBtn.innerText = "실패(재시도)";
                            submitBtn.disabled = false;
                            cancelBtn.disabled = false;
                        }
                    };
                };
            }

            setTimeout(() => {
                closeDetails = (evt) => {
                    if (!detailsBox.contains(evt.target) && !badge.contains(evt.target)) {
                        if (detailsBox.dataset.isDragged !== "true" && detailsBox.dataset.isFeedbackActive !== "true") {
                            if (detailsBox.cleanupListeners) detailsBox.cleanupListeners();
                            detailsBox.remove();
                        }
                    }
                };
                document.addEventListener('click', closeDetails);
            }, 10);
        };

        badge.onmouseenter = (e) => {
            badge.style.opacity = "1";
            badge.dataset.isHovered = "true";
            showReportBox(e);
        };

        badge.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                badge.style.opacity = "1";
                badge.dataset.isHovered = "true";
                showReportBox(e);
                
                setTimeout(() => {
                    const toggleBtn = detailsBox.querySelector('#veritai-toggle-xai-btn');
                    const cBtn = detailsBox.querySelector('.veritai-close-btn');
                    if (toggleBtn && !toggleBtn.disabled) toggleBtn.focus();
                    else if (cBtn) cBtn.focus();
                }, 50);
            }
        };
        
        badge.onmouseleave = () => {
            badge.dataset.isHovered = "false";
            setTimeout(() => {
                let existingBox = null;
                document.querySelectorAll('.veritai-details-box').forEach(box => {
                    if (box.dataset.targetMedia === targetMediaSrc) existingBox = box; 
                });
                
                if (existingBox && existingBox.dataset.isHovered !== "true" && badge.dataset.isHovered !== "true" && existingBox.dataset.isDragged !== "true" && existingBox.dataset.isFeedbackActive !== "true") {
                    if (existingBox.cleanupListeners) existingBox.cleanupListeners();
                    existingBox.remove();
                }

                if (isCleanUIMode && status === "real" && !existingBox && badge.dataset.isHovered !== "true") {
                    if (uiContainer && uiContainer.parentNode) {
                        uiContainer.style.transition = "opacity 0.5s ease-out";
                        uiContainer.style.opacity = "0";
                        setTimeout(() => { if (uiContainer && uiContainer.parentNode) uiContainer.style.display = "none"; }, 1000);
                    }
                }
            }, 100);
        };

        badge.onclick = (e) => { e.preventDefault(); e.stopPropagation(); };
    }
}

async function startInspection(media) {
    if (!isSystemOn && media.dataset.forceInspect !== "true") return;
    if (media.dataset.forceInspect !== "true" && !shouldInspectMedia(media)) return; 
    if (media.dataset.veritaiScanned === "true") return;

    const mediaUrl = media.currentSrc || media.src;
    const scanKey = getMediaKey(media);

    if (mediaUrl && scanCache.has(mediaUrl)) {
        media.dataset.veritaiScanned = "true";
        media.dataset.veritaiScanKey = scanKey;
        scannedMediaKeys.add(scanKey); 
        const cachedData = getFromCache(mediaUrl); 
        updateStatusBadge(media, readDeepfakeFlag(cachedData.result) ? "fake" : "real", cachedData);
        return;
    }

    if (scannedMediaKeys.has(scanKey)) return;
    scannedMediaKeys.add(scanKey);
    manageMemoryCache();
    media.dataset.veritaiScanned = "true";
    media.dataset.veritaiScanKey = scanKey;

    const wrapper = ensureWrapper(media);
    if (wrapper) {
        const btn = wrapper.querySelector('.veritai-check-btn');
        if (btn) btn.remove();
    }

    updateStatusBadge(media, "waiting");

    return runWithInspectionLimit(async () => {
        updateStatusBadge(media, "loading");

        if (mediaUrl && scanCache.has(mediaUrl)) {
            const cachedData = getFromCache(mediaUrl);
            if (readDeepfakeFlag(cachedData.result)) updateStatusBadge(media, "fake", cachedData);
            else updateStatusBadge(media, "real", cachedData);
            return;
        }

        let blob;
        let mediaType = "image";
        if (media.tagName === "VIDEO") {
            blob = await captureVideoBlob(media);
            mediaType = "video_frame";
        } else {
            blob = await captureImageBlob(mediaUrl);
        }

        const data = await sendToBackend(blob, mediaType);

        if (!media.dataset.veritaiScanned) return;

        if (mediaUrl) setToCache(mediaUrl, data);

        const isFake = readDeepfakeFlag(data.result);
        
        recordInspectionStat(isFake); 

        if (isFake) updateStatusBadge(media, "fake", data);
        else updateStatusBadge(media, "real", data);
    }, media).catch((err) => {
        if (!isSystemOn) return;

        const isLikelyAd = (window !== window.top) || media.closest(GLOBAL_AD_SELECTOR);

        if (err.message.includes("CORS") || err.message.includes("보안 차단됨") || (err.name === 'TypeError' && err.message === 'Failed to fetch' && isLikelyAd)) {
            delete media.dataset.veritaiScanned;
            delete media.dataset.veritaiScanKey;
            const wrapper = ensureWrapper(media);
            if (wrapper) {
                const ui = wrapper.querySelector('.veritai-ui-container');
                if (ui) ui.remove();
                const btn = wrapper.querySelector('.veritai-check-btn');
                if (btn) btn.remove(); 
            }
            return; 
        }

        let friendlyMessage = "분석 오류";
        if (err.status === 429) friendlyMessage = "요청 과다 (잠시 후 시도)";
        else if (err.status === 408) friendlyMessage = "응답 지연 (서버 혼잡)";
        else if (err.status >= 500) friendlyMessage = "서버 내부 오류";
        else if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
            friendlyMessage = "접근 불가 (보안차단/서버꺼짐)";
        }
        else if (err.status === 400 || err.status === 415) friendlyMessage = "지원하지 않는 이미지";
        else friendlyMessage = err.message || "분석 실패";
        
        updateStatusBadge(media, "error", { message: friendlyMessage });
        delete media.dataset.veritaiScanned;
        if (media.dataset.veritaiScanKey) {
            scannedMediaKeys.delete(media.dataset.veritaiScanKey);
            delete media.dataset.veritaiScanKey;
        }
    });
}

const autoScanObserver = new IntersectionObserver((entries) => {
    if (!isSystemOn || !isAutoScanMode) return;
    entries.forEach(entry => {
        if (entry.isIntersecting && entry.target.clientWidth > 80) {
            if (entry.target.dataset.scanTimer) clearTimeout(entry.target.dataset.scanTimer);
            entry.target.dataset.scanTimer = setTimeout(() => {
                const rect = entry.target.getBoundingClientRect();
                if (rect.top < window.innerHeight && rect.bottom > 0) {
                    startInspection(entry.target);
                    autoScanObserver.unobserve(entry.target);
                }
            }, 300);
        }
    });
}, { threshold: 0.3 });

const domObserver = new MutationObserver((mutations) => {
    if (!isSystemOn) return;

    mutationQueue.push(...mutations);
    if (observerDebounceTimer) clearTimeout(observerDebounceTimer);
    observerDebounceTimer = setTimeout(() => {
        const mutationsToProcess = mutationQueue;
        mutationQueue = []; 

        mutationsToProcess.forEach(mutation => {
            if (mutation.addedNodes) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && (node.tagName === 'IMG' || node.tagName === 'VIDEO')) attachUI(node); 
                    else if (node.nodeType === 1 && node.querySelectorAll) node.querySelectorAll('img, video').forEach(media => attachUI(media));
                });
            }
            if (mutation.removedNodes) {
                mutation.removedNodes.forEach(node => {
                    if (node.nodeType === 1 && (node.tagName === 'IMG' || node.tagName === 'VIDEO')) {
                        const key = node.dataset.veritaiScanKey;
                        if (key) scannedMediaKeys.delete(key);
                    }
                });
            }
            
            if (mutation.type === 'attributes' && (mutation.attributeName === 'src' || mutation.attributeName === 'srcset')) {
                const target = mutation.target;
                if (target.tagName === 'IMG' || target.tagName === 'VIDEO') {
                    delete target.dataset.veritaiAttached;
                    delete target.dataset.veritaiScanned;
                    delete target.dataset.veritaiScanKey;
                    const wrapper = ensureWrapper(target);
                    if (wrapper) {
                        const oldBadge = wrapper.querySelector('.veritai-ui-container');
                        if (oldBadge) oldBadge.remove();
                        const oldBtn = wrapper.querySelector('.veritai-check-btn');
                        if (oldBtn) oldBtn.remove();
                    }
                    if (target.tagName === 'IMG' && !target.complete) target.addEventListener('load', () => attachUI(target), { once: true });
                    else attachUI(target); 
                }
            }
        });
    }, 150);
});

function ensureWrapper(media) {
    let parent = media.parentElement;
    if (!parent) return null;
    if (parent.tagName === 'PICTURE' || parent.tagName === 'YT-IMAGE' || parent.tagName === 'YT-IMG-SHADOW') {
        parent = parent.parentElement;
        if (!parent) return null;
    }
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    return parent;
}

function attachUI(media, retryCount = 0) {
    if (media.tagName === 'IMG' && !media.complete) {
        media.addEventListener('load', () => attachUI(media, retryCount), { once: true });
        return;
    }

    if (!shouldInspectMedia(media)) {
        if (retryCount < 5) setTimeout(() => attachUI(media, retryCount + 1), 300);
        return;
    }

    const wrapper = ensureWrapper(media);
    const hasUI = wrapper && (wrapper.querySelector('.veritai-check-btn') || wrapper.querySelector('.veritai-status-badge'));
    const mediaUrl = media.currentSrc || media.src;

    if (mediaUrl && scanCache.has(mediaUrl) && !hasUI) {
        media.dataset.veritaiAttached = "true";
        media.dataset.veritaiScanned = "true";
        media.dataset.veritaiScanKey = getMediaKey(media);
        const data = getFromCache(mediaUrl); 
        updateStatusBadge(media, readDeepfakeFlag(data.result) ? "fake" : "real", data);
        return;
    }

    if (media.dataset.veritaiScanned === "true") return;
    if (media.dataset.veritaiAttached === "true" && hasUI) return;
    media.dataset.veritaiAttached = "true";
    delete media.dataset.veritaiScanned;

    if (isAutoScanMode && media.tagName !== 'VIDEO') {
        autoScanObserver.observe(media); 
    } else {
        if (wrapper && !wrapper.querySelector('.veritai-check-btn')) {
            const btn = document.createElement("button");
            btn.innerText = "🔍 검사";
            btn.className = "veritai-check-btn";
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                startInspection(media);
            });
            wrapper.appendChild(btn);
        }
    }
}

function clearAllUI() {
    document.querySelectorAll('img, video').forEach(media => {
        media.style.border = "none";
        media.style.boxShadow = "none"; 
        delete media.dataset.veritaiScanned;
        delete media.dataset.veritaiAttached;
        delete media.dataset.veritaiScanKey;
        const wrapper = ensureWrapper(media);
        if (wrapper) {
            const container = wrapper.querySelector('.veritai-ui-container');
            if (container) container.remove();
            const btn = wrapper.querySelector('.veritai-check-btn');
            if (btn) btn.remove();
        }
    });
    scannedMediaKeys.clear();
    closeAllReportBoxes(true); 
    const hint = document.getElementById('veritai-mini-hint');
    if (hint) hint.remove();
    const wrapper = document.getElementById('veritai-dropzone-wrapper');
    if (wrapper) wrapper.remove();
    document.querySelectorAll('.veritai-standalone-modal').forEach(m => m.remove());
}

chrome.storage.local.get(['isSystemOn', 'isAutoScanOn', 'isCleanUIMode'], (result) => {
    isSystemOn = result.isSystemOn !== false;
    isAutoScanMode = result.isAutoScanOn || false;
    isCleanUIMode = result.isCleanUIMode || false;
    setTimeout(() => {
        if (isSystemOn) {
            injectDropzone(); 
            document.querySelectorAll('img, video').forEach(media => attachUI(media));
            domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [ "src","class", "style", "open", "aria-hidden", "aria-modal"] });
        }
    }, 500);
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        let modeChanged = false;
        
        if (changes.isSystemOn) isSystemOn = changes.isSystemOn.newValue;
        if (changes.isAutoScanOn) {
            isAutoScanMode = changes.isAutoScanOn.newValue;
            modeChanged = true;
        }
        
        if (changes.isCleanUIMode) {
            isCleanUIMode = changes.isCleanUIMode.newValue;
            document.querySelectorAll('img, video').forEach(media => {
                if (media.dataset.veritaiScanned === "true") {
                    const mediaUrl = media.currentSrc || media.src;
                    if (mediaUrl && scanCache.has(mediaUrl)) {
                        const data = scanCache.get(mediaUrl);
                        if (!readDeepfakeFlag(data.result)) {
                            const wrapper = ensureWrapper(media);
                            if (wrapper) {
                                const shadowHost = wrapper.querySelector('veritai-host');
                                const uiContainer = shadowHost ? shadowHost.shadowRoot.querySelector('.veritai-ui-container') : wrapper.querySelector('.veritai-ui-container');
                                
                                if (isCleanUIMode) {
                                    if (uiContainer) {
                                        uiContainer.style.transition = "opacity 0.5s ease-out";
                                        uiContainer.style.opacity = "0";
                                        setTimeout(() => { if (uiContainer) uiContainer.style.display = "none"; }, 300);
                                    }
                                } else {
                                    delete media.dataset.veritaiFadedOut;
                                    if (uiContainer) {
                                        uiContainer.style.display = "flex";
                                        uiContainer.style.opacity = "1";
                                    } else {
                                        updateStatusBadge(media, "real", data);
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }
        
        if (!isSystemOn) {
            while (pendingInspectionQueue.length > 0) {
                pendingInspectionQueue.shift().reject(new Error("시스템 중지됨"));
            }
            clearPendingPolls();
            autoScanObserver.disconnect();
            domObserver.disconnect();
            clearAllUI();
        } else {
            injectDropzone(); 
            if (modeChanged) {
                if (!isAutoScanMode) {
                    while (pendingInspectionQueue.length > 0) {
                        pendingInspectionQueue.shift().reject(new Error("수동 모드 전환으로 인한 취소"));
                    }
                }

                document.querySelectorAll('img, video').forEach(media => {
                    if (!isAutoScanMode && media.dataset.veritaiScanned === "true") {
                        const wrapper = ensureWrapper(media);
                        if (wrapper) {
                            const badge = wrapper.querySelector('.veritai-status-badge');
                            if (badge && badge.innerHTML.includes("veritai-spin")) {
                                delete media.dataset.veritaiScanned;
                                if (media.dataset.veritaiScanKey) {
                                    scannedMediaKeys.delete(media.dataset.veritaiScanKey);
                                    delete media.dataset.veritaiScanKey;
                                }
                                const container = wrapper.querySelector('.veritai-ui-container');
                                if (container) container.remove();
                            }
                        }
                    }

                    if (!media.dataset.veritaiScanned) {
                        const wrapper = ensureWrapper(media);
                        if (wrapper) {
                            const btn = wrapper.querySelector('.veritai-check-btn');
                            if (btn) btn.remove();
                        }
                        autoScanObserver.unobserve(media);
                        delete media.dataset.veritaiAttached;
                    }
                });
            }
            document.querySelectorAll('img, video').forEach(media => attachUI(media));
            domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "class"] });
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAllReportBoxes(true);
    }
    
    if (e.altKey && e.key.toLowerCase() === 'v') {
        const badges = Array.from(document.querySelectorAll('.veritai-status-badge'));
        const fakeBadges = badges.filter(badge => badge.innerText.includes('조작 의심'));
        
        if (fakeBadges.length === 0) {
            const hint = document.getElementById('veritai-mini-hint');
            if (hint) {
                hint.style.transform = 'scale(1.1)';
                setTimeout(() => hint.style.transform = 'scale(1)', 200);
            }
            return;
        }

        let targetBadge = fakeBadges[0];
        for (let badge of fakeBadges) {
            const rect = badge.getBoundingClientRect();
            if (rect.top >= 0) { 
                targetBadge = badge;
                break;
            }
        }

        targetBadge.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => targetBadge.focus(), 300);
    }
});

document.addEventListener('click', (e) => {
    if (!e.isTrusted) return; 
    const customUIs = document.querySelectorAll('.veritai-check-btn, .veritai-status-badge');
    if (customUIs.length === 0) return; 
    for (let ui of customUIs) {
        const rect = ui.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
            e.preventDefault();
            e.stopPropagation();
            if (ui.classList.contains('veritai-check-btn')) ui.click();
            else if (ui.classList.contains('veritai-status-badge') && ui.onclick) ui.onclick(e);
            return; 
        }
    }
}, true);

function injectDropzone() {
    if (document.getElementById('veritai-mini-hint')) return;

    const miniHint = document.createElement('div');
    miniHint.id = 'veritai-mini-hint';
    miniHint.innerHTML = `<span style="font-size:18px;">📥</span><span class="veritai-mini-text">사진 드래그 검사</span>`;
    document.body.appendChild(miniHint);

    const wrapper = document.createElement('div');
    wrapper.id = 'veritai-dropzone-wrapper';
    wrapper.style.cssText = 'position:fixed; bottom:24px; right:24px; width:240px; height:180px; z-index:2147483646; display:none; background:rgba(30, 41, 59, 0.95); border: 3px dashed #3b82f6; border-radius: 16px; align-items:center; justify-content:center; box-shadow: 0 10px 40px rgba(0,0,0,0.5); transition:all 0.2s ease; transform:translateY(10px); opacity:0;';

    const dz = document.createElement('div');
    dz.innerHTML = `<div style="text-align:center; pointer-events:none;"><div style="font-size:36px; margin-bottom:12px;">📥</div><div style="font-size:14px; font-weight:bold; color:white;">여기로 사진을 놓으세요</div></div>`;
    wrapper.appendChild(dz);
    document.body.appendChild(wrapper);

    let dragCounter = 0;

    const hideDropzoneUI = () => {
        wrapper.style.borderColor = '#3b82f6';
        wrapper.style.background = 'rgba(30, 41, 59, 0.95)';
        wrapper.style.opacity = '0';
        wrapper.style.transform = 'translateY(10px)';
        setTimeout(() => { 
            if (dragCounter === 0) {
                wrapper.style.display = 'none'; 
                miniHint.style.display = 'flex'; 
            }
        }, 200);
    };

    window.addEventListener('dragenter', (e) => {
        if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list") || e.dataTransfer.types.includes("text/html")) {
            e.preventDefault();
            dragCounter++;
            if (dragCounter === 1) {
                miniHint.style.display = 'none'; 
                wrapper.style.display = 'flex';
                requestAnimationFrame(() => { 
                    wrapper.style.opacity = '1'; 
                    wrapper.style.transform = 'translateY(0)'; 
                });
            }
        }
    });

    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) hideDropzoneUI(); 
    });

    wrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        wrapper.style.borderColor = '#10b981';
        wrapper.style.background = 'rgba(16, 185, 129, 0.15)';
    });

    wrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation(); 
        dragCounter = 0;
        hideDropzoneUI(); 

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
                analyzeStandaloneMedia(URL.createObjectURL(file), file.type.startsWith('video/'));
            }
        } else {
            const html = e.dataTransfer.getData('text/html');
            const srcMatch = html && html.match(/src\s*=\s*['"]([^'"]+)['"]/);
            if (srcMatch) analyzeStandaloneMedia(srcMatch[1], false);
            else {
                const uri = e.dataTransfer.getData('text/uri-list');
                if (uri) analyzeStandaloneMedia(uri, false);
            }
        }
    });
}

function analyzeStandaloneMedia(src, isVideo) {
    const modal = document.createElement('div');
    modal.className = 'veritai-standalone-modal';
    
    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '✕ 닫기';
    closeBtn.style.cssText = 'position:absolute; top:20px; right:30px; color:white; font-size:16px; cursor:pointer; font-weight:bold; background:rgba(255,255,255,0.2); padding:5px 10px; border-radius:8px; z-index:10; transition:0.2s;';

    closeBtn.tabIndex = 0;
    closeBtn.setAttribute('role', 'button');
    closeBtn.setAttribute('aria-label', '모달 닫기');
    const closeModal = () => modal.remove();
    closeBtn.onclick = closeModal;
    closeBtn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') closeModal(); };

    setTimeout(() => closeBtn.focus(), 100);
    
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative; display:inline-block; max-width:80vw; max-height:80vh; background:black; border-radius:8px; box-shadow: 0 0 30px rgba(0,0,0,0.8);';
    
    const media = document.createElement(isVideo ? 'video' : 'img');
    media.src = src;
    media.style.cssText = 'max-width:80vw; max-height:80vh; display:block; border-radius:8px;';
    if (isVideo) { media.controls = true; media.autoplay = true; media.muted = true; }
    
    wrapper.appendChild(media);
    modal.appendChild(closeBtn);
    modal.appendChild(wrapper);
    document.body.appendChild(modal);

    const initInspect = () => setTimeout(() => { 
        media.dataset.forceInspect = "true"; 
        startInspection(media); 
    }, 300);
    if (isVideo) media.onloadeddata = initInspect; else media.onload = initInspect;
}

function recordInspectionStat(isFake) {
    const today = new Date().toLocaleDateString();
    
    chrome.storage.local.get(['veritai_stat_date', 'veritai_stat_scanned', 'veritai_stat_blocked'], (res) => {
        let scanned = res.veritai_stat_scanned || 0;
        let blocked = res.veritai_stat_blocked || 0;
        
        if (res.veritai_stat_date !== today) {
            scanned = 0; 
            blocked = 0;
        }
        
        scanned++; 
        if (isFake) blocked++; 
        
        chrome.storage.local.set({
            veritai_stat_date: today,
            veritai_stat_scanned: scanned,
            veritai_stat_blocked: blocked
        });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "clear_cache_and_rescan") {
        scanCache.clear();      
        scannedMediaKeys.clear(); 
        clearAllUI();            
        if (isSystemOn) {
            document.querySelectorAll('img, video').forEach(media => attachUI(media));
        }
        sendResponse({ success: true });
    } 
    else if (request.action === "context_menu_inspect") {
        const targetSrc = request.srcUrl;
        const mediaElements = Array.from(document.querySelectorAll('img, video'));
        const foundMedia = mediaElements.find(m => m.src === targetSrc || m.currentSrc === targetSrc);
        
        if (foundMedia && isVisibleMedia(foundMedia)) {
            foundMedia.scrollIntoView({ behavior: 'smooth', block: 'center' });
            foundMedia.dataset.forceInspect = "true"; 
            startInspection(foundMedia);
        } else {
            analyzeStandaloneMedia(targetSrc, request.mediaType === "video");
        }
    }
    return true;
});