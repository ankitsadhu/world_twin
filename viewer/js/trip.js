// Directions, Google Maps style: route options for any place, mixing the ways the world lets you travel:
//   walk · self-driving cab (Midtown's roads) · the Hudson Sightseer from Pier 83 (you take the helm) · the plane off the
//   Intrepid (a sightseeing flight: it lands back on the carrier)
// Each option lists its legs with distance and time; Start guides you leg by leg (waypoint beacon + the minimap's blue
// line, the next step offered as you finish each one). Harbour places also say how you'd really get there in New York.
// Coordinates: Blender local metres.

const KN = 0.5144;
const SPEED = { walk: 1.4, cab: 7.0, boat: 9.5 * KN, plane: 46 };          // average door-to-door speeds (m/s)
const MIDTOWN = [-1750, -720, 960, 740];
const PIER83 = { id: "pier83", name: "Pier 83", x: -1494, y: -193, berth: [-1560, -208.8] };
const INTREPID = { id: "intrepid", name: "the Intrepid", x: -1486, y: 23, lift: [-1424.3, 54.0] };
// how people really get there today (shown under the in-game options)
const REAL = {
  liberty: "In New York: subway 1 to South Ferry, then Statue City Cruises from The Battery: the only boats that land on Liberty Island.",
  ellis: "In New York: subway 1 to South Ferry, then Statue City Cruises from The Battery (they stop at Liberty and Ellis Islands).",
  governors: "In New York: subway 1 to South Ferry, then the Governors Island ferry from the Battery Maritime Building.",
  battery: "In New York: subway 1 to South Ferry or 4/5 to Bowling Green.",
  onewtc: "In New York: subway E to World Trade Center or 1 to WTC Cortlandt.",
  exchange: "In New York: PATH train from 33rd St or the NY Waterway ferry from Midtown (W 39th St) to Paulus Hook.",
  hoboken: "In New York: PATH train from 33rd St, or the NY Waterway ferry from W 39th St.",
  pier25: "In New York: subway 1 to Franklin St, then walk to the river.",
  centralpark: "In New York: a 15-minute walk up 7th Ave from Times Square, or subway N/Q/R/W to 5th Ave-59th St.",
};
const ICON = { walk: "🚶", cab: "🚕", boat: "⛴", plane: "✈" };

const inRect = (x, y, r = MIDTOWN) => x > r[0] && x < r[2] && y > r[1] && y < r[3];
const fmtD = d => d < 1000 ? `${Math.max(10, Math.round(d / 10) * 10)} m` : `${(d / 1000).toFixed(1)} km`;
const fmtT = s => s < 60 ? "1 min" : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;

export class Trip {
  constructor(o) {
    // o: { nav, ride, helm, flight, harbor, boat, camera, getMode, toast }
    Object.assign(this, o);
    this.active = null;                                    // { option, step, dest }
    this.buildDOM();
  }

  me() { const c = this.camera.position; return [c.x, -c.z]; }

  // ---------------------------------------------------------------- planning
  // a landing for the boat at a harbour place: the nearest pier with a long straight face, approached from the water
  landingFor(dest) {
    const H = this.harbor;
    if (!H?.pierEdges) return null;
    let best = null;
    for (const p of [...H.pierEdges, ...(H.landFaces || [])]) {
      for (const e of p.edges) {
        if (e.len < 30) continue;
        const mx = e.ax + e.dx * e.len / 2, my = e.ay + e.dy * e.len / 2;
        const d = Math.hypot(mx - dest.x, my - dest.y);
        if (d > 900) continue;
        const wx = mx + e.nx * 25, wy = my + e.ny * 25;                 // 25 m out, on the water side
        if (H.isLand(wx, wy) || H.isPier(wx, wy)) continue;
        if (!best || d < best.d) best = { d, x: mx, y: my, wx, wy, e };
      }
    }
    return best;
  }

  // a channel down the Hudson (and into the Upper Bay) from Pier 83 to the landing: the middle of the open water
  waterRoute(to) {
    const H = this.harbor, pts = [[-1560, -208.8], [-1660, -215], [-1730, -260]];
    const water = (x, y) => (inRect(x, y) ? x < -1450 && !this.helm.hits(x, y) : H.inFrame(x, y) && !H.isLand(x, y) && !H.isPier(x, y));
    for (let y = -500; y > to.wy + 150; y -= 250) {               // middle of the widest stretch of water at each y
      let run = null, best = null;
      for (let x = -3400; x <= 1600; x += 20) {
        if (water(x, y)) { if (!run) run = [x, x]; run[1] = x; }
        else if (run) { if (!best || run[1] - run[0] > best[1] - best[0]) best = run; run = null; }
      }
      if (run && (!best || run[1] - run[0] > best[1] - best[0])) best = run;
      if (best) pts.push([(best[0] + best[1]) / 2, y]);
    }
    pts.push([to.wx, to.wy], [to.x + to.e.nx * 8, to.y + to.e.ny * 8]);
    return pts;
  }

  lengthOf(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }

  options(dest) {
    const [x, y] = this.me(), out = [];
    const crow = Math.hypot(dest.x - x, dest.y - y);
    const midtown = inRect(dest.x, dest.y) && inRect(x, y);
    const leg = (mode, text, dist, extra = 0) => ({ mode, text, dist, time: dist / SPEED[mode] + extra });
    const toHub = hub => {                                          // getting to a hub: walk if close, else a cab
      const d = Math.hypot(hub.x - x, hub.y - y) * 1.25;
      return d < 600 ? leg("walk", `Walk to ${hub.name}`, d) : leg("cab", `Self-driving cab to ${hub.name}`, d * 1.15, 120);
    };
    if (midtown) {
      out.push({ id: "cab", title: "Self-driving cab", legs: [leg("cab", `Cab to ${dest.name}`, crow * 1.35, 120)] });
      out.push({ id: "walk", title: "Walk", legs: [leg("walk", `Walk to ${dest.name}`, crow * 1.25)] });
    }
    if (!inRect(dest.x, dest.y)) {                                  // the harbour: on foot if it's on our island, by water or by air
      const H = this.harbor, n = Math.ceil(crow / 25);
      let onFoot = crow < 5000 && !!H?.frame;
      for (let i = 1; onFoot && i <= n; i++) {                       // a straight walk that stays on land (no river in between)
        const px = x + (dest.x - x) * i / n, py = y + (dest.y - y) * i / n;
        if (!inRect(px, py) && H.inFrame(px, py) && !H.isLand(px, py)) onFoot = false;
      }
      if (onFoot) out.push({ id: "walk", title: "Walk", legs: [leg("walk", `Walk to ${dest.name}`, crow * 1.3)] });
      const land = this.landingFor(dest);
      if (land && Math.hypot(dest.x - land.x, dest.y - land.y) < 900) {   // a landing within a short walk of the place
        const route = this.waterRoute(land);
        const ashore = Math.hypot(dest.x - land.x, dest.y - land.y) * 1.2;
        out.push({ id: "boat", title: "Cab + boat", route, land, legs: [toHub(PIER83),
          leg("walk", "Walk onto Pier 83 and board the Hudson Sightseer", 120),
          leg("boat", `Take the helm: follow the blue line down the Hudson to ${dest.name}`, this.lengthOf(route)),
          leg("walk", `Tie up, go ashore and walk to ${dest.name}`, ashore + 30)] });
      }
      const fly = Math.hypot(dest.x - INTREPID.x, dest.y - INTREPID.y);
      out.push({ id: "plane", title: "Cab + plane (sightseeing)", legs: [toHub(INTREPID),
        leg("walk", "Walk out on Pier 86, elevator to the flight deck", 160, 30),
        leg("plane", `Fly over ${dest.name}`, fly), leg("plane", "Fly back and land on the Intrepid", fly, 60)] });
    }
    for (const o of out) o.time = o.legs.reduce((a, l) => a + l.time, 0);
    out.sort((a, b) => a.time - b.time);
    return out;
  }

  // ---------------------------------------------------------------- UI
  buildDOM() {
    const css = document.createElement("style");
    css.textContent = `
      #trippanel { position: fixed; left: 50%; bottom: var(--s4); transform: translateX(-50%); z-index: 31; width: min(460px, calc(100% - 32px));
        box-sizing: border-box; padding: var(--s4) var(--s5); display: none; max-height: 72vh; overflow: auto; }
      #trippanel h3 { margin: 0 0 var(--s1); font-size: var(--t-headline); font-weight: var(--w-semibold); }
      #trippanel .sub { margin: 0 0 var(--s3); color: var(--ink-2); font-size: var(--t-caption); }
      #trippanel .opt { display: flex; align-items: center; gap: var(--s3); width: 100%; text-align: left; border: none; border-radius: var(--r-control);
        padding: var(--s2) var(--s3); margin: 0 0 var(--s2); background: var(--fill); color: var(--ink); font: var(--w-semibold) var(--t-body) var(--font); cursor: pointer; }
      #trippanel .opt:hover, #trippanel .opt.sel { background: var(--fill-hover); outline: 2px solid var(--accent); }
      #trippanel .chain { font-size: 18px; letter-spacing: 2px; white-space: nowrap; }
      #trippanel .t { margin-left: auto; font-weight: var(--w-bold); white-space: nowrap; }
      #trippanel ol { margin: var(--s2) 0 var(--s3); padding-left: 20px; color: var(--ink-2); font-size: var(--t-caption); }
      #trippanel li { margin: 0 0 6px; } #trippanel li b { color: var(--ink); font-weight: var(--w-semibold); }
      #trippanel li.now b { color: var(--accent); }
      #trippanel .real { margin: var(--s2) 0 var(--s3); padding: var(--s2) var(--s3); border-radius: var(--r-control); background: rgba(10,132,255,.12);
        color: var(--ink-2); font-size: var(--t-caption); }
      #trippanel .acts { display: flex; gap: var(--s2); }
      #tripstrip { position: fixed; left: 50%; top: calc(64px + env(safe-area-inset-top)); transform: translateX(-50%); z-index: 27; display: none;
        align-items: center; gap: var(--s3); padding: var(--s2) var(--s3); max-width: calc(100% - 32px); box-sizing: border-box; }
      #tripstrip .ic { font-size: 18px; } #tripstrip .tx { font-size: var(--t-caption); color: var(--ink); }
      #tripstrip .ui-btn { min-height: 32px; font-size: var(--t-caption); padding: 0 var(--s3); white-space: nowrap; }`;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML("beforeend", `<div id="trippanel" class="ui-surface" role="dialog" aria-label="Directions"></div>
      <div id="tripstrip" class="ui-surface" role="status" aria-live="polite"></div>`);
    this.panel = document.getElementById("trippanel");
    this.strip = document.getElementById("tripstrip");
  }

  open(dest) {
    if (!dest) return;
    this.dest = dest; this.opts = this.options(dest); this.sel = 0;
    this.render();
  }
  close() { this.panel.style.display = "none"; }

  render() {
    const P = this.panel, d = this.dest, o = this.opts;
    if (!o.length) { P.innerHTML = `<h3>${d.name}</h3><p class="sub">No way there yet.</p>`; P.style.display = "block"; return; }
    const cur = o[this.sel];
    const chain = opt => opt.legs.map(l => ICON[l.mode]).filter((m, i, a) => i === 0 || m !== a[i - 1]).join(" › ");
    const dist = opt => fmtD(opt.legs.reduce((a, l) => a + l.dist, 0));
    P.innerHTML = `<h3>Directions to ${d.name}</h3><p class="sub">${d.sub || ""}</p>
      ${o.map((opt, i) => `<button class="opt ${i === this.sel ? "sel" : ""}" data-i="${i}"><span class="chain">${chain(opt)}</span>
        <span>${opt.title}<br><small style="color:var(--ink-3);font-weight:400">${dist(opt)}</small></span><span class="t">${fmtT(opt.time)}</span></button>`).join("")}
      <ol>${cur.legs.map(l => `<li><b>${ICON[l.mode]} ${l.text}</b> · ${fmtD(l.dist)} · ${fmtT(l.time)}</li>`).join("")}</ol>
      ${REAL[d.id] ? `<div class="real">${REAL[d.id]}</div>` : ""}
      ${cur.id === "plane" ? `<div class="real">The real Intrepid is a museum: nothing flies off its deck. The flight is a game sightseeing trip.</div>` : ""}
      <div class="acts"><button class="ui-btn primary" data-a="start">Start</button><button class="ui-btn" data-a="close">Close</button></div>`;
    P.style.display = "block";
    P.querySelectorAll(".opt").forEach(b => b.onclick = () => { this.sel = +b.dataset.i; this.render(); });
    P.querySelector('[data-a="start"]').onclick = () => this.start(cur);
    P.querySelector('[data-a="close"]').onclick = () => this.close();
  }

  // ---------------------------------------------------------------- guiding a trip
  start(opt) {
    this.close();
    this.active = { opt, step: 0, dest: this.dest };
    if (opt.id === "boat" && this.boat && !this.helm.active) {         // keep the boat at her berth for you
      const g = this.boat.group?.position, c = this.camera.position;
      const atBerth = this.boat.wait > 0 && !this.boat.manual;
      if (!atBerth && g && Math.hypot(g.x - c.x, g.z - c.z) > 400) this.boat.resume();
      if (!this.boat.manual) this.boat.wait = Math.max(this.boat.wait, 1800);
    }
    this.begin();
  }

  end(msg) {
    this.active = null; this.strip.style.display = "none";
    this.helm.route = null; this.nav.setWaypoint?.(null);
    if (msg) this.toast?.(msg);
  }

  begin() {
    const A = this.active, opt = A.opt, d = A.dest;
    const L = opt.legs[A.step];
    this.say(L);
    const [x, y] = this.me();
    if (opt.id === "cab") return this.ride.book(d);
    if (opt.id === "walk") { this.nav.walkTo?.(d); return; }
    const hub = opt.id === "boat" ? PIER83 : INTREPID;
    if (A.step === 0) {                                              // to the hub
      if (L.mode === "cab") this.ride.book({ ...hub, kind: "landmark" });
      else { this.nav.setWaypoint?.({ ...hub, kind: "point" }); }
    } else if (A.step === 1) {
      this.nav.setWaypoint?.(opt.id === "boat" ? { id: "board", name: "Board the Hudson Sightseer", kind: "point", x: -1555, y: -197 }
        : { id: "lift", name: "Intrepid visitor elevator", kind: "point", x: INTREPID.lift[0], y: INTREPID.lift[1] });
    } else if (opt.id === "boat" && A.step === 2) {
      this.helm.route = opt.route;
      this.nav.setWaypoint?.({ id: "landing", name: `Landing · ${d.name}`, kind: "point", x: opt.land.x, y: opt.land.y });
    } else if (opt.id === "boat" && A.step === 3) {
      this.helm.route = null;
      this.nav.setWaypoint?.(d);
    } else if (opt.id === "plane" && A.step === 2) {
      this.nav.setWaypoint?.(d);
    } else if (opt.id === "plane" && A.step === 3) {
      this.nav.setWaypoint?.({ id: "intrepid", name: "Land on the Intrepid", kind: "point", x: -1490, y: 30 });
    }
  }

  say(L) {
    const A = this.active, n = A.opt.legs.length;
    this.strip.innerHTML = `<span class="ic">${ICON[L.mode]}</span><span class="tx"><b>Step ${A.step + 1} of ${n}</b> · ${L.text}</span>
      <button class="ui-btn" data-a="dirs">Steps</button><button class="ui-btn" data-a="end">End trip</button>`;
    this.strip.style.display = "flex";
    this.strip.querySelector('[data-a="end"]').onclick = () => this.end();
    this.strip.querySelector('[data-a="dirs"]').onclick = () => { this.dest = A.dest; this.opts = [A.opt]; this.sel = 0; this.render(); };
  }

  next() {
    const A = this.active;
    A.step++;
    if (A.step >= A.opt.legs.length) return this.end(`You've arrived at ${A.dest.name}.`);
    this.begin();
  }

  // advance automatically when a leg is done
  update() {
    const A = this.active;
    if (!A) return;
    const [x, y] = this.me(), d = A.dest, opt = A.opt, mode = this.getMode();
    const near = (p, r) => Math.hypot(p.x - x, p.y - y) < r;
    if (opt.id === "cab" || opt.id === "walk") {
      if (mode === "walk" && near(d, 60)) this.end(`You've arrived at ${d.name}.`);
      return;
    }
    const hub = opt.id === "boat" ? PIER83 : INTREPID;
    if (A.step === 0) {
      if ((mode === "walk" && near(hub, opt.id === "boat" ? 180 : 140)) || (opt.id === "plane" && this.flight.active) || (opt.id === "boat" && this.helm.active)) this.next();
    } else if (A.step === 1) {
      if (opt.id === "boat" ? this.helm.active : this.flight.active) this.next();
    } else if (opt.id === "boat" && A.step === 2) {
      if (!this.helm.active && mode === "walk") this.next();          // went ashore
      else if (this.helm.active && Math.hypot(this.helm.x - opt.land.x, this.helm.y - opt.land.y) < 90 && !this._toldTie) {
        this._toldTie = true; this.toast?.("Come alongside slowly and tie up (F), then go ashore.");
      }
    } else if (opt.id === "boat" && A.step === 3) {
      if (mode === "walk" && near(d, 120)) this.end(`You've arrived at ${d.name}.`);
    } else if (opt.id === "plane" && A.step === 2) {
      if (this.flight.active && Math.hypot(this.flight.p.x - d.x, this.flight.p.y - d.y) < 500) { this.toast?.(`That's ${d.name} below you. Head back to the Intrepid.`); this.next(); }
    } else if (opt.id === "plane" && A.step === 3) {
      if (this.flight.state === "ready" || !this.flight.active) this.end("Welcome back aboard the Intrepid.");
    }
  }

  // the boat leg's blue line for the maps
  mapInfo() {
    const r = this.helm.route;
    if (!r || !this.helm.active) return null;
    let i0 = 0, bd = 1e9;                                            // from the nearest point ahead of the boat
    r.forEach((p, i) => { const d = Math.hypot(p[0] - this.helm.x, p[1] - this.helm.y); if (d < bd) { bd = d; i0 = i; } });
    return { car: [this.helm.x, this.helm.y], route: [[this.helm.x, this.helm.y], ...r.slice(Math.min(r.length - 1, i0 + 1))] };
  }
}
