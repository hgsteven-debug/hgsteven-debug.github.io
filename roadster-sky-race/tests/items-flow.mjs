// 道具開關：舊存檔開回一次、每個進場路徑都看得到、觸控與手把點得到、五條賽道都有箱子。
import fs from 'fs';
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { migrateStoredItems, store } from '../js/util.js';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const SHOTS = '/opt/cursor/artifacts/flow';
fs.mkdirSync(SHOTS, { recursive: true });

const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

try {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
  store.set('items', '0');
  store.del('itemsRev');
  migrateStoredItems();
  assert(store.get('items') === '1' && store.get('itemsRev') === '1', JSON.stringify({ items: store.get('items'), rev: store.get('itemsRev') }));
  store.set('items', '0');
  migrateStoredItems();
  assert(store.get('items') === '0', 'turned off after the one-shot must stay off');
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert(sw.includes("const CACHE = 'sky-roadster-v7'"), 'cache name');
  assert(main.includes("const SW_REV = 'v7'"), 'sw rev');
  assert(sw.includes('caches.delete'), 'old caches deleted');
  assert(!sw.includes('sky-roadster-v1') && !sw.includes('sky-roadster-v2') && !sw.includes('sky-roadster-v3') && !sw.includes('sky-roadster-v4') && !sw.includes('sky-roadster-v5') && !sw.includes('sky-roadster-v6'), 'old cache still named');
  ok('saved items=0 migrates once, service worker is v7');
} catch (e) { bad('saved items=0 migrates once, service worker is v7', e); }

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function open(extra, before) {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1600, height: 900, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  if (before) await page.evaluateOnNewDocument(before);
  const q = '?q=low&nonet=1&noadapt=1&nopauseblur=1&lang=zh-TW' + (extra || '');
  await page.goto(BASE + q, { waitUntil: 'domcontentloaded', timeout: 90000 });
  return { page, errors };
}

try {
  const { page, errors } = await open('', () => {
    localStorage.setItem('skyroadster.items', JSON.stringify('0'));
    localStorage.removeItem('skyroadster.itemsRev');
    localStorage.setItem('skyroadster.lang', JSON.stringify('zh-TW'));
  });
  await page.waitForFunction(() => window.__sky && window.__sky.ui && window.__sky.ui.current === 'start', { timeout: 90000 });
  const migrated = await page.evaluate(() => ({
    items: JSON.parse(localStorage.getItem('skyroadster.items')),
    rev: JSON.parse(localStorage.getItem('skyroadster.itemsRev')),
    on: window.__sky.itemsOn(),
    start: document.getElementById('startItems').textContent,
  }));
  assert(migrated.items === '1' && migrated.rev === '1' && migrated.on, JSON.stringify(migrated));
  assert(migrated.start === '道具：開啟', migrated.start);
  await page.click('#s-start [data-act="flow-start"]');
  await page.waitForFunction(() => window.__sky.ui.current === 'items');
  const off = await page.evaluate(() => {
    const b = document.querySelector('#s-items [data-items="0"]');
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height };
  });
  assert(off.h >= 64, String(off.h));
  await page.touchscreen.tap(off.x, off.y);
  const touched = await page.evaluate(() => ({
    items: JSON.parse(localStorage.getItem('skyroadster.items')),
    sel: document.querySelector('#s-items [data-items="0"]').classList.contains('sel'),
    on: window.__sky.itemsOn(),
  }));
  assert(touched.items === '0' && touched.sel && !touched.on, JSON.stringify(touched));
  const pad = await page.evaluate(() => {
    const ui = window.__sky.ui;
    let guard = 0;
    while (!(ui.focusEl && ui.focusEl.dataset.items === '1') && guard < 8) { ui.move('up'); guard++; }
    const el = ui.focusEl;
    ui.handleNav({ up: false, down: false, left: false, right: false, confirm: true, back: false });
    return {
      which: el && el.dataset.items,
      items: JSON.parse(localStorage.getItem('skyroadster.items')),
      selOn: document.querySelector('#s-items [data-items="1"]').classList.contains('sel'),
    };
  });
  assert(pad.which === '1' || pad.which === '0', JSON.stringify(pad));
  assert(pad.items === '1' && pad.selOn, JSON.stringify(pad));
  assert(errors.length === 0, errors.join('\n'));
  ok('touch and gamepad can switch items, old 0 is on');
  await page.close();
} catch (e) { bad('touch and gamepad can switch items, old 0 is on', e); }

try {
  const { page, errors } = await open('&items=0&autostart=1&nocount=1&ai=0');
  await page.waitForFunction(() => window.__sky && window.__sky.game.state === 'race', { timeout: 90000 });
  const forced = await page.evaluate(() => window.__sky.itemsOn());
  assert(forced === false, 'url items=0');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sky.ui.current === 'pause');
  await page.click('#s-pause [data-act="restart"]');
  await page.waitForFunction(() => window.__sky.ui.current === 'items');
  const again = await page.evaluate(() => ({
    next: window.__sky.ui.afterItems,
    on: document.querySelector('#s-items [data-items="1"]').classList.contains('sel'),
    h: document.querySelector('#s-items [data-items="1"]').getBoundingClientRect().height,
  }));
  assert(again.next === 'ready' && again.on && again.h >= 64, JSON.stringify(again));
  await page.click('#s-items [data-act="flow-next"]');
  await page.waitForFunction(() => window.__sky.ui.current === 'ready');
  assert(errors.length === 0, errors.join('\n'));
  ok('restart shows the items step');
  await page.close();
} catch (e) { bad('restart shows the items step', e); }

try {
  const { page, errors } = await open('&track=canyon');
  await page.waitForFunction(() => window.__sky && window.__sky.ui.current === 'start', { timeout: 90000 });
  await page.evaluate(() => document.querySelector('#s-start [data-act="flow-start"]').click());
  await page.waitForFunction(() => window.__sky.ui.current === 'items');
  await page.evaluate(() => document.querySelector('#s-items [data-act="flow-next"]').click());
  await page.waitForFunction(() => window.__sky.ui.current === 'mode');
  await page.evaluate(() => document.querySelector('#s-mode [data-mode="solo"]').click());
  await page.waitForFunction(() => window.__sky.ui.current === 'garage');
  await page.evaluate(() => document.querySelector('#s-garage [data-act="flow-next"]').click());
  await page.waitForFunction(() => window.__sky.ui.current === 'tracks');
  await page.evaluate(() => document.querySelector('#tlist [data-track="coast"]').click());
  await page.waitForFunction(() => window.__sky && window.__sky.ui.current === 'tracks' && window.__sky.track.id === 'coast', { timeout: 90000 });
  await page.evaluate(() => document.querySelector('#s-tracks [data-act="flow-next"]').click());
  await page.waitForFunction(() => window.__sky.ui.current === 'items');
  const back = await page.evaluate(() => ({
    seen: window.__sky.ui.itemsSeen,
    next: window.__sky.ui.afterItems,
    on: document.querySelector('#s-items [data-items="1"]').classList.contains('sel'),
  }));
  assert(back.seen && back.next === 'ready' && back.on, JSON.stringify(back));
  assert(errors.length === 0, errors.join('\n'));
  ok('track reload still opens items before ready');
  await page.close();
} catch (e) { bad('track reload still opens items before ready', e); }

try {
  const { page, errors } = await open('&join=ABCD');
  await page.waitForFunction(() => window.__sky && window.__sky.ui && window.__sky.ui.current === 'items', { timeout: 90000 });
  const guest = await page.evaluate(() => {
    const on = document.querySelector('#s-items [data-items="1"]');
    const r = on.getBoundingClientRect();
    on.click();
    return {
      on: on.classList.contains('sel'),
      h: r.height,
      follow: window.__sky.ui.itemsFollowHost,
      items: JSON.parse(localStorage.getItem('skyroadster.items')),
    };
  });
  assert(guest.follow && guest.on && guest.h >= 64, JSON.stringify(guest));
  assert(guest.items === '1', JSON.stringify(guest));
  await page.screenshot({ path: SHOTS + '/zh-guest-items.png' });
  await page.click('#s-items [data-act="flow-next"]');
  await page.waitForFunction(() => window.__sky.ui.current === 'join');
  const join = await page.evaluate(() => document.getElementById('joinItems').textContent);
  assert(join === '道具：開啟（房主）', join);
  await page.screenshot({ path: SHOTS + '/zh-guest-join.png' });
  const phone = await page.evaluate(() => {
    window.__sky.ui.setHostItems(true);
    document.body.classList.add('touchon');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('touch').classList.remove('hidden');
    window.__sky.hud.setBattle({ on: true, item: 0, how: 'touch' });
    const btn = document.querySelector('.gpad.item');
    const badge = document.getElementById('itembadge');
    const cs = getComputedStyle(btn);
    return {
      body: document.body.classList.contains('items-on'),
      display: cs.display,
      badge: badge.textContent,
      hidden: badge.classList.contains('hidden'),
    };
  });
  assert(phone.body && phone.display !== 'none' && !phone.hidden && phone.badge === '道具 ON', JSON.stringify(phone));
  assert(errors.length === 0, errors.join('\n'));
  ok('guest phone sees items on');
  await page.close();
} catch (e) { bad('guest phone sees items on', e); }

try {
  const { page, errors } = await open('&autostart=1&nocount=1&ai=0&track=canyon');
  await page.waitForFunction(() => window.__sky && window.__sky.game.state === 'race' && window.__sky.battle && window.__sky.battle.boxes.length > 2, { timeout: 90000 });
  const counts = await page.evaluate(async () => {
    const { Track } = await import('./js/track.js');
    const { layoutBoxes } = await import('./js/items.js');
    const out = {};
    for (const id of ['canyon', 'coast', 'alpine', 'city', 'moon']) out[id] = layoutBoxes(new Track(id)).length;
    const tr = window.__sky.track;
    const boxes = window.__sky.battle.boxes.filter((b) => b.alive);
    let best = boxes[0];
    let bestTurn = 99;
    for (const b of boxes) {
      const a = tr.wrap(b.i - 4);
      const c = tr.wrap(b.i + 4);
      const dot = tr.tx[a] * tr.tx[c] + tr.tz[a] * tr.tz[c];
      const turn = 1 - dot;
      if (turn < bestTurn) { bestTurn = turn; best = b; }
    }
    window.__sky.game.freeze = true;
    window.__sky.veh.placeOnTrack(tr.wrap(best.i - 4), 0, 0);
    const renderer = window.__sky.renderer;
    const orig = renderer.render.bind(renderer);
    const i = best.i;
    renderer.render = function (scene, camera) {
      camera.position.set(best.x - tr.tx[i] * 11, best.y + 2.4, best.z - tr.tz[i] * 11);
      camera.up.set(0, 1, 0);
      camera.lookAt(best.x, best.y, best.z);
      camera.fov = 48;
      camera.updateProjectionMatrix();
      return orig(scene, camera);
    };
    return { tracks: out, live: window.__sky.battle.boxes.length, on: window.__sky.itemsOn() };
  });
  for (const id of ['canyon', 'coast', 'alpine', 'city', 'moon']) {
    assert(counts.tracks[id] >= 8, id + ' ' + counts.tracks[id]);
  }
  assert(counts.live >= 8 && counts.on, JSON.stringify(counts));
  await new Promise((r) => setTimeout(r, 700));
  const badge = await page.evaluate(() => {
    const el = document.getElementById('itembadge');
    return { text: el.textContent, hidden: el.classList.contains('hidden'), hud: document.getElementById('hud').classList.contains('hidden') };
  });
  assert(badge.text === '道具 ON' && !badge.hidden && !badge.hud, JSON.stringify(badge));
  await page.screenshot({ path: SHOTS + '/zh-race-boxes.png' });
  assert(errors.length === 0, errors.join('\n'));
  ok('item boxes on all five tracks');
  await page.close();
} catch (e) { bad('item boxes on all five tracks', e); }

await browser.close();
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
