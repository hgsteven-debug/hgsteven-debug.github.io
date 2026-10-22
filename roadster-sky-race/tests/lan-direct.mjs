// 同一個網路：Chromium 房主（車機 1920x1200）加 WebKit 手機，要在 2 秒內顯示直連，
// 車速不能在高速和將近 0 之間來回跳。
import { chromium, webkit } from '/tmp/pw/node_modules/playwright/index.mjs';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const fails = [];
const ok = (name, extra) => console.log('PASS', name, extra || '');
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };

const chromeArgs = [
  '--no-sandbox', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=WebRtcHideLocalIpsWithMdns',
];

async function boot(page, url) {
  const u = new URL(url, BASE);
  if (!u.searchParams.has('lang')) u.searchParams.set('lang', 'zh-TW');
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
}

async function run() {
  const hostBrowser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: chromeArgs });
  const phoneBrowser = await webkit.launch({ headless: true });
  try {
    const host = await hostBrowser.newPage({ viewport: { width: 1920, height: 1200 } });
    host.on('pageerror', (e) => console.log('HOSTERR', e.message));
    await boot(host, BASE + '?track=canyon&q=low&ai=0&noadapt=1&nopauseblur=1&nocount=1&debug=1');
    await host.waitForFunction(() => window.__sky.net.ready || window.__sky.net.failed, { timeout: 25000 });
    const ready = await host.evaluate(() => ({ ready: window.__sky.net.ready, fail: window.__sky.net.failMsg }));
    if (!ready.ready) throw new Error('host not ready ' + ready.fail);
    await host.evaluate(() => window.__sky.startGame());
    const meta = await host.evaluate(() => ({ url: window.__sky.net.url }));
    const phoneUrl = new URL(meta.url, BASE);
    phoneUrl.searchParams.set('track', 'canyon');
    phoneUrl.searchParams.set('noadapt', '1');
    phoneUrl.searchParams.set('nopauseblur', '1');
    phoneUrl.searchParams.set('debug', '1');
    phoneUrl.searchParams.set('q', 'low');
    const phone = await phoneBrowser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    phone.on('pageerror', (e) => console.log('PHONEERR', e.message));
    const t0 = Date.now();
    await boot(phone, phoneUrl.toString());
    const joinedAt = Date.now();
    let snap = {};
    const marks = {};
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      snap = await phone.evaluate(() => {
        const d = window.__sky.net.debug || {};
        const kind = document.getElementById('linkKind');
        const hint = document.getElementById('linkhint');
        const self = window.__sky.net.latest && window.__sky.net.latest.self;
        return {
          via: d.via || '',
          rtc: d.rtc,
          proven: d.proven,
          err: d.err || '',
          kind: kind ? kind.textContent : '',
          signal: d.signal || '',
          hintHidden: !hint || hint.classList.contains('hidden'),
          hint: hint ? hint.textContent : '',
          x: self && self.x,
          state: window.__sky.game.state,
        };
      });
      const now = Date.now() - joinedAt;
      if (!marks.signal && snap.signal && snap.signal !== 'boot') marks.signal = now;
      if (!marks.proven && snap.proven) marks.proven = now;
      if (!marks.via && snap.via === 'direct') marks.via = now;
      if (!marks.kind && snap.kind.indexOf('直連') >= 0) marks.kind = now;
      if (!marks.x && Number.isFinite(snap.x)) marks.x = now;
      if (snap.via === 'direct' && snap.kind.indexOf('直連') >= 0 && Number.isFinite(snap.x)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const ms = marks.kind || marks.via || (Date.now() - joinedAt);
    console.log('MARKS', JSON.stringify(marks));
    console.log('JOIN', JSON.stringify(Object.assign({ ms, boot: joinedAt - t0 }, snap)));
    if (snap.via !== 'direct' || snap.kind.indexOf('直連') < 0) throw new Error('not direct ' + JSON.stringify(snap));
    if (ms > 2000) throw new Error('direct took ' + ms + 'ms');
    if (!snap.hintHidden) throw new Error('isolation hint shown ' + snap.hint);
    if (snap.kind.indexOf('重新連線') >= 0) throw new Error('stuck rejoin ' + snap.kind);

    const speeds = [];
    const drive = host.evaluate(async () => {
      const sky = window.__sky;
      const r = sky.race.racers.find((x) => x.driver && x.driver.kind === 'remote' && !x.parked);
      if (!r) return { ok: false };
      r.veh.placeOnTrack(80, 0, 0);
      const t0 = performance.now();
      while (performance.now() - t0 < 2200) {
        sky.sim(1 / 60);
        const h = r.veh.heading;
        r.veh.vel.set(-Math.sin(h) * 22, 0, -Math.cos(h) * 22);
        r.veh.speed = 22;
        sky.net.flushState();
        await new Promise((res) => setTimeout(res, 16));
      }
      return { ok: true, kmh: Math.round(r.veh.kmh), x: +r.veh.pos.x.toFixed(1) };
    });
    const watch = (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 2000) {
        const kmh = await phone.evaluate(() => {
          const el = document.getElementById('speed');
          const n = el ? parseInt(el.textContent, 10) : NaN;
          const kind = (document.getElementById('linkKind') || {}).textContent || '';
          return { kmh: n, kind };
        });
        speeds.push(kmh);
        await new Promise((r) => setTimeout(r, 80));
      }
    })();
    const drove = await drive;
    await watch;
    const nums = speeds.map((s) => s.kmh).filter((n) => Number.isFinite(n));
    const hot = [];
    let seenFast = false;
    for (const n of nums) {
      if (n > 25) seenFast = true;
      if (seenFast) hot.push(n);
    }
    const kinds = speeds.map((s) => s.kind);
    console.log('MOTION', JSON.stringify({ drove, hot, kinds: kinds.slice(-3) }));
    if (!drove.ok || drove.kmh < 30) throw new Error('host car did not get moving ' + JSON.stringify(drove));
    if (hot.length < 4) throw new Error('phone did not show the moving car ' + JSON.stringify(nums));
    if (hot.some((n) => n < 15)) throw new Error('speed dipped near zero ' + JSON.stringify(hot));
    if (kinds.some((k) => k && k.indexOf('重新連線') >= 0)) throw new Error('rejoin during drive ' + kinds.join('|'));
    ok('webkit direct', ms + 'ms min ' + Math.min(...nums) + ' max ' + Math.max(...nums));
  } finally {
    await phoneBrowser.close();
    await hostBrowser.close();
  }
}

run().then(() => {
  if (fails.length) process.exit(1);
}).catch((e) => {
  bad('webkit direct', e);
  process.exit(1);
});
