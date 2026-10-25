// 兩格道具：車機大格＋小格，手機按鈕上的排隊圖示，以及甩尾計量表。
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

function me(sky) {
  return sky.race.racers.find((r) => r.primary) || sky.race.racers[0];
}

const page = await browser.newPage();
await page.setCacheEnabled(false);
await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE', e.message));
await page.goto(BASE + '?track=canyon&q=low&ai=0&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=1&autostart=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__sky && window.__sky.game.state === 'race' && window.__sky.hud && window.__sky.race, { timeout: 90000 });

const host = await page.evaluate(() => {
  const sky = window.__sky;
  const v = sky.race.racers.find((r) => r.primary).veh;
  sky.game.freeze = true;
  v.item = 1;
  v.itemNext = 2;
  v.driftT = 1.05;
  const hud = sky.hud;
  hud._itemShown = 0;
  hud._nextShown = 0;
  hud._roll = null;
  hud._nextRoll = null;
  hud.setBattle({ on: true, item: 1, next: 2, aimed: false, how: 'pad', hitKind: 0 });
  hud._roll = null;
  hud._nextRoll = null;
  hud.setBattle({ on: true, item: 1, next: 2, aimed: false, how: 'pad', hitKind: 0 });
  hud.setDrift(1.05);
  const count = document.getElementById('count');
  if (count) count.textContent = '';
  const pop = document.getElementById('itempop');
  if (pop) pop.classList.add('hidden');
  const slot = document.getElementById('itemslot');
  const next = document.getElementById('itemnext');
  const bar = document.getElementById('driftbar');
  return {
    name: document.getElementById('itemname').textContent,
    glyph: document.getElementById('itemglyph').innerHTML.includes('<svg'),
    nextGlyph: document.getElementById('itemnextglyph').innerHTML.includes('<svg'),
    nextOn: next && !next.classList.contains('hidden'),
    slotOn: slot && !slot.classList.contains('hidden'),
    armed: slot.classList.contains('armed'),
    touch: document.getElementById('touchItemIco').innerHTML.includes('<svg'),
    touchNext: document.getElementById('touchItemNext').innerHTML.includes('<svg'),
    touchNextOn: !document.getElementById('touchItemNext').classList.contains('hidden'),
    driftOn: bar && !bar.classList.contains('hidden') && bar.classList.contains('max'),
    fill: document.getElementById('driftfill').style.width,
  };
});
console.log('HOST', JSON.stringify(host));
assert(host.slotOn && host.armed && host.name === '直矢' && host.glyph, 'big slot ' + JSON.stringify(host));
assert(host.nextOn && host.nextGlyph, 'queued slot ' + JSON.stringify(host));
assert(host.touch && host.touchNext && host.touchNextOn, 'phone icons ' + JSON.stringify(host));
assert(host.driftOn && parseFloat(host.fill) > 80, 'drift meter ' + host.fill);
await page.screenshot({ path: OUT + '/kart-slots-host.png' });

const shifted = await page.evaluate(() => {
  const hud = window.__sky.hud;
  hud._itemShown = 1;
  hud._nextShown = 2;
  hud._roll = null;
  hud._nextRoll = null;
  hud.setBattle({ on: true, item: 2, next: 0, aimed: false, how: 'pad', hitKind: 0 });
  const out = {
    roll: hud._roll,
    name: document.getElementById('itemname').textContent,
    nextHidden: document.getElementById('itemnext').classList.contains('hidden'),
    slotRoll: document.getElementById('itemslot').classList.contains('roll'),
  };
  const v = window.__sky.race.racers.find((r) => r.primary).veh;
  v.item = 1;
  v.itemNext = 2;
  v.driftT = 1.05;
  hud._itemShown = 1;
  hud._nextShown = 2;
  hud._roll = null;
  hud._nextRoll = null;
  hud.setBattle({ on: true, item: 1, next: 2, aimed: false, how: 'pad', hitKind: 0 });
  hud.setDrift(1.05);
  return out;
});
console.log('SHIFT', JSON.stringify(shifted));
assert(!shifted.roll && !shifted.slotRoll && shifted.name === '追蜂' && shifted.nextHidden, 'shift is not a new roll ' + JSON.stringify(shifted));

const phone = await browser.newPage();
await phone.setCacheEnabled(false);
await phone.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
phone.on('pageerror', (e) => console.log('PHONEPAGE', e.message));
await phone.goto(BASE + '?join=ABC234&q=low&noadapt=1&nopauseblur=1&nonet=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
await phone.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
const phoneInfo = await phone.evaluate(() => {
  const sky = window.__sky;
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('touch').classList.remove('hidden');
  document.body.classList.add('touchon', 'items-on');
  sky.game.state = 'race';
  sky.ui.touchMode = 'on';
  const hud = sky.hud;
  hud._itemShown = 0;
  hud._nextShown = 0;
  hud._roll = null;
  hud._nextRoll = null;
  hud.setBattle({ on: true, item: 1, next: 2, aimed: false, how: 'touch', hitKind: 0 });
  hud._roll = null;
  hud._nextRoll = null;
  hud._itemShown = 1;
  hud._nextShown = 2;
  hud.setBattle({ on: true, item: 1, next: 2, aimed: false, how: 'touch', hitKind: 0 });
  hud.setDrift(0.7);
  const pop = document.getElementById('itempop');
  if (pop) pop.classList.add('hidden');
  const count = document.getElementById('count');
  if (count) count.textContent = '';
  hud.setBattle = () => {};
  hud.setDrift = () => {};
  const item = document.querySelector('button.gpad.item');
  const next = document.getElementById('touchItemNext');
  const slot = document.getElementById('itemslot');
  const ir = item.getBoundingClientRect();
  const nr = next.getBoundingClientRect();
  return {
    nextSvg: next.innerHTML.includes('<svg'),
    nextHidden: next.classList.contains('hidden'),
    slotDisplay: getComputedStyle(slot).display,
    itemDisplay: getComputedStyle(item).display,
    w: Math.round(ir.width),
    h: Math.round(ir.height),
    nextInside: nr.width > 0 && nr.right <= ir.right + 2 && nr.bottom <= ir.bottom + 2 && nr.left >= ir.left - 2,
    guest: document.body.classList.contains('guest'),
  };
});
console.log('PHONE', JSON.stringify(phoneInfo));
assert(phoneInfo.guest, 'phone page is a guest');
assert(phoneInfo.nextSvg && !phoneInfo.nextHidden, 'queued icon on the phone ' + JSON.stringify(phoneInfo));
assert(phoneInfo.slotDisplay === 'none', 'guest hides the big slot');
assert(phoneInfo.itemDisplay !== 'none', 'item button shown ' + phoneInfo.itemDisplay);
assert(Math.abs(phoneInfo.w - phoneInfo.h) <= 2 && phoneInfo.w >= 64, 'item button stays square ' + phoneInfo.w + 'x' + phoneInfo.h);
assert(phoneInfo.nextInside, 'queued icon stays inside the button ' + JSON.stringify(phoneInfo));
await phone.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await phone.screenshot({ path: OUT + '/kart-slots-phone.png' });

const drift = await page.evaluate(() => {
  const v = window.__sky.race.racers.find((r) => r.primary).veh;
  v.placeOnTrack(40, 0, 36);
  v.driftT = 0;
  v._driftHeld = false;
  v.boostT = 0;
  v.boostPower = 0;
  v.driftBoost = 0;
  v.spinT = 0;
  const inp = { steer: 1, throttle: 1, brake: 1, lift: false, nitro: false, pitch: 0, item: false };
  let peak = 0;
  for (let i = 0; i < 50; i++) {
    v.step(1 / 60, inp);
    const h = v.heading;
    if (v.speed < 20) {
      v.vel.x = -Math.sin(h) * 32;
      v.vel.z = -Math.cos(h) * 32;
    }
    v.grounded = true;
    if (v.driftT > peak) peak = v.driftT;
  }
  v.step(1 / 60, { steer: 0, throttle: 1, brake: 0, lift: false, nitro: false, pitch: 0, item: false });
  return { peak, boost: v.boostT, power: v.boostPower, tier: v.driftBoost | 0, drift: v.driftT };
});
console.log('DRIFT', JSON.stringify(drift));
assert(drift.peak >= 0.55, 'charge while braking ' + drift.peak);
assert(drift.tier >= 1 && drift.boost >= 0.4, 'release grants a boost ' + JSON.stringify(drift));

await browser.close();
console.log('PASS kart hud');
