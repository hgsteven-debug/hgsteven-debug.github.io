// 手機用 WebKit（Safari JSON）加入開著道具戰的車機，直連後要看得到飛行物，使用鍵要送到房主。
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
    await boot(host, BASE + '?track=canyon&q=low&ai=0&noadapt=1&nopauseblur=1&nocount=1&debug=1&items=1');
    await host.waitForFunction(() => window.__sky.net.ready || window.__sky.net.failed, { timeout: 25000 });
    const ready = await host.evaluate(() => ({ ready: window.__sky.net.ready, fail: window.__sky.net.failMsg, items: window.__sky.itemsOn() }));
    if (!ready.ready) throw new Error('host not ready ' + ready.fail);
    if (!ready.items) throw new Error('items off on host');
    await host.evaluate(() => window.__sky.startGame());
    const meta = await host.evaluate(() => ({ url: window.__sky.net.url }));
    const phoneUrl = new URL(meta.url, BASE);
    phoneUrl.searchParams.set('track', 'canyon');
    phoneUrl.searchParams.set('noadapt', '1');
    phoneUrl.searchParams.set('nopauseblur', '1');
    phoneUrl.searchParams.set('debug', '1');
    phoneUrl.searchParams.set('q', 'low');
    phoneUrl.searchParams.set('items', '1');
    const phone = await phoneBrowser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    phone.on('pageerror', (e) => console.log('PHONEERR', e.message));
    const t0 = Date.now();
    await boot(phone, phoneUrl.toString());
    const joinedAt = Date.now();
    let snap = {};
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      snap = await phone.evaluate(() => {
        const d = window.__sky.net.debug || {};
        const kind = document.getElementById('linkKind');
        const latest = window.__sky.net.latest;
        return {
          via: d.via || '',
          kind: kind ? kind.textContent : '',
          battle: !!(latest && latest.battle && latest.battle.on),
          boxes: latest && latest.battle && latest.battle.boxes ? latest.battle.boxes.length : 0,
          x: latest && latest.self ? latest.self.x : null,
        };
      });
      if (snap.via === 'direct' && snap.kind.indexOf('直連') >= 0 && snap.battle) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const ms = Date.now() - joinedAt;
    console.log('JOIN', JSON.stringify(Object.assign({ ms, boot: joinedAt - t0 }, snap)));
    if (snap.via !== 'direct' || snap.kind.indexOf('直連') < 0) throw new Error('not direct ' + JSON.stringify(snap));
    if (ms > 2000) throw new Error('direct took ' + ms + 'ms');
    if (!snap.battle || snap.boxes < 1) throw new Error('phone missed item state ' + JSON.stringify(snap));

    const shot = await host.evaluate(() => {
      const sky = window.__sky;
      const me = sky.race.racers.find((r) => r.primary);
      me.veh.item = 1;
      sky.battle.use(me);
      sky.battle.step(1 / 60, sky.race.racers);
      sky.net.flushState();
      const s = sky.battle.view().shots[0];
      return s ? { kind: s.kind, n: sky.battle.view().shots.length } : null;
    });
    if (!shot || shot.kind !== 1) throw new Error('host did not fire ' + JSON.stringify(shot));
    await phone.waitForFunction(() => {
      const b = window.__sky.net.latest && window.__sky.net.latest.battle;
      return !!(b && b.shots && b.shots.some((s) => s.kind === 1));
    }, { timeout: 4000 });

    await phone.evaluate(() => {
      const sky = window.__sky;
      const btn = document.querySelector('.gpad.item');
      if (btn) btn.classList.add('on');
      sky.input.touch.item = true;
      sky.input.poll(1 / 60);
      for (let i = 0; i < 4; i++) sky.net.flushInput();
    });
    await host.waitForFunction(() => {
      const r = window.__sky.race.racers.find((x) => x.driver && x.driver.kind === 'remote');
      return !!(r && r.driver.state.item);
    }, { timeout: 4000 });
    ok('webkit item direct', ms + 'ms boxes ' + snap.boxes);
  } finally {
    await phoneBrowser.close();
    await hostBrowser.close();
  }
}

run().then(() => {
  if (fails.length) process.exit(1);
}).catch((e) => {
  bad('webkit item direct', e);
  process.exit(1);
});
