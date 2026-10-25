// 同步單元測試（不需要網路）＋ 兩個瀏覽器情境的手機加入（PeerJS 連得到才跑）。
import fs from 'fs';
import crypto from 'crypto';
import * as sync from '../js/sync.js';
import * as ice from '../js/ice.js';
import * as relay from '../js/relay.js';
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function yawQuat(rad) {
  const h = rad / 2;
  return { qx: 0, qy: Math.sin(h), qz: 0, qw: Math.cos(h) };
}

function testCodes() {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = sync.makeRoomCode();
    assert(c.length === 6, c);
    for (const ch of c) assert(sync.ROOM_ALPHABET.includes(ch), c);
    seen.add(c);
    assert(/^skyroadster-[A-Z2-9]+$/.test(sync.peerIdFor(c)), sync.peerIdFor(c));
  }
  assert(seen.size > 180, 'codes collided too often ' + seen.size);
  assert(sync.normalizeCode(' ab2-cde ') === 'AB2CDE');
  assert(sync.formatCode('AB2CDE') === 'AB2-CDE');
  assert(sync.joinUrl('ab2cde', { hostname: 'hgsteven-debug.github.io', pathname: '/roadster-sky-race/' }) === 'https://hgsteven-debug.github.io/?join=AB2CDE');
  assert(sync.joinUrl('AB2CDE', { hostname: '127.0.0.1', origin: 'http://127.0.0.1:8137', pathname: '/' }) === 'http://127.0.0.1:8137/?join=AB2CDE');
  const msg = sync.failText({ type: 'network' });
  assert(msg.includes('NAT'), msg);
  assert(sync.REMOTE_LIMIT >= 1);
}

function testInputs() {
  const packed = sync.packInput({ steer: -0.1234, throttle: 1, brake: 0, lift: 1, nitro: 0, pitch: 0.2 });
  assert(packed.steer === -0.123 && packed.throttle === 1 && packed.lift === true && packed.nitro === false && packed.pitch === 0.2, JSON.stringify(packed));
  assert(sync.sameInput(packed, sync.unpackInput(packed)));
  const remote = { lastAt: 1000, cmd: packed };
  assert(sync.heldInput(remote, 1400).throttle === 1);
  assert(sync.heldInput(remote, 1400).lift === true);
  const stale = sync.heldInput(remote, 1601);
  assert(stale.throttle === 0 && stale.steer === 0 && stale.lift === false, JSON.stringify(stale));
  assert(sync.heldInput(null, 0).throttle === 0);
  assert(sync.heldInput({ lastAt: 0, cmd: packed }, 1000).brake === 0);
}

function testReconcile() {
  const log = [{ seq: 2, cmd: sync.zeroInput(), steps: 4 }];
  const near = sync.reconcileDecision({ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }, 1, log);
  assert(near.mode === 'nudge' && near.replay.length === 0, JSON.stringify(near));
  const mid = sync.reconcileDecision({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, 1, log);
  assert(mid.mode === 'replay' && mid.replay.length === 1 && mid.replay[0].seq === 2, JSON.stringify(mid));
  const far = sync.reconcileDecision({ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }, 1, log);
  assert(far.mode === 'snap' && far.replay.length === 0, JSON.stringify(far));
  const none = sync.reconcileDecision({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, 1, []);
  assert(none.mode === 'snap', none.mode);
  const q = sync.slerpQuat(yawQuat(0), yawQuat(Math.PI / 2), 0.5);
  const half = Math.PI / 8;
  assert(Math.abs(q.qy - Math.sin(half)) < 1e-3 && Math.abs(q.qw - Math.cos(half)) < 1e-3, JSON.stringify(q));
}

function pose(id, x, extra) {
  return Object.assign({ id, x, y: 0, z: 0, vx: 0, vy: 0, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1, heading: 0, speed: 0 }, extra || {});
}

function testBuffer() {
  const buf = new sync.StateBuffer(100);
  buf.push(1000, [pose('p1', 0)]);
  buf.push(1100, [pose('p1', 10)]);
  const mid = buf.sample(1150);
  assert(mid.length === 1 && Math.abs(mid[0].x - 5) < 0.02, JSON.stringify(mid));
  const jump = new sync.StateBuffer(100);
  jump.push(0, [pose('p1', 0)]);
  jump.push(100, [pose('p1', 80)]);
  const snapped = jump.sample(150);
  assert(snapped[0].x === 80, 'jump smear ' + snapped[0].x);
  const ext = new sync.StateBuffer(100);
  ext.push(1000, [pose('p1', 0, { vx: 10 })]);
  const held = ext.sample(1000);
  assert(held[0].x === 0, 'early ' + held[0].x);
  const later = ext.sample(1600);
  assert(Math.abs(later[0].x - 0.8) < 0.02, 'extrapolate ' + later[0].x);
  const gone = new sync.StateBuffer(100);
  gone.push(0, [pose('p1', 0), pose('ai', 3)]);
  gone.push(100, [pose('p1', 2)]);
  const left = gone.sample(150);
  assert(left.length === 1 && left[0].id === 'p1', JSON.stringify(left));
}

try { testCodes(); ok('room code / join url'); }
catch (e) { bad('room code / join url', e); }
try { testInputs(); ok('input pack / stale coast'); }
catch (e) { bad('input pack / stale coast', e); }
try { testReconcile(); ok('reconcile / slerp'); }
catch (e) { bad('reconcile / slerp', e); }
try { testBuffer(); ok('snapshot interpolation'); }
catch (e) { bad('snapshot interpolation', e); }

function testGuestSmooth() {
  const vis = { x: 0, y: 0, z: 0, heading: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, ready: true };
  const moved = sync.easeGuestPose(vis, { x: 4, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, heading: 0, speed: 10 }, 1 / 60);
  assert(moved.step < 0.4 && moved.step > 0.05 && !moved.snapped, JSON.stringify(moved));
  const fwd = sync.easeGuestPose(
    { x: 0, y: 0, z: 0, heading: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, ready: true },
    { x: 0, y: 0, z: -4, qx: 0, qy: 0, qz: 0, qw: 1, heading: 0, speed: 40 },
    1 / 60,
  );
  assert(fwd.step > moved.step && fwd.step < 1.5 && fwd.z < -0.4, JSON.stringify(fwd));
  const wobble = { x: 0, y: 0, z: 0, heading: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 30, ready: true };
  let sideStep = 0;
  for (let i = 0; i < 20; i++) {
    const before = wobble.x;
    sync.easeGuestPose(wobble, { x: i % 2 ? 1 : -1, y: 0, z: -i * 0.7, heading: 0, qw: 1, speed: 40 }, 1 / 60);
    sideStep = Math.max(sideStep, Math.abs(wobble.x - before));
  }
  assert(sideStep < 0.12 && wobble.z < -3, JSON.stringify({ sideStep, z: wobble.z }));
  const far = sync.easeGuestPose({ x: 0, y: 0, z: 0, ready: true, qx: 0, qy: 0, qz: 0, qw: 1 }, { x: 40, y: 0, z: 0, qw: 1 }, 1 / 60);
  assert(far.snapped && far.x === 40, JSON.stringify(far));
  const road = { known: false, onRoad: true, since: 0, toastAt: 0 };
  const still = sync.hostOffroadWarn(road, true, 1000);
  assert(!still.warn, 'on road warned');
  const early = sync.hostOffroadWarn(still.state, false, 1100);
  assert(!early.warn, 'warned too soon');
  const later = sync.hostOffroadWarn(early.state, false, 1700);
  assert(later.warn, 'missed off-track warning');
  const again = sync.hostOffroadWarn(later.state, false, 2000);
  assert(!again.warn, 'repeated warning');
  const back = sync.hostOffroadWarn(again.state, true, 2100);
  assert(!back.warn && back.state.onRoad === true, JSON.stringify(back));
  assert(sync.wantCssRotate({ type: 'portrait-primary', sw: 800, sh: 400, iw: 390, ih: 844 }, 'native') === true);
  assert(sync.wantCssRotate({ type: 'portrait-primary', sw: 400, sh: 800, iw: 844, ih: 390 }, 'css') === false);
  assert(sync.wantCssRotate({ type: 'landscape-primary', sw: 400, sh: 800, iw: 390, ih: 700 }, 'css') === false);
  assert(sync.wantCssRotate({ type: '', sw: 844, sh: 430 }, 'native') === false, 'url bar jitter');
  assert(sync.wantCssRotate({ type: '', sw: 390, sh: 760 }, 'css') === true);
  assert(sync.wantCssRotate({ type: '', sw: 844, sh: 390 }, 'css') === false);
  // 瀏覽器已橫向就不要再 CSS 轉。angle 和 window.orientation 不一致時也不要轉兩次。
  assert(sync.wantCssRotate({ type: 'portrait-primary', angle: 90, win: 0, iw: 915, ih: 412 }, 'css') === false, 'angle landscape, portrait type');
  assert(sync.wantCssRotate({ type: 'portrait-primary', angle: 0, win: 90, iw: 800, ih: 760 }, 'css') === false, 'window.orientation landscape');
  assert(sync.wantCssRotate({ type: 'landscape-secondary', angle: 270, win: 90, iw: 390, ih: 844 }, 'css') === false, 'type landscape wins');
  assert(sync.wantCssRotate({ type: 'portrait-primary', angle: 0, win: 90, iw: 412, ih: 915 }, '') === true, 'layout still portrait');
  assert(sync.phoneHeldPortrait({ iw: 390, ih: 664 }) === true, 'portrait chrome');
  assert(sync.phoneHeldPortrait({ iw: 390, ih: 844 }) === true, 'portrait full');
  assert(sync.phoneHeldPortrait({ iw: 844, ih: 390 }) === false, 'landscape full');
  assert(sync.phoneHeldPortrait({ iw: 844, ih: 320 }) === false, 'landscape short');
  assert(sync.phoneHeldPortrait({ type: 'landscape-primary', iw: 390, ih: 700 }) === true, 'viewport wins over type');
  const right = sync.viewportDeltaToUi(0, 40, 0, 1, -1, 0);
  const left = sync.viewportDeltaToUi(0, -40, 0, 1, -1, 0);
  const up = sync.viewportDeltaToUi(30, 0, 0, 1, -1, 0);
  const ident = sync.viewportDeltaToUi(25, -10, 1, 0, 0, 1);
  assert(right.x > 30 && Math.abs(right.y) < 1, JSON.stringify(right));
  assert(left.x < -30 && Math.abs(left.y) < 1, JSON.stringify(left));
  assert(up.y < -20 && Math.abs(up.x) < 1, JSON.stringify(up));
  assert(Math.abs(ident.x - 25) < 1e-6 && Math.abs(ident.y + 10) < 1e-6, JSON.stringify(ident));
  const packed = sync.packSelf({ x: 1.239, y: 2, z: 3, vx: 10.129, vy: 0, vz: 0, onRoad: false, speed: 12.3456, qw: 1 });
  assert(packed.x === 1.24 && packed.speed === 12.35 && packed.onRoad === false, JSON.stringify(packed));
  assert(JSON.stringify(packed).length < 400, 'self payload ' + JSON.stringify(packed).length);
}

try { testGuestSmooth(); ok('guest smooth / off-track / orientation'); }
catch (e) { bad('guest smooth / off-track / orientation', e); }

function testIceList() {
  const list = ice.iceServers();
  const urls = list.map((s) => (Array.isArray(s.urls) ? s.urls.join(',') : String(s.urls)));
  const blob = urls.join('\n');
  assert(blob.includes('stun:stun.l.google.com:19302'), 'missing public stun');
  assert(blob.includes('stun:stun.cloudflare.com:3478'), 'missing cloudflare stun');
  assert(blob.includes('global.relay.metered.ca'), 'missing metered turn');
  assert(blob.includes('transport=tcp'), 'missing tcp turn');
  assert(blob.includes('turns:'), 'missing turns');
  assert(!blob.includes('turn.peerjs.com'), 'peerjs turn leaked in');
  assert(!blob.includes('openrelay.metered.ca'), 'public open relay still allocated');
  const turn = list.find((s) => s.username);
  assert(!!(turn && turn.username && turn.credential), 'turn entry missing static auth');
  assert(!String(turn.urls).includes('stun:'), 'stun row was given a username');
  const cfg = ice.rtcConfig(0, '');
  assert(cfg.iceTransportPolicy === 'all', cfg.iceTransportPolicy);
  assert(ice.iceTransportPolicy('?forceTurn=1') === 'relay', 'forceTurn');
  assert(ice.iceTransportPolicy('?lang=en&forceTurn=1') === 'relay', 'forceTurn query');
  assert(ice.ICE_TRANSPORT_POLICY === 'all', 'default policy');
  const root = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert(root.includes('location.search + location.hash'), 'root redirect dropped the query');
  const pub = relay.mqttPublish('skyroadster/v1/ABC', '{"t":"ping"}');
  assert(relay.mqttPayload(pub) === '{"t":"ping"}', relay.mqttPayload(pub));
}

function probeRelay(spec) {
  return new Promise((resolve) => {
    let ws = null;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { if (ws) ws.close(); } catch (e) {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 4000);
    try {
      ws = new WebSocket(spec.url, ['mqtt']);
      ws.onopen = () => { clearTimeout(timer); finish(true); };
      ws.onerror = () => { clearTimeout(timer); finish(false); };
    } catch (e) {
      clearTimeout(timer);
      finish(false);
    }
  });
}

async function testRelay() {
  const up = [];
  await Promise.all(relay.RELAYS.map(async (spec, i) => { if (await probeRelay(spec)) up.push(i); }));
  if (!up.length) {
    console.log('SKIP websocket relay (no public broker answered)');
    return;
  }
  const index = up[0];
  const code = 'ZZ' + Math.random().toString(36).slice(2, 6);
  let got = null;
  const opt = { index, epoch: 0, role: 'guest' };
  const b = relay.connectRelay(code, { onMessage: (m) => { if (m && m.from === 'a') got = m; } }, opt);
  const a = relay.connectRelay(code, {}, opt);
  const start = Date.now();
  while ((!a.open || !b.open) && Date.now() - start < 12000) await new Promise((r) => setTimeout(r, 50));
  assert(a.open && b.open, 'relay not open ' + a.reason + ' / ' + b.reason + ' index ' + index);
  assert(a.index === index && b.index === index, 'split brokers ' + a.index + ' ' + b.index);
  a.send({ t: 'ping', from: 'a', n: 7 });
  const wait = Date.now();
  while (!got && Date.now() - wait < 5000) await new Promise((r) => setTimeout(r, 50));
  a.close(); b.close();
  assert(got && got.n === 7, JSON.stringify(got));
  console.log('relay broker', relay.RELAYS[index].label);
}

try { testIceList(); ok('ice servers / root redirect'); }
catch (e) { bad('ice servers / root redirect', e); }
try { await testRelay(); ok('websocket relay'); }
catch (e) { bad('websocket relay', e); }

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});

async function openPage(url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  const u = new URL(url, BASE);
  if (!u.searchParams.has('lang')) u.searchParams.set('lang', 'zh-TW');
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
  return { page, errors };
}

async function waitLink(hostPage, phonePage, ms) {
  const start = Date.now();
  let last = {};
  while (Date.now() - start < ms) {
    try {
      last = {
        host: await hostPage.evaluate(() => window.__sky && ({
          ready: window.__sky.net.ready, remotes: window.__sky.net.remotes, track: window.__sky.track.id, fail: window.__sky.net.failMsg,
        })),
        phone: await phonePage.evaluate(() => window.__sky && ({
          connected: window.__sky.net.connected, state: window.__sky.game.state, track: window.__sky.track.id, fail: window.__sky.net.failMsg, live: window.__sky.net.live,
        })),
      };
      if (last.host && last.host.remotes > 0 && last.phone && last.phone.connected) return Object.assign({ ok: true }, last);
    } catch (e) { last = { nav: String(e && e.message || e) }; }
    await new Promise((r) => setTimeout(r, 200));
  }
  return Object.assign({ ok: false }, last);
}

function ownErrors(errors) {
  return errors.filter((e) => /main\.js|net\.js|sync\.js|physics\.js|race\.js|qrcode|ice\.js|relay\.js/.test(e) && !/favicon/i.test(e));
}

try {
  const { page, errors } = await openPage(BASE + '?track=canyon&q=low&ai=0&nonet=1&noadapt=1&nopauseblur=1&autostart=1&nocount=1&items=0');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.freeze = true;
    sky.game.state = 'race';
    const veh = sky.veh;
    veh.placeOnTrack(30, 1.2, 22);
    const snap = veh.exportState();
    const cmd = { steer: 0.35, throttle: 1, brake: 0, lift: false, nitro: false, pitch: 0 };
    for (let i = 0; i < 24; i++) veh.step(1 / 120, cmd);
    const moved = Math.hypot(veh.pos.x - snap.x, veh.pos.z - snap.z);
    veh.importState(snap);
    const back = Math.hypot(veh.pos.x - snap.x, veh.pos.y - snap.y, veh.pos.z - snap.z);
    const endA = { x: veh.pos.x, z: veh.pos.z };
    for (let i = 0; i < 24; i++) veh.step(1 / 120, cmd);
    endA.x = veh.pos.x; endA.z = veh.pos.z;
    veh.importState(snap);
    for (let i = 0; i < 24; i++) veh.step(1 / 120, cmd);
    const qr = document.createElement('canvas');
    qr.width = qr.height = 168;
    const lib = typeof qrcode === 'function';
    let modules = 0;
    if (lib) {
      const q = qrcode(0, 'M');
      q.addData('https://hgsteven-debug.github.io/?join=AB2CDE');
      q.make();
      modules = q.getModuleCount();
    }
    return {
      role: sky.net.role, split: !!sky.game.split, moved, back,
      ax: endA.x, az: endA.z, bx: veh.pos.x, bz: veh.pos.z,
      attached: snap.attached, fi: snap.fi, lib, modules,
      locals: sky.race.locals().length,
    };
  });
  if (ownErrors(errors).length) throw new Error(ownErrors(errors).join('\n'));
  if (report.role !== 'off') throw new Error('nonet role ' + report.role);
  if (report.split || report.locals !== 1) throw new Error('solo split ' + JSON.stringify(report));
  if (!(report.moved > 1)) throw new Error('did not move ' + JSON.stringify(report));
  if (!(report.back < 0.05)) throw new Error('importState ' + JSON.stringify(report));
  if (Math.hypot(report.ax - report.bx, report.az - report.bz) > 0.05) throw new Error('replay diverged ' + JSON.stringify(report));
  if (!report.lib || report.modules < 15) throw new Error('qr lib ' + JSON.stringify(report));
  await page.close();
  ok('vehicle snapshot roundtrip + qr library');
} catch (e) { bad('vehicle snapshot roundtrip + qr library', e); }

let webrtc = 'skip';
try {
  const hostUrl = BASE + '?track=canyon&q=low&ai=0&noadapt=1&nopauseblur=1&nocount=1&items=0';
  const host = await openPage(hostUrl);
  let signal = 'timeout';
  try {
    await host.page.waitForFunction(() => window.__sky.net.ready || window.__sky.net.failed, { timeout: 22000 });
    signal = await host.page.evaluate(() => window.__sky.net.ready ? 'ready' : ('fail:' + window.__sky.net.failMsg));
  } catch (e) { signal = 'timeout'; }
    if (!signal.startsWith('ready')) {
    console.log('SKIP phone webrtc', signal);
    await host.page.close();
  } else {
    const hostStage = await host.page.evaluate(() => (document.getElementById('phoneStatus') || {}).textContent || '');
    if (!hostStage.startsWith('階段：')) throw new Error('host status ' + hostStage);
    const meta = await host.page.evaluate(() => {
      const c = document.getElementById('phoneQr');
      const ctx = c.getContext('2d');
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 16) if (data[i] < 48) dark++;
      return { url: window.__sky.net.url, code: window.__sky.net.code, dark, split: !!window.__sky.game.split };
    });
    if (!(meta.dark > 20)) throw new Error('qr canvas blank ' + JSON.stringify(meta));
    if (!meta.url.includes('join=' + meta.code)) throw new Error('qr url ' + JSON.stringify(meta));
    const phoneUrl = new URL(meta.url);
    phoneUrl.searchParams.set('track', 'canyon');
    phoneUrl.searchParams.set('noadapt', '1');
    phoneUrl.searchParams.set('nopauseblur', '1');
    const phone = await openPage(phoneUrl.toString());
    await phone.page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await phone.page.waitForFunction(() => {
      const t = (document.getElementById('joinStatus') || {}).textContent || '';
      return t.startsWith('階段：') && t.indexOf('正在連上房間') < 0;
    }, { timeout: 8000 });
    const linked = await waitLink(host.page, phone.page, 45000);
    if (!linked.ok) throw new Error('peers did not connect ' + JSON.stringify(linked));
    await host.page.bringToFront();
    await host.page.evaluate(() => window.__sky.startGame());
    try {
      await phone.page.waitForFunction(() => window.__sky && (window.__sky.game.state === 'race' || window.__sky.game.state === 'countdown'), { timeout: 15000, polling: 200 });
    } catch (e) {
      const dump = {
        phone: await phone.page.evaluate(() => ({
          state: window.__sky.game.state,
          live: window.__sky.net.live,
          ready: window.__sky.net.trackReady,
          connected: window.__sky.net.connected,
          phase: window.__sky.net.latest && window.__sky.net.latest.race,
          cars: window.__sky.net.latest && window.__sky.net.latest.cars && window.__sky.net.latest.cars.length,
          status: (document.getElementById('joinStatus') || {}).textContent,
          fail: window.__sky.net.failMsg,
        })),
        host: await host.page.evaluate(() => ({
          state: window.__sky.game.state,
          remotes: window.__sky.net.remotes,
          sent: window.__sky.net.sent,
          lastErr: window.__sky.net.lastErr,
          racers: window.__sky.race && window.__sky.race.racers.map((r) => r.driver.kind + ':' + r.name),
        })),
        phoneErr: phone.errors.slice(0, 8),
        hostErr: host.errors.slice(0, 8),
      };
      throw new Error('phone did not enter race ' + JSON.stringify(dump));
    }
    await phone.page.waitForFunction(() => window.__sky && window.__sky.game.state === 'race', { timeout: 15000, polling: 200 });
    await phone.page.bringToFront();
    const view = await phone.page.evaluate(() => {
      const sky = window.__sky;
      const gas = document.querySelector('[data-t="gas"]');
      const r = gas.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      gas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, clientX: cx, clientY: cy, pointerType: 'touch' }));
      gas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch' }));
      sky.input.poll(1 / 60);
      for (let i = 0; i < 4; i++) sky.net.flushInput();
      const touch = document.getElementById('touch');
      return {
        split: !!sky.game.split,
        touch: touch && !touch.classList.contains('hidden'),
        q: sky.Q && sky.Q.scale,
        state: sky.game.state,
        label: (gas.textContent || '').trim(),
        held: !!sky.input.touch.gas,
        throttle: sky.input.state.throttle,
        dpr: sky.renderer.getPixelRatio(),
      };
    });
    if (view.split) throw new Error('phone is split ' + JSON.stringify(view));
    if (!view.touch) throw new Error('touch controls hidden ' + JSON.stringify(view));
    if (!(view.q < 0.7)) throw new Error('phone quality ' + JSON.stringify(view));
    if (view.label !== '加速') throw new Error('gas label ' + JSON.stringify(view));
    if (!view.held || !(view.throttle > 0.5)) throw new Error('gas hold ' + JSON.stringify(view));
    if (!(view.dpr <= 1.05)) throw new Error('phone dpr ' + JSON.stringify(view));
    await host.page.bringToFront();
    const hostView = await host.page.evaluate(() => ({
      split: !!window.__sky.game.split,
      locals: window.__sky.race.locals().length,
      kinds: window.__sky.race.racers.map((r) => r.driver.kind),
    }));
    if (hostView.split || hostView.locals !== 1 || !hostView.kinds.includes('remote')) throw new Error('host view ' + JSON.stringify(hostView));
    await host.page.waitForFunction(() => {
      const r = window.__sky.race.racers.find((x) => x.driver.kind === 'remote');
      return !!(r && r.driver.state.throttle > 0.5);
    }, { timeout: 8000, polling: 100 });
    const phoneAt = await phone.page.evaluate(() => ({
      x: window.__sky.car.root.position.x,
      z: window.__sky.car.root.position.z,
      sx: window.__sky.net.latest && window.__sky.net.latest.self ? window.__sky.net.latest.self.x : 0,
      sz: window.__sky.net.latest && window.__sky.net.latest.self ? window.__sky.net.latest.self.z : 0,
    }));
    const hostMove = await host.page.evaluate(() => {
      const sky = window.__sky;
      const r = sky.race.racers.find((x) => x.driver.kind === 'remote');
      const x0 = r.veh.pos.x, z0 = r.veh.pos.z;
      const thr = r.driver.state.throttle;
      const cmd = r.driver.sample();
      for (let i = 0; i < 90; i++) r.veh.step(1 / 60, cmd);
      sky.net.flushState();
      return { thr, sp: r.veh.speed, moved: Math.hypot(r.veh.pos.x - x0, r.veh.pos.z - z0), x: r.veh.pos.x };
    });
    if (!(hostMove.thr > 0.5 && hostMove.sp > 4 && hostMove.moved > 1)) throw new Error('host throttle ' + JSON.stringify(hostMove));
    await phone.page.waitForFunction((at) => {
      const s = window.__sky.net.latest && window.__sky.net.latest.self;
      return !!(s && Math.hypot(s.x - at.sx, s.z - at.sz) > 0.5);
    }, { timeout: 8000, polling: 100 }, phoneAt);
    await new Promise((r) => setTimeout(r, 250));
    const phoneMoved = await phone.page.evaluate((at) => {
      const sky = window.__sky;
      for (let i = 0; i < 10; i++) sky.net.tick(1 / 30);
      const p = sky.car.root.position;
      return Math.hypot(p.x - at.x, p.z - at.z);
    }, phoneAt);
    if (!(phoneMoved > 0.4)) {
      const diag = {
        phoneMoved,
        phone: await phone.page.evaluate(() => {
          const s = window.__sky.net.latest && window.__sky.net.latest.self;
          const p = window.__sky.car.root.position;
          return {
            state: window.__sky.game.state, live: window.__sky.net.live, connected: window.__sky.net.connected,
            sx: s && s.x, sz: s && s.z, x: p.x, z: p.z,
            track: window.__sky.net.latest && window.__sky.net.latest.track,
          };
        }),
        host: await host.page.evaluate(() => {
          const r = window.__sky.race.racers.find((x) => x.driver.kind === 'remote');
          return {
            p3: window.__sky.net.p3(),
            x: r && r.veh.pos.x, z: r && r.veh.pos.z, fi: r && r.veh.fi,
            thr: r && r.driver.state.throttle, brk: r && r.driver.state.brake,
          };
        }),
      };
      throw new Error('phone view froze ' + JSON.stringify(diag));
    }
    await phone.page.bringToFront();
    await phone.page.waitForFunction(() => window.__sky.net.ghosts >= 1 && window.__sky.net.latest && window.__sky.net.latest.standings && window.__sky.net.latest.standings.length >= 2, { timeout: 8000 });
    await phone.page.evaluate(() => window.__sky.net.disconnect());
    await new Promise((r) => setTimeout(r, 500));
    const after = await host.page.evaluate(() => {
      const sky = window.__sky;
      sky.game.freeze = true;
      const v = sky.veh;
      v.placeOnTrack(40, 0, 34);
      const x = v.pos.x, z = v.pos.z;
      sky.sim(0.35);
      return {
        state: sky.game.state,
        hidden: document.hidden,
        dist: Math.hypot(v.pos.x - x, v.pos.z - z),
        remote: sky.race.racers.some((r) => r.driver.kind === 'remote' && !r.parked),
      };
    });
    if (!(after.dist > 2)) throw new Error('host stalled after drop ' + JSON.stringify(after));
    if (after.state !== 'race' && !(after.state === 'paused' && after.hidden)) throw new Error('host stalled after drop ' + JSON.stringify(after));
    await host.page.bringToFront();
    await host.page.evaluate(() => {
      const sky = window.__sky;
      sky.game.freeze = false;
      if (sky.game.state === 'paused') { sky.ui.hideAll(); sky.game.state = 'race'; }
    });
    const phone2 = await openPage(phoneUrl.toString());
    await phone2.page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const again = await waitLink(host.page, phone2.page, 45000);
    if (!again.ok) throw new Error('rejoin failed ' + JSON.stringify(again));
    await phone2.page.waitForFunction(() => {
      const s = window.__sky.game.state;
      return window.__sky.net.live && (s === 'race' || s === 'countdown' || s === 'paused');
    }, { timeout: 20000 });
    const rejoined = await host.page.evaluate(() => window.__sky.race.racers.some((r) => r.driver.kind === 'remote' && !r.parked));
    if (!rejoined) throw new Error('rejoin did not add a car');
    const badErr = ownErrors(host.errors).concat(ownErrors(phone.errors), ownErrors(phone2.errors));
    if (badErr.length) throw new Error(badErr.join('\n'));
    await phone.page.close();
    await phone2.page.close();
    await host.page.close();
    webrtc = 'pass';
    ok('phone joins by room code');
  }
} catch (e) {
  webrtc = 'fail';
  bad('phone joins by room code', e);
}

try {
  const host = await openPage(BASE + '?track=canyon&q=low&ai=0&noadapt=1&nopauseblur=1&nocount=1&items=0');
  await host.page.waitForFunction(() => window.__sky.net.ready || window.__sky.net.failed, { timeout: 22000 });
  const ready = await host.page.evaluate(() => window.__sky.net.ready);
  if (!ready) {
    console.log('SKIP phone relay', await host.page.evaluate(() => window.__sky.net.failMsg));
    await host.page.close();
  } else {
    await host.page.evaluate(() => window.__sky.startGame());
    await host.page.waitForFunction(() => {
      const t = (document.getElementById('phoneStatus') || {}).textContent || '';
      return t.indexOf('已連到伺服器') >= 0;
    }, { timeout: 45000 });
    const meta = await host.page.evaluate(() => ({ url: window.__sky.net.url }));
    if (!/[?&]relay=\d+/.test(meta.url) || !/[?&]epoch=\d+/.test(meta.url)) throw new Error('join url missing broker ' + meta.url);
    const phoneUrl = new URL(meta.url);
    phoneUrl.searchParams.set('track', 'canyon');
    phoneUrl.searchParams.set('noadapt', '1');
    phoneUrl.searchParams.set('nopauseblur', '1');
    const phone = await browser.newPage();
    await phone.evaluateOnNewDocument(() => {
      const boom = function () { throw new Error('blocked'); };
      window.RTCPeerConnection = boom;
      window.webkitRTCPeerConnection = boom;
    });
    const errors = [];
    phone.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    await phone.setViewport({ width: 915, height: 412, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await phone.goto(phoneUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 });
    await phone.waitForFunction(() => window.__sky && window.__sky.game.state !== 'loading', { timeout: 90000, polling: 200 });
    const linked = await waitLink(host.page, phone, 40000);
    if (!linked.ok) throw new Error('relay did not connect ' + JSON.stringify(linked));
    const via = await phone.evaluate(() => (document.getElementById('joinStatus') || {}).textContent || '');
    if (via.indexOf('網頁中繼') < 0) throw new Error('not on relay ' + via);
    await phone.bringToFront();
    await phone.waitForFunction(() => window.__sky.game.state === 'race' || window.__sky.game.state === 'countdown', { timeout: 15000, polling: 200 });
    await phone.waitForFunction(() => window.__sky.game.state === 'race', { timeout: 15000, polling: 200 });
    await phone.evaluate(() => {
      const gas = document.querySelector('[data-t="gas"]');
      const r = gas.getBoundingClientRect();
      gas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 9, clientX: r.x + 12, clientY: r.y + 12, pointerType: 'touch' }));
      gas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch' }));
      window.__sky.input.poll(1 / 60);
      for (let i = 0; i < 4; i++) window.__sky.net.flushInput();
    });
    await host.page.bringToFront();
    await host.page.waitForFunction(() => {
      const r = window.__sky.race.racers.find((x) => x.driver.kind === 'remote');
      return !!(r && r.driver.state.throttle > 0.5);
    }, { timeout: 8000, polling: 100 });
    const phoneAt = await phone.evaluate(() => ({
      x: window.__sky.car.root.position.x,
      z: window.__sky.car.root.position.z,
      sx: window.__sky.net.latest && window.__sky.net.latest.self ? window.__sky.net.latest.self.x : 0,
      sz: window.__sky.net.latest && window.__sky.net.latest.self ? window.__sky.net.latest.self.z : 0,
    }));
    const hostMove = await host.page.evaluate(() => {
      const sky = window.__sky;
      const r = sky.race.racers.find((x) => x.driver.kind === 'remote');
      const x0 = r.veh.pos.x, z0 = r.veh.pos.z;
      const thr = r.driver.state.throttle;
      const cmd = r.driver.sample();
      for (let i = 0; i < 90; i++) r.veh.step(1 / 60, cmd);
      sky.net.flushState();
      return { thr, sp: r.veh.speed, moved: Math.hypot(r.veh.pos.x - x0, r.veh.pos.z - z0) };
    });
    if (!(hostMove.thr > 0.5 && hostMove.sp > 3 && hostMove.moved > 1)) throw new Error('relay host ' + JSON.stringify(hostMove));
    try {
      await phone.waitForFunction((at) => {
        const s = window.__sky.net.latest && window.__sky.net.latest.self;
        return !!(s && Math.hypot(s.x - at.sx, s.z - at.sz) > 0.5);
      }, { timeout: 8000, polling: 100 }, phoneAt);
      // 畫面刻意落後約 100ms。封包剛到就取樣，內插還停在舊位置。
      await new Promise((r) => setTimeout(r, 250));
    } catch (e) {
      const phoneNow = await phone.evaluate((at) => {
        const s = window.__sky.net.latest && window.__sky.net.latest.self;
        return { self: s, at, link: window.__sky.net.link, state: window.__sky.game.state };
      }, phoneAt);
      const hostNow = await host.page.evaluate(() => ({ link: window.__sky.net.link, sent: window.__sky.net.sent, err: window.__sky.net.lastErr }));
      throw new Error('relay pose ' + JSON.stringify({ phoneNow, hostNow }));
    }
    const moved = await phone.evaluate((at) => {
      const sky = window.__sky;
      for (let i = 0; i < 10; i++) sky.net.tick(1 / 30);
      const p = sky.car.root.position;
      return Math.hypot(p.x - at.x, p.z - at.z);
    }, phoneAt);
    if (!(moved > 0.3)) throw new Error('relay view froze ' + moved);
    const warned = await phone.evaluate(() => (document.getElementById('toast').textContent || '') + '|' + (document.getElementById('state').textContent || ''));
    if (warned.indexOf('離道') >= 0 || warned.indexOf('偏離賽道') >= 0) throw new Error('false off-track ' + warned);
    await phone.close();
    await host.page.close();
    ok('phone relay throttle');
  }
} catch (e) {
  bad('phone relay throttle', e);
}

try {
  const host = await openPage(BASE + '?track=canyon&q=low&ai=0&noadapt=1&nopauseblur=1&nocount=1&items=0');
  await host.page.waitForFunction(() => window.__sky && window.__sky.net && window.__sky.net.role === 'host', { timeout: 20000 });
  await host.page.evaluate(() => window.__sky.startGame());
  const kept = await host.page.evaluate(() => {
    const sky = window.__sky;
    const remote = sky.net.debugJoin('same-player');
    const r = sky.race.racers.find((x) => x.driver && x.driver.kind === 'remote');
    if (!remote || !r) return { err: 'no remote' };
    const startFi = r.veh.fi;
    r._token = 7;
    r.lap.n = 4;
    r.lap.t = 18;
    r.veh.placeOnTrack(40, 1.5, 20);
    const placed = r.veh.fi;
    sky.net.debugBlip();
    sky.sim(0.35);
    const held = sky.net.p3();
    const again = sky.net.debugJoin('same-player');
    const back = sky.net.p3();
    sky.net.debugExpire();
    const gone = sky.net.p3();
    sky.net.debugJoin('same-player');
    const fresh = sky.net.p3();
    return { startFi, placed, held, back, gone, fresh, same: again === remote || !!(back && back.token === 7) };
  });
  if (kept.err) throw new Error(kept.err);
  if (!kept.held || kept.held.lap !== 4 || !kept.held.holding) throw new Error('blip dropped the car ' + JSON.stringify(kept));
  if (Math.abs(kept.held.fi - kept.placed) > 18) throw new Error('blip teleported ' + JSON.stringify(kept));
  if (Math.abs(kept.held.fi - kept.startFi) < 12) throw new Error('blip returned to the start ' + JSON.stringify(kept));
  if (!kept.back || kept.back.lap !== 4 || kept.back.token !== 7 || kept.back.holding) throw new Error('rejoin reset P3 ' + JSON.stringify(kept));
  if (Math.abs(kept.back.fi - kept.placed) > 18) throw new Error('rejoin moved P3 ' + JSON.stringify(kept));
  if (kept.gone) throw new Error('grace did not expire ' + JSON.stringify(kept));
  if (!kept.fresh || kept.fresh.lap !== 1 || kept.fresh.token !== 0) throw new Error('new join after grace ' + JSON.stringify(kept));
  if (Math.abs(kept.fresh.fi - kept.startFi) > 2) throw new Error('new join was not at the start ' + JSON.stringify(kept));
  await host.page.close();
  ok('phone blip keeps P3 laps');
} catch (e) {
  bad('phone blip keeps P3 laps', e);
}

await browser.close();
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS', webrtc === 'pass' ? '(including webrtc)' : '(webrtc skipped)');
