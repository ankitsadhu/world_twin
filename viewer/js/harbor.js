// New York Harbor scenery: Lower Manhattan, the Jersey City / Hoboken waterfront, Brooklyn's edge, Governors, Ellis and
// Liberty Islands, and the Statue of Liberty (export/harbor/*, built by scripts/tools/prep_harbor.py +
// scripts/blender/build_harbor.py + scripts/blender/heroes/statue_of_liberty.py). Same local frame as Times Square.
// Also answers "is this land / a pier / inside a tower?" for boats and planes (data/harbor/collide.json).
import * as THREE from "three";

const B = (x, y, z) => new THREE.Vector3(x, z, -y);
const GRID_ROT = 29;                                         // local +Y = 29 deg east of true north
const CELL = 100;

export class Harbor {
  constructor(o) {
    // o: { root, scene, loader, loadChunk, registerMaterial }
    Object.assign(this, o);
    this.ready = fetch(`${o.root}data/harbor/collide.json`).then(r => r.json()).then(d => this.index(d)).catch(() => null);
  }

  index(d) {
    const ring = f => { const pts = []; for (let i = 0; i < f.length; i += 2) pts.push([f[i], f[i + 1]]); return pts; };
    const bbox = pts => pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [1e9, 1e9, -1e9, -1e9]);
    this.frame = ring(d.frame);
    this.land = d.land.map(ring).map(pts => ({ pts, box: bbox(pts) }));
    this.piers = d.piers.map(ring).map(pts => ({ pts, box: bbox(pts) }));
    this.statue = d.statue;
    this.grid = new Map();                                    // buildings by 100 m cell
    for (const b of d.buildings) {
      const pts = ring(b.slice(1)), bx = bbox(pts), rec = { h: b[0], pts, box: bx };
      for (let cx = Math.floor(bx[0] / CELL); cx <= Math.floor(bx[2] / CELL); cx++)
        for (let cy = Math.floor(bx[1] / CELL); cy <= Math.floor(bx[3] / CELL); cy++) {
          const k = cx + "," + cy; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(rec);
        }
    }
    this.pierEdges = this.piers.map(p => ({ box: p.box, pts: p.pts, edges: edges(p.pts) }));
    // seawalls and island docks (Liberty Island's ferry dock is part of its shoreline): straight land edges a boat can
    // lie alongside, each with its normal turned to face the water
    this.landFaces = this.land.map(l => ({ box: l.box, pts: l.pts, edges: edges(l.pts).filter(e => e.len >= 25).map(e => {
      const mx = e.ax + e.dx * e.len / 2, my = e.ay + e.dy * e.len / 2;
      return this.isLand(mx + e.nx * 3, my + e.ny * 3) ? { ...e, nx: -e.nx, ny: -e.ny } : e;
    }) }));
    return this;
  }

  inFrame(x, y) { return !!this.frame && inside(this.frame, x, y); }
  isLand(x, y) { return !!this.land?.some(l => x >= l.box[0] && x <= l.box[2] && y >= l.box[1] && y <= l.box[3] && inside(l.pts, x, y)); }
  isPier(x, y) { return !!this.piers?.some(p => x >= p.box[0] && x <= p.box[2] && y >= p.box[1] && y <= p.box[3] && inside(p.pts, x, y)); }
  // height of whatever stands at (x, y): a building's roof, the Statue (93 m), or 0
  topAt(x, y) {
    if (this.statue) {
      const d = Math.hypot(x - this.statue[0], y - this.statue[1]);
      if (d < 7) return 93; if (d < 15) return 47;              // the statue on her pedestal
    }
    let top = 0;
    for (const b of this.grid?.get(Math.floor(x / CELL) + "," + Math.floor(y / CELL)) || [])
      if (b.h > top && x >= b.box[0] && x <= b.box[2] && y >= b.box[1] && y <= b.box[3] && inside(b.pts, x, y)) top = b.h;
    return top;
  }

  // ---------------------------------------------------------------- scenery
  async load() {
    await Promise.all(["export/harbor/land.glb", "export/harbor/buildings.glb"].map(p => this.loadChunk(p).catch(e => console.warn(p, e))));
    await this.ready;
    const g = await new Promise((res, rej) => this.loader.load(`${this.root}export/harbor/liberty.glb`, res, undefined, rej));
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; [].concat(o.material).forEach(m => this.registerMaterial?.(m)); } });
    // she faces the Narrows, bearing ~135 deg true; the model faces +Y
    const bearing = 135, a = THREE.MathUtils.degToRad(bearing - GRID_ROT);
    const [sx, sy] = this.statue || [-643.6, -9108.0];
    g.scene.position.copy(B(sx, sy, 0));
    g.scene.rotation.y = -a;                                    // turns the model's +Y onto (sin a, cos a)
    g.scene.name = "LIBERTY";
    this.scene.add(g.scene);
    this.liberty = g.scene;
  }
}

function edges(pts) {
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return { ax: a[0], ay: a[1], dx: dx / len, dy: dy / len, nx: dy / len, ny: -dx / len, len };
  });
}

function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
