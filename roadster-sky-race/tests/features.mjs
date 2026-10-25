// 無頭測試：迴圈吸地、電腦對手、兩支手把分屏。用 puppeteer-core 驅動本機靜態站。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function open(query) {
  if (!query.includes('nonet=1') && !query.includes('net=1')) query += '&nonet=1';
  if (!query.includes('items=')) query += '&items=0';
  if (!query.includes('lang=')) query += '&lang=zh-TW';
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
  return { page, errors };
}

async function testCityShape() {
  const { page, errors } = await open('?track=city&q=low&autostart=1&nocount=1&noadapt=1&nopauseblur=1&ai=0');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    const tr = sky.track;
    const N = tr.N;
    let maxDy = 0, maxTurn = 0;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      maxDy = Math.max(maxDy, Math.abs(tr.py[j] - tr.py[i]));
      const dot = tr.tx[i] * tr.tx[j] + tr.tz[i] * tr.tz[j];
      maxTurn = Math.max(maxTurn, Math.acos(Math.max(-1, Math.min(1, dot))));
    }
    let cross = null;
    for (let i = 0; i < N && !cross; i += 4) {
      for (let j = i + 40; j < N - 40; j += 4) {
        const d = Math.hypot(tr.px[i] - tr.px[j], tr.pz[i] - tr.pz[j]);
        if (d < 36) { cross = { i, j, d: Math.round(d) }; break; }
      }
    }
    const legacy = sky.trackById('stunt');
    return {
      id: tr.id, gaps: tr.gaps.length, cps: (tr.checkpoints || []).length,
      stunt: !!tr.stunt, city: !!(tr.def && tr.def.city), blocks: !!(sky.world && sky.world.cityBlocks),
      maxDy: +maxDy.toFixed(3), maxTurn: +maxTurn.toFixed(3), cross,
      legacy: legacy && legacy.id, len: Math.round(tr.length),
    };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (report.id !== 'city' || report.legacy !== 'city') throw new Error('id ' + JSON.stringify(report));
  if (report.gaps !== 0 || report.stunt) throw new Error('still a stunt ' + JSON.stringify(report));
  if (report.cps < 8) throw new Error('checkpoints ' + JSON.stringify(report));
  if (!report.city || !report.blocks) throw new Error('scenery ' + JSON.stringify(report));
  if (!(report.maxDy < 0.2)) throw new Error('not flat ' + JSON.stringify(report));
  if (!(report.maxTurn < 0.15)) throw new Error('kink ' + JSON.stringify(report));
  if (report.cross) throw new Error('cross ' + JSON.stringify(report.cross));
  await page.close();
}

async function testAi() {
  const { page, errors } = await open('?track=canyon&ai=1&diff=hard&autostart=1&nocount=1&q=low&noadapt=1&nopauseblur=1');
  const report = await page.evaluate(async () => {
    const sky = window.__sky;
    sky.game.freeze = true;
    sky.game.state = 'race';
    const ai = sky.race.racers.find((r) => r.driver.kind === 'ai');
    const samples = [];
    for (let t = 0; t < 180 && ai.lap.n < 2; t += 15) {
      sky.sim(15);
      samples.push({ t: t + 15, n: ai.lap.n, fi: Math.round(ai.veh.fi), cp: ai.lap.cp.slice(), sp: Math.round(ai.veh.speed), y: Math.round(ai.veh.pos.y) });
    }
    return { n: ai.lap.n, samples, humans: sky.race.locals().length, racers: sky.race.racers.length };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (report.racers !== 2 || report.humans !== 1) throw new Error('roster ' + JSON.stringify(report));
  if (!(report.n >= 2)) throw new Error('AI did not finish a lap ' + JSON.stringify(report.samples));
  await page.close();
}

async function testAiCity() {
  const { page, errors } = await open('?track=city&ai=1&diff=hard&autostart=1&nocount=1&q=low&noadapt=1&nopauseblur=1');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.freeze = true;
    sky.game.state = 'race';
    const ai = sky.race.racers.find((r) => r.driver.kind === 'ai');
    const samples = [];
    let stuck = 0;
    let prev = ai.veh.fi;
    for (let t = 0; t < 150 && ai.lap.n < 2; t += 10) {
      sky.sim(10);
      const fi = ai.veh.fi;
      let d = fi - prev;
      if (d < -sky.track.N / 2) d += sky.track.N;
      if (d < 8 && ai.veh.speed < 4) stuck += 10;
      else stuck = 0;
      prev = fi;
      samples.push({ t: t + 10, n: ai.lap.n, fi: Math.round(fi), sp: Math.round(ai.veh.speed), stuck });
      if (stuck > 20) break;
    }
    return { n: ai.lap.n, stuck, samples };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!(report.n >= 2)) throw new Error('AI did not finish a lap ' + JSON.stringify(report.samples));
  if (report.stuck > 20) throw new Error('AI stuck ' + JSON.stringify(report.samples.slice(-4)));
  await page.close();
}

async function testPads() {
  const { page, errors } = await open('?q=low&noadapt=1&nopauseblur=1&ai=0');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    const mk = (index, id) => ({
      index, id, mapping: 'standard', connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    });
    const pads = [
      mk(0, 'P1 (Vendor: 045e Product: 028e)'),
      mk(1, 'P2 (Vendor: 045e Product: 028e)'),
    ];
    navigator.getGamepads = () => pads;
    sky.input.poll(1 / 60);
    sky.pollLobby();
    pads[1].buttons[0].pressed = true; pads[1].buttons[0].value = 1;
    sky.pollLobby();
    const joined = !!(sky.lobby.p2 && sky.lobby.p2.index === 1);
    const locked = sky.input.padIndex === 0 && sky.input.exclusive === true;
    pads[1].buttons[0].pressed = false; pads[1].buttons[0].value = 0;
    sky.pollLobby();
    pads[1].buttons[8].pressed = true; pads[1].buttons[8].value = 1;
    sky.pollLobby();
    const left = sky.lobby.p2 == null && sky.input.padIndex == null;
    sky.input.poll(1 / 60);
    sky.pollLobby();
    pads[1].buttons[8].pressed = false; pads[1].buttons[8].value = 0;
    sky.pollLobby();
    pads[1].buttons[1].pressed = true; pads[1].buttons[1].value = 1;
    sky.pollLobby();
    const rejoined = !!(sky.lobby.p2 && sky.lobby.p2.index === 1);
    const remote = new sky.RemoteDriver();
    remote.push({ steer: 0.5, throttle: 1, brake: 0, lift: false, nitro: true, pitch: 0 });
    const remoteOk = remote.sample().steer === 0.5 && remote.sample().nitro === true && sky.LOCAL_LIMIT === 2;
    sky.startGame();
    sky.game.freeze = true;
    sky.game.state = 'race';
    const p2 = sky.race.locals()[1];
    const split = sky.game.split === true;
    for (let i = 0; i < 40; i++) {
      const w = Math.sin(i) * 0.9;
      pads[0].axes[0] = w;
      pads[1].axes[0] = -w;
      sky.sim(1 / 60);
    }
    pads[0].axes[0] = -1;
    pads[1].axes[0] = 1;
    sky.sim(0.8);
    const steer0 = sky.input.state.steer;
    const steer1 = p2.input.state.steer;
    const x0 = sky.veh.pos.x, z0 = sky.veh.pos.z;
    const x1 = p2.veh.pos.x, z1 = p2.veh.pos.z;
    const h0 = sky.veh.heading, h1 = p2.veh.heading;
    return {
      joined, locked, left, rejoined, remoteOk, split,
      locals: sky.race.locals().length,
      steer0, steer1, h0, h1,
      apart: Math.hypot(x0 - x1, z0 - z1),
      cal0: sky.input.cal.done, cal1: p2.input.cal.done,
    };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!report.joined || !report.locked) throw new Error('join failed ' + JSON.stringify(report));
  if (!report.left || !report.rejoined) throw new Error('leave/rejoin failed ' + JSON.stringify(report));
  if (!report.remoteOk) throw new Error('remote driver ' + JSON.stringify(report));
  if (!report.split || report.locals !== 2) throw new Error('split roster ' + JSON.stringify(report));
  if (!(report.steer0 < -0.35 && report.steer1 > 0.35)) throw new Error('steer ' + JSON.stringify(report));
  if (!(Math.abs(report.h0 - report.h1) > 0.05 || report.apart > 1.5)) throw new Error('cars did not diverge ' + JSON.stringify(report));
  await page.close();
}

async function testTeslaSlots() {
  const { page, errors } = await open('?q=low&noadapt=1&nopauseblur=1&ai=0');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    const XID = 'Xbox Wireless Controller (Vendor: 045e Product: 02fd)';
    const VID = 'Tesla Virtual Gamepad (Vendor: 28de Product: 0001)';
    const mk = (index, id, mapping) => ({
      index, id, mapping, connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    });
    const resetLobby = () => {
      sky.leaveP2();
      sky.input.lockPad(null);
      sky.lobby.prev.clear();
    };
    let slots = [];
    navigator.getGamepads = () => slots;

    // 虛擬手把占在 index 0，兩支相同 id 的 Xbox 在 2 和 3。P1 必須是第一支真手把。
    const virt0 = mk(0, VID, 'standard');
    virt0.buttons[0].pressed = true; virt0.buttons[0].value = 1; virt0.axes = [1, -1, 0, 0];
    const lateA = mk(2, XID, 'standard');
    const lateB = mk(3, XID, 'standard');
    slots = [virt0, null, lateA, lateB];
    resetLobby();
    sky.input.poll(1 / 60); sky.pollLobby();
    sky.input.poll(1 / 60); sky.pollLobby();
    const virtP1 = sky.input.padInfo.index;
    const virtNotP2 = sky.lobby.p2 == null;
    lateB.buttons[0].pressed = true; lateB.buttons[0].value = 1;
    sky.input.poll(1 / 60); sky.pollLobby();
    const virtJoin = sky.lobby.p2 && sky.lobby.p2.index;
    const virtP1Stuck = sky.input.padInfo.index;

    // 車主照片：index 0 Xbox、index 1 空、index 2 Xbox（同一支 id）、index 3 Tesla Virtual。
    const virt = mk(3, VID, 'standard');
    virt.buttons[0].pressed = true; virt.buttons[0].value = 1; virt.axes = [1, -1, 1, 0];
    const pad0 = mk(0, XID, 'standard');
    const pad2 = mk(2, XID, '');
    slots = [pad0, null, null, virt];
    resetLobby();
    sky.input.poll(1 / 60); sky.pollLobby();
    sky.input.poll(1 / 60); sky.pollLobby();
    sky.input.poll(1 / 60); sky.pollLobby();
    const quiet = {
      p1: sky.input.padInfo.index,
      p1id: sky.input.padInfo.id,
      p2: sky.lobby.p2,
      hint: document.getElementById('startP2Hint').textContent,
      list: document.getElementById('startPads').textContent,
    };
    // 第一次按下才出現的第二支：這一幀不能被吃成 P1。
    pad2.buttons[0].pressed = true; pad2.buttons[0].value = 1;
    slots = [pad0, null, pad2, virt];
    sky.input.poll(1 / 60);
    const p1AfterReveal = sky.input.padInfo.index;
    sky.pollLobby();
    const revealed = sky.lobby.p2 && { index: sky.lobby.p2.index, id: sky.lobby.p2.id };
    const listRevealed = document.getElementById('startPads').textContent;
    pad2.buttons[0].pressed = false; pad2.buttons[0].value = 0;
    sky.pollLobby();
    pad2.buttons[8].pressed = true; pad2.buttons[8].value = 1;
    sky.pollLobby();
    const leftReveal = sky.lobby.p2 == null && sky.input.padIndex == null;
    pad2.buttons[8].pressed = false; pad2.buttons[8].value = 0;
    sky.input.poll(1 / 60); sky.pollLobby();
    // 類比按鈕：pressed 為 false，value 只到 0.62。
    pad2.buttons[1] = { pressed: false, value: 0.62 };
    sky.input.poll(1 / 60); sky.pollLobby();
    const analog = sky.lobby.p2 && sky.lobby.p2.index;
    const p1DuringAnalog = sky.input.padIndex;
    pad2.buttons[1] = { pressed: false, value: 0 };
    sky.pollLobby();
    pad2.buttons[8].pressed = true; pad2.buttons[8].value = 1;
    sky.pollLobby();
    pad2.buttons[8].pressed = false; pad2.buttons[8].value = 0;
    sky.pollLobby();
    // 只推搖桿、沒有按鈕。
    pad2.axes[0] = 0.82;
    sky.pollLobby();
    const stick = sky.lobby.p2 && sky.lobby.p2.index;
    pad2.axes[0] = 0;
    sky.pollLobby();
    pad2.buttons[8].pressed = true; pad2.buttons[8].value = 1;
    sky.pollLobby();
    pad2.buttons[8].pressed = false; pad2.buttons[8].value = 0;
    sky.pollLobby();
    // 按鈕是數字而不是 {pressed,value}。
    pad2.buttons = [0, 0, 1, 0, 0, 0, 0, 0, 0];
    sky.pollLobby();
    const numeric = sky.lobby.p2 && sky.lobby.p2.index;
    pad2.buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    pad2.mapping = 'standard';
    sky.input.poll(1 / 60);
    sky.startGame();
    sky.game.freeze = true;
    sky.game.state = 'race';
    const p2r = sky.race.locals()[1];
    for (let i = 0; i < 30; i++) {
      pad0.axes[0] = -0.2;
      pad2.axes[0] = 0.2;
      virt.axes[0] = -1;
      sky.sim(1 / 60);
    }
    pad0.axes[0] = -1;
    pad2.axes[0] = 1;
    virt.axes[0] = -1;
    sky.sim(0.7);
    return {
      virtP1, virtNotP2, virtJoin, virtP1Stuck,
      quiet, p1AfterReveal, revealed, listRevealed, leftReveal, analog, p1DuringAnalog, stick, numeric,
      split: sky.game.split === true,
      locals: sky.race.locals().length,
      p1Race: sky.input.padIndex,
      p2Race: p2r && p2r.input.padIndex,
      steer0: sky.input.state.steer,
      steer1: p2r && p2r.input.state.steer,
    };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (report.virtP1 !== 2 || !report.virtNotP2) throw new Error('virtual stole P1/P2 ' + JSON.stringify(report));
  if (report.virtJoin !== 3 || report.virtP1Stuck !== 2) throw new Error('virtual-at-0 join ' + JSON.stringify(report));
  if (report.quiet.p1 !== 0 || report.quiet.p2) throw new Error('quiet lobby ' + JSON.stringify(report.quiet));
  if (report.quiet.p1id.indexOf('Xbox') < 0) throw new Error('P1 id ' + report.quiet.p1id);
  if (report.quiet.hint !== '第二支搖桿：按任一鍵加入 P2') throw new Error('hint ' + report.quiet.hint);
  const list = report.quiet.list;
  if (!list.includes('[1]') || !list.includes('（空）')) throw new Error('empty slot ' + list);
  if (!list.includes('[3]') || !list.includes('車機虛擬（不使用）')) throw new Error('virtual line ' + list);
  if (!list.includes('Tesla Virtual Gamepad')) throw new Error('virtual id ' + list);
  if (report.p1AfterReveal !== 0) throw new Error('reveal stole P1 ' + JSON.stringify(report));
  if (!report.revealed || report.revealed.index !== 2 || report.revealed.id !== 'Xbox Wireless Controller (Vendor: 045e Product: 02fd)') throw new Error('reveal join ' + JSON.stringify(report.revealed));
  if (!report.listRevealed.includes('P2') || !report.listRevealed.includes('（非標準）')) throw new Error('list after join ' + report.listRevealed);
  if (!report.leftReveal) throw new Error('leave ' + JSON.stringify(report));
  if (report.analog !== 2 || report.p1DuringAnalog !== 0) throw new Error('analog ' + JSON.stringify(report));
  if (report.stick !== 2) throw new Error('stick ' + JSON.stringify(report));
  if (report.numeric !== 2) throw new Error('numeric ' + JSON.stringify(report));
  if (!report.split || report.locals !== 2) throw new Error('roster ' + JSON.stringify(report));
  if (report.p1Race !== 0 || report.p2Race !== 2) throw new Error('race pads ' + JSON.stringify(report));
  if (!(report.steer0 < -0.35 && report.steer1 > 0.35)) throw new Error('steer ' + JSON.stringify(report));
  await page.close();
}

async function testKeys() {
  const { page, errors } = await open('?ai=0&q=low&autostart=1&nocount=1&noadapt=1&nopauseblur=1');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.freeze = true;
    sky.game.state = 'race';
    const before = sky.race.racers.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }));
    const x0 = sky.veh.pos.x, z0 = sky.veh.pos.z, h0 = sky.veh.heading;
    sky.sim(1.2);
    const key = { sp: sky.veh.speed, steer: sky.input.state.steer, moved: Math.hypot(sky.veh.pos.x - x0, sky.veh.pos.z - z0), dh: Math.abs(sky.veh.heading - h0) };
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight', bubbles: true }));
    sky.veh.placeOnTrack(sky.track.N - 10, 0, 0);
    sky.input.touch.gas = true;
    sky.input.touch.left = true;
    sky.input.touch.right = false;
    sky.sim(1.1);
    const touch = { sp: sky.veh.speed, steer: sky.input.state.steer };
    return { before, key, touch, split: !!sky.game.split };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (report.before !== 1 || report.split) throw new Error('solo changed ' + JSON.stringify(report));
  if (!(report.key.sp > 4 && report.key.steer > 0.2 && report.key.moved > 1)) throw new Error('keyboard ' + JSON.stringify(report.key));
  if (!(report.touch.sp > 3 && report.touch.steer < -0.2)) throw new Error('touch ' + JSON.stringify(report.touch));
  await page.close();
}

async function testCityRules() {
  const { page, errors } = await open('?track=city&q=low&ai=0&autostart=1&nocount=1&noadapt=1&nopauseblur=1');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.freeze = true;
    sky.game.state = 'race';
    const tr = sky.track;
    const N = tr.N;
    const r = sky.race.racers[0];
    const lap = r.lap;
    const mark = (frac) => {
      r.veh.placeOnTrack(Math.floor(frac * N), 0, 4);
      lap.prevFi = r.veh.fi;
      sky.sim(0.08);
      return lap.cp.slice();
    };
    lap.cp = [false, false, false];
    lap.prevFi = null;
    const a = mark(0.27);
    const b = mark(0.77);
    const c = mark(0.52);
    const d = mark(0.77);
    lap.cp = [false, false, false];
    const bnds = tr.bounds;
    const cx = (bnds.minX + bnds.maxX) / 2;
    const cz = (bnds.minZ + bnds.maxZ) / 2;
    r.veh.pos.set(cx, 4, cz);
    r.veh.vel.set(0, 0, 0);
    const qMid = tr.query(cx, cz);
    lap.prevFi = qMid.fi;
    sky.sim(0.25);
    const infield = { cp: lap.cp.slice(), al: qMid.al };
    const spots = [
      [cx, cz],
      [bnds.minX - 70, bnds.minZ - 70],
      [bnds.maxX + 80, cz],
      [cx, bnds.maxZ + 90],
    ];
    const lands = spots.map(([x, z]) => {
      r.veh.pos.set(x, 40, z);
      r.veh.recoverToCheckpoint();
      const q = tr.query(r.veh.pos.x, r.veh.pos.z);
      return { al: +q.al.toFixed(2), dy: +Math.abs(r.veh.pos.y - q.y).toFixed(2), gap: !!q.gap };
    });
    return { a, b, c, d, infield, lands };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!report.a[0] || report.a[1] || report.a[2]) throw new Error('first gate ' + JSON.stringify(report.a));
  if (report.b[2]) throw new Error('checkpoint skipped ahead ' + JSON.stringify(report.b));
  if (!report.c[0] || !report.c[1] || report.c[2]) throw new Error('middle gate ' + JSON.stringify(report.c));
  if (!report.d[2]) throw new Error('last gate ' + JSON.stringify(report.d));
  if (report.infield.cp.some(Boolean) || !(report.infield.al > 18)) throw new Error('shortcut counted ' + JSON.stringify(report.infield));
  for (const land of report.lands) {
    if (!(land.al < 14) || land.gap || !(land.dy < 3)) throw new Error('respawn off track ' + JSON.stringify(report.lands));
  }
  await page.close();
}

function overlap(a, b) {
  return a.x < b.x + b.w - 0.5 && a.x + a.w > b.x + 0.5 && a.y < b.y + b.h - 0.5 && a.y + a.h > b.y + 0.5;
}

async function measurePad(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, t: (el.textContent || '').replace(/\s+/g, '') };
    };
    const gas = box('[data-t="gas"]');
    const brake = box('[data-t="brake"]');
    const down = box('[data-t="pdown"]');
    const faces = ['y', 'x', 'b', 'a'].map((k) => box('.gpad.face.' + k));
    const stick = box('#stick');
    const dpad = box('#dpad');
    const stickShown = getComputedStyle(document.querySelector('#stick')).display !== 'none';
    const hit = (b) => {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const node = document.elementFromPoint(cx, cy);
      const host = node && node.closest ? node.closest('[data-t],[data-p],#stick') : null;
      return {
        cx, cy,
        key: host && (host.dataset.t || host.dataset.p || (host.id === 'stick' ? 'stick' : '')),
        inside: cx >= 2 && cy >= 2 && cx <= innerWidth - 2 && cy <= innerHeight - 2,
      };
    };
    const sky = window.__sky;
    const gasEl = document.querySelector('[data-t="gas"]');
    gasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 4, clientX: gas.x + 8, clientY: gas.y + 8, pointerType: 'touch' }));
    gasEl.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerId: 4, pointerType: 'touch' }));
    sky.input.poll(1 / 60);
    sky.veh.followHost = true;
    sky.veh.events.respawn = false;
    sky.veh.pos.y = -80;
    sky.veh.step(1 / 30, { steer: 0, throttle: 1, brake: 0, lift: false, nitro: false, pitch: 0 });
    const eased = sky.sync.easeGuestPose(
      { x: sky.veh.pos.x, y: 0, z: sky.veh.pos.z, ready: true, qx: 0, qy: 0, qz: 0, qw: 1, heading: 0, speed: 0 },
      { x: sky.veh.pos.x + 4, y: 0, z: sky.veh.pos.z, qx: 0, qy: 0, qz: 0, qw: 1, heading: 0, speed: 20 },
      1 / 60,
    );
    const early = sky.sync.hostOffroadWarn({ known: true, onRoad: true, since: 0, toastAt: 0 }, false, 1000);
    const late = sky.sync.hostOffroadWarn(early.state, false, 1600);
    return {
      w: innerWidth, h: innerHeight, gas, brake, down, faces, stick, dpad, stickShown,
      brakeShown: getComputedStyle(document.querySelector('[data-t="brake"]')).display !== 'none',
      hitG: hit(gas), hitD: hit(down),
      held: sky.input.touch.gas === true, throttle: sky.input.state.throttle,
      respawn: !!sky.veh.events.respawn, why: sky.veh.events.why || '',
      step: eased.step, snapped: !!eased.snapped,
      early: !!early.warn, late: !!late.warn,
      toast: (document.getElementById('toast').textContent || ''),
      forced: document.documentElement.classList.contains('force-landscape'),
    };
  });
}

async function testPhonePad() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  await page.setViewport({ width: 800, height: 360, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
  await page.goto(BASE + '?join=ABC234&q=low&noadapt=1&nopauseblur=1&nonet=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
  await page.evaluate(() => {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    document.getElementById('touch').classList.remove('hidden');
    document.getElementById('hud').classList.remove('hidden');
    window.__sky.game.state = 'race';
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const sizes = [[800, 360], [851, 393], [915, 412], [844, 390]];
  for (const [w, h] of sizes) {
    await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const box = await measurePad(page);
    if (errors.length) throw new Error(errors.join('\n'));
    if (box.gas.t !== '加速') throw new Error('label ' + JSON.stringify(box.gas));
    if (box.brakeShown || box.brake.w > 2) throw new Error('brake pedal still shown ' + JSON.stringify(box.brake));
    if (!box.down.t.includes('煞車')) throw new Error('down label ' + box.down.t);
    if (!(box.gas.x > w * 0.55 && box.gas.y + box.gas.h > h * 0.7)) throw new Error('gas not lower right ' + JSON.stringify(box));
    if (!(box.down.x < w * 0.45 && box.down.y + box.down.h > h * 0.7)) throw new Error('down not lower left ' + JSON.stringify(box));
    if (!box.hitG.inside || box.hitG.key !== 'gas') throw new Error('gas hit ' + JSON.stringify(box.hitG));
    if (!box.hitD.inside || box.hitD.key !== 'pdown') throw new Error('down hit ' + JSON.stringify(box.hitD));
    for (const f of box.faces) {
      if (f.y < 0 || f.x < 0 || f.x + f.w > w || f.y + f.h > h) throw new Error('face offscreen ' + JSON.stringify(f));
      if (overlap(f, box.gas)) throw new Error('face overlaps gas ' + JSON.stringify({ f, gas: box.gas }));
    }
    const byText = Object.fromEntries(box.faces.map((f) => [f.t, f]));
    const fb = byText['B推進'], fa = byText['A氮氣'], fy = byText['Y視角'], fx = byText['X回賽道'];
    if (!fb || !fa || !fy || !fx) throw new Error('face labels ' + JSON.stringify(box.faces.map((f) => f.t)));
    if (!(fb.y > fa.y && fb.y > fy.y && fb.y > fx.y)) throw new Error('B not bottom ' + JSON.stringify(box.faces));
    if (!(fa.x > fb.x + 16 && box.gas.x > fb.x + fb.w)) throw new Error('cluster ' + JSON.stringify(box.faces));
    if (!(fy.y + fy.h < fb.y && fx.y + fx.h < fb.y && fx.x + 4 < fy.x)) throw new Error('xy ' + JSON.stringify(box.faces));
    if (box.stickShown || box.stick.w > 2) throw new Error('stick visible ' + JSON.stringify(box.stick));
    if (!(box.dpad.w > 40) || box.down.y + box.down.h + 2 < box.dpad.y + box.dpad.h) throw new Error('down not on pad ' + JSON.stringify({ dpad: box.dpad, down: box.down }));
    if (!box.held || !(box.throttle > 0.5)) throw new Error('hold ' + JSON.stringify(box));
    if (box.respawn || box.why) throw new Error('local off-track respawn ' + JSON.stringify(box));
    if (!(box.step < 1.5) || box.snapped) throw new Error('smooth ' + JSON.stringify(box));
    if (box.early || !box.late) throw new Error('warn debounce ' + JSON.stringify(box));
  }
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const turned = await page.evaluate(() => {
    const turn = document.getElementById('turnPhone');
    const r = turn.getBoundingClientRect();
    const body = getComputedStyle(document.body);
    return {
      need: document.body.classList.contains('need-rotate'),
      forced: document.documentElement.classList.contains('force-landscape'),
      transform: body.transform,
      w: Math.round(r.width), h: Math.round(r.height),
      text: (turn.innerText || '').replace(/\s+/g, ''),
      iw: innerWidth, ih: innerHeight,
    };
  });
  if (turned.forced || turned.transform !== 'none') throw new Error('portrait still rotates ' + JSON.stringify(turned));
  if (!turned.need || turned.w < 380 || turned.h < 800) throw new Error('rotate overlay ' + JSON.stringify(turned));
  if (turned.text.indexOf('橫向') < 0) throw new Error('rotate copy ' + turned.text);
  const pr = await page.evaluate(() => window.__sky.renderer.getPixelRatio());
  if (!(pr <= 1.05)) throw new Error('dpr ' + pr);
  await page.close();
}

async function testUnstickAndEnergy() {
  const { page, errors } = await open('?track=city&q=low&ai=0&autostart=1&nocount=1&noadapt=1&nopauseblur=1');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.freeze = true;
    sky.game.state = 'race';
    const v = sky.veh;
    v.energy = 300;
    v.step(1 / 120, { steer: 0, throttle: 0, brake: 1, lift: false, nitro: false, pitch: 0 });
    sky.hud.update(0, { kmh: 0, energy: 300, speed: 0, nitroOn: false, grounded: true, thrusting: false, thrust: 0, onRoad: true }, sky.game.lap, 'c', '', 'g');
    const text = document.getElementById('ebarTxt').textContent;
    const width = document.getElementById('ebarFill').style.width;
    v.placeOnTrack(80, 0, 0);
    v._safeT = 0;
    const cmd = { steer: 0, throttle: 1, brake: 1, lift: false, nitro: false, pitch: 0 };
    let why = '';
    let steps = 0;
    for (let i = 0; i < 800 && !v.events.respawn; i++) {
      v.vel.set(0, 0, 0);
      v.speedF = 0;
      v.step(1 / 120, cmd);
      steps = i + 1;
      why = v.events.why;
    }
    const both = { steer: 0, throttle: 1, brake: 1, lift: false, nitro: false, pitch: 0 };
    v.placeOnTrack(90, 0, 0);
    v.events.respawn = false;
    v.vel.set(0, 0, 0);
    let sp = 0;
    for (let i = 0; i < 90; i++) v.step(1 / 120, both);
    sp = v.speed;
    return { energy: v.energy, text, width, respawn: steps, why, sp: +sp.toFixed(2), mass: v.mass };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!(report.energy <= 100)) throw new Error('energy stored ' + JSON.stringify(report));
  if (report.text.indexOf('300') >= 0 || report.width === '300%') throw new Error('energy hud ' + JSON.stringify(report));
  if (report.text.indexOf('100%') < 0) throw new Error('energy label ' + JSON.stringify(report));
  if (!report.respawn || report.respawn > 700 || report.why !== 'stuck') throw new Error('unstick ' + JSON.stringify(report));
  if (!(report.sp > 1)) throw new Error('brake held with throttle ' + JSON.stringify(report));
  await page.close();
}

async function testCollide() {
  const { page, errors } = await open('?track=city&q=low&ai=1&autostart=1&nocount=1&noadapt=1&nopauseblur=1');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.freeze = true;
    sky.game.state = 'race';
    const race = sky.race;
    const a = race.racers[0].veh;
    const b = race.racers[1].veh;
    a.placeOnTrack(120, 0, 0);
    b.placeOnTrack(120, 0, 0);
    b.pos.x = a.pos.x + 0.4;
    b.pos.y = a.pos.y;
    b.pos.z = a.pos.z;
    a.ghostT = 2;
    b.ghostT = 0;
    const gx = a.pos.x;
    race.collide();
    const ghostHeld = Math.abs(a.pos.x - gx) < 1e-6;
    a.ghostT = 0;
    b.ghostT = 0;
    a.mass = 1900;
    b.mass = 11000;
    a.vel.set(20, 0, 0);
    b.vel.set(-8, 0, 0);
    race.collide();
    const d = a.pos.distanceTo(b.pos);
    a.placeOnTrack(140, 0, 0);
    b.placeOnTrack(140, 0, 0);
    a.ghostT = 0;
    b.ghostT = 0;
    const h = a.heading;
    const fx = -Math.sin(h), fz = -Math.cos(h);
    a.pos.x += fx * 2; a.pos.z += fz * 2;
    b.pos.x -= fx * 2; b.pos.z -= fz * 2;
    a._px = a.pos.x - fx * 6; a._py = a.pos.y; a._pz = a.pos.z - fz * 6;
    b._px = b.pos.x + fx * 6; b._py = b.pos.y; b._pz = b.pos.z + fz * 6;
    a.vel.set(fx * 70, 0, fz * 70);
    b.vel.set(-fx * 70, 0, -fz * 70);
    race.collide();
    const swept = a.pos.distanceTo(b.pos);
    const on = a.onRoad && b.onRoad;
    return { ghostHeld, d: +d.toFixed(2), swept: +swept.toFixed(2), bumps: race.lastBump, on, wall: a.events.wall > 0 };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!report.ghostHeld) throw new Error('ghost ' + JSON.stringify(report));
  if (!(report.d >= 2 && report.d < 4)) throw new Error('separate ' + JSON.stringify(report));
  if (!(report.swept >= 1.8)) throw new Error('tunnel ' + JSON.stringify(report));
  if (!report.wall) throw new Error('bump ' + JSON.stringify(report));
  await page.close();
}

async function testMoon() {
  const { page, errors } = await open('?track=moon&q=low&ai=1&diff=hard&autostart=1&nocount=1&noadapt=1&nopauseblur=1');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    const tr = sky.track;
    const hang = (g) => {
      const v = sky.veh;
      tr.def.gravity = g;
      v.placeOnTrack(30, 0, 0);
      v.grounded = false;
      v.vel.set(0, 8, 0);
      v.pos.y = v.groundY + 2;
      v.airTime = 0.05;
      v._safeT = 30;
      v.events.respawn = false;
      const cmd = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0 };
      let t = 0;
      for (let i = 0; i < 6000; i++) {
        v.step(1 / 120, cmd);
        t += 1 / 120;
        if (v.events.respawn) return { t, respawn: true };
        if (v.grounded && t > 0.35) return { t, respawn: false };
      }
      return { t, respawn: false, grounded: v.grounded };
    };
    const earth = hang(9.81);
    const moon = hang(1.62);
    tr.def.gravity = 1.62;
    sky.game.freeze = true;
    sky.game.state = 'race';
    const ai = sky.race.racers.find((r) => r.driver.kind === 'ai');
    const samples = [];
    for (let t = 0; t < 220 && ai.lap.n < 2; t += 10) {
      sky.sim(10);
      samples.push({ t: t + 10, n: ai.lap.n, fi: Math.round(ai.veh.fi), sp: Math.round(ai.veh.speed), y: Math.round(ai.veh.pos.y) });
    }
    const badge = document.getElementById('gbadge');
    let cross = null;
    const N = tr.N;
    for (let i = 0; i < N && !cross; i += 6) {
      for (let j = i + 50; j < N - 50; j += 6) {
        const d = Math.hypot(tr.px[i] - tr.px[j], tr.pz[i] - tr.pz[j]);
        if (d < 28) { cross = { i, j, d: Math.round(d) }; break; }
      }
    }
    return {
      id: tr.id, g: tr.def.gravity, cps: (tr.checkpoints || []).length,
      earth: +earth.t.toFixed(2), moon: +moon.t.toFixed(2),
      earthRespawn: earth.respawn, moonRespawn: moon.respawn,
      n: ai.lap.n, samples, cross,
      badge: badge && !badge.classList.contains('hidden') ? badge.textContent : '',
      earthMesh: !!(sky.world && sky.world.earth),
      dust: !!(sky.world && sky.world.moonDust),
    };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (report.id !== 'moon' || report.g !== 1.62) throw new Error('track ' + JSON.stringify(report));
  if (report.cps < 8) throw new Error('checkpoints ' + JSON.stringify(report));
  if (report.cross) throw new Error('cross ' + JSON.stringify(report.cross));
  if (report.earthRespawn || report.moonRespawn) throw new Error('air respawn ' + JSON.stringify(report));
  if (!(report.moon / report.earth > 2)) throw new Error('airtime ' + JSON.stringify(report));
  if (!(report.n >= 2)) throw new Error('AI moon lap ' + JSON.stringify(report.samples));
  if (!report.badge.includes('1.62')) throw new Error('badge ' + JSON.stringify(report));
  if (!report.earthMesh || !report.dust) throw new Error('art ' + JSON.stringify(report));
  await page.close();
}

async function testBoost() {
  const { page, errors } = await open('?track=city&q=low&ai=0&autostart=1&nocount=1&noadapt=1&nopauseblur=1&veh=semi');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.freeze = true;
    const v = sky.veh;
    const zero = { steer: 0, throttle: 0, brake: 0, lift: false, nitro: false, pitch: 0 };
    const tap = () => {
      v.placeOnTrack(80, 0, 0);
      v.energy = 100;
      v.vel.set(0, 0, 0);
      const y0 = v.pos.y;
      v.step(1 / 120, { ...zero, lift: true });
      let max = v.pos.y;
      for (let i = 0; i < 160; i++) {
        v.step(1 / 120, zero);
        if (v.pos.y > max) max = v.pos.y;
      }
      return { dy: +(max - y0).toFixed(2), e: +v.energy.toFixed(1), g: v.grounded };
    };
    const hold = () => {
      v.setTune(sky.vehicleById('semi').tune);
      v.placeOnTrack(80, 0, 0);
      v.energy = 100;
      v.vel.set(0, 0, 0);
      const y0 = v.pos.y;
      for (let i = 0; i < 90; i++) v.step(1 / 120, { ...zero, lift: true });
      return { dy: +(v.pos.y - y0).toFixed(2), e: +v.energy.toFixed(1), g: v.grounded, thr: v.thrusting };
    };
    const nitroStill = () => {
      v.setTune(sky.vehicleById('roadster').tune);
      v.placeOnTrack(80, 0, 0);
      v.energy = 100;
      v.vel.set(0, 0, 0);
      const y0 = v.pos.y;
      for (let i = 0; i < 60; i++) v.step(1 / 120, { ...zero, nitro: true });
      return { dy: +(v.pos.y - y0).toFixed(2), e: +v.energy.toFixed(1), sp: +v.speed.toFixed(2) };
    };
    const reverse = () => {
      v.placeOnTrack(80, 0, 0);
      v.vel.set(0, 0, 0);
      const h = v.heading;
      for (let i = 0; i < 90; i++) v.step(1 / 120, { ...zero, brake: 1 });
      const fx = -Math.sin(h), fz = -Math.cos(h);
      const back = -(v.vel.x * fx + v.vel.z * fz);
      return { back: +back.toFixed(2), sp: +v.speed.toFixed(2) };
    };
    const wedged = () => {
      v.setTune(sky.vehicleById('roadster').tune);
      v.placeOnTrack(120, 0, 0);
      v.energy = 100;
      v.vel.set(0, 0, 0);
      const y0 = v.pos.y;
      const orig = v.tr.groundHeight.bind(v.tr);
      v.tr.groundHeight = () => y0 + 2.4;
      let max = y0;
      for (let i = 0; i < 40; i++) {
        v.step(1 / 120, { ...zero, lift: true, throttle: 1 });
        if (v.pos.y > max) max = v.pos.y;
      }
      v.tr.groundHeight = orig;
      return { dy: +(max - y0).toFixed(2), e: +v.energy.toFixed(1) };
    };
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    const axes = [0, 0, 0, 0, 0, 0];
    const gp = { id: 'JOWUA Pro Controller (Vendor: 057e Product: 2009)', index: 0, connected: true, mapping: 'standard', buttons, axes, timestamp: 1 };
    navigator.getGamepads = () => [gp];
    sky.input.setPadMode('switch');
    sky.input.padIndex = null;
    sky.input.exclusive = false;
    const press = (i, on) => { buttons[i].pressed = on; buttons[i].value = on ? 1 : 0; };
    press(0, true);
    for (let i = 0; i < 24; i++) sky.input.poll(1 / 60);
    const switchB = { lift: !!sky.input.state.lift, nitro: !!sky.input.state.nitro, profile: sky.input.profile.id };
    v.setTune(sky.vehicleById('roadster').tune);
    v.placeOnTrack(80, 0, 0);
    v.energy = 100;
    v.vel.set(0, 0, 0);
    const y0 = v.pos.y;
    for (let i = 0; i < 30; i++) {
      sky.input.poll(1 / 60);
      v.step(1 / 120, sky.input.state);
    }
    const padHop = { dy: +(v.pos.y - y0).toFixed(2), e: +v.energy.toFixed(1) };
    press(0, false);
    press(1, true);
    press(7, true);
    v.placeOnTrack(80, 0, 22);
    v.energy = 100;
    for (let i = 0; i < 20; i++) sky.input.poll(1 / 60);
    const switchA = { lift: !!sky.input.state.lift, nitro: !!sky.input.state.nitro, thr: +sky.input.state.throttle.toFixed(2) };
    sky.input.setPadMode('xbox');
    const xbox = { id: 'Xbox 360 Controller (Vendor: 045e Product: 028e)', index: 0, connected: true, mapping: 'standard', buttons, axes, timestamp: 2 };
    navigator.getGamepads = () => [xbox];
    sky.input.padIndex = null;
    for (let i = 0; i < 8; i++) sky.input.poll(1 / 60);
    const xboxB = { lift: !!sky.input.state.lift, nitro: !!sky.input.state.nitro, profile: sky.input.profile.id };
    return { tap: tap(), hold: hold(), nitroStill: nitroStill(), reverse: reverse(), wedged: wedged(), switchB, padHop, switchA, xboxB };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!(report.tap.dy >= 2 && report.tap.e <= 90)) throw new Error('tap ' + JSON.stringify(report.tap));
  if (!(report.hold.dy >= 1.5 && report.hold.e <= 90 && report.hold.thr)) throw new Error('hold ' + JSON.stringify(report.hold));
  if (!(report.nitroStill.e >= 99 && report.nitroStill.sp < 2)) throw new Error('nitro still ' + JSON.stringify(report.nitroStill));
  if (!(report.reverse.back > 2)) throw new Error('reverse ' + JSON.stringify(report.reverse));
  if (!(report.wedged.dy >= 1 && report.wedged.e <= 90)) throw new Error('wedged lift ' + JSON.stringify(report.wedged));
  if (!(report.switchB.lift && !report.switchB.nitro && report.switchB.profile === 'switch')) throw new Error('switch B ' + JSON.stringify(report.switchB));
  if (!(report.padHop.dy >= 1.2 && report.padHop.e <= 90)) throw new Error('pad hop ' + JSON.stringify(report.padHop));
  if (!(report.switchA.nitro && !report.switchA.lift)) throw new Error('switch A ' + JSON.stringify(report.switchA));
  if (!(report.xboxB.nitro && !report.xboxB.lift && report.xboxB.profile === 'xbox')) throw new Error('xbox B ' + JSON.stringify(report.xboxB));
  await page.close();
}

async function testPadPage() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  const res = await page.goto(BASE + 'gamepad-test.html?lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#status', { timeout: 10000 });
  const title = await page.title();
  if (!res.ok()) throw new Error('status ' + res.status());
  if (!title.includes('搖桿')) throw new Error('title ' + title);
  if (errors.length) throw new Error(errors.join('\n'));
  await page.close();
}

try {
  const tests = [
    ['city shape', testCityShape],
    ['keyboard touch', testKeys],
    ['phone accel pad', testPhonePad],
    ['two gamepads', testPads],
    ['tesla pad slots', testTeslaSlots],
    ['gamepad test page', testPadPage],
    ['ai lap', testAi],
    ['ai city lap', testAiCity],
    ['city checkpoints and respawn', testCityRules],
    ['unstick and energy cap', testUnstickAndEnergy],
    ['boost button', testBoost],
    ['car collision', testCollide],
    ['moon gravity and ai lap', testMoon],
  ];
  for (const [name, fn] of tests) {
    try { await fn(); ok(name); }
    catch (e) { bad(name, e); }
  }
} finally {
  await browser.close();
}
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
