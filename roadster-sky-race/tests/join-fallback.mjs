// 同一台機器上的兩頁：直連、關掉 mDNS、強制 TURN、以及沒有 WebRTC 時改走中繼。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const fails = [];
const ok = (name, extra) => console.log('PASS', name, extra || '');
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };

function launch(mdns) {
  const args = [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ];
  if (!mdns) args.push('--disable-features=WebRtcHideLocalIpsWithMdns');
  return puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args,
  });
}

async function open(browser, url, before) {
  const page = await browser.newPage();
  if (before) await page.evaluateOnNewDocument(before);
  const u = new URL(url, BASE);
  if (!u.searchParams.has('lang')) u.searchParams.set('lang', 'zh-TW');
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.track && window.__sky.game.state !== 'loading', { timeout: 90000 });
  return page;
}

async function joinOnce(browser, label, hostQuery) {
  const t0 = Date.now();
  const host = await open(browser, BASE + '?track=city&q=low&ai=0&noadapt=1&nopauseblur=1&nocount=1&debug=1' + hostQuery);
  let signal = 'timeout';
  try {
    await host.waitForFunction(() => window.__sky.net.ready || window.__sky.net.failed, { timeout: 22000 });
    signal = await host.evaluate(() => window.__sky.net.ready ? 'ready' : 'fail');
  } catch (e) { signal = 'timeout'; }
  if (signal !== 'ready') {
    await host.close();
    return { skip: signal };
  }
  const meta = await host.evaluate(() => ({ url: window.__sky.net.url, code: window.__sky.net.code }));
  const phoneUrl = new URL(meta.url);
  phoneUrl.searchParams.set('track', 'city');
  phoneUrl.searchParams.set('noadapt', '1');
  phoneUrl.searchParams.set('nopauseblur', '1');
  phoneUrl.searchParams.set('debug', '1');
  if (hostQuery.includes('forceTurn=1')) phoneUrl.searchParams.set('forceTurn', '1');
  const phone = await open(browser, phoneUrl.toString(), hostQuery.includes('blockrtc=1') ? () => {
    window.RTCPeerConnection = function () { throw new Error('blocked'); };
  } : null);
  const start = Date.now();
  let last = {};
  let linked = false;
  while (Date.now() - start < 20000) {
    last = await phone.evaluate(() => {
      const d = window.__sky.net.debug || {};
      return {
        connected: window.__sky.net.connected,
        via: d.via || d.pair || '',
        stage: d.stage || '',
        pair: d.pair || '',
        fail: window.__sky.net.failMsg || '',
      };
    });
    const hostN = await host.evaluate(() => window.__sky.net.remotes);
    if (last.connected && hostN > 0) { linked = true; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  const ms = Date.now() - start;
  await phone.close();
  await host.close();
  return { skip: '', linked, ms, via: last.via, stage: last.stage, pair: last.pair, fail: last.fail, boot: Date.now() - t0, label };
}

const cases = [
  ['mdns-off direct', false, ''],
  ['mdns-on direct', true, ''],
  ['forceTurn', false, '&forceTurn=1'],
  ['webrtc-blocked', false, '&blockrtc=1'],
];

for (const [name, mdns, q] of cases) {
  const browser = await launch(mdns);
  try {
    const r = await joinOnce(browser, name, q);
    if (r.skip) {
      console.log('SKIP', name, r.skip);
      continue;
    }
    if (!r.linked) throw new Error('no path ' + JSON.stringify(r));
    const via = r.via || r.pair || r.stage;
    if (name === 'webrtc-blocked' && via !== 'ws' && r.stage !== 'mqtt') throw new Error('expected relay ' + JSON.stringify(r));
    if (name === 'forceTurn' && via === 'direct') throw new Error('forceTurn stayed direct ' + JSON.stringify(r));
    if (r.ms > 12000) throw new Error('slow ' + JSON.stringify(r));
    ok(name, via + ' ' + r.ms + 'ms stage=' + r.stage);
  } catch (e) {
    bad(name, e);
  } finally {
    await browser.close();
  }
}

if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
