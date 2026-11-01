const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');
const esbuild = require('esbuild');

const entryPoint = path.resolve(__dirname, '..', 'core', 'cache-clear.js');
const build = esbuild.buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
});
const compiled = new Module(entryPoint, module);
compiled.filename = entryPoint;
compiled.paths = module.paths;
compiled._compile(build.outputFiles[0].text, entryPoint);

const { cacheDeletionErrorMessage, clearDetectionCacheFlow } = compiled.exports;

test('backend success clears persistent IDs, memory, UI, and statistics in order', async () => {
    const calls = [];
    const deletion = await clearDetectionCacheFlow({
        getStoredRequestIds: async () => {
            calls.push('get-ids');
            return [1, 2];
        },
        deleteRecords: async ids => {
            calls.push(`delete:${ids.join(',')}`);
            return { deletedRequestCount: 2 };
        },
        clearStoredRequestIds: async () => calls.push('clear-ids'),
        clearMemoryCache: () => calls.push('clear-memory'),
        clearUi: () => calls.push('clear-ui'),
        resetStatistics: async () => calls.push('reset-statistics'),
        reattachUi: () => calls.push('reattach-ui'),
    });

    assert.deepEqual(deletion, { deletedRequestCount: 2 });
    assert.deepEqual(calls, [
        'get-ids',
        'delete:1,2',
        'clear-ids',
        'clear-memory',
        'clear-ui',
        'reset-statistics',
        'reattach-ui',
    ]);
});

test('backend failure preserves every local cache and UI state', async () => {
    const calls = [];
    const conflict = Object.assign(new Error('processing'), { status: 409 });

    await assert.rejects(
        clearDetectionCacheFlow({
            getStoredRequestIds: async () => {
                calls.push('get-ids');
                return [7];
            },
            deleteRecords: async () => {
                calls.push('delete');
                throw conflict;
            },
            clearStoredRequestIds: async () => calls.push('clear-ids'),
            clearMemoryCache: () => calls.push('clear-memory'),
            clearUi: () => calls.push('clear-ui'),
            resetStatistics: async () => calls.push('reset-statistics'),
            reattachUi: () => calls.push('reattach-ui'),
        }),
        conflict,
    );

    assert.deepEqual(calls, ['get-ids', 'delete']);
});

test('403, 409, and network failures have distinct user-facing messages', () => {
    assert.equal(
        cacheDeletionErrorMessage({ status: 403 }),
        '검사 기록 삭제 권한을 확인할 수 없습니다.',
    );
    assert.equal(
        cacheDeletionErrorMessage({ status: 409 }),
        '처리 중인 검사가 있어 기록을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    );
    assert.equal(
        cacheDeletionErrorMessage(new Error('network')),
        '검사 기록을 삭제하지 못했습니다.',
    );
});
