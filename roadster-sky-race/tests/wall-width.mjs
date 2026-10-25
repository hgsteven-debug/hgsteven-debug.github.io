// 加寬前（路面半寬 11m）電腦對手三圈的護欄接觸。數字來自改寬度前的同一套模擬。
// canyon 363 / coast 34 / alpine 212 / city 946 / moon 1558，合計 3113。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const BEFORE = { canyon: 363, coast: 34, alpine: 212, city: 946, moon: 1558 };
const BEFORE_RAIL = { canyon: 2512, coast: 488, alpine: 1120, city: 4716, moon: 3271 };
const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function race(id) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => page.__err.push(String(e.message || e)));
  page.__err = [];
  await page.setCacheEnabled(false);
  await page.goto(BASE + `?track=${id}&q=low&ai=0&autostart=1&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=0&lang=zh-TW`, {
    waitUntil: 'domcontentloaded', timeout: 90000,
  });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.race && window.__sky.game.state !== 'loading', { timeout: 90000 });
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.freeze = true;
    sky.game.state = 'race';
    const tr = sky.track;
    const r = sky.race.racers[0];
    const v = r.veh;
    r.driver = new sky.AiDriver(tr, 'normal');
    const dt = 1 / 120;
    let hits = 0, prev = false, rail = 0, t = 0, maxAl = 0;
    while (r.lap.n < 4 && t < 340) {
      sky.race.step(dt);
      const w = v.events.wall || 0;
      const hit = w > 2;
      if (hit && !prev) hits++;
      prev = hit;
      if (v._onRail) rail++;
      v.events.wall = 0;
      v.events.impact = 0;
      if (v.q1 && v.q1.al > maxAl) maxAl = v.q1.al;
      t += dt;
    }
    const boxes = sky.battle ? sky.battle.boxes : [];
    let boxAl = 0;
    for (const b of boxes) {
      const q = tr.query(b.x, b.z);
      if (q.al > boxAl) boxAl = q.al;
    }
    let calls = 0;
    try {
      sky.renderer.render(sky.scene, sky.camera);
      calls = sky.renderer.info.render.calls;
    } catch (e) { calls = -1; }
    return {
      laps: r.lap.n, t: +t.toFixed(1), hits, rail, maxAl: +maxAl.toFixed(1),
      half: tr.half, pads: (tr.pads || []).length, zones: (tr.zones || []).length,
      boosts: (tr.boosts || []).length, grav: tr.def && tr.def.gravity || 0,
      stunt: !!(tr.stunt && tr.stunt.loop0 != null),
      boxAl: +boxAl.toFixed(2), boxes: boxes.length, calls,
      ice: (tr.zones || []).some((z) => z.kind === 'ice' && z.k < 0.5),
      respawns: sky.game.respawns || 0,
    };
  });
  const errors = page.__err;
  await page.close();
  return { report, errors };
}

try {
  const out = {};
  for (const id of ['canyon', 'coast', 'alpine', 'city', 'moon']) {
    const { report, errors } = await race(id);
    assert(errors.length === 0, id + ' ' + errors.join('\n'));
    assert(report.laps >= 4, id + ' unfinished ' + JSON.stringify(report));
    assert(report.half >= 14.8 && report.half <= 16, id + ' width ' + report.half);
    assert(report.hits < BEFORE[id] * 0.72, id + ' hits ' + report.hits + ' before ' + BEFORE[id]);
    assert(report.rail < BEFORE_RAIL[id] * 0.85, id + ' rail ' + report.rail + ' before ' + BEFORE_RAIL[id]);
    assert(report.pads > 0, id + ' pads');
    assert(report.boxAl < report.half * 0.55, id + ' box in wall ' + report.boxAl);
    out[id] = report;
    console.log(id, JSON.stringify(report));
  }
  const sum = Object.values(out).reduce((s, r) => s + r.hits, 0);
  const beforeSum = Object.values(BEFORE).reduce((s, n) => s + n, 0);
  assert(sum < beforeSum * 0.6, 'sum ' + sum + ' before ' + beforeSum);
  ok('wider roads cut wall hits ' + sum + ' from ' + beforeSum);

  const neon = await race('neon');
  assert(neon.errors.length === 0, neon.errors.join('\n'));
  assert(neon.report.laps >= 4 && neon.report.pads >= 6 && neon.report.boosts >= 2, JSON.stringify(neon.report));
  assert(neon.report.hits < 800, 'neon hits ' + neon.report.hits);
  console.log('neon', JSON.stringify(neon.report));
  ok('neon boost chain');

  const glacier = await race('glacier');
  assert(glacier.errors.length === 0, glacier.errors.join('\n'));
  assert(glacier.report.laps >= 4 && glacier.report.ice && glacier.report.zones >= 3, JSON.stringify(glacier.report));
  assert(glacier.report.hits < 800, 'glacier hits ' + glacier.report.hits);
  console.log('glacier', JSON.stringify(glacier.report));
  ok('glacier ice');

  const orbit = await race('orbit');
  assert(orbit.errors.length === 0, orbit.errors.join('\n'));
  assert(orbit.report.laps >= 4 && Math.abs(orbit.report.grav - 3.7) < 0.01, JSON.stringify(orbit.report));
  assert(orbit.report.hits < 800, 'orbit hits ' + orbit.report.hits);
  console.log('orbit', JSON.stringify(orbit.report));
  ok('orbit station');

  const rift = await race('rift');
  assert(rift.errors.length === 0, rift.errors.join('\n'));
  assert(rift.report.stunt && rift.report.laps >= 4, JSON.stringify(rift.report));
  assert(rift.report.hits < 1400, 'rift hits ' + rift.report.hits);
  console.log('rift', JSON.stringify(rift.report));
  ok('rift helix');

  assert(out.moon.grav === 1.62, 'moon g ' + out.moon.grav);
  ok('moon gravity unchanged');
} catch (e) { bad('wall width race', e); }

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.setCacheEnabled(false);
  await page.goto(BASE + '?track=city&q=low&ai=0&autostart=1&nocount=1&noadapt=1&nopauseblur=1&nonet=1&items=0&lang=zh-TW', {
    waitUntil: 'domcontentloaded', timeout: 90000,
  });
  await page.waitForFunction(() => window.__sky && window.__sky.game.state !== 'loading', { timeout: 90000 });
  const slide = await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.freeze = true;
    const v = sky.veh;
    const tr = sky.track;
    const i = 30;
    const lat = (tr.half || 15) + 2.2;
    v.placeOnTrack(i, lat, 36);
    v.energy = 100;
    v._safeT = 30;
    const fi0 = v.fi;
    const sp0 = v.speed;
    let minSp = sp0, rails = 0;
    const cmd = { steer: 1, throttle: 1, brake: 0, lift: false, nitro: false, pitch: 0 };
    for (let n = 0; n < 180; n++) {
      v.step(1 / 120, cmd);
      if (v.speed < minSp) minSp = v.speed;
      if (v._onRail) rails++;
      v.events.wall = 0;
    }
    let d = v.fi - fi0;
    if (d < -tr.N / 2) d += tr.N;
    return { sp0: +sp0.toFixed(1), minSp: +minSp.toFixed(1), end: +v.speed.toFixed(1), dfi: +d.toFixed(1), rails, respawn: !!v.events.respawn };
  });
  assert(errors.length === 0, errors.join('\n'));
  assert(slide.dfi > 8, 'stuck on wall ' + JSON.stringify(slide));
  assert(slide.minSp > slide.sp0 * 0.45, 'hard stop ' + JSON.stringify(slide));
  assert(!slide.respawn, 'respawn ' + JSON.stringify(slide));
  console.log('slide', JSON.stringify(slide));
  ok('wall glance keeps speed');
  await page.close();
} catch (e) { bad('wall glance keeps speed', e); }

await browser.close();
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
