// 迴旋試煉：在既有平面賽道上插入垂直高牆、倒吊迴圈、倒走段與飛越缺口。
// 迴圈與倒吊不是高度場，車子改貼著路面座標系走；吸地力不夠就脫離。
import { ROAD_HALF_K } from './track.js';

export const KIND = { GROUND: 0, WALL: 1, LOOP: 2, INVERT: 3, FLY: 4 };
// 風扇吸地：加速度 = FAN_K * v²。約 30 m/s 時抵過一倍重力，慢了就從倒吊段掉下去。
export const FAN_K = 0.011;

export function ribbonCompression(ny, kn, speed) {
  const v2 = speed * speed;
  return 9.81 * ny + v2 * (kn + FAN_K);
}

const hypot3 = (x, y, z) => Math.hypot(x, y, z) || 1;

function walk(pts, i, meters) {
  let d = 0;
  let j = i;
  const last = pts.length - 1;
  while (d < meters && j < last) {
    const n = j + 1;
    d += Math.hypot(pts[n].x - pts[j].x, pts[n].y - pts[j].y, pts[n].z - pts[j].z);
    j = n;
    if (j <= i) break;
  }
  return j;
}

function retangent(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = hypot3(dx, dy, dz);
    pts[i].tx = dx / L; pts[i].ty = dy / L; pts[i].tz = dz / L;
  }
}

function buildFrames(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    let tx = p.tx, ty = p.ty, tz = p.tz;
    let nx, ny, nz;
    if (p.kind === KIND.LOOP) {
      const th = p.th, ax = p.ax, az = p.az;
      nx = -ax * Math.sin(th);
      ny = Math.cos(th);
      nz = -az * Math.sin(th);
    } else {
      let hx = -tz, hz = tx;
      const hl = Math.hypot(hx, hz) || 1;
      hx /= hl; hz /= hl;
      const c = Math.cos(p.roll || 0), s = Math.sin(p.roll || 0);
      nx = -hx * s; ny = c; nz = -hz * s;
    }
    let L = hypot3(tx, ty, tz);
    tx /= L; ty /= L; tz /= L;
    const dot = nx * tx + ny * ty + nz * tz;
    nx -= dot * tx; ny -= dot * ty; nz -= dot * tz;
    L = hypot3(nx, ny, nz);
    nx /= L; ny /= L; nz /= L;
    let rx = ty * nz - tz * ny, ry = tz * nx - tx * nz, rz = tx * ny - ty * nx;
    L = hypot3(rx, ry, rz);
    rx /= L; ry /= L; rz /= L;
    p.tx = tx; p.ty = ty; p.tz = tz;
    p.nx = nx; p.ny = ny; p.nz = nz;
    p.rx = rx; p.ry = ry; p.rz = rz;
  }
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const ds = Math.max(0.25, Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z));
    p.arc = ds;
    p.kn = ((q.tx - p.tx) * p.nx + (q.ty - p.ty) * p.ny + (q.tz - p.tz) * p.nz) / ds;
  }
}

export function applyStunts(tr) {
  const spec = tr.def && tr.def.stunts;
  if (!spec) return;
  const N0 = tr.N;
  const pts = [];
  for (let i = 0; i < N0; i++) {
    pts.push({
      x: tr.px[i], y: tr.py[i], z: tr.pz[i], kind: KIND.GROUND, roll: 0, bank: tr.bank[i], th: 0, ax: 0, az: 0,
    });
  }

  const [wA, wB] = spec.wall;
  const iA = Math.max(8, Math.round(wA * N0));
  const iB = Math.min(N0 - 8, Math.round(wB * N0));
  let ks = 0;
  for (let i = iA; i <= iB; i++) ks += tr.kappa[i] || 0;
  const sign = ks >= 0 ? -1 : 1;
  for (let i = iA; i <= iB; i++) {
    const u = (i - iA) / Math.max(1, iB - iA);
    let ramp = u < 0.16 ? u / 0.16 : u > 0.84 ? (1 - u) / 0.16 : 1;
    ramp = Math.max(0, Math.min(1, ramp));
    const roll = sign * 0.95 * ramp;
    pts[i].roll = roll;
    pts[i].kind = Math.abs(roll) > 0.08 ? KIND.WALL : KIND.GROUND;
    pts[i].y += ROAD_HALF_K * Math.abs(Math.sin(roll));
  }

  const loopAt = Math.min(N0 - 20, Math.max(iB + 10, Math.round(spec.loop * N0)));
  const a = pts[Math.max(0, loopAt - 3)], b = pts[Math.min(pts.length - 1, loopAt + 3)];
  let tax = b.x - a.x, taz = b.z - a.z;
  const tl = Math.hypot(tax, taz) || 1;
  tax /= tl; taz /= tl;
  const R = spec.loopR || 22;
  const steps = Math.max(56, Math.round((2 * Math.PI * R) / 2.1));
  const ex = pts[loopAt].x, ey = pts[loopAt].y, ez = pts[loopAt].z;
  const loop = [];
  for (let s = 1; s < steps; s++) {
    const th = (s / steps) * Math.PI * 2;
    loop.push({
      x: ex + tax * R * Math.sin(th),
      y: ey + R * (1 - Math.cos(th)),
      z: ez + taz * R * Math.sin(th),
      kind: KIND.LOOP, roll: 0, bank: 0, th, ax: tax, az: taz,
    });
  }
  pts.splice(loopAt + 1, 0, ...loop);
  const loop0 = loopAt + 1;
  const loop1 = loopAt + loop.length;
  let loopTop = loop0;
  let bestNy = 1;
  for (let i = loop0; i <= loop1; i++) if (Math.cos(pts[i].th) < bestNy) { bestNy = Math.cos(pts[i].th); loopTop = i; }

  const after = loop1 + 1;
  const inv0 = walk(pts, after, 36);
  const inv1 = walk(pts, inv0, 100);
  const fly1 = walk(pts, inv1, 42);
  for (let i = inv0; i <= inv1 && i < pts.length; i++) {
    const u = (i - inv0) / Math.max(1, inv1 - inv0);
    const ramp = u < 0.14 ? u / 0.14 : 1;
    const base = pts[i].y;
    pts[i].roll = Math.PI * ramp;
    pts[i].kind = ramp > 0.2 ? KIND.INVERT : KIND.GROUND;
    pts[i].y = base + 14 * ramp;
    pts[i]._base = base;
  }
  for (let i = inv1 + 1; i <= fly1 && i < pts.length; i++) {
    pts[i].kind = KIND.FLY;
    pts[i].roll = Math.PI;
    pts[i].y = (pts[inv1]._base || pts[i].y) + 14;
  }

  const jump0 = walk(pts, fly1, 70);
  const jump1 = walk(pts, jump0, 34);
  const rampN = 14;
  for (let k = 0; k <= rampN; k++) {
    const i = jump0 - k;
    if (i < 1 || pts[i].kind !== KIND.GROUND) continue;
    const u = 1 - k / rampN;
    pts[i].y += 2.7 * Math.pow(Math.max(0, u), 1.3);
  }

  retangent(pts);
  buildFrames(pts);
  tr._loadPoints(pts);

  const glen = Math.max(4, jump1 - jump0);
  tr.gaps.push({ g0: tr.wrap(jump0), g1: tr.wrap(jump0 + glen), center: tr.wrap(jump0 + Math.floor(glen / 2)), len: glen, boost: 12 });

  const obstacles = [];
  const colors = [0x2f6f6a, 0xc4a574, 0x6e7a45, 0x8d3b4a, 0xd9d3c5, 0x3e4c59, 0xb0b4ae];
  for (let c = 0; c < 7; c++) {
    const i = tr.wrap(jump0 + 2 + Math.round((c + 0.5) * (glen - 4) / 7));
    obstacles.push({
      x: tr.px[i], y: tr.py[i] + 0.75, z: tr.pz[i],
      r: 1.55, h: 1.35,
      yaw: Math.atan2(tr.tx[i], tr.tz[i]),
      color: colors[c % colors.length],
      len: 3.6 + (c % 3) * 0.45,
      ht: 1.15 + (c % 2) * 0.25,
    });
  }
  tr.obstacles = obstacles;
  tr.stunt = {
    wall0: iA, wall1: iB, loop0, loop1, loopTop, inv0, inv1, fly0: inv1 + 1, fly1, jump0, jump1,
  };
}
