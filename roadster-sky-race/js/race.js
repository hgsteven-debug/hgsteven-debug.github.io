// 一場比賽的參賽者。本地、電腦、以及之後的遠端選手都走同一個 sample() 介面。
// LOCAL_LIMIT 目前是 2（上下分屏）。想加到 4 人時，提高這個數字並多切幾塊畫面即可。
import { AiDriver } from './ai.js';

// 與 track.js 的 ROAD_HALF 相同。這裡不能 import track.js，否則會把 three 拉進來。
const ROAD_HALF = 15;

export const LOCAL_LIMIT = 2;
export const RACE_LAPS = 2;

export class LocalDriver {
  constructor(input) {
    this.kind = 'local';
    this.input = input;
  }
  sample() { return this.input.state; }
}

// 遠端選手：手機封包呼叫 push()，車子仍用同一套 step。沒有新封包時維持最後的輸入。
export class RemoteDriver {
  constructor() {
    this.kind = 'remote';
    this.state = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0, item: false };
  }
  push(s) {
    if (!s) return;
    this.state.steer = s.steer || 0;
    this.state.throttle = s.throttle || 0;
    this.state.brake = s.brake || 0;
    this.state.lift = !!s.lift;
    this.state.nitro = !!s.nitro;
    this.state.pitch = s.pitch || 0;
    this.state.item = !!s.item;
  }
  sample() { return this.state; }
}

export { AiDriver };

export class Race {
  constructor(track) {
    this.track = track;
    this.racers = [];
    this.raceMode = false;
    this.onLap = null;
    this.onMiss = null;
    this.onResetRings = null;
  }

  add(racer) { this.racers.push(racer); return racer; }

  pollHumans(dt) {
    for (const r of this.racers) {
      if (r.driver && r.driver.kind === 'local' && r.driver.input) r.driver.input.poll(dt);
    }
  }

  step(dt) {
    const all = this.racers;
    const coast = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0, item: false };
    for (let i = 0; i < all.length; i++) {
      const r = all[i];
      if (r.parked) continue;
      r.others = all;
      let inp = null;
      try {
        inp = r.driver && r.driver.kind === 'ai' ? r.driver.sample(dt, r) : r.driver.sample();
      } catch (e) { inp = null; }
      r.veh.step(dt, inp || coast);
    }
    this.collide();
    this.updateLaps(dt);
  }

  collide() {
    const rs = this.racers;
    const R = 1.15;
    const min = R * 2;
    this.lastBump = 0;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const ra = rs[i], rb = rs[j];
        if (ra.parked || rb.parked) continue;
        const a = ra.veh, b = rb.veh;
        if ((a.ghostT || 0) > 0 || (b.ghostT || 0) > 0) continue;
        const ax0 = a._px != null ? a._px : a.pos.x;
        const ay0 = a._py != null ? a._py : a.pos.y;
        const az0 = a._pz != null ? a._pz : a.pos.z;
        const bx0 = b._px != null ? b._px : b.pos.x;
        const by0 = b._py != null ? b._py : b.pos.y;
        const bz0 = b._pz != null ? b._pz : b.pos.z;
        let best = 1e9, bu = 1;
        const samples = 4;
        for (let s = 0; s <= samples; s++) {
          const u = s / samples;
          const dx = (bx0 + (b.pos.x - bx0) * u) - (ax0 + (a.pos.x - ax0) * u);
          const dy = (by0 + (b.pos.y - by0) * u) - (ay0 + (a.pos.y - ay0) * u);
          const dz = (bz0 + (b.pos.z - bz0) * u) - (az0 + (a.pos.z - az0) * u);
          const d = Math.hypot(dx, dy, dz);
          if (d < best) { best = d; bu = u; }
        }
        const now = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z);
        if (best >= min && now >= min) continue;
        const u = best < now ? bu : 1;
        const ax = ax0 + (a.pos.x - ax0) * u;
        const ay = ay0 + (a.pos.y - ay0) * u;
        const az = az0 + (a.pos.z - az0) * u;
        const bx = bx0 + (b.pos.x - bx0) * u;
        const by = by0 + (b.pos.y - by0) * u;
        const bz = bz0 + (b.pos.z - bz0) * u;
        let nx = bx - ax, ny = by - ay, nz = bz - az;
        let dist = Math.hypot(nx, ny, nz);
        if (dist < 1e-4) { nx = 1; ny = 0; nz = 0; dist = min; }
        else { nx /= dist; ny /= dist; nz /= dist; }
        const overlap = min - Math.min(best, now);
        if (!(overlap > 0)) continue;
        const ma = Math.max(400, a.mass || ra.mass || 1800);
        const mb = Math.max(400, b.mass || rb.mass || 1800);
        const wa = mb / (ma + mb);
        const wb = ma / (ma + mb);
        this._shove(a, -nx, -ny, -nz, overlap * wa);
        this._shove(b, nx, ny, nz, overlap * wb);
        const rv = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny + (b.vel.z - a.vel.z) * nz;
        if (rv < 0) {
          const inv = 1 / ma + 1 / mb;
          let j = -(1 + 0.22) * rv / inv;
          const capJ = 16 * Math.min(ma, mb);
          if (j > capJ) j = capJ;
          let ix = nx * j / ma, iy = ny * j / ma, iz = nz * j / ma;
          const mag = Math.hypot(ix, iy, iz);
          if (mag > 16) { const s = 16 / mag; ix *= s; iy *= s; iz *= s; }
          a.vel.x -= ix; a.vel.y -= iy; a.vel.z -= iz;
          let jx = nx * j / mb, jy = ny * j / mb, jz = nz * j / mb;
          const magB = Math.hypot(jx, jy, jz);
          if (magB > 16) { const s = 16 / magB; jx *= s; jy *= s; jz *= s; }
          b.vel.x += jx; b.vel.y += jy; b.vel.z += jz;
          a.vel.multiplyScalar(0.97);
          b.vel.multiplyScalar(0.97);
          const sideA = nx * Math.cos(a.heading) - nz * Math.sin(a.heading);
          const sideB = nx * Math.cos(b.heading) - nz * Math.sin(b.heading);
          const yaw = Math.min(0.28, Math.abs(rv) * 0.008);
          a.heading += Math.max(-0.28, Math.min(0.28, sideA * yaw));
          b.heading -= Math.max(-0.28, Math.min(0.28, sideB * yaw));
          a.yawRate += sideA * yaw;
          b.yawRate -= sideB * yaw;
        }
        const hit = Math.max(4, Math.abs(rv));
        a.events.wall = Math.max(a.events.wall || 0, hit);
        b.events.wall = Math.max(b.events.wall || 0, hit);
        this._reel(a);
        this._reel(b);
        this.lastBump++;
      }
    }
  }

  _shove(veh, nx, ny, nz, dist) {
    if (!(dist > 0)) return;
    if (veh.attached) {
      const rx = (veh.q1 && veh.q1.rx) || Math.cos(veh.heading);
      const rz = (veh.q1 && veh.q1.rz) || -Math.sin(veh.heading);
      const along = nx * rx + nz * rz;
      veh.lat = Math.max(-(ROAD_HALF - 1), Math.min(ROAD_HALF - 1, (veh.lat || 0) + along * dist));
      return;
    }
    veh.pos.x += nx * dist;
    veh.pos.y += ny * dist * 0.65;
    veh.pos.z += nz * dist;
  }

  _reel(veh) {
    if (veh.attached) {
      veh.lat = Math.max(-(ROAD_HALF - 1.2), Math.min(ROAD_HALF - 1.2, veh.lat || 0));
      return;
    }
    if (!veh.onRoad || !veh.tr) return;
    const q = veh.tr.query(veh.pos.x, veh.pos.z, veh.tr._q2);
    const lim = ROAD_HALF - 0.8;
    if (q.near && !q.gap && q.al > lim && q.al < lim + 6) {
      const side = Math.sign(q.l) || 1;
      const back = q.al - lim;
      veh.pos.x -= q.rx * side * back;
      veh.pos.z -= q.rz * side * back;
    }
  }

  updateLaps(dt) {
    const tr = this.track, N = tr.N;
    for (const r of this.racers) {
      const lap = r.lap;
      const veh = r.veh;
      if (r.finish != null) { lap.prevFi = veh.attached ? veh.fi : veh.q1.fi; continue; }
      lap.t += dt;
      const q = veh.q1;
      const fi = veh.attached ? veh.fi : (q.fi || 0);
      if ((q.near && q.al < ROAD_HALF + 18) || veh.attached) r.lastGoodI = veh.attached ? Math.floor(veh.fi) : q.i;
      if (lap.prevFi != null) {
        if (lap.prevFi > N * 0.8 && fi < N * 0.2) {
          if (lap.cp.every(Boolean)) {
            const completed = lap.n;
            const lapTime = lap.t;
            r.banked = (r.banked || 0) + lapTime;
            if (this.raceMode && completed >= RACE_LAPS && r.finish == null) r.finish = r.banked;
            if (this.onLap) this.onLap(r, lapTime, completed);
            if (r.primary && this.onResetRings) this.onResetRings();
            lap.n++; lap.t = 0; lap.cp = [false, false, false];
          } else if (lap.cp.some(Boolean) && r.primary && this.onMiss) this.onMiss();
        } else if (lap.prevFi < N * 0.2 && fi > N * 0.8) {
          lap.cp = [false, false, false];
        }
      }
      const cps = [0.25, 0.5, 0.75];
      const onLine = veh.attached || (q.near && q.al < ROAD_HALF + 7);
      for (let k = 0; k < 3; k++) {
        if (onLine && !lap.cp[k] && (k === 0 || lap.cp[k - 1]) && fi > cps[k] * N && fi < (cps[k] + 0.06) * N) lap.cp[k] = true;
      }
      lap.prevFi = fi;
    }
  }

  standings() {
    const N = this.track.N;
    const score = (r) => {
      if (r.finish != null) return 1e9 - r.finish;
      const fi = r.veh.attached ? r.veh.fi : (r.veh.q1.fi || 0);
      return (r.lap.n - 1) * N + fi;
    };
    return this.racers.slice().sort((a, b) => score(b) - score(a));
  }

  locals() { return this.racers.filter((r) => r.driver && r.driver.kind === 'local'); }
}
