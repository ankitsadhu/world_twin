// Dents: a crash pushes the vehicle's own body in, on the side that was hit. The vertices within reach of the impact point are shoved towards the vehicle's
// centre by a depth that grows with the crash energy (strength comes from the physics in collide.js), with a ragged edge so it reads as crumpled metal, not a smooth dimple.
// Geometry is shared between clones of a model, so each mesh is cloned once, the first time it is dented.
import * as THREE from "three";
const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
// smooth, low-frequency crumple: neighbouring vertices move almost alike, so the surface folds instead of tearing
const wobble = (x, y, z) => 0.8 + 0.2 * Math.sin(x * 11 + z * 7) * Math.cos(y * 9 + x * 5);

// v: a vehicle ({ group, model }); point: world-space impact point; strength 0..1
export function dentVehicle(v, point, strength) {
  const root = v?.model || v?.group; if (!root || strength < 0.06) return 0;
  root.updateMatrixWorld(true);
  _c.setFromMatrixPosition(v.group.matrixWorld); _c.y += 0.6;                                // the body's centre: dents push towards it
  _d.copy(_c).sub(point); _d.y *= 0.3; if (_d.lengthSq() < 1e-4) return 0; _d.normalize();
  const big = v.kind !== "bike", R = big ? 0.5 + strength * 0.9 : 0.3 + strength * 0.4, depth = big ? 0.04 + strength * 0.2 : 0.02 + strength * 0.1; let moved = 0;   // a bike is thin: a small, shallow crumple, never through the other side
  root.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || /WHEEL|STEER|LIGHT|GLASS/i.test(o.name || "")) return;
    const g0 = o.geometry; if (!g0?.attributes?.position) return;
    o.updateMatrixWorld(true);
    if (!g0.boundingSphere) g0.computeBoundingSphere();
    const bs = g0.boundingSphere.clone().applyMatrix4(o.matrixWorld); if (bs.center.distanceTo(point) > bs.radius + R) return;   // out of reach: leave it shared
    if (!o.userData.dented) { o.geometry = g0.clone(); o.userData.dented = true; }
    const pos = o.geometry.attributes.position;
    _m.copy(o.matrixWorld); const inv = _m.clone().invert(); o.getWorldScale(_s);
    const lp = _p.copy(point).applyMatrix4(inv), ld = _v.copy(_d).transformDirection(inv), rl = R / Math.max(1e-3, (_s.x + _s.y + _s.z) / 3), dl = depth / Math.max(1e-3, (_s.x + _s.y + _s.z) / 3);
    let touched = false;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), dist = Math.hypot(x - lp.x, y - lp.y, z - lp.z); if (dist > rl) continue;
      const k = 1 - dist / rl, w = k * k * (3 - 2 * k) * wobble(x, y, z);
      pos.setXYZ(i, x + ld.x * dl * w, y + ld.y * dl * w, z + ld.z * dl * w); touched = true; moved++;
    }
    if (touched) { pos.needsUpdate = true; o.geometry.computeVertexNormals(); o.geometry.computeBoundingSphere(); }
  });
  return moved;
}

// which part of the vehicle a world point is on, from its heading: "front" | "rear" | "left" | "right"
export function hitSide(v, heading, point) {
  const dx = point.x - v.group.position.x, dy = -(point.z - v.group.position.z), f = dx * Math.cos(heading) + dy * Math.sin(heading), l = -dx * Math.sin(heading) + dy * Math.cos(heading);
  return Math.abs(f) > Math.abs(l) * 1.2 ? (f > 0 ? "front" : "rear") : (l > 0 ? "left" : "right");
}
