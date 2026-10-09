// The ground's height, anywhere in Midtown, in one array lookup (no raycasts): baked once from the terrain meshes the district
// ships (TER_TS_Sidewalks / Roads / Plazas / Piers, the merged asphalt, the TKTS steps): every upward-facing triangle is scanline-rasterised
// onto a 1 m grid in the local frame (x, y = -z), keeping the highest surface per cell, so a kerb is a real step and a
// sidewalk is above the road.
//   h(x, y)                     the ground's height (m) at a point, 0 off the map
//   slope(x, y, hx, hy, len)    height difference over `len` metres along a heading (for pitch)
// Only ground: never cars, bikes, people or buildings (the old raycast hit those too, which lifted people onto car roofs).
// Used for vehicles (wheels on the ground, pitch and roll over a kerb), NPCs, and as the baseline for the walker.
import * as THREE from "three";

const CELL = 1;                                         // metres per cell
const Q = 0.02;                                         // height quantum: a Uint8 covers 0..5.1 m

export class GroundMap {
  // rect: [x0, y0, x1, y1] in the local frame (metres)
  constructor(rect = [-1800, -800, 1010, 800]) {
    this.rect = rect;
    this.nx = Math.ceil((rect[2] - rect[0]) / CELL); this.ny = Math.ceil((rect[3] - rect[1]) / CELL);
    this.grid = new Uint8Array(this.nx * this.ny);
    this.built = false;
  }

  // bake from the scene's terrain meshes; time-sliced so the page never hitches. Resolves when done.
  build(scene) {
    const meshes = [];
    scene.traverse(o => { if (o.isMesh && o.geometry && /^(TER_TS_(Sidewalks|Roads|Plazas|Piers)|MERGED_M_Road_Asphalt|BLD_TS_TKTSDuffySquare_[1-8]$)/.test(o.name)) meshes.push(o); });
    const jobs = [];
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      jobs.push({ m, pos: m.geometry.attributes.position, idx: m.geometry.index, mw: m.matrixWorld, i: 0, n: (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 });
    }
    this.tris = jobs.reduce((a, j) => a + j.n, 0);
    return new Promise(resolve => {
      let ji = 0;
      const t0 = performance.now();
      const step = () => {
        const until = performance.now() + 6;                 // 6 ms a slice
        while (ji < jobs.length && performance.now() < until) {
          const J = jobs[ji];
          for (let k = 0; k < 400 && J.i < J.n; k++, J.i++) this.tri(J, J.i);
          if (J.i >= J.n) ji++;
        }
        if (ji < jobs.length) setTimeout(step, 0);
        else { this.built = true; this.ms = Math.round(performance.now() - t0); resolve(this); }
      };
      step();
    });
  }

  tri(J, t) {
    const { pos, idx, mw } = J, a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const P = (i, out) => out.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mw);
    const A = P(a, _a), B = P(b, _b), C = P(c, _c);
    // world -> local frame (x, y = -z); the surface height is world y
    const ax = A.x, ay = -A.z, bx = B.x, by = -B.z, cx = C.x, cy = -C.z;
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-6) return;                                  // vertical (a kerb face) or degenerate
    if (!(A.y + B.y + C.y < 15)) return;                               // not ground (a roof, a bridge): the TKTS steps reach ~5 m
    // h(x, y) = A.y + gx (x - ax) + gy (y - ay), from the three corners
    const gx = ((B.y - A.y) * (cy - ay) - (C.y - A.y) * (by - ay)) / det;
    const gy = ((C.y - A.y) * (bx - ax) - (B.y - A.y) * (cx - ax)) / det;
    const [x0, y0] = this.rect, ymin = Math.min(ay, by, cy), ymax = Math.max(ay, by, cy);
    const r0 = Math.max(0, Math.floor((ymin - y0) / CELL)), r1 = Math.min(this.ny - 1, Math.floor((ymax - y0) / CELL));
    const ex = [[ax, ay, bx, by], [bx, by, cx, cy], [cx, cy, ax, ay]];
    for (let r = r0; r <= r1; r++) {
      const y = y0 + (r + 0.5) * CELL;
      let xl = Infinity, xr = -Infinity;
      for (const [px, py, qx, qy] of ex) {                              // where this row crosses the triangle's edges
        if ((py <= y && qy > y) || (qy <= y && py > y)) { const x = px + (y - py) / (qy - py) * (qx - px); if (x < xl) xl = x; if (x > xr) xr = x; }
      }
      if (xl > xr) continue;
      const c0 = Math.max(0, Math.ceil((xl - x0) / CELL - 0.5)), c1 = Math.min(this.nx - 1, Math.floor((xr - x0) / CELL - 0.5));
      for (let col = c0; col <= c1; col++) {
        const x = x0 + (col + 0.5) * CELL;
        const q = Math.max(0, Math.min(254, Math.round((A.y + gx * (x - ax) + gy * (y - ay)) / Q)));
        const i = r * this.nx + col;
        if (q > this.grid[i]) this.grid[i] = q;
      }
    }
  }

  inside(x, y) { return x >= this.rect[0] && x < this.rect[2] && y >= this.rect[1] && y < this.rect[3]; }
  // the ground at (x, y), metres; 0 where there is none
  h(x, y) {
    if (!this.inside(x, y)) return 0;
    return this.grid[Math.floor((y - this.rect[1]) / CELL) * this.nx + Math.floor((x - this.rect[0]) / CELL)] * Q;
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
