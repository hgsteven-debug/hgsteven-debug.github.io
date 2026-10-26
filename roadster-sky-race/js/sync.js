import { t } from './i18n.js';

// 手機加入用的純邏輯：房間代碼、輸入封包、快照內插、預測修正。
// 不碰 DOM、不碰 WebRTC，方便在 node 裡單測。多人遠端時只要把 REMOTE_LIMIT 調高，清單結構不用改。

export const REMOTE_LIMIT = 4;
export const INPUT_STALE_MS = 500;
export const INTERP_DELAY_MS = 100;
export const STATE_GAP_MS = 66;
export const INPUT_GAP_MS = 50;
export const LINK_STALE_MS = 5000;
// 這一拍跟上一拍隔太久，是分頁或鎖屏恢復，不是車機沉默。
export const LINK_RESUME_GAP_MS = 1200;
// 直連超過這段時間沒有自己的封包，中繼封包就要拿來用，不能只拿來擋斷線。
export const LINK_DC_FRESH_MS = 1500;
export const REMOTE_GRACE_MS = 45000;
export const INPUT_HISTORY = 4;

const SELF_KEYS = [
  'x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'vx', 'vy', 'vz',
  'heading', 'speed', 'energy', 'grounded', 'onRoad', 'nitroOn', 'thrusting',
  'thrust', 'lift', 'braking', 'steerAngle', 'groundY', 'nx', 'ny', 'nz',
  'fi', 'lat', 'attached', 'alt',
];

// 有收到對端訊息才算接上。只連上 MQTT 伺服器不算。
export function hostStillThere(lastAt, now, stale = LINK_STALE_MS) {
  return lastAt > 0 && now >= lastAt && now - lastAt <= stale;
}

// 上一拍到這一拍的間隔。pollAt 還沒寫過（第一拍）不算恢復。
export function noteLinkResume(prevPollAt, now, gapMs = LINK_RESUME_GAP_MS) {
  if (!(prevPollAt > 0) || !(now >= prevPollAt)) return false;
  return now - prevPollAt > gapMs;
}

// 這一拍要不要宣布斷線。分頁或鎖屏剛恢復時，先把 lastAt 拉到 now，不當成斷線。
// 已經判定失去聯絡（heardHost 為假）不會被這一拍洗掉。
export function advanceLinkWatch({ heardHost, lastAt, pollAt, now, stale = LINK_STALE_MS, resumeGap = LINK_RESUME_GAP_MS } = {}) {
  const resumed = noteLinkResume(pollAt, now, resumeGap);
  let at = lastAt || 0;
  let heard = !!heardHost;
  let lost = false;
  if (resumed && heard) at = now;
  else if (heard && now < at) { /* 時鐘往回走，不當斷線 */ }
  else if (heard && !hostStillThere(at, now, stale)) { heard = false; lost = true; }
  return { resumed, lastAt: at, heardHost: heard, lost, pollAt: now };
}

// 比賽中、timeout 內沒有任何路徑的封包，才顯示失去聯絡。
// 健康連線（最近有封包，RTT 晶片會是綠的）必須隱藏。replaced 另有自己的橫幅。
export function showLostContact({ live, lastAt, now, resumed, replaced, stale = LINK_STALE_MS } = {}) {
  if (!live || replaced || resumed) return false;
  if (!(lastAt > 0)) return true;
  if (!(now >= lastAt)) return false;
  return now - lastAt > stale;
}

// 直連還活著時，中繼封包只證明車機還在，不拿來改位置、也不改走哪條路。
// 直連安靜超過 dcStale，這包中繼就要生效，並把 rtcLive 放掉。
export function relayPacketWhileDirect({ rtcLive, via, lastDcAt, now, dcStale = LINK_DC_FRESH_MS } = {}) {
  if (via !== 'ws' || !rtcLive) return { drop: false, rtcLive: !!rtcLive };
  const dcFresh = lastDcAt > 0 && now >= lastDcAt && now - lastDcAt < dcStale;
  if (dcFresh) return { drop: true, rtcLive: true };
  return { drop: false, rtcLive: false };
}
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PUBLIC_ORIGIN = 'https://hgsteven-debug.github.io';

const ZERO = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0, item: false };

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
export function joinUrl(code, loc, relay, lang) {
  const c = normalizeCode(code);
  const host = loc && loc.hostname ? String(loc.hostname) : '';
  let url;
  if (!host || host === 'hgsteven-debug.github.io' || host.endsWith('.github.io')) {
    url = PUBLIC_ORIGIN + '/?join=' + c;
  } else {
    const origin = loc.origin || '';
    const path = loc.pathname || '/';
    url = origin + path + '?join=' + c;
  }
  if (relay && Number.isFinite(+relay.index)) {
    url += '&relay=' + ((+relay.index) | 0) + '&epoch=' + ((+relay.epoch) | 0);
  }
  if (lang) url += '&lang=' + encodeURIComponent(lang);
  return url;
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
    item: !!src.item,
    pitch: round3(src.pitch),
  };
}

export function unpackInput(msg) {
  return packInput(msg);
}

export function sameInput(a, b) {
  if (!a || !b) return false;
  return a.steer === b.steer && a.throttle === b.throttle && a.brake === b.brake
    && a.lift === b.lift && a.nitro === b.nitro && a.item === b.item && a.pitch === b.pitch;
}

// 太久沒收到手機輸入就滑行，不能卡死主機的比賽。
export function heldInput(remote, now, staleMs = INPUT_STALE_MS) {
  if (!remote || !remote.lastAt || !(now >= remote.lastAt) || now - remote.lastAt > staleMs) return zeroInput();
  return packInput(remote.cmd);
}

export function failText(err) {
  const type = err && err.type;
  if (type === 'browser-incompatible') return t('fail.browser');
  if (type === 'peer-unavailable') return t('fail.noRoom');
  if (type === 'unavailable-id') return t('fail.taken');
  if (type === 'invalid-id') return t('fail.badCode');
  return t('fail.generic');
}

export function roundNet(v, d = 0) {
  const x = Number(v);
  if (!Number.isFinite(x)) return d;
  return Math.round(x * 100) / 100;
}

function normAngle(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return ((Math.round(n) % 360) + 360) % 360;
}

// 手機與小平板（觸控、短邊 ≤ 900、長邊 ≤ 1400）用方鍵十字。車機瀏覽器維持圓形搖桿。
// 加入比賽的客戶端另外一律加 phone，這裡只判斷這支裝置本身像不像手機。
export function phoneLayout(sample) {
  if (!sample || !sample.touch) return false;
  const ua = String(sample.ua || '');
  if (/Tesla|QtCarBrowser/i.test(ua)) return false;
  const w = Number(sample.w) || 0;
  const h = Number(sample.h) || 0;
  if (!(w >= 2 && h >= 2)) return false;
  return Math.min(w, h) <= 900 && Math.max(w, h) <= 1400;
}

// 直向：請使用者把手機轉橫。只看可視範圍的寬高，不看會說謊的方向 API，也不做 CSS 旋轉。
// 橫向網址列伸縮不會把寬高對調，所以 24px 就夠擋抖動。
export function phoneHeldPortrait(sample) {
  const iw = (sample && sample.iw) || 0;
  const ih = (sample && sample.ih) || 0;
  if (iw >= 2 && ih >= 2) return ih > iw + 24;
  const sw = (sample && sample.sw) || 0;
  const sh = (sample && sample.sh) || 0;
  return sh > sw + 24;
}

// 舊的 CSS 轉正判斷。手機畫面不再套用，直向改成全螢幕提示。測試仍鎖住這份判斷。
export function wantCssRotate(sample, sticky) {
  const type = (sample && sample.type) || '';
  const iw = (sample && sample.iw) || 0;
  const ih = (sample && sample.ih) || 0;
  const viewLandscape = iw > ih + 80;
  const viewPortrait = ih > iw + 80;
  const angle = normAngle(sample && sample.angle);
  const win = normAngle(sample && sample.win);
  const reportedLandscape = type.indexOf('landscape') === 0 || angle === 90 || angle === 270 || win === 90 || win === 270;
  if (type.indexOf('landscape') === 0) return false;
  if (viewLandscape) return false;
  if (reportedLandscape && !viewPortrait) return false;
  if (type.indexOf('portrait') === 0) return true;
  if (viewPortrait) {
    if (sticky === 'native') return false;
    return true;
  }
  const sw = (sample && sample.sw) || 0;
  const sh = (sample && sample.sh) || 0;
  if (sticky === 'css') return !(sw > sh + 80);
  if (sticky === 'native') return sh > sw + 80;
  return sh > sw + 40;
}

// 把視窗上的位移換算成元素自己的軸。CSS matrix(a, b, c, d, tx, ty) 的線性部分：
// 元素 +x（畫面上的右）落到視窗 (a, b)，元素 +y（畫面上的下）落到視窗 (c, d)。
// 沒有旋轉時就是單位矩陣，視窗往右仍是往右。
export function viewportDeltaToUi(vx, vy, a, b, c, d) {
  const det = a * d - b * c;
  if (!(Math.abs(det) > 1e-8)) return { x: vx, y: vy };
  return {
    x: (d * vx - c * vy) / det,
    y: (-b * vx + a * vy) / det,
  };
}

// 手機畫面追房主姿態。一幀最多吃掉一部分誤差，重生那種大跳才直接對齊。
export function easeGuestPose(vis, target, dt) {
  const o = vis || { x: 0, y: 0, z: 0, ready: false };
  if (!target) return o;
  const dx = (target.x || 0) - (o.x || 0);
  const dy = (target.y || 0) - (o.y || 0);
  const dz = (target.z || 0) - (o.z || 0);
  const dist = Math.hypot(dx, dy, dz);
  if (!o.ready || !(dist < 30)) {
    o.x = target.x || 0;
    o.y = target.y || 0;
    o.z = target.z || 0;
    o.heading = target.heading || 0;
    o.qx = target.qx || 0;
    o.qy = target.qy || 0;
    o.qz = target.qz || 0;
    o.qw = target.qw == null ? 1 : target.qw;
    o.speed = target.speed || 0;
    o.ready = true;
    o.step = dist;
    o.snapped = true;
    return o;
  }
  // 前進要跟上車速。左右和上下抖動（封包把車身左右甩）吃得慢，畫面才不會左右晃。
  const dtv = Math.max(0, dt || 0);
  const kf = 1 - Math.exp(-12 * dtv);
  const kl = 1 - Math.exp(-2.2 * dtv);
  const h = o.heading || 0;
  const fx = -Math.sin(h), fz = -Math.cos(h);
  const along = dx * fx + dz * fz;
  const lx = dx - fx * along;
  const lz = dz - fz * along;
  const sx = fx * along * kf + lx * kl;
  const sz = fz * along * kf + lz * kl;
  const sy = dy * kl;
  o.x += sx;
  o.y += sy;
  o.z += sz;
  let dh = (target.heading || 0) - (o.heading || 0);
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  o.heading = (o.heading || 0) + dh * kl;
  const q = slerpQuat(o, target, kl);
  o.qx = q.qx; o.qy = q.qy; o.qz = q.qz; o.qw = q.qw;
  o.speed = (o.speed || 0) + ((target.speed || 0) - (o.speed || 0)) * kf;
  o.ready = true;
  o.step = Math.hypot(sx, sy, sz);
  o.snapped = false;
  return o;
}

// 偏離賽道只相信房主，而且要連續離道一陣子才提示一次，不能每幀刷。
export function hostOffroadWarn(state, onRoad, now, debounceMs = 450, repeatMs = 4000) {
  const s = state || { known: false, onRoad: true, since: now || 0, toastAt: 0 };
  const on = onRoad !== false;
  if (!s.known || s.onRoad !== on) {
    s.known = true;
    s.onRoad = on;
    s.since = now || 0;
  }
  let warn = false;
  const t = now || 0;
  const toasted = s.toastAt || 0;
  if (!s.onRoad && t - s.since >= debounceMs && (toasted === 0 || t - toasted >= repeatMs)) {
    warn = true;
    s.toastAt = t;
  }
  return { state: s, warn };
}

// 連線品質：good 綠、poor 黃、bad 紅。rtt 單位是毫秒。
export function linkQuality({ rtt, via, age } = {}) {
  if (!via) return 'bad';
  if (age != null && age > 2000) return 'bad';
  if (rtt == null || !Number.isFinite(rtt)) return 'poor';
  if (rtt < 80) return 'good';
  if (rtt < 200) return 'poor';
  return 'bad';
}

// direct = host/srflx，turn = TURN relay 候選，mqtt = 網頁中繼。
export function linkKind(via) {
  if (via === 'direct') return 'direct';
  if (via === 'relay') return 'turn';
  if (via === 'ws') return 'mqtt';
  return '';
}

// 只有直連候選真的失敗才提示隔離。改走中繼或還在重試，不算。
export function lanIsolationHint({ directFailed, sawLocalHost, sawRemoteHost, via } = {}) {
  if (!sawLocalHost || !sawRemoteHost) return false;
  if (via === 'direct') return false;
  return !!directFailed;
}

export function stateGapMs(tier, floor = STATE_GAP_MS) {
  const base = floor || STATE_GAP_MS;
  if (tier === 'bad') return Math.max(base, 140);
  if (tier === 'poor') return Math.max(base, 100);
  return base;
}

export function deltaPose(prev, next) {
  if (!prev || !next) return null;
  const d = {};
  let n = 0;
  for (const k of SELF_KEYS) {
    if (prev[k] !== next[k]) { d[k] = next[k]; n++; }
  }
  if (n > 12) return null;
  return d;
}

export function mergePose(prev, delta) {
  if (!delta) return prev ? Object.assign({}, prev) : null;
  if (!prev) return Object.assign({}, delta);
  return Object.assign({}, prev, delta);
}

export function makeMidWindow(limit = 64) {
  const order = [];
  const set = new Set();
  return {
    accept(mid) {
      if (mid == null || mid === '') return true;
      const key = String(mid);
      if (set.has(key)) return false;
      set.add(key);
      order.push(key);
      while (order.length > limit) set.delete(order.shift());
      return true;
    },
  };
}

// 套用比目前新的輸入。同一包裡較早的氮氣／推進仍算按到，避免單包遺失吃掉點按。
export function acceptInputs(remote, msg, now) {
  const rows = [];
  if (msg && Array.isArray(msg.hist)) {
    for (const h of msg.hist) if (h && h.seq != null) rows.push(h);
  }
  if (msg && msg.seq != null) rows.push(msg);
  rows.sort((a, b) => (a.seq | 0) - (b.seq | 0));
  let applied = null;
  let lift = false;
  let nitro = false;
  let item = false;
  let seq = remote && remote.seq ? remote.seq | 0 : 0;
  for (const row of rows) {
    const n = row.seq | 0;
    if (n > seq) {
      const cmd = packInput(row);
      if (cmd.lift) lift = true;
      if (cmd.nitro) nitro = true;
      if (cmd.item) item = true;
      applied = cmd;
      seq = n;
    }
  }
  if (!applied || !remote) return 0;
  if (lift) applied.lift = true;
  if (nitro) applied.nitro = true;
  if (item) applied.item = true;
  remote.cmd = applied;
  remote.seq = seq;
  if (now != null) remote.lastAt = now;
  return seq;
}

export function packSelf(s) {
  if (!s) return null;
  const n = roundNet;
  const speed = s.speed != null ? s.speed : Math.hypot(s.vx || 0, s.vy || 0, s.vz || 0);
  const out = {
    x: n(s.x), y: n(s.y), z: n(s.z),
    qx: n(s.qx), qy: n(s.qy), qz: n(s.qz), qw: n(s.qw, 1),
    vx: n(s.vx), vy: n(s.vy), vz: n(s.vz),
    heading: n(s.heading), speed: n(speed),
    energy: Math.max(0, Math.min(100, n(s.energy, 100))),
    grounded: !!s.grounded,
    onRoad: s.onRoad !== false,
    nitroOn: !!s.nitroOn,
    thrusting: !!s.thrusting,
    thrust: n(s.thrust),
    lift: n(s.lift),
    braking: !!s.braking,
    steerAngle: n(s.steerAngle),
    groundY: n(s.groundY, s.y),
    nx: n(s.nx), ny: n(s.ny, 1), nz: n(s.nz),
    fi: n(s.fi), lat: n(s.lat),
    attached: !!s.attached,
    alt: n(s.alt),
    item: s.item | 0,
    itemNext: s.itemNext | 0,
    shield: !!s.shield,
    spin: !!(s.spin || s.spinT > 0),
    aimed: !!s.aimed,
    boost: !!(s.boost || s.boostT > 0),
    slow: !!(s.slow || s.slowT > 0),
  };
  const hitKind = (s.hitKind | 0) & 7;
  if (hitKind) out.hitKind = hitKind;
  if (s.offLeft > 0.05) out.offLeft = Math.round(s.offLeft * 10) / 10;
  if (s.hitBlock) out.hitBlock = true;
  return out;
}

export function packPose(p) {
  if (!p) return null;
  const n = roundNet;
  const o = {
    x: n(p.x), y: n(p.y), z: n(p.z),
    qx: n(p.qx), qy: n(p.qy), qz: n(p.qz), qw: n(p.qw, 1),
    vx: n(p.vx), vy: n(p.vy), vz: n(p.vz),
    nx: n(p.nx), ny: n(p.ny, 1), nz: n(p.nz),
    heading: n(p.heading), speed: n(p.speed), gy: n(p.gy, p.y),
    steer: n(p.steer), thrust: n(p.thrust), lift: n(p.lift), fi: n(p.fi),
    grounded: !!p.grounded, nitro: !!p.nitro, braking: !!p.braking,
    onRoad: p.onRoad !== false,
    item: p.item | 0,
    shield: !!p.shield,
    spin: !!(p.spin || p.spinT > 0),
    aimed: !!p.aimed,
    boost: !!(p.boost || p.boostT > 0),
    slow: !!(p.slow || p.slowT > 0),
  };
  if (p.id != null) o.id = p.id;
  if (p.name != null) o.name = p.name;
  if (p.kind != null) o.kind = p.kind;
  if (p.vehicle != null) o.vehicle = p.vehicle;
  if (p.paint != null) o.paint = p.paint;
  if (p.lap != null) o.lap = p.lap;
  if (p.finish != null) o.finish = p.finish;
  return o;
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
function lerpAngle(a, b, u) {
  let d = (b || 0) - (a || 0);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return (a || 0) + d * u;
}

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
    heading: lerpAngle(a.heading || 0, b.heading || 0, u),
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
  o.onRoad = src.onRoad !== false;
  o.thrusting = !!src.thrusting;
  o.energy = lerpNum(a.energy == null ? (b.energy || 0) : a.energy, b.energy == null ? (a.energy || 0) : b.energy, u);
  o.alt = lerpNum(a.alt || 0, b.alt || 0, u);
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
  sample(now, maxExtra = 0.08) {
    const pk = this.packets;
    if (!pk.length) return [];
    const target = now - this.delay;
    if (target <= pk[0].t) return pk[0].cars.map((c) => Object.assign({}, c));
    const last = pk[pk.length - 1];
    if (target >= last.t) {
      const extra = Math.min(maxExtra, Math.max(0, (target - last.t) / 1000));
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
