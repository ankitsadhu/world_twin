// 2D footprint collision (baked by scripts/tools/build_collision2d.py). Coordinates: Blender local metres.
// Walkers / cars slide along walls; aircraft only collide when below a building's roof height.
export class Collider {
  constructor(data) {
    this.cell = data.cell;
    this.polys = data.polys;
    this.grid = new Map(Object.entries(data.grid));
    for (const p of this.polys) {          // cache bounding boxes
      const xs = p.pts.map(q => q[0]), ys = p.pts.map(q => q[1]);
      p.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
  }

  near(x, y, r) {
    const out = new Set(), c = this.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++)
      for (let cy = Math.floor((y - r) / c); cy <= Math.floor((y + r) / c); cy++)
        for (const i of this.grid.get(`${cx},${cy}`) || []) out.add(i);
    return out;
  }

  // true if a circle (x, y, r) at height z overlaps a polygon taller than z. onFoot: piers over the river are walkable
  // (this.walkable(x, y) says where), the river around them is not
  blocked(x, y, r = 0.35, z = 0, onFoot = false) {
    if (this.outside && !(x > -1750 && x < 960 && y > -720 && y < 740)) return this.outside(x, y, z);   // beyond Midtown: the harbour
    if (onFoot && z > 10 && this.deck && this.deck(x, y) === false && this.deck(x, y, true)) return true;   // a ship's deck edge
    const pier = onFoot && p_kindWater(this, x, y, r) && this.walkable?.(x, y);
    for (const i of this.near(x, y, r)) {
      const p = this.polys[i];
      if (z >= p.h || p.kind === "raised") continue;            // raised = walkable (the red steps)
      if (pier && p.kind === "water") continue;
      const [x0, y0, x1, y1] = p.box;
      if (x < x0 - r || x > x1 + r || y < y0 - r || y > y1 + r) continue;
      if (inside(p.pts, x, y) || edgeDist(p.pts, x, y) < r) return true;
    }
    return false;
  }

  // the building whose footprint contains (x, y), or the closest one within r metres (taps land on walls)
  buildingAt(x, y, r = 1.5) {
    let best = null, bd = r;
    for (const i of this.near(x, y, r)) {
      const p = this.polys[i];
      if (p.kind !== "building") continue;
      if (inside(p.pts, x, y)) return p;
      const d = edgeDist(p.pts, x, y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // is the straight line a -> b ([x, y, z] each) cut by any building other than `skip`?
  lineBlocked(a, b, skip) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4);
    for (let k = 1; k < n; k++) {
      const t = k / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      for (const i of this.near(x, y, 0)) {
        const p = this.polys[i];
        if (p === skip || p.kind !== "building" || z >= p.h) continue;
        const [x0, y0, x1, y1] = p.box;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && inside(p.pts, x, y)) return true;
      }
    }
    return false;
  }

  // inside a raised walkable area (the TKTS red steps)?
  raisedAt(x, y) {
    for (const i of this.near(x, y, 0)) {
      const p = this.polys[i];
      if (p.kind === "raised" && inside(p.pts, x, y)) return p;
    }
    return null;
  }

  // try to move from (x, y) by (dx, dy); slide along walls. Returns [nx, ny].
  move(x, y, dx, dy, r = 0.35, z = 0, onFoot = false) {
    if (!this.blocked(x + dx, y + dy, r, z, onFoot)) return [x + dx, y + dy];
    if (!this.blocked(x + dx, y, r, z, onFoot)) return [x + dx, y];
    if (!this.blocked(x, y + dy, r, z, onFoot)) return [x, y + dy];
    return [x, y];
  }
}

function p_kindWater(c, x, y, r) {          // is (x, y) within a river polygon at all (cheap pre-check)
  for (const i of c.near(x, y, r)) if (c.polys[i].kind === "water") return true;
  return false;
}

function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function edgeDist(pts, x, y) {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L));
    best = Math.min(best, Math.hypot(ax + vx * t - x, ay + vy * t - y));
  }
  return best;
}
