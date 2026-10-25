// 手機橫向：單人、房主、加入都用方鍵。沒有獨立煞車鍵，十字下鍵煞車（含倒車與甩尾蓄力）。
import { createRequire } from 'node:module';
import fs from 'fs';
const { webkit, devices } = createRequire(import.meta.url)('/tmp/pw/node_modules/playwright/index.js');

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const OUT = '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const browser = await webkit.launch({ headless: true });
const phone13 = devices['iPhone 13'];
const land = { width: 844, height: 390 };

function overlaps(a, b) {
  if (!a || !b || a.w < 4 || b.w < 4) return false;
  return a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
}

async function openPhone(query, viewport) {
  const context = await browser.newContext({
    ...phone13,
    viewport: viewport || land,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
  return { context, page, errors };
}

async function showRace(page) {
  await page.evaluate(() => {
    const sky = window.__sky;
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    document.getElementById('touch').classList.remove('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.body.classList.add('touchon', 'items-on');
    sky.game.state = 'race';
    sky.game.freeze = true;
    const count = document.getElementById('count');
    if (count) count.textContent = '';
    if (sky.veh) {
      sky.veh.item = 1;
      sky.veh.itemNext = 2;
    }
    sky.hud.setBattle({ on: true, item: 1, next: 2, aimed: false, how: 'touch' });
    sky.hud.setBattle = () => {};
    sky.renderer.render(sky.scene, sky.camera);
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function readPad(page) {
  return page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: r.x, y: r.y, w: r.width, h: r.height,
        display: cs.display,
        t: (el.innerText || '').replace(/\s+/g, ''),
      };
    };
    const hit = (el) => {
      if (!el) return '';
      const r = el.getBoundingClientRect();
      const node = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const host = node && node.closest ? node.closest('[data-t],[data-p],#stick') : null;
      return host ? (host.dataset.t || host.dataset.p || host.id) : '';
    };
    const q = (sel) => document.querySelector(sel);
    const down = q('[data-t="pdown"]');
    const map = q('#minimap');
    return {
      phone: document.body.classList.contains('phone'),
      guest: document.body.classList.contains('guest'),
      forced: document.documentElement.classList.contains('force-landscape'),
      role: window.__sky.net.role,
      w: innerWidth,
      h: innerHeight,
      stick: rect(q('#stick')),
      dpad: rect(q('#dpad')),
      brake: rect(q('.gpad.brake')),
      down: rect(down),
      downHit: hit(down),
      gas: rect(q('[data-t="gas"]')),
      lift: rect(q('[data-t="lift"]')),
      nitro: rect(q('[data-t="nitro"]')),
      item: rect(q('[data-t="item"]')),
      reset: rect(q('[data-p="reset"]')),
      camera: rect(q('[data-p="camera"]')),
      map: rect(map),
      slot: rect(q('#itemslot')),
      next: (q('#touchItemNext') || {}).innerHTML || '',
      ico: (q('#touchItemIco') || {}).innerHTML || '',
    };
  });
}

function assertPad(name, box) {
  assert(box.phone && !box.forced, name + ' class ' + JSON.stringify({ phone: box.phone, forced: box.forced, role: box.role }));
  assert(box.stick.display === 'none' && box.stick.w < 2, name + ' stick ' + JSON.stringify(box.stick));
  assert(box.dpad.display !== 'none' && box.dpad.w > 80, name + ' dpad ' + JSON.stringify(box.dpad));
  assert(box.brake.display === 'none' && box.brake.w < 2, name + ' pedal ' + JSON.stringify(box.brake));
  assert(box.slot.display === 'none', name + ' big slot ' + box.slot.display);
  assert(box.down.t.includes('煞車') && box.downHit === 'pdown', name + ' down ' + JSON.stringify(box.down) + ' ' + box.downHit);
  assert(box.down.y + box.down.h > box.h * 0.72, name + ' down not low ' + JSON.stringify(box.down));
  assert(box.dpad.y + box.dpad.h >= box.h - 14, name + ' pad not on the bottom ' + JSON.stringify(box.dpad));
  for (const key of ['gas', 'lift', 'nitro', 'item', 'reset', 'camera', 'down', 'dpad']) {
    const r = box[key];
    assert(r.x >= -1 && r.y >= -1 && r.x + r.w <= box.w + 1 && r.y + r.h <= box.h + 1, name + ' off ' + key + ' ' + JSON.stringify(r));
  }
  for (const key of ['gas', 'lift', 'nitro', 'item', 'reset', 'camera', 'down']) {
    assert(!overlaps(box[key], box.map), name + ' covers map ' + key);
  }
  const gap = box.lift.x - (box.dpad.x + box.dpad.w);
  assert(gap >= 24, name + ' cluster gap ' + gap);
  assert(box.item.w >= 60 && box.item.h >= 60 && box.ico.includes('<svg'), name + ' item icon ' + JSON.stringify({ w: box.item.w, ico: box.ico.slice(0, 40) }));
}

async function drive(page) {
  return page.evaluate(() => {
    const sky = window.__sky;
    const fire = (sel, type, id) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
        clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
      }));
    };
    const snap = (st) => ({ brake: st.brake, pitch: st.pitch, throttle: st.throttle, steer: st.steer });
    fire('[data-t="pdown"]', 'pointerdown', 21);
    const brake = snap(sky.input.poll(1 / 60));
    const v = sky.veh;
    v.placeOnTrack(40, 0, 0);
    v.vel.set(0, 0, 0);
    v.speedF = 0;
    for (let i = 0; i < 45; i++) v.step(1 / 60, brake);
    const reversed = v.speedF;
    fire('[data-t="pdown"]', 'pointerup', 21);
    fire('[data-t="pdown"]', 'pointerdown', 22);
    fire('[data-t="right"]', 'pointerdown', 23);
    let held = null;
    for (let i = 0; i < 36; i++) held = snap(sky.input.poll(1 / 60));
    v.attached = true;
    v.grounded = true;
    v.speedF = 30;
    v.driftT = 0;
    v._driftHeld = false;
    v.boostT = 0;
    v.spinT = 0;
    v._steer = held.steer;
    v._brake = held.brake;
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      v._drift(1 / 60);
      if (v.driftT > peak) peak = v.driftT;
    }
    fire('[data-t="pdown"]', 'pointerup', 22);
    fire('[data-t="right"]', 'pointerup', 23);
    sky.input.touch.pdown = false;
    sky.input.touch.right = false;
    sky.input.touch.brake = false;
    sky.input.keys.add('ArrowDown');
    const key = snap(sky.input.poll(1 / 60));
    sky.input.keys.delete('ArrowDown');
    sky.input.keys.clear();
    document.body.classList.remove('phone');
    sky.input.touch.pdown = true;
    const pitched = snap(sky.input.poll(1 / 60));
    sky.input.touch.pdown = false;
    document.body.classList.add('phone');
    return {
      brake: brake.brake, pitch: brake.pitch, throttle: brake.throttle,
      reversed,
      held: { brake: held.brake, steer: held.steer, pitch: held.pitch },
      peak,
      key: key.brake,
      pitched: { brake: pitched.brake, pitch: pitched.pitch },
    };
  });
}

try {
  const modes = [
    ['solo', '?track=canyon&q=low&ai=0&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=1&autostart=1&lang=zh-TW', false, 'phone-solo-landscape.png'],
    ['host', '?track=canyon&q=low&ai=1&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=1&autostart=1&lang=zh-TW', false, 'phone-host-landscape.png'],
    ['join', '?join=ABC234&q=low&noadapt=1&nopauseblur=1&nonet=1&lang=zh-TW', true, 'phone-join-landscape.png'],
  ];
  for (const [name, query, guest, shot] of modes) {
    const { context, page, errors } = await openPhone(query);
    if (errors.length) throw new Error(name + ' ' + errors.join('\n'));
    await showRace(page);
    const box = await readPad(page);
    assertPad(name, box);
    assert(box.guest === guest, name + ' guest ' + box.guest);
    assert(box.role === (guest ? 'guest' : 'off'), name + ' role ' + box.role);
    if (name === 'solo') {
      const drove = await drive(page);
      assert(drove.brake > 0.5 && Math.abs(drove.pitch) < 0.05 && drove.throttle === 0, 'down brakes ' + JSON.stringify(drove));
      assert(drove.reversed < -0.4, 'reverse when stopped ' + drove.reversed);
      assert(drove.held.brake > 0.5 && drove.held.steer > 0.8 && Math.abs(drove.held.pitch) < 0.05, 'drift input ' + JSON.stringify(drove.held));
      assert(drove.peak >= 0.5, 'drift charge ' + drove.peak);
      assert(drove.key > 0.5, 'keyboard still brakes ' + drove.key);
      assert(drove.pitched.brake === 0 && drove.pitched.pitch > 0.45, 'desktop down still pitches ' + JSON.stringify(drove.pitched));
      await showRace(page);
    }
    await page.screenshot({ path: OUT + '/' + shot });
    await context.close();
    ok(name);
  }

  const portrait = await openPhone('?q=low&noadapt=1&nopauseblur=1&nonet=1&lang=zh-TW', { width: 390, height: 844 });
  const turn = await portrait.page.evaluate(() => {
    const el = document.getElementById('turnPhone');
    const r = el.getBoundingClientRect();
    return {
      phone: document.body.classList.contains('phone'),
      guest: document.body.classList.contains('guest'),
      need: document.body.classList.contains('need-rotate'),
      forced: document.documentElement.classList.contains('force-landscape'),
      transform: getComputedStyle(document.body).transform,
      w: Math.round(r.width),
      h: Math.round(r.height),
      text: (el.innerText || '').replace(/\s+/g, ''),
    };
  });
  assert(turn.phone && !turn.guest && turn.need && !turn.forced && turn.transform === 'none', 'solo portrait ' + JSON.stringify(turn));
  assert(turn.w >= 380 && turn.h >= 800 && turn.text.includes('橫向'), 'overlay ' + JSON.stringify(turn));
  await portrait.page.screenshot({ path: OUT + '/phone-solo-portrait.png' });
  await portrait.context.close();
  ok('solo portrait prompt');
} catch (e) { bad('phone controls', e); }

await browser.close();
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('PHONE CONTROLS OK');
