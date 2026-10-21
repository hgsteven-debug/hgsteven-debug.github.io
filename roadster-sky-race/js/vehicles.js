// 車輛資料：名稱、車漆選項、各車物理調校、屬性條（由調校數值推導）
// 所有造型皆為原創程序生成（見 car.js），這裡的名稱只用於選單標示，模型上沒有任何標誌或文字。
import { clamp } from './util.js';

export const PAINT_DEFS = {
  silver: { name: '銀灰', css: 'linear-gradient(135deg,#d5d9df,#7d838b)', color: 0x858b94, metalness: 0.92, roughness: 0.36 },
  blue:   { name: '午夜藍', css: 'linear-gradient(135deg,#2a56c8,#0a1f5c)', color: 0x0b2468, metalness: 0.72, roughness: 0.28 },
  red:    { name: '烈焰紅', css: 'linear-gradient(135deg,#e5303a,#860b10)', color: 0x9d0d12, metalness: 0.62, roughness: 0.26 },
  white:  { name: '珍珠白', css: 'linear-gradient(135deg,#ffffff,#c9ccd1)', color: 0xe3e5e8, metalness: 0.35, roughness: 0.24 },
  black:  { name: '曜石黑', css: 'linear-gradient(135deg,#3a3d44,#050506)', color: 0x0c0c0f, metalness: 0.55, roughness: 0.24 },
  steel:  { name: '拉絲不鏽鋼', css: 'linear-gradient(135deg,#d8dbe0,#8d9299)', color: 0xa5aab1, metalness: 1.0, roughness: 0.42 },
};
const ALL5 = ['silver', 'blue', 'red', 'white', 'black'];

// 物理調校（單位：m/s、m/s²、g）
//   accel 油門加速度、vTop 近似極速（空氣阻力平衡點）、brake 煞車、grip 側向抓地(g)、steer 轉向靈敏度、maxSteer 前輪最大轉角(rad)、yawResp 偏航響應
//   eCap 能量容量倍率（越大，推進器與氮氣續航越久）、liftA 推進器最大向上加速度、climb 最大爬升速度、hMax 最大懸停高度
//   liftDrain 推進器耗能倍率、nitro 氮氣加速度、nitroDrain 氮氣耗能倍率、airThrust/airSteer 空中推力與轉向
//   tough 堅固度（撞護欄與落地的速度損失 ÷ tough；震動與鏡頭搖晃也變小）、wb 軸距、hw 半軌距（只用於地面取樣）
const T = (o) => o;
export const VEHICLES = [
  {
    id: 'roadster', name: '新 Roadster', tag: '雙座超跑', mass: 1900, paints: ALL5,
    desc: '低矮寬體的雙座超跑，最快、最靈活，推進器飛行表現最好。',
    tune: T({ accel: 15.5, vTop: 70, brake: 31, grip: 1.75, steer: 1.15, maxSteer: 0.55, yawResp: 11, eCap: 1.0, liftA: 32, climb: 11, hMax: 38,
      liftDrain: 1.0, nitro: 11, nitroDrain: 1.0, airThrust: 7, airSteer: 1.15, tough: 1.0, wb: 2.8, hw: 0.86 }),
    cam: { dist: 1, height: 1, cockpit: [1.22, 0.25] },
  },
  {
    id: 'model3', name: 'Model 3', tag: '運動轎車', mass: 1800, paints: ALL5,
    desc: '輕巧均衡的四門轎車，轉向直接，適合入門。',
    tune: T({ accel: 12.6, vTop: 62, brake: 30, grip: 1.7, steer: 1.12, maxSteer: 0.56, yawResp: 11, eCap: 1.0, liftA: 28, climb: 9.5, hMax: 34,
      liftDrain: 1.0, nitro: 10.5, nitroDrain: 1.0, airThrust: 6.5, airSteer: 1.1, tough: 1.05, wb: 2.84, hw: 0.8 }),
    cam: { dist: 1, height: 1, cockpit: [1.2, 0.15] },
  },
  {
    id: 'modely', name: 'Model Y', tag: '緊湊休旅', mass: 1980, paints: ALL5,
    desc: '車身較高的休旅車，穩定、續航佳，略重。',
    tune: T({ accel: 11.8, vTop: 59, brake: 29, grip: 1.6, steer: 1.08, maxSteer: 0.56, yawResp: 10, eCap: 1.05, liftA: 26, climb: 9, hMax: 32,
      liftDrain: 1.08, nitro: 10, nitroDrain: 1.0, airThrust: 6, airSteer: 1.05, tough: 1.15, wb: 2.86, hw: 0.8 }),
    cam: { dist: 1.05, height: 1.12, cockpit: [1.4, 0.2] },
  },
  {
    id: 'models', name: 'Model S', tag: '旗艦轎車', mass: 2150, paints: ALL5,
    desc: '長軸距的旗艦掀背轎車，加速強、極速高，操控偏穩。',
    tune: T({ accel: 14.5, vTop: 67, brake: 30, grip: 1.65, steer: 1.05, maxSteer: 0.54, yawResp: 10, eCap: 1.1, liftA: 27, climb: 9, hMax: 33,
      liftDrain: 1.12, nitro: 11, nitroDrain: 1.0, airThrust: 6.5, airSteer: 1.0, tough: 1.1, wb: 3.0, hw: 0.8 }),
    cam: { dist: 1.05, height: 1.0, cockpit: [1.12, 0.2] },
  },
  {
    id: 'modelx', name: 'Model X', tag: '大型休旅', mass: 2450, paints: ALL5,
    desc: '大型休旅車，車身堅固但偏重，飛行較吃力。（鷹翼門簡化為一般車門）',
    tune: T({ accel: 13.2, vTop: 61, brake: 28, grip: 1.45, steer: 0.98, maxSteer: 0.52, yawResp: 9, eCap: 1.1, liftA: 22, climb: 7.5, hMax: 28,
      liftDrain: 1.35, nitro: 10.5, nitroDrain: 1.05, airThrust: 5.5, airSteer: 0.95, tough: 1.45, wb: 3.04, hw: 0.86 }),
    cam: { dist: 1.12, height: 1.18, cockpit: [1.5, 0.2] },
  },
  {
    id: 'cybertruck', name: 'Cybertruck', tag: '不鏽鋼皮卡', mass: 3100, paints: ['steel'],
    desc: '稜角分明的不鏽鋼皮卡，最耐撞的一般車；很重，起飛吃力、飛得低。',
    tune: T({ accel: 12.8, vTop: 58, brake: 27, grip: 1.4, steer: 0.95, maxSteer: 0.5, yawResp: 8.5, eCap: 1.2, liftA: 20, climb: 6.8, hMax: 24,
      liftDrain: 1.5, nitro: 10.5, nitroDrain: 1.1, airThrust: 5, airSteer: 0.9, tough: 1.9, wb: 3.5, hw: 1.0 }),
    cam: { dist: 1.2, height: 1.3, cockpit: [1.6, 0.1], menu: 17 },
  },
  {
    id: 'semi', name: 'Semi', tag: '電動卡車頭＋短拖車', mass: 11000, paints: ALL5,
    desc: '卡車頭加短拖車：最重、最耐撞、最慢，但能量最多；推進器只能低空短飛。',
    tune: T({ accel: 7.6, vTop: 46, brake: 22, grip: 1.05, steer: 0.72, maxSteer: 0.42, yawResp: 6, eCap: 1.45, liftA: 17, climb: 5.2, hMax: 18,
      liftDrain: 1.9, nitro: 8, nitroDrain: 1.4, airThrust: 3.5, airSteer: 0.65, tough: 2.6, wb: 5.0, hw: 1.1 }),
    cam: { dist: 1.65, height: 1.7, cockpit: [2.9, -2.3], menu: 29 },
  },
  {
    id: 'cybercab', name: 'Cybercab', tag: '雙座無人計程車', mass: 1500, paints: ALL5,
    desc: '小巧圓潤的雙座車（沒有方向盤），轉向最靈活，輕盈好飛，但較不耐撞。',
    tune: T({ accel: 11.0, vTop: 55, brake: 28, grip: 1.55, steer: 1.2, maxSteer: 0.6, yawResp: 12, eCap: 0.95, liftA: 27, climb: 9.5, hMax: 34,
      liftDrain: 0.9, nitro: 10, nitroDrain: 0.95, airThrust: 6.5, airSteer: 1.25, tough: 0.9, wb: 2.3, hw: 0.72 }),
    cam: { dist: 0.9, height: 0.95, cockpit: [1.2, 0.1] },
  },
  {
    id: 'roadster08', name: '2008 Roadster', tag: '經典雙座', mass: 1300, paints: ALL5,
    desc: '初代雙座敞篷風格：輕巧、轉向靈活，極速略低，飛行輕盈。',
    tune: T({ accel: 13.8, vTop: 58, brake: 29, grip: 1.6, steer: 1.22, maxSteer: 0.58, yawResp: 12, eCap: 0.9, liftA: 29, climb: 10, hMax: 36,
      liftDrain: 0.95, nitro: 10.5, nitroDrain: 1.0, airThrust: 6.8, airSteer: 1.2, tough: 0.85, wb: 2.45, hw: 0.74 }),
    cam: { dist: 0.92, height: 0.95, cockpit: [1.15, 0.15] },
  },
  {
    id: 'model3p', name: 'Model 3 Performance', tag: '性能轎車', mass: 1850, paints: ALL5,
    desc: 'Model 3 性能版：尾翼、更硬懸吊與更強加速，彎道抓地更好。',
    tune: T({ accel: 15.2, vTop: 68, brake: 32, grip: 1.85, steer: 1.18, maxSteer: 0.55, yawResp: 12, eCap: 1.0, liftA: 30, climb: 10, hMax: 36,
      liftDrain: 1.0, nitro: 12, nitroDrain: 1.05, airThrust: 7.2, airSteer: 1.15, tough: 1.0, wb: 2.84, hw: 0.82 }),
    cam: { dist: 1, height: 1, cockpit: [1.2, 0.15] },
  },
  {
    id: 'modelyl', name: 'Model Y L', tag: '加長六座休旅', mass: 2300, paints: ALL5,
    desc: '加長六座版 Model Y：車身長、空間大，較重但續航與堅固度提升。',
    tune: T({ accel: 11.0, vTop: 57, brake: 28, grip: 1.5, steer: 1.0, maxSteer: 0.54, yawResp: 9.5, eCap: 1.2, liftA: 24, climb: 8, hMax: 30,
      liftDrain: 1.2, nitro: 9.5, nitroDrain: 1.05, airThrust: 5.5, airSteer: 0.95, tough: 1.3, wb: 3.15, hw: 0.84 }),
    cam: { dist: 1.15, height: 1.2, cockpit: [1.45, 0.25], menu: 16 },
  },
  {
    id: 'modelsplaid', name: 'Model S Plaid', tag: '三馬達旗艦', mass: 2200, paints: ALL5,
    desc: 'Model S 三馬達性能版：加速與極速頂尖，附尾翼。',
    tune: T({ accel: 17.5, vTop: 78, brake: 33, grip: 1.8, steer: 1.1, maxSteer: 0.53, yawResp: 11, eCap: 1.15, liftA: 31, climb: 10.5, hMax: 36,
      liftDrain: 1.1, nitro: 13, nitroDrain: 1.1, airThrust: 8, airSteer: 1.05, tough: 1.15, wb: 3.0, hw: 0.82 }),
    cam: { dist: 1.05, height: 1.0, cockpit: [1.12, 0.2] },
  },
  {
    id: 'modelxplaid', name: 'Model X Plaid', tag: '三馬達休旅', mass: 2500, paints: ALL5,
    desc: 'Model X 三馬達版：休旅身形但加速兇猛，飛行仍偏吃力。',
    tune: T({ accel: 16.2, vTop: 72, brake: 31, grip: 1.6, steer: 1.02, maxSteer: 0.52, yawResp: 10, eCap: 1.15, liftA: 25, climb: 8.5, hMax: 30,
      liftDrain: 1.3, nitro: 12.5, nitroDrain: 1.1, airThrust: 6.5, airSteer: 0.98, tough: 1.5, wb: 3.04, hw: 0.88 }),
    cam: { dist: 1.12, height: 1.18, cockpit: [1.5, 0.2] },
  },
  {
    id: 'cyberbeast', name: 'Cyberbeast', tag: '三馬達皮卡', mass: 3200, paints: ['steel'],
    desc: 'Cybertruck 三馬達「野獸」版：加速更猛、更耐撞，仍飛得低。',
    tune: T({ accel: 15.5, vTop: 64, brake: 29, grip: 1.5, steer: 0.98, maxSteer: 0.5, yawResp: 9, eCap: 1.25, liftA: 22, climb: 7.2, hMax: 26,
      liftDrain: 1.45, nitro: 12, nitroDrain: 1.15, airThrust: 5.8, airSteer: 0.92, tough: 2.2, wb: 3.5, hw: 1.0 }),
    cam: { dist: 1.2, height: 1.3, cockpit: [1.6, 0.1], menu: 17 },
  },
  {
    id: 'robovan', name: 'Robovan', tag: '無人廂型車', mass: 2800, paints: ALL5,
    desc: '低矮修長的無人廂型車：穩定、空間大、續航長，轉向偏鈍。',
    tune: T({ accel: 9.5, vTop: 52, brake: 26, grip: 1.25, steer: 0.85, maxSteer: 0.48, yawResp: 7.5, eCap: 1.35, liftA: 20, climb: 6.5, hMax: 24,
      liftDrain: 1.4, nitro: 8.5, nitroDrain: 1.2, airThrust: 4.5, airSteer: 0.8, tough: 1.7, wb: 3.8, hw: 0.95 }),
    cam: { dist: 1.35, height: 1.35, cockpit: [1.7, 0.4], menu: 20 },
  },
];
export const DEFAULT_VEHICLE = 'roadster';
export const vehicleById = (id) => VEHICLES.find((v) => v.id === id) || VEHICLES[0];

// ---- 補齊調校並推導阻力 ----
export function fullTune(t) {
  const o = { ...t };
  o.vRef = o.vTop * 1.43;                                                        // 推力隨速度線性衰減到 0 的速度
  o.drag = Math.max(1e-5, (o.accel * (1 - o.vTop / o.vRef) - 0.35) / (o.vTop * o.vTop)); // 令 vTop 為推力 = 阻力（含 0.35 滾動阻力）的平衡點
  // 平路全油門加氮氣的平衡速度。下坡與迴圈不得超過這個速度。
  let lo = o.vTop, hi = o.vRef * 1.35;
  for (let i = 0; i < 24; i++) {
    const v = (lo + hi) / 2;
    const a = o.accel * Math.max(0, 1 - v / o.vRef) + o.nitro * Math.max(0, 1 - v / (o.vRef * 1.35)) - o.drag * v * v;
    if (a > 0) lo = v; else hi = v;
  }
  o.vMax = lo;
  return o;
}

// ---- 屬性條（0~1）----
export function statsOf(def) {
  const t = def.tune;
  const speed = clamp((t.vTop * 3.6 - 120) / 140, 0.05, 1);
  const accel = clamp((t.accel - 5) / 12, 0.05, 1);
  const handling = clamp(((t.grip - 0.9) / 0.9) * 0.6 + ((t.steer - 0.6) / 0.65) * 0.4, 0.05, 1);
  const flight = clamp(((t.liftA - 14) / 20) * 0.4 + ((t.climb - 4) / 8) * 0.3 + (clamp((t.eCap / t.liftDrain - 0.5) / 0.7, 0, 1)) * 0.2 + ((t.hMax - 14) / 26) * 0.1, 0.05, 1);
  const tough = clamp((t.tough - 0.8) / 2.0, 0.05, 1);
  return { speed, accel, handling, flight, tough };
}
export const STAT_LABELS = [['speed', '速度'], ['accel', '加速'], ['handling', '操控'], ['flight', '飛行'], ['tough', '堅固']];
