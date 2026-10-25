// 天空飛馳 Sky Roadster — 主程式
import * as THREE from 'three';
import { World, QUALITY } from './world.js';
import { CarModel, paintsOf } from './car.js';
import { VEHICLES, DEFAULT_VEHICLE, vehicleById } from './vehicles.js';
import { TRACKS, DEFAULT_TRACK, trackById } from './tracks.js';
import { Vehicle } from './physics.js';
import { InputManager, isVirtualPad, padButtonDown, padStickHot, profileLabel } from './input.js';
import { initLocale, onLocale, applyDom, t, getLocale, vehicleText, paintLabel } from './i18n.js';
import { UI, shortPadName } from './ui.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { clamp, lerp, damp, wrapAngle, smoothstep, store, fmtTime, migrateStoredItems } from './util.js';
import { ROAD_HALF } from './track.js';
import { ribbonCompression, KIND } from './stunts.js';
import { Race, LocalDriver, RemoteDriver, LOCAL_LIMIT, RACE_LAPS } from './race.js';
import { ItemBattle, layoutBoxes, clearItemState } from './items.js';
import { AiDriver } from './ai.js';
import { createHost, createGuest, drawRoomQr } from './net.js';
import {
  normalizeCode, formatCode, joinUrl, heldInput, reconcileDecision, StateBuffer, zeroInput,
  packSelf, packPose, easeGuestPose, hostOffroadWarn, wantCssRotate,
} from './sync.js';
import * as syncApi from './sync.js';

const params = new URLSearchParams(location.search);
const joinCode = normalizeCode(params.get('join') || '');
if (joinCode) document.body.classList.add('guest');
const netOff = params.get('nonet') === '1';
let qname = params.get('q') || store.get('quality', null) || ((navigator.hardwareConcurrency || 8) <= 4 ? 'low' : 'med');
if (joinCode && !params.get('q')) qname = 'low';
if (!QUALITY[qname]) qname = 'med';
const Q = QUALITY[qname];
const $ = (id) => document.getElementById(id);
initLocale();
migrateStoredItems();
const camName = (i) => t('cam.' + i);
const PHYS_DT = 1 / 120;

let renderer, scene, camera, camera2, world, track, car, veh, hud, ui, audio, input, race;
let hostNet = null, guestNet = null;
let battle = null;
let guestBattle = null;
const ghosts = new Map();
const guestBuf = new StateBuffer(100);
const guestSelfBuf = new StateBuffer(90);
const guestEase = { x: 0, y: 0, z: 0, heading: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, ready: false };
const guestVis = {
  on: false, pos: new THREE.Vector3(), q: new THREE.Quaternion(), n: new THREE.Vector3(0, 1, 0),
  heading: 0, speed: 0, speedF: 0, energy: 100,
  grounded: true, nitroOn: false, thrusting: false, braking: false, thrust: 0, lift: 0,
  steerAngle: 0, accel: 0, latAccel: 0, groundY: 0, alt: 0,
  get kmh() { return this.speed * 3.6; },
};
let guestSelfAt = 0;
let guestRoad = { known: false, onRoad: true, since: 0, toastAt: 0 };
let guestOffLeft = 0;
let orientSticky = '';
let orientTimer = 0;
let orientPending = '';
let viewLock = null;
let lastApplied = '';
let guestLive = false;
let guestTrackReady = false;
let guestTries = 0;
let guestRetryTimer = null;
let pendingSnap = null;
let guestPoses = [];
const guestLap = { n: 1, t: 0, last: null, best: null, cp: [false, false, false], prevFi: null };
const lobby = { p2: null, prev: new Map() };
const AI_PAINTS = ['white', 'blue', 'black', 'red'];
const game = {
  state: 'loading', time: 0, camMode: 0, countdown: 0, dyn: 1, guest: !!joinCode, hostPaused: false,
  lap: { n: 1, t: 0, last: null, best: null, cp: [false, false, false], prevFi: null },
  lastGoodI: 0, camYaw: 0, camSnap: true, shake: 0, kick: 0, rumbleT: 0, acc: 0, frames: [], autoDone: false,
};
const camPos = new THREE.Vector3();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const noAdapt = params.get('noadapt') === '1';

function fail(msg, err) {
  console.error(msg, err);
  const el = $('loadTxt');
  if (el) { el.style.color = '#ff9a8a'; el.textContent = msg; }
  if ($('loadRetry')) return;
  const host = el && el.parentNode;
  if (!host) return;
  const btn = document.createElement('button');
  btn.id = 'loadRetry';
  btn.className = 'btn primary';
  btn.type = 'button';
  btn.style.pointerEvents = 'auto';
  btn.style.marginTop = '0.8rem';
  btn.textContent = t('load.retry');
  btn.addEventListener('click', () => location.reload());
  host.appendChild(btn);
}

function baseDpr() { return Math.min(window.devicePixelRatio || 1, game.guest ? 1 : 1.5); }
function viewSize() {
  const forced = document.documentElement.classList.contains('force-landscape');
  if (!forced) { viewLock = null; return { w: window.innerWidth, h: window.innerHeight }; }
  const w = window.innerHeight, h = window.innerWidth;
  if (!viewLock) viewLock = { w, h };
  else if (Math.abs(w - viewLock.w) > 120 || Math.abs(h - viewLock.h) > 120) viewLock = { w, h };
  return viewLock;
}
function applyForceBox() {
  const b = document.body;
  if (!b) return;
  if (!document.documentElement.classList.contains('force-landscape')) {
    b.style.width = '';
    b.style.height = '';
    return;
  }
  const { w, h } = viewSize();
  b.style.width = w + 'px';
  b.style.height = h + 'px';
}
function applySize() {
  applyForceBox();
  if (!renderer) return;
  const scale = game.guest ? Math.min(Q.scale, 0.62) : Q.scale;
  const pr = Math.min(game.guest ? 1 : 1.5, baseDpr() * scale * game.dyn);
  const { w, h } = viewSize();
  const key = pr.toFixed(3) + ':' + Math.round(w) + 'x' + Math.round(h);
  if (key === lastApplied) return;
  lastApplied = key;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  if (hud) hud.resize();
}

async function boot() {
  try {
    game._loadTimer = setTimeout(() => {
      if (game.state === 'loading') fail(t('load.timeout'));
    }, 25000);
    const canvas = $('gl');
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.aa, powerPreference: 'high-performance', stencil: false });
    } catch (e) { return fail(t('boot.webgl'), e); }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 7000);
    camera2 = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 7000);
    applySize();
    input = new InputManager();
    audio = new GameAudio();

    if (store.get('track', '') === 'stunt') store.set('track', 'city');
    const qTrack = params.get('track');
    const tid = (qTrack && TRACKS.some((t) => t.id === qTrack)) ? qTrack : trackById(store.get('track', DEFAULT_TRACK)).id;
    world = new World(renderer, scene, qname, tid);
    track = world.track;
    await world.build((p, label) => { $('loadBar').style.width = Math.round(p * 80) + '%'; $('loadTxt').textContent = t('load.step', { label: t(label) }); });
    world.mountItems(layoutBoxes(track));
    if (!game.guest) battle = new ItemBattle(track, world._boxLayout);
    $('loadTxt').textContent = t('load.step', { label: t('load.car') });
    await new Promise((r) => setTimeout(r, 0));

    const vid = vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).id;
    car = new CarModel(Q, vid, savedPaint(vid)); car.setPaint(savedPaint(vid));
    scene.add(car.root); scene.add(car.blob);
    veh = new Vehicle(track);
    const bootDef = vehicleById(vid);
    veh.setTune(bootDef.tune);
    veh.mass = bootDef.mass || 1800;
    if (game.guest) veh.followHost = true;
    game.lap.best = store.get('best.' + track.id, store.get('best', null));
    hud = new Hud(track, world);

    ui = new UI(input, {
      onStart: () => { if (!game.guest) startGame(); }, onResume: resume, onRestart: () => { if (!game.guest) offerRestart(); }, onQuit: quit,
      onFullscreen: toggleFullscreen, onVehicle: setVehicle, getCar: () => car,
      onTrack: (id) => {
        store.set('track', id);
        try { sessionStorage.setItem('skyroadster.flow', 'tracks'); } catch (e) {}
        const u = new URL(location.href);
        u.searchParams.delete('track');
        location.href = u.toString();
      },
      onQuality: (q) => { store.set('quality', q); const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.toString(); },
      getQuality: () => qname, onVolume: (v) => audio.setVolume(v), getVolume: () => audio.volume,
      onTouchMode: () => {}, onTouchPress: (p) => { input.noteTouchPress(p); game.touchPressed = p; },
      onBackTop: () => { if (game.state === 'paused') resume(); },
      onJoinRetry: retryGuest, onJoinLeave: leaveGuestRoom,
    });
    input.onProfileChange = (prof) => ui.applyProfile(prof);
    onLocale(() => {
      applyDom();
      ui.buildGarage();
      ui.buildTracks();
      ui.refreshTracks();
      ui.applyProfile();
      ui.syncItems();
      paintJoinCar();
      updateLobby();
      const link = document.querySelector('a[href^="gamepad-test"]');
      if (link) link.href = 'gamepad-test.html?lang=' + encodeURIComponent(getLocale());
      try { if (hostNet && hostNet.relabel) hostNet.relabel(); } catch (e) {}
      try { if (guestNet && guestNet.relabel) guestNet.relabel(); } catch (e) {}
    });
    const link = document.querySelector('a[href^="gamepad-test"]');
    if (link) link.href = 'gamepad-test.html?lang=' + encodeURIComponent(getLocale());
    ui.applyProfile(input.profile);
    input.onPadChange = (on, gp) => {
      if (hud && game.state === 'race') hud.toast(on ? t('toast.padOn') : t('toast.padOff'), 1500);
    };

    $('loadBar').style.width = '92%';
    veh.placeOnTrack(track.N - 10, 0, 0);
    game.camYaw = veh.heading;
    syncCar(0);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    $('loadBar').style.width = '100%';

    window.addEventListener('resize', () => { syncPhoneOrientation(); applySize(); game._presentAt = 0; });
    try {
      const swHost = location.hostname || '';
      if ((swHost.endsWith('github.io') || params.get('sw') === '1') && 'serviceWorker' in navigator) {
        const SW_REV = 'v3';
        navigator.serviceWorker.register('sw.js').then(() => {
          let once = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (once) return;
            let seen = '';
            try { seen = sessionStorage.getItem('skyroadster.swre') || ''; } catch (e) {}
            if (seen === SW_REV) return;
            if (game.state === 'race' || game.state === 'countdown' || game.state === 'paused' || game.state === 'results') return;
            once = true;
            try { sessionStorage.setItem('skyroadster.swre', SW_REV); } catch (e) {}
            location.reload();
          });
        }).catch(() => {});
      }
    } catch (e) {}
    window.addEventListener('orientationchange', () => { syncPhoneOrientation(); applySize(); });
    for (const ev of ['pointerdown', 'touchend', 'click']) {
      window.addEventListener(ev, () => { tryLockLandscape(); }, { passive: true });
    }
    window.addEventListener('pagehide', (ev) => {
      if (ev.persisted) return;
      try { if (guestNet && !guestNet._destroyed) guestNet.destroy(); } catch (e) {}
    });
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => audio.init(), { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'race' && params.get('nopauseblur') !== '1') pause(); });
    window.addEventListener('blur', () => { if (game.state === 'race' && params.get('nopauseblur') !== '1') pause(); });

    if (qTrack && TRACKS.some((t) => t.id === qTrack)) { ui.trackId = qTrack; ui.refreshTracks(); }
    window.__sky = {
      Q, CarModel, setVehicle, sim, game, veh, input, world, hud, ui, car, camera, camera2, renderer, scene, audio,
      startGame, track, TRACKS, trackById, VEHICLES, vehicleById, THREE,
      lobby, ribbonCompression, KIND, joinPad, pollLobby, leaveP2, LocalDriver, RemoteDriver, LOCAL_LIMIT, RACE_LAPS, AiDriver,
      sync: syncApi, retryGuest,
      get race() { return race; },
      get battle() { return battle; },
      itemsOn() { return itemsEnabled(); },
      net: {
        get role() { return game.guest ? 'guest' : (hostNet ? 'host' : 'off'); },
        get code() { return hostNet ? hostNet.code : joinCode; },
        get url() { return hostNet ? hostNet.url : (joinCode ? joinUrl(joinCode, location) : ''); },
        get ready() { return !!(hostNet && hostNet.ready); },
        get failed() { return game.guest ? !!(guestNet && guestNet.failed) : !!(hostNet && hostNet.failed); },
        get failMsg() { return (game.guest ? guestNet && guestNet.failMsg : hostNet && hostNet.failMsg) || ''; },
        get remotes() { return hostNet ? hostNet.remotes.length : 0; },
        get connected() { return !!(guestNet && guestNet.connected); },
        get ghosts() { return ghosts.size; },
        get latest() { return guestNet && guestNet.latest; },
        get live() { return guestLive; },
        get seq() { return guestNet ? guestNet.seq : 0; },
        flushInput() {
          if (!guestNet) return 0;
          input.poll(1 / 60);
          return guestNet.noteInput(input.state, performance.now());
        },
        flushState() {
          try { flushNet(true); } catch (e) {}
        },
        tick(dt) { syncCar(dt || (1 / 60)); },
        debugJoin(nonce) { return hostNet && hostNet.debugJoin ? hostNet.debugJoin(nonce) : null; },
        debugBlip() { return !!(hostNet && hostNet.debugBlip && hostNet.debugBlip()); },
        debugExpire() { return !!(hostNet && hostNet.debugExpire && hostNet.debugExpire()); },
        p3() {
          const r = race && race.racers.find((x) => x.driver && x.driver.kind === 'remote' && !String(x.netId || '').endsWith('-done'));
          if (!r) return null;
          const remote = hostNet && hostNet.remotes && hostNet.remotes.find((x) => x.racer === r);
          return {
            x: r.veh.pos.x, z: r.veh.pos.z, fi: r.veh.attached ? r.veh.fi : r.veh.q1.fi,
            lap: r.lap ? r.lap.n : 0, lapT: r.lap ? r.lap.t : 0, name: r.name,
            holding: !!(remote && remote.holding), token: r._token || 0,
          };
        },
        get trackReady() { return guestTrackReady; },
        get sent() { return hostNet ? (hostNet.sent || 0) : 0; },
        get lastErr() { return (hostNet && hostNet.lastErr) || ''; },
        get debug() {
          const n = game.guest ? guestNet : hostNet;
          return n && n.joinDebug ? n.joinDebug() : null;
        },
        get link() {
          const n = game.guest ? guestNet : hostNet;
          if (!n || typeof n.linkSample !== 'function') return null;
          const sample = n.linkSample();
          const r = n.remotes && n.remotes[0];
          return Object.assign({}, sample, {
            via: game.guest ? n.via : (r && r.via),
            rtc: game.guest ? n.rtcLive : (r && r.rtcLive),
            ws: !!n.wsOpen,
          });
        },
        disconnect() {
          try { if (guestNet) guestNet.destroy(); } catch (e) {}
          try { if (hostNet) hostNet.destroy(); } catch (e) {}
        },
      },
    };
    game.state = 'menu';
    ui.refreshTracks();
    let resumeFlow = '';
    try {
      resumeFlow = sessionStorage.getItem('skyroadster.flow') || '';
      sessionStorage.removeItem('skyroadster.flow');
    } catch (e) {}
    if (game.guest) {
      ui.itemsFollowHost = true;
      ui.hostItemsOn = true;
      ui.afterItems = 'join';
      ui.show('items');
      const jc = $('joinCode');
      if (jc) jc.textContent = formatCode(joinCode);
      const pg = $('btnPauseGarage'); if (pg) pg.classList.remove('hidden');
      paintJoinCar();
      setJoinStatus(t('guest.scanning'), 'wait');
      syncPhoneOrientation();
      if (!netOff) beginGuest();
    } else if (resumeFlow === 'tracks') {
      ui.enterFlow('tracks');
      if (!netOff) beginHost();
    } else {
      ui.show('start');
      if (!netOff) beginHost();
      if (params.get('autostart') === '1') startGame();
    }
    if (game._loadTimer) { clearTimeout(game._loadTimer); game._loadTimer = 0; }
    last = performance.now();
    requestAnimationFrame(frame);
    // 分頁在背景時 requestAnimationFrame 會停，手機的畫面和心跳就一起斷。
    // 這個計時器在前景只是碰到發送間隔就返回；在背景仍維持約一秒一包，低於中繼逾時。
    setInterval(() => {
      const now = performance.now();
      try { if (hostNet && hostNet.poll) hostNet.poll(now); } catch (e) {}
      try { if (guestNet && guestNet.poll) guestNet.poll(now); } catch (e) {}
      try {
        if (guestNet && game.guest && (game.state === 'race' || game.state === 'countdown')) guestNet.noteInput(input.state, now);
      } catch (e) {}
      try { flushNet(false); } catch (e) {}
    }, 250);
  } catch (e) {
    fail(t('load.fail', { msg: e && e.message ? e.message : e }), e);
  }
}

// 測試用：不經渲染快速推進模擬（無頭測試用）
function sim(sec, cb) {
  const n = Math.round(sec / PHYS_DT);
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      if (race) race.pollHumans(1 / 60);
      else input.poll(1 / 60);
    }
    if (race) race.step(PHYS_DT);
    else veh.step(PHYS_DT, input.state);
    if (battle && battle.enabled && race && game.state === 'race') battle.step(PHYS_DT, race.racers);
    if (i % 2 === 1) { handleEvents(1 / 60); if (!race) updateLap(1 / 60); updateRings(1 / 60); game.time += 1 / 60; }
    if (cb && cb(i)) break;
  }
}

// ---------------- 車輛選擇 ----------------
function savedPaint(vid) {
  const list = paintsOf(vid), k = store.get('paint.' + vid, null);
  return list.some((p) => p.key === k) ? k : list[0].key;
}
function validPaint(vid, paint) {
  const list = paintsOf(vid);
  return list.some((p) => p.key === paint) ? paint : list[0].key;
}
function paintJoinCar() {
  const el = $('joinCar');
  if (!el || !car) return;
  const def = vehicleById(car.vehicleId);
  const pd = paintsOf(def.id).find((p) => p.key === car.paintKey);
  const text = vehicleText(def.id, def.name);
  el.textContent = t('join.car', { name: text.name, paint: pd ? paintLabel(pd.key) : '' });
}
let guestCarPick = null;
let orientLockTried = false;
function orientSample() {
  if (typeof window !== 'undefined' && window.__skyOrient) {
    const o = window.__skyOrient;
    return {
      type: o.type || '',
      angle: Number.isFinite(+o.angle) ? +o.angle : null,
      win: Number.isFinite(+o.win) ? +o.win : null,
      sw: o.sw || 0,
      sh: o.sh || 0,
      iw: o.iw || window.innerWidth,
      ih: o.ih || window.innerHeight,
    };
  }
  const ori = (typeof screen !== 'undefined' && screen.orientation) || null;
  const type = (ori && ori.type) || '';
  const angle = ori && Number.isFinite(ori.angle) ? ori.angle : null;
  const win = typeof window.orientation === 'number' ? window.orientation : null;
  let sw = (typeof screen !== 'undefined' && screen.width) || 0;
  let sh = (typeof screen !== 'undefined' && screen.height) || 0;
  if (!type) {
    const iw = window.innerWidth, ih = window.innerHeight;
    const screenPortrait = sh > sw;
    const viewPortrait = ih > iw + 80;
    const viewLandscape = iw > ih + 80;
    if ((screenPortrait && viewLandscape) || (!screenPortrait && viewPortrait && sw > 0)) {
      sw = iw;
      sh = ih;
    }
  }
  return { type, angle, win, sw, sh, iw: window.innerWidth, ih: window.innerHeight };
}
function syncPhoneOrientation() {
  if (!game.guest) {
    document.documentElement.classList.remove('force-landscape');
    orientSticky = '';
    orientPending = '';
    if (orientTimer) { clearTimeout(orientTimer); orientTimer = 0; }
    applyForceBox();
    return;
  }
  const want = wantCssRotate(orientSample(), orientSticky);
  const key = want ? 'css' : 'native';
  const on = document.documentElement.classList.contains('force-landscape');
  if (want === on && orientSticky) return;
  if (orientPending === key && orientTimer) return;
  orientPending = key;
  if (orientTimer) clearTimeout(orientTimer);
  const wait = orientSticky ? 280 : 0;
  orientTimer = setTimeout(() => {
    orientTimer = 0;
    if (!game.guest) return;
    const still = wantCssRotate(orientSample(), orientSticky);
    if ((still ? 'css' : 'native') !== key) return;
    document.documentElement.classList.toggle('force-landscape', still);
    orientSticky = still ? 'css' : 'native';
    orientPending = '';
    viewLock = null;
    lastApplied = '';
    applyForceBox();
    applySize();
  }, wait);
}
async function tryLockLandscape() {
  if (!game.guest || orientLockTried) return;
  orientLockTried = true;
  const el = document.documentElement;
  try {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req && !document.fullscreenElement) await req.call(el);
  } catch (e) { /* iOS Safari 沒有頁面全螢幕 */ }
  try {
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch (e) { /* 鎖不住就用 CSS 把整個畫面轉成橫向 */ }
  syncPhoneOrientation();
  applySize();
}
// 換車：重建車輛模型、套用該車的物理調校；paintKey 省略時使用該車上次選的車漆。
// 手機加入時，房主指定的車不寫進這支手機自己的車庫；玩家自己換車才會通知房主。
function setVehicle(id, paintKey, opts) {
  const opt = opts || {};
  const persist = opt.persist !== false;
  const notify = opt.notify !== false;
  const def = vehicleById(id);
  const pk = validPaint(def.id, paintKey || (persist ? savedPaint(def.id) : car.paintKey));
  if (car.vehicleId === def.id && car.paintKey === pk) {
    if (notify && game.guest) rememberGuestCar(def.id, pk);
    paintJoinCar();
    return car;
  }
  const prevCar = car;
  scene.remove(car.root, car.blob); car.dispose();
  car = new CarModel(Q, def.id, pk); car.setPaint(pk);
  scene.add(car.root); scene.add(car.blob);
  if (race) { const p = race.racers[0]; if (p && p.car === prevCar) p.car = car; }
  if (window.__sky) window.__sky.car = car;
  veh.setTune(def.tune);
  veh.mass = def.mass || 1800;
  if (!opt.keepEnergy) veh.energy = Math.min(100, veh.energy || 100);
  if (persist) { store.set('vehicle', def.id); store.set('paint.' + def.id, car.paintKey); }
  if (notify && game.guest) rememberGuestCar(def.id, car.paintKey);
  game.camSnap = true;
  syncCar(0);
  paintJoinCar();
  try { renderer.compile(scene, camera); } catch (e) { /* */ }
  return car;
}
function rememberGuestCar(id, paint) {
  guestCarPick = { vehicle: id, paint };
  try { if (guestNet && guestNet.connected) guestNet.send({ t: 'car', vehicle: id, paint }); } catch (e) {}
}

// ---------------- 狀態控制 ----------------
function freshLap(best) {
  return { n: 1, t: 0, last: null, best: best == null ? null : best, cp: [false, false, false], prevFi: null };
}
function raceOptions() {
  let count = params.get('ai');
  if (count == null || count === '') count = store.get('aicount', '0');
  count = Math.max(0, Math.min(3, parseInt(count, 10) || 0));
  let diff = params.get('diff');
  if (!['easy', 'normal', 'hard'].includes(diff)) diff = store.get('aidiff', 'normal');
  if (!['easy', 'normal', 'hard'].includes(diff)) diff = 'normal';
  return { count, diff };
}
function clearRace() {
  if (hostNet) for (const remote of hostNet.remotes) remote.racer = null;
  if (!race) return;
  for (const r of race.racers) {
    if (r.car && r.car !== car) {
      scene.remove(r.car.root, r.car.blob);
      try { r.car.dispose(); } catch (e) { /* */ }
    }
    if (r.input && r.input !== input) r.input.dispose();
  }
  race = null;
}
function makeRacer(opts) {
  const cam = {
    yaw: 0, snap: true, pos: new THREE.Vector3(),
  };
  return {
    name: opts.name, driver: opts.driver, veh: opts.veh, car: opts.car, input: opts.input || null,
    lap: opts.lap, primary: !!opts.primary, lat0: opts.lat0 || 0, finish: null, banked: 0,
    cam, impactForCar: 0,
  };
}
function startGame() {
  audio.init();
  clearRace();
  ui.hideAll(); hud.show(true);
  const lap = game.lap;
  lap.n = 1; lap.t = 0; lap.last = null; lap.cp = [false, false, false]; lap.prevFi = null;
  lap.best = store.get('best.' + track.id, store.get('best', null));
  world.resetRings();
  const opt = raceOptions();
  const humans = [makeRacer({
    name: 'P1', driver: new LocalDriver(input), veh, car, input, lap, primary: true,
  })];
  if (lobby.p2) {
    const p2input = new InputManager({ padIndex: lobby.p2.index, keys: false, exclusive: true });
    const p2car = new CarModel(QUALITY.low, vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).id, 'red');
    scene.add(p2car.root); scene.add(p2car.blob);
    const p2def = vehicleById(store.get('vehicle', DEFAULT_VEHICLE));
    const p2veh = new Vehicle(track);
    p2veh.setTune(p2def.tune);
    p2veh.mass = p2def.mass || 1800;
    humans.push(makeRacer({
      name: 'P2', driver: new LocalDriver(p2input), veh: p2veh, car: p2car, input: p2input, lap: freshLap(null),
    }));
  }
  const aiN = opt.count;
  const ais = [];
  const tune = vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).tune;
  const vid = vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).id;
  for (let i = 0; i < aiN; i++) {
    const acar = new CarModel(QUALITY.low, vid, AI_PAINTS[i % AI_PAINTS.length]);
    scene.add(acar.root); scene.add(acar.blob);
    const aveh = new Vehicle(track);
    aveh.setTune(tune);
    aveh.mass = vehicleById(vid).mass || 1800;
    ais.push(makeRacer({
      name: t('race.cpu', { n: i + 1 }), cpuN: i + 1, driver: new AiDriver(track, opt.diff), veh: aveh, car: acar, lap: freshLap(null),
    }));
  }
  const roster = humans.concat(ais);
  const gap = Math.min(4.2, (ROAD_HALF * 1.5) / Math.max(1, roster.length - 1));
  const mid = (roster.length - 1) / 2;
  const origin = track.wrap(track.N - 10);
  race = new Race(track);
  race.raceMode = false;
  race.onLap = (r, lapTime) => {
    if (!r.primary) return;
    const L = r.lap;
    L.last = lapTime;
    const isBest = L.best == null || lapTime < L.best;
    if (isBest) { L.best = lapTime; store.set('best.' + track.id, lapTime); store.set('best', lapTime); }
    hud.toast(isBest ? t('toast.lapBest', { n: L.n }) : t('toast.lap', { n: L.n }), 2500);
    audio.beep(true);
    input.rumble(0.4, 0.7, 250);
  };
  race.onMiss = () => hud.toast(t('toast.miss'), 1800);
  race.onResetRings = () => world.resetRings();
  roster.forEach((r, i) => {
    const lat = roster.length === 1 ? 0 : (i - mid) * gap;
    r.lat0 = lat;
    r.veh.energy = 100;
    r.veh.placeOnTrack(origin, lat, 0);
    r.cam.yaw = r.veh.heading;
    r.cam.snap = true;
    race.add(r);
  });
  humans[0].netId = 'p1';
  if (humans[1]) humans[1].netId = 'p2';
  ais.forEach((r, i) => { r.netId = 'ai' + i; });
  if (hostNet) for (const remote of hostNet.remotes) attachRemoteRacer(remote);
  race.raceMode = race.racers.length > 1;
  if (battle) {
    battle.enabled = itemsEnabled();
    battle.reset();
    for (const r of race.racers) clearItemState(r.veh);
  }
  veh = humans[0].veh;
  car = humans[0].car;
  game.camYaw = veh.heading; game.camSnap = true;
  setSplit(humans.length > 1);
  game.state = 'countdown';
  game._cdStart = performance.now();
  game.countdown = params.get('nocount') === '1' ? 0.05 : 3.4;
  if (game.countdown <= 0.4) { game.state = 'race'; game.countdown = 0; }
  game.lastCount = -1;
  game.shake = 0;
  const sb = $('standings');
  if (sb) sb.classList.toggle('hidden', race.racers.length < 2);
  flushNet(true);
}
function setSplit(on) {
  game.split = !!on;
  const bar = $('splitbar');
  if (bar) bar.classList.toggle('hidden', !on);
  if (on) {
    if (game._dynBefore == null) game._dynBefore = game.dyn;
    game.dyn = Math.min(game.dyn, 0.7);
    renderer.shadowMap.enabled = false;
    renderer.autoClear = false;
    applySize();
  } else {
    if (game._dynBefore != null) { game.dyn = game._dynBefore; game._dynBefore = null; }
    renderer.shadowMap.enabled = !!Q.shadows;
    renderer.autoClear = true;
    renderer.setScissorTest(false);
    camera.clearViewOffset();
    const w = innerWidth, h = innerHeight;
    renderer.setViewport(0, 0, w, h);
    camera.aspect = w / h;
    applySize();
  }
}
function pause() {
  if (game.state !== 'race' && game.state !== 'countdown') return;
  game.prevState = game.state;
  game.state = 'paused';
  ui.show('pause');
}
function resume() {
  if (game.state !== 'paused') return;
  ui.hideAll(); ui.stack = [];
  game.state = game.prevState || 'race';
  input.flushKeys();
}
function offerRestart() {
  if (game.guest) return;
  clearRace();
  clearGhosts();
  setSplit(false);
  game.state = 'menu';
  hud.show(false); hud.count('');
  const sb = $('standings'); if (sb) sb.classList.add('hidden');
  veh.placeOnTrack(track.N - 10, 0, 0);
  ui.offerItems('ready');
  updateLobby();
  flushNet(true);
}
function quit() {
  if (game.guest) { leaveGuestRace(); return; }
  clearRace();
  clearGhosts();
  setSplit(false);
  game.state = 'menu';
  hud.show(false); hud.count('');
  const sb = $('standings'); if (sb) sb.classList.add('hidden');
  veh.placeOnTrack(track.N - 10, 0, 0);
  ui.show('start');
  updateLobby();
  flushNet(true);
}

function paintForRemote(def, slot) {
  const list = paintsOf(def.id).map((p) => p.key);
  const hostPaint = car && car.paintKey;
  const prefer = ['blue', 'red', 'white', 'black', 'silver', 'steel'];
  for (const k of prefer) if (list.includes(k) && k !== hostPaint) return k;
  return list[(slot || 0) % list.length] || list[0];
}
function ensureRemoteCar(remote) {
  if (!remote) return;
  if (remote.vehicle && remote.paint) {
    remote.paint = validPaint(remote.vehicle, remote.paint);
    remote.vehicle = vehicleById(remote.vehicle).id;
    return;
  }
  const def = vehicleById(store.get('vehicle', DEFAULT_VEHICLE));
  remote.vehicle = def.id;
  remote.paint = paintForRemote(def, remote.slot || 0);
}
function welcomeFor(remote) {
  const opt = raceOptions();
  ensureRemoteCar(remote);
  return {
    t: 'welcome', track: track.id, vehicle: remote.vehicle, paint: remote.paint,
    ai: opt.count, diff: opt.diff,
    laps: RACE_LAPS, slot: remote.slot, name: remote.name,
  };
}
function poseOf(r) {
  const v = r.veh;
  return packPose({
    id: r.netId || r.name,
    name: r.name,
    kind: r.driver && r.driver.kind,
    vehicle: r.car && r.car.vehicleId,
    paint: r.car && r.car.paintKey,
    x: v.pos.x, y: v.pos.y, z: v.pos.z,
    qx: v.q.x, qy: v.q.y, qz: v.q.z, qw: v.q.w,
    vx: v.vel.x, vy: v.vel.y, vz: v.vel.z,
    nx: v.n.x, ny: v.n.y, nz: v.n.z,
    heading: v.heading, speed: v.speed, gy: v.groundY,
    grounded: !!v.grounded, nitro: !!v.nitroOn, thrust: v.thrust, lift: v.lift,
    braking: !!v.braking, steer: v.steerAngle,
    item: v.item | 0, shield: !!v.shield, spin: v.spinT > 0, aimed: !!v.aimed,
    boost: v.boostT > 0, slow: v.slowT > 0,
    fi: v.attached ? v.fi : (v.q1.fi || 0),
    onRoad: !!v.onRoad,
    lap: r.lap ? r.lap.n : 1,
    finish: r.finish == null ? null : r.finish,
  });
}
function netStateFor(remote) {
  const cars = [];
  if (race) {
    for (const r of race.racers) {
      if (!r.veh || r === remote.racer) continue;
      const pose = poseOf(r);
      if (Number.isFinite(pose.x) && Number.isFinite(pose.z)) cars.push(pose);
    }
  }
  const standings = race ? race.standings().map((r) => ({
    name: r.name, finish: r.finish == null ? null : r.finish, kind: r.driver && r.driver.kind,
  })) : [];
  let self = null, selfLap = null, selfId = null;
  if (remote.racer && remote.racer.veh) {
    selfId = remote.racer.netId;
    try { self = packSelf(remote.racer.veh.exportState()); } catch (e) { self = null; }
    const L = remote.racer.lap;
    selfLap = L ? { n: L.n, t: L.t, last: L.last, best: L.best } : null;
  }
  ensureRemoteCar(remote);
  return {
    t: 'state', now: performance.now(), race: game.state, cd: game.countdown, track: track.id,
    ack: remote.seq | 0, selfId, self, selfLap, standings, cars,
    selfVehicle: remote.vehicle, selfPaint: remote.paint,
    battle: battle && battle.enabled ? battle.view() : null,
    offLeft: remote.racer && remote.racer.veh ? (remote.racer.veh.offLeft || 0) : 0,
  };
}
function itemsEnabled() {
  if (params.get('items') === '0') return false;
  if (params.get('items') === '1') return true;
  return store.get('items', '1') !== '0';
}
function battleFrameView() {
  if (game.guest) {
    const src = guestBattle || { on: true, boxes: [], shots: [] };
    const msg = guestNet && guestNet.latest;
    const shields = [];
    if (msg && msg.self && msg.self.shield) shields.push({ x: msg.self.x, y: msg.self.y + 0.7, z: msg.self.z });
    if (msg && msg.cars) for (const c of msg.cars) if (c && c.shield) shields.push({ x: c.x, y: c.y + 0.7, z: c.z });
    return { on: !!src.on, boxes: src.boxes || [], shots: src.shots || [], bursts: src.bursts || [], shields };
  }
  if (!battle || !itemsEnabled()) return { on: false, boxes: [], shots: [], bursts: [], shields: [] };
  if (game.state !== 'race' && game.state !== 'countdown' && game.state !== 'paused') {
    return { on: true, boxes: battle.boxes.map((b) => ({ alive: true })), shots: [], bursts: [], shields: [] };
  }
  const view = battle.view();
  view.shields = [];
  if (race) {
    for (const r of race.racers) {
      if (r.veh && r.veh.shield) view.shields.push({ x: r.veh.pos.x, y: r.veh.pos.y + 0.7, z: r.veh.pos.z });
    }
  }
  return view;
}
function itemHow() {
  if (document.body.classList.contains('touchon')) return 'touch';
  if (input && input.padInfo && input.padInfo.connected) return 'pad';
  return 'key';
}
let _spinShown = false;
function battleHud() {
  const how = itemHow();
  if (game.guest) {
    const msg = guestNet && guestNet.latest;
    const self = msg && msg.self;
    const known = msg && (msg.battle || msg.keyframe);
    return {
      on: known ? !!(msg.battle && msg.battle.on) : true,
      item: self ? (self.item | 0) : 0,
      aimed: !!(self && self.aimed),
      how,
      hitKind: self ? (self.hitKind | 0) : 0,
      hitBlock: !!(self && self.hitBlock),
    };
  }
  if (!battle || !battle.enabled) return { on: false };
  const spinning = !!(veh && veh.spinT > 0.15);
  if (spinning && !_spinShown && hud) hud.flash();
  _spinShown = spinning;
  return {
    on: true, item: veh ? (veh.item | 0) : 0, aimed: !!(veh && veh.aimed), how,
    hitKind: veh ? (veh.hitKind | 0) : 0, hitBlock: !!(veh && veh.hitBlock),
  };
}
function flushNet(force) {
  if (!hostNet || game.guest) return;
  const st = game.state;
  if (!force && (st === 'menu' || st === 'loading')) return;
  try { hostNet.broadcast((remote) => netStateFor(remote), !!force); } catch (e) {}
}
function applyRemoteInputs() {
  if (!hostNet || !race) return;
  const now = performance.now();
  for (const remote of hostNet.remotes) {
    if (!remote.driver) continue;
    try {
      if (remote.holding) remote.driver.push({ steer: 0, throttle: 0, brake: 1, lift: false, nitro: false, pitch: 0 });
      else remote.driver.push(heldInput(remote, now));
    } catch (e) {}
  }
}
function refreshRaceMode() {
  if (!race) return;
  const active = race.racers.filter((r) => !r.parked);
  const anyFinish = race.racers.some((r) => r.finish != null);
  if (active.length < 2 && !anyFinish) race.raceMode = false;
  else race.raceMode = race.racers.length > 1;
}
function mountRemoteCar(remote) {
  ensureRemoteCar(remote);
  const def = vehicleById(remote.vehicle);
  const rcar = new CarModel(QUALITY.low, def.id, remote.paint);
  rcar.setPaint(remote.paint);
  scene.add(rcar.root); scene.add(rcar.blob);
  if (remote.racer) {
    const old = remote.racer.car;
    if (old && old !== car) {
      scene.remove(old.root, old.blob);
      try { old.dispose(); } catch (e) {}
    }
    remote.racer.car = rcar;
    remote.racer.veh.setTune(def.tune);
    remote.racer.veh.mass = def.mass || 1800;
  }
  return rcar;
}
function onRemoteCar(remote, data) {
  if (!remote || !data) return;
  const def = vehicleById(data.vehicle);
  remote.vehicle = def.id;
  remote.paint = validPaint(def.id, data.paint);
  if (remote.racer) mountRemoteCar(remote);
}
function attachRemoteRacer(remote) {
  if (!race || !remote || remote.racer) return remote.racer;
  const def = vehicleById(remote.vehicle || store.get('vehicle', DEFAULT_VEHICLE));
  const tune = def.tune;
  const rcar = mountRemoteCar(remote);
  const rveh = new Vehicle(track);
  rveh.setTune(tune);
  rveh.mass = def.mass || 1800;
  const r = makeRacer({
    name: remote.name || ('P' + (3 + remote.slot)),
    driver: remote.driver,
    veh: rveh, car: rcar, lap: freshLap(null),
  });
  r.netId = 'r' + remote.slot;
  const lat = Math.max(-8, 6 - remote.slot * 3.2);
  r.lat0 = lat;
  rveh.energy = 100;
  rveh.placeOnTrack(track.wrap(track.N - 10), lat, 0);
  r.cam.yaw = rveh.heading;
  race.add(r);
  remote.racer = r;
  refreshRaceMode();
  const sb = $('standings');
  if (sb && race.racers.length > 1) sb.classList.remove('hidden');
  return r;
}
function releaseRemoteCar(r) {
  if (!r || !r.car || r.car === car) return;
  scene.remove(r.car.root, r.car.blob);
  try { r.car.dispose(); } catch (e) {}
}
function detachRemoteRacer(remote) {
  const r = remote && remote.racer;
  if (remote) remote.racer = null;
  if (!r || !race) return;
  const i = race.racers.indexOf(r);
  if (i >= 0) race.racers.splice(i, 1);
  releaseRemoteCar(r);
  refreshRaceMode();
  try { checkResults(); } catch (e) {}
}
function parkRemoteRacer(remote) {
  const r = remote && remote.racer;
  if (!r) { if (remote) remote.racer = null; return; }
  r.parked = true;
  r.netId = (r.netId || 'r') + '-done';
  if (!r.offlineTagged) { r.offlineTagged = true; r.name += t('race.offline'); }
  remote.racer = null;
  refreshRaceMode();
}
function paintHostStatus(info) {
  const st = $('phoneStatus');
  const codeEl = $('phoneCode');
  const urlEl = $('phoneUrl');
  if (codeEl) codeEl.textContent = info.code ? formatCode(info.code) : '——';
  if (urlEl) urlEl.textContent = info.url || '';
  if (st) {
    st.textContent = info.text || '';
    const flag = info.kind === 'joined' || info.kind === 'ready' ? ' ok' : info.kind === 'fail' ? ' bad' : info.kind === 'warn' ? ' warn' : '';
    st.className = 'padline' + flag;
  }
  const hint = $('phoneHint');
  if (hint) hint.className = 'small dim' + (info.kind === 'fail' ? ' bad' : info.kind === 'warn' ? ' warn' : '');
  const canvas = $('phoneQr');
  if (canvas && info.url && (info.kind === 'ready' || info.kind === 'joined')) {
    if (drawRoomQr(canvas, info.url)) canvas.classList.remove('hidden');
  }
}
function beginHost() {
  if (hostNet || game.guest || netOff) return;
  hostNet = createHost({
    onStatus: paintHostStatus,
    onJoin: (remote) => {
      try {
        if (game.state === 'countdown' || game.state === 'race' || game.state === 'paused') attachRemoteRacer(remote);
      } catch (e) {}
    },
    onLeave: (remote, why) => {
      try {
        if (remote.racer && remote.racer.finish != null) parkRemoteRacer(remote);
        else detachRemoteRacer(remote);
        if (game.state === 'race') checkResults();
      } catch (e) {}
      if (why !== 'replaced' && hud && (game.state === 'race' || game.state === 'countdown')) hud.toast(t('toast.left'), 1800);
    },
    onReset: (remote) => { try { if (remote.racer) resetRacer(remote.racer); } catch (e) {} },
    onCar: onRemoteCar,
    welcome: welcomeFor,
    state: (remote) => {
      if (game.state === 'loading') return null;
      return netStateFor(remote);
    },
  });
}
function setJoinStatus(text, kind) {
  const el = $('joinStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'sub' + (kind === 'bad' ? ' bad' : kind === 'ok' ? ' ok' : '');
}
function showBanner(text) {
  const el = $('netbanner');
  if (!el) return;
  if (!text) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = text;
  el.classList.remove('hidden');
}
function onGuestWelcome(msg) {
  if (!guestNet) return;
  guestNet.connected = true;
  guestTries = 0;
  showBanner('');
  const want = msg && msg.track;
  if (want && want !== track.id && TRACKS.some((t) => t.id === want)) {
    const u = new URL(location.href);
    u.searchParams.set('join', joinCode);
    u.searchParams.set('track', want);
    if (!params.get('q')) u.searchParams.set('q', 'low');
    location.replace(u.toString());
    return;
  }
  guestTrackReady = true;
  if (guestCarPick) {
    setVehicle(guestCarPick.vehicle, guestCarPick.paint, { persist: false, keepEnergy: true });
  } else if (msg && msg.vehicle) {
    setVehicle(msg.vehicle, msg.paint, { persist: false, notify: false, keepEnergy: true });
  }
  setJoinStatus(t('guest.waitHost', { how: linkHow(guestNet.via) }), 'ok');
}
function onGuestState(msg) {
  if (!guestNet || !msg) return;
  const prev = guestNet.latest;
  const packetVehicle = msg.selfVehicle;
  if (!msg.standings && prev && prev.standings) msg.standings = prev.standings;
  guestNet.latest = msg;
  guestNet.connected = true;
  guestOffLeft = msg.offLeft > 0 ? msg.offLeft : 0;
  if (!guestCarPick && packetVehicle) setVehicle(packetVehicle, msg.selfPaint, { persist: false, notify: false, keepEnergy: true });
  const cars = (msg.cars || []).filter((c) => c && c.id !== msg.selfId);
  guestBuf.push(performance.now(), cars);
  if (msg.selfLap) {
    if (Number.isFinite(msg.selfLap.n)) guestLap.n = msg.selfLap.n;
    if (Number.isFinite(msg.selfLap.t)) guestLap.t = msg.selfLap.t;
    if (msg.selfLap.last !== undefined) guestLap.last = msg.selfLap.last;
    if (msg.selfLap.best !== undefined) guestLap.best = msg.selfLap.best;
  }
  const wantTrack = msg.track;
  if (wantTrack && wantTrack !== track.id && TRACKS.some((t) => t.id === wantTrack)) {
    const u = new URL(location.href);
    u.searchParams.set('join', joinCode);
    u.searchParams.set('track', wantTrack);
    if (!params.get('q')) u.searchParams.set('q', 'low');
    location.replace(u.toString());
    return;
  }
  if (msg.self) noteHostSelf(msg);
  else pendingSnap = null;
  if (msg.battle) guestBattle = msg.battle;
  else if (msg.keyframe) guestBattle = { on: false, boxes: [], shots: [] };
  if (ui && (msg.battle || msg.keyframe)) ui.setHostItems(!!(guestBattle && guestBattle.on));
  guestTrackReady = true;
  const phase = msg.race;
  if (!guestLive && (phase === 'countdown' || phase === 'race' || phase === 'paused')) enterGuestRace(msg);
  if (guestLive && (phase === 'countdown' || phase === 'race') && (game.state === 'results' || game.state === 'menu')) enterGuestRace(msg);
  if (guestLive && phase === 'results' && game.state !== 'results') showGuestResults(msg);
  if (guestLive && phase === 'menu') leaveGuestRace();
  if (!guestLive) {
    if (phase === 'results') showGuestResults(msg);
    return;
  }
  if (phase === 'countdown' && game.state !== 'paused') {
    game.countdown = typeof msg.cd === 'number' ? msg.cd : game.countdown;
    if (game.state !== 'countdown') game.state = 'countdown';
  }
  if (phase === 'race' && game.state === 'countdown') {
    game.state = 'race';
    game.hostPaused = false;
    if (hud) { hud.count(t('toast.go')); setTimeout(() => hud && hud.count(''), 700); }
  }
  if (phase === 'paused' && (game.state === 'race' || game.state === 'countdown')) {
    game.hostPaused = true;
    game.prevState = game.state;
    game.state = 'paused';
    if (hud) hud.toast(t('toast.hostPause'), 1500);
  }
  if (phase === 'race' && game.state === 'paused' && game.hostPaused) {
    game.hostPaused = false;
    game.state = 'race';
    if (ui.current === 'pause') ui.hideAll();
  }
}
function onGuestFail(msg) {
  if (guestNet) { guestNet.failed = true; guestNet.failMsg = msg; }
  setJoinStatus(msg, 'bad');
  if (guestLive) showBanner(msg);
  else showBanner('');
}
function onGuestClose(info) {
  if (!guestNet || guestNet._destroyed) return;
  guestNet.connected = false;
  if (info && info.full) return;
  if (info && info.replaced) {
    setJoinStatus(t('guest.replaced'), 'bad');
    showBanner(t('guest.replacedBanner'));
    return;
  }
  if (guestLive) showBanner(t('guest.dropLive'));
  else setJoinStatus(t('guest.drop'), 'bad');
  if (guestRetryTimer) return;
  guestRetryTimer = setTimeout(() => {
    guestRetryTimer = null;
    retryGuest();
  }, 800);
}
function onGuestStage(info) {
  if (!info) return;
  if (guestNet && guestNet.connected) {
    if (guestLive) { showBanner(''); return; }
    setJoinStatus(t('guest.waitHost', { how: linkHow(guestNet.via) }), 'ok');
    return;
  }
  if (guestLive) showBanner(t('guest.lost'));
  setJoinStatus(info.text || '', info.kind === 'fail' ? 'bad' : 'wait');
}
function beginGuest() {
  if (!game.guest || netOff) return;
  if (guestNet) { try { guestNet.destroy(); } catch (e) {} guestNet = null; }
  setJoinStatus(t('guest.scanning'), 'wait');
  const relayIndex = Number(params.get('relay'));
  const relayEpoch = Number(params.get('epoch'));
  guestNet = createGuest(joinCode, {
    onWelcome: onGuestWelcome,
    onState: onGuestState,
    onFail: onGuestFail,
    onClose: onGuestClose,
    onStatus: onGuestStage,
    relayIndex: Number.isFinite(relayIndex) ? relayIndex : 0,
    relayEpoch: Number.isFinite(relayEpoch) ? relayEpoch : 0,
  });
}
function retryGuest() {
  if (!game.guest) return;
  guestTries = 0;
  if (guestRetryTimer) { clearTimeout(guestRetryTimer); guestRetryTimer = null; }
  beginGuest();
}
function leaveGuestRoom() {
  try { if (guestNet) guestNet.destroy({ gone: true }); } catch (e) {}
  const u = new URL(location.href);
  u.searchParams.delete('join');
  location.href = u.toString();
}
function enterGuestRace(msg) {
  guestLive = true;
  clearGhosts();
  ui.hideAll();
  hud.show(true);
  setSplit(false);
  veh.followHost = true;
  veh.energy = 100;
  guestEase.ready = false;
  guestVis.on = false;
  veh.placeOnTrack(track.wrap(track.N - 10), 6, 0);
  game.camYaw = veh.heading;
  game.camSnap = true;
  game.countdown = typeof msg.cd === 'number' ? msg.cd : 3.4;
  game.lastCount = -1;
  game.hostPaused = msg.race === 'paused';
  game.state = msg.race === 'race' ? 'race' : (msg.race === 'paused' ? 'paused' : 'countdown');
  const sb = $('standings');
  if (sb) sb.classList.remove('hidden');
  showBanner('');
  updateTouchVisibility();
}
function leaveGuestRace() {
  guestLive = false;
  pendingSnap = null;
  guestSelfAt = 0;
  guestVis.on = false;
  guestEase.ready = false;
  guestRoad = { known: false, onRoad: true, since: 0, toastAt: 0 };
  guestOffLeft = 0;
  clearGhosts();
  setSplit(false);
  game.state = 'menu';
  game.hostPaused = false;
  if (hud) { hud.show(false); hud.count(''); }
  const sb = $('standings'); if (sb) sb.classList.add('hidden');
  veh.placeOnTrack(track.wrap(track.N - 10), 0, 0);
  ui.show('join');
  if (guestNet && guestNet.connected) setJoinStatus(t('guest.inRoom', { code: formatCode(joinCode) }), 'ok');
}
function showGuestResults(msg) {
  guestLive = true;
  game.state = 'results';
  const list = $('resultsList');
  const rows = (msg && msg.standings) || [];
  if (list) {
    list.innerHTML = rows.map((r, i) => `<div>${i + 1}. ${r.name}　${r.finish != null ? fmtTime(r.finish) : t('results.dnf')}</div>`).join('');
  }
  ui.show('results');
  if (hud) hud.count('');
}
function clearGhosts() {
  for (const g of ghosts.values()) releaseRemoteCar({ car: g.car });
  ghosts.clear();
  guestPoses = [];
}
function applyGhost(c, pose, dt) {
  c.root.position.set(pose.x || 0, pose.y || 0, pose.z || 0);
  c.root.quaternion.set(pose.qx || 0, pose.qy || 0, pose.qz || 0, pose.qw == null ? 1 : pose.qw);
  c.root.visible = true;
  c.update(dt, {
    grounded: !!pose.grounded, impact: 0, accel: 0, latAccel: 0, speedF: pose.speed || 0,
    steerAngle: pose.steer || 0, thrust: pose.thrust || 0, lift: pose.lift || 0, nitro: !!pose.nitro, braking: !!pose.braking,
  });
  const gy = Number.isFinite(pose.gy) ? pose.gy : (pose.y || 0);
  c.blob.position.set(pose.x || 0, gy + 0.04, pose.z || 0);
  _v.set(pose.nx || 0, Number.isFinite(pose.ny) ? pose.ny : 1, pose.nz || 0);
  if (_v.lengthSq() < 1e-4) _v.set(0, 1, 0);
  _q.setFromUnitVectors(_v2.set(0, 1, 0), _v.normalize());
  c.blob.quaternion.copy(_q);
  c.blob.rotateY(-(pose.heading || 0));
  c.blob.material.opacity = 0.55;
}
function syncGhosts(dt) {
  const poses = guestBuf.sample(performance.now());
  guestPoses = poses;
  const seen = new Set();
  const fallback = vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).id;
  for (const pose of poses) {
    if (!pose || !pose.id) continue;
    seen.add(pose.id);
    const vid = vehicleById(pose.vehicle || fallback).id;
    const paint = validPaint(vid, pose.paint || 'white');
    let g = ghosts.get(pose.id);
    if (!g || g.car.vehicleId !== vid || g.car.paintKey !== paint) {
      if (g) releaseRemoteCar({ car: g.car });
      const c = new CarModel(QUALITY.low, vid, paint);
      c.setPaint(paint);
      scene.add(c.root); scene.add(c.blob);
      g = { car: c };
      ghosts.set(pose.id, g);
    }
    applyGhost(g.car, pose, dt);
  }
  for (const [id, g] of ghosts) {
    if (seen.has(id)) continue;
    releaseRemoteCar({ car: g.car });
    ghosts.delete(id);
  }
}
function nudgeVehicle(v, s, k) {
  v.pos.x += ((s.x || 0) - v.pos.x) * k;
  v.pos.y += ((s.y || 0) - v.pos.y) * k;
  v.pos.z += ((s.z || 0) - v.pos.z) * k;
  v.vel.x += ((s.vx || 0) - v.vel.x) * k;
  v.vel.y += ((s.vy || 0) - v.vel.y) * k;
  v.vel.z += ((s.vz || 0) - v.vel.z) * k;
  if (Number.isFinite(s.energy)) v.energy += (s.energy - v.energy) * k;
}
function applyReconcile(msg) {
  if (!msg || !msg.self || !veh.importState) return;
  const local = { x: veh.pos.x, y: veh.pos.y, z: veh.pos.z };
  const decision = reconcileDecision(local, msg.self, msg.ack | 0, guestNet ? guestNet.log : []);
  if (decision.mode === 'nudge') nudgeVehicle(veh, msg.self, 0.22);
  else if (decision.mode === 'replay') {
    veh.importState(msg.self);
    for (const rec of decision.replay) {
      const n = Math.min(rec.steps | 0, 36);
      const cmd = rec.cmd || zeroInput();
      for (let i = 0; i < n; i++) veh.step(PHYS_DT, cmd);
    }
  } else if (decision.mode === 'snap') veh.importState(msg.self);
}
function toggleFullscreen() {
  try {
    const d = document, el = d.documentElement;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  } catch (e) { hud && hud.toast(t('toast.fullScreen'), 1500); }
}
function nearestGap(v) {
  const subject = v || veh;
  const fi = subject.attached ? subject.fi : subject.q1.fi;
  let best = track.gaps[0], bd = 1e9;
  for (const g of track.gaps) { let d = fi - g.g0; if (d < -track.N / 2) d += track.N; if (d > track.N / 2) d -= track.N; d = Math.abs(d); if (d < bd) { bd = d; best = g; } }
  return best;
}
function whyText(msg) {
  if (msg === 'stuck') return t('toast.stuck');
  if (msg === 'off') return t('toast.deviate');
  return msg || '';
}
function respawnRacer(r, why) {
  const v = r ? r.veh : veh;
  const msg = whyText((v.events && v.events.why) || why);
  if (v.events) v.events.why = '';
  const lap = (r && r.lap) || game.lap;
  const keep = lap ? { n: lap.n, t: lap.t, cp: lap.cp.slice(), last: lap.last, best: lap.best } : null;
  if (v.recoverBehind) v.recoverBehind(18);
  else if (track.checkpoints && track.checkpoints.length && v.recoverToCheckpoint) v.recoverToCheckpoint();
  else v.placeOnTrack(track.wrap((v.lastGoodFi != null ? v.lastGoodFi : v.fi) - 8), r ? r.lat0 : 0, 18);
  if (lap && keep) {
    lap.n = keep.n;
    lap.t = keep.t;
    lap.cp = keep.cp;
    lap.last = keep.last;
    lap.best = keep.best;
    lap.prevFi = v.attached ? v.fi : (v.q1 && v.q1.fi);
  }
  v.energy = Math.max(v.energy, 55);
  v.offLeft = 0;
  if (!r || r.primary) {
    game.respawns = (game.respawns || 0) + 1;
    hud.flash();
    game.camSnap = true; game.camYaw = v.heading;
    if (msg) hud.toast(msg, 2200);
  } else if (r.cam) { r.cam.snap = true; r.cam.yaw = v.heading; }
}
function respawn(why) { respawnRacer(race ? race.racers[0] : null, why); }
function resetRacer(r) {
  const v = r.veh;
  let idx = v.q1.near ? v.q1.i : (r.lastGoodI || game.lastGoodI);
  if (v.attached) idx = Math.floor(v.fi);
  if (v.q1.gap && track.gaps.length) idx = track.wrap(nearestGap(v).g0 - track.rampRows - 32);
  v.placeOnTrack(idx, r.lat0 || 0, 0);
  v.energy = Math.max(v.energy, 30);
  if (r.primary) { game.camSnap = true; game.camYaw = v.heading; hud.toast(t('toast.reset'), 1200); }
  else if (r.cam) { r.cam.snap = true; r.cam.yaw = v.heading; }
}
function resetToTrack() {
  if (race) resetRacer(race.racers[0]);
  else {
    let idx = veh.q1.near ? veh.q1.i : game.lastGoodI;
    if (veh.q1.gap && track.gaps.length) idx = track.wrap(nearestGap().g0 - track.rampRows - 32);
    veh.placeOnTrack(idx, 0, 0);
    veh.energy = Math.max(veh.energy, 30);
    game.camSnap = true; game.camYaw = veh.heading;
    hud.toast(t('toast.reset'), 1200);
  }
}

// ---------------- 圈速 / 能量環 ----------------
function updateLap(dt) {
  const q = veh.q1, N = track.N, lap = game.lap;
  lap.t += dt;
  if (!q.near) return;
  if (q.al < 30) game.lastGoodI = q.i;
  const fi = q.fi;
  if (lap.prevFi != null) {
    if (lap.prevFi > N * 0.8 && fi < N * 0.2) {
      if (lap.cp.every(Boolean)) {
        const t = lap.t;
        lap.last = t;
        const isBest = lap.best == null || t < lap.best;
        if (isBest) { lap.best = t; store.set('best.' + track.id, t); store.set('best', t); }
        hud.toast(isBest ? t('toast.lapBest', { n: lap.n }) : t('toast.lap', { n: lap.n }), 2500);
        audio.beep(true);
        lap.n++; lap.t = 0; lap.cp = [false, false, false];
        world.resetRings();
        input.rumble(0.4, 0.7, 250);
      } else if (lap.cp.some(Boolean)) hud.toast(t('toast.miss'), 1800);
    } else if (lap.prevFi < N * 0.2 && fi > N * 0.8) {
      lap.cp = [false, false, false];
    }
  }
  const cps = [0.25, 0.5, 0.75];
  if (q.al < 18) {
    for (let k = 0; k < 3; k++) if (!lap.cp[k] && (k === 0 || lap.cp[k - 1]) && fi > cps[k] * N && fi < (cps[k] + 0.06) * N) lap.cp[k] = true;
  }
  lap.prevFi = fi;
}
function updateRings(dt) {
  const humans = race ? race.racers.filter((r) => r.driver && r.driver.kind !== 'ai' && !r.parked) : [{ veh, input, primary: true }];
  for (const ring of world.rings) {
    if (!ring.on) { if (game.time - ring.t > 45) ring.on = true; continue; }
    for (const h of humans) {
      const v = h.veh;
      const dx = v.pos.x - ring.pos.x, dy = v.pos.y + 0.6 - ring.pos.y, dz = v.pos.z - ring.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > (ring.R + 3) * (ring.R + 3)) continue;
      const along = dx * ring.T.x + dz * ring.T.z;
      if (Math.abs(along) > 3.2) continue;
      if (d2 - along * along > (ring.R * 0.95) * (ring.R * 0.95)) continue;
      ring.on = false; ring.t = game.time;
      v.energy = Math.min(100, v.energy + 30);
      const sp = v.speed;
      if (sp > 1 && sp < 115) {
        const k = (v.grounded ? 6 : 8) / sp;
        v.vel.x *= 1 + k; v.vel.z *= 1 + k;
      }
      if (h.primary) {
        hud.toast(t('toast.ring'), 1000);
        audio.ding();
        input.rumble(0.3, 0.8, 140);
        game.shake = Math.max(game.shake, 0.25);
      } else if (h.input) h.input.rumble(0.3, 0.8, 140);
      break;
    }
  }
}

// ---------------- 車輛同步 ----------------
function syncOne(dt, v, c, impact) {
  c.root.position.copy(v.pos);
  c.root.quaternion.copy(v.q);
  c.update(dt, {
    grounded: v.grounded, impact: impact || 0, accel: v.accel, latAccel: v.latAccel, speedF: v.speedF,
    steerAngle: v.steerAngle, thrust: v.thrust, lift: v.lift, nitro: v.nitroOn, braking: v.braking,
  });
  const gy = v.groundY;
  c.blob.position.set(v.pos.x, gy + 0.04, v.pos.z);
  _v.copy(v.n);
  _q.setFromUnitVectors(_v2.set(0, 1, 0), _v);
  c.blob.quaternion.copy(_q);
  c.blob.rotateY(-v.heading);
  c.blob.material.opacity = (Q.shadows && !game.split ? 0.4 : 0.8) * clamp(1 - v.alt / 22, 0.05, 1);
  c.root.visible = true;
}
function selfAsPose(s) {
  const p = packSelf(s);
  if (!p) return null;
  return {
    id: 'self',
    x: p.x, y: p.y, z: p.z, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw,
    vx: p.vx, vy: p.vy, vz: p.vz, heading: p.heading,
    speed: (p.speed > 0.4 || Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0) < 1) ? p.speed : Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0),
    gy: p.groundY, nx: p.nx, ny: p.ny, nz: p.nz,
    grounded: p.grounded, nitro: p.nitroOn, thrust: p.thrust, lift: p.lift,
    braking: p.braking, steer: p.steerAngle, onRoad: p.onRoad,
    energy: p.energy, alt: p.alt, thrusting: p.thrusting,
  };
}
function noteHostSelf(msg) {
  if (!msg || !msg.self || (msg.track && msg.track !== track.id)) return;
  const pose = selfAsPose(msg.self);
  if (!pose || !Number.isFinite(pose.x)) return;
  const now = performance.now();
  guestSelfBuf.push(now, [pose]);
  guestSelfAt = now;
  pendingSnap = null;
  const road = hostOffroadWarn(guestRoad, pose.onRoad, now);
  guestRoad = road.state;
  // 倒數已經在畫了。舊的「偏離賽道」每 4 秒跳一次，正常跳躍也會觸發。
  if (road.warn && !(guestOffLeft > 0) && pose.onRoad === false && guestLive && game.state === 'race' && hud) hud.toast(t('toast.offroad'), 1400);
}
function sampleGuestView(dt) {
  if (!game.guest || !guestSelfAt || performance.now() - guestSelfAt > 2500) {
    guestVis.on = false;
    return null;
  }
  const poses = guestSelfBuf.sample(performance.now(), 0.25);
  const p = poses && poses[0];
  if (!p || !Number.isFinite(p.x)) { guestVis.on = false; return null; }
  easeGuestPose(guestEase, p, dt);
  guestVis.pos.set(guestEase.x, guestEase.y, guestEase.z);
  guestVis.q.set(guestEase.qx || 0, guestEase.qy || 0, guestEase.qz || 0, guestEase.qw == null ? 1 : guestEase.qw);
  guestVis.heading = guestEase.heading || 0;
  guestVis.speed = guestEase.speed || 0;
  guestVis.speedF = guestVis.speed;
  if (guestVis.n) guestVis.n.set(p.nx || 0, p.ny == null ? 1 : p.ny, p.nz || 0);
  if (!guestVis.n || guestVis.n.lengthSq() < 1e-8) guestVis.n.set(0, 1, 0);
  else guestVis.n.normalize();
  guestVis.groundY = Number.isFinite(p.gy) ? p.gy : guestVis.pos.y;
  guestVis.grounded = p.grounded !== false;
  guestVis.nitroOn = !!p.nitro;
  guestVis.thrust = p.thrust || 0;
  guestVis.lift = p.lift || 0;
  guestVis.thrusting = !!p.thrusting || guestVis.thrust > 0.2;
  guestVis.braking = !!p.braking;
  guestVis.steerAngle = p.steer || 0;
  const rawE = Number.isFinite(p.energy) ? p.energy : veh.energy;
  guestVis.energy = Math.max(0, Math.min(100, rawE));
  guestVis.alt = Number.isFinite(p.alt) ? p.alt : 0;
  guestVis.accel = 0;
  guestVis.latAccel = 0;
  guestVis.on = true;
  return guestVis;
}
function syncCar(dt) {
  if (game.guest) { syncOne(dt, sampleGuestView(dt) || veh, car, 0); return; }
  if (!race) { syncOne(dt, veh, car, game.impactForCar || 0); game.impactForCar = 0; return; }
  for (const r of race.racers) {
    const hit = r.primary ? (game.impactForCar || 0) : (r.impactForCar || 0);
    syncOne(dt, r.veh, r.car, hit);
    if (r.primary) game.impactForCar = 0; else r.impactForCar = 0;
  }
}

// ---------------- 相機 ----------------
function updateCamera(dt, subject, cam, decay = true, viewVeh) {
  cam = cam || camera;
  if (params.get('overview') === '1') {
    const b = track.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 80);
    const gy = track.py[0] || 0;
    cam.position.set(cx, gy + span * 0.92, cz + span * 0.02);
    cam.up.set(0, 1, 0);
    cam.lookAt(cx, gy, cz);
    cam.fov = 42;
    if (cam.view && cam.view.enabled) cam.clearViewOffset();
    cam.updateProjectionMatrix();
    return;
  }
  const v = viewVeh || (subject ? subject.veh : veh);
  const cmodel = subject ? subject.car : car;
  cam = cam || camera;
  const st = subject ? subject.cam : null;
  const mode = game.camMode, sp = v.speed;
  const snap = st ? st.snap : game.camSnap;
  if (st) st.snap = false; else game.camSnap = false;
  if (!subject && game.state === 'menu') {
    game.orbit = (game.orbit || 0) + dt * 0.25;
    const a = game.orbit + 0.6;
    const cd = cmodel.vehicle.cam, md = cd.menu || 13 * cd.dist, mh = 0.28 * md, ly = 0.6 * Math.max(1, cd.height);
    camPos.set(v.pos.x + Math.cos(a) * md, v.pos.y + mh, v.pos.z + Math.sin(a) * md);
    cam.position.copy(camPos);
    cam.lookAt(v.pos.x, v.pos.y + ly, v.pos.z);
    cam.fov = damp(cam.fov, 45, 5, dt);
    const vs = viewSize();
    cam.setViewOffset(vs.w, vs.h, -vs.w * 0.27, 0, vs.w, vs.h);
    cam.updateProjectionMatrix();
    return;
  }
  if (cam.view && cam.view.enabled) cam.clearViewOffset();
  const lam = snap ? 999 : mode === 2 ? 40 : viewVeh ? 2.2 : (v.grounded ? 5.5 : 3.5);
  const yaw0 = st ? st.yaw : game.camYaw;
  const yaw = yaw0 + wrapAngle(v.heading - yaw0) * (1 - Math.exp(-lam * dt));
  if (st) st.yaw = yaw; else game.camYaw = yaw;
  const dir = _v2.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  const fovBase = [62, 68, 74, 56][mode];
  const fov = fovBase + 30 * smoothstep(10, 100, sp) + (v.nitroOn ? 6 : 0);
  cam.fov = snap ? fov : damp(cam.fov, fov, 6, dt);
  const cpos = st ? st.pos : camPos;
  if (mode === 2) {
    _v.set(0, cmodel.vehicle.cam.cockpit[0], cmodel.vehicle.cam.cockpit[1]).applyQuaternion(v.q).add(v.pos);
    cam.position.copy(_v);
    cam.quaternion.copy(v.q);
    cpos.copy(_v);
  } else {
    const cv = cmodel.vehicle.cam;
    const dist = [7.6, 5.4, 0, 13.5][mode] * cv.dist + sp * 0.03;
    const h = [2.5, 1.5, 0, 5.2][mode] * cv.height + clamp(v.alt, 0, 40) * 0.12;
    const tx = v.pos.x - dir.x * dist, tz = v.pos.z - dir.z * dist, ty = v.pos.y + h;
    if (snap) cpos.set(tx, ty, tz);
    else {
      const follow = viewVeh ? 6 : 16;
      cpos.x = damp(cpos.x, tx, follow, dt); cpos.z = damp(cpos.z, tz, follow, dt); cpos.y = damp(cpos.y, ty, viewVeh ? 4 : 7, dt);
    }
    const gy = track.groundHeight(cpos.x, cpos.z) + 0.8;
    if (cpos.y < gy) cpos.y = gy;
    cam.position.copy(cpos);
    const ahead = [7, 9, 0, 6][mode];
    cam.lookAt(v.pos.x + dir.x * ahead, v.pos.y + [1.2, 1.0, 0, 1.0][mode] * cv.height + clamp(v.alt, 0, 40) * 0.04, v.pos.z + dir.z * ahead);
  }
  const noise = game.guest ? 0 : (smoothstep(40, 110, sp) * 0.012 + (v.nitroOn ? 0.012 : 0) + (v.thrusting ? 0.004 : 0));
  const k = game.guest ? 0 : noise + game.shake * 0.05;
  if (k > 0.0005 && game.state === 'race') {
    cam.position.x += (Math.random() - 0.5) * k * 2;
    cam.position.y += (Math.random() - 0.5) * k * 2 - game.kick;
    cam.position.z += (Math.random() - 0.5) * k * 2;
  }
  if (decay) {
    game.shake = Math.max(0, game.shake - dt * 1.8);
    game.kick = damp(game.kick, 0, 7, dt);
  }
  cam.updateProjectionMatrix();
}
const _buf = new THREE.Vector2();
function renderSplit(dt) {
  const locals = race.locals();
  renderer.getDrawingBufferSize(_buf);
  const w = _buf.x, h = _buf.y;
  const half = Math.max(1, Math.floor(h / 2));
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  const views = [
    { y: half, height: Math.max(1, h - half), racer: locals[0], cam: camera },
    { y: 0, height: half, racer: locals[1], cam: camera2 },
  ];
  views.forEach((view, i) => {
    if (!view.racer) return;
    const cam = view.cam;
    cam.aspect = w / view.height;
    renderer.setViewport(0, view.y, w, view.height);
    renderer.setScissor(0, view.y, w, view.height);
    renderer.clear(true, true, true);
    updateCamera(dt, view.racer, cam, i === views.length - 1);
    world.update(cam, view.racer.veh.pos);
    renderer.render(scene, cam);
  });
}

// ---------------- 主迴圈 ----------------
let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (!(dt > 0)) return;
  dt = Math.min(dt, 0.1);
  game.time += dt;
  try { if (hostNet && hostNet.poll) hostNet.poll(now); } catch (e) {}
  try { if (guestNet && guestNet.poll) guestNet.poll(now); } catch (e) {}
  if (!game.freeze) {
    if (race && game.state !== 'menu') race.pollHumans(dt);
    else input.poll(dt);
  }
  const pressed = input.pressed;

  // UI 導航
  if (ui.active) { ui.handleNav(input.nav); ui.updateMeters(); }
  if (game.state === 'menu' && !ui.active) ui.show('start');

  if (game.state === 'countdown' || game.state === 'race') {
    if (pressed.pause) { pause(); }
    else {
      if (pressed.camera) { game.camMode = (game.camMode + 1) % 4; game.camSnap = true; }
      if (game.state === 'race') {
        if (!game.freeze) {
          if (pressed.reset) {
            if (game.guest) {
              if (game.outbox) game.outbox.push({ t: 'reset' });
              if (guestNet) guestNet.send({ t: 'reset' });
              else if (!game.outbox) resetToTrack();
            } else resetToTrack();
          }
          const p2 = race && race.locals()[1];
          if (p2 && p2.input && p2.input.pressed.reset) resetRacer(p2);
          game.acc += dt;
          let steps = 0;
          if (game.guest) {
            if (guestNet) guestNet.noteInput(input.state, performance.now());
            const freshHost = guestSelfAt > 0 && performance.now() - guestSelfAt < 400;
            if (!freshHost) {
              while (game.acc >= PHYS_DT && steps < 4) {
                veh.step(PHYS_DT, input.state);
                if (guestNet) guestNet.noteSubstep();
                game.acc -= PHYS_DT; steps++;
              }
              if (steps === 4) game.acc = 0;
            } else game.acc = 0;
            veh.events.respawn = false;
            veh.events.why = '';
            veh.events.offroad = false;
            veh.events.impact = 0;
            veh.events.wall = 0;
            pendingSnap = null;
          } else {
            try { applyRemoteInputs(); } catch (e) {}
            while (game.acc >= PHYS_DT && steps < 6) {
              if (race) race.step(PHYS_DT);
              else veh.step(PHYS_DT, input.state);
              if (battle && battle.enabled && race && game.state === 'race') battle.step(PHYS_DT, race.racers);
              game.acc -= PHYS_DT; steps++;
            }
            if (steps === 6) game.acc = 0;
            handleEvents(dt);
            if (!race) updateLap(dt);
            updateRings(dt);
            checkResults();
          }
        }
      } else if (!game.guest) {
        if (game._cdStart && performance.now() - game._cdStart > 8000) game.countdown = 0;
        game.countdown -= dt;
        const c = Math.ceil(game.countdown - 0.4);
        if (c !== game.lastCount) {
          game.lastCount = c;
          if (c > 0) { hud.count(String(c)); audio.beep(false); } else { hud.count(t('toast.go')); audio.beep(true); }
        }
        if (game.countdown <= 0.4 && game.state === 'countdown') { game.state = 'race'; setTimeout(() => hud.count(''), 700); }
        if (race) for (const r of race.racers) r.veh.energy = 100;
        else veh.energy = 100;
      } else {
        const c = Math.ceil((game.countdown || 0) - 0.4);
        if (c !== game.lastCount) {
          game.lastCount = c;
          if (c > 0) { hud.count(String(c)); audio.beep(false); } else hud.count(t('toast.go'));
        }
      }
    }
  } else if (game.state === 'paused') {
    if (pressed.pause && ui.current === 'pause') resume();
  }

  // 比賽中每幀畫。選單和結算最多 4Hz，暫停最多 1Hz，避免車機在不動的畫面空轉。
  const racing = game.state === 'countdown' || game.state === 'race';
  if (game._shown !== game.state) { game._shown = game.state; game._presentAt = 0; }
  const draw = racing || (now - (game._presentAt || 0) >= (game.state === 'paused' ? 1000 : 250));
  if (draw) {
    syncCar(dt);
    if (game.guest && guestLive) { try { syncGhosts(dt); } catch (e) {} }
    world.updateRings(dt, game.time);
    if (world.syncItems) world.syncItems(battleFrameView(), game.time);
    if (game.split && race && race.locals().length > 1 && game.state !== 'menu') renderSplit(dt);
    else {
      const view = game.guest && guestVis.on ? guestVis : null;
      updateCamera(dt, null, null, true, view);
      world.update(camera, (view || veh).pos);
      renderer.render(scene, camera);
    }
    game._presentAt = now;
  }

  // HUD / 音效
  if (game.state === 'countdown' || game.state === 'race' || game.state === 'paused') {
    const shown = game.guest && guestVis.on ? guestVis : veh;
    const onRoad = game.guest && guestRoad.known ? guestRoad.onRoad : shown.onRoad !== false;
    const stLabel = shown.nitroOn ? t('hud.nitro') : !shown.grounded ? (shown.thrusting ? t('hud.flying') : t('hud.air')) : (!onRoad ? t('hud.off') : t('hud.ground'));
    const lapView = game.guest && guestLive ? guestLap : game.lap;
    hud.update(dt, shown, lapView, camName(game.camMode), game.guest ? t('hud.touchDrive') : padText(), stLabel);
    hud.setOff(game.guest ? guestOffLeft : (veh.offLeft || 0));
    hud.setBattle(battleHud());
    if (game.guest && guestPoses.length) {
      hud.drawMinimap(shown, guestPoses.map((p) => ({ veh: { pos: { x: p.x, z: p.z }, heading: p.heading || 0 }, driver: { kind: p.kind || 'remote' } })));
    } else hud.drawMinimap(shown, race ? race.racers : null);
    hud.fx(dt, shown, !game.guest && Q.fx && game.state === 'race' && !game.split);
    updateStandings();
  }
  if (audio.ctx && audio.ctx.state === 'suspended' && (input.anyPadInput || pressed.pause)) audio.init();
  {
    const shown = game.guest && guestVis.on ? guestVis : veh;
    audio.update(shown.speed, shown.thrust, shown.lift, shown.nitroOn, shown.grounded, game.state === 'race');
  }
  updateTouchVisibility();
  const pi = input.padInfo;
  const sp = $('startPad');
  if (sp) { sp.className = 'padline' + (pi.connected ? ' ok' : ''); const label = pi.connected ? t('start.pad.on', { name: shortPadName(pi.id), profile: profileLabel(input.profile) }) : t('start.pad.wait'); if (sp.textContent !== label) sp.textContent = label; }
  if (game.state === 'menu' && !game.guest) {
    pollLobby();
    if (ui && ui.current === 'lobby') {
      if (!game._lobbySince) game._lobbySince = performance.now();
      const phoneHere = hostNet && hostNet.remotes && hostNet.remotes.length;
      if (!lobby.p2 && !phoneHere && performance.now() - game._lobbySince > 8000) {
        const hint = document.querySelector('#s-lobby .sub');
        if (hint && hint.dataset.alone !== '1') {
          hint.dataset.alone = '1';
          hint.textContent = t('lobby.alone');
        }
      }
    } else game._lobbySince = 0;
  }
  try { flushNet(false); } catch (e) {}
  try { paintLink(); } catch (e) {}
  try { paintDebug(); } catch (e) {}
  adaptResolution(dt);
}

function handleEvents(dt) {
  const list = race ? race.racers : [{ veh, input, primary: true }];
  for (const r of list) {
    const v = r.veh, ev = v.events, pad = r.input || null;
    if (r.primary) {
      if (ev.impact > 3) {
        const k = clamp(ev.impact / 22, 0.1, 1);
        input.rumble(0.35 + 0.65 * k, 0.5 + 0.4 * k, 120 + 220 * k, true);
        audio.land(ev.impact);
        game.shake = Math.max(game.shake, k);
        game.kick = Math.max(game.kick, k * 0.45);
      }
      if (ev.wall > 0) {
        const k = clamp(ev.wall / 40, 0.2, 1);
        input.rumble(0.9 * k + 0.1, 0.6, 180, true); audio.hit(); game.shake = Math.max(game.shake, k * 0.6);
      }
      game.impactForCar = Math.max(game.impactForCar || 0, ev.impact);
      game.rumbleT -= dt;
      if (game.rumbleT <= 0) {
        let s = 0, w = 0;
        if (v.nitroOn) { s = 0.22; w = 0.45; } else if (v.thrusting) { s = 0.1; w = 0.28; }
        if (ev.offroad && v.speed > 4) { s = Math.max(s, 0.35); w = Math.max(w, 0.2); }
        if (v.grounded && v.speed > 55) w = Math.max(w, (v.speed - 55) / 160);
        if (s || w) { input.rumble(s, w, 120); game.rumbleT = 0.1; }
      }
    } else {
      r.impactForCar = Math.max(r.impactForCar || 0, ev.impact);
      if (pad && ev.impact > 3) pad.rumble(0.4, 0.5, 120, true);
    }
    if (ev.respawn) {
      if (!(game.guest && (r.primary || !race))) respawnRacer(race ? r : null, r.primary || !race ? t('toast.canyon') : '');
    }
    ev.impact = 0; ev.wall = 0; ev.respawn = false; ev.offroad = false;
  }
}
function formatStandings(list) {
  return list.map((r, i) => `${i + 1} ${r.name}${r.finish != null ? '  ' + fmtTime(r.finish) : ''}`).join('\n');
}
function updateStandings() {
  const el = $('standings');
  if (!el) return;
  if (game.guest) {
    const rows = guestNet && guestNet.latest && guestNet.latest.standings;
    if (!rows || rows.length < 2) return;
    const t = formatStandings(rows);
    if (el.textContent !== t) el.textContent = t;
    el.classList.remove('hidden');
    return;
  }
  if (!race || race.racers.length < 2) return;
  const t = formatStandings(race.standings());
  if (el.textContent !== t) el.textContent = t;
}
function showResults() {
  const list = $('resultsList');
  if (list && race) {
    list.innerHTML = race.standings().map((r, i) => `<div>${i + 1}. ${r.name}　${r.finish != null ? fmtTime(r.finish) : t('results.dnf')}</div>`).join('');
  }
  ui.show('results');
}
function checkResults() {
  if (game.guest || !race || !race.raceMode || game.state !== 'race') return;
  const humans = race.racers.filter((r) => r.driver && r.driver.kind !== 'ai');
  if (humans.length && humans.every((r) => r.finish != null)) {
    game.state = 'results';
    showResults();
    flushNet(true);
  }
}
function escPad(s) {
  return String(s).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
function mappingLabel(gp) {
  if (!gp || gp.mapping == null || gp.mapping === '') return t('lobby.nonstd');
  return gp.mapping === 'standard' ? 'standard' : String(gp.mapping);
}
function updateLobby() {
  const p1 = $('startP1'), p2 = $('startP2');
  if (!p1 || !p2 || !input) return;
  const pi = input.padInfo;
  const p1real = pi.connected && !isVirtualPad(pi.id);
  const t1 = p1real ? t('start.p1.pad', { index: pi.index, name: shortPadName(pi.id) }) : t('start.p1.keys');
  if (p1.textContent !== t1) p1.textContent = t1;
  p1.className = 'padline' + (p1real ? ' ok' : '');
  const hint = $('startP2Hint');
  const hintText = t('start.p2.hint');
  if (hint && hint.textContent !== hintText) hint.textContent = hintText;
  if (lobby.p2) {
    const t2 = t('start.p2.on', { index: lobby.p2.index, name: shortPadName(lobby.p2.id) });
    if (p2.textContent !== t2) p2.textContent = t2;
    p2.className = 'padline ok';
  } else {
    const t2 = t('start.p2.off');
    if (p2.textContent !== t2) p2.textContent = t2;
    p2.className = 'padline';
  }
  const box = $('startPads');
  if (!box) return;
  const slots = input.getPadList();
  const lines = [];
  if (!slots.length) lines.push('<div>' + t('lobby.empty') + '</div>');
  for (let i = 0; i < slots.length; i++) {
    const gp = slots[i];
    if (!gp || gp.connected === false) {
      lines.push(`<div>[${i}] ${t('lobby.slotEmpty')}</div>`);
      continue;
    }
    const virt = isVirtualPad(gp);
    let role = t('lobby.out');
    let cls = '';
    if (virt) { role = t('lobby.virt'); cls = 'virt'; }
    else if (p1real && pi.index === gp.index) { role = 'P1'; cls = 'p1'; }
    else if (lobby.p2 && lobby.p2.index === gp.index) { role = 'P2'; cls = 'p2'; }
    const idx = Number.isFinite(gp.index) ? gp.index : i;
    lines.push(`<div class="${cls}">[${idx}] ${escPad(gp.id || t('lobby.noId'))}　${escPad(mappingLabel(gp))}　${role}</div>`);
  }
  const html = lines.join('');
  if (box.innerHTML !== html) box.innerHTML = html;
}
function leaveP2() {
  lobby.p2 = null;
  if (input) input.lockPad(null);
  updateLobby();
}
function joinPad(index) {
  if (lobby.p2 || !input) return false;
  const pads = input.getPadList();
  const gp = pads.find((g) => g && g.index === index);
  if (!gp || isVirtualPad(gp)) return false;
  const p1idx = input.padInfo.connected && !isVirtualPad(input.padInfo.id) ? input.padInfo.index : -1;
  if (p1idx === index || (input.pad && input.pad.index === index && !isVirtualPad(input.pad))) return false;
  if (p1idx >= 0) input.lockPad(p1idx);
  else input.lockPad(-2);
  lobby.p2 = { index: gp.index, id: gp.id || '' };
  updateLobby();
  return true;
}
function pollLobby() {
  if (!input || game.state !== 'menu') return;
  // 走每一格，包含 null。P2 不是 index 1；Tesla 上第二支 Xbox 在 index 2，index 1 是空的。
  const slots = input.getPadList();
  const menuIdx = input.padInfo.connected && !isVirtualPad(input.padInfo.id) ? input.padInfo.index : -1;
  let firstReal = null;
  let joinIdx = null;
  const seen = new Set();
  for (let i = 0; i < slots.length; i++) {
    const gp = slots[i];
    if (!gp || gp.connected === false) {
      lobby.prev.delete(i);
      continue;
    }
    const idx = Number.isFinite(gp.index) ? gp.index : i;
    seen.add(idx);
    const prev = lobby.prev.get(idx) || { btns: [], axes: [] };
    const prevBtns = Array.isArray(prev.btns) ? prev.btns : [];
    const prevAxes = Array.isArray(prev.axes) ? prev.axes : [];
    const buttons = gp.buttons || [];
    const btns = [];
    for (let b = 0; b < buttons.length; b++) btns.push(padButtonDown(buttons[b]));
    const src = gp.axes || [];
    const axes = [];
    for (let a = 0; a < src.length; a++) axes.push(Number.isFinite(src[a]) ? src[a] : 0);
    const edge = btns.some((v, bi) => v && !prevBtns[bi]);
    const stick = padStickHot(axes, prevAxes);
    lobby.prev.set(idx, { btns, axes });
    if (isVirtualPad(gp)) continue;
    if (firstReal == null) firstReal = idx;
    const reserved = menuIdx >= 0 ? menuIdx : firstReal;
    if (lobby.p2 && idx === lobby.p2.index) {
      if (btns[8] && !prevBtns[8]) leaveP2();
      continue;
    }
    // 同一幀有多支在動時，取 index 最小、還沒被 P1 占用的那支。id 相同也分開算。
    if (!lobby.p2 && joinIdx == null && idx !== reserved && (edge || stick)) joinIdx = idx;
  }
  for (const k of [...lobby.prev.keys()]) if (!seen.has(k)) lobby.prev.delete(k);
  if (joinIdx != null && !lobby.p2) joinPad(joinIdx);
  updateLobby();
}

function padText() {
  const p = input.padInfo;
  if (!p.connected) return t('hud.padWake');
  let label = '🎮 ' + shortPadName(p.id);
  if (p.mapping !== 'standard') label += t('hud.padNonstd');
  return label;
}

function paintLink() {
  if (!hud || !hud.setLink) return;
  const net = game.guest ? guestNet : hostNet;
  if (!net || typeof net.linkSample !== 'function') { hud.setLink(null); return; }
  hud.setLink(net.linkSample());
}
function paintDebug() {
  const el = $('netdebug');
  if (!el) return;
  if (params.get('debug') !== '1') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const net = game.guest ? guestNet : hostNet;
  const d = net && net.joinDebug ? net.joinDebug() : null;
  const fmtB = (n) => {
    n = n || 0;
    if (n >= 1000000) return (n / 1e6).toFixed(1) + ' MB/s';
    if (n >= 10000) return (n / 1000).toFixed(1) + ' kB/s';
    return Math.round(n) + ' B/s';
  };
  const lines = d
    ? ['stage ' + d.stage, 'signal ' + d.signal, 'cand ' + d.cand, 'pair ' + d.pair, 'proven ' + d.proven, 'via ' + d.via, 'up ' + fmtB(d.up), 'dn ' + fmtB(d.down)]
    : ['net off'];
  if (d && d.per) lines.push('per ' + fmtB(d.per));
  if (d && d.err) lines.push('err ' + d.err);
  el.textContent = lines.join('\n');
}
function linkHow(via) {
  if (via === 'ws') return t('how.ws');
  if (via === 'relay') return t('how.turn');
  if (via === 'direct') return t('how.direct');
  return t('how.joined');
}

function updateTouchVisibility() {
  const mode = ui ? ui.touchMode : 'auto';
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const guestRace = game.guest && (game.state === 'race' || game.state === 'countdown');
  const want = guestRace || mode === 'on' || (mode === 'auto' && hasTouch && !input.padInfo.connected);
  const show = want && (game.state === 'race' || game.state === 'countdown');
  const el = $('touch');
  if (el.classList.contains('hidden') === show) { el.classList.toggle('hidden', !show); document.body.classList.toggle('touchon', show); }
}

// 動態解析度：效能不足時自動降低渲染解析度
function adaptResolution(dt) {
  if (noAdapt || game.state === 'loading') return;
  game.frames.push(dt);
  if (game.frames.length < 90) return;
  const avg = game.frames.reduce((a, b) => a + b, 0) / game.frames.length;
  game.frames.length = 0;
  let changed = false;
  if (avg > 1 / 27 && game.dyn > 0.55) { game.dyn = Math.max(0.55, game.dyn - 0.1); changed = true; }
  else if (avg < 1 / 52 && game.dyn < (game.split ? 0.7 : 1)) { game.dyn = Math.min(game.split ? 0.7 : 1, game.dyn + 0.05); changed = true; }
  if (changed) applySize();
}

boot();
