// 道具戰。房主模擬拾取、擲骰、飛行物與命中。手機只送「使用道具」。
// 名稱與外型都是原創，不借用其他遊戲的角色或道具名。

export const ITEM = { NONE: 0, SPARK: 1, DRONE: 2, SLICK: 3, AEGIS: 4, BURST: 5, STORM: 6 };
export const ITEM_KEY = ['', 'spark', 'drone', 'slick', 'aegis', 'burst', 'storm'];
export const ITEM_GLYPH = ['', '✦', '◉', '●', '◇', '▲', '※'];
export const ITEM_PRESS_QUEUE_S = 0.6;

const PICK_R = 3.4;
const PICK_Y = 4.2;
const BOX_GAP_M = 155;
const RESPAWN_S = 8;
const MAX_SHOTS = 8;
const SKIP_KIND = new Set([1, 2, 3, 4, 5]);

export function itemWeights(place, count) {
  const back = count <= 1 ? 0.35 : (place - 1) / Math.max(1, count - 1);
  const mix = (a, b) => a + (b - a) * back;
  const last = place === count && count > 1;
  return [
    mix(50, 5),
    mix(2, 28),
    mix(24, 8),
    mix(6, 16),
    mix(16, 14),
    last ? 26 : mix(1, 4),
  ];
}

export function rollItem(place, count, rng) {
  const w = itemWeights(place, count);
  let sum = 0;
  for (let i = 0; i < w.length; i++) sum += w[i];
  let u = (rng || Math.random)() * sum;
  for (let i = 0; i < w.length; i++) {
    u -= w[i];
    if (u <= 0) return i + 1;
  }
  return ITEM.SPARK;
}

export function layoutBoxes(track) {
  if (!track || !track.N || !track.px) return [];
  const N = track.N;
  const ds = track.ds || ((track.length || N) / N);
  const step = Math.max(8, Math.round(BOX_GAP_M / ds));
  const boxes = [];
  let i = Math.round(step * 0.42);
  while (i < N - 8 && boxes.length < 20) {
    const kind = track.kind ? track.kind[i] : 0;
    if (SKIP_KIND.has(kind)) {
      i += Math.max(4, Math.round(step / 4));
      continue;
    }
    if (track.isGapIdx && track.isGapIdx(i)) {
      i += Math.max(4, Math.round(step / 4));
      continue;
    }
    const y = (track.py ? track.py[i] : 0) + 2.15;
    const half = track.half || 15;
    const side = (boxes.length % 2 ? 1 : -1) * Math.min(half * 0.34, 5.2);
    const rx = track.rx ? track.rx[i] : 0;
    const rz = track.rz ? track.rz[i] : 0;
    boxes.push({ i, x: track.px[i] + rx * side, y, z: track.pz[i] + rz * side, alive: true, cool: 0 });
    i += step;
  }
  return boxes;
}

export function packItemBits(src) {
  const s = src || {};
  let b = (s.item | 0) & 7;
  if (s.shield) b |= 8;
  if (s.spin || (s.spinT > 0)) b |= 16;
  if (s.aimed) b |= 32;
  if (s.boost || (s.boostT > 0)) b |= 64;
  if (s.slow || (s.slowT > 0)) b |= 128;
  return b & 255;
}

export function unpackItemBits(bits) {
  const b = bits | 0;
  return {
    item: b & 7,
    shield: !!(b & 8),
    spin: !!(b & 16),
    aimed: !!(b & 32),
    boost: !!(b & 64),
    slow: !!(b & 128),
  };
}

export function clearItemState(v) {
  if (!v) return;
  v.item = 0;
  v.spinT = 0;
  v.iFrame = 0;
  v.shield = false;
  v.shieldT = 0;
  v.boostT = 0;
  v.boostPower = 0;
  v.slowT = 0;
  v.aimed = false;
  v.itemAge = 0;
  v.hitKind = 0;
  v.hitT = 0;
  v.hitBlock = false;
}

// 打轉只削水平速度，垂直速度留給各賽道的重力（月球也一樣）。
export function applyDriveFx(veh, dt, inp) {
  const src = inp || {};
  if (!veh) return src;
  if (veh.hitT > 0) {
    veh.hitT = Math.max(0, veh.hitT - dt);
    if (veh.hitT <= 0) { veh.hitKind = 0; veh.hitBlock = false; }
  }
  if (veh.iFrame > 0) veh.iFrame = Math.max(0, veh.iFrame - dt);
  if (veh.shieldT > 0) {
    veh.shieldT -= dt;
    if (veh.shieldT <= 0) { veh.shield = false; veh.shieldT = 0; }
  }
  if (veh.spinT > 0) {
    veh.spinT = Math.max(0, veh.spinT - dt);
    const wobble = Math.sin((1.25 - veh.spinT) * 16);
    if (veh.attached) {
      veh.speedF = (veh.speedF || 0) * Math.max(0.42, 1 - dt * 1.35);
      veh.lat = (veh.lat || 0) + wobble * 5 * dt;
    } else {
      veh.heading = (veh.heading || 0) + wobble * 2.6 * dt;
      const sp = Math.hypot(veh.vel.x, veh.vel.z);
      if (sp > 0.25) {
        const keep = Math.max(0.38, 1 - dt * 1.25);
        veh.vel.x *= keep;
        veh.vel.z *= keep;
      }
    }
    return { steer: wobble, throttle: 0, brake: 0.35, lift: false, nitro: false, pitch: src.pitch || 0, item: false };
  }
  if (veh.slowT > 0) {
    veh.slowT = Math.max(0, veh.slowT - dt);
    if (veh.attached) veh.speedF = (veh.speedF || 0) * Math.max(0.55, 1 - dt * 1.5);
    else {
      const sp = Math.hypot(veh.vel.x, veh.vel.z);
      if (sp > 7) {
        const keep = 1 - Math.min(0.5, dt * 1.7);
        veh.vel.x *= keep;
        veh.vel.z *= keep;
      }
    }
  }
  if (veh.boostT > 0) {
    veh.boostT = Math.max(0, veh.boostT - dt);
    const add = (veh.boostPower || 24) * dt;
    if (veh.attached) veh.speedF = (veh.speedF || 0) + add;
    else {
      const h = veh.heading || 0;
      veh.vel.x += -Math.sin(h) * add;
      veh.vel.z += -Math.cos(h) * add;
    }
  }
  return src;
}

function progress(r) {
  const v = r && r.veh;
  if (!v) return 0;
  const N = (v.tr && v.tr.N) || 1;
  const fi = v.attached ? (v.fi || 0) : ((v.q1 && v.q1.fi) || 0);
  const lap = r.lap && r.lap.n ? r.lap.n : 1;
  return (lap - 1) * N + fi;
}

function ranked(racers) {
  return racers.filter((r) => r && r.veh && !r.parked).slice().sort((a, b) => progress(b) - progress(a));
}

function hitCar(veh, kind) {
  if (!veh || veh.iFrame > 0) return false;
  if (veh.shield) {
    veh.shield = false;
    veh.shieldT = 0;
    veh.iFrame = 0.45;
    veh.hitKind = kind | 0;
    veh.hitT = 1.1;
    veh.hitBlock = true;
    return 'block';
  }
  veh.spinT = 1.25;
  veh.iFrame = 2.45;
  veh.boostT = 0;
  veh.hitKind = kind | 0;
  veh.hitT = 1.3;
  veh.hitBlock = false;
  return 'hit';
}

export class ItemBattle {
  constructor(track, boxes, rng) {
    this.track = track;
    this.boxes = boxes || layoutBoxes(track);
    this.shots = [];
    this.bursts = [];
    this.enabled = true;
    this.rng = rng || Math.random;
  }

  reset() {
    for (const b of this.boxes) { b.alive = true; b.cool = 0; }
    this.shots.length = 0;
    this.bursts.length = 0;
  }

  roll(place, count) { return rollItem(place, count, this.rng); }

  step(dt, racers) {
    if (!this.enabled || !racers) return;
    const keep = [];
    for (const b of this.bursts) {
      b.age += dt;
      if (b.age < 0.7) keep.push(b);
    }
    this.bursts = keep;
    const list = racers.filter((r) => r && r.veh && !r.parked);
    for (const r of list) r.veh.aimed = false;
    for (const b of this.boxes) {
      if (b.alive) continue;
      b.cool -= dt;
      if (b.cool <= 0) b.alive = true;
    }
    const order = ranked(list);
    for (const r of list) {
      const v = r.veh;
      if ((v.item | 0) !== 0) continue;
      for (const b of this.boxes) {
        if (!b.alive) continue;
        const dx = v.pos.x - b.x, dy = v.pos.y - b.y, dz = v.pos.z - b.z;
        if (dx * dx + dz * dz > PICK_R * PICK_R || dy * dy > PICK_Y * PICK_Y) continue;
        b.alive = false;
        b.cool = RESPAWN_S;
        const place = Math.max(1, order.indexOf(r) + 1);
        v.item = this.roll(place, order.length);
        v.itemAge = 0;
        break;
      }
    }
    for (const r of list) this._considerUse(r, order, dt);
    this._moveShots(dt, list);
  }

  _considerUse(r, order, dt) {
    const v = r.veh;
    const kind = r.driver && r.driver.kind;
    if (kind === 'ai') {
      if (!(v.item | 0)) { v.itemAge = 0; return; }
      v.itemAge = (v.itemAge || 0) + dt;
      if (v.itemAge > 0.85) this.use(r, order);
      return;
    }
    let down = false;
    if (kind === 'local') down = !!(r.driver.input && r.driver.input.state && r.driver.input.state.item);
    else if (kind === 'remote') down = !!(r.driver.state && r.driver.state.item);
    const pressed = down && !r._itemLatch;
    r._itemLatch = down;
    if (pressed) r._itemQueueT = ITEM_PRESS_QUEUE_S;
    if ((v.item | 0) && r._itemQueueT > 0) {
      r._itemQueueT = 0;
      this.use(r, order);
      return;
    }
    if (r._itemQueueT > 0) r._itemQueueT = Math.max(0, r._itemQueueT - dt);
  }

  use(r, order) {
    const v = r && r.veh;
    const id = v && (v.item | 0);
    if (!v || !id) return false;
    const roster = order || ranked([r]);
    v.item = 0;
    v.itemAge = 0;
    this.bursts.push({ kind: id, x: v.pos.x, y: v.pos.y + 1.3, z: v.pos.z, age: 0 });
    if (id === ITEM.AEGIS) {
      v.shield = true;
      v.shieldT = 18;
      return true;
    }
    if (id === ITEM.BURST) {
      v.boostT = 1.35;
      v.boostPower = 26;
      return true;
    }
    if (id === ITEM.STORM) {
      const idx = roster.indexOf(r);
      const ahead = idx > 0 ? roster.slice(0, idx) : [];
      for (const o of ahead) {
        const ov = o.veh;
        if (!ov || ov.iFrame > 0) continue;
        if (ov.shield) {
          ov.shield = false;
          ov.shieldT = 0;
          ov.iFrame = 0.45;
          ov.hitKind = ITEM.STORM;
          ov.hitT = 1.1;
          ov.hitBlock = true;
          continue;
        }
        ov.slowT = 1.7;
        ov.spinT = 0;
        ov.boostT = 0;
        ov.iFrame = 2.2;
        ov.hitKind = ITEM.STORM;
        ov.hitT = 1.2;
        ov.hitBlock = false;
      }
      v.boostT = ahead.length ? 1.15 : 1.7;
      v.boostPower = ahead.length ? 16 : 34;
      return true;
    }
    const h = v.heading || 0;
    const fx = -Math.sin(h), fz = -Math.cos(h);
    if (id === ITEM.SLICK) {
      this._pushShot({
        kind: ITEM.SLICK,
        x: v.pos.x - fx * 3.6, y: v.pos.y + 0.3, z: v.pos.z - fz * 3.6,
        vx: 0, vy: 0, vz: 0, life: 9, owner: r, r: 2.7, armed: 0.4,
      });
      return true;
    }
    if (id === ITEM.DRONE) {
      const idx = roster.indexOf(r);
      const target = idx > 0 ? roster[idx - 1] : null;
      this._pushShot({
        kind: ITEM.DRONE,
        x: v.pos.x + fx * 2.4, y: v.pos.y + 1.1, z: v.pos.z + fz * 2.4,
        vx: fx * 28 + (v.vel.x || 0) * 0.25, vy: 1.5, vz: fz * 28 + (v.vel.z || 0) * 0.25,
        life: 4.8, owner: r, target, r: 1.8, armed: 0.18,
      });
      return true;
    }
    this._pushShot({
      kind: ITEM.SPARK,
      x: v.pos.x + fx * 2.4, y: v.pos.y + 0.7, z: v.pos.z + fz * 2.4,
      vx: fx * 68, vy: (v.vel.y || 0) * 0.15, vz: fz * 68,
      life: 1.45, owner: r, r: 1.55, armed: 0.1,
    });
    return true;
  }

  _pushShot(shot) {
    shot.hit = new Set();
    if (this.shots.length >= MAX_SHOTS) this.shots.shift();
    this.shots.push(shot);
  }

  _moveShots(dt, list) {
    const next = [];
    for (const s of this.shots) {
      s.life -= dt;
      if (s.armed > 0) s.armed -= dt;
      if (s.kind === ITEM.DRONE && s.target && s.target.veh && !s.target.parked) {
        const tv = s.target.veh;
        tv.aimed = true;
        const lead = 0.28;
        const dx = tv.pos.x + (tv.vel.x || 0) * lead - s.x;
        const dy = tv.pos.y + 0.6 + (tv.vel.y || 0) * lead - s.y;
        const dz = tv.pos.z + (tv.vel.z || 0) * lead - s.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const sp = 40;
        const k = Math.min(1, dt * 5);
        s.vx += (dx / d * sp - s.vx) * k;
        s.vy += (dy / d * sp - s.vy) * k;
        s.vz += (dz / d * sp - s.vz) * k;
      }
      if (s.kind !== ITEM.SLICK) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
      }
      if (s.life <= 0) continue;
      if (s.armed <= 0) {
        for (const r of list) {
          if (r === s.owner || s.hit.has(r)) continue;
          const v = r.veh;
          const dx = v.pos.x - s.x, dy = v.pos.y - s.y, dz = v.pos.z - s.z;
          const rad = s.r + 1.15;
          if (dx * dx + dy * dy + dz * dz > rad * rad) continue;
          const res = hitCar(v, s.kind);
          if (res) {
            s.hit.add(r);
            this.bursts.push({ kind: s.kind, x: v.pos.x, y: v.pos.y + 0.8, z: v.pos.z, age: 0, hit: res });
          }
          if (res && s.kind !== ITEM.SLICK) { s.life = 0; break; }
        }
      }
      if (s.life > 0) next.push(s);
    }
    this.shots = next;
  }

  view() {
    return {
      on: !!this.enabled,
      boxes: this.boxes.map((b) => ({ alive: !!b.alive })),
      shots: this.shots.map((s) => ({
        kind: s.kind,
        x: s.x, y: s.y, z: s.z,
        owner: (s.owner && (s.owner.netId || s.owner.name)) || '',
        target: (s.target && (s.target.netId || s.target.name)) || '',
      })),
      bursts: this.bursts.map((b) => ({ kind: b.kind, x: b.x, y: b.y, z: b.z, age: b.age, hit: b.hit || '' })),
    };
  }
}
