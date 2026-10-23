// 車輛物理：地面（準擬真）＋ 推進器飛行
import * as THREE from 'three';
import { clamp, lerp, damp, wrapAngle } from './util.js';
import { ROAD_HALF, ROAD_HALF_K } from './track.js';
import { VEHICLES, fullTune } from './vehicles.js';
import { KIND, ribbonCompression } from './stunts.js';
import { applyDriveFx } from './items.js';

const G = 9.81;
const ENERGY_MAX = 100;

function trackGravity(tr) {
  const g = tr && tr.def && +tr.def.gravity;
  return g > 0.4 && g < 25 ? g : G;
}

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
const _m = new THREE.Matrix4(), _qT = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _up = new THREE.Vector3(0, 1, 0);
const _tf = new THREE.Vector3(), _tr = new THREE.Vector3();

export class Vehicle {
  constructor(track) {
    this.tr = track;
    this.setTune(VEHICLES[0].tune);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.n = new THREE.Vector3(0, 1, 0);
    this.q1 = track.newQuery();
    this.heading = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.energy = ENERGY_MAX;
    this.hover = 9;
    this.grounded = true;
    this.thrusting = false;
    this.nitroOn = false;
    this.events = { impact: 0, wall: 0, respawn: false, ring: false, offroad: false, why: '' };
    this.accel = 0; this.latAccel = 0; this.speedF = 0;
    this.thrust = 0; this.lift = 0; this.braking = false;
    this.groundY = 0; this.airTime = 0;
    this.pitchView = 0;
    this.onRoad = true;
    this.alt = 0;
    this.respawnT = 0;
    this._prevL = 0;
    this.fi = 0;
    this.lat = 0;
    this.attached = false;
    this.flipAssist = false;
    this.detachCool = 0;
    this.vlat = 0;
    this.sawCeiling = false;
    this.sawInvert = false;
    this._jumpArmed = false;
    this.lastCp = null;
    this._safeT = 0;
    this._trapT = 0;
    this._trapDist = 0;
    this._oobT = 0;
    this._lip = 0;
    this.ghostT = 0;
    this._crawlT = 0;
    this._fastT = 0;
    this._nudged = false;
    this.mass = 1800;
    this._px = 0; this._py = 0; this._pz = 0;
    this._throttle = 0;
    this.item = 0;
    this.spinT = 0;
    this.iFrame = 0;
    this.shield = false;
    this.shieldT = 0;
    this.boostT = 0;
    this.boostPower = 0;
    this.slowT = 0;
    this.aimed = false;
    this.itemAge = 0;
  }

  _frameSlot(name) {
    return this[name] || (this[name] = {
      pos: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3(), right: new THREE.Vector3(),
    });
  }

  _limitSpeed() {
    const cap = (this.t && this.t.vMax) || 90;
    let sp = this.vel.length();
    if (!Number.isFinite(sp)) { this.vel.set(0, 0, 0); sp = 0; }
    else if (sp > cap) this.vel.multiplyScalar(cap / sp);
    if (!Number.isFinite(this.speedF)) this.speedF = 0;
    else if (this.speedF > cap) this.speedF = cap;
    else if (this.speedF < -cap * 0.4) this.speedF = -cap * 0.4;
  }

  _checkpointBehind(fi) {
    const cps = this.tr.checkpoints;
    const N = this.tr.N;
    const at = this.tr.wrap(Math.round(fi || 0));
    if (!cps || !cps.length) return at;
    let best = cps[0], bestD = 1e9;
    for (const c of cps) {
      let d = at - c;
      d = ((d % N) + N) % N;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  recoverToCheckpoint() {
    const i = this.lastCp != null ? this.tr.wrap(this.lastCp) : this._checkpointBehind(this.fi);
    this.placeOnTrack(i, 0, 22);
    this.energy = Math.max(this.energy, 55);
    this.lastCp = this._checkpointBehind(i);
  }

  // 套用車輛調校（見 vehicles.js）
  setTune(t) { this.t = fullTune(t); this.wb = this.t.wb; this.halfW = this.t.hw; }

  get speed() { return this.vel.length(); }
  get kmh() { return this.vel.length() * 3.6; }

  placeOnTrack(i, lat = 0, speed = 0, yOffset = 0.0) {
    const tr = this.tr;
    i = tr.wrap(Math.round(i));
    this.fi = i;
    this.lat = lat;
    this.detachCool = 0;
    this.flipAssist = false;
    this.vlat = 0;
    this.speedF = speed;
    this.yawRate = 0; this.steerAngle = 0;
    this.airTime = 0; this.thrusting = false;
    this._safeT = 1.6;
    this._trapT = 0;
    this._trapDist = 0;
    this._oobT = 0;
    this._lip = 0;
    this._railT = 0;
    this._onRail = false;
    this._wx = null;
    this.ghostT = 1.5;
    this._crawlT = 0;
    this._fastT = 0;
    this._nudged = false;
    if (tr.kind && tr.kind[i] && tr.kind[i] !== KIND.FLY) {
      this.attached = true;
      this.grounded = true;
      const f = tr.frame(i, this._blankFrame());
      this.pos.copy(f.pos).addScaledVector(f.right, lat).addScaledVector(f.normal, 0.32 + yOffset);
      this.vel.copy(f.tangent).multiplyScalar(speed);
      this.n.copy(f.normal);
      this._orientFrame(f, 1);
      this._syncQuery();
      return;
    }
    this.attached = false;
    tr.surface(i, lat, this.pos); this.pos.y += yOffset;
    this.heading = tr.headingAt(i);
    this.vel.set(-Math.sin(this.heading), 0, -Math.cos(this.heading)).multiplyScalar(speed);
    this.n.set(0, 1, 0);
    this.probe();
    this.pos.y = this.groundY;
    this.grounded = true;
    this.snapOrientation();
    // 出生點的索引以呼叫者指定的為準。探地用的是另一個查詢，舊的 q1 會把車指到別的路段。
    this.fi = i;
    this.q1.fi = i;
    this.q1.i = i;
    this.q1.l = lat;
    this.q1.al = Math.abs(lat);
    this.q1.near = true;
    this.q1.y = this.pos.y;
  }

  _blankFrame() {
    return this._fr || (this._fr = {
      pos: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3(), right: new THREE.Vector3(),
    });
  }
  _syncQuery() {
    const q = this.q1;
    q.fi = this.fi; q.i = Math.floor(this.fi); q.near = true;
    q.l = this.lat; q.al = Math.abs(this.lat); q.gap = false; q.y = this.pos.y;
  }
  _orientFrame(f, dt) {
    _f.copy(f.tangent); _r.copy(f.right); this.n.copy(f.normal);
    _m.makeBasis(_r, this.n, _f.clone().negate());
    _qT.setFromRotationMatrix(_m);
    this.q.slerp(_qT, 1 - Math.exp(-18 * dt));
    this.heading = Math.atan2(-f.tangent.x, -f.tangent.z);
  }
  _detachRibbon(fly) {
    const f = this.tr.frame(this.fi, this._blankFrame());
    this.attached = false;
    // 倒吊缺口只要離開路面就好；太長的冷卻會錯過緊接著的落地橋。
    this.detachCool = fly ? 0.32 : 0.9;
    this.vel.copy(f.tangent).multiplyScalar(this.speedF || 0).addScaledVector(f.right, this.vlat || 0);
    this.n.copy(f.normal);
    if (fly || f.normal.y < 0.55) {
      this.grounded = false;
      this.flipAssist = f.normal.y < 0.82;
      this.pos.addScaledVector(f.normal, 0.45);
    } else {
      this.grounded = true;
      this.flipAssist = false;
    }
    this._syncQuery();
  }
  _skipsRibbon(a, b) {
    const tr = this.tr;
    if (!tr.kind || a == null || b == null) return false;
    let d = b - a;
    if (d > tr.N / 2) d -= tr.N;
    if (d < -tr.N / 2) d += tr.N;
    if (d < 10) return false;
    const dir = d > 0 ? 1 : -1;
    const steps = Math.min(Math.ceil(Math.abs(d)), tr.N);
    for (let k = 1; k < steps; k += 2) {
      const kind = tr.kind[tr.wrap(Math.floor(a + dir * k))];
      if (kind === KIND.LOOP || kind === KIND.INVERT || kind === KIND.FLY) return true;
    }
    return false;
  }
  // 地面索引會跳過迴圈。沿著路面一格一格追上車子，避免索引卡在迴圈前面。
  // 人已經開過特技、離入口很遠時，改接到前面的路面，不要永遠卡在入口。
  _catchRibbon() {
    const tr = this.tr;
    let fi = this.fi || 0;
    for (let n = 0; n < 10; n++) {
      const a = tr.frame(fi, this._frameSlot('_fc'));
      const b = tr.frame(fi + 1, this._frameSlot('_fd'));
      if (this.pos.distanceTo(b.pos) + 0.2 < this.pos.distanceTo(a.pos)) fi = tr.wrapF(fi + 1);
      else break;
    }
    const ground = this.q1.fi || fi;
    if (this._skipsRibbon(fi, ground)) {
      const mouth = tr.frame(fi, this._frameSlot('_fc'));
      const g = tr.frame(ground, this._frameSlot('_fe'));
      if (this.pos.distanceTo(mouth.pos) > 16 && this.pos.distanceTo(g.pos) < 10 && Math.abs(this.pos.y - g.pos.y) < 4) {
        this.fi = ground;
        return;
      }
    }
    this.fi = fi;
  }
  _tryAttach() {
    const tr = this.tr;
    if (!tr.hasRibbon || this.attached || this.detachCool > 0 || !tr.kind) return;
    const i = Math.round(this.fi || this.q1.fi || 0);
    for (let k = 0; k <= 14; k++) {
      const j = tr.wrap(i + k);
      const kind = tr.kind[j];
      if (!kind || kind === KIND.FLY) continue;
      const f = tr.frame(j, this._blankFrame());
      const dx = this.pos.x - f.pos.x, dy = this.pos.y - f.pos.y, dz = this.pos.z - f.pos.z;
      if (dx * dx + dy * dy + dz * dz > 280) continue;
      const sp = Math.max(this.speed, Math.abs(this.speedF || 0));
      const stick = ribbonCompression(f.normal.y, clamp(f.kn, -0.05, 0.08), sp);
      // 吸地力不夠就不要貼上（否則高速墜落也會被倒吊段吸回去）
      if (stick < 1.2) continue;
      this.attached = true;
      this.fi = j;
      this.lat = clamp(this.q1.near ? this.q1.l : 0, -(ROAD_HALF - 0.5), ROAD_HALF - 0.5);
      this.speedF = sp;
      this.vlat = 0;
      this.grounded = true;
      this.flipAssist = false;
      return;
    }
  }
  _stepAttached(dt, inp) {
    const tr = this.tr, ev = this.events, t = this.t;
    const g = trackGravity(tr);
    const f0 = tr.frame(this.fi, this._blankFrame());
    let vf = this.speedF || 0;
    let vlat = this.vlat || 0;
    const thr = inp.throttle || 0, brk = inp.brake || 0;
    this._throttle = thr;
    let af = 0;
    if (thr > 0.01) af += thr * t.accel * Math.max(0, 1 - Math.max(0, vf) / t.vRef);
    if (brk > 0.01 && vf > 0.5 && !(thr > 0.5 && vf < 3)) af -= brk * t.brake;
    af -= t.drag * vf * Math.abs(vf);
    const back = tr.frame(this.fi - 0.8, this._frameSlot('_fb'));
    const ahead = tr.frame(this.fi + 0.8, this._frameSlot('_fa'));
    const span = Math.max(0.5, ahead.pos.distanceTo(back.pos));
    const slope = clamp((ahead.pos.y - back.pos.y) / span, -1, 1);
    af += -g * slope;
    this.nitroOn = !!inp.nitro && this.energy > 0.5 && (thr > 0.1 || vf > 5);
    if (this.nitroOn) {
      af += t.nitro * Math.max(0, 1 - vf / (t.vRef * 1.35));
      this.energy -= 22 * t.nitroDrain / t.eCap * dt;
    } else this.energy += 4 / t.eCap * dt;
    this.energy = clamp(this.energy, 0, ENERGY_MAX);
    vf += af * dt;
    const cap = t.vMax || 90;
    if (vf > cap) vf = cap;
    else if (vf < -cap * 0.4) vf = -cap * 0.4;
    vlat += -g * f0.right.y * dt;
    // 鬆開搖桿時把車拉回路面中央，高牆才不會一路滑出去。
    vlat += clamp(-(this.lat || 0) * 4.5, -14, 14) * dt;
    const kn = clamp(f0.kn, -0.05, 0.08);
    const c = ribbonCompression(f0.normal.y, kn, vf);
    const maxA = t.grip * Math.max(0.2, c);
    vlat += clamp(-vlat * 10, -maxA, maxA) * dt;
    const steer = inp.steer || 0;
    this.steerAngle = damp(this.steerAngle, steer * t.maxSteer, 14, dt);
    // 和地面相同：steer 為正＝向右，橫向（右為正）因此增加。
    vlat = damp(vlat, vf * Math.tan(this.steerAngle), 5, dt);
    this.lat = clamp((this.lat || 0) + vlat * dt, -ROAD_HALF - 0.3, ROAD_HALF + 0.3);
    this.fi = tr.wrapF(this.fi + (vf * dt) / Math.max(0.3, f0.arc));
    const f = tr.frame(this.fi, f0);
    this.speedF = vf;
    this.vlat = vlat;
    this.accel = af;
    this.thrust = clamp((thr > 0.01 ? thr : 0) * 0.35 + (this.nitroOn ? 1 : 0), 0, 1);
    this.lift = 0;
    this.braking = brk > 0.2;
    this.grounded = true;
    this.onRoad = true;
    this.airTime = 0;
    this.pos.copy(f.pos).addScaledVector(f.right, this.lat).addScaledVector(f.normal, 0.32);
    this.vel.copy(f.tangent).multiplyScalar(vf).addScaledVector(f.right, vlat);
    this.groundY = this.pos.y;
    this.alt = 0;
    this._orientFrame(f, dt);
    this._syncQuery();
    if (f.kind === KIND.LOOP && f.normal.y < -0.45) this.sawCeiling = true;
    if (f.kind === KIND.INVERT && f.normal.y < -0.45) this.sawInvert = true;
    const offEdge = Math.abs(this.lat) > ROAD_HALF + 0.05;
    const ride = f.kind === KIND.WALL || f.kind === KIND.LOOP || f.kind === KIND.INVERT || f.kind === KIND.DECK;
    const leave = c < 0.45 || offEdge || !ride;
    if (leave) this._detachRibbon(f.kind === KIND.FLY);
    this._limitSpeed();
    this._noteTrap(dt);
  }

  _noteTrap(dt) {
    if (this.followHost) return;
    const ev = this.events;
    const fi = this.attached ? this.fi : (this.q1.fi || this.fi || 0);
    if (this.tr.checkpoints && this.tr.checkpoints.length) this.lastCp = this._checkpointBehind(fi);
    if (this._wx == null) { this._wx = this.pos.x; this._wy = this.pos.y; this._wz = this.pos.z; }
    const moved = Math.hypot(this.pos.x - this._wx, this.pos.y - this._wy, this.pos.z - this._wz);
    this._wx = this.pos.x; this._wy = this.pos.y; this._wz = this.pos.z;
    if (this.pos.y < -30 || !Number.isFinite(this.pos.x)) { ev.respawn = true; if (!ev.why) ev.why = 'off'; }
    if (this._safeT > 0) { this._safeT -= dt; this._trapT = 0; this._trapDist = 0; this._oobT = 0; this._crawlT = 0; return; }
    const away = !this.attached && ((this.q1.al || 0) > 34 || (this.q1.d || 0) > 40);
    const oob = this.pos.y < -8 || away || !Number.isFinite(this.pos.y);
    this._oobT = oob ? (this._oobT || 0) + dt : 0;
    this._trapT = (this._trapT || 0) + dt;
    this._trapDist = (this._trapDist || 0) + moved;
    // 貼著護欄磨、油門踩著卻快不起來：約兩秒回到檢查點。停在路面中央不算。
    const grinding = this._onRail && this.speed < 9 && this.thrust > 0.15 && !this.attached;
    this._railT = grinding ? (this._railT || 0) + dt : 0;
    const g = trackGravity(this.tr);
    const airLim = 1.6 * (9.81 / g);
    const roadY = (this.q1 && this.q1.near) ? this.q1.y : this.groundY;
    const longFall = this.airTime > airLim && !this.thrusting && this.pos.y < roadY - 8;
    if ((this._lip || 0) > 1.2 || this._oobT > 2 || this._railT > 2) {
      ev.respawn = true;
      ev.why = this._oobT > 2 && (this._lip || 0) <= 1.2 && this._railT <= 2 ? 'off' : 'stuck';
    } else if (this._trapT >= 2) {
      const pinned = this._trapDist < 2.2 && (
        this.speed > 8 || (this._lip || 0) > 0.2 || (!this.onRoad && this.speed < 4)
        || longFall
        || (!this.attached && this.q1.near && this.q1.al > 16 && this.speed < 8)
      );
      if (pinned) {
        ev.respawn = true;
        ev.why = 'stuck';
      }
      this._trapT = 0;
      this._trapDist = 0;
    }
    // 油門按住、車速仍低於約 3 km/h：先沿車頭推一把，滿 3 秒就回上一個檢查點。
    const thrHeld = (this._throttle || 0) > 0.5;
    const crawling = thrHeld && this.speed < 0.85 && !this.attached;
    if (crawling) {
      this._crawlT = (this._crawlT || 0) + dt;
      this._fastT = 0;
      if (this._crawlT > 1.4 && !this._nudged) {
        this._nudged = true;
        const hdg = this.heading;
        this.vel.x += -Math.sin(hdg) * 7;
        this.vel.z += -Math.cos(hdg) * 7;
        this.pos.y += 0.35;
      }
      if (this._crawlT > 3) {
        ev.respawn = true;
        ev.why = 'stuck';
        this._crawlT = 0;
      }
    } else if (thrHeld && this.speed >= 0.85) {
      this._fastT = (this._fastT || 0) + dt;
      if (this._fastT > 0.45) { this._crawlT = 0; this._nudged = false; }
    } else {
      this._crawlT = 0;
      this._fastT = 0;
      this._nudged = false;
    }
  }

  snapOrientation() {
    this.computeGroundBasis(this.q);
  }

  // 依車輪取樣地面：回傳高度與平面法線
  probe() {
    const tr = this.tr, h = this.heading, p = this.pos;
    _fwd.set(-Math.sin(h), 0, -Math.cos(h)); _right.set(Math.cos(h), 0, -Math.sin(h));
    const WB = this.wb, HALF_W = this.halfW, zf = WB / 2, hs = [];
    let max = -1e9;
    for (const [a, b] of [[1, -1], [1, 1], [-1, -1], [-1, 1]]) {
      const x = p.x + _fwd.x * zf * a + _right.x * HALF_W * b, z = p.z + _fwd.z * zf * a + _right.z * HALF_W * b;
      const y = tr.groundHeight(x, z);
      hs.push(y); if (y > max) max = y;
    }
    for (let i = 0; i < 4; i++) hs[i] = Math.max(hs[i], max - 0.9);
    const front = (hs[0] + hs[1]) / 2, rear = (hs[2] + hs[3]) / 2;
    const left = (hs[0] + hs[2]) / 2, right = (hs[1] + hs[3]) / 2;
    const sF = (front - rear) / WB, sR = (right - left) / (2 * HALF_W);
    _tf.set(_fwd.x, sF, _fwd.z); _tr.set(_right.x, sR, _right.z);
    this.n.crossVectors(_tr, _tf).normalize();
    this.groundY = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
    return this.groundY;
  }

  computeGroundBasis(out) {
    const h = this.heading;
    _fwd.set(-Math.sin(h), 0, -Math.cos(h));
    _f.copy(_fwd).addScaledVector(this.n, -_fwd.dot(this.n)).normalize();
    _r.crossVectors(_f, this.n);
    _m.makeBasis(_r, this.n, _f.clone().negate());
    out.setFromRotationMatrix(_m);
  }

  step(dt, inp) {
    inp = applyDriveFx(this, dt, inp || {});
    this._px = this.pos.x; this._py = this.pos.y; this._pz = this.pos.z;
    if (this.ghostT > 0) this.ghostT -= dt;
    this._throttle = (inp && inp.throttle) || 0;
    if (this.detachCool > 0) this.detachCool -= dt;
    if (this.tr.hasRibbon) {
      if (this.attached) { this._stepAttached(dt, inp); return; }
      this._tryAttach();
      if (this.attached) { this._stepAttached(dt, inp); return; }
    }
    const tr = this.tr, ev = this.events, t = this.t;
    const g = trackGravity(tr);
    const h = this.heading;
    const sp0 = this.vel.length();
    _fwd.set(-Math.sin(h), 0, -Math.cos(h)); _right.set(Math.cos(h), 0, -Math.sin(h));
    const wasGrounded = this.grounded;
    let thr = inp.throttle, brk = inp.brake;

    // 目前中心查詢（賽道座標）
    const q = tr.query(this.pos.x, this.pos.z, this.q1);
    this.onRoad = q.near && q.al <= ROAD_HALF_K + 0.6 && !q.gap;
    const planeY = q.near ? q.y - q.l * Math.tan(q.bank) : this.groundY;
    const refY = (q.near && q.al < ROAD_HALF_K + 8) ? Math.max(this.groundY, planeY) : this.groundY;
    this.alt = this.pos.y - refY;

    // 起飛 / 推進器狀態
    const wantLift = !!inp.lift && this.energy > 0.5;
    const wasThrusting = this.thrusting;
    this.thrusting = wantLift;
    const liftKick = Math.sqrt(Math.max(0.4, 2 * g * 3.4));
    if (wantLift && !wasThrusting) {   // 起飛：懸停高度依車輛的最大高度而定（重車飛得低）
      const hLow = Math.max(3, 8 * Math.sqrt(t.hMax / 38));
      this.hover = clamp(this.alt + 5 * hLow / 8, hLow, Math.max(hLow + 1, t.hMax * 0.8));
    }
    this.nitroOn = !!inp.nitro && this.energy > 0.5 && (thr > 0.1 || !this.grounded || this.speed > 5);

    let af = 0, ar = 0, latA = 0;

    if (this.grounded && !wantLift) {
      // ---------- 地面 ----------
      const n = this.n;
      _f.copy(_fwd).addScaledVector(n, -_fwd.dot(n)).normalize();
      _r.crossVectors(_f, n);
      const vf = this.vel.dot(_f), vr = this.vel.dot(_r);
      this.speedF = vf;
      if (thr > 0.01) {
        if (vf < -0.5) af += t.accel * 2.06 * thr;
        else af += thr * t.accel * Math.max(0, 1 - vf / t.vRef);
      }
      this.braking = false;
      if (brk > 0.01 && !(thr > 0.5 && vf < 3)) {
        if (vf > 0.8) { af -= brk * t.brake; this.braking = true; }
        else if (thr < 0.05) af -= brk * t.brake * 0.29 * Math.max(0, 1 + vf / 14);
      }
      af -= 0.35 * clamp(vf, -1, 1) + t.drag * vf * Math.abs(vf);
      if (thr < 0.01 && brk < 0.01) af -= clamp(vf, -1, 1) * 1.6; // 能量回收
      if (this.nitroOn) af += t.nitro * Math.max(0, 1 - vf / (t.vRef * 1.35));
      // 坡度重力分量
      const gsx = n.x * g * n.y, gsy = -g + n.y * g * n.y, gsz = n.z * g * n.y;
      af += gsx * _f.x + gsy * _f.y + gsz * _f.z;
      ar += gsx * _r.x + gsy * _r.y + gsz * _r.z;
      let gripScale = 1;
      const off = !this.onRoad;
      if (off) { af -= vf * 0.3; gripScale *= 0.55; if (!this.followHost) ev.offroad = true; }
      const steer = inp.steer;
      if (brk > 0.3 && Math.abs(steer) > 0.25 && vf > 12) gripScale *= 0.55;     // 煞車漂移
      else if (thr > 0.7 && Math.abs(steer) > 0.6 && vf > 3 && vf < 32) gripScale *= 0.8; // 低速出彎甩尾
      const gN = g * n.y + 0.0004 * vf * vf;
      const maxLat = t.grip * gN * gripScale;
      const gripA = clamp(-vr * 9, -maxLat, maxLat);
      ar += gripA;
      af -= Math.abs(gripA) * 0.05 * Math.sign(vf);
      // 轉向 → 目標偏航速率
      const sa = steer * t.maxSteer;
      this.steerAngle = damp(this.steerAngle, sa, 14, dt);
      // 座標系：heading 增加＝逆時針（俯視）＝向左轉；steer 為正＝向右，所以偏航速率取負號
      const yawKin = -vf * Math.tan(this.steerAngle) / this.wb;
      const yawLat = -steer * t.steer * t.grip * g / Math.max(Math.abs(vf), 4) * Math.sign(vf || 1) * Math.min(1, Math.abs(vf) / 3);
      let yawT = Math.abs(yawKin) < Math.abs(yawLat) ? yawKin : yawLat;
      if (Math.abs(vf) < 0.2) yawT = 0;
      this.yawRate = damp(this.yawRate, yawT, t.yawResp, dt);
      this.heading += this.yawRate * dt;
      latA = ar;
      this.vel.addScaledVector(_f, af * dt).addScaledVector(_r, ar * dt);
      this.accel = af;
      this.thrust = clamp((thr > 0.01 ? thr : 0) * 0.35 + (this.nitroOn ? 1 : 0), 0, 1);
      this.lift = 0;
      if (this.nitroOn) this.energy -= 22 * t.nitroDrain / t.eCap * dt;
      else this.energy += 5 / t.eCap * dt;
    } else {
      // ---------- 空中 / 推進器 ----------
      if (this.grounded && wantLift) { // 離地。點一下也要跳得夠高，能量條立刻看得到下降。
        this.grounded = false;
        this.vel.y = Math.max(this.vel.y, liftKick);
        this.pos.y += 0.22;
        if (!wasThrusting) this.energy -= 12;
      }
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.speedF = hs;
      let drain = 0;
      if (wantLift) {
        const desiredVy = clamp((this.hover - this.alt) * 1.4, -7, t.climb);
        this.hover = clamp(this.hover + inp.pitch * 14 * dt, 2.5, t.hMax);
        const aT = clamp(g + (desiredVy - this.vel.y) * 5, 0, t.liftA);
        this.vel.y += (aT - g) * dt;
        drain = (15 + 14 * Math.max(0, aT - g) / 22) * t.liftDrain / t.eCap;
        this.lift = clamp(aT / 22, 0.25, 1);
        // 水平推力
        const a = thr * t.airThrust - brk * 14;
        this.vel.x += _fwd.x * a * dt; this.vel.z += _fwd.z * a * dt;
        this.heading -= inp.steer * t.airSteer * dt;
        // 速度方向跟隨車頭（推進器向量化）
        if (hs > 0.5) {
          const t = 1 - Math.exp(-1.8 * dt);
          const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
          let dx = lerp(this.vel.x / hs, fx, t), dz = lerp(this.vel.z / hs, fz, t);
          const dl = Math.hypot(dx, dz) || 1;
          this.vel.x = (dx / dl) * hs; this.vel.z = (dz / dl) * hs;
        }
        this.thrust = clamp(thr * 0.5 + (this.nitroOn ? 1 : 0), 0, 1);
      } else {
        this.vel.y -= g * dt;
        this.heading -= inp.steer * 0.35 * dt;
        if (hs > 0.5) {
          const t = 1 - Math.exp(-0.12 * dt);
          const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
          let dx = lerp(this.vel.x / hs, fx, t), dz = lerp(this.vel.z / hs, fz, t);
          const dl = Math.hypot(dx, dz) || 1;
          this.vel.x = (dx / dl) * hs; this.vel.z = (dz / dl) * hs;
        }
        this.lift = 0;
        this.thrust = this.nitroOn ? 1 : 0;
        this.thrusting = false;
      }
      if (this.nitroOn) {
        const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
        const a = t.nitro * Math.max(0, 1 - hs / (t.vRef * 1.35));
        this.vel.x += fx * a * dt; this.vel.z += fz * a * dt;
        drain += 22 * t.nitroDrain / t.eCap;
      }
      // 空氣阻力
      const k = Math.max(0, 1 - 0.0005 * hs * dt);
      this.vel.x *= k; this.vel.z *= k;
      this.energy -= drain * dt;
      this.accel = 0; this.braking = false;
      this.yawRate = damp(this.yawRate, -inp.steer * (wantLift ? t.airSteer : 0.35), 6, dt);
      this.steerAngle = damp(this.steerAngle, 0, 6, dt);
    }
    this.energy = clamp(this.energy, 0, ENERGY_MAX);
    this.latAccel = latA;

    // ---------- 積分 ----------
    const px = this.pos.x, pz = this.pos.z;
    this.pos.addScaledVector(this.vel, dt);
    if (tr.jumpBoost) {
      const bq = tr.query(this.pos.x, this.pos.z, this.q1);
      const b = tr.jumpBoost(bq.fi);
      if (b && wasGrounded && !this._jumpArmed) {
        this.vel.y = Math.max(this.vel.y, b);
        this.pos.y += 0.35;
        this._jumpArmed = true;
      }
      if (!b) this._jumpArmed = false;
    }
    const gy = this.probe();
    const n = this.n;
    const vn = this.vel.dot(n);
    const rise = gy - this.pos.y;
    const overGap = tr.isGapIdx(tr._q.fi);
    if (!wantLift && !overGap && this.airTime < 0.35 && rise > 1.15 && this.pos.y < gy - 0.5) {
      // 低矮路緣：油門踩著就爬過去。高牆才退回，而且不要把速度反轉釘在原地。
      const climbing = rise < 2.6 && (inp.throttle || 0) > 0.35;
      if (climbing) {
        this.pos.y = gy + 0.02;
        if (this.vel.y < 1.2) this.vel.y = 1.2;
        this._lip = 0;
        this.grounded = true;
        this.airTime = 0;
      } else {
        this.pos.x = px; this.pos.z = pz;
        this.vel.x *= 0.35; this.vel.z *= 0.35;
        if (this.vel.y > 0) this.vel.y = 0;
        ev.wall = Math.max(ev.wall, sp0);
        this.grounded = false;
        this._lip = (this._lip || 0) + dt;
      }
    } else if (this.pos.y <= gy) {
      if (wantLift) {
        this.pos.y = gy + 0.16;
        if (this.vel.y < liftKick * 0.5) this.vel.y = liftKick * 0.5;
        this._lip = 0;
        this.grounded = false;
        this.airTime += dt;
      } else {
        this._lip = 0;
        this.pos.y = gy;
        if (this.flipAssist) {
          _up.set(0, 1, 0).applyQuaternion(this.q);
          if (_up.y < 0.2) {
            ev.impact = Math.max(ev.impact, 12);
            this.vel.multiplyScalar(0.4);
          }
          this.flipAssist = false;
        }
        if (vn < 0) {
          if (!wasGrounded || vn < -2.5) ev.impact = Math.max(ev.impact, -vn);
          this.vel.addScaledVector(n, -vn * 1.0);
          if (-vn > 16) this.vel.multiplyScalar(1 - 0.12 / t.tough);
        }
        this.grounded = true;
        this.airTime = 0;
      }
    } else if (wasGrounded && !this.thrusting && this.pos.y - gy < 0.3 && vn < 3.0) {
      this.pos.y = gy;
      if (vn > 0) this.vel.addScaledVector(n, -vn);
      this.grounded = true;
    } else {
      this.grounded = false;
      this.airTime += dt;
    }

    // ---------- 護欄 ----------
    // 只消掉向外的速度。舊版每一步至少扣 2% 車速，貼著護欄會穩定磨在約 20 km/h，方向盤打滿也離不開。
    const q2 = tr.query(this.pos.x, this.pos.z, this.q1);
    this._onRail = false;
    if (q2.near && !q2.gap && tr.hasRail(q2.fi) && this.alt < 3.2) {
      const lim = ROAD_HALF_K - 0.4;
      if (q2.al > lim && Math.abs(this._prevL) <= lim + 0.5) {
        const side = Math.sign(q2.l) || 1;
        const ex = q2.al - lim;
        this.pos.x -= q2.rx * ex * side; this.pos.z -= q2.rz * ex * side;
        const vlat = (this.vel.x * q2.rx + this.vel.z * q2.rz) * side;
        this._onRail = true;
        if (vlat > 0) {
          this.vel.x -= q2.rx * side * vlat; this.vel.z -= q2.rz * side * vlat;
          if (vlat > 8) {
            const loss = clamp((vlat - 8) / 55, 0, 0.22) / t.tough;
            this.vel.x *= 1 - loss; this.vel.z *= 1 - loss;
          }
          ev.wall = Math.max(ev.wall, vlat * 1.2 + 2);
          // 車手正在把車頭轉開時不要把航向鎖回護欄，否則方向盤打滿也離不開。
          const into = (inp.steer || 0) * side;
          if (into > -0.15 && vlat > 6) {
            const ht = Math.atan2(-q2.tx, -q2.tz);
            let dh = ht - this.heading;
            while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
            if (Math.abs(dh) <= Math.PI / 2) this.heading += dh * Math.min(0.1, dt * 1.5);
          }
        }
        // into > 0 ＝往護欄裡打。往反方向打時補一點向內的速度，車身才不會被位置修正釘住。
        const intoWall = (inp.steer || 0) * side;
        if (intoWall < -0.2) {
          const push = 9 * dt;
          this.vel.x -= q2.rx * side * push; this.vel.z -= q2.rz * side * push;
        }
        if ((inp.throttle || 0) > 0.4 && this.speed < 2) {
          this.vel.x -= q2.rx * side * 8;
          this.vel.z -= q2.rz * side * 8;
          this.vel.x += (q2.tx || 0) * 5;
          this.vel.z += (q2.tz || 0) * 5;
        }
      }
    }
    this._prevL = q2.l;

    // 墜入峽谷
    if (!this.followHost && q2.near && tr.pitEdge(q2.fi) > 0.5 && this.pos.y < q2.y - 7.5) {
      ev.respawn = true;
      ev.why = 'off';
    }
    if (tr.obstacles && this.pos.y < 80) {
      for (let oi = 0; oi < tr.obstacles.length; oi++) {
        const o = tr.obstacles[oi];
        const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
        if (dx * dx + dz * dz < o.r * o.r && Math.abs(this.pos.y - o.y) < o.h) {
          this.vel.multiplyScalar(0.42);
          this.vel.y = Math.max(this.vel.y, 3);
          ev.impact = Math.max(ev.impact, 8);
          ev.wall = Math.max(ev.wall, 5);
          this.grounded = false;
        }
      }
    }
    if (!this.attached) {
      const next = this.q1.fi || this.fi;
      if (this._skipsRibbon(this.fi, next)) this._catchRibbon();
      else this.fi = next;
    }

    // ---------- 姿態 ----------
    if (this.grounded) {
      this.computeGroundBasis(_qT);
      this.q.slerp(_qT, 1 - Math.exp(-18 * dt));
    } else if (this.flipAssist) {
      _e.set(clamp((inp.pitch || 0) * 0.25, -0.45, 0.45), this.heading, 0, 'YXZ');
      _qT.setFromEuler(_e);
      const pull = (inp.lift ? 2.6 : 0) + Math.abs(inp.pitch || 0) * 1.3;
      if (pull > 0) this.q.slerp(_qT, 1 - Math.exp(-pull * dt));
      _up.set(0, 1, 0).applyQuaternion(this.q);
      if (_up.y > 0.94) this.flipAssist = false;
    } else {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const pitchT = clamp(Math.atan2(this.vel.y, Math.max(hs, 8)) * 0.85 + inp.pitch * 0.22, -0.6, 0.6);
      const rollT = -inp.steer * (this.thrusting ? 0.5 : 0.18);
      _e.set(pitchT, this.heading, rollT, 'YXZ');
      _qT.setFromEuler(_e);
      this.q.slerp(_qT, 1 - Math.exp(-6 * dt));
    }
    if (this.tr.hasRibbon && !this.attached) this._tryAttach();
    this._limitSpeed();
    this._noteTrap(dt);
  }

  // 給手機對帳：房主把這包狀態傳出去，手機可整包貼回再重播尚未確認的輸入。
  exportState() {
    const n = (v, d = 0) => (Number.isFinite(v) ? v : d);
    return {
      x: n(this.pos.x), y: n(this.pos.y), z: n(this.pos.z),
      qx: n(this.q.x), qy: n(this.q.y), qz: n(this.q.z), qw: n(this.q.w, 1),
      vx: n(this.vel.x), vy: n(this.vel.y), vz: n(this.vel.z),
      nx: n(this.n.x), ny: n(this.n.y, 1), nz: n(this.n.z),
      heading: n(this.heading), yawRate: n(this.yawRate), steerAngle: n(this.steerAngle),
      energy: n(this.energy, 100), hover: n(this.hover, 9),
      grounded: !!this.grounded, thrusting: !!this.thrusting, nitroOn: !!this.nitroOn,
      accel: n(this.accel), latAccel: n(this.latAccel), speedF: n(this.speedF),
      thrust: n(this.thrust), lift: n(this.lift), braking: !!this.braking,
      groundY: n(this.groundY), airTime: n(this.airTime), pitchView: n(this.pitchView),
      onRoad: !!this.onRoad, alt: n(this.alt),
      fi: n(this.fi), lat: n(this.lat), attached: !!this.attached,
      flipAssist: !!this.flipAssist, detachCool: n(this.detachCool), vlat: n(this.vlat),
      sawCeiling: !!this.sawCeiling, sawInvert: !!this.sawInvert,
      prevL: n(this._prevL),
      item: this.item | 0, shield: !!this.shield, spinT: n(this.spinT),
      boostT: n(this.boostT), slowT: n(this.slowT), iFrame: n(this.iFrame), aimed: !!this.aimed,
    };
  }
  importState(s) {
    if (!s) return;
    const n = (v, d = 0) => (Number.isFinite(v) ? v : d);
    this.pos.set(n(s.x), n(s.y), n(s.z));
    this.vel.set(n(s.vx), n(s.vy), n(s.vz));
    this.q.set(n(s.qx), n(s.qy), n(s.qz), n(s.qw, 1)).normalize();
    this.n.set(n(s.nx), n(s.ny, 1), n(s.nz));
    if (this.n.lengthSq() < 1e-6) this.n.set(0, 1, 0); else this.n.normalize();
    this.heading = n(s.heading);
    this.yawRate = n(s.yawRate);
    this.steerAngle = n(s.steerAngle);
    this.energy = clamp(n(s.energy, 100), 0, ENERGY_MAX);
    this.hover = n(s.hover, 9);
    this.grounded = !!s.grounded;
    this.thrusting = !!s.thrusting;
    this.nitroOn = !!s.nitroOn;
    this.accel = n(s.accel);
    this.latAccel = n(s.latAccel);
    this.speedF = n(s.speedF);
    this.thrust = n(s.thrust);
    this.lift = n(s.lift);
    this.braking = !!s.braking;
    this.groundY = n(s.groundY);
    this.airTime = n(s.airTime);
    this.pitchView = n(s.pitchView);
    this.onRoad = s.onRoad !== false;
    this.alt = n(s.alt);
    this.fi = n(s.fi);
    this.lat = n(s.lat);
    this.attached = !!s.attached;
    this.flipAssist = !!s.flipAssist;
    this.detachCool = n(s.detachCool);
    this.vlat = n(s.vlat);
    this.sawCeiling = !!s.sawCeiling;
    this.sawInvert = !!s.sawInvert;
    this._prevL = n(s.prevL);
    if (s.item != null) this.item = s.item | 0;
    if (s.shield != null) this.shield = !!s.shield;
    if (s.spinT != null) this.spinT = n(s.spinT);
    if (s.boostT != null) this.boostT = n(s.boostT);
    if (s.slowT != null) this.slowT = n(s.slowT);
    if (s.iFrame != null) this.iFrame = n(s.iFrame);
    if (s.aimed != null) this.aimed = !!s.aimed;
    this.events.impact = 0; this.events.wall = 0; this.events.respawn = false; this.events.offroad = false;
    if (this.attached) this._syncQuery();
  }
}

export { ENERGY_MAX };
