import { listCells, cellWorld, makeCamera } from "./layout.js";
import { initialDpr, degradeDpr, createLoop } from "./perf.js";

const ACCENT = "#d6ff3c";

export function create2DView(canvas) {
  return new CanvasView(canvas);
}

class CanvasView {
  constructor(canvas) {
    this.mode = "2d";
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ready = false;
    this.dpr = initialDpr();
    this.effects = true;
    this.degradeSteps = 0;
    this.warmup = 8;
    this.fpsAcc = 0;
    this.fpsN = 0;
    this.dirty = true;
    this.width = 0;
    this.height = 0;
    this.level = null;
    this.items = null;
    this.placed = [];
    this.ghost = null;
    this.records = [];
    this.fitPoints = [];
    this.cam = null;
    this.loop = createLoop((dt) => this.onFrame(dt));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement || canvas);
    this.loop.request();
  }

  setLevel(level, items) {
    this.level = level;
    this.items = items;
    this.records = listCells(level.compartments, { playableOnly: true });
    this.fitPoints = [];
    for (const comp of level.compartments) {
      const size = comp.cell || 1;
      this.fitPoints.push({ x: comp.ox - 0.2, y: comp.y || 0, z: comp.oz - 0.2 });
      this.fitPoints.push({
        x: comp.ox + comp.cols * size + 0.2,
        y: (comp.y || 0) + 0.6,
        z: comp.oz + comp.rows * size + 0.2,
      });
    }
    this.placed = [];
    this.ghost = null;
    this.resize();
  }

  setState({ placed, ghost }) {
    this.placed = placed || [];
    this.ghost = ghost || null;
    this.dirty = true;
    this.loop.request();
  }

  resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width < 2 || height < 2 || !this.fitPoints.length) return;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.cam = makeCamera(width, height, this.fitPoints);
    this.dirty = true;
    this.loop.request();
  }

  projectCells() {
    if (!this.cam) return [];
    const rect = this.canvas.getBoundingClientRect();
    return this.records.map((rec) => {
      const p = this.cam.project(rec);
      return {
        compId: rec.compId,
        col: rec.col,
        row: rec.row,
        playable: true,
        x: p.x + rect.left,
        y: p.y + rect.top,
      };
    });
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const pitch = this.pitch();
    let best = null;
    let bestD = pitch * 0.72;
    for (const rec of this.records) {
      const p = this.cam.project(rec);
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < bestD) {
        bestD = dist;
        best = rec;
      }
    }
    if (!best) return null;
    return { compId: best.compId, col: best.col, row: best.row };
  }

  onFrame(dt) {
    this.draw();
    this.fpsAcc += dt;
    this.fpsN += 1;
    if (this.fpsN >= 20 && this.degradeSteps < 2) {
      const fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsN = 0;
      if (fps < 30) {
        this.degradeSteps += 1;
        this.effects = false;
        const next = degradeDpr(this.dpr);
        if (next < this.dpr) {
          this.dpr = next;
          this.resize();
        }
      }
    }
    if (this.warmup > 0) this.warmup -= 1;
    if (!this.ready && this.width > 0) this.ready = true;
    const again = this.warmup > 0 || this.dirty;
    this.dirty = false;
    return again;
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.cam || !this.width) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 0, this.width, this.height);
    const pitch = this.pitch();
    for (const rec of this.records) {
      const p = this.cam.project(rec);
      roundRect(ctx, p.x - pitch * 0.46, p.y - pitch * 0.46, pitch * 0.92, pitch * 0.92, 6, "#3a3a3a");
    }
    for (const placed of this.placed) this.drawPiece(placed, "#", false);
    if (this.ghost) this.drawPiece(this.ghost, this.ghost.valid ? ACCENT : "#6a6a6a", true);
  }

  drawPiece(piece, fallback, ghost) {
    const comp = this.level.compartments.find((item) => item.id === piece.compId);
    const def = this.items[piece.defId];
    if (!comp || !def) return;
    const ctx = this.ctx;
    const pitch = this.pitch();
    const color = ghost ? fallback : def.color;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const [x, y] of piece.shape) {
      const world = cellWorld(comp, piece.col + x, piece.row + y);
      const p = this.cam.project(world);
      roundRect(ctx, p.x - pitch * 0.4, p.y - pitch * 0.4, pitch * 0.8, pitch * 0.8, 6, color);
      sx += p.x;
      sy += p.y;
      n += 1;
    }
    if (!n || ghost) return;
    ctx.font = `${Math.max(18, pitch * 0.46)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.emoji || "", sx / n, sy / n);
  }

  pitch() {
    const a = this.cam.project({ x: 0, y: 0, z: 0 });
    const b = this.cam.project({ x: 1, y: 0, z: 0 });
    return Math.max(20, Math.hypot(b.x - a.x, b.y - a.y));
  }
}

function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fill();
}
