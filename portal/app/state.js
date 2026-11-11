export const $ = (id) => document.getElementById(id);

export const state = {
    image: null,
    video: null,        // 영상을 골랐을 때 { element, url, duration }. 사진이면 null
    frameBusy: false,
    data: null,
    baseImg: null,
    heatmapImg: null,
    heatmapMode: false,
    heatmapView: null,
    showAllFaces: false,
    busy: false,
};

export const IS_EMBED_REPORT = new URLSearchParams(location.search).get('embed') === 'report';
