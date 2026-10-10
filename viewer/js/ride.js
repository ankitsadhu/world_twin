// Book a self-driving cab, ride it across Midtown, or take the wheel yourself.
// The car is the LOD0 cab from the Blender generator (export/vehicles/taxi.glb): separate wheels (spin / steer),
// doors (open on hinges), steering wheel, seats and camera points. Routes follow the real street centrelines
// (data/<district>/nav.json NAV_roads), keep to the right-hand lane and slow down for turns.
// Coordinates: road graph in Blender local metres (x, y); three.js = (x, z = -y).
import * as THREE from "three";
import { makeBlob } from "./shadow.js";
import { Bikes, BIKE, PAINTS } from "./bike.js";
import { ICON } from "./icons.js";
import { Settings } from "./settings.js";
import { prompt, onInputChange, inputDevice } from "./gamepad.js";
import { obbContact, resolveImpact, boxInertia } from "./collide.js";

const LANE = 3.2;            // metres right of the street centreline
const V_MAX = 13;            // m/s (~29 mph): Midtown speed
const A_LAT = 2.6, A_LON = 2.4, DECEL = 3.2;
const CAR_R = 1.5;           // collision radius when you drive
const MPH = 2.237;
// the cruiser motorcycle: lighter, quicker, narrower than a car (it filters through gaps a car can't), leans into turns
const CAR_H = { wheelbase: 2.69, accel: 4.2, brake: 9, vmax: 22, steerMax: 0.55, radius: CAR_R * 0.8, front: 1.6, box: 0.9,
  people: 1.6, parked: 2.4, traffic: 2.4 };
const BIKE_H = { wheelbase: BIKE.wheelbase, accel: 6.0, brake: 11, vmax: 27, steerMax: 0.62, radius: 0.55, front: 1.05, box: 0.45,
  people: 1.3, parked: 1.5, traffic: 1.7 };
// A small number of bikes stand on the pavement at the curb, spread across the walking start and the bowtie.
// spread over Midtown (one per ~100-150 m of the street grid, on the sidewalk), not clustered: found by farthest-point sampling of the sidewalk corners
const BIKE_SPOTS = [[-563, -406, 0], [-563, 480, 1.5708], [286, -420, 3.1416], [286, 480, -1.5708], [-537, 68, 0], [-262, -171, 1.5708], [286, -78, 3.1416], [-262, 321, -1.5708], [-13, -406, 0], [13, 401, 1.5708], [286, 227, 3.1416], [13, -157, -1.5708], [-262, -420, 0], [-288, 82, 1.5708], [-537, -171, 3.1416], [-200.5, 1, -1.5708], [-26, 2, 0], [56, -10, 1.5708]];
const BIKE_WHEELBASE = BIKE.wheelbase;
const BIKE_SHOW_M = 60;                           // bikes beyond this are not drawn

// ------------------------------------------------------------------ road graph
function inPoly(ring, x, y) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

class Roads {
  constructor(rawLines, plazas = []) {
    // pedestrian plazas (Broadway through Times Square / Duffy Square) are car-free: cut those stretches out
    const onPlaza = (x, y) => plazas.some(p => inPoly(p.exterior, x, y) && !(p.holes || []).some(h => inPoly(h, x, y)));
    const lines = [];
    for (const l of rawLines) {
      let cur = [l[0]];
      for (let i = 1; i < l.length; i++) {
        const a = l[i - 1], b = l[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6));
        let blocked = false;
        for (let k = 0; k <= n && !blocked; k++) blocked = onPlaza(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n);
        if (blocked) { if (cur.length > 1) lines.push(cur); cur = [b]; } else cur.push(b);
      }
      if (cur.length > 1) lines.push(cur);
    }
    this.nodes = []; this.adj = [];
    const key = (x, y) => Math.round(x / 4) + "," + Math.round(y / 4), grid = new Map();
    const node = (x, y) => {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const i of grid.get((Math.round(x / 4) + dx) + "," + (Math.round(y / 4) + dy)) || []) {
          const n = this.nodes[i]; if (Math.abs(n[0] - x) < 4 && Math.abs(n[1] - y) < 4) return i;
        }
      }
      this.nodes.push([x, y]); this.adj.push([]);
      const k = key(x, y); (grid.get(k) || grid.set(k, []).get(k)).push(this.nodes.length - 1);
      return this.nodes.length - 1;
    };
    this.segs = [];
    for (const l of lines) {
      const ids = l.map(p => node(p[0], p[1]));
      for (let i = 0; i < ids.length - 1; i++) {
        const a = ids[i], b = ids[i + 1]; if (a === b) continue;
        const d = Math.hypot(this.nodes[a][0] - this.nodes[b][0], this.nodes[a][1] - this.nodes[b][1]);
        this.adj[a].push([b, d]); this.adj[b].push([a, d]); this.segs.push([a, b]);
      }
    }
  }
  // closest point on any road segment of the main (connected) network
  project(x, y) {
    if (!this.main) {
      const { dist } = this.dijkstra([[this.segs.reduce((m, [a]) => (this.adj[a].length > this.adj[m].length ? a : m), 0), 0]], false, true);
      this.main = dist.map(isFinite);
    }
    let best = null, bd = Infinity;
    for (const [a, b] of this.segs) {
      if (!this.main[a]) continue;
      const [ax, ay] = this.nodes[a], [bx, by] = this.nodes[b], vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L)), px = ax + vx * t, py = ay + vy * t;
      const d = Math.hypot(px - x, py - y);
      if (d < bd) { bd = d; best = { a, b, t, x: px, y: py, d }; }
    }
    return best;
  }
  // one-way rules: allow(a, b) says whether driving from node a to node b is legal (set by the viewer from the grid)
  allow() { return true; }
  // the k nearest road points (on different segments), nearest first
  // nodes you can both reach and leave legally (strongly connected under the one-way rules): the only sensible
  // places to pick someone up or drop them off. Dead-end stubs next to the plazas are excluded.
  core() {
    if (this._core) return this._core;
    this.project(0, 0);
    const hub = this.segs.reduce((m, [a]) => (this.adj[a].length > this.adj[m].length ? a : m), this.segs[0][0]);
    const f = this.dijkstra([[hub, 0]]).dist, r = this.dijkstra([[hub, 0]], true).dist;
    return (this._core = f.map((d, i) => isFinite(d) && isFinite(r[i])));
  }
  projectAll(x, y, k = 8, coreOnly = true) {
    this.project(x, y);                                    // builds the connectivity mask
    const core = coreOnly ? this.core() : null;
    const out = [];
    for (const [a, b] of this.segs) {
      if (!this.main[a] || (core && !(core[a] && core[b]))) continue;
      const [ax, ay] = this.nodes[a], [bx, by] = this.nodes[b], vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L)), px = ax + vx * t, py = ay + vy * t;
      out.push({ a, b, t, x: px, y: py, d: Math.hypot(px - x, py - y) });
    }
    return out.sort((p, q) => p.d - q.d).slice(0, k);
  }
  dijkstra(srcs, reverse = false, free = false) {   // srcs: [[node, startCost]]; reverse: costs *to* the sources
    const n = this.nodes.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    for (const [s, c] of srcs) if (c < dist[s]) dist[s] = c;
    for (;;) {                              // O(n^2) is fine for ~1.5k nodes, and runs once per booking
      let u = -1, bd = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      for (const [v, w] of this.adj[u]) {
        if (!free && !(reverse ? this.allow(v, u) : this.allow(u, v))) continue;
        if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
      }
    }
    return { dist, prev };
  }
  // route between two projected points -> polyline [[x, y], ...]
  route(p, q) {
    const P = this.nodes;
    if ((p.a === q.a && p.b === q.b) || (p.a === q.b && p.b === q.a)) return [[p.x, p.y], [q.x, q.y]];
    const dl = (i, x, y) => Math.hypot(P[i][0] - x, P[i][1] - y);
    let { dist, prev } = this.dijkstra([[p.a, dl(p.a, p.x, p.y)], [p.b, dl(p.b, p.x, p.y)]]);
    let end = dist[q.a] + dl(q.a, q.x, q.y) < dist[q.b] + dl(q.b, q.x, q.y) ? q.a : q.b;
    this.lastFree = false;
    if (!isFinite(dist[end])) {                     // no legal one-way route (map edge, data gap): ignore directions
      this.lastFree = true;
      ({ dist, prev } = this.dijkstra([[p.a, dl(p.a, p.x, p.y)], [p.b, dl(p.b, p.x, p.y)]], false, true));
      end = dist[q.a] + dl(q.a, q.x, q.y) < dist[q.b] + dl(q.b, q.x, q.y) ? q.a : q.b;
    }
    if (!isFinite(dist[end])) return null;
    const ids = []; for (let u = end; u >= 0; u = prev[u]) ids.unshift(u);
    return [[p.x, p.y], ...ids.map(i => P[i]), [q.x, q.y]];
  }
  // a road node roughly `d` metres of driving away from q (where the cab comes from)
  nodeAway(q, d, towards = true) {               // towards: a node from which you can legally drive to q
    const { dist } = this.dijkstra([[q.a, 0], [q.b, 0]], towards);
    let best = q.a, bd = Infinity;
    for (let i = 0; i < dist.length; i++) if (isFinite(dist[i]) && Math.abs(dist[i] - d) < bd) { bd = Math.abs(dist[i] - d); best = i; }
    return { a: best, b: best, t: 0, x: this.nodes[best][0], y: this.nodes[best][1] };
  }
}

// polyline (centreline) -> smooth right-lane path sampled every metre, with a speed limit per sample
function buildPath(pts, endStop = true) {
  const clean = [pts[0]];
  for (const p of pts.slice(1)) { const q = clean[clean.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1.5) clean.push(p); }
  if (clean.length < 2) clean.push([clean[0][0] + 0.1, clean[0][1]]);
  const dir = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
  // lane offset: to the right of travel ((dx, dy) -> right normal (dy, -dx))
  const off = clean.map((p, i) => {
    const d0 = dir(clean[Math.max(0, i - 1)], clean[Math.min(clean.length - 1, i === 0 ? 1 : i)]);
    const d1 = dir(clean[Math.max(0, i === clean.length - 1 ? i - 1 : i)], clean[Math.min(clean.length - 1, i + 1)]);
    let nx = d0[1] + d1[1], ny = -d0[0] - d1[0]; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    const k = Math.min(1.8, 1 / Math.max(0.55, (d0[0] * d1[0] + d0[1] * d1[1] + 1) / 2) ** 0.5);   // keep lane width round corners
    return [p[0] + nx * LANE * k, p[1] + ny * LANE * k];
  });
  // round the corners: replace each bend by two points r metres before / after it
  const f = [off[0]];
  for (let i = 1; i < off.length - 1; i++) {
    const a = off[i - 1], p = off[i], b = off[i + 1], u = dir(a, p), w = dir(p, b);
    if (u[0] * w[0] + u[1] * w[1] > 0.97) { f.push(p); continue; }
    const r = Math.min(8, Math.hypot(p[0] - a[0], p[1] - a[1]) / 2.2, Math.hypot(b[0] - p[0], b[1] - p[1]) / 2.2);
    f.push([p[0] - u[0] * r, p[1] - u[1] * r], [p[0] + w[0] * r, p[1] + w[1] * r]);
  }
  f.push(off[off.length - 1]);
  const curve = new THREE.CatmullRomCurve3(f.map(p => new THREE.Vector3(p[0], -p[1], 0)), false, "centripetal");
  const len = curve.getLength(), n = Math.max(2, Math.ceil(len));
  const s = curve.getSpacedPoints(n).map(v => [v.x, -v.y]);
  const head = s.map((p, i) => { const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); });
  const v = head.map((h, i) => {
    const a = head[Math.max(0, i - 4)], b = head[Math.min(head.length - 1, i + 4)];
    let dh = Math.abs(b - a); if (dh > Math.PI) dh = 2 * Math.PI - dh;
    const kappa = dh / 8;
    return Math.min(V_MAX, Math.sqrt(A_LAT / Math.max(kappa, 1e-4)));
  });
  if (endStop) v[v.length - 1] = 0;
  for (let i = v.length - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * DECEL * (len / n)));
  return { pts: s, head, v, len, step: len / n };
}

const NO_PARTS = { wheels: [], doors: {}, steer: null, seat: {}, cam: {} };

// ------------------------------------------------------------------ the ride
export class Ride {
  constructor(o) {
    // o: { root, district, scene, camera, dom, nav, walk, groundAt, getCollider, setMode, getMode, loader, registerMaterial, refreshTime,
    //      screens, demoArt, audio, setWalkerAt }
    Object.assign(this, o);
    this.state = "idle";       // idle | choose | coming | waiting | riding | driving | arrived
    this.view = "chase";
    this.look = { yaw: 0, pitch: -0.08, drag: null, idle: 0 };
    this.ctl = { up: 0, down: 0, left: 0, right: 0 };
    this.vehicle = null; this.v = 0; this.steer = 0;   // vehicle: { group, parts, kind: "taxi" | "car" | "bike", type }
    this.damage = 0; this.slideX = 0; this.slideY = 0; this.yawRate = 0;
    this.bikeAir = 0; this.bikeVy = 0;
    this.bikes = new Bikes({ loader: o.loader, root: o.root, registerMaterial: o.registerMaterial });   // the cruiser motorcycle
    this.parked = [];                                    // cars you got out of: they stay where you left them
    this.nextGarageVehicle = BIKE_SPOTS.length;
    this.garageReady = false;
    this.towing = [];
    this.hidden = [];
    Promise.all([fetch(`${o.root}data/${o.district}/nav.json`).then(r => r.json()),
                 fetch(`${o.root}data/${o.district}/ground.json`).then(r => r.json())])
      .then(([d, g]) => {
        this.roads = new Roads(d.paths.NAV_roads.lines, g.plazas || []);
      });
    this.buildDOM();
    this.bindInput();
  }

  // live traffic: the cab follows its lights, gaps and one-way rules
  setTraffic(t) {
    this.traffic = t;
    this.bikeSpawnPromise = this.spawnBikes();
    this.me_ = { alive: () => !!this.car?.visible && this.state !== "idle", pose: () => this.pose() };
    t.extra.push(this.me_);
    const apply = () => {
      if (!this.roads) return setTimeout(apply, 300);
      t.setRoads(this.roads.nodes, this.roads.segs);             // traffic only where a street really is
      const N = this.roads.nodes;
      this.roads.allow = (a, b) => {
        const [ax, ay] = N[a], [bx, by] = N[b], dx = bx - ax, dy = by - ay, mx = (ax + bx) / 2, my = (ay + by) / 2;
        if (Math.abs(dy) > 2 * Math.abs(dx)) { const av = t.avenues.find(v => Math.abs(mx - v.x) < v.w / 2); return !av || Math.sign(dy) === av.dir; }
        if (Math.abs(dx) > 2 * Math.abs(dy)) { const st = t.streets.find(v => Math.abs(my - v.y) < v.w / 2); return !st || st.dir === 0 || Math.sign(dx) === st.dir; }
        return true;
      };
      this.roads._core = null;                                   // recompute the legal core under the new rules
    };
    apply();
  }

  get car() { return this.vehicle?.group || null; }
  get parts() { return this.vehicle?.parts || NO_PARTS; }
  get active() { return this.state !== "idle"; }
  get inCar() { return this.state === "riding" || this.state === "driving" || this.state === "arrived"; }

  // ---------------------------------------------------------------- UI
  buildDOM() {
    const css = document.createElement("style");
    css.textContent = `
      #ridepanel { position: fixed; left: 50%; bottom: var(--s4); transform: translateX(-50%); z-index: 30; width: min(440px, calc(100% - 32px));
        box-sizing: border-box; padding: var(--s4) var(--s5); display: none; }
      #ridepanel h3 { margin: 0 0 var(--s1); font-size: var(--t-headline); font-weight: var(--w-semibold); display: flex; align-items: center; gap: var(--s2); }
      #ridepanel p { margin: 0 0 var(--s3); color: var(--ink-2); font-size: var(--t-caption); }
      #ridepanel .acts { display: flex; gap: var(--s2); flex-wrap: wrap; align-items: center; }
      #ridepanel .acts .x { margin-left: auto; width: var(--hit); padding: 0; display: grid; place-items: center; }
      #ridepanel .dest { display: flex; flex-direction: column; gap: 2px; max-height: 34vh; overflow: auto; margin: 0 0 var(--s3); }
      #ridepanel .dest button { min-height: var(--hit); text-align: left; border: none; border-radius: var(--r-control); padding: 0 var(--s3);
        background: var(--fill); color: var(--ink); font: var(--w-semibold) var(--t-body) var(--font); cursor: pointer; display: flex; align-items: center; gap: var(--s2); }
      #ridepanel .dest button:hover { background: var(--fill-hover); }
      #ridepanel .dest small { margin-left: auto; color: var(--ink-3); font-weight: var(--w-regular); font-size: var(--t-caption); }
      #ridepanel .big { font-size: var(--t-large); font-weight: var(--w-bold); line-height: 1; }
      #ridepanel .stats { display: flex; gap: var(--s4); align-items: baseline; margin: 0 0 var(--s3); color: var(--ink-2); font-size: var(--t-caption); }
      #hopin { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 28; display: none; align-items: center;
        gap: var(--s2); box-shadow: var(--shadow); }
      #hopin kbd { font: var(--w-semibold) var(--t-caption) var(--font); background: rgba(0,0,0,.15); border-radius: 6px; padding: 2px 6px; }
      body[data-input="touch"] #hopin kbd { display: none; }
      #ridefab { position: fixed; left: var(--s3); z-index: 12; display: none; align-items: center; gap: var(--s2); }
      #drivepad { position: fixed; inset: auto 0 0 0; z-index: 29; display: none; pointer-events: none; }
      #drivepad button { pointer-events: auto; position: absolute; width: 72px; height: 72px; border-radius: 36px; border: none; color: var(--ink);
        background: var(--glass); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); font: var(--w-bold) 15px var(--font);
        touch-action: none; user-select: none; -webkit-user-select: none; }
      #drivepad button.on { background: var(--accent); color: var(--accent-ink); }
      @media (max-width: 640px) {
        #ridepanel { bottom: calc(68px + env(safe-area-inset-bottom)); }
        #ridefab { display: none; }                                   /* Ride is a tab in the bottom bar now */
        body.riding #zoom { display: none !important; }            /* the ride panel owns the bottom of a phone screen */
        body.riding #wpchip { display: none !important; }          /* the ride panel already says where the cab is */
      }
      #ridepanel .ui-btn:disabled { opacity: .4; cursor: default; }
      /* riding / driving: one slim row (title, speed, actions) so the panel never covers the car */
      body.ridestrip #ridepanel { display: flex !important; align-items: center; gap: var(--s3); width: auto; max-width: calc(100% - 32px); padding: var(--s2) var(--s3); }
      body.ridestrip #ridepanel h3 { margin: 0; font-size: var(--t-body); white-space: nowrap; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
      body.ridestrip #ridepanel h3 svg { flex: none; }
      body.ridestrip #ridepanel .stats { margin: 0; white-space: nowrap; }
      body.ridestrip #ridepanel .big { font-size: var(--t-title); }
      body.ridestrip #ridepanel p, body.ridestrip #ride-left { display: none; }
      body.ridestrip #ridepanel .acts { flex-wrap: nowrap; }
      body.ridestrip #ridepanel .ui-btn { min-height: 36px; font-size: var(--t-caption); padding: 0 var(--s3); white-space: nowrap; }
      @media (min-width: 641px) {        /* centred in the free space between the minimap (left) and the dock (right) */
        body.ridestrip #ridepanel { left: 236px; right: 88px; transform: none; margin-inline: auto; width: fit-content; }
      }
      @media (max-width: 640px) { body.ridestrip #ridepanel { flex-wrap: wrap; } body.ridestrip #ridepanel h3 { max-width: 60vw; } }
      /* phones while driving: a slim status strip on top, thumbs free for the pedals at the bottom */
      body.drivetouch #ridepanel { top: calc(64px + env(safe-area-inset-top)); bottom: auto; padding: var(--s2) var(--s3); }
      body.drivetouch #ridepanel h3, body.drivetouch #ridepanel p { display: none; }
      body.drivetouch #ridepanel .stats { margin: 0 0 var(--s2); }
      body.drivetouch #ridepanel .ui-btn { min-height: 36px; font-size: var(--t-caption); padding: 0 var(--s3); }
      body.drivetouch #minimap { top: auto !important; bottom: calc(176px + env(safe-area-inset-bottom)) !important; }
      body.incar #minimap { opacity: .95; }
      body.incar #zoom, body.incar [data-t], body.incar #wpchip { display: none !important; }`;
    document.head.appendChild(css);
    const carIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
      stroke-linejoin="round" aria-hidden="true"><path d="M5 16V11.5L7 6.5h10l2 5V16"/><path d="M3.5 11.5h17"/><rect x="3.5" y="11.5" width="17" height="5" rx="1.5"/>
      <circle cx="7.5" cy="17.5" r="1.6"/><circle cx="16.5" cy="17.5" r="1.6"/><path d="M10 4.5h4"/></svg>`;
    this.carIcon = carIcon;
    document.body.insertAdjacentHTML("beforeend", `
      <div id="ridepanel" class="ui-surface" role="dialog" aria-live="polite"></div>
      <button id="hopin" class="ui-btn primary" aria-label="Hop in this car">${carIcon}Hop in<kbd>${prompt("interact")}</kbd></button>
      <button id="ridefab" class="ui-btn ui-surface" aria-label="Book a self-driving car">${carIcon}Ride</button>
      <div id="drivepad" aria-hidden="true">
        <button data-c="left" style="left:16px;bottom:calc(var(--drivepad-b) + 0px)">◀</button>
        <button data-c="right" style="left:100px;bottom:calc(var(--drivepad-b) + 0px)">▶</button>
        <button data-c="down" style="right:100px;bottom:calc(var(--drivepad-b) + 0px)">Brake</button>
        <button data-c="up" style="right:16px;bottom:calc(var(--drivepad-b) + 24px)">Go</button>
        <button data-c="horn" style="left:58px;bottom:calc(var(--drivepad-b) + 84px);width:56px;height:56px">Horn</button>
      </div>
      <div id="garage" class="ui-surface" role="dialog" aria-modal="true" aria-labelledby="garage-title" hidden>
        <section><header><h2 id="garage-title">My Garage</h2><button class="ui-btn garage-close" aria-label="Close garage">${ICON.close}</button></header>
          <p>Your cars and motorcycles stay where you park them. Find one on the map to walk back and get in.</p>
          <div class="garage-list"></div>
        </section>
      </div>`);
    const dock = document.getElementById("dock");
    dock?.querySelector("#walk")?.insertAdjacentHTML("afterend",
      `<button id="ridebtn" class="dockbtn" aria-pressed="false" aria-label="Ride or drive">${carIcon}<span>Ride a cab or drive</span><em>Ride</em></button>
       <button id="garagebtn" class="dockbtn" aria-label="My Garage" aria-haspopup="dialog">${carIcon}<span>My Garage</span><em>Garage</em></button>`);
    this.panel = document.getElementById("ridepanel");
    this.hopChip = document.getElementById("hopin");
    this.garage = document.getElementById("garage");
    const garageCss = document.createElement("style");
    garageCss.textContent = `
      #garage { position: fixed; inset: 0; z-index: 65; display: grid; place-items: center; padding: var(--s4); box-sizing: border-box; background: rgba(0,0,0,.42); }
      #garage[hidden] { display: none; }
      #garage section { width: min(480px, 100%); max-height: min(620px, 100%); overflow: auto; box-sizing: border-box; padding: var(--s5); }
      #garage header { display: flex; justify-content: space-between; align-items: center; gap: var(--s3); }
      #garage h2 { margin: 0; font-size: var(--t-title); }
      #garage p { color: var(--ink-2); font-size: var(--t-caption); line-height: 1.5; margin: var(--s2) 0 var(--s4); }
      #garage .garage-list { display: grid; gap: var(--s2); }
      #garage .garage-empty { padding: var(--s4); border-radius: var(--r-control); background: var(--fill); color: var(--ink-2); font-size: var(--t-body); }
      #garage .garage-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); padding: var(--s3); border-radius: var(--r-control); background: var(--fill); }
      #garage .garage-row strong, #garage .garage-row small { display: block; }
      #garage .garage-row small { margin-top: 3px; color: var(--ink-3); font-size: var(--t-caption); }
      @media (max-width: 640px) { #garage section { padding: var(--s4); } }`;
    document.head.appendChild(garageCss);
    this.hopChip.onclick = () => (this.approaching ? this.enter(this.approaching.t) : this.approach(this.hopTarget));
    onInputChange(() => { this.hopChip.querySelector("kbd").textContent = prompt("interact"); if (this.active) this.render(); });
    addEventListener("keydown", e => {
      if (e.code === "KeyF" && !e.repeat && e.target.tagName !== "INPUT") {
        if (this.approaching) this.enter(this.approaching.t);
        else if (this.hopTarget && !this.inCar) this.approach(this.hopTarget);
        else if (this.inCar && this.borrowed) this.getOut();        // F again: get out (like GTA)
      }
    });
    addEventListener("keydown", e => {
      if (e.code === "Space" && !e.repeat && e.target.tagName !== "INPUT" && this.inCar && this.vehicle?.kind === "bike") {
        e.preventDefault();
        this.jumpBike();
      }
    });
    document.getElementById("ridefab").onclick = () => this.open();
    document.getElementById("ridebtn").onclick = () => (this.active ? this.render() : this.open());
    document.getElementById("garagebtn").onclick = () => this.openGarage();
    this.garage.querySelector(".garage-close").onclick = () => this.closeGarage();
    this.garage.addEventListener("click", e => { if (e.target === this.garage) this.closeGarage(); });
    const pad = document.getElementById("drivepad");
    pad.style.setProperty("--drivepad-b", "calc(76px + env(safe-area-inset-bottom))");
    pad.querySelectorAll("button").forEach(b => {
      const k = b.dataset.c, on = v => e => {
        e.preventDefault();
        if (k === "horn") { if (v) this.vehicle?.kind === "bike" ? this.jumpBike() : this.honk(); return; }
        this.ctl[k] = v; b.classList.toggle("on", !!v);
      };
      b.addEventListener("pointerdown", on(1)); b.addEventListener("pointerup", on(0));
      b.addEventListener("pointercancel", on(0)); b.addEventListener("pointerleave", on(0));
    });
  }

  render() {
    const P = this.panel, s = this.state;
    document.body.classList.toggle("riding", this.active);
    document.body.classList.toggle("incar", this.inCar);
    const touch = inputDevice() === "touch", pad = inputDevice() === "pad";
    document.getElementById("drivepad").style.display = s === "driving" && touch ? "block" : "none";
    document.body.classList.toggle("drivetouch", s === "driving" && touch);
    document.body.classList.toggle("ridestrip", (s === "riding" || s === "driving") && !(s === "driving" && touch));
    const bike = this.vehicle?.kind === "bike";
    const touchAction = document.querySelector('#drivepad [data-c="horn"]');
    if (touchAction) {
      touchAction.textContent = bike ? "Hop" : "Horn";
      touchAction.setAttribute("aria-label", bike ? "Hop on motorcycle" : "Honk");
    }

    if (s === "driving" && !touch) this.nav.tip?.(pad ? "drivepad" : "drivekeys", pad
      ? bike ? "R2 go · L2 brake · left stick steer · R1 hop · ○ get off" : "R2 go · L2 brake · left stick steer · □ horn · ○ get out"
      : bike ? "W go · S brake · A/D steer · Space hop · F get off" : "W go · S brake · A/D steer · H horn · F get out");
    if (s === "idle") { P.style.display = "none"; return; }
    P.style.display = "block";
    const x = `<button class="ui-btn x" data-a="cancel" aria-label="Cancel ride">${ICON.close}</button>`;
    const dest = this.dest ? this.dest.name : "Free drive";
    if (s === "choose") {
      // like a maps app: nearby places by cab, the waterfront (where the boat and the plane are), and the harbour
      // (beyond Midtown's roads: those open Directions, which mixes cab, boat and plane)
      const [mx, my] = this.me(), d = p => Math.hypot(p.x - mx, p.y - my);
      const mid = p => p.x > -1750 && p.x < 960 && p.y > -720 && p.y < 740;
      const L = (this.nav.places || []).filter(p => p.kind === "landmark");
      const water = ["pier83", "intrepid"].map(id => L.find(p => p.id === id)).filter(Boolean);
      const near = L.filter(p => mid(p) && !water.includes(p)).sort((a, b) => d(a) - d(b)).slice(0, 6);
      const far = L.filter(p => !mid(p)).sort((a, b) => d(a) - d(b));
      const row = (p, sub, attr) => `<button ${attr}="${p.id}">${p.name}${sub ? ` <span style="color:var(--ink-3);font-weight:400">· ${sub}</span>` : ""}<small>${fmtDist(d(p))}</small></button>`;
      const head = t => `<div style="margin:var(--s2) 0 2px;color:var(--ink-3);font-size:var(--t-caption);font-weight:600">${t}</div>`;
      P.innerHTML = `<h3>${this.carIcon} Where to?</h3>
        <p>A self-driving cab anywhere on Midtown's streets. Beyond Midtown, tap a place for directions (walk, boat or plane).</p>
        <div class="dest">${head("Nearby · by cab")}${near.map(p => row(p, "", "data-dest")).join("")}
          ${head("Waterfront · the boat and the plane")}${water.map(p => row(p, p.id === "pier83" ? "Hudson Sightseer" : "fly a plane", "data-dest")).join("")}
          ${far.length ? head("Beyond Midtown · walk, boat or plane") + far.map(p => row(p, "directions", "data-dirs")).join("") : ""}</div>
        <div class="acts"><button class="ui-btn" data-a="free">Free drive · take the wheel</button>${x}</div>`;
    } else if (s === "coming") {
      P.innerHTML = `<h3>${this.carIcon} Your self-driving cab is on its way</h3>
        <div class="stats"><span class="big" id="ride-eta">–</span><span>to ${dest}</span></div>
        <p>Pickup at the nearest curb, ${fmtDist(this.pickupDist || 0)} from you (yellow beacon)${this.pickupDist > 120 ? ` · about ${Math.max(1, Math.round(this.pickupDist / 80))} min walk` : ""}.</p>
        <div class="acts">${x}</div>`;
    } else if (s === "waiting") {
      P.innerHTML = `<h3>${this.carIcon} Your cab is here</h3><p>${this.dest ? `Ride to ${dest}` : "Get in and take the wheel"}</p>
        <div class="acts"><button class="ui-btn primary" data-a="getin">Get in${pad ? " · ✕" : ""}</button>
        <button class="ui-btn" data-a="show">Show me</button>${x}</div>`;
    } else if (s === "riding" || s === "driving") {
      const self = s === "riding";
      const chaseReady = s === "driving" && !bike && this.pursuit;
      const chaseLabel = this.pursuit?.active ? "End 2-star chase"
        : this.pursuit?.state === "escaped" || this.pursuit?.state === "caught" ? "Replay 2-star chase" : "Start 2-star chase";
      P.innerHTML = `<h3>${this.carIcon} ${self ? `Riding to ${dest}${this.detour ? " · taking a detour" : ""}` : this.vehicle?.kind === "bike" ? "Cruiser motorcycle" : this.borrowed ? "Your car" : "You're driving"}</h3>
        <div class="stats"><span class="big" id="ride-speed">0</span><span>mph</span><span id="ride-left"></span></div>
        ${self ? "" : `<p>${bike
          ? pad ? "R2 go · L2 brake · left stick steer · R1 hop · ○ get off" : touch ? "Hold Go / Brake, tap ◀ ▶ to steer · Hop"
            : "W / ↑ go · S / ↓ brake · A D / ← → steer · Space hop"
          : pad ? "R2 go · L2 brake · left stick steer · □ horn · ○ get out" : touch ? "Hold Go / Brake, tap ◀ ▶ to steer"
            : "W / ↑ go · S / ↓ brake · A D / ← → steer · H horn"}</p>`}
        <div class="acts">
          ${self ? `<button class="ui-btn primary" data-a="wheel">Take the wheel</button>`
                 : `<button class="ui-btn primary" data-a="auto"${this.dest ? "" : " disabled"}>Self-drive</button>`}
          ${this.vehicle?.kind === "bike" ? `<button class="ui-btn" data-a="paint">Repaint: ${PAINTS[this.vehicle.paint ?? 0]?.name || ""}</button>` : ""}
          ${this.vehicle?.kind === "taxi" ? `<button class="ui-btn" data-a="view">${this.view === "chase" ? "Inside view" : "Outside view"}</button>` : ""}
          ${!self && this.vehicle?.type === "Taxi" ? `<button class="ui-btn" data-a="fares">${this.fares?.active ? "Off duty" : "Take fares"}${touch ? "" : " · J"}</button>` : ""}
          ${chaseReady ? `<button class="ui-btn${this.pursuit.active ? " danger" : ""}" data-a="pursuit">${chaseLabel}</button>` : ""}
          <button class="ui-btn" data-a="out">${self ? "Stop & get out" : "Park & get out"}${this.borrowed && !touch ? " · " + prompt(pad ? "back" : "interact") : ""}</button></div>`;
      if (chaseReady) P.insertAdjacentHTML("beforeend", `<p id="pursuit-status" role="status" style="margin:var(--s2) 0 0;color:var(--ink-2);font-size:var(--t-caption)">${this.pursuit.status}</p>`);
    } else if (s === "arrived") {
      P.innerHTML = `<h3>${this.carIcon} You've arrived</h3><p>${dest}</p>
        <div class="acts"><button class="ui-btn primary" data-a="out">Get out</button><button class="ui-btn" data-a="wheel">Keep driving</button></div>`;
    }
    P.querySelectorAll("[data-a]").forEach(b => b.onclick = () => this.action(b.dataset.a));
    P.querySelectorAll("[data-dest]").forEach(b => b.onclick = () => this.book(this.nav.byId.get(b.dataset.dest)));
    P.querySelectorAll("[data-dirs]").forEach(b => b.onclick = () => { const p = (this.nav.places || []).find(q => q.id === b.dataset.dirs); this.end(); this.onDirections?.(p); });
  }

  assignGarageId(v) {
    if (!v.garageId) v.garageId = v.kind === "bike"
      ? v.marker?.id || `bike_${++this.nextGarageVehicle}`
      : `car_${++this.nextGarageVehicle}`;
    const n = Number(v.garageId.match?.(/_(\d+)$/)?.[1]);
    if (Number.isFinite(n)) this.nextGarageVehicle = Math.max(this.nextGarageVehicle, n);
    return v.garageId;
  }

  garageVehicles() {
    const vehicles = this.parked.filter(v => v !== this.taxi || v.garageId);
    if (this.inCar && this.vehicle && (this.vehicle !== this.taxi || this.borrowed)) vehicles.push(this.vehicle);
    return vehicles.filter(v => (v.pinned || this.parked.includes(v) || v === this.vehicle))
      .filter(v => v.garageId || v === this.vehicle || !v.pinned)
      .map(v => { this.assignGarageId(v); return v; });
  }

  openGarage() {
    this.renderGarage();
    this.garage.hidden = false;
  }

  closeGarage() {
    this.garage.hidden = true;
  }

  renderGarage() {
    const list = this.garage.querySelector(".garage-list");
    const vehicles = this.garageVehicles();
    list.replaceChildren();
    if (!vehicles.length) {
      const empty = document.createElement("div");
      empty.className = "garage-empty";
      empty.textContent = "No personal vehicles yet. Drive a car or ride a motorcycle to add it to your garage.";
      list.append(empty);
      return;
    }
    for (const v of vehicles) {
      const row = document.createElement("div");
      row.className = "garage-row";
      const details = document.createElement("div");
      const title = document.createElement("strong");
      const type = String(v.type || "Car").replace(/^Car/, "");
      title.textContent = v.kind === "bike" ? "Cruiser motorcycle" : v.type === "Taxi" ? "Taxi"
        : type.startsWith("SUV") ? `${type.slice(3)} SUV` : type.startsWith("Sedan") ? `${type.slice(5)} Sedan`
          : type.replace(/([a-z])([A-Z])/g, "$1 $2").trim() || "Car";
      const status = document.createElement("small");
      status.textContent = v === this.vehicle && this.inCar ? "Currently driving" : "Parked · find on map";
      details.append(title, status);
      const button = document.createElement("button");
      button.className = "ui-btn";
      button.type = "button";
      button.textContent = v === this.vehicle && this.inCar ? "In use" : "Find";
      button.disabled = v === this.vehicle && this.inCar;
      button.onclick = () => {
        if (!v.marker) this.syncVehicleMarkers();
        if (v.marker) { this.closeGarage(); this.onGarageMap?.(v.marker); }
      };
      row.append(details, button);
      list.append(row);
    }
  }

  garageData() {
    return this.garageVehicles().map(v => {
      const id = this.assignGarageId(v);
      return { id, type: v.type, kind: v.kind, markerId: v.marker?.id || null,
        x: +v.group.position.x.toFixed(2), y: +(-v.group.position.z).toFixed(2), h: +(v.heading || 0).toFixed(4) };
    });
  }

  action(a) {
    if (a === "cancel") return this.end();
    if (a === "free") return this.book(null);
    if (a === "getin") return this.approach({ booked: true });
    if (a === "show") return this.showCar(true);
    if (a === "wheel") { this.state = "driving"; this.look.yaw = 0; return this.render(); }
    if (a === "auto") return this.autopilot();
    if (a === "paint") { const v = this.vehicle; v.userPaint = true; const p = this.bikes.repaint(v, (v.paint ?? 0) + 1); this.toast?.(p.name); return this.render(); }
    if (a === "view") { this.view = this.view === "chase" ? "inside" : "chase"; this.look.yaw = 0; return this.render(); }
    if (a === "out") return this.getOut();
    if (a === "pursuit") {
      if (this.pursuit?.active) this.pursuit.finish("ended", "Challenge ended by you.");
      else if (!this.pursuit?.start()) this.toast?.("Cruisers need a nearby street to start the challenge.");
      return this.render();
    }
    if (a === "fares") { this.onFares?.(); return this.render(); }
  }

  // ---------------------------------------------------------------- booking
  me() {                       // where "you" are: the camera at street level, the map centre when high above the city
    const c = this.camera.position, high = this.getMode() !== "walk" && c.y > 40 && this.nav.orbit;
    const p = high ? this.nav.orbit.target : c;
    return [p.x, -p.z];
  }

  open() {
    if (!this.roads) return;
    if (this.active && this.state !== "choose") return this.render();
    this.state = "choose"; this.nav.pickingRide = true; this.render();
  }

  // search / map "Ride" while choosing or riding: (re)route to that place
  setDestination(place) {
    if (this.state === "choose" || this.state === "idle") return this.book(place);
    this.dest = place;
    if (this.inCar) return this.autopilot();
    this.render();
  }

  async book(place) {
    if (!this.roads) return;
    this.nav.pickingRide = false;
    this.dest = place || null;
    this.borrowed = false;
    await this.ensureCar();
    const [x, y] = this.me();
    let pts = null;
    for (const cand of this.roads.projectAll(x, y, 10)) {
      const from = this.roads.nodeAway(cand, 260);
      const r = this.roads.route(from, cand);
      if (!r || this.roads.lastFree) continue;                     // needs a legal approach
      let len = 0; for (let i = 1; i < r.length; i++) len += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
      if (len < 80) continue;                                       // a dead-end stub: nowhere to come from
      this.pickup = cand; pts = r; break;
    }
    if (!pts) { this.pickup = this.roads.project(x, y); pts = this.roads.route(this.roads.nodeAway(this.pickup, 260), this.pickup); }
    if (!pts) return this.end();
    this.path = buildPath(pts);
    this.pickupDist = Math.hypot(this.pickup.x - x, this.pickup.y - y);
    this.restoreTraffic(); this.clearTraffic(this.path);
    this.s = 0; this.v = 0;
    this.placeCarOnPath(0);
    this.car.visible = true;
    this.state = "coming";
    if (this.nav.setWaypoint) {
      this.nav.setWaypoint({ id: "pickup", name: "Your ride", kind: "point", x: this.path.pts.at(-1)[0], y: this.path.pts.at(-1)[1] });
      if (this.nav.q && document.activeElement !== this.nav.q) this.nav.q.value = "";
    }
    this.render();
  }

  autopilot() {
    if (!this.dest) return;
    const [x, y] = [this.car.position.x, -this.car.position.z];
    const p = this.roads.project(x, y);
    // drop-off: the nearest curb you can reach legally (within ~60 m more walking); otherwise the nearest, as a detour
    let pts = null, detour = true;
    const cands = this.roads.projectAll(this.dest.x, this.dest.y, 10);
    for (const q of cands) {
      if (q.d > cands[0].d + 60) break;
      const r = this.roads.route(p, q);
      if (r && !this.roads.lastFree) { pts = r; detour = false; break; }
    }
    if (!pts) pts = this.roads.route(p, cands[0] || this.roads.project(this.dest.x, this.dest.y));
    if (!pts) return;
    this.path = buildPath([[x, y], ...pts]);
    this.detour = detour;                             // honest: say when the route had to bend a one-way rule
    this.s = 0;
    this.restoreTraffic(); this.clearTraffic(this.path);
    this.state = "riding";
    this.nav.setWaypoint?.(this.dest);
    this.render();
  }

  async getIn() {
    this.state = "riding";
    this.setMode("ride");
    this.door(1);
    setTimeout(() => this.door(0), 1400);
    this.audio?.setCabin?.(1);
    this.camBlend = 0;
    if (this.dest) this.autopilot(); else { this.state = "driving"; this.path = null; }
    this.nav.setWaypoint?.(this.dest || null);
    this.render();
  }

  getOut() {
    if (this.bikeAir > 0) { this.toast?.("Wait for the motorcycle to land before getting off"); return; }
    const car = this.car;
    this.bikeAir = 0; this.bikeVy = 0;
    this.door(1); setTimeout(() => this.door(0), 1200);
    // step out on the passenger side (the curb), facing the way the car points
    const side = new THREE.Vector3(this.vehicle?.kind === "bike" ? 1.1 : 1.7, 0, 0).applyQuaternion(car.quaternion);
    const fwd = new THREE.Vector3(0, 0, this.vehicle?.kind === "bike" ? 1 : -1).applyQuaternion(car.quaternion);
    this.audio?.setCabin?.(0);
    const pos = car.position.clone().add(side);
    this.setWalkerAt(pos, fwd);
    this.nav.setWaypoint?.(null);
    document.body.classList.remove("incar", "riding", "drivetouch", "ridestrip");
    this.panel.style.display = "none";
    document.getElementById("drivepad").style.display = "none";
    if (this.wrecked) {
      const wreck = this.vehicle;
      if (wreck.kind === "bike") { this.bikes.dismount(wreck); this.bikes.pose(wreck, 0, 0, 0); }
      if (!this.parked.includes(wreck)) this.parked.push(wreck);
      this.startTow(wreck);
      this.vehicle = null; this.v = 0; this.borrowed = false; this.damage = 0; this.wrecked = false;
      this.state = "idle"; this.render();
      return;
    }
    if (this.vehicle !== this.taxi || this.borrowed) {               // personal vehicle: keep it where you parked it
      const v = this.vehicle; v.heading = this.heading; v.speed = 0;
      this.assignGarageId(v);
      if (v.kind === "bike") { this.bikes.dismount(v); this.bikes.pose(v, 0, 0, 0); v.stand = 0; v.pinned = true; }   // kickstand down, leaning
      this.parked.push(v);
      if (v.kind === "bike" && !v.marker) {
        v.marker = { id: this.assignGarageId(v), icon: "bike", label: "Your motorcycle", x: car.position.x, y: -car.position.z, minS: 0.45 };
        this.onBikes?.([v.marker]);
      }
      this.syncVehicleMarkers();
      this.traffic?.extra.push({ temp: true, alive: () => this.parked.includes(v), pose: () => [v.group.position.x, -v.group.position.z, v.heading, 0] });
      while (this.parked.filter(p => !p.pinned).length > 4) { const old = this.parked.find(p => !p.pinned); this.parked = this.parked.filter(p => p !== old); this.scene.remove(old.group); }
      this.syncVehicleMarkers();
      this.vehicle = null; this.v = 0; this.borrowed = false;
      this.state = "idle"; this.render();
      return;
    }
    this.state = "leaving";
    // the cab pulls away and disappears down the street
    const [x, y] = [car.position.x, -car.position.z];
    const p = this.roads.project(x, y);
    const away = this.roads.nodeAway(p, 220, false);
    const pts = this.roads.route(p, away);
    this.path = pts ? buildPath([[x, y], ...pts]) : null;
    this.s = 0;
    this.leaveT = 9;
  }

  end() {
    if (this.inCar) return this.getOut();
    this.state = "idle"; this.nav.pickingRide = false;
    if (this.car) this.car.visible = false;
    this.restoreTraffic();
    this.path = null;
    if (this.nav.waypoint?.place?.id === "pickup") this.nav.setWaypoint(null);
    this.render();
  }

  // ---------------------------------------------------------------- the car model
  // the detailed cab (separate wheels, doors, interior): loaded once, cloned per vehicle (geometry is shared)
  async ensureCar() {
    await this.loadTpl();
    if (!this.taxi || this.parked.includes(this.taxi)) this.taxi = this.makeTaxi();
    this.vehicle = this.taxi;
  }
  async loadTpl() {
    if (!this.tpl) {
      const g = await new Promise((res, rej) => this.loader.load(`${this.root}export/vehicles/taxi.glb`, res, undefined, rej));
      g.scene.traverse(o => {
        const n = o.name || "";
        if (o.isMesh && /^AD_VEH_taxi_tv/.test(n) && !/^MAT_SLOT_/.test(o.material.name)) {   // the in-cab TV is a screen too
          o.material = o.material.clone(); o.material.name = "MAT_SLOT_veh.taxi.tv";
          o.material.emissive?.set(0xffffff); o.material.emissiveIntensity = 1.2;
          if (!o.material.emissiveMap) o.material.emissiveMap = o.material.map;
        }
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) {
          if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = 0.35; m.depthWrite = false; }
          this.registerMaterial?.(m);
          if (/^MAT_SLOT_veh\.taxi\./.test(m.name)) {   // roof sign (both sides) + in-cab TV: fleet-wide ad slots
            const id = m.name.replace("MAT_SLOT_", ""), shape = id.includes("topper") ? "4x1" : "16x9";
            this.screens?.add(id, m); this.screens?.setPlaylist(id, this.demoArt?.(shape) || []);
          }
        }
      });
      this.refreshTime?.();
      this.tpl = g.scene;
    }
  }
  // cars you parked last visit (saved progress) are where you left them
  async restoreParked(list) {
    await (this.bikeSpawnPromise || this.bikes.ready);
    const bikes = list.filter(v => v.kind === "bike");
    const cars = list.filter(v => v.kind !== "bike").slice(-4);
    for (const { id, markerId, type, x, y, h } of bikes) {
      const bike = this.parked.find(v => v.kind === "bike" && v.marker?.id === (markerId || id));
      if (!bike) continue;
      bike.garageId = id || bike.marker.id;
      bike.group.position.set(x, 0.03, -y);
      bike.group.rotation.set(0, h + Math.PI / 2, 0);
      bike.heading = h;
      bike.marker.label = "Your motorcycle";
      this.settle(bike, h);
    }
    for (const { id, type, x, y, h } of cars) {
      let v;
      if (type === "Taxi") { await this.loadTpl(); v = this.makeTaxi(); }
      else { const t = this.traffic?.types.find(t => t.type === type); if (!t) continue; v = this.makeCar(t); }
      v.garageId = id || null;
      v.group.visible = true; v.group.position.set(x, 0.03, -y); v.group.rotation.set(0, h - Math.PI / 2, 0); v.heading = h; this.settle(v, h);
      this.parked.push(v);
      this.traffic?.extra.push({ temp: true, alive: () => this.parked.includes(v), pose: () => [v.group.position.x, -v.group.position.z, v.heading, 0] });
    }
    this.syncVehicleMarkers();
    this.garageReady = true;
  }
  syncVehicleMarkers() {
    const parked = this.parked.filter(v => v.kind !== "bike");
    for (const v of parked) {
      const garageId = this.assignGarageId(v);
      if (!v.marker) v.marker = { id: `vehicle_${garageId}`, icon: "car", label: "Your car", x: 0, y: 0 };
      v.marker.x = v.group.position.x;
      v.marker.y = -v.group.position.z;
      v.marker.hidden = false;
    }
    this.onVehicles?.(parked.map(v => v.marker));
  }
  rideParked(id) {
    const v = this.parked.find(car => car.marker?.id === id);
    if (v) this.approach({ parked: v });
  }
  makeTaxi() {
    const group = new THREE.Group(); group.name = "RIDE_car";
    const model = this.tpl.clone(true); group.add(model);
    const parts = { wheels: [], doors: {}, steer: null, seat: {}, cam: {} };
    model.traverse(o => {
      const n = o.name || "";
      if (n.startsWith("WHEEL_")) parts.wheels.push({ o, front: n.startsWith("WHEEL_F"), base: o.quaternion.clone() });
      if (n.startsWith("DOOR_")) parts.doors[n] = { o, base: o.rotation.y, sign: n.includes("_R_") ? 1 : -1, t: 0 };
      if (n === "STEER") parts.steer = { o, base: o.quaternion.clone() };
      if (n.startsWith("SEAT_")) parts.seat[n] = o.position.clone();
      if (n.startsWith("CAM_")) parts.cam[n] = o.position.clone();
      if (o.isMesh) o.userData.ride = true;
    });
    group.add(makeBlob(2.3, 5.2));                        // contact shadow
    group.visible = false;
    this.scene.add(group);
    return { group, parts, kind: "taxi", type: "Taxi" };
  }
  // the bike's fork, lean and kickstand follow what you do: it stands up as you mount, the bars turn, it leans into turns
  updateBike(v, dt) {
    const riding = this.inCar && this.vehicle === v;
    v.standT = THREE.MathUtils.clamp((v.standT ?? 0) + (riding ? dt / 0.8 : -dt / 0.8), 0, 1);
    const grip = this.bikeAir > 0 ? 0.3 : 1;
    const want = this.steer * THREE.MathUtils.clamp(Math.abs(this.v) / 7, 0, 1) * grip;
    v.leanNow = (v.leanNow || 0) + (want - (v.leanNow || 0)) * Math.min(1, dt * 5);
    this.bikes.pose(v, v.standT, riding ? this.steer * 1.15 * grip : 0, v.leanNow);
  }
  jumpBike() {
    if (this.state !== "driving" || this.vehicle?.kind !== "bike" || this.v < 7 || this.bikeAir > 0) return;
    this.bikeVy = 3.8 + Math.min(1.1, this.v * 0.045);
    this.bikeAir = 0.001;
  }
  stepBikeAir(dt) {
    const v = this.vehicle;
    if (this.state !== "driving" || !v) return;
    const blob = v.group.children.find(c => c.userData.isBlob);
    // landing: the suspension squashes and the nose settles (a short dip that eases out)
    if (this.landDip > 0) {
      this.landDip = Math.max(0, this.landDip - dt * 4.5);
      v.group.position.y -= Math.sin(this.landDip / 0.3 * Math.PI) * 0.1 * Math.min(1, this.landHard);
      v.group.rotation.x += this.landDip * 0.5 * (this.airPitch > 0 ? -1 : 1) * 0.3;
    }
    if (this.bikeAir <= 0) { if (blob) { blob.position.y = 0; blob.scale.setScalar(1); } this.airPitch = 0; return; }
    this.bikeVy -= 9.81 * dt;
    this.bikeAir = Math.max(0, this.bikeAir + this.bikeVy * dt);
    if (!this.bikeAir) {                                                                       // touchdown
      this.landHard = Math.min(1.5, Math.abs(this.bikeVy) / 6); this.landDip = 0.3; this.bikeVy = 0;
      if (this.landHard > 0.5) { this.onBump?.(Math.min(0.5, this.landHard * 0.3)); this.audio?.crash?.(new THREE.Vector3(this.car.position.x, 0.3, this.car.position.z), 0.25 * this.landHard, "concrete"); }
      this.settle(v, this.heading);
      return;
    }
    // in the air the nose follows the flight path: up on the way up, level at the top, down on the way down, the way a real jump looks
    const target = THREE.MathUtils.clamp(Math.atan2(this.bikeVy, Math.max(7, this.v)) * 1.1, -0.65, 0.65);
    this.airPitch = (this.airPitch ?? 0) + (target - (this.airPitch ?? 0)) * Math.min(1, dt * 7);
    v.group.position.y = (v.gy ?? v.group.position.y - 0.03) + 0.03 + this.bikeAir;
    v.group.rotation.x = -this.airPitch;
    if (blob) { blob.position.y = -this.bikeAir + 0.02; blob.scale.setScalar(Math.max(0.45, 1 - this.bikeAir * 0.2)); }       // the contact shadow stays on the ground below
  }
  async makeBike() { await this.bikes.ready; return this.bikes.make(); }
  // a few cruisers stand at the curb to start with (they're always there: bikes aren't part of your saved progress)
  async spawnBikes() {
    if (this.bikesSpawned) return;
    this.bikesSpawned = true;
    await this.bikes.ready;
    this.bikeMarkers = [];
    for (const [x, y, h] of BIKE_SPOTS) {
      const v = this.bikes.make();
      // bike faces +Z so parked rotation uses h + PI/2 (not h - PI/2 like cars)
      v.group.position.set(x, 0.03, -y); v.group.rotation.set(0, h + Math.PI / 2, 0); v.heading = h; v.pinned = true; v.standT = 0; this.settle(v, h);
      this.scene.add(v.group);
      // a pin on the map and the minimap that follows the bike (hidden while you ride it); shown from neighbourhood zoom
      v.marker = { id: "bike_" + this.bikeMarkers.length, icon: "bike", label: "Motorcycle", x, y, minS: 0.45 };
      this.bikeMarkers.push(v.marker);
      this.parked.push(v);
      this.traffic?.extra.push({ temp: true, alive: () => this.parked.includes(v), pose: () => [v.group.position.x, -v.group.position.z, v.heading, 0] });
    }
    this.onBikes?.(this.bikeMarkers);
  }
  // flat, open ground near (x, y) with a clear run ahead: [x, y, heading] or null (no steps, kerbs, walls or people's furniture within 14 m ahead)
  openSpot(x, y) {
    const G = this.ground, col = this.getCollider(); if (!G?.built || !col) return null;
    let best = null;
    for (let r = 3; r <= 60 && !best; r += 3) for (let a = 0; a < 360 && !best; a += 20) {
      const px = x + Math.cos(a * Math.PI / 180) * r, py = y + Math.sin(a * Math.PI / 180) * r, h0 = G.h(px, py);
      if (h0 > 0.35 || col.blocked(px, py, 0.8, 0.3)) continue;
      for (let k = 0; k < 8; k++) {                                                    // a clear straight run in some direction
        const h = k * Math.PI / 4; let ok = true;
        for (let d = 3; d <= 40 && ok; d += 3) {                                          // 40 m of clear run: ground, walls, and the street furniture the mesh test knows (planters, bollards)
          const qx = px + Math.cos(h) * d, qy = py + Math.sin(h) * d, bx = px + Math.cos(h) * (d - 3), by = py + Math.sin(h) * (d - 3);
          if (Math.abs(G.h(qx, qy) - h0) > 0.2 || col.blocked(qx, qy, 0.9, 0.3) || this.vehicleObstacle?.({ x: bx, y: by, nx: qx, ny: qy, halfLength: 1.15, halfWidth: 0.7, height: 0.8 })) ok = false;
        }
        if (ok) { best = { x: px, y: py, h }; break; }
      }
    }
    return best;
  }

  // a fresh bike standing at (x, y): used when you fast-travel to a mission far from any bike
  async bikeAt(x, y, h = 0) {
    await this.bikes.ready;
    const v = this.bikes.make();
    v.group.position.set(x, 0.03, -y); v.group.rotation.set(0, h + Math.PI / 2, 0); v.heading = h; v.standT = 0; v.temp = true; this.settle(v, h);
    this.scene.add(v.group); this.parked.push(v);
    return v;
  }

  // the bikes: drawn only near you; their map pins follow them
  tendBikes() {
    if (this.ground?.built) for (const v of this.parked) if (!v.settled) { this.settle(v, v.heading ?? 0); v.settled = true; }   // placed before the ground map was ready
    for (const v of this.parked) if (v.kind !== "bike" && v.marker) {
      v.marker.x = v.group.position.x;
      v.marker.y = -v.group.position.z;
    }
    if (!this.bikeMarkers) return;
    const c = this.camera.position;
    for (const v of this.parked) {
      if (v.kind !== "bike") continue;
      const p = v.group.position;
      const show = Math.hypot(p.x - c.x, p.z - c.z) < BIKE_SHOW_M;
      if (show && !v.group.visible && v !== this.vehicle) { v.group.visible = true; this.bikes.autoPaint(v); }   // newly in view: pick a colour nobody nearby wears
      v.group.visible = show;
      if (v.marker) { v.marker.x = p.x; v.marker.y = -p.z; v.marker.hidden = false; }
    }
    this.bikes.dedupe(c);
    if (this.vehicle?.kind === "bike" && this.vehicle.marker) this.vehicle.marker.hidden = true;     // you're on it
  }
  // walk to a bike (by its map pin) and get on
  rideBike(id) {
    const v = this.parked.find(b => b.marker?.id === id);
    if (v) { this.assignGarageId(v); this.approach({ parked: v }); }
  }
  // the nearest free bike to where you are: the welcome screen's "Ride a motorcycle"
  async rideNearestBike(instant = false) {
    await this.bikes.ready;                                                           // the bike model may still be loading: wait for it instead of failing
    const c = this.camera.position;
    let best = null, bd = Infinity;
    for (const v of this.parked) {
      if (v.kind !== "bike") continue;
      const d = Math.hypot(v.group.position.x - c.x, v.group.position.z - c.z);
      if (d < bd) { bd = d; best = v; }
    }
    if (!instant && best && bd < 45) this.approach({ parked: best });
    else if (this.bikes.tpl) {                                                      // none within a short walk: one is waiting nearby on open flat ground (the first minute must not be a hike, or a staircase)
      const spot = this.openSpot(c.x, -c.z);
      if (spot) this.bikeAt(spot.x, spot.y, spot.h).then(v => instant ? this.enter({ parked: v }) : this.approach({ parked: v }));     // Play: you are on the bike, no walking
      else this.toast?.("No room to put a bike here: walk to the street");
    } else this.toast?.("The motorcycles are still being brought out: try again in a moment");
  }
  // sedans / SUVs from the traffic: the same light model as the traffic itself (outside view only)
  makeCar(t) {
    const group = new THREE.Group(); group.name = "RIDE_" + t.type;
    for (const m of t.meshes) { const mesh = new THREE.Mesh(m.geometry, m.material); mesh.userData.ride = true; group.add(mesh); }
    group.add(makeBlob(2.3, 5.2));
    this.scene.add(group);
    return { group, parts: { wheels: [], doors: {}, steer: null, seat: { SEAT_driver: new THREE.Vector3(-0.42, 0.69, -0.05) }, cam: {} },
      kind: "car", type: t.type };
  }

  // ---------------------------------------------------------------- hop into any car (GTA-style, minus the crime:
  // every car in this city is part of a shared self-driving fleet, so it's yours to borrow)
  nearbyCar(x, y, r) {
    let best = null, bd = r;
    for (const v of this.parked) { const d = Math.hypot(v.group.position.x - x, -v.group.position.z - y); if (d < bd) { bd = d; best = { parked: v }; } }
    for (const c of this.traffic?.ready ? this.traffic.cars : []) {
      const canTakeBike = c.motorcycle && c.riderEjected && c.mode === "abandoned";
      const d = Math.hypot(c.x - x, c.y - y);
      if (c.alive && (!c.motorcycle || canTakeBike) && d < bd) { bd = d; best = { car: c }; }
    }
    return best;
  }
  async hopIn(target) {
    if (!target || this.inCar) return;
    if (this.active) this.end();
    let v, x, y, h, speed = 0;
    if (target.parked) {
      v = target.parked; this.parked = this.parked.filter(p => p !== v);
      if (v.marker) v.marker.hidden = true;
      x = v.group.position.x; y = -v.group.position.z; h = v.heading ?? 0;
    } else {
      if (target.car.motorcycle) {
        const acquired = this.traffic.takeMotorcycle(target.car);
        if (!acquired) return;
        ({ x, y, h, speed } = acquired); v = acquired.bike;
      } else {
        const c = this.traffic.take(target.car);
        ({ x, y, h } = c); speed = c.v;
        if (c.type.type === "Taxi") { await this.ensureCar(); v = this.makeTaxi(); } else v = this.makeCar(c.type);
      }
    }
    this.assignGarageId(v);
    this.borrowed = true;
    this.vehicle = v;
    this.damage = v.damage || 0; this.wrecked = this.damage >= 1;
    v.group.visible = true;
    v.group.position.set(x, 0.03, -y); this.setHeading(h);
    this.v = speed; this.steer = 0; this.dest = null; this.path = null;
    this.view = v.kind === "taxi" ? this.view : "chase";
    if (v.kind === "bike") { v.leanNow = v.lean || 0; this.bikes.mount(v, this.getPlayer?.()); }
    this.state = "driving";
    this.setMode("ride");
    this.audio?.setCabin?.(1);
    this.camBlend = 0;
    this.render();
  }
  // the hop-in prompt while you're on foot (or low over the street)
  checkHopIn() {
    const chip = this.hopChip, cam = this.camera.position;
    if (this.approaching) {                                       // on the way to a car: offer to skip the walk
      const bike = this.approaching.t.parked?.kind === "bike" || this.approaching.t.car?.motorcycle;
      const text = bike ? "Walking to the motorcycle · Get on now" : "Walking to the car · Get in now";
      if (chip.dataset.mode !== "skip" || chip.dataset.label !== text) { chip.dataset.mode = "skip"; chip.dataset.label = text; chip.firstElementChild.nextSibling.textContent = text; }
      chip.style.display = "inline-flex";
      return;
    }
    if (chip.dataset.mode === "skip") { chip.dataset.mode = ""; chip.dataset.label = "Hop in"; chip.firstElementChild.nextSibling.textContent = "Hop in"; }
    const onFoot = !this.inCar && this.getMode() === "walk";      // only when you're actually on foot
    this.hopTarget = onFoot ? this.nearbyCar(cam.x, -cam.z, 7) : null;
    if (onFoot && this.bikeMarkers && !this.hopTarget) {            // first time near a motorcycle: say what it is
      const near = this.parked.some(v => v.kind === "bike" && Math.hypot(v.group.position.x - cam.x, v.group.position.z - cam.z) < 45);
      if (near) this.nav.tip?.("bike", "A motorcycle: walk up and hop on", 9000);
    }
    const label = this.hopTarget?.parked?.kind === "bike" || this.hopTarget?.car?.motorcycle ? "Hop on" : "Hop in";
    if (chip.dataset.mode !== "skip" && chip.dataset.label !== label) { chip.dataset.label = label; chip.firstElementChild.nextSibling.textContent = label; }
    chip.style.display = this.hopTarget && this.state !== "waiting" ? "inline-flex" : "none";
  }

  // ---------------------------------------------------------------- walk to the car before getting in
  // From wherever you are (the top of the red steps, across the plaza) you first walk down to street level and to
  // the car's curb-side door; a traffic car you chose pulls up and waits. Then you get in.
  approachSpot(t) {
    let x, y, h;
    if (t.car) ({ x, y, h } = t.car);
    else if (t.parked) { x = t.parked.group.position.x; y = -t.parked.group.position.z; h = t.parked.heading ?? 0; }
    else { x = this.car.position.x; y = -this.car.position.z; h = this.heading; }
    const side = t.parked?.kind === "bike" ? 1.3 : 2.3;
    return { x: x + Math.sin(h) * side, y: y - Math.cos(h) * side };   // 2.3 m out from the right-hand (curb) side (a bike: 1.3 m)
  }
  approach(t) {
    if (!t || this.inCar) return;
    const cam = this.camera.position, spot = this.approachSpot(t);
    const d = Math.hypot(spot.x - cam.x, spot.y + cam.z), atStreet = cam.y < 3.2;    // eye ~1.7 m above the road
    if (d < 3.5 && atStreet) return this.enter(t);
    if (t.car) t.car.hailed = true;                                 // it pulls up and waits for you
    if (this.getMode() !== "walk") this.setMode("walk");
    this.approaching = { t, best: Infinity, stuck: 0, retarget: 0, time: 0 };
    this.panel.style.display = "none";                              // the "Walking to the car" button says it all
  }
  enter(t) {
    if (this.approaching?.t.car) this.approaching.t.car.hailed = false;
    this.approaching = null;
    if (t.booked) return this.getIn();
    return this.hopIn(t);
  }
  cancelApproach() {
    if (this.approaching?.t.car) this.approaching.t.car.hailed = false;
    this.approaching = null;
    this.render();                                                  // e.g. the booked cab's panel comes back
  }
  // a walking route around buildings (2 m grid around you and the car, A*, then straightened into a few legs)
  walkRoute(sx, sy, tx, ty) {
    const col = this.getCollider();
    if (!col) return [[tx, ty]];
    const free = (x, y) => !col.blocked(x, y, 0.6, 0.4) && !col.raisedAt?.(x, y);   // street level only: around the steps, not over
    const clear = (ax, ay, bx, by) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay)); for (let k = 1; k <= n; k++) if (!free(ax + (bx - ax) * k / n, ay + (by - ay) * k / n)) return false; return true; };
    if (clear(sx, sy, tx, ty)) return [[tx, ty]];
    const G = 2, pad = 40, x0 = Math.min(sx, tx) - pad, y0 = Math.min(sy, ty) - pad;
    const W = Math.ceil((Math.max(sx, tx) + pad - x0) / G), H = Math.ceil((Math.max(sy, ty) + pad - y0) / G);
    if (W * H > 40000) return [[tx, ty]];                          // too far for a walk: go straight (the stuck fallback covers it)
    const idx = (i, j) => j * W + i, cx = i => x0 + i * G, cy = j => y0 + j * G;
    const ok = new Int8Array(W * H).fill(-1), isOk = (i, j) => { const k = idx(i, j); if (ok[k] < 0) ok[k] = free(cx(i), cy(j)) ? 1 : 0; return ok[k] === 1; };
    const si = Math.round((sx - x0) / G), sj = Math.round((sy - y0) / G), ti = Math.round((tx - x0) / G), tj = Math.round((ty - y0) / G);
    const g = new Float32Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1), open = [[0, si, sj]];
    g[idx(si, sj)] = 0;
    const hdist = (i, j) => Math.hypot(i - ti, j - tj);
    let found = false, guard = 0;
    while (open.length && guard++ < 40000) {
      let b = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[b][0]) b = k;
      const [, i, j] = open.splice(b, 1)[0];
      if (i === ti && j === tj) { found = true; break; }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H || !(isOk(ni, nj) || (ni === ti && nj === tj))) continue;
        const ng = g[idx(i, j)] + Math.hypot(di, dj);
        if (ng < g[idx(ni, nj)]) { g[idx(ni, nj)] = ng; prev[idx(ni, nj)] = idx(i, j); open.push([ng + hdist(ni, nj), ni, nj]); }
      }
    }
    if (!found) return [[tx, ty]];
    const cells = []; for (let k = idx(ti, tj); k >= 0; k = prev[k]) cells.unshift([cx(k % W), cy(Math.floor(k / W))]);
    const pts = [[sx, sy], ...cells.slice(1, -1), [tx, ty]], legs = [];
    for (let a = 0; a < pts.length - 1;) {                         // straighten: walk to the farthest point in plain sight
      let b = pts.length - 1;
      while (b > a + 1 && !clear(pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--;
      legs.push(pts[b]); a = b;
    }
    return legs;
  }
  // from a raised spot (the red steps), the way down to street level without a drop: try 16 directions, walk each in
  // half-metre steps; a direction is good if every step down is stair-sized. Prefer the one that ends nearest the car.
  wayDown(x, y, eyeY, spot) {
    if (!this.groundAt) return null;
    const P = new THREE.Vector3();
    let best = null, bestCost = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8, dx = Math.cos(a), dy = Math.sin(a);
      let prev = eyeY - 1.7;
      for (let s = 0.5; s <= 30; s += 0.5) {
        P.set(x + dx * s, eyeY + 0.5, -(y + dy * s));
        const h = this.groundAt(P);
        if (prev - h > 0.6 || h - prev > 0.6) break;                 // a drop or a wall: not this way
        prev = h;
        if (h < 0.5) {                                                // reached the street
          const ex = x + dx * (s + 1), ey = y + dy * (s + 1), cost = s + Math.hypot(spot.x - ex, spot.y - ey) * 0.6;
          if (cost < bestCost) { bestCost = cost; best = [ex, ey]; }
          break;
        }
      }
    }
    return best;
  }
  stepApproach(dt) {
    const A = this.approaching;
    if (!A) return;
    if (this.getMode() !== "walk" || (A.t.car && !A.t.car.alive && !A.t.car.hailed)) return this.cancelApproach();   // you chose something else
    const cam = this.camera.position, spot = this.approachSpot(A.t), px = cam.x, py = -cam.z;
    const d = Math.hypot(spot.x - px, spot.y - py);
    A.time += dt; A.retarget -= dt;
    // (re)plan when starting, or when the car has moved since (it may still be pulling up)
    if (!A.legs || Math.hypot(spot.x - A.goal[0], spot.y - A.goal[1]) > 4) {
      const down = cam.y - 1.7 > 1.0 ? this.wayDown(px, py, cam.y, spot) : null;     // up on steps / a platform: walk down first
      A.legs = down ? [down, ...this.walkRoute(down[0], down[1], spot.x, spot.y)] : this.walkRoute(px, py, spot.x, spot.y);
      A.goal = [spot.x, spot.y]; A.retarget = 0;
    }
    while (A.legs.length > 1 && Math.hypot(A.legs[0][0] - px, A.legs[0][1] - py) < 1.6) { A.legs.shift(); A.retarget = 0; A.best = Infinity; }
    if (A.retarget <= 0) { const [wx, wy] = A.legs[0]; this.walk.walkTo(new THREE.Vector3(wx, 0, -wy)); A.retarget = 0.4; }
    if (d < 2.6 && cam.y < 3.2) return this.enter(A.t);
    const dl = Math.hypot(A.legs[0][0] - px, A.legs[0][1] - py);   // progress on the current leg (the way down may lead away first)
    if (dl < A.best - 0.3) { A.best = dl; A.stuck = 0; } else A.stuck += dt;
    if (A.stuck > 3 || A.time > 30) this.enter(A.t);              // railings, a statue in the way: don't leave you hanging
  }
  // tap / click a car (within ~35 m) to hop in
  tapCar(ray) {
    if (this.inCar || !this.traffic?.ready) return false;
    const meshes = [];
    for (const t of this.traffic.types) for (const m of t.meshes) if (m.count) { m.computeBoundingSphere(); m.computeBoundingBox(); meshes.push(m); }   // cars move: refresh bounds
    for (const v of this.parked) v.group.traverse(o => o.isMesh && meshes.push(o));
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit || hit.distance > 35) return false;
    const pv = this.parked.find(v => { let f = false; v.group.traverse(o => { if (o === hit.object) f = true; }); return f; });
    if (pv) { this.approach({ parked: pv }); return true; }
    const c = this.traffic.carAt(hit.object, hit.instanceId);
    if (c) { this.approach({ car: c }); return true; }
    return false;
  }

  // turn the view to the cab when it pulls up (from the curb side, so the open door faces you)
  showCar(asked = false) {
    if (!asked || this.getMode() === "ride" || !this.nav.flyTo) return;
    const c = this.car.position, side = new THREE.Vector3(7, 0, 5).applyQuaternion(this.car.quaternion);
    const e = c.clone().add(side);
    this.nav.flyTo({ eye: [e.x, -e.z, 3.2], target: [c.x, -c.z, 0.8], name: "Your cab is here", kind: "ad" }, { duration: 1.4 });
  }

  door(open) { for (const d of Object.values(this.parts.doors)) if (d.o.name.includes("rear") && d.sign > 0) d.target = open; }

  placeCarOnPath(s) {
    const P = this.path, i = Math.min(P.pts.length - 1, Math.max(0, s / P.step)), i0 = Math.floor(i), i1 = Math.min(P.pts.length - 1, i0 + 1), t = i - i0;
    const x = P.pts[i0][0] + (P.pts[i1][0] - P.pts[i0][0]) * t, y = P.pts[i0][1] + (P.pts[i1][1] - P.pts[i0][1]) * t;
    let h0 = P.head[i0], h1 = P.head[i1]; if (h1 - h0 > Math.PI) h1 -= 2 * Math.PI; if (h0 - h1 > Math.PI) h1 += 2 * Math.PI;
    const h = h0 + (h1 - h0) * t;
    this.car.position.set(x, 0.03, -y);
    this.setHeading(h);
    const ahead = P.head[Math.min(P.head.length - 1, i0 + 5)];
    let dh = ahead - h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    this.steer += (THREE.MathUtils.clamp(dh * 1.6, -0.55, 0.55) - this.steer) * 0.2;
    return P.v[i0] + (P.v[i1] - P.v[i0]) * t;
  }
  // heading h: Blender-plane angle of travel; car front is -Z in three (uses h-PI/2); bike front is +Z (uses h+PI/2)
  setHeading(h) {
    this.heading = h;
    const bikeMode = this.vehicle?.kind === "bike";
    this.car.rotation.set(0, bikeMode ? h + Math.PI / 2 : h - Math.PI / 2, 0);
    if (this.vehicle) this.settle(this.vehicle, h, this._dt ?? null);
  }
  // Wheels on the ground: the vehicle's height from the ground under its wheels (a pavement is 16 cm above the road: at a
  // fixed 3 cm the wheels of anything parked or ridden on it were buried), and its pitch / roll from where the axles are
  // (nose up over a kerb, rolling over a crown). dt: ease it (driving); null: snap (placing it).
  settle(v, h, dt = null) {
    const G = this.ground;
    if (!G?.built || !v) return;
    const g = v.group, x = g.position.x, y = -g.position.z, c = Math.cos(h), s = Math.sin(h);
    const bike = v.kind === "bike", hl = bike ? BIKE_WHEELBASE / 2 : 1.35, hw = bike ? 0 : 0.8;
    const H = (a, b) => G.h(x + c * a - s * b, y + s * a + c * b);       // a along the heading, b to the left
    let gy, pitch, roll = 0;
    if (hw) {
      const fl = H(hl, hw), fr = H(hl, -hw), rl = H(-hl, hw), rr = H(-hl, -hw);
      gy = (fl + fr + rl + rr) / 4; pitch = Math.atan2((fl + fr - rl - rr) / 2, 2 * hl); roll = Math.atan2((fl + rl - fr - rr) / 2, 2 * hw);
    } else { const f = H(hl, 0), r = H(-hl, 0); gy = (f + r) / 2; pitch = Math.atan2(f - r, 2 * hl); }
    const k = dt == null || v.gy == null ? 1 : Math.min(1, dt * 14);
    v.gy = (v.gy ?? gy) + (gy - (v.gy ?? gy)) * k; v.gp = (v.gp ?? pitch) + (pitch - (v.gp ?? pitch)) * k; v.gr = (v.gr ?? roll) + (roll - (v.gr ?? roll)) * k;
    g.position.y = v.gy + 0.03;
    g.rotation.order = "YXZ"; g.rotation.set(-v.gp, (v.kind === "bike" ? h + Math.PI / 2 : h - Math.PI / 2), v.gr);
  }

  // parked / traffic cars standing on the route drive off (hidden) so the cab never passes through them
  clearTraffic(path) {
    if (this.traffic?.ready) return;                // live traffic drives around; nothing frozen to clear
    const grid = new Set(), k = (x, y) => Math.floor(x / 4) + "," + Math.floor(y / 4);
    for (const [x, y] of path.pts) grid.add(k(x, y));
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.scene.traverse(o => {
      if (!o.isInstancedMesh || !/^INST_PROP_(Taxi|Car)/.test(o.name)) return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); p.setFromMatrixPosition(m);
        const x = p.x, y = -p.z;
        let near = false;
        for (let dx = -1; dx <= 1 && !near; dx++) for (let dy = -1; dy <= 1 && !near; dy++) near = grid.has(Math.floor(x / 4) + dx + "," + (Math.floor(y / 4) + dy));
        if (!near) continue;
        if (!path.pts.some(q => Math.hypot(q[0] - x, q[1] - y) < 3.4)) continue;
        this.hidden.push([o, i, m.clone()]); o.setMatrixAt(i, zero); o.instanceMatrix.needsUpdate = true;
      }
    });
  }
  restoreTraffic() {
    for (const [o, i, m] of this.hidden) { o.setMatrixAt(i, m); o.instanceMatrix.needsUpdate = true; }
    this.hidden = [];
  }
  trafficCars() {                       // positions of parked cars, for bumping into them when you drive
    if (this.traffic?.ready) return [];
    if (this._cars) return this._cars;
    const out = [], m = new THREE.Matrix4(), p = new THREE.Vector3();
    this.scene.traverse(o => {
      if (!o.isInstancedMesh || !/^INST_PROP_(Taxi|Car)/.test(o.name) || !/^M_Car_Paint/.test(o.material.name)) return;   // the body: one per car
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); p.setFromMatrixPosition(m); out.push([o, i, p.x, -p.z]); }
    });
    return (this._cars = out);
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const keys = { KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right" };
    addEventListener("keydown", e => { if (this.state === "driving" && keys[e.code] && e.target.tagName !== "INPUT") { this.ctl[keys[e.code]] = 1; e.preventDefault(); } });
    addEventListener("keydown", e => {                                // H: honk (people ahead hurry out of the way)
      if (e.code === "KeyH" && this.inCar && !e.repeat && e.target.tagName !== "INPUT") this.honk();
    });
    addEventListener("keyup", e => { if (keys[e.code]) this.ctl[keys[e.code]] = 0; });
    this.dom.addEventListener("pointerdown", e => { if (this.inCar) this.look.drag = [e.clientX, e.clientY]; });
    addEventListener("pointermove", e => {
      if (!this.look.drag) return;
      const { k, inv } = Settings.lookScale();
      this.look.yaw -= (e.clientX - this.look.drag[0]) * 0.005 * k;
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch + (e.clientY - this.look.drag[1]) * 0.004 * k * inv, -0.9, 0.6);
      this.look.drag = [e.clientX, e.clientY]; this.look.idle = 0;
    });
    addEventListener("pointerup", () => { this.look.drag = null; });
  }

  honk() {
    if (!this.car) return;
    this.audio?.hornAt?.(this.car.position.clone().setY(1));
    this.honkT = 1.5;                                                  // crowd treats the cab as a fast mover briefly
  }
  // what pedestrians and traffic should treat as a mover: your cab
  pose() { return [this.car.position.x, -this.car.position.z, this.heading, this.honkT > 0 ? Math.max(6, this.v) : this.v]; }

  startTow(v) {
    if (this.towing.some(t => t.v === v)) return;
    const materials = new Set();
    v.group.traverse(o => {
      if (!o.isMesh) return;
      const clone = m => {
        const c = m.clone();
        c.userData.towOpacity = c.opacity; c.userData.towTransparent = c.transparent; c.userData.towDepthWrite = c.depthWrite;
        materials.add(c);
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
    });
    this.towing.push({ v, materials: [...materials], t: 1.8 });
  }

  updateTowing(dt) {
    for (let i = this.towing.length - 1; i >= 0; i--) {
      const t = this.towing[i]; t.t -= dt;
      const alpha = THREE.MathUtils.clamp(t.t / 1.8, 0, 1);
      for (const m of t.materials) {
        m.opacity = m.userData.towOpacity * alpha;
        m.transparent = alpha < 1 || m.userData.towTransparent;
        m.depthWrite = alpha < 1 ? false : m.userData.towDepthWrite;
        m.needsUpdate = true;
      }
      if (t.t <= 0) {
        t.v.group.visible = false;
        this.parked = this.parked.filter(v => v !== t.v);
        if (this.taxi === t.v) this.taxi = null;
        this.towing.splice(i, 1);
      }
    }
  }

  updateParked(dt) {
    for (const v of this.parked) {
      const m = v.motion;
      if (!m || Math.hypot(m.vx, m.vy) < 0.05 && Math.abs(m.omega) < 0.02) continue;
      const x = v.group.position.x + m.vx * dt, y = -v.group.position.z + m.vy * dt;
      if (this.getCollider()?.blocked(x, y, v.kind === "bike" ? 0.45 : 1, 0.5)) {
        m.vx = m.vy = m.omega = 0;
        continue;
      }
      v.group.position.x = x; v.group.position.z = -y; v.heading += m.omega * dt;
      const drag = Math.exp(-dt * 1.1);
      m.vx *= drag; m.vy *= drag; m.omega *= Math.exp(-dt * 2);
      this.settle(v, v.heading, dt);
    }
  }

  impactBody(x, y, h, K) {
    const bike = this.vehicle?.kind === "bike", mass = bike ? 330 : 1400;
    const halfLength = bike ? 1.15 : 2.3, halfWidth = bike ? 0.45 : 1;
    const fx = Math.cos(h), fy = Math.sin(h);
    return { x, y, h, vx: fx * this.v + this.slideX, vy: fy * this.v + this.slideY, omega: this.yawRate,
      mass, inertia: boxInertia(mass, halfLength, halfWidth), halfLength, halfWidth, K };
  }

  applyImpact(body, result) {
    if (!result) return;
    this.car.position.x = body.x; this.car.position.z = -body.y;
    const fx = Math.cos(body.h), fy = Math.sin(body.h);
    this.heading = body.h;
    this.v = body.vx * fx + body.vy * fy;
    this.slideX = body.vx - fx * this.v; this.slideY = body.vy - fy * this.v;
    this.yawRate = body.omega;
    this.setHeading(this.heading);
    if (result.closingSpeed < 0.5) return;
    if (!this.invincible) this.damage = THREE.MathUtils.clamp(this.damage + result.strength * (this.vehicle?.kind === "bike" ? 0.72 : 0.58), 0, 1);   // (a crash run is not about your own repair bill)
    this.vehicle.damage = this.damage;
    this.onBump?.(result.strength);
    this.fares?.bump(result.strength);
    this.audio?.crash?.(new THREE.Vector3(result.point[0], 0.6, -result.point[1]), result.strength);
    this.bump = Settings.reduceMotion ? 0 : 0.25 + 0.55 * result.strength;
    this.bumpS = result.strength;
    this.stall = 0.15 + 0.45 * result.strength;
    if (this.damage >= 1) { this.wrecked = true; this.v = 0; this.toast?.("Wrecked · get out to call a tow"); }
    if (this.vehicle?.kind === "bike" && result.closingSpeed > 6) this.ejectRider();
  }

  ejectRider() {
    const bike = this.vehicle, rider = bike?.rider;
    if (!rider || this.ejected) return;
    this.bikes.dismount(bike);
    rider.object.position.copy(bike.group.position);
    rider.object.position.y += 0.8;
    bike.group.position.y = (bike.gy ?? bike.group.position.y - 0.03) + 0.03;
    this.bikes.pose(bike, 0, 0, 0);
    bike.model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    bike.motion = { vx: Math.cos(this.heading) * this.v + this.slideX,
      vy: Math.sin(this.heading) * this.v + this.slideY, omega: this.yawRate };
    if (!this.parked.includes(bike)) this.parked.push(bike);
    this.traffic?.extra.push({ temp: true, alive: () => this.parked.includes(bike), pose: () => [bike.group.position.x, -bike.group.position.z, bike.heading, 0] });
    const p = bike.group.position.clone().add(new THREE.Vector3(0.4, 0, 0));
    this.setWalkerAt(p, new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading)));
    this.ejected = { avatar: rider, t: 1.65, air: 0.8, originY: bike.group.position.y, vy: 4.5,
      vx: Math.cos(this.heading) * Math.max(2, Math.abs(this.v) * 0.45), vz: -Math.sin(this.heading) * Math.max(2, Math.abs(this.v) * 0.45) };
    if (this.walk) this.walk.stunT = 1.5;
    this.vehicle = null; this.v = 0; this.state = "idle"; this.borrowed = false;
    if (this.damage >= 1) this.startTow(bike);
    this.setMode("walk"); this.render();
  }

  updateEjected(dt) {
    const e = this.ejected;
    if (!e) return;
    e.t -= dt; e.vy -= 9.81 * dt;
    e.air = Math.max(0, e.air + e.vy * dt);
    const p = e.avatar.object.position;
    p.x += e.vx * dt; p.z += e.vz * dt; p.y = e.originY + e.air;
    e.vx *= Math.exp(-dt * 1.8); e.vz *= Math.exp(-dt * 1.8);
    e.avatar.set(p.x, p.y, p.z, this.heading, 0, e.air);
    e.avatar.update(dt);
    if (e.air < 0.06) {
      e.air = 0;
      e.avatar.rot("Hips", ["x", 25], ["z", 52]);
      e.avatar.rot("Spine", ["x", 18], ["z", -24]);
      e.avatar.rot("LeftUpLeg", ["x", -28]); e.avatar.rot("LeftLeg", ["x", 55]);
      e.avatar.rot("RightUpLeg", ["x", 18]); e.avatar.rot("RightLeg", ["x", 62]);
      e.avatar.rot("LeftArm", ["x", -38]); e.avatar.rot("RightArm", ["x", -45]);
    }
    if (e.t <= 0) {
      const p = e.avatar.object.position, ground = this.groundAt(new THREE.Vector3(p.x, p.y + 2, p.z));
      this.camera.position.set(p.x, ground + 1.7, p.z);
      this.walk.yaw = Math.atan2(-Math.cos(this.heading), Math.sin(this.heading));
      this.walk.pitch = 0; this.camera.rotation.set(0, this.walk.yaw, 0, "YXZ");
      e.avatar.object.visible = false; this.ejected = null;
    }
  }

  updateSmoke(dt) {
    const v = this.vehicle;
    if (!v) return;
    if (this.damage <= 0.6) {
      if (v.smoke) v.smoke.visible = false;
      return;
    }
    if (!v.smoke) {
      const count = 14, geometry = new THREE.BufferGeometry(), positions = new Float32Array(count * 3);
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({ color: 0x62666a, size: 0.24, transparent: true, opacity: 0.28, depthWrite: false });
      v.smoke = new THREE.Points(geometry, material);
      v.smoke.frustumCulled = false; v.smoke.raycast = () => {};
      v.smokeAges = Float32Array.from({ length: count }, (_, i) => i / count);
      v.group.add(v.smoke);
    }
    v.smoke.visible = true;
    v.smoke.material.opacity = 0.14 + this.damage * 0.18;
    const a = v.smoke.geometry.attributes.position, bike = v.kind === "bike";
    for (let i = 0; i < v.smokeAges.length; i++) {
      const age = v.smokeAges[i] = (v.smokeAges[i] + dt * (0.45 + this.damage * 0.25)) % 1;
      a.setXYZ(i, Math.sin(age * 8 + i) * (0.08 + age * 0.24), 0.75 + age * 1.45, (bike ? 0 : -0.25) + Math.cos(age * 7 + i) * 0.12);
    }
    a.needsUpdate = true;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (this.honkT) this.honkT = Math.max(0, this.honkT - dt);
    this.stepApproach(dt);
    this.checkHopIn();
    this.tendBikes();
    this.updateParked(dt);
    this.updateTowing(dt);
    this.updateEjected(dt);
    if (!this.car || this.state === "idle") return;
    const P = this.path;
    if (this.state === "coming" || this.state === "riding" || this.state === "leaving") {
      if (P) {
        let limit = this.placeCarOnPath(this.s);
        const T = this.traffic?.ready && this.state !== "leaving" ? this.traffic : null;
        if (T) {                                                     // the robotaxi obeys the lights and keeps its distance
          const x = this.car.position.x, y = -this.car.position.z;
          limit = Math.min(limit, T.lightLimit(x, y, this.heading), T.followLimit(x, y, this.heading, this.me_));
        }
        this.v += THREE.MathUtils.clamp(limit - this.v, -DECEL * dt, A_LON * dt);
        this.v = Math.max(0, this.v);
        this.s = Math.min(P.len, this.s + this.v * dt);
        const left = P.len - this.s;
        if (left < 0.4 && this.v < 0.3) {
          if (this.state === "coming") {
            this.state = "waiting"; this.door(1); this.render();   // the camera only moves if you ask ("Show me")
            if (this.nav.waypoint?.place?.id === "pickup") this.nav.setWaypoint(null);   // the cab itself marks the spot now
          }
          else if (this.state === "riding") { this.state = "arrived"; this.render(); }
        }
        const eta = document.getElementById("ride-eta");
        if (eta) eta.textContent = fmtTime(left / 9 + 2);
        const lf = document.getElementById("ride-left");
        if (lf) lf.textContent = `· ${fmtDist(left)} · ${fmtTime(left / 9 + 1)} left`;
      }
      if (this.state === "leaving") {
        this.leaveT -= dt;
        if (this.leaveT < 0 || !P || P.len - this.s < 1) { this.state = "idle"; this.car.visible = false; this.restoreTraffic(); this.path = null; this.render(); }
      }
    } else if (this.state === "driving") { this.drive(dt); this.stepBikeAir(dt); }
    else if (this.state === "waiting" || this.state === "arrived") this.v = Math.max(0, this.v - DECEL * dt);
    // wheels, steering wheel, doors
    this._dt = dt;
    const bike = this.vehicle?.kind === "bike" ? this.vehicle : null;
    if (bike) this.updateBike(bike, dt);
    this.updateSmoke(dt);
    const spin = this.v * dt / (bike ? BIKE.wheelR : 0.36);
    for (const w of this.parts.wheels) {
      w.spin = (w.spin || 0) - spin;
      w.o.quaternion.copy(w.base)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.front ? this.steer : 0))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), w.spin));
    }
    if (this.parts.steer) this.parts.steer.o.quaternion.copy(this.parts.steer.base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -this.steer * 4));
    for (const d of Object.values(this.parts.doors)) {
      d.t += THREE.MathUtils.clamp((d.target || 0) - d.t, -dt * 2, dt * 2);
      d.o.rotation.y = d.base + d.sign * 1.1 * d.t;
    }
    const sp = document.getElementById("ride-speed");
    if (sp) sp.textContent = Math.round(Math.abs(this.v) * MPH);
    this.audio?.setCar?.(this.car.visible ? Math.abs(this.v) : 0, this.car.position);
    if (this.inCar) this.cameraFollow(dt);
  }

  drive(dt) {
    const c = this.ctl, col = this.getCollider();
    const P = this.pad;                                               // controller: analog steer, pressure-sensitive pedals
    const K = this.vehicle?.kind === "bike" ? BIKE_H : CAR_H;
    this.heading += this.yawRate * dt;
    this.yawRate *= Math.exp(-dt * 2.2);
    this.slideX *= Math.exp(-dt * 1.4); this.slideY *= Math.exp(-dt * 1.4);
    const target = P && Math.abs(P.lx) > 0 ? -P.lx : (c.left ? 1 : 0) - (c.right ? 1 : 0);
    const pull = this.damage > 0.4 ? (this.damage - 0.4) * 0.16 : 0;
    this.steer += THREE.MathUtils.clamp(target * K.steerMax * (1 - Math.min(K === BIKE_H ? 0.75 : 0.6, Math.abs(this.v) / (K === BIKE_H ? 24 : 30))) + pull - this.steer, -dt * (K === BIKE_H ? 2.4 : 1.6), dt * (K === BIKE_H ? 2.4 : 1.6));
    const gas = Math.max(c.up ? 1 : 0, P?.r2 || 0), brake = Math.max(c.down ? 1 : 0, P?.l2 || 0);
    if (this.stall > 0) this.stall -= dt;                              // shaken after a crash: no throttle for a moment
    if (gas > 0.05 && !(this.stall > 0) && !this.wrecked) this.v += (this.v < 0 ? 9 : K.accel) * gas * dt;
    else if (brake > 0.05) this.v -= (this.v > 0.3 ? K.brake : (K === BIKE_H ? 4.5 : 3.5)) * brake * dt;
    else this.v -= Math.sign(this.v) * Math.min(Math.abs(this.v), 1.2 * dt);
    if (this.wrecked) this.v = 0;
    if (this.boostT > 0) { this.boostT -= dt; if (gas > 0.05) this.v += 9 * dt; }                       // a boost pad: extra push and a higher ceiling
    this.v = THREE.MathUtils.clamp(this.v, K === BIKE_H ? -5 : -7, K.vmax * (1 - this.damage * 0.65) * (this.boostT > 0 ? 1.4 : 1));
    const inAir = this.bikeAir > 0;
    const h = this.heading + this.v / K.wheelbase * Math.tan(this.steer) * dt * (inAir ? 0.3 : 1);
    const x = this.car.position.x, y = -this.car.position.z;
    const nx = x + (Math.cos(h) * this.v + this.slideX) * dt, ny = y + (Math.sin(h) * this.v + this.slideY) * dt;
    const front = [nx + Math.cos(h) * K.front * Math.sign(this.v || 1), ny + Math.sin(h) * K.front * Math.sign(this.v || 1)];
    const lift = this.bikeAir;
    const halfLength = K === BIKE_H ? 1.15 : 2.3, halfWidth = K === BIKE_H ? 0.45 : 1;
    let hitObstacle = null;
    if (col) {
      const c = Math.cos(h), s = Math.sin(h);
      const alongN = Math.ceil(halfLength / 0.65), acrossN = Math.max(1, Math.ceil(halfWidth / 0.45));
      for (let i = -alongN; i <= alongN && !hitObstacle; i++) {
        const along = halfLength * i / alongN;
        for (let j = -acrossN; j <= acrossN; j++) {
          const across = halfWidth * j / acrossN;
          hitObstacle = col.obstacleAt(nx + c * along - s * across, ny + s * along + c * across,
            0.2, 0.3 + lift, false, true);
          if (hitObstacle) break;
        }
      }
    }
    if (Math.hypot(nx - x, ny - y) > 1e-4) {
      const meshObstacle = this.vehicleObstacle?.({ x, y, nx, ny, halfLength, halfWidth, height: 0.65 + lift }) || null;
      if (meshObstacle && (!hitObstacle || meshObstacle.kind === "metal" || meshObstacle.kind === "glass"))
        hitObstacle = meshObstacle;
    }
    // Midtown has its own colliders. Past it (downtown, the harbour islands, Central Park's side) the harbour's data answers: only land and piers are
    // ground, towers are walls, and beyond the harbour's frame there is a wall (nothing is modelled there).
    if (!hitObstacle && this.bounds) {
      const [bx0, by0, bx1, by1] = this.bounds, H = this.harbor;
      const inMid = nx > bx0 + 12 && nx < bx1 - 12 && ny > by0 + 12 && ny < by1 - 12;
      if (!inMid) {
        let why = null;
        if (!H?.frame || !H.inFrame(nx, ny)) why = "That's the edge of the city: turn around";
        else if (!(nx > bx0 && nx < bx1 && ny > by0 && ny < by1)) {                       // outside Midtown proper: the harbour's world
          if (!H.isLand(nx, ny) && !H.isPier(nx, ny)) why = "Water ahead";
          else if (H.topAt(nx, ny) > 2.5) why = "";
        }
        if (why != null) {
          hitObstacle = { kind: "concrete", point: new THREE.Vector3(nx, 0.6, -ny) };
          if (why && !(this.edgeT > performance.now())) { this.edgeT = performance.now() + 8000; this.toast?.(why); }
        }
      }
    }
    let hit = !!hitObstacle;
    // people: the car stops for them (a GTA world without the crime): brake hard, no crash
    if (!hit && Math.abs(this.v) > 0.2 && this.people?.(front[0], front[1], K.people).length) {
      if (Settings.roughContact && Math.abs(this.v) > 2) this.hitPedestrians?.(front[0], front[1], Math.cos(h) * this.v, Math.sin(h) * this.v, Math.min(1, Math.abs(this.v) / 14));
      else {
        if (!Settings.roughContact && Math.abs(this.v) > 2 && !(this.hintT > performance.now())) { this.hintT = performance.now() + 30000; this.toast?.("Cars stop for people. Turn on Rough contact in Settings to hit them"); }
        this.v *= Math.max(0, 1 - dt * 8); return;
      }
    }
    let impact = null;
    if (!hit) {
      const own = this.impactBody(nx, ny, h, K);
      for (const v of this.parked) {
        if (v === this.vehicle || this.towing.some(t => t.v === v)) continue;
        const bike = v.kind === "bike", hl = bike ? 1.15 : 2.3, hw = bike ? 0.45 : 1;
        const motion = v.motion ||= { vx: 0, vy: 0, omega: 0 };
        const mass = bike ? (v.rider ? 330 : 250) : 1400;
        const other = { x: v.group.position.x, y: -v.group.position.z, h: v.heading || 0, ...motion,
          mass, inertia: boxInertia(mass, hl, hw), halfLength: hl, halfWidth: hw };
        const contact = obbContact(own, other);
        if (!contact) continue;
        const result = resolveImpact(own, other, contact);
        Object.assign(v.motion, { vx: other.vx, vy: other.vy, omega: other.omega });
        v.heading = other.h; v.group.position.x = other.x; v.group.position.z = -other.y;
          this.applyImpact(own, result); impact = { own, result }; break;
      }
    }
    if (!hit && !impact && this.traffic?.ready) {
      for (const car of this.traffic.cars) {
        if (!car.alive) continue;
        const own = this.impactBody(nx, ny, h, K);
        const other = { x: car.x, y: car.y, h: car.h, halfLength: car.motorcycle ? 0.95 : 2.3,
          halfWidth: car.motorcycle ? 0.43 : 1 };
        const contact = obbContact(own, other);
        if (!contact) continue;
        if (car.pursuit) {
          hit = true;
          hitObstacle = { kind: "vehicle", point: new THREE.Vector3(car.x, 0.7, -car.y) };
          break;
        }
        const result = this.traffic.hitCar(car, { player: own, contact });
        if (result) { this.applyImpact(own, result); impact = { own, result }; break; }
      }
    } else if (!hit) for (const [, , cx, cy] of this.trafficCars()) if (Math.hypot(cx - front[0], cy - front[1]) < K.traffic - 0.2) {
      if (!this.hidden.some(([, , m]) => { const p = new THREE.Vector3().setFromMatrixPosition(m); return Math.hypot(p.x - cx, -p.z - cy) < 0.1; })) { hit = true; break; }
    }
    if (impact) return;
    if (hit) {
      // a crash you feel: a kick of the camera and a thump that scale with speed, the car bounces back and stalls a moment
      const s = Math.min(1, Math.abs(this.v) / 14);
      if (Math.abs(this.v) > 1) {
        this.onBump?.(s);
        this.fares?.bump(s);
        this.audio?.crash?.(hitObstacle?.point || new THREE.Vector3(front[0], 0.6, -front[1]), s, hitObstacle?.kind || "concrete");
        this.bump = Settings.reduceMotion ? 0 : 0.25 + 0.55 * s; this.bumpS = s;
        this.stall = 0.35 + 0.6 * s;
      }
      this.v *= -0.3;
    }
    else {
      this.car.position.set(nx, 0.03, -ny); this.setHeading(h);
      // ramps: climbing a slope and leaving its lip at speed throws the vehicle into the air (a bike's hop uses the same flight)
      if (this.ground?.built && !(this.bikeAir > 0)) {
        const gNow = this.ground.h(nx, ny), lg = this.lastG ?? gNow, stepD = Math.hypot(nx - x, ny - y);
        const cs = Math.cos(h), sn = Math.sin(h), sl = (this.ground.h(nx + cs * 1.5, ny + sn * 1.5) - this.ground.h(nx - cs * 1.5, ny - sn * 1.5)) / 3;   // the slope under you, smoothed over 3 m
        if (sl > 0.08) this.rampSlope = sl;
        if (lg > 0.5 && gNow < lg - 0.1 && this.v > 6 && (this.rampSlope || 0) > 0.1) {
          this.bikeVy = Math.min(10, this.v * this.rampSlope * 2.2); this.bikeAir = 0.001; this.rampSlope = 0;
          this.onLaunch?.(this.bikeVy);
        }
        this.lastG = gNow;
      }
    }
  }

  // ---- a passenger (taxi fares): on the back of a bike, in the back seat of a car; hips on the seat
  seatPassenger(av) {
    const v = this.vehicle; if (!v || !av) return;
    av.object.updateMatrixWorld(true);
    const hp = new THREE.Vector3(); av.bones.Hips.b.getWorldPosition(hp);
    const hipH = Math.max(0.7, hp.y - av.object.position.y);                       // standing hip height above the feet
    this.passenger = av; av.object.visible = true; av.object.removeFromParent();
    if (v.kind === "bike") {
      v.model.add(av.object); av.object.position.set(0, 0.0, -0.5); av.object.rotation.set(0, 0, 0);
      av.setRide(this.bikes.clips[av.id === "daniel" ? "man" : "woman"]); av.pillionArms(); av.pose(0);
    } else {
      const S = v.parts.seat.SEAT_rear_left || new THREE.Vector3(-0.45, 0.67, 0.85);
      v.group.add(av.object); av.object.position.set(S.x, S.y - hipH + 0.04, S.z); av.object.rotation.set(0, Math.PI, 0);   // the car faces -Z: look ahead
      av.sit(true); av.pose(0);
    }
  }
  // gets out beside the vehicle; returns the avatar (the caller walks them off / removes them)
  unseatPassenger() {
    const av = this.passenger; if (!av) return null;
    this.passenger = null;
    const wp = new THREE.Vector3(); av.object.getWorldPosition(wp);
    av.setRide(null); av.sit(false); av.object.removeFromParent(); av.object.rotation.set(0, 0, 0);
    const side = new THREE.Vector3(Math.cos(this.heading + Math.PI / 2) * 1.8, 0, -Math.sin(this.heading + Math.PI / 2) * 1.8);
    av.object.position.set(this.car.position.x + side.x, this.car.position.y, this.car.position.z + side.z);
    this.scene.add(av.object); av.object.visible = true; av.contact(true);
    return av;
  }

  cameraFollow(dt) {
    const cam = this.camera, car = this.car, L = this.look;
    L.idle += dt;
    if (this.pad && (this.pad.rx || this.pad.ry)) {                  // right stick looks around
      L.yaw -= this.pad.rx * dt * 2.2; L.pitch = THREE.MathUtils.clamp(L.pitch - this.pad.ry * dt * 1.5, -0.9, 0.6); L.idle = 0;
    }
    if (!L.drag && L.idle > 2.5 && Math.abs(this.v) > 2) L.yaw *= Math.exp(-dt * 1.5);    // drift back to looking ahead
    const shake = this.bump ? (this.bump -= dt, Math.max(0, this.bump) * (0.3 + 0.9 * (this.bumpS || 0))) : 0;
    if (this.view === "inside") {
      // robotaxi: you ride up front next to the empty driver's seat (the wheel turns by itself); driving: driver's seat
      const seat = this.state === "driving" ? this.parts.seat.SEAT_driver : this.parts.seat.SEAT_front_passenger;
      const p = seat.clone().add(new THREE.Vector3(0, 0.62, 0)).applyMatrix4(car.matrixWorld);
      cam.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * shake, 0, 0));
      cam.quaternion.setFromEuler(new THREE.Euler(L.pitch, car.rotation.y + L.yaw, 0, "YXZ"));
    } else {
      const bk = this.vehicle?.kind === "bike";
      // Forward camera offsets use bike-local -Z with h+PI/2 and car-local +Z with h-PI/2; both rotate behind the vehicle.
      const off = new THREE.Vector3(0, (bk ? 1.9 : 2.5) + Math.min(2.2, (this.bikeAir || 0) * 0.5), (bk ? -4.6 : 7.2) * (1 + Math.min(0.25, (this.bikeAir || 0) * 0.08))).applyAxisAngle(new THREE.Vector3(0, 1, 0), car.rotation.y + L.yaw);
      off.y += Math.max(0, L.pitch - 0.08) * 8;
      const want = car.position.clone().add(off);
      if (shake) want.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake));
      // never through a wall: pull the camera in toward the car
      const col = this.getCollider();
      if (col) for (let k = 0; k < 8 && col.blocked(want.x, -want.z, 0.4, want.y); k++) want.lerp(car.position.clone().setY(want.y), 0.3);
      const a = this.camBlend < 1 ? (this.camBlend = Math.min(1, (this.camBlend || 0) + dt * 1.2), 1 - Math.exp(-dt * 3)) : 1 - Math.exp(-dt * 6);
      cam.position.lerp(want, a);
      // bike faces +Z so look ahead is +Z; car faces -Z so look ahead is -Z
      const look = car.position.clone().add(new THREE.Vector3(0, bk ? 1.0 : 1.1, 0)).add(new THREE.Vector3(0, 0, bk ? 4 : -4).applyQuaternion(car.quaternion));
      cam.lookAt(look);
    }
  }

  // minimap: the route still to drive and where the car is
  mapInfo() {
    if (!this.car?.visible || this.state === "idle") return null;
    const P = this.path, i0 = P ? Math.floor(this.s / P.step) : 0;
    const routed = P && (this.state === "coming" || this.state === "riding");
    const wp = this.nav.waypoint;
    if (!routed && this.state === "driving" && wp && this.roads) {          // driving yourself to a destination: the road route is on the map too
      const now = performance.now(), x = this.car.position.x, y = -this.car.position.z;
      if (!this.wpRoute || now - this.wpRoute.t > 2000 || this.wpRoute.key !== wp.x + "," + wp.y) {
        const a = this.roads.projectAll(x, y, 1)?.[0], b = this.roads.projectAll(wp.x, wp.y, 1)?.[0];
        this.wpRoute = { t: now, key: wp.x + "," + wp.y, route: (a && b && this.roads.route(a, b)) || [[x, y], [wp.x, wp.y]] };
      }
      return { car: [x, y], route: this.wpRoute.route };
    }
    return { car: [this.car.position.x, -this.car.position.z], route: routed ? P.pts.slice(i0) : null };
  }
}

const fmtDist = d => d < 1000 ? `${Math.max(10, Math.round(d / 10) * 10)} m` : `${(d / 1000).toFixed(1)} km`;
const fmtTime = s => s < 60 ? `${Math.max(5, Math.round(s / 5) * 5)} s` : `${Math.round(s / 60)} min`;
