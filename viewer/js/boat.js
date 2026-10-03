// The Hudson sightseeing boat (export/vehicles/sightseeing_boat.glb, built by scripts/blender/vehicles/build_sightseeing_boat.py)
// berths on the south side of Pier 83 (W 42nd St), casts off, cruises up the Hudson past the Intrepid, turns, comes back
// down the river and berths again: a ~7 minute loop plus a 90 s stop, day and night (saloon windows glow after dark).
// Its two top-deck railing banners are a sellable ad slot (boat.hudson.side). Coordinates: Blender local metres.
import * as THREE from "three";

const B = (x, y, z) => new THREE.Vector3(x, z, -y);
const WATER = -1.8;                                    // the Hudson surface (TER_TS_Water_Hudson)
export const BOAT_SLOT = "boat.hudson.side";
export const BOAT_CRUISE = 5.2;
const BERTH = [-1560, -208.8];                         // alongside Pier 83's south face, bow to the river (west)
// cast off west, up the far lane (clear of the Intrepid and Pier 86), round at W 56th, down the near lane, east along
// y -262, a U-turn clear of the small stub piers, and a slow glide west into the berth
const ROUTE = [[-1560, -208.8], [-1610, -209.5], [-1655, -214], [-1700, -180], [-1722, -100], [-1726, 100], [-1726, 400],
  [-1722, 560], [-1710, 625], [-1690, 642], [-1678, 610], [-1688, 560], [-1690, 300], [-1690, 0], [-1690, -150], [-1680, -235],
  [-1640, -264], [-1560, -264], [-1525, -258], [-1494, -236], [-1496, -214], [-1515, -208.8], [-1560, -208.8]];
const CRUISE = 5.2, SLOW = 1.6, DWELL = 90;            // m/s (about 10 knots), harbour speed, seconds at the pier

export class Boat {
  constructor(o) {
    // o: { root, scene, loader, registerMaterial, screens, demoArt, pickables, audio }
    Object.assign(this, o);
    this.buildPath();
    this.s = 0; this.v = 0; this.wait = 20; this.t = 0;   // starts at the pier, leaves 20 s after you arrive
    this.ready = this.load();
  }

  // Catmull-Rom through the waypoints, resampled every metre: position, heading and a speed limit per metre
  buildPath() {
    const P = ROUTE, pts = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      for (let k = 0; k < 20; k++) {
        const t = k / 20, t2 = t * t, t3 = t2 * t;
        pts.push([0, 1].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
      }
    }
    pts.push(P[P.length - 1]);
    const cum = [0];                                    // resample to exactly 1 m steps along the curve
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const out = [];
    for (let d = 0, j = 0; d <= cum[cum.length - 1]; d += 1) {
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      const f = (d - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]);
    }
    out.push(pts[pts.length - 1]);
    this.pts = out; this.len = out.length - 1;
    this.head = out.map((p, i) => { const q = out[Math.min(out.length - 1, i + 1)], r = out[Math.max(0, i - 1)]; return Math.atan2(q[1] - r[1], q[0] - r[0]); });
    // turn rate per metre -> slower through bends; harbour speed for the first 70 m and the last 110 m
    this.limit = out.map((p, i) => {
      let dh = this.head[Math.min(out.length - 1, i + 6)] - this.head[Math.max(0, i - 6)];
      while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      const bend = Math.abs(dh) / 12;
      let v = Math.min(CRUISE, Math.max(2.2, 0.9 / Math.max(bend, 1e-3)));
      if (i < 70) v = Math.min(v, SLOW + (CRUISE - SLOW) * i / 70);
      const left = this.len - i;
      if (left < 110) v = Math.min(v, Math.max(0.35, SLOW * left / 60));
      return v;
    });
  }

  async load() {
    const g = await new Promise((res, rej) => this.loader.load(`${this.root}export/vehicles/sightseeing_boat.glb`, res, undefined, rej));
    this.group = new THREE.Group(); this.group.name = "BOAT";
    this.group.add(g.scene);
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      for (const m of [].concat(o.material)) {
        this.registerMaterial?.(m);
        if (m.name === "MAT_SLOT_" + BOAT_SLOT) {           // the railing banners: a screen like any other
          const c = document.createElement("canvas"); c.width = 1024; c.height = 128;
          const x = c.getContext("2d");
          x.fillStyle = "#fbfbf7"; x.fillRect(0, 0, 1024, 128);
          x.fillStyle = "#0a84ff"; x.font = "800 74px -apple-system, Helvetica, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
          x.fillText("YOUR BRAND HERE", 512, 68);
          const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
          m.map = null; m.color?.set(0x202020); m.emissive?.set(0xffffff); m.emissiveIntensity = 1.4; m.emissiveMap = tex; m.needsUpdate = true;
          this.screens?.add(BOAT_SLOT, m);
          const art = this.demoArt?.("8x1") || [];
          if (art.length) this.screens?.setPlaylist(BOAT_SLOT, art);
          o.userData.slot_id = BOAT_SLOT;
          this.pickables?.push(o);
        }
      }
    });
    this.group.add(this.wake());
    this.scene.add(this.group);
    this.place(0);
  }

  // a soft V of foam behind the stern and a bow wave; fades with speed
  wake() {
    const c = document.createElement("canvas"); c.width = 128; c.height = 512;
    const x = c.getContext("2d");
    for (let i = 0; i < 260; i++) {                      // two diverging bands of streaks
      const t = Math.random(), side = Math.random() < 0.5 ? -1 : 1, y = t * 512;
      const xx = 64 + side * (8 + t * 54) + (Math.random() - 0.5) * 10;
      x.fillStyle = `rgba(255,255,255,${0.5 * (1 - t) * Math.random()})`;
      x.fillRect(xx, y, 2 + Math.random() * 4, 6 + Math.random() * 14);
    }
    const g = x.createLinearGradient(0, 0, 0, 512);       // the churned prop wash down the middle
    g.addColorStop(0, "rgba(255,255,255,.55)"); g.addColorStop(0.35, "rgba(235,245,250,.18)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(52, 0, 24, 512);
    const tex = new THREE.CanvasTexture(c);
    this.wakeMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 90).rotateX(-Math.PI / 2), this.wakeMat);
    m.position.set(0, 0.06, 25 + 45);                     // behind the transom (three +Z is aft)
    m.renderOrder = 2; m.raycast = () => {};
    return m;
  }

  at(s) {
    const i = Math.max(0, Math.min(this.len, s)), i0 = Math.floor(i), i1 = Math.min(this.len, i0 + 1), f = i - i0;
    const [ax, ay] = this.pts[i0], [bx, by] = this.pts[i1];
    let h0 = this.head[i0], h1 = this.head[i1]; if (h1 - h0 > Math.PI) h1 -= 2 * Math.PI; if (h0 - h1 > Math.PI) h1 += 2 * Math.PI;
    return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, h: h0 + (h1 - h0) * f, lim: this.limit[i0] };
  }

  place(dt) {
    const q = this.at(this.s);
    this.placePose(q, this.at(this.s + 8).h - q.h, this.v);
  }

  // q: {x, y, h} (Blender local, heading in radians); turn: heading change over the next ~8 m (heel); v: speed
  placePose(q, turn, v) {
    const t = this.t;
    // gentle swell: a slow heave, roll and pitch; heel outward a little in turns
    const roll = 0.012 * Math.sin(t * 0.7) - THREE.MathUtils.clamp(turn, -0.4, 0.4) * 0.06 * (Math.abs(v) / CRUISE);
    const pitch = 0.006 * Math.sin(t * 0.53 + 1.3);
    this.group.position.copy(B(q.x, q.y, WATER + 0.05 * Math.sin(t * 0.9)));
    this.group.rotation.set(pitch, q.h - Math.PI / 2, roll, "YXZ");
    this.wakeMat.opacity = Math.min(0.85, Math.max(0, v) / CRUISE);
    this.pose = q;
  }

  // back into service after someone had the helm: on its berth at Pier 83, next departure after the usual stop
  resume() { this.manual = false; this.s = 0; this.v = 0; this.wait = DWELL; this.place(0); }

  // a clear view of the railing banner (for the sales sheet): abeam, from slightly above the water
  bannerView() {
    if (!this.pose) return null;
    const { x, y, h } = this.pose, sx = Math.sin(h), sy = -Math.cos(h);          // starboard side
    const cx = x - Math.cos(h) * 6, cy = y - Math.sin(h) * 6;                    // the banners sit a little aft of amidships
    return { eye: [cx + sx * 45, cy + sy * 45, 14], target: [cx, cy, 7] };
  }

  update(dt) {
    if (!this.group) return;
    this.t += dt;
    if (this.manual) return;                             // someone has the helm (js/helm.js drives placePose)
    if (this.hold?.()) { this.v = Math.max(0, this.v - dt); this.place(dt); return; }   // idles while a buyer looks at it
    if (this.wait > 0) {                                 // at the pier: passengers off and on
      this.wait -= dt; this.v = 0;
      if (this.wait <= 0) this.s = 0;
    } else {
      const lim = this.at(this.s).lim;
      this.v += THREE.MathUtils.clamp(lim - this.v, -0.35 * dt, 0.25 * dt);   // a heavy boat: slow to speed up and to stop
      this.s += this.v * dt;
      if (this.s >= this.len - 0.2) { this.s = this.len; this.v = 0; this.wait = DWELL; }
    }
    this.place(dt);
    this.audio?.setPlane?.("boat", this.v > 0.3 ? 0.25 + 0.25 * this.v / CRUISE : 0.12, this.group.position, 25);   // diesel drone
  }
}
