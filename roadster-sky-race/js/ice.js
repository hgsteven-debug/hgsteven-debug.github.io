// WebRTC 的 STUN/TURN 清單，以及瀏覽器有沒有資料通道。
// PeerJS 內建的 turn.peerjs.com 已經查不到位址，放進去只會拖慢連線，所以不使用。
// 實際的 TURN 主機在 turn-config.js，方便以後整份換掉。
// 這裡的 iceTransportPolicy 維持 all：主機候選（含 mDNS .local）照常收集，優先直連。
// 只有網址帶 ?forceTurn=1 時才改成 relay，用來確認 TURN 那條路。

import { TURN_ICE_SERVERS } from './turn-config.js';

const OPEN_RELAY_SECRET = 'openrelayprojectsecret';

export const ICE_TRANSPORT_POLICY = 'all';
// 直連大約 4.5 秒還沒起來就改走 TURN；整段大約 8 秒還沒證明送得到封包就改走網頁中繼。
export const JOIN_DIRECT_MS = 4500;
export const JOIN_TOTAL_MS = 8000;

// 純函式，測試與連線迴圈共用。proven+connected 代表這條路已經送達過封包。
export function nextJoinStage(s) {
  const age = s && s.age > 0 ? s.age : 0;
  if (!s || !s.rtcOk) return 'mqtt';
  const live = !!(s.proven && s.connected);
  if (live) {
    if (s.via === 'ws') return 'mqtt';
    if (s.via === 'relay' || s.policy === 'relay') return 'turn';
    return 'direct';
  }
  if (s.policy === 'relay') return age >= JOIN_TOTAL_MS ? 'mqtt' : 'turn';
  if (s.iceDirect && age < JOIN_TOTAL_MS) return 'direct';
  if (age < JOIN_DIRECT_MS) return 'direct';
  if (age < JOIN_TOTAL_MS) return 'turn';
  return 'mqtt';
}

const PUBLIC_STUN = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun3.l.google.com:19302',
  'stun:stun4.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
  'stun:stun.sipgate.net:3478',
];

function rotl(n, s) { return ((n << s) | (n >>> (32 - s))) >>> 0; }

function sha1(bytes) {
  const ml = bytes.length;
  const padded = new Uint8Array(((ml + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[ml] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, (ml * 8) >>> 0, false);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      let f, k;
      if (t < 20) { f = ((b & c) | (~b & d)) >>> 0; k = 0x5a827999; }
      else if (t < 40) { f = (b ^ c ^ d) >>> 0; k = 0x6ed9eba1; }
      else if (t < 60) { f = ((b & c) | (b & d) | (c & d)) >>> 0; k = 0x8f1bbcdc; }
      else { f = (b ^ c ^ d) >>> 0; k = 0xca62c1d6; }
      const temp = (rotl(a, 5) + f + e + k + w[t]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, h0); ov.setUint32(4, h1); ov.setUint32(8, h2); ov.setUint32(12, h3); ov.setUint32(16, h4);
  return out;
}

function concat(a, b) {
  const o = new Uint8Array(a.length + b.length);
  o.set(a, 0); o.set(b, a.length);
  return o;
}

export function hmacSha1Base64(keyStr, msgStr) {
  const enc = new TextEncoder();
  let key = enc.encode(keyStr);
  if (key.length > 64) key = sha1(key);
  const block = new Uint8Array(64);
  block.set(key);
  const ip = new Uint8Array(64);
  const op = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ip[i] = block[i] ^ 0x36; op[i] = block[i] ^ 0x5c; }
  const mac = sha1(concat(op, sha1(concat(ip, enc.encode(msgStr)))));
  let s = '';
  for (let i = 0; i < mac.length; i++) s += String.fromCharCode(mac[i]);
  return btoa(s);
}

// 短時效 TURN 帳號（coturn REST）。密鑰是 Open Relay 公開的靜態密鑰。
export function turnCredential(nowMs = Date.now()) {
  const username = String(Math.floor(nowMs / 1000) + 3600);
  return { username, credential: hmacSha1Base64(OPEN_RELAY_SECRET, username) };
}

function urlKey(urls) {
  return Array.isArray(urls) ? urls.join('|') : String(urls || '');
}

// 公開 STUN 在前，TURN 設定接在後面。同一組網址只留一次，避免重複分配中繼。
export function iceServers() {
  const out = [];
  const seen = new Set();
  const add = (entry) => {
    if (!entry || !entry.urls) return;
    const key = urlKey(entry.urls);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };
  for (const urls of PUBLIC_STUN) add({ urls });
  for (const entry of TURN_ICE_SERVERS) add(entry);
  return out;
}

// 預設 all，讓 host / srflx 比 relay 優先。?forceTurn=1 只拿 TURN 候選。
export function iceTransportPolicy(search) {
  let q = search;
  if (q == null) {
    try { q = typeof location !== 'undefined' ? location.search : ''; } catch (e) { q = ''; }
  }
  return /(?:^|[?&])forceTurn=1(?:&|$)/.test(String(q || '')) ? 'relay' : ICE_TRANSPORT_POLICY;
}

export function rtcConfig(nowMs, search) {
  return {
    iceServers: iceServers(nowMs),
    sdpSemantics: 'unified-plan',
    iceTransportPolicy: iceTransportPolicy(search),
  };
}

export function webrtcSupport() {
  const RTC = globalThis.RTCPeerConnection;
  if (typeof RTC !== 'function') return { ok: false, reason: '沒有 RTCPeerConnection' };
  try {
    const pc = new RTC({ iceServers: [] });
    let dc = null;
    try { dc = pc.createDataChannel('sky'); } catch (e) {
      try { pc.close(); } catch (err) {}
      return { ok: false, reason: '無法建立資料通道（' + (e && e.message ? e.message : e) + '）' };
    }
    try { pc.close(); } catch (e) {}
    if (!dc) return { ok: false, reason: '無法建立資料通道' };
    return { ok: true, reason: '' };
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message : String(e) };
  }
}
