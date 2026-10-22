// 比賽封包的二進位編碼。控制訊息（歡迎、心跳、離開）仍走物件。
// 位置用 5 公分的 int16（賽道大約 ±800 公尺，1 公分的 int16 裝不下）。
// 速度用公分／秒。姿態用航向＋俯仰＋側傾；翻車時才多帶一段四元數。

import { VEHICLES, PAINT_DEFS } from './vehicles.js';
import { TRACKS } from './tracks.js';

export const INPUT_KEEPALIVE_MS = 200;
export const NEAR_CAR_M = 110;
export const FAR_CAR_STRIDE = 4;
export const KEYFRAME_MS = 1000;
export const STATE_MAGIC = 0x53;
export const INPUT_MAGIC = 0x49;

// 序號往前才算新。同一包從中繼晚到時丟掉，避免和直連交錯把車拉回去。
export function seqNewer(prev, next) {
  if (prev == null) return true;
  const d = ((next | 0) - (prev | 0)) & 0xffff;
  return d !== 0 && d < 0x8000;
}

const VEH_IDS = VEHICLES.map((v) => v.id);
const PAINT_IDS = Object.keys(PAINT_DEFS);
const TRACK_IDS = TRACKS.map((t) => t.id);
const PHASES = ['menu', 'loading', 'countdown', 'race', 'paused', 'results'];
const KINDS = ['local', 'remote', 'ai'];
const enc = new TextEncoder();
const dec = new TextDecoder();

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}
function qPos(m) { return clamp(Math.round((+m || 0) / 0.05), -32768, 32767); }
function dqPos(n) { return n * 0.05; }
function qVel(m) { return clamp(Math.round((+m || 0) * 100), -32768, 32767); }
function dqVel(n) { return n / 100; }
function qYaw(rad) {
  let r = +rad || 0;
  const t = Math.PI * 2;
  r %= t;
  if (r < 0) r += t;
  return clamp(Math.round(r / t * 65535), 0, 65535);
}
function dqYaw(n) { return (n / 65535) * Math.PI * 2; }
function qAng(rad) { return clamp(Math.round((+rad || 0) * 100), -128, 127); }
function dqAng(n) { return n / 100; }
function qNorm(n) { return clamp(Math.round((+n || 0) * 127), -128, 127); }
function dqNorm(n) { return n / 127; }
function qUnit(n) { return clamp(Math.round((+n || 0) * 255), 0, 255); }
function qCent(n) { return clamp(Math.round((+n || 0) * 100), -128, 127); }

function indexOf(list, id) {
  const i = list.indexOf(id);
  return i < 0 ? 255 : i;
}

export function quatFromYXZ(pitch, yaw, roll) {
  const c1 = Math.cos(pitch / 2), c2 = Math.cos(yaw / 2), c3 = Math.cos(roll / 2);
  const s1 = Math.sin(pitch / 2), s2 = Math.sin(yaw / 2), s3 = Math.sin(roll / 2);
  return {
    qx: s1 * c2 * c3 + c1 * s2 * s3,
    qy: c1 * s2 * c3 - s1 * c2 * s3,
    qz: c1 * c2 * s3 - s1 * s2 * c3,
    qw: c1 * c2 * c3 + s1 * s2 * s3,
  };
}

export function eulerYXZ(qx, qy, qz, qw) {
  const x = +qx || 0, y = +qy || 0, z = +qz || 0, w = qw == null ? 1 : +qw;
  const pitch = Math.asin(clamp(2 * (w * x - y * z), -1, 1));
  const yaw = Math.atan2(2 * (x * z + w * y), w * w - x * x - y * y + z * z);
  const roll = Math.atan2(2 * (x * y + w * z), w * w - x * x + y * y - z * z);
  return { pitch, yaw, roll };
}

function qDot(a, b) {
  return Math.abs((a.qx || 0) * b.qx + (a.qy || 0) * b.qy + (a.qz || 0) * b.qz + (a.qw == null ? 1 : a.qw) * b.qw);
}

function makeW(cap) {
  const b = new Uint8Array(cap || 256);
  return { b, n: 0, v: new DataView(b.buffer) };
}
function need(w, k) {
  if (w.n + k <= w.b.length) return;
  const n = new Uint8Array(Math.max(w.b.length * 2, w.n + k + 32));
  n.set(w.b.subarray(0, w.n));
  w.b = n;
  w.v = new DataView(n.buffer);
}
function u8(w, x) { need(w, 1); w.b[w.n++] = x & 255; }
function i8(w, x) { u8(w, x < 0 ? x + 256 : x); }
function u16(w, x) { need(w, 2); w.v.setUint16(w.n, x & 65535, true); w.n += 2; }
function i16(w, x) { need(w, 2); w.v.setInt16(w.n, clamp(x, -32768, 32767), true); w.n += 2; }
function u24(w, x) {
  const n = clamp(x | 0, 0, 0xffffff);
  u8(w, n & 255); u8(w, (n >> 8) & 255); u8(w, (n >> 16) & 255);
}
function str(w, s, max) {
  const u = enc.encode(String(s == null ? '' : s).slice(0, max || 24));
  const n = Math.min(255, u.length);
  u8(w, n);
  need(w, n);
  w.b.set(u.subarray(0, n), w.n);
  w.n += n;
}
function bytesOf(w) { return w.b.slice(0, w.n); }

function makeR(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return { b, n: 0, v: new DataView(b.buffer, b.byteOffset, b.byteLength) };
}
function ru8(r) {
  if (r.n >= r.b.length) throw new Error('short');
  return r.b[r.n++];
}
function ri8(r) { const n = ru8(r); return n < 128 ? n : n - 256; }
function ru16(r) {
  if (r.n + 2 > r.b.length) throw new Error('short');
  const n = r.v.getUint16(r.n, true); r.n += 2; return n;
}
function ri16(r) {
  if (r.n + 2 > r.b.length) throw new Error('short');
  const n = r.v.getInt16(r.n, true); r.n += 2; return n;
}
function ru24(r) { return ru8(r) | (ru8(r) << 8) | (ru8(r) << 16); }
function rstr(r) {
  const n = ru8(r);
  if (r.n + n > r.b.length) throw new Error('short');
  const s = dec.decode(r.b.subarray(r.n, r.n + n));
  r.n += n;
  return s;
}

function writeQuat(w, qx, qy, qz, qw) {
  const a = [+qx || 0, +qy || 0, +qz || 0, qw == null ? 1 : +qw];
  let maxI = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(a[i]) > Math.abs(a[maxI])) maxI = i;
  if (a[maxI] < 0) { a[0] = -a[0]; a[1] = -a[1]; a[2] = -a[2]; a[3] = -a[3]; }
  u8(w, maxI);
  for (let i = 0; i < 4; i++) if (i !== maxI) i16(w, Math.round(clamp(a[i], -1, 1) * 32767));
}
function readQuat(r) {
  const maxI = ru8(r);
  const rest = [ri16(r) / 32767, ri16(r) / 32767, ri16(r) / 32767];
  const a = [0, 0, 0, 0];
  let k = 0, sum = 0;
  for (let i = 0; i < 4; i++) {
    if (i === maxI) continue;
    a[i] = rest[k++];
    sum += a[i] * a[i];
  }
  a[maxI] = Math.sqrt(Math.max(0, 1 - sum));
  return { qx: a[0], qy: a[1], qz: a[2], qw: a[3] };
}

function writeOrient(w, heading, qx, qy, qz, qw) {
  const e = eulerYXZ(qx, qy, qz, qw);
  const pitch = Number.isFinite(e.pitch) ? e.pitch : 0;
  const roll = Number.isFinite(e.roll) ? e.roll : 0;
  u16(w, qYaw(heading));
  i8(w, qAng(pitch));
  i8(w, qAng(roll));
  const rec = quatFromYXZ(dqAng(qAng(pitch)), dqYaw(qYaw(heading)), dqAng(qAng(roll)));
  const src = { qx, qy, qz, qw };
  if (qDot(src, rec) < 0.992) { u8(w, 1); writeQuat(w, qx, qy, qz, qw); }
  else u8(w, 0);
}
function readOrient(r) {
  const heading = dqYaw(ru16(r));
  const pitch = dqAng(ri8(r));
  const roll = dqAng(ri8(r));
  let q = quatFromYXZ(pitch, heading, roll);
  if (ru8(r)) q = readQuat(r);
  return { heading, pitch, roll, qx: q.qx, qy: q.qy, qz: q.qz, qw: q.qw };
}

function slotFor(remote, id) {
  if (!remote._slots) remote._slots = new Map();
  const key = String(id == null ? '' : id);
  if (remote._slots.has(key)) return remote._slots.get(key);
  const n = remote._slots.size & 255;
  remote._slots.set(key, n);
  return n;
}

function writeIdentity(w, car) {
  const kind = KINDS.indexOf(car.kind);
  u8(w, kind < 0 ? 1 : kind);
  const vi = indexOf(VEH_IDS, car.vehicle);
  u8(w, vi);
  if (vi === 255) str(w, car.vehicle || '', 24);
  const pi = indexOf(PAINT_IDS, car.paint);
  u8(w, pi);
  if (pi === 255) str(w, car.paint || '', 16);
  str(w, car.id || car.name || '', 16);
  str(w, car.name || car.id || '', 24);
  if (car.finish == null || !Number.isFinite(+car.finish)) u24(w, 0xffffff);
  else u24(w, Math.round((+car.finish) * 1000));
}
function readIdentity(r) {
  const kind = KINDS[ru8(r)] || 'remote';
  let vi = ru8(r);
  const vehicle = vi === 255 ? rstr(r) : (VEH_IDS[vi] || VEH_IDS[0] || 'roadster');
  let pi = ru8(r);
  const paint = pi === 255 ? rstr(r) : (PAINT_IDS[pi] || 'white');
  const id = rstr(r);
  const name = rstr(r);
  const fin = ru24(r);
  return { kind, vehicle, paint, id, name, finish: fin === 0xffffff ? null : fin / 1000 };
}

function writePose(w, p, slot, ident) {
  u8(w, slot & 255);
  i16(w, qPos(p.x)); i16(w, qPos(p.y)); i16(w, qPos(p.z));
  i16(w, qVel(p.vx)); i16(w, qVel(p.vy)); i16(w, qVel(p.vz));
  writeOrient(w, p.heading, p.qx, p.qy, p.qz, p.qw);
  i8(w, qNorm(p.nx)); i8(w, qNorm(p.nz));
  let flags = 0;
  if (p.grounded) flags |= 1;
  if (p.nitro || p.nitroOn) flags |= 2;
  if (p.braking) flags |= 4;
  if (p.onRoad !== false) flags |= 8;
  if (p.thrusting) flags |= 16;
  if (ident) flags |= 32;
  u8(w, flags);
  i16(w, qPos(p.gy == null ? p.y : p.gy));
  u8(w, qUnit(p.thrust));
  u8(w, clamp(Math.round((+p.lift || 0) * 100), 0, 255));
  i8(w, qCent(p.steer));
  if (ident) writeIdentity(w, p);
}
function readPose(r, dict) {
  const slot = ru8(r);
  const x = dqPos(ri16(r)), y = dqPos(ri16(r)), z = dqPos(ri16(r));
  const vx = dqVel(ri16(r)), vy = dqVel(ri16(r)), vz = dqVel(ri16(r));
  const o = readOrient(r);
  const nx = dqNorm(ri8(r)), nz = dqNorm(ri8(r));
  const ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz));
  const flags = ru8(r);
  const gy = dqPos(ri16(r));
  const thrust = ru8(r) / 255;
  const lift = ru8(r) / 100;
  const steer = ri8(r) / 100;
  let ident = dict && dict.slots.get(slot);
  if (flags & 32) {
    ident = readIdentity(r);
    if (dict) dict.slots.set(slot, ident);
  }
  const speed = Math.hypot(vx, vy, vz);
  return {
    id: ident ? ident.id : ('#' + slot),
    name: ident ? ident.name : ('#' + slot),
    kind: ident ? ident.kind : 'remote',
    vehicle: ident ? ident.vehicle : undefined,
    paint: ident ? ident.paint : undefined,
    lap: ident ? ident.lap : undefined,
    finish: ident ? ident.finish : null,
    x, y, z, vx, vy, vz, nx, ny, nz,
    heading: o.heading, qx: o.qx, qy: o.qy, qz: o.qz, qw: o.qw,
    gy, speed, thrust, lift, steer,
    grounded: !!(flags & 1), nitro: !!(flags & 2), braking: !!(flags & 4),
    onRoad: !!(flags & 8), thrusting: !!(flags & 16),
  };
}

function writeSelf(w, s, keyframe) {
  i16(w, qPos(s.x)); i16(w, qPos(s.y)); i16(w, qPos(s.z));
  i16(w, qVel(s.vx)); i16(w, qVel(s.vy)); i16(w, qVel(s.vz));
  writeOrient(w, s.heading, s.qx, s.qy, s.qz, s.qw);
  i8(w, qNorm(s.nx)); i8(w, qNorm(s.nz));
  let flags = 0;
  if (s.grounded) flags |= 1;
  if (s.onRoad !== false) flags |= 2;
  if (s.nitroOn) flags |= 4;
  if (s.thrusting) flags |= 8;
  if (s.braking) flags |= 16;
  if (s.attached) flags |= 32;
  if (s.flipAssist) flags |= 64;
  if (s.sawCeiling) flags |= 128;
  u8(w, flags);
  u8(w, clamp(Math.round(+s.energy || 0), 0, 100));
  u8(w, qUnit(s.thrust));
  u8(w, clamp(Math.round((+s.lift || 0) * 100), 0, 255));
  i8(w, qCent(s.steerAngle != null ? s.steerAngle : s.steer));
  i16(w, qPos(s.groundY == null ? s.y : s.groundY));
  i16(w, clamp(Math.round((+s.alt || 0) * 100), -32768, 32767));
  u16(w, clamp(Math.round(Math.max(0, +s.speed || 0) * 100), 0, 65535));
  i16(w, clamp(Math.round((+s.fi || 0) * 10), -32768, 32767));
  i16(w, clamp(Math.round((+s.lat || 0) * 100), -32768, 32767));
  if (!keyframe) return;
  i16(w, clamp(Math.round((+s.yawRate || 0) * 1000), -32768, 32767));
  i16(w, clamp(Math.round((+s.hover || 0) * 100), -32768, 32767));
  i16(w, clamp(Math.round((+s.airTime || 0) * 100), -32768, 32767));
  i16(w, clamp(Math.round((+s.pitchView || 0) * 1000), -32768, 32767));
  i16(w, clamp(Math.round((+s.speedF || 0) * 100), -32768, 32767));
  i16(w, clamp(Math.round((+s.accel || 0) * 100), -32768, 32767));
  i16(w, clamp(Math.round((+s.latAccel || 0) * 100), -32768, 32767));
  i16(w, clamp(Math.round((+s.detachCool || 0) * 100), -32768, 32767));
  i16(w, clamp(Math.round((+s.vlat || 0) * 100), -32768, 32767));
  i16(w, clamp(Math.round((+s.prevL || 0) * 100), -32768, 32767));
  u8(w, s.sawInvert ? 1 : 0);
}
function readSelf(r, keyframe) {
  const x = dqPos(ri16(r)), y = dqPos(ri16(r)), z = dqPos(ri16(r));
  const vx = dqVel(ri16(r)), vy = dqVel(ri16(r)), vz = dqVel(ri16(r));
  const o = readOrient(r);
  const nx = dqNorm(ri8(r)), nz = dqNorm(ri8(r));
  const ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz));
  const flags = ru8(r);
  const energy = ru8(r);
  const thrust = ru8(r) / 255;
  const lift = ru8(r) / 100;
  const steerAngle = ri8(r) / 100;
  const groundY = dqPos(ri16(r));
  const alt = ri16(r) / 100;
  const speed = ru16(r) / 100;
  const fi = ri16(r) / 10;
  const lat = ri16(r) / 100;
  const self = {
    x, y, z, vx, vy, vz, nx, ny, nz,
    heading: o.heading, qx: o.qx, qy: o.qy, qz: o.qz, qw: o.qw,
    energy, thrust, lift, steerAngle, groundY, alt, speed, fi, lat,
    grounded: !!(flags & 1), onRoad: !!(flags & 2), nitroOn: !!(flags & 4),
    thrusting: !!(flags & 8), braking: !!(flags & 16), attached: !!(flags & 32),
    flipAssist: !!(flags & 64), sawCeiling: !!(flags & 128),
  };
  if (!keyframe) return self;
  self.yawRate = ri16(r) / 1000;
  self.hover = ri16(r) / 100;
  self.airTime = ri16(r) / 100;
  self.pitchView = ri16(r) / 1000;
  self.speedF = ri16(r) / 100;
  self.accel = ri16(r) / 100;
  self.latAccel = ri16(r) / 100;
  self.detachCool = ri16(r) / 100;
  self.vlat = ri16(r) / 100;
  self.prevL = ri16(r) / 100;
  self.sawInvert = !!ru8(r);
  return self;
}

function hudKey(msg) {
  const lap = msg.selfLap || {};
  const rows = (msg.standings || []).map((row) => [
    row && row.name, row && row.kind, row && row.finish == null ? '' : Math.round(+row.finish * 100),
  ].join(',')).join('|');
  return [msg.selfVehicle || '', msg.selfPaint || '', lap.last, lap.best, rows].join(';');
}

function dist2(a, b) {
  if (!a || !b) return Infinity;
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  const dz = (a.z || 0) - (b.z || 0);
  return dx * dx + dy * dy + dz * dz;
}

function pickCars(msg, remote) {
  const cars = Array.isArray(msg.cars) ? msg.cars : [];
  const n = remote._stateN || 1;
  const keyframe = n === 1 || !remote._kfAt || (remote._now - remote._kfAt) >= KEYFRAME_MS;
  if (keyframe || !msg.self) return { list: cars, keyframe, far: false };
  const near = [];
  const far = [];
  const lim = NEAR_CAR_M * NEAR_CAR_M;
  for (const c of cars) {
    if (dist2(msg.self, c) <= lim) near.push(c);
    else far.push(c);
  }
  const sendFar = n % FAR_CAR_STRIDE === 0;
  return { list: sendFar ? near.concat(far) : near, keyframe: false, far: !sendFar && far.length > 0 };
}

export function encodeState(msg, remote, now) {
  const ctx = remote || {};
  ctx._stateN = (ctx._stateN || 0) + 1;
  ctx._now = now || 0;
  const picked = pickCars(msg || {}, ctx);
  if (picked.keyframe) ctx._kfAt = ctx._now;
  const key = hudKey(msg || {});
  const hasHud = picked.keyframe || key !== ctx._hudKey;
  if (hasHud) ctx._hudKey = key;
  const w = makeW(384);
  u8(w, STATE_MAGIC);
  let flags = 0;
  if (picked.keyframe) flags |= 1;
  if (msg && msg.self) flags |= 2;
  if (hasHud) flags |= 4;
  u8(w, flags);
  u16(w, ctx._stateN & 65535);
  u16(w, (msg && msg.ack) | 0);
  const phase = PHASES.indexOf(msg && msg.race);
  u8(w, phase < 0 ? 3 : phase);
  const ti = indexOf(TRACK_IDS, msg && msg.track);
  u8(w, ti === 255 ? 0 : ti);
  u8(w, clamp(Math.round(((msg && +msg.cd) || 0) * 20), 0, 255));
  const lap = (msg && msg.selfLap) || {};
  u8(w, clamp((lap.n | 0) || 1, 0, 255));
  u24(w, Math.round((+lap.t || 0) * 1000));
  const selfId = msg && msg.selfId;
  u8(w, selfId == null ? 255 : slotFor(ctx, selfId));
  const list = picked.list;
  u8(w, Math.min(255, list.length));
  if (msg && msg.self) writeSelf(w, msg.self, picked.keyframe);
  for (const car of list) {
    const id = car.id || car.name || '';
    writePose(w, car, slotFor(ctx, id), picked.keyframe);
  }
  if (hasHud) {
    const vi = indexOf(VEH_IDS, msg && msg.selfVehicle);
    u8(w, vi);
    if (vi === 255) str(w, (msg && msg.selfVehicle) || '', 24);
    const pi = indexOf(PAINT_IDS, msg && msg.selfPaint);
    u8(w, pi);
    if (pi === 255) str(w, (msg && msg.selfPaint) || '', 16);
    if (lap.last == null || !Number.isFinite(+lap.last)) u24(w, 0xffffff);
    else u24(w, Math.round((+lap.last) * 1000));
    if (lap.best == null || !Number.isFinite(+lap.best)) u24(w, 0xffffff);
    else u24(w, Math.round((+lap.best) * 1000));
    const rows = (msg && msg.standings) || [];
    u8(w, Math.min(32, rows.length));
    for (let i = 0; i < rows.length && i < 32; i++) {
      const row = rows[i] || {};
      str(w, row.name || '', 24);
      const k = KINDS.indexOf(row.kind);
      u8(w, k < 0 ? 1 : k);
      if (row.finish == null || !Number.isFinite(+row.finish)) u24(w, 0xffffff);
      else u24(w, Math.round((+row.finish) * 1000));
    }
  }
  return bytesOf(w);
}

export function createDict() { return { slots: new Map() }; }

export function decodeState(buf, dict) {
  const r = makeR(buf);
  if (ru8(r) !== STATE_MAGIC) return null;
  const flags = ru8(r);
  const keyframe = !!(flags & 1);
  const hasSelf = !!(flags & 2);
  const hasHud = !!(flags & 4);
  const seq = ru16(r);
  const ack = ru16(r);
  const race = PHASES[ru8(r)] || 'race';
  const track = TRACK_IDS[ru8(r)] || TRACK_IDS[0] || 'canyon';
  const cd = ru8(r) / 20;
  const lapN = ru8(r);
  const lapT = ru24(r) / 1000;
  const selfSlot = ru8(r);
  const nCars = ru8(r);
  const book = dict || createDict();
  const self = hasSelf ? readSelf(r, keyframe) : null;
  const cars = [];
  for (let i = 0; i < nCars; i++) cars.push(readPose(r, book));
  let selfVehicle, selfPaint, standings;
  const selfLap = { n: lapN, t: lapT };
  if (hasHud) {
    const vi = ru8(r);
    selfVehicle = vi === 255 ? rstr(r) : VEH_IDS[vi];
    const pi = ru8(r);
    selfPaint = pi === 255 ? rstr(r) : PAINT_IDS[pi];
    const last = ru24(r);
    const best = ru24(r);
    selfLap.last = last === 0xffffff ? null : last / 1000;
    selfLap.best = best === 0xffffff ? null : best / 1000;
    const n = ru8(r);
    standings = [];
    for (let i = 0; i < n; i++) {
      const name = rstr(r);
      const kind = KINDS[ru8(r)] || 'remote';
      const fin = ru24(r);
      standings.push({ name, kind, finish: fin === 0xffffff ? null : fin / 1000 });
    }
  }
  let selfId = null;
  if (selfSlot !== 255) {
    const ident = book.slots.get(selfSlot);
    selfId = ident ? ident.id : ('#' + selfSlot);
  }
  return {
    t: 'state', seq, ack, race, cd, track, selfId, self, selfLap, cars,
    selfVehicle, selfPaint, standings, keyframe, partial: !keyframe,
  };
}

export function holdCars(cache, msg, now) {
  if (!msg || msg.t !== 'state') return msg;
  const box = cache || { map: new Map() };
  if (!box.map) box.map = new Map();
  const incoming = msg.cars || [];
  if (msg.keyframe) box.map.clear();
  const seen = new Set();
  const out = [];
  for (const c of incoming) {
    if (!c || !c.id) continue;
    box.map.set(c.id, { pose: c, at: now });
    seen.add(c.id);
    out.push(c);
  }
  if (!msg.keyframe) {
    for (const [id, rec] of box.map) {
      if (seen.has(id)) continue;
      const age = (now - rec.at) / 1000;
      if (!(age >= 0) || age > 0.7) { box.map.delete(id); continue; }
      const p = Object.assign({}, rec.pose);
      p.x = (rec.pose.x || 0) + (rec.pose.vx || 0) * age;
      p.y = (rec.pose.y || 0) + (rec.pose.vy || 0) * age;
      p.z = (rec.pose.z || 0) + (rec.pose.vz || 0) * age;
      out.push(p);
    }
  }
  msg.cars = out;
  return msg;
}

export function inputParts(s) {
  const src = s || {};
  return {
    steer: clamp(Math.round((+src.steer || 0) * 127), -127, 127),
    throttle: clamp(Math.round((+src.throttle || 0) * 255), 0, 255),
    brake: clamp(Math.round((+src.brake || 0) * 255), 0, 255),
    pitch: clamp(Math.round((+src.pitch || 0) * 127), -127, 127),
    lift: !!src.lift,
    nitro: !!src.nitro,
  };
}
export function partsToCmd(p) {
  return {
    steer: (p.steer || 0) / 127,
    throttle: (p.throttle || 0) / 255,
    brake: (p.brake || 0) / 255,
    lift: !!p.lift,
    nitro: !!p.nitro,
    pitch: (p.pitch || 0) / 127,
  };
}
export function inputChanged(prev, next) {
  if (!prev || !next) return { edge: true, moved: true };
  const edge = prev.lift !== next.lift || prev.nitro !== next.nitro
    || ((prev.throttle === 0) !== (next.throttle === 0))
    || ((prev.brake === 0) !== (next.brake === 0));
  const moved = edge
    || Math.abs(prev.steer - next.steer) >= 2
    || Math.abs(prev.pitch - next.pitch) >= 2
    || Math.abs(prev.throttle - next.throttle) >= 4
    || Math.abs(prev.brake - next.brake) >= 4;
  return { edge, moved };
}

function writeCmd(w, p) {
  i8(w, p.steer | 0);
  u8(w, p.throttle | 0);
  u8(w, p.brake | 0);
  i8(w, p.pitch | 0);
  u8(w, (p.lift ? 1 : 0) | (p.nitro ? 2 : 0));
}
function readCmd(r) {
  const steer = ri8(r), throttle = ru8(r), brake = ru8(r), pitch = ri8(r), buttons = ru8(r);
  return partsToCmd({
    steer, throttle, brake, pitch,
    lift: !!(buttons & 1), nitro: !!(buttons & 2),
  });
}

export function encodeInput(msg) {
  const w = makeW(64);
  u8(w, INPUT_MAGIC);
  u16(w, (msg && msg.seq) | 0);
  writeCmd(w, inputParts(msg));
  const hist = (msg && msg.hist) || [];
  const rows = [];
  const seq = (msg && msg.seq) | 0;
  for (let i = hist.length - 1; i >= 0 && rows.length < 4; i--) {
    const row = hist[i];
    if (!row || row.seq == null) continue;
    const d = seq - (row.seq | 0);
    if (d <= 0 || d > 255) continue;
    rows.push({ d, p: inputParts(row) });
  }
  rows.reverse();
  u8(w, rows.length);
  for (const row of rows) { u8(w, row.d); writeCmd(w, row.p); }
  return bytesOf(w);
}

export function decodeInput(buf) {
  const r = makeR(buf);
  if (ru8(r) !== INPUT_MAGIC) return null;
  const seq = ru16(r);
  const cmd = readCmd(r);
  const n = ru8(r);
  const hist = [];
  for (let i = 0; i < n; i++) {
    const d = ru8(r);
    const row = readCmd(r);
    row.seq = seq - d;
    hist.push(row);
  }
  return Object.assign({ t: 'input', seq, hist }, cmd);
}

// PeerJS 的 bin16 是 0xDA 加 2 byte 長度。Safari 有時把整包（含這 3 byte）交出來。
function stripBinHeader(bytes) {
  if (!bytes || bytes.length < 2) return bytes;
  const t = bytes[0];
  if (t >= 0xa0 && t <= 0xaf && bytes.length === 1 + (t - 0xa0)) return bytes.subarray(1);
  if (t === 0xda && bytes.length >= 3) {
    const n = (bytes[1] << 8) | bytes[2];
    if (n > 0 && bytes.length === 3 + n) return bytes.subarray(3);
  }
  if (t === 0xc4 && bytes.length >= 2 && bytes.length === 2 + bytes[1]) return bytes.subarray(2);
  if (t === 0xc5 && bytes.length >= 3) {
    const n = (bytes[1] << 8) | bytes[2];
    if (n > 0 && bytes.length === 3 + n) return bytes.subarray(3);
  }
  return bytes;
}

export function decodeWire(data, dict) {
  let bytes = null;
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (!bytes || !bytes.length) return data;
  bytes = stripBinHeader(bytes);
  try {
    if (bytes[0] === STATE_MAGIC) return decodeState(bytes, dict);
    if (bytes[0] === INPUT_MAGIC) return decodeInput(bytes);
  } catch (e) { return null; }
  return data;
}

// 資料通道改走 JSON 序列化（Safari 對 PeerJS binary/bin16 會把封包弄丟）。
// 位元組本體仍是壓縮過的狀態，只用 base64 放進物件。
export function packDc(payload) {
  if (payload instanceof ArrayBuffer) payload = new Uint8Array(payload);
  if (payload instanceof Uint8Array) return { b: bytesToB64(payload) };
  return payload;
}
export function unpackDc(data) {
  if (!data || typeof data !== 'object') return data;
  if (typeof data.b === 'string' && data.t == null && data.from == null && data.nonce == null) {
    try { return b64ToBytes(data.b); } catch (e) { return data; }
  }
  return data;
}

export function bytesToB64(bytes) {
  let s = '';
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
export function b64ToBytes(text) {
  const s = atob(String(text || ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

export function unwrapRelay(msg) {
  if (!msg || typeof msg.b !== 'string') return msg;
  let data = null;
  try { data = decodeWire(b64ToBytes(msg.b)); } catch (e) { data = null; }
  if (!data || typeof data !== 'object') return msg;
  if (msg.nonce && data.nonce == null) data.nonce = msg.nonce;
  if (msg.from && data.from == null) data.from = msg.from;
  if (msg.lan) data.lan = 1;
  return data;
}

export function dcBytes(payload) {
  let n = 0;
  if (payload instanceof ArrayBuffer) n = payload.byteLength;
  else if (ArrayBuffer.isView(payload)) n = payload.byteLength;
  else {
    try { return enc.encode(JSON.stringify(payload)).length; } catch (e) { return 0; }
  }
  return n + (n <= 15 ? 1 : n <= 65535 ? 3 : 5);
}

// 房間代碼 6 碼時主題長度固定 22。只算一條連線，不含第二台 broker。
export function relayWireBytes(obj) {
  let n = 0;
  try { n = enc.encode(JSON.stringify(obj)).length; } catch (e) { n = 0; }
  const body = 2 + 22 + n;
  const rl = body < 128 ? 1 : body < 16384 ? 2 : 3;
  return 1 + rl + body;
}

export function relayFanTarget(primaryOpen, mirrorOpen) {
  if (primaryOpen) return 'primary';
  if (mirrorOpen) return 'mirror';
  return '';
}
