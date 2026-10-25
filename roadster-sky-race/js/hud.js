// HUD：速度、能量、圈速、小地圖、速度線
import { clamp, smoothstep, fmtTime } from './util.js';
import { t } from './i18n.js';
import { ROAD_HALF } from './track.js';
import { ITEM_KEY } from './items.js';
import { itemSvg, ITEM_ROLL_MS, ITEM_POP_MS, ITEM_HIT_MS } from './itemart.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(track, world) {
    this.tr = track; this.world = world;
    this.el = {
      hud: $('hud'), speed: $('speed'), fill: $('ebarFill'), txt: $('ebarTxt'), state: $('state'),
      lapN: $('lapN'), lapT: $('lapT'), lapLast: $('lapLast'), lapBest: $('lapBest'),
      toast: $('toast'), off: $('offcount'), pad: $('padstate'), cam: $('camlabel'), count: $('count'),
      vig: $('vignette'), fx: $('fx'), mm: $('minimap'), flash: $('flash'),
      pill: $('linkpill'), linkKind: $('linkKind'), linkMs: $('linkMs'), linkHint: $('linkhint'),
      slot: $('itemslot'), glyph: $('itemglyph'), iname: $('itemname'), warn: $('itemwarn'),
      badge: $('itembadge'),
      pop: $('itempop'), popIco: $('itempopIco'), popName: $('itempopName'), popHow: $('itempopHow'),
      hit: $('itemhit'), touchIco: $('touchItemIco'),
    };
    this._last = {};
    this.toastT = 0;
    this.fxCtx = this.el.fx.getContext('2d');
    this.lines = Array.from({ length: 46 }, () => ({ a: Math.random() * 6.283, r: Math.random(), s: 0.6 + Math.random() }));
    this.fxScale = 0.5;
    this.buildMinimap();
    this.resize();
  }
  resize() {
    const gl = document.getElementById('gl');
    const vw = gl && parseFloat(gl.style.width) || innerWidth;
    const vh = gl && parseFloat(gl.style.height) || innerHeight;
    const w = Math.max(2, Math.round(vw * this.fxScale)), h = Math.max(2, Math.round(vh * this.fxScale));
    this.el.fx.width = w; this.el.fx.height = h;
  }
  setText(key, el, v) { if (this._last[key] !== v) { this._last[key] = v; el.textContent = v; } }
  show(v) { this.el.hud.classList.toggle('hidden', !v); }
  setLink(info) {
    const pill = this.el.pill;
    const hint = this.el.linkHint;
    if (!pill) return;
    if (!info || !info.show) {
      pill.classList.add('hidden');
      if (hint) hint.classList.add('hidden');
      return;
    }
    pill.classList.remove('hidden', 'good', 'poor', 'bad');
    pill.classList.add(info.tier || 'poor');
    const kindKey = info.rejoin ? 'link.rejoin' : info.kind === 'turn' ? 'link.turn' : info.kind === 'mqtt' ? 'link.relay' : info.kind === 'direct' ? 'link.direct' : 'link.checking';
    this.setText('linkKind', this.el.linkKind, t(kindKey));
    const ms = info.rtt == null || !Number.isFinite(info.rtt) ? '' : t('link.ms', { n: Math.round(info.rtt) });
    this.setText('linkMs', this.el.linkMs, ms);
    if (hint) {
      if (info.hint) {
        hint.classList.remove('hidden');
        this.setText('linkHint', hint, t('link.iso'));
      } else hint.classList.add('hidden');
    }
  }

  buildMinimap() {
    const tr = this.tr, S = this.el.mm.width, pad = 22;
    const b = tr.bounds, w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    const sc = (S - pad * 2) / Math.max(w, h);
    this.mmScale = sc;
    this.mmOff = { x: pad + ((S - pad * 2) - w * sc) / 2 - b.minX * sc, y: pad + ((S - pad * 2) - h * sc) / 2 - b.minZ * sc };
    const off = document.createElement('canvas'); off.width = off.height = S;
    const g = off.getContext('2d');
    const P = (i) => [tr.px[i % tr.N] * sc + this.mmOff.x, tr.pz[i % tr.N] * sc + this.mmOff.y];
    const ribbon = Math.max(6, Math.round(5 * ((tr.half || 11) / 11)));
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = ribbon + 4;
    g.beginPath(); for (let i = 0; i <= tr.N; i += 4) { const [x, y] = P(i); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    g.strokeStyle = '#cfd6dd'; g.lineWidth = ribbon;
    g.beginPath(); for (let i = 0; i <= tr.N; i += 4) { const [x, y] = P(i); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    if (tr.pads && tr.pads.length) {
      g.strokeStyle = '#3dffb0'; g.lineWidth = Math.max(3, ribbon - 1);
      for (const pad of tr.pads) {
        g.beginPath();
        for (let k = 0; k <= pad.len; k += 2) {
          const [x, y] = P(pad.i0 + k);
          k ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
    }
    // 缺口
    g.strokeStyle = '#ff4a3a'; g.lineWidth = 5;
    for (const gp of tr.gaps) { const glen = tr.gapSpan ? tr.gapSpan(gp) : tr.gapLen; g.beginPath(); for (let k = 0; k <= glen; k++) { const [x, y] = P(gp.g0 + k); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    // 起點
    const [sx, sy] = P(0); g.fillStyle = '#fff'; g.fillRect(sx - 6, sy - 2, 12, 4);
    this.mmBase = off;
    const badge = $('gbadge');
    const grav = this.tr && this.tr.def && +this.tr.def.gravity;
    if (badge) {
      if (grav && grav < 5) {
        badge.classList.remove('hidden');
        badge.textContent = 'g = ' + grav + ' m/s²';
      } else badge.classList.add('hidden');
    }
  }
  drawMinimap(veh, racers) {
    const c = this.el.mm.getContext('2d'), S = this.el.mm.width, sc = this.mmScale;
    c.clearRect(0, 0, S, S);
    c.drawImage(this.mmBase, 0, 0);
    // 能量環
    for (const r of this.world.rings) {
      if (!r.on) continue;
      c.fillStyle = r.air ? '#9cf' : '#27d7ff';
      c.beginPath(); c.arc(r.pos.x * sc + this.mmOff.x, r.pos.z * sc + this.mmOff.y, 3, 0, 7); c.fill();
    }
    if (racers) {
      for (const r of racers) {
        if (!r || !r.veh || r.veh === veh) continue;
        c.fillStyle = r.driver && r.driver.kind === 'local' ? '#7dffb0' : '#d0d4dc';
        c.beginPath();
        c.arc(r.veh.pos.x * sc + this.mmOff.x, r.veh.pos.z * sc + this.mmOff.y, 4, 0, 7);
        c.fill();
      }
    }
    const x = veh.pos.x * sc + this.mmOff.x, y = veh.pos.z * sc + this.mmOff.y;
    c.save(); c.translate(x, y); c.rotate(-veh.heading);
    c.fillStyle = '#ffb02e'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6.5, 7); c.lineTo(0, 3.5); c.lineTo(-6.5, 7); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }

  toast(msg, ms = 1800) {
    this.el.toast.textContent = msg; this.el.toast.classList.add('on'); this.toastT = ms / 1000;
  }
  setOff(sec) {
    const el = this.el.off;
    if (!el) return;
    const show = sec > 0.05;
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const n = Math.max(1, Math.ceil(sec));
    this.setText('offcount', el, t('toast.offcount', { n }));
  }
  flash() { this.el.flash.classList.add('on'); setTimeout(() => this.el.flash.classList.remove('on'), 160); }
  count(t) { this.setText('count', this.el.count, t); }

  update(dt, veh, lap, camLabel, padText, stateLabel) {
    const e = this.el;
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) e.toast.classList.remove('on'); }
    const kmh = Math.round(veh.kmh);
    this.setText('speed', e.speed, String(kmh));
    const raw = Number.isFinite(veh.energy) ? veh.energy : 0;
    const pct = Math.max(0, Math.min(100, Math.round(raw)));
    const energy = t('hud.energy', { n: pct });
    if (this._last.energy !== energy) {
      this._last.pct = pct;
      this._last.energy = energy;
      e.fill.style.width = pct + '%';
      e.fill.classList.toggle('low', pct < 25);
      e.txt.textContent = energy;
    }
    this.setText('state', e.state, stateLabel);
    this.setText('lapN', e.lapN, String(lap.n));
    this.setText('lapT', e.lapT, fmtTime(lap.t));
    this.setText('lapLast', e.lapLast, fmtTime(lap.last));
    this.setText('lapBest', e.lapBest, fmtTime(lap.best));
    this.setText('cam', e.cam, t('hud.cam', { name: camLabel }));
    this.setText('pad', e.pad, padText);
  }

  _paintIcon(el, id) {
    if (!el) return;
    const key = 'ico' + (el.id || '') ;
    const next = id | 0;
    if (this._last[key] === next) return;
    this._last[key] = next;
    el.innerHTML = next ? itemSvg(next) : '';
  }

  setBattle(info) {
    const e = this.el;
    const on = !!(info && info.on);
    if (e.slot) e.slot.classList.toggle('hidden', !on);
    if (e.warn) e.warn.classList.toggle('hidden', !(on && info.aimed));
    if (e.badge) {
      e.badge.classList.toggle('hidden', !on);
      if (on && e.badge.textContent !== t('items.badge')) e.badge.textContent = t('items.badge');
    }
    document.body.classList.toggle('items-on', on);
    if (!on) {
      this._roll = null;
      this._itemShown = 0;
      this._popUntil = 0;
      this._hitUntil = 0;
      if (e.pop) e.pop.classList.add('hidden');
      if (e.hit) e.hit.classList.add('hidden');
      this._paintIcon(e.touchIco, 0);
      return;
    }
    const id = info.item | 0;
    const now = performance.now();
    if (id && this._itemShown !== id) {
      this._itemShown = id;
      this._roll = { until: now + ITEM_ROLL_MS, final: id };
      this._popUntil = now + ITEM_POP_MS;
      this._popFinal = id;
      const howKey = info.how === 'touch' ? 'item.howTouch' : info.how === 'key' ? 'item.howKey' : 'item.howPad';
      if (e.popName) e.popName.textContent = t('item.' + ITEM_KEY[id]);
      if (e.popHow) e.popHow.textContent = t(howKey);
      this._paintIcon(e.popIco, id);
    }
    if (!id) { this._roll = null; this._itemShown = 0; this._popUntil = 0; }
    let show = id;
    let rolling = false;
    if (this._roll && id) {
      if (now < this._roll.until) {
        rolling = true;
        show = 1 + (Math.floor(now / 70) % 6);
      } else {
        show = this._roll.final;
        this._roll = null;
      }
    } else if (id) this._itemShown = id;
    const name = id ? t('item.' + ITEM_KEY[id]) : t('item.empty');
    if (e.slot) {
      e.slot.classList.toggle('roll', rolling);
      e.slot.classList.toggle('armed', !!id && !rolling);
    }
    this._paintIcon(e.glyph, rolling ? show : id);
    if (e.iname) this.setText('itemname', e.iname, rolling ? t('item.roll') : (id ? name : t('item.empty')));
    this._paintIcon(e.touchIco, id);
    if (e.pop) e.pop.classList.toggle('hidden', !(id && this._popUntil && now < this._popUntil));
    if (e.warn && info.aimed) this.setText('itemwarn', e.warn, t('item.warn'));
    const hit = info.hitKind | 0;
    const blocked = !!info.hitBlock;
    if (hit && hit !== this._hitShown) {
      this._hitShown = hit;
      this._hitUntil = now + ITEM_HIT_MS;
      if (e.hit) e.hit.textContent = t(blocked ? 'item.block' : 'item.hit', { name: t('item.' + ITEM_KEY[hit]) });
    }
    if (!hit) { this._hitShown = 0; this._hitUntil = 0; }
    if (e.hit) e.hit.classList.toggle('hidden', !(hit && this._hitUntil && now < this._hitUntil));
  }

  // 速度線與暈邊
  fx(dt, veh, enabled) {
    const sp = veh.speed;
    const k = clamp(smoothstep(38, 105, sp) + (veh.nitroOn ? 0.35 : 0), 0, 1);
    this.el.vig.style.opacity = (k * 0.9).toFixed(2);
    const c = this.fxCtx, w = this.el.fx.width, h = this.el.fx.height;
    c.clearRect(0, 0, w, h);
    if (!enabled || k < 0.12) return;
    const cx = w / 2, cy = h * 0.46, R = Math.hypot(w, h) / 2;
    c.lineCap = 'round';
    for (const l of this.lines) {
      l.r += dt * (0.7 + k * 1.6) * l.s;
      if (l.r > 1) { l.r = 0.15 + Math.random() * 0.2; l.a = Math.random() * 6.283; l.s = 0.6 + Math.random(); }
      const r0 = R * (0.35 + 0.65 * l.r * l.r), r1 = r0 + R * 0.1 * (0.3 + k) * l.r;
      const a = l.a, ca = Math.cos(a), sa = Math.sin(a);
      c.strokeStyle = `rgba(255,255,255,${(0.1 + 0.3 * l.r) * k})`;
      c.lineWidth = 1 + 2 * l.r * this.fxScale * 2;
      c.beginPath(); c.moveTo(cx + ca * r0, cy + sa * r0 * 0.8); c.lineTo(cx + ca * r1, cy + sa * r1 * 0.8); c.stroke();
    }
  }
}
