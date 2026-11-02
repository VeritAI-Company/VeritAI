// 화면 요소 찾기와 PWA 공용 상태

export const $ = (id) => document.getElementById(id);

export const state = {
    image: null,
    data: null,
    baseImg: null,
    heatmapImg: null,
    heatmapMode: false,
    heatmapView: null,
    showAllFaces: false,
    busy: false,
};

export const IS_EMBED_REPORT = new URLSearchParams(location.search).get('embed') === 'report';
