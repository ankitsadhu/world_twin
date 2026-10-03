// Living street: ambient traffic on the real one-way grid, traffic signals on a green wave, crosswalk phases.
// Cars use the same LOD1 meshes as the props (instanced per car type and part). They live in a ring around the
// camera (spawned out of sight, removed when far), stop at the painted stop bars on red, keep a gap to whatever
// is ahead (other cars, your cab, pedestrians on a crosswalk) and turn onto cross streets that run their way.
// Coordinates: Blender local metres (x, y); avenues run along +y. three.js = (x, z = -y).
import * as THREE from "three";
import { RINGS, ellipseGeometry, ringMaterial } from "./shadow.js";

const NORTHBOUND = new Set([-823, -275, 273]);    // 10th, 8th, 6th Ave (same rule as scripts/blender/scatter_props.py)
const CYCLE = 36;                                   // s: avenue green 0-15, amber -18, all red -19, street green -33, amber -35.5
const WAVE = 1.6;                                   // s per block: avenue greens roll uptown/downtown like the real ones
const V_CRUISE = 11, ACC = 2.4, BRAKE = 4.5, GAP = 6.5;
const TYPES = [["Taxi", 11], ["CarSedanBlack", 3], ["CarSedanWhite", 2], ["CarSUVSilver", 2], ["CarSedanBlue", 1], ["CarSUVRed", 1]];

export class Traffic {
  constructor({ scene, camera, grid, bounds, crowd = () => null, audio = null, count = 45, getCollider = () => null, models = null }) {
    Object.assign(this, { scene, camera, crowd, audio, count, getCollider, models });
    this.avenues = grid.avenues.map(([x, w]) => ({ x, w, dir: NORTHBOUND.has(x) ? 1 : -1 }));
    this.streets = grid.streets.slice().sort((a, b) => a[0] - b[0]).map(([y, w], k) => {
      const no = 37 + k;                                            // 37th St at the south edge of the grid
      return { y, w, k, dir: w >= 15 ? 0 : (no % 2 === 0 ? 1 : -1) }; // 0 = two-way (42nd); even streets eastbound
    });
    this.bounds = bounds;
    this.cars = [];
    this.extra = [];                                                // other movers to respect: your cab
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
    let gap = Infinity;
    const consider = (ox, oy, oh, len = 4.6) => {
      const rx = ox - x, ry = oy - y, along = rx * fx + ry * fy;
      if (along <= 0 || along > 32) return;
      const lat = Math.abs(rx * fy - ry * fx);
      if (lat > 2.1) return;
      if (oh !== null) { let dh = Math.abs(oh - h) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh; if (dh > 2.2) return; }
      gap = Math.min(gap, along - len / 2);
    };
    for (const c of this.cars) if (c !== self && c.alive) consider(c.x, c.y, c.h);
    for (const e of this.extra) if (e !== self && e.alive?.()) { const [ex, ey, eh] = e.pose(); consider(ex, ey, null); }
    const crowd = this.crowd();
    if (crowd) for (const [px, py] of crowd.near(x + fx * 8, y + fy * 8, 10)) consider(px, py, null, 1.2);
    return gap === Infinity ? Infinity : Math.max(0, gap - GAP) * 1.1;
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
    const cap = this.count + 8;
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
    this.initSignals();
    this.ready = true;
    return true;
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
      if (this.extra.some(e => e.alive?.() && Math.hypot(e.pose()[0] - x, e.pose()[1] - y) < 12)) continue;
      this.cars.push({ x, y, h, v: V_CRUISE * 0.7, type: this.pickType(), alive: true, turn: null, blocked: 0, lastCross: null });
      return;
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.ready) return;
    this.t += dt;
    this.updateSignals();
    const cam = this.camera.position, cx = cam.x, cy = -cam.z;
    const want = cam.y > 400 ? 0 : this.count;                      // nobody needs traffic from a plane
    this.cars = this.cars.filter(c => c.alive);
    this.extra = this.extra.filter(e => !e.temp || e.alive());       // parked cars that are gone stop being obstacles
    let n = 0;
    while (this.cars.length < want && n++ < 4) this.spawn(this.cars.length < want * 0.5);
    if (this.cars.length > want) {                                  // the Traffic setting went down: thin out now
      const extra = this.cars.length - want;
      const order = this.cars.filter(c => !c.hailed).sort((a, b) => (this.visible(a.x, a.y) ? 1 : 0) - (this.visible(b.x, b.y) ? 1 : 0));
      for (const c of want === 0 ? order : order.slice(0, Math.min(extra, 3))) { if (want === 0 || !this.visible(c.x, c.y)) c.alive = false; }
      if (want === 0) this.cars = this.cars.filter(c => c.alive);
    }
    for (const c of this.cars) {
      // drive
      const limit = c.hailed ? 0                                     // someone is walking over to get in: wait
        : Math.min(V_CRUISE, this.lightLimit(c.x, c.y, c.h), this.followLimit(c.x, c.y, c.h, c), c.turn ? 6 : Infinity);
      c.v += THREE.MathUtils.clamp(limit - c.v, -BRAKE * 1.6 * dt, ACC * dt);
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
      // honk when stuck behind something that won't move (usually you)
      c.blocked = c.v < 0.3 && limit < 0.5 && this.lightLimit(c.x, c.y, c.h) === Infinity ? c.blocked + dt : 0;
      if (c.blocked > 3.5) { this.audio?.hornAt?.(new THREE.Vector3(c.x, 1, -c.y)); c.blocked = -6; }
      const d = Math.hypot(c.x - cx, c.y - cy);
      if (!c.hailed && (!this.inBounds(c.x, c.y) || (d > 340 && !this.visible(c.x, c.y)))) c.alive = false;
    }
    this.draw();
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

  draw() {
    for (const t of this.types) { for (const m of t.meshes) m.count = 0; t.drawn = []; }
    if (this.shadows) for (const im of this.shadows) im.count = 0;
    const d = new THREE.Object3D();
    for (const c of this.cars) {
      if (!c.alive) continue;
      c.type.drawn.push(c);
      d.position.set(c.x, 0.03, -c.y); d.rotation.set(0, c.h - Math.PI / 2, 0); d.updateMatrix();
      for (const m of c.type.meshes) m.setMatrixAt(m.count++, d.matrix);
      if (this.shadows) for (const im of this.shadows) im.setMatrixAt(im.count++, d.matrix);
    }
    for (const t of this.types) for (const m of t.meshes) m.instanceMatrix.needsUpdate = true;
    if (this.shadows) for (const im of this.shadows) im.instanceMatrix.needsUpdate = true;
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
