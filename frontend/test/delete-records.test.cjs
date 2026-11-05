// 캐시 비우기의 서버 기록 삭제가 서버 재시작, 처리 중, 100개 초과 상황에서도 멈추지 않는지 확인한다
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');
const esbuild = require('esbuild');

const entryPoint = path.resolve(__dirname, '..', 'core', 'network.js');
const build = esbuild.buildSync({
    entryPoints: [entryPoint], bundle: true, format: 'cjs', platform: 'node', write: false,
    define: { __VERITAI_API_BASE__: '"http://server"' },
});

function load({ known = new Set(), pending = new Set(), notOwned = new Set(), maxIds = 100 } = {}) {
    const storage = {};
    const calls = [];
    global.chrome = { storage: { local: {
        get: async keys => Object.fromEntries(keys.filter(k => k in storage).map(k => [k, storage[k]])),
        set: async obj => Object.assign(storage, obj),
        remove: async key => { delete storage[key]; },
    } } };
    global.window = { location: { href: 'http://page' } };
    global.fetch = async (url, options = {}) => {
        const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
        if (options.method !== 'DELETE') return json(500, {});
        const single = /\/api\/detections\/(\d+)$/.exec(url);
        const ids = single ? [Number(single[1])] : JSON.parse(options.body).requestIds;
        calls.push(single ? `one:${ids[0]}` : `batch:${ids.length}`);
        if (ids.length > maxIds) return json(400, { message: 'too many' });
        if (ids.some(id => !known.has(id))) return json(404, {});
        if (ids.some(id => notOwned.has(id))) return json(403, {});
        if (ids.some(id => pending.has(id))) return json(409, {});
        ids.forEach(id => known.delete(id));
        return json(200, { deletedRequestCount: ids.length });
    };
    const mod = new Module(entryPoint, module);
    mod.paths = module.paths;
    mod._compile(build.outputFiles[0].text, entryPoint);
    return { api: mod.exports, calls, storage, known };
}

test('모두 서버에 있으면 한 번에 지운다', async () => {
    const { api, calls } = load({ known: new Set([1, 2, 3]) });
    const r = await api.deleteDetectionRecords([1, 2, 3]);
    assert.equal(r.deletedRequestCount, 3);
    assert.deepEqual(r.handledIds, [1, 2, 3]);
    assert.deepEqual(calls, ['batch:3']);
});

test('서버 재시작으로 없어진 번호는 이미 삭제된 것으로 보고 나머지는 지운다', async () => {
    const { api } = load({ known: new Set([2]) });
    const r = await api.deleteDetectionRecords([1, 2, 3]);
    assert.equal(r.deletedRequestCount, 1);
    assert.equal(r.alreadyMissingCount, 2);
    assert.deepEqual(r.handledIds.sort(), [1, 2, 3]);
    assert.deepEqual(r.pendingIds, []);
});

test('처리 중인 번호는 남기고 끝난 번호만 지운다', async () => {
    const { api } = load({ known: new Set([1, 2]), pending: new Set([2]) });
    const r = await api.deleteDetectionRecords([1, 2]);
    assert.equal(r.deletedRequestCount, 1);
    assert.deepEqual(r.pendingIds, [2]);
    assert.deepEqual(r.handledIds, [1]);
});

test('100개가 넘으면 나눠서 보낸다', async () => {
    const ids = Array.from({ length: 230 }, (_, i) => i + 1);
    const { api, calls } = load({ known: new Set(ids) });
    const r = await api.deleteDetectionRecords(ids);
    assert.equal(r.deletedRequestCount, 230);
    assert.deepEqual(calls, ['batch:100', 'batch:100', 'batch:30']);
});

test('저장 목록에서는 정리한 번호만 지우고 처리 중인 번호는 남긴다', async () => {
    const { api, storage } = load();
    storage.veritai_detection_request_ids = [1, 2, 3];
    await api.clearStoredDetectionRequestIds([1, 3]);
    assert.deepEqual(storage.veritai_detection_request_ids, [2]);
});
