// 賽道資料與地面查詢（純數學，不含網格）
import * as THREE from 'three';
import { clamp, lerp, smoothstep, fbm2 } from './util.js';

export const ROAD_HALF = 11;          // 路面半寬（公尺）
export const KERB = 1.2;              // 路緣寬
export const ROAD_HALF_K = ROAD_HALF + KERB;
export const RAIL_L = ROAD_HALF_K + 0.5; // 護欄橫向位置
export const PIT_DEPTH = 11;
const GAP_LEN = 40, RAMP_LEN = 24, RAMP_H = 2.4;

import { TRACKS, trackById, THEMES, DEFAULT_TRACK } from './tracks.js';
export { TRACKS, trackById, THEMES, DEFAULT_TRACK };

class Grid {
  constructor(track, cell, step, radius) {
    this.cell = cell; this.step = step; this.radius = radius; this.map = new Map();
    const { N, px, pz } = track;
    for (let i = 0; i < N; i += step) {
      const k = this.key(Math.floor(px[i] / cell), Math.floor(pz[i] / cell));
      let a = this.map.get(k);
      if (!a) this.map.set(k, (a = []));
      a.push(i);
    }
    this.track = track;
  }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  nearest(x, z) {
    const { px, pz } = this.track;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell), r = this.radius;
    let best = -1, bd = 1e18;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const a = this.map.get(this.key(cx + dx, cz + dz));
      if (!a) continue;
      for (let n = 0; n < a.length; n++) {
        const i = a[n];
        const ddx = px[i] - x, ddz = pz[i] - z;
        const d = ddx * ddx + ddz * ddz;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best < 0 ? null : { i: best, d2: bd };
  }
}

export class Track {
  constructor(idOrDef = DEFAULT_TRACK, N = 1200) {
    const def = typeof idOrDef === 'string' ? trackById(idOrDef) : (idOrDef || trackById(DEFAULT_TRACK));
    this.id = def.id; this.name = def.name; this.tag = def.tag; this.desc = def.desc;
    this.theme = THEMES[def.theme] || THEMES.desert;
    this.def = def;
    const pts = def.ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = 4000;
    this.curve = curve;
    this.N = N;
    this.length = curve.getLength();
    this.ds = this.length / N;
    const px = (this.px = new Float32Array(N)), pz = (this.pz = new Float32Array(N));
    for (let i = 0; i < N; i++) {
      const p = curve.getPointAt(i / N);
      px[i] = p.x; pz[i] = p.z;
    }
    const wrap = (i) => ((i % N) + N) % N;
    this.wrap = wrap;
    const tx = (this.tx = new Float32Array(N)), tz = (this.tz = new Float32Array(N));
    for (let i = 0; i < N; i++) {
      const a = wrap(i - 1), b = wrap(i + 1);
      const dx = px[b] - px[a], dz = pz[b] - pz[a];
      const l = Math.hypot(dx, dz);
      tx[i] = dx / l; tz[i] = dz / l;
    }
    this.rx = new Float32Array(N); this.rz = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.rx[i] = -tz[i]; this.rz[i] = tx[i]; }
    // 曲率（右轉為正）與傾斜角
    const kap = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const j = wrap(i + 1);
      kap[i] = (tx[i] * tz[j] - tz[i] * tx[j]) / this.ds;
    }
    this.kappa = kap;
    const ks = new Float32Array(N);
    const W = 14;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -W; k <= W; k++) s += kap[wrap(i + k)];
      ks[i] = s / (2 * W + 1);
    }
    this.bank = new Float32Array(N);
    for (let i = 0; i < N; i++) this.bank[i] = clamp(ks[i] * 75, -0.3, 0.3);

    // 缺口：選在最直的位置附近
    this.gaps = [];
    const gl = Math.round(GAP_LEN / this.ds);
    for (const f of (def.gaps || [0.2, 0.47, 0.76])) {
      let bestI = 0, bestC = 1e9;
      const c0 = Math.round(f * N), span = Math.round(0.06 * N);
      for (let c = c0 - span; c <= c0 + span; c += 3) {
        let m = 0;
        for (let k = -90; k <= 90; k += 3) m = Math.max(m, Math.abs(kap[wrap(c + k)]));
        if (m < bestC) { bestC = m; bestI = c; }
      }
      const g0 = wrap(bestI - Math.floor(gl / 2));
      this.gaps.push({ g0, g1: g0 + gl, center: wrap(bestI) });
    }
    this.gapLen = gl;
    this.rampRows = Math.round(RAMP_LEN / this.ds);

    // 高度：緩起伏，缺口附近壓平，再加上跳台
    const py = (this.py = new Float32Array(N));
    const H = def.height || { a: 7, b: 4.5, c: 2, pa: 2, pb: 3, pc: 5, oa: 0.6, ob: 2.1 };
    const base = (i) => {
      const u = (i / N) * Math.PI * 2;
      return H.a * Math.sin(H.pa * u + H.oa) + H.b * Math.sin(H.pb * u + H.ob) + H.c * Math.sin(H.pc * u);
    };
    for (let i = 0; i < N; i++) {
      let y = base(i);
      for (const g of this.gaps) {
        let d = Math.abs(i - g.center); d = Math.min(d, N - d);
        const w = 1 - smoothstep(60, 140, d); // 以 ±60 列(約 140m) 完全壓平
        y = lerp(y, base(g.center), w);
      }
      py[i] = y;
    }
    for (const g of this.gaps) {
      for (let k = 0; k <= this.rampRows; k++) {
        const i = wrap(g.g0 - k);
        const u = 1 - k / this.rampRows;
        py[i] += RAMP_H * Math.pow(u, 1.35);
      }
    }
    // 空間索引
    this.fine = new Grid(this, 30, 1, 3);
    this.coarse = new Grid(this, 150, 6, 3);
    // 範圍
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < N; i++) {
      minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]);
      minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    this._q = this.newQuery();
    this._q2 = this.newQuery();
  }

  newQuery() {
    return { i: 0, fi: 0, l: 0, al: 0, y: 0, bank: 0, tx: 0, tz: 0, rx: 0, rz: 0, d: 0, near: false, gap: false };
  }

  isGapIdx(fi) {
    // fi：浮點索引；回傳該位置是否在缺口（沒有路面）
    for (const g of this.gaps) {
      let a = fi - g.g0;
      if (a < -this.N / 2) a += this.N;
      if (a > this.N / 2) a -= this.N;
      if (a > 0 && a < this.gapLen) return true;
    }
    return false;
  }
  pitEdge(fi) {
    let e = 0;
    for (const g of this.gaps) {
      let a = fi - g.g0;
      if (a < -this.N / 2) a += this.N;
      if (a > this.N / 2) a -= this.N;
      if (a > 0 && a < this.gapLen) e = Math.max(e, smoothstep(0, 3, a) * (1 - smoothstep(this.gapLen - 3, this.gapLen, a)));
    }
    return e;
  }

  // 查詢 (x,z) 相對賽道資訊
  query(x, z, out = this._q) {
    let r = this.fine.nearest(x, z);
    out.near = !!r;
    if (!r) r = this.coarse.nearest(x, z);
    if (!r) { out.d = 600; out.al = 600; out.l = 600; out.gap = false; out.y = 0; out.bank = 0; out.fi = 0; out.i = 0; return out; }
    const i = r.i, N = this.N;
    const dx = x - this.px[i], dz = z - this.pz[i];
    out.i = i;
    if (!out.near) { out.d = Math.sqrt(r.d2); out.al = out.d; out.l = out.d; out.fi = i; out.y = this.py[i]; out.bank = 0; out.gap = false; return out; }
    const along = dx * this.tx[i] + dz * this.tz[i];
    const off = clamp(along / this.ds, -1, 1);
    let fi = i + off;
    out.fi = fi < 0 ? fi + N : fi;
    const i0 = Math.floor(out.fi) % N, i1 = (i0 + 1) % N, f = out.fi - Math.floor(out.fi);
    out.y = lerp(this.py[i0], this.py[i1], f);
    out.bank = lerp(this.bank[i0], this.bank[i1], f);
    out.tx = lerp(this.tx[i0], this.tx[i1], f); out.tz = lerp(this.tz[i0], this.tz[i1], f);
    const tl = Math.hypot(out.tx, out.tz); out.tx /= tl; out.tz /= tl;
    out.rx = -out.tz; out.rz = out.tx;
    out.l = dx * out.rx + dz * out.rz;
    out.al = Math.abs(out.l);
    out.d = out.al;
    out.gap = this.isGapIdx(out.fi);
    return out;
  }

  // 自然地形（不含道路影響）
  natural(x, z, d) {
    const dunes = (fbm2(x * 0.006, z * 0.006, 4) - 0.35) * 14 + (fbm2(x * 0.03 + 9, z * 0.03, 2) - 0.4) * 1.6;
    const mW = smoothstep(130, 520, d);
    let m = 0;
    if (mW > 0) {
      const n = fbm2(x * 0.0025 + 40, z * 0.0025 - 17, 5);
      const ridge = 1 - Math.abs(n * 2.1 - 1);
      m = (Math.pow(Math.max(ridge, 0), 2.2) * 420 + n * 90) * mW;
    }
    return dunes + m;
  }

  // 地形網格高度（道路下方略為壓低，避免 z-fighting）
  terrainHeight(x, z) {
    const q = this.query(x, z, this._q2);
    if (!q.near) return this.natural(x, z, q.d) + 0;
    const tb = Math.tan(q.bank);
    let h;
    if (q.al <= ROAD_HALF_K) {
      h = q.y - q.l * tb - 1.0;
    } else {
      const edgeY = q.y - Math.sign(q.l) * ROAD_HALF_K * tb - 0.15;
      const t = smoothstep(ROAD_HALF_K + 3, ROAD_HALF_K + 75, q.al);
      h = lerp(edgeY, this.natural(x, z, q.al), t);
    }
    const e = this.pitEdge(q.fi);
    if (e > 0) h -= PIT_DEPTH * e * (1 - smoothstep(ROAD_HALF_K + 1, ROAD_HALF_K + 13, q.al));
    return h;
  }

  // 物理地面高度（道路使用精確面）
  groundHeight(x, z, q = this._q) {
    this.query(x, z, q);
    if (q.near && q.al <= ROAD_HALF_K && !q.gap) return q.y - q.l * Math.tan(q.bank);
    return this.terrainHeightFromQuery(x, z, q);
  }
  terrainHeightFromQuery(x, z, q) {
    if (!q.near) return this.natural(x, z, q.d);
    const tb = Math.tan(q.bank);
    let h;
    if (q.al <= ROAD_HALF_K) h = q.y - q.l * tb - 0.15;
    else {
      const edgeY = q.y - Math.sign(q.l) * ROAD_HALF_K * tb - 0.15;
      const t = smoothstep(ROAD_HALF_K + 3, ROAD_HALF_K + 75, q.al);
      h = lerp(edgeY, this.natural(x, z, q.al), t);
    }
    const e = this.pitEdge(q.fi);
    if (e > 0) h -= PIT_DEPTH * e * (1 - smoothstep(ROAD_HALF_K + 1, ROAD_HALF_K + 13, q.al));
    return h;
  }

  // 路面上索引 i、橫向 l 的世界座標
  surface(i, l, out = new THREE.Vector3()) {
    i = this.wrap(i);
    out.set(this.px[i] + this.rx[i] * l, this.py[i] - l * Math.tan(this.bank[i]), this.pz[i] + this.rz[i] * l);
    return out;
  }
  // 路面朝向（forward = (-sin h, 0, -cos h)）
  headingAt(i) {
    i = this.wrap(i);
    return Math.atan2(-this.tx[i], -this.tz[i]);
  }
  hasRail(fi) {
    return !this.isGapIdx(fi);
  }
}
