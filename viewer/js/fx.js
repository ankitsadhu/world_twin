// Particles for the things a driving game shows you: smoke from a damaged engine (thicker as it gets worse, black when wrecked), tyre smoke under hard
// braking, sparks and dust on a crash, dust on a hard landing, and a burst when a wolf is picked up. One pooled Points object, a tiny shader (size + fade).
import * as THREE from "three";

const N = 700;
const VS = `attribute float aSize; attribute float aAlpha; attribute float aRot; attribute vec3 aColor; varying float vA; varying float vR; varying vec3 vC;
  void main(){ vA = aAlpha; vR = aRot; vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * (320.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const FS = `uniform sampler2D uTex; varying float vA; varying float vR; varying vec3 vC;
  void main(){ vec2 c = gl_PointCoord - 0.5; float cs = cos(vR), sn = sin(vR); vec2 uv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
    vec4 t = texture2D(uTex, uv); float shade = mix(0.7, 1.15, t.r);                                     /* lumpy: the dense core is lighter, the edges darker */
    gl_FragColor = vec4(vC * shade, t.a * vA); }`;

// a billowy puff: layered value noise under a soft radial falloff (made once, on a canvas), so smoke has lumps and an irregular edge instead of a flat disc
function puffTexture() {
  const S = 128, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d"), img = g.createImageData(S, S);
  const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
  const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x / S - 0.5) * 2, dy = (y / S - 0.5) * 2, r = Math.hypot(dx, dy);
    let f = 0, a = 0.5, fr = 3; for (let o = 0; o < 4; o++) { f += a * noise(x / S * fr + 7, y / S * fr + 3); a *= 0.5; fr *= 2; }
    const edge = Math.max(0, 1 - r), alpha = Math.min(1, Math.max(0, (f * 1.5 - 0.35) * 1.5) * Math.pow(edge, 0.8) * 1.4);
    const i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * Math.min(1, f * 1.2)); img.data[i + 3] = Math.round(255 * alpha);
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Fx {
  constructor(scene) {
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.life = new Float32Array(N).fill(0); this.max = new Float32Array(N).fill(1);
    this.size = new Float32Array(N); this.alpha = new Float32Array(N); this.rot = new Float32Array(N); this.spin = new Float32Array(N); this.col = new Float32Array(N * 3); this.kind = new Uint8Array(N); this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3)); g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1)); g.setAttribute("aRot", new THREE.BufferAttribute(this.rot, 1)); g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { uTex: { value: puffTexture() } }, transparent: true, depthWrite: false }));
    this.pts.frustumCulled = false; this.pts.raycast = () => {}; this.pts.userData.traffic = true; scene.add(this.pts);
    this.acc = 0;
  }

  // kind: 0 smoke (rises, grows), 1 spark (fast, falls, tiny), 2 dust (low, grows), 3 gold (a pickup burst)
  emit(kind, x, y, z, n = 1, power = 1, black = 0) {
    for (let k = 0; k < n; k++) {
      const i = this.i = (this.i + 1) % N, j = i * 3, r = () => Math.random() - 0.5;
      this.pos[j] = x + r() * 0.4; this.pos[j + 1] = y; this.pos[j + 2] = z + r() * 0.4; this.kind[i] = kind;
      if (kind === 0) { this.vel[j] = r() * 1.2; this.vel[j + 1] = 1.4 + Math.random() * 1.6; this.vel[j + 2] = r() * 1.2; this.max[i] = this.life[i] = 2.2 + Math.random() * 1.8; this.size[i] = 0.6; this.rot[i] = Math.random() * 6.28; this.spin[i] = (Math.random() - 0.5) * 0.9; const g = black ? 0.10 + Math.random() * 0.06 : 0.42 + Math.random() * 0.18; this.col.set([g, g, g * 1.03], j); }
      else if (kind === 1) { this.vel[j] = r() * 7 * power; this.vel[j + 1] = 1 + Math.random() * 4 * power; this.vel[j + 2] = r() * 7 * power; this.max[i] = this.life[i] = 0.25 + Math.random() * 0.35; this.size[i] = 0.12; this.col.set([1, 0.65 + Math.random() * 0.25, 0.2], j); }
      else if (kind === 2) { this.vel[j] = r() * 3 * power; this.vel[j + 1] = 0.4 + Math.random() * 0.9; this.vel[j + 2] = r() * 3 * power; this.max[i] = this.life[i] = 1.0 + Math.random() * 0.9; this.size[i] = 0.7; this.rot[i] = Math.random() * 6.28; this.spin[i] = (Math.random() - 0.5) * 1.2; this.col.set([0.66, 0.6, 0.52], j); }
      else { this.vel[j] = r() * 5; this.vel[j + 1] = 1.5 + Math.random() * 4; this.vel[j + 2] = r() * 5; this.max[i] = this.life[i] = 0.7 + Math.random() * 0.5; this.size[i] = 0.18; this.col.set([1, 0.8, 0.25], j); }
    }
  }
  crash(x, y, z, s) { this.emit(1, x, y + 0.5, z, Math.round(12 + s * 36), 0.6 + s); this.emit(2, x, y + 0.2, z, Math.round(5 + s * 12), 1 + s); }
  land(x, y, z, hard) { this.emit(2, x, y + 0.1, z, Math.round(6 + hard * 14), 1 + hard); }
  gold(x, y, z) { this.emit(3, x, y + 1.2, z, 40); }

  // per frame: advance the particles, and emit the vehicle's own: damage smoke and tyre smoke under hard braking
  update(dt, ride) {
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      const j = i * 3, k = this.kind[i], f = 1 - this.life[i] / this.max[i];
      this.life[i] -= dt;
      if (k === 1) this.vel[j + 1] -= 14 * dt; else if (k === 3) this.vel[j + 1] -= 6 * dt;
      else if (k === 0 || k === 2) { const t = performance.now() / 1000 + i; this.vel[j] += (Math.sin(t * 1.7) * 0.9 + 0.5) * dt; this.vel[j + 2] += Math.cos(t * 1.3) * 0.8 * dt; this.vel[j + 1] *= 1 - 0.35 * dt; this.rot[i] += this.spin[i] * dt; }   // billows on a faint wind, slows as it rises
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (k === 0) { this.size[i] = 0.6 + Math.sqrt(f) * 4.2; this.alpha[i] = 0.7 * Math.min(1, f * 6) * Math.pow(1 - f, 1.4); }              // swells fast, then thins and dissolves
      else if (k === 2) { this.size[i] = 0.7 + Math.sqrt(f) * 3.0; this.alpha[i] = 0.5 * Math.min(1, f * 8) * (1 - f); }
      else this.alpha[i] = 1 - f;
    }
    this.pts.geometry.attributes.position.needsUpdate = this.pts.geometry.attributes.aSize.needsUpdate = this.pts.geometry.attributes.aAlpha.needsUpdate = this.pts.geometry.attributes.aColor.needsUpdate = this.pts.geometry.attributes.aRot.needsUpdate = true;
    if (!ride || ride.state !== "driving" || !ride.car) return;
    this.acc += dt;
    if (this.acc < 0.05) return; this.acc = 0;
    const p = ride.car.position, h = ride.heading, c = Math.cos(h), s = Math.sin(h), sp = Math.abs(ride.v);
    const front = [p.x + c * 1.0, p.z - s * 1.0], rear = [p.x - c * 1.0, p.z + s * 1.0];
    if (ride.damage > 0.3 && !ride.invincible && Math.random() < 0.55 + ride.damage * 0.45) this.emit(0, front[0], p.y + 0.8, front[1], 1 + (ride.damage > 0.6 ? 1 : 0), 1, ride.damage > 0.8 || ride.wrecked ? 1 : 0);     // an engine in trouble
    if (ride.ctl?.down && ride.v > 11 && !(ride.bikeAir > 0)) this.emit(2, rear[0], p.y + 0.1, rear[1], 2, 0.5);                                                            // tyres on the limit
  }
}
