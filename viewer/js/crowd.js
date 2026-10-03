// Crowd system: thousands of people as GPU-instanced meshes with shader-driven walk cycles.
// Placement uses a walkability raster (plazas + sidewalks from ground.json) + building collision.
// `setCount(n)` is the single knob: later it can be driven by the live number of visitors.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const REGION = [-600, -520, 620, 580];            // Blender local metres: where crowds live
const SKIN = [0xf1c9a5, 0xd9a07a, 0xb57a52, 0x8a5536, 0x5e3a24, 0xe8b893];
const TOPS = [0x1c1c22, 0xe8e8ea, 0x2b4a7a, 0x8b1e2b, 0x3c5e3a, 0xd9a21b, 0x6b6f78, 0x111111, 0xc75d2c, 0x4b3a6b,
  0x9fb7c9, 0xf2f2f2];
const BOTTOMS = [0x1d2433, 0x2a2a2e, 0x3b4a63, 0x6b5a45, 0x111114, 0x8a8f99];
const HAIR = [0x111111, 0x2b1d14, 0x5a3b22, 0xa77b48, 0x3a3a3a];

// ---------------------------------------------------------------- geometry (Y-up, facing +Z, feet at 0)
// Two levels of detail built from one "person spec" so a person looks the same near and far:
// HI (shaped limbs, face, hair styles, bags, phones) within ~40 m of the camera, LO (a few hundred
// triangles) beyond. Part ids drive the walk cycle: 1/2 = left/right leg, 3/4 = left/right arm.
function part(geo, color, id) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3), pid = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; pid[i] = id; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("part", new THREE.BufferAttribute(pid, 1));
  for (const k of Object.keys(g.attributes)) if (!["position", "normal", "color", "part"].includes(k)) g.deleteAttribute(k);
  return g;
}
const V = (r, y) => new THREE.Vector2(r, y);
const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => V(r, y)), seg);
const sphere = (r, w, h, x, y, z, sx = 1, sy = 1, sz = 1) => { const g = new THREE.SphereGeometry(r, w, h); g.scale(sx, sy, sz); g.translate(x, y, z); return g; };
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

function personSpec(rng, { seated = false, film = false } = {}) {
  return {
    s: 0.92 + rng() * 0.16, seated, film,
    skin: pick(rng, SKIN), top: pick(rng, TOPS), bottom: pick(rng, BOTTOMS), hair: pick(rng, HAIR),
    shoe: rng() < 0.5 ? 0x151515 : 0xeeeeee, coat: !seated && rng() < 0.3, tee: rng() < 0.35,
    skirt: !seated && rng() < 0.15, hairStyle: pick(rng, ["short", "short", "long", "bun", "cap", "beanie", "bald"]),
    hat: pick(rng, TOPS), bag: rng() < 0.22 ? "backpack" : rng() < 0.2 ? "tote" : null, bagCol: pick(rng, TOPS),
  };
}

function buildPerson(p, hi) {
  const parts = [], seg = hi ? 7 : 5, hip = 0.9, tz = p.seated ? 0.5 - hip : 0;
  const add = (g, c, id = 0) => parts.push(part(g, c, id));
  // legs
  if (!p.seated) {
    for (const [sx, id] of [[-0.095, 1], [0.095, 2]]) {
      const leg = hi ? lathe([[0, 0.03], [0.045, 0.05], [0.05, 0.16], [0.06, 0.36], [0.056, 0.48], [0.074, 0.62], [0.088, 0.8], [0.07, 0.9], [0, 0.92]], seg)
        : lathe([[0.05, 0.04], [0.085, 0.9]], seg);
      leg.translate(sx, 0, 0); add(leg, p.skirt && !hi ? p.bottom : (p.skirt ? p.skin : p.bottom), id);
      const shoe = hi ? new THREE.CapsuleGeometry(0.045, 0.16, 3, 8) : new THREE.BoxGeometry(0.1, 0.07, 0.24);
      if (hi) { shoe.rotateX(Math.PI / 2); shoe.scale(1.15, 0.8, 1); shoe.translate(sx, 0.042, 0.045); } else shoe.translate(sx, 0.035, 0.04);
      add(shoe, p.shoe, id);
    }
    if (p.skirt) { const sk = lathe([[0.15, 0.95], [0.21, 0.5]], seg); sk.scale(1, 1, 0.75); add(sk, p.bottom, 0); }
  } else {
    for (const sx of [-0.095, 0.095]) {
      const th = new THREE.CapsuleGeometry(0.075, 0.34, 3, seg); th.rotateX(Math.PI / 2); th.translate(sx, 0.48, 0.21); add(th, p.bottom);
      const sh = new THREE.CapsuleGeometry(0.055, 0.36, 3, seg); sh.translate(sx, 0.25, 0.42); add(sh, p.bottom);
      const shoe = new THREE.BoxGeometry(0.1, 0.07, 0.24); shoe.translate(sx, 0.035, 0.46); add(shoe, p.shoe);
    }
  }
  // hips + torso (+ long coat)
  const pelvis = new THREE.CylinderGeometry(0.17, 0.16, 0.16, seg); pelvis.scale(1, 1, 0.66); pelvis.translate(0, hip + tz, 0);
  add(pelvis, p.bottom);
  const torso = hi ? lathe([[0, hip - 0.02], [0.155, hip], [0.15, 1.05], [0.175, 1.25], [0.2, 1.4], [0.16, 1.48], [0.06, 1.52], [0, 1.52]], seg + 3)
    : lathe([[0.16, hip], [0.19, 1.45], [0.05, 1.5]], seg);
  torso.scale(1, 1, 0.6); torso.translate(0, tz, 0); add(torso, p.top);
  if (p.coat) { const c = lathe([[0.21, 1.2], [0.23, 0.55]], seg); c.scale(1, 1, 0.66); add(c, p.top); }
  if (hi && !p.tee && !p.coat) { const col = new THREE.TorusGeometry(0.075, 0.018, 4, 10); col.rotateX(Math.PI / 2); col.translate(0, 1.5 + tz, 0); add(col, 0xf2f2f2); }
  // arms (the filming pose holds a phone up in front of the face)
  for (const [sx, id] of [[-0.215, 3], [0.215, 4]]) {
    const filmArm = p.film && id === 4;
    const sleeve = p.tee ? p.skin : p.top;
    if (hi) add(sphere(0.062, 8, 6, sx, 1.4 + tz, 0), p.top, id);
    if (filmArm) {
      const up = new THREE.CapsuleGeometry(0.045, 0.24, 3, seg); up.rotateX(-1.2); up.translate(sx - 0.02, 1.33 + tz, 0.13); add(up, p.top, 0);
      const fo = new THREE.CapsuleGeometry(0.038, 0.22, 3, seg); fo.rotateX(-0.35); fo.rotateZ(0.5); fo.translate(sx - 0.1, 1.43 + tz, 0.3); add(fo, sleeve, 0);
      add(sphere(0.04, 6, 5, 0.08, 1.56 + tz, 0.35, 1, 1.3, 0.8), p.skin, 0);
      const phone = new THREE.BoxGeometry(0.075, 0.15, 0.012); phone.translate(0.08, 1.6 + tz, 0.37); add(phone, 0x1a1a1e, 0);
      continue;
    }
    const upper = hi ? lathe([[0, 1.43], [0.052, 1.4], [0.048, 1.15], [0.04, 1.12], [0, 1.1]], seg) : lathe([[0.055, 1.44], [0.04, 0.82]], seg);
    upper.translate(sx, tz, 0); add(upper, p.top, id);
    if (hi) { const fore = lathe([[0, 1.15], [0.041, 1.12], [0.033, 0.88], [0, 0.86]], seg); fore.translate(sx, tz, 0.02); add(fore, sleeve, id); }
    add(hi ? sphere(0.04, 6, 5, sx, 0.82 + tz, 0.025, 0.9, 1.4, 0.75) : sphere(0.045, 4, 3, sx, 0.8 + tz, 0), p.skin, id);
    if (p.bag === "tote" && id === 3) { const t = new THREE.BoxGeometry(0.3, 0.32, 0.1); t.translate(sx - 0.03, 0.6 + tz, 0.02); add(t, p.bagCol, id); }
  }
  // neck, head, face
  const neck = new THREE.CylinderGeometry(0.048, 0.052, 0.12, hi ? 8 : 4); neck.translate(0, 1.55 + tz, 0); add(neck, p.skin);
  add(sphere(0.1, hi ? 12 : 6, hi ? 9 : 4, 0, 1.665 + tz, 0.008, 0.88, 1.1, 1), p.skin);
  if (hi) {
    add(sphere(0.07, 10, 6, 0, 1.6 + tz, 0.025, 0.95, 0.8, 0.95), p.skin);                    // jaw
    const nose = new THREE.ConeGeometry(0.016, 0.04, 5); nose.rotateX(Math.PI / 2); nose.translate(0, 1.655 + tz, 0.105); add(nose, p.skin);
    for (const sx of [-1, 1]) {
      add(sphere(0.022, 6, 4, sx * 0.088, 1.66 + tz, 0, 0.5, 1, 0.8), p.skin);              // ears
      add(sphere(0.012, 6, 4, sx * 0.034, 1.685 + tz, 0.088), 0x16110e);                      // eyes
      const brow = new THREE.BoxGeometry(0.032, 0.007, 0.01); brow.translate(sx * 0.035, 1.705 + tz, 0.092); add(brow, p.hair);
    }
    const mouth = new THREE.BoxGeometry(0.035, 0.006, 0.01); mouth.translate(0, 1.615 + tz, 0.093); add(mouth, 0x7a3b33);
  }
  // hair / hats
  const capG = (r, open) => { const g = new THREE.SphereGeometry(r, hi ? 11 : 6, hi ? 5 : 3, 0, Math.PI * 2, 0, Math.PI * open); g.rotateX(-0.25); g.translate(0, 1.672 + tz, -0.006); return g; };
  if (p.hairStyle !== "bald") {
    if (p.hairStyle === "cap") {
      add(capG(0.108, 0.45), p.hat);
      if (hi) { const brim = new THREE.CylinderGeometry(0.07, 0.07, 0.01, 10, 1, false, -Math.PI / 2, Math.PI); brim.scale(1, 1, 1.3); brim.translate(0, 1.73 + tz, 0.08); add(brim, p.hat); }
    } else if (p.hairStyle === "beanie") add(capG(0.112, 0.52), p.hat);
    else {
      add(capG(0.107, p.hairStyle === "long" ? 0.6 : 0.47), p.hair);
      if (hi && p.hairStyle === "long") { const back = new THREE.CapsuleGeometry(0.075, 0.16, 3, 8); back.scale(1.2, 1, 0.6); back.translate(0, 1.56 + tz, -0.06); add(back, p.hair); }
      if (hi && p.hairStyle === "bun") add(sphere(0.045, 8, 6, 0, 1.76 + tz, -0.07), p.hair);
    }
  }
  if (p.bag === "backpack") {
    const bag = hi ? new THREE.CapsuleGeometry(0.11, 0.16, 3, 8) : new THREE.BoxGeometry(0.26, 0.34, 0.12);
    if (hi) bag.scale(1.15, 1, 0.55); bag.translate(0, 1.2 + tz, -0.16); add(bag, p.bagCol);
  }
  const g = mergeGeometries(parts);
  g.scale(p.s, p.s, p.s);
  return g;
}

// ---------------------------------------------------------------- material with walk-cycle vertex shader
function crowdMaterial(uniforms) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute float part; attribute float aPhase; attribute float aSpeed; uniform float uTime;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        if (aSpeed > 0.0 && part > 0.5) {
          float sw = sin(uTime * aSpeed * 5.2 + aPhase);
          bool leg = part < 2.5;
          float side = (part == 1.0 || part == 4.0) ? 1.0 : -1.0;   // left leg swings with right arm
          float ang = sw * side * (leg ? 0.42 : -0.32);
          float pivot = leg ? 0.86 : 1.42;
          float y = transformed.y - pivot, z = transformed.z;
          transformed.y = pivot + y * cos(ang) - z * sin(ang);
          transformed.z = y * sin(ang) + z * cos(ang);
        }
        if (aSpeed > 0.0) transformed.y += abs(sin(uTime * aSpeed * 5.2 + aPhase)) * 0.03;`);
  };
  return m;
}

// ---------------------------------------------------------------- walkability raster (1 px = 1 m)
function rasterize(ground, crosswalks = []) {
  const [x0, y0, x1, y1] = REGION, W = x1 - x0, H = y1 - y0;
  const cv = new OffscreenCanvas(W, H), cx = cv.getContext("2d");
  cx.fillStyle = "#000"; cx.fillRect(0, 0, W, H);
  const draw = (polys, col) => {
    cx.fillStyle = col;
    for (const p of polys) {
      cx.beginPath();
      for (const ring of [p.exterior, ...(p.holes || [])]) {
        ring.forEach(([x, y], i) => i ? cx.lineTo(x - x0, y1 - y) : cx.moveTo(x - x0, y1 - y));
        cx.closePath();
      }
      cx.fill("evenodd");
    }
  };
  draw(ground.sidewalk, "rgb(1,0,0)");
  draw(ground.plazas, "rgb(2,0,0)");
  const px = cx.getImageData(0, 0, W, H).data;
  const grid = new Uint8Array(W * H), xw = new Int16Array(W * H).fill(-1);
  for (let i = 0; i < W * H; i++) grid[i] = px[i * 4];
  // crosswalks (3): walkable only on the walk phase; remember which crosswalk each cell belongs to
  crosswalks.forEach((c, id) => {
    for (let y = Math.floor(c.y0); y < c.y1; y++) for (let x = Math.floor(c.x0); x < c.x1; x++) {
      const u = Math.floor(x - x0), v = Math.floor(y1 - y);
      if (u < 0 || v < 0 || u >= W || v >= H || grid[v * W + u]) continue;      // never over sidewalk / plaza
      grid[v * W + u] = 3; xw[v * W + u] = id;
    }
  });
  const idx = (x, y) => { const u = Math.floor(x - x0), v = Math.floor(y1 - y); return u < 0 || v < 0 || u >= W || v >= H ? -1 : v * W + u; };
  return {
    at(x, y) { const i = idx(x, y); return i < 0 ? 0 : grid[i]; },
    crosswalkAt(x, y) { const i = idx(x, y); return i < 0 || xw[i] < 0 ? null : crosswalks[xw[i]]; },
    W, H, grid,
  };
}

// ---------------------------------------------------------------- the crowd
const NEAR = 30;                                   // metres: inside this, people get the detailed body
export class Crowd {
  constructor(scene, ground, collider, { variants = 14, filmVariants = 4, seatedVariants = 4, maxPeople = 4000, seated = [], camera = null,
    traffic = null, movers = () => [] } = {}) {
    // traffic: signal phases + crosswalks (people wait at the curb, cross on the walk phase); movers: [x, y, h, v] of
    // cars (and your cab) that people step out of the way of
    this.scene = scene; this.collider = collider; this.camera = camera; this.traffic = traffic; this.movers = movers;
    this.walk = rasterize(ground, traffic ? traffic.crosswalks() : []);
    this.uniforms = { uTime: { value: 0 } };
    this.material = crowdMaterial(this.uniforms);
    let seed = 7; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    this.rng = rng; this.dummy = new THREE.Object3D(); this.all = [];
    const make = (spec, cap) => {
      const v = {};
      for (const lod of ["hi", "lo"]) {
        const m = new THREE.InstancedMesh(buildPerson(spec, lod === "hi"), this.material, cap);
        m.geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
        m.geometry.setAttribute("aSpeed", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false; m.count = 0; m.userData.crowd = true;   // walkable-through (no collision)
        scene.add(m); this.all.push(m); v[lod] = m;
      }
      v.cap = cap; v.used = 0; return v;
    };
    this.walkers = Array.from({ length: variants }, () => make(personSpec(rng), Math.ceil(maxPeople / variants) + 20));
    this.filmers = Array.from({ length: filmVariants }, () => make(personSpec(rng, { film: true }), 250));
    this.sitters = Array.from({ length: seatedVariants }, () => make(personSpec(rng, { seated: true }), Math.ceil(seated.length / seatedVariants) + 2));
    this.seated = seated.map(([x, y, z, yaw], i) => ({ x, y, z, yaw, speed: 0, phase: 0, v: this.sitters[i % seatedVariants] }));
    this.agents = []; this.seatN = 0;
  }

  // spawn point weighted toward the bowtie plazas (where real crowds are)
  sample() {
    const [x0, y0, x1, y1] = REGION;
    for (let t = 0; t < 60; t++) {
      const bowtie = this.rng() < 0.55;
      const x = bowtie ? (this.rng() - 0.5) * 140 - 10 : x0 + this.rng() * (x1 - x0);
      const y = bowtie ? -260 + this.rng() * 420 : y0 + this.rng() * (y1 - y0);
      const k = this.walk.at(x, y);
      if ((k === 1 || k === 2) && !this.collider.blocked(x, y, 0.3, 0)) return [x, y, k];
    }
    return null;
  }

  setCount(n) {
    n = Math.min(n, this.walkers.length * (this.walkers[0].cap - 20));
    while (this.agents.length < n) {
      const p = this.sample(); if (!p) break;
      const [x, y, k] = p;
      const standing = k === 2 ? this.rng() < 0.45 : this.rng() < 0.12;   // plazas: people stop, film, chat
      const axis = this.rng() < 0.5;
      const dir = standing ? this.rng() * Math.PI * 2 : (axis ? 0 : Math.PI / 2) + (this.rng() < 0.5 ? 0 : Math.PI)
        + (k === 2 ? (this.rng() - 0.5) * 1.6 : 0);
      let v = this.walkers[this.agents.length % this.walkers.length];
      if (standing && k === 2 && this.rng() < 0.4) {                       // Times Square: everybody films the screens
        const f = this.filmers[Math.floor(this.rng() * this.filmers.length)];
        if (f.used < f.cap) v = f;
      }
      v.used++;
      this.agents.push({ x, y, dir, v, speed: standing ? 0 : 1.1 + this.rng() * 0.5, phase: this.rng() * 6.28, turnT: this.rng() * 8 });
    }
    while (this.agents.length > n) this.agents.pop().v.used--;
    this.seatN = Math.floor(this.seated.length * Math.min(1, n / 1500));
    this.update(0);
  }

  nearAgents(x, y, r) {
    const out = [], cell = 10;
    if (!this.index) return out;
    for (let cx = Math.floor((x - r) / cell); cx <= Math.floor((x + r) / cell); cx++)
      for (let cy = Math.floor((y - r) / cell); cy <= Math.floor((y + r) / cell); cy++)
        for (const a of this.index.get(cx + "," + cy) || []) if (Math.abs(a.x - x) < r && Math.abs(a.y - y) < r) out.push(a);
    return out;
  }
  // people standing in the roadway (on a crosswalk), for cars to yield to
  near(x, y, r) { return this.nearAgents(x, y, r).filter(a => this.walk.at(a.x, a.y) === 3).map(a => [a.x, a.y]); }

  update(dt) {
    this.uniforms.uTime.value += dt;
    const d = this.dummy, cam = this.camera?.position, aerial = !cam || cam.y > 80;
    for (const m of this.all) m.count = 0;
    const put = (a, x, h, z, yaw) => {
      const near = !aerial && (x - cam.x) ** 2 + (z - cam.z) ** 2 < NEAR * NEAR;
      const m = near ? a.v.hi : a.v.lo, i = m.count++;
      d.position.set(x, h, z); d.rotation.set(0, yaw, 0); d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      m.geometry.attributes.aPhase.array[i] = a.phase; m.geometry.attributes.aSpeed.array[i] = a.waiting ? 0 : a.speed;
    };
    // spatial index (10 m cells) for "who is near" queries: cars yielding to people, people dodging cars
    const cell = 10, grid = this.index = new Map();
    for (const a of this.agents) { const k = Math.floor(a.x / cell) + "," + Math.floor(a.y / cell); (grid.get(k) || grid.set(k, []).get(k)).push(a); }
    // people step out of the way of anything driving at them (no one gets hurt in this city)
    if (dt > 0) for (const [mx, my, mh, mv] of this.movers()) {
      if (Math.abs(mv) < 0.8) continue;
      const fx = Math.cos(mh) * Math.sign(mv), fy = Math.sin(mh) * Math.sign(mv);
      for (const a of this.nearAgents(mx + fx * 4, my + fy * 4, 7)) {
        const rx = a.x - mx, ry = a.y - my, along = rx * fx + ry * fy, lat = rx * fy - ry * fx;
        if (along < -1 || along > 4 + Math.abs(mv) * 0.8 || Math.abs(lat) > 2.2) continue;
        const side = lat >= 0 ? 1 : -1, step = 4.5 * dt;             // quick sidestep, then carry on
        const nx = a.x + fy * side * step, ny = a.y - fx * side * step;
        if (!this.collider.blocked(nx, ny, 0.3, 0)) { a.x = nx; a.y = ny; a.startled = 1.2; }
      }
    }
    for (const a of this.agents) {
      a.waiting = false;
      if (a.startled) a.startled = Math.max(0, a.startled - dt);
      if (a.speed > 0 && dt > 0) {
        a.turnT -= dt;
        const sp = a.speed * (a.startled ? 1.8 : 1);
        const nx = a.x + Math.cos(a.dir) * sp * dt, ny = a.y + Math.sin(a.dir) * sp * dt;
        const next = this.walk.at(nx, ny);
        let ok = next === 1 || next === 2;
        if (next === 3) {                                            // a crosswalk: keep going if already on it, else obey the light
          const xw = this.walk.crosswalkAt(nx, ny);
          ok = this.walk.at(a.x, a.y) === 3 || !this.traffic || (xw && this.traffic.canCross(xw.kind, xw.k));
          if (!ok && (a.waitT = (a.waitT || 0) + dt) < 45) { a.waiting = true; ok = null; }   // wait at the curb
        }
        if (ok === null) { /* waiting for the walk signal */ }
        else if (!ok || this.collider.blocked(nx, ny, 0.3, 0) || (a.turnT < 0 && this.walk.at(a.x, a.y) !== 3)) {
          // at curbs / walls: turn (mostly reverse, sometimes a 90 degree corner turn)
          a.dir += this.rng() < 0.6 ? Math.PI : (this.rng() < 0.5 ? 1 : -1) * Math.PI / 2;
          a.turnT = 6 + this.rng() * 20; a.waitT = 0;
        } else { a.x = nx; a.y = ny; a.waitT = 0; }
      }
      // Blender heading (cos, sin) -> three forward (cos, -sin); model faces +Z
      put(a, a.x, 0.15, -a.y, Math.atan2(Math.cos(a.dir), -Math.sin(a.dir)));
    }
    for (let i = 0; i < this.seatN; i++) { const s = this.seated[i]; put(s, s.x, s.z, -s.y, s.yaw); }
    for (const m of this.all) {
      if (!m.count) continue;
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.aPhase.needsUpdate = true; m.geometry.attributes.aSpeed.needsUpdate = true;
    }
  }
}

// TKTS red steps: seats on the treads, facing south toward One Times Square (Blender local metres)
export function tktsSeats(rngSeed = 3) {
  let seed = rngSeed; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const CX = -20.6, Y0 = 121.5, RISE = 0.18, TREAD = 0.62, W = 15, G = 0.16, out = [];
  for (let k = 1; k < 27; k += 1) {
    for (let x = CX - W / 2 + 0.5; x < CX + W / 2 - 0.4; x += 0.55 + rng() * 0.9) {
      if (rng() < 0.45 || Math.abs(x - (CX - W / 6)) < 0.4 || Math.abs(x - (CX + W / 6)) < 0.4) continue;
      // thighs rest on tread k, feet two treads down; yaw 0 = model +Z = Blender -Y = facing south
      out.push([x, Y0 + k * TREAD + 0.25, G + k * RISE - 0.405, (rng() - 0.5) * 0.5]);
    }
  }
  return out;
}
