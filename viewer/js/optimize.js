// Load-time scene optimisation for the static city.
// Blender exports one node per building / prop so the pipeline stays editable; the GPU wants the opposite:
// few big draws. Per chunk we (1) share textures that several chunks ship under the same name,
// (2) turn repeated props into InstancedMesh, (3) merge the remaining static meshes per material and
// per ~160 m cell (so frustum culling still drops what is behind you), and (4) give large meshes a BVH
// so street-level raycasts (ground probe, "blocked ahead", clicks) stay cheap. Sellable screens are
// never touched: they keep their own mesh, material and slot_id.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { computeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
const baseRaycast = acceleratedRaycast;
// BVHs are built lazily, the first time a ray actually reaches a mesh, so loading never stalls on them
THREE.Mesh.prototype.raycast = function (raycaster, hits) {
  const g = this.geometry;
  if (!g.boundsTree && !g.userData.noBVH && (g.index ? g.index.count : g.attributes.position.count) > 3000) {
    if (!g.boundingSphere) g.computeBoundingSphere();
    const s = g.boundingSphere.clone().applyMatrix4(this.matrixWorld);
    if (raycaster.ray.intersectsSphere(s)) { try { g.computeBoundsTree(); } catch (e) { g.userData.noBVH = true; } }
  }
  return baseRaycast.call(this, raycaster, hits);
};

const MAPS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "specularColorMap",
  "specularIntensityMap", "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap", "transmissionMap"];
const sharedTex = new Map();

function isSlot(o) { for (let p = o; p; p = p.parent) if (p.userData.slot_id) return true; return false; }
const sig = g => Object.keys(g.attributes).sort().map(k => k + g.attributes[k].itemSize + (g.attributes[k].normalized ? "n" : ""))
  .join(",") + (g.index ? "|i" : "|n");

export function optimizeChunk(root, { cell = 160, minInstances = 6 } = {}) {
  root.updateMatrixWorld(true);
  const stats = { before: 0, after: 0, sharedTex: 0 };
  // 1. textures shared across chunks (facade / pavement sets ship in several GLBs)
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) for (const k of MAPS) {
      const t = m[k];
      if (!t || !t.name) continue;
      const key = t.name + "|" + t.colorSpace;
      const have = sharedTex.get(key);
      if (!have) sharedTex.set(key, t);
      else if (have !== t) { m[k] = have; t.dispose(); stats.sharedTex++; }
    }
  });
  // physical transmission re-renders the whole city into an extra target every frame: fake it instead
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (m.transmission > 0) {
      if (m.transmission > 0.5) { m.transparent = true; m.opacity = 1 - m.transmission * 0.7; m.depthWrite = false; }
      m.transmission = 0; m.needsUpdate = true;
    }
  });
  const meshes = [];
  root.traverse(o => { if (o.isMesh) { stats.before++; if (!o.isInstancedMesh && !o.isSkinnedMesh && !isSlot(o)) meshes.push(o); } });
  const remove = new Set();
  // 2. repeated props -> one InstancedMesh per (geometry, material)
  const byGM = new Map();
  for (const o of meshes) {
    if (Array.isArray(o.material)) continue;
    const k = o.geometry.uuid + o.material.uuid;
    (byGM.get(k) || byGM.set(k, []).get(k)).push(o);
  }
  for (const list of byGM.values()) {
    if (list.length < minInstances) continue;
    const im = new THREE.InstancedMesh(list[0].geometry, list[0].material, list.length);
    list.forEach((o, i) => { im.setMatrixAt(i, o.matrixWorld); remove.add(o); });
    im.name = "INST_" + (list[0].name || list[0].material.name);
    im.computeBoundingSphere();
    root.add(im);
  }
  // 3. everything else static: merge per material and per cell
  const groups = new Map();
  for (const o of meshes) {
    if (remove.has(o) || Array.isArray(o.material)) continue;
    const m = o.material;
    if (m.transparent || m.transmission > 0) continue;            // keep glass sortable
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const c = g.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
    const k = m.uuid + "|" + Math.floor(c.x / cell) + "," + Math.floor(c.z / cell) + "|" + sig(g);
    (groups.get(k) || groups.set(k, []).get(k)).push(o);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map(o => { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); return g; });
    let merged = null;
    try { merged = mergeGeometries(geos, false); } catch (e) { merged = null; }
    geos.forEach(g => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.name = "MERGED_" + list[0].material.name;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    list.forEach(o => remove.add(o));
  }
  for (const o of remove) o.removeFromParent();
  // drop now-empty building nodes, freeze the rest (the city never moves)
  const empties = [];
  root.traverse(o => { if (o !== root && !o.isMesh && !o.children.length && !o.userData.slot_id) empties.push(o); });
  empties.forEach(o => o.removeFromParent());
  root.traverse(o => { o.updateMatrix(); o.matrixAutoUpdate = false; });
  root.updateMatrixWorld(true);
  root.traverse(o => { if (o.isMesh) stats.after++; });
  return stats;
}
