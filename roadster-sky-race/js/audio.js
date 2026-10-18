// 簡易 WebAudio 音效（全部程式合成，無音檔）
import { clamp, store } from './util.js';

export class GameAudio {
  constructor() {
    this.volume = store.get('volume', 0.7);
    this.ctx = null;
    this.ok = false;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC());
      this.master = c.createGain(); this.master.gain.value = this.volume; this.master.connect(c.destination);
      // 電動馬達鳴聲
      this.whine = c.createOscillator(); this.whine.type = 'sawtooth';
      this.whine2 = c.createOscillator(); this.whine2.type = 'sine';
      this.whineG = c.createGain(); this.whineG.gain.value = 0;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      this.whine.connect(lp); this.whine2.connect(lp); lp.connect(this.whineG); this.whineG.connect(this.master);
      // 噪音：風聲與推進器
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      const mkNoise = (type, freq, q) => {
        const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
        const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = c.createGain(); g.gain.value = 0;
        s.connect(f); f.connect(g); g.connect(this.master); s.start();
        return { s, f, g };
      };
      this.wind = mkNoise('bandpass', 700, 0.6);
      this.jet = mkNoise('lowpass', 500, 0.8);
      this.whine.start(); this.whine2.start();
      this.ok = true;
    } catch (e) { this.ok = false; }
  }
  setVolume(v) {
    this.volume = v; store.set('volume', v);
    if (this.ok) this.master.gain.value = v;
  }
  update(speed, thrust, lift, nitro, grounded, active) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const a = active ? 1 : 0;
    const sp = clamp(speed / 90, 0, 1.3);
    this.whine.frequency.setTargetAtTime(90 + sp * 900, t, 0.05);
    this.whine2.frequency.setTargetAtTime(180 + sp * 1800, t, 0.05);
    this.whineG.gain.setTargetAtTime(a * (0.025 + sp * 0.05), t, 0.1);
    this.wind.g.gain.setTargetAtTime(a * sp * sp * 0.22, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(500 + sp * 1500, t, 0.1);
    const j = a * clamp(lift * 0.6 + thrust * (nitro ? 0.9 : 0.35), 0, 1);
    this.jet.g.gain.setTargetAtTime(j * 0.35, t, 0.06);
    this.jet.f.frequency.setTargetAtTime(350 + j * 900, t, 0.1);
  }
  _burst(freq, dur, gain, type = 'noise', fEnd = null) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    if (type === 'noise') {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
      s.connect(f); f.connect(g); s.start(t); s.stop(t + dur);
    } else {
      const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
      if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
      o.connect(g); o.start(t); o.stop(t + dur);
    }
  }
  ding() { this._burst(880, 0.35, 0.18, 'sine', 1760); }
  land(imp) { const k = clamp(imp / 20, 0.1, 1); this._burst(300, 0.35, 0.5 * k, 'noise'); this._burst(90, 0.3, 0.5 * k, 'sine', 40); }
  hit() { this._burst(900, 0.25, 0.4, 'noise'); }
  beep(hi) { this._burst(hi ? 1100 : 660, hi ? 0.5 : 0.18, 0.2, 'square'); }
}
