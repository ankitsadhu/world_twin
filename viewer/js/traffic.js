// Living street: ambient cars and motorcycle riders on the real one-way grid, signals on a green wave and crosswalk phases.
// Cars use instanced LOD1 meshes; motorcycles use pooled bike/rider models. They live in a ring around the camera,
// stop at painted stop bars, keep a gap to traffic and pedestrians, and turn onto cross streets that run their way.
// Coordinates: Blender local metres (x, y); avenues run along +y. three.js = (x, z = -y).
import * as THREE from "three";
import { RINGS, ellipseGeometry, ringMaterial } from "./shadow.js";
import { obbContact, resolveImpact, boxInertia } from "./collide.js";
import { Avatar } from "./avatar.js";

const NORTHBOUND = new Set([-823, -275, 273]);    // 10th, 8th, 6th Ave (same rule as scripts/blender/scatter_props.py)
const CYCLE = 36;                                   // s: avenue green 0-15, amber -18, all red -19, street green -33, amber -35.5
const WAVE = 1.6;                                   // s per block: avenue greens roll uptown/downtown like the real ones
const V_CRUISE = 11, ACC = 2.4, BRAKE = 4.5, GAP = 6.5;
const TYPES = [["Taxi", 4], ["CarSedanBlack", 4], ["CarSedanWhite", 3], ["CarSUVSilver", 3], ["CarSedanBlue", 3], ["CarSUVRed", 2]];

// do two oriented boxes (centre, heading, half length, half width) overlap? separating-axis test
function obbOverlap(ax, ay, ah, bx, by, bh, hl, hw) {
  const dx = bx - ax, dy = by - ay;
  const axes = [[Math.cos(ah), Math.sin(ah)], [-Math.sin(ah), Math.cos(ah)], [Math.cos(bh), Math.sin(bh)], [-Math.sin(bh), Math.cos(bh)]];
  const rad = (h, u) => hl * Math.abs(Math.cos(h) * u[0] + Math.sin(h) * u[1]) + hw * Math.abs(-Math.sin(h) * u[0] + Math.cos(h) * u[1]);
  for (const u of axes) if (Math.abs(dx * u[0] + dy * u[1]) > rad(ah, u) + rad(bh, u)) return false;
  return true;
}

export class Traffic {
  constructor({ scene, camera, grid, bounds, crowd = () => null, audio = null, count = 28, getCollider = () => null,
    models = null, ground = null, allowRiderHits = () => false }) {
    Object.assign(this, { scene, camera, crowd, audio, count, getCollider, models, ground });
    this.allowRiderHits = allowRiderHits;
    this.avenues = grid.avenues.map(([x, w]) => ({ x, w, dir: NORTHBOUND.has(x) ? 1 : -1 }));
    this.streets = grid.streets.slice().sort((a, b) => a[0] - b[0]).map(([y, w], k) => {
      const no = 37 + k;                                            // 37th St at the south edge of the grid
      return { y, w, k, dir: w >= 15 ? 0 : (no % 2 === 0 ? 1 : -1) }; // 0 = two-way (42nd); even streets eastbound
    });
    this.bounds = bounds;
    this.cars = [];
    this.nextId = 0;                                                // each car's rank: the lower number has the right of way where paths cross
    this.extra = [];                                                // other movers to respect: your cab, you on foot
    this.people = null;                                             // (x, y, r) => [[x, y]]: pedestrians with bodies (set by the viewer)
    this.pursuitCars = [];
    this.pursuitTarget = null;
    this.motorcyclePool = [];
    this.motorcyclesReady = false;
    this.t = 0;
    this.ready = false;
  }

  // ---------------------------------------------------------------- signals
  // phase of the intersection at street index k: "G" / "Y" / "R" for avenue and street traffic
  phase(k, t = this.t) {
    const c = ((t + k * WAVE) % CYCLE + CYCLE) % CYCLE;
    const ave = c < 15 ? "G" : c < 18 ? "Y" : "R";
    const st = c >= 19 && c < 33 ? "G" : c >= 33 && c < 35.5 ? "Y" : "R";
    return { ave, st, c };
  }
  // may a pedestrian step onto this crosswalk now? (walk with the parallel traffic, not in its last seconds)
  canCross(kind, k) {
    const { c } = this.phase(k);
    return kind === "acrossAve" ? c >= 19 && c < 27 : c >= 0.5 && c < 8;
  }
  crosswalks() {                                                    // for the crowd's walkable raster
    const out = [];
    for (const a of this.avenues) for (const s of this.streets) {
      for (const side of [-1, 1]) {
        const yc = s.y + side * (s.w / 2 + 1.2 + 1.8);
        out.push({ kind: "acrossAve", k: s.k, x0: a.x - a.w / 2, x1: a.x + a.w / 2, y0: yc - 1.8, y1: yc + 1.8 });
        const xc = a.x + side * (a.w / 2 + 1.2 + 1.8);
        out.push({ kind: "acrossSt", k: s.k, x0: xc - 1.8, x1: xc + 1.8, y0: s.y - s.w / 2, y1: s.y + s.w / 2 });
      }
    }
    return out;
  }

  // is (x, y) on the pavement within ~2 m of a crosswalk (someone waiting to cross)? Lazy 20 m cell index of the rects.
  atCrosswalk(x, y) {
    if (!this.cwCells) {
      this.cwCells = new Map();
      for (const r of this.crosswalks()) {
        for (let cx = Math.floor((r.x0 - 2.2) / 20); cx <= Math.floor((r.x1 + 2.2) / 20); cx++)
          for (let cy = Math.floor((r.y0 - 2.2) / 20); cy <= Math.floor((r.y1 + 2.2) / 20); cy++) {
            const k = cx + "," + cy; (this.cwCells.get(k) || this.cwCells.set(k, []).get(k)).push(r);
          }
      }
    }
    for (const r of this.cwCells.get(Math.floor(x / 20) + "," + Math.floor(y / 20)) || [])
      if (x > r.x0 - 2.2 && x < r.x1 + 2.2 && y > r.y0 - 2.2 && y < r.y1 + 2.2) return true;
    return false;
  }

  // where a car will be d metres further along its own path: its turn curve (then straight on), or straight ahead
  pathAt(c, d) {
    const T = c.turn;
    if (!T) return [c.x + Math.cos(c.h) * d, c.y + Math.sin(c.h) * d, c.h];
    const tt = T.t + d / T.len;
    if (tt >= 1) { const rest = (tt - 1) * T.len; return [T.p2[0] + Math.cos(T.hEnd) * rest, T.p2[1] + Math.sin(T.hEnd) * rest, T.hEnd]; }
    const u = 1 - tt, [p0, p1, p2] = [T.p0, T.p1, T.p2];
    const dx = 2 * u * (p1[0] - p0[0]) + 2 * tt * (p2[0] - p1[0]), dy = 2 * u * (p1[1] - p0[1]) + 2 * tt * (p2[1] - p1[1]);
    return [u * u * p0[0] + 2 * u * tt * p1[0] + tt * tt * p2[0], u * u * p0[1] + 2 * u * tt * p1[1] + tt * tt * p2[1], dx * dx + dy * dy > 1e-6 ? Math.atan2(dy, dx) : c.h];
  }

  inIntersection(c) {
    return this.avenues.some(a => Math.abs(c.x - a.x) < a.w / 2 + 3)
      && this.streets.some(s => Math.abs(c.y - s.y) < s.w / 2 + 3);
  }

  // the speed allowed by the next stop bar for a vehicle at (x, y) heading h (radians, Blender plane)
  lightLimit(x, y, h) {
    const cx = Math.cos(h), cy = Math.sin(h);
    if (Math.abs(cy) > Math.abs(cx) * 1.5) {                       // moving along an avenue
      const a = this.avenues.find(a => Math.abs(x - a.x) < a.w / 2 + 1);
      if (!a) return Infinity;
      const d = Math.sign(cy);
      let best = Infinity;
      for (const s of this.streets) {
        const stop = s.y - d * (s.w / 2 + 1.2 + 3.6 + 1.2), dist = (stop - y) * d;
        if (dist < -0.3 || dist > 45) continue;
        const p = this.phase(s.k).ave;
        if (p === "G" || (p === "Y" && dist < 7)) continue;
        best = Math.min(best, Math.sqrt(2 * BRAKE * 0.8 * Math.max(0, dist)));
      }
      return best;
    }
    if (Math.abs(cx) > Math.abs(cy) * 1.5) {                       // moving along a street
      const s = this.streets.find(s => Math.abs(y - s.y) < s.w / 2 + 1);
      if (!s) return Infinity;
      const d = Math.sign(cx);
      let best = Infinity;
      for (const a of this.avenues) {
        const stop = a.x - d * (a.w / 2 + 1.2 + 3.6 + 1.2), dist = (stop - x) * d;
        if (dist < -0.3 || dist > 45) continue;
        const p = this.phase(s.k).st;
        if (p === "G" || (p === "Y" && dist < 7)) continue;
        best = Math.min(best, Math.sqrt(2 * BRAKE * 0.8 * Math.max(0, dist)));
      }
      return best;
    }
    return Infinity;
  }

  // the speed allowed by whatever is ahead: other cars, your cab, people on the road
  followLimit(x, y, h, self) {
    const fx = Math.cos(h), fy = Math.sin(h);
    let gap = Infinity, ped = Infinity, slow = Infinity;
    const consider = (ox, oy, oh, len = 4.6, person = false) => {
      const rx = ox - x, ry = oy - y, along = rx * fx + ry * fy;
      if (along <= 0 || along > 32) return;
      const lat = Math.abs(rx * fy - ry * fx);
      // someone in the next lane or at the edge of the street (crossing, stepping off the kerb): the car eases past slowly
      if (person && lat >= 1.7 && lat < 4.5 && along < 16) slow = Math.min(slow, 3.5 + along * 0.35);
      // someone waiting at a crosswalk, still on the pavement: the car is ready to stop, as a driver is (about 13 mph)
      else if (person && lat >= 4.5 && lat < 16 && along < 24 && this.atCrosswalk(ox, oy)) slow = Math.min(slow, 6);
      if (lat > (person ? 1.7 : 2.1)) return;                   // a person: only if actually in the car's path
      if (oh !== null) { let dh = Math.abs(oh - h) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh; if (dh > 2.2) return; }
      const g = along - len / 2;
      if (person) { ped = Math.min(ped, g); gap = Math.min(gap, g + 3.0); }   // people: it stops about 3 m closer than behind a car
      else gap = Math.min(gap, g);
    };
    for (const c of this.cars) if (c !== self && c.alive) consider(c.x, c.y, c.h, c.motorcycle ? 1.8 : 4.6);
    for (const e of this.extra) if (e !== self && e.alive?.()) { const [ex, ey] = e.pose(); consider(ex, ey, null, e.len, !!e.len); }   // e.len: a person is not 4.6 m long
    const crowd = this.crowd();
    if (crowd) for (const [px, py] of crowd.near(x + fx * 8, y + fy * 8, 10)) consider(px, py, null, 1.2, true);
    // people with bodies (the NPCs strolling Times Square, and you on foot): a car never drives over anyone in its lane
    if (this.people) for (const [px, py] of this.people(x + fx * 12, y + fy * 12, 14)) consider(px, py, null, 1.0, true);
    // Crossing traffic projects both paths over the next ~2 s. Cars already in the intersection keep their space;
    // simultaneous turns use stable ids to avoid both yielding. A vehicle you drive always has the right of way.
    let cross = Infinity;
    if (self?.id != null) {
      const vm = Math.max(self.v, 4), TAUS = [0.35, 0.7, 1.1, 1.6, 2.2];
      const verdict = (o, oPath) => {
        for (const tau of TAUS) {
          const A = this.pathAt(self, vm * tau), B = oPath(tau);
          if (obbOverlap(A[0], A[1], A[2], B[0], B[1], B[2], 2.55, 1.2)) return tau < 0.8 ? 0 : tau < 1.7 ? 2.5 : 5;
        }
        return Infinity;
      };
      for (const o of this.cars) {
        if (o === self || !o.alive || (o.x - x) ** 2 + (o.y - y) ** 2 > 900) continue;
        let dh = Math.abs(o.h - h) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh;
        if (dh < 0.35 && !self.turn && !o.turn) continue;           // same way, neither turning: the lane-following logic handles it
        if (o.id > self.id && o.v > 0.8 && !self.turn && !o.turn) continue;
        if (!self.turn && this.inIntersection(self) && o.turn) continue;
        if (self.turn && o.turn && self.id < o.id) continue;
        cross = Math.min(cross, verdict(o, tau => this.pathAt(o, o.v * tau)));
      }
      for (const e of this.extra) {
        if (!e.alive?.() || e.len) continue;
        const [ex, ey, eh, ev] = e.pose();
        if ((ex - x) ** 2 + (ey - y) ** 2 > 900) continue;
        cross = Math.min(cross, verdict(e, tau => [ex + Math.cos(eh) * ev * tau, ey + Math.sin(eh) * ev * tau, eh]));
      }
    }
    this.pedGap = ped;                                                // read right after by the car loop: brake harder if someone is close
    const lim = gap === Infinity ? Infinity : Math.max(0, gap - GAP) * 1.1;
    return Math.min(lim, slow, cross);
  }

  // ---------------------------------------------------------------- where cars may be: on a real road, never in the river
  // The grid lines run to the map edge (across the Hudson, through blocks with no street); the street centrelines
  // (nav.json NAV_roads, plazas already cut out) say where a road actually is.
  setRoads(nodes, segs) {
    this.roadCells = new Map();
    const C = 20;
    for (const [a, b] of segs) {
      const [ax, ay] = nodes[a], [bx, by] = nodes[b];
      for (let cx = Math.floor((Math.min(ax, bx) - 14) / C); cx <= Math.floor((Math.max(ax, bx) + 14) / C); cx++)
        for (let cy = Math.floor((Math.min(ay, by) - 14) / C); cy <= Math.floor((Math.max(ay, by) + 14) / C); cy++) {
          const k = cx + "," + cy; (this.roadCells.get(k) || this.roadCells.set(k, []).get(k)).push([ax, ay, bx, by]);
        }
    }
  }
  inWater(x, y) {
    const col = this.getCollider();
    if (!col) return false;
    for (const i of col.near(x, y, 0)) {
      const p = col.polys[i];
      if (p.kind !== "water") continue;
      const [x0, y0, x1, y1] = p.box;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      let c = false;
      for (let a = 0, b = p.pts.length - 1; a < p.pts.length; b = a++) {
        const [xi, yi] = p.pts[a], [xj, yj] = p.pts[b];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      if (c) return true;
    }
    return false;
  }
  drivable(x, y) {
    if (this.inWater(x, y)) return false;
    if (this.getCollider()?.blocked(x, y, 1.2, 0.5)) return false;   // the simple grid crosses real buildings in places
    if (!this.roadCells) return true;
    for (const [ax, ay, bx, by] of this.roadCells.get(Math.floor(x / 20) + "," + Math.floor(y / 20)) || []) {
      const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L));
      if (Math.hypot(ax + vx * t - x, ay + vy * t - y) < 12) return true;   // within half an avenue of a real street
    }
    return false;
  }

  // ---------------------------------------------------------------- setup (after the props chunk is in the scene)
  // models: the traffic cars' own file (export/vehicles/traffic.glb: PROP_Taxi, PROP_CarSedanBlack, ...), newer than the
  // props chunk's cars; each car is one mesh per material
  init(models = this.models) {
    if (this.ready) return true;
    const parts = {};
    this.scene.traverse(o => {
      const m = o.isInstancedMesh && /^INST_PROP_(Taxi|Car\w+?)(\d*)(_\d+)?$/.exec(o.name);
      if (!m) return;
      const type = m[1];
      (parts[type] ||= []).push(o);
    });
    if (!parts.Taxi) return false;                                  // props not loaded (or ?noopt)
    // the frozen props traffic is replaced by moving cars
    this.statics = [];
    for (const list of Object.values(parts)) for (const o of list) { this.statics.push([o, o.count]); o.count = 0; }
    if (models) for (const type of Object.keys(parts)) {           // the newer cars, where the file has them
      const root = models.getObjectByName("PROP_" + type);
      const list = [];
      root?.traverse(o => { if (o.isMesh) list.push(o); });
      if (list.length) parts[type] = list;
    }
    this.types = [];
    const cap = this.count + 24;
    for (const [type, weight] of TYPES) {
      if (!parts[type]) continue;
      const meshes = parts[type].map(src => {
        const im = new THREE.InstancedMesh(src.geometry, src.material, cap);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.count = 0; im.frustumCulled = false; im.name = "TRAFFIC_" + src.name; im.userData.traffic = true;
        this.scene.add(im); return im;
      });
      this.types.push({ type, weight, meshes });
    }
    this.weightSum = this.types.reduce((s, t) => s + t.weight, 0);
    this.shadows = RINGS.map(([k, a]) => {                         // contact shadows (shadow.js), one layer per ring
      const im = new THREE.InstancedMesh(ellipseGeometry(2.3 * k, 5.2 * k), ringMaterial(a), cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.count = 0; im.frustumCulled = false;
      im.raycast = () => {}; im.renderOrder = 1; this.scene.add(im); return im;
    });
    const lightGeometry = new THREE.BoxGeometry(0.18, 0.1, 0.22);
    const lightMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.policeRed = new THREE.InstancedMesh(lightGeometry, lightMaterial, Math.max(cap, 48));
    this.policeBlue = new THREE.InstancedMesh(lightGeometry, lightMaterial, Math.max(cap, 48));
    for (const [mesh, name] of [[this.policeRed, "PURSUIT_red_lights"], [this.policeBlue, "PURSUIT_blue_lights"]]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.name = name; mesh.userData.traffic = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(mesh);
    }
    this.initSignals();
    this.ready = true;
    return true;
  }

  async setMotorcycles({ bikes, loader, root, characterIds, count = 6 }) {
    await bikes.ready;
    const available = characterIds.length ? characterIds : ["daniel"];
    const made = await Promise.all(Array.from({ length: count }, async (_, i) => {
      const avatar = await Avatar.create(loader, root, available[i % available.length], { far: true });
      const bike = bikes.make();
      bikes.mount(bike, avatar);
      bikes.pose(bike, 1, 0, 0);
      bike.group.visible = false;
      this.scene.add(bike.group);
      return { bike, avatar, busy: false };
    }));
    this.motorcyclePool.push(...made);
    this.bikeSystem = bikes;
    this.motorcyclesReady = true;
    const candidates = this.cars.filter(c => c.alive && !c.pursuit);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const c of candidates.slice(0, this.motorcycleTarget())) {
      const actor = this.acquireMotorcycle();
      if (!actor) break;
      c.motorcycle = true;
      c.actor = actor;
    }
  }

  acquireMotorcycle() {
    const actor = this.motorcyclePool.find(v => !v.busy);
    if (!actor) return null;
    actor.busy = true;
    actor.bike.group.visible = true;
    this.bikeSystem?.autoPaint?.(actor.bike);                                  // a colour no bike in view is wearing
    return actor;
  }

  motorcycleTarget() {
    return Math.min(this.motorcyclePool.length, Math.max(2, Math.round(this.count * 0.18)));
  }

  vehicleBody(c) {
    const halfLength = c.motorcycle ? 0.95 : 2.3, halfWidth = c.motorcycle ? 0.43 : 1;
    const mass = c.motorcycle ? 330 : 1400;
    return { x: c.x, y: c.y, h: c.h, vx: c.vx, vy: c.vy, omega: c.omega || 0,
      mass, inertia: boxInertia(mass, halfLength, halfWidth), halfLength, halfWidth };
  }

  ejectMotorcycleRider(c, vx, vy, strength) {
    if (!c?.motorcycle || c.riderEjected || !c.actor?.avatar) return false;
    const avatar = c.actor.avatar;
    this.bikeSystem.dismount(c.actor.bike);
    c.actor.avatar = null;
    c.riderEjected = true;
    const speed = Math.hypot(vx, vy) || Math.hypot(c.vx, c.vy) || 1;
    const dx = vx || c.vx || Math.cos(c.h), dy = vy || c.vy || Math.sin(c.h);
    this.bikeSystem.pose(c.actor.bike, 0, 0, 0);
    this.onRiderEjected?.(avatar, c.x, c.y, dx / speed * Math.max(speed, 2), dy / speed * Math.max(speed, 2), strength);
    return true;
  }

  hitRiderAt(x, y, vx, vy, strength = 0.3, radius = 1.8) {
    if (!this.allowRiderHits()) return false;
    const target = this.cars.filter(c => c.alive && c.motorcycle && !c.riderEjected)
      .map(c => [c, Math.hypot(c.x - x, c.y - y)])
      .filter(([, d]) => d < radius).sort((a, b) => a[1] - b[1])[0]?.[0];
    if (!target || !this.ejectMotorcycleRider(target, vx, vy, strength)) return false;
    target.vx *= 0.25; target.vy *= 0.25;
    target.v = Math.hypot(target.vx, target.vy);
    target.mode = "kicked";
    target.hitT = 0.35;
    target.crashedT = 0;
    return true;
  }

  takeMotorcycle(c) {
    if (!c?.alive || !c.motorcycle || !c.riderEjected || c.mode !== "abandoned" || !c.actor) return null;
    const actor = c.actor, bike = actor.bike;
    this.motorcyclePool = this.motorcyclePool.filter(item => item !== actor);
    actor.busy = false;
    c.actor = null; c.alive = false;
    bike.group.visible = true;
    bike.heading = c.h;
    bike.speed = 0;
    return { bike, x: c.x, y: c.y, h: c.h, speed: 0 };
  }

  // light the red / amber / green lamps of every signal head according to its intersection's phase
  initSignals() {
    let poles = null;
    this.scene.traverse(o => { if (o.isInstancedMesh && /^INST_PROP_TrafficSignal/.test(o.name) && !poles) poles = o; });
    this.scene.traverse(o => {                                      // the baked "always red" lamps go dark
      for (const m of o.isMesh ? [].concat(o.material) : []) if (/^M_Light_SignalRed/.test(m.name)) { m.emissive?.setRGB(0, 0, 0); m.color?.setRGB(0.05, 0.02, 0.02); }
    });
    if (!poles) return;
    const heads = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < poles.count; i++) {
      poles.getMatrixAt(i, m);
      m.decompose(p, q, sc);
      const n = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);      // lenses face -X (local)
      const travel = [-n.x, n.z];                                    // drivers who see it travel against the lens normal
      const axis = Math.abs(travel[1]) > Math.abs(travel[0]) ? "ave" : "st";
      const bx = p.x, by = -p.z;
      const s = this.streets.reduce((b, s) => Math.abs(s.y - by) < Math.abs(b.y - by) ? s : b, this.streets[0]);
      for (const hy of [3.4, 6.2]) heads.push({ m: m.clone(), hy, axis, k: s.k });
    }
    const geo = new THREE.CircleGeometry(0.12, 14);
    geo.rotateY(-Math.PI / 2);                                       // face -X like the lenses
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.lamps = new THREE.InstancedMesh(geo, mat, heads.length);
    this.lamps.frustumCulled = false; this.lamps.name = "TRAFFIC_lamps";
    this.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(heads.length * 3), 3);
    this.heads = heads;
    this.scene.add(this.lamps);
    this.lastLamp = "";
  }
  updateSignals() {
    if (!this.lamps) return;
    const key = this.streets.map(s => { const p = this.phase(s.k); return p.ave + p.st; }).join("");
    if (key === this.lastLamp) return;                               // only when some light changes
    this.lastLamp = key;
    const local = new THREE.Matrix4(), out = new THREE.Matrix4(), col = new THREE.Color();
    const Z = { R: 6.08, Y: 5.75, G: 5.42 }, C = { R: [1, 0.08, 0.05], Y: [1, 0.62, 0.05], G: [0.15, 1, 0.45] };
    this.heads.forEach((h, i) => {
      const st = this.phase(h.k)[h.axis];
      local.makeTranslation(-0.215, Z[st], -h.hy);                   // Blender (x, y, z) -> three (x, z, -y)
      out.multiplyMatrices(h.m, local);
      this.lamps.setMatrixAt(i, out);
      col.setRGB(...C[st]).multiplyScalar(1.8);
      this.lamps.setColorAt(i, col);
    });
    this.lamps.instanceMatrix.needsUpdate = true; this.lamps.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- spawning
  pickType() { let r = Math.random() * this.weightSum; for (const t of this.types) if ((r -= t.weight) <= 0) return t; return this.types[0]; }
  inBounds(x, y) { const [x0, y0, x1, y1] = this.bounds; return x > x0 + 20 && x < x1 - 20 && y > y0 + 20 && y < y1 - 20; }
  visible(x, y) {
    const v = new THREE.Vector3(x, 1, -y).project(this.camera);
    return v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && this.camera.position.distanceTo(new THREE.Vector3(x, 1, -y)) < 260;
  }
  lanesOf(line, axis) {
    if (axis === "ave") return [1, 2, 3, 4, 5].map(l => line.x - line.w / 2 + (l + 0.5) * line.w / 6);
    return line.dir === 0 ? [line.y - 2.6, line.y + 2.6] : [line.y];
  }
  spawn(initial) {
    const cam = this.camera.position, cx = cam.x, cy = -cam.z;
    for (let tries = 0; tries < 20; tries++) {
      const ave = Math.random() < 0.62, r = 40 + Math.random() * 180, a = Math.random() * 6.283;   // the streets around you
      let x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, h, dir;
      if (ave) {
        const line = this.avenues.reduce((b, l) => Math.abs(l.x - x) < Math.abs(b.x - x) ? l : b);
        const lanes = this.lanesOf(line, "ave"); x = lanes[Math.floor(Math.random() * lanes.length)]; dir = line.dir; h = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        if (this.streets.some(s => Math.abs(s.y - y) < s.w / 2 + 8)) continue;          // not inside an intersection
      } else {
        const line = this.streets.reduce((b, l) => Math.abs(l.y - y) < Math.abs(b.y - y) ? l : b);
        dir = line.dir || (Math.random() < 0.5 ? 1 : -1);
        y = line.dir === 0 ? line.y - 2.6 * dir : line.y; h = dir > 0 ? 0 : Math.PI;
        if (this.avenues.some(av => Math.abs(av.x - x) < av.w / 2 + 8)) continue;
      }
      if (!this.inBounds(x, y) || (!initial && this.visible(x, y))) continue;
      if (!this.drivable(x, y) || !this.drivable(x + Math.cos(h) * 20, y + Math.sin(h) * 20)) continue;   // real road, not the river
      if (this.cars.some(c => c.alive && Math.hypot(c.x - x, c.y - y) < 12)) continue;
      if (this.cars.reduce((n, c) => n + (c.alive && Math.hypot(c.x - x, c.y - y) < 55 ? 1 : 0), 0) >= 3) continue;   // spread out: no convoys
      if (this.extra.some(e => e.alive?.() && Math.hypot(e.pose()[0] - x, e.pose()[1] - y) < 12)) continue;
      const activeBikes = this.cars.reduce((n, c) => n + (c.alive && c.motorcycle ? 1 : 0), 0);
      const actor = this.motorcyclesReady && activeBikes < this.motorcycleTarget() ? this.acquireMotorcycle() : null;
      this.cars.push({ id: ++this.nextId, x, y, h, v: V_CRUISE * 0.7, type: this.pickType(), alive: true,
        motorcycle: !!actor, actor, turn: null, blocked: 0, lastCross: null, mode: "driving", vx: Math.cos(h) * V_CRUISE * 0.7,
        vy: Math.sin(h) * V_CRUISE * 0.7, omega: 0, hitT: 0, crashedT: 0 });
      return;
    }
  }

  startPursuit(target, count = 2, vmax = 18, { bikes = 0, blocks = 0 } = {}) {
    this.clearPursuit();
    const choices = [];
    for (let ring = 34; ring <= 76; ring += 14) for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, x = target.x + Math.cos(a) * ring, y = target.y + Math.sin(a) * ring;
      if (!this.inBounds(x, y) || !this.drivable(x, y)) continue;
      if (this.cars.some(c => c.alive && Math.hypot(c.x - x, c.y - y) < 10)) continue;
      if (choices.some(p => Math.hypot(p.x - x, p.y - y) < 12)) continue;
      choices.push({ x, y, h: Math.atan2(target.y - y, target.x - x) });
    }
    if (choices.length < 2) return false;
    count = Math.min(count, choices.length);

    const types = this.types.filter(t => t.type !== "Taxi");
    if (!types.length) return false;
    this.pursuitCars = choices.slice(0, count).map((p, i) => {
      const c = { id: ++this.nextId, ...p, v: 0, type: types[i % types.length], alive: true, turn: null,
        blocked: 0, lastCross: null, mode: "pursuing", vx: 0, vy: 0, omega: 0, hitT: 0, crashedT: 0, pursuit: true, vmax };
      this.cars.push(c);
      return c;
    });
    // police motorcycles: the last `bikes` chasers swap their cars for bikes (faster to turn, they weave through the traffic)
    for (let i = 0; i < bikes && i < this.pursuitCars.length; i++) {
      const c = this.pursuitCars[this.pursuitCars.length - 1 - i];
      let actor = this.motorcyclesReady ? this.acquireMotorcycle() : null;
      if (!actor && this.motorcyclesReady) {                                    // every bike is already out on the street: a civilian hands theirs to the police
        const civ = this.cars.find(o => o.alive && o.motorcycle && !o.pursuit && !o.riderEjected && o.actor);
        if (civ) { actor = civ.actor; civ.actor = null; civ.alive = false; }
      }
      if (actor) { c.motorcycle = true; c.actor = actor; c.vmax = vmax + 3; }
    }
    this.setPursuitTarget(target);
    this.blockTarget = blocks;
    this.refreshRoadblocks(target);
    return true;
  }

  // a roadblock across the street ahead of you: cruisers parked broadside (solid), lights flashing; kept up as you drive on
  refreshRoadblocks(target) {
    if (!this.blockTarget) return;
    const fx = Math.cos(target.h), fy = Math.sin(target.h);
    for (const c of this.pursuitCars) if (c.blockade) {                         // passed or far: take it down
      const along = (c.x - target.x) * fx + (c.y - target.y) * fy;
      if ((along < -45) || Math.hypot(c.x - target.x, c.y - target.y) > 320) { c.alive = false; }
    }
    this.pursuitCars = this.pursuitCars.filter(c => c.alive);
    const have = new Set(this.pursuitCars.filter(c => c.blockade).map(c => c.group));
    if (have.size >= this.blockTarget || (this.lastBlock && performance.now() - this.lastBlock < 6000)) return;
    const ang = Math.round(target.h / (Math.PI / 2)) * Math.PI / 2, ax = Math.cos(ang), ay = Math.sin(ang), px = -ay, py = ax;
    for (const d of [140, 175, 210, 110]) {
      const x = target.x + ax * d, y = target.y + ay * d;
      if (!this.inBounds(x, y) || !this.drivable(x, y)) continue;
      const slots = [-4.6, 0, 4.6].map(o => [x + px * o, y + py * o]).filter(([sx, sy]) => this.drivable(sx, sy) && this.inBounds(sx, sy));
      if (slots.length < 2) continue;
      for (const c of this.cars) if (c.alive && !c.pursuit && Math.hypot(c.x - x, c.y - y) < 14) c.alive = false;   // civilians clear out
      const types = this.types.filter(t => t.type !== "Taxi"), gid = ++this.nextId;
      slots.forEach(([sx, sy], i) => {
        const c = { id: ++this.nextId, x: sx, y: sy, h: ang + Math.PI / 2 + (i - 1) * 0.12, v: 0, type: types[i % types.length], alive: true, turn: null, blocked: 0,
          lastCross: null, mode: "blockade", vx: 0, vy: 0, omega: 0, hitT: 0, crashedT: 0, pursuit: true, blockade: true, group: gid };
        this.cars.push(c); this.pursuitCars.push(c);
      });
      this.lastBlock = performance.now();
      return;
    }
  }

  setPursuitTarget(target) { this.pursuitTarget = target ? { ...target } : null; }

  clearPursuit() {
    for (const c of this.pursuitCars) c.alive = false;
    this.pursuitCars = [];
    this.pursuitTarget = null;
  }

  updatePursuitCar(c, dt) {
    if (c.blockade) { c.v = 0; c.vx = c.vy = 0; c.mode = "blockade"; return; }
    const target = this.pursuitTarget;
    c.mode = "pursuing";
    if (!target) {
      c.v = Math.max(0, c.v - BRAKE * dt);
      return;
    }
    const targetDistance = Math.hypot(target.x - c.x, target.y - c.y);
    if (targetDistance <= 5) {
      c.v = Math.max(0, c.v - BRAKE * dt);
      return;
    }
    c.prevX = c.x; c.prevY = c.y; c.prevH = c.h;
    const desired = Math.atan2(target.y - c.y, target.x - c.x);
    let delta = ((desired - c.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    let heading = c.h + THREE.MathUtils.clamp(delta, -1.25 * dt, 1.25 * dt);
    let step = Math.min(Math.max(5, c.v) * dt, targetDistance - 5);
    let nx = c.x + Math.cos(heading) * step;
    let ny = c.y + Math.sin(heading) * step;
    if (!this.drivable(nx, ny)) {
      const options = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
        .filter(h => this.drivable(c.x + Math.cos(h) * 2, c.y + Math.sin(h) * 2))
        .sort((a, b) => {
          const da = Math.abs(((Math.atan2(target.y - c.y, target.x - c.x) - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          const db = Math.abs(((Math.atan2(target.y - c.y, target.x - c.x) - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          return da - db;
        });
      if (!options.length) {
        c.v = Math.max(0, c.v - BRAKE * dt);
        return;
      }
      delta = ((options[0] - c.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      heading = c.h + THREE.MathUtils.clamp(delta, -1.25 * dt, 1.25 * dt);
      step = Math.min(Math.max(5, c.v) * dt, targetDistance - 5);
      nx = c.x + Math.cos(heading) * step;
      ny = c.y + Math.sin(heading) * step;
      if (!this.drivable(nx, ny)) {
        c.v = Math.max(0, c.v - BRAKE * dt);
        return;
      }
    }
    const body = { x: nx, y: ny, h: heading, halfLength: 2.3, halfWidth: 1 };
    if (this.cars.some(other => other !== c && other.alive && obbContact(body,
      { x: other.x, y: other.y, h: other.h, halfLength: 2.3, halfWidth: 1 }))) {
      c.v = Math.max(0, c.v - BRAKE * dt);
      return;
    }
    c.h = heading;
    c.v = Math.min(c.vmax || 18, c.v + ACC * dt, this.lightLimit(c.x, c.y, c.h), this.followLimit(c.x, c.y, c.h, c));
    c.v = Math.max(0, c.v);
    c.x += Math.cos(c.h) * c.v * dt;
    c.y += Math.sin(c.h) * c.v * dt;
    c.vx = Math.cos(c.h) * c.v; c.vy = Math.sin(c.h) * c.v;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.ready) return;
    this.t += dt;
    this.updateSignals();
    const cam = this.camera.position, cx = cam.x, cy = -cam.z;
    const rush = 0.65 + 0.35 * Math.sin(this.t / 55);               // the city breathes: a slow rush-hour wave, 65%..100%
    const want = cam.y > 400 ? 0 : Math.max(2, Math.round(this.count * rush));                      // nobody needs traffic from a plane
    for (const c of this.cars) if (!c.alive && c.actor) {
      c.actor.bike.group.visible = false;
      if (c.actor.avatar) c.actor.busy = false;
      else this.motorcyclePool = this.motorcyclePool.filter(actor => actor !== c.actor);
      c.actor = null;
    }
    this.cars = this.cars.filter(c => c.alive);
    this.extra = this.extra.filter(e => !e.temp || e.alive());       // parked cars that are gone stop being obstacles
    let n = 0, regular = this.cars.filter(c => !c.pursuit).length;
    while (regular < want && n++ < 4) { this.spawn(regular < want * 0.5); regular = this.cars.filter(c => !c.pursuit).length; }
    if (regular > want) {                                           // the Traffic setting went down: thin out now
      const extra = regular - want;
      const order = this.cars.filter(c => !c.hailed && !c.pursuit).sort((a, b) => (this.visible(a.x, a.y) ? 1 : 0) - (this.visible(b.x, b.y) ? 1 : 0));
      for (const c of want === 0 ? order : order.slice(0, Math.min(extra, 3))) { if (want === 0 || !this.visible(c.x, c.y)) c.alive = false; }
      if (want === 0) this.cars = this.cars.filter(c => c.alive);
    }
    for (const c of this.cars) {
      if (c.pursuit) { this.updatePursuitCar(c, dt); continue; }
      c.prevX = c.x; c.prevY = c.y; c.prevH = c.h;
      if (c.mode === "abandoned") {
        const d = Math.hypot(c.x - cx, c.y - cy);
        if (!c.hailed && (d > 340 && !this.visible(c.x, c.y))) c.alive = false;
        continue;
      }
      if (c.mode === "kicked" || c.mode === "crashed") {
        c.hitT = Math.max(0, c.hitT - dt);
        if (c.mode === "crashed") {
          c.crashedT -= dt;
          if (c.crashedT <= 0) { c.alive = false; continue; }
        } else {
          c.x += c.vx * dt; c.y += c.vy * dt; c.h += c.omega * dt;
          const drag = Math.exp(-dt * (c.mode === "crashed" ? 2.5 : 0.8));
          c.vx *= drag; c.vy *= drag; c.omega *= Math.exp(-dt * 1.8);
          c.v = Math.hypot(c.vx, c.vy);
          if (Math.hypot(c.vx, c.vy) < 0.35 && c.hitT <= 0) {
            c.v = c.vx = c.vy = c.omega = 0;
            if (c.motorcycle && c.riderEjected) c.mode = "abandoned";
            else { c.mode = "crashed"; c.crashedT = 5; }
          }
        }
        continue;
      }
      if (c.hold) { c.v = 0; c.vx = c.vy = 0; continue; }              // crash run: held on the line during the countdown
      // drive
      const limit = c.reckless ? c.reckless                          // a crash-run car: straight on, no lights, no yielding (the pile-up is the game)
        : c.hailed ? 0                                     // someone is walking over to get in: wait
        : Math.min(V_CRUISE, this.lightLimit(c.x, c.y, c.h), this.followLimit(c.x, c.y, c.h, c), c.turn ? 6 : Infinity);
      const brake = BRAKE * (this.pedGap < 5.5 ? 3.5 : 1.6);        // someone suddenly close in front: emergency braking (~1.6 g)
      c.v += THREE.MathUtils.clamp(limit - c.v, -brake * dt, ACC * dt);
      c.v = Math.max(0, c.v);
      if (c.turn) this.stepTurn(c, dt);
      else {
        c.x += Math.cos(c.h) * c.v * dt; c.y += Math.sin(c.h) * c.v * dt; this.maybeTurn(c);
        // the road ends ahead (river, a block with no street): out of sight it just leaves; in sight it pulls over
        if (!c.turn && (c.chk = (c.chk || 0) - dt) < 0) {
          c.chk = 0.4;
          if (!c.hailed && !this.drivable(c.x + Math.cos(c.h) * 10, c.y + Math.sin(c.h) * 10)) {
            if (!this.visible(c.x, c.y)) c.alive = false; else c.endOfRoad = true;
          }
        }
        if (c.endOfRoad) { c.v = Math.max(0, c.v - BRAKE * dt); if (!this.visible(c.x, c.y)) c.alive = false; }
      }
      c.vx = Math.cos(c.h) * c.v; c.vy = Math.sin(c.h) * c.v;
      // honk when stuck behind something that won't move (usually you)
      c.blocked = c.v < 0.3 && limit < 0.5 && this.lightLimit(c.x, c.y, c.h) === Infinity ? c.blocked + dt : 0;
      if (c.blocked > 3.5) { this.audio?.hornAt?.(new THREE.Vector3(c.x, 1, -c.y)); c.blocked = -6; }
      const d = Math.hypot(c.x - cx, c.y - cy);
      if (!c.hailed && (!this.inBounds(c.x, c.y) || (d > 340 && !this.visible(c.x, c.y)))) c.alive = false;
    }
    this.resolveTrafficImpacts();
    this.separateCars();
    this.draw();
  }

  separateCars() {
    const cars = this.cars.filter(c => c.alive);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (!obbContact(this.vehicleBody(a), this.vehicleBody(b))) continue;
        const later = a.id > b.id ? a : b, other = later === a ? b : a;
        later.x = later.prevX ?? later.x; later.y = later.prevY ?? later.y; later.h = later.prevH ?? later.h;
        later.turn = null; later.mode = "crashed"; later.crashedT = Math.max(later.crashedT || 0, 3);
        later.v = later.vx = later.vy = later.omega = 0;
        if (obbContact(this.vehicleBody(later), this.vehicleBody(other))) {
          for (let back = 0.5; back <= 6; back += 0.5) {
            const x = later.x - Math.cos(later.h) * back, y = later.y - Math.sin(later.h) * back;
            if (!this.drivable(x, y)) continue;
            if (cars.every(c => c === later || !obbContact({ ...this.vehicleBody(later), x, y },
              this.vehicleBody(c)))) { later.x = x; later.y = y; break; }
          }
        }
        if (cars.some(c => c !== later && obbContact(this.vehicleBody(later), this.vehicleBody(c)))) {
          for (let back = 0.5; back <= 24; back += 0.5) {
            const x = later.x - Math.cos(later.h) * back, y = later.y - Math.sin(later.h) * back;
            if (cars.every(c => c === later || !obbContact({ ...this.vehicleBody(later), x, y },
              this.vehicleBody(c)))) { later.x = x; later.y = y; break; }
          }
        }
      }
    }
  }

  overlapCount() {
    const cars = this.cars.filter(c => c.alive);
    let count = 0;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++)
      if (obbContact(this.vehicleBody(cars[i]), this.vehicleBody(cars[j]))) count++;
    return count;
  }

  resolveTrafficImpacts() {
    for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) {
      const a = this.cars[i], b = this.cars[j];
      if (a.pursuit || b.pursuit) continue;
      if (!a.alive || !b.alive || a.hitT > 0 || b.hitT > 0) continue;
      const A = this.vehicleBody(a), B = this.vehicleBody(b), contact = obbContact(A, B);
      if (!contact) continue;
      const result = resolveImpact(A, B, contact);
      if (result.closingSpeed < 0.5) continue;
      for (const [c, p] of [[a, A], [b, B]]) {
        Object.assign(c, { x: p.x, y: p.y, h: p.h, vx: p.vx, vy: p.vy, omega: p.omega,
          v: Math.hypot(p.vx, p.vy), mode: "kicked", hitT: 1.2, crashedT: result.strength > 0.45 ? 8 : 3 });
        if (this.allowRiderHits() && c.motorcycle && result.closingSpeed > 2.8)
          this.ejectMotorcycleRider(c, p.vx, p.vy, result.strength);
      }
    }
  }

  hitCar(car, impact) {
    if (!car?.alive) return;
    const body = this.vehicleBody(car);
    const contact = impact.contact || obbContact(impact.player, body);
    if (!contact) return;
    const result = resolveImpact(impact.player, body, contact);
    Object.assign(car, { x: body.x, y: body.y, h: body.h, vx: body.vx, vy: body.vy, omega: body.omega,
      mode: result.closingSpeed >= 0.5 ? "kicked" : car.mode, v: Math.hypot(body.vx, body.vy),
      hitT: result.closingSpeed >= 0.5 ? 1.2 : car.hitT });
    if (result.closingSpeed >= 0.5) car.crashedT = result.strength > 0.45 ? 8 : 3;
    if (this.allowRiderHits() && car.motorcycle && result.closingSpeed > 2.8)
      this.ejectMotorcycleRider(car, body.vx, body.vy, result.strength);
    return result;
  }

  // entering an intersection: maybe turn onto the cross street (only if it runs our way); the turn is a smooth
  // curve from the box entry, through the corner, to just past the far side
  maybeTurn(c) {
    const onAve = Math.abs(Math.sin(c.h)) > Math.abs(Math.cos(c.h));
    if (onAve) {
      const d = Math.sign(Math.sin(c.h));
      const s = this.streets.find(s => Math.abs(c.y - (s.y - d * s.w / 2)) < 1.0);
      if (!s || c.lastCross === "s" + s.k) return;
      c.lastCross = "s" + s.k;
      const ave = this.avenues.find(a => Math.abs(c.x - a.x) < a.w / 2 + 1);
      if (!ave || Math.random() > 0.22) return;
      const dirs = s.dir === 0 ? [1, -1] : [s.dir], e = dirs[Math.floor(Math.random() * dirs.length)];
      const ty = s.dir === 0 ? s.y - 2.6 * e : s.y;
      this.startTurn(c, [c.x, c.y], [c.x, ty], [ave.x + e * (ave.w / 2 + 3), ty], e > 0 ? 0 : Math.PI);
    } else {
      const d = Math.sign(Math.cos(c.h));
      const a = this.avenues.find(a => Math.abs(c.x - (a.x - d * a.w / 2)) < 1.0);
      if (!a || c.lastCross === "a" + a.x) return;
      c.lastCross = "a" + a.x;
      const s = this.streets.find(s => Math.abs(c.y - s.y) < s.w / 2 + 1);
      if (!s || Math.random() > 0.22) return;
      const lanes = this.lanesOf(a, "ave"), lx = lanes[(a.dir > 0) === (d > 0) ? 1 : 3];
      this.startTurn(c, [c.x, c.y], [lx, c.y], [lx, s.y + a.dir * (s.w / 2 + 3)], a.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }
  startTurn(c, p0, p1, p2, hEnd) {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    c.turn = { p0, p1, p2, t: 0, len: Math.max(4, len * 0.8), hEnd };
  }
  stepTurn(c, dt) {
    const T = c.turn;
    T.t = Math.min(1, T.t + c.v * dt / T.len);
    const t = T.t, u = 1 - t, [p0, p1, p2] = [T.p0, T.p1, T.p2];
    c.x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
    c.y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
    const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]), dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    if (dx * dx + dy * dy > 1e-6) c.h = Math.atan2(dy, dx);
    if (T.t >= 1) { c.h = T.hEnd; c.turn = null; }
  }

  // safety net: two ordinary cars may never overlap. The later car stops (and, on a straight, is eased back along its own line)
  separate() {
    const L = this.cars;
    for (let i = 0; i < L.length; i++) {
      const a = L[i]; if (!a.alive || a.pursuit || a.mode === "kicked" || a.mode === "crashed") continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j]; if (!b.alive || b.pursuit || b.mode === "kicked" || b.mode === "crashed") continue;
        const dx = b.x - a.x, dy = b.y - a.y; if (dx * dx + dy * dy > 30) continue;
        if (!obbOverlap(a.x, a.y, a.h, b.x, b.y, b.h, 2.3, 1.0)) continue;
        const [late, early] = a.id > b.id ? [a, b] : [b, a];
        late.v = Math.min(late.v, 0); late.blocked = (late.blocked || 0) + 1;
        if (!late.turn) { late.x -= Math.cos(late.h) * 0.12; late.y -= Math.sin(late.h) * 0.12; }
        if (early.v < 0.3 && late.turn && !early.turn) early.v = Math.max(early.v, 0.6);        // a stopped car that blocks a turn creeps on
      }
    }
  }

  draw() {
    this.separate();
    for (const t of this.types) { for (const m of t.meshes) m.count = 0; t.drawn = []; }
    if (this.shadows) for (const im of this.shadows) im.count = 0;
    const d = new THREE.Object3D();
    const local = new THREE.Matrix4(), out = new THREE.Matrix4(), lightColor = new THREE.Color();
    if (this.policeRed) { this.policeRed.count = 0; this.policeBlue.count = 0; }
    for (const c of this.cars) {
      if (!c.alive) continue;
      if (c.motorcycle) {
        this.drawMotorcycle(c);
        continue;
      }
      c.type.drawn.push(c);
      d.position.set(c.x, (this.ground?.built ? this.ground.h(c.x, c.y) : 0) + 0.03, -c.y); d.rotation.set(0, c.h - Math.PI / 2, 0); d.updateMatrix();
      for (const m of c.type.meshes) {
        const i = m.count++;
        m.setMatrixAt(i, d.matrix);
        if (c.mode === "crashed") {
          const blink = Math.floor(this.t * 3) % 2 === 0, fade = c.crashedT < 1.5 ? c.crashedT / 1.5 : 1;
          m.setColorAt(i, new THREE.Color(blink ? 0xffa525 : 0x423d37).multiplyScalar(fade));
          m.instanceColor.needsUpdate = true;
        } else if (c.pursuit) {
          m.setColorAt(i, new THREE.Color(0x173b57));
          m.instanceColor.needsUpdate = true;
        } else if (m.instanceColor) {
          m.setColorAt(i, new THREE.Color(0xffffff));
          m.instanceColor.needsUpdate = true;
        }
      }
      if (c.pursuit && this.policeRed && !c.motorcycle) {
        const blink = Math.floor(this.t * 4) % 2;
        for (const [mesh, x, color, on] of [[this.policeRed, -0.22, 0xff2638, blink === 0],
          [this.policeBlue, 0.22, 0x36a8ff, blink === 1]]) {
          const i = mesh.count++;
          local.compose(new THREE.Vector3(x * 1.5, 1.42, 0), new THREE.Quaternion(), new THREE.Vector3(3, 2.4, 3));   // big enough to read from a block away
          out.multiplyMatrices(d.matrix, local);
          mesh.setMatrixAt(i, out);
          lightColor.setHex(on ? color : 0x17202a);
          mesh.setColorAt(i, lightColor);
        }
      }
      if (this.shadows) for (const im of this.shadows) im.setMatrixAt(im.count++, d.matrix);
    }
    for (const t of this.types) for (const m of t.meshes) m.instanceMatrix.needsUpdate = true;
    if (this.policeRed) {
      this.policeRed.instanceMatrix.needsUpdate = this.policeBlue.instanceMatrix.needsUpdate = true;
      if (this.policeRed.instanceColor) this.policeRed.instanceColor.needsUpdate = true;
      if (this.policeBlue.instanceColor) this.policeBlue.instanceColor.needsUpdate = true;
    }
    if (this.shadows) for (const im of this.shadows) im.instanceMatrix.needsUpdate = true;
  }

  drawMotorcycle(c) {
    const actor = c.actor;
    if (!actor) return;
    const group = actor.bike.group;
    const ground = this.ground?.built ? this.ground.h(c.x, c.y) : 0;
    group.position.set(c.x, ground + 0.03, -c.y);
    group.rotation.set(0, c.h + Math.PI / 2, 0);
    const delta = c.prevH == null ? 0 : THREE.MathUtils.euclideanModulo(c.h - c.prevH + Math.PI, Math.PI * 2) - Math.PI;
    const steering = THREE.MathUtils.clamp(delta * 1.7, -0.4, 0.4);
    const lean = THREE.MathUtils.clamp(delta * 0.22, -0.28, 0.28);
    this.bikeSystem.pose(actor.bike, c.riderEjected ? 0 : 1, steering, lean);
    actor.avatar?.setFar(this.camera.position.distanceTo(group.position) > 35);
    group.visible = this.camera.position.y < 400 && this.camera.position.distanceTo(group.position) < 260;
    c.prevH = c.h;
  }

  // hop-in: hand a car over to the player (it leaves the traffic simulation)
  take(c) { c.alive = false; this.draw(); return c; }
  carAt(mesh, instanceId) {
    const t = this.types.find(t => t.meshes.includes(mesh));
    return t && instanceId != null ? t.drawn?.[instanceId] || null : null;
  }

  // other systems: where the moving cars are (for bumping into them and for pedestrians to dodge)
  obstacles() { return this.cars.filter(c => c.alive).map(c => [c.x, c.y, c.h, c.v]); }
}
