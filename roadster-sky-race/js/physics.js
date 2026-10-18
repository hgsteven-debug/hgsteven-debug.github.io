// 車輛物理：地面（準擬真）＋ 推進器飛行
import * as THREE from 'three';
import { clamp, lerp, damp } from './util.js';
import { ROAD_HALF_K } from './track.js';
import { VEHICLES, fullTune } from './vehicles.js';

const G = 9.81;
const ENERGY_MAX = 100;

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
    this.events = { impact: 0, wall: 0, respawn: false, ring: false, offroad: false };
    this.accel = 0; this.latAccel = 0; this.speedF = 0;
    this.thrust = 0; this.lift = 0; this.braking = false;
    this.groundY = 0; this.airTime = 0;
    this.pitchView = 0;
    this.onRoad = true;
    this.alt = 0;
    this.respawnT = 0;
    this._prevL = 0;
  }

  // 套用車輛調校（見 vehicles.js）
  setTune(t) { this.t = fullTune(t); this.wb = this.t.wb; this.halfW = this.t.hw; }

  get speed() { return this.vel.length(); }
  get kmh() { return this.vel.length() * 3.6; }

  placeOnTrack(i, lat = 0, speed = 0, yOffset = 0.0) {
    const tr = this.tr;
    tr.surface(i, lat, this.pos); this.pos.y += yOffset;
    this.heading = tr.headingAt(i);
    this.vel.set(-Math.sin(this.heading), 0, -Math.cos(this.heading)).multiplyScalar(speed);
    this.yawRate = 0; this.steerAngle = 0;
    this.grounded = true; this.airTime = 0; this.thrusting = false;
    this.n.set(0, 1, 0);
    this.probe();
    this.pos.y = this.groundY;
    this.snapOrientation();
    this.q1.l = 0;
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
    const tr = this.tr, ev = this.events, t = this.t;
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
      if (brk > 0.01) {
        if (vf > 0.8) { af -= brk * t.brake; this.braking = true; }
        else if (thr < 0.05) af -= brk * t.brake * 0.29 * Math.max(0, 1 + vf / 14);
      }
      af -= 0.35 * clamp(vf, -1, 1) + t.drag * vf * Math.abs(vf);
      if (thr < 0.01 && brk < 0.01) af -= clamp(vf, -1, 1) * 1.6; // 能量回收
      if (this.nitroOn) af += t.nitro * Math.max(0, 1 - vf / (t.vRef * 1.35));
      // 坡度重力分量
      const gsx = n.x * G * n.y, gsy = -G + n.y * G * n.y, gsz = n.z * G * n.y;
      af += gsx * _f.x + gsy * _f.y + gsz * _f.z;
      ar += gsx * _r.x + gsy * _r.y + gsz * _r.z;
      let gripScale = 1;
      const off = !this.onRoad;
      if (off) { af -= vf * 0.3; gripScale *= 0.55; ev.offroad = true; }
      const steer = inp.steer;
      if (brk > 0.3 && Math.abs(steer) > 0.25 && vf > 12) gripScale *= 0.55;     // 煞車漂移
      else if (thr > 0.7 && Math.abs(steer) > 0.6 && vf > 3 && vf < 32) gripScale *= 0.8; // 低速出彎甩尾
      const gN = G * n.y + 0.0004 * vf * vf;
      const maxLat = t.grip * gN * gripScale;
      const gripA = clamp(-vr * 9, -maxLat, maxLat);
      ar += gripA;
      af -= Math.abs(gripA) * 0.05 * Math.sign(vf);
      // 轉向 → 目標偏航速率
      const sa = steer * t.maxSteer;
      this.steerAngle = damp(this.steerAngle, sa, 14, dt);
      // 座標系：heading 增加＝逆時針（俯視）＝向左轉；steer 為正＝向右，所以偏航速率取負號
      const yawKin = -vf * Math.tan(this.steerAngle) / this.wb;
      const yawLat = -steer * t.steer * t.grip * G / Math.max(Math.abs(vf), 4) * Math.sign(vf || 1) * Math.min(1, Math.abs(vf) / 3);
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
      if (this.grounded && wantLift) { // 離地
        this.grounded = false;
        this.vel.y = Math.max(this.vel.y, 3.5);
        this.pos.y += 0.06;
      }
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.speedF = hs;
      let drain = 0;
      if (wantLift) {
        const desiredVy = clamp((this.hover - this.alt) * 1.4, -7, t.climb);
        this.hover = clamp(this.hover + inp.pitch * 14 * dt, 2.5, t.hMax);
        const aT = clamp(G + (desiredVy - this.vel.y) * 5, 0, t.liftA);
        this.vel.y += (aT - G) * dt;
        drain = (15 + 14 * Math.max(0, aT - G) / 22) * t.liftDrain / t.eCap;
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
        this.vel.y -= G * dt;
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
    const gy = this.probe();
    const n = this.n;
    const vn = this.vel.dot(n);
    const rise = gy - this.pos.y;
    if (rise > 1.0 && this.pos.y < gy) {
      // 撞上落地端斷面 / 垂直牆：彈回
      this.pos.x = px; this.pos.z = pz;
      this.vel.x *= -0.15; this.vel.z *= -0.15;
      ev.wall = Math.max(ev.wall, sp0);
      this.pos.y = Math.max(this.pos.y, gy - 1.0);
      this.grounded = false;
    } else if (this.pos.y <= gy) {
      this.pos.y = gy;
      if (vn < 0) {
        if (!wasGrounded || vn < -2.5) ev.impact = Math.max(ev.impact, -vn);
        this.vel.addScaledVector(n, -vn * 1.0);
        if (-vn > 16) this.vel.multiplyScalar(1 - 0.12 / t.tough);
      }
      this.grounded = true;
      this.airTime = 0;
    } else if (wasGrounded && !this.thrusting && this.pos.y - gy < 0.3 && vn < 3.0) {
      this.pos.y = gy;
      if (vn > 0) this.vel.addScaledVector(n, -vn);
      this.grounded = true;
    } else {
      this.grounded = false;
      this.airTime += dt;
    }

    // ---------- 護欄 ----------
    const q2 = tr.query(this.pos.x, this.pos.z, this.q1);
    if (q2.near && !q2.gap && tr.hasRail(q2.fi) && this.alt < 3.2) {
      const lim = ROAD_HALF_K - 0.4;
      if (q2.al > lim && Math.abs(this._prevL) <= lim + 0.5) {
        const side = Math.sign(q2.l);
        const ex = q2.al - lim;
        this.pos.x -= q2.rx * ex * side; this.pos.z -= q2.rz * ex * side;
        const vlat = (this.vel.x * q2.rx + this.vel.z * q2.rz) * side;
        if (vlat > 0) {
          this.vel.x -= q2.rx * side * vlat * 1.25; this.vel.z -= q2.rz * side * vlat * 1.25;
          const hit = Math.hypot(this.vel.x, this.vel.z);
          const loss = 1 - clamp(vlat / 40, 0.02, 0.35) / t.tough;
          this.vel.x *= loss; this.vel.z *= loss;
          ev.wall = Math.max(ev.wall, vlat * 1.5 + 4);
          // 車頭向賽道方向略為修正
          const ht = Math.atan2(-q2.tx, -q2.tz);
          let dh = ht - this.heading;
          while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
          if (Math.abs(dh) > Math.PI / 2) dh = 0;
          this.heading += dh * 0.18;
        }
      }
    }
    this._prevL = q2.l;

    // 墜入峽谷
    if (q2.near && tr.pitEdge(q2.fi) > 0.5 && this.pos.y < q2.y - 7.5) {
      ev.respawn = true;
    }

    // ---------- 姿態 ----------
    if (this.grounded) {
      this.computeGroundBasis(_qT);
      this.q.slerp(_qT, 1 - Math.exp(-18 * dt));
    } else {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const pitchT = clamp(Math.atan2(this.vel.y, Math.max(hs, 8)) * 0.85 + inp.pitch * 0.22, -0.6, 0.6);
      const rollT = -inp.steer * (this.thrusting ? 0.5 : 0.18);
      _e.set(pitchT, this.heading, rollT, 'YXZ');
      _qT.setFromEuler(_e);
      this.q.slerp(_qT, 1 - Math.exp(-6 * dt));
    }
  }
}

export { ENERGY_MAX };
