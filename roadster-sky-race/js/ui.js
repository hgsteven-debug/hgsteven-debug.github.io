// 選單、設定、按鍵對應畫面與觸控按鍵
import { ACTIONS, DEFAULT_BINDINGS, bindingText, buttonNames, hintsFor, PROFILES } from './input.js';
import { paintsOf } from './car.js';
import { VEHICLES, DEFAULT_VEHICLE, vehicleById, statsOf, STAT_LABELS } from './vehicles.js';
import { store } from './util.js';

const $ = (id) => document.getElementById(id);

export function shortPadName(id) {
  if (!id) return '';
  const m = id.match(/^(.*?)\s*\(/);
  let n = (m ? m[1] : id).trim();
  if (n.length > 34) n = n.slice(0, 34) + '…';
  return n || id;
}

export class UI {
  constructor(input, handlers) {
    this.input = input; this.h = handlers;
    this.screens = { loading: $('s-loading'), start: $('s-start'), pause: $('s-pause'), settings: $('s-settings'), mapping: $('s-mapping'), garage: $('s-garage') };
    this.current = 'loading';
    this.stack = [];           // 返回用
    this.focusEl = null;
    this.learningRow = null;
    this.vehicleId = vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).id;
    this.touchMode = store.get('touch', 'auto');
    this.mapRows = {};
    this.buildMapping();
    this.buildGarage();
    this.wire();
    this.syncSettings();
  }

  show(name, push = false) {
    if (push) this.stack.push(this.current);
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('show', k === name);
    this.current = name;
    if (name === 'mapping') this.refreshMapping();
    if (name === 'settings') this.syncSettings();
    if (name === 'garage') this.refreshGarage();
    this.setFocus(this.firstFocus());
  }
  hideAll() {
    for (const el of Object.values(this.screens)) el.classList.remove('show');
    this.current = null; this.stack = [];
    this.setFocus(null);
  }
  back() {
    if (this.input.learning) { this.cancelLearn(); return; }
    const prev = this.stack.pop();
    if (prev) this.show(prev); else if (this.h.onBackTop) this.h.onBackTop();
  }
  get active() { return this.current != null; }

  // ---------- 焦點導航（搖桿 / 鍵盤）----------
  focusables() {
    const root = this.screens[this.current];
    if (!root) return [];
    return Array.from(root.querySelectorAll('.btn')).filter((b) => b.offsetParent !== null && !b.closest('.hidden') && !(b.closest('#learn') && $('learn').classList.contains('hidden')));
  }
  firstFocus() {
    const f = this.focusables();
    if (this.current === 'mapping') return f[0] || null;
    if (this.current === 'garage') return f.find((b) => b.dataset.veh === this.vehicleId) || f[0] || null;
    return f.find((b) => b.classList.contains('primary')) || f[0] || null;
  }
  setFocus(el) {
    if (this.focusEl) this.focusEl.classList.remove('focus');
    this.focusEl = el;
    if (el) { el.classList.add('focus'); el.scrollIntoView({ block: 'nearest' }); }
  }
  move(dir) {
    const list = this.focusables();
    if (!list.length) return;
    if (!this.focusEl || !list.includes(this.focusEl)) { this.setFocus(list[0]); return; }
    const r0 = this.focusEl.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = null, bs = 1e12;
    for (const el of list) {
      if (el === this.focusEl) continue;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4;
      if (!ok) continue;
      const primary = dir === 'up' || dir === 'down' ? Math.abs(dy) : Math.abs(dx);
      const sec = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      const s = primary + sec * 2.2;
      if (s < bs) { bs = s; best = el; }
    }
    if (best) this.setFocus(best);
  }
  handleNav(nav) {
    if (!this.active || this.input.learning) return;
    for (const d of ['up', 'down', 'left', 'right']) if (nav[d]) this.move(d);
    if (nav.confirm && this.focusEl) this.focusEl.click();
    if (nav.back) this.back();
  }

  // ---------- 事件 ----------
  wire() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('.btn,[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (b.dataset.inv != null) { this.input.setInvertSteer(b.dataset.inv === '1'); this.syncSettings(); return; }
      if (b.dataset.pm) { this.input.setPadMode(b.dataset.pm); this.syncSettings(); return; }
      if (b.dataset.veh) { this.selectVehicle(b.dataset.veh); return; }
      if (b.dataset.paintk) { this.setPaint(b.dataset.paintk); return; }
      if (b.dataset.q) { this.h.onQuality(b.dataset.q); return; }
      if (b.dataset.v != null) { this.h.onVolume(parseFloat(b.dataset.v)); this.syncSettings(); return; }
      if (b.dataset.r != null) { this.input.setRumbleEnabled(b.dataset.r === '1'); if (b.dataset.r === '1') this.input.rumble(0.6, 0.6, 250, true); this.syncSettings(); return; }
      if (b.dataset.tc) { this.touchMode = b.dataset.tc; store.set('touch', b.dataset.tc); this.h.onTouchMode(); this.syncSettings(); return; }
      if (b.dataset.row) { this.startLearn(b.dataset.row); return; }
      switch (act) {
        case 'start': this.h.onStart(); break;
        case 'resume': this.h.onResume(); break;
        case 'restart': this.h.onRestart(); break;
        case 'quit': this.h.onQuit(); break;
        case 'mapping': this.show('mapping', true); break;
        case 'settings': this.show('settings', true); break;
        case 'garage': this.show('garage', true); break;
        case 'fullscreen': this.h.onFullscreen(); break;
        case 'back': this.back(); break;
        case 'calibrate': this.input.calibrate(); this.updateCalState(); break;
        case 'mapReset': this.input.resetBindings(); this.refreshMapping(); break;
        case 'learnCancel': this.cancelLearn(); break;
        default: break;
      }
    });
    $('btnFull').addEventListener('click', () => this.h.onFullscreen());
    // 觸控按鍵（Pointer Events，支援多點）
    for (const b of document.querySelectorAll('[data-t]')) {
      const k = b.dataset.t;
      const on = (v) => (e) => { e.preventDefault(); this.input.touch[k] = v; b.classList.toggle('on', v); if (v) try { b.setPointerCapture(e.pointerId); } catch (_) { /* */ } };
      b.addEventListener('pointerdown', on(true));
      b.addEventListener('pointerup', on(false)); b.addEventListener('pointercancel', on(false)); b.addEventListener('lostpointercapture', on(false));
    }
    for (const b of document.querySelectorAll('[data-p]')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.h.onTouchPress(b.dataset.p); });
    }
  }

  // ---------- 設定 ----------
  // ---------- 選擇車輛 ----------
  buildGarage() {
    const host = $('vlist'); host.innerHTML = '';
    for (const v of VEHICLES) {
      const b = document.createElement('button');
      b.className = 'btn vbtn'; b.dataset.veh = v.id;
      b.innerHTML = `<b>${v.name}</b><small>${v.tag}</small>`;
      host.appendChild(b);
    }
  }
  get vehicle() { return vehicleById(this.vehicleId); }
  selectVehicle(id) {
    this.vehicleId = vehicleById(id).id;
    const car = this.h.onVehicle(this.vehicleId);
    this.paintKey = car.paintKey;
    this.refreshGarage();
    this.setFocus(document.querySelector(`#vlist [data-veh="${this.vehicleId}"]`));
  }
  setPaint(key) { const car = this.h.onVehicle(this.vehicleId, key); this.paintKey = car.paintKey; this.refreshGarage(); }
  refreshGarage() {
    const v = this.vehicle, car = this.h.getCar && this.h.getCar();
    for (const b of document.querySelectorAll('#vlist [data-veh]')) b.classList.toggle('sel', b.dataset.veh === v.id);
    $('vname').textContent = v.name; $('vtag').textContent = `${v.tag}・約 ${(v.mass / 1000).toFixed(1)} 噸`;
    $('vdesc').textContent = v.desc;
    const st = statsOf(v);
    $('vstats').innerHTML = STAT_LABELS.map(([k, l]) => `<div class="vstat ${k === 'tough' ? 'tough' : ''}"><span>${l}</span><span class="bar"><i style="width:${Math.round(st[k] * 100)}%"></i></span></div>`).join('');
    const pk = car ? car.paintKey : this.paintKey;
    $('vpaints').innerHTML = paintsOf(v.id).map((p) => `<button class="btn paintbtn${p.key === pk ? ' sel' : ''}" data-paintk="${p.key}"><i class="dot" style="background:${p.css}"></i>${p.name}</button>`).join('');
    const sc = $('startCar'); if (sc) { const pd = paintsOf(v.id).find((p) => p.key === pk); sc.textContent = `目前車輛：${v.name}（${v.tag}）・${pd ? pd.name : ''}`; }
  }

  syncSettings() {
    const q = this.h.getQuality();
    for (const b of document.querySelectorAll('[data-inv]')) b.classList.toggle('sel', (b.dataset.inv === '1') === this.input.invertSteer);
    for (const b of document.querySelectorAll('[data-pm]')) b.classList.toggle('sel', b.dataset.pm === this.input.padMode);
    for (const b of document.querySelectorAll('[data-q]')) b.classList.toggle('sel', b.dataset.q === q);
    const vol = this.h.getVolume();
    for (const b of document.querySelectorAll('[data-v]')) b.classList.toggle('sel', Math.abs(parseFloat(b.dataset.v) - vol) < 0.01);
    for (const b of document.querySelectorAll('[data-r]')) b.classList.toggle('sel', (b.dataset.r === '1') === this.input.rumbleEnabled);
    for (const b of document.querySelectorAll('[data-tc]')) b.classList.toggle('sel', b.dataset.tc === this.touchMode);
    this.refreshGarage();
    $('qinfo').textContent = '低：不使用陰影、解析度 62%，適合效能較弱的車機；中：預設；高：2048 陰影、完整解析度。';
  }

  // ---------- 按鍵設定 ----------
  buildMapping() {
    const host = $('mapRows');
    host.innerHTML = '';
    for (const a of ACTIONS) {
      const row = document.createElement('button');
      row.className = 'btn maprow'; row.dataset.row = a.id;
      row.innerHTML = `<span class="rl">${a.label}</span><span class="bind"></span><span class="meter"><i></i></span>`;
      host.appendChild(row);
      this.mapRows[a.id] = { row, label: row.querySelector('.rl'), bind: row.querySelector('.bind'), bar: row.querySelector('i') };
    }
  }
  refreshMapping() {
    const prof = this.input.profile, p = this.input.padInfo, names = buttonNames(prof, p.mapping);
    for (const a of ACTIONS) { const r = this.mapRows[a.id]; r.bind.textContent = bindingText(this.input.bindings[a.id], names); r.label.textContent = a.labelFor(prof); }
    $('mapPad').textContent = p.connected ? `已連接：${p.id}（映射：${p.mapping || '非標準（原始）'}；使用「${prof.name}」設定檔，${this.input.padMode === 'auto' ? '自動偵測' : '手動指定'}）` : '未偵測到搖桿：請接上搖桿並按任一鍵';
    this.updateCalState();
  }
  updateCalState() {
    const el = $('calState'); if (!el) return;
    const i = this.input;
    const t = !i.pad ? '' : i.calibrating ? '校正中…請放開搖桿，不要碰任何方向。' : `搖桿中心已校正${i.cal.hat.size ? `（已忽略十字鍵 hat 軸 ${[...i.cal.hat].join(', ')}）` : ''}。若搖桿自己漂移，按「校正搖桿」。`;
    if (el.textContent !== t) el.textContent = t;
  }
  // 依目前搖桿設定檔更新按鈕標示（開始畫面圖例 / HUD 提示）
  applyProfile(prof = this.input.profile) {
    for (const b of document.querySelectorAll('#legend [data-k]')) b.textContent = prof[b.dataset.k];
    const h = $('hint'); if (h) h.textContent = hintsFor(prof);
    const modeTxt = { auto: '自動偵測', switch: '手動：Switch 模式', xbox: '手動：X-input 模式' }[this.input.padMode];
    const pp = $('padProfile'); if (pp) pp.textContent = this.input.pad ? `搖桿設定檔：${prof.name}（${modeTxt}；確認＝${prof.ok}、返回＝${prof.back}）` : `未偵測到搖桿：以 ${prof.name} 標示顯示。`;
    this.refreshMapping(); this.syncSettings();
  }
  updateMeters() {
    if (this.current === 'mapping') this.updateCalState();
    if (this.current !== 'mapping') return;
    const s = this.input.state;
    const v = { steer: Math.abs(s.steer), pitch: Math.abs(s.pitch), throttle: s.throttle, brake: s.brake, lift: s.lift ? 1 : 0, nitro: s.nitro ? 1 : 0, camera: this.input._prev.camera ? 1 : 0, reset: this.input._prev.reset ? 1 : 0, pause: this.input._prev.pause ? 1 : 0 };
    for (const a of ACTIONS) this.mapRows[a.id].bar.style.width = Math.round(clamp01(v[a.id] || 0) * 100) + '%';
  }
  startLearn(id) {
    const a = ACTIONS.find((x) => x.id === id);
    if (!this.input.pad) { $('learn').classList.remove('hidden'); $('learnTxt').textContent = '尚未偵測到搖桿'; $('learnSub').textContent = '請先接上搖桿並按任一鍵，再重試。'; this.learningRow = null; setTimeout(() => this.cancelLearn(), 1800); return; }
    this.learningRow = id;
    $('learn').classList.remove('hidden');
    $('learnTxt').textContent = a.label;
    $('learnSub').textContent = a.hint + '（5 秒內未操作會取消）';
    clearTimeout(this._learnTimer);
    this._learnTimer = setTimeout(() => this.cancelLearn(), 5000);
    this.input.startLearn(a.kind, (b) => {
      clearTimeout(this._learnTimer);
      this.input.setBinding(id, b);
      $('learn').classList.add('hidden');
      this.learningRow = null;
      this.refreshMapping();
      this.setFocus(this.mapRows[id].row);
    });
    this.setFocus($('learn').querySelector('.btn'));
  }
  cancelLearn() {
    clearTimeout(this._learnTimer);
    this.input.cancelLearn();
    $('learn').classList.add('hidden');
    if (this.learningRow && this.mapRows[this.learningRow]) this.setFocus(this.mapRows[this.learningRow].row);
    this.learningRow = null;
  }
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
