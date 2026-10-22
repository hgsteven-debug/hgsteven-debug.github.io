// 量測二進位封包，並在 15% 丟包與抖動下確認三支手機的點按和姿態。
import * as sync from '../js/sync.js';
import { mqttPublish } from '../js/relay.js';
import {
  encodeState, decodeState, createDict, encodeInput, decodeInput, holdCars, inputParts, inputChanged,
  seqNewer,
  INPUT_KEEPALIVE_MS, bytesToB64, relayWireBytes,
} from '../js/wire.js';

const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

const NAMES = ['P1', 'P2', 'P3', 'P4', 'P5'];
const PAINTS = ['white', 'red', 'blue', 'black', 'silver'];
const VEH = ['roadster', 'model3', 'modely', 'models', 'modelx'];
const TOPIC = 'skyroadster/v1/AB2CDE';

function quat(yaw, pitch) {
  const c1 = Math.cos(pitch / 2), c2 = Math.cos(yaw / 2);
  const s1 = Math.sin(pitch / 2), s2 = Math.sin(yaw / 2);
  return { qx: s1 * c2, qy: c2 * s2, qz: -s1 * s2, qw: c1 * c2 };
}
function carAt(i, t) {
  const phase = t * 0.035 + i * 1.7;
  const radius = 280 + (i % 3) * 40;
  const x = Math.cos(phase) * radius;
  const z = Math.sin(phase) * (radius * 0.85);
  const y = 2 + Math.sin(phase * 2) * 1.2;
  const heading = phase + Math.PI / 2;
  const speed = 26 + Math.sin(t * 0.4 + i) * 4;
  const q = quat(heading, Math.sin(t + i) * 0.08);
  return {
    id: NAMES[i], name: NAMES[i], kind: i < 2 ? 'local' : 'remote',
    vehicle: VEH[i], paint: PAINTS[i],
    x, y, z, ...q,
    vx: -Math.sin(heading) * speed, vy: Math.cos(t + i) * 0.4, vz: -Math.cos(heading) * speed,
    nx: 0.02, ny: 1, nz: 0, heading, speed, gy: y - 0.4,
    steer: Math.sin(t * 0.8 + i) * 0.3, thrust: 0.8, lift: 0, fi: (t * 3 + i * 20) % 400,
    grounded: true, nitro: (Math.floor(t) + i) % 17 === 0, braking: false, onRoad: true,
    lap: 1, finish: null,
  };
}
function selfOf(pose, t) {
  return sync.packSelf({
    x: pose.x, y: pose.y, z: pose.z, qx: pose.qx, qy: pose.qy, qz: pose.qz, qw: pose.qw,
    vx: pose.vx, vy: pose.vy, vz: pose.vz, heading: pose.heading, speed: pose.speed,
    energy: Math.max(0, 100 - (t % 30)), grounded: true, onRoad: true,
    nitroOn: pose.nitro, thrusting: true, thrust: 0.85, lift: 0, braking: false,
    steerAngle: pose.steer, groundY: pose.gy, nx: pose.nx, ny: 1, nz: pose.nz,
    fi: pose.fi, lat: Math.sin(t) * 1.5, attached: true, alt: Math.max(0, pose.y - pose.gy),
    yawRate: 0.05, hover: 9, airTime: 0, pitchView: 0, speedF: pose.speed, accel: 0.2,
    latAccel: 0, detachCool: 0, vlat: 0, prevL: 0,
  });
}
function buildState(phoneIndex, phones, t, seq) {
  const cars = [];
  const total = 2 + phones;
  for (let i = 0; i < total; i++) {
    if (i === phoneIndex) continue;
    cars.push(sync.packPose(carAt(i, t)));
  }
  const selfPose = carAt(phoneIndex, t);
  const standings = [];
  for (let i = 0; i < total; i++) standings.push({ name: NAMES[i], finish: null, kind: i < 2 ? 'local' : 'remote' });
  return {
    t: 'state', race: 'race', cd: 0, track: 'canyon', ack: seq, selfId: NAMES[phoneIndex],
    self: selfOf(selfPose, t),
    selfLap: { n: 1, t, last: null, best: 92.4 },
    standings, cars, selfVehicle: VEH[phoneIndex], selfPaint: PAINTS[phoneIndex],
  };
}

function measure(phones, link) {
  const gap = link === 'relay' ? 100 : 66;
  const dur = 10000;
  const ctx = Array.from({ length: phones }, () => ({}));
  let stateBytes = 0, statePkts = 0;
  const sizes = [];
  for (let tms = 0; tms < dur; tms += gap) {
    const t = tms / 1000;
    for (let p = 0; p < phones; p++) {
      const msg = buildState(2 + p, phones, t, Math.floor(tms / 50));
      const bytes = encodeState(msg, ctx[p], tms);
      let wire;
      if (link === 'relay') {
        const env = { from: 'host', nonce: 'n' + p + 'abc12345', b: bytesToB64(bytes), mid: 'habc12-1' };
        wire = mqttPublish(TOPIC, JSON.stringify(env)).length;
      } else wire = bytes.length + 3;
      stateBytes += wire;
      statePkts++;
      sizes.push(link === 'relay' ? mqttPublish(TOPIC, JSON.stringify({ from: 'h', nonce: 'n', b: bytesToB64(bytes), mid: 'h1' })).length : bytes.length);
    }
  }
  let inBytes = 0, inPkts = 0;
  const inSizes = [];
  const logs = ctx.map(() => ({ last: null, lastSend: -1000, seq: 0, hist: [] }));
  for (let tms = 0; tms < dur; tms += 16) {
    for (let p = 0; p < phones; p++) {
      const log = logs[p];
      const parts = inputParts({
        steer: Math.sin(tms / 400 + p) * 0.8,
        throttle: 1, brake: 0,
        lift: Math.floor(tms / 50) % 80 === 0, nitro: Math.floor(tms / 50) % 47 === 0,
        pitch: Math.sin(tms / 900) * 0.2,
      });
      const ch = inputChanged(log.last, parts);
      if (ch.edge && log.last && tms - log.lastSend < 32 && !ch.moved) continue;
      if (!ch.edge && !ch.moved && tms - log.lastSend < INPUT_KEEPALIVE_MS) continue;
      if (!ch.edge && ch.moved && tms - log.lastSend < 50) continue;
      log.seq += 1;
      log.lastSend = tms;
      const hist = log.hist.slice(-4);
      const bytes = encodeInput(Object.assign({ seq: log.seq, hist }, sync.packInput({
        steer: parts.steer / 127, throttle: parts.throttle / 255, brake: 0,
        lift: parts.lift, nitro: parts.nitro, pitch: parts.pitch / 127,
      })));
      log.hist.push(Object.assign({ seq: log.seq }, { steer: parts.steer / 127, throttle: 1, brake: 0, lift: parts.lift, nitro: parts.nitro, pitch: parts.pitch / 127 }));
      let wire;
      if (link === 'relay') {
        const env = { from: 'g' + p, nonce: 'g' + p + 'k7q2m9ab', b: bytesToB64(bytes), mid: 'gabc-1' };
        wire = mqttPublish(TOPIC, JSON.stringify(env)).length;
      } else wire = bytes.length + 3;
      inBytes += wire;
      inPkts++;
      inSizes.push(bytes.length);
      log.last = parts;
    }
  }
  const sec = dur / 1000;
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stateBps = stateBytes / phones / sec;
  const inBps = inBytes / phones / sec;
  return {
    phones, link,
    stateBps: Math.round(stateBps),
    statePps: +(statePkts / phones / sec).toFixed(2),
    stateAvg: Math.round(avg(sizes)),
    inBps: Math.round(inBps),
    inPps: +(inPkts / phones / sec).toFixed(2),
    inAvg: Math.round(avg(inSizes)),
    mb10: +((stateBps + inBps) * 600 / 1e6).toFixed(2),
  };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function testLoss() {
  const rand = mulberry32(11);
  const phones = [0, 1, 2].map(() => ({
    remote: { seq: 0, cmd: sync.zeroInput(), lastAt: 0 },
    log: [],
    seq: 0,
    taps: [],
    hit: new Set(),
    dict: createDict(),
    hold: { map: new Map() },
    buf: new sync.StateBuffer(100),
    errs: [],
    ctx: {},
    nextIn: 0,
    nextSt: 0,
    lastParts: null,
    lastSend: -1000,
  }));
  const flight = [];
  let now = 0;
  const ms = 20000;
  const loss = 0.15;
  const jitter = 80;
  while (now <= ms) {
    phones.forEach((phone, p) => {
      if (now >= phone.nextIn) {
        const nitro = Math.floor(now / 50) % 29 === 0;
        const lift = Math.floor(now / 50) % 41 === 0;
        const parts = inputParts({ steer: Math.sin(now / 300) * 0.6, throttle: 1, brake: 0, lift, nitro, pitch: 0 });
        const ch = inputChanged(phone.lastParts, parts);
        let wait = 0;
        if (!(ch.edge && !(phone.lastParts && now - phone.lastSend < 32 && !ch.moved))) {
          if (!ch.edge && !ch.moved) wait = INPUT_KEEPALIVE_MS;
          else if (!ch.edge && ch.moved) wait = 50;
        }
        if (phone.lastParts && now - phone.lastSend < wait) phone.nextIn = phone.lastSend + wait;
        else {
          phone.seq += 1;
          if (nitro) phone.taps.push(phone.seq);
          const cmd = { steer: parts.steer / 127, throttle: 1, brake: 0, lift, nitro, pitch: 0 };
          phone.log.push({ seq: phone.seq, cmd });
          const hist = phone.log.slice(-sync.INPUT_HISTORY, -1).map((row) => Object.assign({ seq: row.seq }, row.cmd));
          const bytes = encodeInput(Object.assign({ seq: phone.seq, hist }, cmd));
          phone.lastParts = parts;
          phone.lastSend = now;
          phone.nextIn = now + 16;
          if (rand() >= loss) flight.push({ kind: 'in', p, arrive: now + Math.floor(rand() * jitter), bytes });
        }
      }
      if (now >= phone.nextSt) {
        phone.nextSt = now + 66;
        const msg = buildState(2 + p, 3, now / 1000, phone.seq);
        const bytes = encodeState(msg, phone.ctx, now);
        if (rand() >= loss) flight.push({ kind: 'st', p, arrive: now + Math.floor(rand() * jitter), bytes });
      }
    });
    for (let i = flight.length - 1; i >= 0; i--) {
      const item = flight[i];
      if (item.arrive > now) continue;
      const phone = phones[item.p];
      if (item.kind === 'in') {
        const msg = decodeInput(item.bytes);
        const prev = phone.remote.seq | 0;
        sync.acceptInputs(phone.remote, msg, now);
        const rows = (msg.hist || []).concat(msg);
        for (const row of rows) if (row.nitro && (row.seq | 0) > prev && phone.remote.seq >= (row.seq | 0)) phone.hit.add(row.seq | 0);
      } else {
        const msg = decodeState(item.bytes, phone.dict);
        holdCars(phone.hold, msg, now);
        if (msg.self) phone.buf.push(now, [Object.assign({ id: 'self' }, msg.self)]);
        const sample = phone.buf.sample(now);
        const truth = carAt(2 + item.p, Math.max(0, now - 100) / 1000);
        if (sample[0]) phone.errs.push(Math.hypot((sample[0].x || 0) - truth.x, (sample[0].z || 0) - truth.z));
      }
      flight.splice(i, 1);
    }
    now += 16;
  }
  const tapPct = phones.map((phone) => phone.taps.length ? 100 * phone.taps.filter((n) => phone.hit.has(n)).length / phone.taps.length : 0);
  const errs = phones.flatMap((phone) => phone.errs).sort((a, b) => a - b);
  const p95 = errs.length ? errs[Math.min(errs.length - 1, Math.ceil(errs.length * 0.95) - 1)] : 999;
  const med = errs.length ? errs[Math.floor(errs.length * 0.5)] : 999;
  console.log('LOSS', JSON.stringify({ tapPct: tapPct.map((n) => +n.toFixed(1)), p95: +p95.toFixed(2), med: +med.toFixed(2), samples: errs.length }));
  assert(tapPct.every((n) => n >= 98), 'nitro under loss ' + tapPct.join(','));
  assert(p95 < 3, 'pose p95 ' + p95);
  assert(med < 0.8, 'pose median ' + med);
}

function testBudget() {
  const rows = [];
  for (const phones of [1, 2, 3]) for (const link of ['direct', 'relay']) rows.push(measure(phones, link));
  console.log('AFTER', JSON.stringify(rows, null, 2));
  const worst = rows.find((r) => r.phones === 3 && r.link === 'relay');
  const direct = rows.find((r) => r.phones === 3 && r.link === 'direct');
  assert(direct.stateBps < 4000, 'direct state ' + direct.stateBps);
  assert(direct.inBps < 2500, 'direct input ' + direct.inBps);
  assert(worst.stateBps < 8000, 'relay state ' + worst.stateBps);
  assert(worst.inBps < 5000, 'relay input ' + worst.inBps);
  assert(worst.mb10 < 8, 'relay 10 min ' + worst.mb10);
  const env = relayWireBytes({ b: 'aa', mid: 'h1', from: 'host' });
  assert(env > 20 && env < 80, 'envelope ' + env);
}

function testSelfAlways() {
  const ctx = {};
  const dict = createDict();
  let far = 0;
  let prev = null;
  for (let i = 0; i < 8; i++) {
    const msg = {
      t: 'state', race: 'race', track: 'canyon', ack: 1,
      self: { x: i, y: 1, z: 2, vx: 10, vy: 0, vz: 0, heading: 0.2, qx: 0, qy: 0, qz: 0, qw: 1, speed: 10, energy: 80, groundY: 1 },
      selfId: 'r0', selfLap: { n: 1, t: i * 0.1 },
      cars: [{ id: 'far', name: 'P1', kind: 'local', x: 800, y: 0, z: 0, vx: 1, vy: 0, vz: 0, heading: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 1 }],
    };
    const dec = decodeState(encodeState(msg, ctx, i * 66), dict);
    assert(dec && dec.self && Math.abs(dec.self.speed - 10) < 0.05, 'own car every packet ' + i + ' ' + (dec && dec.self && dec.self.speed));
    assert(seqNewer(prev, dec.seq), 'seq ' + prev + ' ' + dec.seq);
    prev = dec.seq;
    if ((dec.cars || []).some((c) => c && (c.id === 'far' || c.name === 'P1'))) far++;
  }
  assert(far > 0 && far < 8, 'far car is not every packet ' + far);
  assert(!seqNewer(prev, prev) && !seqNewer(prev, (prev - 3) & 65535), 'old seq dropped');
}

try { testSelfAlways(); ok('self full rate'); } catch (e) { bad('self full rate', e); }
try { testBudget(); ok('budget'); } catch (e) { bad('budget', e); }
try { testLoss(); ok('loss'); } catch (e) { bad('loss', e); }
if (fails.length) { console.error('FAILED', fails.join(', ')); process.exit(1); }
console.log('ALL PASS');
