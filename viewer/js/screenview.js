// A clear view of any screen, worked out in the live scene. The exported per-slot views were placed blindly and many
// landed inside a neighbouring building or behind its glass, so the screen showed up half (or 90%) black. Here we
// face the screen's main surface, back off until it fits the frame, and keep the first spot from which rays to the
// centre and both sides of the screen actually reach the screen (not a wall, a pole or another sign).
import * as THREE from "three";

export function makeScreenViews({ scene, camera, getCollider, slotObjects, slots }) {
  const cache = new Map(), ray = new THREE.Raycaster();
  const B = (x, y, z) => new THREE.Vector3(x, z, -y);              // Blender local -> three
  const byId = new Map(slots.map(s => [s.slot_id, s]));

  // does a ray from eye reach the screen at point p (Blender coords) before anything else?
  const sees = (eye, p, own) => {
    const from = B(...eye), to = B(...p), dir = to.clone().sub(from), len = dir.length();
    ray.set(from, dir.normalize()); ray.far = len + 2;
    const hit = ray.intersectObjects(scene.children, true).find(h => h.object.visible && !h.object.userData.crowd && !h.object.userData.traffic
      && !h.object.isLine && h.object.type !== "Points");
    if (!hit) return true;
    return own.has(hit.object) || hit.distance > len - 1.5;
  };

  function viewFor(id) {
    if (cache.has(id)) return cache.get(id);
    const s = byId.get(id);
    if (!s) return null;
    const own = new Set(slotObjects(id));
    const f = (s.facets || []).slice().sort((a, b) => b[6] - a[6])[0] || [...s.center, ...s.normal, s.width_m * s.height_m];
    const [cx, cy, cz, nx0, ny0] = f, h = +s.height_m || 4, w = Math.max(2, Math.min(+s.width_m || 4, f[6] / h));   // the main face
    let nx = nx0, ny = ny0; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    if (Math.hypot(nx0, ny0) < 0.3) { nx = 0; ny = -1; }               // a roof-facing sign: look from the south
    const col0 = getCollider();                                          // some wrap screens store a normal pointing into the
    const openAt = k => !col0?.blocked(cx + nx * k, cy + ny * k, 0.8, cz);   // building: face whichever side is open air
    if (!openAt(6) && !openAt(12) && (openAt(-6) || openAt(-12))) { nx = -nx; ny = -ny; }
    const half = THREE.MathUtils.degToRad(camera.fov) / 2, aspect = Math.max(1, camera.aspect);
    const fit = Math.max(h * 1.35 / 2 / Math.tan(half), w * 1.25 / 2 / (Math.tan(half) * aspect));
    const tx = -ny, ty = nx;                                            // along the screen face
    const col = getCollider(), samples = [[cx, cy, cz], [cx + tx * w * 0.35, cy + ty * w * 0.35, cz], [cx - tx * w * 0.35, cy - ty * w * 0.35, cz]];
    let best = null, bestScore = -1;
    for (const k of [1, 0.75, 0.55, 1.4, 0.4])                         // distance: fit, then closer, then further
      for (const a of [0, 0.3, -0.3, 0.6, -0.6])                        // straight on, then from the side
        for (const lift of [0, -0.35, 0.35]) {                          // level, from below (street), from above
          const d = Math.min(260, Math.max(8, fit * k)), ca = Math.cos(a), sa = Math.sin(a);
          const dx = nx * ca - ny * sa, dy = nx * sa + ny * ca;
          const ex = cx + dx * d, ey = cy + dy * d, ez = Math.max(1.8, cz + lift * d);
          if (col?.blocked(ex, ey, 1.2, ez)) continue;                 // not inside a building
          const eye = [ex, ey, ez], score = samples.filter(p => sees(eye, p, own)).length - Math.abs(a) * 0.3 - Math.abs(lift) * 0.2 - Math.abs(1 - k) * 0.1;
          if (score > bestScore) { bestScore = score; best = { eye, target: [cx, cy, cz], seen: samples.filter(p => sees(eye, p, own)).length }; }
          if (score >= 3) { cache.set(id, best); return best; }
        }
    const v = best || (s.view ? { eye: s.view.eye, target: s.view.target } : null);
    cache.set(id, v);
    return v;
  }
  return { viewFor, sees };
}
