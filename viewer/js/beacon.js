// A mission marker that reads as a place, not a prop: a soft glowing ground ring with a ripple that spreads out of it, a thin beam of light that fades with height
// (bright at the base, edges softened so it never looks like a solid pillar), and a floating badge with the mission's number and icon that bobs and always faces you.
// The beam and ring thin out as you get close, so you can see what you are driving into. Done missions go quiet: a small green ring and a tick, no beam.
import * as THREE from "three";

const RING_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FS = `uniform vec3 uColor; uniform float uTime; uniform float uAlpha; varying vec2 vUv;
  void main(){ float r = length(vUv - 0.5) * 2.0;
    float edge = smoothstep(0.80, 0.93, r) * (1.0 - smoothstep(0.96, 1.0, r));                      /* the crisp ring */
    float glow = smoothstep(0.35, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r)) * 0.28;               /* soft light inside it */
    float rp = fract(uTime * 0.33), ripple = (1.0 - smoothstep(0.0, 0.07, abs(r - rp * 0.92))) * (1.0 - rp) * 0.5;   /* a ripple spreading out */
    float a = (edge * 0.95 + glow + ripple) * uAlpha; if (a < 0.003) discard; gl_FragColor = vec4(uColor * (1.0 + edge * 0.5), a); }`;
const BEAM_VS = `varying float vH; varying vec3 vN; varying vec3 vV; void main(){ vH = clamp((position.y + 0.5), 0.0, 1.0); vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const BEAM_FS = `uniform vec3 uColor; uniform float uTime; uniform float uAlpha; varying float vH; varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);                              /* soft edges: strongest facing you */
    float fade = pow(1.0 - vH, 2.0) * smoothstep(0.0, 0.02, vH);                                       /* bright at the base, gone at the top */
    float shimmer = 0.88 + 0.12 * sin(vH * 60.0 - uTime * 2.5);
    float a = f * fade * shimmer * uAlpha; gl_FragColor = vec4(uColor * 1.15, a); }`;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };

function badgeTexture(color, icon, label, done) {
  const S = 128, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
  g.beginPath(); g.arc(S / 2, S / 2, 54, 0, 6.283); g.fillStyle = done ? "#2e9e4f" : color; g.fill();
  g.lineWidth = 7; g.strokeStyle = "rgba(255,255,255,.95)"; g.stroke();
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "52px system-ui, Apple Color Emoji, sans-serif"; g.fillText(done ? "✓" : icon, S / 2, S / 2 - 6);
  if (!done && label) { g.font = "800 24px system-ui, sans-serif"; g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.arc(S / 2 + 38, S / 2 + 38, 19, 0, 6.283); g.fill(); g.fillStyle = "#fff"; g.fillText(String(label), S / 2 + 38, S / 2 + 39); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// o: { color: "#hex", icon: emoji, label: number }
export function makeBeacon(o) {
  const g = new THREE.Group(), col = new THREE.Color(o.color), R = 6;
  const U = () => ({ uColor: { value: col.clone() }, uTime: { value: 0 }, uAlpha: { value: 1 } });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, uniforms: U(), ...additive, polygonOffset: true, polygonOffsetFactor: -2 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.16;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.5, 1, 20, 1, true), new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, uniforms: U(), ...additive, side: THREE.DoubleSide }));
  beam.scale.y = 70; beam.position.y = 35;
  const mkSprite = done => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(o.color, o.icon, o.label, done), transparent: true, depthWrite: false, toneMapped: false })); sp.scale.setScalar(3.4); sp.position.y = 6; return sp; };
  const badge = mkSprite(false), tick = mkSprite(true); tick.visible = false;
  g.add(ring, beam, badge, tick);
  g.traverse(x => { x.raycast = () => {}; x.userData.traffic = true; });
  // per frame: time, whether it's the tracked mission or done, and your distance (it thins out as you arrive)
  g.userData.set = (t, { active, done, dist }) => {
    const near = THREE.MathUtils.smoothstep(dist, 8, 30);                                                // 0 at your feet .. 1 from 30 m
    for (const m of [ring.material, beam.material]) { m.uniforms.uTime.value = t; m.uniforms.uColor.value.set(done ? "#2e9e4f" : o.color); }
    ring.material.uniforms.uAlpha.value = done ? 0.55 : active ? 1 : 0.8;
    beam.material.uniforms.uAlpha.value = done ? 0 : (active ? 0.75 : 0.4) * (0.15 + 0.85 * near);
    beam.visible = !done; badge.visible = !done; tick.visible = done;
    const b = (done ? tick : badge); b.position.y = 5.2 + Math.sin(t * 1.8) * 0.35; b.scale.setScalar((active ? 4.2 : 3.4) * (0.7 + 0.3 * near));
    g.scale.setScalar(active ? 1.35 : 1);
  };
  return g;
}
