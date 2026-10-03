// Storefront variety without re-exporting the city: the facades' M_Storefront UVs are in 16 m tile units with each
// building on one 4.5 m row of the atlas. export/textures/storefront4_*.jpg holds 2 x 2 copies of that tile with
// different shops (scripts/tools/gen_storefronts.py); here every 16 m stretch of facade picks one copy from a hash of
// its tile index, so neighbouring buildings stop repeating the same row of shops (review 2026-10-03).
import * as THREE from "three";

const SAMPLE = `
vec4 sfTex(sampler2D t, vec2 uv) {
  vec2 cell = floor(uv);
  float h = fract(sin(dot(cell + vec2(floor(uv.y * 4.0) * 7.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
  float k = floor(h * 4.0);
  vec2 q = vec2((fract(uv.x) + mod(k, 2.0)) * 0.5, (fract(uv.y) + floor(k / 2.0)) * 0.5);
  return textureGrad(t, q, dFdx(uv) * 0.5, dFdy(uv) * 0.5);
}
`;

export function applyStorefronts(scene, root) {
  const mats = new Set();
  scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.name === "M_Storefront") mats.add(m); });
  if (!mats.size) return Promise.resolve(0);
  const L = new THREE.TextureLoader();
  const load = (n, srgb) => L.loadAsync(`${root}export/textures/storefront4_${n}.jpg`).then(t => {
    t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  return Promise.all([load("diff", true), load("orm", false), load("emit", true)]).then(([diff, orm, emit]) => {
    for (const m of mats) {
      m.map = diff; if (m.roughnessMap) m.roughnessMap = orm; if (m.metalnessMap) m.metalnessMap = orm;
      if (m.emissiveMap) m.emissiveMap = emit;
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        prev?.call(m, sh, r);
        sh.fragmentShader = sh.fragmentShader.replace("void main() {", SAMPLE + "void main() {")
          .replaceAll("texture2D( map, vMapUv )", "sfTex( map, vMapUv )")
          .replaceAll("texture2D( emissiveMap, vEmissiveMapUv )", "sfTex( emissiveMap, vEmissiveMapUv )")
          .replaceAll("texture2D( roughnessMap, vRoughnessMapUv )", "sfTex( roughnessMap, vRoughnessMapUv )")
          .replaceAll("texture2D( metalnessMap, vMetalnessMapUv )", "sfTex( metalnessMap, vMetalnessMapUv )");
      };
      m.customProgramCacheKey = () => "storefront4";
      m.needsUpdate = true;
    }
    return mats.size;
  }).catch(e => { console.warn("storefronts", e); return 0; });
}
