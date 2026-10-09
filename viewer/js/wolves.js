// Wolf Hunt (Spider-Man's backpacks / Astro Bot's bots / Roblox collectibles): 30 golden wolves hidden on sidewalks and plazas across the
// whole of Midtown, the same 30 every time. Walk or ride into one to collect it. They only show on the map when you are within 250 m (the
// "tracker"), so finding them means going everywhere. Placeholder model: a spinning gold gem on a ring (the wolf mascot art comes later).
import * as THREE from "three";
const KEY = "ts.wolves.v1", N_MID = 30, N_DOWN = 20, N = N_MID + N_DOWN, SEP = 130;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

export class Wolves {
  // o: { scene, ground, collider: () => collider, pos: () => {x, y} | null, chaos, pop(text), toast, mapSets: () => [data...], onFound(count) }
  constructor(o) {
    Object.assign(this, o);
    this.found = new Set(load()); this.list = []; this.t = 0; this.placed = false;
    this.build();
    setInterval(() => this.tick(0.25), 250);
    this.frame();
  }
  get count() { return this.found.size; }

  place() {
    const col = this.collider(), G = this.ground; if (!col || !G.built || (this.harbor && !this.harbor.land)) return false;
    let seed = 20261010; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;          // the same wolves for everyone
    const pts = []; let tries = 0;
    while (pts.length < N_MID && tries++ < 20000) {
      const x = -1600 + rnd() * 2500, y = -650 + rnd() * 1300, h = G.h(x, y);
      if (h < 0.1 || h > 0.3 || col.blocked(x, y, 1.0, 0.3)) continue;
      if (pts.some(p => Math.hypot(p[0] - x, p[1] - y) < SEP)) continue;
      pts.push([Math.round(x), Math.round(y)]);
    }
    const H = this.harbor;                                                        // downtown and the islands: the harbour's land, between the towers
    if (H?.land) { tries = 0; while (pts.length < N && tries++ < 60000) {
      const x = -900 + rnd() * 2400, y = -1100 - rnd() * 8000;
      if (!H.isLand(x, y) || H.topAt(x, y) > 1 || pts.some(p => Math.hypot(p[0] - x, p[1] - y) < SEP * 2)) continue;
      let clear = true; for (let k = 0; k < 8 && clear; k++) if (H.topAt(x + Math.cos(k * 0.785) * 6, y + Math.sin(k * 0.785) * 6) > 1) clear = false;   // on open ground, not against a tower
      if (clear) pts.push([Math.round(x), Math.round(y)]);
    } }
    this.list = pts.map((p, i) => {
      const g = new THREE.Group();
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0xaa7a00, emissiveIntensity: 1.2, metalness: 0.8, roughness: 0.25 }));
      gem.position.y = 1.5; gem.scale.set(1, 1.4, 1);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffe08a, toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.15;
      g.add(gem, ring); g.position.set(p[0], 0, -p[1]); g.traverse(o => { o.raycast = () => {}; o.userData.traffic = true; }); g.visible = false; this.scene.add(g);
      return { id: i, x: p[0], y: p[1], g, gem, got: this.found.has(i) };
    });
    this.placed = true; return true;
  }

  tick() {
    if (!this.placed && !this.place()) return;
    const p = this.pos?.(); if (!p) return;
    const G = this.ground;
    for (const w of this.list) {
      if (w.got) { w.g.visible = false; continue; }
      const d = Math.hypot(w.x - p.x, w.y - p.y);
      w.g.visible = d < 220; if (w.g.visible) w.g.position.y = G.inside(w.x, w.y) ? G.h(w.x, w.y) : 0;
      if (d < 3.2) this.collect(w);
    }
    if (performance.now() > (this.pinT || 0)) { this.pinT = performance.now() + 1500; this.pins(p); }
    this.paint();
  }

  collect(w) {
    w.got = true; this.found.add(w.id); save([...this.found]); w.g.visible = false;
    const n = this.found.size;
    this.chaos.s.total += 500; this.chaos.s.best = Math.max(this.chaos.s.best, this.chaos.s.total);
    this.pop?.(`GOLDEN WOLF ${n}/${N}  +500`);
    if (n === N) { this.chaos.s.total += 10000; this.toast?.("All 50 golden wolves found! +10,000 bonus"); }
    this.onFound?.(n); this.pins(this.pos?.()); this.paint();
  }

  pins(p) {                                                    // the tracker: unfound wolves within 250 m show on the map
    const markers = p ? this.list.filter(w => !w.got && Math.hypot(w.x - p.x, w.y - p.y) < 250).map(w => ({ id: "wolf_" + w.id, icon: "wolf", label: "Golden wolf", x: w.x, y: w.y, minS: 0.4, wolf: true })) : [];
    for (const d of this.mapSets() || []) if (d?.markers) { d.markers = d.markers.filter(m => !m.wolf); d.markers.push(...markers); }
  }

  nearest() { const p = this.pos?.(); if (!p) return null; return this.list.filter(w => !w.got).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] || null; }

  frame() {                                                    // spin and bob (cheap, only the visible ones)
    const t = performance.now() / 1000;
    for (const w of this.list) if (w.g.visible) { w.gem.rotation.y = t * 1.8; w.gem.position.y = 1.5 + Math.sin(t * 2 + w.id) * 0.12; }
    requestAnimationFrame(() => this.frame());
  }

  build() {
    this.el = document.createElement("div");
    this.el.style.cssText = "position:fixed;left:12px;top:calc(100px + env(safe-area-inset-top));z-index:25;padding:5px 10px;border-radius:999px;background:rgba(20,20,24,.72);border:1px solid rgba(255,255,255,.2);color:#ffd86a;font:700 12px system-ui,sans-serif;backdrop-filter:blur(8px);pointer-events:none";
    document.body.appendChild(this.el);
  }
  paint() { this.el.textContent = `🐺 ${this.found.size}/${N}`; }
}
