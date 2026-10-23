// 使用道具：舊按鍵存檔補上 R、手把索引 5、手機點按、輪盤期間的按鍵排隊。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { DEFAULT_BINDINGS, PROFILES, migrateBindings } from '../js/input.js';
import { ITEM, ITEM_PRESS_QUEUE_S, ItemBattle } from '../js/items.js';
import { ITEM_POP_MS, ITEM_ROLL_MS } from '../js/itemart.js';

const fails = [];
const ok = (name, extra) => console.log('PASS', name, extra || '');
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

const OLD = {
  steer: { t: 'a', i: 0, m: 'full', inv: false },
  pitch: { t: 'a', i: 1, m: 'full', inv: true },
  throttle: { t: 'b', i: 7 },
  brake: { t: 'b', i: 6 },
  lift: { t: 'b', i: 0 },
  nitro: { t: 'b', i: 1 },
  camera: { t: 'b', i: 2 },
  reset: { t: 'b', i: 3 },
  pause: { t: 'b', i: 9 },
};

function testMigrate() {
  assert(DEFAULT_BINDINGS.item.i === 5 && DEFAULT_BINDINGS.throttle.i === 7 && DEFAULT_BINDINGS.brake.i === 6, 'defaults');
  assert(PROFILES.switch.item === 'R' && PROFILES.xbox.item === 'RB', 'profile labels');
  const added = migrateBindings(OLD);
  assert(added.changed, 'old profile should be rewritten');
  assert(added.bindings.item.t === 'b' && added.bindings.item.i === 5, 'useItem defaults to R');
  assert(added.bindings.throttle.i === 7 && added.bindings.brake.i === 6, 'ZR/ZL stay');
  const broken = migrateBindings(Object.assign({}, OLD, { item: { t: 'b' } }));
  assert(broken.changed && broken.bindings.item.i === 5, 'item row without an index');
  const custom = migrateBindings(Object.assign({}, OLD, { item: { t: 'b', i: 4 }, throttle: { t: 'b', i: 7 } }));
  assert(!custom.changed && custom.bindings.item.i === 4 && custom.bindings.throttle.i === 7, 'a saved item index stays');
  const fresh = migrateBindings(null);
  assert(fresh.bindings.item.i === 5 && fresh.bindings.brake.i === 6, 'empty store');
}

function racer() {
  return {
    name: 'P1', netId: 'P1', parked: false, lap: { n: 1 },
    driver: { kind: 'local', input: { state: { item: false } }, state: {} },
    veh: {
      pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 }, heading: 0,
      tr: { N: 8 }, q1: { fi: 0 }, item: 0, spinT: 0, iFrame: 0, shield: false, shieldT: 0,
      boostT: 0, slowT: 0, aimed: false, attached: false,
    },
  };
}

function testQueue() {
  assert(ITEM_PRESS_QUEUE_S <= 0.6, 'queue ' + ITEM_PRESS_QUEUE_S);
  assert(ITEM_ROLL_MS <= 600 && ITEM_ROLL_MS >= 400, 'roll ' + ITEM_ROLL_MS);
  assert(ITEM_POP_MS >= 900 && ITEM_POP_MS <= 1200, 'pop ' + ITEM_POP_MS);
  const battle = new ItemBattle({ N: 8, px: [], py: [], pz: [] }, [], () => 0);
  const me = racer();
  me.driver.input.state.item = true;
  battle.step(1 / 60, [me]);
  me.driver.input.state.item = false;
  battle.step(1 / 60, [me]);
  for (let i = 0; i < 20; i++) battle.step(1 / 60, [me]);
  me.veh.item = ITEM.SPARK;
  battle.step(1 / 60, [me]);
  assert(me.veh.item === 0 && battle.shots.length === 1, 'press queued through the roll fired the dart');

  const late = new ItemBattle({ N: 8, px: [], py: [], pz: [] }, [], () => 0);
  const held = racer();
  held.driver.input.state.item = true;
  late.step(1 / 60, [held]);
  held.driver.input.state.item = false;
  for (let i = 0; i < 50; i++) late.step(1 / 60, [held]);
  held.veh.item = ITEM.SPARK;
  late.step(1 / 60, [held]);
  assert(held.veh.item === ITEM.SPARK && late.shots.length === 0, 'a press older than 0.6s does not fire');

  const live = new ItemBattle({ N: 8, px: [], py: [], pz: [] }, [], () => 0);
  const now = racer();
  now.veh.item = ITEM.SPARK;
  now.driver.input.state.item = true;
  live.step(1 / 60, [now]);
  assert(now.veh.item === 0 && live.shots.length === 1, 'press skips the roll');

  const stuck = new ItemBattle({ N: 8, px: [], py: [], pz: [] }, [], () => 0);
  const hold = racer();
  hold.driver.input.state.item = true;
  stuck.step(1 / 60, [hold]);
  for (let i = 0; i < 70; i++) stuck.step(1 / 60, [hold]);
  hold.veh.item = ITEM.SPARK;
  stuck.step(1 / 60, [hold]);
  assert(hold.veh.item === ITEM.SPARK && stuck.shots.length === 0, 'holding R into the box does not fire');
}

try { testMigrate(); ok('saved bindings migrate to R'); } catch (e) { bad('saved bindings migrate to R', e); }
try { testQueue(); ok('roulette queues the press'); } catch (e) { bad('roulette queues the press', e); }

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function boot(viewport) {
  const page = await browser.newPage();
  if (viewport) await page.setViewport(viewport);
  page.on('pageerror', (e) => console.log('PAGE', e.message));
  await page.evaluateOnNewDocument((saved) => {
    localStorage.setItem('skyroadster.bindings', JSON.stringify(saved));
  }, OLD);
  const url = BASE + '?track=canyon&q=low&ai=0&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=1&autostart=1&lang=zh-TW';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.game.state === 'race' && window.__sky.battle, { timeout: 90000 });
  return page;
}

try {
  const page = await boot({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const migrated = await page.evaluate(() => {
    const sky = window.__sky;
    const saved = JSON.parse(localStorage.getItem('skyroadster.bindings'));
    return {
      mem: sky.input.bindings.item,
      thr: sky.input.bindings.throttle.i,
      brk: sky.input.bindings.brake.i,
      disk: saved.item,
      diskThr: saved.throttle.i,
      diskBrk: saved.brake.i,
    };
  });
  assert(migrated.mem && migrated.mem.i === 5 && migrated.disk && migrated.disk.i === 5, 'migrated item ' + JSON.stringify(migrated));
  assert(migrated.thr === 7 && migrated.brk === 6 && migrated.diskThr === 7 && migrated.diskBrk === 6, 'triggers ' + JSON.stringify(migrated));

  const fired = await page.evaluate(() => {
    const installPad = (pressed, id) => {
      const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: i === pressed, value: i === pressed ? 1 : 0 }));
      const gp = { id, index: 0, connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0], timestamp: performance.now() };
      navigator.getGamepads = () => [gp];
    };
    const sky = window.__sky;
    sky.game.freeze = true;
    const me = sky.race.racers.find((r) => r.primary);
    me.veh.item = 1;
    me._itemLatch = false;
    me._itemQueueT = 0;
    sky.battle.shots.length = 0;
    installPad(5, 'JOWUA Pro Controller');
    sky.input.poll(1 / 60);
    const down = !!sky.input.state.item;
    sky.battle.step(1 / 60, sky.race.racers);
    installPad(-1, 'Xbox Wireless Controller');
    sky.input.padIndex = null;
    sky.input.poll(1 / 60);
    const released = !!sky.input.state.item;
    installPad(5, 'Xbox Wireless Controller (045e)');
    sky.input.poll(1 / 60);
    return {
      down, released, xbox: !!sky.input.state.item, profile: sky.input.profile.id,
      item: me.veh.item, shots: sky.battle.shots.length,
    };
  });
  console.log('PAD', JSON.stringify(fired));
  assert(fired.down && fired.item === 0 && fired.shots >= 1, 'R did not fire ' + JSON.stringify(fired));
  assert(fired.released === false && fired.xbox === true && fired.profile === 'xbox', 'RB ' + JSON.stringify(fired));

  const key = await page.evaluate(() => {
    const sky = window.__sky;
    navigator.getGamepads = () => [];
    sky.input.padIndex = null;
    sky.input.poll(1 / 60);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', bubbles: true }));
    sky.input.poll(1 / 60);
    const once = !!sky.input.state.item;
    sky.input.poll(1 / 60);
    return { once, again: !!sky.input.state.item };
  });
  assert(key.once === true && key.again === false, 'KeyF tap ' + JSON.stringify(key));
  await page.close();
  ok('gamepad R and KeyF');
} catch (e) { bad('gamepad R and KeyF', e); }

try {
  const phone = await boot({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const tap = await phone.evaluate(() => {
    const sky = window.__sky;
    sky.ui.touchMode = 'on';
    sky.game.freeze = true;
    document.getElementById('touch').classList.remove('hidden');
    document.body.classList.add('touchon', 'items-on');
    const el = document.querySelector('.gpad.item');
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const rect = (node) => {
      if (!node) return null;
      const b = node.getBoundingClientRect();
      return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height };
    };
    const item = rect(el);
    const others = {
      gas: rect(document.querySelector('.gpad.gas')),
      brake: rect(document.querySelector('.gpad.brake')),
      pause: rect(document.querySelector('.gpad.menu')),
      full: rect(document.getElementById('btnFull')),
      map: rect(document.getElementById('minimap')),
      y: rect(document.querySelector('.gpad.face.y')),
      b: rect(document.querySelector('.gpad.face.b')),
    };
    const overlap = (a, b) => a && b && a.x < b.r - 1 && a.r > b.x + 1 && a.y < b.b - 1 && a.b > b.y + 1;
    const hits = Object.keys(others).filter((k) => overlap(item, others[k]));
    const under = document.elementFromPoint(x, y);
    const host = under && under.closest ? under.closest('[data-t]') : null;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, pointerType: 'touch' }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, pointerType: 'touch' }));
    const held = !!sky.input.touch.item;
    sky.input.poll(1 / 60);
    const after = !!sky.input.state.item;
    sky.input.poll(1 / 60);
    const touch = new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
    document.getElementById('touch').dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true, touches: [touch], changedTouches: [touch],
    }));
    sky.input.poll(1 / 60);
    return {
      hit: host && host.dataset.t, held, after, again: !!sky.input.state.item,
      w: item.w, h: item.h, hits,
    };
  });
  console.log('TAP', JSON.stringify(tap));
  assert(tap.hit === 'item' && tap.w >= 100 && tap.h >= 70, 'target ' + JSON.stringify(tap));
  assert(!tap.hits.length, 'overlaps ' + tap.hits.join(','));
  assert(tap.held === false && tap.after === true && tap.again === true, 'tap did not reach poll ' + JSON.stringify(tap));
  await phone.close();
  ok('phone item tap');
} catch (e) { bad('phone item tap', e); }

await browser.close();
if (fails.length) { console.error('FAILED', fails.join(', ')); process.exit(1); }
console.log('INPUT OK');
