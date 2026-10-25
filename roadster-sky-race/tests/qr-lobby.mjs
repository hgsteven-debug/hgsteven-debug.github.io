// 大廳 QR 必須用加入網址在本機畫出來，不能等掃碼伺服器或網頁中繼。
import puppeteer from '/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const BASE = process.env.SKY_BASE || 'http://127.0.0.1:8137/';
const OUT = '/opt/cursor/artifacts/lobby-qr.png';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const page = await browser.newPage();
await page.setCacheEnabled(false);
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE', e.message));
// 掃碼伺服器與網頁中繼的連線都不成立，QR 仍須用本機加入網址畫出來。
await page.evaluateOnNewDocument(() => {
  function DeadSocket() {
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.extensions = '';
    this.protocol = '';
    this.binaryType = 'blob';
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }
  DeadSocket.prototype.send = function () {};
  DeadSocket.prototype.close = function () {
    this.readyState = 3;
    if (typeof this.onclose === 'function') this.onclose({ code: 1006, reason: '', wasClean: false });
  };
  DeadSocket.prototype.addEventListener = function (type, fn) { this['on' + type] = fn; };
  DeadSocket.prototype.removeEventListener = function () {};
  DeadSocket.CONNECTING = 0;
  DeadSocket.OPEN = 1;
  DeadSocket.CLOSING = 2;
  DeadSocket.CLOSED = 3;
  window.WebSocket = DeadSocket;
});
await page.goto(BASE + '?q=low&noadapt=1&nopauseblur=1&lang=zh-TW', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__sky && window.__sky.ui && window.__sky.ui.current === 'start', { timeout: 90000 });
await page.evaluate(() => {
  const sky = window.__sky;
  sky.ui.wizard = true;
  sky.ui.show('lobby', true);
});
await page.waitForFunction(() => {
  const c = document.getElementById('phoneQr');
  const code = (document.getElementById('phoneCode') || {}).textContent || '';
  if (!c || c.classList.contains('hidden') || code === '——' || !code.trim()) return false;
  const ctx = c.getContext('2d');
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 16) if (data[i] < 48 && data[i + 1] < 48 && data[i + 2] < 48) dark++;
  return dark > 30;
}, { timeout: 8000 });

const info = await page.evaluate(() => {
  const c = document.getElementById('phoneQr');
  const card = document.querySelector('#s-lobby .card');
  const cr = card.getBoundingClientRect();
  const qr = c.getBoundingClientRect();
  const ctx = c.getContext('2d');
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 16) if (data[i] < 48) dark++;
  const url = (document.getElementById('phoneUrl') || {}).textContent || '';
  const code = (document.getElementById('phoneCode') || {}).textContent || '';
  return {
    status: (document.getElementById('phoneStatus') || {}).textContent || '',
    code, url, dark,
    hidden: c.classList.contains('hidden'),
    w: Math.round(qr.width), h: Math.round(qr.height),
    inCard: qr.top >= cr.top - 2 && qr.bottom <= cr.bottom + 2 && qr.left >= cr.left - 2 && qr.right <= cr.right + 2 && qr.width > 80,
    ready: !!(window.__sky.net && window.__sky.net.ready),
  };
});
console.log('LOBBY', JSON.stringify(info));
assert(!info.hidden && info.dark > 30, 'qr pixels ' + JSON.stringify(info));
assert(info.url.includes('join='), 'join url ' + info.url);
assert(info.code && info.code !== '——', 'room code ' + info.code);
assert(info.inCard, 'qr inside the lobby card ' + JSON.stringify(info));
assert(info.ready === false, 'qr must not wait for the join server ' + JSON.stringify(info));
await page.screenshot({ path: OUT });
await browser.close();
console.log('PASS lobby qr');
