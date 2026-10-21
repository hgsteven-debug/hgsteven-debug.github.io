// 手機加入用的純邏輯：房間代碼、輸入封包、快照內插、預測修正。
// 不碰 DOM、不碰 WebRTC，方便在 node 裡單測。多人遠端時只要把 REMOTE_LIMIT 調高，清單結構不用改。

export const REMOTE_LIMIT = 1;
export const INPUT_STALE_MS = 500;
export const INTERP_DELAY_MS = 100;
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PUBLIC_ORIGIN = 'https://hgsteven-debug.github.io';

const ZERO = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0 };

export function zeroInput() {
  return { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0 };
}

export function makeRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length];
  return s;
}

export function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCode(code) {
  const c = normalizeCode(code);
  if (c.length <= 3) return c;
  return c.slice(0, 3) + '-' + c.slice(3);
}

export function peerIdFor(code) {
  return 'skyroadster-' + normalizeCode(code);
}

// 正式站走網站根目錄，讓現有的轉址把 ?join= 帶進遊戲。
// 本機或預覽網址則開目前這頁，測試才連得到。
export function joinUrl(code, loc) {
  const c = normalizeCode(code);
  const host = loc && loc.hostname ? String(loc.hostname) : '';
  if (!host || host === 'hgsteven-debug.github.io' || host.endsWith('.github.io')) {
    return PUBLIC_ORIGIN + '/?join=' + c;
  }
  const origin = loc.origin || '';
  const path = loc.pathname || '/';
  return origin + path + '?join=' + c;
}

function round3(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 1000) / 1000;
}

export function packInput(s) {
  const src = s || ZERO;
  return {
    steer: round3(src.steer),
    throttle: round3(src.throttle),
    brake: round3(src.brake),
    lift: !!src.lift,
    nitro: !!src.nitro,
    pitch: round3(src.pitch),
  };
}

export function unpackInput(msg) {
  return packInput(msg);
}

export function sameInput(a, b) {
  if (!a || !b) return false;
  return a.steer === b.steer && a.throttle === b.throttle && a.brake === b.brake
    && a.lift === b.lift && a.nitro === b.nitro && a.pitch === b.pitch;
}

// 太久沒收到手機輸入就滑行，不能卡死主機的比賽。
export function heldInput(remote, now, staleMs = INPUT_STALE_MS) {
  if (!remote || !remote.lastAt || !(now >= remote.lastAt) || now - remote.lastAt > staleMs) return zeroInput();
  return packInput(remote.cmd);
}

export function failText(err) {
  const type = err && err.type;
  if (type === 'browser-incompatible') return '這台瀏覽器不支援點對點連線，手機暫時無法加入。這台比賽不受影響。';
  if (type === 'peer-unavailable') return '找不到這個房間。請核對代碼，並請房主留在遊戲頁面。';
  if (type === 'unavailable-id') return '這組房間代碼剛被使用，請再試一次。';
  if (type === 'invalid-id') return '房間代碼無效。';
  return '連線失敗。請確認兩台裝置都有網路。嚴格的防火牆或對稱 NAT 可能擋下點對點連線。這台比賽不受影響。';
}

export function dist3(a, b) {
  if (!a || !b) return Infinity;
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  const dz = (a.z || 0) - (b.z || 0);
  return Math.hypot(dx, dy, dz);
}

// 誤差小就輕輕拉回；中等就用尚未確認的輸入重播；差太大直接對齊房主。
export function reconcileDecision(local, host, ack, log) {
  const err = dist3(local, host);
  const replay = [];
  const ackN = ack | 0;
  if (log) {
    for (let i = 0; i < log.length; i++) if (log[i].seq > ackN) replay.push(log[i]);
  }
  if (!(err >= 0)) return { mode: 'keep', err: 0, replay: [] };
  if (err < 0.45) return { mode: 'nudge', err, replay: [] };
  if (replay.length && err < 25) return { mode: 'replay', err, replay };
  return { mode: 'snap', err, replay: [] };
}

export function slerpQuat(a, b, t) {
  let ax = a.qx || 0, ay = a.qy || 0, az = a.qz || 0, aw = a.qw == null ? 1 : a.qw;
  let bx = b.qx || 0, by = b.qy || 0, bz = b.qz || 0, bw = b.qw == null ? 1 : b.qw;
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
  if (dot > 0.9995) {
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t, w = aw + (bw - aw) * t;
    const n = Math.hypot(x, y, z, w) || 1;
    return { qx: x / n, qy: y / n, qz: z / n, qw: w / n };
  }
  const theta = Math.acos(Math.min(1, dot));
  const s = Math.sin(theta);
  const w1 = Math.sin((1 - t) * theta) / s;
  const w2 = Math.sin(t * theta) / s;
  return { qx: ax * w1 + bx * w2, qy: ay * w1 + by * w2, qz: az * w1 + bz * w2, qw: aw * w1 + bw * w2 };
}

function lerpNum(a, b, u) { return a + (b - a) * u; }

function shiftPose(p, dt) {
  const o = Object.assign({}, p);
  if (!(dt > 0)) return o;
  o.x = (p.x || 0) + (p.vx || 0) * dt;
  o.y = (p.y || 0) + (p.vy || 0) * dt;
  o.z = (p.z || 0) + (p.vz || 0) * dt;
  return o;
}

function lerpPose(a, b, u) {
  if (!a) return Object.assign({}, b);
  if (!b) return Object.assign({}, a);
  if (dist3(a, b) > 30) return Object.assign({}, u < 0.5 ? a : b);
  const q = slerpQuat(a, b, u);
  const o = {
    id: b.id,
    x: lerpNum(a.x || 0, b.x || 0, u),
    y: lerpNum(a.y || 0, b.y || 0, u),
    z: lerpNum(a.z || 0, b.z || 0, u),
    vx: lerpNum(a.vx || 0, b.vx || 0, u),
    vy: lerpNum(a.vy || 0, b.vy || 0, u),
    vz: lerpNum(a.vz || 0, b.vz || 0, u),
    heading: lerpNum(a.heading || 0, b.heading || 0, u),
    speed: lerpNum(a.speed || 0, b.speed || 0, u),
    gy: lerpNum(a.gy == null ? (a.y || 0) : a.gy, b.gy == null ? (b.y || 0) : b.gy, u),
    nx: lerpNum(a.nx || 0, b.nx || 0, u),
    ny: lerpNum(a.ny == null ? 1 : a.ny, b.ny == null ? 1 : b.ny, u),
    nz: lerpNum(a.nz || 0, b.nz || 0, u),
    steer: lerpNum(a.steer || 0, b.steer || 0, u),
    thrust: lerpNum(a.thrust || 0, b.thrust || 0, u),
    lift: lerpNum(a.lift || 0, b.lift || 0, u),
  };
  o.qx = q.qx; o.qy = q.qy; o.qz = q.qz; o.qw = q.qw;
  const src = u < 0.5 ? a : b;
  o.grounded = !!src.grounded;
  o.nitro = !!src.nitro;
  o.braking = !!src.braking;
  o.kind = b.kind || a.kind;
  o.name = b.name || a.name;
  o.paint = b.paint || a.paint;
  o.vehicle = b.vehicle || a.vehicle;
  o.fi = b.fi;
  o.lap = b.lap;
  o.finish = b.finish;
  return o;
}

function lerpCarList(aCars, bCars, u) {
  const byId = new Map();
  for (const c of aCars) if (c && c.id) byId.set(c.id, c);
  const out = [];
  const seen = new Set();
  for (const b of bCars) {
    if (!b || !b.id || seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(lerpPose(byId.get(b.id), b, u));
  }
  return out;
}

// 依「收到的時間」內插，不依賴兩台裝置的時鐘。大約落後 INTERP_DELAY_MS，斷訊時最多外推 80ms。
export class StateBuffer {
  constructor(delayMs = INTERP_DELAY_MS) {
    this.delay = delayMs;
    this.packets = [];
  }
  push(t, cars) {
    this.packets.push({ t, cars: Array.isArray(cars) ? cars : [] });
    if (this.packets.length > 30) this.packets.shift();
  }
  sample(now) {
    const pk = this.packets;
    if (!pk.length) return [];
    const target = now - this.delay;
    if (target <= pk[0].t) return pk[0].cars.map((c) => Object.assign({}, c));
    const last = pk[pk.length - 1];
    if (target >= last.t) {
      const extra = Math.min(0.08, Math.max(0, (target - last.t) / 1000));
      return last.cars.map((c) => shiftPose(c, extra));
    }
    let j = 0;
    while (j < pk.length - 1 && pk[j + 1].t <= target) j++;
    if (j >= pk.length - 1) return last.cars.map((c) => Object.assign({}, c));
    const a = pk[j], b = pk[j + 1];
    const u = (target - a.t) / Math.max(1, b.t - a.t);
    return lerpCarList(a.cars, b.cars, Math.min(1, Math.max(0, u)));
  }
}
