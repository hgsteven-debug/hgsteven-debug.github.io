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

function testIceList() {
  const now = 1792669800000;
  const list = ice.iceServers(now);
  const blob = JSON.stringify(list);
  assert(blob.includes('stun:stun.l.google.com:19302'), blob);
  assert(blob.includes('transport=tcp'), blob);
  assert(!blob.includes('turn.peerjs.com'), blob);
  const turn = list.find((s) => s.username);
  const expect = crypto.createHmac('sha1', 'openrelayprojectsecret').update(turn.username).digest('base64');
  assert(turn.credential === expect, turn.credential);
  assert(String(turn.urls).includes(':443'), turn.urls);
  const root = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert(root.includes('location.search + location.hash'), 'root redirect dropped the query');
  const pub = relay.mqttPublish('skyroadster/v1/ABC', '{"t":"ping"}');
  assert(relay.mqttPayload(pub) === '{"t":"ping"}', relay.mqttPayload(pub));
}

async function testRelay() {
  const code = 'ZZ' + Math.random().toString(36).slice(2, 6);
  let got = null;
  const b = relay.connectRelay(code, { onMessage: (m) => { if (m && m.from === 'a') got = m; } });
  const a = relay.connectRelay(code, {});
  const start = Date.now();
  while ((!a.open || !b.open) && Date.now() - start < 12000) await new Promise((r) => setTimeout(r, 50));
  assert(a.open && b.open, 'relay not open ' + a.reason + ' / ' + b.reason);
  a.send({ t: 'ping', from: 'a', n: 7 });
  const wait = Date.now();
  while (!got && Date.now() - wait < 5000) await new Promise((r) => setTimeout(r, 50));
  a.close(); b.close();
  assert(got && got.n === 7, JSON.stringify(got));
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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
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
  const { page, errors } = await openPage(BASE + '?track=canyon&q=low&ai=0&nonet=1&noadapt=1&nopauseblur=1&autostart=1&nocount=1');
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
  const hostUrl = BASE + '?track=canyon&q=low&ai=0&noadapt=1&nopauseblur=1&nocount=1';
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
      sky.input.touch.gas = true;
      sky.input.touch.left = true;
      const touch = document.getElementById('touch');
      return {
        split: !!sky.game.split,
        touch: touch && !touch.classList.contains('hidden'),
        q: sky.Q && sky.Q.scale,
        state: sky.game.state,
      };
    });
    if (view.split) throw new Error('phone is split ' + JSON.stringify(view));
    if (!view.touch) throw new Error('touch controls hidden ' + JSON.stringify(view));
    if (!(view.q < 0.7)) throw new Error('phone quality ' + JSON.stringify(view));
    const hostView = await host.page.evaluate(() => ({
      split: !!window.__sky.game.split,
      locals: window.__sky.race.locals().length,
      kinds: window.__sky.race.racers.map((r) => r.driver.kind),
    }));
    if (hostView.split || hostView.locals !== 1 || !hostView.kinds.includes('remote')) throw new Error('host view ' + JSON.stringify(hostView));
    await phone.page.waitForFunction(() => window.__sky.veh.speed > 4, { timeout: 8000 });
    await host.page.waitForFunction(() => {
      const r = window.__sky.race.racers.find((x) => x.driver.kind === 'remote');
      return !!(r && r.driver.state.throttle > 0.5);
    }, { timeout: 10000 });
    await phone.page.waitForFunction(() => window.__sky.net.ghosts >= 1 && window.__sky.net.latest && window.__sky.net.latest.standings && window.__sky.net.latest.standings.length >= 2, { timeout: 8000 });
    await phone.page.evaluate(() => window.__sky.net.disconnect());
    const dropped = await host.page.waitForFunction(() => window.__sky.net.remotes === 0, { timeout: 8000, polling: 200 }).then(() => true).catch(() => false);
    if (!dropped) {
      const dump = await host.page.evaluate(() => ({
        remotes: window.__sky.net.remotes,
        status: (document.getElementById('phoneStatus') || {}).textContent,
        sent: window.__sky.net.sent,
        err: window.__sky.net.lastErr,
      }));
      const phoneDump = await phone.page.evaluate(() => ({
        via: window.__sky.net && window.__sky.input && (document.getElementById('joinStatus') || {}).textContent,
        connected: window.__sky.net.connected,
      }));
      throw new Error('remote stayed ' + JSON.stringify({ dump, phoneDump }));
    }
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
    if (after.remote || !(after.dist > 2)) throw new Error('host stalled after drop ' + JSON.stringify(after));
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

await browser.close();
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS', webrtc === 'pass' ? '(including webrtc)' : '(webrtc skipped)');
