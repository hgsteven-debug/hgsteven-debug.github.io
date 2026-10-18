// 以 canvas 程式化產生貼圖（無外部圖檔）
import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { ROAD_HALF, ROAD_HALF_K } from './track.js';

export const UI_FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei","Heiti TC",sans-serif';

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(canvas, { repeat = false, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export const ROAD_TEX_LEN = 20; // 貼圖沿路長度（公尺）

export function roadTexture(aniso) {
  const W = 512, H = 512;
  const [c, g] = mk(W, H);
  const rnd = mulberry32(7);
  g.fillStyle = '#3c3c40';
  g.fillRect(0, 0, W, H);
  const total = ROAD_HALF_K * 2;
  const X = (l) => ((l + ROAD_HALF_K) / total) * W;
  // 顆粒
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 34;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // 輪胎痕（較深、較亮的車道）
  for (const l of [-5.2, 5.2]) {
    const grad = g.createLinearGradient(X(l - 2.2), 0, X(l + 2.2), 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(10,10,12,0.28)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(X(l - 2.2), 0, X(l + 2.2) - X(l - 2.2), H);
  }
  // 路緣紅白
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? 0 : X(ROAD_HALF), x1 = side < 0 ? X(-ROAD_HALF) : W;
    for (let k = 0; k < 8; k++) {
      g.fillStyle = k % 2 ? '#d8d8d8' : '#c4261d';
      g.fillRect(x0, (k * H) / 8, x1 - x0, H / 8);
    }
  }
  // 邊線
  g.fillStyle = '#e8e8e8';
  for (const l of [-(ROAD_HALF - 0.7), ROAD_HALF - 0.7]) g.fillRect(X(l) - 3, 0, 6, H);
  // 中線虛線
  g.fillStyle = '#e6e2c8';
  g.fillRect(X(0) - 2.5, H * 0.1, 5, H * 0.3);
  g.fillRect(X(0) - 2.5, H * 0.6, 5, H * 0.3);
  const t = tex(c, { repeat: true, aniso });
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

export function sandTexture(aniso) {
  const S = 256;
  const [c, g] = mk(S, S);
  const rnd = mulberry32(21);
  g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = 190 + rnd() * 65;
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let i = 0; i < 200; i++) {
    g.strokeStyle = `rgba(90,90,90,${0.04 + rnd() * 0.06})`;
    g.lineWidth = 1 + rnd() * 2;
    g.beginPath(); const y = rnd() * S; g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + rnd() * 10 - 5, S * 0.6, y + rnd() * 10 - 5, S, y); g.stroke();
  }
  return tex(c, { repeat: true, aniso });
}

export function glowTexture() {
  const S = 128;
  const [c, g] = mk(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return tex(c, { srgb: true, aniso: 1 });
}

export function blobTexture() {
  const S = 128;
  const [c, g] = mk(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return tex(c, { aniso: 1 });
}

// 輪框（帶輪胎側壁）圓形貼圖
export function rimTexture() {
  const S = 256, R = S / 2;
  const [c, g] = mk(S, S);
  g.fillStyle = '#111'; g.fillRect(0, 0, S, S);
  g.beginPath(); g.arc(R, R, R * 0.95, 0, 7); g.fillStyle = '#18181a'; g.fill();
  g.beginPath(); g.arc(R, R, R * 0.7, 0, 7); g.fillStyle = '#9aa0a8'; g.fill();
  g.beginPath(); g.arc(R, R, R * 0.62, 0, 7); g.fillStyle = '#23262b'; g.fill();
  g.strokeStyle = '#c7ccd3'; g.lineWidth = 16;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.beginPath(); g.moveTo(R + Math.cos(a) * 14, R + Math.sin(a) * 14); g.lineTo(R + Math.cos(a) * R * 0.66, R + Math.sin(a) * R * 0.66); g.stroke();
  }
  g.beginPath(); g.arc(R, R, 26, 0, 7); g.fillStyle = '#d6dae0'; g.fill();
  g.beginPath(); g.arc(R, R, 10, 0, 7); g.fillStyle = '#3a3f46'; g.fill();
  return tex(c, { aniso: 4 });
}

// 空力輪圈貼圖（渦輪葉片造型，原創；無任何標誌）
export function aeroWheelTexture() {
  const S = 512, R = S / 2;
  const [c, g] = mk(S, S);
  g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, S, S);
  const grad = g.createRadialGradient(R * 0.8, R * 0.7, R * 0.1, R, R, R);
  grad.addColorStop(0, '#d5dae0'); grad.addColorStop(0.6, '#a9b0b9'); grad.addColorStop(1, '#6f757d');
  g.beginPath(); g.arc(R, R, R * 0.985, 0, 7); g.fillStyle = grad; g.fill();
  // 外圈輪緣
  g.beginPath(); g.arc(R, R, R * 0.93, 0, 7); g.strokeStyle = '#4a4f56'; g.lineWidth = 5; g.stroke();
  // 渦輪式導風槽（深色，帶彎曲）
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    g.beginPath();
    const r0 = R * 0.30, r1 = R * 0.90, sw = 0.55, w = 0.17;
    for (let k = 0; k <= 16; k++) { const t = k / 16, r = r0 + (r1 - r0) * t, a = a0 + sw * t; k ? g.lineTo(R + Math.cos(a) * r, R + Math.sin(a) * r) : g.moveTo(R + Math.cos(a) * r, R + Math.sin(a) * r); }
    for (let k = 16; k >= 0; k--) { const t = k / 16, r = r0 + (r1 - r0) * t, a = a0 + sw * t + w * Math.sin(Math.PI * Math.min(1, t * 1.15)); g.lineTo(R + Math.cos(a) * r, R + Math.sin(a) * r); }
    g.closePath(); g.fillStyle = '#16181c'; g.fill();
    g.strokeStyle = 'rgba(235,240,245,.55)'; g.lineWidth = 2; g.stroke();
  }
  // 中心蓋（素面）
  g.beginPath(); g.arc(R, R, R * 0.2, 0, 7); g.fillStyle = '#2a2d33'; g.fill();
  g.beginPath(); g.arc(R, R, R * 0.2, 0, 7); g.strokeStyle = '#c9ced5'; g.lineWidth = 6; g.stroke();
  g.beginPath(); g.arc(R, R, R * 0.07, 0, 7); g.fillStyle = '#8b9199'; g.fill();
  return tex(c, { aniso: 8 });
}

function textPanel(w, h, draw) {
  const [c, g] = mk(w, h);
  draw(g, w, h);
  return tex(c, { aniso: 8 });
}

export function gantryTexture() {
  return textPanel(1024, 192, (g, w, h) => {
    g.fillStyle = '#101418'; g.fillRect(0, 0, w, h);
    const s = 24;
    for (let y = 0; y < 2; y++) for (let x = 0; x < w / s; x++) {
      g.fillStyle = (x + y) % 2 ? '#f2f2f2' : '#101010';
      g.fillRect(x * s, y * s, s, s);
      g.fillStyle = (x + y) % 2 ? '#101010' : '#f2f2f2';
      g.fillRect(x * s, h - (y + 1) * s, s, s);
    }
    g.fillStyle = '#ffffff'; g.font = `bold 96px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('起點 / 終點', w / 2, h / 2 + 4);
  });
}

export function warnTexture() {
  return textPanel(512, 256, (g, w, h) => {
    g.fillStyle = '#f5c400'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111'; g.fillRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#f5c400'; g.fillRect(16, 16, w - 32, h - 32);
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 78px ${UI_FONT}`; g.fillText('前方斷橋', w / 2, h * 0.34);
    g.font = `bold 52px ${UI_FONT}`; g.fillText('加速 + A 推進飛越', w / 2, h * 0.7);
  });
}
