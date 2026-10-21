// 房主／手機的 WebRTC 連線。訊號走 PeerJS 公開伺服器（含他們提供的免費 TURN）。
// 這裡不碰比賽迴圈：斷線只回呼，主機的物理不會等待網路。
import { RemoteDriver } from './race.js';
import {
  REMOTE_LIMIT, makeRoomCode, peerIdFor, joinUrl, failText, packInput, zeroInput,
} from './sync.js';

export { REMOTE_LIMIT };

function peerOptions() {
  return {
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    debug: 0,
    // 不覆寫 iceServers，沿用 PeerJS 預設：Google STUN + peerjs.com 的公開 TURN。
  };
}

function peerCtor() {
  const P = globalThis.Peer;
  return typeof P === 'function' ? P : null;
}

export function drawRoomQr(canvas, text) {
  if (!canvas || !text) return false;
  const qrcode = globalThis.qrcode;
  if (typeof qrcode !== 'function') return false;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 2;
    const cell = Math.max(2, Math.floor(Math.min(canvas.width, canvas.height) / (n + quiet * 2)));
    const size = cell * n;
    const off = Math.floor((canvas.width - size) / 2);
    const offY = Math.floor((canvas.height - size) / 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b0f14';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, offY + r * cell, cell, cell);
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

function clientNonce() {
  const key = 'skyroadster.peerNonce';
  try {
    let n = sessionStorage.getItem(key);
    if (!n) {
      n = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
      sessionStorage.setItem(key, n);
    }
    return n;
  } catch (e) {
    return 'n' + Math.random().toString(36).slice(2);
  }
}

export function createHost(handlers) {
  const h = handlers || {};
  const session = {
    role: 'host',
    code: makeRoomCode(),
    url: '',
    ready: false,
    failed: false,
    failMsg: '',
    remotes: [],
    attempt: 0,
    lastSend: 0,
    _destroyed: false,
    _gen: 0,
  };
  let peer = null;

  function emitStatus(text, kind) {
    session.url = joinUrl(session.code, globalThis.location);
    try { if (h.onStatus) h.onStatus({ text, kind, code: session.code, url: session.url, ready: session.ready, failed: session.failed }); }
    catch (e) { /* 狀態列不能拖垮比賽 */ }
  }

  function fail(msg) {
    session.failed = true;
    session.ready = false;
    session.failMsg = msg;
    emitStatus(msg, 'fail');
  }

  function drop(remote, why) {
    if (!remote) return;
    const i = session.remotes.indexOf(remote);
    if (i >= 0) session.remotes.splice(i, 1);
    try { if (remote.driver) remote.driver.push(zeroInput()); } catch (e) {}
    try { if (remote.conn && remote.conn.open) remote.conn.send({ t: why === 'replaced' ? 'replaced' : 'bye' }); } catch (e) {}
    try { if (remote.conn) remote.conn.close(); } catch (e) {}
    try { if (h.onLeave) h.onLeave(remote, why); } catch (e) {}
    if (!session.remotes.length && session.ready) emitStatus('手機已離開，這台比賽繼續。可以再掃碼加入。', 'ready');
  }

  function nameFor(slot) { return 'P' + (3 + slot); }

  function adopt(conn, nonce) {
    if (conn._skyJoined || session._destroyed) return;
    while (session.remotes.length >= REMOTE_LIMIT) {
      const cur = session.remotes[0];
      const age = performance.now() - (cur.lastAt || cur.joinedAt || 0);
      const same = nonce && cur.nonce && cur.nonce === nonce;
      const fresh = !!(cur.conn && cur.conn.open) && age < 2500;
      if (!same && fresh) {
        try { conn.send({ t: 'full' }); } catch (e) {}
        try { conn.close(); } catch (e) {}
        return;
      }
      drop(cur, 'replaced');
    }
    conn._skyJoined = true;
    const remote = {
      id: conn.peer,
      slot: 0,
      conn,
      nonce: nonce || '',
      name: nameFor(0),
      seq: 0,
      cmd: zeroInput(),
      lastAt: 0,
      joinedAt: performance.now(),
      driver: new RemoteDriver(),
      racer: null,
    };
    session.remotes.push(remote);
    try { if (h.onJoin) h.onJoin(remote); } catch (e) {}
    try { conn.send(h.welcome ? h.welcome(remote) : { t: 'welcome', name: remote.name, slot: remote.slot }); } catch (e) {}
    try {
      const st = h.state && h.state(remote);
      if (st) conn.send(st);
    } catch (e) {}
    emitStatus(remote.name + ' 已用手機加入。開始後會在自己的螢幕開車。', 'joined');
  }

  function accept(conn) {
    conn.on('data', (data) => {
      if (session._destroyed || !data || typeof data !== 'object') return;
      if (!conn._skyJoined) {
        if (data.t === 'hello' || data.t === 'input') adopt(conn, data.nonce);
        if (!conn._skyJoined) return;
      }
      const remote = session.remotes.find((r) => r.conn === conn);
      if (!remote) return;
      if (data.t === 'input') {
        remote.cmd = packInput(data);
        remote.seq = data.seq | 0;
        remote.lastAt = performance.now();
        try { remote.driver.push(remote.cmd); } catch (e) {}
      } else if (data.t === 'hello') {
        if (data.nonce) remote.nonce = data.nonce;
      } else if (data.t === 'bye') {
        drop(remote, 'close');
      } else if (data.t === 'reset') {
        try { if (h.onReset) h.onReset(remote); } catch (e) {}
      }
    });
    conn.on('close', () => drop(session.remotes.find((r) => r.conn === conn), 'close'));
    conn.on('error', () => drop(session.remotes.find((r) => r.conn === conn), 'error'));
  }

  function openPeer() {
    if (session._destroyed) return;
    const Peer = peerCtor();
    if (!Peer) {
      fail('這台瀏覽器沒有載入連線元件，手機暫時無法加入。本機仍可正常遊玩。');
      return;
    }
    const gen = ++session._gen;
    let next;
    try { next = new Peer(peerIdFor(session.code), peerOptions()); }
    catch (e) {
      fail(failText(e));
      return;
    }
    peer = next;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled || gen !== session._gen) return;
      settled = true;
      fail('連線伺服器沒有回應。請確認網路。嚴格的防火牆也可能擋住掃碼。本機比賽不受影響。');
    }, 12000);
    next.on('open', () => {
      if (gen !== session._gen || session._destroyed) return;
      settled = true;
      clearTimeout(timer);
      session.ready = true;
      session.failed = false;
      session.failMsg = '';
      emitStatus('手機掃這個碼，以 P3 加入同一場。下方代碼也可以手動輸入。', 'ready');
    });
    next.on('connection', (conn) => { if (gen === session._gen) accept(conn); });
    next.on('disconnected', () => {
      if (gen !== session._gen || session._destroyed) return;
      session.ready = false;
      emitStatus('掃碼服務暫時中斷，比賽繼續。正在重新連上…', 'warn');
      try { next.reconnect(); } catch (e) {}
    });
    next.on('error', (err) => {
      if (gen !== session._gen || session._destroyed) return;
      const type = err && err.type;
      if (type === 'unavailable-id' && session.attempt < 4) {
        session.attempt++;
        settled = true;
        clearTimeout(timer);
        try { next.destroy(); } catch (e) {}
        session.code = makeRoomCode();
        emitStatus('這組代碼使用中，正在換一組…', 'warn');
        openPeer();
        return;
      }
      if (type === 'network' || type === 'socket-error' || type === 'socket-closed' || type === 'disconnected' || type === 'server-error') {
        if (session.ready) {
          emitStatus('掃碼服務暫時不穩，比賽繼續。', 'warn');
          try { next.reconnect(); } catch (e) {}
          return;
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          fail(failText(err));
        }
        return;
      }
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fail(failText(err));
      }
    });
  }

  session.broadcast = (build, force) => {
    if (session._destroyed || !session.remotes.length) return;
    const now = performance.now();
    if (!force && now - session.lastSend < 50) return;
    session.lastSend = now;
    for (let i = 0; i < session.remotes.length; i++) {
      const remote = session.remotes[i];
      if (!remote.conn || !remote.conn.open) continue;
        try {
          const msg = build(remote);
          if (msg) { remote.conn.send(msg); session.sent = (session.sent || 0) + 1; }
        } catch (e) { session.lastErr = String(e && e.message || e); }
    }
  };
  session.send = (remote, msg) => {
    try { if (remote && remote.conn && remote.conn.open && msg) remote.conn.send(msg); } catch (e) {}
  };
  session.destroy = () => {
    session._destroyed = true;
    session._gen++;
    const list = session.remotes.splice(0);
    for (const remote of list) {
      try { remote.conn.close(); } catch (e) {}
    }
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = null;
  };
  session.url = joinUrl(session.code, globalThis.location);
  emitStatus('正在準備房間…', 'wait');
  openPeer();
  return session;
}

export function createGuest(code, handlers) {
  const h = handlers || {};
  const nonce = clientNonce();
  const session = {
    role: 'guest',
    code,
    connected: false,
    failed: false,
    failMsg: '',
    replaced: false,
    full: false,
    seq: 0,
    lastSend: 0,
    log: [],
    _destroyed: false,
    _opened: false,
  };
  let peer = null;
  let conn = null;

  function send(msg) {
    try { if (conn && conn.open && msg) conn.send(msg); } catch (e) {}
  }
  session.send = send;
  session.noteInput = (state, now) => {
    const cmd = packInput(state);
    const last = session.log.length ? session.log[session.log.length - 1] : null;
    const same = last && last.cmd.steer === cmd.steer && last.cmd.throttle === cmd.throttle && last.cmd.brake === cmd.brake
      && last.cmd.lift === cmd.lift && last.cmd.nitro === cmd.nitro && last.cmd.pitch === cmd.pitch;
    if (same && now - session.lastSend < 200) return session.seq;
    session.seq += 1;
    session.lastSend = now;
    send({ t: 'input', seq: session.seq, nonce, steer: cmd.steer, throttle: cmd.throttle, brake: cmd.brake, lift: cmd.lift, nitro: cmd.nitro, pitch: cmd.pitch });
    session.log.push({ seq: session.seq, cmd, steps: 0 });
    if (session.log.length > 90) session.log.shift();
    return session.seq;
  };
  session.noteSubstep = () => {
    const last = session.log[session.log.length - 1];
    if (last) last.steps += 1;
  };

  function start() {
    const Peer = peerCtor();
    if (!Peer) {
      session.failed = true;
      session.failMsg = '這台瀏覽器不支援點對點連線。';
      try { if (h.onFail) h.onFail(session.failMsg); } catch (e) {}
      return;
    }
    try { peer = new Peer(peerOptions()); }
    catch (e) {
      session.failed = true;
      session.failMsg = failText(e);
      try { if (h.onFail) h.onFail(session.failMsg); } catch (err) {}
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled || session._destroyed || session._opened) return;
      settled = true;
      session.failed = true;
      session.failMsg = failText({ type: 'network' });
      try { if (h.onFail) h.onFail(session.failMsg); } catch (e) {}
    }, 20000);
    peer.on('open', () => {
      if (session._destroyed) return;
      try {
        conn = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
      } catch (e) {
        settled = true;
        clearTimeout(timer);
        session.failed = true;
        session.failMsg = failText(e);
        try { if (h.onFail) h.onFail(session.failMsg); } catch (err) {}
        return;
      }
      const hello = { t: 'hello', nonce, name: 'P3' };
      conn.on('open', () => {
        if (session._destroyed) return;
        session._opened = true;
        settled = true;
        clearTimeout(timer);
        send(hello);
      });
      conn.on('data', (data) => {
        if (session._destroyed || !data) return;
        if (data.t === 'welcome') {
          session.connected = true;
          session.failed = false;
          try { if (h.onWelcome) h.onWelcome(data); } catch (e) {}
        } else if (data.t === 'state') {
          session.connected = true;
          try { if (h.onState) h.onState(data); } catch (e) {}
        } else if (data.t === 'full') {
          session.full = true;
          session.failed = true;
          session.failMsg = '這個房間已經有一位手機玩家。請等對方離開再加入。';
          try { if (h.onFail) h.onFail(session.failMsg); } catch (e) {}
        } else if (data.t === 'replaced') {
          session.replaced = true;
        }
      });
      conn.on('close', () => {
        if (session._destroyed) return;
        session.connected = false;
        setTimeout(() => {
          if (session._destroyed) return;
          try { if (h.onClose) h.onClose({ replaced: session.replaced, full: session.full }); } catch (e) {}
        }, 400);
      });
      conn.on('error', () => {
        if (session._destroyed || session.connected) return;
        session.failed = true;
        session.failMsg = failText({ type: 'network' });
        try { if (h.onFail) h.onFail(session.failMsg); } catch (e) {}
      });
    });
    peer.on('error', (err) => {
      if (session._destroyed || session.connected) return;
      const type = err && err.type;
      if (type === 'disconnected' || type === 'network') {
        try { peer.reconnect(); } catch (e) {}
      }
      if (!settled || type === 'peer-unavailable') {
        settled = true;
        clearTimeout(timer);
        session.failed = true;
        session.failMsg = failText(err);
        try { if (h.onFail) h.onFail(session.failMsg); } catch (e) {}
      }
    });
  }

  session.destroy = () => {
    session._destroyed = true;
    try { send({ t: 'bye' }); } catch (e) {}
    try { if (conn) conn.close(); } catch (e) {}
    const dying = peer;
    conn = null;
    peer = null;
    setTimeout(() => { try { if (dying) dying.destroy(); } catch (e) {} }, 80);
  };
  start();
  return session;
}
