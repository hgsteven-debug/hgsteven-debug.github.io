// 輸入：Gamepad API（主要）、鍵盤、觸控（備用），含按鍵重新對應
import { clamp, damp, store } from './util.js';

// ---- 搖桿設定檔（Profile）----
// Switch Pro（JOWUA Switch 模式）：標準映射下按鈕「位置」與 Xbox 相同（索引 0=下、1=右、2=左、3=上），但標示名稱不同。
export const XBOX_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', '十字上', '十字下', '十字左', '十字右', 'Home'];
export const SWITCH_NAMES = ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '－', '＋', 'L3', 'R3', '十字上', '十字下', '十字左', '十字右', 'Home', '截圖'];
export const SWITCH_RAW_NAMES = ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '－', '＋', 'L3', 'R3', 'Home', '截圖'];
export const STD_NAMES = XBOX_NAMES; // 相容舊名稱

export const PROFILES = {
  switch: { id: 'switch', name: 'Switch Pro', digitalTriggers: true, names: SWITCH_NAMES, thr: 'ZR', brk: 'ZL', lift: 'B', nitro: 'A', cam: 'Y', reset: 'X', pause: '＋', ok: 'A', back: 'B', confirmIdx: 1, backIdx: 0 },
  xbox: { id: 'xbox', name: 'Xbox', digitalTriggers: false, names: XBOX_NAMES, thr: 'RT', brk: 'LT', lift: 'A', nitro: 'B', cam: 'X', reset: 'Y', pause: 'Start', ok: 'A', back: 'B', confirmIdx: 0, backIdx: 1 },
};
PROFILES.generic = { ...PROFILES.xbox, id: 'generic', name: '一般搖桿' };

export const PAD_MODES = [['auto', '自動偵測'], ['switch', 'Switch 模式'], ['xbox', 'X-input（Xbox）模式']];
// 依手動模式決定設定檔：auto 時依裝置 id 偵測
export function resolveProfile(mode, id) {
  if (mode === 'switch') return PROFILES.switch;
  if (mode === 'xbox') return PROFILES.xbox;
  return detectProfile(id);
}

// 依裝置 id 判斷：Xbox / 045e 優先，其次 Pro Controller / Switch / Nintendo / 057e
export function detectProfile(id) {
  const s = String(id || '').toLowerCase();
  if (s.includes('xbox') || s.includes('045e')) return PROFILES.xbox;
  if (s.includes('pro controller') || s.includes('switch') || s.includes('nintendo') || s.includes('057e')) return PROFILES.switch;
  return PROFILES.generic;
}
export function buttonNames(profile, mapping) {
  if (profile.id === 'switch' && mapping !== 'standard') return SWITCH_RAW_NAMES;
  return profile.names;
}
// 目前顯示用的提示文字（沒接搖桿時顯示 Switch 標示）
export function hintsFor(profile) {
  const p = profile || PROFILES.switch;
  return `${p.thr} 加速　${p.brk} 煞車　${p.lift} 起飛推進　${p.nitro} 氮氣　${p.cam} 視角　${p.reset} 回賽道　${p.pause} 暫停`;
}

// 標準映射的預設（索引為標準位置；Xbox 與 Switch Pro 相同位置）
export const DEFAULT_BINDINGS = {
  steer:    { t: 'a', i: 0, m: 'full', inv: false },
  pitch:    { t: 'a', i: 1, m: 'full', inv: true },
  throttle: { t: 'b', i: 7 },
  brake:    { t: 'b', i: 6 },
  lift:     { t: 'b', i: 0 },
  nitro:    { t: 'b', i: 1 },
  camera:   { t: 'b', i: 2 },
  reset:    { t: 'b', i: 3 },
  pause:    { t: 'b', i: 9 },
};

const ACTION_DEFS = [
  { id: 'steer',    label: () => '轉向（左搖桿左右）', kind: 'axis', hint: '請把搖桿「往右」推到底' },
  { id: 'pitch',    label: () => '空中升降（左搖桿上下）', kind: 'axis', hint: '請把搖桿「往上」推到底' },
  { id: 'throttle', label: (p) => `加速（${p.thr}）`, kind: 'any', hint: '請按住要用來加速的鍵或板機' },
  { id: 'brake',    label: (p) => `煞車 / 倒車（${p.brk}）`, kind: 'any', hint: '請按住要用來煞車的鍵或板機' },
  { id: 'lift',     label: (p) => `起飛推進器（${p.lift}）`, kind: 'any', hint: '請按下要用來起飛的按鈕' },
  { id: 'nitro',    label: (p) => `氮氣加速（${p.nitro}）`, kind: 'any', hint: '請按下要用來氮氣的按鈕' },
  { id: 'camera',   label: (p) => `切換視角（${p.cam}）`, kind: 'any', hint: '請按下要用來切換視角的按鈕' },
  { id: 'reset',    label: (p) => `回到賽道（${p.reset}）`, kind: 'any', hint: '請按下要用來回到賽道的按鈕' },
  { id: 'pause',    label: (p) => `暫停選單（${p.pause}）`, kind: 'any', hint: '請按下要用來暫停的按鈕' },
];
// ACTIONS.label 隨目前 profile 變化（ui.js 重新整理畫面時會讀取）
export const ACTIONS = ACTION_DEFS.map((d) => ({ id: d.id, kind: d.kind, hint: d.hint, labelFor: d.label, label: d.label(PROFILES.switch) }));

export function bindingText(b, names = SWITCH_NAMES) {
  if (!b) return '未設定';
  if (b.t === 'b') return `按鈕 ${b.i}${names[b.i] ? `（${names[b.i]}）` : ''}`;
  const mode = { full: '全幅', pos: '正向', neg: '負向', trig: '板機' }[b.m] || '';
  return `軸 ${b.i}（${mode}${b.inv ? '・反向' : ''}）`;
}

const btnValue = (gp, i) => {
  const x = gp && gp.buttons ? gp.buttons[i] : null;
  if (!x) return 0;
  const v = typeof x.value === 'number' && Number.isFinite(x.value) ? x.value : 0;
  return v > 0 ? clamp(v, 0, 1) : x.pressed ? 1 : 0;
};
const dz = (v, d) => {
  const a = Math.abs(v);
  return a < d ? 0 : Math.sign(v) * (a - d) / (1 - d);
};
export const RADIAL_DZ = 0.15;      // 搖桿放射狀死區
const AXIS_LIMIT = 1.05;            // 超過這個絕對值（例如十字鍵 hat 閒置值 1.2857）一律視為無效
const CAL_TIME = 0.3;               // 連線後的校正取樣時間（秒）
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };

// 每位玩家一個 InputManager（padIndex 指定使用哪支搖桿；null = 自動選擇）。
// v1 只有 1 位玩家；雙人分割畫面時可建立第二個 new InputManager({ padIndex: 1 })。
export class InputManager {
  constructor({ padIndex = null } = {}) {
    this.bindings = this.loadBindings();
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, lift: false, nitro: false };
    this.padIndex = padIndex;       // null = 自動選擇
    this.pad = null;                // 目前使用的 Gamepad 物件
    this.padInfo = { connected: false, id: '', mapping: '', index: -1, profile: 'switch' };
    this.padMode = ['auto', 'switch', 'xbox'].includes(store.get('padmode', 'auto')) ? store.get('padmode', 'auto') : 'auto';
    this.profile = this.padMode === 'xbox' ? PROFILES.xbox : PROFILES.switch;
    this.cal = this._newCal();
    this._thr = 0; this._brk = 0;
    this.onProfileChange = () => {};
    this.state = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0 };
    this.pressed = { camera: false, reset: false, pause: false };
    this.nav = { up: false, down: false, left: false, right: false, confirm: false, back: false };
    this._prev = {};
    this._navPrev = {};
    this._navRepeat = {};
    this._kbSteer = 0;
    this.invertSteer = store.get('invertSteer', false) === true;   // 「轉向左右反轉」：套用到所有輸入（搖桿、十字鍵、鍵盤、觸控）
    this._padSteer = 0;
    this.learning = null;
    this.rumbleEnabled = store.get('rumble', true);
    this._lastRumble = 0;
    this.onPadChange = () => {};
    this.anyPadInput = false;
    this.keyPressedQueue = new Set();
    window.addEventListener('gamepadconnected', (e) => { this.refreshPads(); this.onPadChange(true, e.gamepad); });
    window.addEventListener('gamepaddisconnected', (e) => { this.refreshPads(); this.onPadChange(false, e.gamepad); });
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.keyPressedQueue.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); });
  }

  _newCal() { return { done: false, t: 0, n: 0, samples: [], centre: {}, ignore: new Set(), hat: new Set(), still: {}, last: {}, heal: {} }; }
  setInvertSteer(v) { this.invertSteer = !!v; store.set('invertSteer', this.invertSteer); }
  // 手動指定搖桿模式（auto / switch / xbox）；會覆寫自動偵測，存在 localStorage
  setPadMode(m) {
    if (!['auto', 'switch', 'xbox'].includes(m)) return;
    this.padMode = m; store.set('padmode', m);
    const gp = this.pad;
    this.profile = gp ? resolveProfile(m, gp.id) : (m === 'xbox' ? PROFILES.xbox : PROFILES.switch);
    this.padInfo.profile = this.profile.id;
    this._thr = this._brk = 0;
    this.onProfileChange(this.profile, this.padInfo);
  }
  // 重新校正搖桿中心（請放開搖桿）
  calibrate() { this.cal = this._newCal(); this._padSteer = 0; this._thr = this._brk = 0; }
  get calibrating() { return !this.cal.done && !!this.pad; }
  _finishCal() {
    const c = this.cal, gp = this.pad;
    const n = gp ? gp.axes.length : 0;
    for (let i = 0; i < n; i++) {
      const vals = c.samples.map((r) => r[i]).filter((v) => Number.isFinite(v));
      if (!vals.length) { c.ignore.add(i); continue; }
      const m = median(vals);
      if (Math.abs(m) > AXIS_LIMIT) { c.ignore.add(i); c.hat.add(i); continue; }   // hat（十字鍵）閒置值，如 1.2857
      // 連線當下就被推到底的軸視為中心 0（使用者可能正握著搖桿）
      const held = vals.every((v) => Math.abs(v) > 0.6);
      // 取樣期間軸在動：多半是玩家正在推搖桿（瀏覽器常在「第一次動搖桿」時才公開搖桿，
      // 所以首次進入遊戲時校正幾乎都發生在推桿途中）。這時中位數不可信 → 中心先當 0，
      // 不可把軸忽略，否則方向會整局失效（v5 的「第一次進去方向無法控制」bug）。
      const moving = Math.max(...vals) - Math.min(...vals) > 0.08;
      if (held || moving) c.centre[i] = 0;
      else if (Math.abs(m) <= 0.4) c.centre[i] = m;
      else c.ignore.add(i);                                                         // 靜止在非零位置（例如板機軸 -1 或半推著不動）：暫不拿來轉向，回到中央後自動恢復（_healIgnored）
    }
    c.samples = []; c.done = true;
  }
  _calStep(gp, dt) {
    const c = this.cal;
    if (c.done) return;
    c.samples.push(Array.from(gp.axes)); c.t += dt; c.n++;
    if (c.t >= CAL_TIME && c.n >= 6) this._finishCal();
  }
  // 校正後的單軸值（無效軸 = 0）
  calAxis(gp, i) {
    const v = gp.axes[i];
    if (!Number.isFinite(v) || Math.abs(v) > AXIS_LIMIT) return 0;
    if (!this.cal.done) return 0;
    if (this.cal.ignore.has(i) && this.cal.centre[i] === undefined) return 0;
    return clamp(v - (this.cal.centre[i] || 0), -1, 1);
  }
  // 放射狀死區 + 軸對（0,1）（2,3）
  stickComp(gp, i) {
    if (i >= 4) return dz(this.calAxis(gp, i), RADIAL_DZ);
    const base = i & ~1;
    const x = this.calAxis(gp, base), y = this.calAxis(gp, base + 1);
    const m = Math.hypot(x, y);
    if (m < RADIAL_DZ) return 0;
    const k = (Math.min(m, 1) - RADIAL_DZ) / (1 - RADIAL_DZ) / m;
    return clamp((i & 1 ? y : x) * k, -1, 1);
  }
  axisValue(gp, b) {
    switch (b.m) {
      case 'pos': return Math.max(0, this.stickComp(gp, b.i));
      case 'neg': return Math.max(0, -this.stickComp(gp, b.i));
      case 'trig': { const v = gp.axes[b.i]; return Number.isFinite(v) && Math.abs(v) <= AXIS_LIMIT ? clamp((v + 1) / 2, 0, 1) : 0; }
      default: { const v = this.stickComp(gp, b.i); return b.inv ? -v : v; }
    }
  }
  bindingValue(gp, b) {
    if (!gp || !b) return 0;
    return b.t === 'b' ? btnValue(gp, b.i) : this.axisValue(gp, b);
  }
  // 漂移修正：搖桿靜止（連續 >1.2 秒幾乎不動）且離中心很近時，慢慢把中心拉到目前值
  _autoRecentre(gp, dt) {
    const c = this.cal;
    if (!c.done) return;
    for (const i of Object.keys(c.centre)) {
      const v = gp.axes[i];
      if (!Number.isFinite(v) || Math.abs(v) > AXIS_LIMIT) continue;
      const last = c.last[i];
      c.last[i] = v;
      if (last === undefined || Math.abs(v - last) > 0.004) { c.still[i] = 0; continue; }
      c.still[i] = (c.still[i] || 0) + dt;
      if (c.still[i] > 1.2 && Math.abs(v - c.centre[i]) < 0.28 && Math.abs(v - c.centre[i]) > 0.002) c.centre[i] += (v - c.centre[i]) * Math.min(1, dt * 2.5);
    }
  }
  // 被忽略的軸（非 hat）若之後在中央附近穩定靜止 0.4 秒，表示當初只是校正時被推著 → 以目前值為中心恢復使用
  _healIgnored(gp, dt) {
    const c = this.cal;
    if (!c.done || !c.ignore.size) return;
    for (const i of [...c.ignore]) {
      if (c.hat.has(i)) continue;
      const v = gp.axes[i], last = c.heal['l' + i];
      c.heal['l' + i] = v;
      if (!Number.isFinite(v) || Math.abs(v) > 0.2 || last === undefined || Math.abs(v - last) > 0.01) { c.heal[i] = 0; continue; }
      c.heal[i] = (c.heal[i] || 0) + dt;
      if (c.heal[i] >= 0.4) { c.ignore.delete(i); c.centre[i] = v; c.still[i] = 0; c.last[i] = v; }
    }
  }
  // 十字鍵：標準映射用按鈕 12–15；非標準映射用 hat 軸（-1=上、順時針每 2/7 一格；閒置 1.2857）
  dpad(gp) {
    let up = false, down = false, left = false, right = false;
    if (gp.mapping === 'standard') {
      up = !!gp.buttons[12]?.pressed; down = !!gp.buttons[13]?.pressed; left = !!gp.buttons[14]?.pressed; right = !!gp.buttons[15]?.pressed;
    }
    for (const i of this.cal.hat) {
      const v = gp.axes[i];
      if (!Number.isFinite(v) || Math.abs(v) > 1.0001) continue;
      const k = Math.round((v + 1) * 3.5) % 8;     // 0=上 1=右上 2=右 3=右下 4=下 5=左下 6=左 7=左上
      if (k === 7 || k === 0 || k === 1) up = true;
      if (k >= 1 && k <= 3) right = true;
      if (k >= 3 && k <= 5) down = true;
      if (k >= 5 && k <= 7) left = true;
    }
    return { up, down, left, right };
  }

  loadBindings() {
    const saved = store.get('bindings', null);
    const b = {};
    for (const k of Object.keys(DEFAULT_BINDINGS)) b[k] = { ...(saved && saved[k] ? saved[k] : DEFAULT_BINDINGS[k]) };
    return b;
  }
  saveBindings() { store.set('bindings', this.bindings); }
  resetBindings() {
    this.bindings = {};
    for (const k of Object.keys(DEFAULT_BINDINGS)) this.bindings[k] = { ...DEFAULT_BINDINGS[k] };
    store.del('bindings');
  }
  setBinding(id, b) { this.bindings[id] = b; this.saveBindings(); }

  getPads() {
    let list = [];
    try { list = (navigator.getGamepads ? navigator.getGamepads() : []) || []; } catch (e) { list = []; }
    return Array.from(list).filter((g) => g && g.connected !== false);
  }
  refreshPads() {
    const pads = this.getPads();
    let gp = null;
    if (this.padIndex != null) gp = pads.find((g) => g.index === this.padIndex) || null;
    if (!gp) gp = pads.find((g) => g.mapping === 'standard') || pads[0] || null;
    this.pad = gp;
    const profile = gp ? resolveProfile(this.padMode, gp.id) : this.profile;
    const info = gp ? { connected: true, id: gp.id, mapping: gp.mapping, index: gp.index, profile: profile.id } : { connected: false, id: '', mapping: '', index: -1, profile: this.profile.id };
    const p0 = this.padInfo;
    if (info.id !== p0.id || info.connected !== p0.connected || info.mapping !== p0.mapping || info.index !== p0.index) {
      const newPad = gp && (info.id !== p0.id || info.index !== p0.index || info.mapping !== p0.mapping || !p0.connected);
      this.padInfo = info;
      if (gp) { this.profile = profile; this.onProfileChange(profile, info); }
      if (newPad) this.calibrate();   // 新連線的搖桿：重新取樣中心
    }
    if (gp && profile.id !== this.profile.id) { this.profile = profile; this.padInfo.profile = profile.id; this.onProfileChange(profile, this.padInfo); }
    return gp;
  }

  // 學習模式：偵測下一個按鈕 / 軸
  startLearn(kind, cb) {
    const gp = this.refreshPads();
    const base = gp ? Array.from(gp.axes) : [];
    const held = new Set();
    if (gp) gp.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.4) held.add(i); });
    this.learning = { kind, cb, base, held, t: 0, started: performance.now() };
  }
  cancelLearn() { this.learning = null; }
  _learnPoll(gp) {
    const L = this.learning;
    if (!L || !gp) return;
    if (performance.now() - L.started < 350) return; // 避免剛按下的按鍵被誤判
    if (L.kind !== 'axis') {
      for (let i = 0; i < gp.buttons.length; i++) {
        const b = gp.buttons[i];
        const down = b.pressed || b.value > 0.6;
        if (!down) { L.held.delete(i); continue; }
        if (L.held.has(i)) continue; // 開始學習時還按著的鍵（例如剛按的 A）要先放開
        if (down) { const cb = L.cb; this.learning = null; cb({ t: 'b', i }); return; }
      }
    }
    for (let i = 0; i < gp.axes.length; i++) {
      const v = gp.axes[i], base = L.base[i] ?? 0;
      if (!Number.isFinite(v) || !Number.isFinite(base) || Math.abs(v) > AXIS_LIMIT || Math.abs(base) > AXIS_LIMIT) continue;   // hat 閒置值等無效軸
      if (this.cal.hat.has(i)) continue;
      if (Math.abs(v - base) > 0.7) {
        const cb = L.cb; this.learning = null;
        if (L.kind === 'axis') cb({ t: 'a', i, m: 'full', inv: (v - base) < 0 });
        else if (base < -0.9) cb({ t: 'a', i, m: 'trig' });
        else cb({ t: 'a', i, m: v > base ? 'pos' : 'neg' });
        return;
      }
    }
  }

  isKey(...codes) { return codes.some((c) => this.keys.has(c)); }
  consumeKey(code) { const r = this.keyPressedQueue.has(code); this.keyPressedQueue.delete(code); return r; }
  flushKeys() { this.keyPressedQueue.clear(); }

  // 每幀呼叫
  poll(dt) {
    const gp = this.refreshPads();
    this.anyPadInput = false;
    const st = this.state;
    const pr = { camera: false, reset: false, pause: false };
    if (gp) {
      this._learnPoll(gp);
      this._calStep(gp, dt);
      const b = this.bindings, prof = this.profile;
      this._autoRecentre(gp, dt);
      this._healIgnored(gp, dt);
      // 轉向：校正 + 放射死區 + 反應曲線；十字鍵（含 hat）當備用
      const steerRaw = b.steer.t === 'a' ? this.axisValue(gp, b.steer) : this.bindingValue(gp, b.steer);
      const dp = this.dpad(gp);
      const dpadX = (dp.right ? 1 : 0) - (dp.left ? 1 : 0);
      let tgt = clamp(steerRaw + (steerRaw === 0 ? dpadX : 0), -1, 1);
      tgt = Math.sign(tgt) * Math.pow(Math.abs(tgt), 1.5);
      if (this.calibrating) tgt = 0;
      this._padSteer = damp(this._padSteer, tgt, Math.abs(tgt) > Math.abs(this._padSteer) ? 22 : 30, dt);
      if (tgt === 0 && Math.abs(this._padSteer) < 0.002) this._padSteer = 0;
      // 油門 / 煞車：Switch 的 ZR/ZL 是數位按鈕（只有 0 或 1），以斜坡平滑，避免瞬間全油門或全煞車
      const tT = dz(this.bindingValue(gp, b.throttle), 0.04), tB = dz(this.bindingValue(gp, b.brake), 0.04);
      const up = prof.digitalTriggers ? 3.4 : 14, down = prof.digitalTriggers ? 7 : 20;
      const bup = prof.digitalTriggers ? 4.5 : 16, bdown = prof.digitalTriggers ? 9 : 22;
      this._thr += clamp(tT - this._thr, -down * dt, up * dt);
      this._brk += clamp(tB - this._brk, -bdown * dt, bup * dt);
      st.padThrottle = this._thr; st.padBrake = this._brk;
      st.padLift = this.bindingValue(gp, b.lift) > 0.5;
      st.padNitro = this.bindingValue(gp, b.nitro) > 0.5;
      st.padPitch = this.calibrating ? 0 : dz(this.bindingValue(gp, b.pitch), 0.1);
      for (const k of ['camera', 'reset', 'pause']) {
        const down2 = this.bindingValue(gp, b[k]) > 0.5;
        pr[k] = down2 && !this._prev[k];
        this._prev[k] = down2;
      }
      // 選單導航：十字鍵 / 左搖桿（已校正）/ 確認與返回（Switch：A=右、B=下；Xbox：A=下、B=右）
      const sx = this.calibrating ? 0 : this.stickComp(gp, 0), sy = this.calibrating ? 0 : this.stickComp(gp, 1);
      const nav = {
        up: dp.up || sy < -0.6, down: dp.down || sy > 0.6,
        left: dp.left || sx < -0.6, right: dp.right || sx > 0.6,
        confirm: !!gp.buttons[prof.confirmIdx]?.pressed, back: !!gp.buttons[prof.backIdx]?.pressed,
      };
      this._navFrom(nav, dt);
      this.anyPadInput = nav.up || nav.down || nav.left || nav.right || nav.confirm || nav.back || st.padThrottle > 0.1;
    } else {
      this._padSteer = 0; this._thr = this._brk = 0; st.padThrottle = st.padBrake = 0; st.padLift = st.padNitro = false; st.padPitch = 0;
      this._navFrom({}, dt);
    }
    // 鍵盤
    const kl = this.isKey('ArrowLeft', 'KeyA') || this.touch.left, kr = this.isKey('ArrowRight', 'KeyD') || this.touch.right;
    const kt = (kr ? 1 : 0) - (kl ? 1 : 0);
    const rate = kt === 0 ? 9 : 5;
    this._kbSteer += clamp(kt - this._kbSteer, -rate * dt, rate * dt);
    const kThr = this.isKey('ArrowUp', 'KeyW') || this.touch.gas ? 1 : 0;
    const kBrk = this.isKey('ArrowDown', 'KeyS') || this.touch.brake ? 1 : 0;
    st.steer = clamp(this._padSteer + this._kbSteer, -1, 1) * (this.invertSteer ? -1 : 1);
    st.throttle = Math.max(st.padThrottle || 0, kThr);
    st.brake = Math.max(st.padBrake || 0, kBrk);
    st.lift = !!st.padLift || this.isKey('Space') || this.touch.lift;
    st.nitro = !!st.padNitro || this.isKey('ShiftLeft', 'ShiftRight') || this.touch.nitro;
    st.pitch = clamp((st.padPitch || 0) + ((this.isKey('KeyE') ? 1 : 0) - (this.isKey('KeyQ') ? 1 : 0)), -1, 1);
    pr.camera = pr.camera || this.consumeKey('KeyC');
    pr.reset = pr.reset || this.consumeKey('KeyR');
    pr.pause = pr.pause || this.consumeKey('Escape') || this.consumeKey('KeyP');
    if (this.override) Object.assign(st, this.override);
    this.pressed = pr;
    this.keyPressedQueue.clear();
    return st;
  }

  _navFrom(nav, dt) {
    const out = { up: false, down: false, left: false, right: false, confirm: false, back: false };
    const kb = {
      up: this.keyPressedQueue.has('ArrowUp') || this.keyPressedQueue.has('KeyW'), down: this.keyPressedQueue.has('ArrowDown') || this.keyPressedQueue.has('KeyS'),
      left: this.keyPressedQueue.has('ArrowLeft') || this.keyPressedQueue.has('KeyA'), right: this.keyPressedQueue.has('ArrowRight') || this.keyPressedQueue.has('KeyD'),
      confirm: this.keyPressedQueue.has('Enter') || this.keyPressedQueue.has('Space'),
      back: this.keyPressedQueue.has('Escape') || this.keyPressedQueue.has('Backspace'),
    };
    const now = performance.now();
    for (const k of Object.keys(out)) {
      const down = !!nav[k];
      if (down && !this._navPrev[k]) { out[k] = true; this._navRepeat[k] = now + 380; }
      else if (down && ['up', 'down', 'left', 'right'].includes(k) && now > this._navRepeat[k]) { out[k] = true; this._navRepeat[k] = now + 130; }
      this._navPrev[k] = down;
      if (kb[k]) out[k] = true;
    }
    this.nav = out;
  }

  // 震動（雙馬達）；沒有支援就安靜略過
  rumble(strong = 0.5, weak = 0.5, ms = 120, force = false) {
    if (!this.rumbleEnabled && !force) return false;
    const gp = this.pad;
    if (!gp) return false;
    const now = performance.now();
    if (!force && now - this._lastRumble < 70) return false;
    this._lastRumble = now;
    try {
      const act = gp.vibrationActuator;
      if (act && typeof act.playEffect === 'function') {
        act.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: clamp(weak, 0, 1), strongMagnitude: clamp(strong, 0, 1) }).catch(() => {});
        return true;
      }
      const h = gp.hapticActuators && gp.hapticActuators[0];
      if (h && typeof h.pulse === 'function') { h.pulse(clamp(Math.max(strong, weak), 0, 1), ms); return true; }
    } catch (e) { /* 忽略 */ }
    return false;
  }
  setRumbleEnabled(v) { this.rumbleEnabled = v; store.set('rumble', v); }
}
