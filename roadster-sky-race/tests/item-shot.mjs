// 道具戰畫面：箱子、發射、命中，以及手機右上角 R 肩鍵。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'fs';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const OUT = '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function frames(page, n = 2) {
  await page.evaluate((k) => new Promise((resolve) => {
    let left = k;
    const step = () => { if (--left <= 0) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), n);
}

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE', e.message));
const url = BASE + '?track=canyon&q=med&ai=1&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=1&autostart=1&lang=zh-TW';
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__sky && window.__sky.game.state === 'race' && window.__sky.battle && window.__sky.battle.boxes.length > 2, { timeout: 90000 });

const placed = await page.evaluate(() => {
  const sky = window.__sky;
  const battle = sky.battle;
  const tr = sky.track;
  const me = sky.race.racers.find((r) => r.primary);
  for (const r of sky.race.racers) {
    if (r !== me) {
      r.parked = true;
      r.veh.pos.x = 9000;
      r.veh.pos.z = 9000;
    }
  }
  sky.game.freeze = true;
  const v = me.veh;
  const skip = new Set([sky.KIND.WALL, sky.KIND.LOOP, sky.KIND.INVERT, sky.KIND.FLY].filter((n) => n != null));
  let chosen = null;
  for (const b of battle.boxes) {
    if (tr.kind && skip.has(tr.kind[b.i])) continue;
    for (const back of [5, 6, 7, 9]) {
      v.placeOnTrack(tr.wrap(b.i - back), 0, 0);
      const d = Math.hypot(v.pos.x - b.x, v.pos.z - b.z);
      if (d > 8 && d < 26) { chosen = { i: b.i, back, d }; break; }
    }
    if (chosen) break;
  }
  if (!chosen) {
    const b = battle.boxes[2];
    v.placeOnTrack(tr.wrap(b.i - 12), 0, 0);
    chosen = { i: b.i, back: 12, d: Math.hypot(v.pos.x - b.x, v.pos.z - b.z) };
  }
  const shown = battle.boxes.find((box) => box.i === chosen.i) || battle.boxes[2];
  const face = v.heading;
  const fx = -Math.sin(face), fz = -Math.cos(face);
  shown.x = v.pos.x + fx * 7.2;
  shown.y = v.pos.y + 1.35;
  shown.z = v.pos.z + fz * 7.2;
  shown.alive = true;
  v.item = 0;
  v.spinT = 0;
  v.vel.y = 0;
  sky.game.camMode = 0;
  sky.game.camSnap = true;
  sky.game.camYaw = v.heading;
  sky._shot = chosen;
  const flash = document.getElementById('flash');
  if (flash) flash.style.display = 'none';
  const count = document.getElementById('count');
  if (count) count.style.display = 'none';
  return { boxes: battle.boxes.length, chosen, hx: +v.pos.x.toFixed(1), hy: +v.pos.y.toFixed(2), hz: +v.pos.z.toFixed(1) };
});
console.log('PLACED', JSON.stringify(placed));
await frames(page, 3);
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: OUT + '/item-box.png' });

await page.evaluate(() => {
  const sky = window.__sky;
  const me = sky.race.racers.find((r) => r.primary);
  sky.input.padInfo.connected = true;
  me.veh.item = 0;
  sky.hud.setBattle({ on: true, item: 0, aimed: false, how: 'pad' });
  me.veh.item = 1;
});
const pop = await page.evaluate(() => {
  const sky = window.__sky;
  const me = sky.race.racers.find((r) => r.primary);
  sky.input.padInfo.connected = true;
  me.veh.item = 1;
  sky.hud.setBattle({ on: true, item: 1, aimed: false, how: 'pad', hitKind: 0 });
  sky.hud._roll = null;
  sky.hud._popUntil = performance.now() + 20000;
  sky.hud.setBattle({ on: true, item: 1, aimed: false, how: 'pad', hitKind: 0 });
  const slot = document.getElementById('itemslot');
  const popEl = document.getElementById('itempop');
  return {
    name: document.getElementById('itempopName').textContent,
    how: document.getElementById('itempopHow').textContent,
    slot: document.getElementById('itemname').textContent,
    glyph: document.getElementById('itemglyph').innerHTML.includes('<svg'),
    pop: document.getElementById('itempopIco').innerHTML.includes('ff2d2d'),
    armed: slot.classList.contains('armed'),
    popOn: !popEl.classList.contains('hidden'),
  };
});
console.log('POP', JSON.stringify(pop));
assert(pop.popOn && pop.name === '直矢' && pop.how === '按 R 發射', 'pickup pop ' + JSON.stringify(pop));
assert(pop.slot === '直矢' && pop.glyph && pop.pop && pop.armed, 'hud slot ' + JSON.stringify(pop));
await page.screenshot({ path: OUT + '/item-pop.png' });

const fired = await page.evaluate(() => {
  const sky = window.__sky;
  const me = sky.race.racers.find((r) => r.primary);
  me.veh.item = 1;
  sky.battle.use(me);
  for (let n = 0; n < 5; n++) sky.battle.step(1 / 60, sky.race.racers);
  const s = sky.battle.shots[0];
  sky.game.camSnap = true;
  sky.game.camYaw = me.veh.heading;
  return s ? { kind: s.kind, x: +s.x.toFixed(2), z: +s.z.toFixed(2), n: sky.battle.shots.length } : null;
});
console.log('FIRED', JSON.stringify(fired));
assert(fired && fired.kind === 1, 'spark missing');
await frames(page, 2);
await page.screenshot({ path: OUT + '/item-fire.png' });

const hit = await page.evaluate(() => {
  const sky = window.__sky;
  const me = sky.race.racers.find((r) => r.primary);
  const foe = sky.race.racers.find((r) => r !== me);
  const tr = sky.track;
  const b = sky.battle.boxes.find((box) => box.i === sky._shot.i) || sky.battle.boxes[2];
  const v = me.veh;
  v.placeOnTrack(b.i, 0, 0);
  v.iFrame = 0; v.spinT = 0; v.shield = false; v.shieldT = 0; v.item = 0;
  const h = v.heading;
  const fx = -Math.sin(h), fz = -Math.cos(h);
  foe.parked = false;
  foe.veh.placeOnTrack(tr.wrap(b.i - 6), 0, 0);
  foe.veh.pos.x = v.pos.x - fx * 8.6;
  foe.veh.pos.y = v.pos.y;
  foe.veh.pos.z = v.pos.z - fz * 8.6;
  foe.veh.heading = h;
  foe.veh.vel.x = 0; foe.veh.vel.y = 0; foe.veh.vel.z = 0;
  foe.veh.item = 1;
  foe.veh.iFrame = 0;
  const before = v.heading;
  const hold = { x: v.pos.x, y: v.pos.y, z: v.pos.z };
  sky.battle.use(foe);
  let steps = 0;
  let last = null;
  while (steps < 40 && !(v.spinT > 0)) {
    sky.battle.step(1 / 60, sky.race.racers);
    const s = sky.battle.shots[0];
    if (s) last = { x: s.x, y: s.y, z: s.z, life: s.life, armed: s.armed };
    steps++;
  }
  const spun = v.spinT;
  v.attached = false;
  v.grounded = false;
  v.detachCool = 4;
  v.spinT = 0;
  v.heading = before + 1.05;
  const coast = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0, item: false };
  for (let n = 0; n < 28; n++) {
    v.heading = before + 1.05;
    v.vel.y = 0;
    v.step(1 / 60, coast);
    v.pos.x = hold.x; v.pos.y = hold.y; v.pos.z = hold.z;
    v.vel.x = 0; v.vel.y = 0; v.vel.z = 0;
    v.attached = false;
    v.grounded = false;
    v.detachCool = 4;
  }
  sky.game.camYaw = before;
  sky.game.camSnap = false;
  const flash = document.getElementById('flash');
  if (flash) flash.style.display = 'none';
  return {
    steps, spin: +spun.toFixed(3), yaw: +v.heading.toFixed(3), before: +before.toFixed(3), vy: v.vel.y,
    car: { x: v.pos.x, y: v.pos.y, z: v.pos.z }, last,
  };
});
console.log('HIT', JSON.stringify(hit));
assert(hit.spin > 0, 'no spin');
assert(Math.abs(hit.yaw - hit.before) > 0.6, 'car did not yaw');
await frames(page, 1);
const banner = await page.evaluate(() => {
  const sky = window.__sky;
  sky.hud.setBattle(Object.assign({ on: true, how: 'pad' }, {
    item: 0, aimed: false,
    hitKind: sky.race.racers.find((r) => r.primary).veh.hitKind,
    hitBlock: !!sky.race.racers.find((r) => r.primary).veh.hitBlock,
  }));
  sky.hud._hitUntil = performance.now() + 20000;
  const el = document.getElementById('itemhit');
  el.classList.remove('hidden');
  return { text: el.textContent, on: !el.classList.contains('hidden'), kind: sky.race.racers.find((r) => r.primary).veh.hitKind };
});
console.log('BANNER', JSON.stringify(banner));
assert(banner.on && banner.text.includes('被直矢擊中'), 'hit banner ' + JSON.stringify(banner));
await page.screenshot({ path: OUT + '/item-hit.png' });

const phone = await browser.newPage();
await phone.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await phone.goto(BASE + '?track=canyon&q=low&ai=0&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=1&autostart=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
await phone.waitForFunction(() => window.__sky && window.__sky.game.state === 'race', { timeout: 90000 });
const pad = await phone.evaluate(() => {
  const sky = window.__sky;
  sky.ui.touchMode = 'on';
  sky.game.freeze = true;
  document.getElementById('touch').classList.remove('hidden');
  document.body.classList.add('touchon', 'items-on');
  const me = sky.race.racers.find((r) => r.primary);
  me.veh.item = 1;
  sky.hud.setBattle({ on: true, item: 1, aimed: false, how: 'touch' });
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
  };
  const item = document.querySelector('.gpad.item');
  return {
    iw: innerWidth, ih: innerHeight,
    on: document.body.classList.contains('items-on'),
    label: (item.textContent || '').replace(/\s+/g, ''),
    ico: document.getElementById('touchItemIco').innerHTML,
    item: rect(item),
    gas: rect(document.querySelector('.gpad.gas')),
    brake: rect(document.querySelector('.gpad.brake')),
    pause: rect(document.querySelector('.gpad.menu')),
    reset: rect(document.querySelector('.gpad.face.x')),
    y: rect(document.querySelector('.gpad.face.y')),
    a: rect(document.querySelector('.gpad.face.a')),
    b: rect(document.querySelector('.gpad.face.b')),
    full: rect(document.getElementById('btnFull')),
    map: rect(document.getElementById('minimap')),
  };
});
console.log('PAD', JSON.stringify(pad));
const hits = (a, b) => a && b && a.x < b.r - 1 && a.r > b.x + 1 && a.y < b.b - 1 && a.b > b.y + 1;
assert(pad.on, 'items not shown on phone');
assert(pad.label.includes('道具'), 'label ' + pad.label);
assert(pad.item.w >= 64 && pad.item.h >= 64, 'item target small');
for (const key of ['gas', 'pause', 'reset', 'y', 'a', 'b', 'full', 'map']) {
  assert(!hits(pad.item, pad[key]), 'item overlaps ' + key + ' ' + JSON.stringify(pad.item) + ' ' + JSON.stringify(pad[key]));
}
const hitItem = await phone.evaluate(() => {
  const el = document.querySelector('.gpad.item');
  const r = el.getBoundingClientRect();
  const node = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const host = node && node.closest ? node.closest('[data-t]') : null;
  return host && host.dataset.t;
});
assert(hitItem === 'item', 'item hit ' + hitItem);
assert(pad.ico.includes('<svg') && pad.ico.includes('ff2d2d'), 'held icon ' + pad.ico.slice(0, 80));
await frames(phone, 2);
await phone.screenshot({ path: OUT + '/item-phone.png' });

await browser.close();
console.log('SHOTS OK');
