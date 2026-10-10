// Player settings + saved progress + the pause menu. Everything persists in this browser (localStorage, wrapped:
// private windows simply start fresh). Other modules read `Settings.v` and subscribe with `Settings.on(fn)`.
import { ICON } from "./icons.js";

const KEY = "ts.settings", PROGRESS = "ts.progress";
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const prefersReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// a rough guess at the device: phones and small / low-memory machines start on "balanced"
function autoQuality() {
  const phone = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 900;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  return phone || weak ? "balanced" : "high";
}

const DEFAULTS = {
  volume: 0.8, sound: null,            // sound: null = not asked yet, true / false = the player's answer
  sensitivity: 1, invertY: false,
  textScale: 1, reduceMotion: null,    // null = follow the system setting
  captions: false, contrast: false,
  roughContact: undefined,   // undefined = the default above (on at localhost, off public)
  quality: "auto",                     // auto | low | balanced | high
  traffic: 1, crowd: 1500,
  view: "third",                       // walking camera: third person (see yourself) or first person
  outfit: "leather",                   // your character's outfit (avatar.js PLAYER_OUTFITS)
  shades: false, cap: false, jacket: false,   // accessories on your character (cosmetic only: nothing to buy)
  people: null,                        // how many characters walk the city; null = by graphics quality
};

export const Settings = {
  _m: (() => { if (!store.get("ts.roughMig")) { const o = store.get(KEY); if (o && o.roughContact === false) { delete o.roughContact; store.set(KEY, o); } store.set("ts.roughMig", 1); } })(),
  v: { ...DEFAULTS, ...(store.get(KEY) || {}) },
  subs: [],
  on(fn) { this.subs.push(fn); fn(this.v); },
  set(patch) { Object.assign(this.v, patch); store.set(KEY, this.v); for (const f of this.subs) f(this.v, patch); },
  reset() { this.v = { ...DEFAULTS, sound: this.v.sound }; store.set(KEY, this.v); for (const f of this.subs) f(this.v, this.v); },
  get reduceMotion() { return this.v.reduceMotion ?? prefersReduced(); },
  get roughContact() {
    const debug = new URLSearchParams(location.search).get("rough");
    if (debug !== null) return debug !== "0";
    return this.v.roughContact ?? /^(localhost|127\.0\.0\.1)$/.test(location.hostname);   // on while developing here, off on the public site until you switch it on
  },
  get quality() { return this.v.quality === "auto" ? autoQuality() : this.v.quality; },
  lookScale() { return { k: this.v.sensitivity, inv: this.v.invertY ? -1 : 1 }; },
};

// ---------------------------------------------------------------- saved progress (where you were, parked cars)
export const Progress = {
  load() {
    const p = store.get(PROGRESS);
    return p && Date.now() - p.t < 30 * 864e5 ? p : null;      // older than a month: start fresh
  },
  save(p) { store.set(PROGRESS, { ...p, t: Date.now() }); },
  clear() { store.del(PROGRESS); },
};

// ---------------------------------------------------------------- text size: scale the type tokens
const BASE = { "--t-caption": 12, "--t-body": 15, "--t-headline": 17, "--t-title": 22, "--t-large": 28 };
Settings.on(v => { for (const [k, px] of Object.entries(BASE)) document.documentElement.style.setProperty(k, `${Math.round(px * v.textScale)}px`); });
Settings.on(v => document.body.classList.toggle("contrast", !!v.contrast));

// ---------------------------------------------------------------- pause menu
export class PauseMenu {
  constructor({ onOpen, onClose, actions = [] }) {
    Object.assign(this, { onOpen, onClose, actions });
    const css = document.createElement("style");
    css.textContent = `
      #pause { position: fixed; inset: 0; z-index: 70; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #pause .card { width: min(480px, calc(100% - 24px)); max-height: calc(100% - 32px); overflow: auto; padding: var(--s5); box-sizing: border-box; }
      #pause h2 { margin: 0 0 var(--s4); font-size: var(--t-title); display: flex; align-items: center; justify-content: space-between; }
      #pause h3 { margin: var(--s5) 0 var(--s2); font-size: var(--t-caption); color: var(--ink-3); text-transform: uppercase; letter-spacing: .06em; }
      #pause .acts { display: flex; flex-wrap: wrap; gap: var(--s2); }
      #pause #pause-resume { width: 100%; min-height: 48px; font-size: var(--t-headline); }
      #pause .list { margin-top: var(--s3); border-radius: 14px; overflow: hidden; background: var(--fill); }
      #pause .list button { display: flex; width: 100%; justify-content: space-between; align-items: center; min-height: 48px; padding: 0 var(--s4); border: none; background: none; color: var(--ink); font: var(--t-body) var(--font); text-align: left; cursor: pointer; }
      #pause .list button + button { border-top: 1px solid var(--glass-border); }
      #pause .list button:hover { background: var(--fill-hover); }
      #pause .list span { color: var(--ink-3); font-size: 20px; }
      #pause .row { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); min-height: var(--hit); }
      #pause .row label { color: var(--ink); font-size: var(--t-body); }
      #pause .row small { display: block; color: var(--ink-3); font-size: var(--t-caption); }
      #pause input[type=range] { width: 46%; accent-color: var(--accent); }
      #pause select { min-height: 36px; border-radius: var(--r-control); background: var(--fill); color: var(--ink); border: 1px solid var(--glass-border);
        font: var(--t-body) var(--font); padding: 0 var(--s2); }
      #pause .sw { width: 50px; height: 30px; border-radius: 15px; border: none; background: var(--fill-hover); position: relative; cursor: pointer; flex: none; }
      #pause .sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 12px; background: #fff; transition: left .15s; }
      #pause .sw[aria-checked="true"] { background: var(--good); }
      #pause .sw[aria-checked="true"]::after { left: 23px; }
      #pause .fine { color: var(--ink-3); font-size: var(--t-caption); margin-top: var(--s4); }
      #pause .seg { display: flex; gap: 2px; padding: 2px; margin: var(--s4) 0 var(--s2); background: var(--fill); border-radius: var(--r-control); }
      #pause .seg button { flex: 1; min-height: 36px; border: none; border-radius: 10px; background: none; color: var(--ink-2);
        font: var(--w-semibold) var(--t-caption) var(--font); cursor: pointer; }
      #pause .seg button[aria-selected="true"] { background: var(--fill-hover); color: var(--ink); }
      #pause section[hidden] { display: none; }
      #pause .danger.armed { background: var(--danger); color: #fff; }`;
    document.head.appendChild(css);
    const sw = (k, label, sub = "") => `<div class="row"><label for="set-${k}">${label}${sub ? `<small>${sub}</small>` : ""}</label>
      <button class="sw" role="switch" id="set-${k}" data-k="${k}" aria-checked="false"></button></div>`;
    const range = (k, label, min, max, step) => `<div class="row"><label for="set-${k}">${label}</label>
      <input type="range" id="set-${k}" data-k="${k}" min="${min}" max="${max}" step="${step}"></div>`;
    document.body.insertAdjacentHTML("beforeend", `
      <div id="pause" role="dialog" aria-modal="true" aria-label="Paused"><div class="card ui-surface">
        <h2>Menu <button class="ui-btn" id="pause-x" aria-label="Resume">${ICON.close}</button></h2>
        <button class="ui-btn primary" id="pause-resume">Resume</button>
        <div class="list">${this.actions.map((a, i) => `<button data-act="${i}">${a.label}<span aria-hidden="true">›</span></button>`).join("")}</div>
        <div class="seg" role="tablist" aria-label="Settings">
          ${["Sound", "You", "Display", "City"].map(t => `<button role="tab" data-tab="${t}" aria-selected="false">${t}</button>`).join("")}</div>
        <section data-tab="Sound" role="tabpanel">${sw("sound", "City sound")}${range("volume", "Volume", 0, 1, 0.05)}${sw("captions", "Captions", "Horns, sirens and your cab, as text")}</section>
        <section data-tab="You" role="tabpanel">
        <div class="row"><label for="set-outfit">Outfit</label>
          <select id="set-outfit" data-k="outfit"><option value="leather">Leather trousers</option><option value="leather_shorts">Leather shorts</option></select></div>
        ${sw("shades", "Sunglasses")}${sw("cap", "Baseball cap")}${sw("jacket", "Denim jacket")}
        <div class="row"><label for="set-view">Walking view<small>V switches</small></label>
          <select id="set-view" data-k="view"><option value="third">Third person (see yourself)</option><option value="first">First person</option></select></div>
        ${range("sensitivity", "Look sensitivity", 0.3, 2.5, 0.1)}${sw("invertY", "Invert vertical look")}</section>
        <section data-tab="Display" role="tabpanel">
        <div class="row"><label for="set-quality">Graphics<small>Lower = smoother on older phones</small></label>
          <select id="set-quality" data-k="quality"><option value="auto">Automatic</option><option value="low">Low</option>
          <option value="balanced">Balanced</option><option value="high">High</option></select></div>
        ${range("textScale", "Text size", 0.85, 1.5, 0.05)}${sw("contrast", "High-contrast markers", "Bigger, outlined map markers")}
        ${sw("reduceMotion", "Reduce motion", "No fly-ins, camera swoops or shakes")}</section>
        <section data-tab="City" role="tabpanel">${range("traffic", "Traffic", 0, 1.5, 0.25)}
          ${sw("roughContact", "Rough contact", "Non-graphic hits; press G or tap Shove on foot · on while testing at localhost, off on the public site")}
          <div class="acts" style="margin-top:var(--s4)"><button class="ui-btn danger" id="pause-reset">Reset settings</button>
          <button class="ui-btn danger" id="pause-forget">Forget my place &amp; parked cars</button></div>
          <p class="fine">Settings and your progress are saved in this browser only.</p></section>
      </div></div>`);
    this.el = document.getElementById("pause");
    const el = this.el;
    el.addEventListener("pointerdown", e => { if (e.target === el) this.close(); });
    document.getElementById("pause-x").onclick = () => this.close();
    document.getElementById("pause-resume").onclick = () => this.close();
    el.querySelectorAll("[data-act]").forEach(b => b.onclick = () => { this.close(); this.actions[+b.dataset.act].run(); });
    // anything that erases asks twice: the first tap arms the button ("Tap again to ..."), the second does it
    const confirmTwice = (id, again, done, run) => {
      const b = document.getElementById(id), label = b.textContent;
      b.onclick = () => {
        if (!b.classList.contains("armed")) {
          b.classList.add("armed"); b.textContent = again;
          clearTimeout(b.t); b.t = setTimeout(() => { b.classList.remove("armed"); b.textContent = label; }, 4000);
          return;
        }
        clearTimeout(b.t); b.classList.remove("armed"); run(); b.textContent = done;
        setTimeout(() => { b.textContent = label; }, 2500);
      };
    };
    confirmTwice("pause-reset", "Tap again to reset", "Settings reset", () => { Settings.reset(); this.sync(); });
    confirmTwice("pause-forget", "Tap again to forget", "Forgotten", () => { Progress.clear(); this.onForget?.(); });
    el.querySelectorAll(".seg [data-tab]").forEach(b => b.onclick = () => this.tab(b.dataset.tab));
    this.tab(store.get("ts.settingsTab") || "Sound");
    el.querySelectorAll(".sw").forEach(b => b.onclick = () => {
      const k = b.dataset.k, cur = k === "reduceMotion" ? Settings.reduceMotion : k === "roughContact" ? Settings.roughContact : !!Settings.v[k];
      Settings.set({ [k]: !cur }); this.sync();
    });
    el.querySelectorAll("input[type=range]").forEach(r => r.oninput = () => Settings.set({ [r.dataset.k]: +r.value }));
    el.querySelectorAll("select").forEach(sel => sel.onchange = () => Settings.set({ [sel.dataset.k]: sel.value }));
  }
  sync() {
    for (const b of this.el.querySelectorAll(".sw")) b.setAttribute("aria-checked", String(
      b.dataset.k === "reduceMotion" ? Settings.reduceMotion
        : b.dataset.k === "roughContact" ? Settings.roughContact : !!Settings.v[b.dataset.k]));
    for (const r of this.el.querySelectorAll("input[type=range]")) r.value = Settings.v[r.dataset.k];
    for (const sel of this.el.querySelectorAll("select")) sel.value = Settings.v[sel.dataset.k];
  }
  tab(name) {
    for (const b of this.el.querySelectorAll(".seg [data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
    for (const sec of this.el.querySelectorAll("section[data-tab]")) sec.hidden = sec.dataset.tab !== name;
    store.set("ts.settingsTab", name);
  }
  get isOpen() { return this.el.style.display === "flex"; }
  open() { if (this.isOpen) return; this.sync(); this.el.style.display = "flex"; this.onOpen?.(); document.getElementById("pause-resume").focus(); }
  close() { if (!this.isOpen) return; this.el.style.display = "none"; this.onClose?.(); }
  toggle() { this.isOpen ? this.close() : this.open(); }
}
