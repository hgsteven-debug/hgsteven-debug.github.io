import { LEVELS, ITEMS } from "./levels.js";
import {
  anchorFromHover,
  canPlace,
  cellKey,
  cloneShape,
  coveredCells,
  filledCount,
  isTidy,
  playableCount,
  rotateShape,
} from "./puzzle.js";

export class Game {
  constructor({ view, ui, audio, i18n }) {
    this.view = view;
    this.ui = ui;
    this.audio = audio;
    this.i18n = i18n;
    this.uid = 0;
    this.screen = "title";
    this.levelIndex = 0;
    this.level = LEVELS[0];
    this.score = 0;
    this.levelScore = 0;
    this.breakdown = { place: 0, tidy: 0, full: 0, time: 0 };
    this.timeLeft = 0;
    this.spawnAcc = 0;
    this.queue = [];
    this.tray = [];
    this.placed = [];
    this.occupied = new Set();
    this.fullAwarded = new Set();
    this.selected = null;
    this.ghost = null;
    this.pointer = null;
    this.trayDirty = false;
    this.overReason = null;
    this.shareResult = null;
    this.totalItems = 0;
    this.placedCount = 0;
    this.lastAction = 0;
    this.lastTick = 0;
    this.bound = false;
    this.clockPaused = false;
  }

  start() {
    if (!this.bound) {
      this.bind();
      this.bound = true;
      this.lastTick = performance.now();
      setInterval(() => this.tick(), 100);
    }
    this.ui.setSound(this.audio.enabled, this.i18n);
    this.showTitle();
  }

  showTitle() {
    this.screen = "title";
    this.levelIndex = 0;
    this.level = LEVELS[0];
    this.pointer = null;
    this.ghost = null;
    this.view.setLevel(this.level, ITEMS);
    this.view.setState({ placed: [], ghost: null });
    this.ui.setScreen("title");
    this.ui.showTitle(this.i18n);
    this.ui.renderHud(null, this.i18n);
    this.ui.setLabels([]);
    this.ui.hideFinger();
    this.ui.setSound(this.audio.enabled, this.i18n);
  }

  showHowto() {
    this.screen = "howto";
    this.ui.setScreen("howto");
    this.ui.showHowto(this.i18n);
    this.ui.setLabels([]);
  }

  beginLevel(index, resetScore) {
    if (resetScore) this.score = 0;
    this.levelIndex = index;
    this.level = LEVELS[index];
    this.queue = this.level.spawns.slice();
    this.tray = [];
    this.placed = [];
    this.occupied = new Set();
    this.fullAwarded = new Set();
    this.selected = null;
    this.ghost = null;
    this.pointer = null;
    this.trayDirty = false;
    this.timeLeft = this.level.time;
    this.spawnAcc = 0;
    this.levelScore = 0;
    this.breakdown = { place: 0, tidy: 0, full: 0, time: 0 };
    this.overReason = null;
    this.shareResult = null;
    this.totalItems = this.level.spawns.length;
    this.placedCount = 0;
    this.lastTick = performance.now();
    this.screen = "play";
    document.body.dataset.shareResult = "";
    this.view.setLevel(this.level, ITEMS);
    this.ui.setScreen("play");
    this.ui.showPlay();
    this.ui.hideFinger();
    this.spawnOne();
    this.updateLabels();
  }

  spawnOne() {
    if (this.screen !== "play") return false;
    if (!this.queue.length) return false;
    if (this.tray.length >= this.level.trayLimit) {
      this.gameOver("tray");
      return false;
    }
    const defId = this.queue.shift();
    const def = ITEMS[defId];
    if (!def) return false;
    const item = {
      uid: ++this.uid,
      defId,
      rotation: 0,
      shape: cloneShape(def.shape),
    };
    this.tray.push(item);
    if (this.selected == null) this.selected = item.uid;
    this.audio.play("spawn");
    this.sync();
    return true;
  }

  tick() {
    if (this.screen !== "play") return;
    if (this.clockPaused) {
      this.lastTick = performance.now();
      return;
    }
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.gameOver("time");
      return;
    }
    this.spawnAcc += dt;
    while (this.spawnAcc >= this.level.spawnEvery && this.queue.length) {
      this.spawnAcc -= this.level.spawnEvery;
      if (!this.spawnOne()) return;
    }
    this.ui.renderHud(this.hudModel(), this.i18n);
  }

  commitPlace(uid) {
    const item = this.tray.find((entry) => entry.uid === uid);
    const ghost = this.ghost;
    if (!item || !ghost?.valid || this.screen !== "play") return;
    const comp = this.level.compartments.find((entry) => entry.id === ghost.compId);
    const before = new Set(this.occupied);
    for (const [col, row] of coveredCells(item.shape, ghost.col, ghost.row)) {
      this.occupied.add(cellKey(comp.id, col, row));
    }
    this.placed.push({
      uid: item.uid,
      defId: item.defId,
      compId: comp.id,
      col: ghost.col,
      row: ghost.row,
      shape: cloneShape(item.shape),
    });
    this.tray = this.tray.filter((entry) => entry.uid !== uid);
    this.placedCount += 1;
    const def = ITEMS[item.defId];
    let gained = def.points;
    this.breakdown.place += def.points;
    if (isTidy(comp, item.shape, ghost.col, ghost.row, before)) {
      gained += this.level.tidyBonus;
      this.breakdown.tidy += this.level.tidyBonus;
    }
    if (!this.fullAwarded.has(comp.id) && filledCount(comp, this.occupied) === playableCount(comp)) {
      this.fullAwarded.add(comp.id);
      gained += this.level.fullBonus;
      this.breakdown.full += this.level.fullBonus;
    }
    this.score += gained;
    this.levelScore += gained;
    this.selected = this.tray[0]?.uid ?? null;
    this.ghost = null;
    this.audio.play("place");
    this.ui.toast(this.i18n.t("toast.gain", { n: gained }));
    if (!this.queue.length && !this.tray.length) this.levelClear();
    else this.sync();
  }

  rotateSelected() {
    const item = this.tray.find((entry) => entry.uid === this.selected);
    if (!item || this.screen !== "play") return;
    item.rotation = (item.rotation + 1) % 4;
    item.shape = rotateShape(item.shape);
    this.audio.play("rotate");
    this.ghost = null;
    this.sync();
  }

  levelClear() {
    if (this.screen !== "play") return;
    const bonus = Math.max(0, Math.ceil(this.timeLeft)) * this.level.timeBonusPerSec;
    this.breakdown.time = bonus;
    this.score += bonus;
    this.levelScore += bonus;
    this.screen = "clear";
    this.pointer = null;
    this.ghost = null;
    this.audio.play("clear");
    this.ui.hideFinger();
    this.syncView();
    this.ui.setScreen("clear");
    this.ui.showClear(this.resultModel(), this.i18n);
  }

  gameOver(reason) {
    if (this.screen !== "play") return;
    this.screen = "over";
    this.overReason = reason;
    this.pointer = null;
    this.ghost = null;
    this.audio.play("over");
    this.ui.hideFinger();
    this.syncView();
    this.ui.setScreen("over");
    this.ui.showOver({ ...this.resultModel(), reason }, this.i18n);
  }

  async share() {
    const text = this.i18n.t("share.body", { score: this.score });
    const title = this.i18n.t("share.title");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text });
        this.markShare("shared");
        return;
      } catch (err) {
        if (err && err.name === "AbortError") {
          this.markShare("aborted");
          return;
        }
      }
    }
    const copied = await copyText(text);
    if (copied) {
      this.ui.toast(this.i18n.t("share.copied"));
      this.markShare("copied");
      return;
    }
    this.ui.showManualCopy(text, this.i18n);
    this.markShare("manual");
  }

  markShare(result) {
    this.shareResult = result;
    document.body.dataset.shareResult = result;
  }

  sync() {
    this.syncView();
    if (this.pointer) this.trayDirty = true;
    else this.ui.renderTray(this.trayModel());
    this.ui.renderHud(this.hudModel(), this.i18n);
  }

  syncView() {
    this.view.setState({
      placed: this.placed,
      ghost: this.ghost,
    });
  }

  updateLabels() {
    if (this.screen !== "play") {
      this.ui.setLabels([]);
      return;
    }
    const cells = this.view.projectCells();
    const labels = [];
    const rect = this.ui.canvas.getBoundingClientRect();
    for (const comp of this.level.compartments) {
      const group = cells.filter((cell) => cell.compId === comp.id);
      if (!group.length) continue;
      const x = group.reduce((sum, cell) => sum + cell.x, 0) / group.length - rect.left;
      const y = Math.min(...group.map((cell) => cell.y)) - rect.top;
      labels.push({ id: comp.id, text: this.i18n.t(comp.nameKey), x, y });
    }
    this.ui.setLabels(labels);
  }

  hudModel() {
    const waiting = this.queue.length > 0;
    return {
      level: this.level.id,
      score: this.score,
      done: this.placedCount,
      total: this.totalItems,
      next: waiting ? Math.max(0, Math.ceil(this.level.spawnEvery - this.spawnAcc)) : null,
      time: formatTime(this.timeLeft),
      urgent: this.timeLeft <= 10,
    };
  }

  trayModel() {
    return {
      tray: this.tray,
      selected: this.selected,
      limit: this.level.trayLimit,
      full: this.tray.length >= this.level.trayLimit,
      items: ITEMS,
      i18n: this.i18n,
    };
  }

  resultModel() {
    return {
      level: this.level.id,
      score: this.score,
      levelScore: this.levelScore,
      breakdown: this.breakdown,
      isLast: this.levelIndex >= LEVELS.length - 1,
    };
  }

  updateGhost(x, y) {
    const item = this.tray.find((entry) => entry.uid === this.pointer?.uid);
    if (!item) return;
    const hit = this.view.pick(x, y);
    if (!hit) {
      this.ghost = null;
      this.syncView();
      return;
    }
    const anchor = anchorFromHover(item.shape, hit.col, hit.row);
    const comp = this.level.compartments.find((entry) => entry.id === hit.compId);
    this.ghost = {
      defId: item.defId,
      shape: item.shape,
      compId: hit.compId,
      col: anchor.col,
      row: anchor.row,
      valid: canPlace(comp, item.shape, anchor.col, anchor.row, this.occupied),
    };
    this.syncView();
  }

  onAction(action) {
    const now = performance.now();
    if (now - this.lastAction < 280) return;
    this.lastAction = now;
    if (action === "start") this.showHowto();
    else if (action === "play") this.beginLevel(0, true);
    else if (action === "rotate") this.rotateSelected();
    else if (action === "next") this.beginLevel(this.levelIndex + 1, false);
    else if (action === "retry") this.beginLevel(0, true);
    else if (action === "again") this.showTitle();
    else if (action === "share") this.share();
    else if (action === "sound") {
      const on = this.audio.toggle();
      this.ui.setSound(on, this.i18n);
      if (on) this.audio.play("place");
    }
  }

  bind() {
    window.addEventListener("pointerdown", (event) => {
      const button = event.target.closest?.("[data-action]");
      if (button) event.preventDefault();
      if (this.pointer || this.screen !== "play") return;
      const card = event.target.closest?.(".tray-item");
      if (!card) return;
      event.preventDefault();
      const uid = Number(card.dataset.uid);
      this.pointer = {
        id: event.pointerId,
        uid,
        x: event.clientX,
        y: event.clientY,
        dragging: false,
        wasSelected: this.selected === uid,
      };
      this.selected = uid;
      try { card.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
      this.ui.renderTray(this.trayModel());
    }, { passive: false });

    window.addEventListener("pointermove", (event) => {
      if (!this.pointer || event.pointerId !== this.pointer.id) return;
      event.preventDefault();
      const dx = event.clientX - this.pointer.x;
      const dy = event.clientY - this.pointer.y;
      if (!this.pointer.dragging && Math.hypot(dx, dy) >= 10) {
        this.pointer.dragging = true;
        const item = this.tray.find((entry) => entry.uid === this.pointer.uid);
        if (item) this.ui.showFinger(ITEMS[item.defId].emoji, event.clientX, event.clientY);
      }
      if (!this.pointer.dragging) return;
      this.updateGhost(event.clientX, event.clientY);
      this.ui.moveFinger(event.clientX, event.clientY);
    }, { passive: false });

    const finishPointer = (event) => {
      if (this.pointer && event.pointerId === this.pointer.id) {
        const pointer = this.pointer;
        this.pointer = null;
        this.ui.hideFinger();
        if (pointer.dragging) {
          if (this.ghost?.valid) this.commitPlace(pointer.uid);
          else {
            this.ghost = null;
            this.audio.play("invalid");
            this.ui.toast(this.i18n.t("toast.invalid"));
            this.sync();
          }
        } else if (pointer.wasSelected) {
          this.rotateSelected();
        } else {
          this.sync();
        }
        if (this.trayDirty) {
          this.trayDirty = false;
          this.ui.renderTray(this.trayModel());
        }
        return;
      }
      const button = event.target.closest?.("[data-action]");
      if (button && event.type === "pointerup") this.onAction(button.dataset.action);
    };
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    window.addEventListener("resize", () => {
      this.view.resize();
      this.updateLabels();
    });
  }

  snapshot() {
    const cells = this.view.projectCells().map((cell) => ({
      ...cell,
      occupied: this.occupied.has(cellKey(cell.compId, cell.col, cell.row)),
    }));
    return {
      ready: !!this.view.ready,
      mode: this.view.mode,
      dpr: this.view.dpr,
      effects: this.view.effects !== false,
      screen: this.screen,
      level: this.level?.id ?? 1,
      score: this.score,
      levelScore: this.levelScore,
      timeLeft: this.timeLeft,
      trayLimit: this.level?.trayLimit ?? 0,
      tray: this.tray.map((item) => ({
        uid: item.uid,
        defId: item.defId,
        rotation: item.rotation,
        shape: item.shape.map((cell) => [...cell]),
      })),
      spawnsLeft: this.queue.length,
      overReason: this.overReason,
      shareResult: this.shareResult,
      cells,
    };
  }

  attachDebug() {
    return {
      snapshot: () => this.snapshot(),
      spawnNow: () => {
        if (this.screen === "play") this.spawnOne();
      },
      expireTimer: () => {
        if (this.screen !== "play") return;
        this.timeLeft = 0;
        this.gameOver("time");
      },
      pauseClock: (paused) => {
        this.clockPaused = !!paused;
        this.lastTick = performance.now();
      },
      pick: (x, y) => this.view.pick(x, y),
    };
  }
}

function formatTime(sec) {
  const total = Math.max(0, Math.ceil(sec));
  const min = Math.floor(total / 60);
  const rem = total % 60;
  return `${min}:${String(rem).padStart(2, "0")}`;
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    /* try the older path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch (err) {
    return false;
  }
}
