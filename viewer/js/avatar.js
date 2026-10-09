// People with real bodies: the realistic characters (export/characters/*.glb, Mixamo 19-bone rig, facing +Z here) as
// YOUR walker in third person, as NPCs strolling Times Square, and later as the other players in a multiplayer session.
// One Avatar class for all three: give it a position, a heading and a speed each frame and it idles, walks or runs.
// The gait is procedural (no baked clips needed): rotations about the body's own axes, layered on the rig's
// arms-down pose, with stride length and cadence that follow the speed (a real walk is ~1.4 m/s, a jog ~3.5 m/s).
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { makeBlob } from "./shadow.js";

export const CHARACTERS = [
  { id: "leather", label: "Black top & leather", url: "export/characters/woman_leather.glb" },
  { id: "jeans", label: "White tee & jeans", url: "export/characters/woman_jeans.glb" },
  { id: "red_dress", label: "Red dress", url: "export/characters/woman_red_dress.glb" },
  { id: "jeans_hotpants", label: "White tee & denim hot pants", url: "export/characters/woman_jeans_hotpants.glb" },
  { id: "leather_shorts", label: "Black top & leather shorts", url: "export/characters/woman_leather_shorts.glb" },
  { id: "mei", label: "Linen summer dress", url: "export/characters/woman_mei.glb" },
  // the first man: same rig and poses (scaled x1.10 at export), grey tee + jeans (their colours vary per person).
  // weight: how often he is picked among the NPCs (a street is not 1 man in 7)
  { id: "daniel", label: "Grey tee & jeans", url: "export/characters/man_daniel.glb", weight: 2 },
];
export const PLAYER = "leather";                  // the best-looking one is you...
export const PLAYER_OUTFITS = ["leather", "leather_shorts"];   // ...in her trousers or her shorts (Settings > Outfit)
// everyone else in the city: every character and outfit except the one you're wearing (so your other outfit shows up)
export const npcPool = playerId => CHARACTERS.filter(c => c.id !== playerId).flatMap(c => Array(c.weight || 1).fill(c.id));
// clothing colours people really wear, per cloth material (multiplied over the texture: white cloth takes them fully)
const TINTS = {
  M_Dress: [0xffffff, 0x1a1a1f, 0x1f3a6e, 0x0f5a3c, 0xf2d7c9, 0x7a1630, 0xe8e2d4],                 // red, black, navy...
  M_Top: [0xffffff, 0xffffff, 0x222226, 0xf3c6d3, 0xbcd6ee, 0xe9dfc7, 0xc9e3c1, 0xffe08a],             // tees and tops
  M_Denim: [0xffffff, 0xd6e2f2, 0x8fa6c9, 0x4a5568, 0x2b2b33],                                       // light to black denim
};
const D = THREE.MathUtils.degToRad;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const noRay = () => {};                                   // never in the way of ground probes / clicks (like the crowd)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const cache = new Map();
function loadModel(loader, root, id, far = false) {
  const c = CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
  const url = far ? c.url.replace(/\.glb$/, "_far.glb") : c.url;
  if (!cache.has(url)) cache.set(url, loader.loadAsync(root + url));
  return cache.get(url);
}
function prepMaterial(m) {
  if (m.userData.prepped) return;
  m.userData.prepped = true;
  if (m.name === "M_Hair" || m.transparent) { m.transparent = false; m.alphaTest = 0.45; m.depthWrite = true; }
  m.side = THREE.DoubleSide;       // the body under clothes is cut away (MakeHuman): a fold must show cloth, not the street
}

export class Avatar {
  // opts.far: also load the far version (~12k tris) and swap to it beyond ~35 m; opts.rng: pick clothing colours
  static async create(loader, root, id, opts = {}) {
    const [g, f] = await Promise.all([loadModel(loader, root, id), opts.far ? loadModel(loader, root, id, true) : null]);
    return new Avatar(g, id, f, opts.rng);
  }

  constructor(gltf, id, farGltf = null, rng = null) {
    this.id = id;
    this.object = new THREE.Group();
    const model = cloneSkinned(gltf.scene);
    this.object.add(model);
    const tinted = new Map();                               // this person's own clothing colours
    const dress = m => {
      prepMaterial(m);
      const pal = rng && TINTS[m.name];
      if (!pal) return m;
      if (!tinted.has(m.name)) {
        const c = m.clone(); c.userData.prepped = true;
        c.color.multiply(new THREE.Color(pal[Math.floor(rng() * pal.length)]));
        tinted.set(m.name, c);
      }
      return tinted.get(m.name);
    };
    this.near = []; this.far = [];
    model.traverse(o => {
      if (!o.isMesh) return;
      o.raycast = noRay; o.castShadow = true; o.frustumCulled = false;   // skinned bounds don't follow the pose
      o.material = Array.isArray(o.material) ? o.material.map(dress) : dress(o.material);
      this.near.push(o);
    });
    // the base pose: the rig's arms-down pose (its rest pose is an A-pose)
    const clip = gltf.animations.find(a => /ArmsDown/.test(a.name));
    if (clip) { const mx = new THREE.AnimationMixer(model); mx.clipAction(clip).play(); mx.update(0); }   // (stopping it would put the A-pose back)
    model.updateMatrixWorld(true);
    this.bones = {};
    const inv = new THREE.Quaternion(), pq = new THREE.Quaternion();
    model.traverse(o => {
      if (!o.isBone) return;
      o.parent.getWorldQuaternion(pq); inv.copy(pq).invert();
      this.bones[o.name] = { b: o, base: o.quaternion.clone(), pos: o.position.clone(),
        x: X.clone().applyQuaternion(inv), y: Y.clone().applyQuaternion(inv), z: Z.clone().applyQuaternion(inv) };   // the body's axes, in the bone's parent
    });
    const hips = this.bones.Hips;
    if (hips) {                                            // "up" in the hips' parent space (for the step bounce)
      const p = hips.b.parent, a = p.worldToLocal(new THREE.Vector3(0, 0, 0)), b = p.worldToLocal(new THREE.Vector3(0, 1, 0));
      hips.up = b.sub(a);
    }
    // the far version: its meshes bound to THIS skeleton (same rig, same bone names), so one pose drives both
    if (farGltf) farGltf.scene.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const bones = o.skeleton.bones.map(b => this.bones[b.name]?.b);
      if (bones.some(b => !b)) return;
      const sm = new THREE.SkinnedMesh(o.geometry, Array.isArray(o.material) ? o.material.map(dress) : dress(o.material));
      sm.bind(new THREE.Skeleton(bones, o.skeleton.boneInverses), o.bindMatrix);
      sm.raycast = noRay; sm.frustumCulled = false; sm.visible = false;
      this.near[0].parent.add(sm);
      this.far.push(sm);
    });
    this.lodFar = false;
    this.shadow = makeBlob(0.75, 0.6);                      // contact shadow: stays on the ground when you jump
    this.object.add(this.shadow);
    this.phase = 0; this.speed = 0; this.t = Math.random() * 10; this.heading = 0;
    this._q = new THREE.Quaternion(); this._r = new THREE.Quaternion();
    this.pose(0);
  }

  setFar(far) {
    if (far === this.lodFar || !this.far.length) return;
    this.lodFar = far;
    for (const m of this.near) m.visible = !far && !m.userData.hide;
    for (const m of this.far) m.visible = far && !m.userData.hide;
  }

  // Accessories (export/characters/acc_<kind>__<id>.glb: the rig + only the accessory, skinned to the same 19 bones):
  // rebound to THIS skeleton by bone name, so they follow every pose (walk, run, riding). "cap" swaps the hair for HAIR_CAP,
  // which is her hair cut just under the rim, so nothing pokes through. kind: sunglasses_aviator | cap_baseball | jacket_denim
  static accCache = new Map();
  static ACC_TINT = { M_Jacket: [0.30, 0.42, 0.62], M_Cap: [0.10, 0.14, 0.30] };      // the colours of the artist's renders
  async wear(loader, root, kind, on) {
    this.acc ||= {};
    if (on && !this.acc[kind]) {
      const base = { leather_shorts: "leather", jeans_hotpants: "jeans" }[this.id] || this.id;
      const url = `${root}export/characters/acc_${kind}__${base}.glb`;
      if (!Avatar.accCache.has(url)) Avatar.accCache.set(url, loader.loadAsync(url).catch(() => null));   // one load per file, shared
      const g = await Avatar.accCache.get(url);
      if (!g) return;
      const made = [], parent = this.near[0].parent;
      g.scene.traverse(o => {
        if (!o.isSkinnedMesh) return;
        const bones = o.skeleton.bones.map(b => this.bones[b.name]?.b);
        if (bones.some(b => !b)) return;
        const mats = [].concat(o.material).map(m => {
          const c = m.clone(); prepMaterial(c);
          if (/Lens/.test(c.name)) { c.transparent = true; c.depthWrite = false; }
          const t = Avatar.ACC_TINT[c.name]; if (t) c.color.multiply(new THREE.Color().setRGB(...t));
          return c;
        });
        const sm = new THREE.SkinnedMesh(o.geometry, Array.isArray(o.material) ? mats : mats[0]);
        sm.bind(new THREE.Skeleton(bones, o.skeleton.boneInverses), o.bindMatrix);
        sm.name = o.name; sm.raycast = noRay; sm.frustumCulled = false; sm.castShadow = true;
        parent.add(sm); made.push(sm); this.near.push(sm);
      });
      this.acc[kind] = made;
    }
    for (const m of this.acc[kind] || []) m.userData.hide = !on;
    if (kind === "cap_baseball") for (const m of [...this.near, ...this.far]) if (m.name === "HAIR") m.userData.hide = on;   // hair under the cap: HAIR_CAP
    for (const m of this.near) m.visible = !this.lodFar && !m.userData.hide;
    for (const m of this.far) m.visible = this.lodFar && !m.userData.hide;
  }

  // place in three.js space: feet at (x, y, z), facing heading (radians, 0 = +Z), moving at speed m/s
  set(x, y, z, heading, speed, air = 0) {
    this.object.position.set(x, y, z);
    this.heading = heading; this.object.rotation.y = heading;
    this.speed = speed;
    if (this.air > 0.05 && air === 0) this.landT = 0.25;   // touch-down: knees give for a moment
    this.air = air;
    this.shadow.position.y = -air;                          // on the ground under you, smaller and lighter in the air
    this.shadow.scale.setScalar(Math.max(0.55, 1 - air * 0.5));
  }

  rot(name, ...turns) {                                    // base pose, then [axis, degrees] turns about the body's axes
    const B = this.bones[name];
    if (!B) return;
    const q = this._q.identity();
    for (const [ax, deg] of turns) if (deg) q.premultiply(this._r.setFromAxisAngle(B[ax], D(deg)));
    B.b.quaternion.copy(q).multiply(B.base);
  }

  // on a motorcycle: the rig's own "Pose_Ride" (ride_pose_woman / _man.glb), authored in the bike's frame (hips on the
  // seat, hands on the grips, feet on the pegs): the absolute local pose of every bone it keys, sampled at its first key
  setRide(clip) {
    if (!clip) { this.ridePose = null; this.contact(true); return; }
    const pose = {};
    for (const t of clip.tracks) {
      const [bone, prop] = t.name.split(".");
      (pose[bone] ||= {})[prop] = Array.from(t.values.slice(0, prop === "quaternion" ? 4 : 3));
    }
    this.ridePose = pose;
    this.contact(false);
    this.pose(0);
  }
  contact(on) { this.shadow.visible = on; }                // the bike has its own contact shadow

  update(dt) {
    const v = this.speed;
    const run = sstep(2.4, 3.6, v), move = sstep(0.05, 0.7, v);
    const stride = THREE.MathUtils.lerp(1.45, 2.6, run);   // metres per full cycle (two steps)
    this.phase = (this.phase + (v > 0.05 ? v / stride : 0) * Math.PI * 2 * dt) % (Math.PI * 200);
    this.t += dt;
    this.jb = (this.jb || 0) + ((this.air > 0.02 ? 1 : 0) - (this.jb || 0)) * Math.min(1, dt * 14);
    this.landT = Math.max(0, (this.landT || 0) - dt);
    this.pose(dt, move * (1 - this.jb), run);
  }

  pose(dt, m = 0, r = 0) {
    if (this.ridePose) {
      for (const [name, P] of Object.entries(this.ridePose)) {
        const B = this.bones[name];
        if (!B) continue;
        if (P.quaternion) B.b.quaternion.fromArray(P.quaternion);
        if (P.position) B.b.position.fromArray(P.position);
      }
      return;
    }
    const t = this.phase, s = Math.sin(t), c = Math.cos(t), L = THREE.MathUtils.lerp;
    const thigh = L(20, 36, r) * m, knee = L(52, 100, r) * m, arm = L(17, 34, r) * m;
    const idle = 1 - m, br = Math.sin(this.t * 1.7) * 0.8 * idle;              // breathing, standing still
    const sway = Math.sin(this.t * 0.35) * 2.2 * idle;                         // weight shift from foot to foot
    const j = this.jb || 0, land = Math.sin(Math.min(1, (this.landT || 0) / 0.25) * Math.PI);   // airborne / landing
    for (const [side, ph] of [["Left", 0], ["Right", Math.PI]]) {
      const ss = Math.sin(t + ph), cc = Math.cos(t + ph);
      this.rot(side + "UpLeg", ["x", -thigh * ss - 6 * r * m - (side === "Left" ? 34 : 18) * j - 22 * land]);   // tuck, one leg leads
      this.rot(side + "Leg", ["x", (L(6, 14, r) * m + knee * Math.max(0, cc) ** 1.4) + 2 * idle + (side === "Left" ? 55 : 40) * j + 40 * land]);
      this.rot(side + "Foot", ["x", -8 * Math.max(0, cc) * m + 6 * Math.max(0, -cc) * m * (1 - r) + 12 * j - 18 * land]);
      this.rot(side + "Arm", ["x", arm * ss - 35 * j], ["z", (side === "Left" ? 1 : -1) * 18 * j]);   // arms up and out for balance
      this.rot(side + "ForeArm", ["x", -(L(10, 80, r) * m + 6 + 10 * Math.max(0, -ss) * m)]);
    }
    const lean = L(3, 11, r) * m;
    this.rot("Hips", ["y", -4 * s * m], ["z", sway * 0.5]);
    this.rot("Spine", ["x", lean * 0.5 + br]);
    this.rot("Spine1", ["x", lean * 0.5 + br * 0.6], ["y", L(5, 9, r) * s * m]);
    this.rot("Neck", ["x", -lean * 0.4]);
    this.rot("Head", ["x", -lean * 0.4], ["y", Math.sin(this.t * 0.23) * 9 * idle]);
    const H = this.bones.Hips;
    if (H?.up) H.b.position.copy(H.pos).addScaledVector(H.up, -L(0.025, 0.06, r) * m * s * s + 0.012 * m - 0.09 * land);
  }
}

// ---------------------------------------------------------------- NPCs: the city's people
// Every character and outfit except yours, each person in their own clothing colours. They wander between random spots
// on the plazas / sidewalks (the crowd's walkability raster, weighted to the bowtie), only along straight lines that stay
// walkable, and pause a while (look at the screens). Cost control: off-screen or beyond 300 m they aren't drawn or posed,
// beyond 35 m they wear the far version and are posed every other frame.
const NEAR_M = 35, DRAW_M = 300;
export class Npcs {
  // movers(): cars as [x, y, heading, speed]; player(): your feet [x, y] or null
  constructor({ loader, root, scene, camera, crowd, collider, groundAt, playerId, count = 24, movers = () => [], player = () => null }) {
    Object.assign(this, { loader, root, scene, camera, crowd, collider, groundAt, playerId, movers, player });
    this.list = [];
    let seed = 11; this.rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    this.frustum = new THREE.Frustum(); this.m4 = new THREE.Matrix4(); this.sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    this.frame = 0; this.want = 0;
    this.setCount(count);
  }

  // add or remove people (the People slider); spawning is async (models load once, then clone)
  async setCount(n) {
    this.want = n;
    while (this.list.length > this.want) this.scene.remove(this.list.pop().a.object);
    if (this.spawning) return;
    this.spawning = true;
    const pool = npcPool(this.playerId);
    while (this.list.length < this.want) {
      // three in four on the bowtie (Broadway / 7th Ave, 42nd-47th St: where the crowds really are), the rest nearby
      const p = this.rng() < 0.75 ? this.sampleRect(-80, -250, 60, 155) : this.sample(-10, -40, 320);
      if (!p) break;
      const id = pool[Math.floor(this.rng() * pool.length)];
      const a = await Avatar.create(this.loader, this.root, id, { far: true, rng: this.rng }).catch(() => null);
      if (!a || this.list.length >= this.want) break;
      this.scene.add(a.object);
      if (this.rng() < 0.25) a.wear(this.loader, this.root, "sunglasses_aviator", true);   // a quarter of the street wears shades
      this.list.push({ a, x: p[0], y: p[1], h: this.rng() * 6.28, target: null, wait: this.rng() * 6,
        sp: 1.1 + this.rng() * 0.45, v: 0 });
    }
    this.spawning = false;
    if (this.list.length !== this.want) this.setCount(this.want);
  }

  // you changed outfit: nobody else may wear it (they're replaced by someone from the new pool)
  setPlayer(id) {
    if (id === this.playerId) return;
    this.playerId = id;
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].a.id === id) this.scene.remove(this.list.splice(i, 1)[0].a.object);
    this.setCount(this.want);
  }

  sampleRect(x0, y0, x1, y1) {
    for (let k = 0; k < 60; k++) {
      const x = x0 + this.rng() * (x1 - x0), y = y0 + this.rng() * (y1 - y0), w = this.crowd?.walk.at(x, y);
      if ((w === 1 || w === 2) && !this.collider?.blocked(x, y, 0.4, 0.5)) return [x, y];
    }
    return null;
  }

  sample(cx, cy, r) {
    for (let k = 0; k < 40; k++) {
      const x = cx + (this.rng() - 0.5) * 2 * r, y = cy + (this.rng() - 0.5) * 2 * r;
      const w = this.crowd?.walk.at(x, y);
      if ((w === 1 || w === 2) && !this.collider?.blocked(x, y, 0.4, 0.5)) return [x, y];
    }
    return null;
  }

  clearPath(x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 1; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n, w = this.crowd.walk.at(x, y);
      if (!(w === 1 || w === 2) || this.collider?.blocked(x, y, 0.35, 0.5)) return false;
    }
    return true;
  }

  // people near a point, for the traffic AI (cars stop for them)
  near(x, y, r) { return this.list.filter(n => Math.abs(n.x - x) < r && Math.abs(n.y - y) < r).map(n => [n.x, n.y]); }

  // nobody walks through a car or through you: step out of a car's path, never stand inside one, make room for you
  avoid(n, cars, me, dt) {
    for (const [cx, cy, ch, cv] of cars) {
      const dx = n.x - cx, dy = n.y - cy;
      if (dx * dx + dy * dy > 144) continue;
      const fx = Math.cos(ch), fy = Math.sin(ch), along = dx * fx + dy * fy, side = dx * -fy + dy * fx;
      const s = side >= 0 ? 1 : -1;
      if (Math.abs(along) < 2.6 && Math.abs(side) < 1.25) {            // inside the car's body: out to the nearest side
        n.x += -fy * s * (1.3 - Math.abs(side)); n.y += fx * s * (1.3 - Math.abs(side));
      } else if (Math.abs(cv) > 0.5 && along > 0 && along < 4 + Math.abs(cv) * 1.5 && Math.abs(side) < 1.8) {
        const st = Math.min(1, dt * 3.2);                              // in its path: hurry aside, facing away
        n.x += -fy * s * st; n.y += fx * s * st;
        n.target = null; n.wait = 1 + this.rng(); n.dodge = 0.6;
      }
    }
    if (me) {
      const dx = n.x - me[0], dy = n.y - me[1], d = Math.hypot(dx, dy);
      if (d < 0.75 && d > 1e-3) { n.x = me[0] + dx / d * 0.75; n.y = me[1] + dy / d * 0.75; }
    }
  }

  // people follow you around the city (as in open-world games): someone far away and out of sight reappears out of
  // sight on a sidewalk near you, so every street you walk down has people on it, not just the bowtie
  recycle() {
    const cam = this.camera.position, cx = cam.x, cy = -cam.z;
    const far = this.list.find(n => !n.a.object.visible && Math.hypot(n.x - cx, n.y - cy) > 260);
    if (!far) return;
    for (let k = 0; k < 12; k++) {
      const a = this.rng() * 6.283, r = 45 + this.rng() * 150, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const w = this.crowd?.walk.at(x, y);
      if (!(w === 1 || w === 2) || this.collider?.blocked(x, y, 0.4, 0.5)) continue;
      this.sphere.center.set(x, 1, -y);
      if (this.frustum.intersectsSphere(this.sphere) && r < 200) continue;   // never pop in where you're looking
      Object.assign(far, { x, y, target: null, wait: this.rng() * 4, g: null });
      return;
    }
  }

  update(dt) {
    const cam = this.camera.position;
    const cars = this.movers(), me = this.player();
    if ((this.recT = (this.recT || 0) + dt) > 0.2) { this.recT = 0; if (cam.y < 60) this.recycle(); }
    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.frame++;
    for (let i = 0; i < this.list.length; i++) {
      const n = this.list[i];
      if (n.target) {
        const dx = n.target[0] - n.x, dy = n.target[1] - n.y, d = Math.hypot(dx, dy);
        if (d < 0.4) { n.target = null; n.wait = 3 + this.rng() * 9; }
        else {
          const want = Math.atan2(dx, -dy);                       // heading in three.js (+Z = local -y)
          let diff = ((want - n.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          n.h += diff * Math.min(1, dt * 3);
          const st = Math.min(d, n.sp * dt * (Math.abs(diff) > 1 ? 0.3 : 1));
          n.x += dx / d * st; n.y += dy / d * st;
        }
      } else if ((n.wait -= dt) <= 0) {
        const p = this.sample(n.x, n.y, 45);
        if (p && this.clearPath(n.x, n.y, p[0], p[1])) n.target = p; else n.wait = 0.5 + this.rng();
      }
      const dist = Math.hypot(n.x - cam.x, -n.y - cam.z);
      if (dist < 120) this.avoid(n, cars, me, dt);
      if (n.g == null || Math.hypot(n.x - n.gx, n.y - n.gy) > 4) {   // ground height: probe again every 4 m walked
        n.g = this.groundAt(new THREE.Vector3(n.x, 3, -n.y)); n.gx = n.x; n.gy = n.y;
      }
      this.sphere.center.set(n.x, n.g + 0.9, -n.y);
      const show = dist < DRAW_M && this.frustum.intersectsSphere(this.sphere);
      n.a.object.visible = show;
      n.v += ((n.target ? n.sp : 0) - n.v) * Math.min(1, dt * 4);
      if (!show) { n.skip = (n.skip || 0) + dt; continue; }
      const farLod = dist > NEAR_M;
      n.a.setFar(farLod);
      n.a.set(n.x, n.g, -n.y, n.h, n.v);
      n.skip = (n.skip || 0) + dt;
      if (farLod && (this.frame + i) % 2) continue;              // far away: pose every other frame
      n.a.update(n.skip); n.skip = 0;
    }
  }
}
