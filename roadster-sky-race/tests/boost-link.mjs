// 手機 B（推進）按住與點一下，要讓房主的車跳起來並扣能量。直連、TURN、中繼各走一次。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const fails = [];
const ok = (name, extra) => console.log('PASS', name, extra || '');
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };

function launch() {
  return puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
    ],
  });
}

async function open(browser, url, before) {
  const page = await browser.newPage();
  await page.setViewport({ width: 915, height: 412, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  if (before) await page.evaluateOnNewDocument(before);
  const u = new URL(url, BASE);
  if (!u.searchParams.has('lang')) u.searchParams.set('lang', 'zh-TW');
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
  return page;
}

async function pressB(page, down) {
  return page.evaluate((hold) => {
    const el = document.querySelector('[data-t="lift"]');
    const r = el.getBoundingClientRect();
    const ev = (type) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 11,
      clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerType: 'touch',
    }));
    ev(hold ? 'pointerdown' : 'pointerup');
    window.__sky.input.poll(1 / 60);
    for (let i = 0; i < 3; i++) window.__sky.net.flushInput();
    return (el.innerText || '').replace(/\s+/g, '');
  }, down);
}

function remoteLift() {
  const r = window.__sky.race && window.__sky.race.racers.find((x) => x.driver && x.driver.kind === 'remote' && !x.parked);
  return !!(r && r.driver.state.lift);
}

async function measure(host, secs) {
  return host.evaluate((sec) => {
    const sky = window.__sky;
    const r = sky.race.racers.find((x) => x.driver && x.driver.kind === 'remote' && !x.parked);
    r.veh.placeOnTrack(200, 0, 0);
    r.veh.energy = 100;
    r.veh.vel.set(0, 0, 0);
    const y0 = r.veh.pos.y;
    const lift = !!r.driver.state.lift;
    sky.game.freeze = true;
    sky.sim(sec);
    sky.net.flushState();
    return {
      lift,
      dy: +(r.veh.pos.y - y0).toFixed(2),
      e: +r.veh.energy.toFixed(1),
      sp: +r.veh.speed.toFixed(2),
    };
  }, secs);
}

async function runPath(browser, name, hostQuery, blockRtc) {
  const host = await open(browser, BASE + '?track=canyon&q=low&ai=0&noadapt=1&nopauseblur=1&nocount=1&debug=1&items=0' + hostQuery);
  await host.waitForFunction(() => window.__sky.net.ready || window.__sky.net.failed, { timeout: 22000 });
  const ready = await host.evaluate(() => window.__sky.net.ready);
  if (!ready) {
    const why = await host.evaluate(() => window.__sky.net.failMsg);
    await host.close();
    throw new Error('host not ready ' + why);
  }
  await host.evaluate(() => window.__sky.startGame());
  const meta = await host.evaluate(() => ({ url: window.__sky.net.url }));
  const phoneUrl = new URL(meta.url, BASE);
  phoneUrl.searchParams.set('track', 'canyon');
  phoneUrl.searchParams.set('noadapt', '1');
  phoneUrl.searchParams.set('nopauseblur', '1');
  phoneUrl.searchParams.set('debug', '1');
  if (hostQuery.includes('forceTurn=1')) phoneUrl.searchParams.set('forceTurn', '1');
  const phone = await open(browser, phoneUrl.toString(), blockRtc ? () => {
    const boom = function () { throw new Error('blocked'); };
    window.RTCPeerConnection = boom;
    window.webkitRTCPeerConnection = boom;
  } : null);
  const start = Date.now();
  let last = {};
  while (Date.now() - start < 30000) {
    last = await phone.evaluate(() => {
      const d = window.__sky.net.debug || {};
      return {
        connected: !!window.__sky.net.connected,
        stage: d.stage || '',
        via: d.via || '',
        pair: d.pair || '',
        state: window.__sky.game.state,
        status: (document.getElementById('joinStatus') || {}).textContent || '',
      };
    });
    const n = await host.evaluate(() => window.__sky.net.remotes);
    if (last.connected && n > 0 && (last.state === 'race' || last.state === 'countdown')) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!last.connected) throw new Error('not linked ' + JSON.stringify(last));
  await phone.waitForFunction(() => window.__sky.game.state === 'race', { timeout: 15000 });
  await phone.bringToFront();
  const label = await pressB(phone, true);
  if (label !== 'B推進') throw new Error('label ' + label);
  const held = await phone.evaluate(() => !!window.__sky.input.state.lift);
  if (!held) throw new Error('phone lift bit ' + held);
  await host.bringToFront();
  await host.waitForFunction(remoteLift, { timeout: 8000, polling: 50 });
  const hold = await measure(host, 0.55);
  if (!(hold.lift && hold.dy >= 1.5 && hold.e <= 88)) throw new Error('hold ' + JSON.stringify(hold));
  await phone.bringToFront();
  await pressB(phone, false);
  await phone.evaluate(() => { for (let i = 0; i < 4; i++) window.__sky.net.flushInput(); });
  await host.bringToFront();
  await host.waitForFunction(() => {
    const r = window.__sky.race.racers.find((x) => x.driver && x.driver.kind === 'remote' && !x.parked);
    return r && !r.driver.state.lift;
  }, { timeout: 8000, polling: 50 });
  await phone.bringToFront();
  await pressB(phone, true);
  await host.bringToFront();
  await host.waitForFunction(remoteLift, { timeout: 8000, polling: 20 });
  const tap = await host.evaluate(() => {
    const sky = window.__sky;
    const r = sky.race.racers.find((x) => x.driver && x.driver.kind === 'remote' && !x.parked);
    r.veh.placeOnTrack(240, 0, 0);
    r.veh.energy = 100;
    r.veh.vel.set(0, 0, 0);
    const y0 = r.veh.pos.y;
    sky.game.freeze = true;
    const cmd = Object.assign({}, r.driver.sample());
    for (let i = 0; i < 3; i++) r.veh.step(1 / 120, cmd);
    r.driver.push({ steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0 });
    let max = r.veh.pos.y;
    for (let i = 0; i < 140; i++) {
      r.veh.step(1 / 120, r.driver.sample());
      if (r.veh.pos.y > max) max = r.veh.pos.y;
    }
    sky.net.flushState();
    return { dy: +(max - y0).toFixed(2), e: +r.veh.energy.toFixed(1), got: !!cmd.lift };
  });
  if (!(tap.got && tap.dy >= 2 && tap.e <= 90)) throw new Error('tap ' + JSON.stringify(tap));
  await host.evaluate(() => window.__sky.net.flushState());
  await phone.waitForFunction(() => {
    const s = window.__sky.net.latest && window.__sky.net.latest.self;
    return !!(s && s.energy <= 92);
  }, { timeout: 8000, polling: 100 });
  const via = await phone.evaluate(() => {
    const d = window.__sky.net.debug || {};
    return { via: d.via || '', stage: d.stage || '', status: (document.getElementById('joinStatus') || {}).textContent || '' };
  });
  const ms = Date.now() - start;
  await phone.close();
  await host.close();
  return { ms, via, hold, tap };
}

const browser = await launch();
try {
  const paths = [
    ['direct', '', false],
    ['turn', '&forceTurn=1', false],
    ['relay', '', true],
  ];
  for (const [name, query, block] of paths) {
    try {
      const r = await runPath(browser, name, query, block);
      const via = (r.via && (r.via.via || r.via.status)) || '';
      if (name === 'direct' && via !== 'direct' && String(r.via.status).indexOf('直連') < 0) throw new Error('not direct ' + JSON.stringify(r.via));
      if (name === 'turn' && via !== 'relay' && String(r.via.status).indexOf('轉送') < 0) throw new Error('not turn ' + JSON.stringify(r.via));
      if (name === 'relay' && via !== 'ws' && String(r.via.status).indexOf('中繼') < 0) throw new Error('not relay ' + JSON.stringify(r.via));
      ok(name, JSON.stringify({ ms: r.ms, via: r.via, hold: r.hold, tap: r.tap }));
    } catch (e) { bad(name, e); }
  }
} finally {
  await browser.close();
}

if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
