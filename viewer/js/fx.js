// Particles for the things a driving game shows you: smoke from a damaged engine (thicker as it gets worse, black when wrecked), tyre smoke under hard
// braking, sparks and dust on a crash, dust on a hard landing, and a burst when a wolf is picked up. One pooled Points object, a tiny shader (size + fade).
import * as THREE from "three";

const N = 700;
const VS = `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; varying float vA; varying vec3 vC;
  void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * (320.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const FS = `varying float vA; varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = vA * smoothstep(0.5, 0.1, r); gl_FragColor = vec4(vC, a); }`;

export class Fx {
  constructor(scene) {
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.life = new Float32Array(N).fill(0); this.max = new Float32Array(N).fill(1);
    this.size = new Float32Array(N); this.alpha = new Float32Array(N); this.col = new Float32Array(N * 3); this.kind = new Uint8Array(N); this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3)); g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1)); g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false }));
    this.pts.frustumCulled = false; this.pts.raycast = () => {}; this.pts.userData.traffic = true; scene.add(this.pts);
    this.acc = 0;
  }

  // kind: 0 smoke (rises, grows), 1 spark (fast, falls, tiny), 2 dust (low, grows), 3 gold (a pickup burst)
  emit(kind, x, y, z, n = 1, power = 1, black = 0) {
    for (let k = 0; k < n; k++) {
      const i = this.i = (this.i + 1) % N, j = i * 3, r = () => Math.random() - 0.5;
      this.pos[j] = x + r() * 0.4; this.pos[j + 1] = y; this.pos[j + 2] = z + r() * 0.4; this.kind[i] = kind;
      if (kind === 0) { this.vel[j] = r() * 0.8; this.vel[j + 1] = 1.2 + Math.random() * 1.4; this.vel[j + 2] = r() * 0.8; this.max[i] = this.life[i] = 1.2 + Math.random() * 1.2; this.size[i] = 0.35; const g = black ? 0.12 : 0.55 + Math.random() * 0.2; this.col.set([g, g, g], j); }
      else if (kind === 1) { this.vel[j] = r() * 7 * power; this.vel[j + 1] = 1 + Math.random() * 4 * power; this.vel[j + 2] = r() * 7 * power; this.max[i] = this.life[i] = 0.25 + Math.random() * 0.35; this.size[i] = 0.12; this.col.set([1, 0.65 + Math.random() * 0.25, 0.2], j); }
      else if (kind === 2) { this.vel[j] = r() * 3 * power; this.vel[j + 1] = 0.3 + Math.random() * 0.8; this.vel[j + 2] = r() * 3 * power; this.max[i] = this.life[i] = 0.7 + Math.random() * 0.6; this.size[i] = 0.4; this.col.set([0.62, 0.55, 0.46], j); }
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
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (k === 0) { this.size[i] = 0.35 + f * 1.8; this.alpha[i] = 0.55 * (1 - f); }
      else if (k === 2) { this.size[i] = 0.4 + f * 1.4; this.alpha[i] = 0.45 * (1 - f); }
      else this.alpha[i] = 1 - f;
    }
    this.pts.geometry.attributes.position.needsUpdate = this.pts.geometry.attributes.aSize.needsUpdate = this.pts.geometry.attributes.aAlpha.needsUpdate = this.pts.geometry.attributes.aColor.needsUpdate = true;
    if (!ride || ride.state !== "driving" || !ride.car) return;
    this.acc += dt;
    if (this.acc < 0.05) return; this.acc = 0;
    const p = ride.car.position, h = ride.heading, c = Math.cos(h), s = Math.sin(h), sp = Math.abs(ride.v);
    const front = [p.x + c * 1.0, p.z - s * 1.0], rear = [p.x - c * 1.0, p.z + s * 1.0];
    if (ride.damage > 0.3 && !ride.invincible && Math.random() < 0.35 + ride.damage * 0.6) this.emit(0, front[0], p.y + 0.7, front[1], 1, 1, ride.damage > 0.8 || ride.wrecked ? 1 : 0);     // an engine in trouble
    if (ride.ctl?.down && ride.v > 11 && !(ride.bikeAir > 0)) this.emit(2, rear[0], p.y + 0.1, rear[1], 2, 0.5);                                                            // tyres on the limit
  }
}
