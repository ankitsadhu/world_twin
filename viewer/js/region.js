// The wider New York region a plane flies over: flat land from the real coastline (Midtown and the harbour draw their
// detailed ground on top of it) and the real airports a small plane uses - Teterboro, LaGuardia, Newark - with their
// runways (real headings and lengths, painted numbers, centreline and threshold markings), taxiways, aprons, terminals
// and hangars. Data: data/region/region.json (scripts/tools/prep_region.py, OpenStreetMap).
// Coordinates: Blender local metres (x, y), three.js (x, z = -y).
import * as THREE from "three";

const Z_LAND = -0.35, Z_PAVE = -0.25, Z_MARK = -0.22;
const CELL = 50;                                                  // land / water raster for collision (metres)

export class Region {
  // skip(x, y): true where a detailed district draws its own ground and buildings (Midtown, the harbour)
  constructor({ root, scene, skip = () => false, skipReady = Promise.resolve() }) {
    Object.assign(this, { root, scene, skip, skipReady });
    this.airports = [];
    this.group = new THREE.Group(); this.group.name = "REGION";
    this.ready = fetch(`${root}data/region/region.json`).then(r => r.json()).then(d => this.build(d)).catch(e => console.warn("region", e));
  }

  build(d) {
    this.frame = d.frame;
    const xs = d.frame.map(p => p[0]), ys = d.frame.map(p => p[1]);
    this.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    // land: one mesh, a muted urban grey-green as it reads from the air
    const t = d.land_tris, pos = new Float32Array(t.length / 2 * 3);
    for (let i = 0, j = 0; i < t.length; i += 2, j += 3) { pos[j] = t[i]; pos[j + 1] = Z_LAND; pos[j + 2] = -t[i + 1]; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
    const land = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6e7468, roughness: 0.95, side: THREE.DoubleSide }));
    land.name = "REGION_land";
    this.group.add(land);
    this.raster(t);
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x2f3236, roughness: 0.9 });
    const taxi = new THREE.MeshStandardMaterial({ color: 0x3b3e43, roughness: 0.9 });
    const apron = new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.92 });
    const white = new THREE.MeshBasicMaterial({ color: 0xe8e8e2, toneMapped: false });
    const yellow = new THREE.MeshBasicMaterial({ color: 0xe0b020, toneMapped: false });
    const term = new THREE.MeshStandardMaterial({ color: 0x9aa2aa, roughness: 0.6, metalness: 0.2 });
    const hang = new THREE.MeshStandardMaterial({ color: 0x8c8f88, roughness: 0.8 });
    for (const A of Object.values(d.airports)) {
      for (const poly of A.aprons) this.group.add(this.flat(poly, apron, Z_PAVE - 0.02));
      for (const tw of A.taxiways) {
        this.group.add(this.ribbon(tw.pts, tw.w, taxi, Z_PAVE - 0.01));
        this.group.add(this.ribbon(tw.pts, 0.3, yellow, Z_MARK));
      }
      for (const r of A.runways) this.runway(r, asphalt, white);
      for (const poly of A.terminals) this.group.add(this.block(poly, 16, term));
      for (const poly of A.hangars) this.group.add(this.block(poly, 11, hang));
      this.airports.push({ ...A, runways: A.runways.map(r => ({ ...r, z: Z_PAVE + 0.25, code: A.code })) });
    }
    this.parks = (d.parks || []).map(p => p.poly);
    const grass = new THREE.MeshStandardMaterial({ color: 0x55704a, roughness: 1 });
    for (const poly of this.parks) this.group.add(this.flat(poly, grass, Z_LAND + 0.03));
    this.mapLayer(d);
    this.skipReady.then(() => this.infill(d));
    this.group.traverse(o => { if (o.isMesh) { o.raycast = () => {}; o.receiveShadow = false; } });
    this.scene.add(this.group);
  }

  // ---------------------------------------------------------------- the rest of the city, from the air
  // Beyond the detailed districts every land cell gets a block of buildings: instanced boxes, on the street grid's
  // axes, heights by where you are (Manhattan tall, Jersey City and Long Island City mid-rise, the rest low), none in
  // the parks, on the shore or inside an airport's fence, low under the approaches. Seen from a plane at 300 m.
  infill(d) {
    const S = 140, [x0, y0, x1, y1] = this.box;
    this.hx0 = x0; this.hy0 = y0; this.hS = S;
    this.hnx = Math.ceil((x1 - x0) / S); this.hny = Math.ceil((y1 - y0) / S);
    this.tops = new Float32Array(this.hnx * this.hny);
    const fences = Object.values(d.airports).map(A => {                 // the airport's footprint, + 150 m
      const pts = [...A.runways.flatMap(r => [r.a, r.b]), ...A.aprons.flat(), ...A.terminals.flat()];
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      return { box: [Math.min(...xs) - 150, Math.min(...ys) - 150, Math.max(...xs) + 150, Math.max(...ys) + 150], c: A.center };
    });
    const inPoly = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[j]; if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) c = !c; } return c; };
    // a repeatable random per cell (the same city every visit)
    const rnd = (i, j, k) => { let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const items = [];
    for (let i = 0; i < this.hnx; i++) for (let j = 0; j < this.hny; j++) {
      const cx = x0 + (i + 0.5) * S, cy = y0 + (j + 0.5) * S;
      if (!this.isLand(cx, cy) || this.skip(cx, cy)) continue;
      if (!this.isLand(cx + 70, cy) || !this.isLand(cx - 70, cy) || !this.isLand(cx, cy + 70) || !this.isLand(cx, cy - 70)) continue;   // the shore
      if (this.parks.some(p => inPoly(p, cx, cy))) continue;
      if (fences.some(f => cx > f.box[0] && cx < f.box[2] && cy > f.box[1] && cy < f.box[3])) continue;
      const dA = Math.min(...fences.map(f => Math.hypot(cx - f.c[0], cy - f.c[1])));
      const dM = Math.hypot(cx + 400, cy), manhattan = this.inManhattan(cx, cy);
      let hMax = manhattan ? (dM < 6000 ? 90 : 45) : dM < 4500 ? 40 : dM < 9000 ? 22 : 14;
      if (dA < 3500) hMax = Math.min(hMax, 12);                                  // under the approaches
      if (rnd(i, j, 1) > (manhattan || dM < 9000 ? 0.97 : 0.85)) continue;          // the odd empty lot
      const n = 2;                                                                // buildings per cell
      let top = 0;
      for (let k = 0; k < n; k++) {
        const w = manhattan ? 40 + rnd(i, j, k + 2) * 35 : 22 + rnd(i, j, k + 2) * 30, dd = manhattan ? 70 + rnd(i, j, k + 7) * 25 : 18 + rnd(i, j, k + 7) * 26;
        const ox = (k - (n - 1) / 2) * (S / n), oy = (rnd(i, j, k + 11) - 0.5) * 30;
        let h = 6 + Math.pow(rnd(i, j, k + 17), 2.2) * hMax;
        if (manhattan && dM < 6000 && rnd(i, j, k + 23) > 0.93) h += 60 + rnd(i, j, k + 29) * 120;   // the odd tower
        items.push([cx + ox, cy + oy, Math.min(w, S / n - 6), dd, h, rnd(i, j, k + 31)]);
        top = Math.max(top, h);
      }
      this.tops[j * this.hnx + i] = Z_LAND + top;
    }
    // in 2.5 km tiles: each culled by the camera's frustum, and hidden beyond 11 km (the fog has it by then)
    const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
    const T = 2500, tiles = new Map();
    for (const it of items) { const k = Math.floor(it[0] / T) + "," + Math.floor(it[1] / T); (tiles.get(k) || tiles.set(k, []).get(k)).push(it); }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    const tones = [0x8d8a84, 0x9a9690, 0x7f8187, 0xa39a8c, 0x8a7d70, 0x6f7378, 0xb0aaa0, 0x857a6c];
    this.tiles = [];
    for (const list of tiles.values()) {
      const mesh = new THREE.InstancedMesh(g, mat, list.length);
      let sx = 0, sy = 0;
      list.forEach(([x, y, w, dd, h, r], k) => {
        m.compose(pos.set(x, Z_LAND, -y), q, sc.set(w, h, dd));
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, col.setHex(tones[Math.floor(r * tones.length)]));
        sx += x; sy += y;
      });
      mesh.computeBoundingSphere();
      mesh.name = "REGION_city"; mesh.raycast = () => {}; mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.userData.c = [sx / list.length, sy / list.length];
      this.scene.add(mesh);
      this.tiles.push(mesh);
    }
    this.count = items.length;
  }
  // per frame (cheap): only the city tiles near the camera are drawn
  update(camera) {
    if (!this.tiles) return;
    const x = camera.position.x, y = -camera.position.z, far = 11000 + Math.max(0, camera.position.y) * 4;
    for (const t of this.tiles) t.visible = Math.hypot(t.userData.c[0] - x, t.userData.c[1] - y) < far;
  }
  // Manhattan (north of Midtown, the Upper East / West Sides, Harlem): a narrow island along the grid's y axis - land
  // with river water within 3.5 km on both sides (Jersey, Queens and the Bronx are wider than that)
  inManhattan(x, y) {
    if (y < -800 || y > 17000) return false;                     // the harbour covers Lower Manhattan
    let w = false, e = false;
    for (let d = 200; d <= 3500 && !(w && e); d += 200) { w ||= !this.isLand(x - d, y); e ||= !this.isLand(x + d, y); }
    return w && e;
  }
  // the highest roof in the cell under (x, y), for flying into the city
  topAt(x, y) {
    if (!this.tops) return Z_LAND;
    const i = Math.floor((x - this.hx0) / this.hS), j = Math.floor((y - this.hy0) / this.hS);
    if (i < 0 || j < 0 || i >= this.hnx || j >= this.hny) return Z_LAND;
    return this.tops[j * this.hnx + i];
  }

  // the maps (big map + minimap) beyond Midtown and the harbour: water, land and the runways, in the harbour map's colours
  mapLayer(d) {
    const k = 1 / 16, [x0, y0, x1, y1] = this.box, W = Math.ceil((x1 - x0) * k), H = Math.ceil((y1 - y0) * k);
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), T = (x, y) => [(x - x0) * k, (y1 - y) * k];
    g.fillStyle = "rgb(28,58,92)"; g.beginPath(); d.frame.forEach((q, i) => i ? g.lineTo(...T(...q)) : g.moveTo(...T(...q))); g.fill();
    g.fillStyle = "rgb(46,50,56)"; g.strokeStyle = "rgb(46,50,56)"; g.lineWidth = 0.6;
    const t = d.land_tris;
    g.beginPath();
    for (let i = 0; i < t.length; i += 6) {
      g.moveTo(...T(t[i], t[i + 1])); g.lineTo(...T(t[i + 2], t[i + 3])); g.lineTo(...T(t[i + 4], t[i + 5])); g.closePath();
    }
    g.fill(); g.stroke();                                          // the stroke closes hairline seams between triangles
    g.lineCap = "butt";
    for (const A of Object.values(d.airports)) {
      g.fillStyle = "rgb(70,74,80)";
      for (const poly of A.aprons) { g.beginPath(); poly.forEach((q, i) => i ? g.lineTo(...T(...q)) : g.moveTo(...T(...q))); g.fill(); }
      g.strokeStyle = "rgb(150,154,162)";
      for (const r of A.runways) { g.lineWidth = Math.max(2, r.w * k * 1.6); g.beginPath(); g.moveTo(...T(...r.a)); g.lineTo(...T(...r.b)); g.stroke(); }
    }
    c.complete = true;                                             // reads like a loaded image to the map code
    this.map = { img: c, bounds: [...this.box], px_per_m: k };
  }

  // 50 m land/water grid from the land triangles (point-in-triangle per covered cell)
  raster(t) {
    const [x0, y0, x1, y1] = this.box;
    this.nx = Math.ceil((x1 - x0) / CELL); this.ny = Math.ceil((y1 - y0) / CELL);
    this.grid = new Uint8Array(this.nx * this.ny);
    for (let i = 0; i < t.length; i += 6) {
      const ax = t[i], ay = t[i + 1], bx = t[i + 2], by = t[i + 3], cx = t[i + 4], cy = t[i + 5];
      const gx0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / CELL)), gx1 = Math.min(this.nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / CELL));
      const gy0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / CELL)), gy1 = Math.min(this.ny - 1, Math.floor((Math.max(ay, by, cy) - y0) / CELL));
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
        const px = x0 + (gx + 0.5) * CELL, py = y0 + (gy + 0.5) * CELL;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) this.grid[gy * this.nx + gx] = 1;
      }
    }
  }
  // how far (m) you are outside the fetched area's tilted edges (negative: inside, that far from the nearest edge)
  edgeOut(x, y) {
    const F = this.frame; if (!F) return -1e9;
    let cx = 0, cy = 0; for (const q of F) { cx += q[0] / F.length; cy += q[1] / F.length; }
    let out = -1e9;
    for (let i = 0; i < F.length; i++) {
      const [ax, ay] = F[i], [bx, by] = F[(i + 1) % F.length], L = Math.hypot(bx - ax, by - ay);
      let nx = (by - ay) / L, ny = -(bx - ax) / L;
      if ((cx - ax) * nx + (cy - ay) * ny > 0) { nx = -nx; ny = -ny; }            // outward
      out = Math.max(out, (x - ax) * nx + (y - ay) * ny);
    }
    return out;
  }
  inside(x, y) { const [x0, y0, x1, y1] = this.box || [0, 0, 0, 0]; return x > x0 && x < x1 && y > y0 && y < y1; }
  isLand(x, y) {
    if (!this.grid || !this.inside(x, y)) return false;
    const gx = Math.floor((x - this.box[0]) / CELL), gy = Math.floor((y - this.box[1]) / CELL);
    return this.grid[gy * this.nx + gx] === 1;
  }

  // ---------------------------------------------------------------- meshes
  flat(poly, mat, z) {
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); g.scale(1, 1, 1);
    const m = new THREE.Mesh(g, mat); m.position.y = z;
    // ShapeGeometry is in x,y; rotateX(-90) maps y -> -z, which is exactly local y -> three.js -z
    return m;
  }
  block(poly, h, mat) {
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat); m.position.y = Z_PAVE;
    return m;
  }
  ribbon(pts, w, mat, z) {
    const pos = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * w / 2, ny = dx / L * w / 2;
      pos.push(pts[i][0] + nx, z, -(pts[i][1] + ny), pts[i][0] - nx, z, -(pts[i][1] - ny));
      if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.material.side = THREE.DoubleSide;
    return m;
  }
  // a runway: asphalt strip, centreline dashes (36 m dash / 24 m gap), threshold bars and the painted numbers
  runway(r, asphalt, white) {
    const [ax, ay] = r.a, [bx, by] = r.b, L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L, vx = -uy, vy = ux;
    this.group.add(this.ribbon([r.a, r.b], r.w, asphalt, Z_PAVE));
    for (let s = 120; s < L - 120; s += 60) this.group.add(this.ribbon([[ax + ux * s, ay + uy * s], [ax + ux * (s + 36), ay + uy * (s + 36)]], 0.9, white, Z_MARK));
    const ends = [[ax, ay, ux, uy], [bx, by, -ux, -uy]];
    const refs = (r.ref || "").split("/");
    ends.forEach(([ex, ey, dx, dy], k) => {
      for (let i = -3; i <= 3; i++) if (i) {                          // threshold "piano keys"
        const off = i * r.w / 8;
        const px = ex + vx * off * (dx === ux ? 1 : -1), py = ey + vy * off * (dx === ux ? 1 : -1);
        this.group.add(this.ribbon([[px + dx * 6, py + dy * 6], [px + dx * 36, py + dy * 36]], 1.8, white, Z_MARK));
      }
      const num = refs[k] || refs[0];
      if (num) this.group.add(this.number(num.replace(/[^0-9LRC]/g, ""), ex + dx * 60, ey + dy * 60, Math.atan2(dy, dx), white));
    });
  }
  number(txt, x, y, heading, white) {                              // painted runway designator, read on approach
    const c = document.createElement("canvas"); c.width = 128; c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#e8e8e2"; g.font = "bold 150px Helvetica, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.save(); g.translate(64, 128); g.scale(0.55, 1.1); g.fillText(txt, 0, 0); g.restore();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 28), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = heading - Math.PI / 2 + Math.PI;
    m.position.set(x, Z_MARK + 0.01, -y);
    return m;
  }
}
