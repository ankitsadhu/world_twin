// Getting around: "Where to?" search, fly-to travel, waypoints, explore keys, camera safety, onboarding + tour.
// Places come from export/<district>/places.json (scripts/tools/build_places.py). Coordinates there are
// Blender local metres (x, y, z-up); this module converts with B() / toLocal().
import * as THREE from "three";
import { ICON } from "./icons.js";
import { Settings } from "./settings.js";

const KIND_ORDER = { activity: -1, landmark: 0, intersection: 1, building: 2, ad: 3 };
const KIND_LABEL = { activity: "Things to do", landmark: "Landmark", intersection: "Street", building: "Building", ad: "Ad spot" };
const KIND_ICON = { activity: ICON.star, landmark: ICON.star, intersection: ICON.street, building: ICON.building, ad: ICON.screen };
// things to DO, found by what people type ("fly", "plane", "boat", "taxi job"): picking one starts it
export const ACTIVITIES = [
  { act: "fly", name: "Fly a plane", sub: "Catapult off the Intrepid · over Midtown, the Hudson, the Statue of Liberty", keywords: "plane airplane aeroplane fly flying pilot cessna flight airport land intrepid sky" },
  { act: "speedboat", name: "Speedboat race: Hudson Dash", sub: "A fast boat on the Hudson · boost pads · beat the clock", keywords: "speedboat speed boat race racing hudson dash water jet ski mario kart boost" },
  { act: "sail", name: "Take the helm of the boat", sub: "Sail the Hudson from Pier 83 · Statue of Liberty", keywords: "boat sail sailing ship helm captain river hudson cruise ferry" },
  { act: "bike", name: "Ride a motorcycle", sub: "A cruiser parked along 7th Ave: walk up, F to hop on", keywords: "motorcycle motorbike bike chopper cruiser harley scooter ride riding biker" },
  { act: "fares", name: "Drive a cab: pick up fares", sub: "Find a passenger, get them there fast · stars, not money", keywords: "taxi cab drive driving job fares passenger uber car" },
  { act: "tours", name: "Sightseeing tours", sub: "Walk, sail or fly a landmark route against the clock", keywords: "tour tours sightseeing race challenge time landmarks game" },
  { act: "drive", name: "Drive any car", sub: "Walk up to a car and hop in", keywords: "car drive driving steal hop vehicle" },
  { act: "walk", name: "Walk the streets", sub: "Run, jump, explore on foot", keywords: "walk walking run running jump foot person avatar" },
  { act: "business", name: "Buy a screen or building", sub: "Real screens, real prices", keywords: "buy billboard screen advertise ad business property building price" },
].map(a => ({ ...a, kind: "activity", x: 0, y: 0 }));
const TOUR = [
  ["tkts", "The TKTS red steps: the classic seat to watch Times Square glow."],
  ["1tsq", "One Times Square: the New Year's Eve ball drops from the top of this tower."],
  ["nasdaq", "The Nasdaq drum: a curved LED screen wrapping the corner of 4 Times Square."],
  ["paramount", "The Paramount Building: 1927 clock tower and glass globe."],
  ["750", "7th Ave & 49th: wraparound screens and a 3D corner board."],
  ["intrepid", "The USS Intrepid on the Hudson: this is where planes take off."],
];

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const safeStore = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// edit distance <= max (insert / delete / substitute / swap two neighbours), with an early exit
function near(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v); best = Math.min(best, v);
    }
    if (best > max) return false;
    prev2 = prev; prev = cur;
  }
  return prev[b.length] <= max;
}

export class Navigator {
  constructor({ camera, orbit, scene, B, root, setMode, getMode, getCollider, onArrive, groundAt, blockedAhead }) {
    Object.assign(this, { camera, orbit, scene, B, root, setMode, getMode, getCollider, onArrive, groundAt, blockedAhead });
    this.low = null;          // at street level? (then drag = look around from where you stand)
    this.turnLeft = 0;        // remaining in-place turn (radians) from the ⟲ ⟳ buttons
    this.initLookAround();
    this.places = [];
    this.flight = null;
    this.waypoint = null;
    this.tour = null;
    this.beacon = this.makeBeacon();
    this.buildUI();
  }

  toLocal(v) { return [v.x, -v.z, v.y]; }

  async load(url) {
    this.places = (await (await fetch(url)).json()).places;
    this.byId = new Map(this.places.map(p => [p.id, p]));
    this.renderResults("");
  }

  // ---------------------------------------------------------------- UI
  buildUI() {
    const css = document.createElement("style");
    css.textContent = `
      #where { position: fixed; top: var(--s4); left: 50%; transform: translateX(-50%); width: min(520px, calc(100% - 520px));
               min-width: 240px; z-index: 30; font-family: var(--font); }
      #where input { width: 100%; box-sizing: border-box; height: var(--hit); padding: 0 var(--s6) 0 44px; border-radius: var(--r-surface);
               border: 1px solid var(--glass-border); background: var(--glass); color: var(--ink); font: var(--t-body) var(--font);
               outline: none; box-shadow: var(--shadow); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur); }
      #where input::placeholder { color: var(--ink-3); }
      #where input:focus { border-color: var(--accent); }
      #where .icon { position: absolute; left: 14px; top: 12px; color: var(--ink-3); pointer-events: none; }
      #where .kbd { position: absolute; right: 12px; top: 12px; color: var(--ink-3); font-size: var(--t-caption); border: 1px solid var(--glass-border);
               border-radius: 6px; padding: 1px 7px; pointer-events: none; }
      #results { margin-top: var(--s2); overflow: auto; max-height: 56vh; display: none; padding: var(--s1) 0; }
      #results .hd { padding: var(--s2) var(--s4) var(--s1); color: var(--ink-3); font-size: var(--t-caption); font-weight: var(--w-semibold); }
      #results .it { display: flex; gap: var(--s3); align-items: center; padding: var(--s2) var(--s4); cursor: pointer; min-height: var(--hit); }
      #results .it.sel, #results .it:hover { background: var(--fill); }
      #results .ic { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--fill); color: var(--ink-2); flex: none; }
      #results .ic.landmark { background: rgba(255,69,58,.18); color: #ff6961; }
      #results .ic.ad { background: rgba(255,204,0,.16); color: var(--accent); }
      #results .nm { flex: 1; min-width: 0; }
      #results .nm b { display: block; font-weight: var(--w-semibold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #results .nm span { color: var(--ink-3); font-size: var(--t-caption); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
      #results .dist { color: var(--ink-3); font-size: var(--t-caption); flex: none; }
      #wpchip { position: fixed; top: 72px; left: 50%; transform: translateX(-50%); z-index: 25; display: none; align-items: center; gap: var(--s2);
               padding: var(--s1) var(--s1) var(--s1) var(--s4); border-radius: 999px; font-size: var(--t-body); }
      #wpchip .arrow { display: inline-grid; color: var(--accent); transition: transform .1s linear; }
      #wpchip button { min-height: 34px; border-radius: 999px; }
      #hint { position: fixed; bottom: var(--s5); left: 50%; transform: translateX(-50%); z-index: 6; font: var(--w-semibold) var(--t-body) var(--font);
               opacity: 0; transition: opacity .4s; pointer-events: none; border-radius: 999px; white-space: nowrap; }
      #welcome { position: fixed; inset: 0; z-index: 50; display: none; align-items: center; justify-content: center;
               background: rgba(5,5,10,.45); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
      #welcome .card { width: min(440px, calc(100% - 32px)); padding: var(--s6) var(--s5); text-align: center; }
      #welcome h2 { margin: 0 0 var(--s2); font-size: var(--t-large); font-weight: var(--w-bold); letter-spacing: -.01em; }
      #welcome p.lead { margin: 0 0 var(--s5); color: var(--ink-2); font-size: var(--t-body); line-height: 1.45; }
      #welcome .actions { display: flex; gap: var(--s2); justify-content: center; flex-wrap: wrap; }
      #welcome .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s2); text-align: left; }
      #welcome .tile { min-height: 72px; padding: var(--s3); border: none; border-radius: var(--r-control); background: var(--fill); color: var(--ink);
        cursor: pointer; font-family: var(--font); display: flex; flex-direction: column; gap: 2px; justify-content: center; }
      #welcome .tile:hover, #welcome .tile:focus-visible { background: var(--fill-hover); outline: 2px solid var(--accent); outline-offset: 1px; }
      #welcome .tile:last-child:nth-child(odd) { grid-column: 1 / -1; }
      #welcome .tile b { font-size: var(--t-body); }
      #welcome .tile span { font-size: var(--t-caption); color: var(--ink-2); }
      #welcome .tile.hero { grid-column: 1 / -1; min-height: 96px; text-align: center; }
      #welcome .tile.hero b { font-size: 22px; }
      #welcome .tile.hero span { font-size: var(--t-body); }
      #welcome .more2 { grid-column: 1 / -1; margin-top: var(--s2); } #welcome .more2 summary { cursor: pointer; text-align: center; color: var(--ink-2); font-size: var(--t-caption); padding: var(--s2); list-style: none; } #welcome .more2 .tiles { margin-top: var(--s2); }
      #welcome .more { grid-column: 1 / -1; margin: var(--s2) 0 0; font-size: var(--t-caption); color: var(--ink-2); text-align: center; }
      #welcome .tile.primary { background: var(--accent); color: var(--accent-ink); }
      #welcome .tile.primary span { color: var(--accent-ink); opacity: .75; }
      @media (max-width: 420px) { #welcome .tiles { grid-template-columns: 1fr; } #welcome .tile { min-height: 56px; } }
      #tourbar { position: fixed; left: 50%; bottom: var(--s5); transform: translateX(-50%); z-index: 40; display: none;
               width: min(520px, calc(100% - 32px)); padding: var(--s4) var(--s5); box-sizing: border-box; }
      #tourbar .t { font-weight: var(--w-semibold); font-size: var(--t-headline); margin-bottom: var(--s1); }
      #tourbar .c { color: var(--ink-2); font-size: var(--t-body); }
      #tourbar .row { display: flex; justify-content: space-between; align-items: center; margin-top: var(--s3); gap: var(--s2); }
      #tourbar .dots span { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--fill-hover); margin-right: 5px; }
      #tourbar .dots span.on { background: var(--accent); }
      @media (max-width: 1150px) { #tourbar { left: 240px; transform: none; width: min(460px, calc(100% - 320px)); } }
      @media (max-width: 760px) { #where { left: var(--s3); right: var(--s3); transform: none; width: auto; }
               #tourbar { left: var(--s3); right: var(--s3); width: auto; bottom: calc(84px + env(safe-area-inset-bottom)); } }
    `;
    document.head.appendChild(css);
    const html = `
      <div id="where" role="search"><span class="icon">${ICON.search}</span><input id="whereq" type="search" autocomplete="off" spellcheck="false"
        placeholder="Where to?" aria-label="Search places, streets and screens" aria-controls="results"><span class="kbd">/</span>
        <div id="results" class="ui-surface" role="listbox"></div></div>
      <div id="wpchip" class="ui-surface"><span class="arrow">${ICON.arrow}</span><span id="wptext"></span>
        <button id="wpfly" class="ui-btn primary">Go</button><button id="wpclear" class="ui-btn" aria-label="Clear destination">${ICON.close}</button></div>
      <div id="hint" class="ui-surface" role="status"></div>
      <div id="welcome" role="dialog" aria-modal="true" aria-labelledby="wtitle"><div class="card ui-surface">
        <h2 id="wtitle">Times Square, live.</h2>
        <p class="lead">A real city, real New York time. Jump on a bike and cause some chaos.</p>
        <div class="tiles">
          <button class="tile primary hero" data-w="bike"><b>▶ Play: ride a motorcycle</b><span>Ride, jump, smash, escape the police. Score a chaos chain.</span></button>
          <button class="tile" data-w="walk"><b>Walk the streets</b><span>Run, jump, explore on foot</span></button>
          <button class="tile" data-w="tour"><b>60-second tour</b><span>The highlights, hands-free</span></button>
          <details class="more2"><summary>More ways to play</summary><div class="tiles">
            <button class="tile" data-w="fares"><b>🚕 Drive a cab</b><span>Beat-the-clock fares</span></button>
            <button class="tile" data-w="fly"><b>✈ Fly a plane</b><span>Off the Intrepid</span></button>
            <button class="tile" data-w="speedboat"><b>🚤 Speedboat race</b><span>Boost pads on the water</span></button>
            <button class="tile" data-w="sail"><b>⚓ Sail the Hudson</b><span>To the Statue of Liberty</span></button>
            <button class="tile" data-w="tours"><b>⏱ Sightseeing tours</b><span>Against the clock</span></button>
            <button class="tile" data-w="ride"><b>Ride a cab</b><span>Book it and ride</span></button>
            <button class="tile" data-w="business"><b>Buy a screen or building</b><span>Real screens, real prices</span></button>
          </div></details>
        </div>
      </div></div>
      <div id="tourbar" class="ui-surface" role="dialog" aria-label="Tour"><div class="t" id="tourt"></div><div class="c" id="tourc"></div>
        <div class="row"><div class="dots" id="tourdots"></div>
        <div style="display:flex;gap:var(--s2)"><button id="tourend" class="ui-btn">End</button><button id="tourprev" class="ui-btn">Back</button>
        <button id="tournext" class="ui-btn primary">Next</button></div></div></div>`;
    document.body.insertAdjacentHTML("beforeend", html);
    const q = this.q = document.getElementById("whereq");
    this.results = document.getElementById("results");
    q.addEventListener("focus", () => { this.renderResults(q.value); this.results.style.display = "block"; });
    q.addEventListener("input", () => { this.renderResults(q.value); this.results.style.display = "block"; });
    q.addEventListener("keydown", e => this.onSearchKey(e));
    addEventListener("pointerdown", e => { if (!document.getElementById("where").contains(e.target)) this.results.style.display = "none"; });
    addEventListener("keydown", e => {
      if (e.key === "/" && document.activeElement !== q && this.getMode() !== "walk") { e.preventDefault(); q.focus(); q.select(); }
    });
    document.getElementById("wpclear").onclick = () => this.setWaypoint(null);
    document.getElementById("wpfly").onclick = () => {     // Go: on foot you walk there; otherwise fly over
      const pl = this.waypoint?.place;
      if (!pl) return;
      if (this.getMode() === "walk" && this.walkToPoint) return this.walkToPoint(pl.x, pl.y);
      if (pl.eye) this.flyTo(pl); else this.flyToPoint(pl.x, pl.y);   // a bare point (your ride's pickup) has no camera view
    };
    document.querySelectorAll("#welcome [data-w]").forEach(b => b.onclick = () => {
      const k = b.dataset.w;
      this.closeWelcome();
      if (k === "tour") this.startTour(); else if (k !== "explore") this.onWelcome?.(k);     // the viewer wires the rest
    });
    document.getElementById("welcome").addEventListener("pointerdown", e => { if (e.target.id === "welcome") this.closeWelcome(); });
    document.getElementById("tournext").onclick = () => this.tourStep(+1);
    document.getElementById("tourprev").onclick = () => this.tourStep(-1);
    document.getElementById("tourend").onclick = () => this.endTour();
    this.setHint();
  }

  // One-time tips instead of a permanent instruction bar: each appears the first time it's relevant,
  // disappears as soon as you do it (or after a few seconds) and never comes back.
  setHint() {
    if (!this.revealed) return;
    const touch = matchMedia("(pointer: coarse)").matches;
    if (this.getMode() === "walk") this.tip("walk2", touch ? "Tap the street to walk there · drag to look"
      : "WASD walk · Shift run · Space jump · V camera · drag to look", 11000);
    else if (this.low) this.tip("look", touch ? "Drag to look around · pinch to move" : "Drag to look around · scroll to move");
    else this.tip("map", touch ? "Drag to move · double-tap a building to see all of it" : "Drag to move · double-click a building to see all of it");
  }
  tip(key, text, ms = 6500) {
    if (safeStore.get("ts_tip_" + key)) return;
    safeStore.set("ts_tip_" + key, "1");
    const h = document.getElementById("hint");
    h.textContent = text; h.style.opacity = 1; h.style.padding = "10px 18px";
    this.tipKey = key;
    clearTimeout(this.tipT); this.tipT = setTimeout(() => this.doneTip(), ms);
  }
  doneTip(key) {
    if (key && key !== this.tipKey) return;
    document.getElementById("hint").style.opacity = 0;
  }
  afterReveal() { this.revealed = true; this.showWelcomeIfNew(); if (!document.getElementById("welcome").style.display.includes("flex")) this.setHint(); }

  showWelcomeIfNew() {
    if (!safeStore.get("ts_welcomed")) document.getElementById("welcome").style.display = "flex";
  }
  openWelcome() { document.getElementById("welcome").style.display = "flex"; document.querySelector("#welcome .tile")?.focus(); }
  closeWelcome() {
    document.getElementById("welcome").style.display = "none"; safeStore.set("ts_welcomed", "1"); this.setHint();
    const f = this.onWelcomeClosed; this.onWelcomeClosed = null; f?.();
  }

  // ---------------------------------------------------------------- search
  score(p, terms) {
    const hay = (p.name + " " + (p.keywords || "") + " " + (p.sub || "")).toLowerCase();
    let s = 0;
    for (const t of terms) {
      if (/^\d+$/.test(t)) {                        // numbers ("47", "8") must be whole words: "47th", not "1024739"
        const m = hay.match(new RegExp(`(^|[\\s&,.])${t}(st|nd|rd|th)?(?![\\d])`));
        if (!m) return -1;
        s += 25;
        continue;
      }
      const i = hay.indexOf(t);
      if (i < 0) {                                  // typo tolerance: a close spelling of a word ("paramont", "nasdac")
        if (t.length < 4) return -1;
        const max = t.length >= 7 ? 2 : 1;
        const hit = hay.split(/[\s&,.·]+/).some(w => w.length >= 3 && (near(t, w, max) || (w.length > t.length && near(t, w.slice(0, t.length), max))));
        if (!hit) return -1;
        s += 6 + t.length / 2;
        continue;
      }
      s += (i === 0 ? 30 : /[\s&]/.test(hay[i - 1] || " ") ? 15 : 4) + t.length;
    }
    return s - KIND_ORDER[p.kind] * 6;
  }

  renderResults(text) {
    const q = text.trim().toLowerCase().replace(/(\d+)(st|nd|rd|th)\b/g, "$1").replace(/\bave?\b|\bstreet\b|\bst\b/g, " ");
    const terms = q.split(/[\s&,]+/).filter(Boolean);
    let list;
    if (!terms.length) list = this.places.filter(p => p.kind === "landmark");
    else list = [...ACTIVITIES, ...this.places].filter(p => p.kind !== "ad" || this.showAds).map(p => [this.score(p, terms), p]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]).map(([, p]) => p).slice(0, 30);
    const none = terms.length && !list.length;
    if (none) list = this.places.filter(p => p.kind === "landmark").slice(0, 6);   // never a dead end: suggest instead
    this.list = list;
    this.sel = 0;
    const [x, y] = this.toLocal(this.camera.position);
    const dist = p => { if (p.act) return "Start"; const d = Math.hypot(p.x - x, p.y - y); return d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`; };
    const esc = t => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const head = !terms.length ? `<div class="hd">Popular places</div>`
      : none ? `<div class="hd">Nothing called “${esc(text.trim())}” here yet. Try a street like “44th &amp; 7th”, or one of these:</div>` : "";
    this.results.innerHTML = head + list.map((p, i) => `
      <div class="it${i === 0 ? " sel" : ""}" data-i="${i}" role="option"><span class="ic ${p.kind}">${KIND_ICON[p.kind]}</span>
        <div class="nm"><b>${p.name}</b><span>${p.sub || KIND_LABEL[p.kind]}</span></div><span class="dist">${dist(p)}</span></div>`).join("");
    this.results.querySelectorAll(".it").forEach(el => el.onclick = e => {
      const i = +el.dataset.i;
      if (e.target.dataset.w !== undefined) this.walkTo(this.list[i]); else this.go(this.list[i]);
    });
  }

  onSearchKey(e) {
    const items = this.results.querySelectorAll(".it");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      this.sel = (this.sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length);
      items.forEach((el, i) => el.classList.toggle("sel", i === this.sel));
      items[this.sel]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && this.list[this.sel]) {
      e.preventDefault();
      (e.shiftKey ? this.walkTo : this.go).call(this, this.list[this.sel]);
    } else if (e.key === "Escape") { this.q.blur(); this.results.style.display = "none"; }
    e.stopPropagation();   // typing must not drive WASD
  }

  go(place) {
    this.q.value = place.act ? "" : place.name; this.q.blur(); this.results.style.display = "none";
    if (place.act) return this.onWelcome?.(place.act);       // an activity: start it, don't fly anywhere
    if (this.beforeGo?.(place)) return;                    // e.g. choosing / changing a ride's destination
    if (place.kind === "ad" && this.screenView) { const v = this.screenView(place.id); if (v) place = { ...place, ...v }; }
    this.setWaypoint(place);
    this.flyTo(place);
  }

  walkTo(place) {
    if (place.act) return this.go(place);
    this.q.value = place.name; this.q.blur(); this.results.style.display = "none";
    this.setWaypoint(place);
    this.setMode("walk");
  }

  // ---------------------------------------------------------------- travel
  flyTo(place, { duration, arc } = {}) {
    if (this.getMode() === "ride") return;                // the camera belongs to the car you're in
    if (this.getMode() === "walk") this.setMode("orbit");
    if (place.kind !== "building" || !this.focus || place.x !== this.focus.x) this.focus = null;
    const p0 = this.camera.position.clone(), t0 = this.orbit.target.clone();
    const p1 = this.B(...place.eye), t1 = this.B(...place.target);
    const d = p0.distanceTo(p1);
    if (d < 0.5) return;
    const calm = Settings.reduceMotion;                       // reduce motion: a short, flat move instead of a swoop
    this.flight = { p0, t0, p1, t1, t: 0, dur: calm ? 0.35 : duration || Math.min(3.6, Math.max(1.1, 0.8 + d / 450)),
                    arc: calm ? 0 : arc ?? Math.min(320, d * 0.35 + 20), place };
    this.orbit.enabled = false;
  }

  flyToPoint(x, y) {
    // nearest named place within 70 m, else an overview of the clicked spot from the south
    let best = null, bd = 70;
    for (const p of this.places) {
      if (p.kind === "ad") continue;
      const dd = Math.hypot(p.x - x, p.y - y);
      if (dd < bd) { bd = dd; best = p; }
    }
    const place = best || { id: "pt", name: `Map point`, kind: "point", x, y, eye: [x + 25, y - 110, 75], target: [x, y, 5] };
    this.setWaypoint(place);
    this.flyTo(place);
  }

  flyToHit(point) {   // double-click: approach the clicked point, keep current viewing direction
    const dir = point.clone().sub(this.camera.position);
    const dist = dir.length();
    dir.normalize();
    const back = Math.min(Math.max(22, dist * 0.35), 160);
    const eye = point.clone().sub(dir.multiplyScalar(back));
    eye.y = Math.max(eye.y, point.y + 2, 1.7);
    const [ex, ey, ez] = this.toLocal(eye), [tx, ty, tz] = this.toLocal(point);
    this.flyTo({ eye: [ex, ey, ez], target: [tx, ty, tz] }, { duration: Math.min(2.2, 0.7 + dist / 500) });
  }

  // tap / double-click a building: frame ALL of it from a 3/4 angle on the side you tapped (never a wall in your face),
  // then the turn buttons orbit around it so it can be seen from every side
  frameBuilding(poly) {
    const xs = poly.pts.map(q => q[0]), ys = poly.pts.map(q => q[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const r = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2, h = poly.h;
    const cam = this.camera, half = THREE.MathUtils.degToRad(cam.fov) / 2, col = this.getCollider();
    const dist = Math.max(45, (h * 1.25) / 2 / Math.tan(half), (r * 2.4) / 2 / (Math.tan(half) * cam.aspect));
    const [px, py] = this.toLocal(cam.position);
    let a0 = Math.atan2(py - cy, px - cx);                     // from the side you are looking at it...
    if (!isFinite(a0)) a0 = -Math.PI / 2;
    const gz = h * 0.45;
    // back away until both the roof and the street fit in the frame from this angle
    const fits = (e, z) => { const dz = z - e[2], dh = Math.hypot(cx - e[0], cy - e[1]); return Math.abs(Math.atan2(dz, dh) - Math.atan2(gz - e[2], dh)) < half * 0.85; };
    const eyeAt = (a, elev) => {
      for (let d = dist; ; d *= 1.15) {
        const e = [cx + Math.cos(a) * d * Math.cos(elev), cy + Math.sin(a) * d * Math.cos(elev), Math.max(18, gz + d * Math.sin(elev))];
        if ((fits(e, h) && fits(e, 0)) || d > dist * 4) return e;
      }
    };
    // ...turned a little for a 3/4 view; if a neighbour tower is in the way, try other sides, then look from higher up
    // try sides and heights; keep the view that sees the most of the building (ties: the nearest to your own side)
    let eye = eyeAt(a0 + 0.45, 0.36), best = -1;
    const probes = [0.15, 0.4, 0.65, 0.9, 1].map(f => [cx, cy, h * f]);
    for (const elev of [0.36, 0.6, 0.9, 1.15]) {
      for (const da of [0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, Math.PI]) {
        const e = eyeAt(a0 + da, elev);
        if (col?.blocked(e[0], e[1], 2, e[2])) continue;
        const seen = col ? probes.filter(t => !col.lineBlocked(e, t, poly)).length : probes.length;
        const score = seen - elev * 0.4 - Math.abs(da) * 0.1;          // lower and closer to your side when equal
        if (score > best) { best = score; eye = e; }
        if (seen === probes.length && elev < 0.4) break;
      }
      if (best >= probes.length - 0.4) break;
    }
    const near = this.nearestIntersection?.(cx, cy);
    const sub = [poly.name ? "Building" : near && `Near ${near.name}`, poly.year && `Built ${poly.year}`, `${Math.round(h)} m tall`].filter(Boolean).join(" · ");
    this.focus = { x: cx, y: cy };
    this.flyTo({ name: poly.name || "Building", sub, kind: "building", x: cx, y: cy, eye, target: [cx, cy, gz] }, { duration: 1.6 });
    if (this.onBuilding?.({ name: poly.name, x: cx, y: cy, h })) return;   // business view: what the building offers
    this.tip("orbit", "Use ↺ ↻ to see it from every side");
  }
  nearestIntersection(x, y) {
    let best = null, bd = Infinity;
    for (const p of this.places || []) if (p.kind === "intersection") { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  // arrival title, Apple Maps style: the place name fades in, then out
  arrived(place) {
    if (!place?.name || this.tour || place.kind === "ad") return;
    let el = document.getElementById("arrival");
    if (!el) {
      document.body.insertAdjacentHTML("beforeend", `<div id="arrival" role="status" aria-live="polite"
        style="position:fixed;top:128px;left:50%;transform:translateX(-50%);z-index:20;text-align:center;pointer-events:none;
        font-family:var(--font);color:var(--ink);text-shadow:0 2px 12px rgba(0,0,0,.8);opacity:0;transition:opacity .6s">
        <div id="arr-t" style="font-size:var(--t-title);font-weight:var(--w-bold)"></div>
        <div id="arr-s" style="font-size:var(--t-body);color:var(--ink-2)"></div></div>`);
      el = document.getElementById("arrival");
    }
    document.getElementById("arr-t").textContent = place.name;
    document.getElementById("arr-s").textContent = place.sub || "";
    el.style.opacity = 1;
    clearTimeout(this.arrT); this.arrT = setTimeout(() => { el.style.opacity = 0; }, 3200);
  }

  // ---------------------------------------------------------------- waypoint beacon
  makeBeacon() {
    const g = new THREE.CylinderGeometry(1.4, 1.4, 260, 24, 1, true);
    g.translate(0, 130, 0);
    const m = new THREE.MeshBasicMaterial({ color: 0xffc400, transparent: true, opacity: 0.28, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.RingGeometry(3, 4.2, 40), new THREE.MeshBasicMaterial({ color: 0xffc400,
      transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25;
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(g, m), ring);
    grp.visible = false;
    grp.renderOrder = 10;
    this.scene.add(grp);
    return grp;
  }

  setWaypoint(place) {
    this.waypoint = place ? { place, x: place.x, y: place.y } : null;
    if (document.activeElement !== this.q) this.q.value = place ? place.name : "";
    this.beacon.visible = !!place;
    if (place) this.beacon.position.copy(this.B(place.x, place.y, 0.1));
    document.getElementById("wpchip").style.display = place ? "flex" : "none";
  }

  // ---------------------------------------------------------------- tour
  startTour() { this.tour = { i: -1 }; document.getElementById("tourbar").style.display = "block"; this.tourStep(1); }
  endTour() { this.tour = null; document.getElementById("tourbar").style.display = "none"; }
  tourStep(dir) {
    if (!this.tour) return;
    const i = Math.max(0, Math.min(TOUR.length - 1, this.tour.i + dir));
    if (dir > 0 && this.tour.i === TOUR.length - 1) return this.endTour();
    this.tour.i = i; this.tour.wait = 0;
    const [id, caption] = TOUR[i], p = this.byId.get(id);
    document.getElementById("tourt").textContent = `${i + 1} / ${TOUR.length} · ${p.name}`;
    document.getElementById("tourc").textContent = caption;
    document.getElementById("tourdots").innerHTML = TOUR.map((_, k) => `<span class="${k <= i ? "on" : ""}"></span>`).join("");
    document.getElementById("tournext").textContent = i === TOUR.length - 1 ? "Finish" : "Next";
    this.setWaypoint(null);
    this.flyTo(p, { duration: 2.6 });
  }

  // ---------------------------------------------------------------- look around from where you stand
  // At street level, rotating must pivot at YOUR position (turn your head), not swing you around a building
  // hundreds of metres away. High above the city, the map behaviour (pan + rotate around a point) is kept.
  height() { return this.camera.position.y - (this.groundAt ? this.groundAt(this.camera.position) : 0); }

  initLookAround() {
    const dom = this.orbit.domElement;
    dom.addEventListener("pointerdown", e => {
      if (this.getMode() !== "orbit" || this.flight || !this.low) return;
      if (e.button !== 0 && e.button !== 2) return;
      this.lookDrag = [e.clientX, e.clientY];
      this.turnLeft = 0;
    });
    addEventListener("pointermove", e => {
      if (!this.lookDrag) return;
      const { k: sens, inv } = Settings.lookScale();
      const k = 0.0042 * (this.camera.fov / 55) * sens, dx = e.clientX - this.lookDrag[0], dy = e.clientY - this.lookDrag[1];
      if (Math.abs(dx) < 150 && Math.abs(dy) < 150) this.rotateInPlace(dx * k, dy * k * inv);   // ignore pointer jumps
      this.doneTip("look");
      this.lookDrag = [e.clientX, e.clientY];
    });
    addEventListener("pointerup", () => { this.lookDrag = null; });
    // street-level scroll (Google Earth style): scroll in = move forward, scroll out = rise up and back away;
    // once high enough, normal map zoom takes over. Capture phase so the map control never sees it.
    dom.addEventListener("wheel", e => {
      if (this.getMode() !== "orbit" || this.flight || !this.low) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.streetWheel(Math.max(-120, Math.min(120, e.deltaY)));
    }, { capture: true, passive: false });
    const dock = document.getElementById("dock") || document.body;
    dock.insertAdjacentHTML("beforeend", `
      <button class="dockbtn" data-t="1" aria-label="Turn left 30 degrees">${ICON.turnLeft}<span>Turn left 30° (Q)</span></button>
      <button class="dockbtn" data-t="-1" aria-label="Turn right 30 degrees">${ICON.turnRight}<span>Turn right 30° (E)</span></button>`);
    dock.querySelectorAll("[data-t]").forEach(b => b.onclick = () => this.turn(+b.dataset.t * Math.PI / 6));
    addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT" || e.repeat || this.getMode() !== "orbit") return;
      if (e.code === "KeyQ") this.turn(Math.PI / 6);
      if (e.code === "KeyE") this.turn(-Math.PI / 6);
    });
  }

  streetWheel(dy) {
    const cam = this.camera, col = this.getCollider();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); fwd.y = 0; fwd.normalize();
    const free = (x, z, y) => !col || !col.blocked(x, -z, 0.6, y);
    if (dy < 0) {                                     // forward, staying above the ground
      const step = -dy * 0.08;
      const nx = cam.position.x + fwd.x * step, nz = cam.position.z + fwd.z * step;
      const solid = this.blockedAhead?.(cam.position, fwd, step + 1.2);       // statues, kiosks, poles...
      if (!solid && free(nx, nz, cam.position.y)) { cam.position.x = nx; cam.position.z = nz; }
      const g = (this.groundAt ? this.groundAt(cam.position) : 0) + 1.7;    // glide back down to eye level
      cam.position.y = Math.max(g, cam.position.y - Math.min(step * 0.7, Math.max(0, cam.position.y - g)));
    } else {                                          // rise and back away, tilting down to keep the street in view
      const up = dy * 0.09, back = dy * 0.06;
      const nx = cam.position.x - fwd.x * back, nz = cam.position.z - fwd.z * back;
      if (free(nx, nz, cam.position.y + up)) { cam.position.x = nx; cam.position.z = nz; }
      cam.position.y += up;
    }
    const h = this.height();
    const ahead = Math.max(25, h * 1.4);
    const tilt = THREE.MathUtils.clamp((h - 3) / 20, 0, 0.9);     // level near the ground, looking down when high
    this.orbit.target.set(cam.position.x + fwd.x * ahead, Math.max(0, cam.position.y - Math.max(0.3, h * tilt)),
      cam.position.z + fwd.z * ahead);
    cam.lookAt(this.orbit.target);
  }

  // + / − buttons: street level moves you forward / up and back; above the city (or around a building) dollies in / out
  zoom(dir) {
    if (this.flight) return;
    if (this.zoomAnim?.dir === dir) this.zoomAnim.t = Math.min(this.zoomAnim.t, 0) - 0.35;   // quick taps add up
    else this.zoomAnim = { dir, t: 0 };
  }

  turn(a) {                   // smooth 30° turn: in place at street level, around the map centre when high up
    if (this.getMode() === "walk") return;
    this.turnLeft += a;
  }

  rotateInPlace(dyaw, dpitch = 0) {
    const cam = this.camera, e = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ");
    e.y += dyaw;
    e.x = THREE.MathUtils.clamp(e.x + dpitch, -1.3, 1.3);
    e.z = 0;
    cam.quaternion.setFromEuler(e);
    // keep the orbit target in front of you so zoom / map controls continue from the new direction
    const d = THREE.MathUtils.clamp(cam.position.distanceTo(this.orbit.target), 20, 80);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.orbit.target.copy(cam.position).addScaledVector(fwd, d);
  }

  applyControlScheme() {
    const low = this.height() < 15;
    if (low === this.low) return;
    this.low = low;
    const o = this.orbit;
    if (low) {   // street level: our drag-look handles left/right drag; scroll still moves you
      o.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null };
      o.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
    } else {     // above the city: Google Maps / Earth
      o.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
      o.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    }
    this.orbit.domElement.style.cursor = low ? "grab" : "";
    this.setHint();
  }

  // ---------------------------------------------------------------- per-frame
  update(dt, keys) {
    const cam = this.camera, orbit = this.orbit;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = ease(f.t);
      cam.position.lerpVectors(f.p0, f.p1, e);
      cam.position.y += Math.sin(Math.PI * e) * f.arc;            // rise over the rooftops, then descend
      orbit.target.lerpVectors(f.t0, f.t1, e);
      cam.lookAt(orbit.target);
      if (f.t >= 1) { this.flight = null; orbit.enabled = this.getMode() === "orbit"; orbit.update(); this.arrived(f.place); this.onArrive?.(f.place); }
    } else if (this.getMode() === "orbit" && document.activeElement !== this.q) {
      this.applyControlScheme();
      if (this.zoomAnim) {
        const z = this.zoomAnim, step = Math.max(0, Math.min(dt, 0.35 - z.t)); z.t += dt;
        if (step > 0) {
          if (this.low && !this.focus) this.streetWheel(z.dir > 0 ? -12 * step / 0.0167 : 12 * step / 0.0167);
          else {
            const off = cam.position.clone().sub(orbit.target), d = off.length();
            const nd = THREE.MathUtils.clamp(d * Math.pow(z.dir > 0 ? 0.55 : 1 / 0.55, step / 0.35), 6, 2500);
            const next = orbit.target.clone().addScaledVector(off.normalize(), nd), col = this.getCollider();
            if (col && col.blocked(next.x, -next.z, 1.5, next.y)) this.zoomAnim = null;     // a tower in the way: stop there
            else cam.position.copy(next);
          }
        } else this.zoomAnim = null;
      }
      if (this.focus) {                                            // panned away from the building: stop orbiting it
        const [tx, ty] = this.toLocal(orbit.target);
        if (Math.hypot(tx - this.focus.x, ty - this.focus.y) > 60) this.focus = null;
      }
      if (this.turnLeft) {                                         // animated 30° turn
        const step = Math.sign(this.turnLeft) * Math.min(Math.abs(this.turnLeft), dt * 2.4);
        this.turnLeft -= step;
        if (this.low && !this.focus) this.rotateInPlace(step);
        else { const off = cam.position.clone().sub(orbit.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), step);
               cam.position.copy(orbit.target).add(off); cam.lookAt(orbit.target); }
      }
      const P = this.pad;
      if (P && this.low) {                                         // controller at street level: right stick looks, left stick moves
        if (P.rx || P.ry) this.rotateInPlace(-P.rx * dt * 2.2, -P.ry * dt * 1.6);
        if (P.ly) { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); f.y = 0; f.normalize();
          const d = f.multiplyScalar(-P.ly * 12 * dt);
          if (!this.blockedAhead?.(cam.position, d.clone().normalize(), d.length() + 1.2)) { cam.position.add(d); orbit.target.add(d); } }
      } else if (P && (P.lx || P.ly || P.rx)) {                    // above the city: left stick glides, right stick turns around the view centre
        const fwd = new THREE.Vector3().subVectors(orbit.target, cam.position); fwd.y = 0; fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x), sp = Math.min(450, Math.max(18, cam.position.distanceTo(orbit.target) * 1.4)) * dt;
        const mv = fwd.multiplyScalar(-P.ly * sp).add(right.multiplyScalar(P.lx * sp));
        cam.position.add(mv); orbit.target.add(mv);
        if (P.rx) { const off = cam.position.clone().sub(orbit.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), -P.rx * dt * 1.6);
          cam.position.copy(orbit.target).add(off); cam.lookAt(orbit.target); }
      }
      if (this.low) {
        // street level: ←/→ turn your head, ↑/↓ (W/S) move where you look; scroll keeps moving you forward
        if (keys.ArrowLeft || keys.KeyA) this.rotateInPlace(dt * 1.6);
        if (keys.ArrowRight || keys.KeyD) this.rotateInPlace(-dt * 1.6);
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); f.y = 0; f.normalize();
        const mvs = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
        if (mvs) { const d = f.clone().multiplyScalar(mvs * (keys.ShiftLeft || keys.ShiftRight ? 30 : 12) * dt);
                   if (!this.blockedAhead?.(cam.position, f.clone().multiplyScalar(mvs), d.length() + 1.2)) {
                     cam.position.add(d); orbit.target.add(d);
                   } }
        if (cam.position.distanceTo(orbit.target) < 20) {          // let scrolling carry on forward
          const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
          orbit.target.copy(cam.position).addScaledVector(fw, 20);
        }
        this.keepCameraSafe();
        return this.tail(dt);
      }
      // above the city: keys glide across the map; faster when zoomed out
      const fwd = new THREE.Vector3().subVectors(orbit.target, cam.position); fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const speed = Math.min(450, Math.max(18, cam.position.distanceTo(orbit.target) * 1.4)) * (keys.ShiftLeft || keys.ShiftRight ? 2.5 : 1);
      const mv = new THREE.Vector3();
      if (keys.KeyW || keys.ArrowUp) mv.add(fwd);
      if (keys.KeyS || keys.ArrowDown) mv.sub(fwd);
      if (keys.KeyD || keys.ArrowRight) mv.add(right);
      if (keys.KeyA || keys.ArrowLeft) mv.sub(right);
      if (mv.lengthSq()) { mv.normalize().multiplyScalar(speed * dt); cam.position.add(mv); orbit.target.add(mv); }
      this.keepCameraSafe();
    }
    this.tail(dt);
  }

  tail(dt) {
    const cam = this.camera;
    // tour auto-advance after a pause at each stop
    if (this.tour && !this.flight) { this.tour.wait += dt; if (this.tour.wait > 7) this.tourStep(1); }
    // waypoint chip: distance + arrow relative to where you are looking
    if (this.waypoint) {
      const [x, y] = this.toLocal(cam.position);
      const d = Math.hypot(this.waypoint.x - x, this.waypoint.y - y);
      const dirv = new THREE.Vector3(); cam.getWorldDirection(dirv);
      const heading = Math.atan2(dirv.x, -dirv.z), bearing = Math.atan2(this.waypoint.x - x, this.waypoint.y - y);
      document.querySelector("#wpchip .arrow").style.transform = `rotate(${bearing - heading}rad)`;
      document.getElementById("wptext").textContent = `${this.waypoint.place.name} · ${d < 1000 ? Math.round(d) + " m" : (d / 1000).toFixed(1) + " km"}`;
      this.beacon.children[0].material.opacity = 0.18 + 0.12 * Math.sin(performance.now() / 300);
      if (d < 18 && this.getMode() === "walk") this.setWaypoint(null);   // arrived on foot
    }
  }

  // never let the camera sit inside a building or below the street
  keepCameraSafe() {
    const col = this.getCollider(), cam = this.camera, tgt = this.orbit.target;
    if (cam.position.y < 1.2) cam.position.y = 1.2;
    if (tgt.y < 0) tgt.y = 0;
    if (!col) return;
    const inside = v => col.blocked(v.x, -v.z, 0.6, v.y);
    const to = cam.position.clone();
    if (inside(to)) {
      // walk from the target toward the camera; stop just before the first wall
      const from = tgt.clone(), p = new THREE.Vector3();
      let lo = 0, hi = 1;
      if (inside(from)) {
        if (this.safeCameraPosition) cam.position.copy(this.safeCameraPosition);
        else {
          let height = 8;
          while (height < 600 && col.blocked(from.x, -from.z, 0.6, height)) height *= 2;
          cam.position.y = Math.max(cam.position.y, height);
        }
      }
      else {
        for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; p.lerpVectors(from, to, m); if (inside(p)) hi = m; else lo = m; }
        cam.position.lerpVectors(from, to, Math.max(0, lo - 0.02));
      }
    } else if (this.safeCameraPosition) {
      const from = this.safeCameraPosition, distance = from.distanceTo(to);
      if (distance > 0.05 && distance <= 250) {
        const steps = Math.ceil(distance / 1.5), p = new THREE.Vector3();
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          p.lerpVectors(from, to, t);
          if (inside(p)) { cam.position.lerpVectors(from, to, Math.max(0, (i - 1) / steps)); break; }
        }
      }
    }
    this.safeCameraPosition = cam.position.clone();
  }
}
