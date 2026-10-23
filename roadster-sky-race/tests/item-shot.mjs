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
  v.item = 1;
  v.spinT = 0;
  v.vel.y = 0;
  sky.game.camMode = 0;
  sky.game.camSnap = true;
  sky.game.camYaw = v.heading;
  sky._shot = chosen;
  return { boxes: battle.boxes.length, chosen, hx: +v.pos.x.toFixed(1), hy: +v.pos.y.toFixed(2), hz: +v.pos.z.toFixed(1) };
});
console.log('PLACED', JSON.stringify(placed));
await frames(page, 3);
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: OUT + '/item-box.png' });

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
await frames(page, 2);
await page.screenshot({ path: OUT + '/item-hit.png' });

const phone = await browser.newPage();
await phone.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await phone.goto(BASE + '?track=canyon&q=low&ai=0&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=1&autostart=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
await phone.waitForFunction(() => window.__sky && window.__sky.game.state === 'race', { timeout: 90000 });
const pad = await phone.evaluate(() => {
  const sky = window.__sky;
  sky.ui.touchMode = 'on';
  sky.game.freeze = true;
  const item = document.querySelector('.gpad.item');
  const gas = document.querySelector('.gpad.gas');
  const pause = document.querySelector('.gpad.menu');
  const reset = document.querySelector('.gpad.face.x');
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
  };
  return {
    iw: innerWidth, ih: innerHeight,
    on: document.body.classList.contains('items-on'),
    label: (item.textContent || '').replace(/\s+/g, ''),
    ico: document.getElementById('touchItemIco').textContent,
    item: rect(item), gas: rect(gas), pause: rect(pause), reset: rect(reset),
  };
});
console.log('PAD', JSON.stringify(pad));
assert(pad.on, 'items not shown on phone');
assert(pad.label.includes('道具'), 'label ' + pad.label);
assert(pad.item.w >= 100 && pad.item.h >= 48, 'item target small');
assert(pad.item.b < pad.gas.y - 8, 'item overlaps throttle');
assert(pad.item.x > pad.pause.r + 8, 'item overlaps pause');
assert(pad.item.b < pad.reset.y - 2, 'item overlaps reset');
assert(pad.item.x > pad.iw * 0.75 && pad.item.r >= pad.iw - 12, 'item not in the right shoulder ' + JSON.stringify(pad.item));
const hitItem = await phone.evaluate(() => {
  const el = document.querySelector('.gpad.item');
  const r = el.getBoundingClientRect();
  const node = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const host = node && node.closest ? node.closest('[data-t]') : null;
  return host && host.dataset.t;
});
assert(hitItem === 'item', 'item hit ' + hitItem);
const ico = await phone.evaluate(() => {
  const sky = window.__sky;
  const me = sky.race.racers.find((r) => r.primary);
  me.veh.item = 2;
  sky.hud.setBattle({ on: true, item: 2, aimed: false });
  return document.getElementById('touchItemIco').textContent;
});
assert(ico && ico !== '–', 'held icon ' + ico);
await frames(phone, 2);
await phone.screenshot({ path: OUT + '/item-phone.png' });

await browser.close();
console.log('SHOTS OK');
