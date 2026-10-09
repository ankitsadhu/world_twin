// Stunt Park (Goat Simulator / BeamNG energy): a sandbox on the Times Square plaza with real ramps (stamped into the ground height map, so
// wheels climb them and vehicles launch off the lip) and ~50 breakable props: barrels in a bowling triangle, a crate pyramid, bins, cones.
// Hit a prop and it goes flying with spin and bounces off the other props; every smash scores in the chaos chain; they reset when you leave.
// No people are involved: the props are the comedy.
import * as THREE from "three";

const CX = -20, CY = 92;                                    // a free 44 x 24 m patch of the plaza, found by scanning the collider
const KINDS = {
  barrel: { r: 0.32, h: 0.9, pts: 30, mass: 1.0, make: () => new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), color: 0x2a6fb3 },
  crate: { r: 0.45, h: 0.8, pts: 45, mass: 1.6, make: () => new THREE.BoxGeometry(0.8, 0.8, 0.8), color: 0xb98a4b },
  bin: { r: 0.36, h: 1.0, pts: 25, mass: 0.8, make: () => new THREE.CylinderGeometry(0.34, 0.3, 1.0, 12), color: 0x2f8f4a },
  cone: { r: 0.3, h: 0.9, pts: 15, mass: 0.35, make: () => new THREE.ConeGeometry(0.34, 0.9, 12), color: 0xff6a00 },
};

export class PlayZone {
  // o: { scene, ground, ride, chaos, nav, toast }
  constructor(o) {
    Object.assign(this, o);
    this.cx = CX; this.cy = CY; this.props = []; this.smashed = 0; this.away = 0;
    this.geos = {}; this.mats = {};
    this.build();
    this.nav?.places?.push({ id: "stuntpark", name: "Stunt Park", sub: "Ramps and things to smash · Times Square plaza", kind: "landmark", keywords: "stunt park ramps jump smash barrels sandbox playground", x: CX, y: CY, eye: [CX - 14, CY - 22, 8], target: [CX, CY, 1] });
  }

  mesh(kind) {
    const K = KINDS[kind];
    const m = new THREE.Mesh(this.geos[kind] ||= K.make(), this.mats[kind] ||= new THREE.MeshStandardMaterial({ color: K.color, roughness: 0.7 }));
    m.castShadow = true; m.raycast = () => {}; m.userData.traffic = true; this.scene.add(m); return m;
  }
  add(kind, x, y) {
    const K = KINDS[kind], mesh = this.mesh(kind), z0 = this.ground.h(x, y);
    const p = { kind, mesh, hx: x, hy: y, x, y, z: z0 + K.h / 2, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, spin: [0, 0], idle: 0, hit: false };
    mesh.position.set(x, p.z, -y); this.props.push(p); return p;
  }

  build() {
    // ramps: a small kicker from the west, a big one from the east (rise over run), each with a painted lip
    const ramps = [{ x: CX - 15, y: CY - 5, h: 0, len: 9, wid: 5.5, rise: 1.5 }, { x: CX + 17, y: CY + 3, h: Math.PI, len: 11, wid: 6.5, rise: 2.3 },
      { x: CX + 1, y: CY + 8.5, h: -Math.PI / 2, len: 7, wid: 4.5, rise: 1.0 }];
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 0.8 }), stripe = new THREE.MeshBasicMaterial({ color: 0xffd60a, toneMapped: false });
    for (const R of ramps) {
      this.ground.addRamp(R.x, R.y, R.h, R.len, R.wid, R.rise);
      const sh = new THREE.Shape(); sh.moveTo(-R.len / 2, 0); sh.lineTo(R.len / 2, 0); sh.lineTo(R.len / 2, R.rise); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: R.wid, bevelEnabled: false }); g.translate(0, 0, -R.wid / 2);
      const base = this.ground.h(R.x, R.y - 0), m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; m.raycast = () => {}; m.userData.traffic = true;   // not a wall: the ground map carries the ramp
      m.position.set(R.x, 0.17, -R.y); m.rotation.y = R.h;                           // local +x = up the ramp; three's y is flipped from the plan's
      this.scene.add(m);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, R.wid), stripe); lip.position.set(R.len / 2 - 0.2, R.rise + 0.03, 0); lip.raycast = () => {}; m.add(lip);
    }
    // props: a bowling triangle of barrels, a crate pyramid, bins in a row, and a cone slalom
    let row = 0; for (let r = 4; r >= 1; r--, row++) for (let i = 0; i < r; i++) this.add("barrel", CX - 3 + row * 1.1, CY - 2 + (i - (r - 1) / 2) * 1.1);
    for (let i = 0; i < 3; i++) this.add("crate", CX + 8, CY - 6 + i * 0.95);
    for (let i = 0; i < 2; i++) this.add("crate", CX + 8, CY - 5.5 + i * 0.95).z += 0.8;   // second layer (resting on the first)
    this.props[this.props.length - 1].z += 0; this.props.at(-2).z += 0;
    this.add("crate", CX + 8, CY - 5.0).z += 1.6;
    for (let i = 0; i < 5; i++) this.add("bin", CX - 24 + i * 1.6, CY + 9.5);
    for (let i = 0; i < 8; i++) this.add("cone", CX - 8 + i * 2.6, CY + (i % 2 ? 4 : -9));
    for (const p of this.props) { p.lift = p.z - (this.ground.h(p.x, p.y) + KINDS[p.kind].h / 2); p.mesh.position.set(p.x, p.z, -p.y); }
  }

  update(dt) {
    if (!this.placed && this.ground.built) { this.placed = true; this.reset(); }                // the ground is baked: stand everything on it
    const rd = this.ride; if (!rd.car) return;
    const P = rd.car.position, px = P.x, py = -P.z, near = Math.hypot(px - this.cx, py - this.cy);
    const driving = rd.state === "driving";
    const R = rd.vehicle?.kind === "bike" ? 0.6 : 1.25, vel = [Math.cos(rd.heading) * rd.v, Math.sin(rd.heading) * rd.v], air = rd.bikeAir || 0;
    const G = this.ground;
    for (const p of this.props) {
      const K = KINDS[p.kind], moving = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz) > 0.05 || p.z > G.h(p.x, p.y) + K.h / 2 + 0.02;
      p.lock = Math.max(0, (p.lock || 0) - dt);
      if (driving && near < 60 && !p.lock && Math.hypot(p.x - px, p.y - py) < R + K.r && air < K.h * 0.8 && Math.abs(rd.v) > 1.5) this.smash(p, vel, P);
      if (moving) {
        p.vz -= 9.81 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const floor = G.h(p.x, p.y) + K.h / 2;
        if (p.z < floor) {                                                             // bounce, lose energy, roll to a stop
          p.z = floor; if (p.vz < -1) { p.vz *= -0.35; p.vx *= 0.8; p.vy *= 0.8; } else p.vz = 0;
          p.vx *= Math.exp(-dt * 2.4); p.vy *= Math.exp(-dt * 2.4); p.spin[0] *= 0.97; p.spin[1] *= 0.97;
        }
        p.rx += p.spin[0] * dt; p.ry += p.spin[1] * dt;
        if (!p.hit) p.hit = true; p.idle = 0;
      } else p.idle += dt;
      p.mesh.position.set(p.x, p.z, -p.y);
      p.mesh.rotation.set(p.rx, 0, p.ry);
    }
    // props knock each other about (barrels in the bowling triangle go down like pins)
    for (let i = 0; i < this.props.length; i++) {
      const a = this.props[i]; if (a.vx === 0 && a.vy === 0 && a.vz === 0 && !a.hit) continue;
      for (let j = i + 1; j < this.props.length; j++) {
        const b = this.props[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), rr = KINDS[a.kind].r + KINDS[b.kind].r;
        if (d > rr || d < 1e-4 || Math.abs(a.z - b.z) > 0.9) continue;
        const nx = dx / d, ny = dy / d, rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel <= 0.2) continue;
        const ma = KINDS[a.kind].mass, mb = KINDS[b.kind].mass, jn = 1.4 * rel / (1 / ma + 1 / mb);
        a.vx -= jn * nx / ma; a.vy -= jn * ny / ma; b.vx += jn * nx / mb; b.vy += jn * ny / mb; b.vz += 1.2 + rel * 0.12;
        b.spin[0] += (Math.random() - 0.5) * 8; b.spin[1] += (Math.random() - 0.5) * 8; b.hit = true;
        const push = (rr - d) / 2; a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      }
    }
    // everything back where it was once the player has gone (or after a long calm)
    this.away = near > 140 ? this.away + dt : 0;
    if (this.props.every(p => p.idle > 25) && this.props.some(p => p.hit) || this.away > 8) this.reset();
  }

  smash(p, vel, P) {
    const K = KINDS[p.kind], rd = this.ride, sp = Math.max(4, Math.abs(rd.v));
    const dx = p.x - P.x, dy = p.y + P.z, d = Math.hypot(dx, dy) || 1;
    const f = sp * (1.05 + Math.random() * 0.3) / K.mass ** 0.4;
    p.vx = dx / d * f * 0.55 + vel[0] * 0.7 / K.mass ** 0.3; p.vy = dy / d * f * 0.55 + vel[1] * 0.7 / K.mass ** 0.3;
    p.vz = 2.5 + sp * 0.22 + Math.random() * 2; p.spin = [(Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18]; p.hit = true; p.idle = 0; p.lock = 0.8;
    rd.v *= 1 - 0.035 * K.mass;                                                       // a crate slows you more than a cone
    this.smashed++; this.onSmash?.(p.kind);
    this.chaos?.add(K.pts, p.kind === "crate" ? "CRATE!" : p.kind === "barrel" ? "Barrel!" : "Smash!", "smash");
    if (p.kind === "crate") rd.audio?.crash?.(new THREE.Vector3(p.x, 0.6, -p.y), 0.5, "concrete");
  }

  reset() {
    for (const p of this.props) { Object.assign(p, { x: p.hx, y: p.hy, z: this.ground.h(p.hx, p.hy) + KINDS[p.kind].h / 2 + (p.lift || 0), vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, spin: [0, 0], idle: 0, hit: false }); p.mesh.position.set(p.x, p.z, -p.y); p.mesh.rotation.set(0, 0, 0); }
  }
}
