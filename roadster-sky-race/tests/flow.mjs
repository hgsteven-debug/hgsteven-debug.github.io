// 進場流程：一屏一件事，確認鍵一路開跑，返回鍵退回上一屏。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'fs';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const SHOTS = '/opt/cursor/artifacts/flow';
fs.mkdirSync(SHOTS, { recursive: true });

const fails = [];
const ok = (name) => console.log('PASS', name);
const bad = (name, err) => { console.error('FAIL', name, err && err.stack ? err.stack : err); fails.push(name); };

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function open(lang, extra = '') {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  await page.evaluateOnNewDocument((code) => {
    try {
      localStorage.setItem('skyroadster.lang', JSON.stringify(code));
      localStorage.removeItem('skyroadster.playmode');
    } catch (e) {}
  }, lang);
  const q = '?q=low&nonet=1&noadapt=1&nopauseblur=1&lang=' + encodeURIComponent(lang) + extra;
  await page.goto(BASE + q, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__sky && window.__sky.ui && window.__sky.ui.current === 'start', { timeout: 90000 });
  return { page, errors };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function shot(page, name) {
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: SHOTS + '/' + name + '.png' });
}

try {
  const { page, errors } = await open('zh-TW');
  const title = await page.evaluate(() => {
    const root = document.querySelector('#s-start.screen.show');
    const acts = [...root.querySelectorAll('.btn')].filter((b) => b.offsetParent).map((b) => b.dataset.act || b.dataset.lang || '');
    const focus = window.__sky.ui.focusEl;
    const start = root.querySelector('[data-act="flow-start"]');
    const box = start.getBoundingClientRect();
    return {
      acts,
      text: start.textContent,
      focus: focus && focus.dataset.act,
      w: box.width,
      h: box.height,
      gears: root.querySelectorAll('[data-act="settings"]').length,
      advanced: root.querySelector('[data-act="mapping"],[data-act="fullscreen"],[data-act="tracks"],[data-act="garage"],a[href^="gamepad-test"]'),
    };
  });
  assert(title.text === '開始', title.text);
  assert(title.focus === 'flow-start', title.focus);
  assert(title.h >= 64 && title.w >= 160, JSON.stringify(title));
  assert(title.acts.includes('zh-TW') && title.acts.includes('en') && title.acts.includes('settings'), title.acts.join(','));
  assert(!title.advanced, 'title still has an advanced action');
  assert(!title.acts.includes('mapping') && !title.acts.includes('tracks'), title.acts.join(','));
  await shot(page, 'zh-title');

  await page.click('#s-start [data-act="flow-start"]');
  await page.waitForFunction(() => window.__sky.ui.current === 'mode');
  const mode = await page.evaluate(() => {
    const focus = window.__sky.ui.focusEl;
    const back = document.querySelector('#s-mode [data-act="back"]');
    const solo = document.querySelector('#s-mode [data-mode="solo"]');
    return {
      focus: focus && focus.dataset.mode,
      primary: solo.classList.contains('primary'),
      back: back && back.getBoundingClientRect().height,
      text: solo.textContent,
    };
  });
  assert(mode.focus === 'solo' && mode.primary, JSON.stringify(mode));
  assert(mode.text === '單人', mode.text);
  assert(mode.back >= 48, String(mode.back));
  await shot(page, 'zh-mode');

  await page.click('#s-mode [data-mode="multi"]');
  await page.waitForFunction(() => window.__sky.ui.current === 'lobby');
  const lobby = await page.evaluate(() => ({
    qr: !!document.getElementById('phoneQr'),
    pads: !!document.getElementById('startPads'),
    status: (document.getElementById('phoneStatus') || {}).textContent || '',
    next: document.querySelector('#s-lobby [data-act="flow-next"]').textContent,
    focus: window.__sky.ui.focusEl && window.__sky.ui.focusEl.dataset.act,
    back: !!document.querySelector('#s-lobby [data-act="back"]'),
  }));
  assert(lobby.qr && lobby.pads && lobby.back, JSON.stringify(lobby));
  assert(lobby.next === '繼續', lobby.next);
  assert(lobby.focus === 'flow-next', lobby.focus);
  assert(lobby.status.includes('P3'), lobby.status);
  await shot(page, 'zh-lobby');

  await page.click('#s-lobby [data-act="flow-next"]');
  await page.waitForFunction(() => window.__sky.ui.current === 'garage');
  const garage = await page.evaluate(() => {
    const next = document.querySelector('#s-garage [data-act="flow-next"]');
    const box = next.getBoundingClientRect();
    return {
      focus: window.__sky.ui.focusEl && window.__sky.ui.focusEl.dataset.act,
      text: next.textContent,
      h: box.height,
      sel: !!document.querySelector('#vlist .btn.sel'),
      browseHidden: document.querySelector('#s-garage .when-browse').classList.contains('hidden'),
    };
  });
  assert(garage.focus === 'flow-next', JSON.stringify(garage));
  assert(garage.text === '下一步' && garage.h >= 64, JSON.stringify(garage));
  assert(garage.sel && garage.browseHidden, JSON.stringify(garage));
  await shot(page, 'zh-car');

  await page.click('#s-garage [data-act="flow-next"]');
  await page.waitForFunction(() => window.__sky.ui.current === 'tracks');
  const tracks = await page.evaluate(() => ({
    focus: window.__sky.ui.focusEl && window.__sky.ui.focusEl.dataset.act,
    ai: document.querySelector('#aiCount .btn.sel') && document.querySelector('#aiCount .btn.sel').dataset.ai,
    diff: document.querySelector('#aiDiff .btn.sel') && document.querySelector('#aiDiff .btn.sel').dataset.diff,
    track: document.querySelector('#tlist .btn.sel') && document.querySelector('#tlist .btn.sel').dataset.track,
  }));
  assert(tracks.focus === 'flow-next', JSON.stringify(tracks));
  assert(tracks.ai === '0' && tracks.diff === 'normal', JSON.stringify(tracks));
  assert(tracks.track === 'canyon', JSON.stringify(tracks));
  await shot(page, 'zh-track');

  await page.click('#s-tracks [data-act="flow-next"]');
  await page.waitForFunction(() => window.__sky.ui.current === 'ready');
  const ready = await page.evaluate(() => ({
    focus: window.__sky.ui.focusEl && window.__sky.ui.focusEl.dataset.act,
    go: document.querySelector('#s-ready [data-act="start"]').textContent,
    mode: document.getElementById('readyMode').textContent,
    ai: document.getElementById('readyAi').textContent,
    laps: document.querySelector('#s-ready [data-i18n="results.sub"]').textContent,
    car: document.getElementById('startCar').textContent,
    track: document.getElementById('startTrack').textContent,
  }));
  assert(ready.focus === 'start', JSON.stringify(ready));
  assert(ready.go === '開跑' && ready.mode === '多人', JSON.stringify(ready));
  assert(ready.ai === '沒有電腦對手' && ready.laps === '兩圈衝刺', JSON.stringify(ready));
  assert(ready.car.includes('目前車輛') && ready.track.includes('目前賽道'), JSON.stringify(ready));
  await shot(page, 'zh-ready');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sky.ui.current === 'tracks');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sky.ui.current === 'garage');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sky.ui.current === 'lobby');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sky.ui.current === 'mode');
  const remembered = await page.evaluate(() => window.__sky.ui.focusEl && window.__sky.ui.focusEl.dataset.mode);
  assert(remembered === 'multi', remembered);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sky.ui.current === 'start');

  const settings = await page.evaluate(() => {
    document.querySelector('#s-start [data-act="settings"]').click();
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        const root = document.getElementById('s-settings');
        resolve({
          current: window.__sky.ui.current,
          map: !!root.querySelector('[data-act="mapping"]'),
          full: !!root.querySelector('[data-act="fullscreen"]'),
          test: !!root.querySelector('a[href^="gamepad-test"]'),
          legend: !!root.querySelector('#legend'),
        });
      });
    });
  });
  assert(settings.current === 'settings' && settings.map && settings.full && settings.test && settings.legend, JSON.stringify(settings));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sky.ui.current === 'start');

  const join = await page.evaluate(() => {
    const root = document.getElementById('s-join');
    return {
      retry: !!root.querySelector('[data-act="join-retry"]'),
      leave: !!root.querySelector('[data-act="join-leave"]'),
      garage: !!root.querySelector('[data-act="garage"]'),
      flow: !!root.querySelector('[data-act="flow-start"],[data-act="flow-next"]'),
    };
  });
  assert(join.retry && join.leave && join.garage && !join.flow, JSON.stringify(join));
  assert(errors.length === 0, errors.join('\n'));
  ok('stages, back, and settings');
  await page.close();
} catch (e) { bad('stages, back, and settings', e); }

try {
  const { page, errors } = await open('zh-TW');
  const path = [];
  for (let i = 0; i < 5; i++) {
    const before = await page.evaluate(() => window.__sky.ui.current + '|' + window.__sky.game.state);
    path.push(before);
    await page.keyboard.press('Enter');
    await page.waitForFunction((prev) => (window.__sky.ui.current + '|' + window.__sky.game.state) !== prev, { timeout: 4000 }, before);
  }
  const end = await page.evaluate(() => ({ state: window.__sky.game.state, ui: window.__sky.ui.current, mode: localStorage.getItem('skyroadster.playmode') }));
  assert(path.join('>') === 'start|menu>mode|menu>garage|menu>tracks|menu>ready|menu', path.join('>'));
  assert(end.state === 'countdown' || end.state === 'race', JSON.stringify(end));
  assert(end.ui == null, JSON.stringify(end));
  assert(end.mode === JSON.stringify('solo'), end.mode);
  assert(errors.length === 0, errors.join('\n'));
  ok('enter reaches the race');
  await page.close();
} catch (e) { bad('enter reaches the race', e); }

try {
  const { page, errors } = await open('en');
  const text = await page.evaluate(() => document.querySelector('#s-start [data-act="flow-start"]').textContent);
  assert(text === 'Start', text);
  assert(documentLang(await page.evaluate(() => document.documentElement.lang)) === 'en');
  await shot(page, 'en-title');
  await page.click('#s-start [data-act="flow-start"]');
  await page.waitForFunction(() => window.__sky.ui.current === 'mode');
  const labels = await page.evaluate(() => ({
    solo: document.querySelector('[data-mode="solo"]').textContent,
    multi: document.querySelector('[data-mode="multi"]').textContent,
  }));
  assert(labels.solo === 'Solo' && labels.multi === 'Multi', JSON.stringify(labels));
  assert(errors.length === 0, errors.join('\n'));
  ok('english title');
  await page.close();
} catch (e) { bad('english title', e); }

function documentLang(lang) { return lang; }

try {
  const { page, errors } = await open('zh-TW', '&track=canyon');
  await page.evaluate(() => {
    document.querySelector('#s-start [data-act="flow-start"]').click();
  });
  await page.waitForFunction(() => window.__sky.ui.current === 'mode');
  await page.evaluate(() => document.querySelector('#s-mode [data-mode="solo"]').click());
  await page.waitForFunction(() => window.__sky.ui.current === 'garage');
  await page.evaluate(() => document.querySelector('#s-garage [data-act="flow-next"]').click());
  await page.waitForFunction(() => window.__sky.ui.current === 'tracks');
  await page.evaluate(() => document.querySelector('#tlist [data-track="coast"]').click());
  await page.waitForFunction(() => window.__sky && window.__sky.ui && window.__sky.ui.current === 'tracks' && window.__sky.ui.trackId === 'coast', { timeout: 90000 });
  const back = await page.evaluate(() => {
    const ui = window.__sky.ui;
    return { stack: ui.stack.slice(), wizard: ui.wizard, track: window.__sky.track.id };
  });
  assert(back.wizard && back.track === 'coast', JSON.stringify(back));
  assert(back.stack[back.stack.length - 1] === 'garage', JSON.stringify(back));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sky.ui.current === 'garage');
  assert(errors.length === 0, errors.join('\n'));
  ok('track change returns to the course stage');
  await page.close();
} catch (e) { bad('track change returns to the course stage', e); }

await browser.close();
if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
