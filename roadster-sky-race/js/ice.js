// WebRTC 的 STUN/TURN 清單，以及瀏覽器有沒有資料通道。
// PeerJS 內建的 turn.peerjs.com 已經查不到位址，放進去只會拖慢連線，所以不使用。
// Open Relay 的靜態密鑰公開在 https://www.metered.ca/tools/openrelay/ ，不是私人金鑰。

const OPEN_RELAY_SECRET = 'openrelayprojectsecret';

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

export function iceServers(nowMs = Date.now()) {
  const turn = turnCredential(nowMs);
  const tcp = (port) => ({
    urls: 'turn:staticauth.openrelay.metered.ca:' + port + '?transport=tcp',
    username: turn.username,
    credential: turn.credential,
  });
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // 443 / 80 的 TCP，給擋住 UDP 的行動網路。直連仍會先試。
    tcp(443),
    tcp(80),
  ];
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
