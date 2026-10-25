// Pixel 7 觸控：橫向主方向、橫向反方向、直向 CSS 轉正。按鍵中心必須打到標籤上的功能，
// 搖桿往畫面右側必須是正轉向。畫面右側用元素自己的右邊量，不跟實作共用矩陣。
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('/tmp/pw/node_modules/playwright/index.js');

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const pixel = devices['Pixel 7'];
const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function finger(session, type, x, y) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  });
}

async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function openPhone(viewport, orient) {
  const context = await browser.newContext({
    ...pixel,
    viewport,
    hasTouch: true,
    isMobile: true,
  });
  await context.addInitScript((o) => { window.__skyOrient = o; }, orient);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(BASE + '?join=ABC234&q=low&noadapt=1&nopauseblur=1&nonet=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
  await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.state = 'race';
    sky.game.camMode = 0;
    sky.game.outbox = [];
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    document.getElementById('touch').classList.remove('hidden');
    document.getElementById('hud').classList.remove('hidden');
  });
  await settle(page);
  if (errors.length) throw new Error(errors.join('\n'));
  const session = await context.newCDPSession(page);
  return { context, page, session };
}

async function layout(page) {
  return page.evaluate(() => {
    const axis = (el, left, top) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const marker = document.createElement('div');
      marker.style.cssText = `position:absolute;left:${left};top:${top};width:0;height:0;pointer-events:none;`;
      el.appendChild(marker);
      const m = marker.getBoundingClientRect();
      el.removeChild(marker);
      const vx = m.left - cx, vy = m.top - cy;
      const len = Math.hypot(vx, vy) || 1;
      return { x: vx / len, y: vy / len, cx, cy };
    };
    const pad = document.getElementById('dpad');
    const buttons = {};
    for (const el of document.querySelectorAll('[data-t],[data-p]')) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const node = document.elementFromPoint(cx, cy);
      const host = node && node.closest ? node.closest('[data-t],[data-p],#stick') : null;
      const key = el.dataset.t || el.dataset.p;
      buttons[key] = {
        cx, cy,
        hit: host && (host.dataset.t || host.dataset.p || host.id),
        label: (el.innerText || '').replace(/\s+/g, ''),
        inside: cx >= 2 && cy >= 2 && cx <= innerWidth - 2 && cy <= innerHeight - 2,
      };
    }
    return {
      forced: document.documentElement.classList.contains('force-landscape'),
      iw: innerWidth, ih: innerHeight,
      right: axis(pad, '100%', '50%'),
      left: axis(pad, '0%', '50%'),
      up: axis(pad, '50%', '0%'),
      down: axis(pad, '50%', '100%'),
      buttons,
    };
  });
}

async function hostNow(page) {
  return page.evaluate(() => {
    const sky = window.__sky;
    sky.input.poll(1 / 60);
    const pkt = sky.sync.packInput(sky.input.state);
    const drv = new sky.RemoteDriver();
    drv.push(pkt);
    return {
      host: drv.state,
      cam: sky.game.camMode,
      state: sky.game.state,
      box: (sky.game.outbox || []).slice(),
    };
  });
}

async function pressButton(session, page, button) {
  await finger(session, 'touchStart', button.cx, button.cy);
  await settle(page);
  const mid = await hostNow(page);
  await finger(session, 'touchEnd', button.cx, button.cy);
  await settle(page);
  return mid;
}

async function idle(page, n) {
  for (let i = 0; i < n; i++) await hostNow(page);
}

async function hold(session, page, button, polls) {
  await finger(session, 'touchStart', button.cx, button.cy);
  await settle(page);
  let mid = null;
  for (let i = 0; i < polls; i++) mid = await hostNow(page);
  await finger(session, 'touchEnd', button.cx, button.cy);
  await settle(page);
  return mid.host;
}

async function runMode(name, viewport, orient, expectCss) {
  const { context, page, session } = await openPhone(viewport, orient);
  try {
    if (expectCss === 'overlay') {
      const turn = await page.evaluate(() => {
        const el = document.getElementById('turnPhone');
        const r = el.getBoundingClientRect();
        const body = getComputedStyle(document.body);
        return {
          need: document.body.classList.contains('need-rotate'),
          forced: document.documentElement.classList.contains('force-landscape'),
          transform: body.transform,
          w: Math.round(r.width), h: Math.round(r.height),
          text: (el.innerText || '').replace(/\s+/g, ''),
          iw: innerWidth, ih: innerHeight,
        };
      });
      assert(turn.need && !turn.forced && turn.transform === 'none', name + ' overlay ' + JSON.stringify(turn));
      assert(turn.w >= viewport.width - 4 && turn.h >= viewport.height - 4, name + ' cover ' + JSON.stringify(turn));
      assert(turn.text.indexOf('橫向') >= 0, name + ' copy ' + turn.text);
      ok(name);
      return;
    }
    const box = await layout(page);
    assert(box.forced === expectCss, name + ' css ' + box.forced + ' ' + JSON.stringify({ iw: box.iw, ih: box.ih }));
    const expect = {
      gas: { label: '加速', field: 'throttle' },
      lift: { label: 'B推進', field: 'lift' },
      nitro: { label: 'A氮氣', field: 'nitro' },
      camera: { label: 'Y視角', field: 'camera' },
      reset: { label: 'X回賽道', field: 'reset' },
      pause: { label: '暫停', field: 'pause' },
    };
    for (const key of Object.keys(expect)) {
      const b = box.buttons[key];
      assert(b, name + ' missing ' + key);
      assert(b.label === expect[key].label, name + ' label ' + key + ' ' + b.label);
      assert(b.inside && b.hit === key, name + ' hit ' + key + ' ' + JSON.stringify(b));
    }
    const along = (btn, dir) => (btn.cx - box.right.cx) * dir.x + (btn.cy - box.right.cy) * dir.y;
    const B = box.buttons.lift, A = box.buttons.nitro, Y = box.buttons.camera, X = box.buttons.reset, G = box.buttons.gas;
    assert(along(B, box.down) > along(A, box.down) + 16, name + ' B not below A');
    assert(along(A, box.right) > along(B, box.right) + 16, name + ' A not right of B');
    assert(along(G, box.right) > along(B, box.right) + 16, name + ' gas not right of B');
    assert(along(Y, box.up) > along(B, box.up) + 16 && along(X, box.up) > along(B, box.up) + 16, name + ' xy not above cluster');
    assert(along(Y, box.right) > along(X, box.right) + 8, name + ' Y not right of X');
    for (const key of ['left', 'right', 'pup', 'pdown']) {
      const b = box.buttons[key];
      assert(b && b.inside && b.hit === key, name + ' dpad ' + key + ' ' + JSON.stringify(b));
    }
    assert(box.buttons.left.label === '左轉' && box.buttons.right.label === '右轉' && box.buttons.pup.label === '俯仰', name + ' dpad labels');
    assert(box.buttons.pdown.label === '煞車', name + ' down label ' + box.buttons.pdown.label);
    const pedal = await page.evaluate(() => getComputedStyle(document.querySelector('[data-t="brake"]')).display);
    assert(pedal === 'none', name + ' brake pedal shown');
    const quiet = (h) => Math.abs(h.steer) < 0.05 && h.throttle === 0 && h.brake === 0 && !h.lift && !h.nitro && h.pitch === 0;

    const right = await hold(session, page, box.buttons.right, 18);
    assert(right.steer > 0.8 && Math.abs(right.pitch) < 0.2, name + ' dpad right ' + JSON.stringify(right));
    await idle(page, 24);
    const left = await hold(session, page, box.buttons.left, 18);
    assert(left.steer < -0.8 && Math.abs(left.pitch) < 0.2, name + ' dpad left ' + JSON.stringify(left));
    await idle(page, 24);
    const up = await hold(session, page, box.buttons.pup, 3);
    assert(Math.abs(up.steer) < 0.25 && up.pitch < -0.45, name + ' dpad up ' + JSON.stringify(up));
    await idle(page, 8);
    const down = await hold(session, page, box.buttons.pdown, 3);
    assert(Math.abs(down.steer) < 0.25 && down.brake > 0.5 && Math.abs(down.pitch) < 0.05 && down.throttle === 0, name + ' dpad down brake ' + JSON.stringify(down));
    await idle(page, 8);

    const gas = await pressButton(session, page, box.buttons.gas);
    assert(gas.host.throttle > 0.5 && gas.host.brake === 0 && !gas.host.lift && !gas.host.nitro, name + ' gas ' + JSON.stringify(gas.host));
    const lift = await pressButton(session, page, box.buttons.lift);
    assert(lift.host.lift === true && lift.host.nitro === false && lift.host.throttle === 0, name + ' lift ' + JSON.stringify(lift.host));
    const nitro = await pressButton(session, page, box.buttons.nitro);
    assert(nitro.host.nitro === true && nitro.host.lift === false && nitro.host.throttle === 0, name + ' nitro ' + JSON.stringify(nitro.host));

    const beforeCam = await page.evaluate(() => window.__sky.game.camMode);
    await finger(session, 'touchStart', box.buttons.camera.cx, box.buttons.camera.cy);
    await page.waitForFunction((n) => window.__sky.game.camMode === n + 1, beforeCam, { timeout: 3000 });
    const camPkt = await hostNow(page);
    assert(quiet(camPkt.host), name + ' camera leaked ' + JSON.stringify(camPkt.host));
    await finger(session, 'touchEnd', box.buttons.camera.cx, box.buttons.camera.cy);
    await settle(page);

    const beforeResetCam = await page.evaluate(() => window.__sky.game.camMode);
    await page.evaluate(() => { window.__sky.game.outbox = []; });
    await finger(session, 'touchStart', box.buttons.reset.cx, box.buttons.reset.cy);
    await page.waitForFunction(() => (window.__sky.game.outbox || []).some((m) => m.t === 'reset'), null, { timeout: 3000 });
    const afterReset = await page.evaluate(() => ({ cam: window.__sky.game.camMode, box: window.__sky.game.outbox }));
    assert(afterReset.cam === beforeResetCam, name + ' reset changed camera ' + JSON.stringify(afterReset));
    assert(afterReset.box.filter((m) => m.t === 'reset').length === 1, name + ' reset count ' + JSON.stringify(afterReset.box));
    await finger(session, 'touchEnd', box.buttons.reset.cx, box.buttons.reset.cy);
    await settle(page);

    if (name === 'landscape-primary') {
      await page.screenshot({ path: '/opt/cursor/artifacts/phone_pad_labels.png' });
    }

    await finger(session, 'touchStart', box.buttons.pause.cx, box.buttons.pause.cy);
    await page.waitForFunction(() => window.__sky.game.state === 'paused', null, { timeout: 3000 });
    await finger(session, 'touchEnd', box.buttons.pause.cx, box.buttons.pause.cy);
    ok(name);
  } finally {
    await context.close();
  }
}

try {
  const modes = [
    ['landscape-primary', { width: 915, height: 412 }, {
      type: 'landscape-primary', angle: 90, win: -90, sw: 915, sh: 412, iw: 915, ih: 412,
    }, false],
    ['landscape-secondary', { width: 915, height: 412 }, {
      type: 'landscape-secondary', angle: 270, win: 90, sw: 915, sh: 412, iw: 915, ih: 412,
    }, false],
    ['portrait-fallback', { width: 412, height: 915 }, {
      type: 'portrait-primary', angle: 0, win: 90, sw: 412, sh: 915, iw: 412, ih: 915,
    }, 'overlay'],
  ];
  for (const [name, viewport, orient, css] of modes) {
    try { await runMode(name, viewport, orient, css); }
    catch (e) { bad(name, e); }
  }
} finally {
  await browser.close();
}
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
