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
import { applyStunts, KIND } from './stunts.js';
export { TRACKS, trackById, THEMES, DEFAULT_TRACK, KIND };

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
        const kind = this.track.kind ? this.track.kind[i] : 0;
        if (kind === KIND.LOOP || kind === KIND.INVERT || kind === KIND.FLY || kind === KIND.WALL || kind === KIND.DECK) continue;
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
    this.kind = null;
    this.hasRibbon = false;
    this.obstacles = [];
    this.stunt = null;
    applyStunts(this);
  }

  // 特技賽道把樣本換成含迴圈的 3D 點列後，重新建立索引。
  _loadPoints(pts) {
    const N = pts.length;
    this.N = N;
    this.wrap = (i) => ((i % N) + N) % N;
    const px = this.px = new Float32Array(N), py = this.py = new Float32Array(N), pz = this.pz = new Float32Array(N);
    const tx = this.tx = new Float32Array(N), ty = this.ty = new Float32Array(N), tz = this.tz = new Float32Array(N);
    const nx = this.nx = new Float32Array(N), ny = this.ny = new Float32Array(N), nz = this.nz = new Float32Array(N);
    const rx = this.rx = new Float32Array(N), ry = this.ry = new Float32Array(N), rz = this.rz = new Float32Array(N);
    const bank = this.bank = new Float32Array(N);
    const arc = this.arc = new Float32Array(N);
    const kn = this.kn = new Float32Array(N);
    const kind = this.kind = new Uint8Array(N);
    let length = 0;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      px[i] = p.x; py[i] = p.y; pz[i] = p.z;
      tx[i] = p.tx; ty[i] = p.ty; tz[i] = p.tz;
      nx[i] = p.nx; ny[i] = p.ny; nz[i] = p.nz;
      rx[i] = p.rx; ry[i] = p.ry; rz[i] = p.rz;
      bank[i] = p.bank || 0;
      arc[i] = p.arc;
      kn[i] = p.kn;
      kind[i] = p.kind || 0;
      length += p.arc;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this.length = length;
    this.ds = length / N;
    this.bounds = { minX, maxX, minZ, maxZ };
    this.hasRibbon = true;
    this.fine = new Grid(this, 30, 1, 3);
    this.coarse = new Grid(this, 150, 6, 3);
    this._q = this.newQuery();
    this._q2 = this.newQuery();
  }

  wrapF(fi) {
    const N = this.N;
    let x = fi % N;
    if (x < 0) x += N;
    return x;
  }

  frame(fi, out) {
    const N = this.N;
    fi = this.wrapF(fi);
    const i0 = Math.floor(fi) % N, i1 = (i0 + 1) % N, f = fi - Math.floor(fi);
    const o = out || (this._fr || (this._fr = {
      pos: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3(), right: new THREE.Vector3(),
    }));
    const L = (arr) => arr[i0] + (arr[i1] - arr[i0]) * f;
    o.pos.set(L(this.px), L(this.py), L(this.pz));
    o.tangent.set(L(this.tx), this.ty ? L(this.ty) : 0, L(this.tz));
    if (this.nx) o.normal.set(L(this.nx), L(this.ny), L(this.nz));
    else o.normal.set(0, 1, 0);
    if (this.ry) o.right.set(L(this.rx), L(this.ry), L(this.rz));
    else o.right.set(L(this.rx), 0, L(this.rz));
    if (o.tangent.lengthSq() < 1e-8) o.tangent.set(0, 0, 1);
    o.tangent.normalize();
    o.normal.normalize();
    o.right.crossVectors(o.tangent, o.normal);
    if (o.right.lengthSq() < 1e-8) o.right.set(1, 0, 0);
    o.right.normalize();
    o.normal.crossVectors(o.right, o.tangent).normalize();
    o.kind = this.kind ? this.kind[i0] : 0;
    o.kn = this.kn ? L(this.kn) : 0;
    o.arc = this.arc ? Math.max(0.25, L(this.arc)) : this.ds;
    o.i0 = i0;
    return o;
  }

  newQuery() {
    return { i: 0, fi: 0, l: 0, al: 0, y: 0, bank: 0, tx: 0, tz: 0, rx: 0, rz: 0, d: 0, near: false, gap: false };
  }

  gapSpan(g) { return g && g.len ? g.len : this.gapLen; }
  isGapIdx(fi) {
    // fi：浮點索引；回傳該位置是否在缺口（沒有路面）
    for (const g of this.gaps) {
      let a = fi - g.g0;
      if (a < -this.N / 2) a += this.N;
      if (a > this.N / 2) a -= this.N;
      if (a > 0 && a < this.gapSpan(g)) return true;
    }
    return false;
  }
  // 進入特技大跳躍起點時給一點向上速度（只有標了 boost 的缺口）
  jumpBoost(fi) {
    for (const g of this.gaps) {
      if (!g.boost) continue;
      let a = fi - g.g0;
      if (a < -this.N / 2) a += this.N;
      if (a > this.N / 2) a -= this.N;
      if (a > -1 && a < 8) return g.boost;
    }
    return 0;
  }
  hiddenRoad(i) {
    const k = this.kind ? this.kind[this.wrap(Math.floor(i))] : 0;
    if (k === KIND.FLY) return true;
    return this.isGapIdx(i + 0.5);
  }
  pitEdge(fi) {
    let e = 0;
    for (const g of this.gaps) {
      const len = this.gapSpan(g);
      let a = fi - g.g0;
      if (a < -this.N / 2) a += this.N;
      if (a > this.N / 2) a -= this.N;
      if (a > 0 && a < len) e = Math.max(e, smoothstep(0, 3, a) * (1 - smoothstep(len - 3, len, a)));
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
    const side0 = dx * this.rx[i] + dz * this.rz[i];
    // 迴圈／倒吊沒進地面索引時，最近的地面點可能在切線很遠的地方。
    // 不能把那種點當成腳下的路面，否則慢車會被「吸」在半空。
    if (Math.abs(along) > this.ds * 1.8) {
      out.fi = i;
      out.y = this.py[i];
      out.bank = this.bank[i] || 0;
      out.tx = this.tx[i]; out.tz = this.tz[i];
      out.rx = this.rx[i]; out.rz = this.rz[i];
      out.l = side0;
      out.al = Math.hypot(along, side0);
      out.d = out.al;
      out.gap = false;
      out.near = true;
      return out;
    }
    const off = clamp(along / this.ds, -1, 1);
    let fi = i + off;
    out.fi = fi < 0 ? fi + N : fi;
    const i0 = Math.floor(out.fi) % N, i1 = (i0 + 1) % N, f = out.fi - Math.floor(out.fi);
    const upRibbon = (k) => k === KIND.LOOP || k === KIND.INVERT || k === KIND.FLY;
    const k0 = this.kind ? this.kind[i0] : 0, k1 = this.kind ? this.kind[i1] : 0;
    if (upRibbon(k0) || upRibbon(k1)) {
      const ig = upRibbon(k0) ? i1 : i0;
      out.y = this.py[ig];
      out.bank = this.bank[ig] || 0;
      out.fi = ig;
    } else {
      out.y = lerp(this.py[i0], this.py[i1], f);
      out.bank = lerp(this.bank[i0], this.bank[i1], f);
    }
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
    if (this.hasRibbon && this.kind && this.kind[i] !== KIND.GROUND && this.kind[i] !== KIND.FLY) {
      out.set(this.px[i] + this.rx[i] * l, this.py[i] + this.ry[i] * l, this.pz[i] + this.rz[i] * l);
      return out;
    }
    out.set(this.px[i] + this.rx[i] * l, this.py[i] - l * Math.tan(this.bank[i] || 0), this.pz[i] + this.rz[i] * l);
    return out;
  }
  // 路面朝向（forward = (-sin h, 0, -cos h)）
  headingAt(i) {
    i = this.wrap(i);
    return Math.atan2(-this.tx[i], -this.tz[i]);
  }
  hasRail(fi) {
    if (this.kind) {
      const k = this.kind[this.wrap(Math.floor(fi))];
      if (k === KIND.LOOP || k === KIND.INVERT || k === KIND.FLY || k === KIND.DECK) return false;
    }
    return !this.isGapIdx(fi);
  }
}
