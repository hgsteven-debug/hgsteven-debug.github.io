// HUD：速度、能量、圈速、小地圖、速度線
import { clamp, smoothstep, fmtTime } from './util.js';
import { ROAD_HALF } from './track.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(track, world) {
    this.tr = track; this.world = world;
    this.el = {
      hud: $('hud'), speed: $('speed'), fill: $('ebarFill'), txt: $('ebarTxt'), state: $('state'),
      lapN: $('lapN'), lapT: $('lapT'), lapLast: $('lapLast'), lapBest: $('lapBest'),
      toast: $('toast'), pad: $('padstate'), cam: $('camlabel'), count: $('count'),
      vig: $('vignette'), fx: $('fx'), mm: $('minimap'), flash: $('flash'),
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
    const w = Math.max(2, Math.round(innerWidth * this.fxScale)), h = Math.max(2, Math.round(innerHeight * this.fxScale));
    this.el.fx.width = w; this.el.fx.height = h;
  }
  setText(key, el, v) { if (this._last[key] !== v) { this._last[key] = v; el.textContent = v; } }
  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  buildMinimap() {
    const tr = this.tr, S = this.el.mm.width, pad = 22;
    const b = tr.bounds, w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    const sc = (S - pad * 2) / Math.max(w, h);
    this.mmScale = sc;
    this.mmOff = { x: pad + ((S - pad * 2) - w * sc) / 2 - b.minX * sc, y: pad + ((S - pad * 2) - h * sc) / 2 - b.minZ * sc };
    const off = document.createElement('canvas'); off.width = off.height = S;
    const g = off.getContext('2d');
    const P = (i) => [tr.px[i % tr.N] * sc + this.mmOff.x, tr.pz[i % tr.N] * sc + this.mmOff.y];
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 9;
    g.beginPath(); for (let i = 0; i <= tr.N; i += 4) { const [x, y] = P(i); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    g.strokeStyle = '#cfd6dd'; g.lineWidth = 5;
    g.beginPath(); for (let i = 0; i <= tr.N; i += 4) { const [x, y] = P(i); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    // 缺口
    g.strokeStyle = '#ff4a3a'; g.lineWidth = 5;
    for (const gp of tr.gaps) { const glen = tr.gapSpan ? tr.gapSpan(gp) : tr.gapLen; g.beginPath(); for (let k = 0; k <= glen; k++) { const [x, y] = P(gp.g0 + k); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    // 起點
    const [sx, sy] = P(0); g.fillStyle = '#fff'; g.fillRect(sx - 6, sy - 2, 12, 4);
    this.mmBase = off;
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
  flash() { this.el.flash.classList.add('on'); setTimeout(() => this.el.flash.classList.remove('on'), 160); }
  count(t) { this.setText('count', this.el.count, t); }

  update(dt, veh, lap, camLabel, padText, stateLabel) {
    const e = this.el;
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) e.toast.classList.remove('on'); }
    const kmh = Math.round(veh.kmh);
    this.setText('speed', e.speed, String(kmh));
    const pct = Math.round(veh.energy);
    if (this._last.pct !== pct) {
      this._last.pct = pct;
      e.fill.style.width = pct + '%';
      e.fill.classList.toggle('low', pct < 25);
      e.txt.textContent = `推進能量 ${pct}%`;
    }
    this.setText('state', e.state, stateLabel);
    this.setText('lapN', e.lapN, String(lap.n));
    this.setText('lapT', e.lapT, fmtTime(lap.t));
    this.setText('lapLast', e.lapLast, fmtTime(lap.last));
    this.setText('lapBest', e.lapBest, fmtTime(lap.best));
    this.setText('cam', e.cam, '視角：' + camLabel);
    this.setText('pad', e.pad, padText);
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
