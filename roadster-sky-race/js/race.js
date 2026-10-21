// 一場比賽的參賽者。本地、電腦、以及之後的遠端選手都走同一個 sample() 介面。
// LOCAL_LIMIT 目前是 2（上下分屏）。想加到 4 人時，提高這個數字並多切幾塊畫面即可。
import { AiDriver } from './ai.js';

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
    this.state = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0 };
  }
  push(s) {
    if (!s) return;
    this.state.steer = s.steer || 0;
    this.state.throttle = s.throttle || 0;
    this.state.brake = s.brake || 0;
    this.state.lift = !!s.lift;
    this.state.nitro = !!s.nitro;
    this.state.pitch = s.pitch || 0;
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
    const coast = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0 };
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
    const min = 2.35;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        if (rs[i].parked || rs[j].parked) continue;
        const a = rs[i].veh, b = rs[j].veh;
        if (Math.abs(a.pos.y - b.pos.y) > 2.4) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.55;
        const nx = dx / d, nz = dz / d;
        if (a.attached) a.lat = Math.max(-10, Math.min(10, (a.lat || 0) - push));
        else { a.pos.x -= nx * push; a.pos.z -= nz * push; }
        if (b.attached) b.lat = Math.max(-10, Math.min(10, (b.lat || 0) + push));
        else { b.pos.x += nx * push; b.pos.z += nz * push; }
        const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
        if (rel < 0) {
          const imp = -rel * 0.32;
          a.vel.x -= nx * imp; a.vel.z -= nz * imp;
          b.vel.x += nx * imp; b.vel.z += nz * imp;
        }
      }
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
      if ((q.near && q.al < 30) || veh.attached) r.lastGoodI = veh.attached ? Math.floor(veh.fi) : q.i;
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
      for (let k = 0; k < 3; k++) {
        if (!lap.cp[k] && (k === 0 || lap.cp[k - 1]) && fi > cps[k] * N && fi < (cps[k] + 0.06) * N) lap.cp[k] = true;
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
