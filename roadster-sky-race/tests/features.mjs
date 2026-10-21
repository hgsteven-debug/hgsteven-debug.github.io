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
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
  return { page, errors };
}

async function testLoop() {
  const { page, errors } = await open('?track=stunt&q=low&autostart=1&nocount=1&noadapt=1&nopauseblur=1&ai=0');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    const { track, veh, game, sim, ribbonCompression } = sky;
    const s = track.stunt;
    const order = s && s.wall0 < s.wall1 && s.wall1 < s.loop0 && s.loop0 < s.loopTop && s.loopTop < s.loop1
      && s.loop1 <= s.inv0 && s.inv0 < s.inv1 && s.inv1 < s.jump0
      && s.jump0 < s.jump1 && s.jump1 < track.N;
    const slowC = ribbonCompression(-1, 1 / 22, 8);
    const fastC = ribbonCompression(-1, 1 / 22, 40);
    game.freeze = true;
    game.state = 'race';
    veh.sawCeiling = false;
    veh.placeOnTrack(s.loop0 + 2, 0, 64);
    const yEnter = veh.pos.y;
    sim(3.2);
    const fast = { saw: veh.sawCeiling, y: veh.pos.y, yEnter, attached: veh.attached, fi: veh.fi, sp: veh.speed, top: s.loopTop };
    veh.sawCeiling = false;
    veh.placeOnTrack(s.loopTop, 0, 8);
    const yTop = veh.pos.y;
    sim(1.5);
    const fall = { attached: veh.attached, y: veh.pos.y, yTop, drop: yTop - veh.pos.y, sp: veh.speed };
    veh.sawInvert = false;
    const invAt = Math.max(s.inv0 + 2, s.inv1 - 4);
    veh.placeOnTrack(invAt, 0, 48);
    const yInv = veh.pos.y;
    sim(1.1);
    const invFast = { saw: veh.sawInvert, attached: veh.attached, y: veh.pos.y, yInv, sp: veh.speed };
    veh.sawInvert = false;
    veh.placeOnTrack(invAt, 0, 8);
    const ySlow = veh.pos.y;
    sim(1.45);
    const invSlow = { attached: veh.attached, y: veh.pos.y, ySlow, drop: ySlow - veh.pos.y };
    return { order, slowC, fastC, fast, fall, invFast, invSlow, stunt: s, errors: [] };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!report.order) throw new Error('stunt index order ' + JSON.stringify(report.stunt));
  if (!(report.slowC < 0)) throw new Error('slow compression ' + report.slowC);
  if (!(report.fastC > 2)) throw new Error('fast compression ' + report.fastC);
  if (!report.fast.saw) throw new Error('fast loop did not reach ceiling ' + JSON.stringify(report.fast));
  if (!(report.fast.fi > report.fast.top)) throw new Error('fast loop did not pass the top ' + JSON.stringify(report.fast));
  if (report.fall.attached || !(report.fall.drop > 8)) throw new Error('slow loop did not fall ' + JSON.stringify(report.fall));
  if (!report.invFast.saw && !(report.invFast.y > 8)) throw new Error('fast invert failed ' + JSON.stringify(report.invFast));
  if (report.invSlow.attached || !(report.invSlow.drop > 6)) throw new Error('slow invert did not fall ' + JSON.stringify(report.invSlow));
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

async function testAiStunt() {
  const { page, errors } = await open('?track=stunt&ai=1&diff=hard&autostart=1&nocount=1&q=low&noadapt=1&nopauseblur=1');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    sky.game.freeze = true;
    sky.game.state = 'race';
    const ai = sky.race.racers.find((r) => r.driver.kind === 'ai');
    ai.veh.sawCeiling = false;
    const samples = [];
    for (let t = 0; t < 90 && !ai.veh.sawCeiling; t += 10) {
      sky.sim(10);
      samples.push({ t: t + 10, fi: Math.round(ai.veh.fi), y: Math.round(ai.veh.pos.y), sp: Math.round(ai.veh.speed), saw: ai.veh.sawCeiling, att: ai.veh.attached });
    }
    return { saw: ai.veh.sawCeiling, samples };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!report.saw) throw new Error('AI did not cross the loop ' + JSON.stringify(report.samples));
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

async function testStuntDrive() {
  const { page, errors } = await open('?track=stunt&q=low&ai=0&autostart=1&nocount=1&noadapt=1&nopauseblur=1');
  const report = await page.evaluate(() => {
    const sky = window.__sky;
    const tr = sky.track;
    const veh = sky.veh;
    sky.game.freeze = true;
    sky.game.state = 'race';
    let maxDy = 0, maxTurn = 0, worst = null;
    for (let i = 0; i < tr.N; i++) {
      const j = (i + 1) % tr.N;
      const dy = Math.abs(tr.py[j] - tr.py[i]);
      const dot = tr.tx[i] * tr.tx[j] + tr.ty[i] * tr.ty[j] + tr.tz[i] * tr.tz[j];
      const turn = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (dy > maxDy) maxDy = dy;
      if (turn > maxTurn) { maxTurn = turn; worst = i; }
    }
    const cap = veh.t.vMax * 3.6 + 4;
    const follow = () => {
      const fi = veh.attached ? veh.fi : (veh.q1.fi || veh.fi || 0);
      const look = Math.max(10, Math.min(28, (veh.speed || 0) * 0.34));
      const f = tr.frame(fi + look);
      let err = Math.atan2(-f.tangent.x, -f.tangent.z) - veh.heading;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      const lat = veh.attached ? (veh.lat || 0) : (veh.q1.near ? veh.q1.l : 0);
      // 橫向右為正（與地面轉向一致）。steer 為正＝向右。
      let steer = veh.attached
        ? -lat * 0.55
        : -err * 0.85 - lat * 0.14;
      const airborne = !veh.attached && (veh.airTime > 0.12 || (veh.q1 && veh.q1.gap));
      if (airborne) steer = -err * 0.6;
      else if (!veh.attached && Math.abs(lat) > 4.5) steer = -lat * 0.28;
      steer = Math.max(-1, Math.min(1, steer));
      const st = sky.input.state;
      const target = st._target || 48;
      const spd = Math.max(veh.speed, Math.abs(veh.speedF || 0));
      const here = tr.kind ? tr.kind[tr.wrap(Math.floor(fi))] : 0;
      const soon = tr.kind ? tr.kind[tr.wrap(Math.floor(fi) + 10)] : 0;
      st.steer = steer;
      st.throttle = spd < target ? 1 : 0.35;
      st.brake = !veh.attached && spd > target + 12 ? 0.35 : 0;
      st.nitro = spd < target - 6 && target >= 42;
      st.lift = !!(veh.flipAssist || here === 4 || soon === 4);
      st.pitch = st.lift ? 0.65 : 0;
    };
    const orig = sky.input.poll.bind(sky.input);
    sky.input.poll = (dt) => { orig(dt); follow(); };
    const drives = [];
    for (const target of [32, 48, 64]) {
      sky.input.state._target = target;
      sky.game.respawns = 0;
      veh.placeOnTrack(tr.N - 12, 0, target * 0.45);
      let maxKmh = 0, progress = 0, prev = veh.fi, nan = false;
      const tEnd = target >= 64 ? 80 : target >= 48 ? 100 : 110;
      for (let t = 0; t < tEnd && progress < tr.N * 1.05; t += 5) {
        sky.sim(5);
        maxKmh = Math.max(maxKmh, veh.kmh);
        let d = veh.fi - prev;
        if (d < -tr.N / 2) d += tr.N;
        if (d > tr.N / 2) d -= tr.N;
        if (d > 0) progress += d;
        prev = veh.fi;
        if (!Number.isFinite(veh.pos.x) || !Number.isFinite(veh.kmh)) { nan = true; break; }
      }
      drives.push({ target, progress: Math.round(progress), need: Math.round(tr.N * 0.9), maxKmh: Math.round(maxKmh), respawns: sky.game.respawns || 0, fi: Math.round(veh.fi), nan, y: Math.round(veh.pos.y) });
    }
    sky.input.poll = orig;
    const fuzz = [];
    let seed = 11;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let trial = 0; trial < 28; trial++) {
      const i = Math.floor(rnd() * tr.N);
      const sp = rnd() * 75;
      veh.placeOnTrack(i, (rnd() * 2 - 1) * 7, sp);
      let maxKmh = 0, bad = '';
      const inp = { steer: rnd() * 2 - 1, throttle: 0.3 + rnd() * 0.7, brake: rnd() * 0.2, nitro: rnd() > 0.4, lift: rnd() > 0.75, pitch: rnd() * 2 - 1 };
      for (let n = 0; n < 120 * 3; n++) {
        if (n % 20 === 0) { inp.steer = rnd() * 2 - 1; inp.throttle = rnd(); inp.nitro = rnd() > 0.5; }
        veh.step(1 / 120, inp);
        if (veh.events.respawn) { veh.recoverToCheckpoint(); veh.events.respawn = false; veh.events.why = ''; }
        maxKmh = Math.max(maxKmh, veh.kmh);
        if (!Number.isFinite(veh.pos.x) || maxKmh > cap) { bad = 'speed ' + Math.round(maxKmh); break; }
      }
      if (bad) fuzz.push({ trial, i, sp: Math.round(sp), bad, y: Math.round(veh.pos.y) });
    }
    return { maxDy: +maxDy.toFixed(2), maxTurn: +maxTurn.toFixed(2), worst, cap: Math.round(cap), drives, fuzz, cps: (tr.checkpoints || []).length, arrows: !!(sky.world && sky.world.stuntArrows) };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!(report.maxDy < 4)) throw new Error('cliff ' + JSON.stringify(report));
  if (!(report.maxTurn < 0.75)) throw new Error('kink ' + JSON.stringify(report));
  if (report.cps < 4) throw new Error('checkpoints ' + JSON.stringify(report));
  if (!report.arrows) throw new Error('no guide arrows');
  for (const d of report.drives) {
    if (d.nan || d.maxKmh > report.cap) throw new Error('overspeed ' + JSON.stringify(d));
    if (d.progress < d.need) throw new Error('did not finish a lap ' + JSON.stringify(d));
    if (d.respawns > 8) throw new Error('too many respawns ' + JSON.stringify(d));
  }
  if (report.fuzz.length) throw new Error('fuzz ' + JSON.stringify(report.fuzz.slice(0, 6)));
}

async function testPadPage() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  const res = await page.goto(BASE + 'gamepad-test.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#status', { timeout: 10000 });
  const title = await page.title();
  if (!res.ok()) throw new Error('status ' + res.status());
  if (!title.includes('搖桿')) throw new Error('title ' + title);
  if (errors.length) throw new Error(errors.join('\n'));
  await page.close();
}

try {
  const tests = [
    ['loop physics', testLoop],
    ['keyboard touch', testKeys],
    ['two gamepads', testPads],
    ['tesla pad slots', testTeslaSlots],
    ['gamepad test page', testPadPage],
    ['ai lap', testAi],
    ['ai stunt loop', testAiStunt],
    ['stunt laps and fuzz', testStuntDrive],
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
