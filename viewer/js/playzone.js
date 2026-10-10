// Stunt Park (Goat Simulator / BeamNG energy): a sandbox on the Times Square plaza with real ramps (stamped into the ground height map, so
// wheels climb them and vehicles launch off the lip) and ~50 breakable props: barrels in a bowling triangle, a crate pyramid, bins, cones.
// Hit a prop and it goes flying with spin and bounces off the other props; every smash scores in the chaos chain; they reset when you leave.
// No people are involved: the props are the comedy.
import * as THREE from "three";

const KINDS = {
  barrel: { r: 0.32, h: 0.9, pts: 30, mass: 1.0, make: () => new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), color: 0x2a6fb3 },
  crate: { r: 0.45, h: 0.8, pts: 45, mass: 1.6, make: () => new THREE.BoxGeometry(0.8, 0.8, 0.8), color: 0xb98a4b },
  bin: { r: 0.36, h: 1.0, pts: 25, mass: 0.8, make: () => new THREE.CylinderGeometry(0.34, 0.3, 1.0, 12), color: 0x2f8f4a },
  cone: { r: 0.3, h: 0.9, pts: 15, mass: 0.35, make: () => new THREE.ConeGeometry(0.34, 0.9, 12), color: 0xff6a00 },
};

// where the parks stand: the Times Square plaza (fixed) and four more across the map, each snapped to the nearest free flat 44 x 24 m patch
const SITES = [
  { id: "cross", name: "Stunt Park", at: [-20, 92], fixed: true, variant: 0, sub: "Times Square plaza" },
  { id: "hudson", name: "Pier Jump", at: [-1400, -300], variant: 1, sub: "Hudson River Park" },
  { id: "back", name: "Backstreet Bowl", at: [-823, 75], variant: 3, sub: "Hell's Kitchen" },
  { id: "east", name: "East Side Stunts", at: [739, 394], variant: 2, sub: "Midtown East" },
  { id: "gate", name: "Park Gate Skatepark", at: [273, 631], variant: 1, sub: "Central Park's south edge" },
];

export class PlayZone {
  // o: { scene, ground, ride, chaos, nav, collider: () => collider }
  constructor(o) {
    Object.assign(this, o);
    this.props = []; this.ramps = []; this.sites = []; this.smashed = 0; this.away = 0;
    this.geos = {}; this.mats = {};
    this.pending = SITES.map(s => ({ ...s }));
  }

  // build the parks once the ground map and the collider exist (the free patch is found by scanning them)
  tryBuild() {
    const col = this.collider?.(), G = this.ground;
    if (!G?.built || !col) return;
    const free = (cx, cy) => { for (let dx = -22; dx <= 22; dx += 3) for (let dy = -12; dy <= 12; dy += 3) { const x = cx + dx, y = cy + dy, h = G.h(x, y); if (col.blocked(x, y, 0.8, 0.3) || h > 0.3 || h < -0.01) return false; } return true; };
    for (const site of this.pending) {
      let c = site.at;
      if (!site.fixed) { c = null; for (let r = 0; r <= 420 && !c; r += 10) for (let a = 0; a < 360 && !c; a += 30) { const x = site.at[0] + Math.cos(a * Math.PI / 180) * r, y = site.at[1] + Math.sin(a * Math.PI / 180) * r; if (free(x, y)) c = [x, y]; } }
      if (!c) continue;
      site.cx = c[0]; site.cy = c[1]; this.buildSite(site); this.sites.push(site);
      this.nav?.places?.push({ id: "stuntpark_" + site.id, name: site.name, sub: `Ramps and things to smash · ${site.sub}`, kind: "landmark", keywords: "stunt park ramps jump smash barrels sandbox playground skatepark", x: site.cx, y: site.cy, eye: [site.cx - 14, site.cy - 22, 8], target: [site.cx, site.cy, 1] });
      if (site.id === "cross") this.nav?.places?.push({ id: "stuntpark", name: "Stunt Park", sub: site.sub, kind: "landmark", keywords: "stunt park", x: site.cx, y: site.cy, eye: [site.cx - 14, site.cy - 22, 8], target: [site.cx, site.cy, 1] });
    }
    this.pending = this.pending.filter(s => !s.cx);
    if (this.sites.length) this.onBuilt?.(this.sites);
  }

  mesh(kind) {
    const K = KINDS[kind];
    const m = new THREE.Mesh(this.geos[kind] ||= K.make(), this.mats[kind] ||= new THREE.MeshStandardMaterial({ color: K.color, roughness: 0.7 }));
    m.castShadow = true; m.raycast = () => {}; m.userData.traffic = true; this.scene.add(m); return m;
  }
  add(kind, x, y, site, lift = 0) {
    const K = KINDS[kind], mesh = this.mesh(kind), z0 = this.ground.h(x, y);
    const p = { kind, mesh, site: site.id, hx: x, hy: y, x, y, z: z0 + K.h / 2 + lift, lift, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, spin: [0, 0], idle: 0, hit: false };
    mesh.position.set(x, p.z, -y); this.props.push(p); return p;
  }

  buildSite(site) {
    const CX = site.cx, CY = site.cy, v = site.variant;
    const R = (dx, dy, h, len, wid, rise) => ({ x: CX + dx, y: CY + dy, h, len, wid, rise });
    const ramps = v === 0 ? [R(-15, -5, 0, 9, 5.5, 1.5), R(17, 3, Math.PI, 11, 6.5, 2.3), R(1, 8.5, -Math.PI / 2, 7, 4.5, 1.0)]
      : v === 1 ? [R(-16, -6, 0, 8, 5, 1.3), R(-16, 1, 0, 9, 5, 1.8), R(-16, 8, 0, 10, 5, 2.4)]                    // three kickers side by side, small to big
      : v === 2 ? [R(-14, 0, 0, 11, 6.5, 2.3), R(14, 0, Math.PI, 11, 6.5, 2.3)]                                      // two big ramps facing each other
      : [R(-10, -7, 0, 7, 4.5, 1.1), R(10, 7, Math.PI, 7, 4.5, 1.1), R(10, -7, Math.PI / 2, 7, 4.5, 1.1), R(-10, 7, -Math.PI / 2, 7, 4.5, 1.1)];   // a bowl of four
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 0.8 }), stripe = new THREE.MeshBasicMaterial({ color: 0xffd60a, toneMapped: false });
    this.ramps.push(...ramps);
    for (const r of ramps) {
      const base = this.ground.h(r.x, r.y);                                                // the ground it stands on (before the ramp is stamped in)
      this.ground.addRamp(r.x, r.y, r.h, r.len, r.wid, r.rise);
      const sh = new THREE.Shape(); sh.moveTo(-r.len / 2, 0); sh.lineTo(r.len / 2, 0); sh.lineTo(r.len / 2, r.rise); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: r.wid, bevelEnabled: false }); g.translate(0, 0, -r.wid / 2);
      const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; m.raycast = () => {}; m.userData.traffic = true;   // not a wall: the ground map carries the ramp
      m.position.set(r.x, base + 0.01, -r.y); m.rotation.y = r.h;                                          // local +x = up the ramp
      this.scene.add(m);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, r.wid), stripe); lip.position.set(r.len / 2 - 0.2, r.rise + 0.03, 0); lip.raycast = () => {}; m.add(lip);
    }
    const A = (k, dx, dy, lift) => this.add(k, CX + dx, CY + dy, site, lift);
    if (v === 0 || v === 3) { let row = 0; for (let r = 4; r >= 1; r--, row++) for (let i = 0; i < r; i++) A("barrel", -3 + row * 1.1, -2 + (i - (r - 1) / 2) * 1.1); }      // a bowling triangle
    if (v === 0) { for (let i = 0; i < 3; i++) A("crate", 8, -6 + i * 0.95); A("crate", 8, -5.5, 0.8); A("crate", 8, -4.5, 0.8); A("crate", 8, -5.0, 1.6); for (let i = 0; i < 5; i++) A("bin", -24 + i * 1.6, 9.5); for (let i = 0; i < 8; i++) A("cone", -8 + i * 2.6, i % 2 ? 4 : -9); }
    if (v === 1) { for (let i = 0; i < 6; i++) { A("crate", 6, -7 + i * 2.4); if (i % 2) A("crate", 6, -7 + i * 2.4, 0.8); } for (let r = 3; r >= 1; r--) for (let i = 0; i < r; i++) A("barrel", 12 + (3 - r) * 1.1, -1 + (i - (r - 1) / 2) * 1.1); for (let i = 0; i < 6; i++) A("cone", -2 + i * 2.2, i % 2 ? 6 : -9); }
    if (v === 2) { for (let r = 0; r < 3; r++) for (let i = 0; i < 3 - r; i++) { A("crate", -1 + i * 0.95 + r * 0.47, -1, r * 0.8); A("crate", -1 + i * 0.95 + r * 0.47, 0.5, r * 0.8); } for (let i = 0; i < 8; i++) A("bin", -7 + i * 2, 8); for (let i = 0; i < 8; i++) A("cone", -7 + i * 2, -8); }
    if (v === 3) { for (let i = 0; i < 6; i++) A("cone", -6 + i * 2.4, 0.4 + (i % 2 ? 1.5 : -1.5)); for (let i = 0; i < 4; i++) A("bin", -4 + i * 2.6, -11); }
    for (const p of this.props) if (p.site === site.id) { p.lift = p.z - (this.ground.h(p.x, p.y) + KINDS[p.kind].h / 2); p.mesh.position.set(p.x, p.z, -p.y); }
  }

  update(dt) {
    if (this.pending.length) { this.tryBuild(); if (!this.pending.length) this.reset(); }
    const rd = this.ride; if (!rd.car) return;
    const P = rd.car.position, px = P.x, py = -P.z, near = this.sites.length ? Math.min(...this.sites.map(t => Math.hypot(px - t.cx, py - t.cy))) : 1e9;
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
    this.smashed++; this.onSmash?.(p.kind, p.site);
    this.chaos?.add(K.pts, p.kind === "crate" ? "CRATE!" : p.kind === "barrel" ? "Barrel!" : "Smash!", "smash");
    if (p.kind === "crate") rd.audio?.crash?.(new THREE.Vector3(p.x, 0.6, -p.y), 0.5, "concrete");
  }

  // solid for people on foot: the ramps (you can't walk up the wedge) and every prop standing still (you can't walk through a barrel)
  blockers() {
    const out = (this.ramps || []).map(R => [R.x, R.y, R.h, R.len / 2, R.wid / 2, 0]);
    for (const p of this.props) if (Math.abs(p.vx) + Math.abs(p.vy) < 0.3 && p.vz === 0) out.push([p.x, p.y, 0, KINDS[p.kind].r, KINDS[p.kind].r, 0]);
    return out;
  }

  reset() {
    for (const p of this.props) { Object.assign(p, { x: p.hx, y: p.hy, z: this.ground.h(p.hx, p.hy) + KINDS[p.kind].h / 2 + (p.lift || 0), vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, spin: [0, 0], idle: 0, hit: false }); p.mesh.position.set(p.x, p.z, -p.y); p.mesh.rotation.set(0, 0, 0); }
  }
}
