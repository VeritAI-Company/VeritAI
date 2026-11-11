// PWA 영상 도우미(portal/video.js)의 순수 함수: 영상 판별, 시간 표시, 장면 지점 보정
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');
const esbuild = require('esbuild');

const entry = path.resolve(__dirname, '..', '..', 'portal', 'video.js');
const out = esbuild.buildSync({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false });
const mod = new Module(entry, module);
mod.paths = module.paths;
mod._compile(out.outputFiles[0].text, entry);
const { isVideoFile, formatTime, clampFrameTime } = mod.exports;

test('영상 판별: 형식이 있으면 형식으로, 비어 있으면 확장자로 판단한다', () => {
    assert.equal(isVideoFile({ type: 'video/mp4', name: 'a.mp4' }), true);
    assert.equal(isVideoFile({ type: 'video/quicktime', name: 'a' }), true);
    assert.equal(isVideoFile({ type: '', name: 'clip.MOV' }), true);
    assert.equal(isVideoFile({ type: '', name: 'clip.mkv' }), true);
    assert.equal(isVideoFile({ type: '', name: 'notes.txt' }), false);
    assert.equal(isVideoFile({ type: '', name: '' }), false);
    assert.equal(isVideoFile({ type: 'image/png', name: 'fake.mov' }), false);
    assert.equal(isVideoFile(null), false);
    assert.equal(isVideoFile(undefined), false);
});

test('시간 표시는 초를 버리고 분:초로 보여 준다', () => {
    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(3.9), '0:03');
    assert.equal(formatTime(61), '1:01');
    assert.equal(formatTime(-5), '0:00');
    assert.equal(formatTime('abc'), '0:00');
});

test('장면 지점은 0 이상, 영상 끝 바로 앞까지로 보정한다', () => {
    assert.equal(clampFrameTime(-3, 4), 0);
    assert.equal(clampFrameTime(2, 4), 2);
    assert.ok(Math.abs(clampFrameTime(10, 4) - 3.9) < 1e-9);
    assert.equal(clampFrameTime(0, 0.05), 0);
    assert.equal(clampFrameTime(7, null), 7); // 길이를 모르면 위쪽 제한이 없다
    assert.equal(clampFrameTime(7, Infinity), 7);
    assert.equal(clampFrameTime('abc', 4), 0);
});
