// 道具介面：小圖示留在角落，彈出訊息不擋路中央，也不壓到速度、小地圖、圈數。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const OUT = '/opt/cursor/artifacts';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function hits(a, b) {
  if (!a || !b || a.w < 2 || b.w < 2) return false;
  return a.x < b.r - 2 && a.r > b.x + 2 && a.y < b.b - 2 && a.b > b.y + 2;
}

async function boot(width, height, touch) {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
  await page.goto(BASE + '?track=canyon&q=low&ai=0&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=1&autostart=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.game.state === 'race' && window.__sky.hud, { timeout: 90000 });
  return page;
}

function showItems() {
  const sky = window.__sky;
  sky.game.freeze = true;
  const count = document.getElementById('count');
  if (count) count.textContent = '';
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('touch').classList.remove('hidden');
  document.body.classList.add('touchon', 'items-on');
  const hud = sky.hud;
  hud._itemShown = 0;
  hud._nextShown = 0;
  hud._roll = null;
  hud._nextRoll = null;
  hud._popUntil = 0;
  hud.setBattle({ on: true, item: 1, next: 4, aimed: true, how: 'pad', hitKind: 1, hitBlock: false });
  hud._roll = null;
  hud._nextRoll = null;
  hud._popUntil = performance.now() + 60000;
  hud._hitUntil = performance.now() + 60000;
  hud.setBattle({ on: true, item: 1, next: 4, aimed: true, how: 'pad', hitKind: 1, hitBlock: false });
  const rect = (el) => {
    if (!el) return { x: 0, y: 0, w: 0, h: 0, r: 0, b: 0, display: 'none' };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, display: cs.display };
  };
  const glyph = document.getElementById('itemglyph');
  const next = document.getElementById('itemnextglyph');
  return {
    phone: document.body.classList.contains('phone'),
    vw: innerWidth,
    vh: innerHeight,
    slot: rect(document.getElementById('itemslot')),
    glyph: rect(glyph),
    next: rect(next),
    pop: rect(document.getElementById('itempop')),
    hit: rect(document.getElementById('itemhit')),
    warn: rect(document.getElementById('itemwarn')),
    speed: rect(document.getElementById('speedbox')),
    lap: rect(document.getElementById('lapbox')),
    map: rect(document.getElementById('minimap')),
    stand: rect(document.getElementById('standings')),
    itemKey: rect(document.querySelector('.gpad.item')),
    name: document.getElementById('itemname').textContent,
  };
}

const host = await boot(1920, 1080, true);
const hostBox = await host.evaluate(showItems);
console.log('HOST', JSON.stringify(hostBox));
assert(hostBox.phone === false, 'tesla-sized host became a phone');
assert(hostBox.slot.display !== 'none' && hostBox.glyph.w >= 40 && hostBox.glyph.w <= 52, 'host glyph ' + hostBox.glyph.w);
assert(hostBox.next.w > 0 && hostBox.next.w < hostBox.glyph.w - 4, 'next icon not smaller ' + hostBox.next.w + ' vs ' + hostBox.glyph.w);
assert(hostBox.slot.w <= 120 && hostBox.slot.h <= 90, 'host slot still a panel ' + hostBox.slot.w + 'x' + hostBox.slot.h);
assert(hostBox.slot.x > hostBox.vw * 0.7, 'host slot is not in the right corner');
assert(hostBox.pop.w <= 220 && hostBox.pop.h <= 56, 'host pop ' + hostBox.pop.w + 'x' + hostBox.pop.h);
assert(hostBox.pop.x > hostBox.vw * 0.55, 'host pop sits over the road');
assert(hostBox.name === '直矢', 'slot name ' + hostBox.name);
for (const key of ['speed', 'lap', 'map']) {
  for (const piece of ['slot', 'pop', 'hit', 'warn']) {
    assert(!hits(hostBox[piece], hostBox[key]), 'host ' + piece + ' overlaps ' + key);
  }
}
await host.evaluate(() => {
  document.getElementById('itemhit').classList.add('hidden');
  document.getElementById('itemwarn').classList.add('hidden');
});
await host.screenshot({ path: OUT + '/item-hud-host.png' });
await host.close();

const phone = await boot(844, 390, true);
const phoneBox = await phone.evaluate(showItems);
console.log('PHONE', JSON.stringify(phoneBox));
assert(phoneBox.phone === true, 'landscape phone did not get the phone layout');
assert(phoneBox.slot.display === 'none', 'phone still shows the big slot');
assert(phoneBox.pop.display !== 'none' && phoneBox.pop.h <= 48 && phoneBox.pop.w <= 180, 'phone pop ' + JSON.stringify(phoneBox.pop));
assert(phoneBox.pop.x > phoneBox.vw * 0.45, 'phone pop is not beside the item key');
assert(phoneBox.pop.y > phoneBox.vh * 0.35, 'phone pop is still in the upper centre');
for (const key of ['speed', 'lap', 'map', 'itemKey']) {
  for (const piece of ['pop', 'hit', 'warn']) {
    assert(!hits(phoneBox[piece], phoneBox[key]), 'phone ' + piece + ' overlaps ' + key);
  }
}
await phone.evaluate(() => {
  document.getElementById('itemhit').classList.add('hidden');
  document.getElementById('itemwarn').classList.add('hidden');
});
await phone.screenshot({ path: OUT + '/item-hud-phone.png' });
await phone.close();

await browser.close();
console.log('ITEM HUD SIZE OK');
