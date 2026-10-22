// 免費公開 MQTT，當 WebRTC 不通時改走 WebSocket。不需要私人金鑰。
// 第一個在 443，車機 LTE 比較容易放行；後面是備用。
// 主題是公開的，房間代碼當題目，不要傳帳號密碼。

import { normalizeCode, makeMidWindow } from './sync.js';
import { t } from './i18n.js';

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

export const RELAY_BACKOFF_CAP = 8000;
export const RELAY_FAIL_STREAK = 4;

// 斷線重試同一台。次數愈多等愈久，最多 8 秒，不會停。
export function relayBackoff(attempt) {
  const n = Math.max(0, attempt | 0);
  return Math.min(RELAY_BACKOFF_CAP, 400 * (2 ** Math.min(n, 5)));
}

// 房主選定的起點加上共同的 epoch，兩邊才會落在同一台。
export function relaySlot(start, epoch, count) {
  const n = count || RELAYS.length || 1;
  const s = ((start % n) + n) % n;
  const e = Math.max(0, epoch | 0);
  return (s + e) % n;
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

export function connectRelay(code, handlers, opts) {
  const h = handlers || {};
  const opt = opts || {};
  const list = opt.relays && opt.relays.length ? opt.relays : RELAYS;
  const n = list.length || 1;
  // index 是現在要連的那一台（QR 上的絕對編號），epoch 是已經一起換過幾次。
  // 不要把兩者再加一次，否則手機掃到的網址會落到另一台。
  const given = Number.isFinite(+opt.index) ? ((+opt.index % n) + n) % n : 0;
  let epoch = Number.isFinite(+opt.epoch) ? Math.max(0, +opt.epoch | 0) : 0;
  let start = ((given - epoch) % n + n) % n;
  let index = relaySlot(start, epoch, n);
  const role = opt.role === 'host' ? 'host' : 'guest';
  const failStreak = opt.failStreak || RELAY_FAIL_STREAK;
  const backoff = typeof opt.backoff === 'function' ? opt.backoff : relayBackoff;
  const helloTimeout = opt.helloTimeout || 6000;
  const openSocket = opt.socket || ((url, protos) => new WebSocket(url, protos));
  const schedule = opt.schedule || ((fn, ms) => setTimeout(fn, ms));
  const topic = 'skyroadster/v1/' + normalizeCode(code);
  const state = {
    open: false,
    failed: false,
    reason: '',
    label: '',
    index,
    epoch,
    attempts: 0,
    _stop: false,
  };
  let ws = null;
  let buf = new Uint8Array(0);
  let ping = 0;
  let attempts = 0;
  let streak = 0;
  let generation = 0;
  let openedGen = -1;
  let openedAt = 0;
  let helloTimer = 0;

  function clearHello() {
    if (!helloTimer) return;
    try { clearTimeout(helloTimer); } catch (e) {}
    helloTimer = 0;
  }

  function tell() {
    state.index = index;
    state.epoch = epoch;
    state.attempts = attempts;
    state.label = list[index] ? list[index].label : '';
    if (state.reasonKey) state.reason = t(state.reasonKey, { label: state.reasonLabel || '' });
    try { if (h.onStatus) h.onStatus({ open: state.open, failed: false, reason: state.reason, reasonKey: state.reasonKey || '', reasonLabel: state.reasonLabel || '', label: state.label, index, epoch }); }
    catch (e) {}
  }

  function retry(delay, gen) {
    if (state._stop) return;
    schedule(() => {
      if (state._stop || gen !== generation) return;
      open();
    }, delay);
  }

  function failHandshake(gen, reason) {
    if (gen !== generation || state._stop) return;
    generation += 1;
    attempts += 1;
    streak += 1;
    state.open = false;
    state.failed = false;
    state.reason = reason;
    if (role === 'host' && streak >= failStreak) {
      epoch += 1;
      streak = 0;
      attempts = 0;
      index = relaySlot(start, epoch, n);
      state.reasonKey = 'relay.failover';
      state.reasonLabel = list[index] ? list[index].label : '';
      state.reason = t('relay.failover', { label: state.reasonLabel });
      try { if (h.onFailover) h.onFailover({ index, epoch, label: list[index] ? list[index].label : '' }); } catch (e) {}
    }
    tell();
    retry(backoff(attempts), generation);
  }

  function onPacket(pkt) {
    if (pkt[0] === 0x20) {
      const codeByte = pkt.length > 3 ? pkt[3] : 0;
      if (codeByte !== 0) {
        try { if (ws) ws.close(); } catch (e) {}
        return;
      }
      try { if (ws) ws.send(mqttSubscribe(topic)); } catch (e) {}
      return;
    }
    if (pkt[0] === 0x90) {
      clearHello();
      attempts = 0;
      streak = 0;
      openedGen = generation;
      openedAt = Date.now();
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
    if (msg && msg.t === 'broker' && role !== 'host' && Number.isFinite(+msg.epoch) && (+msg.epoch | 0) !== epoch) {
      state.pin(+msg.relay, +msg.epoch | 0);
    }
    try { if (h.onMessage) h.onMessage(msg); } catch (e) {}
  }

  function feed(chunk) {
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf, 0); next.set(chunk, buf.length);
    const taken = mqttTake(next);
    buf = taken.rest;
    for (const pkt of taken.packets) onPacket(pkt);
  }

  function open() {
    if (state._stop) return;
    const spec = list[index];
    const gen = ++generation;
    state.label = spec.label;
    state.open = false;
    state.failed = false;
    state.reasonKey = 'relay.connecting';
    state.reasonLabel = spec.label;
    state.reason = t('relay.connecting', { label: spec.label });
    tell();
    let sock;
    try { sock = openSocket(spec.url, ['mqtt']); }
    catch (e) {
      state.reasonKey = 'relay.down';
      state.reasonLabel = spec.label;
      failHandshake(gen, t('relay.down', { label: spec.label }));
      return;
    }
    ws = sock;
    buf = new Uint8Array(0);
    sock.binaryType = 'arraybuffer';
    clearHello();
    helloTimer = schedule(() => {
      if (gen !== generation || state._stop || state.open) return;
      state.reasonKey = 'relay.timeout';
      state.reasonLabel = spec.label;
      state.reason = t('relay.timeout', { label: spec.label });
      try { sock.close(); } catch (e) {}
    }, helloTimeout);
    sock.onopen = () => {
      if (gen !== generation) return;
      const id = 'sky' + Math.random().toString(36).slice(2, 10);
      try { sock.send(mqttConnect(id, spec.username)); } catch (e) {}
    };
    sock.onmessage = (ev) => {
      if (gen !== generation) return;
      const data = ev.data;
      if (data instanceof ArrayBuffer) feed(new Uint8Array(data));
      else if (ArrayBuffer.isView(data)) feed(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    };
    sock.onerror = () => {};
    sock.onclose = () => {
      clearHello();
      if (gen !== generation || state._stop) return;
      state.open = false;
      if (openedGen === gen) {
        attempts = 0;
        streak = 0;
        openedGen = -1;
        generation += 1;
        state.reasonKey = 'relay.retry';
        state.reasonLabel = spec.label;
        state.reason = t('relay.retry', { label: spec.label });
        tell();
        retry(backoff(0), generation);
        return;
      }
      failHandshake(gen, state.reasonKey && state.reasonKey !== 'relay.connecting' ? t(state.reasonKey, { label: spec.label }) : t('relay.closed', { label: spec.label }));
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
  state.pin = (nextIndex, nextEpoch) => {
    const e = Math.max(0, nextEpoch | 0);
    const i = Number.isFinite(+nextIndex) ? ((+nextIndex % n) + n) % n : relaySlot(start, e, n);
    if (i === index && e === epoch) return;
    epoch = e;
    index = i;
    start = ((i - e) % n + n) % n;
    attempts = 0;
    streak = 0;
    openedGen = -1;
    generation += 1;
    state.open = false;
    clearHello();
    try { if (ws) ws.close(); } catch (e2) {}
    ws = null;
    tell();
    retry(0, generation);
  };
  state.poll = (now) => {
    if (state._stop || !state.open || !ws || ws.readyState !== 1) return;
    if (openedAt && now - openedAt > 10000 && attempts) {
      attempts = 0;
      state.attempts = 0;
    }
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

// 同時掛兩台 broker。房主的 epoch 只由第一台前進，第二台跟著重開。
// 同一則訊息帶 mid，收到第二次就丟掉。
// 房主的鏡像連線也會收到自己發出的封包。兩邊若都用 epoch-序號，手機的油門會被當成重複而丟掉。
export function makeRelayMidPrefix(role) {
  const side = role === 'host' ? 'h' : 'g';
  return side + Math.random().toString(36).slice(2, 8);
}

export function connectRelayFan(code, handlers, opts) {
  const opt = opts || {};
  const list = opt.relays && opt.relays.length ? opt.relays : RELAYS;
  const n = list.length || 1;
  const h = handlers || {};
  const role = opt.role === 'host' ? 'host' : 'guest';
  const mids = makeMidWindow(64);
  const midPrefix = makeRelayMidPrefix(role);
  let seq = 1;
  let mirror = null;
  let primary = null;
  const state = {
    open: false,
    failed: false,
    reason: '',
    reasonKey: '',
    reasonLabel: '',
    label: '',
    index: Number.isFinite(+opt.index) ? ((+opt.index % n) + n) % n : 0,
    epoch: Number.isFinite(+opt.epoch) ? Math.max(0, +opt.epoch | 0) : 0,
    attempts: 0,
    _stop: false,
  };

  function sync() {
    state.open = !!((primary && primary.open) || (mirror && mirror.open));
    if (primary) {
      state.index = primary.index;
      state.epoch = primary.epoch;
      state.attempts = primary.attempts;
      state.label = primary.label || '';
      state.reason = primary.reason || '';
      state.reasonKey = primary.reasonKey || '';
      state.reasonLabel = primary.reasonLabel || '';
      state._stop = !!primary._stop;
    }
    state.failed = false;
  }

  function tellStatus() {
    sync();
    try { if (h.onStatus) h.onStatus(state); } catch (e) {}
  }

  function deliver(msg) {
    if (!msg || !mids.accept(msg.mid)) return;
    try { if (h.onMessage) h.onMessage(msg); } catch (e) {}
  }

  function openMirror(index) {
    if (mirror) {
      try { mirror.close(); } catch (e) {}
      mirror = null;
    }
    if (n < 2) return;
    const i = ((index % n) + n) % n;
    mirror = connectRelay(code, {
      onStatus: () => tellStatus(),
      onOpen: () => { tellStatus(); try { if (h.onOpen) h.onOpen(state); } catch (e) {} },
      onMessage: deliver,
    }, Object.assign({}, opt, { role: 'guest', index: i, epoch: 0 }));
  }

  primary = connectRelay(code, {
    onStatus: () => tellStatus(),
    onOpen: () => { tellStatus(); try { if (h.onOpen) h.onOpen(state); } catch (e) {} },
    onFailover: (info) => {
      openMirror(((info && info.index) || 0) + 1);
      sync();
      try { if (h.onFailover) h.onFailover(info); } catch (e) {}
    },
    onMessage: deliver,
  }, Object.assign({}, opt, { role, index: state.index, epoch: state.epoch }));
  openMirror(state.index + 1);

  state.send = (obj) => {
    if (!obj) return false;
    const body = Object.assign({}, obj);
    if (body.mid == null) body.mid = midPrefix + '-' + (seq++);
    const a = primary && primary.send(body);
    const b = mirror && mirror.send(body);
    return !!(a || b);
  };
  state.pin = (nextIndex, nextEpoch) => {
    if (primary) primary.pin(nextIndex, nextEpoch);
    const i = Number.isFinite(+nextIndex) ? ((+nextIndex % n) + n) % n : state.index;
    const want = (i + 1) % n;
    const mirrorOk = mirror && !mirror._stop && mirror.index === want && (mirror.epoch | 0) === 0;
    if (!mirrorOk) openMirror(want);
    sync();
  };
  state.poll = (now) => {
    if (primary) primary.poll(now);
    if (mirror) mirror.poll(now);
  };
  state.close = () => {
    state._stop = true;
    state.open = false;
    try { if (primary) primary.close(); } catch (e) {}
    try { if (mirror) mirror.close(); } catch (e) {}
  };
  return state;
}
