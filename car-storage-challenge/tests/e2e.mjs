import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    return require("/tmp/pw/node_modules/playwright/index.js");
  }
}
const { chromium } = loadPlaywright();
import { LEVELS } from "../js/levels.js";
import { anchorFromHover, canPlace, hoverFromAnchor, sameShape } from "../js/puzzle.js";
import { solveLevel } from "./solve.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SHOTS = "/opt/cursor/artifacts/screenshots";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function snapshot(page) {
  return page.evaluate(() => window.__GAME.snapshot());
}

async function touchSession(page) {
  return page.context().newCDPSession(page);
}

async function touchTap(session, x, y) {
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: Math.round(x), y: Math.round(y), id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function touchDrag(session, from, to) {
  const steps = 18;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: Math.round(from.x), y: Math.round(from.y), id: 1 }],
  });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: Math.round(x), y: Math.round(y), id: 1 }],
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function tapSelector(page, session, selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, selector);
  await touchTap(session, box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(320);
}

function pitch(snap, compId) {
  const cells = snap.cells.filter((cell) => cell.compId === compId);
  const a = cells.find((cell) => cell.col === 0 && cell.row === 0);
  const b = cells.find((cell) => cell.col === 1 && cell.row === 0)
    || cells.find((cell) => cell.col === 0 && cell.row === 1);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function occupiedSet(snap) {
  return new Set(snap.cells.filter((cell) => cell.occupied).map((cell) => `${cell.compId}:${cell.col},${cell.row}`));
}

function findInvalidCell(level, snap, shape) {
  for (const cell of snap.cells) {
    const comp = level.compartments.find((item) => item.id === cell.compId);
    const anchor = anchorFromHover(shape, cell.col, cell.row);
    if (!canPlace(comp, shape, anchor.col, anchor.row, occupiedSet(snap))) return cell;
  }
  return null;
}

async function boot(page, server, query) {
  const port = server.address().port;
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto(`http://127.0.0.1:${port}/car-storage-challenge/${query}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAME && window.__GAME.snapshot().ready);
  return errors;
}

async function enterLevel(page, session) {
  await tapSelector(page, session, "#btn-start");
  await page.waitForSelector("#screen-howto");
  await tapSelector(page, session, "#btn-play");
  await page.waitForSelector(".tray-item");
}

async function placeSolution(page, session, level, onPiece) {
  const solved = solveLevel(level);
  assert.equal(solved.ok, true);
  for (let index = 0; index < solved.placement.length; index++) {
    let snap = await snapshot(page);
    if (snap.screen !== "play") throw new Error(`left play at piece ${index}: ${snap.screen} ${snap.overReason}`);
    if (snap.tray.length === 0) {
      await page.evaluate(() => window.__GAME.spawnNow());
      await page.waitForFunction(() => window.__GAME.snapshot().tray.length > 0 || window.__GAME.snapshot().screen !== "play");
      snap = await snapshot(page);
    }
    if (onPiece) await onPiece(index, snap);
    const target = solved.placement[index];
    let item = snap.tray[0];
    assert.equal(item.defId, level.spawns[index]);
    for (let turn = 0; turn < 4 && !sameShape(item.shape, target.shape); turn++) {
      await tapSelector(page, session, "#btn-rotate");
      snap = await snapshot(page);
      item = snap.tray.find((entry) => entry.uid === item.uid);
    }
    assert.equal(sameShape(item.shape, target.shape), true, item.defId);
    const hover = hoverFromAnchor(target.shape, target.col, target.row);
    const cell = snap.cells.find((entry) => (
      entry.compId === target.compId && entry.col === hover.col && entry.row === hover.row
    ));
    assert.ok(cell, `${item.defId} hover ${hover.col},${hover.row}`);
    const box = await page.locator(`.tray-item[data-uid="${item.uid}"]`).boundingBox();
    await touchDrag(session, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, cell);
    await page.waitForFunction((uid) => !window.__GAME.snapshot().tray.some((entry) => entry.uid === uid), item.uid);
  }
  await page.waitForSelector("#screen-clear");
}

async function runViewport(browser, server, viewport, { shots }) {
  const context = await browser.newContext({
    viewport,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const errors = await boot(page, server, "?nosw=1");
  const session = await touchSession(page);
  if (shots) await page.screenshot({ path: path.join(SHOTS, "title.png") });

  const title = await snapshot(page);
  assert.equal(title.screen, "title");
  assert.equal(title.mode, "webgl");
  assert.ok(title.dpr >= 1 && title.dpr <= 1.5);

  await enterLevel(page, session);
  const playing = await snapshot(page);
  assert.equal(playing.screen, "play");
  assert.equal(playing.level, 1);
  assert.ok(playing.tray.length === 1);
  const cell = pitch(playing, "console");
  assert.ok(cell >= 64, `cell pitch ${cell.toFixed(1)} at ${viewport.width}x${viewport.height}`);
  const rotateBox = await page.locator("#btn-rotate").boundingBox();
  const soundBox = await page.locator("#btn-sound").boundingBox();
  assert.ok(rotateBox.height >= 64 && rotateBox.width >= 64);
  assert.ok(soundBox.height >= 64 && soundBox.width >= 64);

  const before = playing.timeLeft;
  await page.waitForTimeout(350);
  const after = await snapshot(page);
  assert.ok(after.timeLeft < before, "timer should count down");
  await page.evaluate(() => window.__GAME.pauseClock(true));

  const shapeBefore = after.tray[0].shape.map((pair) => pair.join(",")).join("|");
  await tapSelector(page, session, "#btn-rotate");
  const rotated = await snapshot(page);
  assert.equal(rotated.tray[0].rotation, 1);
  assert.notEqual(rotated.tray[0].shape.map((pair) => pair.join(",")).join("|"), shapeBefore);

  const invalid = findInvalidCell(LEVELS[0], rotated, rotated.tray[0].shape);
  assert.ok(invalid, "expected an invalid cell");
  const card = await page.locator(`.tray-item[data-uid="${rotated.tray[0].uid}"]`).boundingBox();
  await touchDrag(
    session,
    { x: card.x + card.width / 2, y: card.y + card.height / 2 },
    { x: invalid.x, y: invalid.y },
  );
  await page.waitForTimeout(80);
  let mid = await snapshot(page);
  assert.ok(mid.tray.some((item) => item.uid === rotated.tray[0].uid), "invalid drop should return the item");

  const outside = await page.locator("#hud-time").boundingBox();
  const cardAgain = await page.locator(`.tray-item[data-uid="${rotated.tray[0].uid}"]`).boundingBox();
  await touchDrag(
    session,
    { x: cardAgain.x + cardAgain.width / 2, y: cardAgain.y + cardAgain.height / 2 },
    { x: outside.x + 10, y: outside.y + 10 },
  );
  await page.waitForTimeout(80);
  mid = await snapshot(page);
  assert.equal(mid.screen, "play");
  assert.ok(mid.tray.some((item) => item.uid === rotated.tray[0].uid));

  await placeSolution(page, session, LEVELS[0], async (index) => {
    if (shots && index === 2) await page.screenshot({ path: path.join(SHOTS, "gameplay.png") });
  });
  const cleared = await snapshot(page);
  assert.equal(cleared.screen, "clear");
  assert.ok(cleared.score > 0);
  assert.equal(await page.locator("#promo-code").textContent(), "JOWUA-DEMO");
  assert.equal(await page.locator("#promo-label").textContent(), "示範用、非正式優惠");
  if (shots) await page.screenshot({ path: path.join(SHOTS, "level-clear.png") });

  await page.evaluate(() => {
    window.__shared = null;
    navigator.share = async (data) => {
      window.__shared = data;
    };
  });
  await tapSelector(page, session, "#btn-share");
  await page.waitForFunction(() => document.body.dataset.shareResult === "shared");
  const shared = await page.evaluate(() => window.__shared);
  assert.ok(shared.text.includes("JOWUA-DEMO"));
  assert.ok(shared.text.includes(String(cleared.score)));

  await context.close();

  const overContext = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 1 });
  await overContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  const overPage = await overContext.newPage();
  await boot(overPage, server, "?nosw=1");
  const overSession = await touchSession(overPage);
  await enterLevel(overPage, overSession);
  await overPage.evaluate(() => window.__GAME.pauseClock(true));
  for (let i = 0; i < 8; i++) {
    const state = await snapshot(overPage);
    if (state.screen === "over") break;
    await overPage.evaluate(() => window.__GAME.spawnNow());
  }
  const over = await snapshot(overPage);
  assert.equal(over.screen, "over");
  assert.equal(over.overReason, "tray");
  assert.equal(await overPage.locator("#promo-code").textContent(), "JOWUA-DEMO");
  assert.equal(await overPage.locator("#promo-label").textContent(), "示範用、非正式優惠");

  await overPage.evaluate(() => {
    navigator.share = async () => {
      throw new Error("share failed");
    };
  });
  await tapSelector(overPage, overSession, "#btn-share");
  await overPage.waitForFunction(() => document.body.dataset.shareResult === "copied" || document.body.dataset.shareResult === "manual");
  const result = await overPage.evaluate(() => document.body.dataset.shareResult);
  if (result === "copied") {
    const text = await overPage.evaluate(() => navigator.clipboard.readText());
    assert.ok(text.includes("JOWUA-DEMO"));
  } else {
    const manual = await overPage.locator("#manual-copy").inputValue();
    assert.ok(manual.includes("JOWUA-DEMO"));
  }
  await overContext.close();

  const timeContext = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 1 });
  const timePage = await timeContext.newPage();
  await boot(timePage, server, "?nosw=1");
  const timeSession = await touchSession(timePage);
  await enterLevel(timePage, timeSession);
  await timePage.evaluate(() => window.__GAME.expireTimer());
  const timed = await snapshot(timePage);
  assert.equal(timed.screen, "over");
  assert.equal(timed.overReason, "time");
  assert.equal(await timePage.locator("#promo-code").textContent(), "JOWUA-DEMO");
  await timeContext.close();

  const realErrors = errors.filter((line) => !line.includes("graphics degraded") && !line.includes("KTX2"));
  assert.deepEqual(realErrors, [], realErrors.join("\n"));
}

async function runOffline(browser, server) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  const port = server.address().port;
  await page.goto(`http://127.0.0.1:${port}/car-storage-challenge/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAME && window.__GAME.snapshot().ready);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAME && window.__GAME.snapshot().ready);
  const urls = await page.evaluate(async () => {
    const names = await caches.keys();
    const found = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) found.push(request.url);
    }
    return found;
  });
  assert.ok(urls.some((url) => url.includes("three.module.min.js")), urls.join("\n"));
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GAME && window.__GAME.snapshot().ready);
  const offline = await snapshot(page);
  assert.equal(offline.screen, "title");
  assert.equal(await page.locator("#btn-start").textContent(), "開始");
  await context.close();
}

const server = await startServer();
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});

try {
  fs.mkdirSync(SHOTS, { recursive: true });
  await runViewport(browser, server, { width: 1920, height: 1200 }, { shots: true });
  await runViewport(browser, server, { width: 1280, height: 800 }, { shots: false });
  await runOffline(browser, server);
  console.log("e2e ok");
} finally {
  await browser.close();
  server.close();
}
