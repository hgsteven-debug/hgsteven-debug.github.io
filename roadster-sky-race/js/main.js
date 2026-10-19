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
import { clamp, lerp, damp, wrapAngle, smoothstep, store } from './util.js';

const params = new URLSearchParams(location.search);
let qname = params.get('q') || store.get('quality', null) || ((navigator.hardwareConcurrency || 8) <= 4 ? 'low' : 'med');
if (!QUALITY[qname]) qname = 'med';
const Q = QUALITY[qname];
const $ = (id) => document.getElementById(id);
const CAM_NAMES = ['追尾', '低角度', '車內', '遠景'];
const PHYS_DT = 1 / 120;

let renderer, scene, camera, world, track, car, veh, hud, ui, audio, input;
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
    applySize();
    input = new InputManager();
    audio = new GameAudio();

    const tid = trackById(store.get('track', DEFAULT_TRACK)).id;
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
      onTrack: (id) => { store.set('track', id); const u = new URL(location.href); location.href = u.toString(); },
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

    window.__sky = { Q, CarModel, setVehicle, sim, game, veh, input, world, hud, ui, car, camera, renderer, scene, audio, startGame, track, TRACKS, trackById, VEHICLES, vehicleById, THREE };
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
    if (i % 2 === 0) input.poll(1 / 60);
    veh.step(PHYS_DT, input.state);
    if (i % 2 === 1) { handleEvents(1 / 60); updateLap(1 / 60); updateRings(1 / 60); game.time += 1 / 60; }
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
  scene.remove(car.root, car.blob); car.dispose();
  car = new CarModel(Q, def.id, pk); car.setPaint(pk);
  scene.add(car.root); scene.add(car.blob);
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
function startGame() {
  audio.init();
  ui.hideAll(); hud.show(true);
  const lap = game.lap;
  lap.n = 1; lap.t = 0; lap.last = null; lap.cp = [false, false, false]; lap.prevFi = null;
  world.resetRings();
  veh.energy = 100;
  veh.placeOnTrack(track.N - 10, 0, 0);
  game.camYaw = veh.heading; game.camSnap = true;
  game.state = 'countdown';
  game.countdown = params.get('nocount') === '1' ? 0.05 : 3.4;
  game.lastCount = -1;
  game.shake = 0;
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
  game.state = 'menu';
  hud.show(false); hud.count('');
  veh.placeOnTrack(track.N - 10, 0, 0);
  ui.show('start');
}
function toggleFullscreen() {
  try {
    const d = document, el = d.documentElement;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  } catch (e) { hud && hud.toast('此瀏覽器不支援全螢幕', 1500); }
}
function respawn(why) {
  game.respawns = (game.respawns || 0) + 1;
  hud.flash();
  let idx;
  const g = nearestGap();
  idx = track.wrap(g.g0 - track.rampRows - 32);
  veh.placeOnTrack(idx, 0, 24);
  veh.energy = Math.max(veh.energy, 55);
  game.camSnap = true; game.camYaw = veh.heading;
  hud.toast(why, 2200);
}
function nearestGap() {
  const fi = veh.q1.fi;
  let best = track.gaps[0], bd = 1e9;
  for (const g of track.gaps) { let d = fi - g.g0; if (d < -track.N / 2) d += track.N; if (d > track.N / 2) d -= track.N; d = Math.abs(d); if (d < bd) { bd = d; best = g; } }
  return best;
}
function resetToTrack() {
  let idx = veh.q1.near ? veh.q1.i : game.lastGoodI;
  if (veh.q1.gap) idx = track.wrap(nearestGap().g0 - track.rampRows - 32);
  veh.placeOnTrack(idx, 0, 0);
  veh.energy = Math.max(veh.energy, 30);
  game.camSnap = true; game.camYaw = veh.heading;
  hud.toast('已回到賽道', 1200);
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
  for (const r of world.rings) {
    if (!r.on) { if (game.time - r.t > 45) r.on = true; continue; }
    const dx = veh.pos.x - r.pos.x, dy = veh.pos.y + 0.6 - r.pos.y, dz = veh.pos.z - r.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > (r.R + 3) * (r.R + 3)) continue;
    const along = dx * r.T.x + dz * r.T.z;
    if (Math.abs(along) > 3.2) continue;
    if (d2 - along * along > (r.R * 0.95) * (r.R * 0.95)) continue;
    r.on = false; r.t = game.time;
    veh.energy = Math.min(100, veh.energy + 30);
    const sp = veh.speed;
    if (sp > 1 && sp < 115) {
      const k = (veh.grounded ? 6 : 8) / sp;
      veh.vel.x *= 1 + k; veh.vel.z *= 1 + k;
    }
    hud.toast('⚡ 能量環  +能量 +加速', 1000);
    audio.ding();
    input.rumble(0.3, 0.8, 140);
    game.shake = Math.max(game.shake, 0.25);
  }
}

// ---------------- 車輛同步 ----------------
function syncCar(dt) {
  const ev = veh.events;
  car.root.position.copy(veh.pos);
  car.root.quaternion.copy(veh.q);
  car.update(dt, {
    grounded: veh.grounded, impact: game.impactForCar || 0, accel: veh.accel, latAccel: veh.latAccel, speedF: veh.speedF,
    steerAngle: veh.steerAngle, thrust: veh.thrust, lift: veh.lift, nitro: veh.nitroOn, braking: veh.braking,
  });
  // 假陰影貼地
  const gy = veh.groundY;
  car.blob.position.set(veh.pos.x, gy + 0.04, veh.pos.z);
  _v.copy(veh.n);
  _q.setFromUnitVectors(_v2.set(0, 1, 0), _v);
  car.blob.quaternion.copy(_q);
  car.blob.rotateY(-veh.heading);
  car.blob.material.opacity = (Q.shadows ? 0.4 : 0.8) * clamp(1 - veh.alt / 22, 0.05, 1);
  game.impactForCar = 0;
  car.root.visible = true;
}

// ---------------- 相機 ----------------
function updateCamera(dt) {
  const mode = game.camMode, sp = veh.speed;
  const snap = game.camSnap; game.camSnap = false;
  if (game.state === 'menu') {
    game.orbit = (game.orbit || 0) + dt * 0.25;
    const a = game.orbit + 0.6;
    const cd = car.vehicle.cam, md = cd.menu || 13 * cd.dist, mh = 0.28 * md, ly = 0.6 * Math.max(1, cd.height);
    camPos.set(veh.pos.x + Math.cos(a) * md, veh.pos.y + mh, veh.pos.z + Math.sin(a) * md);
    camera.position.copy(camPos);
    camera.lookAt(veh.pos.x, veh.pos.y + ly, veh.pos.z);
    camera.fov = damp(camera.fov, 45, 5, dt);
    // 選單在左側，車子往右偏移，避免被選單蓋住
    camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.27, 0, innerWidth, innerHeight);
    camera.updateProjectionMatrix();
    return;
  }
  if (camera.view && camera.view.enabled) camera.clearViewOffset();
  const lam = snap ? 999 : mode === 2 ? 40 : veh.grounded ? 5.5 : 3.5;
  game.camYaw += wrapAngle(veh.heading - game.camYaw) * (1 - Math.exp(-lam * dt));
  const dir = _v2.set(-Math.sin(game.camYaw), 0, -Math.cos(game.camYaw));
  const fovBase = [62, 68, 74, 56][mode];
  let fov = fovBase + 30 * smoothstep(10, 100, sp) + (veh.nitroOn ? 6 : 0);
  camera.fov = snap ? fov : damp(camera.fov, fov, 6, dt);
  if (mode === 2) {
    _v.set(0, car.vehicle.cam.cockpit[0], car.vehicle.cam.cockpit[1]).applyQuaternion(veh.q).add(veh.pos);
    camera.position.copy(_v);
    camera.quaternion.copy(veh.q);
    camPos.copy(_v);
  } else {
    const cv = car.vehicle.cam;
    const dist = [7.6, 5.4, 0, 13.5][mode] * cv.dist + sp * 0.03;
    const h = [2.5, 1.5, 0, 5.2][mode] * cv.height + clamp(veh.alt, 0, 40) * 0.12;
    const tx = veh.pos.x - dir.x * dist, tz = veh.pos.z - dir.z * dist, ty = veh.pos.y + h;
    if (snap) camPos.set(tx, ty, tz);
    else { camPos.x = damp(camPos.x, tx, 16, dt); camPos.z = damp(camPos.z, tz, 16, dt); camPos.y = damp(camPos.y, ty, 7, dt); }
    const gy = track.groundHeight(camPos.x, camPos.z) + 0.8;
    if (camPos.y < gy) camPos.y = gy;
    camera.position.copy(camPos);
    const ahead = [7, 9, 0, 6][mode];
    camera.lookAt(veh.pos.x + dir.x * ahead, veh.pos.y + [1.2, 1.0, 0, 1.0][mode] * cv.height + clamp(veh.alt, 0, 40) * 0.04, veh.pos.z + dir.z * ahead);
  }
  // 抖動：速度 / 氮氣 / 落地
  const k = smoothstep(40, 110, sp) * 0.012 + (veh.nitroOn ? 0.012 : 0) + game.shake * 0.05 + (veh.thrusting ? 0.004 : 0);
  if (k > 0.0005 && game.state === 'race') {
    camera.position.x += (Math.random() - 0.5) * k * 2;
    camera.position.y += (Math.random() - 0.5) * k * 2 - game.kick;
    camera.position.z += (Math.random() - 0.5) * k * 2;
  }
  game.shake = Math.max(0, game.shake - dt * 1.8);
  game.kick = damp(game.kick, 0, 7, dt);
  camera.updateProjectionMatrix();
}

// ---------------- 主迴圈 ----------------
let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (!(dt > 0)) return;
  dt = Math.min(dt, 0.1);
  game.time += dt;
  const inp = input.poll(dt);
  const pressed = input.pressed;

  // UI 導航
  if (ui.active) { ui.handleNav(input.nav); ui.updateMeters(); }
  if (game.state === 'menu' && !ui.active) ui.show('start');

  if (game.state === 'countdown' || game.state === 'race') {
    if (pressed.pause) { pause(); }
    else {
      if (pressed.camera) { game.camMode = (game.camMode + 1) % CAM_NAMES.length; game.camSnap = true; }
      if (game.state === 'race') {
        if (pressed.reset) resetToTrack();
        game.acc += dt;
        let steps = 0;
        while (!game.freeze && game.acc >= PHYS_DT && steps < 6) { veh.step(PHYS_DT, inp); game.acc -= PHYS_DT; steps++; }
        if (steps === 6) game.acc = 0;
        handleEvents(dt);
        updateLap(dt);
        updateRings(dt);
      } else {
        game.countdown -= dt;
        const c = Math.ceil(game.countdown - 0.4);
        if (c !== game.lastCount) {
          game.lastCount = c;
          if (c > 0) { hud.count(String(c)); audio.beep(false); } else { hud.count('出發！'); audio.beep(true); }
        }
        if (game.countdown <= 0.4 && game.state === 'countdown') { game.state = 'race'; setTimeout(() => hud.count(''), 700); }
        veh.energy = 100;
      }
    }
  } else if (game.state === 'paused') {
    if (pressed.pause && ui.current === 'pause') resume();
  }

  syncCar(dt);
  updateCamera(dt);
  world.updateRings(dt, game.time);
  world.update(camera, veh.pos);
  renderer.render(scene, camera);

  // HUD / 音效
  if (game.state === 'countdown' || game.state === 'race' || game.state === 'paused') {
    const stLabel = veh.nitroOn ? '氮氣加速' : !veh.grounded ? (veh.thrusting ? '推進飛行' : '滯空') : (!veh.onRoad ? '離開路面' : '地面行駛');
    hud.update(dt, veh, game.lap, CAM_NAMES[game.camMode], padText(), stLabel);
    hud.drawMinimap(veh);
    hud.fx(dt, veh, Q.fx && game.state === 'race');
  }
  if (audio.ctx && audio.ctx.state === 'suspended' && (input.anyPadInput || pressed.pause)) audio.init();
  audio.update(veh.speed, veh.thrust, veh.lift, veh.nitroOn, veh.grounded, game.state === 'race');
  updateTouchVisibility();
  const pi = input.padInfo;
  const sp = $('startPad');
  if (sp) { sp.className = 'padline' + (pi.connected ? ' ok' : ''); const t = pi.connected ? `🎮 已連接：${shortPadName(pi.id)}（${input.profile.name}）` : '🎮 尚未偵測到搖桿：請接上 JOWUA 搖桿並按任一鍵'; if (sp.textContent !== t) sp.textContent = t; }
  adaptResolution(dt);
}

function handleEvents(dt) {
  const ev = veh.events;
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
  if (ev.respawn) respawn('墜入峽谷！回到跳台前');
  // 持續震動
  game.rumbleT -= dt;
  if (game.rumbleT <= 0) {
    let s = 0, w = 0;
    if (veh.nitroOn) { s = 0.22; w = 0.45; } else if (veh.thrusting) { s = 0.1; w = 0.28; }
    if (ev.offroad && veh.speed > 4) { s = Math.max(s, 0.35); w = Math.max(w, 0.2); }
    if (veh.grounded && veh.speed > 55) w = Math.max(w, (veh.speed - 55) / 160);
    if (s || w) { input.rumble(s, w, 120); game.rumbleT = 0.1; }
  }
  game.impactForCar = Math.max(game.impactForCar || 0, ev.impact);
  ev.impact = 0; ev.wall = 0; ev.respawn = false; ev.offroad = false;
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
  else if (avg < 1 / 52 && game.dyn < 1) { game.dyn = Math.min(1, game.dyn + 0.05); changed = true; }
  if (changed) applySize();
}

boot();
