// VeritAI 화면 공통 스타일
// 배지는 Shadow DOM 안에, 검사 버튼과 리포트는 페이지 DOM에 들어가므로 같은 CSS를 양쪽에 넣는다.
// 페이지 CSS의 영향을 줄이려고 리포트 안쪽 규칙은 .veritai-details-box 아래로 한정한다.

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`;
const THEMED = `.veritai-details-box, #veritai-mini-hint, #veritai-dropzone-wrapper, .veritai-standalone-modal`;

export const VERITAI_CORE_CSS = `
    ${THEMED} {
        --vr-bg: #1b2331; --vr-surface: #232d3d; --vr-border: #334056; --vr-text: #e3e8ef; --vr-sub: #a8b3c4; --vr-muted: #7a879b;
        --vr-accent: #6f9be8; --vr-fake: #ef6f72; --vr-real: #52c08c; --vr-warn: #e2a64a; --vr-track: #2e394b;
        --vr-btn-bg: #4f7fd1; --vr-btn-text: #ffffff; --vr-shadow: 0 12px 32px rgba(8, 12, 20, 0.45);
    }

    @keyframes veritai-spin { to { transform: rotate(360deg); } }
    @keyframes veritai-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

    .veritai-ui-container { position: absolute; top: 8px; left: 8px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-start; pointer-events: none; }

    /* 사진 위 배지: 어떤 사진 위에서도 읽히도록 테마와 상관없이 반투명 어두운 칩 */
    .veritai-status-badge {
        display: inline-flex !important; align-items: center; gap: 6px; box-sizing: border-box !important;
        height: 26px; padding: 0 10px 0 9px; border-radius: 13px;
        background: rgba(27, 35, 49, 0.88); border: 1px solid rgba(255, 255, 255, 0.12);
        color: #eceef0; font: 600 12px/1 ${FONT}; letter-spacing: -0.1px; white-space: nowrap;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22); user-select: none; cursor: default; pointer-events: auto !important;
        font-variant-numeric: tabular-nums;
    }
    .veritai-status-badge svg { width: 13px; height: 13px; flex-shrink: 0; }
    .veritai-status-badge .vr-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .veritai-status-badge.is-fake { cursor: pointer; }
    .veritai-status-badge.is-fake .vr-dot { background: #f06a6d; }
    .veritai-status-badge.is-real { cursor: pointer; }
    .veritai-status-badge.is-real svg { color: #5fd39b; }
    .veritai-status-badge.is-waiting .vr-dot { border: 1.5px solid #9aa1aa; box-sizing: border-box; }
    .veritai-status-badge.is-error { cursor: pointer; }
    .veritai-status-badge.is-error svg { color: #eab066; }
    .veritai-status-badge .vr-retry { margin-left: 2px; text-decoration: underline; text-underline-offset: 2px; }
    .veritai-spinner { width: 11px; height: 11px; border: 1.5px solid rgba(255, 255, 255, 0.3); border-top-color: #eceef0; border-radius: 50%; box-sizing: border-box; animation: veritai-spin 0.8s linear infinite !important; flex-shrink: 0; }

    .veritai-check-btn {
        position: absolute; top: 8px; left: 8px; z-index: 2147483647; box-sizing: border-box !important;
        display: inline-flex !important; align-items: center; gap: 5px; height: 28px; padding: 0 12px 0 10px; margin: 0;
        background: rgba(255, 255, 255, 0.95); color: #23272c; border: 1px solid rgba(0, 0, 0, 0.1); border-radius: 14px;
        font: 600 12px/1 ${FONT} !important; letter-spacing: -0.1px; cursor: pointer; pointer-events: auto !important;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18); transition: background 0.15s ease;
    }
    .veritai-check-btn svg { width: 13px; height: 13px; }
    .veritai-check-btn:hover { background: #ffffff; }

    .veritai-details-box {
        position: absolute; top: 0; left: 0; z-index: 2147483647; box-sizing: border-box; margin: 0;
        width: 304px; max-height: 500px; overflow-y: auto; padding: 0;
        background: var(--vr-bg); color: var(--vr-text); border: 1px solid var(--vr-border); border-radius: 12px;
        box-shadow: var(--vr-shadow); font: 400 13px/1.55 ${FONT}; text-align: left; letter-spacing: normal;
        cursor: default; pointer-events: auto; animation: veritai-rise 0.18s ease-out;
    }
    .veritai-details-box * { box-sizing: border-box; }
    .veritai-details-box::-webkit-scrollbar { width: 6px; }
    .veritai-details-box::-webkit-scrollbar-thumb { background: var(--vr-border); border-radius: 3px; }
    .veritai-details-box button { font-family: ${FONT}; margin: 0; }

    .veritai-details-box .veritai-drag-handle { display: flex; align-items: center; justify-content: space-between; padding: 10px 10px 4px 16px; cursor: grab; user-select: none; }
    .veritai-details-box .vr-head-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--vr-muted); }
    .veritai-details-box .vr-head-title svg { width: 13px; height: 13px; }
    .veritai-details-box .veritai-close-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; color: var(--vr-muted); cursor: pointer; }
    .veritai-details-box .veritai-close-btn:hover { background: var(--vr-surface); color: var(--vr-text); }
    .veritai-details-box .veritai-close-btn svg { width: 15px; height: 15px; }

    .veritai-details-box .vr-section { padding: 10px 16px 14px; }
    .veritai-details-box .vr-section + .vr-section { border-top: 1px solid var(--vr-border); padding-top: 14px; }
    .veritai-details-box .vr-verdict { font-size: 19px; font-weight: 700; letter-spacing: -0.3px; line-height: 1.3; }
    .veritai-details-box .vr-verdict.is-fake { color: var(--vr-fake); }
    .veritai-details-box .vr-verdict.is-real { color: var(--vr-real); }
    .veritai-details-box .vr-desc { margin-top: 2px; color: var(--vr-sub); }

    .veritai-details-box .vr-meter { margin-top: 12px; }
    .veritai-details-box .vr-meter-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: var(--vr-sub); margin-bottom: 5px; font-variant-numeric: tabular-nums; }
    .veritai-details-box .vr-meter-row b { color: var(--vr-text); font-size: 13px; }
    .veritai-details-box .vr-track { position: relative; height: 6px; border-radius: 3px; background: var(--vr-track); overflow: hidden; }
    .veritai-details-box .vr-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; }
    .veritai-details-box .vr-fill.is-fake { background: var(--vr-fake); }
    .veritai-details-box .vr-fill.is-warn { background: var(--vr-warn); }
    .veritai-details-box .vr-fill.is-real { background: var(--vr-real); }
    .veritai-details-box .vr-meter-scale { display: flex; justify-content: space-between; margin-top: 4px; font-size: 10.5px; color: var(--vr-muted); }
    .veritai-details-box .vr-meta { margin-top: 8px; font-size: 12px; color: var(--vr-muted); }

    .veritai-details-box .vr-stage-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .veritai-details-box .vr-label { font-size: 12px; font-weight: 600; color: var(--vr-sub); }
    .veritai-details-box .vr-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 28px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--vr-border); background: transparent; color: var(--vr-text); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .veritai-details-box .vr-btn:hover { background: var(--vr-surface); }
    .veritai-details-box .vr-btn:disabled { color: var(--vr-muted); cursor: default; background: transparent; }
    .veritai-details-box .vr-btn.is-primary { background: var(--vr-btn-bg); border-color: var(--vr-btn-bg); color: var(--vr-btn-text); }
    .veritai-details-box .vr-btn.is-accent { border-color: rgba(111, 155, 232, 0.5); color: #c9daf8; }
    .veritai-details-box .vr-btn.is-accent:hover { background: rgba(111, 155, 232, 0.14); }
    .veritai-details-box .vr-btn.is-quiet { border-color: transparent; color: var(--vr-sub); }
    .veritai-details-box .vr-btn.is-quiet:hover { color: var(--vr-text); }
    .veritai-details-box .vr-btn svg { width: 13px; height: 13px; }

    .veritai-details-box .vr-stage { position: relative; width: 100%; height: 210px; background: var(--vr-surface); border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
    .veritai-details-box .vr-stage canvas { position: absolute; max-width: 100%; max-height: 100%; }

    .veritai-details-box .vr-slider { display: none; align-items: center; gap: 8px; margin-top: 10px; font-size: 12px; color: var(--vr-sub); }
    .veritai-details-box .vr-slider input { flex: 1; accent-color: var(--vr-fake); cursor: pointer; margin: 0; }
    .veritai-details-box .vr-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 8px; background: transparent; color: var(--vr-sub); cursor: pointer; }
    .veritai-details-box .vr-icon-btn:hover { background: var(--vr-surface); }
    .veritai-details-box .vr-icon-btn svg { width: 16px; height: 16px; }
    .veritai-details-box .vr-icon-btn.is-off { color: var(--vr-muted); opacity: 0.6; }

    .veritai-details-box .vr-tabs { display: none; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .veritai-details-box .veritai-heatmap-view-btn { height: 28px; padding: 0 10px; border-radius: 14px; border: 1px solid var(--vr-border); background: transparent; color: var(--vr-sub); font-size: 12px; cursor: pointer; font-variant-numeric: tabular-nums; }
    .veritai-details-box .veritai-heatmap-view-btn.is-active { border-color: var(--vr-accent); color: var(--vr-text); background: rgba(111, 155, 232, 0.16); }
    .veritai-details-box .vr-note { display: none; margin-top: 8px; font-size: 12px; line-height: 1.55; color: var(--vr-sub); }
    .veritai-details-box .vr-legend { display: none; align-items: center; gap: 8px; margin-top: 8px; font-size: 11px; color: var(--vr-muted); }
    .veritai-details-box .vr-legend i { flex: 1; max-width: 140px; height: 6px; border-radius: 3px; background: linear-gradient(90deg, rgba(255, 150, 0, 0.45), #f86a1a, #eb1e1e); }

    .veritai-details-box .vr-face { padding: 8px 0; }
    .veritai-details-box .vr-face + .vr-face { border-top: 1px solid var(--vr-border); }
    .veritai-details-box .vr-face-head { display: flex; align-items: center; gap: 10px; font-variant-numeric: tabular-nums; }
    .veritai-details-box .vr-face-name { width: 44px; flex-shrink: 0; font-weight: 600; }
    .veritai-details-box .vr-face-head .vr-track { flex: 1; height: 5px; }
    .veritai-details-box .vr-face-prob { width: 40px; text-align: right; font-weight: 600; }
    .veritai-details-box .vr-face-info { margin: 3px 0 0 54px; font-size: 11.5px; color: var(--vr-muted); }
    .veritai-details-box .veritai-face-toggle { margin-top: 6px; text-align: center; font-size: 12px; color: var(--vr-sub); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; padding: 2px 0; }
    .veritai-details-box .vr-empty { color: var(--vr-sub); font-size: 12px; }

    .veritai-details-box .vr-actions { display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; }
    .veritai-details-box .vr-actions-right { display: flex; gap: 4px; }
    .veritai-details-box .vr-request-id { font-size: 11px; color: var(--vr-muted); font-variant-numeric: tabular-nums; }
    .veritai-details-box .vr-feedback { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; width: 100%; }
    .veritai-details-box .vr-feedback textarea { width: 100%; height: 56px; resize: none; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--vr-border); background: var(--vr-surface); color: var(--vr-text); font: 13px/1.45 ${FONT}; outline: none; }
    .veritai-details-box .vr-feedback textarea:focus { border-color: var(--vr-muted); }
    .veritai-details-box .vr-feedback textarea.is-invalid { border-color: var(--vr-fake); }
    .veritai-details-box .vr-feedback-actions { display: flex; justify-content: flex-end; gap: 6px; }
    .veritai-details-box .vr-feedback-done { font-size: 12px; color: var(--vr-real); }

    #veritai-mini-hint {
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483645; box-sizing: border-box;
        display: flex; align-items: center; justify-content: center; height: 40px; min-width: 40px; padding: 0 11px;
        background: var(--vr-bg); color: var(--vr-sub); border: 1px solid var(--vr-border); border-radius: 20px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15); opacity: 0.88; cursor: default; overflow: hidden; transition: padding 0.2s ease, opacity 0.2s ease;
    }
    #veritai-mini-hint svg { width: 17px; height: 17px; flex-shrink: 0; }
    #veritai-mini-hint:hover { opacity: 1; padding: 0 15px; color: var(--vr-text); }
    .veritai-mini-text { font: 600 12px/1 ${FONT}; white-space: nowrap; max-width: 0; opacity: 0; transition: all 0.2s ease; }
    #veritai-mini-hint:hover .veritai-mini-text { max-width: 140px; opacity: 1; margin-left: 7px; }

    #veritai-dropzone-wrapper { background: var(--vr-bg); border-color: var(--vr-muted); }
    #veritai-dropzone-wrapper.is-over { border-color: var(--vr-accent); background: var(--vr-surface); }
    #veritai-dropzone-wrapper .vr-drop-inner { text-align: center; pointer-events: none; color: var(--vr-text); font: 600 13px/1.45 ${FONT}; }
    #veritai-dropzone-wrapper .vr-drop-inner svg { width: 28px; height: 28px; margin-bottom: 8px; color: var(--vr-sub); }
    #veritai-dropzone-wrapper .vr-drop-sub { margin-top: 2px; font-weight: 400; font-size: 12px; color: var(--vr-sub); }

    .veritai-standalone-modal { position: fixed; inset: 0; width: 100vw; height: 100vh; background: rgba(15, 17, 20, 0.82); z-index: 2147483647; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .veritai-standalone-modal .vr-modal-close { position: absolute; top: 18px; right: 22px; z-index: 10; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 17px; border: 1px solid var(--vr-border); background: var(--vr-bg); color: var(--vr-text); font: 600 13px/1 ${FONT}; cursor: pointer; }
    .veritai-standalone-modal .vr-modal-close svg { width: 14px; height: 14px; }

    .veritai-status-badge:focus-visible, .veritai-check-btn:focus-visible, .veritai-details-box button:focus-visible, .veritai-close-btn:focus-visible, .vr-modal-close:focus-visible { outline: 2px solid #8fb3f0 !important; outline-offset: 2px !important; }
`;

// 선 아이콘 (stroke 1.8). 이모지 대신 쓴다
const ICON_PATHS = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    check: '<path d="M5 12.5 10 17l9-10"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.2"/><path d="M12 17.2h.01"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    upload: '<path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.7 7.5 9 4.3-1.3 7.5-4.5 7.5-9V6L12 3Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
};

export function icon(name) {
    const paths = ICON_PATHS[name] || '';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export function injectCSS() {
    if (document.getElementById('veritai-style-core')) return;
    const style = document.createElement('style');
    style.id = 'veritai-style-core';
    style.textContent = VERITAI_CORE_CSS;
    document.head.appendChild(style);
}
