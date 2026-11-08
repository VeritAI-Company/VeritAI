// 브라우저 테스트용 가짜 분석 서버(8080)와 테스트 페이지 서버(8000)
// 시나리오는 테스트가 GET /__set?mode=이름&delay=ms 로 바꾼다. 실제 백엔드 응답 형식을 흉내 낸다
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const XSS = '<img src=x onerror="window.__xss=1">';

function grid(n, peakRow = 5, peakCol = 6) {
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) =>
        Math.round(Math.max(0, 1 - Math.hypot(r - peakRow, c - peakCol) / 8) * 1000) / 1000));
}

function face(x, y, w, h, prob = 0.6, extra = {}) {
    const f = { bbox: { x, y, w, h }, detectionConfidence: 0.9, ...extra };
    if (prob != null) f.cnn = { fakeProbability: prob };
    return f;
}

const BOX = { x: 20, y: 10, w: 120, h: 140 };
function base(prob = 0.82) {
    return {
        isDeepfake: prob >= 0.5, confidence: prob, faceCount: 1, faces: [face(20, 10, 120, 140, prob)],
        decisionReason: prob >= 0.8 ? 'high_single_face_probability' : prob >= 0.5 ? 'high_average_face_probability' : 'below_combined_thresholds',
        maxProbability: prob, averageProbability: prob,
        cnn: { modelLoaded: true, winningView: 'face_1', views: [{ name: 'face_1', fakeProbability: prob, bbox: BOX, cam: grid(14) }] },
    };
}

const SCENARIOS = {
    fake: () => base(0.82),
    real: () => base(0.12),
    ai_unavailable: () => ({ ...base(0), isDeepfake: false, confidence: 0, cnn: { modelLoaded: false, error: 'cnn import failed: DLL load failed', views: [] } }),
    empty_result: () => ({}),
    string_flag: () => ({ ...base(0.12), isDeepfake: 'false' }),
    bad_confidence: () => ({ ...base(0.82), confidence: 'abc' }),
    out_of_range: () => ({ ...base(0.12), faces: [face(20, 10, 120, 140, 1.7), face(150, 10, 60, 60, -0.3)] }),
    boundary: () => ({
        ...base(0.4996), isDeepfake: false, decisionReason: 'below_combined_thresholds', maxProbability: 0.797, averageProbability: 0.4996,
        faces: [face(20, 10, 120, 140, 0.797), face(180, 40, 80, 80, 0.2024)],
    }),
    xss: () => ({ ...base(0.82), decisionReason: XSS, modelVersion: XSS, faces: [face(20, 10, 120, 140, 0.82, { faceMode: XSS, quality: { label: XSS } })] }),
    bad_bbox: () => ({
        ...base(0.82), faceCount: 5,
        faces: [{ bbox: null, detectionConfidence: 0.9, cnn: { fakeProbability: 0.7 } }, { detectionConfidence: 0.9 }, face(-50, -40, 100, 100, 0.4), face(380, 280, 500, 500, 0.6), face(10, 10, 0, 0, 0.9)],
    }),
    bad_cam: () => ({
        ...base(0.82),
        cnn: { modelLoaded: true, winningView: 'face_9', views: [
            { name: 'face_1', fakeProbability: 0.82, bbox: BOX, cam: [[null, 'a'], [0, 1]] },
            { name: 'full', fakeProbability: 0.3, cam: [] },
        ] },
    }),
};

const state = { mode: 'fake', delay: 0, posts: 0, deletes: 0, nextId: 1, known: new Set(), pending: new Set(), queueRunning: true, down: false };

function send(res, code, body, raw) {
    res.writeHead(code, {
        'Content-Type': raw ? 'text/html' : 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    });
    res.end(raw ?? JSON.stringify(body));
}

function readBody(req) {
    return new Promise(resolve => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => resolve(data));
    });
}

const api = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') return send(res, 204, {});

    if (url.pathname === '/__set') {
        for (const [k, v] of url.searchParams) {
            if (k === 'mode') state.mode = v;
            if (k === 'delay') state.delay = Number(v);
            if (k === 'running') state.queueRunning = v === 'true';
            if (k === 'down') state.down = v === 'true';
        }
        return send(res, 200, state.mode);
    }
    if (url.pathname === '/__restart') { state.known.clear(); state.pending.clear(); return send(res, 200, {}); }
    if (url.pathname === '/__stats') return send(res, 200, { posts: state.posts, deletes: state.deletes, known: [...state.known] });
    if (state.down) { req.socket.destroy(); return; }

    if (req.method === 'GET' && url.pathname === '/api/detections/queue') {
        return send(res, 200, { running: state.queueRunning, queuedCount: 0 });
    }

    if (req.method === 'POST' && url.pathname === '/api/detections') {
        await readBody(req);
        state.posts += 1;
        if (state.delay) await new Promise(r => setTimeout(r, state.delay));
        const id = state.nextId++;
        state.known.add(id);
        if (state.mode === 'http500') return send(res, 500, { message: XSS });
        if (state.mode === 'http429') return send(res, 429, { message: 'queue full' });
        if (state.mode === 'bad_json') return send(res, 200, null, '<html>oops</html>');
        const make = SCENARIOS[state.mode] || SCENARIOS.fake;
        return send(res, 200, { status: 'DONE', requestId: id, result: make() });
    }

    if (req.method === 'POST' && url.pathname === '/api/feedback') { await readBody(req); return send(res, 200, {}); }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/detections')) {
        const body = await readBody(req);
        state.deletes += 1;
        const single = /\/api\/detections\/(\d+)$/.exec(url.pathname);
        const ids = single ? [Number(single[1])] : (JSON.parse(body || '{}').requestIds || []);
        if (ids.length > 100) return send(res, 400, { message: 'too many' });
        if (ids.some(id => !state.known.has(id))) return send(res, 404, { message: 'not found' });
        if (ids.some(id => state.pending.has(id))) return send(res, 409, { message: 'pending' });
        ids.forEach(id => state.known.delete(id));
        return send(res, 200, { deletedRequestCount: ids.length });
    }
    return send(res, 404, {});
});

function startServers(staticDir) {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
    const pages = http.createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        // 디시인사이드처럼 Referer가 이 사이트가 아니면 막는 사진 (외부 링크 차단)
        if (pathname.startsWith('/protected/') && !(req.headers.referer || '').startsWith('http://localhost:8000')) {
            res.writeHead(403, { 'Content-Type': 'text/html' });
            return res.end('<html>403 Forbidden</html>');
        }
        const file = path.join(staticDir, pathname);
        if (!file.startsWith(staticDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return Promise.all([
        new Promise(r => api.listen(8080, '127.0.0.1', r)),
        new Promise(r => pages.listen(8000, '127.0.0.1', r)),
    ]).then(() => ({ close: () => { api.close(); pages.close(); } }));
}

module.exports = { startServers, state };
