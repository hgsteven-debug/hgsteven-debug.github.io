// 模擬 MQTT：斷線不換伺服器、失敗很多次也不放棄、手機要等車機回應才算連上。
// P3 短暫斷線留在原位的瀏覽器測試在 sync.mjs。
import * as sync from '../js/sync.js';
import * as relay from '../js/relay.js';
import { createHost, createGuest } from '../js/net.js';

const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitFor(fn, ms, label) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < ms) {
    try {
      last = fn();
      if (last) return last;
    } catch (e) { last = e; }
    await sleep(15);
  }
  throw new Error((label || 'timeout') + ' ' + JSON.stringify(last));
}

const PAIR = [
  { url: 'wss://sim-a/mqtt', username: '', label: 'sim-a' },
  { url: 'wss://sim-b/mqtt', username: '', label: 'sim-b' },
];

function makeHub() {
  const rooms = new Map();
  function detach(sock) {
    const set = rooms.get(sock.url);
    if (set) set.delete(sock);
  }
  function deliver(sock, bytes) {
    const copy = new Uint8Array(bytes);
    queueMicrotask(() => {
      if (sock.readyState !== 1 || !sock.onmessage) return;
      try { sock.onmessage({ data: copy.buffer }); } catch (e) {}
    });
  }
  function handle(sock, data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data);
    const type = u8[0] & 0xf0;
    if (type === 0x10) deliver(sock, new Uint8Array([0x20, 0x02, 0x00, 0x00]));
    else if (type === 0x80) {
      sock.subscribed = true;
      deliver(sock, new Uint8Array([0x90, 0x03, 0x00, 0x01, 0x00]));
    } else if (type === 0x30) {
      const set = rooms.get(sock.url);
      if (!set) return;
      for (const other of set) {
        if (other !== sock && other.subscribed && other.readyState === 1) deliver(other, u8);
      }
    }
  }
  function socket(url) {
    const sock = {
      url, binaryType: 'arraybuffer', readyState: 0, subscribed: false,
      onopen: null, onmessage: null, onerror: null, onclose: null,
      send(data) { if (this.readyState === 1) handle(sock, data); },
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        detach(sock);
        const fn = this.onclose;
        queueMicrotask(() => { try { if (fn) fn(); } catch (e) {} });
      },
    };
    let set = rooms.get(url);
    if (!set) rooms.set(url, set = new Set());
    set.add(sock);
    queueMicrotask(() => {
      if (sock.readyState === 3) return;
      sock.readyState = 1;
      try { if (sock.onopen) sock.onopen(); } catch (e) {}
    });
    return sock;
  }
  function dead() {
    const sock = {
      url: 'dead', binaryType: 'arraybuffer', readyState: 0, subscribed: false,
      onopen: null, onmessage: null, onerror: null, onclose: null,
      send() {},
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        const fn = this.onclose;
        queueMicrotask(() => { try { if (fn) fn(); } catch (e) {} });
      },
    };
    queueMicrotask(() => {
      if (sock.readyState === 3) return;
      sock.readyState = 3;
      try { if (sock.onclose) sock.onclose(); } catch (e) {}
    });
    return sock;
  }
  function dropAll() {
    for (const set of rooms.values()) for (const sock of [...set]) sock.close();
  }
  return { socket, dead, dropAll };
}

function fast(hub, extra) {
  return Object.assign({
    socket: (url) => hub.socket(url),
    relays: PAIR,
    backoff: () => 12,
    helloTimeout: 300,
    failStreak: 3,
  }, extra || {});
}

function testMath() {
  assert(relay.relaySlot(0, 1, 4) === 1, relay.relaySlot(0, 1, 4));
  assert(relay.relaySlot(3, 1, 4) === 0, relay.relaySlot(3, 1, 4));
  assert(relay.relayBackoff(0) === 400, relay.relayBackoff(0));
  assert(relay.relayBackoff(1) === 800, relay.relayBackoff(1));
  assert(relay.relayBackoff(2) === 1600, relay.relayBackoff(2));
  assert(relay.relayBackoff(10) === relay.RELAY_BACKOFF_CAP, relay.relayBackoff(10));
  assert(sync.REMOTE_GRACE_MS >= 30000 && sync.REMOTE_GRACE_MS <= 60000, sync.REMOTE_GRACE_MS);
  assert(sync.hostStillThere(1000, 5000) === true);
  assert(sync.hostStillThere(1000, 7000) === false);
  assert(sync.hostStillThere(0, 1000) === false);
  const plain = sync.joinUrl('ab2cde', { hostname: '127.0.0.1', origin: 'http://127.0.0.1:8137', pathname: '/' });
  assert(plain === 'http://127.0.0.1:8137/?join=AB2CDE', plain);
  const pinned = sync.joinUrl('AB2CDE', { hostname: '127.0.0.1', origin: 'http://127.0.0.1:8137', pathname: '/' }, { index: 2, epoch: 1 });
  assert(pinned === 'http://127.0.0.1:8137/?join=AB2CDE&relay=2&epoch=1', pinned);
  const urls = [];
  const hub = makeHub();
  const pinnedRelay = relay.connectRelay('PIN99', {}, {
    index: 1, epoch: 1, role: 'guest', relays: PAIR, backoff: () => 10000, helloTimeout: 10000,
    socket: (url) => { urls.push(url); return hub.socket(url); },
  });
  assert(pinnedRelay.index === 1 && pinnedRelay.epoch === 1, JSON.stringify(pinnedRelay));
  assert(urls[0] === PAIR[1].url, urls.join(','));
  pinnedRelay.close();
}

async function testStayOnBroker() {
  const hub = makeHub();
  const seen = [];
  const host = relay.connectRelay('STAY01', {}, fast(hub, { role: 'host' }));
  const phone = relay.connectRelay('STAY01', { onMessage: (m) => { if (m && m.from === 'host') seen.push(m); } }, fast(hub, { role: 'guest' }));
  await waitFor(() => host.open && phone.open, 1000, 'open');
  assert(host.index === 0 && phone.index === 0, host.index + '/' + phone.index);
  assert(host.attempts === 0 && phone.attempts === 0, 'attempts after connect');
  for (let i = 0; i < 9; i++) {
    hub.dropAll();
    await sleep(0);
    await waitFor(() => !host.open && !phone.open, 1000, 'closed ' + i);
    await waitFor(() => host.open && phone.open, 1000, 'reopen ' + i);
    assert(host.index === 0 && phone.index === 0, 'hopped on drop ' + i + ' ' + host.index + '/' + phone.index);
    assert(host.epoch === 0 && phone.epoch === 0, 'epoch moved ' + host.epoch);
    assert(host.attempts === 0 && phone.attempts === 0, 'attempts not reset ' + host.attempts + '/' + phone.attempts);
    assert(host._stop === false && phone._stop === false && host.failed === false && phone.failed === false, 'gave up');
  }
  seen.length = 0;
  assert(host.send({ t: 'ping', from: 'host', n: 9 }) === true, 'send after 9 drops');
  await waitFor(() => seen.some((m) => m && m.n === 9), 500, 'message after drops');
  host.close();
  phone.close();
}

async function testNeverGiveUp() {
  const hub = makeHub();
  const phone = relay.connectRelay('GIVEUP', {}, fast(hub, { role: 'guest', socket: () => hub.dead(), backoff: () => 8, helloTimeout: 20 }));
  await waitFor(() => phone.attempts >= 10, 1500, 'attempts ' + phone.attempts);
  assert(phone.index === 0 && phone.epoch === 0, 'guest hopped ' + phone.index + ' epoch ' + phone.epoch);
  assert(phone._stop === false && phone.failed === false, 'guest stopped');
  const more = phone.attempts;
  await sleep(80);
  assert(phone.attempts > more, 'guest stopped retrying at ' + phone.attempts);
  phone.close();
}

async function testHostFailover() {
  const hub = makeHub();
  const moved = [];
  const socket = (url) => (url === PAIR[0].url ? hub.dead() : hub.socket(url));
  const host = relay.connectRelay('FAIL01', {
    onFailover: (info) => moved.push(info),
  }, fast(hub, { role: 'host', socket, backoff: () => 8, helloTimeout: 30 }));
  const phone = relay.connectRelay('FAIL01', {}, fast(hub, { role: 'guest', socket, backoff: () => 8, helloTimeout: 30 }));
  await waitFor(() => host.index === 1 && host.epoch === 1 && host.open, 2000, 'host failover ' + host.reason);
  assert(moved.length >= 1 && moved[0].index === 1 && moved[0].epoch === 1 && moved[0].label === 'sim-b', JSON.stringify(moved));
  await sleep(120);
  assert(phone.index === 0 && phone.epoch === 0, 'phone followed a dead broker by itself');
  phone.pin(host.index, host.epoch);
  await waitFor(() => phone.open && phone.index === 1 && phone.epoch === 1, 1000, 'phone pin');
  const seen = [];
  const again = relay.connectRelay('FAIL01', { onMessage: (m) => seen.push(m) }, fast(hub, { role: 'guest', index: 1, epoch: 1 }));
  await waitFor(() => again.open, 1000, 'rescanned phone');
  assert(host.send({ t: 'broker', relay: 1, epoch: 1, from: 'host' }) === true);
  await waitFor(() => seen.some((m) => m && m.t === 'broker' && m.epoch === 1), 500, 'announce');
  host.close();
  phone.close();
  again.close();
}

async function testBrokerAnnounce() {
  const hub = makeHub();
  const phone = relay.connectRelay('ANN01', {}, fast(hub, { role: 'guest' }));
  const host = relay.connectRelay('ANN01', {}, fast(hub, { role: 'host' }));
  await waitFor(() => phone.open && host.open, 1000, 'announce open');
  host.send({ t: 'broker', relay: 1, epoch: 1, from: 'host' });
  await waitFor(() => phone.index === 1 && phone.epoch === 1 && phone.open, 1000, 'phone followed announce');
  host.pin(1, 1);
  await waitFor(() => host.open && host.index === 1, 1000, 'host pin');
  const seen = [];
  phone.close();
  const phone2 = relay.connectRelay('ANN01', { onMessage: (m) => { if (m && m.n === 4) seen.push(m); } }, fast(hub, { role: 'guest', index: 1, epoch: 1 }));
  await waitFor(() => phone2.open, 1000, 'phone2');
  assert(host.send({ t: 'ping', from: 'host', n: 4 }));
  await waitFor(() => seen.length, 500, 'same broker after announce');
  host.close();
  phone2.close();
}

async function testEndToEnd() {
  const hub = makeHub();
  const code = 'AB2CDE';
  const texts = [];
  const host = createHost({
    code,
    relayOpts: fast(hub),
    welcome: (remote) => ({ t: 'welcome', name: remote.name, slot: remote.slot }),
    state: () => ({ t: 'state', race: 'race' }),
  });
  await waitFor(() => host.wsOpen, 1000, 'host socket');
  const phone = createGuest(code, {
    relayIndex: 0,
    relayEpoch: 0,
    relayOpts: fast(hub),
    onStatus: (s) => texts.push(s.text || ''),
  });
  await waitFor(() => {
    const now = performance.now();
    phone.poll(now);
    host.poll(now);
    return phone.connected;
  }, 3500, 'welcome ' + texts.slice(-3).join(' | '));
  assert(texts.some((t) => t.includes('尚未跟車機確認')), texts.join('\n'));
  const joinedAt = texts.findIndex((t) => t.includes('已加入'));
  assert(joinedAt > 0, texts.join('\n'));
  assert(!texts.slice(0, joinedAt).some((t) => t.includes('已連上') || t.includes('已加入')), texts.join('\n'));
  assert(texts[texts.length - 1].includes('已加入'), texts[texts.length - 1]);
  assert(host.url.includes('relay=0') && host.url.includes('epoch=0'), host.url);
  assert(host.remotes.length === 1, 'remotes ' + host.remotes.length);
  host.remotes[0].racer = { token: 7 };
  for (let i = 0; i < 9; i++) {
    hub.dropAll();
    await sleep(0);
    await waitFor(() => !host.wsOpen && !phone.wsOpen, 1000, 'net closed ' + i);
    await waitFor(() => host.wsOpen && phone.wsOpen, 1000, 'net reopen ' + i);
  }
  phone.poll(performance.now());
  host.poll(performance.now());
  await sleep(40);
  phone.noteInput({ steer: 0.25, throttle: 1, brake: 0, lift: false, nitro: false, pitch: 0 }, performance.now());
  await waitFor(() => host.remotes[0] && host.remotes[0].cmd && host.remotes[0].cmd.throttle === 1, 800, 'throttle after drops');
  assert(host.remotes.length === 1 && host.remotes[0].racer && host.remotes[0].racer.token === 7, 'rejoin made a new P3');
  assert(host.relayIndex === 0 && host.relayEpoch === 0, 'host left the broker');
  phone.lastPeerAt = performance.now() - sync.LINK_STALE_MS - 50;
  phone.heardHost = true;
  phone.connected = true;
  phone.poll(performance.now());
  assert(phone.connected === false && phone.heardHost === false, 'stale host still looked connected');
  assert(texts[texts.length - 1].includes('尚未跟車機確認'), texts[texts.length - 1]);
  assert(phone.wsGaveUp === false && phone.failed === false, 'phone gave up');
  phone.destroy();
  host.destroy();
}

async function testGraceSamePlayer() {
  const hub = makeHub();
  const host = createHost({ code: 'GRACE1', relayOpts: fast(hub) });
  const first = host.debugJoin('same-player');
  first.racer = { token: 7 };
  assert(host.debugBlip() === true);
  assert(first.holding === true && first.driver.state.brake === 1, 'not braking');
  const again = host.debugJoin('same-player');
  assert(again === first && first.holding === false && first.racer.token === 7, 'same player was replaced');
  first.conn.emit('data', { t: 'bye' });
  assert(first.supersede === true, 'bye did not free the slot');
  const other = host.debugJoin('other-phone');
  assert(other && other !== first && host.remotes.length === 1 && other.nonce === 'other-phone', 'other phone was rejected');
  const extra = host.debugJoin('extra');
  assert(extra == null && host.remotes.length === 1 && host.remotes[0] === other, 'live phone was kicked');
  host.debugBlip();
  assert(host.debugExpire() === true);
  assert(host.remotes.length === 0, 'grace did not expire');
  host.destroy();
}

async function testQrFailover() {
  const hub = makeHub();
  const socket = (url) => (url === PAIR[0].url ? hub.dead() : hub.socket(url));
  const host = createHost({
    code: 'QRFAIL',
    relayOpts: fast(hub, { socket, backoff: () => 8, helloTimeout: 40 }),
    welcome: (remote) => ({ t: 'welcome', name: remote.name, slot: 0 }),
    state: () => ({ t: 'state', race: 'race' }),
  });
  await waitFor(() => host.relayIndex === 1 && host.relayEpoch === 1 && host.wsOpen, 2000, 'qr failover ' + host.wsReason);
  assert(host.url.includes('relay=1') && host.url.includes('epoch=1'), host.url);
  const stuckTexts = [];
  const stuck = createGuest('QRFAIL', {
    relayIndex: 0,
    relayEpoch: 0,
    relayOpts: fast(hub, { socket: () => hub.dead(), backoff: () => 8, helloTimeout: 20 }),
    onStatus: (s) => stuckTexts.push(s.text || ''),
  });
  await sleep(200);
  assert(stuck.connected === false && stuck.wsGaveUp === false, 'old url gave up or connected');
  assert(!stuckTexts.some((t) => t.includes('已加入')), stuckTexts.join('\n'));
  stuck.destroy();
  const phone = createGuest('QRFAIL', {
    relayIndex: host.relayIndex,
    relayEpoch: host.relayEpoch,
    relayOpts: fast(hub),
  });
  await waitFor(() => phone.connected, 2000, 'rescanned qr');
  assert(host.remotes.length === 1, 'host did not see the rescanned phone');
  phone.destroy();
  host.destroy();
}

try { testMath(); ok('relay slot / backoff / join url'); }
catch (e) { bad('relay slot / backoff / join url', e); }
try { await testStayOnBroker(); ok('simulated drops stay on one broker'); }
catch (e) { bad('simulated drops stay on one broker', e); }
try { await testNeverGiveUp(); ok('reconnects do not permanently stop'); }
catch (e) { bad('reconnects do not permanently stop', e); }
try { await testHostFailover(); ok('host failover stays coordinated'); }
catch (e) { bad('host failover stays coordinated', e); }
try { await testBrokerAnnounce(); ok('phone follows broker announce'); }
catch (e) { bad('phone follows broker announce', e); }
try { await testEndToEnd(); ok('phone waits for the host, then survives drops'); }
catch (e) { bad('phone waits for the host, then survives drops', e); }
try { await testGraceSamePlayer(); ok('same player resumes, grace can expire'); }
catch (e) { bad('same player resumes, grace can expire', e); }
try { await testQrFailover(); ok('qr carries the broker the host moved to'); }
catch (e) { bad('qr carries the broker the host moved to', e); }

if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
