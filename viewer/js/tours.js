// Sightseeing tours: fly, sail or walk a route of real landmarks against the clock.
// Each tour is a list of gates (glowing rings in the sky, beacons on the water and the street). Pass them in order; at
// each one a short, true fact about the landmark. Finish under par for 3 stars; your best time is saved in this
// browser. Rewards are time and stars only: the only money in this game is buying property and billboards.
// Coordinates: Blender local metres (x east-ish, y north-ish along Manhattan's grid), z up.
import * as THREE from "three";

const KEY = "ts.tours";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };
const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export const TOURS = [
  {
    id: "walk", mode: "walk", title: "Times Square on foot", sub: "Six landmarks of the bowtie · about 1 km", speed: 1.9,
    start: [-20.6, 150], gates: [
      { x: -18, y: 128, r: 9, name: "TKTS red steps",
        fact: "27 red glass steps over the TKTS booth (2008): same-day Broadway tickets below, the best seat in the square above." },
      { x: -12, y: 205, r: 9, name: "Father Duffy",
        fact: "Duffy Square is named for Father Francis Duffy, the First World War chaplain of New York's 69th Infantry Regiment." },
      { x: 25, y: 335, r: 10, name: "750 Seventh Avenue",
        fact: "750 Seventh Avenue (1989): the spiralling, stepped glass tower at 49th Street." },
      { x: -55, y: 30, r: 10, name: "Marriott Marquis",
        fact: "The Marriott Marquis (1985) has one of the tallest hotel atriums in the world and a revolving restaurant on top." },
      { x: -28, y: -122, r: 10, name: "Paramount Building",
        fact: "The Paramount Building (1926): a 33-storey tower crowned by a clock and an illuminated glass globe." },
      { x: 12, y: -190, r: 10, name: "One Times Square",
        fact: "One Times Square (1904) was The New York Times' tower; the New Year's Eve ball has dropped from its roof since 1907." },
    ],
  },
  {
    id: "boat", mode: "boat", title: "Midtown waterfront by boat", sub: "The Hudson Sightseer · about 2.6 km", speed: 4.4,
    gates: [
      { x: -1690, y: 110, r: 45, name: "USS Intrepid",
        fact: "USS Intrepid, an Essex-class carrier commissioned in 1943, has been a museum at Pier 86 since 1982." },
      { x: -1700, y: 640, r: 50, name: "Cruise terminal",
        fact: "The Manhattan Cruise Terminal's piers 88 and 90 berth ocean liners more than 300 m long, right off Midtown." },
      { x: -1700, y: -640, r: 50, name: "The Hudson",
        fact: "The Hudson is about 1.3 km wide here and tidal all the way to Troy, 246 km upriver." },
      { x: -1568, y: -210, r: 35, name: "Pier 83", finish: "tie",
        fact: "Pier 83 is the home of Midtown's harbour sightseeing cruises. Come alongside slowly and tie up (F)." },
    ],
  },
  {
    id: "air", mode: "fly", title: "Hudson & Liberty by air", sub: "Off the Intrepid, down to Liberty and back · about 21 km", speed: 46,
    gates: [
      { x: -1700, y: -1500, z: 160, r: 70, name: "Hudson River",
        fact: "Below you, Hudson River Park: 6.4 km of piers and lawns along Manhattan's west side." },
      { x: -150, y: -5400, z: 230, r: 80, name: "One World Trade Center",
        fact: "One World Trade Center: 541 m (1,776 ft) to the tip of its spire, the tallest building in the Western Hemisphere." },
      { x: -830, y: -7700, z: 150, r: 80, name: "Ellis Island",
        fact: "Ellis Island processed about 12 million immigrants arriving in America between 1892 and 1954." },
      { x: -420, y: -9050, z: 140, r: 80, name: "Statue of Liberty",
        fact: "The Statue of Liberty, dedicated in 1886: 93 m from the ground to the torch. Her copper skin is about 2.4 mm thick." },
      { x: -1600, y: -2500, z: 160, r: 90, name: "Back up the Hudson",
        fact: "Now land back on the Intrepid: “Land on the Intrepid”, or follow the gold rings in from Manhattan yourself." },
      { x: -1382, y: 32, z: 18, r: 30, name: "Intrepid", finish: "land", airport: "INT",
        fact: "" },
    ],
  },
];

export class Tours {
  // o: { scene, camera, flight, helm, walk, getMode, setMode, goTo, toast, harbor }
  constructor(o) {
    Object.assign(this, o);
    this.best = load();
    this.active = null;
    this.buildDOM();
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
    this.nextMat = new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.25, toneMapped: false, depthWrite: false });
    this.marks = new THREE.Group(); this.marks.visible = false; this.scene.add(this.marks);
    const reset = this.flight.reset.bind(this.flight);         // a crash (put back on the deck) ends an air tour
    this.flight.reset = (msg) => { if (this.active?.t.mode === "fly" && !this.flight.resetting) this.end("Tour over: " + (msg || "you touched something") + "."); return reset(msg); };
  }

  buildDOM() {
    const css = document.createElement("style");
    css.textContent = `
      #tourhud { position: fixed; left: 50%; top: calc(132px + env(safe-area-inset-top));   /* under the message cards */ transform: translateX(-50%); z-index: 26;
        display: none; align-items: center; gap: var(--s3); padding: var(--s2) var(--s4); max-width: calc(100% - 32px); box-sizing: border-box; }
      #tourhud .n { font-weight: var(--w-bold); color: var(--accent); white-space: nowrap; }
      #tourhud .tx { font-size: var(--t-caption); }
      #tourhud .clock { font-variant-numeric: tabular-nums; font-weight: var(--w-bold); }
      #tourpanel { position: fixed; left: 50%; bottom: var(--s4); transform: translateX(-50%); z-index: 31; width: min(440px, calc(100% - 32px));
        box-sizing: border-box; padding: var(--s4) var(--s5); display: none; }
      #tourpanel h3 { margin: 0 0 var(--s3); font-size: var(--t-headline); }
      #tourpanel .t { display: flex; align-items: center; gap: var(--s3); width: 100%; text-align: left; border: none; border-radius: var(--r-control);
        padding: var(--s3); margin: 0 0 var(--s2); background: var(--fill); color: var(--ink); font: var(--w-semibold) var(--t-body) var(--font); cursor: pointer; }
      #tourpanel .t:hover { background: var(--fill-hover); }
      #tourpanel .t small { display: block; color: var(--ink-3); font-weight: 400; }
      #tourpanel .t .b { margin-left: auto; white-space: nowrap; color: var(--accent); font-size: var(--t-caption); text-align: right; }`;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML("beforeend", `<div id="tourhud" class="ui-surface" role="status" aria-live="polite">
      <span class="n"></span><span class="tx"></span><span class="clock"></span>
      <button class="ui-btn" id="tourend" style="min-height:30px">End</button></div>
      <div id="tourpanel" class="ui-surface" role="dialog" aria-label="Sightseeing tours"></div>`);
    this.hud = document.getElementById("tourhud");
    this.panel = document.getElementById("tourpanel");
    document.getElementById("tourend").onclick = () => this.end("Tour ended.");
  }

  // ---------------------------------------------------------------- the list
  open() {
    const icon = { walk: "🚶", boat: "⛴", fly: "✈" };
    this.panel.innerHTML = `<h3>Sightseeing tours</h3>${TOURS.map(t => {
      const b = this.best[t.id];
      return `<button class="t" data-t="${t.id}"><span style="font-size:20px">${icon[t.mode]}</span><span>${t.title}<small>${t.sub} · par ${fmtT(this.par(t))}</small></span>
        <span class="b">${b ? `Best ${fmtT(b.time)}<br>${"★".repeat(b.stars)}${"☆".repeat(3 - b.stars)}` : "Not yet"}</span></button>`;
    }).join("")}<div class="acts" style="display:flex;justify-content:flex-end"><button class="ui-btn" data-x>Close</button></div>`;
    this.panel.style.display = "block";
    this.panel.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { this.close(); this.start(TOURS.find(t => t.id === b.dataset.t)); });
    this.panel.querySelector("[data-x]").onclick = () => this.close();
  }
  close() { this.panel.style.display = "none"; }

  par(t) {                                                   // the route at the tour's typical speed, plus 25%
    let d = 0, p = t.start || [t.gates[0].x, t.gates[0].y];
    if (t.mode === "fly") p = [-1382, 32];
    if (t.mode === "boat") p = [-1560, -208];
    for (const g of t.gates) { d += Math.hypot(g.x - p[0], g.y - p[1]); p = [g.x, g.y]; }
    return Math.round(d / t.speed * 1.25 + (t.mode === "fly" ? 40 : 15));
  }

  // ---------------------------------------------------------------- running a tour
  async start(t) {
    if (this.active) this.end();
    if (t.mode === "walk") {
      this.flight?.forceOut?.(); this.helm?.forceOut?.();
      this.goTo([t.start[0], t.start[1] - 25, 1.7], [t.start[0], t.start[1], 1.5]);
      this.setMode("walk");
    } else if (t.mode === "fly") {
      this.helm?.forceOut?.();
      if (this.flight.base?.r.code !== "INT" && this.flight.base) {   // air tours start on the Intrepid's deck
        this.flight.base = null;
        if (this.flight.active && this.flight.state !== "air") { this.flight.park(); this.flight.camSnap = true; }
      }
      if (!this.flight.active) await this.flight.board();
      this.toast?.("Take off when you're ready: the clock starts when you leave the deck.");
    } else if (t.mode === "boat") {
      this.flight?.forceOut?.();
      if (!this.helm.active) {
        await this.boat?.ready;
        this.boat?.resume?.();                                     // the Sightseer back at Pier 83
        await new Promise(r => setTimeout(r, 300));
        await this.helm.board();
      }
      this.toast?.("Full ahead (W) when you're ready: the clock starts when you get under way.");
    }
    this.active = { t, i: 0, t0: null, gates: t.gates };
    this.buildMarks();
    this.hud.style.display = "flex";
    this.draw();
  }

  buildMarks() {
    this.marks.clear();
    const { t } = this.active;
    let prev = new THREE.Vector3(-1382, 18, -32);                  // the Intrepid's deck: where air tours start
    for (const g of t.gates) {
      let m;
      if (t.mode === "fly") {
        m = new THREE.Mesh(new THREE.TorusGeometry(g.r, Math.max(1.2, g.r * 0.04), 10, 48), this.nextMat);
        m.position.set(g.x, g.z, -g.y);
        m.lookAt(prev); prev = m.position.clone();                // the ring faces the way you fly through it
      } else {
        m = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.RingGeometry(g.r * 0.85, g.r, 48), this.nextMat);
        ring.rotation.x = -Math.PI / 2; ring.position.y = t.mode === "boat" ? -1.6 : 0.12;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(t.mode === "boat" ? 2.5 : 0.6, t.mode === "boat" ? 2.5 : 0.6, t.mode === "boat" ? 60 : 30, 16, 1, true), this.nextMat);
        beam.position.y = t.mode === "boat" ? 28 : 15;
        m.add(ring, beam);
        m.position.set(g.x, 0, -g.y);
      }
      m.traverse(o => { o.raycast = () => {}; o.renderOrder = 2; });
      this.marks.add(m);
    }
    this.marks.visible = true;
    this.paint();
  }

  paint() {                                                  // the current gate bright, the next one faint, the rest hidden
    const A = this.active;
    this.marks.children.forEach((m, k) => {
      m.visible = k === A.i || k === A.i + 1;
      m.traverse(o => { if (o.isMesh) o.material = k === A.i ? this.ringMat : this.nextMat; });
    });
  }

  me() {
    const t = this.active.t.mode;
    if (t === "fly") return [this.flight.p.x, this.flight.p.y, this.flight.p.z];
    if (t === "boat") return [this.helm.x, this.helm.y, 0];
    const e = this.walk.eye; return [e.x, -e.z, e.y - 1.7];
  }

  update(dt) {
    const A = this.active;
    if (!A) return;
    const mode = A.t.mode;
    // left the vehicle: the tour is over
    if (mode === "fly" && !this.flight.active) return this.end("Tour ended: you left the plane.");
    if (mode === "boat" && !this.helm.active && !(A.i === A.gates.length - 1 && this.helm.moored)) {
      if (this.getMode() !== "walk" || A.i < A.gates.length - 1) return this.end("Tour ended: you left the helm.");
    }
    if (mode === "walk" && this.getMode() !== "walk") return this.end("Tour ended.");
    // the clock starts when you get going
    if (A.t0 == null) {
      const going = mode === "fly" ? this.flight.state === "air" : mode === "boat" ? Math.abs(this.helm.u || 0) > 0.5 : (this.walk.speed || 0) > 0.3;
      if (going) A.t0 = performance.now();
    }
    const g = A.gates[A.i], [x, y, z] = this.me();
    const d = mode === "fly" && !g.finish ? Math.hypot(g.x - x, g.y - y, g.z - z) : Math.hypot(g.x - x, g.y - y);
    let passed = d < g.r;
    if (g.finish === "land") passed = this.flight.state === "roll" && this.flight.landing      // a real landing roll
      && (!g.airport || (this.flight.base?.r.code || "INT") === g.airport);
    if (g.finish === "tie") passed = d < g.r * 3 && this.helm.moored;
    if (passed && A.t0 != null) {
      if (g.fact) this.toast?.(`${g.name}: ${g.fact}`);
      A.i++;
      if (A.i >= A.gates.length) return this.finish();
      this.paint();
    }
    if (A.t0 != null && this.ringMat) this.ringMat.opacity = 0.65 + 0.3 * Math.sin(performance.now() / 200);
    this.draw();
  }

  finish() {
    const A = this.active, secs = (performance.now() - A.t0) / 1000, par = this.par(A.t);
    const stars = secs <= par ? 3 : secs <= par * 1.3 ? 2 : 1;
    const prev = this.best[A.t.id];
    const record = !prev || secs < prev.time;
    if (record) { this.best[A.t.id] = { time: Math.round(secs), stars: Math.max(stars, prev?.stars || 0) }; save(this.best); }
    else if (stars > prev.stars) { prev.stars = stars; save(this.best); }
    this.end(`${"★".repeat(stars)}${"☆".repeat(3 - stars)}  ${A.t.title} in ${fmtT(secs)} (par ${fmtT(par)})${record ? " · new best!" : ` · best ${fmtT(prev.time)}`}`);
  }

  end(msg) {
    this.active = null;
    this.marks.visible = false;
    this.hud.style.display = "none";
    if (msg) this.toast?.(msg);
  }

  draw() {
    const A = this.active, g = A.gates[A.i];
    this.hud.querySelector(".n").textContent = `${A.i + 1}/${A.gates.length}`;
    const [x, y] = this.me(), d = Math.hypot(g.x - x, g.y - y);
    this.hud.querySelector(".tx").textContent = `${g.name} · ${d < 1000 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1) + " km"}`;
    this.hud.querySelector(".clock").textContent = A.t0 == null ? "ready" : fmtT((performance.now() - A.t0) / 1000);
  }

  // the minimap line: from you through the remaining gates
  mapInfo() {
    const A = this.active;
    if (!A) return null;
    const [x, y] = this.me();
    return { car: [x, y], route: [[x, y], ...A.gates.slice(A.i).map(g => [g.x, g.y])] };
  }
}
