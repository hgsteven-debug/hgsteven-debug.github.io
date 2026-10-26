function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function mountUI(doc) {
  const app = doc.getElementById("app");
  const overlay = doc.getElementById("overlay");
  const toast = doc.getElementById("toast");
  const ghost = doc.getElementById("drag-ghost");
  app.innerHTML = `
    <header id="hud">
      <div id="hud-level"></div>
      <div id="hud-score"></div>
      <div id="hud-progress"></div>
      <div id="hud-next"></div>
      <div id="hud-time"></div>
      <button id="btn-sound" data-action="sound" type="button"></button>
    </header>
    <div id="stage">
      <canvas id="view"></canvas>
      <div id="labels"></div>
    </div>
    <aside id="tray">
      <div id="tray-head"></div>
      <div id="tray-list"></div>
      <button id="btn-rotate" data-action="rotate" type="button"></button>
    </aside>
  `;

  let toastTimer = 0;
  let hudSig = "";

  function setScreen(name) {
    doc.body.dataset.screen = name;
  }

  function setSound(on, i18n) {
    const button = doc.getElementById("btn-sound");
    button.textContent = i18n.t(on ? "btn.soundOn" : "btn.soundOff");
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function renderHud(model, i18n) {
    const level = doc.getElementById("hud-level");
    const score = doc.getElementById("hud-score");
    const progress = doc.getElementById("hud-progress");
    const next = doc.getElementById("hud-next");
    const time = doc.getElementById("hud-time");
    if (!model) {
      level.textContent = "";
      score.textContent = "";
      progress.textContent = "";
      next.textContent = "";
      time.textContent = "";
      hudSig = "";
      return;
    }
    const sig = `${model.level}|${model.score}|${model.done}|${model.total}|${model.next}|${model.time}|${model.urgent}`;
    if (sig === hudSig) return;
    hudSig = sig;
    level.textContent = i18n.t("hud.level", { n: model.level });
    score.textContent = i18n.t("hud.score", { score: model.score });
    progress.textContent = i18n.t("hud.progress", { done: model.done, total: model.total });
    next.textContent = model.next == null ? i18n.t("hud.spawned") : i18n.t("hud.next", { sec: model.next });
    time.textContent = model.time;
    time.classList.toggle("urgent", !!model.urgent);
  }

  function renderTray({ tray, selected, limit, full, items, i18n }) {
    doc.getElementById("tray-head").textContent = full ? i18n.t("tray.full") : i18n.t("tray.title");
    doc.getElementById("btn-rotate").textContent = i18n.t("btn.rotate");
    const list = doc.getElementById("tray-list");
    const cards = tray.map((item) => {
      const def = items[item.defId];
      return `
        <button class="tray-item${item.uid === selected ? " selected" : ""}" type="button" data-uid="${item.uid}">
          <span class="emoji">${esc(def.emoji)}</span>
          <span class="meta">
            <span class="name">${esc(i18n.t(def.nameKey))}</span>
            ${mini(item.shape)}
          </span>
        </button>
      `;
    }).join("");
    const empties = Math.max(0, limit - tray.length);
    const slots = Array.from({ length: empties }, () => `<div class="slot"></div>`).join("");
    const emptyNote = tray.length === 0 ? `<p class="tray-empty">${esc(i18n.t("tray.empty"))}</p>` : "";
    list.innerHTML = cards + slots + emptyNote;
  }

  function showTitle(i18n) {
    overlay.innerHTML = `
      <section class="panel" id="screen-title">
        <p class="brand">${esc(i18n.t("app.brand"))}</p>
        <h1>${esc(i18n.t("app.title"))}</h1>
        <p class="tagline">${esc(i18n.t("app.tagline"))}</p>
        <button id="btn-start" data-action="start" type="button">${esc(i18n.t("btn.start"))}</button>
      </section>
    `;
  }

  function showHowto(i18n) {
    const lines = [1, 2, 3, 4, 5, 6].map((n) => `<li>${esc(i18n.t(`howto.${n}`))}</li>`).join("");
    overlay.innerHTML = `
      <section class="panel" id="screen-howto">
        <h1>${esc(i18n.t("howto.title"))}</h1>
        <ol>${lines}</ol>
        <button id="btn-play" data-action="play" type="button">${esc(i18n.t("btn.play"))}</button>
      </section>
    `;
  }

  function showPlay() {
    overlay.innerHTML = "";
  }

  function promo(i18n) {
    return `<p id="promo-label">${esc(i18n.t("promo.label"))}</p><p id="promo-code">${esc(i18n.t("promo.code"))}</p>`;
  }

  function breakdown(model, i18n) {
    return `
      <ul class="breakdown">
        <li>${esc(i18n.t("clear.place", { n: model.breakdown.place }))}</li>
        <li>${esc(i18n.t("clear.tidy", { n: model.breakdown.tidy }))}</li>
        <li>${esc(i18n.t("clear.full", { n: model.breakdown.full }))}</li>
        <li>${esc(i18n.t("clear.time", { n: model.breakdown.time }))}</li>
      </ul>
    `;
  }

  function showClear(model, i18n) {
    const title = model.isLast ? i18n.t("clear.win") : i18n.t("clear.title", { n: model.level });
    const primary = model.isLast
      ? `<button id="btn-again" data-action="again" type="button">${esc(i18n.t("btn.again"))}</button>`
      : `<button id="btn-next" data-action="next" type="button">${esc(i18n.t("btn.next"))}</button>`;
    overlay.innerHTML = `
      <section class="panel" id="screen-clear">
        <h1>${esc(title)}</h1>
        <p class="score-line">${esc(i18n.t("clear.levelScore", { score: model.levelScore }))}</p>
        <p class="score-line total">${esc(i18n.t("clear.total", { score: model.score }))}</p>
        ${breakdown(model, i18n)}
        ${promo(i18n)}
        <div class="actions">
          <button id="btn-share" data-action="share" type="button">${esc(i18n.t("btn.share"))}</button>
          ${primary}
        </div>
      </section>
    `;
  }

  function showOver(model, i18n) {
    const title = model.reason === "time" ? i18n.t("over.time") : i18n.t("over.tray");
    overlay.innerHTML = `
      <section class="panel" id="screen-over">
        <h1>${esc(title)}</h1>
        <p class="score-line total">${esc(i18n.t("over.score", { score: model.score }))}</p>
        ${promo(i18n)}
        <div class="actions">
          <button id="btn-share" data-action="share" type="button">${esc(i18n.t("btn.share"))}</button>
          <button id="btn-retry" data-action="retry" type="button">${esc(i18n.t("btn.retry"))}</button>
        </div>
      </section>
    `;
  }

  function showManualCopy(text, i18n) {
    const panel = overlay.querySelector(".panel");
    if (!panel) return;
    let note = doc.getElementById("manual-copy-note");
    if (!note) {
      note = doc.createElement("p");
      note.id = "manual-copy-note";
      panel.appendChild(note);
    }
    note.textContent = i18n.t("share.manual");
    let area = doc.getElementById("manual-copy");
    if (!area) {
      area = doc.createElement("textarea");
      area.id = "manual-copy";
      area.readOnly = true;
      panel.appendChild(area);
    }
    area.value = text;
    area.focus();
    area.select();
  }

  function setLabels(labels) {
    const root = doc.getElementById("labels");
    root.innerHTML = labels.map((label) => (
      `<span class="zone-label" style="left:${label.x}px;top:${label.y}px">${esc(label.text)}</span>`
    )).join("");
  }

  return {
    canvas: doc.getElementById("view"),
    setScreen,
    setSound,
    renderHud,
    renderTray,
    showTitle,
    showHowto,
    showPlay,
    showClear,
    showOver,
    showManualCopy,
    setLabels,
    toast(message) {
      toast.hidden = false;
      toast.textContent = message;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.hidden = true;
      }, 900);
    },
    showFinger(emoji, x, y) {
      ghost.hidden = false;
      ghost.textContent = emoji;
      ghost.style.left = `${x}px`;
      ghost.style.top = `${y}px`;
    },
    moveFinger(x, y) {
      ghost.style.left = `${x}px`;
      ghost.style.top = `${y}px`;
    },
    hideFinger() {
      ghost.hidden = true;
    },
  };
}

function mini(shape) {
  let w = 0;
  let h = 0;
  for (const [x, y] of shape) {
    if (x + 1 > w) w = x + 1;
    if (y + 1 > h) h = y + 1;
  }
  const on = new Set(shape.map(([x, y]) => `${x},${y}`));
  let cells = "";
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cells += `<i class="${on.has(`${x},${y}`) ? "on" : ""}"></i>`;
    }
  }
  return `<span class="mini" style="grid-template-columns:repeat(${w},12px);grid-template-rows:repeat(${h},12px)">${cells}</span>`;
}
