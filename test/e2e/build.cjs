// 브라우저 테스트용 빌드: 확장과 PWA를 esbuild로 묶고, 테스트 페이지와 사진을 만든다 (결과는 test/e2e/out, git에 안 올라감)
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const API_BASE = 'http://localhost:8080';

function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// 단색에 가까운 PNG (사진마다 색을 달리해 서로 다른 사진으로 취급되게 한다)
function png(width, height, [r, g, b]) {
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) { row[1 + x * 3] = r; row[2 + x * 3] = (g + x) % 256; row[3 + x * 3] = b; }
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function buildExtension() {
    const dir = path.join(OUT, 'ext');
    for (const name of ['content', 'popup', 'background', 'worker']) {
        esbuild.buildSync({
            entryPoints: [path.join(ROOT, 'frontend', `${name}.js`)], bundle: true, format: 'iife', logLevel: 'error',
            outfile: path.join(dir, 'frontend', `${name}.js`), define: { __VERITAI_API_BASE__: JSON.stringify(API_BASE) },
        });
    }
    for (const file of ['popup.html', 'offscreen.html']) fs.copyFileSync(path.join(ROOT, 'frontend', file), path.join(dir, 'frontend', file));
    fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(dir, 'manifest.json'));
    fs.cpSync(path.join(ROOT, 'public', 'icons'), path.join(dir, 'icons'), { recursive: true });
    return dir;
}

function buildPwa() {
    const dir = path.join(OUT, 'site', 'pwa');
    const stub = path.join(OUT, 'pwa-register-stub.js');
    write(stub, 'export function registerSW() { return () => {}; }\n');
    esbuild.buildSync({
        entryPoints: [path.join(ROOT, 'portal', 'main.js')], bundle: true, format: 'esm', logLevel: 'error',
        outfile: path.join(dir, 'main.js'), alias: { 'virtual:pwa-register': stub },
    });
    for (const file of ['index.html', 'style.css']) fs.copyFileSync(path.join(ROOT, 'portal', file), path.join(dir, file));
}

function buildPages() {
    const site = path.join(OUT, 'site');
    const colors = [[200, 80, 60], [60, 160, 90], [70, 90, 200], [180, 170, 40], [150, 60, 160]];
    colors.forEach((c, i) => write(path.join(site, 'img', `p${i}.png`), png(320, 240, c)));
    write(path.join(site, 'img', 'tiny.png'), png(40, 30, [10, 10, 10]));
    write(path.join(site, 'img', 'big.png'), png(1600, 1200, [120, 110, 100]));
    write(path.join(site, 'img', 'broken.png'), Buffer.from('not really a png'.repeat(50)));
    write(path.join(site, 'img', 'doc.pdf'), Buffer.from('%PDF-1.4 fake'));

    write(path.join(site, 'page', 'basic.html'), `<!doctype html><html><body style="margin:20px">
<img id="a" src="/img/p0.png" width="320" height="240">
<img id="b" src="/img/p1.png" width="320" height="240">
<img id="c" src="/img/p0.png" width="320" height="240">
<img id="t" src="/img/tiny.png" width="40" height="30">
</body></html>`);

    write(path.join(site, 'page', 'overlap.html'), `<!doctype html><html><body style="margin:20px">
<div style="position:relative;width:320px;height:240px">
  <img id="under" src="/img/p2.png" width="320" height="240" style="position:absolute;left:0;top:0">
  <img id="over" src="/img/p3.png" width="320" height="240" style="position:absolute;left:0;top:0">
</div>
<img id="free" src="/img/p4.png" width="320" height="240">
</body></html>`);

    // 태그 이름으로 거칠게 스타일을 거는 사이트 흉내 (결과창이 영향을 받으면 안 된다)
    write(path.join(site, 'page', 'hostile.html'), `<!doctype html><html><head><style>
* { font-family: "Courier New", monospace !important; letter-spacing: 6px !important; text-transform: uppercase !important; }
div, span, b, button { font-size: 30px !important; padding: 20px !important; line-height: 4 !important; }
canvas { display: none !important; }
</style></head><body style="margin:20px">
<img id="h" src="/img/p2.png" width="320" height="240">
</body></html>`);

    // 광고 판별: 배너 영역 사진(bn)은 버튼만, 구글 광고(ad)는 아무것도 붙이지 않는다
    write(path.join(site, 'page', 'ads.html'), `<!doctype html><html><body style="margin:20px">
<div class="main-banner"><img id="bn" src="/img/p3.png" width="320" height="240"></div>
<ins class="adsbygoogle" style="display:block"><img id="ad" src="/img/p4.png" width="320" height="240"></ins>
</body></html>`);

    // 외부 링크 차단 사진: 이 사이트 Referer가 없으면 403 (mock-server.cjs의 /protected/)
    write(path.join(site, 'protected', 'hl.png'), png(320, 240, [90, 140, 170]));
    write(path.join(site, 'page', 'hotlink.html'), `<!doctype html><html><body style="margin:20px">
<img id="hl" src="/protected/hl.png" width="320" height="240">
</body></html>`);

    const many = Array.from({ length: 400 }, (_, i) => `<img src="/img/p${i % 5}.png?i=${i}" width="150" height="150" style="margin:2px">`).join('\n');
    write(path.join(site, 'page', 'many.html'), `<!doctype html><html><body style="margin:0">${many}</body></html>`);

    write(path.join(site, 'page', 'busy.html'), `<!doctype html><html><body style="margin:0">
<div id="ticker"></div><div id="g"></div>
<script>
let t = 0; setInterval(() => { document.getElementById('ticker').textContent = 'tick ' + (t++); }, 50);
let k = 0; const iv = setInterval(() => { const im = document.createElement('img'); im.src = '/img/p' + (k % 5) + '.png?b=' + (k++); im.width = 200; im.height = 200; document.getElementById('g').appendChild(im); if (k >= 10) clearInterval(iv); }, 400);
</script></body></html>`);
}

function build() {
    fs.rmSync(OUT, { recursive: true, force: true });
    const extDir = buildExtension();
    buildPwa();
    buildPages();
    return { extDir, siteDir: path.join(OUT, 'site'), outDir: OUT };
}

module.exports = { build };
if (require.main === module) console.log(build());
