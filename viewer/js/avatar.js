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
  { id: "daniel", label: "Grey tee & jeans", url: "export/characters/man_daniel.glb", weight: 5 },
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

// ---- the gait. A person's stride (metres per full cycle = two steps) grows with speed: ~1.3 m at 1.0 m/s, 1.55 at a 1.6 m/s
// walk, 2.2 at a 3 m/s jog, 3.0 at a 4.6 m/s run (cadence 124 -> 186 steps/min, as people really move). The feet are
// PLANTED: each stance foot stays put on the ground while the body passes over it (two-bone IK per leg), which the old
// fixed-swing walk didn't do (measured: the planted foot slid at 1.4 m/s: it skated).
const strideOf = v => 0.75 + 0.5 * Math.min(v, 6);
const dutyOf = v => v < 2.0 ? 0.62 : THREE.MathUtils.lerp(0.62, 0.34, Math.min(1, (v - 2.0) / 2.6));   // share of the cycle a foot is down
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

const PUNCH_T = 0.5, PUNCH_FWD = -1, FIST_SQUEEZE = 0.5;
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
    const materials = new Map();
    const dress = m => {
      if (materials.has(m)) return materials.get(m);
      const c = m.clone();
      prepMaterial(c);
      const pal = rng && TINTS[m.name];
      if (pal) c.color.multiply(new THREE.Color(pal[Math.floor(rng() * pal.length)]));
      c.userData.fadeOpacity = c.opacity;
      c.userData.fadeTransparent = c.transparent;
      c.userData.fadeDepthWrite = c.depthWrite;
      materials.set(m, c);
      return c;
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
    this.measureLegs();
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

  setOpacity(opacity) {
    for (const m of [...this.near, ...this.far].flatMap(o => [].concat(o.material))) {
      const alpha = THREE.MathUtils.clamp(opacity, 0, 1);
      m.userData.fadeOpacity ??= m.opacity;
      m.userData.fadeTransparent ??= m.transparent;
      m.userData.fadeDepthWrite ??= m.depthWrite;
      m.opacity = m.userData.fadeOpacity * alpha;
      m.transparent = alpha < 1 || m.userData.fadeTransparent;
      m.depthWrite = alpha < 1 ? false : m.userData.fadeDepthWrite;
      m.needsUpdate = true;
    }
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
    const dh = ((heading - (this.heading ?? heading) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;      // how fast you're turning, how fast you're speeding up
    this.turn = (this.turn || 0) * 0.85 + dh * 0.15 * 60;        // rad/s, smoothed (called once per frame: ~60 Hz)
    this.accel = (this.accel || 0) * 0.9 + (speed - (this.speed || 0)) * 0.1 * 60;
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
    const stride = this.ik ? strideOf(v) : THREE.MathUtils.lerp(1.45, 2.6, run);   // metres per full cycle (two steps)
    this.phase = (this.phase + (v > 0.05 ? v / stride : 0) * Math.PI * 2 * dt) % (Math.PI * 200);
    this.t += dt;
    if (this.punchT > 0) this.punchT = Math.max(0, this.punchT - dt);
    this.jb = (this.jb || 0) + ((this.air > 0.02 ? 1 : 0) - (this.jb || 0)) * Math.min(1, dt * 14);
    this.landT = Math.max(0, (this.landT || 0) - dt);
    this.pose(dt, move * (1 - this.jb), run);
  }

  // a punch (G / Shove): guard up, wind back, a straight strike with the torso twisting into it, then recover; hands alternate
  punch() { if ((this.punchT || 0) > 0.12 || this.ridePose) return false; this.punchT = PUNCH_T; this.punchSide = this.punchSide === "Right" ? "Left" : "Right"; return true; }
  // the rig has no finger bones, so a fist is a small skin-coloured knuckled block fitted over each hand while punching
  handColour() {
    try {
      for (const sm of this.near) {
        if (!sm.isSkinnedMesh) continue;
        const mats = [].concat(sm.material), g = sm.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, uv = g.attributes.uv;
        const hi = sm.skeleton.bones.findIndex(b => b === this.bones.RightHand?.b);
        if (hi < 0 || !si || !uv) continue;
        const map = (mats.find(m => /skin/i.test(m.name)) || mats[0]).map, img = map?.image;
        if (!img) continue;
        const cv = document.createElement("canvas"), W = cv.width = Math.min(256, img.width), H = cv.height = Math.min(256, img.height);
        const c = cv.getContext("2d", { willReadFrequently: true }); c.drawImage(img, 0, 0, W, H);
        let r = 0, gr = 0, b = 0, n = 0;
        for (let i = 0; i < si.count && n < 40; i++) for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hi && sw.getComponent(i, k) > 0.9) {
          const u = uv.getX(i), v = map.flipY ? 1 - uv.getY(i) : uv.getY(i), d = c.getImageData(Math.floor((u % 1) * W), Math.floor((v % 1) * H), 1, 1).data;
          r += d[0]; gr += d[1]; b += d[2]; n++;
        }
        if (n) return new THREE.Color().setRGB(r / n / 255, gr / n / 255, b / n / 255, THREE.SRGBColorSpace);
      }
    } catch { /* texture not readable: fall back */ }
    return null;
  }
  // the hand's own axes in its bone frame, from its mesh: the longest direction runs to the fingertips, the thinnest is the palm's
  // normal (signed to face the body at rest), and its width. Returns { f, n, w, width } or null.
  handAxes(side) {
    try {
      const hb = this.bones[side + "Hand"]?.b;
      for (const sm of this.near) {
        if (!sm.isSkinnedMesh) continue;
        const hi = sm.skeleton.bones.indexOf(hb); if (hi < 0) continue;
        const g = sm.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position;
        const inv = sm.skeleton.boneInverses[hi], pts = [], P = new THREE.Vector3(), M = new THREE.Vector3();
        let mx = 0;
        for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hi && sw.getComponent(i, k) > 0.7) {
          P.fromBufferAttribute(pos, i); mx += P.x; pts.push(P.clone().applyMatrix4(inv)); break;
        }
        if (pts.length < 30) continue;
        mx /= pts.length;
        const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
        // power iteration for the covariance's axes
        const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (const p of pts) { const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j]; }
        const mul = (m, v) => new THREE.Vector3(m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z, m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z, m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z);
        let f = new THREE.Vector3(0.3, 1, 0.2); for (let i = 0; i < 40; i++) f = mul(cov, f).normalize();
        let w = new THREE.Vector3(1, 0, 0).sub(f.clone().multiplyScalar(f.x)).normalize(); for (let i = 0; i < 40; i++) w = mul(cov, w).sub(f.clone().multiplyScalar(f.dot(mul(cov, w)))).normalize();
        const n = f.clone().cross(w).normalize();
        // f must point away from the wrist: the mesh's centre is further along the bone than its origin
        if (f.dot(c) < 0) f.negate();
        // inward at rest: the normal, taken back to the model frame, points toward the body's centre line
        const toModel = new THREE.Matrix4().copy(inv).invert();
        if (M.copy(n).transformDirection(toModel).x * mx > 0) n.negate();
        const wv = f.clone().cross(n).normalize();
        let wd = 0; for (const p of pts) wd = Math.max(wd, Math.abs(p.clone().sub(c).dot(wv)));
        return { f, n, w: wv, width: wd * 2, centre: c };
      }
    } catch (e) { console.warn("hand axes", e); }
    return null;
  }

  // the rig has no finger bones, so a fist is built from a few skin-coloured pieces fitted to each hand while punching:
  // a rounded block, four knuckles on the striking face, the curled fingers on the palm side and the thumb across them
  makeFists() {
    this.fists = {};
    const col = this.handColour() || new THREE.Color(0xc79a80);
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.62, metalness: 0 });
    for (const side of ["Left", "Right"]) {
      const hand = this.bones[side + "Hand"]?.b; if (!hand) continue;
      const ax = this.handAxes(side) || { f: new THREE.Vector3(0, 1, 0), n: new THREE.Vector3(0, 0, 1), w: new THREE.Vector3(1, 0, 0), width: 0.085, centre: new THREE.Vector3(0, 0.07, 0) };
      const k = 0.88, grp = new THREE.Group();     // local frame: X = width, Y = to the knuckles, Z = palm side
      const add = (geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
        const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz); m.castShadow = true; m.raycast = () => {}; grp.add(m); return m;
      };
      const sph = new THREE.SphereGeometry(1, 16, 12), cap = new THREE.CapsuleGeometry(1, 1, 4, 10);
      add(sph, 0, 0.040, 0.004, 0, 0, 0, 0.031, 0.045, 0.026);                                  // the block of the hand
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 0.0205;
        add(sph, x, 0.087, -0.006, 0, 0, 0, 0.0118, 0.0125, 0.0118);                            // knuckles on the striking face
        add(cap, x, 0.062, 0.026, 0, 0, 0, 0.0112, 0.024, 0.0112);                              // the curled fingers, palm side
        add(sph, x, 0.0885, 0.024, 0, 0, 0, 0.0108, 0.0085, 0.0108);                            // their tips folded in
      }
      add(cap, 0, 0.075, 0.040, 0, 0, Math.PI / 2, 0.0125, 0.034, 0.0125);                      // the thumb across the front of the fingers
      grp.scale.setScalar(k);
      const basis = new THREE.Matrix4().makeBasis(ax.w, ax.f, ax.n);
      grp.userData.q = new THREE.Quaternion().setFromRotationMatrix(basis);
      grp.userData.off = ax.centre.clone().sub(ax.f.clone().multiplyScalar(ax.centre.dot(ax.f))).addScaledVector(ax.f, -0.02);   // along the finger axis from the wrist
      grp.visible = false; grp.frustumCulled = false;
      (this.bones[side + "ForeArm"]?.b || hand).add(grp); this.fists[side] = grp;
    }
  }
  punchPose() {
    const u = 1 - this.punchT / PUNCH_T;
    const e = u < 0.3 ? -0.3 * (u / 0.3) : u < 0.5 ? -0.3 + 1.3 * ((u - 0.3) / 0.2) : 1 - ((u - 0.5) / 0.5) ** 0.8;   // -0.3 wind-up .. 1 full reach
    const g = Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.0 + (u < 0.9 ? 1 : (1 - u) * 10);                           // guard held until the end
    const hit = this.punchSide, off = hit === "Right" ? "Left" : "Right", sg = hit === "Right" ? 1 : -1;
    this.rot(hit + "Arm", ["x", PUNCH_FWD * (70 + 25 * e)], ["z", -sg * (6 - 8 * e)]);
    this.rot(hit + "ForeArm", ["x", -105 * (1 - Math.min(1, Math.max(0, e) * 1.15))]);
    this.rot(off + "Arm", ["x", PUNCH_FWD * 55 * g], ["z", sg * 8]);
    this.rot(off + "ForeArm", ["x", -115 * g]);
    this.rot("Spine", ["x", 12 + 8 * e], ["y", sg * (-3 + 14 * e)]);                  // weight forward into the blow
    this.rot("Spine1", ["y", sg * (-2 + 8 * e)]);
    this.rot("Hips", ["y", sg * (-2 + 6 * e)]);
    this.rot("Head", ["x", -6], ["y", -sg * (-2 + 18 * e)]);
    // the stance: the foot opposite the punching hand steps in and takes the weight, the back leg pushes, the hips sink and turn
    const st = Math.min(1, this.punchT > PUNCH_T * 0.85 ? (1 - this.punchT / PUNCH_T) / 0.15 : 1) * (u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45 * 0.6), lead = off, back = hit;
    this.rot(lead + "UpLeg", ["x", PUNCH_FWD * 24 * st + 4 * e], ["z", sg * 3]); this.rot(lead + "Leg", ["x", 26 * st]); this.rot(lead + "Foot", ["x", -6 * st]);
    this.rot(back + "UpLeg", ["x", -PUNCH_FWD * 14 * st - 6 * e], ["z", -sg * 5]); this.rot(back + "Leg", ["x", 22 * st + 8 * e]); this.rot(back + "Foot", ["x", -10 * st]);
    const H = this.bones.Hips;
    if (H?.up) H.b.position.copy(H.pos).addScaledVector(H.up, -0.07 * st - 0.015 * e);
    this.object.userData.punchStep = 0;         // metres the body steps into the blow (see set())
  }
  // seated (a passenger in the back of a car): thighs forward, shins down, hands on the lap, a relaxed lean; the caller puts the hips on the seat
  sit(on) { this.sitting = on; this.contact(!on); if (!on) this.pose(0); }
  poseSit() {
    const t = this.t, br = Math.sin(t * 1.7) * 0.6;
    for (const side of ["Left", "Right"]) {
      this.rot(side + "UpLeg", ["x", -86], ["z", side === "Left" ? -4 : 4]); this.rot(side + "Leg", ["x", 88]); this.rot(side + "Foot", ["x", -4]);
      this.rot(side + "Arm", ["x", -22], ["z", side === "Left" ? 10 : -10]); this.rot(side + "ForeArm", ["x", -62]);
    }
    this.rot("Spine", ["x", -4 + br]); this.rot("Spine1", ["x", -2]); this.rot("Head", ["x", 2], ["y", Math.sin(t * 0.3) * 14]);
  }
  // a passenger on a motorcycle: the rider's ride pose, but the arms reach forward to hold the rider's waist instead of the grips
  pillionArms() {
    if (!this.ridePose) return;
    const set = (name, ...turns) => { this.rot(name, ...turns); (this.ridePose[name] ||= {}).quaternion = this.bones[name].b.quaternion.toArray(); };
    set("LeftArm", ["x", -52], ["z", 16]); set("RightArm", ["x", -52], ["z", -16]);
    set("LeftForeArm", ["x", -50]); set("RightForeArm", ["x", -50]);
  }
  pose(dt, m = 0, r = 0) {
    if (this.sitting) { this.poseSit(); return; }
    this.poseBase(dt, m, r);
    if (this.fists || this.punchT > 0) { if (!this.fists) this.makeFists(); const on = this.punchT > 0;
      for (const side of Object.keys(this.fists)) {                          // clench: the open hand is squeezed short and fat under the fist
        const f = this.fists[side], hb = this.bones[side + "Hand"]?.b; f.visible = on;
        if (hb) { hb.scale.setScalar(on ? 0.001 : 1); f.position.copy(hb.position); f.quaternion.copy(hb.quaternion).multiply(f.userData.q); f.position.addScaledVector(f.userData.off.clone().applyQuaternion(hb.quaternion), 1); }
      }
    }
    if (this.punchT > 0) {
      this.punchPose();
      const k = this.object.userData.punchStep || 0;
      this.object.position.x += Math.sin(this.heading) * k; this.object.position.z += Math.cos(this.heading) * k;
    }
  }
  poseBase(dt, m = 0, r = 0) {
    if (this.ridePose) {
      for (const [name, P] of Object.entries(this.ridePose)) {
        const B = this.bones[name];
        if (!B) continue;
        if (P.quaternion) B.b.quaternion.fromArray(P.quaternion);
        if (P.position) B.b.position.fromArray(P.position);
      }
      return;
    }
    // walking / running on planted feet; idle, jumping and landing keep the old pose below (blended in from 0.2 to 0.6 m/s)
    const v = this.speed || 0, w = sstep(0.2, 0.6, v) * (1 - (this.jb || 0) * 4 > 0 ? 1 : 0);
    if (this.ik && w > 0 && (this.jb || 0) < 0.04 && !((this.landT || 0) > 0.02)) {
      if (w < 1) { this.poseOld(dt, m, r); this.keep(); }
      this.gait(dt, v);
      if (w < 1) this.blendBack(w);
      return;
    }
    this.poseOld(dt, m, r);
  }

  // ---- legs: measured once from the rig (segment lengths, the pitch they rest at, the ankle's height and offset)
  measureLegs() {
    const o = this.object; o.updateMatrixWorld(true);
    const P = n => { const v = new THREE.Vector3(); this.bones[n]?.b.getWorldPosition(v); return o.worldToLocal(v); };
    const leg = {};
    for (const side of ["Left", "Right"]) {
      const h = P(side + "UpLeg"), k = P(side + "Leg"), f = P(side + "Foot");
      leg[side] = { l1: h.distanceTo(k), l2: k.distanceTo(f), p1: Math.atan2(k.z - h.z, -(k.y - h.y)), p2: Math.atan2(f.z - k.z, -(f.y - k.y)),
        fz0: f.z - h.z, ay: f.y, hy: h.y };
    }
    this.leg = leg;
    this.ik = !!(leg.Left.l1 > 0.1 && leg.Right.l1 > 0.1 && this.bones.Hips && this.bones.LeftUpLeg && this.bones.RightFoot);
    this.dy = 0;
    this.snap = {};
  }
  // two-bone leg IK in the sagittal plane: foot at (z, y) from the hip joint -> thigh pitch alpha (forward +) and knee flexion beta
  solveLeg(l1, l2, z, y) {
    const C = THREE.MathUtils.clamp;
    const d = C(Math.hypot(z, y), Math.abs(l1 - l2) + 0.02, (l1 + l2) * 0.9995);
    const beta = Math.PI - Math.acos(C((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
    const delta = Math.acos(C((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    return { alpha: Math.atan2(z, -y) + delta, beta };
  }
  keep() { for (const [n, B] of Object.entries(this.bones)) (this.snap[n] ||= new THREE.Quaternion()).copy(B.b.quaternion); this.snapHips = this.bones.Hips.b.position.clone(); }
  blendBack(w) {                                            // slide from the old pose (kept) to the gait by w
    for (const [n, B] of Object.entries(this.bones)) if (this.snap[n]) B.b.quaternion.copy(this.snap[n]).slerp(B.b.quaternion.clone(), w);
    this.bones.Hips.b.position.copy(this.snapHips).lerp(this.bones.Hips.b.position.clone(), w);
  }

  gait(dt, v) {
    const C = THREE.MathUtils.clamp, deg = THREE.MathUtils.radToDeg, run = sstep(2.4, 3.6, v), TAU = Math.PI * 2;
    const S = dutyOf(v), L = strideOf(v), R = THREE.MathUtils.lerp(0.32, 0.28, run);   // R: how far the ankle rolls forward over a planted foot
    const A = Math.max(0.04, (S * L - R) / 2);                                        // half the ankle's travel under the body in stance
    const lift = THREE.MathUtils.lerp(0.07, 0.2, run);                                 // how high the swinging foot rises
    const ph = this.phase / TAU;
    const out = {};
    let dyNeed = Infinity, anyStance = false;
    for (const side of ["Left", "Right"]) {
      const g = this.leg[side], f = ((ph + (side === "Right" ? 0.5 : 0)) % 1 + 1) % 1;
      let z, ay;
      if (f < S) {                                          // stance: the foot stays where it is while the body passes over it
        const u = f / S;
        z = A - 2 * A * u; ay = g.ay + THREE.MathUtils.lerp(0.07, 0.13, run) * sstep(0.7, 1, u);   // the heel lifts before toe-off
        anyStance = true;
      } else {                                              // swing: heel lifts, the leg comes through, reaches for the next step
        const u = (f - S) / (1 - S), e = u - Math.sin(TAU * u) / TAU;
        z = -A + 2 * A * e; ay = g.ay + 0.05 * (1 - u) * (1 - u) + lift * Math.sin(Math.PI * u);
      }
      const zr = g.fz0 + z + 0.02;
      if (f < S) dyNeed = Math.min(dyNeed, ay + Math.sqrt(Math.max(0, ((g.l1 + g.l2) * 0.985) ** 2 - zr * zr)) - g.hy);   // the pelvis height this leg can reach
      out[side] = { zr, ay, f };
    }
    // the pelvis: as low as the legs need (the bob a person has), up and floating in a run's flight phase
    const dyT = anyStance ? C(dyNeed, -0.11, 0.01) : 0.02 + 0.01 * run;
    this.dy += (dyT - this.dy) * Math.min(1, dt * 28);
    const sway = THREE.MathUtils.lerp(0.02, 0.008, run) * Math.cos(TAU * (ph - S / 2));        // over the standing foot
    for (const side of ["Left", "Right"]) {
      const g = this.leg[side], { zr, ay, f } = out[side];
      const sol = this.solveLeg(g.l1, g.l2, zr, ay - (g.hy + this.dy));
      const sigma = sol.alpha - sol.beta;                                                   // the shank's pitch
      let toes = 0;                                                                         // + = toes down
      if (f < S) toes = 14 * sstep(0.82, 1, f / S) - 8 * (1 - sstep(0, 0.1, f / S));        // toe-off / heel strike (the foot is flat between)
      else toes = THREE.MathUtils.lerp(10, -6, (f - S) / (1 - S));                          // toes come up through the swing
      this.rot(side + "UpLeg", ["x", -deg(sol.alpha - g.p1)]);
      this.rot(side + "Leg", ["x", deg(sol.beta + g.p2 - g.p1)]);
      this.rot(side + "Foot", ["x", deg(sigma - g.p2) + toes]);
    }
    // arms swing against the legs: each arm goes back as its own side's leg goes forward
    const armA = C(5 + 7 * v, 6, 38), c = Math.cos(TAU * ph);
    for (const [side, sg] of [["Left", 1], ["Right", -1]]) {
      const fwd = -sg * c;                                // -1 (back) .. +1 (forward)
      const elbow = THREE.MathUtils.lerp(14, 88, run) + THREE.MathUtils.lerp(8, 12, run) * fwd + 6;     // bent more as the arm comes forward
      this.rot(side + "Arm", ["x", -armA * fwd - 4 * run], ["z", sg * (3 + 4 * run)]);
      this.rot(side + "ForeArm", ["x", -elbow]);
      this.rot(side + "Hand", ["x", -6 - 10 * run - 6 * fwd * run]);
    }
    // the trunk: shoulders turn against the hips, the head stays level, a lean that grows with speed, a bank into turns
    const twist = THREE.MathUtils.lerp(4, 8, run) * c;
    const lean = THREE.MathUtils.lerp(2, 12, run) + C((this.accel || 0) * 1.6, -5, 8);
    const bank = -C(0.5 * deg(Math.atan(v * (this.turn || 0) / 9.81)), -22, 22);                       // lean into the turn (left = negative z)
    this.rot("Hips", ["y", -twist], ["z", 0.5 * bank]);
    this.rot("Spine", ["x", lean * 0.45], ["y", twist * 1.1], ["z", 0.3 * bank]);
    this.rot("Spine1", ["x", lean * 0.55], ["y", twist * 1.1], ["z", 0.2 * bank]);
    this.rot("Neck", ["x", -lean * 0.4], ["y", -twist * 0.7], ["z", -0.2 * bank]);
    this.rot("Head", ["x", -lean * 0.35 + 2], ["y", -twist * 0.6], ["z", -0.2 * bank]);
    const H = this.bones.Hips;
    if (H.up) H.b.position.copy(H.pos).addScaledVector(H.up, this.dy).addScaledVector(H.x, sway);
  }

  poseOld(dt, m = 0, r = 0) {
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
const TALK_YAW = 1;   // the sign of a head turn towards someone (checked in the browser)
export class Npcs {
  // movers(): cars as [x, y, heading, speed]; player(): your feet [x, y] or null
  constructor({ loader, root, scene, camera, crowd, collider, groundAt, playerId, count = 24, movers = () => [], player = () => null, ground = null }) {
    Object.assign(this, { loader, root, scene, camera, crowd, collider, groundAt, playerId, movers, player, ground });
    this.list = [];
    let seed = 11; this.rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    this.frustum = new THREE.Frustum(); this.m4 = new THREE.Matrix4(); this.sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    this.frame = 0; this.want = 0;
    this.setCount(count);
  }

  // add or remove people (the People slider); spawning is async (models load once, then clone)
  async setCount(n) {
    this.want = n;
    this.trim();
    if (this.spawning) return;
    this.spawning = true;
    const pool = npcPool(this.playerId), isMan = id => id === "daniel";
    const OFFS = {                                                              // where each member walks relative to the leader: [side, back] in metres
      couple: [[0.75, 0]], friends: [[0.8, 0.1], [-0.8, 0.2], [1.6, 0.4]], family: [[0.8, 0.2], [-0.7, 0.9], [0.1, 1.4]],
    };
    while (this.list.length < this.want) {
      if (!this.grp?.left) {                                                    // a new party: alone, a couple, friends or a family
        const r = this.rng();
        const kind = r < 0.38 ? "solo" : r < 0.62 ? "couple" : r < 0.85 ? "friends" : "family";
        this.grp = { kind, left: kind === "solo" ? 0 : kind === "couple" ? 1 : 2 + Math.floor(this.rng() * 2), i: 0, leader: null };
      }
      const G = this.grp, member = G.left > 0 && G.leader;
      let p;
      if (member) { const o = OFFS[G.kind][Math.min(G.i, OFFS[G.kind].length - 1)]; p = [G.leader.x + o[0], G.leader.y + o[1]]; }
      else p = this.rng() < 0.75 ? this.sampleRect(-80, -250, 60, 155) : this.sample(-10, -40, 320);
      if (!p) break;
      let id = pool[Math.floor(this.rng() * pool.length)];
      if (member) {                                                              // couples are mostly a woman and a man; friends and families mix
        const lm = isMan(G.leader.a.id), pref = G.kind === "couple" ? (this.rng() < 0.85 ? !lm : lm) : this.rng() < 0.5;
        for (let k = 0; k < 8 && isMan(id) !== pref; k++) id = pool[Math.floor(this.rng() * pool.length)];
      }
      const a = await Avatar.create(this.loader, this.root, id, { far: true, rng: this.rng }).catch(() => null);
      if (!a || this.list.length >= this.want) break;
      this.scene.add(a.object);
      if (this.rng() < 0.25) a.wear(this.loader, this.root, "sunglasses_aviator", true);   // a quarter of the street wears shades
      const n = { a, x: p[0], y: p[1], h: this.rng() * 6.28, target: null, wait: this.rng() * 6,
        sp: 1.1 + this.rng() * 0.45, v: 0, state: "walking", hitCount: 0, air: 0 };
      if (member) { n.leader = G.leader; n.off = OFFS[G.kind][Math.min(G.i, OFFS[G.kind].length - 1)]; n.sp = G.leader.sp; n.h = G.leader.h; G.i++; G.left--; }
      else if (G.kind !== "solo") { G.leader = n; G.i = 0; n.sp = 1.0 + this.rng() * 0.3; }     // a party walks slower than a loner
      if (!member && G.kind === "solo") { n.sp = 1.25 + this.rng() * 0.35; }
      this.list.push(n);
    }
    this.spawning = false;
    if (this.list.length !== this.want) this.setCount(this.want);
  }

  // fewer people wanted: only those who are out of sight leave (the rest carry on and go when they have walked out of view), so nobody vanishes in front of you
  trim() {
    for (let i = this.list.length - 1; i >= 0 && this.list.length > this.want; i--) {
      const n = this.list[i]; if (n.a.object.visible && !this.forceTrim) continue;
      this.list.splice(i, 1); this.scene.remove(n.a.object);
    }
  }

  // you changed outfit: nobody else may wear it (they're replaced by someone from the new pool)
  setPlayer(id) {
    if (id === this.playerId) return;
    this.playerId = id;
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].a.id === id) this.scene.remove(this.list.splice(i, 1)[0].a.object);
    this.setCount(this.want);
  }

  clearPosition(x, y, radius = 0.55) {
    return !this.collider?.blocked(x, y, radius, 1);
  }

  stepAside(n, dx, dy) {
    const x = n.x + dx, y = n.y + dy;
    if (!this.clearPath(n.x, n.y, x, y)) return false;
    n.x = x; n.y = y;
    return true;
  }

  sampleRect(x0, y0, x1, y1) {
    for (let k = 0; k < 60; k++) {
      const x = x0 + this.rng() * (x1 - x0), y = y0 + this.rng() * (y1 - y0), w = this.crowd?.walk.at(x, y);
      if ((w === 1 || w === 2) && this.clearPosition(x, y)) return [x, y];
    }
    return null;
  }

  sample(cx, cy, r) {
    for (let k = 0; k < 40; k++) {
      const x = cx + (this.rng() - 0.5) * 2 * r, y = cy + (this.rng() - 0.5) * 2 * r;
      const w = this.crowd?.walk.at(x, y);
      if ((w === 1 || w === 2) && this.clearPosition(x, y)) return [x, y];
    }
    return null;
  }

  clearPath(x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 1; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n, w = this.crowd.walk.at(x, y);
      if (!(w === 1 || w === 2) || !this.clearPosition(x, y, 0.5)) return false;
    }
    return true;
  }

  // people near a point, for the traffic AI (cars stop for them)
  near(x, y, r) { return this.list.filter(n => n.state !== "out" && Math.abs(n.x - x) < r && Math.abs(n.y - y) < r).map(n => [n.x, n.y]); }

  hitAt(x, y, vx, vy, strength = 0.3, radius = 2.2) {
    const n = this.list.filter(p => p.state !== "out")
      .map(p => [p, Math.hypot(p.x - x, p.y - y)])
      .filter(([, d]) => d < radius).sort((a, b) => a[1] - b[1])[0]?.[0];
    if (!n) return false;
    if ((n.hitLock || 0) > 0) return false;
    n.hitLock = 0.8;
    const speed = Math.hypot(vx, vy), hard = speed >= 5 || strength >= 0.7;     // a car or bike at speed is hard; a punch or a bump is not
    const now = performance.now();
    if (now - (n.lastHit || 0) > 10000) n.hitCount = 0;                       // a minute's calm and they've shaken it off
    n.lastHit = now;
    if (n.state === "down" || n.state === "gettingUp" || (n.state === "dazed" && hard)) {
      // hit again while down or dazed: they scramble up and run for it (no vanishing): gone once they're far or out of sight
      n.state = "down"; n.stateT = 0.5; n.escape = true; n.target = null; n.vx = vx / (speed || 1) * 1.5; n.vy = vy / (speed || 1) * 1.5;
      n.fallT = 0; n.airV = 0; n.air = 0; n.fallDir = (Math.sin(n.h) * vx + Math.cos(n.h) * vy) > 0 ? 1 : -1;
      return true;
    }
    if (hard || n.hitCount >= 2) return this.startHit(n, vx, vy, strength);        // knocked off their feet: a car, or the third blow
    return this.startStagger(n, vx, vy, strength);
  }

  // a punch or a bump: rocked back a step or two, a hand to the face, then they hurry away from you. Others nearby back off.
  startStagger(n, vx, vy, strength) {
    n.hitCount++; n.leader = null;
    n.state = "stagger"; n.stateT = 0.85; n.escape = false;
    const sp = Math.hypot(vx, vy) || 1;
    n.vx = vx / sp * (2.4 + strength * 2.2); n.vy = vy / sp * (2.4 + strength * 2.2);
    n.h = Math.atan2(-vx, -vy);                                            // they turn to look at who hit them
    n.fromX = n.x - vx / sp; n.fromY = n.y - vy / sp;
    n.target = null; n.wait = 2;
    for (const other of this.list) {
      if (other === n || Math.hypot(other.x - n.x, other.y - n.y) > 12 || other.state !== "walking") continue;
      const dx = other.x - n.x, dy = other.y - n.y, d = Math.hypot(dx, dy) || 1;
      const p = this.sample(other.x + dx / d * 10, other.y + dy / d * 10, 8);      // they step back and give the scene room
      if (p) { other.target = p; other.wait = 0; other.sp = Math.max(other.sp, 2.2); }
    }
    return true;
  }

  adoptHitRider(avatar, x, y, vx, vy, strength = 0.3) {
    avatar.object.position.set(x, this.groundAt(new THREE.Vector3(x, 3, -y)), -y);
    avatar.object.visible = true;
    avatar.contact(true);
    this.scene.add(avatar.object);
    const n = { a: avatar, x, y, h: Math.atan2(vx, vy), target: null, wait: 0, sp: 1.25, v: 0,
      state: "walking", hitCount: 0, air: 0, vx: 0, vy: 0, stateT: 0, hitLock: 0 };
    this.list.push(n);
    return this.startHit(n, vx, vy, strength);
  }

  startHit(n, vx, vy, strength) {
    n.hitCount++; n.leader = null;
    n.hitLock = 0.8;
    n.state = "hit"; n.stateT = 0.14; n.fallT = 0;
    const speed = Math.hypot(vx, vy) || 1;
    n.fallDir = (Math.sin(n.h) * vx + Math.cos(n.h) * vy) > 0 ? 1 : -1;      // pushed the way they face: face down; else onto their back
    n.vx = vx / speed * (1.8 + strength * 2.2);
    n.vy = vy / speed * (1.8 + strength * 2.2);
    n.air = 0.08 + strength * 0.4;
    n.airV = 1.4 + strength * 2;
    n.target = null; n.wait = 2;
    for (const other of this.list) {
      if (other === n || Math.hypot(other.x - n.x, other.y - n.y) > 15 || other.state !== "walking") continue;
      other.fleeT = 3.5;
      const dx = other.x - n.x, dy = other.y - n.y, d = Math.hypot(dx, dy) || 1;
      const p = this.sample(other.x + dx / d * 18, other.y + dy / d * 18, 10);
      if (p) { other.target = p; other.wait = 0; }
    }
    return true;
  }

  updateImpact(n, dt) {
    if (n.leaving > 0) {                                                     // hurrying away after being hit: they stay in the world, then just wander again
      n.leaving -= dt;
      if (n.leaving <= 0 || !n.target) { n.leaving = 0; n.sp = 1.1 + this.rng() * 0.45; n.escape = false; n.wait = 2 + this.rng() * 4; }
    }
    if (n.state === "walking") return;
    if (n.state === "out") {
      n.stateT -= dt;
      n.a.setOpacity(Math.max(0, n.stateT / 1.1));
      if (n.stateT <= 0) {
        const p = this.sample(this.camera.position.x, -this.camera.position.z, 180);
        if (p) {
          Object.assign(n, { x: p[0], y: p[1], state: "walking", stateT: 0, hitCount: 0, air: 0,
            vx: 0, vy: 0, target: null, wait: 2 + this.rng(), g: null, gs: null });
          n.a.setOpacity(1); n.a.contact(true);
        } else n.stateT = 0.2;
      }
      return;
    }
    if (n.state === "stagger") {
      n.stateT -= dt;
      const x = n.x + n.vx * dt, y = n.y + n.vy * dt;
      if (this.clearPath(n.x, n.y, x, y)) { n.x = x; n.y = y; }
      const drag = Math.exp(-dt * 3.4); n.vx *= drag; n.vy *= drag;
      if (n.stateT <= 0) {                                                  // then off, away from whoever did it
        const dx = n.x - n.fromX, dy = n.y - n.fromY, d = Math.hypot(dx, dy) || 1;
        n.state = "walking"; n.leaving = 10; n.sp = 3.4; n.wait = 0;
        n.target = this.sample(n.x + dx / d * 60, n.y + dy / d * 60, 40) || this.sample(n.x, n.y, 60);
      }
      return;
    }
    n.stateT -= dt;
    if (n.state === "hit" || n.state === "down") n.fallT = (n.fallT || 0) + dt;
    if (n.state === "hit" && n.stateT <= 0) { n.state = "down"; n.stateT = 1.25; }
    if (n.state === "down") {
      const x = n.x + (n.vx || 0) * dt, y = n.y + (n.vy || 0) * dt;
      if (this.clearPath(n.x, n.y, x, y)) { n.x = x; n.y = y; } else n.vx = n.vy = 0;
      const drag = Math.exp(-dt * 3.2);
      n.vx *= drag; n.vy *= drag;
      n.airV -= 9.81 * dt; n.air = Math.max(0, n.air + n.airV * dt);
      if (n.air === 0) n.airV = 0;
      if (n.stateT <= 0 && n.air === 0) { n.state = "gettingUp"; n.stateT = 1.2; }
    } else if (n.state === "gettingUp" && n.stateT <= 0 && n.escape) {
      const cx = this.camera.position.x, cy = -this.camera.position.z, dx = n.x - cx, dy = n.y - cy, d = Math.hypot(dx, dy) || 1;
      n.state = "walking"; n.a.contact(true); n.leaving = 16; n.sp = 3.9; n.wait = 0;
      n.target = this.sample(n.x + dx / d * 70, n.y + dy / d * 70, 40) || this.sample(n.x, n.y, 80);
    } else if (n.state === "gettingUp" && n.stateT <= 0) {
      n.state = "dazed"; n.stateT = 7; n.a.contact(true);
    } else if (n.state === "dazed" && n.stateT <= 0) {
      n.state = "walking"; n.hitCount = 0; n.wait = 1 + this.rng();
    }
  }

  // hit by a vehicle or a shove: thrown off their feet (arms flung out), land on their back (hit from the front) or face
  // down (hit from behind), lie stunned, push themselves up, then stand dazed with a hand to the head before walking off
  poseImpact(n) {
    if (n.state === "walking") return;
    const p = n.a, ss = x => x * x * (3 - 2 * x), cl = x => Math.max(0, Math.min(1, x));
    if (n.state === "stagger") {                                             // rocked back: head snaps, a hand to the face, the other arm out for balance
      const u = 1 - cl(n.stateT / 0.85), k = Math.sin(Math.min(1, u * 2.2) * Math.PI * 0.5) * (1 - 0.35 * u);
      p.rot("Hips", ["x", -8 * k], ["z", 5 * k]); p.rot("Spine", ["x", -14 * k], ["y", 8 * k]); p.rot("Spine1", ["x", -8 * k]);
      p.rot("Neck", ["x", -12 * k]); p.rot("Head", ["x", -10 * k], ["y", 30 * k * (n.hitCount % 2 ? 1 : -1)]);
      p.rot("RightArm", ["x", -100 * k], ["z", -18]); p.rot("RightForeArm", ["x", -125 * k]);
      p.rot("LeftArm", ["x", -15 * k], ["z", 38 * k]); p.rot("LeftForeArm", ["x", -30 * k]);
      p.rot("LeftUpLeg", ["x", 12 * k]); p.rot("LeftLeg", ["x", 18 * k]); p.rot("RightUpLeg", ["x", -16 * k]); p.rot("RightLeg", ["x", 10 * k]);
      return;
    }
    const fd = n.fallDir || 1;
    let lie = 0, air = 0, push = 0, daze = 0;
    if (n.state === "hit" || n.state === "down" || n.state === "out") { n.fallT = (n.fallT || 0); lie = ss(cl(n.fallT / 0.5)); air = n.air > 0.03 ? 1 : 0; }
    else if (n.state === "gettingUp") { const u = 1 - n.stateT / 1.2; lie = 1 - ss(cl((u - 0.25) / 0.75)); push = Math.sin(cl(u / 0.6) * Math.PI) ; }
    else if (n.state === "dazed") daze = cl(n.stateT / 1.5) * 1;
    const H = p.bones.Hips;
    if (lie > 0.001) {
      let alpha = 0, rise = 0;                                                  // lie along the ground: head end vs feet end (slopes, kerbs)
      const G = this.ground;
      if (G?.built) {
        const hx = Math.sin(n.h) * fd * 0.85, hy = Math.cos(n.h) * fd * 0.85;
        const hh = G.h(n.x + hx, n.y + hy), hf = G.h(n.x - hx, n.y - hy);
        alpha = Math.max(-35, Math.min(35, Math.atan2(hh - hf, 1.7) * 57.3));
        rise = ((hh + hf) / 2 - (n.gs ?? G.h(n.x, n.y))) * lie;
      }
      p.rot("Hips", ["x", fd * (88 - alpha * lie)], ["y", 12 * lie * fd]);
      p.rot("Spine", ["x", fd * -6 * lie], ["y", -8 * lie]);
      p.rot("Head", ["x", fd * 10 * lie], ["z", 12 * lie]);
      const flail = air ? 1 : 0.35;                                           // flung: arms out and wide; on the ground: loose
      p.rot("LeftArm", ["x", -40 * flail * lie + 30 * push], ["z", 55 * flail * lie]);
      p.rot("RightArm", ["x", -25 * flail * lie - 20 * push], ["z", -62 * flail * lie]);
      p.rot("LeftForeArm", ["x", -35 * lie - 40 * push]); p.rot("RightForeArm", ["x", -20 * lie - 40 * push]);
      p.rot("LeftUpLeg", ["x", -26 * lie * (air ? 1.4 : 1)], ["z", -9 * lie]); p.rot("LeftLeg", ["x", 38 * lie]);
      p.rot("RightUpLeg", ["x", 14 * lie], ["z", 12 * lie]); p.rot("RightLeg", ["x", 52 * lie]);
      if (H?.up) H.b.position.copy(H.pos).addScaledVector(H.up, -0.83 * lie * (1 - push * 0.15) + rise);   // the pelvis comes down to the ground
    } else if (daze > 0.001 || n.state === "dazed") {
      const w = Math.sin(n.stateT * 2.4);
      p.rot("Hips", ["z", 6 * w], ["x", 6]); p.rot("Spine", ["x", 12], ["z", -8 * w]);
      p.rot("Neck", ["z", 8 * w]); p.rot("Head", ["x", 10], ["z", 6 * w]);
      p.rot("RightArm", ["x", -95], ["z", -20]); p.rot("RightForeArm", ["x", -120]);        // a hand to the head
      p.rot("LeftUpLeg", ["x", -4]); p.rot("LeftLeg", ["x", 10]);
    }
  }

  // Decide once per encounter: wait for a moving car, or choose a stable sidestep around a stopped one.
  avoid(n, cars, me, dt) {
    if (n.carDetour) {
      const d = Math.hypot(n.carDetour[0] - n.x, n.carDetour[1] - n.y);
      if (d > 0.45) { n.target = n.carDetour; return true; }
      n.carIgnore = { x: n.carDetourCar[0], y: n.carDetourCar[1], t: 2.5 };
      n.carDetour = n.carDetourCar = null;
      n.target = null; n.wait = 0.5;
      return true;
    }
    if (n.carIgnore) {
      n.carIgnore.t -= dt;
      if (n.carIgnore.t <= 0 || !cars.some(([x, y]) => Math.hypot(x - n.carIgnore.x, y - n.carIgnore.y) < 5))
        n.carIgnore = null;
    }
    let risk = null;
    for (const [cx, cy, ch, cv] of cars) {
      const dx = n.x - cx, dy = n.y - cy;
      if (n.carIgnore && Math.hypot(cx - n.carIgnore.x, cy - n.carIgnore.y) < 5) continue;
      if (dx * dx + dy * dy > 144) continue;
      const fx = Math.cos(ch), fy = Math.sin(ch), along = dx * fx + dy * fy, side = dx * -fy + dy * fx;
      const inBody = Math.abs(along) < 3.2 && Math.abs(side) < 1.7;
      const approaching = Math.abs(cv) > 0.8 && along * Math.sign(cv) > -1.5
        && along * Math.sign(cv) < 4 + Math.abs(cv) * 1.5 && Math.abs(side) < 2.2;
      if (inBody || approaching) { risk = { cx, cy, fx, fy, moving: Math.abs(cv) > 0.8 }; break; }
    }
    if (risk?.moving) {
      n.target = null; n.wait = Math.max(n.wait, 0.65);
      return true;
    }
    if (risk) {
      const sx = -risk.fy, sy = risk.fx, currentSide = (n.x - risk.cx) * sx + (n.y - risk.cy) * sy;
      const first = currentSide === 0 ? (this.rng() < 0.5 ? -1 : 1) : -Math.sign(currentSide);
      for (const sign of [first, -first]) {
        const goal = [n.x + sx * sign * 3.6, n.y + sy * sign * 3.6];
        if (!this.clearPath(n.x, n.y, goal[0], goal[1])) continue;
        const along = (goal[0] - risk.cx) * risk.fx + (goal[1] - risk.cy) * risk.fy;
        const side = (goal[0] - risk.cx) * sx + (goal[1] - risk.cy) * sy;
        if (Math.abs(along) < 3.1 && Math.abs(side) < 1.8) continue;
        n.carDetour = goal; n.carDetourCar = [risk.cx, risk.cy]; n.target = goal; n.wait = 0;
        return true;
      }
      n.target = null; n.wait = Math.max(n.wait, 0.5);
      return true;
    }
    if (me) {
      const dx = n.x - me[0], dy = n.y - me[1], d = Math.hypot(dx, dy);
      if (d < 0.75 && d > 1e-3) this.stepAside(n, dx / d * (0.75 - d), dy / d * (0.75 - d));
    }
    return false;
  }

  // people follow you around the city (as in open-world games): someone far away and out of sight reappears out of
  // sight on a sidewalk near you, so every street you walk down has people on it, not just the bowtie
  recycle() {
    const cam = this.camera.position, cx = cam.x, cy = -cam.z;
    const far = this.list.find(n => n.state === "walking" && !n.leader && !n.a.object.visible && Math.hypot(n.x - cx, n.y - cy) > 260);
    if (!far) return;
    for (let k = 0; k < 12; k++) {
      const a = this.rng() * 6.283, r = 45 + this.rng() * 150, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const w = this.crowd?.walk.at(x, y);
      if (!(w === 1 || w === 2) || !this.clearPosition(x, y)) continue;
      this.sphere.center.set(x, 1, -y);
      if (this.frustum.intersectsSphere(this.sphere) && r < 200) continue;   // never pop in where you're looking
      Object.assign(far, { x, y, target: null, wait: this.rng() * 4, g: null, gs: null });
      for (const m of this.list) if (m.leader === far) Object.assign(m, { x: x + m.off[0], y: y + m.off[1], target: null, g: null, gs: null });   // the whole party moves
      return;
    }
  }

  // a member of a party keeps their place beside / behind the leader and matches the leader's pace (stops when the leader stops)
  follow(n, dt) {
    const L = n.leader;
    if (!this.list.includes(L) || L.state === "out") { n.leader = null; return; }
    if (n.state !== "walking") return;
    const fx = Math.sin(L.h), fy = -Math.cos(L.h), rx = -fy, ry = fx;           // the leader's forward and right (local metres)
    const tx = L.x + rx * n.off[0] - fx * n.off[1], ty = L.y + ry * n.off[0] - fy * n.off[1], d = Math.hypot(tx - n.x, ty - n.y);
    if (L.state !== "walking" && L.state !== "dazed") { n.target = null; return; }
    n.lost = d > 6 ? (n.lost || 0) + dt : 0;                                      // cut off (a wall, a kerb): rejoin if the slot is free, else go solo
    if (n.lost > 3) { n.lost = 0; if (this.clearPosition(tx, ty) && !n.a.object.visible) Object.assign(n, { x: tx, y: ty, g: null, gs: null }); else if (n.lost === 0 && d > 12) n.leader = null; }
    if (d > 0.35) { n.target = [tx, ty]; n.sp = L.sp * (1 + Math.min(0.7, Math.max(0, (d - 0.7) * 0.5))); }
    else { n.target = L.target ? [tx, ty] : null; n.sp = L.sp; if (!L.target) n.h += (L.h - n.h) * Math.min(1, dt * 2); }
  }

  // people walking together talk: they turn their heads to each other, whoever is speaking gestures with a hand and nods along with their words,
  // and the listener watches them and nods now and then. Speaker and listener swap every few seconds (all on the party's own clock, so a group looks like a conversation).
  talk(n, t) {
    if (!n.leader && t > (n.mateT || 0)) { n.mateT = t + 2; n.mate = this.list.find(m => m.leader === n) || null; }   // a party's leader finds who walks with them (checked every 2 s)
    const L = n.leader || n, mate = n.leader || n.mate;
    if (!mate || mate.state === "out" || !this.list.includes(mate)) return;
    const a = n.a, party = L.tp ??= this.rng() * 6.28, who = Math.sin(t * 0.33 + party) + 0.6 * Math.sin(t * 0.91 + party * 2);          // > 0: the leader is speaking
    const idx = n.leader ? 1 + ((n.off?.[0] > 0) ? 0 : 1) : 0, speaking = n.leader ? who + idx * 0.2 < 0 : who > 0;
    const dx = mate.x - n.x, dy = mate.y - n.y; let yaw = Math.atan2(dx, -dy) - n.h; yaw = ((yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const glance = speaking ? 0.45 : 0.9, look = Math.max(0, Math.min(1, glance + 0.35 * Math.sin(t * 0.7 + party)));              // speakers look at you sometimes, listeners nearly always
    const deg = THREE.MathUtils.radToDeg(Math.max(-0.9, Math.min(0.9, yaw))) * look * TALK_YAW;
    const nod = speaking ? Math.sin(t * 6.5 + party) * 3 + Math.sin(t * 2.3) * 2 : Math.max(0, Math.sin(t * 1.5 + party)) ** 6 * 9;
    a.rot("Neck", ["x", -2 + nod * 0.3], ["y", deg * 0.35]);
    a.rot("Head", ["x", 2 + nod * 0.7], ["y", deg * 0.6]);
    if (speaking && n.v < 2.2) {                                              // a hand that talks: the forearm comes up and moves with the words
      const side = n.off && n.off[0] < 0 ? "Left" : "Right", sg = side === "Left" ? 1 : -1, w = Math.sin(t * 3.1 + party), k = 0.5 + 0.5 * Math.sin(t * 0.8 + party);
      a.rot(side + "Arm", ["x", -28 - 10 * w * k], ["z", sg * (14 + 6 * w)]);
      a.rot(side + "ForeArm", ["x", -(70 + 18 * w * k)]);
      a.rot(side + "Hand", ["x", -10 + 12 * w], ["z", sg * 8 * w]);
    }
  }

  update(dt) {
    this.clock = (this.clock || 0) + dt;
    const cam = this.camera.position;
    const cars = this.movers(), me = this.player();
    if ((this.recT = (this.recT || 0) + dt) > 0.2) { this.recT = 0; if (cam.y < 60) this.recycle(); if (this.list.length > this.want) this.trim(); }
    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.frame++;
    for (let i = 0; i < this.list.length; i++) {
      const n = this.list[i];
      n.hitLock = Math.max(0, (n.hitLock || 0) - dt);
      this.updateImpact(n, dt);
      if (n.leader) this.follow(n, dt);
      const yielding = (n.state === "walking" || n.state === "dazed") && this.avoid(n, cars, me, dt);
      if ((!yielding || n.carDetour) && (n.state === "walking" || n.state === "dazed") && n.target) {
        const dx = n.target[0] - n.x, dy = n.target[1] - n.y, d = Math.hypot(dx, dy);
        if (d < 0.4) { n.target = null; n.wait = 3 + this.rng() * 9; }
        else {
          const want = Math.atan2(dx, -dy);                       // heading in three.js (+Z = local -y)
          let diff = ((want - n.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          n.h += diff * Math.min(1, dt * 3);
          const st = Math.min(d, n.sp * (n.state === "dazed" ? 0.38 : 1) * dt * (Math.abs(diff) > 1 ? 0.3 : 1));
          const nx = n.x + dx / d * st, ny = n.y + dy / d * st;
          if (this.clearPath(n.x, n.y, nx, ny)) { n.x = nx; n.y = ny; }
          else { n.target = null; n.wait = 0.5; }
        }
      } else if (!yielding && !n.leader && (n.wait -= dt) <= 0) {
        const p = this.sample(n.x, n.y, 45);
        if (p && this.clearPath(n.x, n.y, p[0], p[1])) n.target = p; else n.wait = 0.5 + this.rng();
      }
      const dist = Math.hypot(n.x - cam.x, -n.y - cam.z);
      const gm = this.ground;
      if (gm?.built && gm.inside(n.x, n.y)) n.g = gm.h(n.x, n.y);          // Midtown: the baked height of the ground, exact, every frame
      else if (n.g == null || Math.hypot(n.x - n.gx, n.y - n.gy) > 4) {   // elsewhere (the harbour): probe again every 4 m walked
        n.g = this.groundAt(new THREE.Vector3(n.x, 3, -n.y)); n.gx = n.x; n.gy = n.y;
      }
      n.gs = n.gs == null ? n.g : n.gs + (n.g - n.gs) * Math.min(1, dt * 12);   // step up a kerb, don't teleport
      this.sphere.center.set(n.x, n.g + 0.9, -n.y);
      const show = dist < DRAW_M && this.frustum.intersectsSphere(this.sphere);
      n.a.object.visible = show;
      n.v += ((n.target && (n.state === "walking" || n.state === "dazed") ? n.sp * (n.state === "dazed" ? 0.38 : 1) : 0) - n.v) * Math.min(1, dt * 4);
      if (!show) { n.skip = (n.skip || 0) + dt; continue; }
      const farLod = dist > NEAR_M;
      n.a.setFar(farLod);
      n.a.set(n.x, n.gs + (n.air || 0), -n.y, n.h, n.v, n.air || 0);
      n.skip = (n.skip || 0) + dt;
      if (farLod && (this.frame + i) % 2) continue;              // far away: pose every other frame
      n.a.update(n.skip); this.poseImpact(n); if (!farLod && n.state === "walking") this.talk(n, this.clock); n.skip = 0;
    }
  }
}
