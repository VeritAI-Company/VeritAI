// 앱의 장면 고르기 막대 계산(mobile/src/sliderMath.js): 위치와 시각 변환, 영상 길이 읽기
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');
const esbuild = require('esbuild');

const entry = path.resolve(__dirname, '..', '..', 'mobile', 'src', 'sliderMath.js');
const out = esbuild.buildSync({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false });
const mod = new Module(entry, module);
mod.paths = module.paths;
mod._compile(out.outputFiles[0].text, entry);
const { clamp01, ratioFromX, ratioFromTime, timeFromRatio, parseDurationMs } = mod.exports;

test('막대 위치는 0~1로 자르고, 길이를 모르면 0이다', () => {
    assert.equal(clamp01(-0.5), 0);
    assert.equal(clamp01(1.7), 1);
    assert.equal(clamp01(0.25), 0.25);
    assert.equal(clamp01('abc'), 0);
    assert.equal(ratioFromX(150, 300), 0.5);
    assert.equal(ratioFromX(-20, 300), 0);   // 막대 왼쪽 밖을 눌러도 처음
    assert.equal(ratioFromX(999, 300), 1);   // 오른쪽 밖을 눌러도 끝
    assert.equal(ratioFromX(10, 0), 0);      // 아직 폭을 모를 때
});

test('위치와 시각을 서로 바꾼다', () => {
    assert.equal(timeFromRatio(0.5, 42000), 21000);
    assert.equal(timeFromRatio(0, 42000), 0);
    assert.equal(timeFromRatio(1, 42000), 42000);
    assert.equal(timeFromRatio(2, 42000), 42000);
    assert.equal(timeFromRatio(0.5, 0), 0);
    assert.equal(ratioFromTime(21000, 42000), 0.5);
    assert.equal(ratioFromTime(99999, 42000), 1);
    assert.equal(ratioFromTime(1000, null), 0);
    // 왕복해도 1ms 안쪽으로 같다
    for (const ms of [0, 1234, 20000, 41999]) assert.ok(Math.abs(timeFromRatio(ratioFromTime(ms, 42000), 42000) - ms) <= 1, `${ms}`);
});

test('영상 길이는 숫자와 문자열 모두 읽고, 알 수 없으면 null이다', () => {
    assert.equal(parseDurationMs(42000), 42000);
    assert.equal(parseDurationMs('42000'), 42000); // 공유받은 영상은 문자열로 올 수 있다
    assert.equal(parseDurationMs(0), null);
    assert.equal(parseDurationMs('0'), null);
    assert.equal(parseDurationMs(null), null);
    assert.equal(parseDurationMs(undefined), null);
    assert.equal(parseDurationMs('abc'), null);
    assert.equal(parseDurationMs(-5), null);
});
