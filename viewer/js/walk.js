// Street View-style walking: no mouse capture, nothing to learn.
//   drag = look around (grab the world) · W/S or ↑/↓ = walk · A/D or ←/→ = turn · Shift = run · Space = jump
//   double-click the ground = walk there · Esc = back to Explore · V = first / third person
// Third person: the game logic still treats the camera as your eyes (everything that asks "where am I?" reads
// camera.position); only for drawing the frame does the camera step back behind your character (applyView), and the
// next update puts it back at your eyes.
import * as THREE from "three";
import { Settings } from "./settings.js";

export class StreetWalk {
  constructor({ camera, dom, getCollider, groundAt, onExit, blockedAhead }) {
    Object.assign(this, { camera, dom, getCollider, groundAt, onExit, blockedAhead });
    this.active = false;
    this.yaw = 0; this.pitch = 0;
    this.target = null;                       // auto-walk destination [x, y] (Blender local)
    this.drag = null;
    dom.addEventListener("pointerdown", e => {
      if (!this.active || e.button !== 0) return;
      this.drag = [e.clientX, e.clientY];
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener("pointermove", e => {
      if (!this.active || !this.drag) return;
      const { k: sens, inv } = Settings.lookScale(), k = 0.0042 * (this.camera.fov / 55) * sens;
      const dx = e.clientX - this.drag[0], dy = e.clientY - this.drag[1];
      if (Math.abs(dx) < 150 && Math.abs(dy) < 150) {     // grab-and-drag, like Street View (ignore pointer jumps)
        this.yaw += dx * k;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * k * inv, -1.2, 1.2);
      }
      this.drag = [e.clientX, e.clientY];
      this.target = null;
    });
    dom.addEventListener("pointerup", () => { this.drag = null; });
    addEventListener("keydown", e => {
      if (!this.active || e.target.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); if (!e.repeat) this.jump(); return; }
      if (!e.repeat && /^(ArrowUp|ArrowDown|KeyW|KeyS)$/.test(e.code)) this.pressAt = performance.now();
    });
    addEventListener("keyup", e => {     // a quick tap = one Street View step (~8 m); holding = walk
      if (!this.active || e.target.tagName === "INPUT" || !/^(ArrowUp|ArrowDown|KeyW|KeyS)$/.test(e.code)) return;
      if (performance.now() - (this.pressAt || 0) < 220) {
        const dir = /Up|W/.test(e.code) ? 1 : -1, p = this.eye;
        this.target = [p.x - Math.sin(this.yaw) * 8 * dir, -(p.z - Math.cos(this.yaw) * 8 * dir)];
      }
    });
  }

  enable() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.yaw = e.y; this.pitch = THREE.MathUtils.clamp(e.x, -0.5, 0.5);
    this.active = true; this.target = null;
    this.dom.style.cursor = "grab";
  }
  disable() { this.restoreEye(); this.active = false; this.target = null; this.dom.style.cursor = ""; }

  walkTo(point) {                              // three.js point -> auto-walk there
    this.target = [point.x, -point.z];
    this.onWalk?.();
  }

  // a person's jump: ~0.6 m off the ground (3.5 m/s up, real gravity); you keep your run's speed through the air
  jump() {
    if (!this.active || (this.air || 0) > 0) return;
    this.vy = 3.5; this.air = 1e-3;
    this.onJump?.();
  }

  get third() { return Settings.v.view !== "first"; }
  // the eye position you're walking with (the camera is behind you while a frame is drawn in third person)
  get eye() { return this.viewed ? this.saved : this.camera.position; }

  restoreEye() {
    if (!this.viewed) return;
    this.viewed = false;
    // if something moved the camera since the frame was drawn (the Intrepid's lift, getting ashore), that's the new eye
    if (this.camera.position.distanceToSquared(this.viewPos) < 1e-8) this.camera.position.copy(this.saved);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  // third person: put the camera behind and a little above your head for drawing; pulled in by walls, kept off the ground
  applyView(dt) {
    if (!this.active || !this.third || this.viewed) return;
    const cam = this.camera, eye = cam.position;
    this.saved = (this.saved || new THREE.Vector3()).copy(eye);
    const p = Math.min(this.pitch, 0.9), cp = Math.cos(p);
    const f = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(p), -Math.cos(this.yaw) * cp);
    const head = eye.clone(); head.y += 0.15;
    let dist = 3.6;
    const col = this.getCollider(), feet = eye.y - 1.7;
    if (col) for (let d = 0.4; d <= dist; d += 0.2) {
      const q = head.clone().addScaledVector(f, -d);
      if (col.blocked(q.x, -q.z, 0.25, feet + 0.6, true)) { dist = Math.max(0.6, d - 0.3); break; }
    }
    this.dist = this.dist == null ? dist : Math.min(dist, this.dist + (dt || 0.016) * 4);   // in fast, out slowly
    const pos = head.addScaledVector(f, -this.dist);
    pos.y = Math.max(pos.y, this.groundAt(pos) + 0.35);
    cam.position.copy(pos);
    cam.rotation.set(this.pitch - 0.12, this.yaw, 0, "YXZ");                  // your head a little below the centre
    this.viewPos = (this.viewPos || new THREE.Vector3()).copy(pos);
    this.viewed = true;
  }

  update(dt, keys) {
    if (!this.active) return;
    this.restoreEye();
    const cam = this.camera;
    const run = keys.ShiftLeft || keys.ShiftRight || this.pad?.run;
    if (keys.KeyA || keys.ArrowLeft) this.yaw += dt * 1.6;
    if (keys.KeyD || keys.ArrowRight) this.yaw -= dt * 1.6;
    const P = this.pad;                                     // controller: left stick walks / strafes, right stick looks
    if (P) {
      this.yaw -= P.rx * dt * 2.4;
      this.pitch = THREE.MathUtils.clamp(this.pitch - P.ry * dt * 1.8, -1.2, 1.2);
      if (P.rx || P.ry) this.target = null;
    }
    cam.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    // forward in the ground plane
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    let mv = 0;
    if (keys.KeyW || keys.ArrowUp) mv += 1;
    if (keys.KeyS || keys.ArrowDown) mv -= 1;
    let dx = 0, dz = 0;
    const [vw, vr] = this.third ? [1.9, 4.6] : [5, 14];       // you can see yourself: a person's walk and run
    if (mv) { this.target = null; const sp = (run ? vr : vw) * dt * mv; dx = fx * sp; dz = fz * sp; }
    else if (P && (P.lx || P.ly)) {                          // analog walk: push further = walk faster
      this.target = null;
      const sp = (run ? vr : vw) * dt;
      dx = (fx * -P.ly + -fz * P.lx) * sp; dz = (fz * -P.ly + fx * P.lx) * sp;
    }
    else if (this.target) {
      const tx = this.target[0] - cam.position.x, tz = -this.target[1] - cam.position.z;
      const d = Math.hypot(tx, tz);
      if (d < 0.6) this.target = null;
      else {
        const sp = Math.min(d, (this.third ? (d > 40 ? vr : vw) : d > 40 ? 14 : 6) * dt);
        dx = tx / d * sp; dz = tz / d * sp;
        const want = Math.atan2(-tx, -tz);                   // turn smoothly toward where we're going
        let diff = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        this.yaw += diff * Math.min(1, dt * 4);
      }
    }
    if ((dx || dz) && this.blockedAhead) {          // statues, poles, kiosks are not in the footprint map
      const len = Math.hypot(dx, dz), dir = new THREE.Vector3(dx / len, 0, dz / len);
      if (this.blockedAhead(cam.position, dir, len + 0.5)) { dx = 0; dz = 0; this.target = null; }
    }
    if (dx || dz) {
      const col = this.getCollider();
      if (col) {
        const feet = cam.position.y - 1.7;
        const [nx, ny] = col.move(cam.position.x, -cam.position.z, dx, -dz, 0.35, feet + 0.4, true);   // on foot: piers walkable
        if (this.target && Math.hypot(nx - cam.position.x, -ny - cam.position.z) < 1e-4) this.target = null; // blocked
        // a person steps up a kerb or onto a pier deck (1.2 m), not onto a parked aircraft's wing or a ledge
        const ox = cam.position.x, oz = cam.position.z;
        cam.position.x = nx; cam.position.z = -ny;
        if (this.groundAt(cam.position) - feet > 1.35) { cam.position.x = ox; cam.position.z = oz; this.target = null; }
      } else { cam.position.x += dx; cam.position.z += dz; }
    }
    const ground = this.groundAt(cam.position);
    if (this.air > 0) {                                       // in the air: gravity, land on whatever is below
      this.vy -= 9.81 * dt;
      this.air = Math.max(0, cam.position.y - 1.7 + this.vy * dt - ground);
      cam.position.y = ground + 1.7 + this.air;
      if (this.air === 0) this.vy = 0;
    } else cam.position.y += ((ground + 1.7) - cam.position.y) * Math.min(1, dt * 10);
    // what your character does: speed over the ground, and the way you're going (or facing, standing still)
    const moved = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
    this.speed = (this.speed || 0) + (moved - (this.speed || 0)) * Math.min(1, dt * 8);
    const want = moved > 0.1 ? Math.atan2(dx, dz) : this.heading ?? this.yaw + Math.PI;
    let diff = ((want - (this.heading ?? want) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.heading = (this.heading ?? want) + diff * Math.min(1, dt * 10);
  }
}
