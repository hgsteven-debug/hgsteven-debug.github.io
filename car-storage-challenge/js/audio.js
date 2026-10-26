export function createAudio() {
  let ctx = null;
  let enabled = false;

  function ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  return {
    get enabled() {
      return enabled;
    },
    toggle() {
      enabled = !enabled;
      if (enabled) ensure();
      return enabled;
    },
    play(kind) {
      if (!enabled) return;
      const audio = ensure();
      if (!audio) return;
      const freq = { place: 520, rotate: 340, invalid: 160, clear: 720, over: 120, spawn: 440 }[kind] || 400;
      const now = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now);
      osc.stop(now + 0.14);
    },
  };
}
