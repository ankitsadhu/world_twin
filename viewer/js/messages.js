// One message system, three lanes, one rule each (nothing else on screen talks to the player):
//   decision  top centre        needs an answer ("Hear the city?", "Welcome back"): one at a time, queued
//   context   bottom centre     the one thing you can do right here (Hop in): sits just above the bottom controls
//   tip       bottom centre     quiet guidance: only shown when the bottom lane is otherwise empty
// Captions keep their own lane above whatever is at the bottom. layout() runs every frame and stacks the bottom lane
// over the ride panel / bottom bar so nothing ever overlaps.
import { ICON } from "./icons.js";

const css = document.createElement("style");
css.textContent = `
  #notice { position: fixed; left: 50%; top: 76px; transform: translateX(-50%); z-index: 40; display: none; align-items: center;
    gap: var(--s2); padding: var(--s2) var(--s2) var(--s2) var(--s4); font-size: var(--t-body); max-width: calc(100% - 24px); box-sizing: border-box; }
  #notice span { flex: 1; }
  #notice .ui-btn { white-space: nowrap; }
  @media (max-width: 640px) {                     /* phones: full width, the sentence on its own line above the buttons */
    #notice { left: var(--s3); right: var(--s3); transform: none; max-width: none; flex-wrap: wrap; padding: var(--s3); }
    #notice span { flex: 1 0 calc(100% - 48px); }
    #notice .ui-btn[data-i] { flex: 1; }
  }`;
document.head.appendChild(css);
document.body.insertAdjacentHTML("beforeend", `<div id="notice" class="ui-surface" role="status" aria-live="polite"></div>`);
const el = document.getElementById("notice");

export const Messages = {
  queue: [], current: null,
  // ask("Hear the city?", [["Sound on", fn, true], ["Not now", fn]], { ms, key })
  ask(text, actions = [], { ms = 9000, key = text } = {}) {
    if (this.current?.key === key || this.queue.some(m => m.key === key)) return;
    this.queue.push({ text, actions, ms, key });
    if (!this.current) this.next();
  },
  dismiss(key) {
    this.queue = this.queue.filter(m => m.key !== key);
    if (!key || this.current?.key === key) this.next();
  },
  next() {
    clearTimeout(this.t);
    this.current = this.queue.shift() || null;
    if (!this.current) { el.style.display = "none"; return; }
    const m = this.current;
    el.innerHTML = `<span>${m.text}</span>${m.actions.map(([label, , primary], i) =>
      `<button class="ui-btn${primary ? " primary" : ""}" data-i="${i}">${label}</button>`).join("")}
      <button class="ui-btn" data-x aria-label="Dismiss" style="width:36px;min-height:36px;padding:0">${ICON.close}</button>`;
    el.style.display = "flex";
    el.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { const f = m.actions[+b.dataset.i][1]; this.next(); f?.(); });
    el.querySelector("[data-x]").onclick = () => this.next();
    this.t = setTimeout(() => this.next(), m.ms);
  },

  // ---------------------------------------------------------------- bottom lane: stack, never overlap
  layout() {
    const vis = id => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== "none" ? e : null; };
    const H = innerHeight;
    // the floor: top of whatever owns the bottom edge (ride panel at the bottom, phone tab bar, nothing)
    let floor = 16;
    const bar = matchMedia("(max-width: 640px)").matches ? document.getElementById("dock") : null;
    if (bar) floor = H - bar.getBoundingClientRect().top + 8;
    const panel = vis("ridepanel");
    if (panel) { const r = panel.getBoundingClientRect(); if (r.top > H / 2) floor = Math.max(floor, H - r.top + 8); }
    const hop = vis("hopin");
    if (hop) { hop.style.bottom = floor + "px"; floor += hop.offsetHeight + 8; }
    const hint = document.getElementById("hint");
    if (hint) {                                                  // tips only when the bottom lane is free
      const busy = !!hop || (!!panel && !document.body.classList.contains("ridestrip"));   // a slim ride strip leaves room
      hint.style.visibility = busy ? "hidden" : "";
      hint.style.bottom = floor + "px";
      if (!busy && getComputedStyle(hint).opacity !== "0") floor += hint.offsetHeight + 8;
    }
    const cap = document.getElementById("captions");
    if (cap) cap.style.bottom = floor + 8 + "px";
    // top lane: decisions sit under the search bar, or under a ride strip pinned to the top (phones while driving)
    let top = 76;
    if (panel) { const r = panel.getBoundingClientRect(); if (r.top < H / 2) top = r.bottom + 8; }
    el.style.top = top + "px";
  },
};
