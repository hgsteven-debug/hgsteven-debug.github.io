// 房主／手機連線。先走 PeerJS（WebRTC，含免費 TURN），同時備一條免費 WebSocket 中繼。
// 斷線只回呼，主機的物理不會等待網路。
import { RemoteDriver } from './race.js';
import {
  REMOTE_LIMIT, makeRoomCode, peerIdFor, joinUrl, failText, packInput, zeroInput, formatCode, normalizeCode,
  STATE_GAP_MS, INPUT_GAP_MS, LINK_STALE_MS, REMOTE_GRACE_MS, hostStillThere,
  INPUT_HISTORY, acceptInputs, stateGapMs, deltaPose, mergePose, linkQuality, linkKind, lanIsolationHint,
} from './sync.js';
import { webrtcSupport, rtcConfig, nextJoinStage, JOIN_TOTAL_MS } from './ice.js';
import { connectRelayFan } from './relay.js';
import { t, getLocale } from './i18n.js';

export { REMOTE_LIMIT };

function peerOptions() {
  return {
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    debug: 0,
    pingInterval: 3000,
    config: rtcConfig(),
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

function pathOf(conn, bag) {
  if (!conn || !conn.peerConnection || typeof conn.peerConnection.getStats !== 'function') return Promise.resolve('webrtc');
  return conn.peerConnection.getStats().then((stats) => {
    let selected = null;
    let sawLocal = false;
    let sawRemote = false;
    stats.forEach((r) => {
      if (r.type === 'candidate-pair' && (r.selected || r.nominated) && r.state === 'succeeded') selected = r;
      if (r.type === 'local-candidate' && r.candidateType === 'host') sawLocal = true;
      if (r.type === 'remote-candidate' && r.candidateType === 'host') sawRemote = true;
    });
    if (bag) {
      if (sawLocal) bag.sawLocalHost = true;
      if (sawRemote) bag.sawRemoteHost = true;
    }
    if (!selected) return 'webrtc';
    const local = stats.get(selected.localCandidateId);
    const remote = stats.get(selected.remoteCandidateId);
    const types = [local && local.candidateType, remote && remote.candidateType];
    return types.indexOf('relay') >= 0 ? 'relay' : 'direct';
  }).catch(() => 'webrtc');
}

function noteCandidate(bag, cand) {
  if (!bag || !cand) return;
  const typ = cand.type || '';
  const text = cand.candidate || '';
  let kind = typ;
  if (text.indexOf('typ relay') >= 0) kind = 'relay';
  else if (text.indexOf('typ srflx') >= 0) kind = 'srflx';
  else if (text.indexOf('typ prflx') >= 0) kind = 'prflx';
  else if (text.indexOf('typ host') >= 0 || text.indexOf('.local') >= 0) kind = 'host';
  if (kind === 'host' || text.indexOf('typ host') >= 0 || text.indexOf('.local') >= 0) bag.sawLocalHost = true;
  if (!bag.candTypes) bag.candTypes = { host: 0, srflx: 0, relay: 0, prflx: 0 };
  if (bag.candTypes[kind] != null) bag.candTypes[kind]++;
}

function restartIce(pc, bag) {
  if (!pc || typeof pc.restartIce !== 'function') return;
  if (bag && bag._iceOnce) return;
  if (bag) bag._iceOnce = true;
  try { pc.restartIce(); } catch (e) {}
}

function promoteTurn(pc, bag) {
  if (!pc) return;
  try {
    if (typeof pc.setConfiguration === 'function') {
      const cfg = typeof pc.getConfiguration === 'function' ? pc.getConfiguration() : {};
      cfg.iceTransportPolicy = 'relay';
      pc.setConfiguration(cfg);
    }
  } catch (e) {}
  try { pc.restartIce(); } catch (e) {}
  if (bag) bag._iceOnce = true;
}

function watchIce(pc, bag, onChange) {
  if (!pc || !pc.addEventListener || pc._skyWatch) return;
  pc._skyWatch = true;
  pc.addEventListener('icecandidate', (ev) => noteCandidate(bag, ev && ev.candidate));
  pc.addEventListener('iceconnectionstatechange', () => {
    const st = pc.iceConnectionState;
    if (st === 'disconnected' || st === 'failed') {
      bag.rtcLive = false;
      bag.rejoin = true;
      if (st === 'failed') {
        bag.iceFailed = true;
        restartIce(pc, bag);
      }
    } else if (st === 'connected' || st === 'completed') {
      bag.rejoin = false;
      bag.iceFailed = false;
    }
    try { if (onChange) onChange(st); } catch (e) {}
  });
}

function sampleLink(s) {
  const via = s.via || '';
  const kind = linkKind(via);
  const rtt = Number.isFinite(s.rtt) ? s.rtt : null;
  const age = s.lastPeerAt ? performance.now() - s.lastPeerAt : null;
  const show = !!(kind || s.rejoin || s.connected || s.heardHost);
  return {
    show,
    tier: linkQuality({ rtt, via: kind ? via : '', age }),
    kind,
    rtt,
    rejoin: !!s.rejoin,
    hint: s.policy !== 'relay' && lanIsolationHint({
      iceFailed: !!s.iceFailed,
      sawLocalHost: !!s.sawLocalHost,
      sawRemoteHost: !!s.sawRemoteHost,
      via,
    }),
  };
}

function relayOpts(h, role, index, epoch) {
  return Object.assign({}, (h && h.relayOpts) || {}, { role, index, epoch });
}

function labelVia(via, policy) {
  if (policy === 'relay' && (!via || via === 'webrtc')) return 'relay';
  return via;
}

function how(via) {
  if (via === 'ws') return t('how.ws');
  if (via === 'relay') return t('how.turn');
  if (via === 'direct') return t('how.direct');
  if (via === 'webrtc') return t('how.webrtc');
  return t('how.checking');
}

function detailOf(value, fallbackKey, vars) {
  return t(value || fallbackKey, vars);
}

export function createHost(handlers) {
  const h = handlers || {};
  const deadlines = [];
  const wsPeers = new Map();
  const session = {
    role: 'host',
    code: normalizeCode(h.code || '') || makeRoomCode(),
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
    relayIndex: 0,
    relayEpoch: 0,
    policy: rtcConfig().iceTransportPolicy,
    sawLocalHost: false,
    sawRemoteHost: false,
    iceFailed: false,
    rejoin: false,
    stage: rtcConfig().iceTransportPolicy === 'relay' ? 'turn' : 'direct',
    candTypes: { host: 0, srflx: 0, relay: 0, prflx: 0 },
    _joinT: performance.now(),
    _destroyed: false,
    _gen: 0,
    _reopening: false,
  };
  let peer = null;
  let relay = null;
  let lastKick = 0;

  function relayQuery() {
    return { index: relay && Number.isFinite(relay.index) ? relay.index : session.relayIndex, epoch: relay && Number.isFinite(relay.epoch) ? relay.epoch : session.relayEpoch };
  }

  function emit(kind) {
    const q = relayQuery();
    session.relayIndex = q.index;
    session.relayEpoch = q.epoch;
    session.url = joinUrl(session.code, globalThis.location, q, getLocale());
    const text = hostText();
    session.failMsg = session.failed ? text : '';
    try { if (h.onStatus) h.onStatus({ text, kind, code: session.code, url: session.url, ready: session.ready, failed: session.failed }); }
    catch (e) {}
  }

  function wsReasonNow() {
    if (session.wsReasonKey) return t(session.wsReasonKey, { label: session.wsReasonLabel || '' });
    return session.wsReason || t('ws.connecting');
  }

  function hostText() {
    const rtcBit = session.rtc.ok ? t('rtc.ok') : t('rtc.bad', { reason: session.rtc.reason });
    const wsBit = session.wsOpen ? t('ws.openWait') : t('ws.line', { reason: wsReasonNow() });
    if (session.remotes.length) {
      const remote = session.remotes[0];
      if (remote.holding) return t('host.hold', { ws: wsBit });
      return t('host.joined', { how: how(remote.via) });
    }
    if (session.linking) return t('host.linking', { rtc: rtcBit, ws: wsBit });
    if (session.failed) return t('host.fail', { detail: detailOf(session.peerDetail, 'peer.detailNone'), ws: wsBit, rtc: rtcBit });
    if (session.peerOpen && session.wsOpen) return t('host.ready', { rtc: rtcBit, ws: wsBit });
    if (session.peerOpen) return t('host.peerOnly', { ws: wsBit, rtc: rtcBit });
    if (session.wsOpen) return t('host.wsOnly', { detail: detailOf(session.peerDetail, 'ws.connecting'), rtc: rtcBit });
    return t('host.wait', { ws: wsBit, rtc: rtcBit });
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
    remote.holding = false;
    try { if (remote.driver) remote.driver.push(zeroInput()); } catch (e) {}
    try { if (remote.conn && remote.conn.open) remote.conn.send({ t: why === 'replaced' ? 'replaced' : 'bye' }); } catch (e) {}
    try { if (remote.conn && remote.conn !== remote._kept) remote.conn.close(); } catch (e) {}
    try { if (h.onLeave) h.onLeave(remote, why); } catch (e) {}
    if (!session.remotes.length) mark();
  }

  function touchRemote(remote) {
    if (!remote) return;
    remote.lastBeat = performance.now();
    remote.supersede = false;
    if (remote.holding) {
      remote.holding = false;
      remote.heldAt = 0;
      mark();
    }
  }

  // 訊號閃斷先留著同一台車。煞車讓它慢下來，圈數和位置都不清。
  function holdRemote(remote) {
    if (!remote || remote.holding) return;
    if (session.remotes.indexOf(remote) < 0) return;
    remote.holding = true;
    remote.heldAt = performance.now();
    remote.cmd = { steer: 0, throttle: 0, brake: 1, lift: false, nitro: false, pitch: 0 };
    remote.lastAt = performance.now();
    try { if (remote.driver) remote.driver.push(remote.cmd); } catch (e) {}
    mark();
  }

  function expireHeld(now) {
    for (const remote of session.remotes.slice()) {
      if (remote.holding && remote.heldAt && now - remote.heldAt >= REMOTE_GRACE_MS) drop(remote, 'timeout');
      else if (!remote.holding && remote.via === 'ws') {
        const beat = remote.lastBeat || remote.joinedAt || 0;
        if (beat && now - beat >= LINK_STALE_MS) holdRemote(remote);
      }
    }
  }

  function nameFor(slot) { return 'P' + (3 + slot); }

  function prove(remote) {
    if (remote && remote.dcSeen && remote.iceUp) remote.rtcLive = true;
  }

  function greet(conn, remote) {
    const welcome = h.welcome ? h.welcome(remote) : { t: 'welcome', name: remote.name, slot: remote.slot };
    const st = h.state && h.state(remote);
    try { conn.send(welcome); } catch (e) {}
    try { if (st) conn.send(st); } catch (e) {}
    if (remote && remote.rtcLive !== true && relay && conn && conn._skyVia !== 'ws') {
      try { relay.send(Object.assign({ from: 'host', nonce: remote.nonce }, welcome)); } catch (e) {}
      try { if (st) relay.send(Object.assign({ from: 'host', nonce: remote.nonce }, st)); } catch (e) {}
    }
  }

  function resumeRemote(conn, prev, incoming) {
    const old = prev.conn;
    prev.holding = false;
    prev.heldAt = 0;
    prev.supersede = false;
    prev.conn = conn;
    prev.via = incoming;
    conn._skyJoined = true;
    touchRemote(prev);
    try { if (old && old !== conn) old.close(); } catch (e) {}
    if (!prev.racer) {
      try { if (h.onJoin) h.onJoin(prev); } catch (e) {}
    }
    greet(conn, prev);
    mark();
    if (incoming !== 'ws') {
      pathOf(conn).then((via) => {
        if (session._destroyed || prev.conn !== conn) return;
        prev.via = labelVia(via, session.policy);
        mark();
      });
    }
  }

  function adopt(conn, nonce) {
    if (conn._skyJoined || session._destroyed) return;
    const incoming = conn._skyVia || 'webrtc';
    const prev = nonce ? session.remotes.find((r) => r.nonce === nonce) : null;
    if (prev && incoming === 'ws' && prev.rtcLive === true && prev.via !== 'ws' && prev.conn && prev.conn.open && !prev.holding) {
      try { conn.close(); } catch (e) {}
      return;
    }
    // 資料通道還沒送達過封包時，手機的中繼 hello 仍要回歡迎，否則車機以為連上了、手機卻停在選單。
    if (prev && incoming === 'ws' && prev.rtcLive !== true && prev.conn && prev.conn !== conn) {
      touchRemote(prev);
      greet(conn, prev);
      return;
    }
    if (prev) {
      resumeRemote(conn, prev, incoming);
      return;
    }
    while (session.remotes.length >= REMOTE_LIMIT) {
      const cur = session.remotes[0];
      const age = performance.now() - (cur.lastAt || cur.joinedAt || 0);
      const fresh = !cur.holding && !cur.supersede && !!(cur.conn && cur.conn.open) && age < 2500;
      if (fresh) {
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
      lastBeat: performance.now(),
      holding: false,
      heldAt: 0,
      driver: new RemoteDriver(),
      racer: null,
      via: incoming,
    };
    session.remotes.push(remote);
    session.linking = false;
    try { if (h.onJoin) h.onJoin(remote); } catch (e) {}
    greet(conn, remote);
    mark();
    if (incoming !== 'ws') {
      pathOf(conn).then((via) => {
        if (session._destroyed || remote.conn !== conn) return;
        remote.via = labelVia(via, session.policy);
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
      if (conn._skyVia !== 'ws') {
        remote.dcSeen = true;
        prove(remote);
        if (remote.rtcLive) {
          if (remote.pathKind) remote.via = remote.pathKind;
          else if (!remote.via || remote.via === 'ws') remote.via = 'webrtc';
        }
      }
      if (data.t === 'input') {
        if (data.lan) { remote.sawRemoteHost = true; session.sawRemoteHost = true; }
        const applied = acceptInputs(remote, data, performance.now());
        touchRemote(remote);
        if (applied) { try { remote.driver.push(remote.cmd); } catch (e) {} }
      } else if (data.t === 'pong') {
        if (data.lan) { remote.sawRemoteHost = true; session.sawRemoteHost = true; }
        if (Number.isFinite(+data.at)) remote.rtt = Math.max(0, performance.now() - (+data.at));
        remote.linkTier = linkQuality({ rtt: remote.rtt, via: remote.via || 'webrtc', age: 0 });
        touchRemote(remote);
      } else if (data.t === 'hello') {
        if (data.nonce) remote.nonce = data.nonce;
        touchRemote(remote);
        greet(conn, remote);
      } else if (data.t === 'ping') {
        if (data.lan) { remote.sawRemoteHost = true; session.sawRemoteHost = true; }
        touchRemote(remote);
        try { conn.send({ t: 'pong', n: data.n, at: data.at, nonce: remote.nonce, lan: session.sawLocalHost ? 1 : 0, relay: relayQuery().index, epoch: relayQuery().epoch }); } catch (e) {}
      } else if (data.t === 'bye') {
        if (data.gone) drop(remote, 'leave');
        else {
          // 剛接回的 hello 後 1 秒內，舊的 bye 不能把車又按住。但仍讓出位子給另一台手機。
          remote.supersede = true;
          if (performance.now() - (remote.lastBeat || 0) > 1000) holdRemote(remote);
        }
      } else if (data.t === 'reset') {
        try { if (h.onReset) h.onReset(remote); } catch (e) {}
      } else if (data.t === 'car') {
        try { if (h.onCar) h.onCar(remote, data); } catch (e) {}
      }
    });
    conn.on('close', () => {
      const remote = session.remotes.find((r) => r.conn === conn);
      if (remote && relay && relay.open && conn._skyVia !== 'ws') {
        remote.rtcLive = false;
        remote.dcSeen = false;
        remote.iceUp = false;
        remote.via = 'ws';
        remote.rejoin = true;
        return;
      }
      holdRemote(remote);
    });
    conn.on('error', () => holdRemote(session.remotes.find((r) => r.conn === conn)));
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
    if (msg.t === 'ping') {
      if (msg.lan) session.sawRemoteHost = true;
      try {
        relay.send({ t: 'pong', n: msg.n, at: msg.at, nonce, lan: session.sawLocalHost ? 1 : 0, relay: relay.index, epoch: relay.epoch, from: 'host' });
      } catch (e) {}
      const known = session.remotes.find((r) => r.nonce === nonce || r.nonce === msg.from);
      if (known) touchRemote(known);
      return;
    }
    if (msg.t === 'bye') {
      const matches = session.remotes.filter((r) => (r.nonce === nonce || r.nonce === msg.from) && r.via === 'ws');
      for (const remote of matches) {
        if (msg.gone) drop(remote, 'leave');
        else {
          remote.supersede = true;
          if (performance.now() - (remote.lastBeat || 0) > 1000) holdRemote(remote);
        }
      }
      return;
    }
    const webrtc = session.remotes.find((r) => r.nonce === nonce && r.rtcLive === true && r.via !== 'ws' && r.conn && r.conn.open);
    if (webrtc && msg.t === 'reset') {
      try { if (h.onReset) h.onReset(webrtc); } catch (e) {}
      return;
    }
    if (webrtc) return;
    wsPeer(nonce).emit('data', msg);
  }

  function startRelay() {
    if (relay) { try { relay.close(); } catch (e) {} }
    session.wsOpen = false;
    session.wsGaveUp = false;
    relay = connectRelayFan(session.code, {
      onStatus: (s) => {
        session.wsOpen = !!s.open;
        session.wsReason = s.open ? '' : (s.reason || '');
        session.wsReasonKey = s.open ? '' : (s.reasonKey || '');
        session.wsReasonLabel = s.open ? '' : (s.reasonLabel || '');
        session.wsGaveUp = false;
        if (Number.isFinite(s.index)) session.relayIndex = s.index;
        if (Number.isFinite(s.epoch)) session.relayEpoch = s.epoch;
        mark();
      },
      onOpen: () => {
        session.wsOpen = true;
        session.wsGaveUp = false;
        try { relay.send({ t: 'broker', relay: relay.index, epoch: relay.epoch, from: 'host' }); } catch (e) {}
        mark();
      },
      onFailover: () => { mark(); },
      onMessage: onRelayMessage,
    }, relayOpts(h, 'host', session.relayIndex, session.relayEpoch));
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
      session.peerDetail = 'peer.missing';
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
      session.peerDetail = session.peerDetail || 'peer.slow';
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
      if (pc) {
        const bag = { sawLocalHost: session.sawLocalHost, rtcLive: true, rejoin: false, iceFailed: false, candTypes: { host: 0, srflx: 0, relay: 0, prflx: 0 } };
        conn._skyBag = bag;
        watchIce(pc, bag, (st) => {
          session.sawLocalHost = session.sawLocalHost || bag.sawLocalHost;
          const remote = session.remotes.find((r) => r.conn === conn);
          const target = remote || session;
          if (st === 'connected' || st === 'completed') target.iceUp = true;
          if (bag.rtcLive === false) target.rtcLive = false;
          target.rejoin = bag.rejoin;
          target.iceFailed = bag.iceFailed;
          if (bag.sawLocalHost) target.sawLocalHost = true;
          prove(target);
          session.iceFailed = !!bag.iceFailed;
          session.rejoin = !!bag.rejoin;
          if (st === 'checking') session.linking = true;
          if (st === 'failed' || st === 'disconnected') {
            session.linking = false;
            session.peerDetail = 'peer.rejoin';
            if (remote && remote.rtcLive === false) remote.via = session.wsOpen ? 'ws' : remote.via;
          }
          if (st === 'connected' || st === 'completed') {
            pathOf(conn, session).then((via) => {
              if (session._destroyed) return;
              if (remote && remote.conn === conn) {
                remote.pathKind = labelVia(via, session.policy);
                if (remote.rtcLive === true) {
                  remote.via = remote.pathKind;
                  remote.linkTier = linkQuality({ rtt: remote.rtt, via, age: 0 });
                }
              }
              mark();
            });
          }
          mark();
        });
      }
      accept(conn);
    });
    next.on('disconnected', () => {
      if (gen !== session._gen || session._destroyed) return;
      session.peerOpen = false;
      session.peerDetail = 'peer.rejoin';
      session.rejoin = true;
      mark();
      try {
        if (next.connections && typeof next.connections.forEach === 'function') {
          next.connections.forEach((list) => {
            const arr = Array.isArray(list) ? list : [list];
            for (const c of arr) restartIce(c && c.peerConnection, session);
          });
        }
      } catch (e) {}
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
        session.peerDetail = 'peer.busy';
        mark();
        setTimeout(() => { if (gen === session._gen) openPeer(); }, 700);
        return;
      }
      if (type === 'unavailable-id') {
        session.attempt = 0;
        session.code = makeRoomCode();
        session.peerDetail = 'peer.newCode';
        try { next.destroy(); } catch (e) {}
        startRelay();
        openPeer();
        return;
      }
      if (type === 'network' || type === 'socket-error' || type === 'socket-closed' || type === 'disconnected' || type === 'server-error') {
        session.peerOpen = false;
        session.peerDetail = 'peer.unstable';
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
    session.peerDetail = 'peer.rejoin';
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
    let gap = STATE_GAP_MS;
    for (const remote of session.remotes) {
      const floor = remote.via === 'ws' ? Math.max(STATE_GAP_MS, 100) : STATE_GAP_MS;
      gap = Math.max(gap, stateGapMs(remote.linkTier || 'good', floor));
    }
    if (!force && now - session.lastSend < gap) return;
    session.lastSend = now;
    for (let i = 0; i < session.remotes.length; i++) {
      const remote = session.remotes[i];
      try {
        let msg = build(remote);
        if (!msg) continue;
        if (msg.t === 'state' && msg.self) {
          remote._stateN = (remote._stateN || 0) + 1;
          const prev = remote._lastSelf;
          remote._lastSelf = msg.self;
          if (prev && !force && remote._stateN % 8 !== 0) {
            const d = deltaPose(prev, msg.self);
            if (d) {
              msg = Object.assign({}, msg);
              delete msg.self;
              if (Object.keys(d).length) msg.dself = d;
            }
          }
        }
        if (session.sawLocalHost) msg.lan = 1;
        const dc = remote.conn && remote.conn.open && remote.conn._skyVia !== 'ws' && remote.via !== 'ws';
        if (dc && remote.rtcLive !== false) {
          try { remote.conn.send(msg); } catch (e) { remote.rtcLive = false; }
        }
        if (remote.rtcLive !== true && relay) relay.send(Object.assign({ from: 'host', nonce: remote.nonce }, msg));
        session.sent = (session.sent || 0) + 1;
      } catch (e) { session.lastErr = String(e && e.message || e); }
    }
  };
  session.send = (remote, msg) => {
    try { if (remote && remote.conn && remote.conn.open && msg) remote.conn.send(msg); } catch (e) {}
  };
  function tickHostJoin(now) {
    for (const remote of session.remotes) {
      if (!remote || remote.holding) continue;
      const age = now - (remote.joinedAt || now);
      const live = remote.rtcLive === true || (remote.via === 'ws' && remote.lastBeat && now - remote.lastBeat < 2500);
      const stage = nextJoinStage({
        age,
        rtcOk: !!session.rtc.ok,
        proven: live,
        connected: live,
        policy: session.policy,
        iceDirect: !!(remote.iceUp && remote.pathKind === 'direct'),
        via: live ? (remote.rtcLive === true ? (remote.pathKind || remote.via || 'direct') : 'ws') : '',
      });
      remote.stage = stage;
      if (!live && stage === 'turn' && !remote._turnTried && session.policy !== 'relay') {
        remote._turnTried = true;
        promoteTurn(remote.conn && remote.conn.peerConnection, remote.conn && remote.conn._skyBag);
      }
      if (!live && stage === 'mqtt' && remote.stageAt !== 'mqtt') {
        remote.stageAt = 'mqtt';
        remote.rtcLive = false;
        if (!remote.via || remote.via === 'webrtc') remote.via = 'ws';
      }
      const bag = remote.conn && remote.conn._skyBag;
      if (bag && bag.candTypes) remote.candTypes = bag.candTypes;
    }
    const r0 = session.remotes[0];
    session.stage = r0 && r0.stage ? r0.stage : session.stage;
  }
  session.poll = (now) => {
    if (session._destroyed) return;
    runDue(deadlines, now);
    if (relay) relay.poll(now);
    tickHostJoin(now);
    expireHeld(now);
    for (const remote of session.remotes) {
      if (now - (remote._pingAt || 0) < 1000) continue;
      remote._pingAt = now;
      const ping = { t: 'ping', n: (remote._pingN = (remote._pingN || 0) + 1), at: now, lan: session.sawLocalHost ? 1 : 0, nonce: remote.nonce };
      const rtcUp = remote.rtcLive !== false && remote.via !== 'ws' && remote.conn && remote.conn.open && remote.conn._skyVia !== 'ws';
      try {
        if (rtcUp) remote.conn.send(ping);
        else if (relay) relay.send(Object.assign({ from: 'host' }, ping));
      } catch (e) {}
    }
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
  session.debugJoin = (nonce) => {
    const hs = {};
    const conn = {
      open: true,
      peer: 'debug-' + nonce,
      _skyVia: 'ws',
      on(ev, fn) { (hs[ev] = hs[ev] || []).push(fn); },
      emit(ev, arg) { (hs[ev] || []).forEach((fn) => { try { fn(arg); } catch (e) {} }); },
      send() {},
      close() { this.open = false; this.emit('close'); },
    };
    accept(conn);
    conn.emit('data', { t: 'hello', nonce: nonce || 'p3', name: 'P3' });
    return session.remotes.find((r) => r.nonce === (nonce || 'p3')) || null;
  };
  session.debugBlip = () => {
    const remote = session.remotes[0];
    if (remote) holdRemote(remote);
    return !!remote;
  };
  session.joinDebug = () => {
    const remote = session.remotes[0];
    const bag = (remote && remote.conn && remote.conn._skyBag) || session;
    const c = (remote && remote.candTypes) || bag.candTypes || session.candTypes || {};
    return {
      stage: (remote && remote.stage) || session.stage || '',
      signal: session.peerOpen ? 'open' : (session.peerDetail || 'boot'),
      cand: 'host ' + (c.host || 0) + ' srflx ' + (c.srflx || 0) + ' relay ' + (c.relay || 0) + ' prflx ' + (c.prflx || 0),
      pair: (remote && (remote.pathKind || remote.via)) || '',
      proven: remote && remote.rtcLive === true ? 1 : 0,
      via: remote ? remote.via : '',
      rtc: remote ? remote.rtcLive : null,
    };
  };
  session.debugExpire = () => {
    const remote = session.remotes.find((r) => r.holding) || session.remotes[0];
    if (!remote) return false;
    remote.holding = true;
    remote.heldAt = performance.now() - REMOTE_GRACE_MS - 5;
    expireHeld(performance.now());
    return true;
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
  session.url = joinUrl(session.code, globalThis.location, null, getLocale());
  session.relabel = () => { if (!session._destroyed) mark(); };
  session.linkSample = () => {
    const remote = session.remotes[0];
    return sampleLink({
      via: remote ? remote.via : '',
      rtt: remote && Number.isFinite(remote.rtt) ? remote.rtt : null,
      lastPeerAt: remote ? (remote.lastBeat || remote.lastAt || 0) : 0,
      rejoin: !!((remote && remote.rejoin) || session.rejoin),
      connected: !!(remote && !remote.holding),
      heardHost: !!remote,
      iceFailed: !!((remote && remote.iceFailed) || session.iceFailed),
      sawLocalHost: !!(session.sawLocalHost || (remote && remote.sawLocalHost)),
      sawRemoteHost: !!(session.sawRemoteHost || (remote && remote.sawRemoteHost)),
      policy: session.policy,
    });
  };
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
    heardHost: false,
    lastPeerAt: 0,
    policy: rtcConfig().iceTransportPolicy,
    stage: !webrtcSupport().ok ? 'mqtt' : (rtcConfig().iceTransportPolicy === 'relay' ? 'turn' : 'direct'),
    stageAt: performance.now(),
    _joinT: performance.now(),
    candTypes: { host: 0, srflx: 0, relay: 0, prflx: 0 },
    provenAt: 0,
    _turnTried: rtcConfig().iceTransportPolicy === 'relay',
    sawLocalHost: false,
    sawRemoteHost: false,
    iceFailed: false,
    rejoin: false,
    rtcLive: null,
    rtt: null,
  };
  let peer = null;
  let conn = null;
  let relay = null;
  let lastHello = 0;
  let lastPing = 0;
  let pingN = 0;
  const relayIndex = Number.isFinite(+h.relayIndex) ? (+h.relayIndex | 0) : 0;
  const relayEpoch = Number.isFinite(+h.relayEpoch) ? (+h.relayEpoch | 0) : 0;

  function emit(kind) {
    const text = guestText();
    if (kind === 'fail') session.failMsg = text;
    try { if (h.onStatus) h.onStatus({ text, kind, via: session.via }); } catch (e) {}
  }

  function guestWsReason() {
    if (session.wsReasonKey) return t(session.wsReasonKey, { label: session.wsReasonLabel || '' });
    return session.wsReason || t('ws.connecting');
  }

  function guestText() {
    const codeLabel = formatCode(code);
    if (session.connected && hostStillThere(session.lastPeerAt, performance.now())) return t('guest.joined', { how: how(session.via || session.pathKind || 'webrtc') });
    if (session.failed) return t('guest.fail', { detail: detailOf(session.peerDetail, 'peer.detailNone2', { code: codeLabel }), ws: session.wsReasonKey ? guestWsReason() : (session.wsReason || t('ws.down')) });
    if (!session.rtc.ok) return t('guest.noRtc', { reason: session.rtc.reason, ws: wsLine() });
    if (session._opened && !session.connected && !session.rtcGaveUp) return t('guest.opened');
    if (session.rtcGaveUp && session.peerDetail) return t('guest.detail', { detail: detailOf(session.peerDetail, 'peer.detailNone2', { code: codeLabel }), ws: wsLine() });
    if (session._signalled) return t('guest.signal');
    if (session._finding) return t('guest.find', { code: codeLabel });
    return t('guest.boot', { ws: wsLine() });
  }

  function wsLine() {
    if (session.heardHost) return t('ws.heard');
    if (session.wsOpen) return t('ws.noHost');
    return t('ws.line', { reason: guestWsReason() });
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
    if (session.sawLocalHost) msg.lan = 1;
    let dcOk = false;
    if (conn && conn.open && session.rtcLive !== false) {
      try { conn.send(msg); dcOk = true; } catch (e) { session.rtcLive = false; }
    }
    if (session.rtcLive === true && dcOk && msg.t !== 'bye' && msg.t !== 'reset') return;
    try { if (relay) relay.send(Object.assign({ from: nonce }, msg)); } catch (e) {}
  }
  session.send = send;

  function take(data, via) {
    if (session._destroyed || !data || typeof data !== 'object') return;
    if (via === 'ws' && session.rtcLive) return;
    if (data.lan) session.sawRemoteHost = true;
    if (data.t === 'ping' || data.t === 'pong' || data.t === 'welcome' || data.t === 'state' || data.t === 'input') {
      session.provenAt = performance.now();
    }
    if (data.t === 'ping') {
      send({ t: 'pong', n: data.n, at: data.at, lan: session.sawLocalHost ? 1 : 0 });
      return;
    }
    if (data.dself) data = Object.assign({}, data, { self: mergePose(session._self, data.dself) });
    if (data.self) session._self = data.self;
    else if (session._self && data.t === 'state') data = Object.assign({}, data, { self: session._self });
    if (data.t === 'pong' || data.t === 'broker') {
      session.lastPeerAt = performance.now();
      session.heardHost = true;
      if (data.t === 'pong' && Number.isFinite(+data.at)) session.rtt = Math.max(0, performance.now() - (+data.at));
      if (relay && Number.isFinite(+data.epoch)) relay.pin(data.relay, data.epoch | 0);
      if (!session.connected) emit('wait');
      return;
    }
    if (data.t === 'welcome') {
      session.lastPeerAt = performance.now();
      session.heardHost = true;
      session.connected = true;
      session.failed = false;
      session._failedOnce = false;
      session.via = via === 'ws' ? (session.rtcLive === true ? session.via : 'ws') : labelVia(session.pathKind || 'webrtc', session.policy);
      if (via !== 'ws') { session.dcSeen = true; if (session.iceUp || session.pathKind === 'direct' || session.pathKind === 'relay') session.rtcLive = true; }
      if (via === 'ws' && session.rtcGaveUp) retirePeer();
      emit('ok');
      try { if (h.onWelcome) h.onWelcome(data); } catch (e) {}
    } else if (data.t === 'state') {
      session.lastPeerAt = performance.now();
      session.heardHost = true;
      if (via === 'webrtc') session.via = session.rtcLive === true ? labelVia(session.pathKind || 'webrtc', session.policy) : (session.via || 'ws');
      else if (!session.via) session.via = 'ws';
      session.connected = true;
      if (via !== 'ws') { session.dcSeen = true; if (session.iceUp || session.pathKind === 'direct' || session.pathKind === 'relay') session.rtcLive = true; if (session.rtcLive === true) session.via = labelVia(session.pathKind || 'webrtc', session.policy); }
      if (via === 'ws' && session.rtcGaveUp) retirePeer();
      try { if (h.onState) h.onState(data); } catch (e) {}
    } else if (data.t === 'full') {
      session.full = true;
      session.failed = true;
      session._failedOnce = true;
      session.failMsg = t('guest.full');
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
    const hist = session.log.slice(-INPUT_HISTORY).map((row) => Object.assign({ seq: row.seq }, row.cmd));
    send({ t: 'input', seq: session.seq, nonce, steer: cmd.steer, throttle: cmd.throttle, brake: cmd.brake, lift: cmd.lift, nitro: cmd.nitro, pitch: cmd.pitch, hist });
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
    const armGuestIce = () => {
      const pc = next && next.peerConnection;
      if (!pc) return;
      next._skyBag = session;
      watchIce(pc, session, (st) => {
        if (st === 'failed' || st === 'disconnected') {
          session.peerDetail = 'peer.rejoin';
          session.rtcLive = false;
          if (session.wsOpen) session.via = 'ws';
          emit('warn');
        }
        if (st === 'connected' || st === 'completed') {
          session.iceUp = true;
          pathOf(next, session).then((via) => {
            if (session._destroyed) return;
            session.pathKind = labelVia(via, session.policy);
            if (session.dcSeen) session.rtcLive = true;
            if (session.rtcLive === true && session.connected) { session.via = session.pathKind; emit('ok'); }
          });
        }
      });
    };
    next.on('open', () => {
      if (session._destroyed) return;
      session._opened = true;
      armGuestIce();
      emit('wait');
      send({ t: 'hello', nonce, name: 'P3' });
      pathOf(next, session).then((via) => {
        if (session._destroyed) return;
        session.pathKind = labelVia(via, session.policy);
        if (session.connected && session.via !== 'ws') { session.via = session.pathKind; emit('ok'); }
      });
      arm(deadlines, 8000, () => {
        if (session.connected || session._destroyed) return;
        session.peerDetail = 'peer.noWelcome';
        session.rtcGaveUp = true;
        checkDone();
      });
    });
    next.on('data', (data) => take(data, 'webrtc'));
    next.on('close', () => {
      if (session._destroyed) return;
      session.rtcLive = false;
      session.dcSeen = false;
      session.iceUp = false;
      if (relay && (relay.open || session.wsOpen)) {
        session.via = 'ws';
        session.rejoin = true;
        if (session.heardHost) session.connected = true;
        return;
      }
      session.connected = false;
      setTimeout(() => {
        if (session._destroyed || session.via === 'ws') return;
        try { if (h.onClose) h.onClose({ replaced: session.replaced, full: session.full }); } catch (e) {}
      }, 400);
    });
    next.on('error', () => {
      if (session._destroyed || session.connected) return;
      session.peerDetail = 'peer.dc';
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
      session.peerDetail = 'peer.timeout';
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
      session.peerDetail = 'peer.missing';
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
      session.peerDetail = 'peer.slow';
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
        session.peerDetail = 'peer.noRoom';
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
        session.peerDetail = 'peer.unstable';
        try { peer.reconnect(); } catch (e) {}
        return;
      }
      session.peerDetail = failText(err);
      session.rtcGaveUp = true;
      checkDone();
    });
  }

  relay = connectRelayFan(code, {
    onStatus: (s) => {
      session.wsOpen = !!s.open;
      session.wsReason = s.open ? '' : (s.reason || '');
      session.wsReasonKey = s.open ? '' : (s.reasonKey || '');
      session.wsReasonLabel = s.open ? '' : (s.reasonLabel || '');
      session.wsGaveUp = false;
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
  }, relayOpts(h, 'guest', relayIndex, relayEpoch));

  function tickGuestJoin(now) {
    if (session.connected && session.rtcLive === true && session.via !== 'ws') {
      session.stage = (session.pathKind === 'relay' || session.policy === 'relay') ? 'turn' : 'direct';
      return;
    }
    const age = now - (session._joinT || now);
    const live = !!(session.connected && session.provenAt && (session.rtcLive === true || session.via === 'ws'));
    const stage = nextJoinStage({
      age,
      rtcOk: !!(session.rtc && session.rtc.ok),
      proven: !!session.provenAt,
      connected: live,
      policy: session.policy,
      iceDirect: !!(session.iceUp && session.pathKind === 'direct'),
      via: live ? (session.rtcLive === true ? (session.pathKind || session.via || 'direct') : 'ws') : '',
    });
    if (live) {
      session.stage = stage;
      return;
    }
    if (stage === 'turn' && !session._turnTried && session.policy !== 'relay') {
      session._turnTried = true;
      session.stage = 'turn';
      session.stageAt = now;
      promoteTurn(conn && conn.peerConnection, session);
    } else if (stage === 'mqtt' && session.stage !== 'mqtt') {
      session.stage = 'mqtt';
      session.stageAt = now;
      session.rtcGaveUp = true;
      session.rtcLive = false;
      if (session.wsOpen || session.heardHost) session.via = 'ws';
    } else if (stage === 'direct' || stage === 'turn') {
      session.stage = stage;
    }
    if (stage === 'mqtt' && !session.connected && age > JOIN_TOTAL_MS + 4000) {
      session.wsGaveUp = true;
      session.rtcGaveUp = true;
      session.peerDetail = session.peerDetail || 'guest.timeout';
      checkDone();
    }
  }
  session.poll = (now) => {
    if (session._destroyed) return;
    runDue(deadlines, now);
    if (relay) relay.poll(now);
    tickGuestJoin(now);
    if (session.heardHost && !hostStillThere(session.lastPeerAt, now)) {
      session.heardHost = false;
      session.connected = false;
      emit('warn');
      helloRelay();
      lastHello = now;
    }
    if (session.rtcLive && conn && conn.open && now - lastPing > 1000) {
      lastPing = now;
      pingN += 1;
      try { conn.send({ t: 'ping', n: pingN, at: now, nonce, lan: session.sawLocalHost ? 1 : 0 }); } catch (e) {}
    } else if (relay && relay.open && !session.rtcLive && now - lastPing > 2000) {
      lastPing = now;
      pingN += 1;
      try { relay.send({ t: 'ping', n: pingN, at: now, nonce, from: nonce, lan: session.sawLocalHost ? 1 : 0 }); } catch (e) {}
    }
    if (!session.connected && relay && relay.open && now - lastHello > 2000) {
      lastHello = now;
      helloRelay();
    }
  };
  session.destroy = (opts) => {
    if (session._destroyed) return;
    session._destroyed = true;
    try { send({ t: 'bye', nonce, gone: !!(opts && opts.gone) }); } catch (e) {}
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
  session.relabel = () => emit(session.connected ? 'joined' : (session.failed ? 'fail' : 'wait'));
  session.joinDebug = () => {
    const bag = (conn && conn._skyBag) || session;
    const c = bag.candTypes || session.candTypes || {};
    return {
      stage: session.stage || '',
      signal: session.connected ? 'joined' : (session._signalled ? 'signalled' : (session._finding ? 'finding' : (session._opened ? 'open' : (session.peerDetail || 'boot')))),
      cand: 'host ' + (c.host || 0) + ' srflx ' + (c.srflx || 0) + ' relay ' + (c.relay || 0) + ' prflx ' + (c.prflx || 0),
      pair: session.pathKind || session.via || '',
      proven: session.provenAt ? 1 : 0,
      via: session.via || '',
      rtc: session.rtcLive,
    };
  };
  session.linkSample = () => sampleLink(session);
  emit('wait');
  startPeer();
  return session;
}
