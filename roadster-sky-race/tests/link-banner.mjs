// 失去聯絡橫幅：健康連線必須隱藏，沉默超過 timeout 才出現，封包一回來就收起。
// 直連、TURN、MQTT 都算「有看到車機」。分頁恢復的大間隔不算斷線。
import {
  LINK_STALE_MS, LINK_RESUME_GAP_MS, LINK_DC_FRESH_MS, hostStillThere, linkQuality,
  noteLinkResume, advanceLinkWatch, showLostContact, relayPacketWhileDirect,
} from '../js/sync.js';

const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function makeLink() {
  return { lastAt: 0, heard: false, pollAt: 0, connected: false, via: '' };
}

function packet(link, now, via) {
  link.lastAt = now;
  link.heard = true;
  link.connected = true;
  link.via = via;
}

function frame(link, now, live = true) {
  const watch = advanceLinkWatch({
    heardHost: link.heard,
    lastAt: link.lastAt,
    pollAt: link.pollAt,
    now,
  });
  link.pollAt = watch.pollAt;
  link.lastAt = watch.lastAt;
  link.heard = watch.heardHost;
  if (watch.lost) link.connected = false;
  const banner = showLostContact({
    live,
    lastAt: link.lastAt,
    now,
    resumed: watch.resumed && watch.heardHost,
  });
  return { watch, banner };
}

function chipGreen(link, now, rtt = 5) {
  if (!(link.lastAt > 0) || !link.via) return false;
  const age = now - link.lastAt;
  return linkQuality({ rtt, via: link.via, age }) === 'good';
}

try {
  const link = makeLink();
  packet(link, 1000, 'direct');
  const healthy = frame(link, 1500);
  assert(healthy.banner === false, 'fresh packet still showed the banner');
  assert(healthy.watch.lost === false && link.connected === true, 'fresh packet looked lost');
  assert(chipGreen(link, 1500), '5ms-class link was not a green chip');
  assert(!(chipGreen(link, 1500) && healthy.banner), 'green chip overlapped the lost banner');
  ok('healthy direct link hides the banner');
} catch (e) { bad('healthy direct link hides the banner', e); }

try {
  const link = makeLink();
  packet(link, 1000, 'direct');
  let last = null;
  for (let t = 1000; t <= 1000 + LINK_STALE_MS + 400; t += 400) last = frame(link, t);
  assert(last.banner === true, 'silence inside the timeout did not raise the banner');
  assert(last.watch.lost === true && link.heard === false && link.connected === false, 'watchdog left the host connected');
  assert(chipGreen(link, 1000 + LINK_STALE_MS + 1) === false, 'stale link still looked green');
  packet(link, 1000 + LINK_STALE_MS + 50, 'direct');
  const back = frame(link, 1000 + LINK_STALE_MS + 80);
  assert(back.banner === false && link.connected === true, 'banner stayed up after packets returned');
  ok('banner appears after the timeout and clears on the next packet');
} catch (e) { bad('banner appears after the timeout and clears on the next packet', e); }

try {
  const link = makeLink();
  let now = 1000;
  packet(link, now, 'direct');
  frame(link, now);
  const paths = ['direct', 'relay', 'ws'];
  for (const via of paths) {
    now += 800;
    packet(link, now, via);
    const step = frame(link, now + 100);
    assert(step.banner === false && step.watch.lost === false, via + ' did not refresh the timer');
  }
  ok('direct, TURN, and MQTT each reset the timer');
} catch (e) { bad('direct, TURN, and MQTT each reset the timer', e); }

try {
  const link = makeLink();
  link.lastAt = 1000;
  link.heard = true;
  link.connected = true;
  link.via = 'direct';
  link.pollAt = 1000;
  const woke = frame(link, 20000);
  assert(woke.watch.resumed === true && woke.watch.lost === false, 'resume was treated as a loss');
  assert(link.lastAt === 20000 && link.heard === true && link.connected === true, 'resume did not refresh last seen');
  assert(woke.banner === false, 'resume showed the lost banner');
  let last = woke;
  for (let t = 21000; t <= 20000 + LINK_STALE_MS + 1000; t += 1000) last = frame(link, t);
  assert(last.banner === true && last.watch.lost === true, 'a dead host survived the window after resume');
  assert(noteLinkResume(0, 99999) === false, 'first poll counted as a resume');
  const cold = makeLink();
  cold.lastAt = 1000;
  cold.heard = true;
  cold.connected = true;
  cold.pollAt = 0;
  const first = frame(cold, 1000 + LINK_STALE_MS + 50);
  assert(first.watch.resumed === false && first.watch.lost === true && first.banner === true, 'first poll ignored a stale host');
  ok('background resume is not a loss; a stale first poll still is');
} catch (e) { bad('background resume is not a loss; a stale first poll still is', e); }

try {
  assert(showLostContact({ replaced: true, live: true, lastAt: 0, now: 99999 }) === false, 'replaced still raised lost-contact');
  assert(showLostContact({ live: false, lastAt: 1, now: 99999 }) === false, 'banner showed outside the race');
  const back = advanceLinkWatch({ heardHost: true, lastAt: 5000, pollAt: 4900, now: 4800 });
  assert(back.lost === false && back.heardHost === true && back.lastAt === 5000, 'clock step back declared a loss');
  assert(showLostContact({ live: true, lastAt: 5000, now: 4800 }) === false, 'clock step back showed the banner');
  assert(hostStillThere(1000, 5000) === true && hostStillThere(1000, 7000) === false, 'hostStillThere changed');
  assert(LINK_RESUME_GAP_MS === 1200 && LINK_DC_FRESH_MS === 1500, 'windows moved');
  for (let age = 0; age <= 2000; age += 25) {
    const green = linkQuality({ rtt: 5, via: 'direct', age }) === 'good';
    const banner = showLostContact({ live: true, lastAt: 10000, now: 10000 + age });
    assert(green && banner === false, 'green chip coexisted with the banner at ' + age);
  }
  ok('replaced, pre-race, and a green chip never show lost-contact');
} catch (e) { bad('replaced, pre-race, and a green chip never show lost-contact', e); }

try {
  const liveDc = relayPacketWhileDirect({ rtcLive: true, via: 'ws', lastDcAt: 1000, now: 1200 });
  assert(liveDc.drop === true && liveDc.rtcLive === true, 'fresh direct link applied a late relay pose');
  const staleDc = relayPacketWhileDirect({ rtcLive: true, via: 'ws', lastDcAt: 1000, now: 1000 + LINK_DC_FRESH_MS });
  assert(staleDc.drop === false && staleDc.rtcLive === false, 'silent direct link swallowed the relay packet');
  const direct = relayPacketWhileDirect({ rtcLive: true, via: 'webrtc', lastDcAt: 1000, now: 9000 });
  assert(direct.drop === false && direct.rtcLive === true, 'direct packet was treated as relay');
  const mqttOnly = relayPacketWhileDirect({ rtcLive: false, via: 'ws', lastDcAt: 0, now: 5000 });
  assert(mqttOnly.drop === false, 'mqtt-only packet was dropped');
  ok('relay packets refresh a live direct link and take over when it goes quiet');
} catch (e) { bad('relay packets refresh a live direct link and take over when it goes quiet', e); }

if (fails.length) {
  console.error('FAIL', fails.length);
  process.exit(1);
}
console.log('ALL PASS');
