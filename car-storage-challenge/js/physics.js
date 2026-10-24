// Custom settle motion only. No physics engine.
// A short spring drops a placed piece onto its cell, then goes to sleep.

export function createSettle(x, y, z) {
  return {
    x,
    y: y + 0.7,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    tx: x,
    ty: y,
    tz: z,
    age: 0,
    awake: true,
  };
}

export function stepBody(body, dt) {
  if (!body.awake) return false;
  const step = Math.min(dt, 0.05);
  body.age += step;
  const k = 80;
  body.vx += (body.tx - body.x) * k * step;
  body.vy += (body.ty - body.y) * k * step;
  body.vz += (body.tz - body.z) * k * step;
  const damp = Math.exp(-13 * step);
  body.vx *= damp;
  body.vy *= damp;
  body.vz *= damp;
  body.x += body.vx * step;
  body.y += body.vy * step;
  body.z += body.vz * step;
  const err = Math.hypot(body.tx - body.x, body.ty - body.y, body.tz - body.z);
  const speed = Math.hypot(body.vx, body.vy, body.vz);
  if ((err < 0.012 && speed < 0.06) || body.age > 1.1) {
    body.x = body.tx;
    body.y = body.ty;
    body.z = body.tz;
    body.vx = 0;
    body.vy = 0;
    body.vz = 0;
    body.awake = false;
  }
  return body.awake;
}
