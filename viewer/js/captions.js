// Captions for sounds that carry meaning (a horn behind you, a siren, your cab). Off in Settings if not wanted.
import { Settings } from "./settings.js";

const css = document.createElement("style");
css.textContent = `
  #captions { position: fixed; left: 50%; bottom: 150px; transform: translateX(-50%); z-index: 26; display: flex; flex-direction: column;
    align-items: center; gap: 4px; pointer-events: none; }
  #captions span { background: rgba(0,0,0,.78); color: #fff; font: var(--w-semibold) var(--t-body) var(--font); padding: 4px 10px; border-radius: 6px;
    transition: opacity .4s; }
  @media (max-width: 640px) { #captions { bottom: calc(150px + env(safe-area-inset-bottom)); } }`;
document.head.appendChild(css);
document.body.insertAdjacentHTML("beforeend", `<div id="captions" aria-live="polite"></div>`);
const box = document.getElementById("captions");
const last = new Map();

// caption("Horn", { camera, pos }) -> "[Horn · behind you, left]"
export function caption(text, { camera = null, pos = null, key = text, minGap = 2.5 } = {}) {
  if (!Settings.v.captions) return;
  const now = performance.now() / 1000;
  if (now - (last.get(key) || -99) < minGap) return;
  last.set(key, now);
  let where = "";
  if (camera && pos) {
    const f = camera.getWorldDirection(camera.position.clone()), dx = pos.x - camera.position.x, dz = pos.z - camera.position.z;
    const d = Math.hypot(dx, dz), front = (dx * f.x + dz * f.z) / (d || 1), right = (dx * -f.z + dz * f.x) / (d || 1);
    const side = Math.abs(right) > 0.35 ? (right > 0 ? "right" : "left") : "";
    where = d > 140 ? "distant" : front < -0.4 ? `behind you${side ? ", " + side : ""}` : side || "ahead";
  }
  const el = document.createElement("span");
  el.textContent = `[${text}${where ? " · " + where : ""}]`;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 450); }, 2600);
}
