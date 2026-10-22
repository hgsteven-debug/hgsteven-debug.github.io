// 賽道定義：控制點、缺口、高度起伏、主題（光線／地形色）
// 控制點為 (x,z) 順時針閉合；缺口比例與高度參數依各主題調整。
export const TRACKS = [
  {
    id: 'canyon', name: '峽谷沙漠', tag: '賽道 1',
    desc: '日間峽谷沙漠環道，有三處飛躍缺口與護欄彎道。',
    theme: 'desert',
    ctrl: [
      [0, 0], [300, 0], [540, -80], [700, -250], [720, -470], [590, -650], [350, -680],
      [190, -560], [40, -470], [-130, -520], [-310, -450], [-420, -290], [-350, -110], [-190, -35],
    ],
    gaps: [0.2, 0.47, 0.76],
    height: { a: 7, b: 4.5, c: 2, pa: 2, pb: 3, pc: 5, oa: 0.6, ob: 2.1 },
  },
  {
    id: 'coast', name: '海岸懸崖', tag: '賽道 2',
    desc: '日落海岸城市懸崖環道：橋樑、隧道與海上飛躍缺口。',
    theme: 'coast',
    ctrl: [
      [0, 80], [280, 40], [520, -60], [680, -220], [740, -420], [660, -620], [420, -740],
      [160, -700], [-40, -560], [-220, -480], [-380, -320], [-420, -120], [-300, 40], [-120, 100],
    ],
    gaps: [0.18, 0.42, 0.68],
    height: { a: 9, b: 5.5, c: 3, pa: 2, pb: 4, pc: 5, oa: 0.4, ob: 1.6 },
    bridges: [0.3, 0.55],   // 橋樑中心比例（視覺標記）
    tunnel: 0.85,           // 隧道中心比例
  },
  {
    id: 'alpine', name: '雪山夜道', tag: '賽道 3',
    desc: '夜間阿爾卑斯山道：髮夾彎、山谷大飛躍與發光能量環。',
    theme: 'alpine',
    ctrl: [
      [0, 0], [180, -40], [320, -180], [360, -380], [280, -560], [80, -640], [-120, -580],
      [-280, -420], [-360, -220], [-300, -40], [-140, 80], [40, 120], [160, 60],
    ],
    gaps: [0.25, 0.55, 0.82],
    height: { a: 14, b: 8, c: 4, pa: 3, pb: 5, pc: 7, oa: 1.1, ob: 0.7 },
  },
  {
    id: 'stunt', name: '迴旋試煉', tag: '賽道 4',
    desc: '傾斜高牆、一段向前翻轉的迴旋，然後是倒吊直道。速度不夠會從倒吊段落下。接著平緩落地，再飛越一排原創停車。黃箭頭與檢查門標出路徑；卡住或衝出賽道約兩秒會回到上一道檢查門。',
    theme: 'stunt',
    ctrl: stadiumCtrl(560, 420),
    gaps: [],
    height: { a: 3.5, b: 2, c: 1, pa: 1, pb: 2, pc: 3, oa: 0.3, ob: 1.1 },
    // 高牆在第一條直道，迴圈與跳躍在對面直道，彎道半徑大約 420 公尺。
    stunts: { wall: [0.02, 0.13], loop: 0.52, loopR: 22 },
  },
];
export const DEFAULT_TRACK = 'canyon';

// 直道加半圓：彎道夠寬，高速用搖桿才不會一直磨護欄。
function stadiumCtrl(straight, radius) {
  const pts = [];
  const push = (x, z) => pts.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
  const seg = 4;
  const arc = 8;
  for (let i = 0; i <= seg; i++) push(-straight / 2 + (straight * i) / seg, -radius);
  for (let k = 1; k <= arc; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / arc;
    push(straight / 2 + radius * Math.cos(a), radius * Math.sin(a));
  }
  for (let i = 1; i <= seg; i++) push(straight / 2 - (straight * i) / seg, radius);
  for (let k = 1; k < arc; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / arc;
    push(-straight / 2 + radius * Math.cos(a), radius * Math.sin(a));
  }
  return pts;
}

export const trackById = (id) => TRACKS.find((t) => t.id === id) || TRACKS[0];

// 各主題的天空／霧／地形／光線參數
export const THEMES = {
  desert: {
    label: '沙漠',
    fog: [0.80, 0.66, 0.52], fogDen: 0.00042,
    sun: [-0.5, 0.52, 0.7], sunCol: 0xffe2bd, sunInt: 3.2,
    hemiSky: 0xbcd2ff, hemiGnd: 0x8a6a48, hemiInt: 0.45,
    horizon: 0x6a5f66,
    sand: [0xd2a96a, 0xb98a52, 0x7a5f4a, 0x4f4039, 0xe0c08a],
    road: [0x8d8a86, 0x5a5048],
    rail: 0xc8ccd0, post: 0x555a60, refl: 0xff7a1a,
    rock: 0x8a6e55,
    skyKind: 'day',
    ring: [0.2, 1.6, 2.4],
  },
  coast: {
    label: '海岸日落',
    fog: [0.92, 0.55, 0.42], fogDen: 0.00038,
    sun: [-0.75, 0.22, 0.35], sunCol: 0xff8a4a, sunInt: 2.6,
    hemiSky: 0xffb088, hemiGnd: 0x3a4a5a, hemiInt: 0.55,
    horizon: 0x4a5568,
    sand: [0xc4a070, 0x6a8aaa, 0x3d5a6e, 0x2a3a48, 0xe8b888],
    road: [0x6a6e74, 0x3a4048],
    rail: 0xb0c0d0, post: 0x4a5560, refl: 0xffaa44,
    rock: 0x5a6a78,
    skyKind: 'sunset',
    ring: [0.3, 1.4, 2.2],
    water: true,
  },
  alpine: {
    label: '雪山夜景',
    fog: [0.18, 0.22, 0.35], fogDen: 0.00055,
    sun: [0.15, 0.55, -0.6], sunCol: 0xaabbff, sunInt: 1.4,
    hemiSky: 0x1a2848, hemiGnd: 0x3a4558, hemiInt: 0.7,
    horizon: 0x2a3040,
    sand: [0xe8eef5, 0xc8d4e0, 0x8a9aaa, 0x5a6878, 0xf0f4f8],
    road: [0x4a5058, 0x2a3038],
    rail: 0xd0d8e0, post: 0x3a4050, refl: 0x66ccff,
    rock: 0xb8c4d0,
    skyKind: 'night',
    ring: [0.4, 1.8, 2.8],
  },
  stunt: {
    label: '迴旋黃昏',
    fog: [0.55, 0.42, 0.48], fogDen: 0.00036,
    sun: [-0.2, 0.28, 0.85], sunCol: 0xffb070, sunInt: 2.4,
    hemiSky: 0xc8b0ff, hemiGnd: 0x4a4038, hemiInt: 0.5,
    horizon: 0x3a3344,
    sand: [0xb7a090, 0x8a7060, 0x5a5048, 0x3a3438, 0xd0b8a4],
    road: [0x6a6670, 0x3a3840],
    rail: 0xd8d0c8, post: 0x4a4450, refl: 0xffcc66,
    rock: 0x7a6a62,
    skyKind: 'sunset',
    ring: [0.35, 1.5, 2.2],
  },
};
