export const VERITAI_CORE_CSS = `
    @keyframes veritai-fade-in-up {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    
    @keyframes veritai-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    .veritai-spinner {
        width: 12px; 
        height: 12px; 
        border: 2px solid #ffffff; 
        border-top-color: transparent; 
        border-radius: 50%; 
        animation: veritai-spin 0.8s linear infinite !important;
        display: inline-block;
        box-sizing: border-box;
    }

    .veritai-ui-container { position: absolute; top: 6px; left: 6px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-start; pointer-events: none; }
    .veritai-status-badge { padding: 4px 8px; border-radius: 4px; color: white; font-size: 11px; font-weight: bold; font-family: sans-serif; box-shadow: 0 2px 4px rgba(0,0,0,0.5); transition: all 0.2s ease; user-select: none; cursor: default; pointer-events: auto !important; box-sizing: border-box !important; line-height: normal !important; }
    .veritai-check-btn { position: absolute; top: 8px; left: 8px; z-index: 2147483647; padding: 4px 10px; background-color: rgba(59, 130, 246, 0.9); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 11px; backdrop-filter: blur(4px); transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.2); pointer-events: auto !important; box-sizing: border-box !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important; line-height: normal !important; }
    .veritai-check-btn:hover { background-color: rgba(37, 99, 235, 1); transform: scale(1.05); }
    .veritai-details-box { position: absolute; top: 0px; left: 0px; will-change: transform; z-index: 2147483647; background: rgba(30, 41, 59, 0.95); backdrop-filter: blur(12px); color: #F8FAFC; padding: 16px; border-radius: 12px; font-size: 12px; white-space: normal; line-height: 1.6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; width: 280px; max-height: 400px; overflow-y: auto; text-align: left; cursor: default; pointer-events: auto; transition: box-shadow 0.3s ease; box-sizing: border-box; margin: 0; letter-spacing: normal; animation: veritai-fade-in-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .veritai-details-box.fake-border { border: 1px solid rgba(239, 68, 68, 0.5); }
    .veritai-details-box.real-border { border: 1px solid rgba(16, 185, 129, 0.5); }
    .veritai-details-box.unpinned { box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); }
    .veritai-details-box::-webkit-scrollbar { width: 6px; }
    .veritai-details-box::-webkit-scrollbar-track { background: transparent; }
    .veritai-details-box::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.4); border-radius: 4px; }
    .veritai-details-box::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.7); }
    #veritai-mini-hint { position: fixed; bottom: 24px; right: 24px; height: 44px; min-width: 44px; padding: 0 13px; box-sizing: border-box; background: rgba(30, 41, 59, 0.4); backdrop-filter: blur(6px); border-radius: 22px; display: flex; align-items: center; justify-content: center; color: white; cursor: default; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); z-index: 2147483645; overflow: hidden; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    #veritai-mini-hint:hover { background: rgba(59, 130, 246, 0.95); padding: 0 20px; box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4); }
    .veritai-mini-text { font-size: 13px; font-weight: bold; white-space: nowrap; max-width: 0; opacity: 0; transition: all 0.3s ease; font-family: sans-serif; letter-spacing: -0.3px; }
    #veritai-mini-hint:hover .veritai-mini-text { max-width: 150px; opacity: 1; margin-left: 8px; }
    .veritai-standalone-modal { position: fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index: 2147483647; display: flex; flex-direction: column; align-items:center; justify-content:center; backdrop-filter:blur(5px); }
    .veritai-status-badge:focus-visible, .veritai-check-btn:focus-visible, .veritai-close-btn:focus-visible { outline: 2px solid #60a5fa !important; outline-offset: 2px !important; }
`;

export function injectCSS() {
    if (document.getElementById('veritai-style-core')) return;
    const style = document.createElement('style');
    style.id = 'veritai-style-core';
    style.textContent = VERITAI_CORE_CSS;
    document.head.appendChild(style);
}