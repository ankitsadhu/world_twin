// Full-screen city map that behaves like Google Maps, so nobody has to learn anything new:
//   drag = pan · scroll / pinch = zoom toward the pointer · double-click = zoom in · +/− buttons
//   click a place or anywhere = red pin + place card with "Go" / "Walk" · ✕ or Esc closes
// Street names are drawn along the streets and appear as you zoom in. Coordinates: Blender local metres.

import { ICON } from "./icons.js";
import { fmt, money } from "./business.js";

// pin colours by what a place is (the symbol says what, the colour says which kind). Blue is only ever you; yellow is business.
export const PIN_COLOR = { star: "#d93025", plane: "#8e44ad", ship: "#00838f", bike: "#e8710a", car: "#388e3c", flag: "#f59e0b", flagdone: "#2e9e4f", wolf: "#c79a12", race: "#f59e0b", trial: "#f59e0b", bolt: "#f59e0b", taxi: "#2e9e4f", burst: "#ef4a2f", siren: "#ef4a2f", ramp: "#ef4a2f", sboat: "#00838f", chute: "#8e44ad", firstride: "#ef4a2f" };   // landmark red, fly purple, sail teal, motorcycle orange, parked car green
export const pinColor = icon => PIN_COLOR[icon] || PIN_COLOR.star;
// the selected place's big pin takes its kind's colour too
const selColor = p => pinColor(p?.kind === "bike" ? "bike" : p?.kind === "airport" || p?.id === "intrepid" ? "plane" : p?.id === "pier83" ? "ship" : "star");

// place icons drawn as vector paths, centred exactly on the pin (text glyphs sit off-centre and vary by font)
export function drawPlaceIcon(c, kind, u, v, r) {
  const s = r * 0.62;
  c.save(); c.translate(u, v);
  c.fillStyle = "#fff"; c.strokeStyle = "#fff"; c.lineCap = "round"; c.lineJoin = "round";
  if (kind === "plane") {                                  // top-down airliner, nose up, centred on its middle
    c.beginPath();
    c.moveTo(0, -s);                                       // nose
    c.quadraticCurveTo(s * 0.16, -s * 0.9, s * 0.16, -s * 0.55);
    c.lineTo(s * 0.16, -s * 0.2); c.lineTo(s, s * 0.2); c.lineTo(s, s * 0.36); c.lineTo(s * 0.16, s * 0.14);
    c.lineTo(s * 0.12, s * 0.62); c.lineTo(s * 0.45, s * 0.86); c.lineTo(s * 0.45, s * 0.98); c.lineTo(0, s * 0.86);
    c.lineTo(-s * 0.45, s * 0.98); c.lineTo(-s * 0.45, s * 0.86); c.lineTo(-s * 0.12, s * 0.62);
    c.lineTo(-s * 0.16, s * 0.14); c.lineTo(-s, s * 0.36); c.lineTo(-s, s * 0.2); c.lineTo(-s * 0.16, -s * 0.2);
    c.lineTo(-s * 0.16, -s * 0.55); c.quadraticCurveTo(-s * 0.16, -s * 0.9, 0, -s);
    c.fill();
  } else if (kind === "ship") {                            // anchor: ring, shank, stock, curved arms with flukes
    c.lineWidth = Math.max(1.6, r * 0.16);
    c.beginPath(); c.arc(0, -s * 0.78, s * 0.2, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(0, -s * 0.58); c.lineTo(0, s * 0.92); c.stroke();
    c.beginPath(); c.moveTo(-s * 0.42, -s * 0.36); c.lineTo(s * 0.42, -s * 0.36); c.stroke();
    c.beginPath(); c.arc(0, s * 0.18, s * 0.74, Math.PI * 0.12, Math.PI * 0.88); c.stroke();
    for (const sx of [-1, 1]) {                            // flukes
      const x = sx * s * 0.74 * Math.cos(Math.PI * 0.12), y = s * 0.18 + s * 0.74 * Math.sin(Math.PI * 0.12);
      c.beginPath(); c.moveTo(x - sx * s * 0.02, y - s * 0.3); c.lineTo(x + sx * s * 0.14, y + s * 0.02); c.lineTo(x - sx * s * 0.24, y + s * 0.02);
      c.closePath(); c.fill();
    }
  } else if (kind === "bike") {                            // motorcycle, side view: two wheels, frame, seat, bars
    c.lineWidth = Math.max(1.4, r * 0.14);
    for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * s * 0.66, s * 0.38, s * 0.32, 0, Math.PI * 2); c.stroke(); }
    c.beginPath();
    c.moveTo(-s * 0.66, s * 0.38); c.lineTo(-s * 0.12, s * 0.38); c.lineTo(s * 0.26, -s * 0.18);        // rear axle, engine, tank
    c.lineTo(s * 0.52, -s * 0.34); c.lineTo(s * 0.66, s * 0.38);                                         // bars, fork to the front axle
    c.moveTo(-s * 0.5, -s * 0.12); c.lineTo(s * 0.2, -s * 0.12);                                          // seat
    c.stroke();
  } else if (kind === "flag" || kind === "flagdone") {      // a mission: a chequered pennant on a pole (a tick when done)
    c.lineWidth = Math.max(1.5, r * 0.15);
    c.beginPath(); c.moveTo(-s * 0.55, s * 0.95); c.lineTo(-s * 0.55, -s * 0.95); c.stroke();
    c.beginPath(); c.moveTo(-s * 0.55, -s * 0.9); c.lineTo(s * 0.9, -s * 0.45); c.lineTo(-s * 0.55, s * 0.05); c.closePath(); c.fill();
    if (kind === "flagdone") { c.strokeStyle = "#2e9e4f"; c.lineWidth = Math.max(1.2, r * 0.12); c.beginPath(); c.moveTo(-s * 0.2, -s * 0.45); c.lineTo(s * 0.1, -s * 0.28); c.lineTo(s * 0.5, -s * 0.62); c.stroke(); }
  } else if (kind === "race") {                           // chequered flag
    c.lineWidth = Math.max(1.5, r * 0.15); c.beginPath(); c.moveTo(-s * 0.7, s * 0.95); c.lineTo(-s * 0.7, -s * 0.9); c.stroke();
    const n = 4, w = s * 1.5 / n; for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) { if ((i + j) % 2 === 0) c.fillRect(-s * 0.7 + i * w, -s * 0.9 + j * w, w, w); }
  } else if (kind === "trial") {                          // stopwatch
    c.lineWidth = Math.max(1.5, r * 0.15); c.beginPath(); c.arc(0, s * 0.12, s * 0.7, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(0, s * 0.12); c.lineTo(s * 0.32, -s * 0.2); c.moveTo(0, s * 0.12); c.lineTo(0, -s * 0.38); c.stroke(); c.fillRect(-s * 0.16, -s * 0.95, s * 0.32, s * 0.2);
  } else if (kind === "bolt") {                           // boost: a lightning bolt
    c.beginPath(); c.moveTo(s * 0.15, -s); c.lineTo(-s * 0.55, s * 0.12); c.lineTo(-s * 0.05, s * 0.12); c.lineTo(-s * 0.2, s); c.lineTo(s * 0.6, -s * 0.15); c.lineTo(s * 0.05, -s * 0.15); c.closePath(); c.fill();
  } else if (kind === "taxi") {                           // taxi: car with a roof sign
    c.beginPath(); c.roundRect(-s * 0.85, -s * 0.1, s * 1.7, s * 0.7, s * 0.2); c.fill(); c.beginPath(); c.roundRect(-s * 0.45, -s * 0.5, s * 0.9, s * 0.45, s * 0.12); c.fill(); c.fillRect(-s * 0.2, -s * 0.8, s * 0.4, s * 0.22);
    for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * s * 0.5, s * 0.62, s * 0.2, 0, 7); c.fill(); }
  } else if (kind === "burst") {                          // crash: an impact star
    c.beginPath(); for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, rr = i % 2 ? s * 0.5 : s; c[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); c.fill();
  } else if (kind === "siren") {                          // heat: a police light
    c.beginPath(); c.arc(0, -s * 0.05, s * 0.55, Math.PI, 0); c.lineTo(s * 0.55, s * 0.4); c.lineTo(-s * 0.55, s * 0.4); c.closePath(); c.fill(); c.fillRect(-s * 0.8, s * 0.5, s * 1.6, s * 0.3);
    c.lineWidth = Math.max(1.2, r * 0.12); for (const a of [-2.2, -1.57, -0.94]) { c.beginPath(); c.moveTo(Math.cos(a) * s * 0.7, Math.sin(a) * s * 0.7 - s * 0.05); c.lineTo(Math.cos(a) * s * 1.0, Math.sin(a) * s * 1.0 - s * 0.05); c.stroke(); }
  } else if (kind === "ramp") {                           // stunt ramp
    c.beginPath(); c.moveTo(-s, s * 0.7); c.lineTo(s, s * 0.7); c.lineTo(s, -s * 0.6); c.closePath(); c.fill(); c.beginPath(); c.arc(-s * 0.2, -s * 0.8, s * 0.2, 0, 7); c.fill();
  } else if (kind === "sboat") {                          // speedboat, side view
    c.beginPath(); c.moveTo(-s, s * 0.1); c.lineTo(s * 0.95, s * 0.1); c.lineTo(s * 0.5, s * 0.6); c.lineTo(-s * 0.8, s * 0.6); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-s * 0.2, s * 0.1); c.lineTo(s * 0.1, -s * 0.45); c.lineTo(s * 0.5, s * 0.1); c.closePath(); c.fill();
  } else if (kind === "chute") {                          // parachute
    c.beginPath(); c.arc(0, -s * 0.15, s * 0.9, Math.PI, 0); c.closePath(); c.fill(); c.lineWidth = Math.max(1.1, r * 0.1);
    for (const x of [-0.8, 0, 0.8]) { c.beginPath(); c.moveTo(x * s * 0.9, -s * 0.15); c.lineTo(0, s * 0.8); c.stroke(); } c.fillRect(-s * 0.13, s * 0.75, s * 0.26, s * 0.22);
  } else if (kind === "wolf") {                           // a paw print
    c.beginPath(); c.ellipse(0, s * 0.35, s * 0.55, s * 0.45, 0, 0, 7); c.fill();
    for (const [x, y] of [[-0.75, -0.1], [-0.28, -0.6], [0.28, -0.6], [0.75, -0.1]]) { c.beginPath(); c.ellipse(x * s * 0.85, y * s, s * 0.2, s * 0.28, 0, 0, 7); c.fill(); }
  } else if (kind === "firstride") {                      // first ride: a chevron up
    c.lineWidth = Math.max(2, r * 0.22); c.beginPath(); c.moveTo(-s * 0.7, s * 0.35); c.lineTo(0, -s * 0.45); c.lineTo(s * 0.7, s * 0.35); c.stroke(); c.beginPath(); c.moveTo(-s * 0.7, s * 0.95); c.lineTo(0, s * 0.15); c.lineTo(s * 0.7, s * 0.95); c.stroke();
  } else if (kind === "car") {                            // top-down car: body, roof and wheels
    c.lineWidth = Math.max(1.4, r * 0.13);
    c.beginPath(); c.roundRect(-s * 0.42, -s * 0.82, s * 0.84, s * 1.64, s * 0.18); c.fill();
    c.fillStyle = "#388e3c";
    c.fillRect(-s * 0.28, -s * 0.35, s * 0.56, s * 0.7);
    c.fillStyle = "#fff";
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) c.fillRect(sx * s * 0.37 - s * 0.07, sy * s * 0.48 - s * 0.12, s * 0.14, s * 0.24);
  } else {                                                 // five-point star
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? s * 0.42 : s;
      c[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr + s * 0.06);
    }
    c.closePath(); c.fill();
  }
  c.restore();
}

// the small number on a mission pin (its place in the suggested order), a green tick when done, and a pulsing ring on the one you are tracking
export function drawBadge(c, u, v, r, m) {
  if (m.num == null) return;
  if (m.active) { const t = performance.now() / 500, k = 1 + 0.18 * Math.sin(t); c.beginPath(); c.arc(u, v, (r + 6) * k, 0, 7); c.strokeStyle = "#ffffff"; c.lineWidth = 3; c.stroke(); c.beginPath(); c.arc(u, v, (r + 6) * k, 0, 7); c.strokeStyle = "rgba(255,200,40,.9)"; c.lineWidth = 1.5; c.stroke(); }
  const bx = u + r * 0.78, by = v - r * 0.78, br = Math.max(6.5, r * 0.55);
  c.beginPath(); c.arc(bx, by, br, 0, 7); c.fillStyle = m.done ? "#2e9e4f" : "#111317"; c.fill(); c.lineWidth = 1.5; c.strokeStyle = "#fff"; c.stroke();
  c.fillStyle = "#fff"; c.font = `700 ${Math.round(br * 1.25)}px -apple-system, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(m.done ? "✓" : String(m.num), bx, by + 0.5);
}

export class CityMap {
  constructor({ root, district, camera, nav, onGo, onWalk, getSlot = () => null, onScreen = () => {}, onRide = null, onDirections = null,
    inCar = () => false, route = () => null, region = null, whereAmI = null, canLand = null }) {
    Object.assign(this, { root, district, camera, nav, onGo, onWalk, getSlot, onScreen, onRide, inCar, route, onDirections, region, whereAmI, canLand });
    this.isOpen = false;
    this.pointers = new Map();
    this.pin = null;
    this.buildDOM();
    fetch(`${root}export/${district}/map.json`).then(r => r.json()).then(d => {
      this.data = { ...d, midBounds: d.bounds };
      this.img = new Image();
      this.img.src = `${root}export/${district}/map.png`;
      this.img.onload = () => this.isOpen && this.draw();
      this.layers = [{ img: this.img, bounds: d.bounds, k: d.px_per_m, z: 2 }];
      const addLayer = L => {                              // region < harbour < Midtown; the map spans them all
        this.layers.push(L); this.layers.sort((a, b) => a.z - b.z);
        const b = this.layers.map(l => l.bounds);
        this.data.bounds = [Math.min(...b.map(q => q[0])), Math.min(...b.map(q => q[1])), Math.max(...b.map(q => q[2])), Math.max(...b.map(q => q[3]))];
        this.isOpen && this.draw();
      };
      // the harbour's layer goes underneath (Lower Manhattan, Jersey City, the islands); the map then spans both
      fetch(`${root}export/harbor/map.json`).then(r => r.json()).then(h => {
        const img = new Image(); img.src = `${root}export/harbor/map.webp`;
        img.onload = () => this.isOpen && this.draw();
        fetch(`${root}export/harbor/streets.json`).then(r => r.json()).then(st => { this.streets = st; }).catch(() => {});
        this.data = { ...this.data, labels: [...this.data.labels, ...h.labels], markers: [...this.data.markers, ...h.markers] };
        addLayer({ img, bounds: h.bounds, k: h.px_per_m, z: 1 });
      }).catch(() => {});
      this.region?.ready?.then(async () => {               // the wider region (streets, coast, airports) under everything
        const R = this.region.map;
        if (!R) return;
        const baked = await fetch(`${root}export/region/map.json`).then(r => r.ok ? r.json() : null).catch(() => null);
        if (baked) {                                       // overview + sharp tiles loaded when you zoom in
          const img = new Image(); img.src = `${root}export/region/${baked.overview.file}`;
          img.onload = () => this.isOpen && this.draw();
          this.regionTiles = baked.tiles.map(t => ({ ...t, url: `${root}export/region/${t.file}`, img: null }));
          this.regionTileK = baked.tile_px_per_m;
          addLayer({ img, bounds: baked.bounds, k: baked.overview.px_per_m, z: 0, tiles: this.regionTiles, tk: baked.tile_px_per_m });
          this.data.labels = [...this.data.labels, ...baked.labels.filter(l => !this.coveredByDetail(l.x, l.y))];
        } else addLayer({ img: R.img, bounds: R.bounds, k: R.px_per_m, z: 0 });
        this.data.markers = [...this.data.markers, ...this.region.airports.map(A => ({ id: "apt_" + A.code, icon: "plane",
          label: A.name.replace(/ (Liberty )?(International )?Airport$/, "") + " Airport", x: A.center[0], y: A.center[1] }))];
      });
    });
  }

  buildDOM() {
    const css = document.createElement("style");
    css.textContent = `
      #citymap { position: fixed; inset: 0; z-index: 60; display: none; background: #16191e; touch-action: none; }
      #citymap canvas { width: 100%; height: 100%; display: block; cursor: grab; }
      #citymap canvas.dragging { cursor: grabbing; }
      #citymap .close { position: absolute; top: var(--s4); left: var(--s4); display: inline-flex; align-items: center; gap: var(--s2); }
      #citymap .zoom { position: absolute; right: var(--s4); bottom: 140px; display: flex; flex-direction: column; padding: var(--s1); gap: 2px; }
      #citymap .card { position: absolute; left: 50%; bottom: var(--s5); transform: translateX(-50%); width: min(440px, calc(100% - 32px));
               box-sizing: border-box; padding: var(--s4) var(--s5); display: none; }
      #citymap .card h3 { margin: 0 0 var(--s1); font-size: var(--t-headline); font-weight: var(--w-semibold); }
      #citymap .card p { margin: 0 0 var(--s4); color: var(--ink-2); font-size: var(--t-caption); }
      #citymap .card .acts { display: flex; flex-wrap: wrap; gap: var(--s2); align-items: center; }
      #citymap .card .acts .ui-btn { white-space: nowrap; }
      #citymap .card .x { margin-left: auto; width: var(--hit); padding: 0; display: grid; place-items: center; }
      #citymap .note { position: absolute; top: 22px; left: 50%; transform: translateX(-50%); color: var(--ink-2); font-size: var(--t-caption);
               padding: var(--s1) var(--s3); border-radius: 999px; pointer-events: none; }
      #citymap .card .list { display: none; flex-direction: column; gap: 2px; max-height: 38vh; overflow: auto; margin: 0 0 var(--s3); }
      #citymap .card .list button { display: flex; align-items: center; gap: var(--s2); min-height: var(--hit); padding: 0 var(--s3); border: none;
        border-radius: var(--r-control); background: var(--fill); color: var(--ink); font: var(--w-semibold) var(--t-body) var(--font); text-align: left; cursor: pointer; }
      #citymap .card .list button { padding-top: 6px; padding-bottom: 6px; }
      #citymap .card .list small { display: block; color: var(--ink-3); font-size: var(--t-caption); font-weight: var(--w-regular);
        overflow: hidden; text-overflow: ellipsis; }
      #citymap .card .list button:hover { background: var(--fill-hover); }
      #citymap .card .list button span:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #citymap .card .chips { display: flex; gap: var(--s1); margin: 0 0 var(--s3); flex-wrap: wrap; }
      @media (max-width: 640px) { #citymap .note { display: none; } }`;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML("beforeend", `
      <div id="citymap"><canvas></canvas>
        <button class="close ui-btn ui-surface" aria-label="Close map (Esc)">${ICON.close}Close</button>
        <div class="note ui-surface">Select a place to explore it or plan how to get there</div>
        <div class="zoom ui-surface"><button class="dockbtn" data-z="in" aria-label="Zoom in">${ICON.plus}</button>
          <button class="dockbtn" data-z="out" aria-label="Zoom out">${ICON.minus}</button>
          <button class="dockbtn" data-z="me" aria-label="Show my location">${ICON.locate}</button></div>
        <div class="card ui-surface" role="dialog"><h3></h3><p></p><div class="chips"></div><div class="list"></div><div class="acts"><button class="go ui-btn primary">Go</button>
          <button class="dirs ui-btn">Directions</button><button class="walk ui-btn">Walk here</button><button class="ride ui-btn">Ride</button><button class="x ui-btn" aria-label="Close">${ICON.close}</button></div></div></div>`);
    const el = this.el = document.getElementById("citymap");
    this.cv = el.querySelector("canvas");
    this.ctx = this.cv.getContext("2d");
    this.card = el.querySelector(".card");
    el.querySelector(".close").onclick = () => this.close();
    el.querySelector('[data-z="in"]').onclick = () => this.zoomAt(1.6);
    el.querySelector('[data-z="out"]').onclick = () => this.zoomAt(1 / 1.6);
    el.querySelector('[data-z="me"]').onclick = () => { const [x, y] = this.me(); this.cx = x; this.cy = y; this.clamp(); this.draw(); };
    this.card.querySelector(".x").onclick = () => this.select(null);
    this.card.querySelector(".go").onclick = () => {
      const p = this.pin; this.close();
      if (p.kind === "ad") this.onScreen(p.id); else this.onGo(p);
    };
    this.card.querySelector(".walk").onclick = () => { const p = this.pin; this.close(); this.onWalk(p); };
    this.card.querySelector(".ride").onclick = () => { const p = this.pin; this.close(); this.onRide?.(p); };   // book a self-driving cab there
    this.card.querySelector(".dirs").onclick = () => { const p = this.pin; this.close(); this.onDirections?.(p); };   // multi-mode routes
    this.cv.addEventListener("wheel", e => { e.preventDefault(); this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); },
      { passive: false });
    this.cv.addEventListener("dblclick", e => { clearTimeout(this.tapTimer); this.zoomAt(2, e.offsetX, e.offsetY); });
    this.cv.addEventListener("pointerdown", e => this.onDown(e));
    this.cv.addEventListener("pointermove", e => { this.onMove(e); this.hover(e); });
    this.cv.addEventListener("pointerleave", () => this.hideTip());
    this.cv.addEventListener("pointerup", e => this.onUp(e));
    this.cv.addEventListener("pointercancel", e => this.pointers.delete(e.pointerId));
    addEventListener("resize", () => this.isOpen && this.resize());
    addEventListener("keydown", e => { if (this.isOpen && e.key === "Escape") { e.stopPropagation(); this.close(); } }, true);
  }

  // ---------------------------------------------------------------- open / close
  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    if (!this.data) return;
    this.isOpen = true;
    this.el.style.display = "block";
    document.getElementById("wpchip")?.style.setProperty("visibility", "hidden");
    this.resize();
    const [x, y] = this.me();
    this.cx = x; this.cy = y;
    const [m0, n0, m1, n1] = this.data.midBounds || this.data.bounds;
    const away = x < m0 - 1500 || x > m1 + 1500 || y < n0 - 9000 || y > n1 + 1500;   // out past Midtown and the harbour
    this.s = Math.max(this.minScale(), away ? 0.06 : 0.9);   // start zoomed to the neighbourhood around you (or the region)
    this.el.querySelector(".note").textContent = this.nav.showAds ? "Tap a blue screen marker to preview it" : "Tap a place to see it";
    this.select(null);
    this.clamp(); this.draw();
  }
  close() {
    this.hideTip();
    this.isOpen = false;
    this.el.style.display = "none";
    document.getElementById("wpchip")?.style.removeProperty("visibility");
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = this.cv.clientWidth; this.H = this.cv.clientHeight;
    this.cv.width = this.W * dpr; this.cv.height = this.H * dpr;
    this.dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.s) { this.s = Math.max(this.s, this.minScale()); this.clamp(); this.draw(); }
  }

  me() { return this.whereAmI?.() || [this.camera.position.x, -this.camera.position.z]; }   // the plane / boat / you, not the camera

  // ---------------------------------------------------------------- view maths
  minScale() {                                         // map always fills the screen (no void)
    const [x0, y0, x1, y1] = this.data.bounds;
    return Math.max(this.W / (x1 - x0), this.H / (y1 - y0));
  }
  clamp() {
    const [x0, y0, x1, y1] = this.data.bounds;
    this.s = Math.min(6, Math.max(this.minScale(), this.s));
    const hw = this.W / 2 / this.s, hh = this.H / 2 / this.s;
    this.cx = Math.min(x1 - hw, Math.max(x0 + hw, this.cx));
    this.cy = Math.min(y1 - hh, Math.max(y0 + hh, this.cy));
  }
  toScreen(x, y) { return [this.W / 2 + (x - this.cx) * this.s, this.H / 2 - (y - this.cy) * this.s]; }
  toWorld(u, v) { return [this.cx + (u - this.W / 2) / this.s, this.cy - (v - this.H / 2) / this.s]; }
  zoomAt(f, u = this.W / 2, v = this.H / 2) {
    const [wx, wy] = this.toWorld(u, v);
    this.s *= f; this.clamp();
    const [nx, ny] = this.toWorld(u, v);               // keep the point under the cursor fixed
    this.cx += wx - nx; this.cy += wy - ny; this.clamp(); this.draw();
  }

  // ---------------------------------------------------------------- pointer: pan, pinch, tap
  onDown(e) {
    this.cv.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY });
    this.moved = 0;
    if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  }
  // hovering a pin (mouse): a tooltip with what it is; missions show their number, kind, level, place, pitch and state
  hover(e) {
    if (e.pointerType !== "mouse" || e.buttons) return this.hideTip();
    let best = null, bd = 16;
    for (const h of this.hits || []) { const d = Math.hypot(h.u - e.offsetX, h.v - e.offsetY); if (d < bd) { bd = d; best = h; } }
    this.cv.style.cursor = best ? "pointer" : "";
    if (!best) return this.hideTip();
    const m = best.m, esc = t => String(t ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const html = m.mission
      ? `<b>${m.num}. ${esc(m.name)}</b><br><span>${esc(m.cat)} · level ${m.level} · ${esc(m.zone)}</span><br>${esc(m.pitch)}<br><em>${m.done ? "Done ✓" : m.active ? "Tracking" : "Tap for options"}</em>`
      : `<b>${esc(m.label)}</b>`;
    if (!this.tip) {
      this.tip = document.createElement("div");
      this.tip.style.cssText = "position:absolute;z-index:5;pointer-events:none;max-width:260px;padding:8px 10px;border-radius:10px;background:rgba(14,15,18,.94);color:#fff;font:500 12px/1.35 system-ui,sans-serif;border:1px solid rgba(255,255,255,.2);box-shadow:0 6px 20px rgba(0,0,0,.4);display:none";
      this.cv.parentElement.appendChild(this.tip);
    }
    const t = this.tip; t.innerHTML = html; t.style.display = "block";
    const W = this.cv.clientWidth, x = Math.min(e.offsetX + 16, W - t.offsetWidth - 8), y = Math.max(8, e.offsetY - t.offsetHeight - 14);
    t.style.left = Math.max(8, x) + "px"; t.style.top = y + "px";
  }
  hideTip() { if (this.tip) this.tip.style.display = "none"; if (this.cv) this.cv.style.cursor = ""; }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
    p.x = e.offsetX; p.y = e.offsetY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch) this.zoomAt(d / this.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinch = d;
      return;
    }
    if (this.moved > 4) this.cv.classList.add("dragging");
    this.cx -= dx / this.s; this.cy += dy / this.s; this.clamp(); this.draw();
  }
  onUp(e) {
    this.pointers.delete(e.pointerId);
    this.cv.classList.remove("dragging");
    if (this.pointers.size === 0 && this.moved < 6 && e.detail < 2) {
      const [u, v] = [e.offsetX, e.offsetY];        // wait: a second click means "zoom in", not "select"
      clearTimeout(this.tapTimer);
      this.tapTimer = setTimeout(() => this.tap(u, v), e.pointerType === "touch" ? 0 : 230);
    }
    if (this.pointers.size < 2) this.pinch = null;
  }

  // ---------------------------------------------------------------- selecting places
  tap(u, v) {
    for (const h of this.slotHits || []) {             // business view: screens (single) and screen groups
      if (Math.hypot(h.u - u, h.v - v) > (h.ids.length > 1 ? 24 : 20)) continue;
      if (h.ids.length > 1) {                          // a group: zoom in to split it, or list screens stacked on one tower
        const pts = h.ids.map(id => this.data.markers.find(q => q.id === id));
        const spread = Math.max(...pts.map(a => Math.max(...pts.map(b => Math.hypot(a.x - b.x, a.y - b.y)))));
        if (spread < 14 || this.s >= 5.5) return this.selectGroup(h.ids);
        this.select(null); return this.zoomAt(2.4, h.u, h.v);
      }
      return this.selectScreen(h.ids[0]);
    }
    for (const h of this.hits || []) {                 // landmark / transport pins first
      if (Math.hypot(h.u - u, h.v - v) < 18) return this.select(this.placeFor(h.m));
    }
    const [x, y] = this.toWorld(u, v);
    let best = null, bd = 45;
    for (const p of this.nav.places || []) {
      if (p.kind === "ad") continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd && (p.kind !== "intersection" || d < 25)) { bd = d; best = p; }
    }
    if (best) return this.select(best);
    const mid = this.data.midBounds || this.data.bounds;
    const inMid = x > mid[0] && x < mid[2] && y > mid[1] && y < mid[3];
    const near = inMid ? this.nearestIntersection(x, y) : this.nearestStreets(x, y);
    this.select({ id: "pin", kind: "point", name: "Dropped pin", sub: near ? `Near ${near.name}` : "",
      x, y, eye: [x + 20, y - 95, 60], target: [x, y, 5] });
  }
  placeFor(m) {
    const byName = (this.nav.places || []).find(p => p.kind === "landmark" && (p.id === m.id || p.name === m.label));
    return byName || { id: m.id, name: m.label, kind: m.id?.startsWith("apt_") ? "airport" : m.id?.startsWith("bike_") ? "bike"
      : m.id?.startsWith("vehicle_") ? "vehicle" : "point", x: m.x, y: m.y, eye: [m.x + 20, m.y - 90, 55], target: [m.x, m.y, 8] };
  }
  focusMarker(marker) {
    if (!this.data || !marker) return;
    this.open();
    this.cx = marker.x; this.cy = marker.y;
    this.s = Math.max(this.minScale(), 0.9);
    this.clamp();
    this.select(this.placeFor(marker));
    this.draw();
  }
  // outside Times Square: the two nearest named harbour streets ("West St & Chambers St"), or the area it's in
  nearestStreets(x, y) {
    const st = this.streets;
    if (st) {
      const d = new Map();
      for (const ln of st.lines) {
        let m = Infinity;
        for (let i = 1; i + 3 < ln.length; i += 2) {
          const ax = ln[i], ay = ln[i + 1], bx = ln[i + 2] - ax, by = ln[i + 3] - ay, L = bx * bx + by * by;
          const t = L ? Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / L)) : 0;
          m = Math.min(m, Math.hypot(x - ax - bx * t, y - ay - by * t));
        }
        const n = st.names[ln[0]];
        if (m < (d.get(n) ?? Infinity)) d.set(n, m);
      }
      const [a, b] = [...d].filter(e => e[1] < 150).sort((p, q) => p[1] - q[1]);
      if (a) return { name: b && b[1] < 90 ? `${a[0]} & ${b[0]}` : a[0] };
    }
    let best = null, bd = 1500;
    for (const l of this.data.labels) {
      if (l.kind !== "area" && l.kind !== "island" && l.kind !== "area_water" && l.kind !== "water") continue;
      const dd = Math.hypot(l.x - x, l.y - y);
      if (dd < bd) { bd = dd; best = l; }
    }
    return best && { name: best.text };
  }
  nearestIntersection(x, y) {
    let best = null, bd = Infinity;
    for (const p of this.nav.places || []) {
      if (p.kind !== "intersection") continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  selectScreen(id) {
    const m = this.data.markers.find(q => q.id === id), s = this.getSlot(id) || {};
    this.select({ id, kind: "ad", name: s.title || "Screen", x: m.x, y: m.y,
      sub: [s.size, s.faces && `faces ${s.faces}`].filter(Boolean).join(" · "),
      chips: [s.band && [s.band, "biz"], s.price_month_usd && [`${money(s.price_month_usd)} / month`, ""],
        s.daily_audience && [`${fmt(s.daily_audience)} people / day`, ""], [s.status === "available" ? "Available" : "Booked", s.status === "available" ? "good" : ""]].filter(Boolean) });
  }
  selectGroup(ids) {
    const slots = ids.map(id => ({ id, s: this.getSlot(id) || {} })).sort((a, b) => (b.s.price_month_usd || 0) - (a.s.price_month_usd || 0));
    const m = this.data.markers.find(q => q.id === ids[0]);
    const where = (slots[0].s.title || "").split(/ · | at /).pop();
    const row = s => [(s.title || "Screen").split(" · ")[0], s.height_above_street_m != null && `${Math.round(s.height_above_street_m)} m up`]
      .filter(Boolean).join(" · ");                                   // screens on one tower differ by height and side
    this.select({ id: "group", kind: "group", name: `${ids.length} screens here`, sub: where, x: m.x, y: m.y });
    const list = this.card.querySelector(".list");
    list.innerHTML = slots.map(({ id, s }) => `<button data-id="${id}"><span>${row(s)}${s.faces ? `<small>faces ${s.faces}</small>` : ""}</span>
      <span class="ui-chip">${s.price_month_usd ? money(s.price_month_usd) + "/mo" : ""}</span></button>`).join("");
    list.style.display = "flex";
    list.querySelectorAll("button").forEach(b => b.onclick = () => this.selectScreen(b.dataset.id));
    this.card.querySelector(".acts .go").style.display = "none";
  }
  select(p) {
    this.pin = p;
    this.card.querySelector(".list").style.display = "none";
    this.card.querySelector(".acts .go").style.display = "";
    const chips = this.card.querySelector(".chips");
    chips.innerHTML = (p?.chips || []).map(([t, k]) => `<span class="ui-chip ${k}">${t}</span>`).join("");
    chips.style.display = p?.chips ? "flex" : "none";
    if (!p) { this.card.style.display = "none"; this.draw(); return; }
    const ad = p.kind === "ad" || p.kind === "group", car = this.inCar();
    this.card.querySelector(".go").textContent = ad ? "View screen" : car ? "Drive here" : "Explore here";
    const harbour = !(p.x > -1750 && p.x < 960 && p.y > -720 && p.y < 740);   // beyond Midtown's roads: by boat or plane
    this.card.querySelector(".walk").style.display = ad || harbour ? "none" : "";
    this.card.querySelector(".dirs").style.display = ad || !this.onDirections || p.id?.startsWith("apt_") || p.id?.startsWith("bike_") ? "none" : "";
    const bike = p.id?.startsWith("bike_");                          // a parked motorcycle: walk to it and get on
    const land = p.id?.startsWith("apt_") && this.canLand?.();      // an airport, while you're flying: land there
    const parkedCar = p.id?.startsWith("vehicle_");
    const parkedVehicleAvailable = !car && (bike || parkedCar);
    const fly = p.id === "intrepid" || p.id === "pier83" || land || parkedVehicleAvailable;    // aircraft, boat, and nearby parked vehicles
    this.card.querySelector(".ride").style.display = fly ? "" : ad || harbour || !this.onRide || car ? "none" : "";
    this.card.querySelector(".ride").textContent = bike ? "Ride it" : parkedCar ? "Get in" : land ? "✈ Land here" : p.id === "intrepid" ? "✈ Fly a plane" : p.id === "pier83" ? "⚓ Take the helm" : "Book a cab";
    this.card.querySelector(".go").style.display = land || bike ? "none" : "";
    if (bike) this.card.querySelector(".walk").style.display = "none";
    const [x, y] = this.me(), d = Math.hypot(p.x - x, p.y - y);
    const dist = d < 1000 ? `${Math.round(d / 10) * 10} m away` : `${(d / 1000).toFixed(1)} km away`;
    const kind = { landmark: "Landmark", intersection: "Intersection", building: "Building", point: "Location", airport: "Airport",
      bike: "Parked cruiser", vehicle: "Parked vehicle", ad: "Screen", group: "Screens" }[p.kind] || "";
    this.card.querySelector("h3").textContent = p.name;
    this.card.querySelector("p").textContent = [kind, p.sub, dist].filter(Boolean).join(" · ");
    this.card.querySelector(".walk").textContent = (this.inCar() ? "Get out & walk" : "Walk here") + (d < 1500 ? ` · ${Math.max(1, Math.round(d / 80))} min` : "");
    this.card.style.display = "block";
    // keep the selected place visible above the card (Google Maps pans the same way)
    const [, v] = this.toScreen(p.x, p.y), safe = this.H - this.card.offsetHeight - 70;
    if (v > safe || v < 60) { this.cy += (Math.min(safe, Math.max(60, this.H * 0.4)) - v) / this.s; this.clamp(); }
    this.draw();
  }

  // ---------------------------------------------------------------- drawing
  draw() {
    if (!this.isOpen || !this.data || !this.img?.complete) return;
    const c = this.ctx;
    c.fillStyle = "#16191e"; c.fillRect(0, 0, this.W, this.H);          // beyond the maps
    const dpr = this.dpr;
    for (const L of this.layers || []) {                                  // harbour first, Times Square's detail on top
      if (!L.img.complete) continue;
      const [x0, , , y1] = L.bounds, k = L.k;
      c.save();
      c.setTransform(dpr * this.s / k, 0, 0, dpr * this.s / k, dpr * (this.W / 2 - (this.cx - x0) * this.s),
        dpr * (this.H / 2 - (y1 - this.cy) * this.s));
      c.imageSmoothingQuality = "high";
      c.drawImage(L.img, 0, 0);
      c.restore();
      if (L.tiles && this.s > L.k * 1.5) this.drawTiles(c, L.tiles, L.tk);   // zoomed in past the overview: sharp tiles
    }
    this.taken = [];
    this.hits = [];
    const [mu, mv] = this.toScreen(...this.me());
    this.taken.push([mu, mv, 22, 22]);             // reserve the "you" dot, draw it last (on top)
    const sel = this.pin || this.nav.waypoint;     // and the selected place's big pin: labels go around it, not under it
    this.selUV = sel ? this.toScreen(sel.x, sel.y) : null;
    if (this.selUV) this.taken.push([this.selUV[0], this.selUV[1] - 20, 30, 46]);
    this.drawRoute();
    this.drawMarkers();            // place names claim space first (as in Google Maps), streets fill around them
    this.drawStreetLabels();
    this.drawMe();
    if (this.pin) this.drawPin(this.pin.x, this.pin.y, selColor(this.pin));
    else if (this.nav.waypoint) this.drawPin(this.nav.waypoint.x, this.nav.waypoint.y, selColor(this.nav.waypoint.place));
  }

  // the region's detail tiles in view (each loaded the first time it's needed)
  drawTiles(c, tiles, k) {
    const dpr = this.dpr, [vx0, vy0] = this.toWorld(0, this.H), [vx1, vy1] = this.toWorld(this.W, 0);
    for (const t of tiles) {
      const [x0, y0, x1, y1] = t.bounds;
      if (x1 < vx0 || x0 > vx1 || y1 < vy0 || y0 > vy1) continue;
      if (!t.img) { t.img = new Image(); t.img.onload = () => this.isOpen && this.draw(); t.img.src = t.url; }
      if (!t.img.complete || !t.img.naturalWidth) continue;
      c.save();
      c.setTransform(dpr * this.s / k, 0, 0, dpr * this.s / k, dpr * (this.W / 2 - (this.cx - x0) * this.s), dpr * (this.H / 2 - (y1 - this.cy) * this.s));
      c.drawImage(t.img, 0, 0);
      c.restore();
    }
  }
  coveredByDetail(x, y) {                               // inside Midtown's or the harbour's own map: their names win
    return this.layers.some(L => L.z > 0 && x > L.bounds[0] && x < L.bounds[2] && y > L.bounds[1] && y < L.bounds[3]);
  }

  label(text, u, v, { angle = 0, size = 13, color = "#eef0f4", weight = 600 } = {}) {
    const c = this.ctx;
    c.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const w = c.measureText(text).width + 8, h = size + 6;
    const vertical = Math.abs(Math.sin(angle)) > 0.7;
    const bw = vertical ? h : Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h;
    const bh = vertical ? w : Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * h;
    if (u - bw / 2 < 0 || v - bh / 2 < 0 || u + bw / 2 > this.W || v + bh / 2 > this.H) return false;
    if (this.taken.some(t => Math.abs(t[0] - u) < (t[2] + bw) / 2 && Math.abs(t[1] - v) < (t[3] + bh) / 2)) return false;
    this.taken.push([u, v, bw, bh]);
    c.save(); c.translate(u, v); c.rotate(angle);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.lineWidth = 3.5; c.strokeStyle = "rgba(14,16,20,.92)"; c.lineJoin = "round";
    c.strokeText(text, 0, 0); c.fillStyle = color; c.fillText(text, 0, 0);
    c.restore();
    return true;
  }

  drawStreetLabels() {
    const d = this.data, s = this.s;
    const avenues = d.labels.filter(l => l.kind === "avenue").sort((a, b) => a.x - b.x);
    const streets = d.labels.filter(l => l.kind === "street").sort((a, b) => a.y - b.y);
    const [vx0, vy1] = this.toWorld(0, 0), [vx1, vy0] = this.toWorld(this.W, this.H);
    const mids = (arr, key, lo, hi) => {                 // block midpoints inside the view, nearest the centre first
      const out = [];
      for (let i = 0; i < arr.length - 1; i++) { const m = (arr[i][key] + arr[i + 1][key]) / 2; if (m > lo && m < hi) out.push(m); }
      return out;
    };
    const centreOut = (vals, c) => vals.sort((a, b) => Math.abs(a - c) - Math.abs(b - c));
    // Broadway along its diagonal (always, it's the spine of the neighbourhood)
    const bw = d.paths?.Broadway;
    if (bw && s > 0.25) {
      for (let i = 0; i < bw.length - 1; i++) {
        const [ax, ay] = bw[i], [bx, by] = bw[i + 1];
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        if (mx < vx0 || mx > vx1 || my < vy0 || my > vy1) continue;
        const [u, v] = this.toScreen(mx, my);
        let ang = Math.atan2(-(by - ay), bx - ax);
        if (Math.cos(ang) < 0) ang += Math.PI;
        this.label("Broadway", u, v, { angle: ang, size: 14, color: "#ffd27a", weight: 700 });
      }
    }
    // one label per ~260 px of screen at most: never two copies of a name stacked on neighbouring blocks
    const spaced = (vals, minPx, n) => { const out = []; for (const v of vals) if (out.every(o => Math.abs(o - v) * s >= minPx)) { out.push(v); if (out.length >= n) break; } return out; };
    // avenues: vertical text along the avenue
    if (s > 0.22) {
      const ys = spaced(centreOut(mids(streets, "y", vy0, vy1), this.cy), 260, s > 1 ? 3 : 2);
      for (const a of avenues) {
        if (a.x < vx0 || a.x > vx1) continue;
        for (const y of ys) {
          if (a.ymin != null && y < a.ymin) continue;            // only where the avenue actually runs straight
          const [u, v] = this.toScreen(a.x, y); this.label(a.text, u, v, { angle: -Math.PI / 2, size: 13 });
        }
      }
    }
    // streets: horizontal text along the street, only when zoomed in enough to read the grid
    if (s > 0.45) {
      const xs = spaced(centreOut(mids(avenues, "x", vx0, vx1), this.cx), 260, s > 1 ? 3 : 2);
      for (const st of streets) {
        if (st.y < vy0 || st.y > vy1) continue;
        for (const x of xs) { const [u, v] = this.toScreen(x, st.y); this.label(st.text, u, v, { size: 12 }); }
      }
    }
    for (const l of d.labels.filter(l => l.kind === "water")) {
      const [u, v] = this.toScreen(l.x, l.y);
      this.label(l.text, u, v, { angle: -Math.PI / 2, size: 15, color: "#8fc3ff", weight: 500 });
    }
    const roads = d.labels.filter(l => l.kind === "road" && s > (l.major ? 0.3 : 0.6)).sort((a, b) => (b.major ? 1 : 0) - (a.major ? 1 : 0));
    for (const l of roads) {                                       // harbour street names; major roads claim space first
      const [u, v] = this.toScreen(l.x, l.y);
      let a = -l.angle; if (Math.cos(a) < 0) a += Math.PI;
      this.label(l.text, u, v, { angle: a, size: 12 });
    }
    const MIN_S = [0, 0, 0.02, 0.035, 0.09, 0.12];                     // region names: boroughs always, neighbourhoods close up
    for (const l of d.labels.filter(l => l.kind === "area_water" || l.kind === "area" || l.kind === "island").sort((a, b) => (a.rank ?? -1) - (b.rank ?? -1))) {
      if (l.kind === "island" && s < 0.12) continue;                   // harbour place names, horizontal
      if (l.rank != null && s < (MIN_S[l.rank] ?? 0.12)) continue;
      const [u, v] = this.toScreen(l.x, l.y);
      this.label(l.text, u, v, l.kind === "area_water" ? { size: 15, color: "#8fc3ff", weight: 500 }
        : l.kind === "island" ? { size: 12, color: "#cfe8c9", weight: 600 } : { size: 13, color: "#c9ccd2", weight: 600 });
    }
  }

  drawMarkers() {
    const c = this.ctx;
    this.slotHits = [];
    if (this.nav.showAds) this.drawScreens();
    const pins = this.data.markers.filter(m => m.icon !== "slot");
    for (const m of pins) {
      const [u, v] = this.toScreen(m.x, m.y);
      if (m.hidden || (m.minS && this.s < m.minS)) continue;          // a ridden bike; bike pins only at neighbourhood zoom
      if (u < -20 || v < -20 || u > this.W + 20 || v > this.H + 20) continue;
      if (this.selUV && Math.hypot(u - this.selUV[0], v - this.selUV[1]) < 6) continue;   // it's under the big pin
      const col = pinColor(m.icon);                      // coloured by kind (its symbol says what); blue = only you
      c.beginPath(); c.arc(u, v, 11, 0, 7); c.fillStyle = col; c.fill();
      c.lineWidth = 2; c.strokeStyle = "#fff"; c.stroke();
      drawPlaceIcon(c, m.icon, u, v, 11); drawBadge(c, u, v, 11, m);
      this.taken.push([u, v, 24, 24]);
      this.hits.push({ u, v, m });
    }
    {                                                    // names beside the pins, skipped when they would collide
      for (const h of this.hits) {
        if (this.s <= 0.3 && !h.m.id?.startsWith("apt_")) continue;   // zoomed out: only the airports keep a name
        const c2 = this.ctx; c2.font = "600 13px -apple-system, sans-serif";
        const w = c2.measureText(h.m.label).width;
        this.label(h.m.label, h.u + 16 + w / 2, h.v, { size: 13, color: "#ffffff" }) ||
          this.label(h.m.label, h.u - 16 - w / 2, h.v, { size: 13, color: "#ffffff" }) ||
          this.label(h.m.label, h.u, h.v - 22, { size: 13, color: "#ffffff" });
      }
    }
  }

  // business view: every sellable screen as a yellow dot; dots that would overlap merge into a counted bubble
  drawScreens() {
    const c = this.ctx, groups = [];
    for (const m of this.data.markers) {                  // greedy: join the first group whose centre is within 32 px
      if (m.icon !== "slot") continue;
      const [u, v] = this.toScreen(m.x, m.y);
      if (u < -20 || v < -20 || u > this.W + 20 || v > this.H + 20) continue;
      const g = groups.find(g => Math.hypot(g.u - u, g.v - v) < 32);
      if (g) { g.ids.push(m.id); g.su += u; g.sv += v; } else groups.push({ u, v, su: u, sv: v, ids: [m.id] });
    }
    const sel = this.pin?.kind === "ad" ? this.pin.id : null;
    for (const g of groups) {
      g.u = g.su / g.ids.length; g.v = g.sv / g.ids.length;
      const hc = document.body.classList.contains("contrast");          // high-contrast markers (Settings)
      const many = g.ids.length > 1, r = (many ? 14 : 9) + (hc ? 3 : 0), on = g.ids.includes(sel);
      c.beginPath(); c.arc(g.u, g.v, r + (on ? 3 : 0), 0, 7); c.fillStyle = "#64d2ff"; c.fill();
      c.lineWidth = hc ? 4 : 2.5; c.strokeStyle = on || hc ? "#ffffff" : "#1c1c1e"; c.stroke();
      if (many) {
        c.fillStyle = "#1c1c1e"; c.font = "700 12px -apple-system, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(String(g.ids.length), g.u, g.v + 0.5);
      } else { c.fillStyle = "#1c1c1e"; c.fillRect(g.u - 4, g.v - 3, 8, 5.5); }          // tiny screen glyph
      this.taken.push([g.u, g.v, r * 2, r * 2]);
      this.slotHits.push(g);
    }
  }

  // the route your cab is driving (or coming along), in Google Maps blue, with the cab at its start
  drawRoute() {
    const info = this.route?.();
    if (!info?.route || info.route.length < 2) return;
    const c = this.ctx;
    c.save(); c.lineJoin = c.lineCap = "round";
    c.beginPath(); info.route.forEach(([x, y], i) => { const [u, v] = this.toScreen(x, y); i ? c.lineTo(u, v) : c.moveTo(u, v); });
    c.lineWidth = 9; c.strokeStyle = "#1a5fd1"; c.stroke();
    c.lineWidth = 6; c.strokeStyle = "#4285f4"; c.stroke();
    c.restore();
    if (!this.inCar()) {                                           // a booked cab on its way: show where it is
      const [u, v] = this.toScreen(...info.car);
      c.beginPath(); c.roundRect(u - 9, v - 9, 18, 18, 5); c.fillStyle = "#ffcc00"; c.fill(); c.lineWidth = 2.5; c.strokeStyle = "#1c1c1e"; c.stroke();
    }
  }

  drawMe() {                                             // blue dot + heading cone (Google style)
    const c = this.ctx, [x, y] = this.me(), [u, v] = this.toScreen(x, y);
    const dir = this.camera.getWorldDirection(this.camera.position.clone());
    const a = Math.atan2(dir.x, -dir.z);                 // 0 = up the map
    c.save(); c.translate(u, v); c.rotate(a);
    const g = c.createRadialGradient(0, 0, 4, 0, 0, 46);
    g.addColorStop(0, "rgba(66,133,244,.55)"); g.addColorStop(1, "rgba(66,133,244,0)");
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 46, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); c.closePath();
    c.fillStyle = g; c.fill(); c.restore();
    c.beginPath(); c.arc(u, v, 8, 0, 7); c.fillStyle = "#4285f4"; c.fill();
    c.lineWidth = 3; c.strokeStyle = "#fff"; c.stroke();
  }

  drawPin(x, y, color) {                                 // teardrop pin, tip on the location
    const c = this.ctx, [u, v] = this.toScreen(x, y);
    c.save(); c.translate(u, v - 30);
    c.beginPath(); c.arc(0, 0, 12, Math.PI * 0.85, Math.PI * 0.15); c.lineTo(0, 30); c.closePath();
    c.fillStyle = color; c.fill(); c.lineWidth = 1.5; c.strokeStyle = "rgba(0,0,0,.35)"; c.stroke();
    c.beginPath(); c.arc(0, 0, 4.5, 0, 7); c.fillStyle = "#7a1712"; c.fill();
    c.restore();
  }
}
