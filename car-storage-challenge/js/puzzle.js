import { playable } from "./layout.js";

export function cloneShape(shape) {
  return shape.map(([x, y]) => [x, y]);
}

export function normalize(shape) {
  const minX = Math.min(...shape.map(([x]) => x));
  const minY = Math.min(...shape.map(([, y]) => y));
  return shape.map(([x, y]) => [x - minX, y - minY]);
}

export function rotateShape(shape) {
  return normalize(shape.map(([x, y]) => [y, -x]));
}

export function bounds(shape) {
  let w = 0;
  let h = 0;
  for (const [x, y] of shape) {
    if (x + 1 > w) w = x + 1;
    if (y + 1 > h) h = y + 1;
  }
  return { w, h };
}

export function sameShape(a, b) {
  if (a.length !== b.length) return false;
  const key = (shape) => shape.map(([x, y]) => `${x},${y}`).sort().join("|");
  return key(a) === key(b);
}

export function anchorFromHover(shape, col, row) {
  const { w, h } = bounds(shape);
  return {
    col: col - Math.floor((w - 1) / 2),
    row: row - Math.floor((h - 1) / 2),
  };
}

export function hoverFromAnchor(shape, col, row) {
  const { w, h } = bounds(shape);
  return {
    col: col + Math.floor((w - 1) / 2),
    row: row + Math.floor((h - 1) / 2),
  };
}

export function coveredCells(shape, col, row) {
  return shape.map(([x, y]) => [col + x, row + y]);
}

export function cellKey(compId, col, row) {
  return `${compId}:${col},${row}`;
}

export function canPlace(comp, shape, col, row, occupied) {
  if (!shape.length) return false;
  for (const [c, r] of coveredCells(shape, col, row)) {
    if (!playable(comp, c, r)) return false;
    if (occupied.has(cellKey(comp.id, c, r))) return false;
  }
  return true;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Tidy: the piece touches a wall, a blocked cell, or an item already placed.
export function isTidy(comp, shape, col, row, occupiedBefore) {
  const cells = coveredCells(shape, col, row);
  for (const [c, r] of cells) {
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      const wall = nc < 0 || nr < 0 || nc >= comp.cols || nr >= comp.rows || !playable(comp, nc, nr);
      if (wall || occupiedBefore.has(cellKey(comp.id, nc, nr))) return true;
    }
  }
  return false;
}

export function playableCount(comp) {
  let n = 0;
  for (let row = 0; row < comp.rows; row++) {
    for (let col = 0; col < comp.cols; col++) {
      if (playable(comp, col, row)) n += 1;
    }
  }
  return n;
}

export function filledCount(comp, occupied) {
  let n = 0;
  for (let row = 0; row < comp.rows; row++) {
    for (let col = 0; col < comp.cols; col++) {
      if (playable(comp, col, row) && occupied.has(cellKey(comp.id, col, row))) n += 1;
    }
  }
  return n;
}
