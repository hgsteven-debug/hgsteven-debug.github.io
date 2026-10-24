import { LEVELS, ITEMS } from "../js/levels.js";
import { canPlace, cellKey, cloneShape, playableCount, rotateShape } from "../js/puzzle.js";

export function orientations(shape) {
  const found = [];
  const seen = new Set();
  let current = cloneShape(shape);
  for (let i = 0; i < 4; i++) {
    const key = current.map(([x, y]) => `${x},${y}`).sort().join("|");
    if (!seen.has(key)) {
      seen.add(key);
      found.push(current);
    }
    current = rotateShape(current);
  }
  return found;
}

export function solveLevel(level, nodeLimit = 2500000) {
  const pieces = level.spawns.map((id, index) => ({
    index,
    id,
    shapes: orientations(ITEMS[id].shape),
    size: ITEMS[id].shape.length,
  }));
  const order = pieces.slice().sort((a, b) => b.size - a.size);
  const placement = new Array(level.spawns.length);
  const occupied = new Set();
  let nodes = 0;

  function place(shape, comp, col, row, add) {
    for (const [x, y] of shape) {
      const key = cellKey(comp.id, col + x, row + y);
      if (add) occupied.add(key);
      else occupied.delete(key);
    }
  }

  function dfs(step) {
    if (step === order.length) return true;
    if (++nodes > nodeLimit) return false;
    const piece = order[step];
    for (const shape of piece.shapes) {
      for (const comp of level.compartments) {
        for (let row = 0; row < comp.rows; row++) {
          for (let col = 0; col < comp.cols; col++) {
            if (!canPlace(comp, shape, col, row, occupied)) continue;
            place(shape, comp, col, row, true);
            placement[piece.index] = { compId: comp.id, col, row, shape };
            if (dfs(step + 1)) return true;
            place(shape, comp, col, row, false);
          }
        }
      }
    }
    return false;
  }

  const ok = dfs(0);
  return { ok, nodes, placement: ok ? placement : null };
}

export function capacity(level) {
  return level.compartments.reduce((sum, comp) => sum + playableCount(comp), 0);
}

export function demand(level) {
  return level.spawns.reduce((sum, id) => sum + ITEMS[id].shape.length, 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const level of LEVELS) {
    const started = Date.now();
    const result = solveLevel(level);
    console.log(`level ${level.id}`, {
      ok: result.ok,
      nodes: result.nodes,
      ms: Date.now() - started,
      capacity: capacity(level),
      demand: demand(level),
    });
  }
}
