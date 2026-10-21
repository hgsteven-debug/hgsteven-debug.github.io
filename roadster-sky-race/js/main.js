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

const params = new URLSearchParams(location.search);
let qname = params.get('q') || store.get('quality', null) || ((navigator.hardwareConcurrency || 8) <= 4 ? 'low' : 'med');
if (!QUALITY[qname]) qname = 'med';
const Q = QUALITY[qname];
const $ = (id) => document.getElementById(id);
const CAM_NAMES = ['追尾', '低角度', '車內', '遠景'];
const PHYS_DT = 1 / 120;

let renderer, scene, camera, camera2, world, track, car, veh, hud, ui, audio, input, race;
const lobby = { p2: null, prev: new Map() };
const AI_PAINTS = ['white', 'blue', 'black', 'red'];
const game = {
  state: 'loading', time: 0, camMode: 0, countdown: 0, dyn: 1,
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
      onStart: startGame, onResume: resume, onRestart: () => startGame(), onQuit: quit,
      onFullscreen: toggleFullscreen, onVehicle: setVehicle, getCar: () => car,
      onTrack: (id) => { store.set('track', id); const u = new URL(location.href); u.searchParams.delete('track'); location.href = u.toString(); },
      onQuality: (q) => { store.set('quality', q); const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.toString(); },
      getQuality: () => qname, onVolume: (v) => audio.setVolume(v), getVolume: () => audio.volume,
      onTouchMode: () => {}, onTouchPress: (p) => { input.pressed[p] = true; game.touchPressed = p; },
      onBackTop: () => { if (game.state === 'paused') resume(); },
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
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => audio.init(), { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'race') pause(); });
    window.addEventListener('blur', () => { if (game.state === 'race' && params.get('nopauseblur') !== '1') pause(); });

    if (qTrack && TRACKS.some((t) => t.id === qTrack)) { ui.trackId = qTrack; ui.refreshTracks(); }
    window.__sky = {
      Q, CarModel, setVehicle, sim, game, veh, input, world, hud, ui, car, camera, camera2, renderer, scene, audio,
      startGame, track, TRACKS, trackById, VEHICLES, vehicleById, THREE,
      lobby, ribbonCompression, KIND, joinPad, pollLobby, leaveP2, LocalDriver, RemoteDriver, LOCAL_LIMIT, RACE_LAPS, AiDriver,
      get race() { return race; },
    };
    game.state = 'menu';
    ui.refreshTracks(); ui.show('start');
    if (params.get('autostart') === '1') { startGame(); }
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
  race.raceMode = roster.length > 1;
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
  veh = humans[0].veh;
  car = humans[0].car;
  game.camYaw = veh.heading; game.camSnap = true;
  setSplit(humans.length > 1);
  game.state = 'countdown';
  game.countdown = params.get('nocount') === '1' ? 0.05 : 3.4;
  game.lastCount = -1;
  game.shake = 0;
  const sb = $('standings');
  if (sb) sb.classList.toggle('hidden', roster.length < 2);
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
  clearRace();
  setSplit(false);
  game.state = 'menu';
  hud.show(false); hud.count('');
  const sb = $('standings'); if (sb) sb.classList.add('hidden');
  veh.placeOnTrack(track.N - 10, 0, 0);
  ui.show('start');
  updateLobby();
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
  const humans = race ? race.locals() : [{ veh, input, primary: true }];
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
          if (pressed.reset) resetToTrack();
          const p2 = race && race.locals()[1];
          if (p2 && p2.input && p2.input.pressed.reset) resetRacer(p2);
          game.acc += dt;
          let steps = 0;
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
      } else {
        game.countdown -= dt;
        const c = Math.ceil(game.countdown - 0.4);
        if (c !== game.lastCount) {
          game.lastCount = c;
          if (c > 0) { hud.count(String(c)); audio.beep(false); } else { hud.count('出發！'); audio.beep(true); }
        }
        if (game.countdown <= 0.4 && game.state === 'countdown') { game.state = 'race'; setTimeout(() => hud.count(''), 700); }
        if (race) for (const r of race.racers) r.veh.energy = 100;
        else veh.energy = 100;
      }
    }
  } else if (game.state === 'paused') {
    if (pressed.pause && ui.current === 'pause') resume();
  }

  syncCar(dt);
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
    hud.update(dt, veh, game.lap, CAM_NAMES[game.camMode], padText(), stLabel);
    hud.drawMinimap(veh, race ? race.racers : null);
    hud.fx(dt, veh, Q.fx && game.state === 'race' && !game.split);
    updateStandings();
  }
  if (audio.ctx && audio.ctx.state === 'suspended' && (input.anyPadInput || pressed.pause)) audio.init();
  audio.update(veh.speed, veh.thrust, veh.lift, veh.nitroOn, veh.grounded, game.state === 'race');
  updateTouchVisibility();
  const pi = input.padInfo;
  const sp = $('startPad');
  if (sp) { sp.className = 'padline' + (pi.connected ? ' ok' : ''); const t = pi.connected ? `🎮 已連接：${shortPadName(pi.id)}（${input.profile.name}）` : '🎮 尚未偵測到搖桿：請接上 JOWUA 搖桿並按任一鍵'; if (sp.textContent !== t) sp.textContent = t; }
  if (game.state === 'menu') pollLobby();
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
    if (ev.respawn) respawnRacer(race ? r : null, r.primary || !race ? '墜入峽谷！回到跳台前' : '');
    ev.impact = 0; ev.wall = 0; ev.respawn = false; ev.offroad = false;
  }
}
function updateStandings() {
  const el = $('standings');
  if (!el || !race || race.racers.length < 2) return;
  const t = race.standings().map((r, i) => `${i + 1} ${r.name}${r.finish != null ? '  ' + fmtTime(r.finish) : ''}`).join('\n');
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
  if (!race || !race.raceMode || game.state !== 'race') return;
  const humans = race.locals();
  if (humans.length && humans.every((r) => r.finish != null)) {
    game.state = 'results';
    showResults();
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
  const want = mode === 'on' || (mode === 'auto' && hasTouch && !input.padInfo.connected);
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
