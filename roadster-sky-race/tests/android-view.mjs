// Android Chrome 橫向：畫布要鋪滿可視範圍，按鍵只是疊在上面。視口被改小之後也要補回來。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.135 Mobile Safari/537.36';
const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function openPhone(w, h, dpr, orient) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setCacheEnabled(false);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  if (orient) await page.evaluateOnNewDocument((o) => { window.__skyOrient = o; }, orient);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?join=ABC234&q=low&noadapt=1&nopauseblur=1&nonet=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
  await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.state = 'race';
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('touch').classList.remove('hidden');
    document.body.classList.add('items-on');
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return { page, errors };
}

function orientFor(w, h) {
  const landscape = w > h;
  return {
    type: landscape ? 'landscape-primary' : 'portrait-primary',
    angle: landscape ? 90 : 0,
    win: landscape ? 90 : 0,
    sw: w, sh: h, iw: w, ih: h,
  };
}

try {
  const cases = [
    [915, 412, 2.75],
    [851, 393, 3],
    [780, 360, 3.5],
    [412, 915, 2.75],
  ];
  for (const [w, h, dpr] of cases) {
    const name = w + 'x' + h + ' @' + dpr;
    const { page, errors } = await openPhone(w, h, dpr, orientFor(w, h));
    const box = await page.evaluate(() => {
      const gl = document.getElementById('gl');
      const r = gl.getBoundingClientRect();
      const sky = window.__sky;
      const view = new sky.THREE.Vector4();
      const buf = new sky.THREE.Vector2();
      sky.renderer.getViewport(view);
      sky.renderer.getDrawingBufferSize(buf);
      sky.renderer.setViewport(0, 0, 30, 40);
      window.dispatchEvent(new Event('resize'));
      const again = new sky.THREE.Vector4();
      const buf2 = new sky.THREE.Vector2();
      sky.renderer.getViewport(again);
      sky.renderer.getDrawingBufferSize(buf2);
      const cx = innerWidth / 2, cy = innerHeight / 2;
      const node = document.elementFromPoint(cx, cy);
      const host = node && node.closest ? node.closest('[data-t],[data-p],#stick,#gl') : node;
      const touch = getComputedStyle(document.getElementById('touch'));
      const gas = getComputedStyle(document.querySelector('[data-t="gas"]'));
      return {
        iw: innerWidth, ih: innerHeight,
        canvas: { x: r.x, y: r.y, w: r.width, h: r.height, bw: gl.width, bh: gl.height, sw: gl.style.width, sh: gl.style.height },
        pr: sky.renderer.getPixelRatio(),
        forced: document.documentElement.classList.contains('force-landscape'),
        view: { x: again.x, y: again.y, w: again.z, h: again.w },
        buf: { w: buf2.x, h: buf2.y },
        hit: host && (host.id || host.dataset.t || host.dataset.p),
        touchPe: touch.pointerEvents,
        gasPe: gas.pointerEvents,
      };
    });
    const coverW = Math.min(box.canvas.x + box.canvas.w, w) - Math.max(box.canvas.x, 0);
    const coverH = Math.min(box.canvas.y + box.canvas.h, h) - Math.max(box.canvas.y, 0);
    assert(coverW >= w - 2 && coverH >= h - 2, name + ' canvas cover ' + JSON.stringify(box.canvas));
    const expectW = box.forced ? h : w;
    const expectH = box.forced ? w : h;
    assert(box.canvas.bw >= expectW * 0.95 && box.canvas.bh >= expectH * 0.95, name + ' buffer ' + JSON.stringify(box));
    assert(box.pr <= 1.01, name + ' dpr ' + box.pr);
    assert(box.view.x === 0 && box.view.y === 0 && Math.abs(box.view.w - box.buf.w) <= 2 && Math.abs(box.view.h - box.buf.h) <= 2, name + ' viewport ' + JSON.stringify(box));
    assert(box.touchPe === 'none' && box.gasPe === 'auto', name + ' pointer ' + box.touchPe + ' ' + box.gasPe);
    assert(box.hit === 'gl', name + ' center hit ' + box.hit);
    if (errors.length) throw new Error(name + ' ' + errors.join('\n'));
    if (w === 915) await page.screenshot({ path: '/opt/cursor/artifacts/android-915x412.png' });
    if (w === 780) await page.screenshot({ path: '/opt/cursor/artifacts/android-780x360.png' });
    await page.close();
    ok(name);
  }
  ok('canvas fills android viewports');
} catch (e) { bad('canvas fills android viewports', e); }

try {
  const { page, errors } = await openPhone(915, 412, 2.75, orientFor(915, 412));
  await page.evaluate(() => window.__sky.renderer.forceContextLoss());
  await page.waitForFunction(() => {
    const box = document.getElementById('glfail');
    return box && !box.classList.contains('hidden') && document.getElementById('glfailMsg').textContent.includes('畫面中斷');
  }, { timeout: 3000 });
  await page.evaluate(() => window.__sky.renderer.forceContextRestore());
  await page.waitForFunction(() => document.getElementById('glfail').classList.contains('hidden'), { timeout: 3000 });
  if (errors.length) throw new Error(errors.join('\n'));
  ok('webgl loss shows a reload message');
  await page.close();
} catch (e) { bad('webgl loss shows a reload message', e); }

await browser.close();
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ANDROID VIEW OK');
