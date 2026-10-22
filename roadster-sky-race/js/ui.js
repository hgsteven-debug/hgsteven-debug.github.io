// 選單、設定、按鍵對應畫面與觸控按鍵
import { ACTIONS, bindingText, hintsFor, localButtonNames, profileLabel } from './input.js';
import { t, getLocale, setLocale, trackText, vehicleText, paintLabel } from './i18n.js';
import { viewportDeltaToUi } from './sync.js';
import { paintsOf } from './car.js';
import { VEHICLES, DEFAULT_VEHICLE, vehicleById, statsOf } from './vehicles.js';
import { TRACKS, DEFAULT_TRACK, trackById } from './tracks.js';
import { store } from './util.js';

const $ = (id) => document.getElementById(id);

// 元素本地的 +x／+y 在視窗裡指向哪。旋轉在祖先（body）上時也要算進去。
function uiBasis(el) {
  let a = 1, b = 0, c = 0, d = 1;
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    const t = getComputedStyle(node).transform;
    if (!t || t === 'none') continue;
    const m = new DOMMatrix(t);
    const na = m.a * a + m.c * b;
    const nb = m.b * a + m.d * b;
    const nc = m.a * c + m.c * d;
    const nd = m.b * c + m.d * d;
    a = na; b = nb; c = nc; d = nd;
  }
  return { a, b, c, d };
}

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
    this.screens = {
      loading: $('s-loading'), start: $('s-start'), mode: $('s-mode'), lobby: $('s-lobby'),
      pause: $('s-pause'), settings: $('s-settings'), mapping: $('s-mapping'),
      garage: $('s-garage'), tracks: $('s-tracks'), ready: $('s-ready'),
      results: $('s-results'), join: $('s-join'),
    };
    this.current = 'loading';
    this.stack = [];           // 返回用
    this.wizard = false;       // 從標題一路選到開跑
    this.focusEl = null;
    this.learningRow = null;
    this.vehicleId = vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).id;
    this.trackId = trackById(store.get('track', DEFAULT_TRACK)).id;
    this.touchMode = store.get('touch', 'auto');
    this.mapRows = {};
    this.buildMapping();
    this.buildGarage(); this.buildTracks(); this.refreshTracks();
    this.wire();
    this.applyWizard();
    this.syncSettings();
  }

  show(name, push = false) {
    if (name === 'start') { this.wizard = false; this.stack = []; push = false; }
    if (push && this.current) this.stack.push(this.current);
    this.applyWizard();
    for (const [k, el] of Object.entries(this.screens)) if (el) el.classList.toggle('show', k === name);
    this.current = name;
    if (name === 'mapping') this.refreshMapping();
    if (name === 'settings') this.syncSettings();
    if (name === 'garage') this.refreshGarage();
    if (name === 'tracks') this.refreshTracks();
    if (name === 'mode') this.markMode();
    if (name === 'ready') this.refreshReady();
    this.setFocus(this.firstFocus());
  }
  hideAll() {
    for (const el of Object.values(this.screens)) if (el) el.classList.remove('show');
    this.current = null; this.stack = [];
    this.wizard = false;
    this.applyWizard();
    this.setFocus(null);
  }
  applyWizard() {
    document.body.classList.toggle('wizard', !!this.wizard);
    for (const el of document.querySelectorAll('.when-wizard')) el.classList.toggle('hidden', !this.wizard);
    for (const el of document.querySelectorAll('.when-browse')) el.classList.toggle('hidden', !!this.wizard);
  }
  // 換賽道會整頁重載。記下一站，回來仍停在選賽道。
  enterFlow(stage) {
    this.wizard = true;
    const mode = store.get('playmode', 'solo') === 'multi' ? 'multi' : 'solo';
    this.stack = ['start', 'mode'];
    if (mode === 'multi') this.stack.push('lobby');
    if (stage === 'tracks' || stage === 'ready') this.stack.push('garage');
    if (stage === 'ready') this.stack.push('tracks');
    this.show(stage);
  }
  markMode() {
    const mode = store.get('playmode', 'solo') === 'multi' ? 'multi' : 'solo';
    for (const b of document.querySelectorAll('#s-mode [data-mode]')) {
      const on = b.dataset.mode === mode;
      b.classList.toggle('sel', on);
      b.classList.toggle('primary', on);
    }
  }
  advance() {
    const next = { lobby: 'garage', garage: 'tracks', tracks: 'ready' }[this.current];
    if (next) this.show(next, true);
  }
  refreshReady() {
    const mode = store.get('playmode', 'solo') === 'multi' ? 'multi' : 'solo';
    const modeEl = $('readyMode');
    if (modeEl) modeEl.textContent = t(mode === 'multi' ? 'ready.mode.multi' : 'ready.mode.solo');
    const aiEl = $('readyAi');
    if (aiEl) {
      const n = String(store.get('aicount', '0'));
      const diff = store.get('aidiff', 'normal');
      const key = ['easy', 'normal', 'hard'].includes(diff) ? diff : 'normal';
      aiEl.textContent = n === '0' ? t('ready.aiNone') : t('ready.ai', { n, diff: t('diff.' + key) });
    }
    this.refreshGarage();
    this.refreshTracks();
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
    if (this.current === 'garage') {
      if (this.wizard) return f.find((b) => b.dataset.act === 'flow-next') || f[0] || null;
      return f.find((b) => b.dataset.veh === this.vehicleId) || f[0] || null;
    }
    if (this.current === 'tracks') {
      if (this.wizard) return f.find((b) => b.dataset.act === 'flow-next') || f[0] || null;
      return f.find((b) => b.dataset.track === this.trackId) || f[0] || null;
    }
    return f.find((b) => b.classList.contains('primary')) || f[0] || null;
  }
  setFocus(el) {
    // scroll garage / track cards into view when using gamepad
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
      if (b.dataset.track) { this.selectTrack(b.dataset.track); return; }
      if (b.dataset.paintk) { this.setPaint(b.dataset.paintk); return; }
      if (b.dataset.q) { this.h.onQuality(b.dataset.q); return; }
      if (b.dataset.v != null) { this.h.onVolume(parseFloat(b.dataset.v)); this.syncSettings(); return; }
      if (b.dataset.r != null) { this.input.setRumbleEnabled(b.dataset.r === '1'); if (b.dataset.r === '1') this.input.rumble(0.6, 0.6, 250, true); this.syncSettings(); return; }
      if (b.dataset.tc) { this.touchMode = b.dataset.tc; store.set('touch', b.dataset.tc); this.h.onTouchMode(); this.syncSettings(); return; }
      if (b.dataset.ai != null) { store.set('aicount', b.dataset.ai); this.syncSettings(); return; }
      if (b.dataset.diff) { store.set('aidiff', b.dataset.diff); this.syncSettings(); return; }
      if (b.dataset.lang) { setLocale(b.dataset.lang); this.syncSettings(); return; }
      if (b.dataset.row) { this.startLearn(b.dataset.row); return; }
      switch (act) {
        case 'start': this.h.onStart(); break;
        case 'flow-start': this.wizard = true; this.show('mode', true); break;
        case 'mode-solo': store.set('playmode', 'solo'); this.wizard = true; this.show('garage', true); break;
        case 'mode-multi': store.set('playmode', 'multi'); this.wizard = true; this.show('lobby', true); break;
        case 'flow-next': this.advance(); break;
        case 'resume': this.h.onResume(); break;
        case 'restart': this.h.onRestart(); break;
        case 'quit': this.h.onQuit(); break;
        case 'mapping': this.show('mapping', true); break;
        case 'settings': this.show('settings', true); break;
        case 'garage': this.show('garage', true); break;
        case 'tracks': this.show('tracks', true); break;
        case 'fullscreen': this.h.onFullscreen(); break;
        case 'back': this.back(); break;
        case 'join-retry': if (this.h.onJoinRetry) this.h.onJoinRetry(); break;
        case 'join-leave': if (this.h.onJoinLeave) this.h.onJoinLeave(); break;
        case 'calibrate': this.input.calibrate(); this.updateCalState(); break;
        case 'mapReset': this.input.resetBindings(); this.refreshMapping(); break;
        case 'learnCancel': this.cancelLearn(); break;
        default: break;
      }
    });
    $('btnFull').addEventListener('click', () => this.h.onFullscreen());
    this.wirePad();
  }

  // 手指下的那個元素才算數（CSS 轉 90° 之後，用矩形自己算會點到隔壁鍵）。
  padTarget(clientX, clientY) {
    const root = $('touch');
    const under = document.elementFromPoint(clientX, clientY);
    const el = under && under.closest ? under.closest('[data-t],[data-p],#stick') : null;
    if (!el || !root || !root.contains(el)) return null;
    return el;
  }

  // 觸控按鍵（Pointer Events，支援多點）。Android Chrome 會把按住誤判成捲動並送 pointercancel，
  // 那一聲不能放開油門，否則加速鍵一按就沒了。
  // 搖桿的位移要換成畫面上的右／下，不能直接用視窗的 clientX（直向轉正時兩者差 90°）。
  wirePad() {
    const root = $('touch');
    const stick = $('stick');
    if (!root || !stick) return;
    const knob = stick.querySelector('.knob');
    const held = new Map();
    const holds = new Map();
    const setHold = (key, on) => {
      this.input.touch[key] = on;
      const el = root.querySelector(`[data-t="${key}"]`);
      if (el) el.classList.toggle('on', on);
    };
    const place = (e) => {
      const rect = stick.getBoundingClientRect();
      const basis = uiBasis(stick);
      const local = viewportDeltaToUi(
        e.clientX - (rect.left + rect.width / 2),
        e.clientY - (rect.top + rect.height / 2),
        basis.a, basis.b, basis.c, basis.d,
      );
      const w = stick.offsetWidth || rect.width || 1;
      const h = stick.offsetHeight || rect.height || 1;
      const dead = (v) => Math.abs(v) < 0.14 ? 0 : Math.max(-1, Math.min(1, v));
      const steer = dead(local.x / (w * 0.38));
      const pitch = dead(local.y / (h * 0.38));
      this.input.touch.stick = true;
      this.input.touch.steer = steer;
      this.input.touch.pitch = pitch;
      if (knob) knob.style.transform = `translate(-50%, -50%) translate(${steer * 34}%, ${pitch * 34}%)`;
    };
    const releaseStick = () => {
      this.input.touch.stick = false;
      this.input.touch.steer = 0;
      this.input.touch.pitch = 0;
      if (knob) knob.style.transform = 'translate(-50%, -50%)';
    };
    const down = (e) => {
      const el = this.padTarget(e.clientX, e.clientY);
      if (!el) return;
      if (e.cancelable) e.preventDefault();
      if (el.id === 'stick') {
        held.set(e.pointerId, { type: 'stick' });
        try { stick.setPointerCapture(e.pointerId); } catch (_) { /* */ }
        place(e);
        return;
      }
      if (el.dataset.p) {
        if (this.h.onTouchPress) this.h.onTouchPress(el.dataset.p);
        else this.input.noteTouchPress(el.dataset.p);
        el.classList.add('on');
        held.set(e.pointerId, { type: 'press', el });
        return;
      }
      const key = el.dataset.t;
      if (!key) return;
      holds.set(key, (holds.get(key) || 0) + 1);
      setHold(key, true);
      held.set(e.pointerId, { type: 'hold', key });
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* */ }
    };
    const up = (e) => {
      const h = held.get(e.pointerId);
      if (!h) return;
      held.delete(e.pointerId);
      if (h.type === 'press') { h.el.classList.remove('on'); return; }
      if (h.type === 'hold') {
        const n = (holds.get(h.key) || 1) - 1;
        if (n <= 0) { holds.delete(h.key); setHold(h.key, false); }
        else holds.set(h.key, n);
        return;
      }
      if (![...held.values()].some((x) => x.type === 'stick')) releaseStick();
    };
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', (e) => { if (held.get(e.pointerId)?.type === 'stick') place(e); });
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', () => { /* 按住時被當成捲動也不能鬆開 */ });
    root.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  }

  // ---------- 設定 ----------
  // ---------- 選擇車輛 ----------
  buildGarage() {
    const host = $('vlist'); host.innerHTML = '';
    for (const v of VEHICLES) {
      const b = document.createElement('button');
      b.className = 'btn vbtn'; b.dataset.veh = v.id;
      const text = vehicleText(v.id, v.name);
      b.innerHTML = `<b>${text.name}</b><small>${text.tag}</small>`;
      host.appendChild(b);
    }
  }
  buildTracks() {
    const host = $('tlist'); if (!host) return; host.innerHTML = '';
    for (const t of TRACKS) {
      const b = document.createElement('button');
      b.className = 'btn tbtn'; b.dataset.track = t.id;
      const text = trackText(t.id);
      b.innerHTML = `<b>${text.name}</b><small>${text.tag}</small>`;
      host.appendChild(b);
    }
  }
  get track() { return trackById(this.trackId); }
  selectTrack(id) {
    const t = trackById(id);
    if (t.id === this.trackId) { this.refreshTracks(); this.setFocus(document.querySelector(`#tlist [data-track="${t.id}"]`)); return; }
    this.trackId = t.id;
    store.set('track', t.id);
    if (this.h.onTrack) this.h.onTrack(t.id);
    else { location.reload(); }
  }
  refreshTracks() {
    const tr = this.track;
    const text = trackText(tr.id);
    for (const b of document.querySelectorAll('#tlist [data-track]')) b.classList.toggle('sel', b.dataset.track === tr.id);
    if ($('tname')) $('tname').textContent = text.name;
    if ($('ttag')) $('ttag').textContent = text.tag;
    if ($('tdesc')) $('tdesc').textContent = text.desc;
    const best = store.get('best.' + tr.id, store.get('best', null));
    if ($('tbest')) {
      const fmt = (x) => { if (x == null) return null; const m = Math.floor(x / 60), s = (x % 60).toFixed(3); return m + ':' + s.padStart(6, '0'); };
      const shown = fmt(best);
      $('tbest').textContent = shown == null ? t('tracks.bestNone') : t('tracks.best', { time: shown });
    }
    const st = $('startTrack'); if (st) st.textContent = t('start.track', text);
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
    const text = vehicleText(v.id, v.name);
    for (const b of document.querySelectorAll('#vlist [data-veh]')) b.classList.toggle('sel', b.dataset.veh === v.id);
    $('vname').textContent = text.name;
    $('vtag').textContent = t('garage.mass', { tag: text.tag, n: (v.mass / 1000).toFixed(1) });
    $('vdesc').textContent = text.desc;
    const st = statsOf(v);
    $('vstats').innerHTML = ['speed', 'accel', 'handling', 'flight', 'tough'].map((k) => `<div class="vstat ${k === 'tough' ? 'tough' : ''}"><span>${t('stat.' + k)}</span><span class="bar"><i style="width:${Math.round(st[k] * 100)}%"></i></span></div>`).join('');
    const pk = car ? car.paintKey : this.paintKey;
    $('vpaints').innerHTML = paintsOf(v.id).map((p) => `<button class="btn paintbtn${p.key === pk ? ' sel' : ''}" data-paintk="${p.key}"><i class="dot" style="background:${p.css}"></i>${paintLabel(p.key)}</button>`).join('');
    const sc = $('startCar'); if (sc) { const pd = paintsOf(v.id).find((p) => p.key === pk); sc.textContent = t('start.car', { name: text.name, tag: text.tag, paint: pd ? paintLabel(pd.key) : '' }); }
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
    const ac = String(store.get('aicount', '0'));
    for (const b of document.querySelectorAll('[data-ai]')) b.classList.toggle('sel', b.dataset.ai === ac);
    const ad = ['easy', 'normal', 'hard'].includes(store.get('aidiff', 'normal')) ? store.get('aidiff', 'normal') : 'normal';
    for (const b of document.querySelectorAll('[data-diff]')) b.classList.toggle('sel', b.dataset.diff === ad);
    this.refreshReady();
    for (const b of document.querySelectorAll('[data-lang]')) b.classList.toggle('sel', b.dataset.lang === getLocale());
    this.refreshGarage();
    if ($('qinfo')) $('qinfo').textContent = t('set.qinfo');
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
    const prof = this.input.profile, p = this.input.padInfo, names = localButtonNames(prof, p.mapping);
    for (const a of ACTIONS) { const r = this.mapRows[a.id]; if (!r) continue; r.bind.textContent = bindingText(this.input.bindings[a.id], names); r.label.textContent = a.labelFor(prof); }
    $('mapPad').textContent = p.connected ? t('map.connected', { id: p.id, mapping: p.mapping || t('map.raw'), profile: profileLabel(prof), mode: this.input.padMode === 'auto' ? t('map.modeAuto') : t('map.modeManual') }) : t('map.needPad');
    this.updateCalState();
  }
  updateCalState() {
    const el = $('calState'); if (!el) return;
    const i = this.input;
    const hat = i.pad && i.cal.hat.size ? t('map.hat', { axes: [...i.cal.hat].join(', ') }) : '';
    const text = !i.pad ? '' : i.calibrating ? t('map.calibrating') : t('map.calDone', { hat });
    if (el.textContent !== text) el.textContent = text;
  }
  // 依目前搖桿設定檔更新按鈕標示（開始畫面圖例 / HUD 提示）
  applyProfile(prof = this.input.profile) {
    for (const b of document.querySelectorAll('#legend [data-k]')) b.textContent = prof[b.dataset.k];
    const h = $('hint'); if (h) h.textContent = hintsFor(prof);
    const modeTxt = { auto: t('pad.mode.auto'), switch: t('pad.mode.switch'), xbox: t('pad.mode.xbox') }[this.input.padMode];
    const name = profileLabel(prof);
    const pp = $('padProfile'); if (pp) pp.textContent = this.input.pad ? t('pad.profile.on', { name, mode: modeTxt, ok: prof.ok, back: prof.back }) : t('pad.profile.off', { name });
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
    if (!this.input.pad) { $('learn').classList.remove('hidden'); $('learnTxt').textContent = t('map.noPad'); $('learnSub').textContent = t('map.noPadSub'); this.learningRow = null; setTimeout(() => this.cancelLearn(), 1800); return; }
    this.learningRow = id;
    $('learn').classList.remove('hidden');
    $('learnTxt').textContent = a.labelFor(this.input.profile);
    $('learnSub').textContent = (typeof a.hint === 'function' ? a.hint() : a.hint) + t('map.timeout');
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
