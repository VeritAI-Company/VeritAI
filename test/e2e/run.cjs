// 프론트 브라우저 테스트 (확장 + PWA). 가짜 서버로 정상, 오류, 이상한 응답, 경계값, 성능을 확인한다
// 실행: npm run test:e2e   (처음 한 번: npm i -D playwright && npx playwright install chromium)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let chromium;
try {
    ({ chromium } = require('playwright'));
} catch {
    console.error('playwright가 없습니다. 처음 한 번 실행하세요: npm i -D playwright && npx playwright install chromium');
    process.exit(2);
}
const { build } = require('./build.cjs');
const { startServers } = require('./mock-server.cjs');

const API = 'http://127.0.0.1:8080';
const PAGE = 'http://localhost:8000';
const only = process.argv.slice(2);
const results = [];
const wait = ms => new Promise(r => setTimeout(r, ms));

function check(name, ok, detail = '') {
    results.push({ name, ok: Boolean(ok), detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const setMock = query => fetch(`${API}/__set?${query}`);
const mockStats = () => fetch(`${API}/__stats`).then(r => r.json());

// 그림자 DOM 안까지 뒤져서 배지, 버튼, 결과창을 찾는다
const DEEP = `(() => { const roots = []; const walk = r => { roots.push(r); r.querySelectorAll('*').forEach(e => { if (e.shadowRoot) walk(e.shadowRoot); }); }; walk(document); return roots; })()`;
const BADGES = `${DEEP}.flatMap(r => [...r.querySelectorAll('.veritai-status-badge')]).map(b => b.textContent.trim())`;
const REPORT = `(() => { for (const r of ${DEEP}) { const box = r.querySelector('.veritai-details-box'); if (box) return {
    meter: box.querySelector('.vr-meter-row b')?.textContent, reason: box.querySelector('.vr-reason')?.textContent || null,
    faces: [...box.querySelectorAll('.vr-face-prob')].map(e => e.textContent), tabs: [...box.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => /%/.test(t)),
    injected: Boolean(box.querySelector('img[src="x"]')) }; } return null; })()`;

async function launchExtension(extDir) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'veritai-e2e-'));
    const context = await chromium.launchPersistentContext(profile, {
        headless: true, channel: 'chromium',
        args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    });
    let sw = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
    if (!sw) sw = await context.waitForEvent('serviceworker', { predicate: w => w.url().startsWith('chrome-extension://'), timeout: 15000 });
    await sw.evaluate(() => chrome.storage.local.set({ isSystemOn: true, isAutoScanOn: false, isCleanUIMode: false }));
    return { context, sw, extensionId: new URL(sw.url()).host };
}

// 정해진 시간만 기다리지 않고, 조건이 맞을 때까지 기다린다 (PC가 느려도 실패하지 않고, 빠르면 바로 넘어간다).
// 시간 안에 조건이 맞지 않으면 그대로 넘어가고, 뒤의 check가 실패로 알려 준다
const WAIT_LIMIT_MS = 10000;
async function waitUntil(page, expression, arg) {
    await page.waitForFunction(expression, arg, { timeout: WAIT_LIMIT_MS, polling: 100 }).catch(() => {});
}

// 사진의 배지가 '분석 중', '대기 중'이 아닌 상태(결과나 오류)가 될 때까지
const BADGE_SETTLED = (vid) => {
    const host = document.querySelector(`veritai-host[data-veritai-for="${vid}"]`);
    const badge = host?.shadowRoot?.querySelector('.veritai-status-badge');
    return Boolean(badge) && !badge.classList.contains('is-loading') && !badge.classList.contains('is-waiting');
};

async function openPage(context, file, errors) {
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(String(e).slice(0, 150)));
    await page.goto(`${PAGE}/page/${file}`);
    await waitUntil(page, () => document.querySelectorAll('.veritai-check-btn').length > 0);
    await page.waitForTimeout(300); // 나머지 사진의 버튼이 붙을 여유
    return page;
}

async function reloadPage(page) {
    await page.reload();
    await waitUntil(page, () => document.querySelectorAll('.veritai-check-btn').length > 0);
    await page.waitForTimeout(300);
}

async function mediaId(page, id) {
    return page.evaluate(i => document.getElementById(i)?.dataset.veritaiId, id);
}

async function buttonFor(page, id) {
    return page.locator(`.veritai-check-btn[data-veritai-for="${await mediaId(page, id)}"]`);
}

async function scan(page, id) {
    await (await buttonFor(page, id)).click();
    await waitUntil(page, BADGE_SETTLED, await mediaId(page, id));
}

async function openReport(page) {
    const badge = page.locator('.veritai-status-badge').first();
    await badge.hover();
    await badge.dispatchEvent('mouseenter');
    await waitUntil(page, `${DEEP}.some(r => r.querySelector('.veritai-details-box'))`);
    await page.waitForTimeout(150); // 결과창 안의 그림이 그려질 여유
    return page.evaluate(REPORT);
}

async function stats(sw) {
    return sw.evaluate(() => chrome.storage.local.get(['veritai_stat_scanned', 'veritai_stat_blocked', 'veritai_detection_request_ids']));
}

async function extensionTests(extDir) {
    const { context, sw, extensionId } = await launchExtension(extDir);
    const errors = [];
    try {
        let page = await openPage(context, 'basic.html', errors);
        const visibleButtons = await page.evaluate(() => [...document.querySelectorAll('img')].filter(img => document.querySelector(`.veritai-check-btn[data-veritai-for="${img.dataset.veritaiId}"]`)).map(img => img.id));
        check('확장: 일반 사진에만 검사 버튼이 붙음 (40x30 사진 제외)', JSON.stringify(visibleButtons) === '["a","b","c"]', visibleButtons.join(','));
        const hintPassThrough = await page.evaluate(() => {
            const hint = document.getElementById('veritai-mini-hint');
            if (!hint) return null;
            const r = hint.getBoundingClientRect();
            return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== hint;
        });
        check('확장: 오른쪽 아래 안내는 사이트 버튼 클릭을 막지 않음', hintPassThrough === true, String(hintPassThrough));

        await setMock('mode=fake&delay=0');
        await scan(page, 'a');
        check('확장: 조작 의심 배지', (await page.evaluate(BADGES)).includes('조작 의심 82%'));
        let report = await openReport(page);
        await page.evaluate(`${DEEP}.map(r => r.querySelector('#veritai-toggle-xai-btn')).find(Boolean)?.click()`);
        await page.waitForTimeout(400);
        report = await page.evaluate(REPORT);
        check('확장: 결과창 확률, 판정 이유, 얼굴, 히트맵 탭', report && report.meter === '82.0%' && /한 얼굴에서 강한/.test(report.reason) && report.faces[0] === '82%' && report.tabs.some(t => t.includes('82.0%')), JSON.stringify(report));

        let before = (await mockStats()).posts;
        await scan(page, 'c');
        check('확장: 같은 사진은 다시 보내지 않음', (await mockStats()).posts === before);

        await setMock('mode=fake&delay=1500');
        before = (await mockStats()).posts;
        const btnB = await buttonFor(page, 'b');
        for (let i = 0; i < 4; i += 1) await btnB.click({ timeout: 400 }).catch(() => {});
        await page.waitForTimeout(2500);
        check('확장: 검사 버튼 연타해도 요청 1번', (await mockStats()).posts - before === 1, `${(await mockStats()).posts - before}번`);

        // 결과 형식과 경계값
        await setMock('mode=ai_unavailable&delay=0');
        await reloadPage(page);
        const statBefore = await stats(sw);
        await scan(page, 'a');
        check('확장: AI 모델 미로드는 판정 실패로 표시', (await page.evaluate(BADGES)).some(t => t.includes('AI 판정 실패')));
        const statAfter = await stats(sw);
        check('확장: 판정 실패는 통계에 넣지 않음', statAfter.veritai_stat_scanned === statBefore.veritai_stat_scanned);
        await setMock('mode=fake');
        await page.locator('.veritai-status-badge').first().click();
        await waitUntil(page, `${BADGES}.includes('조작 의심 82%')`);
        check('확장: 판정 실패 배지를 누르면 다시 검사', (await page.evaluate(BADGES)).includes('조작 의심 82%'));

        for (const [mode, expected] of [['empty_result', '결과를 읽을 수 없습니다'], ['bad_confidence', '결과를 읽을 수 없습니다'], ['string_flag', '정상']]) {
            await setMock(`mode=${mode}`);
            await reloadPage(page);
            await scan(page, 'a');
            const badges = await page.evaluate(BADGES);
            check(`확장: ${mode} → ${expected}`, badges.some(t => t.startsWith(expected)), badges.join(' / '));
        }

        await setMock('mode=boundary');
        await reloadPage(page);
        await scan(page, 'a');
        report = await openReport(page);
        check('확장: 경계값 0.4996은 49.9%, 판정 이유 79%/49%', report && report.meter === '49.9%' && /79%로/.test(report.reason) && /49%라/.test(report.reason) && report.faces[0] === '79%', JSON.stringify(report));

        for (const mode of ['xss', 'bad_bbox', 'bad_cam', 'out_of_range']) {
            await setMock(`mode=${mode}`);
            await reloadPage(page);
            await scan(page, 'a');
            report = await openReport(page);
            const xss = await page.evaluate(() => window.__xss || 0);
            const ok = report && !report.injected && !xss && (mode !== 'out_of_range' || JSON.stringify(report.faces) === '["100%","0%"]');
            check(`확장: ${mode} 응답에도 결과창이 깨지지 않음`, ok, JSON.stringify(report));
        }

        // 클린 모드: 정상 배지는 잠시 뒤 사라짐
        await setMock('mode=real');
        await sw.evaluate(() => chrome.storage.local.set({ isCleanUIMode: true }));
        await reloadPage(page);
        await scan(page, 'a');
        const shownReal = (await page.evaluate(BADGES)).includes('정상');
        await page.waitForTimeout(2600);
        const hiddenAfter = await page.evaluate(`${DEEP}.flatMap(r => [...r.querySelectorAll('.veritai-status-badge')]).every(b => { let e = b; while (e) { if (e.style && e.style.display === 'none') return true; e = e.parentElement || (e.getRootNode && e.getRootNode().host); } return false; })`);
        check('확장: 클린 모드에서 정상 배지는 잠시 뒤 숨겨짐', shownReal && hiddenAfter);
        await sw.evaluate(() => chrome.storage.local.set({ isCleanUIMode: false }));

        // 전원 끄기
        await setMock('mode=fake&delay=1500');
        await reloadPage(page);
        await (await buttonFor(page, 'b')).click();
        await page.waitForTimeout(300);
        await sw.evaluate(() => chrome.storage.local.set({ isSystemOn: false }));
        await page.waitForTimeout(2000);
        check('확장: 검사 중 전원 끄면 화면에 아무것도 안 남음', await page.evaluate(`${DEEP}.reduce((n, r) => n + r.querySelectorAll('.veritai-status-badge, .veritai-check-btn').length, 0)`) === 0);
        await sw.evaluate(() => chrome.storage.local.set({ isSystemOn: true }));
        await page.waitForTimeout(800);
        check('확장: 다시 켜면 검사 버튼 복구', await page.locator('.veritai-check-btn').count() === 3);

        // 캐시 비우기 + 다른 탭 정리 + 통계 유지
        await setMock('mode=fake&delay=0');
        const page2 = await openPage(context, 'basic.html', errors);
        await scan(page, 'a'); await scan(page2, 'b');
        const statsBeforeClear = await stats(sw);
        const tabs = await sw.evaluate(() => chrome.tabs.query({ url: 'http://localhost:8000/*' }).then(t => t.map(x => x.id)));
        let res = await sw.evaluate(id => chrome.tabs.sendMessage(id, { action: 'clear_cache_and_rescan' }), tabs[0]);
        await page.waitForTimeout(800);
        const tab2Badges = await page2.evaluate(BADGES);
        const statsAfterClear = await stats(sw);
        check('확장: 캐시 비우기 성공, 다른 탭 표시도 정리', res?.success && tab2Badges.length === 0 && await page2.locator('.veritai-check-btn').count() === 3, JSON.stringify(res?.deletion));
        check('확장: 캐시를 비워도 오늘 통계는 유지', statsAfterClear.veritai_stat_scanned === statsBeforeClear.veritai_stat_scanned && (statsAfterClear.veritai_detection_request_ids || []).length === 0);

        await scan(page, 'a');
        await fetch(`${API}/__restart`);
        res = await sw.evaluate(id => chrome.tabs.sendMessage(id, { action: 'clear_cache_and_rescan' }), tabs[0]);
        check('확장: 서버 재시작 뒤에도 캐시 비우기 성공', res?.success && res.deletion?.alreadyMissingCount >= 1, JSON.stringify(res?.deletion));
        await page2.close();

        // 겹친 사진
        page = await openPage(context, 'overlap.html', errors);
        const overlap = await page.evaluate(() => Object.fromEntries(['under', 'over', 'free'].map(id => {
            const img = document.getElementById(id);
            const btn = document.querySelector(`.veritai-check-btn[data-veritai-for="${img.dataset.veritaiId}"]`);
            const visible = Boolean(btn) && getComputedStyle(btn).display !== 'none' && btn.getBoundingClientRect().width > 0;
            return [id, visible];
        })));
        check('확장: 아래에 가려진 사진에는 버튼을 안 보임', overlap.over && overlap.free && !overlap.under, JSON.stringify(overlap));

        // 사이트 CSS가 거칠어도 결과창 모양이 그대로인지 (결과창은 Shadow DOM 안에 있다)
        await setMock('mode=fake&delay=0');
        page = await openPage(context, 'hostile.html', errors);
        await scan(page, 'h');
        await openReport(page);
        const isolated = await page.evaluate(`(() => { for (const r of ${DEEP}) { const box = r.querySelector('.veritai-details-box'); if (!box) continue;
            const css = el => el ? getComputedStyle(el) : null;
            return { meter: css(box.querySelector('.vr-meter-row b'))?.fontSize, btn: css(box.querySelector('#veritai-toggle-xai-btn'))?.fontSize,
                canvas: css(box.querySelector('#veritai-bbox-canvas'))?.display, inPage: Boolean(document.querySelector('.veritai-details-box')) }; } return null; })()`);
        // 외부 링크 차단 사이트(디시인사이드 등)의 사진도 검사되는지
        await setMock('mode=fake&delay=0');
        const hlPage = await openPage(context, 'hotlink.html', errors);
        const directStatus = await fetch(`${PAGE}/protected/hl.png`).then(r => r.status);
        await scan(hlPage, 'hl');
        const hlBadges = await hlPage.evaluate(BADGES);
        await hlPage.close();
        check('확장: 외부 링크 차단 사이트의 사진도 검사', directStatus === 403 && hlBadges.includes('조작 의심 82%'), `Referer 없이 ${directStatus}, 배지 ${hlBadges.join(' / ')}`);

        // 광고 판별 두 단계: 배너 영역은 버튼만 붙이고 자동 검사는 안 함, 구글 광고는 아무것도 안 붙임
        const adUi = async (p) => p.evaluate(() => Object.fromEntries(['bn', 'ad'].map(id => {
            const vid = document.getElementById(id).dataset.veritaiId;
            return [id, { button: Boolean(vid && document.querySelector(`.veritai-check-btn[data-veritai-for="${vid}"]`)), badge: Boolean(vid && document.querySelector(`veritai-host[data-veritai-for="${vid}"]`)) }];
        })));
        let adPage = await openPage(context, 'ads.html', errors);
        const adManual = await adUi(adPage);
        await sw.evaluate(() => chrome.storage.local.set({ isAutoScanOn: true }));
        await reloadPage(adPage);
        await adPage.waitForTimeout(1500); // 자동 검사가 돌 시간을 준다 (돌면 안 된다)
        const adAuto = await adUi(adPage);
        await sw.evaluate(() => chrome.storage.local.set({ isAutoScanOn: false }));
        await adPage.close();
        check('확장: 배너 영역은 검사 버튼만, 구글 광고는 제외', adManual.bn.button && !adManual.ad.button && adAuto.bn.button && !adAuto.bn.badge && !adAuto.ad.button && !adAuto.ad.badge, JSON.stringify({ adManual, adAuto }));

        check('확장: 사이트 CSS가 결과창에 섞이지 않음', isolated && isolated.meter === '13px' && isolated.btn === '12px' && isolated.canvas !== 'none' && !isolated.inPage, JSON.stringify(isolated));

        // 팝업 서버 상태
        const popup = await context.newPage();
        await popup.goto(`chrome-extension://${extensionId}/frontend/popup.html`);
        await popup.waitForTimeout(600);
        const okText = await popup.locator('#server-text').innerText();
        await setMock('down=true');
        await popup.reload(); await popup.waitForTimeout(5000);
        const downText = await popup.locator('#server-text').innerText();
        await setMock('down=false');
        check('확장: 팝업 서버 상태 (연결됨 / 연결 안 됨)', okText.startsWith('분석 서버 연결됨') && downText === '분석 서버에 연결할 수 없습니다', `${okText} / ${downText}`);
        await popup.close();

        // 성능
        page = await context.newPage();
        await page.addInitScript(() => {
            window.__longest = 0;
            new PerformanceObserver(list => { for (const e of list.getEntries()) window.__longest = Math.max(window.__longest, e.duration); }).observe({ type: 'longtask', buffered: true });
        });
        await page.goto(`${PAGE}/page/many.html`);
        await page.waitForTimeout(4000);
        const perf = await page.evaluate(() => ({ longest: Math.round(window.__longest), buttons: document.querySelectorAll('.veritai-check-btn').length }));
        check('확장: 사진 400장 페이지에서 200ms 넘게 멈추지 않음', perf.longest < 200 && perf.buttons === 400, `가장 긴 멈춤 ${perf.longest}ms, 버튼 ${perf.buttons}개`);
        await page.goto(`${PAGE}/page/busy.html`);
        await page.waitForTimeout(6000);
        const busy = await page.evaluate(() => document.querySelectorAll('#g img').length === document.querySelectorAll('.veritai-check-btn').length);
        check('확장: 화면이 계속 바뀌는 페이지에서도 새 사진에 버튼', busy);
        check('확장: 페이지 스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    } finally {
        await context.close();
    }
}

async function pwaTests() {
    const browser = await chromium.launch();
    const errors = [];
    const site = path.join(__dirname, 'out', 'site', 'img');
    const STATE = () => {
        const vis = id => { const e = document.getElementById(id); return Boolean(e) && !e.hidden; };
        return {
            view: ['start', 'preview', 'loading', 'result', 'error'].find(v => vis(`view-${v}`)),
            title: document.getElementById('verdict-title')?.textContent,
            percent: document.getElementById('verdict-percent')?.textContent,
            reason: vis('verdict-reason') ? document.getElementById('verdict-reason').textContent : null,
            error: vis('view-error') ? document.getElementById('error-text').textContent : null,
            faces: [...document.querySelectorAll('.face-prob')].map(e => e.textContent),
            xss: window.__xss || 0,
        };
    };
    const newPage = async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.on('pageerror', e => errors.push(String(e).slice(0, 150)));
        await page.goto(`${PAGE}/pwa/index.html`);
        await page.waitForTimeout(300);
        return page;
    };
    // 화면이 바뀔 때까지 기다린다 (사진 준비 → 미리보기나 오류, 검사 → 결과나 오류)
    const viewIs = (names) => names.some(v => { const e = document.getElementById(`view-${v}`); return e && !e.hidden; });
    const inspect = async (page, file = 'p0.png') => {
        await page.setInputFiles('#input-gallery', path.join(site, file));
        await page.waitForFunction(viewIs, ['preview', 'error'], { timeout: 10000, polling: 100 }).catch(() => {});
        if (await page.isVisible('#btn-inspect')) {
            await page.click('#btn-inspect');
            await page.waitForFunction(viewIs, ['result', 'error'], { timeout: 10000, polling: 100 }).catch(() => {});
        }
        return page.evaluate(STATE);
    };
    try {
        let page = await newPage();
        await setMock('mode=fake&delay=0');
        check('PWA: 서버 상태 연결됨', (await page.locator('#server-text').innerText()).startsWith('분석 서버 연결됨'));
        let st = await inspect(page);
        await page.click('#btn-heatmap'); await page.waitForTimeout(300);
        const note = await page.locator('#heatmap-note').innerText();
        check('PWA: 조작 의심 결과와 히트맵 안내', st.title === '조작 의심' && st.percent === '82.0%' && note.includes('82.0%'), `${st.title} ${st.percent}`);

        const errorCases = [
            ['http500', '서버에서 분석 중 오류가 발생했습니다.'], ['http429', '요청이 많습니다'], ['bad_json', '서버 응답을 읽을 수 없습니다.'],
            ['empty_result', '분석 결과를 읽을 수 없습니다'], ['bad_confidence', '분석 결과를 읽을 수 없습니다'], ['ai_unavailable', 'AI 판정을 하지 못했습니다'],
        ];
        for (const [mode, expected] of errorCases) {
            await page.close(); page = await newPage();
            await setMock(`mode=${mode}`);
            st = await inspect(page);
            check(`PWA: ${mode} → 오류 안내`, st.view === 'error' && st.error?.startsWith(expected), st.error || st.view);
        }

        await page.close(); page = await newPage();
        await setMock('mode=boundary');
        st = await inspect(page);
        check('PWA: 경계값 49.9%, 판정 이유 79%/49%', st.title === '정상' && st.percent === '49.9%' && /79%로/.test(st.reason) && /49%라/.test(st.reason), JSON.stringify(st));

        for (const mode of ['out_of_range', 'xss', 'bad_bbox', 'bad_cam', 'string_flag']) {
            await page.close(); page = await newPage();
            await setMock(`mode=${mode}`);
            st = await inspect(page);
            const ok = st.view === 'result' && !st.xss
                && (mode !== 'out_of_range' || JSON.stringify(st.faces) === '["100%","0%"]')
                && (mode !== 'string_flag' || st.title === '정상');
            check(`PWA: ${mode} 응답 처리`, ok, JSON.stringify({ view: st.view, title: st.title, faces: st.faces }));
        }

        await setMock('mode=fake');
        for (const [file, expected] of [['broken.png', '이 사진 형식은 열 수 없습니다'], ['doc.pdf', '이미지 파일만 검사할 수 있습니다']]) {
            await page.close(); page = await newPage();
            st = await inspect(page, file);
            check(`PWA: ${file} 안내`, st.error?.startsWith(expected), st.error || st.view);
        }
        await page.close(); page = await newPage();
        st = await inspect(page, 'big.png');
        check('PWA: 큰 사진도 검사', st.view === 'result');

        // 기록 지우기 (서버 재시작 뒤 포함)
        await page.click('#view-result .js-restart'); await page.waitForTimeout(300);
        await inspect(page, 'p1.png');
        await page.click('#view-result .js-restart'); await page.waitForTimeout(300);
        await fetch(`${API}/__restart`);
        await page.click('#btn-clear-records'); await page.waitForTimeout(200);
        await page.click('#btn-clear-records'); await page.waitForTimeout(1500);
        const status = await page.locator('#records-status').innerText();
        check('PWA: 서버 재시작 뒤에도 기록 지우기 성공', /건을 지웠습니다/.test(status) && await page.locator('#btn-clear-records').isHidden(), status);

        await setMock('down=true');
        await page.reload(); await page.waitForTimeout(5000);
        check('PWA: 서버 상태 연결 안 됨', (await page.locator('#server-text').innerText()) === '분석 서버에 연결할 수 없습니다');
        await setMock('down=false');
        check('PWA: 페이지 스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    } finally {
        await browser.close();
    }
}

(async () => {
    const { extDir, siteDir } = build();
    const servers = await startServers(siteDir);
    try {
        if (!only.length || only.includes('ext')) await extensionTests(extDir);
        if (!only.length || only.includes('pwa')) await pwaTests();
    } catch (err) {
        check('테스트 실행 중 예외', false, String(err).slice(0, 300));
    } finally {
        servers.close();
    }
    const failed = results.filter(r => !r.ok);
    console.log(`\n# ${results.length - failed.length}/${results.length} 통과`);
    process.exit(failed.length ? 1 : 0);
})();
