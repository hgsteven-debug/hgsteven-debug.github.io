// 手機方向鍵：常見橫向尺寸、安全區、按鍵不重疊、多指同時、車機仍是圓形搖桿。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const SIZES = [[844, 390], [932, 430], [667, 375], [1024, 768]];
const INSETS = [
  { l: 0, r: 0, t: 0, b: 0 },
  { l: 47, r: 47, t: 0, b: 21 },
];

async function bootGuest(page) {
  await page.setCacheEnabled(false);
  await page.goto(BASE + '?join=ABC234&q=low&noadapt=1&nopauseblur=1&nonet=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
  await page.evaluate(() => {
    const sky = window.__sky;
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    document.getElementById('touch').classList.remove('hidden');
    document.getElementById('hud').classList.remove('hidden');
    sky.game.state = 'race';
    sky.hud.setBattle({ on: true, item: 1, aimed: false, how: 'touch' });
    sky.hud._popUntil = 0;
    const pop = document.getElementById('itempop');
    if (pop) pop.classList.add('hidden');
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function measure(page, inset) {
  return page.evaluate((pad) => {
    const root = document.documentElement;
    for (const k of ['l', 'r', 't', 'b']) root.style.setProperty('--safe-' + k, pad[k] + 'px');
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor || '';
      const parts = (bg.match(/[\d.]+/g) || []).map(Number);
      return {
        x: r.x, y: r.y, w: r.width, h: r.height,
        radius: cs.borderRadius,
        touch: cs.touchAction,
        display: cs.display,
        alpha: parts.length >= 4 ? parts[3] : 1,
        bg,
        bw: parseFloat(cs.borderTopWidth) || 0,
      };
    };
    const q = (sel) => rect(document.querySelector(sel));
    return {
      w: innerWidth, h: innerHeight,
      guest: document.body.classList.contains('guest'),
      brake: q('[data-t="brake"]'),
      gas: q('[data-t="gas"]'),
      lift: q('[data-t="lift"]'),
      nitro: q('[data-t="nitro"]'),
      item: q('[data-t="item"]'),
      reset: q('[data-p="reset"]'),
      camera: q('[data-p="camera"]'),
      pause: q('[data-p="pause"]'),
      pup: q('[data-t="pup"]'),
      pdown: q('[data-t="pdown"]'),
      left: q('[data-t="left"]'),
      right: q('[data-t="right"]'),
      map: q('#minimap'),
      full: q('#btnFull'),
      lap: q('#lapbox'),
      speed: q('#speedbox'),
      stick: q('#stick'),
      dpad: q('#dpad'),
    };
  }, inset);
}

function overlaps(a, b) {
  return a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
}
function hGap(a, b) { return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)); }
function vGap(a, b) { return Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)); }
function inside(r, w, h) {
  return r && r.w > 8 && r.h > 8 && r.x >= -1 && r.y >= -1 && r.x + r.w <= w + 1 && r.y + r.h <= h + 1;
}

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await bootGuest(page);
  const keys = ['brake', 'gas', 'lift', 'nitro', 'item', 'reset', 'camera', 'pause', 'pup', 'pdown', 'left', 'right'];
  const hud = ['map', 'full', 'lap', 'speed'];
  for (const [w, h] of SIZES) {
    for (const inset of INSETS) {
      const name = w + 'x' + h + ' inset ' + inset.l + ',' + inset.b;
      await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const box = await measure(page, inset);
      assert(box.guest, name + ' not guest');
      assert(box.stick.display === 'none', name + ' stick shown');
      assert(box.dpad.display !== 'none' && box.dpad.w > 40, name + ' dpad ' + JSON.stringify(box.dpad));
      for (const k of keys) assert(inside(box[k], w, h), name + ' offscreen ' + k + ' ' + JSON.stringify(box[k]));
      for (const k of hud) assert(inside(box[k], w, h), name + ' hud offscreen ' + k + ' ' + JSON.stringify(box[k]));
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          assert(!overlaps(box[keys[i]], box[keys[j]]), name + ' overlap ' + keys[i] + ' ' + keys[j]);
        }
      }
      for (const k of keys) {
        for (const u of hud) assert(!overlaps(box[k], box[u]), name + ' covers ' + u + ' with ' + k);
      }
      assert(hGap(box.lift, box.gas) >= 31, name + ' B/gas gap ' + hGap(box.lift, box.gas));
      assert(vGap(box.nitro, box.gas) >= 31, name + ' A/gas gap ' + vGap(box.nitro, box.gas));
      assert(vGap(box.item, box.lift) >= 31, name + ' item/B gap ' + vGap(box.item, box.lift));
      assert(hGap(box.item, box.nitro) >= 31, name + ' item/A gap ' + hGap(box.item, box.nitro));
      const dgap = hGap(box.left, box.pup);
      assert(dgap >= 8, name + ' dpad gap ' + dgap);
      if (h >= 700) assert(dgap >= 28 && box.pup.w >= 100, name + ' tablet key ' + JSON.stringify(box.pup));
      assert(box.brake.y + 1 >= box.dpad.y + box.dpad.h, name + ' brake not under pad');
      assert(box.gas.w >= box.lift.w - 1 && box.gas.h + 1 >= box.lift.h * 0.9, name + ' gas not largest');
      assert(box.reset.y + 2 >= box.map.y + box.map.h && box.camera.y + 2 >= box.map.y + box.map.h, name + ' XY not under map');
      assert(box.camera.x > box.reset.x, name + ' Y not right of X');
      for (const k of ['gas', 'brake', 'lift', 'pause', 'pup', 'full']) {
        const el = box[k];
        const radius = parseFloat(el.radius);
        assert(radius <= 12, name + ' round ' + k + ' ' + el.radius);
        assert(el.alpha >= 0.34 && el.alpha <= 0.46, name + ' fill ' + k + ' ' + el.bg);
        assert(el.bw >= 2, name + ' outline ' + k);
        assert(el.touch === 'none', name + ' touch-action ' + k + ' ' + el.touch);
      }
      assert(box.left.x >= inset.l - 1 && box.gas.x + box.gas.w <= w - inset.r + 1, name + ' safe inset');
      if (w === 844 && h === 390 && inset.l === 0) await page.screenshot({ path: '/opt/cursor/artifacts/phone-dpad-844x390.png' });
      if (w === 932 && h === 430 && inset.l === 0) await page.screenshot({ path: '/opt/cursor/artifacts/phone-dpad-932x430.png' });
    }
  }
  const multi = await page.evaluate(() => {
    const sky = window.__sky;
    const fire = (sel, type, id) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
        clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, isPrimary: id === 1,
      }));
    };
    fire('[data-t="left"]', 'pointerdown', 11);
    fire('[data-t="gas"]', 'pointerdown', 12);
    fire('[data-t="item"]', 'pointerdown', 13);
    let st = null;
    for (let i = 0; i < 20; i++) st = sky.input.poll(1 / 60);
    const mid = { steer: st.steer, throttle: st.throttle, brake: st.brake, item: st.item, pitch: st.pitch };
    fire('[data-t="left"]', 'pointerup', 11);
    fire('[data-t="gas"]', 'pointerup', 12);
    fire('[data-t="item"]', 'pointerup', 13);
    fire('[data-t="pup"]', 'pointerdown', 14);
    const upPitch = sky.input.poll(1 / 60).pitch;
    fire('[data-t="pup"]', 'pointerup', 14);
    fire('[data-t="pdown"]', 'pointerdown', 15);
    const downPitch = sky.input.poll(1 / 60).pitch;
    fire('[data-t="pdown"]', 'pointerup', 15);
    return { mid, up: upPitch, down: downPitch };
  });
  assert(multi.mid.steer < -0.8 && multi.mid.throttle > 0.5 && multi.mid.item === true && multi.mid.brake === 0, 'multi ' + JSON.stringify(multi));
  assert(multi.up < -0.45 && multi.down > 0.45, 'pitch ' + JSON.stringify(multi));
  if (errors.length) throw new Error(errors.join('\n'));
  ok('guest pad layout and multi-touch');
  await page.close();
} catch (e) { bad('guest pad layout and multi-touch', e); }

try {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.goto(BASE + '?track=canyon&q=low&ai=0&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=1&autostart=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.game.state === 'race', { timeout: 90000 });
  const host = await page.evaluate(() => {
    document.getElementById('touch').classList.remove('hidden');
    document.body.classList.add('touchon', 'items-on');
    const face = getComputedStyle(document.querySelector('.gpad.face.b'));
    const gas = getComputedStyle(document.querySelector('.gpad.gas'));
    const stick = getComputedStyle(document.getElementById('stick'));
    const dpad = getComputedStyle(document.getElementById('dpad'));
    const br = document.querySelector('.gpad.face.b').getBoundingClientRect();
    return {
      guest: document.body.classList.contains('guest'),
      stick: stick.display,
      dpad: dpad.display,
      radius: face.borderRadius,
      faceW: br.width,
      gas: gas.backgroundColor,
    };
  });
  assert(host.guest === false, 'host marked guest');
  assert(host.stick !== 'none' && host.dpad === 'none', 'host pad swapped ' + JSON.stringify(host));
  const radius = parseFloat(host.radius);
  assert(radius >= host.faceW * 0.45, 'host face not round ' + JSON.stringify(host));
  assert(/rgba?\(\s*24\s*,\s*150\s*,\s*64/.test(host.gas), 'host gas recolored ' + host.gas);
  ok('host touch pad unchanged');
  await page.close();
} catch (e) { bad('host touch pad unchanged', e); }

await browser.close();
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('PHONE PAD OK');
