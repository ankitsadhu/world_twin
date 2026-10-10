// Street furniture that gives way the way it does in a driving game: lamp posts and traffic signals BEND (more with speed, more on every hit, and
// SNAP and fall over on the third hard knock), bollards bend then get knocked flat, bins tip over and slide, hydrants are knocked off and spray water.
// The scene's lamps, signals and bollards are instanced meshes (one draw call for hundreds), so the instance you hit is hidden and replaced by its own
// mesh that can tilt on a spring; everything else stays instanced. A car pushes through (and slows); a bike takes the crash (and the pole still bends).
import * as THREE from "three";

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
// per kind: bend per hit (rad) = base + speed * perMs, break at (rad, total tilt), what it does when it breaks, how much a car slows
const KINDS = [
  { re: /StreetLamp/, kind: "lamp", base: 0.14, perMs: 0.017, breakAt: 1.0, slow: 0.9, pts: 40, label: "Bent a lamp post" },
  { re: /TrafficSignal/, kind: "signal", base: 0.14, perMs: 0.016, breakAt: 0.95, slow: 0.9, pts: 40, label: "Bent a signal" },
  { re: /Bollard/, kind: "bollard", base: 0.06, perMs: 0.013, breakAt: 0.5, slow: 0.88, pts: 20, label: "Bollard down" },
  { re: /TrashBasket/, kind: "bin", tip: true, slow: 0.95, pts: 15, label: "Bin tipped" },
  { re: /Hydrant001/, kind: "hydrant", tip: true, spray: true, slow: 0.93, pts: 25, label: "Hydrant!" },
];

export class Furniture {
  // o: { scene, audio, onHit(kind, pts, label) }
  constructor(o) { Object.assign(this, o); this.state = new Map(); this.sprays = []; }

  kindOf(entry) { if (!entry?.mesh?.isInstancedMesh) return null; return KINDS.find(k => k.re.test(entry.name)) || null; }

  // a vehicle hit this entry at `point` moving (vx, vy) in the plan frame (m/s); returns { pass, slow } (pass: the vehicle carries on)
  hit(entry, point, vx, vy, bike) {
    const K = this.kindOf(entry); if (!K) return null;
    const key = entry.mesh.uuid + ":" + entry.inst, now = performance.now();
    let S = this.state.get(key);
    if (S && now - S.last < 700) return { pass: !bike, slow: 1 };                       // the same knock still going on: don't count it twice
    const speed = Math.hypot(vx, vy);
    if (!S) S = this.make(entry, K, key);
    S.last = now; S.hits++;
    const d = new THREE.Vector3(vx, 0, -vy).normalize();                                   // push direction in the three.js frame
    if (K.tip) {                                                                           // bins and hydrants: knocked over, they slide with the push
      S.tilt.set(d.x, d.z).multiplyScalar(1.45); S.target = 1.45; S.vel.set(d.x * Math.min(6, speed * 0.4), d.z * Math.min(6, speed * 0.4)); S.broken = true;
      if (K.spray) this.spray(S);
    } else {
      const add = K.base + speed * K.perMs, t = new THREE.Vector2(d.x, d.z).multiplyScalar(add); S.tilt.add(t);
      const mag = S.tilt.length();
      if (mag > K.breakAt) { S.broken = true; S.target = 1.45; S.tilt.setLength(Math.max(mag, 0.9)); } else S.target = mag;
      S.w += add * 9;                                                                      // the whip: a springy kick on top of the new lean
    }
    if (S.broken || S.tilt.length() > 0.7) entry.skip = true;                                                       // a fallen one is no longer in the way
    this.audio?.crash?.(point, Math.min(1, 0.4 + speed / 22), "metal");
    this.onHit?.(K.kind, K.pts, S.broken ? K.label.replace("Bent", "Snapped") : K.label);
    return { pass: !bike, slow: K.slow };
  }

  make(entry, K, key) {
    const base = new THREE.Vector3().setFromMatrixPosition(entry.matrix);
    const pivot = new THREE.Group(); pivot.position.copy(base);
    const mesh = new THREE.Mesh(entry.geometry, entry.mesh.material);
    mesh.matrixAutoUpdate = false; mesh.matrix.copy(new THREE.Matrix4().makeTranslation(-base.x, -base.y, -base.z).multiply(entry.matrix)); mesh.castShadow = true; mesh.raycast = () => {};
    pivot.add(mesh); pivot.userData.traffic = true; this.scene.add(pivot);
    entry.mesh.setMatrixAt(entry.inst, ZERO); entry.mesh.instanceMatrix.needsUpdate = true;      // the instanced one disappears: the loose copy takes over
    const S = { K, entry, pivot, mesh, base, tilt: new THREE.Vector2(), a: 0, w: 0, target: 0, hits: 0, last: 0, broken: false, vel: new THREE.Vector2(), slideT: 0 };
    this.state.set(key, S); return S;
  }

  spray(S) {                                                                               // a hydrant knocked off: a jet of water for a few seconds
    const g = new THREE.BufferGeometry(), n = 80, pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfe6ff, size: 0.35, transparent: true, opacity: 0.8, depthWrite: false })); pts.frustumCulled = false; pts.raycast = () => {};
    this.scene.add(pts); this.sprays.push({ pts, pos, vel, n, t: 0, base: S.base.clone() });
  }

  update(dt) {
    for (const S of this.state.values()) {
      const mag = S.tilt.length(), want = S.target;
      // a spring toward the target tilt with a little overshoot (a pole whips back and settles); a broken one falls on to its side and rests
      const k = S.broken ? 14 : 70, c = S.broken ? 3.2 : 5.5;
      S.w += (-k * (S.a - want) - c * S.w) * dt; S.a += S.w * dt;
      if (S.broken && S.a > 1.45) { S.a = 1.45; S.w *= -0.25; }
      if (mag > 1e-4) { const dir = new THREE.Vector3(S.tilt.x / mag, 0, S.tilt.y / mag), axis = new THREE.Vector3().crossVectors(UP, dir).normalize(); S.pivot.quaternion.setFromAxisAngle(axis, Math.max(0, S.a)); }
      if (S.K.tip && S.vel.lengthSq() > 0.01) { S.pivot.position.x += S.vel.x * dt; S.pivot.position.z += S.vel.y * dt; S.vel.multiplyScalar(Math.exp(-dt * 3.2)); }
    }
    for (let i = this.sprays.length - 1; i >= 0; i--) {
      const sp = this.sprays[i]; sp.t += dt;
      for (let k = 0; k < sp.n; k++) {
        const j = k * 3;
        if (sp.t < 3.5 && (sp.pos[j + 1] <= sp.base.y || sp.t < 0.05)) { sp.pos[j] = sp.base.x; sp.pos[j + 1] = sp.base.y + 0.4; sp.pos[j + 2] = sp.base.z; sp.vel[j] = (Math.random() - 0.5) * 2; sp.vel[j + 1] = 6 + Math.random() * 4; sp.vel[j + 2] = (Math.random() - 0.5) * 2; }
        sp.vel[j + 1] -= 9.8 * dt; sp.pos[j] += sp.vel[j] * dt; sp.pos[j + 1] += sp.vel[j + 1] * dt; sp.pos[j + 2] += sp.vel[j + 2] * dt;
        if (sp.pos[j + 1] < sp.base.y) sp.pos[j + 1] = sp.t < 3.5 ? sp.base.y : -50;
      }
      sp.pts.geometry.attributes.position.needsUpdate = true;
      if (sp.t > 5.5) { this.scene.remove(sp.pts); this.sprays.splice(i, 1); }
    }
  }
}
