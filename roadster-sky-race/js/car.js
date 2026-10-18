// 程序化原創車輛模型：Roadster / Model 3 / Model Y / Model S / Model X / Cybertruck / Semi / Cybercab 風格的原創造型
// 全部以 Three.js 幾何生成（放樣截面 + 車輪拱孔洞 + 稜面放樣 + Lathe），無任何商標、標誌、文字或官方模型資料。
import * as THREE from 'three';
import { clamp, lerp } from './util.js';
import { glowTexture, blobTexture, aeroWheelTexture } from './textures.js';
import { PAINT_DEFS, vehicleById } from './vehicles.js';

// 細節等級（面數預算：高 < 26k 三角形，低約 8~13k）
const LOD = {
  low:  { stations: 54, n1: 5, n2: 2, n3: 3, n4: 2, n5: 2, cabSt: 22, cabSeg: 16, tire: 20, rings: 2, wheelSeg: 24, sphere: 8, arch: 16 },
  high: { stations: 92, n1: 9, n2: 4, n3: 5, n4: 3, n5: 3, cabSt: 40, cabSeg: 26, tire: 44, rings: 4, wheelSeg: 40, sphere: 14, arch: 24 },
};

// ---- 平滑曲線（Catmull-Rom Hermite，非等距節點） ----
function curve(keys) {
  const n = keys.length, d = keys[0].length - 1;
  const tan = keys.map((k, i) => {
    const a = keys[Math.max(i - 1, 0)], b = keys[Math.min(i + 1, n - 1)];
    const dz = b[0] - a[0];
    return Array.from({ length: d }, (_, j) => (b[j + 1] - a[j + 1]) / dz);
  });
  return (z) => {
    let k = 0;
    while (k < n - 2 && z > keys[k + 1][0]) k++;
    const A = keys[k], B = keys[k + 1], h = B[0] - A[0];
    const t = clamp((z - A[0]) / h, 0, 1), t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    return Array.from({ length: d }, (_, j) => h00 * A[j + 1] + h10 * h * tan[k][j] + h01 * B[j + 1] + h11 * h * tan[k + 1][j]);
  };
}


// ================= 各車造型規格 =================
// 車身站位 → [z, 半寬 hw, 底 yb, 中線頂 yt, 葉子板頂 yc]；座艙 → [z, 半寬, 底, 頂]
const SH_CAR = { rx: 0.10, ry: 0.10, rby: 0.08, rbx: 0.09, tuck: 0.94, topExp: 1.5 };
const SPECS = {
  roadster: {
    kind: 'loft', R: 0.355, archR: 0.405, archX: 0.70, yL: 0.205, blob: [3.3, 6.2], fx: 1, mirror: [0.96, 0.86, -0.62],
    parts: [{ z0: -2.35, z1: 2.35, capF: 0.55, capB: 0.16, sh: { rx: 0.13, ry: 0.10, rby: 0.09, rbx: 0.11, tuck: 0.93, topExp: 1.7 }, keys: [
      [-2.35, 0.60, 0.24, 0.40, 0.42], [-2.00, 0.78, 0.19, 0.47, 0.55], [-1.70, 0.92, 0.17, 0.55, 0.74],
      [-1.40, 1.00, 0.17, 0.62, 0.82], [-1.00, 1.00, 0.18, 0.67, 0.82], [-0.50, 0.97, 0.21, 0.67, 0.77],
      [0.20, 0.97, 0.21, 0.69, 0.77], [0.80, 1.02, 0.19, 0.76, 0.88], [1.40, 1.06, 0.18, 0.80, 0.93],
      [1.90, 1.02, 0.21, 0.78, 0.88], [2.35, 0.90, 0.27, 0.72, 0.76]] }],
    cab: { z0: -1.15, z1: 1.5, cf: 0.30, cb: 0.34, ex: 2.7, keys: [
      [-1.15, 0.40, 0.62, 0.68], [-0.70, 0.54, 0.62, 0.90], [-0.20, 0.58, 0.62, 1.02], [0.30, 0.58, 0.62, 1.05],
      [0.75, 0.55, 0.62, 0.98], [1.15, 0.45, 0.62, 0.88], [1.50, 0.30, 0.62, 0.80]] },
    wheels: [{ z: -1.40, x: 0.82, w: 0.27, front: true }, { z: 1.40, x: 0.86, w: 0.31, front: false }],
    head: [[0.20, 0.40, 0.80, 0.585, 0.018, 0.034, 18], 1, true],
    tail: [-0.86, 0.86, 0.615, 0.03, 0.045],
    darks: [[-0.50, 0.30, 0.50, 0.30, 0.045, 14, 1], [-0.80, 0.355, 0.80, 0.355, 0.11, 18, -1]],
    rear: [{ x: 0.36, y: 0.50, r: 0.145, ry: 0, k: 1 }, { x: 0.70, y: 0.46, r: 0.075, ry: 0.22, k: 0.55 }], zTail: 2.215,
    lifts: [[-0.80, -0.66], [0.80, -0.66], [-0.80, 0.66], [0.80, 0.66]], diffuser: true,
  },
  model3: {
    kind: 'loft', R: 0.345, archR: 0.395, archX: 0.665, yL: 0.235, blob: [3.2, 6.0], fx: 1, mirror: [0.95, 0.89, -0.86],
    parts: [{ z0: -2.35, z1: 2.35, capF: 0.45, capB: 0.2, sh: SH_CAR, keys: [
      [-2.35, 0.50, 0.26, 0.42, 0.44], [-2.05, 0.73, 0.21, 0.54, 0.62], [-1.70, 0.88, 0.19, 0.67, 0.78], [-1.42, 0.93, 0.18, 0.71, 0.80],
      [-0.60, 0.93, 0.20, 0.74, 0.82], [0.60, 0.93, 0.20, 0.76, 0.84], [1.42, 0.93, 0.19, 0.79, 0.88], [2.05, 0.87, 0.21, 0.92, 0.96],
      [2.35, 0.72, 0.27, 0.90, 0.92]] }],
    cab: { z0: -1.0, z1: 1.55, cf: 0.3, cb: 0.1, ex: 3.0, keys: [
      [-1.0, 0.60, 0.62, 0.84], [-0.55, 0.72, 0.62, 1.14], [-0.1, 0.75, 0.62, 1.36], [0.35, 0.75, 0.62, 1.43],
      [0.85, 0.73, 0.62, 1.40], [1.25, 0.70, 0.62, 1.22], [1.55, 0.66, 0.62, 1.0]] },
    wheels: [{ z: -1.42, x: 0.80, w: 0.245, front: true }, { z: 1.42, x: 0.80, w: 0.265, front: false }],
    head: [[0.22, 0.46, 0.78, 0.62, 0.016, 0.03, 18], 1, true],
    tail: [-0.80, 0.80, 0.74, 0.03, 0.05],
    darks: [[-0.55, 0.34, 0.55, 0.34, 0.05, 14, 1], [-0.75, 0.38, 0.75, 0.38, 0.1, 14, -1]],
    rear: [{ x: 0.34, y: 0.5, r: 0.125, ry: 0, k: 0.95 }, { x: 0.66, y: 0.46, r: 0.07, ry: 0.2, k: 0.55 }], zTail: 2.2,
    lifts: [[-0.76, -0.7], [0.76, -0.7], [-0.76, 0.7], [0.76, 0.7]],
  },
  modely: {
    kind: 'loft', R: 0.365, archR: 0.415, archX: 0.665, yL: 0.25, blob: [3.3, 6.1], fx: 1, mirror: [0.96, 1.0, -0.98],
    parts: [{ z0: -2.37, z1: 2.37, capF: 0.45, capB: 0.18, sh: SH_CAR, keys: [
      [-2.37, 0.50, 0.30, 0.48, 0.50], [-2.05, 0.74, 0.25, 0.62, 0.70], [-1.70, 0.90, 0.23, 0.76, 0.86], [-1.43, 0.94, 0.22, 0.80, 0.90],
      [-0.60, 0.94, 0.24, 0.84, 0.92], [0.60, 0.94, 0.24, 0.86, 0.94], [1.43, 0.94, 0.23, 0.88, 0.96], [2.05, 0.88, 0.25, 0.92, 0.96],
      [2.37, 0.74, 0.32, 0.86, 0.88]] }],
    cab: { z0: -1.02, z1: 2.3, cf: 0.3, cb: 0.12, ex: 3.4, keys: [
      [-1.02, 0.60, 0.72, 0.94], [-0.5, 0.74, 0.72, 1.28], [0.0, 0.78, 0.72, 1.55], [0.7, 0.80, 0.72, 1.64],
      [1.4, 0.80, 0.72, 1.62], [2.0, 0.76, 0.72, 1.46], [2.3, 0.70, 0.72, 1.18]] },
    wheels: [{ z: -1.43, x: 0.80, w: 0.255, front: true }, { z: 1.43, x: 0.80, w: 0.275, front: false }],
    head: [[0.22, 0.52, 0.78, 0.68, 0.016, 0.03, 18], 1, true],
    tail: [-0.80, 0.80, 0.84, 0.03, 0.05],
    darks: [[-0.55, 0.36, 0.55, 0.36, 0.05, 14, 1], [-0.75, 0.42, 0.75, 0.42, 0.1, 14, -1]],
    rear: [{ x: 0.34, y: 0.52, r: 0.125, ry: 0, k: 0.95 }, { x: 0.66, y: 0.5, r: 0.07, ry: 0.2, k: 0.55 }], zTail: 2.22,
    lifts: [[-0.76, -0.7], [0.76, -0.7], [-0.76, 0.7], [0.76, 0.7]],
  },
  models: {
    kind: 'loft', R: 0.35, archR: 0.4, archX: 0.675, yL: 0.215, blob: [3.3, 6.4], fx: 1, mirror: [0.97, 0.86, -0.92],
    parts: [{ z0: -2.5, z1: 2.5, capF: 0.5, capB: 0.2, sh: SH_CAR, keys: [
      [-2.5, 0.50, 0.24, 0.40, 0.42], [-2.15, 0.76, 0.20, 0.52, 0.62], [-1.80, 0.90, 0.18, 0.62, 0.76], [-1.50, 0.95, 0.18, 0.65, 0.78],
      [-0.70, 0.95, 0.20, 0.69, 0.80], [0.70, 0.95, 0.20, 0.71, 0.82], [1.50, 0.95, 0.19, 0.74, 0.85], [2.15, 0.88, 0.20, 0.78, 0.84],
      [2.5, 0.72, 0.25, 0.74, 0.78]] }],
    cab: { z0: -1.15, z1: 2.45, cf: 0.3, cb: 0.4, ex: 3.0, keys: [
      [-1.15, 0.58, 0.6, 0.80], [-0.6, 0.70, 0.6, 1.06], [0.0, 0.75, 0.6, 1.26], [0.9, 0.76, 0.6, 1.34],
      [1.6, 0.73, 0.6, 1.26], [2.1, 0.65, 0.6, 1.06], [2.45, 0.5, 0.6, 0.86]] },
    wheels: [{ z: -1.5, x: 0.82, w: 0.26, front: true }, { z: 1.5, x: 0.82, w: 0.285, front: false }],
    head: [[0.20, 0.44, 0.80, 0.58, 0.014, 0.028, 18], 1, true],
    tail: [-0.82, 0.82, 0.72, 0.028, 0.05],
    darks: [[-0.55, 0.32, 0.55, 0.32, 0.05, 14, 1], [-0.78, 0.36, 0.78, 0.36, 0.1, 14, -1]],
    rear: [{ x: 0.34, y: 0.48, r: 0.125, ry: 0, k: 0.95 }, { x: 0.68, y: 0.44, r: 0.07, ry: 0.2, k: 0.55 }], zTail: 2.36,
    lifts: [[-0.78, -0.75], [0.78, -0.75], [-0.78, 0.75], [0.78, 0.75]],
  },
  modelx: {
    kind: 'loft', R: 0.39, archR: 0.44, archX: 0.70, yL: 0.27, blob: [3.5, 6.4], fx: 1.1, mirror: [1.0, 1.04, -1.12],
    parts: [{ z0: -2.52, z1: 2.52, capF: 0.5, capB: 0.2, sh: SH_CAR, keys: [
      [-2.52, 0.55, 0.30, 0.46, 0.50], [-2.15, 0.82, 0.26, 0.64, 0.74], [-1.80, 0.97, 0.24, 0.78, 0.90], [-1.52, 1.00, 0.24, 0.82, 0.94],
      [-0.60, 1.00, 0.26, 0.86, 0.96], [0.80, 1.00, 0.26, 0.88, 0.98], [1.52, 1.00, 0.25, 0.90, 1.00], [2.15, 0.94, 0.27, 0.94, 1.00],
      [2.52, 0.80, 0.33, 0.88, 0.92]] }],
    cab: { z0: -1.18, z1: 2.45, cf: 0.3, cb: 0.4, ex: 3.1, keys: [
      [-1.18, 0.62, 0.74, 0.94], [-0.6, 0.78, 0.74, 1.35], [-0.1, 0.84, 0.74, 1.62], [0.7, 0.86, 0.74, 1.76],
      [1.5, 0.84, 0.74, 1.70], [2.1, 0.76, 0.74, 1.40], [2.45, 0.6, 0.74, 1.04]] },
    wheels: [{ z: -1.52, x: 0.86, w: 0.28, front: true }, { z: 1.52, x: 0.86, w: 0.30, front: false }],
    head: [[0.22, 0.52, 0.84, 0.66, 0.016, 0.03, 18], 1, true],
    tail: [-0.86, 0.86, 0.84, 0.03, 0.05],
    darks: [[-0.6, 0.36, 0.6, 0.36, 0.055, 14, 1], [-0.82, 0.42, 0.82, 0.42, 0.1, 14, -1]],
    rear: [{ x: 0.38, y: 0.52, r: 0.14, ry: 0, k: 1.0 }, { x: 0.72, y: 0.5, r: 0.08, ry: 0.2, k: 0.6 }], zTail: 2.38,
    lifts: [[-0.82, -0.75], [0.82, -0.75], [-0.82, 0.75], [0.82, 0.75]],
  },
  cybercab: {
    kind: 'loft', R: 0.33, archR: 0.38, archX: 0.63, yL: 0.25, blob: [3.0, 4.9], fx: 0.9, mirror: null,
    parts: [{ z0: -1.9, z1: 1.9, capF: 0.5, capB: 0.4, sh: { rx: 0.17, ry: 0.15, rby: 0.09, rbx: 0.12, tuck: 0.9, topExp: 1.4 }, keys: [
      [-1.9, 0.55, 0.32, 0.50, 0.52], [-1.6, 0.76, 0.27, 0.64, 0.70], [-1.2, 0.86, 0.25, 0.72, 0.78], [-0.4, 0.88, 0.26, 0.76, 0.82],
      [0.6, 0.88, 0.26, 0.78, 0.84], [1.3, 0.86, 0.25, 0.78, 0.82], [1.7, 0.74, 0.26, 0.72, 0.76], [1.9, 0.55, 0.32, 0.60, 0.62]] }],
    cab: { z0: -1.32, z1: 1.45, cf: 0.4, cb: 0.45, ex: 2.3, keys: [
      [-1.32, 0.56, 0.66, 0.82], [-0.9, 0.70, 0.66, 1.2], [-0.3, 0.76, 0.66, 1.42], [0.4, 0.76, 0.66, 1.42],
      [1.0, 0.70, 0.66, 1.22], [1.45, 0.50, 0.66, 0.94]] },
    wheels: [{ z: -1.12, x: 0.76, w: 0.23, front: true }, { z: 1.12, x: 0.76, w: 0.24, front: false }],
    head: [[-0.6, 0.66, 0.6, 0.66, 0.035, 0.035, 20], 1, false],
    tail: [-0.6, 0.6, 0.78, 0.035, 0.0],
    darks: [[-0.5, 0.36, 0.5, 0.36, 0.06, 12, 1], [-0.6, 0.4, 0.6, 0.4, 0.09, 12, -1]],
    rear: [{ x: 0.3, y: 0.52, r: 0.115, ry: 0, k: 0.9 }, { x: 0.6, y: 0.48, r: 0.065, ry: 0.2, k: 0.5 }], zTail: 1.8,
    lifts: [[-0.74, -0.55], [0.74, -0.55], [-0.74, 0.55], [0.74, 0.55]],
  },
  cybertruck: {
    kind: 'truck', R: 0.45, archR: 0.52, yL: 0.42, blob: [3.6, 6.6], fx: 1.3, vc: true, mirrorBox: [1.0, 1.32, -0.95],
    wheels: [{ z: -1.75, x: 1.03, w: 0.34, front: true }, { z: 1.75, x: 1.03, w: 0.36, front: false }],
    head: [[-0.74, 0.73, 0.74, 0.73, 0.04, 0.04, 20], 1, false],
    tail: [-0.9, 0.9, 1.06, 0.045, 0.0],
    rear: [{ x: 0.42, y: 0.8, r: 0.15, ry: 0, k: 1.1 }, { x: 0.78, y: 0.62, r: 0.085, ry: 0.2, k: 0.65 }], zTail: 2.78,
    lifts: [[-0.9, -1.2], [0.9, -1.2], [-0.9, 1.2], [0.9, 1.2]], liftR: 1.35,
  },
  semi: {
    kind: 'semi', R: 0.5, archR: 0.5, yL: 0.5, blob: [4.6, 11.2], fx: 1.8, vc: true,
    parts: [
      { z0: -4.4, z1: -0.45, capF: 0.7, capB: 0.06, arch: false, sh: { rx: 0.22, ry: 0.2, rby: 0.1, rbx: 0.1, tuck: 1.0, topExp: 1.3 }, keys: [
        [-4.4, 0.85, 0.60, 1.0, 1.05], [-4.0, 1.05, 0.52, 1.3, 1.4], [-3.4, 1.18, 0.5, 1.7, 1.8], [-2.8, 1.25, 0.5, 2.2, 2.3],
        [-2.0, 1.25, 0.5, 2.6, 2.65], [-1.2, 1.25, 0.5, 2.7, 2.75], [-0.45, 1.25, 0.5, 2.7, 2.75]] },
      { z0: -0.25, z1: 4.55, capF: 0.05, capB: 0.05, arch: false, st: 14, sh: { rx: 0.1, ry: 0.1, rby: 0.08, rbx: 0.08, tuck: 1.0, topExp: 1.0 }, keys: [
        [-0.25, 1.28, 0.9, 3.35, 3.4], [4.55, 1.28, 0.9, 3.35, 3.4]] },
    ],
    cab: { z0: -3.95, z1: -1.3, cf: 0.3, cb: 0.3, ex: 2.4, keys: [
      [-3.95, 0.75, 1.2, 1.5], [-3.4, 1.0, 1.2, 2.2], [-2.8, 1.12, 1.4, 2.95], [-2.0, 1.12, 1.4, 3.1], [-1.3, 1.0, 1.4, 2.95]] },
    wheels: [{ z: -3.3, x: 1.22, w: 0.36, front: true }, { z: -1.6, x: 1.24, w: 0.4, front: false }, { z: -0.65, x: 1.24, w: 0.4, front: false },
      { z: 3.2, x: 1.22, w: 0.38, front: false }, { z: 4.05, x: 1.22, w: 0.38, front: false }],
    head: [[-0.9, 1.30, 0.9, 1.30, 0.07, 0.07, 20], 1, false],
    tail: [-1.1, 1.1, 3.0, 0.06, 0.0],
    boxes: [{ s: [1.7, 0.3, 8.8], p: [0, 0.7, 0.15] }, { s: [2.0, 0.28, 0.3], p: [0, 0.5, -4.42] }, { s: [1.6, 0.9, 0.04], p: [0, 1.05, -4.18] }],
    rear: [{ x: 0.45, y: 1.2, r: 0.2, ry: 0, k: 1.2 }, { x: 0.95, y: 1.0, r: 0.11, ry: 0.15, k: 0.7 }], zTail: 4.55,
    lifts: [[-0.95, -2.4], [0.95, -2.4], [-0.95, 2.2], [0.95, 2.2]], liftR: 1.9,
  },
};
const capE = (z, z0, z1, cf, cb) => {
  let e = 1;
  if (z < z0 + cf) { const d = (z - z0) / cf; e = Math.sqrt(Math.max(0, 1 - (1 - d) * (1 - d))); }
  if (z > z1 - cb) { const d = (z1 - z) / cb; e = Math.min(e, Math.sqrt(Math.max(0, 1 - (1 - d) * (1 - d)))); }
  return e;
};


// 右半截面（由頂部中線到底部中線），回傳 [[x,y]...]
function halfSection(hw, yb, yt, yc, P, s) {
  const H = yc - yb;
  const rx = Math.min(s.rx, hw * 0.4), ry = Math.min(s.ry, H * 0.28), rby = Math.min(s.rby, H * 0.25), rbx = Math.min(s.rbx, hw * 0.3);
  const pts = [], xc = hw - rx;
  for (let i = 0; i < P.n1; i++) { const u = i / P.n1; pts.push([xc * u, yt + (yc - yt) * Math.pow(u, s.topExp)]); }
  const cy = yc - ry;
  for (let i = 0; i <= P.n2; i++) { const a = (1 - i / P.n2) * Math.PI / 2; pts.push([xc + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
  const xb = hw * s.tuck, ybc = yb + rby;
  for (let i = 1; i <= P.n3; i++) { const v = i / P.n3; pts.push([hw + (xb - hw) * v * v, cy + (ybc - cy) * v]); }
  for (let i = 1; i <= P.n4; i++) { const a = (i / P.n4) * Math.PI / 2; pts.push([xb - rbx + rbx * Math.cos(a), ybc - rby * Math.sin(a)]); }
  const xe = xb - rbx;
  for (let i = 1; i <= P.n5; i++) pts.push([xe * (1 - i / P.n5), yb]);
  return pts;
}

// 放樣車身：站位 × 截面環；車輪拱孔洞（只處理側面/底部頂點）
function buildBody(P, spec, part) {
  const BODY = curve(part.keys);
  const { z0: Z0, z1: Z1 } = part;
  const S = part.st || Math.max(18, Math.round(P.stations * (Z1 - Z0) / 4.7));
  const pos = [], inside = [];
  let H = 0;
  const archs = [];
  if (part.arch !== false) for (const w of spec.wheels) for (const sx of [-1, 1]) archs.push({ z: w.z, sx });
  const R = spec.R, AR = spec.archR, AX = spec.archX;
  for (let s = 0; s <= S; s++) {
    const z = lerp(Z0, Z1, s / S);
    const [hw, yb, yt, yc] = BODY(z);
    const e = capE(z, Z0, Z1, part.capF, part.capB);
    const half = halfSection(hw, yb, yt, yc, P, part.sh);
    H = half.length;
    const ym = (yb + yc) / 2;
    const ring = [];
    for (let i = 0; i < H; i++) ring.push([half[i][0], half[i][1], i]);
    for (let i = H - 2; i >= 1; i--) ring.push([-half[i][0], half[i][1], i]);
    for (const [x0, y0, i] of ring) {
      let x = x0 * e, y = ym + (y0 - ym) * e, zz = z, ins = false;
      if (i >= P.n1 && Math.abs(x) > AX) {
        for (const a of archs) {
          if (a.sx * x <= 0) continue;
          const dz = zz - a.z, dy = y - R;
          if (dy >= 0) { const d = Math.hypot(dz, dy); if (d < AR) { ins = true; zz = a.z + dz / d * AR; y = R + dy / d * AR; } }
          else if (Math.abs(dz) < AR) { ins = true; zz = a.z + (dz >= 0 ? 1 : -1) * AR; }
        }
      }
      pos.push(x, y, zz); inside.push(ins);
    }
  }
  const M = 2 * H - 2, idx = [];
  for (let s = 0; s < S; s++) for (let j = 0; j < M; j++) {
    const a = s * M + j, b = s * M + (j + 1) % M, c = a + M, d = b + M;
    if (inside[a] && inside[b] && inside[c]) { /* 拱孔洞 */ } else idx.push(a, c, b);
    if (inside[b] && inside[d] && inside[c]) { /* 拱孔洞 */ } else idx.push(b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // 兩端收口點的法線指向 ±z
  const nr = g.attributes.normal;
  for (let j = 0; j < M; j++) { nr.setXYZ(j, 0, 0, -1); nr.setXYZ(S * M + j, 0, 0, 1); }
  return g;
}

// 座艙玻璃罩（超橢圓截面，底部藏在車身內）
function buildCabin(P, cabSpec) {
  const CAB = curve(cabSpec.keys);
  const Z0 = cabSpec.z0, Z1 = cabSpec.z1, S = P.cabSt, seg = P.cabSeg, ex = cabSpec.ex;
  const pos = [], idx = [];
  for (let s = 0; s <= S; s++) {
    const z = lerp(Z0, Z1, s / S);
    const [hw, yb, yt] = CAB(z);
    const e = capE(z, Z0, Z1, cabSpec.cf, cabSpec.cb);
    const yc = (yb + yt) / 2, hh = (yt - yb) / 2;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a);
      pos.push(Math.sign(c) * Math.pow(Math.abs(c), 2 / ex) * hw * e, yc + Math.sign(si) * Math.pow(Math.abs(si), 2 / ex) * hh * e, z);
    }
  }
  for (let s = 0; s < S; s++) for (let j = 0; j < seg; j++) {
    const a = s * seg + j, b = s * seg + (j + 1) % seg, c = a + seg, d = b + seg;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 稜面放樣（Cybertruck）：站位環以平面三角形連接，法線朝外、平坦著色
function facetLoft(stations, ringFn) {
  const pos = [], idx = [];
  let n = 0;
  for (const st of stations) { const r = ringFn(st); n = r.length; for (const [x, y] of r) pos.push(x, y, st.z); }
  const S = stations.length;
  for (let s = 0; s < S - 1; s++) for (let j = 0; j < n; j++) {
    const a = s * n + j, b = s * n + (j + 1) % n, c = a + n, d = b + n;
    idx.push(a, c, b, b, c, d);
  }
  for (const [base, flip] of [[0, false], [(S - 1) * n, true]]) {
    let cx = 0, cy = 0;
    for (let j = 0; j < n; j++) { cx += pos[(base + j) * 3]; cy += pos[(base + j) * 3 + 1]; }
    const ci = pos.length / 3; pos.push(cx / n, cy / n, pos[base * 3 + 2]);
    for (let j = 0; j < n; j++) { const a = base + j, b = base + (j + 1) % n; idx.push(ci, flip ? a : b, flip ? b : a); }
  }
  // 以整體重心為準，把每個三角形的繞向調成朝外
  const c = new THREE.Vector3(); for (let i = 0; i < pos.length; i += 3) c.x += pos[i], c.y += pos[i + 1], c.z += pos[i + 2];
  c.divideScalar(pos.length / 3);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), nn = new THREE.Vector3(), m = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    A.fromArray(pos, idx[t] * 3); B.fromArray(pos, idx[t + 1] * 3); C.fromArray(pos, idx[t + 2] * 3);
    nn.subVectors(B, A).cross(m.subVectors(C, A));
    m.copy(A).add(B).add(C).divideScalar(3).sub(c);
    if (nn.dot(m) < 0) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const f = g.toNonIndexed(); f.computeVertexNormals();
  return f;
}
function buildTruckBody() {
  // [z, 下半寬, 上半寬, 底, 頂]：尖鼻、平直的引擎蓋、斜切到床板的單一斜線
  const st = [[-2.80, 0.82, 0.70, 0.54, 0.80], [-2.00, 0.98, 0.88, 0.46, 1.02], [-1.20, 1.00, 0.93, 0.44, 1.24],
    [1.55, 1.00, 0.93, 0.44, 1.30], [1.55, 1.00, 0.93, 0.44, 1.14], [2.80, 1.00, 0.93, 0.47, 1.14]].map(([z, hb, ht, yb, yt]) => ({ z, hb, ht, yb, yt }));
  return facetLoft(st, ({ hb, ht, yb, yt }) => [[0, yt], [ht, yt], [hb, yt - 0.22 * (yt - yb)], [hb, yb + 0.14], [hb * 0.9, yb], [0, yb], [-hb * 0.9, yb], [-hb, yb + 0.14], [-hb, yt - 0.22 * (yt - yb)], [-ht, yt]]);
}
function buildTruckCab() {
  const st = [[-1.30, 0.93, 0.88, 1.25], [-0.15, 0.92, 0.66, 1.92], [0.40, 0.92, 0.64, 1.92], [1.55, 0.94, 0.84, 1.30]].map(([z, hb, ht, yt]) => ({ z, hb, ht, yt }));
  return facetLoft(st, ({ hb, ht, yt }) => [[0, yt], [ht, yt], [hb, 1.2], [-hb, 1.2], [-ht, yt]]);
}
function archDecal(R) {   // 側面的半圓拱外框（深色貼片）
  const sh = new THREE.Shape();
  sh.moveTo(-R, -0.03); sh.lineTo(-R, 0); sh.absarc(0, 0, R, Math.PI, 0, true); sh.lineTo(R, -0.03); sh.closePath();
  return new THREE.ShapeGeometry(sh, 14);
}

// 發光燈條：以射線把折線投影到車身表面，沿法線微浮起，做成貼著曲面的細帶
function surfaceRibbon(bodyMesh, pts, dirZ, mat) {
  const ray = new THREE.Raycaster();
  const geo = bodyMesh.geometry, P = geo.attributes.position, N = geo.attributes.normal;
  const hit = (x, y) => {
    ray.set(new THREE.Vector3(x, y, -dirZ * 4), new THREE.Vector3(0, 0, dirZ));
    const h = ray.intersectObject(bodyMesh, false)[0];
    if (!h) return null;
    const f = h.face, tri = new THREE.Triangle(new THREE.Vector3().fromBufferAttribute(P, f.a), new THREE.Vector3().fromBufferAttribute(P, f.b), new THREE.Vector3().fromBufferAttribute(P, f.c));
    const n = new THREE.Vector3();
    tri.getInterpolation(h.point, new THREE.Vector3().fromBufferAttribute(N, f.a), new THREE.Vector3().fromBufferAttribute(N, f.b), new THREE.Vector3().fromBufferAttribute(N, f.c), n);
    n.normalize();
    return h.point.clone().addScaledVector(n, 0.011);
  };
  const pos = [], idx = [];
  let prev = -1;
  for (const [x, y, w] of pts) {
    const a = hit(x, y + w / 2), b = hit(x, y - w / 2);
    if (!a || !b) { prev = -1; continue; }
    const i = pos.length / 3;
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    if (prev >= 0) idx.push(prev, prev + 1, i, prev + 1, i + 1, i);
    prev = i;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  return m;
}
const line = (x0, y0, x1, y1, w0, w1, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [lerp(x0, x1, t), lerp(y0, y1, t) + 0.025 * Math.sin(Math.PI * t) * 0, lerp(w0, w1, t)]; });

// 火箭噴口（鐘形，Lathe）。軸向 +y，口在 +y。
function bellGeometry(rThroat, rMouth, len, seg) {
  const prof = [];
  const n = 8;
  for (let i = 0; i <= n; i++) { const t = i / n; prof.push(new THREE.Vector2(rThroat + (rMouth - rThroat) * Math.pow(t, 0.55) - 0.012, t * len)); }
  prof.push(new THREE.Vector2(rMouth + 0.004, len));
  for (let i = n; i >= 0; i--) { const t = i / n; prof.push(new THREE.Vector2(rThroat + (rMouth - rThroat) * Math.pow(t, 0.55) + 0.006, t * len)); }
  return new THREE.LatheGeometry(prof, seg);
}

// 圓盤（輪圈面，帶凹陷與放射 UV）
function discGeometry(rad, segs, rings, dish, yEdge, up) {
  const pos = [], uv = [], idx = [];
  pos.push(0, yEdge - dish, 0); uv.push(0.5, 0.5);
  for (let k = 1; k <= rings; k++) {
    const t = k / rings, r = rad * t;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, yEdge - dish * (1 - t * t), Math.sin(a) * r);
      uv.push(0.5 + Math.cos(a) * t * 0.5, 0.5 + Math.sin(a) * t * 0.5);
    }
  }
  for (let i = 0; i < segs; i++) { const a = 1 + i, b = 1 + (i + 1) % segs; if (up) idx.push(0, b, a); else idx.push(0, a, b); }
  for (let k = 1; k < rings; k++) for (let i = 0; i < segs; i++) {
    const a = 1 + (k - 1) * segs + i, b = 1 + (k - 1) * segs + (i + 1) % segs, c = a + segs, d = b + segs;
    if (up) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function tireGeometry(w, seg, R) {
  const h = w / 2;
  const p = [[R - 0.083, -h * 0.9], [R - 0.055, -h * 0.99], [R - 0.028, -h * 0.97], [R - 0.010, -h * 0.80], [R - 0.002, -h * 0.5], [R, -h * 0.25],
    [R, h * 0.25], [R - 0.002, h * 0.5], [R - 0.010, h * 0.80], [R - 0.028, h * 0.97], [R - 0.055, h * 0.99], [R - 0.083, h * 0.9]];
  return new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

// 把多個網格合併成一個（減少繪製呼叫）。items: [{geometry, matrix, color?}]；保留 position / normal / uv（有 color 時加頂點色）。
function mergeItems(items) {
  const pos = [], nor = [], uv = [], col = [];
  const useCol = items.some((i) => i.color != null);
  const nm = new THREE.Matrix3(), v = new THREE.Vector3(), cc = new THREE.Color();
  for (const { geometry, matrix, color } of items) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    nm.getNormalMatrix(matrix);
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    cc.set(color != null ? color : 0xffffff);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(matrix); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
      if (useCol) col.push(cc.r, cc.g, cc.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (useCol) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

export function countTriangles(root) {
  let t = 0;
  root.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return Math.round(t);
}

export function paintsOf(vehicleId) { return vehicleById(vehicleId).paints.map((k) => ({ key: k, ...PAINT_DEFS[k] })); }

export class CarModel {
  // vehicleId：車種 id；paint：車漆 key 或該車種車漆清單的索引
  constructor(quality, vehicleId = 'roadster', paint = 0) {
    this.vehicle = vehicleById(vehicleId);
    this.vehicleId = this.vehicle.id;
    const spec = this.spec = SPECS[this.vehicleId];
    this.root = new THREE.Group();       // 由物理設定位置/朝向
    this.body = new THREE.Group();       // 懸吊（俯仰/側傾/下沉）
    this.root.add(this.body);
    const lodName = quality.carLod || (quality.physical ? 'high' : 'low');
    const L = LOD[lodName];
    this.lod = lodName;
    this.R = spec.R;
    this.fx = spec.fx || 1;
    const physical = quality.physical;
    const Mat = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const shadow = !!quality.shadows;
    this.paints = paintsOf(this.vehicleId);
    const pdef = this._paintDef(paint);

    // ---- 材質 ----
    const paintOpts = { color: pdef.color, metalness: pdef.metalness, roughness: pdef.roughness, envMapIntensity: 1.0 };
    if (physical && this.vehicleId !== 'cybertruck') { paintOpts.clearcoat = 1; paintOpts.clearcoatRoughness = 0.04; }
    this.paint = new Mat(paintOpts);
    const dark = new THREE.MeshStandardMaterial({ color: 0x0a0b0d, metalness: 0.6, roughness: 0.45, envMapIntensity: 0.9, side: THREE.DoubleSide });
    const glassOpts = { color: 0x03060a, metalness: 0.55, roughness: 0.05, envMapIntensity: 2.4 };
    if (physical) { glassOpts.clearcoat = 1; glassOpts.clearcoatRoughness = 0.02; }
    const glass = new Mat(glassOpts);

    // ---- 車身 + 座艙 ----
    const bodyMeshes = [];
    if (spec.kind === 'truck') {
      const bm = new THREE.Mesh(buildTruckBody(), this.paint); bm.castShadow = shadow; this.body.add(bm); bodyMeshes.push(bm);
      const cab = new THREE.Mesh(buildTruckCab(), glass); cab.castShadow = shadow; this.body.add(cab);
    } else {
      for (const part of spec.parts) { const bm = new THREE.Mesh(buildBody(L, spec, part), this.paint); bm.castShadow = shadow; this.body.add(bm); bodyMeshes.push(bm); }
      const cab = new THREE.Mesh(buildCabin(L, spec.cab), glass); cab.castShadow = shadow; this.body.add(cab);
    }
    this.body.updateMatrixWorld(true);
    // 光線投射用：把各段車身合成一個網格
    const bodyMesh = bodyMeshes[0];
    const ribbonHost = bodyMeshes.length === 1 ? bodyMesh : null;
    const hostFor = (dir) => (ribbonHost || (dir > 0 ? bodyMeshes[0] : bodyMeshes[bodyMeshes.length - 1]));

    // 後視鏡（流線小橢球 + 支臂）；Cybercab 沒有後視鏡
    if (spec.mirror) {
      const [mx, my, mz] = spec.mirror;
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, L.sphere, Math.max(6, L.sphere - 4)), this.paint);
        m.scale.set(0.05, 0.04, 0.10); m.position.set(s * mx, my, mz); m.rotation.y = s * 0.12; m.userData.bake = 'paint'; this.body.add(m);
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.2, 6), dark);
        st.rotation.z = Math.PI / 2 - s * 0.25; st.position.set(s * (mx - 0.10), my - 0.04, mz + 0.02); st.userData.bake = 'dark'; this.body.add(st);
      }
    }
    if (spec.mirrorBox) {
      const [mx, my, mz] = spec.mirrorBox;
      for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.2), dark); m.position.set(s * mx, my, mz); m.userData.bake = 'dark'; this.body.add(m); }
    }
    for (const b of spec.boxes || []) { const m = new THREE.Mesh(new THREE.BoxGeometry(...b.s), dark); m.position.set(...b.p); m.userData.bake = 'dark'; this.body.add(m); }

    // ---- 發光燈條（細長水平 LED，貼合車身曲面）----
    const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.6, 2.8), toneMapped: false, side: THREE.DoubleSide });
    const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.15, 0.1), toneMapped: false, side: THREE.DoubleSide });
    this.tailMat = tail;
    this.headMat = head;
    {
      const [hargs, hdir, hmirror] = spec.head;
      const hl = surfaceRibbon(hostFor(hdir), line(...hargs), hdir, head);
      hl.userData.bake = 'head'; this.body.add(hl);
      if (hmirror) { const hr = hl.clone(); hr.scale.x = -1; hr.userData.bake = 'head'; this.body.add(hr); }   // 算一側後鏡射，確保左右對稱
    }
    {
      const [xa, xb, ty, tw, curveUp] = spec.tail, half = Math.abs(xb);
      const pts = line(xa, ty, xb, ty, tw, tw, 30).map(([x, y, w]) => [x, y + curveUp * Math.pow(Math.abs(x) / half, 2), w]);
      const t = surfaceRibbon(hostFor(-1), pts, -1, tail); t.userData.bake = 'tail'; this.body.add(t);
    }
    for (const [xa, ya, xb, yb2, w, n, dir] of spec.darks || []) {
      const d = surfaceRibbon(hostFor(dir), line(xa, ya, xb, yb2, w, w, n), dir, dark); d.userData.bake = 'dark'; this.body.add(d);
    }

    // ---- 擴散器（深色斜板 + 導流鰭，僅 Roadster）----
    if (spec.diffuser) {
      const sh = new THREE.Shape();
      sh.moveTo(1.55, 0.175); sh.lineTo(2.27, 0.30); sh.lineTo(2.27, 0.325); sh.lineTo(1.55, 0.20); sh.closePath();
      const ramp = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 1.5, bevelEnabled: false }), dark);
      ramp.rotation.y = -Math.PI / 2; ramp.position.set(0.75, 0, 0); ramp.userData.bake = 'dark'; this.body.add(ramp);
      const fin = new THREE.Shape();
      fin.moveTo(1.62, 0.20); fin.lineTo(2.30, 0.30); fin.lineTo(2.30, 0.20); fin.closePath();
      const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.018, bevelEnabled: false });
      for (const x of [-0.5, -0.25, 0, 0.25, 0.5]) {
        const f = new THREE.Mesh(finGeo, dark); f.rotation.y = -Math.PI / 2; f.position.set(x + 0.009, -0.006, 0); f.userData.bake = 'dark'; this.body.add(f);
      }
    }

    // ---- 推進噴口 ----
    this.flames = [];
    this.lifts = [];
    const glowTex = glowTexture();
    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.95, roughness: 0.28, envMapIntensity: 1.3, side: THREE.DoubleSide });
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.12, 0.2), toneMapped: false });    // 喉部發光
    this.liftRingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.12, 0.2), toneMapped: false });
    const flameGeo = new THREE.ConeGeometry(0.17, 1, 12, 1, true); flameGeo.translate(0, 0.5, 0); // 底（寬）在原點，尖端朝 +y
    const mkFlame = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const mkGlow = () => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0.12, 0.4, 1.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    const bellSeg = physical ? 20 : 12;
    // 後方主噴口（大）與外側小噴口（冷氣推進器）
    for (const nz of spec.rear) for (const s of [-1, 1]) {
      const x = s * nz.x, z0 = spec.zTail;
      const bell = new THREE.Mesh(bellGeometry(nz.r * 0.5, nz.r, 0.2 * (nz.r / 0.145 * 0.5 + 0.5), bellSeg), nozzleMat);
      bell.rotation.x = Math.PI / 2; bell.userData.bake = 'nozzle';
      const grp = new THREE.Group();            // 以群組繞噴口自身旋轉（外側噴口略向外）
      grp.position.set(x, nz.y, z0); grp.rotation.y = s * nz.ry; grp.add(bell);
      const throat = new THREE.Mesh(new THREE.CircleGeometry(nz.r * 0.62, bellSeg), this.ringMat);
      throat.position.set(0, 0, 0.012); throat.userData.bake = 'throat'; grp.add(throat);
      const f = new THREE.Mesh(flameGeo, mkFlame(new THREE.Color(0.12, 0.5, 1.5)));
      f.rotation.x = Math.PI / 2; f.position.set(0, 0, 0.19); f.scale.set(nz.k, 0.001, nz.k); grp.add(f);
      const gs = mkGlow(); gs.position.set(0, 0, 0.34); grp.add(gs);
      this.body.add(grp);
      this.flames.push({ f, gs, k: nz.k });
    }
    // 升力冷氣噴口（四個，位於側裙下緣，向下噴）
    const lr = spec.liftR || 1, yL = spec.yL;
    for (const [x, z] of spec.lifts) {
      const bell = new THREE.Mesh(bellGeometry(0.03 * lr, 0.075 * lr, 0.07, 14), nozzleMat);
      bell.rotation.x = Math.PI; bell.position.set(x, yL, z); bell.userData.bake = 'nozzle'; this.body.add(bell);
      const throat = new THREE.Mesh(new THREE.CircleGeometry(0.05 * lr, 12), this.liftRingMat);
      throat.rotation.x = Math.PI / 2; throat.position.set(x, yL - 0.063, z); throat.userData.bake = 'liftthroat'; this.body.add(throat);
      const f = new THREE.Mesh(flameGeo, mkFlame(new THREE.Color(0.15, 0.55, 1.5)));
      f.rotation.x = Math.PI; f.position.set(x, yL - 0.065, z); f.scale.set(lr, 0.001, lr); this.body.add(f);
      const gs = mkGlow(); gs.position.set(x, yL - 0.125, z); gs.scale.set(0.01, 0.01, 1); this.body.add(gs);
      this.lifts.push({ f, gs, k: lr });
    }

    // ---- 車輪（空力輪圈 + 低扁平比輪胎），含車輪拱內襯 ----
    this.wheels = [];
    const R = spec.R, tireSeg = spec.vc ? Math.round(L.tire * (spec.kind === 'semi' ? 0.55 : 0.75)) : L.tire;
    const wSeg = spec.kind === 'semi' ? Math.round(L.wheelSeg * 0.6) : L.wheelSeg, wRings = spec.kind === 'semi' ? Math.min(2, L.rings) : L.rings;
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x131315, roughness: 0.88, metalness: 0 });
    const faceMat = new THREE.MeshStandardMaterial({ map: aeroWheelTexture(), roughness: 0.32, metalness: 0.75, envMapIntensity: 1.2, side: THREE.DoubleSide });
    const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.4, envMapIntensity: 1.0 });
    const I = new THREE.Matrix4();
    const archAt = spec.archX != null;
    for (const wd of spec.wheels) {
      const tireGeo = tireGeometry(wd.w, tireSeg, R);
      const faceR = R - 0.086;
      const faces = [
        { geometry: discGeometry(faceR, wSeg, wRings, 0.04, wd.w / 2 - 0.018, true), matrix: I, color: 0x70747c },
        { geometry: discGeometry(faceR, wSeg, wRings, 0.04, -(wd.w / 2 - 0.018), false), matrix: I, color: 0x70747c },
      ];
      const faceGeo = spec.vc ? null : mergeItems(faces);
      const vcGeo = spec.vc ? mergeItems([{ geometry: tireGeo, matrix: I, color: 0x131315 }, ...faces]) : null;
      for (const sx of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * wd.x, R, wd.z);
        const spin = new THREE.Group();
        if (spec.vc) { const m = new THREE.Mesh(vcGeo, vcMat); m.castShadow = shadow; spin.add(m); }
        else {
          const tire = new THREE.Mesh(tireGeo, tireMat); tire.castShadow = shadow; spin.add(tire);
          spin.add(new THREE.Mesh(faceGeo, faceMat));
        }
        spin.rotation.z = Math.PI / 2;
        pivot.add(spin);
        this.root.add(pivot);
        this.wheels.push({ pivot, mesh: spin, front: wd.front, side: sx });
        if (archAt) {
          // 拱內襯（深色半筒 + 內壁），固定在車身上
          const AR = spec.archR, AX = spec.archX, lw = Math.max(0.12, wd.x + wd.w / 2 - 0.05 - AX);
          const liner = new THREE.Mesh(new THREE.CylinderGeometry(AR * 0.992, AR * 0.992, lw, L.arch, 1, true, 0, Math.PI * 2), dark);
          liner.rotation.z = Math.PI / 2; liner.position.set(sx * (AX + lw / 2), R, wd.z);
          liner.userData.bake = 'dark'; this.body.add(liner);
          const wall = new THREE.Mesh(new THREE.CircleGeometry(AR, L.arch), dark);
          wall.rotation.y = sx * Math.PI / 2; wall.position.set(sx * (AX - 0.005), R, wd.z);
          wall.userData.bake = 'dark'; this.body.add(wall);
        } else if (spec.kind === 'truck') {
          const dec = new THREE.Mesh(archDecal(spec.archR), dark);
          dec.rotation.y = sx * Math.PI / 2; dec.position.set(sx * 1.003, 0.45, wd.z); dec.userData.bake = 'dark'; this.body.add(dec);
        }
      }
    }

    // ---- 合併靜態零件（降低繪製呼叫）----
    this.root.updateMatrixWorld(true);
    const groups = {};
    this.root.traverse((o) => { if (o.userData.bake) (groups[o.userData.bake] = groups[o.userData.bake] || []).push(o); });
    const mats = { paint: this.paint, dark, nozzle: nozzleMat, throat: this.ringMat, liftthroat: this.liftRingMat, head, tail };
    for (const [k, list] of Object.entries(groups)) {
      const merged = new THREE.Mesh(mergeItems(list.map((m) => ({ geometry: m.geometry, matrix: m.matrixWorld }))), mats[k]);
      merged.frustumCulled = false; merged.castShadow = false;
      for (const m of list) m.removeFromParent();
      this.body.add(merged);
    }

    // 假接地陰影（低畫質或陰影貼圖不足時的補強）
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.blob[0], spec.blob[1]), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: shadow ? 0.45 : 0.85, fog: false }));
    blob.rotation.x = -Math.PI / 2; blob.renderOrder = 2;
    this.blob = blob;
    this.spin = 0;
    this.susp = { y: 0, vy: 0 };
    this.shake = 0;
    this.triangles = countTriangles(this.root);
  }

  _paintDef(p) {
    if (typeof p === 'string') return this.paints.find((x) => x.key === p) || this.paints[0];
    return this.paints[clamp(p | 0, 0, this.paints.length - 1)];
  }
  setPaint(p) {
    const d = this._paintDef(p);
    this.paintKey = d.key;
    this.paint.color.setHex(d.color); this.paint.metalness = d.metalness; this.paint.roughness = d.roughness;
  }
  dispose() {
    const mats = new Set(), geos = new Set();
    for (const root of [this.root, this.blob]) root.traverse((o) => { if (o.geometry) geos.add(o.geometry); if (o.material) mats.add(o.material); });
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
  }

  // 沿車身 +z 為車尾；root 的 -z 為前進方向
  update(dt, st) {
    // 懸吊彈簧（落地衝擊會踢一下）
    const s = this.susp;
    const m = this.vehicle.mass / 1900;        // 重車的懸吊較硬、晃動較小
    if (st.impact > 0) s.vy -= Math.min(st.impact, 25) * 0.22 / Math.sqrt(m);
    const k = 220, c = 17;
    s.vy += (-k * s.y - c * s.vy) * dt;
    s.y += s.vy * dt;
    s.y = clamp(s.y, -0.11, 0.10);
    this.body.position.y = s.y;
    const squat = clamp(-st.accel * 0.0035, -0.05, 0.05);
    this.body.rotation.x = squat + s.y * 0.3;
    // 車身向外側傾：右轉（latAccel>0，向右加速）時車身向左傾＝右側抬高＝繞 +z 正向旋轉
    this.body.rotation.z = clamp(st.latAccel * 0.0028 / Math.sqrt(m), -0.07, 0.07);
    // 輪子滾動與轉向
    const R = this.R;
    this.spin += (st.speedF / R) * dt;
    for (const w of this.wheels) {
      w.mesh.rotation.set(-this.spin, 0, Math.PI / 2);
      w.pivot.rotation.y = w.front ? -st.steerAngle * 0.9 : 0;
      w.pivot.position.y = R + (st.grounded ? 0 : -0.04);
    }
    // 噴口火焰與發光
    const main = st.thrust;     // 0..1 主推進
    const lift = st.lift;       // 0..1 升力
    const flick = 0.9 + Math.random() * 0.2, fx = this.fx;
    for (const { f, gs, k: kk } of this.flames) {
      const Lf = main * (1.2 + (st.nitro ? 1.8 : 0)) * flick * (0.55 + 0.45 * kk) * fx;
      f.scale.set(kk * fx, Math.max(Lf, 0.001), kk * fx); f.visible = Lf > 0.02;
      const gsz = (st.nitro ? main * 2.6 : (main > 0.5 ? main * 1.1 : main * 0.2)) * flick * kk * Math.sqrt(fx);
      gs.scale.set(gsz, gsz, 1); gs.visible = gsz > 0.12;
    }
    for (const { f, gs, k: kk } of this.lifts) {
      const Lf = lift * 1.5 * flick * kk;
      f.scale.set(kk, Math.max(Lf, 0.001), kk); f.visible = Lf > 0.02;
      const gsz = lift * 1.5 * flick * kk;
      gs.scale.set(gsz, gsz, 1); gs.visible = gsz > 0.02;
    }
    const mg = clamp(main * (st.nitro ? 1.6 : 1), 0, 1.6), lg = clamp(lift, 0, 1);
    this.ringMat.color.setRGB(0.05 + mg * 0.9 * flick, 0.12 + mg * 2.2 * flick, 0.2 + mg * 3.6 * flick);
    this.liftRingMat.color.setRGB(0.05 + lg * 0.9 * flick, 0.12 + lg * 2.2 * flick, 0.2 + lg * 3.6 * flick);
    this.tailMat.color.setRGB(st.braking ? 6 : 3, st.braking ? 0.3 : 0.15, 0.1);
  }
}
