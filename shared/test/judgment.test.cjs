// AI 모델이 돌지 않은 결과를 '정상'으로 보여 주지 않는지, 확장/PWA/앱의 판별 기준이 같은지 확인한다
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..', '..');

function compile(entry, options = {}) {
    const out = esbuild.buildSync({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, ...options });
    const mod = new Module(entry, module);
    mod.paths = module.paths;
    mod._compile(out.outputFiles[0].text, entry);
    return mod.exports;
}

const shared = compile(path.join(root, 'shared', 'judgment.js'));
const mobile = compile(path.join(root, 'mobile', 'src', 'judgment.js'));
const heatmap = compile(path.join(root, 'shared', 'heatmap.js'));

const asyncStorageMock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veritai-')), 'async-storage.js');
fs.writeFileSync(asyncStorageMock, 'module.exports = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };');
const mobileApi = compile(path.join(root, 'mobile', 'src', 'api.js'), {
    alias: { '@react-native-async-storage/async-storage': asyncStorageMock },
    define: { __DEV__: 'false' },
});

const unloaded = { isDeepfake: false, confidence: 0, cnn: { modelLoaded: false, error: 'cnn import failed: DLL load failed' } };
const loaded = { isDeepfake: true, confidence: 0.9, cnn: { modelLoaded: true, views: [] } };
const oldResponse = { isDeepfake: false, confidence: 0.1 }; 

test('모델이 안 돈 결과만 판정 실패로 본다 (웹과 앱이 같은 기준)', () => {
    for (const lib of [shared, mobile]) {
        assert.equal(lib.isAiUnavailable(unloaded), true);
        assert.equal(lib.isAiUnavailable(loaded), false);
        assert.equal(lib.isAiUnavailable(oldResponse), false);
        assert.equal(lib.isAiUnavailable(null), false);
        assert.equal(lib.aiUnavailableDetail(unloaded), 'cnn import failed: DLL load failed');
        assert.equal(lib.AI_UNAVAILABLE_MESSAGE, shared.AI_UNAVAILABLE_MESSAGE);
        assert.equal(lib.NO_SCORE_TEXT, shared.NO_SCORE_TEXT);
    }
});

test('앱: 모델이 안 돈 결과는 오류로 바꾸고, 정상 결과는 그대로 둔다', () => {
    const data = { requestId: 1, status: 'DONE', result: loaded };
    assert.equal(mobileApi.ensureAiResult(data), data);
    assert.throws(() => mobileApi.ensureAiResult({ requestId: 2, status: 'DONE', result: unloaded }), err => {
        assert.equal(err.code, mobile.AI_UNAVAILABLE_CODE);
        assert.equal(mobileApi.toFriendlyMessage(err), mobile.AI_UNAVAILABLE_MESSAGE);
        assert.match(mobileApi.toErrorDetail(err), /DLL load failed/);
        return true;
    });
});

test('히트맵 안내 문구는 확률과 진하기 비교 주의를 함께 알린다', () => {
    const strong = heatmap.getHeatmapNoteText('얼굴 1', 0.82);
    assert.match(strong, /82\.0%/);
    assert.match(strong, /사진끼리 비교하는 값이 아닙니다/);
    assert.match(heatmap.getHeatmapNoteText('얼굴 1', 0.1), /참고용/);
    assert.match(heatmap.getHeatmapNoteText('사진 전체', 0.001), /표시할 색이 없습니다/);
});

test('판정 기준값과 판정 이유 문구가 웹과 앱에서 같다', () => {
    for (const key of ['FACE_FAKE_MIN', 'FACE_CAUTION_MIN', 'FACE_DETECTION_MIN']) assert.equal(mobile[key], shared[key], key);
    const cases = [
        { decisionReason: 'high_single_face_probability', maxProbability: 0.91, averageProbability: 0.5 },
        { decisionReason: 'high_average_face_probability', maxProbability: 0.7, averageProbability: 0.62 },
        { decisionReason: 'below_combined_thresholds', maxProbability: 0.66, averageProbability: 0.3 },
        { decisionReason: 'below_combined_thresholds', maxProbability: 0.2, averageProbability: 0.1 },
        { decisionReason: 'full_image_fallback', analysisScope: 'full_fallback' },
        { cnn: { decisionReason: 'high_single_face_probability', maxProbability: 0.85 } },
        {},
    ];
    for (const result of cases) assert.equal(mobile.getDecisionReasonText(result), shared.getDecisionReasonText(result), JSON.stringify(result));
    for (const conf of [0, 0.29, 0.3, 0.8]) for (const fake of [true, false]) assert.equal(mobile.getVerdictDescription(fake, conf), shared.getVerdictDescription(fake, conf));
    for (const n of [0, 1, 3]) assert.equal(mobile.getFaceCountText(n), shared.getFaceCountText(n));
});

test('서버 상태 문구', () => {
    const api = compile(path.join(root, 'shared', 'api.js'));
    assert.deepEqual(api.describeServerStatus(null), { level: 'error', text: '분석 서버에 연결할 수 없습니다' });
    assert.equal(api.describeServerStatus({ running: false }).level, 'warn');
    assert.equal(api.describeServerStatus({ running: true, queuedCount: 0 }, true).text, '서버 연결됨 · 최근 AI 판정 실패');
    assert.equal(api.describeServerStatus({ running: true, queuedCount: 0 }).text, '분석 서버 연결됨');
    assert.equal(api.describeServerStatus({ running: true, queuedCount: 3 }).text, '분석 서버 연결됨 · 대기 3건');
    assert.equal(api.apiUrls('http://x:8080/').queue, 'http://x:8080/api/detections/queue');
});

test('사진 압축 기준이 확장, 작업 창, PWA, 앱에서 같다', () => {
    const api = compile(path.join(root, 'shared', 'api.js'));
    assert.equal(api.UPLOAD_MAX_SIDE, 1280);
    assert.equal(api.UPLOAD_IMAGE_TYPE, 'image/jpeg');
    for (const key of ['UPLOAD_MAX_SIDE', 'UPLOAD_IMAGE_TYPE', 'UPLOAD_IMAGE_QUALITY']) assert.equal(mobileApi[key], api[key], key);
    // worker.js는 빌드 때 그대로 복사되는 파일이라 shared를 가져오지 못해 값을 글자로 비교한다
    const worker = fs.readFileSync(path.join(root, 'frontend', 'worker.js'), 'utf8');
    assert.match(worker, new RegExp(`MAX_UPLOAD_SIZE = ${api.UPLOAD_MAX_SIDE};`));
    assert.match(worker, new RegExp(`UPLOAD_TYPE = '${api.UPLOAD_IMAGE_TYPE}';`));
    assert.match(worker, new RegExp(`UPLOAD_QUALITY = ${api.UPLOAD_IMAGE_QUALITY};`));
});

test('결과 조회 다시 시도 기준이 웹과 앱에서 같다', () => {
    const api = compile(path.join(root, 'shared', 'api.js'));
    assert.equal(mobileApi.POLL_MAX_RETRIES, api.POLL_MAX_RETRIES);
    const retryable = [0, 200, 408, 429, 500, 503];
    const fatal = [400, 401, 403, 404, 415];
    for (const lib of [api, mobileApi]) {
        for (const status of retryable) assert.equal(lib.isRetryablePollStatus(status), true, `${status}`);
        for (const status of fatal) assert.equal(lib.isRetryablePollStatus(status), false, `${status}`);
        assert.equal(lib.isRetryablePollStatus(undefined), true);
    }
});

test('결과 형식 확인: 비었거나 이상한 결과는 판정으로 쓰지 않는다 (웹과 앱 같음)', () => {
    for (const lib of [shared, mobile]) {
        assert.equal(lib.isValidResult({ isDeepfake: true, confidence: 0.82 }), true);
        assert.equal(lib.isValidResult({ deepfake: false, confidence: '0.1' }), true);
        assert.equal(lib.isValidResult({}), false);
        assert.equal(lib.isValidResult(null), false);
        assert.equal(lib.isValidResult({ isDeepfake: false }), false);
        assert.equal(lib.isValidResult({ isDeepfake: false, confidence: null }), false);
        assert.equal(lib.isValidResult({ isDeepfake: false, confidence: 'abc' }), false);
        assert.equal(lib.isValidResult({ isDeepfake: 'maybe', confidence: 0.3 }), false);
        assert.equal(lib.readDeepfakeFlag({ isDeepfake: 'false' }), false);
        assert.equal(lib.readDeepfakeFlag({ isDeepfake: 'true' }), true);
        assert.equal(lib.readDeepfakeFlag({}), false);
    }
});

test('확률 표시: 기준 바로 아래 값이 기준값으로 보이지 않고, 범위를 벗어나지 않는다 (웹과 앱 같음)', () => {
    const cases = [
        [0.4996, 1, '49.9%'], [0.5, 1, '50.0%'], [0.82, 1, '82.0%'], [0.797, 0, '79%'], [0.8, 0, '80%'],
        [0.29, 0, '29%'], [0.57, 0, '57%'], [0.999999, 1, '99.9%'], [1, 1, '100.0%'],
        [1.7, 0, '100%'], [-0.3, 0, '0%'], ['abc', 1, '0.0%'], [null, 0, '0%'],
    ];
    for (const lib of [shared, mobile]) {
        for (const [value, digits, expected] of cases) assert.equal(lib.formatPercent(value, digits), expected, `${value}`);
        assert.equal(lib.percentWidth(1.7), '100%');
        assert.equal(lib.getConfidence({ confidence: -1 }), 0);
    }
    for (let i = 0; i <= 100; i += 1) assert.equal(shared.formatPercent(i / 100, 0), `${i}%`, `${i}/100`);
});

test('판정 이유 문구가 경계값에서 모순되지 않는다', () => {
    const edge = { decisionReason: 'below_combined_thresholds', maxProbability: 0.797, averageProbability: 0.4996 };
    for (const lib of [shared, mobile]) {
        assert.equal(lib.getDecisionReasonText(edge), '한 얼굴이 79%로 나왔지만 단독 기준(80%)보다 낮고, 얼굴 평균도 49%라 정상으로 판정했습니다.');
    }
});
