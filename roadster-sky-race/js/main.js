// 天空飛馳 Sky Roadster — 主程式
import * as THREE from 'three';
import { World, QUALITY } from './world.js';
import { CarModel, paintsOf } from './car.js';
import { VEHICLES, DEFAULT_VEHICLE, vehicleById } from './vehicles.js';
import { TRACKS, DEFAULT_TRACK, trackById } from './tracks.js';
import { Vehicle } from './physics.js';
import { InputManager } from './input.js';
import { UI, shortPadName } from './ui.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { clamp, lerp, damp, wrapAngle, smoothstep, store, fmtTime } from './util.js';
import { ROAD_HALF } from './track.js';
import { ribbonCompression, KIND } from './stunts.js';
import { Race, LocalDriver, RemoteDriver, LOCAL_LIMIT, RACE_LAPS } from './race.js';
import { AiDriver } from './ai.js';
import { createHost, createGuest, drawRoomQr } from './net.js';
import {
  normalizeCode, formatCode, joinUrl, heldInput, reconcileDecision, StateBuffer, zeroInput,
} from './sync.js';
import * as syncApi from './sync.js';

const params = new URLSearchParams(location.search);
const joinCode = normalizeCode(params.get('join') || '');
const netOff = params.get('nonet') === '1';
let qname = params.get('q') || store.get('quality', null) || ((navigator.hardwareConcurrency || 8) <= 4 ? 'low' : 'med');
if (joinCode && !params.get('q')) qname = 'low';
if (!QUALITY[qname]) qname = 'med';
const Q = QUALITY[qname];
const $ = (id) => document.getElementById(id);
const CAM_NAMES = ['追尾', '低角度', '車內', '遠景'];
const PHYS_DT = 1 / 120;

let renderer, scene, camera, camera2, world, track, car, veh, hud, ui, audio, input, race;
let hostNet = null, guestNet = null;
const ghosts = new Map();
const guestBuf = new StateBuffer(100);
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
  const t = $('loadTxt');
  if (t) { t.style.color = '#ff9a8a'; t.innerHTML = msg; }
}

function baseDpr() { return Math.min(window.devicePixelRatio || 1, 2); }
function applySize() {
  const pr = baseDpr() * Q.scale * game.dyn;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (hud) hud.resize();
}

async function boot() {
  try {
    const canvas = $('gl');
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.aa, powerPreference: 'high-performance', stencil: false });
    } catch (e) { return fail('此瀏覽器無法啟用 WebGL，無法執行遊戲。請改用較新的 Chromium 瀏覽器。', e); }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 7000);
    camera2 = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 7000);
    applySize();
    input = new InputManager();
    audio = new GameAudio();

    const qTrack = params.get('track');
    const tid = (qTrack && TRACKS.some((t) => t.id === qTrack)) ? qTrack : trackById(store.get('track', DEFAULT_TRACK)).id;
    world = new World(renderer, scene, qname, tid);
    track = world.track;
    await world.build((p, label) => { $('loadBar').style.width = Math.round(p * 80) + '%'; $('loadTxt').textContent = `載入中：${label}…`; });
    $('loadTxt').textContent = '載入中：車輛…';
    await new Promise((r) => setTimeout(r, 0));

    const vid = vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).id;
    car = new CarModel(Q, vid, savedPaint(vid)); car.setPaint(savedPaint(vid));
    scene.add(car.root); scene.add(car.blob);
    veh = new Vehicle(track);
    veh.setTune(vehicleById(vid).tune);
    game.lap.best = store.get('best.' + track.id, store.get('best', null));
    hud = new Hud(track, world);

    ui = new UI(input, {
      onStart: () => { if (!game.guest) startGame(); }, onResume: resume, onRestart: () => { if (!game.guest) startGame(); }, onQuit: quit,
      onFullscreen: toggleFullscreen, onVehicle: setVehicle, getCar: () => car,
      onTrack: (id) => { store.set('track', id); const u = new URL(location.href); u.searchParams.delete('track'); location.href = u.toString(); },
      onQuality: (q) => { store.set('quality', q); const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.toString(); },
      getQuality: () => qname, onVolume: (v) => audio.setVolume(v), getVolume: () => audio.volume,
      onTouchMode: () => {}, onTouchPress: (p) => { input.pressed[p] = true; game.touchPressed = p; },
      onBackTop: () => { if (game.state === 'paused') resume(); },
      onJoinRetry: retryGuest, onJoinLeave: leaveGuestRoom,
    });
    input.onProfileChange = (prof) => ui.applyProfile(prof);
    ui.applyProfile(input.profile);
    input.onPadChange = (on, gp) => {
      if (hud && game.state === 'race') hud.toast(on ? '🎮 搖桿已連接' : '🎮 搖桿已中斷', 1500);
    };

    $('loadBar').style.width = '92%';
    veh.placeOnTrack(track.N - 10, 0, 0);
    game.camYaw = veh.heading;
    syncCar(0);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    $('loadBar').style.width = '100%';

    window.addEventListener('resize', applySize);
    window.addEventListener('pagehide', (ev) => {
      if (ev.persisted) return;
      try { if (guestNet && !guestNet._destroyed) guestNet.send({ t: 'bye' }); } catch (e) {}
    });
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => audio.init(), { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'race') pause(); });
    window.addEventListener('blur', () => { if (game.state === 'race' && params.get('nopauseblur') !== '1') pause(); });

    if (qTrack && TRACKS.some((t) => t.id === qTrack)) { ui.trackId = qTrack; ui.refreshTracks(); }
    window.__sky = {
      Q, CarModel, setVehicle, sim, game, veh, input, world, hud, ui, car, camera, camera2, renderer, scene, audio,
      startGame, track, TRACKS, trackById, VEHICLES, vehicleById, THREE,
      lobby, ribbonCompression, KIND, joinPad, pollLobby, leaveP2, LocalDriver, RemoteDriver, LOCAL_LIMIT, RACE_LAPS, AiDriver,
      sync: syncApi, retryGuest,
      get race() { return race; },
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
        get trackReady() { return guestTrackReady; },
        get sent() { return hostNet ? (hostNet.sent || 0) : 0; },
        get lastErr() { return (hostNet && hostNet.lastErr) || ''; },
        disconnect() {
          try { if (guestNet) guestNet.destroy(); } catch (e) {}
          try { if (hostNet) hostNet.destroy(); } catch (e) {}
        },
      },
    };
    game.state = 'menu';
    ui.refreshTracks();
    if (game.guest) {
      ui.show('join');
      const jc = $('joinCode');
      if (jc) jc.textContent = formatCode(joinCode);
      setJoinStatus('正在連上房間 ' + formatCode(joinCode) + '…', 'wait');
      if (!netOff) beginGuest();
    } else {
      ui.show('start');
      if (!netOff) beginHost();
      if (params.get('autostart') === '1') startGame();
    }
    last = performance.now();
    requestAnimationFrame(frame);
  } catch (e) {
    fail('載入失敗：' + (e && e.message ? e.message : e), e);
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
    if (i % 2 === 1) { handleEvents(1 / 60); if (!race) updateLap(1 / 60); updateRings(1 / 60); game.time += 1 / 60; }
    if (cb && cb(i)) break;
  }
}

// ---------------- 車輛選擇 ----------------
function savedPaint(vid) {
  const list = paintsOf(vid), k = store.get('paint.' + vid, null);
  return list.some((p) => p.key === k) ? k : list[0].key;
}
// 換車：重建車輛模型、套用該車的物理調校；paintKey 省略時使用該車上次選的車漆
function setVehicle(id, paintKey) {
  const def = vehicleById(id);
  const pk = paintKey || savedPaint(def.id);
  store.set('vehicle', def.id);
  if (car.vehicleId === def.id) { car.setPaint(pk); store.set('paint.' + def.id, car.paintKey); return car; }
  const prevCar = car;
  scene.remove(car.root, car.blob); car.dispose();
  car = new CarModel(Q, def.id, pk); car.setPaint(pk);
  scene.add(car.root); scene.add(car.blob);
  if (race) { const p = race.racers[0]; if (p && p.car === prevCar) p.car = car; }
  if (window.__sky) window.__sky.car = car;
  veh.setTune(def.tune);
  veh.energy = 100;
  store.set('vehicle', def.id); store.set('paint.' + def.id, car.paintKey);
  game.camSnap = true;
  syncCar(0);
  try { renderer.compile(scene, camera); } catch (e) { /* */ }
  return car;
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
    const p2veh = new Vehicle(track);
    p2veh.setTune(vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).tune);
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
    ais.push(makeRacer({
      name: `電腦 ${i + 1}`, driver: new AiDriver(track, opt.diff), veh: aveh, car: acar, lap: freshLap(null),
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
    hud.toast(isBest ? `第 ${L.n} 圈完成・新最佳！` : `第 ${L.n} 圈完成`, 2500);
    audio.beep(true);
    input.rumble(0.4, 0.7, 250);
  };
  race.onMiss = () => hud.toast('請沿賽道完整跑完一圈', 1800);
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
  veh = humans[0].veh;
  car = humans[0].car;
  game.camYaw = veh.heading; game.camSnap = true;
  setSplit(humans.length > 1);
  game.state = 'countdown';
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

function welcomeFor(remote) {
  const opt = raceOptions();
  const vid = vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).id;
  return {
    t: 'welcome', track: track.id, vehicle: vid, ai: opt.count, diff: opt.diff,
    laps: RACE_LAPS, slot: remote.slot, name: remote.name,
  };
}
function poseOf(r) {
  const v = r.veh;
  const n = (x, d = 0) => (Number.isFinite(x) ? x : d);
  return {
    id: r.netId || r.name,
    name: r.name,
    kind: r.driver && r.driver.kind,
    paint: r.car && r.car.paintKey,
    x: n(v.pos.x), y: n(v.pos.y), z: n(v.pos.z),
    qx: n(v.q.x), qy: n(v.q.y), qz: n(v.q.z), qw: n(v.q.w, 1),
    vx: n(v.vel.x), vy: n(v.vel.y), vz: n(v.vel.z),
    nx: n(v.n.x), ny: n(v.n.y, 1), nz: n(v.n.z),
    heading: n(v.heading), speed: n(v.speed), gy: n(v.groundY, v.pos.y),
    grounded: !!v.grounded, nitro: !!v.nitroOn, thrust: n(v.thrust), lift: n(v.lift),
    braking: !!v.braking, steer: n(v.steerAngle),
    fi: n(v.attached ? v.fi : (v.q1.fi || 0)),
    lap: r.lap ? r.lap.n : 1,
    finish: r.finish == null ? null : r.finish,
  };
}
function netStateFor(remote) {
  const cars = [];
  if (race) {
    for (const r of race.racers) {
      if (!r.veh) continue;
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
    try { self = remote.racer.veh.exportState(); } catch (e) { self = null; }
    const L = remote.racer.lap;
    selfLap = L ? { n: L.n, t: L.t, last: L.last, best: L.best } : null;
  }
  return {
    t: 'state', now: performance.now(), race: game.state, cd: game.countdown, track: track.id,
    ack: remote.seq | 0, selfId, self, selfLap, standings, cars,
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
    try { remote.driver.push(heldInput(remote, now)); } catch (e) {}
  }
}
function refreshRaceMode() {
  if (!race) return;
  const active = race.racers.filter((r) => !r.parked);
  const anyFinish = race.racers.some((r) => r.finish != null);
  if (active.length < 2 && !anyFinish) race.raceMode = false;
  else race.raceMode = race.racers.length > 1;
}
function attachRemoteRacer(remote) {
  if (!race || !remote || remote.racer) return remote.racer;
  const vid = vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).id;
  const tune = vehicleById(vid).tune;
  const paints = ['steel', 'blue', 'white', 'black'];
  const rcar = new CarModel(QUALITY.low, vid, paints[remote.slot % paints.length]);
  scene.add(rcar.root); scene.add(rcar.blob);
  const rveh = new Vehicle(track);
  rveh.setTune(tune);
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
  if (r.name.indexOf('離線') < 0) r.name += '（離線）';
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
    st.className = 'padline' + (info.kind === 'joined' || info.kind === 'ready' ? ' ok' : '');
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
      if (why !== 'replaced' && hud && (game.state === 'race' || game.state === 'countdown')) hud.toast('手機玩家已離開，比賽繼續', 1800);
    },
    onReset: (remote) => { try { if (remote.racer) resetRacer(remote.racer); } catch (e) {} },
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
  setJoinStatus('已加入房間 ' + formatCode(joinCode) + '，等待房主開始', 'ok');
}
function onGuestState(msg) {
  if (!guestNet || !msg) return;
  guestNet.latest = msg;
  guestNet.connected = true;
  const cars = (msg.cars || []).filter((c) => c && c.id !== msg.selfId);
  guestBuf.push(performance.now(), cars);
  if (msg.selfLap) {
    if (Number.isFinite(msg.selfLap.n)) guestLap.n = msg.selfLap.n;
    if (Number.isFinite(msg.selfLap.t)) guestLap.t = msg.selfLap.t;
    guestLap.last = msg.selfLap.last;
    guestLap.best = msg.selfLap.best;
  }
  if (msg.self) pendingSnap = msg;
  if (!guestTrackReady) {
    const want = msg.track;
    if (want && want !== track.id && TRACKS.some((t) => t.id === want)) {
      const u = new URL(location.href);
      u.searchParams.set('join', joinCode);
      u.searchParams.set('track', want);
      if (!params.get('q')) u.searchParams.set('q', 'low');
      location.replace(u.toString());
      return;
    }
    guestTrackReady = true;
  }
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
    if (hud) { hud.count('出發！'); setTimeout(() => hud && hud.count(''), 700); }
  }
  if (phase === 'paused' && (game.state === 'race' || game.state === 'countdown')) {
    game.hostPaused = true;
    game.prevState = game.state;
    game.state = 'paused';
    if (hud) hud.toast('房主暫停了', 1500);
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
  showBanner(msg);
  if (!msg || msg.indexOf('已經有一位') >= 0 || msg.indexOf('不支援') >= 0) return;
  if (guestNet && guestNet.connected) return;
  if (guestRetryTimer || guestTries > 3) return;
  guestRetryTimer = setTimeout(() => {
    guestRetryTimer = null;
    if (guestNet && guestNet.connected) return;
    retryGuest();
  }, 900);
}
function onGuestClose(info) {
  if (!guestNet || guestNet._destroyed) return;
  guestNet.connected = false;
  if (info && info.full) return;
  if (info && info.replaced) {
    setJoinStatus('已改由另一台手機加入這個房間。', 'bad');
    showBanner('已改由另一台手機加入。');
    return;
  }
  if (guestLive) showBanner('連線中斷。比賽在房主那邊會繼續。正在重新連線…');
  else setJoinStatus('連線中斷。正在重新連線…', 'bad');
  if (guestRetryTimer) return;
  guestRetryTimer = setTimeout(() => {
    guestRetryTimer = null;
    retryGuest();
  }, 800);
}
function beginGuest() {
  if (!game.guest || netOff) return;
  if (guestNet) { try { guestNet.destroy(); } catch (e) {} guestNet = null; }
  setJoinStatus('正在連上房間 ' + formatCode(joinCode) + '…', 'wait');
  guestNet = createGuest(joinCode, {
    onWelcome: onGuestWelcome,
    onState: onGuestState,
    onFail: onGuestFail,
    onClose: onGuestClose,
  });
}
function retryGuest() {
  if (!game.guest) return;
  guestTries += 1;
  if (guestTries > 3) {
    const msg = '連不上這個房間。請確認代碼與網路。嚴格的防火牆或對稱 NAT 可能擋下點對點連線。';
    setJoinStatus(msg, 'bad');
    showBanner(guestLive ? msg : '');
    return;
  }
  beginGuest();
}
function leaveGuestRoom() {
  try { if (guestNet) guestNet.destroy(); } catch (e) {}
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
  veh.energy = 100;
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
  clearGhosts();
  setSplit(false);
  game.state = 'menu';
  game.hostPaused = false;
  if (hud) { hud.show(false); hud.count(''); }
  const sb = $('standings'); if (sb) sb.classList.add('hidden');
  veh.placeOnTrack(track.wrap(track.N - 10), 0, 0);
  ui.show('join');
  if (guestNet && guestNet.connected) setJoinStatus('已加入房間 ' + formatCode(joinCode) + '，等待房主開始', 'ok');
}
function showGuestResults(msg) {
  guestLive = true;
  game.state = 'results';
  const list = $('resultsList');
  const rows = (msg && msg.standings) || [];
  if (list) {
    list.innerHTML = rows.map((r, i) => `<div>${i + 1}. ${r.name}　${r.finish != null ? fmtTime(r.finish) : '未完成'}</div>`).join('');
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
  const vid = vehicleById(store.get('vehicle', DEFAULT_VEHICLE)).id;
  for (const pose of poses) {
    if (!pose || !pose.id) continue;
    seen.add(pose.id);
    let g = ghosts.get(pose.id);
    if (!g) {
      const c = new CarModel(QUALITY.low, vid, pose.paint || 'white');
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
  } catch (e) { hud && hud.toast('此瀏覽器不支援全螢幕', 1500); }
}
function nearestGap(v) {
  const subject = v || veh;
  const fi = subject.attached ? subject.fi : subject.q1.fi;
  let best = track.gaps[0], bd = 1e9;
  for (const g of track.gaps) { let d = fi - g.g0; if (d < -track.N / 2) d += track.N; if (d > track.N / 2) d -= track.N; d = Math.abs(d); if (d < bd) { bd = d; best = g; } }
  return best;
}
function respawnRacer(r, why) {
  const v = r ? r.veh : veh;
  if (!track.gaps.length) { v.placeOnTrack(track.wrap(track.N - 10), r ? r.lat0 : 0, 20); }
  else {
    const g = nearestGap(v);
    v.placeOnTrack(track.wrap(g.g0 - track.rampRows - 32), r ? r.lat0 : 0, 24);
  }
  v.energy = Math.max(v.energy, 55);
  if (!r || r.primary) {
    game.respawns = (game.respawns || 0) + 1;
    hud.flash();
    game.camSnap = true; game.camYaw = v.heading;
    if (why) hud.toast(why, 2200);
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
  if (r.primary) { game.camSnap = true; game.camYaw = v.heading; hud.toast('已回到賽道', 1200); }
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
    hud.toast('已回到賽道', 1200);
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
        hud.toast(isBest ? `第 ${lap.n} 圈完成・新最佳！` : `第 ${lap.n} 圈完成`, 2500);
        audio.beep(true);
        lap.n++; lap.t = 0; lap.cp = [false, false, false];
        world.resetRings();
        input.rumble(0.4, 0.7, 250);
      } else if (lap.cp.some(Boolean)) hud.toast('請沿賽道完整跑完一圈', 1800);
    } else if (lap.prevFi < N * 0.2 && fi > N * 0.8) {
      lap.cp = [false, false, false];
    }
  }
  const cps = [0.25, 0.5, 0.75];
  for (let k = 0; k < 3; k++) if (!lap.cp[k] && (k === 0 || lap.cp[k - 1]) && fi > cps[k] * N && fi < (cps[k] + 0.06) * N) lap.cp[k] = true;
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
        hud.toast('⚡ 能量環  +能量 +加速', 1000);
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
function syncCar(dt) {
  if (!race) { syncOne(dt, veh, car, game.impactForCar || 0); game.impactForCar = 0; return; }
  for (const r of race.racers) {
    const hit = r.primary ? (game.impactForCar || 0) : (r.impactForCar || 0);
    syncOne(dt, r.veh, r.car, hit);
    if (r.primary) game.impactForCar = 0; else r.impactForCar = 0;
  }
}

// ---------------- 相機 ----------------
function updateCamera(dt, subject, cam, decay = true) {
  const v = subject ? subject.veh : veh;
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
    cam.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.27, 0, innerWidth, innerHeight);
    cam.updateProjectionMatrix();
    return;
  }
  if (cam.view && cam.view.enabled) cam.clearViewOffset();
  const lam = snap ? 999 : mode === 2 ? 40 : v.grounded ? 5.5 : 3.5;
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
    else { cpos.x = damp(cpos.x, tx, 16, dt); cpos.z = damp(cpos.z, tz, 16, dt); cpos.y = damp(cpos.y, ty, 7, dt); }
    const gy = track.groundHeight(cpos.x, cpos.z) + 0.8;
    if (cpos.y < gy) cpos.y = gy;
    cam.position.copy(cpos);
    const ahead = [7, 9, 0, 6][mode];
    cam.lookAt(v.pos.x + dir.x * ahead, v.pos.y + [1.2, 1.0, 0, 1.0][mode] * cv.height + clamp(v.alt, 0, 40) * 0.04, v.pos.z + dir.z * ahead);
  }
  const k = smoothstep(40, 110, sp) * 0.012 + (v.nitroOn ? 0.012 : 0) + game.shake * 0.05 + (v.thrusting ? 0.004 : 0);
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
      if (pressed.camera) { game.camMode = (game.camMode + 1) % CAM_NAMES.length; game.camSnap = true; }
      if (game.state === 'race') {
        if (!game.freeze) {
          if (pressed.reset) {
            if (game.guest && guestNet) guestNet.send({ t: 'reset' });
            resetToTrack();
          }
          const p2 = race && race.locals()[1];
          if (p2 && p2.input && p2.input.pressed.reset) resetRacer(p2);
          game.acc += dt;
          let steps = 0;
          if (game.guest) {
            if (guestNet) guestNet.noteInput(input.state, performance.now());
            while (game.acc >= PHYS_DT && steps < 6) {
              veh.step(PHYS_DT, input.state);
              if (guestNet) guestNet.noteSubstep();
              game.acc -= PHYS_DT; steps++;
            }
            if (steps === 6) game.acc = 0;
            handleEvents(dt);
            if (pendingSnap) {
              try { applyReconcile(pendingSnap); } catch (e) {}
              pendingSnap = null;
              veh.events.impact = 0; veh.events.wall = 0; veh.events.respawn = false; veh.events.offroad = false;
            }
          } else {
            try { applyRemoteInputs(); } catch (e) {}
            while (game.acc >= PHYS_DT && steps < 6) {
              if (race) race.step(PHYS_DT);
              else veh.step(PHYS_DT, input.state);
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
        game.countdown -= dt;
        const c = Math.ceil(game.countdown - 0.4);
        if (c !== game.lastCount) {
          game.lastCount = c;
          if (c > 0) { hud.count(String(c)); audio.beep(false); } else { hud.count('出發！'); audio.beep(true); }
        }
        if (game.countdown <= 0.4 && game.state === 'countdown') { game.state = 'race'; setTimeout(() => hud.count(''), 700); }
        if (race) for (const r of race.racers) r.veh.energy = 100;
        else veh.energy = 100;
      } else {
        const c = Math.ceil((game.countdown || 0) - 0.4);
        if (c !== game.lastCount) {
          game.lastCount = c;
          if (c > 0) { hud.count(String(c)); audio.beep(false); } else hud.count('出發！');
        }
      }
    }
  } else if (game.state === 'paused') {
    if (pressed.pause && ui.current === 'pause') resume();
  }

  syncCar(dt);
  if (game.guest && guestLive) { try { syncGhosts(dt); } catch (e) {} }
  world.updateRings(dt, game.time);
  if (game.split && race && race.locals().length > 1 && game.state !== 'menu') renderSplit(dt);
  else {
    updateCamera(dt);
    world.update(camera, veh.pos);
    renderer.render(scene, camera);
  }

  // HUD / 音效
  if (game.state === 'countdown' || game.state === 'race' || game.state === 'paused') {
    const stLabel = veh.nitroOn ? '氮氣加速' : !veh.grounded ? (veh.thrusting ? '推進飛行' : '滯空') : (!veh.onRoad ? '離開路面' : '地面行駛');
    const lapView = game.guest && guestLive ? guestLap : game.lap;
    hud.update(dt, veh, lapView, CAM_NAMES[game.camMode], game.guest ? '📱 觸控開車' : padText(), stLabel);
    if (game.guest && guestPoses.length) {
      hud.drawMinimap(veh, guestPoses.map((p) => ({ veh: { pos: { x: p.x, z: p.z }, heading: p.heading || 0 }, driver: { kind: p.kind || 'remote' } })));
    } else hud.drawMinimap(veh, race ? race.racers : null);
    hud.fx(dt, veh, Q.fx && game.state === 'race' && !game.split);
    updateStandings();
  }
  if (audio.ctx && audio.ctx.state === 'suspended' && (input.anyPadInput || pressed.pause)) audio.init();
  audio.update(veh.speed, veh.thrust, veh.lift, veh.nitroOn, veh.grounded, game.state === 'race');
  updateTouchVisibility();
  const pi = input.padInfo;
  const sp = $('startPad');
  if (sp) { sp.className = 'padline' + (pi.connected ? ' ok' : ''); const t = pi.connected ? `🎮 已連接：${shortPadName(pi.id)}（${input.profile.name}）` : '🎮 尚未偵測到搖桿：請接上 JOWUA 搖桿並按任一鍵'; if (sp.textContent !== t) sp.textContent = t; }
  if (game.state === 'menu' && !game.guest) pollLobby();
  try { flushNet(false); } catch (e) {}
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
      if (game.guest && guestNet) guestNet.send({ t: 'reset' });
      respawnRacer(race ? r : null, r.primary || !race ? '墜入峽谷！回到跳台前' : '');
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
    list.innerHTML = race.standings().map((r, i) => `<div>${i + 1}. ${r.name}　${r.finish != null ? fmtTime(r.finish) : '未完成'}</div>`).join('');
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
function updateLobby() {
  const p1 = $('startP1'), p2 = $('startP2');
  if (!p1 || !p2 || !input) return;
  const pi = input.padInfo;
  const t1 = pi.connected ? `P1：手把 ${pi.index}　${shortPadName(pi.id)}` : 'P1：鍵盤、觸控（沒有第二支手把時也是你）';
  if (p1.textContent !== t1) p1.textContent = t1;
  p1.className = 'padline' + (pi.connected ? ' ok' : '');
  if (lobby.p2) {
    const t2 = `P2：手把 ${lobby.p2.index}　${shortPadName(lobby.p2.id)}（上下分屏）。按 Back／Select／－ 離開。`;
    if (p2.textContent !== t2) p2.textContent = t2;
    p2.className = 'padline ok';
  } else {
    const t2 = 'P2：用另一支手把按任意鍵加入，上下分屏。鍵盤與觸控在沒有第二支手把時都是 P1。';
    if (p2.textContent !== t2) p2.textContent = t2;
    p2.className = 'padline';
  }
}
function leaveP2() {
  lobby.p2 = null;
  if (input) input.lockPad(null);
  updateLobby();
}
function joinPad(index) {
  if (lobby.p2 || !input) return false;
  const pads = input.getPads();
  const gp = pads.find((g) => g && g.index === index);
  if (!gp) return false;
  if ((input.padInfo.connected && input.padInfo.index === index) || (input.pad && input.pad.index === index)) return false;
  if (input.padInfo.connected && input.padInfo.index >= 0) input.lockPad(input.padInfo.index);
  else input.lockPad(-2);
  lobby.p2 = { index: gp.index, id: gp.id || '' };
  updateLobby();
  return true;
}
function pollLobby() {
  if (!input || game.state !== 'menu') return;
  const pads = input.getPads();
  const menuIdx = input.padInfo.index;
  for (const gp of pads) {
    const prev = lobby.prev.get(gp.index) || [];
    const btns = (gp.buttons || []).map((b) => !!(b && (b.pressed || b.value > 0.5)));
    lobby.prev.set(gp.index, btns);
    const edge = btns.some((v, i) => v && !prev[i]);
    if (lobby.p2 && gp.index === lobby.p2.index) {
      if (btns[8] && !prev[8]) leaveP2();
      continue;
    }
    if (!lobby.p2 && edge && gp.index !== menuIdx) joinPad(gp.index);
  }
  updateLobby();
}

function padText() {
  const p = input.padInfo;
  if (!p.connected) return '🎮 未偵測到搖桿（按任一鍵喚醒）';
  let t = '🎮 ' + shortPadName(p.id);
  if (p.mapping !== 'standard') t += '（非標準映射，請至按鍵設定）';
  return t;
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
