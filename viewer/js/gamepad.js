// Game controller support (any standard-mapping pad: DualSense, DualShock, Xbox...) + device-aware prompts.
// The viewer polls `pad.poll()` once a frame and reads sticks / triggers / button presses; whichever device the
// player touched last (keyboard, touch or pad) decides how on-screen prompts read ("F" / "Hop in" / "✕").
import { Settings } from "./settings.js";

const DEAD = 0.16;
const dz = v => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
export const BTN = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7, SHARE: 8, OPTIONS: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

let device = matchMedia("(pointer: coarse)").matches ? "touch" : "kbd";
const listeners = [];
function setDevice(d) {
  if (d === device) return;
  device = d; document.body.dataset.input = d;
  for (const f of listeners) f(d);
}
document.body.dataset.input = device;
addEventListener("keydown", () => setDevice("kbd"), true);
addEventListener("pointerdown", e => setDevice(e.pointerType === "touch" ? "touch" : "kbd"), true);
export const onInputChange = f => listeners.push(f);
export const inputDevice = () => device;

// how to say an action on the device in hand
const LABEL = {
  interact: { kbd: "F", pad: "✕", touch: "" }, back: { kbd: "Esc", pad: "○", touch: "" }, horn: { kbd: "H", pad: "□", touch: "" },
  map: { kbd: "M", pad: "△", touch: "" }, pause: { kbd: "Esc", pad: "Options", touch: "" },
};
export const prompt = action => LABEL[action]?.[device] ?? "";

export class Pad {
  constructor() {
    this.prev = []; this.state = null; this.index = null;
    addEventListener("gamepadconnected", e => { this.index = e.gamepad.index; setDevice("pad"); this.toast?.(`Controller connected · ${prompt("pause")} for settings`); });
    addEventListener("gamepaddisconnected", e => { if (e.gamepad.index === this.index) this.index = null; });
  }
  // returns { lx, ly, rx, ry, l2, r2, pressed(btn), held(btn) } or null when no pad
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const g = this.index != null ? pads[this.index] : [...pads].find(p => p && p.connected);
    if (!g) { this.state = null; return null; }
    this.index = g.index; this.g = g;
    const held = g.buttons.map(b => b.pressed), prev = this.prev;
    this.prev = held;
    const { k, inv } = Settings.lookScale();
    const s = {
      lx: dz(g.axes[0] || 0), ly: dz(g.axes[1] || 0), rx: dz(g.axes[2] || 0) * k, ry: dz(g.axes[3] || 0) * k * inv,
      l2: g.buttons[BTN.L2]?.value || 0, r2: g.buttons[BTN.R2]?.value || 0,
      pressed: b => held[b] && !prev[b], held: b => !!held[b],
    };
    if (s.lx || s.ly || s.rx || s.ry || s.l2 > 0.1 || s.r2 > 0.1 || held.some((h, i) => h && !prev[i])) setDevice("pad");
    return (this.state = s);
  }
  rumble(strong = 0.6, weak = 0.3, ms = 140) {
    try { this.g?.vibrationActuator?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch { /* not supported */ }
  }
}

// move focus between the buttons of an open dialog with the d-pad / stick, press ✕ to activate (menus, map card...)
export function navigateFocus(root, dir) {
  const items = [...root.querySelectorAll("button, [role=switch], input, select, [tabindex='0']")].filter(e => e.offsetParent !== null && !e.disabled);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  const next = items[(i < 0 ? 0 : i + dir + items.length) % items.length];
  next.focus();
}
