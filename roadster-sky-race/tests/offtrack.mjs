// 偏離賽道：正常跳躍、懸停、路肩、道具、月球不能被送回起跑線。真的迷失才回到剛才的路面。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { encodeState, decodeState, createDict } from '../js/wire.js';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

try {
  const plain = {
    t: 'state', race: 'race', track: 'canyon', ack: 1,
    self: { x: 1, y: 2, z: 3, vx: 0, vy: 0, vz: 0, heading: 0, qw: 1, speed: 1, energy: 50, groundY: 2 },
    selfId: 'p1', selfLap: { n: 2, t: 3 }, cars: [],
  };
  const idle = encodeState(plain, {}, 0);
  const idleDec = decodeState(idle, createDict());
  assert(idleDec.offLeft === 0, 'idle grace ' + idleDec.offLeft);
  const live = encodeState(Object.assign({}, plain, { offLeft: 2.4 }), {}, 0);
  const liveDec = decodeState(live, createDict());
  assert(Math.abs(liveDec.offLeft - 2.4) < 0.051, 'grace byte ' + liveDec.offLeft);
  assert(live.length === idle.length + 1, 'grace adds one byte ' + idle.length + ' ' + live.length);
  const again = encodeState(plain, {}, 1);
  assert(again.length === idle.length, 'back to idle size');
  ok('grace byte only while counting');
} catch (e) { bad('grace byte only while counting', e); }

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function open(track) {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.goto(BASE + `?track=${track}&q=low&ai=0&autostart=1&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=0&lang=zh-TW`, {
    waitUntil: 'domcontentloaded', timeout: 90000,
  });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.race && window.__sky.game.state !== 'loading', { timeout: 90000 });
  await page.evaluate(() => { window.__sky.game.freeze = true; window.__sky.game.state = 'race'; });
  return { page, errors };
}

const coast = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0, item: false };

try {
  const { page, errors } = await open('canyon');
  const report = await page.evaluate((coast) => {
    const sky = window.__sky;
    const tr = sky.track;
    const r = sky.race.racers[0];
    const v = r.veh;
    const respawns = () => sky.game.respawns || 0;
    const drive = (cmd) => { r.driver.sample = typeof cmd === 'function' ? cmd : () => cmd; };
    const out = {};

    const g = tr.gaps[0];
    v.placeOnTrack(tr.wrap(g.g0 - 14), 0, 56);
    v.energy = 100;
    v._safeT = 0;
    v.events.respawn = false;
    r.lap.n = 2;
    r.lap.cp = [true, false, false];
    r.lap.prevFi = v.fi;
    const jumpLap = r.lap.n;
    drive({ ...coast, throttle: 1 });
    let jumpOff = 0, sawAir = false;
    const jump0 = respawns();
    sky.sim(4, () => {
      const over = tr.isGapIdx(v.fi) || !!(v.q1 && v.q1.gap);
      if (!v.grounded && (over || v.airTime > 0.25)) {
        sawAir = true;
        if (!v.onRoad || v.offLeft > 0) jumpOff++;
      }
      return false;
    });
    out.jump = { sawAir, jumpOff, respawns: respawns() - jump0, lap: r.lap.n, n0: jumpLap };

    v.placeOnTrack(260, 0, 22);
    v.energy = 100;
    v._safeT = 0;
    v.events.respawn = false;
    const y0 = v.pos.y;
    let peak = y0, hoverBad = 0;
    const hover0 = respawns();
    drive({ ...coast, throttle: 0.55, lift: true, pitch: 0.15 });
    sky.sim(3.2, () => {
      if (v.pos.y > peak) peak = v.pos.y;
      if (v.offLeft > 0 || v.events.respawn) hoverBad++;
      return false;
    });
    out.hover = { dy: +(peak - y0).toFixed(2), hoverBad, respawns: respawns() - hover0, off: v.offLeft || 0 };

    let shoulderAt = 320;
    for (let i = 80; i < tr.N - 80; i += 8) {
      if (tr.isGapIdx(i) || tr.isGapIdx(i + 10) || tr.isGapIdx(i - 10)) continue;
      const fr = tr.frame(i);
      const gy = tr.groundHeight(fr.pos.x + fr.right.x * 15, fr.pos.z + fr.right.z * 15);
      if (Math.abs(gy - fr.pos.y) < 1.5) { shoulderAt = i; break; }
    }
    v.placeOnTrack(shoulderAt, 0, 18);
    v._safeT = 0;
    v.events.respawn = false;
    const f = tr.frame(v.fi);
    v.pos.x += f.right.x * 15;
    v.pos.z += f.right.z * 15;
    v._prevL = 20;
    const shoulder0 = respawns();
    let maxSide = 0, shoulderOff = 0, snap = null;
    drive({ ...coast, throttle: 0.35 });
    sky.sim(2.4, () => {
      const side = v.q1 && v.q1.near ? Math.abs(v.q1.l || 0) : 0;
      if (side > maxSide) maxSide = side;
      if (v.offLeft > 0 || !v.onRoad || v.events.respawn) {
        shoulderOff++;
        if (!snap) snap = {
          side: +side.toFixed(1), off: +(v.offLeft || 0).toFixed(2), on: v.onRoad,
          y: +v.pos.y.toFixed(1), gy: +v.groundY.toFixed(1), qy: +((v.q1 && v.q1.y) || 0).toFixed(1),
          kind: v._lostKind ? v._lostKind() : '', pit: +tr.pitEdge(v.q1.fi || 0).toFixed(2),
          gap: !!(v.q1 && v.q1.gap), al: +((v.q1 && v.q1.al) || 0).toFixed(1),
          l: +((v.q1 && v.q1.l) || 0).toFixed(1), grounded: v.grounded, air: +v.airTime.toFixed(2),
          why: v.events.why || '', fi: Math.round(v.fi || 0),
        };
      }
      return false;
    });
    out.shoulder = { at: shoulderAt, maxSide: +maxSide.toFixed(1), shoulderOff, respawns: respawns() - shoulder0, snap };

    const mid = Math.floor(tr.N * 0.45);
    v.placeOnTrack(mid, 0, 22);
    v._safeT = 0;
    v.spinT = 1.25;
    v.hitKind = 1;
    r.lap.n = 2;
    r.lap.cp = [true, true, false];
    r.lap.t = 9;
    r.lap.prevFi = v.fi;
    const item0 = respawns();
    drive(() => {
      const lat = v.q1 && v.q1.near ? v.q1.l : 0;
      return { ...coast, throttle: 0.7, steer: Math.max(-1, Math.min(1, -lat * 0.2)) };
    });
    sky.sim(1.5);
    v.boostT = 1.35;
    v.boostPower = 26;
    v.energy = 100;
    sky.sim(1.4);
    out.item = {
      respawns: respawns() - item0,
      n: r.lap.n,
      cp: r.lap.cp.slice(),
      t: +r.lap.t.toFixed(2),
    };

    v.placeOnTrack(Math.floor(tr.N * 0.62), 0, 24);
    v._safeT = 0;
    v.events.respawn = false;
    const backF = tr.frame(v.fi);
    v.pos.x += backF.right.x * 36;
    v.pos.z += backF.right.z * 36;
    v.vel.x = -backF.right.x * 14;
    v.vel.z = -backF.right.z * 14;
    v._prevL = 40;
    const back0 = respawns();
    let sawCount = 0;
    drive(() => {
      const lat = v.q1 && v.q1.near ? v.q1.l : 0;
      return { ...coast, throttle: 1, steer: Math.max(-1, Math.min(1, -Math.sign(lat || 1) * 0.8)) };
    });
    sky.sim(2.3, () => {
      if (v.offLeft > 0.3) sawCount++;
      return false;
    });
    out.back = { sawCount, off: +(v.offLeft || 0).toFixed(2), respawns: respawns() - back0, side: +((v.q1 && v.q1.l) || 0).toFixed(1) };

    const lossAt = Math.floor(tr.N * 0.58);
    v.placeOnTrack(lossAt, 0, 12);
    v._safeT = 0;
    r.lap.n = 3;
    r.lap.cp = [true, false, false];
    r.lap.t = 20;
    r.lap.prevFi = v.fi;
    const good = v.lastGoodFi;
    const lossF = tr.frame(lossAt);
    v.pos.x += lossF.right.x * 80;
    v.pos.z += lossF.right.z * 80;
    v.vel.set(0, 0, 0);
    v._prevL = 80;
    drive(coast);
    sky.sim(1.15);
    sky.hud.setOff(v.offLeft || 0);
    const el = document.getElementById('offcount');
    const during = v.offLeft || 0;
    let ghost = 0;
    const loss0 = respawns();
    sky.sim(2.6, () => {
      if ((sky.game.respawns || 0) > loss0 && v.ghostT > 0.2) ghost = v.ghostT;
      return (sky.game.respawns || 0) > loss0;
    });
    const q = tr.query(v.pos.x, v.pos.z);
    const landed = Math.round(v.attached ? v.fi : (v.q1.fi || v.fi));
    let behind = good - landed;
    const N = tr.N;
    if (behind > N / 2) behind -= N;
    if (behind < -N / 2) behind += N;
    out.loss = {
      text: el ? el.textContent : '',
      hidden: !!(el && el.classList.contains('hidden')),
      during: +during.toFixed(2),
      respawns: respawns() - loss0,
      al: +q.al.toFixed(2),
      gap: !!q.gap,
      landed,
      good,
      behind,
      n: r.lap.n,
      cp: r.lap.cp.slice(),
      t: +r.lap.t.toFixed(2),
      ghost: +ghost.toFixed(2),
      N,
    };

    let li = 0, ly = 1e9;
    for (let i = 0; i < tr.N; i++) if (tr.py[i] < ly) { ly = tr.py[i]; li = i; }
    v.placeOnTrack(li, 0, 28);
    v._safeT = 0;
    v.events.respawn = false;
    const low0 = respawns();
    let lowSide = 0;
    drive({ ...coast, throttle: 1 });
    sky.sim(4, () => {
      const side = v.q1 && v.q1.near ? Math.abs(v.q1.l || 0) : 0;
      if (side > lowSide) lowSide = side;
      return false;
    });
    out.low = { y: +ly.toFixed(1), i: li, maxSide: +lowSide.toFixed(1), respawns: respawns() - low0 };

    v.followHost = true;
    v.events.respawn = false;
    v.events.why = '';
    v.pos.y = -80;
    v.step(1 / 30, { ...coast, throttle: 1 });
    out.phone = { respawn: !!v.events.respawn, why: v.events.why || '' };
    v.followHost = false;
    return out;
  }, coast);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!report.jump.sawAir || report.jump.jumpOff || report.jump.respawns) throw new Error('jump ' + JSON.stringify(report.jump));
  if (!(report.hover.dy > 1) || report.hover.hoverBad || report.hover.respawns) throw new Error('hover ' + JSON.stringify(report.hover));
  if (!(report.shoulder.maxSide > 13) || report.shoulder.shoulderOff || report.shoulder.respawns) throw new Error('shoulder ' + JSON.stringify(report.shoulder));
  if (report.item.respawns || report.item.n !== 2 || !report.item.cp[0] || !report.item.cp[1] || report.item.cp[2]) throw new Error('item ' + JSON.stringify(report.item));
  if (!report.back.sawCount || report.back.respawns) throw new Error('steer back ' + JSON.stringify(report.back));
  if (report.loss.hidden || !report.loss.text.includes('偏離賽道') || !/\d/.test(report.loss.text)) throw new Error('countdown ' + JSON.stringify(report.loss));
  if (!(report.loss.during > 0.4 && report.loss.during < 2.8)) throw new Error('grace ' + JSON.stringify(report.loss));
  if (report.loss.respawns < 1 || !(report.loss.al < 14) || report.loss.gap) throw new Error('land ' + JSON.stringify(report.loss));
  if (!(report.loss.landed > 40 && report.loss.landed < report.loss.N - 40)) throw new Error('origin ' + JSON.stringify(report.loss));
  if (!(report.loss.behind > 0 && report.loss.behind < 80)) throw new Error('behind ' + JSON.stringify(report.loss));
  if (report.loss.n !== 3 || !report.loss.cp[0] || report.loss.cp[1] || report.loss.cp[2]) throw new Error('progress ' + JSON.stringify(report.loss));
  if (!(report.loss.t > 20 && report.loss.t < 40)) throw new Error('lap clock ' + JSON.stringify(report.loss));
  if (!(report.loss.ghost > 0.4)) throw new Error('ghost ' + JSON.stringify(report.loss));
  if (report.low.y < -8 && report.low.maxSide < 22 && report.low.respawns) throw new Error('low road ' + JSON.stringify(report.low));
  if (report.phone.respawn || report.phone.why) throw new Error('phone ' + JSON.stringify(report.phone));
  ok('canyon false positives and recover behind');
  await page.close();
} catch (e) { bad('canyon false positives and recover behind', e); }

try {
  const { page, errors } = await open('moon');
  const report = await page.evaluate((coast) => {
    const sky = window.__sky;
    const tr = sky.track;
    tr.def.gravity = 1.62;
    const r = sky.race.racers[0];
    const v = r.veh;
    v.placeOnTrack(90, 0, 16);
    v.energy = 100;
    v._safeT = 0;
    v.events.respawn = false;
    r.lap.n = 2;
    r.lap.cp = [true, false, false];
    r.lap.prevFi = v.fi;
    const y0 = v.pos.y;
    const n0 = sky.game.respawns || 0;
    let peak = y0, off = 0;
    r.driver.sample = () => ({ ...coast, throttle: 0.35, lift: true });
    sky.sim(4.5, () => {
      if (v.pos.y > peak) peak = v.pos.y;
      if (v.offLeft > 0) off++;
      return false;
    });
    return {
      dy: +(peak - y0).toFixed(2), off, respawns: (sky.game.respawns || 0) - n0,
      n: r.lap.n, cp: r.lap.cp.slice(), g: tr.def.gravity,
    };
  }, coast);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!(report.dy > 1) || report.off || report.respawns) throw new Error('moon hang ' + JSON.stringify(report));
  if (report.n !== 2 || !report.cp[0] || report.cp[1]) throw new Error('moon progress ' + JSON.stringify(report));
  ok('moon hang stays on the lap');
  await page.close();
} catch (e) { bad('moon hang stays on the lap', e); }

try {
  const { page, errors } = await open('alpine');
  const report = await page.evaluate((coast) => {
    const sky = window.__sky;
    const tr = sky.track;
    const r = sky.race.racers[0];
    const v = r.veh;
    let li = 0, ly = 1e9;
    for (let i = 0; i < tr.N; i++) if (tr.py[i] < ly) { ly = tr.py[i]; li = i; }
    v.placeOnTrack(li, 0, 30);
    v._safeT = 0;
    v.events.respawn = false;
    r.lap.n = 2;
    r.lap.cp = [true, false, false];
    r.lap.prevFi = v.fi;
    const n0 = sky.game.respawns || 0;
    let maxSide = 0;
    r.driver.sample = () => {
      const lat = v.q1 && v.q1.near ? v.q1.l : (v.lat || 0);
      return { ...coast, throttle: 1, steer: Math.max(-1, Math.min(1, -lat * 0.25)) };
    };
    sky.sim(5, () => {
      const side = v.q1 && v.q1.near ? Math.abs(v.q1.l || 0) : 0;
      if (side > maxSide) maxSide = side;
      return false;
    });
    return { y: +ly.toFixed(1), maxSide: +maxSide.toFixed(1), respawns: (sky.game.respawns || 0) - n0, n: r.lap.n, cp: r.lap.cp.slice() };
  }, coast);
  if (errors.length) throw new Error(errors.join('\n'));
  if (report.y > -8) throw new Error('expected a low section ' + JSON.stringify(report));
  if (report.maxSide < 22 && report.respawns) throw new Error('low road respawn ' + JSON.stringify(report));
  if (report.n !== 2 || !report.cp[0]) throw new Error('alpine progress ' + JSON.stringify(report));
  ok('alpine valley is not off-track');
  await page.close();
} catch (e) { bad('alpine valley is not off-track', e); }

await browser.close();
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
