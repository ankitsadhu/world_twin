// Take the helm of the Hudson sightseeing boat (js/boat.js). Handles like the real thing, a 50 m twin-diesel
// passenger vessel:
//   * an engine-order telegraph (Full astern .. Stop .. Full ahead), not a gas pedal: the engines spool, and the hull is
//     slow to answer. From rest to full ahead takes about a minute; a crash stop from full ahead about 100 m.
//   * a rudder that swings at a real rate and only bites with water flowing past it (prop wash helps at low speed;
//     going astern it barely steers). Full rudder at full speed turns in about 3 ship lengths.
//   * the Hudson's tide sets you north (flood) or south (ebb). It's a simulated 12 h 25 min cycle, not a live
//     NOAA prediction, and it's weaker in the slips between the piers.
//   * real pier outlines (data/<district>/piers.json), the Intrepid and the Manhattan bulkhead: you bump, you don't sink.
//     Come alongside a pier slowly to tie up, then go ashore and walk the pier.
// Coordinates: Blender local metres, heading h in radians from +X, counter-clockwise.
import * as THREE from "three";
import { Settings } from "./settings.js";
import { inputDevice, onInputChange } from "./gamepad.js";
import { BOAT_CRUISE } from "./boat.js";

const B = (x, y, z) => new THREE.Vector3(x, z, -y);
const KN = 0.5144;
const ORDERS = [["Full astern", -7], ["Half astern", -5], ["Slow astern", -3.5], ["Dead slow astern", -2], ["Stop", 0],
  ["Dead slow ahead", 3], ["Slow ahead", 5], ["Half ahead", 8], ["Full ahead", 12.5]];
const STOP = 4;
const RUDDER_MAX = 35, RUDDER_RATE = 5, R_FULL = 110;       // degrees, steering-gear rate (deg/s), turn radius at full rudder (m)
const HALF_L = 25, HALF_B = 5.25;                            // hull half length / half beam over the fenders
// hull check points, boat frame [ahead, to port]
const HULL = [[25, 0], [18, 3.6], [18, -3.6], [10, 5.2], [10, -5.2], [0, 5.25], [0, -5.25], [-12, 5.2], [-12, -5.2],
  [-24.5, 4.8], [-24.5, -4.8], [-25, 0]];
const GRID_ROT = 29;                                         // local +Y points 29 deg east of true north
const NJ_SHORE = -2740, RIVER_N = 2200;                      // north of the maps: the Weehawken bulkhead, open river to W 72nd
const BRIDGE_EYE = [0, 8.6, 9.3];                            // pilothouse eye, boat-local Blender metres (9.3 m above water)

export class Helm {
  constructor(o) {
    // o: { root, district, boat, camera, dom, setMode, getMode, getCollider, audio, toast, onBoard, onLeave, stepOut }
    Object.assign(this, o);
    this.active = false;
    this.order = STOP; this.thr = 0; this.u = 0; this.r = 0; this.rudder = 0;
    this.ctl = { left: 0, right: 0 };
    this.view = "chase";
    this.look = { yaw: 0, pitch: 0, drag: null, idle: 0 };
    this.piers = [];
    fetch(`${o.root}data/${o.district}/piers.json`).then(r => r.json()).then(d => {   // exact deck outlines (export_piers.py)
      this.piers = d.piers.map(p => ({ box: p.box, pts: p.outline, edges: edges(p.outline) }));
    }).catch(() => {});
    fetch(`${o.root}data/${o.district}/nav.json`).then(r => r.json()).then(d => {
      this.water = d.paths.NAV_water_Hudson.lines[0].map(p => [p[0], p[1]]);   // the district's river outline
    }).catch(() => {});
    this.buildDOM();
    this.bindInput();
  }

  // ---------------------------------------------------------------- the world around the hull
  ship() {                                                   // the Intrepid's hull (collider polygon kind "ship")
    if (this._ship === undefined) {
      const c = this.getCollider();
      if (!c) return null;
      this._ship = [...c.near(-1490, 30, 20)].map(i => c.polys[i]).find(p => p.kind === "ship")?.box || null;
    }
    return this._ship;
  }

  inWater(x, y) {
    if (x > -1750 && x < 960 && y > -720 && y < 740 && this.water) return inside(this.water, x, y);   // Times Square's river
    const H = this.harbor;
    if (H?.frame && H.inFrame(x, y)) return !H.isLand(x, y);   // the harbour: real shorelines (NYC + OSM)
    if (y < -720) return false;                                // past the harbour's edge (the Narrows come later)
    return y < RIVER_N && x < -1342 && x > NJ_SHORE;           // north of the maps: the shoreline runs along the grid
  }

  hits(x, y) {
    if (!this.inWater(x, y)) return "shore";
    const s = this.ship();
    if (s && x >= s[0] && x <= s[2] && y >= s[1] && y <= s[3]) return "pier";
    for (const p of this.allPiers()) {
      const b = p.box;
      if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inside(p.pts, x, y)) return "pier";
    }
    if (this.harbor?.statue && Math.hypot(x - this.harbor.statue[0], y - this.harbor.statue[1]) < 3) return "pier";
    return null;
  }

  allPiers() {                                               // Times Square's piers + the harbour's (Hudson River Park, Jersey City...)
    const hp = this.harbor?.pierEdges || [], key = this.piers.length + ":" + hp.length;
    if (this._allKey !== key) { this._allKey = key; this._all = [...this.piers, ...hp]; }
    return this._all;
  }

  // a pier deck you can stand on (Times Square's piers + the harbour's), for walking
  onPier(x, y) {
    for (const p of this.allPiers()) {
      const b = p.box;
      if (x >= b[0] - 0.5 && x <= b[2] + 0.5 && y >= b[1] - 0.5 && y <= b[3] + 0.5 && inside(p.pts, x, y)) return true;
    }
    return false;
  }

  hullHit(x, y, h) {
    const c = Math.cos(h), s = Math.sin(h);
    for (const [a, b] of HULL) { const w = this.hits(x + a * c - b * s, y + a * s + b * c); if (w) return w; }
    return null;
  }

  // the Hudson's tidal stream (m/s, + = flood, setting north): a simulated M2 cycle by New York time, peaking near
  // 1.4 kn on the flood and 1.8 kn on the ebb out in the stream; the piers shelter the slips between them (15 %)
  tide(x) {
    const now = Date.now() / 3.6e6, phase = Math.sin(2 * Math.PI * (now - 2.1) / 12.42);
    const v = phase > 0 ? phase * 1.4 * KN : phase * 1.8 * KN;
    const shelter = THREE.MathUtils.clamp(0.15 + 0.85 * (-1640 - x) / 60, 0.15, 1);   // full strength past the pier heads
    return v * shelter;
  }

  // ---------------------------------------------------------------- UI
  buildDOM() {
    const css = document.createElement("style");
    css.textContent = `
      #helmpanel { position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 30; display: none;
        align-items: center; gap: var(--s3); padding: var(--s2) var(--s3); max-width: calc(100% - 32px); box-sizing: border-box; flex-wrap: wrap; justify-content: center; }
      #helmpanel h3 { margin: 0; font-size: var(--t-body); font-weight: var(--w-semibold); white-space: nowrap; }
      #helmpanel .stats { display: flex; gap: var(--s3); align-items: baseline; color: var(--ink-2); font-size: var(--t-caption); white-space: nowrap; flex-wrap: wrap; }
      #helmpanel .big { font-size: var(--t-title); font-weight: var(--w-bold); color: var(--ink); }
      #helmpanel .tele { display: flex; align-items: center; gap: 4px; }
      #helmpanel .tele b { min-width: 118px; text-align: center; padding: 4px 8px; border-radius: 8px; background: var(--fill); color: var(--ink); font-size: var(--t-caption); }
      #helmpanel .tele b.ahead { background: #1f7a3a; color: #fff; } #helmpanel .tele b.astern { background: #a33a2a; color: #fff; }
      #helmpanel .ui-btn { min-height: 34px; font-size: var(--t-caption); padding: 0 var(--s3); white-space: nowrap; }
      #helmpanel .ui-btn:disabled { opacity: .4; }
      #helmpanel .rud { display: inline-block; vertical-align: middle; margin-left: 6px; width: 110px; height: 8px; border-radius: 4px; background: var(--fill); position: relative; }
      #helmpanel .rud i { position: absolute; top: -3px; width: 4px; height: 14px; border-radius: 2px; background: var(--accent); left: calc(50% - 2px); }
      #helmpanel .help { flex-basis: 100%; text-align: center; margin: 0; color: var(--ink-3); font-size: var(--t-caption); }
      #helmpad { position: fixed; inset: auto 0 0 0; z-index: 29; display: none; pointer-events: none; }
      #helmpad button { pointer-events: auto; position: absolute; width: 66px; height: 66px; border-radius: 33px; border: none; color: var(--ink);
        background: var(--glass); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); font: var(--w-bold) 14px var(--font);
        touch-action: none; user-select: none; -webkit-user-select: none; }
      #helmpad button.on { background: var(--accent); color: var(--accent-ink); }
      #helmveil { position: fixed; inset: 0; z-index: 60; background: #000; opacity: 0; pointer-events: none; transition: opacity .35s; }
      body[data-input="touch"] #helmpanel { bottom: auto; top: calc(64px + env(safe-area-inset-top)); }
      body[data-input="touch"] #helmpanel .help { display: none; }
      @media (max-width: 640px) { body[data-input="touch"] #helmpanel { left: 16px; transform: none; max-width: calc(100% - 150px); justify-content: flex-start; } }
      body.helming #zoom, body.helming [data-t], body.helming #wpchip, body.helming #hopin, body.helming #flychip { display: none !important; }
      #boardchip { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 28; display: none; align-items: center; gap: var(--s2); box-shadow: var(--shadow); }
      #boardchip kbd { font: var(--w-semibold) var(--t-caption) var(--font); background: rgba(0,0,0,.15); border-radius: 6px; padding: 2px 6px; }
      body[data-input="touch"] #boardchip kbd { display: none; }`;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML("beforeend", `
      <div id="helmpanel" class="ui-surface" role="status" aria-live="polite"></div>
      <div id="helmveil" aria-hidden="true"></div>
      <button id="boardchip" class="ui-btn primary" aria-label="Board the boat and take the helm">⚓ Board the Hudson Sightseer<kbd>F</kbd></button>
      <div id="helmpad" aria-hidden="true">
        <button data-c="left" style="left:16px;bottom:calc(var(--hp-b) + 0px)" aria-label="Rudder to port">◀</button>
        <button data-c="right" style="left:94px;bottom:calc(var(--hp-b) + 0px)" aria-label="Rudder to starboard">▶</button>
        <button data-c="horn" style="left:55px;bottom:calc(var(--hp-b) + 78px);width:54px;height:54px;font-size:12px">Horn</button>
        <button data-c="down" style="right:16px;bottom:calc(var(--hp-b) + 0px)" aria-label="Engine order astern">▼</button>
        <button data-c="up" style="right:16px;bottom:calc(var(--hp-b) + 78px)" aria-label="Engine order ahead">▲</button>
        <button data-c="view" style="right:94px;bottom:calc(var(--hp-b) + 40px);width:54px;height:54px;font-size:12px">View</button>
      </div>`);
    this.panel = document.getElementById("helmpanel");
    this.chip = document.getElementById("boardchip");
    this.chip.onclick = () => this.board();
    const pad = document.getElementById("helmpad");
    pad.style.setProperty("--hp-b", "calc(84px + env(safe-area-inset-bottom))");
    pad.querySelectorAll("button").forEach(b => {
      const k = b.dataset.c;
      const on = v => e => {
        e.preventDefault();
        if (k === "left" || k === "right") { this.ctl[k] = v; b.classList.toggle("on", !!v); return; }
        if (!v) return;
        if (k === "up") this.step(1); if (k === "down") this.step(-1);
        if (k === "horn") this.horn(); if (k === "view") this.toggleView();
      };
      b.addEventListener("pointerdown", on(1)); b.addEventListener("pointerup", on(0));
      b.addEventListener("pointercancel", on(0)); b.addEventListener("pointerleave", on(0));
    });
    onInputChange(() => { if (this.active) this.render(); });
  }

  render() {
    const P = this.panel, touch = inputDevice() === "touch";
    document.body.classList.toggle("helming", this.active);
    document.getElementById("helmpad").style.display = this.active && touch ? "block" : "none";
    if (!this.active) { P.style.display = "none"; return; }
    P.style.display = "flex";
    const near = this.berthing(), mo = this.moored;
    const acts = mo ? `<button class="ui-btn primary" data-a="ashore">Go ashore</button><button class="ui-btn" data-a="castoff">Cast off</button>`
      : `<button class="ui-btn ${near ? "primary" : ""}" data-a="tie" ${near ? "" : "disabled"}>Tie up</button>`;
    const help = inputDevice() === "pad" ? "D-pad ▲▼ engine order · left stick rudder · ✕ tie up / go ashore · □ horn · R3 view · ○ leave the helm"
      : "W / S engine order · A / D rudder · X stop engines · H horn · C view · F tie up / go ashore";
    P.innerHTML = `<h3>⚓ Hudson Sightseer${mo ? " · alongside" : ""}</h3>
      <div class="tele"><button class="ui-btn" data-a="down" aria-label="Engine order astern">▼</button><b id="helm-order">Stop</b>
        <button class="ui-btn" data-a="up" aria-label="Engine order ahead">▲</button></div>
      <div class="stats"><span><span class="big" id="helm-kn">0.0</span> kn</span><span>HDG <span id="helm-hdg">000</span>°</span>
        <span title="Rudder">Rudder <span class="rud"><i id="helm-rud"></i></span></span><span id="helm-tide"></span></div>
      <div style="display:flex;gap:var(--s2)">${acts}<button class="ui-btn" data-a="horn">Horn</button><button class="ui-btn" data-a="view">${this.view === "chase" ? "Bridge view" : "Chase view"}</button>
        <button class="ui-btn" data-a="leave">Leave the helm</button></div>
      ${this.helpT > 0 ? `<p class="help">${help}</p>` : ""}`;
    P.querySelectorAll("[data-a]").forEach(b => b.onclick = () => this.action(b.dataset.a));
    this.hud(true);
  }

  hud(force) {
    const o = ORDERS[this.order], el = document.getElementById("helm-order");
    if (!el) return;
    if (force || el.textContent !== o[0]) { el.textContent = o[0]; el.className = o[1] > 0 ? "ahead" : o[1] < 0 ? "astern" : ""; }
    const sog = Math.hypot(...this.groundVel());
    document.getElementById("helm-kn").textContent = (sog / KN).toFixed(1);
    const brg = ((GRID_ROT + 90 - THREE.MathUtils.radToDeg(this.h)) % 360 + 360) % 360;
    document.getElementById("helm-hdg").textContent = String(Math.round(brg) % 360).padStart(3, "0");
    document.getElementById("helm-rud").style.left = `calc(${50 + 50 * this.rudder / RUDDER_MAX}% - 2px)`;
    const t = this.tide(this.x);
    document.getElementById("helm-tide").textContent = Math.abs(t) < 0.08 ? "Tide: slack" : `Tide: ${t > 0 ? "flood" : "ebb"} ${(Math.abs(t) / KN).toFixed(1)} kn ${t > 0 ? "↑" : "↓"}`;
  }

  action(a) {
    if (a === "up") this.step(1);
    if (a === "down") this.step(-1);
    if (a === "horn") this.horn();
    if (a === "view") this.toggleView();
    if (a === "tie") this.tieUp();
    if (a === "castoff") this.castOff();
    if (a === "ashore") this.goAshore();
    if (a === "leave") this.leave();
  }

  bindInput() {
    const rud = { KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right" };
    addEventListener("keydown", e => {
      if (!this.active || e.target.tagName === "INPUT") return;
      if (rud[e.code]) { this.ctl[rud[e.code]] = 1; e.preventDefault(); return; }
      if (e.repeat) return;
      if (e.code === "KeyW" || e.code === "ArrowUp") { this.step(1); e.preventDefault(); }
      if (e.code === "KeyS" || e.code === "ArrowDown") { this.step(-1); e.preventDefault(); }
      if (e.code === "KeyX") this.setOrder(STOP);
      if (e.code === "KeyH") this.horn();
      if (e.code === "KeyC") this.toggleView();
      if (e.code === "KeyF") this.context();
    });
    addEventListener("keydown", e => {                         // on foot beside her: F to board
      if (!this.active && this.near && e.code === "KeyF" && !e.repeat && e.target.tagName !== "INPUT") this.board();
    });
    addEventListener("keyup", e => { if (rud[e.code]) this.ctl[rud[e.code]] = 0; });
    this.dom.addEventListener("pointerdown", e => { if (this.active) this.look.drag = [e.clientX, e.clientY]; });
    addEventListener("pointermove", e => {
      if (!this.look.drag) return;
      const { k, inv } = Settings.lookScale();
      this.look.yaw -= (e.clientX - this.look.drag[0]) * 0.005 * k;
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - (e.clientY - this.look.drag[1]) * 0.004 * k * inv, -0.7, 0.5);
      this.look.drag = [e.clientX, e.clientY]; this.look.idle = 0;
    });
    addEventListener("pointerup", () => { this.look.drag = null; });
  }

  step(d) { this.setOrder(THREE.MathUtils.clamp(this.order + d, 0, ORDERS.length - 1)); }
  setOrder(i) {
    if (this.moored && i !== STOP) this.castOff();
    this.order = i; this.hud(true);
    this.audio?.telegraph?.();
  }
  toggleView() { this.view = this.view === "chase" ? "bridge" : "chase"; this.look.yaw = 0; this.look.pitch = 0; this.render(); }
  horn() { if (this.boat.group) this.audio?.shipHorn?.(this.boat.group.position.clone().add(new THREE.Vector3(0, 12, 0))); }
  context() { if (this.moored) this.goAshore(); else if (this.berthing()) this.tieUp(); }

  // ---------------------------------------------------------------- boarding and leaving
  veil(on) { document.getElementById("helmveil").style.opacity = on ? "1" : "0"; return new Promise(r => setTimeout(r, on ? 380 : 0)); }

  isBoat(obj) { while (obj) { if (obj === this.boat.group) return true; obj = obj.parent; } return false; }

  async board() {
    await this.boat.ready;
    if (this.active) return;
    this.onBoard?.();
    await this.veil(true);
    const b = this.boat, q = b.pose || b.at(b.s), again = this.pendingResume;
    if (!again) { this.x = q.x; this.y = q.y; this.h = q.h; this.u = b.wait > 0 ? 0 : b.v; }   // else: where you left her
    this.r = 0; this.rudder = 0; this.thr = this.u;
    this.order = this.u < 0.3 ? STOP : ORDERS.reduce((bi, o, i) => Math.abs(o[1] * KN - this.u) < Math.abs(ORDERS[bi][1] * KN - this.u) ? i : bi, STOP);
    b.manual = true; this.pendingResume = false;
    this.active = true; this.helpT = 12; this.camSnap = true; this.view = "chase";
    const wasMoored = again && this.moored;
    this.moored = false; this.tie = null;
    const f = b.wait > 0 || wasMoored ? this.berthing() : null;  // alongside a pier: the lines are already on
    this.moored = !!f; this.face = f;
    this.setMode("boat");
    this.render();
    this.veil(false);
  }

  forceOut() { if (this.active) this.leave(true); }

  // off the boat in mid-river (or switching mode): you're back to exploring; the crew takes her home when you're away
  leave(quiet) {
    if (!this.active) return;
    this.active = false; this.ctl = { left: 0, right: 0 };
    this.pendingResume = true;
    this.render();
    if (!quiet) this.onLeave?.({ x: this.x, y: this.y, h: this.h });
  }

  // alongside a pier: step onto it and walk
  goAshore() {
    if (!this.moored || !this.face) return;
    const e = this.face.e, c = Math.cos(this.h), s = Math.sin(this.h);
    const along = THREE.MathUtils.clamp((this.x - c * 6 - e.ax) * e.dx + (this.y - s * 6 - e.ay) * e.dy, 3, e.len - 3);
    const px = e.ax + e.dx * along - e.nx * 2.5, py = e.ay + e.dy * along - e.ny * 2.5;   // a little aft of amidships, 2.5 m onto the pier
    this.active = false; this.ctl = { left: 0, right: 0 };
    this.pendingResume = true;
    this.render();
    this.stepOut?.(B(px, py, 3), new THREE.Vector3(c, 0, -s));
  }

  // within ~3 m of a straight pier face or seawall (at least 30 m long), nearly parallel to it and slow: lines go over
  berthing() {
    if (!this.active || this.moored || Math.abs(this.u) > 0.75) return null;
    const c = Math.cos(this.h), s = Math.sin(this.h);
    let best = null;
    for (const p of [...this.allPiers(), ...(this.harbor?.landFaces || [])]) {
      const b = p.box;
      if (this.x < b[0] - 40 || this.x > b[2] + 40 || this.y < b[1] - 40 || this.y > b[3] + 40) continue;
      for (const e of p.edges) {
        if (e.len < 30 || Math.abs(c * e.dy - s * e.dx) > 0.42) continue;           // too short, or not parallel
        for (const side of [1, -1]) {                                                 // port / starboard
          const sx = this.x - s * HALF_B * side, sy = this.y + c * HALF_B * side;
          const along = (sx - e.ax) * e.dx + (sy - e.ay) * e.dy;
          const gap = (sx - e.ax) * e.nx + (sy - e.ay) * e.ny;                        // outward = into the water
          if (gap > -0.5 && gap < 3.2 && along > 8 && along < e.len - 8 && (!best || gap < best.gap)) best = { e, side, gap };
        }
      }
    }
    return best;
  }

  tieUp() {
    const f = this.berthing();
    if (!f) return;
    this.face = f;
    const e = f.e, eh = Math.atan2(e.dy, e.dx);
    let h = eh; if (Math.cos(this.h - eh) < 0) h = eh + Math.PI;                       // square to the pier, same way round
    const along = THREE.MathUtils.clamp((this.x - e.ax) * e.dx + (this.y - e.ay) * e.dy, Math.min(HALF_L * 0.6, e.len / 2), Math.max(e.len - HALF_L * 0.6, e.len / 2));
    const off = HALF_B + 0.35;
    this.tie = { x0: this.x, y0: this.y, h0: this.h, x: e.ax + e.dx * along + e.nx * off, y: e.ay + e.dy * along + e.ny * off, h, t: 0 };
    this.moored = true; this.order = STOP; this.thr = 0; this.u = 0; this.r = 0;
    this.toast?.("Lines are on. You're alongside.");
    this.render();
  }

  castOff() { this.moored = false; this.tie = null; this.render(); }

  // ---------------------------------------------------------------- per frame
  groundVel() {
    const c = Math.cos(this.h), s = Math.sin(this.h), t = this.moored ? 0 : this.tide(this.x);
    return [this.u * c, this.u * s + t];
  }

  update(dt) {
    const b = this.boat;
    if (!b.group) return;
    if (!this.active) {                                          // on foot beside her, alongside or stopped: offer to board
      const c = this.camera.position, g = b.group.position;
      this.near = this.getMode() === "walk" && Math.hypot(c.x - g.x, c.z - g.z) < 45 &&
        (this.pendingResume ? this.moored || Math.abs(this.u) < 0.4 : b.wait > 0 || b.v < 0.4);
      this.chip.style.display = this.near ? "flex" : "none";
    } else this.chip.style.display = "none";
    if (this.pendingResume && !this.active) {                    // hand back to the timetable once you're away from her
      if (this.camera.position.distanceTo(b.group.position) > 260) { this.pendingResume = false; b.resume(); }
      else {                                                     // tied up she stays put; adrift she slows and sets with the tide
        if (!this.moored) { this.u *= Math.exp(-dt / 40); this.integrate(dt, true); }
        b.placePose({ x: this.x, y: this.y, h: this.h }, 0, this.moored ? 0 : this.u);
      }
      return;
    }
    if (!this.active) return;
    if (this.helpT > 0) { this.helpT -= dt; if (this.helpT <= 0) this.render(); }
    // rudder: hold to put it over, let go and it comes back amidships, at the steering gear's rate
    const P = this.pad, cmd = P && Math.abs(P.lx) > 0.12 ? P.lx * RUDDER_MAX : (this.ctl.right ? RUDDER_MAX : 0) - (this.ctl.left ? RUDDER_MAX : 0);
    this.rudder += THREE.MathUtils.clamp(cmd - this.rudder, -RUDDER_RATE * dt, RUDDER_RATE * dt);
    if (this.moored) {
      if (this.tie) {                                             // the crew warps her in alongside
        const T = this.tie; T.t = Math.min(1, T.t + dt / 3);
        const e = T.t * T.t * (3 - 2 * T.t);
        let dh = T.h - T.h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        this.x = T.x0 + (T.x - T.x0) * e; this.y = T.y0 + (T.y - T.y0) * e; this.h = T.h0 + dh * e;
      }
      this.thr = 0;
    } else this.integrate(dt, false);
    b.placePose({ x: this.x, y: this.y, h: this.h }, this.r * 8, this.u);
    this.audio?.setPlane?.("boat", 0.12 + 0.5 * Math.abs(this.thr) / (12.5 * KN), b.group.position, 25);
    this.hud();
    const near = !!this.berthing();
    if (near !== this._near) { this._near = near; this.render(); }
    this.follow(dt);
  }

  integrate(dt, adrift) {
    const want = adrift ? 0 : ORDERS[this.order][1] * KN;
    this.thr += THREE.MathUtils.clamp(want - this.thr, -1.0 * dt, 1.0 * dt);   // engines spool up and down
    // speed answers the propellers slowly: water drag when stopped, harder against the screws when backing
    const tau = Math.abs(this.thr) < 0.05 ? 70 : (Math.sign(this.thr) !== Math.sign(this.u) && Math.abs(this.u) > 0.2) ? 45 : 30;
    this.u += (this.thr - this.u) / tau * dt;
    // the rudder steers with the water flowing past it: hull speed plus the screw's wash when driving ahead
    const flow = this.u + 0.5 * Math.max(0, this.thr), eff = this.u < -0.1 && this.thr <= 0 ? 0.5 : 1;
    const rss = -flow * (this.rudder / RUDDER_MAX) / R_FULL * eff;
    this.r += (rss - this.r) / 6 * dt;
    const [vx, vy] = this.groundVel();
    const nx = this.x + vx * dt, ny = this.y + vy * dt, nh = this.h + this.r * dt;
    let hit = this.hullHit(nx, ny, nh);
    if (hit) {
      // fenders: slide along whatever she touches (try each axis, then just the swing), only a real knock bounces
      for (const [tx, ty, th] of [[nx, this.y, nh], [this.x, ny, nh], [nx, this.y, this.h], [this.x, ny, this.h], [this.x, this.y, nh]]) {
        if (!this.hullHit(tx, ty, th)) {
          const into = Math.hypot(nx - tx, ny - ty) / Math.max(1e-6, dt);   // speed of the blocked part
          this.x = tx; this.y = ty; this.h = th;
          if (into > 0.9 && !adrift) { this.u *= 0.6; this.onBump?.(Math.min(1, into / 4)); }
          return;
        }
      }
      const sp = Math.abs(this.u);
      this.u *= -0.15; this.r = 0;
      if (sp > 0.8 && !adrift) {
        this.onBump?.(Math.min(1, sp / 4));
        const edge = ny < -720 && !this.harbor?.inFrame(nx, ny);
        this.toast?.(edge ? "That's the edge of the harbour for now (the Narrows come later)." : "Bump! The fenders took it.");
      }
      return;
    }
    this.x = nx; this.y = ny; this.h = nh;
  }

  follow(dt) {
    const cam = this.camera, g = this.boat.group, L = this.look;
    L.idle += dt;
    if (this.pad && (this.pad.rx || this.pad.ry)) { L.yaw -= this.pad.rx * dt * 2; L.pitch = THREE.MathUtils.clamp(L.pitch - this.pad.ry * dt * 1.4, -0.7, 0.5); L.idle = 0; }
    if (!L.drag && L.idle > 3) { L.yaw *= Math.exp(-dt * 1.2); L.pitch *= Math.exp(-dt * 1.2); }
    const yaw = this.h - Math.PI / 2 + L.yaw;
    if (this.view === "bridge") {
      const [ex, ey, ez] = BRIDGE_EYE;
      const eye = g.localToWorld(new THREE.Vector3(ex, ez, -ey));
      cam.position.copy(eye);
      cam.quaternion.setFromEuler(new THREE.Euler(L.pitch - 0.06, yaw, 0, "YXZ"));
      return;
    }
    const off = new THREE.Vector3(0, 19 + Math.max(0, -L.pitch) * 30, 62).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const want = g.position.clone().add(off);
    const a = this.camSnap ? 1 : 1 - Math.exp(-dt * 3);
    this.camSnap = false;
    cam.position.lerp(want, a);
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    cam.up.set(0, 1, 0);
    cam.lookAt(g.position.clone().addScaledVector(fwd, 18).add(new THREE.Vector3(0, 6 + L.pitch * 20, 0)));
  }
}

// straight edges of a counter-clockwise outline with unit direction and outward normal (pointing into the water)
function edges(pts) {
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return { ax: a[0], ay: a[1], dx: dx / len, dy: dy / len, nx: dy / len, ny: -dx / len, len };
  });
}

function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
