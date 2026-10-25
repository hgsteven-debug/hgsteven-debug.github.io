// iPhone 直向：全螢幕「請轉橫」，不要 CSS 轉 90°。橫向：不旋轉，畫布鋪滿可視範圍，選單塞得進或滑得動。
import { createRequire } from 'node:module';
const { webkit, devices } = createRequire(import.meta.url)('/tmp/pw/node_modules/playwright/index.js');

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const OUT = '/opt/cursor/artifacts';
const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const browser = await webkit.launch({ headless: true });
const phone13 = devices['iPhone 13'];
const phone15 = devices['iPhone 15'];

async function openPhone(device, viewport, vv) {
  const context = await browser.newContext({
    ...device,
    viewport,
    hasTouch: true,
    isMobile: true,
  });
  if (vv) await context.addInitScript((spec) => {
    const bag = { resize: new Set(), scroll: new Set() };
    const fake = {
      width: spec.w,
      height: spec.h,
      offsetTop: spec.top,
      offsetLeft: spec.left,
      pageTop: spec.top,
      pageLeft: spec.left,
      scale: 1,
      addEventListener(type, fn) { (bag[type] || (bag[type] = new Set())).add(fn); },
      removeEventListener(type, fn) { if (bag[type]) bag[type].delete(fn); },
      dispatchEvent(ev) {
        const set = bag[ev.type];
        if (set) set.forEach((fn) => fn(ev));
        return true;
      },
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
  }, vv);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?join=ABC234&q=low&noadapt=1&nopauseblur=1&nonet=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.ui && window.__sky.ui.current === 'items', { timeout: 90000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return { context, page, errors };
}

async function measure(page, screenId = 's-items') {
  return page.evaluate((id) => {
    const turn = document.getElementById('turnPhone');
    const tr = turn.getBoundingClientRect();
    const gl = document.getElementById('gl');
    const gr = gl.getBoundingClientRect();
    const screen = document.getElementById(id);
    const sr = screen.getBoundingClientRect();
    const title = screen.querySelector('h2');
    const tb = title.getBoundingClientRect();
    const buttons = [...screen.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { t: (b.innerText || '').replace(/\s+/g, ''), top: r.top, bottom: r.bottom, h: r.height, w: r.width };
    });
    const vv = window.visualViewport;
    const body = getComputedStyle(document.body);
    const rootH = getComputedStyle(document.documentElement).height;
    return {
      iw: innerWidth, ih: innerHeight,
      vv: vv ? { w: Math.round(vv.width), h: Math.round(vv.height), top: Math.round(vv.offsetTop), left: Math.round(vv.offsetLeft) } : null,
      vars: {
        w: getComputedStyle(document.documentElement).getPropertyValue('--vv-w').trim(),
        h: getComputedStyle(document.documentElement).getPropertyValue('--vv-h').trim(),
      },
      need: document.body.classList.contains('need-rotate'),
      forced: document.documentElement.classList.contains('force-landscape'),
      transform: body.transform,
      rootH,
      turn: { x: tr.x, y: tr.y, w: tr.width, h: tr.height, text: (turn.innerText || '').replace(/\s+/g, ''), shown: getComputedStyle(turn).display !== 'none' },
      canvas: { x: gr.x, y: gr.y, w: gr.width, h: gr.height, sw: gl.style.width, sh: gl.style.height },
      screen: { x: sr.x, y: sr.y, w: sr.width, h: sr.height, scroll: screen.scrollHeight, client: screen.clientHeight },
      title: { top: tb.top, text: title.textContent },
      buttons,
      current: window.__sky.ui.current,
    };
  }, screenId);
}

function fitsOrScrolls(box) {
  const top = box.vv.top;
  const bottom = box.vv.top + box.vv.h;
  assert(box.title.top >= top - 2, 'title clipped ' + JSON.stringify(box.title));
  assert(Math.abs(box.screen.y - top) <= 4 && Math.abs(box.screen.h - box.vv.h) <= 4, 'screen box ' + JSON.stringify(box.screen));
  for (const b of box.buttons) {
    assert(b.h >= 16 && b.w >= 24, 'button size ' + JSON.stringify(b));
    const inView = b.top >= top - 2 && b.bottom <= bottom + 2;
    const inScroll = b.bottom <= top + box.screen.scroll + 12;
    assert(inView || (inScroll && box.screen.scroll > box.screen.client + 8), 'button unreachable ' + JSON.stringify({ b, screen: box.screen, vv: box.vv }));
  }
}

function fillsVisible(name, box, vv) {
  assert(!box.forced && box.transform === 'none', name + ' rotated ' + box.transform);
  assert(box.vv && box.vv.w === vv.w && box.vv.h === vv.h && box.vv.top === vv.top, name + ' vv ' + JSON.stringify(box.vv));
  assert(box.vars.w === vv.w + 'px' && box.vars.h === vv.h + 'px', name + ' vars ' + JSON.stringify(box.vars));
  assert(!box.rootH.includes('vh'), name + ' root height ' + box.rootH);
  assert(Math.abs(box.canvas.x - vv.left) <= 2 && Math.abs(box.canvas.y - vv.top) <= 2, name + ' canvas origin ' + JSON.stringify(box.canvas));
  assert(Math.abs(box.canvas.w - vv.w) <= 3 && Math.abs(box.canvas.h - vv.h) <= 3, name + ' canvas size ' + JSON.stringify(box.canvas));
}

async function enterRace(page) {
  return page.evaluate(() => {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    document.body.classList.add('items-on');
    document.getElementById('touch').classList.remove('hidden');
    document.getElementById('hud').classList.remove('hidden');
    window.__sky.game.state = 'race';
    const vv = window.visualViewport;
    const vis = { l: vv.offsetLeft, t: vv.offsetTop, r: vv.offsetLeft + vv.width, b: vv.offsetTop + vv.height };
    const buttons = {};
    for (const el of document.querySelectorAll('#touch [data-t], #touch [data-p]')) {
      const r = el.getBoundingClientRect();
      const key = el.dataset.t || el.dataset.p;
      if (getComputedStyle(el).display === 'none') continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const node = document.elementFromPoint(cx, cy);
      const host = node && node.closest ? node.closest('[data-t],[data-p]') : null;
      buttons[key] = {
        t: (el.innerText || '').replace(/\s+/g, ''),
        inside: r.left >= vis.l - 2 && r.top >= vis.t - 2 && r.right <= vis.r + 2 && r.bottom <= vis.b + 2 && r.width > 20 && r.height > 16,
        hit: host && (host.dataset.t || host.dataset.p),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    }
    const sky = window.__sky;
    sky.renderer.render(sky.scene, sky.camera);
    const gl = sky.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const cols = 48;
    const rows = 24;
    const pix = new Uint8Array(cols * rows * 4);
    gl.readPixels(Math.max(0, (w - cols) >> 1), Math.max(0, h - rows - 4), cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, pix);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < pix.length; i += 4) {
      sum += pix[i] * 0.2126 + pix[i + 1] * 0.7152 + pix[i + 2] * 0.0722;
      n++;
    }
    const canvas = document.getElementById('gl').getBoundingClientRect();
    return {
      buttons,
      luma: sum / Math.max(1, n),
      buf: { w, h },
      canvas: { x: canvas.x, y: canvas.y, w: canvas.width, h: canvas.height },
      need: document.body.classList.contains('need-rotate'),
      transform: getComputedStyle(document.body).transform,
    };
  });
}

try {
  const full13 = { width: 390, height: 844 };
  const land13 = { width: 844, height: 390 };
  const cases = [
    ['iphone13 portrait full', phone13, full13, null, true, 'iphone13-portrait-full.png'],
    ['iphone13 portrait bars', phone13, full13, { w: 390, h: 641, top: 98, left: 0 }, true, 'iphone13-portrait-bars.png'],
    ['iphone15 portrait bars', phone15, { width: 393, height: 852 }, { w: 393, h: 659, top: 96, left: 0 }, true, 'iphone15-portrait-bars.png'],
    ['iphone13 landscape full', phone13, land13, null, false, 'iphone13-landscape-full.png'],
    ['iphone13 landscape bars', phone13, land13, { w: 844, h: 320, top: 32, left: 0 }, false, 'iphone13-landscape-bars.png'],
    ['iphone15 landscape bars', phone15, { width: 852, height: 393 }, { w: 852, h: 322, top: 28, left: 0 }, false, ''],
  ];
  for (const [name, device, viewport, vv, portrait, shot] of cases) {
    const expect = vv || { w: viewport.width, h: viewport.height, top: 0, left: 0 };
    const { context, page, errors } = await openPhone(device, viewport, vv);
    const box = await measure(page, 's-items');
    if (errors.length) throw new Error(name + ' ' + errors.join('\n'));
    fillsVisible(name, box, expect);
    assert(box.need === portrait, name + ' prompt ' + box.need);
    if (portrait) {
      assert(box.turn.shown, name + ' overlay hidden');
      assert(Math.abs(box.turn.x - expect.left) <= 2 && Math.abs(box.turn.y - expect.top) <= 2, name + ' overlay origin ' + JSON.stringify(box.turn));
      assert(Math.abs(box.turn.w - expect.w) <= 4 && Math.abs(box.turn.h - expect.h) <= 4, name + ' overlay size ' + JSON.stringify(box.turn));
      assert(box.turn.text.includes('請把手機轉成橫向'), name + ' copy ' + box.turn.text);
    } else {
      assert(!box.turn.shown, name + ' overlay on landscape');
      assert(box.title.text === '道具戰', box.title.text);
      fitsOrScrolls(box);
      const labels = box.buttons.map((b) => b.t).join(',');
      assert(labels.includes('開啟') && labels.includes('關閉') && labels.includes('返回') && labels.includes('下一步'), name + ' buttons ' + labels);
    }
    if (shot) await page.screenshot({ path: OUT + '/' + shot });
    await context.close();
    ok(name);
  }

  const bars = { w: 844, h: 320, top: 32, left: 0 };
  const { context, page, errors } = await openPhone(phone13, land13, bars);
  await page.click('#s-items [data-act="flow-next"]');
  await page.waitForFunction(() => window.__sky.ui.current === 'join');
  const join = await measure(page, 's-join');
  if (errors.length) throw new Error(errors.join('\n'));
  fillsVisible('join', join, bars);
  assert(!join.need && !join.turn.shown, 'join overlay');
  assert(join.title.text === '加入比賽', join.title.text);
  fitsOrScrolls(join);
  const joinLabels = join.buttons.map((b) => b.t).join(',');
  assert(joinLabels.includes('重新連線') && joinLabels.includes('離開') && joinLabels.includes('換一台車'), joinLabels);
  await page.screenshot({ path: OUT + '/iphone13-join-bars.png' });
  const race = await enterRace(page);
  console.log('RACE', JSON.stringify({ luma: race.luma, buf: race.buf, buttons: race.buttons }));
  assert(!race.need && race.transform === 'none', 'race rotated');
  assert(Math.abs(race.canvas.w - bars.w) <= 3 && Math.abs(race.canvas.h - bars.h) <= 3, 'race canvas ' + JSON.stringify(race.canvas));
  assert(Math.abs(race.canvas.y - bars.top) <= 2, 'race canvas y ' + JSON.stringify(race.canvas));
  for (const key of ['gas', 'left', 'right', 'pup', 'pdown', 'lift', 'nitro', 'pause', 'item']) {
    const b = race.buttons[key];
    assert(b && b.inside && b.hit === key, 'control ' + key + ' ' + JSON.stringify(b));
  }
  assert(!race.buttons.brake, 'brake pedal still in the race view ' + JSON.stringify(race.buttons.brake));
  assert(race.buttons.pdown.t.includes('煞車'), 'down is the brake ' + race.buttons.pdown.t);
  assert(race.luma > 28, 'phone view under-lit ' + JSON.stringify({ luma: race.luma, buf: race.buf }));
  await page.screenshot({ path: OUT + '/iphone13-race-bars.png' });
  await context.close();
  ok('join and race inside visualViewport');

  const turned = await openPhone(phone13, { width: 390, height: 844 }, null);
  await turned.page.setViewportSize({ width: 844, height: 390 });
  await turned.page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    if (window.visualViewport) window.visualViewport.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('orientationchange'));
  });
  await turned.page.waitForFunction(() => !document.body.classList.contains('need-rotate'), null, { timeout: 3000 });
  const landed = await measure(turned.page, 's-items');
  fillsVisible('after turn', landed, { w: 844, h: 390, top: 0, left: 0 });
  assert(!landed.need && !landed.turn.shown, 'still asking to rotate');
  fitsOrScrolls(landed);
  await turned.page.screenshot({ path: OUT + '/iphone13-landscape-after-turn.png' });
  await turned.context.close();
  ok('portrait to landscape resize');

  const host = await browser.newContext({ ...phone13, viewport: land13, hasTouch: true, isMobile: true });
  const hostPage = await host.newPage();
  await hostPage.goto(BASE + '?q=low&noadapt=1&nopauseblur=1&nonet=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await hostPage.waitForFunction(() => window.__sky && window.__sky.ui && window.__sky.ui.current === 'start', { timeout: 90000 });
  await hostPage.evaluate(() => { window.__sky.ui.wizard = true; window.__sky.ui.show('lobby', true); });
  const lobby = await measure(hostPage, 's-lobby');
  assert(!lobby.need && lobby.transform === 'none' && !lobby.forced, 'host lobby rotated ' + lobby.transform);
  assert(lobby.title.top >= -2 && lobby.screen.h >= 370, 'host lobby ' + JSON.stringify({ title: lobby.title, screen: lobby.screen }));
  await hostPage.screenshot({ path: OUT + '/iphone13-host-lobby.png' });
  await host.close();
  ok('host lobby landscape');
} catch (e) {
  bad('iphone viewport', e);
}

await browser.close();
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('PHONE VIEWPORT OK');
