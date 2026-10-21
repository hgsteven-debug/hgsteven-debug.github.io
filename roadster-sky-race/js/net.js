// 房主／手機連線。先走 PeerJS（WebRTC，含免費 TURN），同時備一條免費 WebSocket 中繼。
// 斷線只回呼，主機的物理不會等待網路。
import { RemoteDriver } from './race.js';
import {
  REMOTE_LIMIT, makeRoomCode, peerIdFor, joinUrl, failText, packInput, zeroInput, formatCode,
  STATE_GAP_MS, INPUT_GAP_MS,
} from './sync.js';
import { iceServers, webrtcSupport } from './ice.js';
import { connectRelay } from './relay.js';

export { REMOTE_LIMIT };

function peerOptions() {
  return {
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    debug: 0,
    pingInterval: 3000,
    config: { iceServers: iceServers(), sdpSemantics: 'unified-plan' },
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

function arm(list, ms, fn) {
  const item = { at: performance.now() + ms, done: false, fn };
  item.timer = setTimeout(() => {
    if (item.done) return;
    item.done = true;
    try { fn(); } catch (e) {}
  }, ms);
  list.push(item);
  return () => { item.done = true; clearTimeout(item.timer); };
}

function runDue(list, now) {
  for (const item of list) {
    if (item.done || now < item.at) continue;
    item.done = true;
    clearTimeout(item.timer);
    try { item.fn(); } catch (e) {}
  }
}

function pathOf(conn) {
  if (!conn || !conn.peerConnection || typeof conn.peerConnection.getStats !== 'function') return Promise.resolve('webrtc');
  return conn.peerConnection.getStats().then((stats) => {
    let selected = null;
    stats.forEach((r) => {
      if (r.type === 'candidate-pair' && (r.selected || r.nominated) && r.state === 'succeeded') selected = r;
    });
    if (!selected) return 'webrtc';
    const local = stats.get(selected.localCandidateId);
    const remote = stats.get(selected.remoteCandidateId);
    const types = [local && local.candidateType, remote && remote.candidateType];
    return types.indexOf('relay') >= 0 ? 'relay' : 'direct';
  }).catch(() => 'webrtc');
}

function how(via) {
  if (via === 'ws') return '網頁中繼';
  if (via === 'relay') return 'TURN 中繼';
  if (via === 'direct') return '裝置直連';
  if (via === 'webrtc') return 'WebRTC';
  return '路徑確認中';
}

export function createHost(handlers) {
  const h = handlers || {};
  const deadlines = [];
  const wsPeers = new Map();
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
    rtc: webrtcSupport(),
    peerOpen: false,
    peerDetail: '',
    peerGaveUp: false,
    wsOpen: false,
    wsReason: '',
    wsGaveUp: false,
    linking: false,
    _destroyed: false,
    _gen: 0,
    _reopening: false,
  };
  let peer = null;
  let relay = null;
  let lastKick = 0;

  function emit(kind) {
    session.url = joinUrl(session.code, globalThis.location);
    const text = hostText();
    session.failMsg = session.failed ? text : '';
    try { if (h.onStatus) h.onStatus({ text, kind, code: session.code, url: session.url, ready: session.ready, failed: session.failed }); }
    catch (e) {}
  }

  function hostText() {
    const rtcBit = session.rtc.ok ? 'WebRTC 可用' : ('WebRTC 不可用：' + session.rtc.reason);
    const wsBit = session.wsOpen ? '網頁中繼已連上' : ('網頁中繼：' + (session.wsReason || '連線中'));
    if (session.remotes.length) return '階段：P3 已加入（' + how(session.remotes[0].via) + '）。';
    if (session.linking) return '階段：手機正在接通 WebRTC。' + rtcBit + '。' + wsBit + '。';
    if (session.failed) return '階段：失敗。掃碼：' + (session.peerDetail || '沒有連上') + '。' + wsBit + '。' + rtcBit + '。本機比賽不受影響。';
    if (session.peerOpen && session.wsOpen) return '階段：房間已登記，等待手機。' + rtcBit + '。' + wsBit + '。';
    if (session.peerOpen) return '階段：房間已登記在掃碼伺服器。' + wsBit + '。' + rtcBit + '。';
    if (session.wsOpen) return '階段：掃碼伺服器尚未登記（' + (session.peerDetail || '連線中') + '）。網頁中繼已連上，手機仍可加入。' + rtcBit + '。';
    return '階段：正在向掃碼伺服器登記房間。' + wsBit + '。' + rtcBit + '。';
  }

  function mark() {
    if (session._destroyed) return;
    session.ready = !!(session.peerOpen || session.wsOpen);
    session.failed = !session.ready && session.peerGaveUp && session.wsGaveUp;
    const kind = session.remotes.length ? 'joined' : session.failed ? 'fail' : session.ready ? 'ready' : (session.peerDetail ? 'warn' : 'wait');
    emit(kind);
  }

  function drop(remote, why) {
    if (!remote) return;
    const i = session.remotes.indexOf(remote);
    if (i >= 0) session.remotes.splice(i, 1);
    try { if (remote.driver) remote.driver.push(zeroInput()); } catch (e) {}
    try { if (remote.conn && remote.conn.open) remote.conn.send({ t: why === 'replaced' ? 'replaced' : 'bye' }); } catch (e) {}
    try { if (remote.conn) remote.conn.close(); } catch (e) {}
    try { if (h.onLeave) h.onLeave(remote, why); } catch (e) {}
    if (!session.remotes.length) mark();
  }

  function nameFor(slot) { return 'P' + (3 + slot); }

  function adopt(conn, nonce) {
    if (conn._skyJoined || session._destroyed) return;
    const incoming = conn._skyVia || 'webrtc';
    const prev = nonce ? session.remotes.find((r) => r.nonce === nonce) : null;
    if (prev && prev.via !== 'ws' && incoming === 'ws' && prev.conn && prev.conn.open) {
      try { conn.close(); } catch (e) {}
      return;
    }
    if (prev && prev.via === 'ws' && incoming !== 'ws') {
      const old = prev.conn;
      prev.conn = conn;
      prev.via = incoming;
      conn._skyJoined = true;
      try { if (old && old !== conn) old.close(); } catch (e) {}
      try { conn.send(h.welcome ? h.welcome(prev) : { t: 'welcome', name: prev.name, slot: prev.slot }); } catch (e) {}
      try { const st = h.state && h.state(prev); if (st) conn.send(st); } catch (e) {}
      mark();
      pathOf(conn).then((via) => {
        if (session._destroyed || prev.conn !== conn) return;
        prev.via = via;
        mark();
      });
      return;
    }
    while (session.remotes.length >= REMOTE_LIMIT) {
      const cur = session.remotes[0];
      if (prev && cur === prev) { drop(cur, 'replaced'); break; }
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
      via: incoming,
    };
    session.remotes.push(remote);
    session.linking = false;
    try { if (h.onJoin) h.onJoin(remote); } catch (e) {}
    try { conn.send(h.welcome ? h.welcome(remote) : { t: 'welcome', name: remote.name, slot: remote.slot }); } catch (e) {}
    try {
      const st = h.state && h.state(remote);
      if (st) conn.send(st);
    } catch (e) {}
    mark();
    if (incoming !== 'ws') {
      pathOf(conn).then((via) => {
        if (session._destroyed || remote.conn !== conn) return;
        remote.via = via;
        mark();
      });
    }
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
      } else if (data.t === 'car') {
        try { if (h.onCar) h.onCar(remote, data); } catch (e) {}
      }
    });
    conn.on('close', () => drop(session.remotes.find((r) => r.conn === conn), 'close'));
    conn.on('error', () => drop(session.remotes.find((r) => r.conn === conn), 'error'));
  }

  function wsPeer(nonce) {
    let conn = wsPeers.get(nonce);
    if (conn) return conn;
    const hs = {};
    conn = {
      open: true,
      peer: 'ws-' + nonce,
      _skyVia: 'ws',
      on(ev, fn) { (hs[ev] = hs[ev] || []).push(fn); },
      emit(ev, arg) { (hs[ev] || []).forEach((fn) => { try { fn(arg); } catch (e) {} }); },
      send(msg) {
        if (!relay || !msg) return;
        try { relay.send(Object.assign({ from: 'host' }, msg)); } catch (e) {}
      },
      close() { this.open = false; wsPeers.delete(nonce); this.emit('close'); },
    };
    wsPeers.set(nonce, conn);
    accept(conn);
    return conn;
  }

  function onRelayMessage(msg) {
    if (!msg || msg.from === 'host' || session._destroyed) return;
    const nonce = msg.nonce || '';
    if (!nonce) return;
    if (msg.t === 'bye') {
      const matches = session.remotes.filter((r) => (r.nonce === nonce || r.nonce === msg.from) && r.via === 'ws');
      for (const remote of matches) drop(remote, 'close');
      const ghost = wsPeers.get(nonce) || wsPeers.get(msg.from);
      if (ghost) { try { ghost.close(); } catch (e) {} }
      return;
    }
    const webrtc = session.remotes.find((r) => r.nonce === nonce && r.via !== 'ws' && r.conn && r.conn.open);
    if (webrtc) return;
    wsPeer(nonce).emit('data', msg);
  }

  function startRelay() {
    if (relay) { try { relay.close(); } catch (e) {} }
    session.wsOpen = false;
    session.wsGaveUp = false;
    relay = connectRelay(session.code, {
      onStatus: (s) => {
        session.wsOpen = !!s.open;
        session.wsReason = s.open ? '' : (s.reason || '');
        if (s.failed && !s.open) session.wsGaveUp = true;
        mark();
      },
      onOpen: () => { session.wsOpen = true; session.wsGaveUp = false; mark(); },
      onMessage: onRelayMessage,
    });
  }

  function openPeer() {
    if (session._destroyed) return;
    if (!session.rtc.ok) {
      session.peerOpen = false;
      session.peerGaveUp = true;
      session.peerDetail = session.rtc.reason;
      mark();
      return;
    }
    const Peer = peerCtor();
    if (!Peer) {
      session.peerOpen = false;
      session.peerGaveUp = true;
      session.peerDetail = '沒有載入 PeerJS';
      mark();
      return;
    }
    const gen = ++session._gen;
    let next;
    try { next = new Peer(peerIdFor(session.code), peerOptions()); }
    catch (e) {
      session.peerGaveUp = true;
      session.peerDetail = failText(e);
      mark();
      return;
    }
    peer = next;
    const giveUp = arm(deadlines, 10000, () => {
      if (gen !== session._gen || session.peerOpen) return;
      session.peerGaveUp = true;
      session.peerDetail = session.peerDetail || '掃碼伺服器 10 秒沒有回應';
      mark();
    });
    next.on('open', () => {
      if (gen !== session._gen || session._destroyed) return;
      giveUp();
      session.peerOpen = true;
      session.peerGaveUp = false;
      session.peerDetail = '';
      session.attempt = 0;
      mark();
    });
    next.on('connection', (conn) => {
      if (gen !== session._gen) return;
      session.linking = true;
      mark();
      const pc = conn.peerConnection;
      if (pc && pc.addEventListener) {
        pc.addEventListener('iceconnectionstatechange', () => {
          const st = pc.iceConnectionState;
          if (st === 'checking') { session.linking = true; mark(); }
          if (st === 'failed') {
            session.linking = false;
            session.peerDetail = 'WebRTC ICE 失敗';
            mark();
          }
        });
      }
      accept(conn);
    });
    next.on('disconnected', () => {
      if (gen !== session._gen || session._destroyed) return;
      session.peerOpen = false;
      session.peerDetail = '掃碼登記中斷，正在用同一組代碼重新登記';
      mark();
      try { next.reconnect(); } catch (e) {}
      arm(deadlines, 6000, () => {
        if (gen === session._gen && !session.peerOpen) reopenSame();
      });
    });
    next.on('error', (err) => {
      if (gen !== session._gen || session._destroyed) return;
      const type = err && err.type;
      if (type === 'unavailable-id' && session.attempt < 2) {
        session.attempt++;
        giveUp();
        try { next.destroy(); } catch (e) {}
        session.peerDetail = '這組代碼暫時被占用，正在再用同一組登記';
        mark();
        setTimeout(() => { if (gen === session._gen) openPeer(); }, 700);
        return;
      }
      if (type === 'unavailable-id') {
        session.attempt = 0;
        session.code = makeRoomCode();
        session.peerDetail = '代碼已更換，請重新掃描';
        try { next.destroy(); } catch (e) {}
        startRelay();
        openPeer();
        return;
      }
      if (type === 'network' || type === 'socket-error' || type === 'socket-closed' || type === 'disconnected' || type === 'server-error') {
        session.peerOpen = false;
        session.peerDetail = '掃碼伺服器連線不穩';
        mark();
        try { next.reconnect(); } catch (e) {}
        return;
      }
      session.peerGaveUp = true;
      session.peerOpen = false;
      session.peerDetail = failText(err);
      mark();
    });
  }

  function reopenSame() {
    if (session._destroyed || session._reopening) return;
    session._reopening = true;
    session.peerOpen = false;
    session.peerDetail = '掃碼登記中斷，正在用同一組代碼重新登記';
    mark();
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = null;
    setTimeout(() => {
      session._reopening = false;
      if (!session._destroyed) openPeer();
    }, 400);
  }

  session.broadcast = (build, force) => {
    if (session._destroyed || !session.remotes.length) return;
    const now = performance.now();
    const gap = session.remotes.some((r) => r.via === 'ws') ? Math.max(STATE_GAP_MS, 100) : STATE_GAP_MS;
    if (!force && now - session.lastSend < gap) return;
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
  session.poll = (now) => {
    if (session._destroyed) return;
    runDue(deadlines, now);
    if (relay) relay.poll(now);
    if (session.peerOpen || !session.rtc.ok) return;
    if (session._reopening || now - lastKick < 8000) return;
    if (!session.peerGaveUp && !session.peerDetail) return;
    lastKick = now;
    if (peer && peer.disconnected) {
      try { peer.reconnect(); } catch (e) {}
      return;
    }
    reopenSame();
  };
  session.destroy = () => {
    session._destroyed = true;
    session._gen++;
    const list = session.remotes.splice(0);
    for (const remote of list) {
      try { remote.conn.close(); } catch (e) {}
    }
    try { if (relay) relay.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = null;
    relay = null;
  };
  session.url = joinUrl(session.code, globalThis.location);
  if (!session.rtc.ok) session.peerDetail = session.rtc.reason;
  emit('wait');
  startRelay();
  openPeer();
  return session;
}

export function createGuest(code, handlers) {
  const h = handlers || {};
  const nonce = clientNonce();
  const deadlines = [];
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
    via: '',
    pathKind: '',
    rtc: webrtcSupport(),
    peerDetail: '',
    rtcGaveUp: false,
    wsOpen: false,
    wsReason: '',
    wsGaveUp: false,
    _destroyed: false,
    _opened: false,
    _failedOnce: false,
    _retried: false,
  };
  let peer = null;
  let conn = null;
  let relay = null;
  let lastHello = 0;

  function emit(kind) {
    const text = guestText();
    if (kind === 'fail') session.failMsg = text;
    try { if (h.onStatus) h.onStatus({ text, kind, via: session.via }); } catch (e) {}
  }

  function guestText() {
    if (session.connected) return '階段：已加入（' + how(session.via || session.pathKind || 'webrtc') + '）。';
    if (session.failed) {
      return '階段：失敗。掃碼：' + (session.peerDetail || '沒有接通') + '。網頁中繼：' + (session.wsReason || '沒有接通') + '。';
    }
    if (!session.rtc.ok) return '階段：這台手機沒有 WebRTC（' + session.rtc.reason + '）。' + wsLine();
    if (session._opened && !session.connected && !session.rtcGaveUp) return '階段：WebRTC 已接通，等待房主歡迎訊息…';
    if (session.rtcGaveUp && session.peerDetail) return '階段：' + session.peerDetail + '。' + wsLine();
    if (session._signalled) return '階段：已找到房間，正在建立 WebRTC（會試免費 TURN 中繼）…';
    if (session._finding) return '階段：掃碼伺服器已連上，正在尋找房間 ' + formatCode(code) + '…';
    return '階段：正在連上掃碼伺服器… ' + wsLine();
  }

  function wsLine() {
    if (session.wsOpen) return '網頁中繼已連上，等待車機回應…';
    return '網頁中繼：' + (session.wsReason || '連線中');
  }

  function retireRelay() {
    if (!relay || session._relayClosed) return;
    session._relayClosed = true;
    const dying = relay;
    relay = null;
    session.wsOpen = false;
    setTimeout(() => { try { dying.close(); } catch (e) {} }, 30);
  }
  function retirePeer() {
    if (session._peerClosed) return;
    session._peerClosed = true;
    const dyingConn = conn;
    const dyingPeer = peer;
    conn = null;
    peer = null;
    setTimeout(() => {
      try { if (dyingConn) dyingConn.close(); } catch (e) {}
      try { if (dyingPeer) dyingPeer.destroy(); } catch (e) {}
    }, 30);
  }

  function checkDone() {
    if (session.connected && session.via === 'ws' && session.rtcGaveUp) retirePeer();
    if (session.connected || session._destroyed || session._failedOnce) return;
    if (!(session.rtcGaveUp && session.wsGaveUp)) {
      emit(session.peerDetail ? 'warn' : 'wait');
      return;
    }
    session._failedOnce = true;
    session.failed = true;
    session.failMsg = guestText();
    emit('fail');
    try { if (h.onFail) h.onFail(session.failMsg); } catch (e) {}
  }

  function send(msg) {
    if (!msg) return;
    if (!msg.nonce) msg = Object.assign({ nonce }, msg);
    const useRtc = session.via !== 'ws' && conn && conn.open;
    if (useRtc) {
      try { conn.send(msg); } catch (e) {}
      if (session.via && session.via !== 'ws' && msg.t !== 'bye') return;
    }
    if (!session.via || session.via === 'ws' || msg.t === 'bye') {
      try { if (relay) relay.send(Object.assign({ from: nonce }, msg)); } catch (e) {}
    }
  }
  session.send = send;

  function take(data, via) {
    if (session._destroyed || !data || typeof data !== 'object') return;
    if (via === 'ws' && session.via && session.via !== 'ws') return;
    if (data.t === 'welcome') {
      session.connected = true;
      session.failed = false;
      session.via = via === 'ws' ? 'ws' : (session.pathKind || 'webrtc');
      if (session.via !== 'ws') retireRelay();
      else if (session.rtcGaveUp) retirePeer();
      emit('ok');
      try { if (h.onWelcome) h.onWelcome(data); } catch (e) {}
    } else if (data.t === 'state') {
      if (via === 'webrtc') session.via = session.pathKind || 'webrtc';
      else if (!session.via) session.via = 'ws';
      session.connected = true;
      if (session.via !== 'ws') retireRelay();
      else if (session.rtcGaveUp) retirePeer();
      try { if (h.onState) h.onState(data); } catch (e) {}
    } else if (data.t === 'full') {
      session.full = true;
      session.failed = true;
      session._failedOnce = true;
      session.failMsg = '這個房間已經有一位手機玩家。請等對方離開再加入。';
      try { if (h.onFail) h.onFail(session.failMsg); } catch (e) {}
    } else if (data.t === 'replaced') {
      session.replaced = true;
    } else if (data.t === 'bye') {
      session.connected = false;
      try { if (h.onClose) h.onClose({ replaced: session.replaced, full: session.full }); } catch (e) {}
    }
  }

  session.noteInput = (state, now) => {
    const cmd = packInput(state);
    const last = session.log.length ? session.log[session.log.length - 1] : null;
    const same = last && last.cmd.steer === cmd.steer && last.cmd.throttle === cmd.throttle && last.cmd.brake === cmd.brake
      && last.cmd.lift === cmd.lift && last.cmd.nitro === cmd.nitro && last.cmd.pitch === cmd.pitch;
    const edge = !last || last.cmd.throttle !== cmd.throttle || last.cmd.brake !== cmd.brake
      || last.cmd.lift !== cmd.lift || last.cmd.nitro !== cmd.nitro;
    if (!edge && now - session.lastSend < INPUT_GAP_MS) return session.seq;
    if (edge && last && now - session.lastSend < 32 && same) return session.seq;
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

  function helloRelay() {
    if (!relay || !relay.open || session._destroyed) return;
    try { relay.send({ t: 'hello', nonce, name: 'P3', from: nonce }); } catch (e) {}
  }

  function wireConn(next) {
    next.on('open', () => {
      if (session._destroyed) return;
      session._opened = true;
      emit('wait');
      send({ t: 'hello', nonce, name: 'P3' });
      pathOf(next).then((via) => {
        if (session._destroyed) return;
        session.pathKind = via;
        if (session.connected && session.via !== 'ws') { session.via = via; emit('ok'); }
      });
      arm(deadlines, 8000, () => {
        if (session.connected || session._destroyed) return;
        session.peerDetail = 'WebRTC 已接通，但 8 秒內沒有收到房主的歡迎訊息';
        session.rtcGaveUp = true;
        checkDone();
      });
    });
    next.on('data', (data) => take(data, 'webrtc'));
    next.on('close', () => {
      if (session._destroyed) return;
      session.connected = session.via === 'ws';
      if (session.via === 'ws') return;
      setTimeout(() => {
        if (session._destroyed || session.via === 'ws') return;
        try { if (h.onClose) h.onClose({ replaced: session.replaced, full: session.full }); } catch (e) {}
      }, 400);
    });
    next.on('error', () => {
      if (session._destroyed || session.connected) return;
      session.peerDetail = 'WebRTC 資料通道錯誤';
      session.rtcGaveUp = true;
      checkDone();
    });
  }

  function connectHost() {
    if (!peer || session._destroyed) return;
    session._finding = false;
    session._signalled = true;
    emit('wait');
    try { conn = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' }); }
    catch (e) {
      session.peerDetail = failText(e);
      session.rtcGaveUp = true;
      checkDone();
      return;
    }
    wireConn(conn);
    arm(deadlines, 12000, () => {
      if (session._opened || session.connected || session._destroyed) return;
      session.peerDetail = 'WebRTC 超過 12 秒沒接通（車機 LTE 的 NAT，或瀏覽器擋住資料通道）';
      session.rtcGaveUp = true;
      checkDone();
    });
  }

  function startPeer() {
    if (!session.rtc.ok) {
      session.rtcGaveUp = true;
      session.peerDetail = session.rtc.reason;
      checkDone();
      return;
    }
    const Peer = peerCtor();
    if (!Peer) {
      session.rtcGaveUp = true;
      session.peerDetail = '沒有載入 PeerJS';
      checkDone();
      return;
    }
    try { peer = new Peer(peerOptions()); }
    catch (e) {
      session.rtcGaveUp = true;
      session.peerDetail = failText(e);
      checkDone();
      return;
    }
    arm(deadlines, 10000, () => {
      if (session._finding || session._signalled || session._destroyed || session.connected) return;
      session.peerDetail = '掃碼伺服器 10 秒沒有回應';
      session.rtcGaveUp = true;
      checkDone();
    });
    peer.on('open', () => {
      if (session._destroyed) return;
      session._finding = true;
      emit('wait');
      connectHost();
    });
    peer.on('error', (err) => {
      if (session._destroyed || (session.connected && session.via !== 'ws')) return;
      const type = err && err.type;
      if (type === 'peer-unavailable') {
        session.peerDetail = '掃碼伺服器上找不到房間 ' + formatCode(code) + '（車機可能沒有登記成功）';
        emit('warn');
        if (!session._retried) {
          session._retried = true;
          arm(deadlines, 4000, () => { if (!session.connected && peer && peer.open) connectHost(); });
          return;
        }
        session.rtcGaveUp = true;
        checkDone();
        return;
      }
      if (type === 'disconnected' || type === 'network' || type === 'socket-error' || type === 'server-error') {
        session.peerDetail = '掃碼伺服器連線不穩';
        try { peer.reconnect(); } catch (e) {}
        return;
      }
      session.peerDetail = failText(err);
      session.rtcGaveUp = true;
      checkDone();
    });
  }

  relay = connectRelay(code, {
    onStatus: (s) => {
      session.wsOpen = !!s.open;
      session.wsReason = s.open ? '' : (s.reason || '');
      if (s.failed && !s.open) session.wsGaveUp = true;
      if (!session.connected) checkDone();
    },
    onOpen: () => {
      session.wsOpen = true;
      session.wsGaveUp = false;
      helloRelay();
      lastHello = performance.now();
      if (!session.connected) emit('wait');
    },
    onMessage: (msg) => {
      if (!msg || msg.from !== 'host') return;
      take(msg, 'ws');
    },
  });

  session.poll = (now) => {
    if (session._destroyed) return;
    runDue(deadlines, now);
    if (relay) relay.poll(now);
    if (!session.connected && relay && relay.open && now - lastHello > 2000) {
      lastHello = now;
      helloRelay();
    }
  };
  session.destroy = () => {
    if (session._destroyed) return;
    session._destroyed = true;
    try { send({ t: 'bye', nonce }); } catch (e) {}
    try { if (conn) conn.close(); } catch (e) {}
    const dyingRelay = relay;
    const dying = peer;
    conn = null;
    peer = null;
    relay = null;
    // 先讓 bye 送出，再關掉網頁中繼，否則車機收不到離開。
    setTimeout(() => {
      try { if (dyingRelay) dyingRelay.close(); } catch (e) {}
      try { if (dying) dying.destroy(); } catch (e) {}
    }, 120);
  };
  emit('wait');
  startPeer();
  return session;
}
