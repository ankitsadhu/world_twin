// Contact shadows: a soft dark ellipse on the ground under every person and car, so nobody floats.
// (The renderer has no shadow maps: a city this size can't afford them. This is what most open-world games
// use for crowds and traffic, and it reads as "standing on the street" from any distance.)
// Soft edge = three stacked ellipses of uniform opacity (big and faint to small and darker). A gradient texture or
// per-vertex alpha would be simpler, but neither reaches the screen in this renderer's pipeline (checked 2026-10).
import * as THREE from "three";

export const RINGS = [[1.0, 0.18], [0.72, 0.22], [0.45, 0.26]];    // [size fraction, opacity]; stacked ~0.53 at the centre
const mats = new Map();
export function ringMaterial(opacity) {
  if (!mats.has(opacity)) mats.set(opacity, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  return mats.get(opacity);
}
// a flat ellipse, w across x by l along z (the model's own axes), lying just above y = 0
export function ellipseGeometry(w, l) {
  const g = new THREE.CircleGeometry(0.5, 24); g.rotateX(-Math.PI / 2); g.scale(w, 1, l); g.translate(0, 0.025, 0);
  return g;
}
export function makeBlob(w, l) {
  const grp = new THREE.Group(); grp.name = "SHADOW_blob";
  for (const [k, a] of RINGS) {
    const m = new THREE.Mesh(ellipseGeometry(w * k, l * k), ringMaterial(a));
    m.raycast = () => {}; m.renderOrder = 1; grp.add(m);
  }
  return grp;
}
