import { createI18n } from "./i18n.js";
import { createAudio } from "./audio.js";
import { mountUI } from "./ui.js";
import { Game } from "./game.js";
import { createWebGLView } from "./render3d.js";
import { create2DView } from "./render2d.js";

window.addEventListener("error", (event) => {
  const node = document.createElement("pre");
  node.id = "boot-error";
  node.textContent = String(event.message || event.error || "error");
  document.body.appendChild(node);
});

const params = new URLSearchParams(location.search);
const i18n = createI18n("zh-Hant");
const ui = mountUI(document);
const audio = createAudio();

let view = null;
if (params.get("renderer") !== "2d") {
  try {
    view = await createWebGLView(ui.canvas);
  } catch (err) {
    console.warn(err);
    view = null;
  }
}

if (!view) {
  const fresh = ui.canvas.cloneNode(false);
  ui.canvas.replaceWith(fresh);
  ui.canvas = fresh;
  view = create2DView(fresh);
}

const game = new Game({ view, ui, audio, i18n });
window.__GAME = game.attachDebug();
game.start();

if ("serviceWorker" in navigator && params.get("nosw") !== "1") {
  navigator.serviceWorker.register("./sw.js").catch((err) => console.warn(err));
}
