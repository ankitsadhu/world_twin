// Living screens: every sellable slot plays a playlist like the real Times Square boards do.
// Images get a slow push-in / drift; items change with an LED-style wipe (bright leading edge);
// .mp4 / .webm entries play as muted looping video. A buyer's creative is just a one-item playlist,
// so later a backend can hand each slot its paid rotation without any viewer change.
import * as THREE from "three";

const loader = new THREE.TextureLoader();
const cache = new Map();          // url -> Promise<Texture>
const isVideo = url => /\.(mp4|webm|mov)(\?|#|$)/i.test(url) || url.startsWith("blob:") && url.includes("#video");

function load(url) {
  if (cache.has(url)) return cache.get(url);
  const p = new Promise(res => {
    if (isVideo(url)) {
      const v = document.createElement("video");
      Object.assign(v, { src: url, muted: true, loop: true, playsInline: true, crossOrigin: "anonymous", preload: "auto" });
      v.addEventListener("loadeddata", () => {
        const t = new THREE.VideoTexture(v); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.userData.video = v;
        v.play().catch(() => {}); res(t);
      }, { once: true });
      v.addEventListener("error", () => res(null), { once: true });
    } else {
      loader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4; res(t); }, undefined, () => res(null));
    }
  });
  cache.set(url, p);
  return p;
}

// stills hold 10-20 s; a video plays through twice
const holdFor = t => t?.isVideoTexture ? Math.max(12, (t.userData.video.duration || 8) * 2) : 10 + Math.random() * 10;

function patch(mat, u) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D uNext; uniform float uMix, uZoomA, uZoomB; uniform vec2 uPanA, uPanB, uDir;`)
      .replace("#include <emissivemap_fragment>", `
        #ifdef USE_EMISSIVEMAP
          vec2 uvS = vEmissiveMapUv;
          vec3 cA = texture2D(emissiveMap, (uvS - 0.5) * uZoomA + 0.5 + uPanA).rgb;
          vec3 cB = texture2D(uNext, (uvS - 0.5) * uZoomB + 0.5 + uPanB).rgb;
          float d = dot(uvS - 0.5, uDir) + 0.5;                    // 0..1 along the wipe direction
          float w = uMix * 1.15 - 0.075;
          float k = smoothstep(w + 0.02, w - 0.02, d);
          vec3 c = mix(cA, cB, uMix > 0.0 ? k : 0.0);
          c += vec3(1.0) * (uMix > 0.0 && uMix < 1.0 ? exp(-abs(d - w) * 90.0) * 0.8 : 0.0);   // bright scan edge
          totalEmissiveRadiance *= c;
        #endif`);
  };
  mat.customProgramCacheKey = () => "ts-screen";
  mat.needsUpdate = true;
}

export class Screens {
  constructor() { this.slots = new Map(); this.time = 0; }

  add(slotId, mat) {
    if (!mat || !/^MAT_SLOT_/.test(mat.name) || this.slots.has(slotId)) return;
    const u = { uNext: { value: mat.emissiveMap }, uMix: { value: 0 }, uZoomA: { value: 1 }, uZoomB: { value: 1 },
      uPanA: { value: new THREE.Vector2() }, uPanB: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2(1, 0) } };
    patch(mat, u);
    this.slots.set(slotId, { mat, u, ph: mat.emissiveMap, list: [], i: 0, cur: null, next: null, t: 0, hold: 12, trans: -1,
      age: Math.random() * 10 });
  }

  // urls: [] = placeholder, [one] = a fixed creative, [a, b, c] = rotation
  async setPlaylist(slotId, urls) {
    const s = this.slots.get(slotId);
    if (!s) return;
    s.list = urls.slice(); s.i = 0; s.trans = -1; s.u.uMix.value = 0;
    s.gen = (s.gen || 0) + 1; const gen = s.gen;
    const tex = urls.length ? await load(urls[0]) : s.ph;
    if (gen !== s.gen) return;                                  // superseded while loading
    s.cur = tex || s.ph; s.cur.userData.video?.play().catch(() => {});
    s.mat.emissiveMap = s.cur; s.u.uNext.value = s.cur;
    s.hold = holdFor(s.cur); s.t = s.cur.isVideoTexture ? 0 : Math.random() * s.hold * 0.8;   // boards don't all change at once
  }

  update(dt) {
    this.time += dt;
    for (const s of this.slots.values()) {
      s.age += dt;
      const still = !s.cur || s.cur.isVideoTexture;
      // slow push-in and drift on stills (real boards are never static)
      const z = still ? 1 : 1 - 0.03 * (1 - Math.cos(s.age * 0.11));
      s.u.uZoomA.value = z; s.u.uPanA.value.set(still ? 0 : Math.sin(s.age * 0.07) * 0.02, 0);
      if (s.list.length < 2) continue;
      s.t += dt;
      if (s.trans < 0 && s.t > s.hold - 2 && !s.next) {        // fetch the next item ahead of time
        s.next = load(s.list[(s.i + 1) % s.list.length]).then(t => (s.nextTex = t || s.ph));
      }
      if (s.trans < 0 && s.t > s.hold && s.nextTex) {
        s.trans = 0; s.u.uNext.value = s.nextTex; s.u.uZoomB.value = 1; s.u.uPanB.value.set(0, 0);
        const a = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
        s.u.uDir.value.set(a[0], a[1]);
        const v = s.nextTex.userData.video; if (v) { v.currentTime = 0; v.play().catch(() => {}); }
      }
      if (s.trans >= 0) {
        s.trans += dt / 0.9;
        s.u.uMix.value = Math.min(1, s.trans);
        if (s.trans >= 1) {
          if (s.cur !== s.nextTex) s.cur?.userData.video?.pause();      // stop decoding what's off screen
          s.i = (s.i + 1) % s.list.length; s.cur = s.nextTex; s.mat.emissiveMap = s.cur;
          s.u.uMix.value = 0; s.trans = -1; s.t = 0; s.age = 0; s.next = null; s.nextTex = null;
          s.hold = holdFor(s.cur);
        }
      }
    }
  }
}
