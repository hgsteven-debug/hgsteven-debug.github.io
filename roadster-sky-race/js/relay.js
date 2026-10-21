// 免費公開 MQTT，當 WebRTC 不通時改走 WebSocket。不需要私人金鑰。
// 第一個在 443，車機 LTE 比較容易放行；後面是備用。
// 主題是公開的，房間代碼當題目，不要傳帳號密碼。

import { normalizeCode } from './sync.js';

export const RELAYS = [
  { url: 'wss://demo.tbmq.io/mqtt', username: 'demo', label: 'demo.tbmq.io:443' },
  { url: 'wss://broker.hivemq.com:8884/mqtt', username: '', label: 'broker.hivemq.com:8884' },
  { url: 'wss://broker.emqx.io:8084/mqtt', username: '', label: 'broker.emqx.io:8084' },
  { url: 'wss://test.mosquitto.org:8081/mqtt', username: '', label: 'test.mosquitto.org:8081' },
];

function encStr(text) {
  const bytes = new TextEncoder().encode(text);
  const out = new Uint8Array(2 + bytes.length);
  out[0] = (bytes.length >> 8) & 255;
  out[1] = bytes.length & 255;
  out.set(bytes, 2);
  return out;
}

function remLen(n) {
  const o = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    o.push(d);
  } while (n > 0);
  return new Uint8Array(o);
}

function packet(type, body) {
  const rl = remLen(body.length);
  const out = new Uint8Array(1 + rl.length + body.length);
  out[0] = type;
  out.set(rl, 1);
  out.set(body, 1 + rl.length);
  return out;
}

function concatBytes(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function mqttConnect(clientId, username) {
  const flags = username ? 0x82 : 0x02;
  const head = new Uint8Array([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, flags, 0x00, 30]);
  const parts = [head, encStr(clientId)];
  if (username) parts.push(encStr(username));
  return packet(0x10, concatBytes(parts));
}

export function mqttSubscribe(topic) {
  return packet(0x82, concatBytes([new Uint8Array([0x00, 0x01]), encStr(topic), new Uint8Array([0])]));
}

export function mqttPublish(topic, text) {
  return packet(0x30, concatBytes([encStr(topic), new TextEncoder().encode(text)]));
}

function readRemLen(buf, at) {
  let n = 0, mul = 1, i = at, used = 0;
  for (; used < 4 && i < buf.length; used++) {
    const d = buf[i++];
    n += (d & 127) * mul;
    mul *= 128;
    if ((d & 128) === 0) return { n, next: i };
  }
  return null;
}

// 從緩衝取出完整的 MQTT 封包。回傳 { packets, rest }。
export function mqttTake(buf) {
  const packets = [];
  let i = 0;
  while (i < buf.length) {
    const rl = readRemLen(buf, i + 1);
    if (!rl) break;
    const end = rl.next + rl.n;
    if (end > buf.length) break;
    packets.push(buf.slice(i, end));
    i = end;
  }
  return { packets, rest: buf.slice(i) };
}

export function mqttPayload(pkt) {
  if (!pkt || pkt.length < 2 || (pkt[0] & 0xf0) !== 0x30) return null;
  const rl = readRemLen(pkt, 1);
  if (!rl) return null;
  const body = rl.next;
  if (body + 2 > pkt.length) return null;
  const tlen = (pkt[body] << 8) | pkt[body + 1];
  const start = body + 2 + tlen;
  if (start > pkt.length) return null;
  return new TextDecoder().decode(pkt.slice(start));
}

export function connectRelay(code, handlers) {
  const h = handlers || {};
  const topic = 'skyroadster/v1/' + normalizeCode(code);
  const state = {
    open: false,
    failed: false,
    reason: '',
    label: '',
    _stop: false,
  };
  let ws = null;
  let buf = new Uint8Array(0);
  let index = 0;
  let ping = 0;
  let attempts = 0;

  function tell() {
    try { if (h.onStatus) h.onStatus({ open: state.open, failed: state.failed, reason: state.reason, label: state.label }); }
    catch (e) {}
  }

  function fail(reason) {
    state.open = false;
    state.failed = true;
    state.reason = reason;
    tell();
  }

  function onPacket(pkt) {
    if (pkt[0] === 0x20) {
      const codeByte = pkt.length > 3 ? pkt[3] : 0;
      if (codeByte !== 0) {
        try { ws.close(); } catch (e) {}
        return;
      }
      try { ws.send(mqttSubscribe(topic)); } catch (e) {}
      return;
    }
    if (pkt[0] === 0x90) {
      state.open = true;
      state.failed = false;
      state.reason = '';
      tell();
      try { if (h.onOpen) h.onOpen(state); } catch (e) {}
      return;
    }
    const text = mqttPayload(pkt);
    if (!text) return;
    let msg = null;
    try { msg = JSON.parse(text); } catch (e) { return; }
    try { if (h.onMessage) h.onMessage(msg); } catch (e) {}
  }

  function feed(chunk) {
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf, 0); next.set(chunk, buf.length);
    const taken = mqttTake(next);
    buf = taken.rest;
    for (const pkt of taken.packets) onPacket(pkt);
  }

  function arm(delay) {
    if (state._stop) return;
    setTimeout(open, delay);
  }

  function open() {
    if (state._stop) return;
    if (attempts >= RELAYS.length * 2) {
      fail(state.reason || '免費網頁中繼都連不上');
      return;
    }
    const spec = RELAYS[index % RELAYS.length];
    index += 1;
    attempts += 1;
    state.label = spec.label;
    state.open = false;
    state.reason = '正在連上 ' + spec.label;
    tell();
    let sock;
    try { sock = new WebSocket(spec.url, ['mqtt']); }
    catch (e) {
      state.reason = spec.label + ' 無法開啟';
      arm(400);
      return;
    }
    ws = sock;
    buf = new Uint8Array(0);
    sock.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      if (sock === ws && !state.open) {
        state.reason = spec.label + ' 超過 6 秒沒有回應';
        try { sock.close(); } catch (e) {}
      }
    }, 6000);
    sock.onopen = () => {
      const id = 'sky' + Math.random().toString(36).slice(2, 10);
      try { sock.send(mqttConnect(id, spec.username)); } catch (e) {}
    };
    sock.onmessage = (ev) => {
      const data = ev.data;
      if (data instanceof ArrayBuffer) feed(new Uint8Array(data));
      else if (ArrayBuffer.isView(data)) feed(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    };
    sock.onerror = () => {};
    sock.onclose = () => {
      clearTimeout(timer);
      if (sock !== ws || state._stop) return;
      state.open = false;
      if (!state.reason || state.reason.indexOf('正在連上') === 0) state.reason = spec.label + ' 已中斷';
      tell();
      arm(500);
    };
  }

  state.send = (obj) => {
    if (!ws || ws.readyState !== 1 || !state.open || !obj) return false;
    try {
      ws.send(mqttPublish(topic, JSON.stringify(obj)));
      return true;
    } catch (e) {
      return false;
    }
  };
  state.poll = (now) => {
    if (state._stop || !state.open || !ws || ws.readyState !== 1) return;
    if (!ping) ping = now;
    if (now - ping < 20000) return;
    ping = now;
    try { ws.send(new Uint8Array([0xc0, 0x00])); } catch (e) {}
  };
  state.close = () => {
    state._stop = true;
    state.open = false;
    try { if (ws) ws.close(); } catch (e) {}
    ws = null;
  };
  open();
  return state;
}
