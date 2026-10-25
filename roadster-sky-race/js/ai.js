// 電腦對手：沿路面切線跑，迴圈前保持吸地速度，會閃避並在卡住時回到賽道。
import { clamp } from './util.js';
import { KIND } from './stunts.js';

const CFG = {
  easy: { speed: 0.62, look: 14, nitro: false, avoid: 0.55 },
  normal: { speed: 0.8, look: 22, nitro: true, avoid: 0.85 },
  hard: { speed: 0.94, look: 34, nitro: true, avoid: 1 },
};

const wrapDelta = (d, n) => {
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
};

export class AiDriver {
  constructor(track, difficulty = 'normal') {
    this.kind = 'ai';
    this.track = track;
    this.difficulty = CFG[difficulty] ? difficulty : 'normal';
    this.cfg = CFG[this.difficulty];
    this.stuck = 0;
    this.state = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0 };
  }

  sample(dt, racer) {
    const veh = racer.veh;
    const tr = this.track;
    const cfg = this.cfg;
    const st = this.state;
    const blank = () => {
      st.steer = 0; st.throttle = 0; st.brake = 0; st.lift = false; st.nitro = false; st.pitch = 0;
      return st;
    };
    if (!veh) return blank();

    if (veh.flipAssist) {
      st.steer = 0;
      st.throttle = 0.55;
      st.brake = 0;
      st.lift = true;
      st.nitro = false;
      st.pitch = 0.9;
      this.stuck = 0;
      return st;
    }

    const fi = veh.attached ? veh.fi : (veh.q1.fi || veh.fi || 0);
    const sp = Math.max(0, veh.speedF || 0, veh.grounded ? 0 : veh.speed);
    const half = tr.half || 15;
    const far = !veh.attached && veh.q1.near && veh.q1.al > half + 10;
    const offEdge = !veh.attached && veh.q1.near && veh.q1.al > half + 1.5 && sp < 12;
    if (veh.pos.y < -6 || veh.airTime > 5.5 || (sp < 1.4 && veh.grounded) || offEdge || far) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt * 0.5);
    if (this.stuck > 2.6) {
      this._recover(veh, fi);
      this.stuck = 0;
      return blank();
    }

    const look = cfg.look + Math.min(18, sp * 0.22);
    const ahead = tr.frame(fi + look);
    const desired = Math.atan2(-ahead.tangent.x, -ahead.tangent.z);
    let err = desired - veh.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const lat = veh.attached ? (veh.lat || 0) : (veh.q1.near ? veh.q1.l : 0);
    // steer 為正是右轉（偏航減少）。橫向右為正，所以偏離中線時往反方向打。
    let steer = veh.attached
      ? clamp(-lat * 0.45 - (veh.vlat || 0) * 0.3, -1, 1)
      : clamp(-err * 0.85 - lat * 0.045, -1, 1);
    const band = half * 0.2;
    if (!veh.attached && Math.abs(lat) > band) {
      const pull = clamp(-lat / (half * 0.5), -1, 1);
      steer = clamp(steer * 0.35 + pull, -1, 1);
    }

    let target = (veh.t ? veh.t.vTop : 60) * cfg.speed;
    let stuntSoon = false;
    let gapDist = 999;
    if (tr.kind) {
      for (let k = 0; k < 48; k++) {
        const j = tr.wrap(Math.round(fi) + k * 2);
        const kind = tr.kind[j];
        if (kind === KIND.LOOP || kind === KIND.INVERT || kind === KIND.WALL || kind === KIND.FLY || kind === KIND.DECK) { stuntSoon = true; break; }
      }
    }
    for (let k = 0; k < 36; k++) {
      if (tr.isGapIdx(fi + k)) { gapDist = k; break; }
    }
    const overGap = !!(veh.q1 && veh.q1.gap) || tr.isGapIdx(fi);
    if (stuntSoon) target = Math.max(target, 62);
    if (gapDist < 36) target = Math.max(target, 42);
    const here = tr.kind ? tr.kind[tr.wrap(Math.floor(fi))] : 0;
    const onRibbon = veh.attached && (here === KIND.LOOP || here === KIND.INVERT || here === KIND.WALL || here === KIND.DECK);
    if (onRibbon) {
      target = Math.max(target, here === KIND.WALL || here === KIND.DECK ? 42 : 58);
    }
    const soonFly = tr.kind && tr.kind[tr.wrap(Math.round(fi) + 8)] === KIND.FLY;

    const spd = Math.max(veh.speed, Math.abs(veh.speedF || 0));
    let throttle = spd < target - 1 ? 1 : 0.25;
    let brake = !onRibbon && gapDist > 20 && spd > target + 8 ? clamp((spd - target) / 16, 0, 1) : 0;
    let nitro = !!(cfg.nitro && veh.energy > 35 && spd < target - 6 && (stuntSoon || gapDist < 28 || onRibbon));
    if (tr.hasRibbon && cfg.nitro && veh.energy > 28 && spd < 46 && (stuntSoon || onRibbon) && !overGap) nitro = true;
    if (onRibbon || stuntSoon) { brake = 0; if (spd < target) throttle = 1; }
    if (tr.kappa && !onRibbon) {
      let kap = 0;
      const base = Math.round(fi);
      for (let k = 4; k <= 18; k += 4) kap = Math.max(kap, Math.abs(tr.kappa[tr.wrap(base + k)] || 0));
      if (kap > 0.008 && spd > 28) brake = Math.max(brake, clamp((kap - 0.008) * 32, 0, 0.72));
    }
    if (!veh.attached && !stuntSoon && Math.abs(lat) > half * 0.62) {
      brake = Math.max(brake, 0.4);
      throttle = Math.min(throttle, 0.45);
    }
    if (tr.surfaceFx) {
      const hereFx = tr.surfaceFx(fi);
      const soonFx = tr.surfaceFx(fi + 14);
      if ((hereFx.grip < 0.6 || soonFx.grip < 0.6) && spd > 30) {
        brake = Math.max(brake, 0.28);
        throttle = Math.min(throttle, 0.72);
      }
    }

    let avoid = 0;
    const others = racer.others || [];
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (!o || o === racer) continue;
      const dx = o.veh.pos.x - veh.pos.x, dz = o.veh.pos.z - veh.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 16 || dist < 0.05) continue;
      const ofi = o.veh.attached ? o.veh.fi : (o.veh.q1.fi || 0);
      const dfi = wrapDelta(ofi - fi, tr.N);
      if (dfi < -3 || dfi > 20) continue;
      const olat = o.veh.attached ? (o.veh.lat || 0) : (o.veh.q1.l || 0);
      const side = lat - olat;
      avoid += Math.sign(side || (i % 2 ? 1 : -1)) * clamp((3.4 - Math.abs(side)) / 3.4, 0, 1) * (1 - dist / 16);
      if (dist < 7 && Math.abs(side) < 2.2 && !onRibbon) brake = Math.max(brake, 0.35);
    }
    steer = clamp(steer - avoid * cfg.avoid, -1, 1);

    let lift = false;
    let pitch = 0;
    // 缺口要靠推進器飛過去，單靠跳台不夠。
    if (here === KIND.FLY || soonFly) {
      lift = true;
      pitch = 0.7;
      throttle = 1;
      brake = 0;
    }
    if ((gapDist < 7 || overGap) && veh.energy > 1) {
      lift = true;
      throttle = 1;
      brake = 0;
      const alt = veh.alt || 0;
      pitch = alt < 7 ? 0.75 : alt > 14 ? -0.35 : 0.1;
      if (cfg.nitro && veh.energy > 20 && spd < 48) nitro = true;
    }
    if (!veh.grounded && veh.alt < -1) { lift = true; pitch = Math.max(pitch, 0.5); }
    if (tr.jumpBoost && tr.jumpBoost(fi)) { throttle = 1; if (cfg.nitro) nitro = veh.energy > 8; }
    // 甩尾蓄滿、而且還在路面中間，才鬆開煞車。貼邊時繼續煞，避免加速衝進護欄。
    if (!lift && !onRibbon && !stuntSoon && veh.grounded && (veh.driftT || 0) >= 1 && Math.abs(lat) < half * 0.28) {
      brake = 0;
      throttle = 1;
      const pull = clamp(-lat / (half * 0.5), -1, 1);
      steer = clamp(steer * 0.25 + pull, -1, 1);
    }

    st.steer = steer;
    st.throttle = throttle;
    st.brake = brake;
    st.lift = lift;
    st.nitro = nitro;
    st.pitch = pitch;
    return st;
  }

  _recover(veh, fi) {
    const tr = this.track;
    let i = tr.wrap(Math.round(fi));
    if (tr.kind) {
      for (let k = 0; k < 90; k++) {
        const j = tr.wrap(i - k);
        if (!tr.kind[j] && !tr.isGapIdx(j)) { i = j; break; }
      }
    }
    if (tr.isGapIdx(i)) i = tr.wrap(i - 20);
    veh.placeOnTrack(i, 0, tr.hasRibbon ? 54 : 28);
    if (tr.hasRibbon) veh.energy = Math.max(veh.energy, 70);
  }
}
