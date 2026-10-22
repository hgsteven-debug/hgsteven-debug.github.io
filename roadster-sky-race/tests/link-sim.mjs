// 丟包與延遲下，輸入歷史仍能把方向與點按送到房主。不開瀏覽器。
import * as sync from '../js/sync.js';
import * as ice from '../js/ice.js';
import { makeRelayMidPrefix } from '../js/relay.js';
import { trackById, TRACKS } from '../js/tracks.js';

const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

function simulate({ loss, jitter, history, seed, ms = 20000, blackoutAt = 8000, blackoutFor = 800 }) {
  const rand = mulberry32(seed);
  const remote = { seq: 0, cmd: sync.zeroInput(), lastAt: 0 };
  const log = [];
  const flight = [];
  const taps = [];
  const recovered = new Set();
  let seq = 0;
  let now = 0;
  let nextSend = 0;
  let samples = 0;
  let stale = 0;
  let maxGap = 0;
  const ages = [];
  let caughtUp = false;
  while (now <= ms) {
    const dark = now >= blackoutAt && now < blackoutAt + blackoutFor;
    if (now >= nextSend) {
      seq += 1;
      const sendAt = now;
      const nitro = seq % 29 === 0;
      const inBlackout = sendAt >= blackoutAt && sendAt < blackoutAt + blackoutFor;
      if (nitro && !inBlackout) taps.push(seq);
      const cmd = {
        steer: Math.round(Math.sin(seq / 6) * 100) / 100,
        throttle: 1, brake: 0, lift: false, nitro, pitch: 0,
      };
      log.push({ seq, cmd });
      const hist = history ? log.slice(-sync.INPUT_HISTORY, -1).map((row) => Object.assign({ seq: row.seq }, row.cmd)) : [];
      const msg = Object.assign({ t: 'input', seq, hist }, cmd);
      if (!dark && rand() >= loss) flight.push({ arrive: now + Math.floor(rand() * (jitter + 1)), msg });
      nextSend += 50;
    }
    if (!dark) {
      for (let i = flight.length - 1; i >= 0; i--) {
        if (flight[i].arrive > now) continue;
        const msg = flight[i].msg;
        const prev = remote.seq | 0;
        sync.acceptInputs(remote, msg, now);
        const rows = (msg.hist || []).concat(msg);
        for (const row of rows) {
          const n = row.seq | 0;
          if (row.nitro && n > prev && remote.seq >= n) recovered.add(n);
        }
        flight.splice(i, 1);
      }
    } else {
      flight.length = 0;
    }
    const gap = seq - (remote.seq | 0);
    if (gap > maxGap) maxGap = gap;
    const age = remote.lastAt ? now - remote.lastAt : jitter + 1000;
    ages.push(age);
    if (age > 250) stale += 1;
    samples += 1;
    if (now > blackoutAt + blackoutFor + jitter && gap <= 4) caughtUp = true;
    now += 16;
  }
  for (const item of flight) {
    const prev = remote.seq | 0;
    sync.acceptInputs(remote, item.msg, ms + jitter);
    const rows = (item.msg.hist || []).concat(item.msg);
    for (const row of rows) {
      const n = row.seq | 0;
      if (row.nitro && n > prev && remote.seq >= n) recovered.add(n);
    }
  }
  ages.sort((a, b) => a - b);
  const tapHit = taps.filter((n) => recovered.has(n)).length;
  return {
    loss, jitter, history: !!history,
    samples, stalePct: samples ? +(100 * stale / samples).toFixed(1) : 0,
    p95Age: percentile(ages, 0.95),
    maxGap,
    taps: taps.length,
    tapHit,
    tapPct: taps.length ? +(100 * tapHit / taps.length).toFixed(1) : 0,
    caughtUp,
    endGap: seq - (remote.seq | 0),
  };
}

function testLoss() {
  const seeds = [3, 8, 21, 44, 90];
  const rows = seeds.map((seed) => ({
    withHist: simulate({ loss: 0.15, jitter: 300, history: true, seed }),
    plain: simulate({ loss: 0.15, jitter: 300, history: false, seed }),
  }));
  const avg = (key, side) => +(rows.reduce((s, row) => s + row[side][key], 0) / rows.length).toFixed(1);
  const summary = {
    loss: 0.15, jitterMs: 300, seeds: seeds.length,
    histTapPct: avg('tapPct', 'withHist'), plainTapPct: avg('tapPct', 'plain'),
    histP95Age: avg('p95Age', 'withHist'), histStalePct: avg('stalePct', 'withHist'),
    histMaxGap: Math.max(...rows.map((row) => row.withHist.maxGap)),
    caughtUp: rows.every((row) => row.withHist.caughtUp),
  };
  console.log('LOSS_STATS', JSON.stringify(summary));
  assert(summary.histTapPct >= 98, 'history lost taps ' + summary.histTapPct);
  assert(summary.histTapPct > summary.plainTapPct + 10, 'history did not beat single packets ' + summary.plainTapPct);
  assert(summary.histP95Age <= 500, 'p95 age ' + summary.histP95Age);
  assert(summary.caughtUp, 'did not catch up after the blackout');
  assert(rows.every((row) => row.withHist.endGap <= 4), 'end gap');
  assert(summary.histStalePct < 15, 'too many stale ticks ' + summary.histStalePct);
}

function testLinkHelpers() {
  assert(sync.linkKind('direct') === 'direct');
  assert(sync.linkKind('relay') === 'turn');
  assert(sync.linkKind('ws') === 'mqtt');
  assert(sync.linkQuality({ rtt: 20, via: 'direct', age: 10 }) === 'good');
  assert(sync.linkQuality({ rtt: 140, via: 'relay', age: 10 }) === 'poor');
  assert(sync.linkQuality({ rtt: 400, via: 'ws', age: 10 }) === 'bad');
  assert(sync.lanIsolationHint({ directFailed: true, sawLocalHost: true, sawRemoteHost: true, via: 'relay' }) === true);
  assert(sync.lanIsolationHint({ directFailed: true, sawLocalHost: true, sawRemoteHost: false, via: 'ws' }) === false);
  assert(sync.lanIsolationHint({ directFailed: false, sawLocalHost: true, sawRemoteHost: true, via: 'ws' }) === false);
  assert(sync.lanIsolationHint({ directFailed: false, sawLocalHost: true, sawRemoteHost: true, via: 'direct' }) === false);
  assert(sync.stateGapMs('good') === 66);
  assert(sync.stateGapMs('poor') === 100);
  assert(sync.stateGapMs('bad') === 140);
  const prev = sync.packSelf({ x: 1, y: 2, z: 3, qw: 1, speed: 10, onRoad: true });
  const next = sync.packSelf({ x: 1.4, y: 2, z: 3, qw: 1, speed: 12, onRoad: true });
  const delta = sync.deltaPose(prev, next);
  const merged = sync.mergePose(prev, delta);
  assert(merged.x === next.x && merged.speed === next.speed && merged.y === prev.y, JSON.stringify(merged));
  const mids = sync.makeMidWindow(4);
  assert(mids.accept('a') && !mids.accept('a') && mids.accept(null));
  const hostPre = makeRelayMidPrefix('host');
  const guestPre = makeRelayMidPrefix('guest');
  assert(hostPre.startsWith('h') && guestPre.startsWith('g') && hostPre !== guestPre, hostPre + ' ' + guestPre);
  assert(makeRelayMidPrefix('guest') !== guestPre, 'prefix reused');
  const echo = sync.makeMidWindow(64);
  for (let i = 1; i <= 80; i++) echo.accept(hostPre + '-' + i);
  assert(echo.accept(guestPre + '-1') && echo.accept(guestPre + '-12'), 'guest mid eaten by host echo');
  const remote = { seq: 0, cmd: sync.zeroInput(), lastAt: 0 };
  const applied = sync.acceptInputs(remote, {
    seq: 5, steer: 0.4, throttle: 1, brake: 0, lift: false, nitro: false, pitch: 0,
    hist: [
      { seq: 4, steer: 0.2, throttle: 1, brake: 0, lift: true, nitro: true, pitch: 0 },
    ],
  }, 1000);
  assert(applied === 5 && remote.cmd.nitro && remote.cmd.lift && remote.cmd.steer === 0.4, JSON.stringify(remote.cmd));
  assert(ice.iceTransportPolicy('') === 'all');
  assert(ice.iceTransportPolicy('?forceTurn=1') === 'relay');
  assert(ice.rtcConfig().iceTransportPolicy === 'all');
  const urls = ice.iceServers().map((s) => String(s.urls));
  assert(urls.some((u) => u.startsWith('stun:stun.l.google.com')), 'stun');
  assert(urls.some((u) => u.includes('global.relay.metered.ca')), 'turn host');
  assert(!urls.some((u) => u.includes('openrelay.metered.ca')), 'extra turn allocation');
  assert(!TRACKS.some((t) => t.id === 'stunt'));
  assert(trackById('stunt').id === 'city');
  assert(trackById('city').city === true);
  assert(TRACKS.some((t) => t.id === 'canyon') && TRACKS.some((t) => t.id === 'coast'));
  assert(TRACKS.some((t) => t.id === 'moon' && t.gravity === 1.62));
  assert(ice.nextJoinStage({ age: 1000, rtcOk: true, policy: 'all' }) === 'direct');
  assert(ice.nextJoinStage({ age: 5000, rtcOk: true, policy: 'all' }) === 'turn');
  assert(ice.nextJoinStage({ age: 5000, rtcOk: true, policy: 'all', iceDirect: true }) === 'direct');
  assert(ice.nextJoinStage({ age: 9000, rtcOk: true, policy: 'all' }) === 'mqtt');
  assert(ice.nextJoinStage({ age: 1000, rtcOk: false }) === 'mqtt');
  assert(ice.nextJoinStage({ age: 2000, rtcOk: true, policy: 'relay' }) === 'turn');
  assert(ice.nextJoinStage({ age: 9000, rtcOk: true, policy: 'relay' }) === 'mqtt');
  assert(ice.nextJoinStage({ age: 10000, rtcOk: true, proven: true, connected: true, via: 'ws' }) === 'mqtt');
  assert(ice.nextJoinStage({ age: 10000, rtcOk: true, proven: true, connected: true, via: 'direct' }) === 'direct');
  const packed = sync.packSelf({ x: 0, y: 0, z: 0, energy: 300, vx: 0, vy: 0, vz: 0 });
  assert(packed.energy === 100, 'energy cap ' + packed.energy);
}

try { testLinkHelpers(); ok('link kind, delta, ice policy, legacy track'); }
catch (e) { bad('link kind, delta, ice policy, legacy track', e); }
try { testLoss(); ok('15% loss / 300ms jitter input history'); }
catch (e) { bad('15% loss / 300ms jitter input history', e); }

if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
