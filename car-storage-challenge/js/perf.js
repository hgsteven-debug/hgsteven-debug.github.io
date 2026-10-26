// DPR stays inside 1–1.5. Preferred cap is 1.25 so there is room to degrade to 1.
export const DPR_MIN = 1;
export const DPR_CAP = 1.25;
export const DPR_HARD_CAP = 1.5;

export function initialDpr() {
  const raw = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
  return clampDpr(Math.min(DPR_CAP, raw));
}

export function clampDpr(value) {
  return Math.min(DPR_HARD_CAP, Math.max(DPR_MIN, value));
}

export function degradeDpr(current) {
  const next = Math.round((current - 0.25) * 100) / 100;
  return clampDpr(Math.min(current, Math.max(DPR_MIN, next)));
}

export function createLoop(onFrame) {
  let raf = 0;
  let running = false;
  let last = 0;

  function tick(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    const again = onFrame(dt) === true;
    if (again && running) raf = requestAnimationFrame(tick);
    else {
      running = false;
      raf = 0;
    }
  }

  return {
    request() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    },
  };
}
