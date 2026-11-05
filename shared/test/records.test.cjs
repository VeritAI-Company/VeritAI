// PWA(portal/records.js)와 앱(mobile/src/records.js)의 내 검사 기록 지우기가 확장과 같은 방식으로 동작하는지 확인한다
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..', '..');

function fakeServer({ known = new Set(), pending = new Set() } = {}) {
    const calls = [];
    const fetch = async (url, options = {}) => {
        const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
        if (options.method !== 'DELETE') return json(500, {});
        calls.push({ url, token: options.headers['X-VeritAI-Owner-Token'] });
        const single = /\/api\/detections\/(\d+)$/.exec(url);
        const ids = single ? [Number(single[1])] : JSON.parse(options.body).requestIds;
        if (ids.length > 100) return json(400, {});
        if (ids.some(id => !known.has(id))) return json(404, {});
        if (ids.some(id => pending.has(id))) return json(409, {});
        ids.forEach(id => known.delete(id));
        return json(200, { deletedRequestCount: ids.length });
    };
    return { fetch, calls };
}

function compile(entry, alias) {
    const out = esbuild.buildSync({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, alias });
    const mod = new Module(entry, module);
    mod.paths = module.paths;
    mod._compile(out.outputFiles[0].text, entry);
    return mod.exports;
}

function loadPortal() {
    const store = {};
    global.localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
    };
    return { api: compile(path.join(root, 'portal', 'records.js')), store };
}

const asyncStorageMock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veritai-')), 'async-storage.js');
fs.writeFileSync(asyncStorageMock, `module.exports = {
    getItem: async k => (k in global.__asyncStore ? global.__asyncStore[k] : null),
    setItem: async (k, v) => { global.__asyncStore[k] = String(v); },
    removeItem: async k => { delete global.__asyncStore[k]; } };`);

function loadMobile() {
    const store = {};
    global.__asyncStore = store;
    return { api: compile(path.join(root, 'mobile', 'src', 'records.js'), { '@react-native-async-storage/async-storage': asyncStorageMock }), store };
}

test('PWA: 토큰은 서버 규칙에 맞고 한 번 만들면 계속 같다', () => {
    const { api } = loadPortal();
    const token = api.getOwnerToken();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(api.getOwnerToken(), token);
});

test('PWA: 기록을 지우면 처리 중인 번호만 남는다', async () => {
    const { api } = loadPortal();
    [1, 2, 3, 3].forEach(api.rememberRequestId);
    assert.deepEqual(api.getStoredRequestIds(), [1, 2, 3]);
    const server = fakeServer({ known: new Set([1, 3]), pending: new Set([3]) }); // 2번은 서버 재시작으로 없어짐
    global.fetch = server.fetch;
    const r = await api.clearMyRecords('http://server/api/detections');
    assert.deepEqual(r.handledIds.sort(), [1, 2]);
    assert.deepEqual(r.pendingIds, [3]);
    assert.deepEqual(api.getStoredRequestIds(), [3]);
    assert.ok(server.calls.every(c => c.token === api.getOwnerToken()));
});

test('PWA: 서버에 연결하지 못하면 저장된 번호를 지우지 않는다', async () => {
    const { api } = loadPortal();
    api.rememberRequestId(5);
    global.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(api.clearMyRecords('http://server/api/detections'));
    assert.deepEqual(api.getStoredRequestIds(), [5]);
});

test('앱: 동시에 저장해도 번호가 빠지지 않고, 지우면 처리 중인 번호만 남는다', async () => {
    const { api } = loadMobile();
    const [t1, t2] = await Promise.all([api.getOwnerToken(), api.getOwnerToken()]);
    assert.equal(t1, t2);
    assert.match(t1, /^[0-9a-f]{64}$/);
    await Promise.all(Array.from({ length: 150 }, (_, i) => api.rememberRequestId(i + 1)));
    assert.equal((await api.getStoredRequestIds()).length, 150);
    const known = new Set(Array.from({ length: 150 }, (_, i) => i + 1));
    known.delete(7);
    const server = fakeServer({ known, pending: new Set([42]) });
    global.fetch = server.fetch;
    const r = await api.clearMyRecords();
    assert.deepEqual(r.pendingIds, [42]);
    assert.equal(r.handledIds.length, 149);
    assert.deepEqual(await api.getStoredRequestIds(), [42]);
});

test('앱: 서버에 연결하지 못하면 status 0 오류를 내고 번호는 남긴다', async () => {
    const { api } = loadMobile();
    await api.rememberRequestId(9);
    global.fetch = async () => { throw new TypeError('Network request failed'); };
    await assert.rejects(api.clearMyRecords(), err => err.status === 0);
    assert.deepEqual(await api.getStoredRequestIds(), [9]);
});
