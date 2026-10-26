export function cellSize(comp) {
  return comp.cell || 1;
}

export function playable(comp, col, row) {
  if (col < 0 || row < 0 || col >= comp.cols || row >= comp.rows) return false;
  if (!comp.mask) return true;
  const line = comp.mask[row];
  if (!line) return false;
  return !!line[col];
}

export function cellWorld(comp, col, row) {
  const size = cellSize(comp);
  return {
    x: comp.ox + (col + 0.5) * size,
    y: comp.y ?? 0.4,
    z: comp.oz + (row + 0.5) * size,
    size,
  };
}

export function listCells(compartments, { playableOnly = false } = {}) {
  const out = [];
  for (const comp of compartments) {
    for (let row = 0; row < comp.rows; row++) {
      for (let col = 0; col < comp.cols; col++) {
        const open = playable(comp, col, row);
        if (playableOnly && !open) continue;
        const world = cellWorld(comp, col, row);
        out.push({ compId: comp.id, col, row, playable: open, ...world });
      }
    }
  }
  return out;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function norm(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function viewBasis(eye, look) {
  const up = { x: 0, y: 1, z: 0 };
  const zAxis = norm(sub(eye, look));
  let xAxis = norm(cross(up, zAxis));
  if (Math.hypot(xAxis.x, xAxis.y, xAxis.z) < 1e-6) xAxis = { x: 1, y: 0, z: 0 };
  const yAxis = cross(zAxis, xAxis);
  return { xAxis, yAxis, zAxis, eye };
}

function toView(p, basis) {
  const d = sub(p, basis.eye);
  return { x: dot(d, basis.xAxis), y: dot(d, basis.yAxis), z: dot(d, basis.zAxis) };
}

// Slightly angled orthographic camera, framed to the storage cells.
export function makeCamera(width, height, points) {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  const n = Math.max(1, points.length);
  const look = { x: cx / n, y: 0.2, z: cz / n };
  const eye = { x: look.x + 0.35, y: look.y + 20, z: look.z + 6.2 };
  const aspect = Math.max(0.4, width / Math.max(1, height));
  const basis = viewBasis(eye, look);

  function inside(halfH) {
    for (const p of points) {
      const v = toView(p, basis);
      const ndcX = v.x / (halfH * aspect);
      const ndcY = v.y / halfH;
      if (ndcX < -0.94 || ndcX > 0.94 || ndcY < -0.9 || ndcY > 0.92) return false;
    }
    return true;
  }

  let lo = 1;
  let hi = 40;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) hi = mid;
    else lo = mid;
  }

  return {
    eye,
    look,
    halfH: hi,
    aspect,
    project(p) {
      const v = toView(p, basis);
      const ndcX = v.x / (hi * aspect);
      const ndcY = v.y / hi;
      return {
        x: (ndcX * 0.5 + 0.5) * width,
        y: (-ndcY * 0.5 + 0.5) * height,
      };
    },
  };
}
