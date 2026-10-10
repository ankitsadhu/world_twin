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
    this.stamina = 1; this.slope = 0; this.vx = 0; this.vz = 0;     // body: wind left (0..1), the ground's slope under you, your velocity
    this.bar = document.createElement("div");                        // a thin wind bar: only there while you're out of breath
    this.bar.setAttribute("aria-hidden", "true");
    this.bar.style.cssText = "position:fixed;left:50%;bottom:12px;transform:translateX(-50%);width:120px;height:4px;border-radius:2px;background:rgba(255,255,255,.18);opacity:0;transition:opacity .3s;z-index:7;pointer-events:none";
    this.bar.innerHTML = '<i style="display:block;height:100%;width:100%;border-radius:2px;background:#fff"></i>';
    document.body.appendChild(this.bar);
    this.hitButton = document.createElement("button");
    this.hitButton.type = "button";
    this.hitButton.className = "ui-btn ui-surface walk-hit";
    this.hitButton.textContent = "Shove";
    this.hitButton.setAttribute("aria-label", "Shove a person");
    this.hitButton.hidden = true;
    this.hitButton.style.cssText = "position:fixed;right:calc(var(--s4) + 76px);bottom:var(--s4);z-index:14;min-height:var(--hit);box-shadow:var(--shadow)";
    document.body.appendChild(this.hitButton);
    this.hitButton.addEventListener("pointerdown", e => e.stopPropagation());
    this.hitButton.addEventListener("click", () => this.attack());
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
      if (e.code === "KeyG") { e.preventDefault(); if (!e.repeat) this.attack(); return; }
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
    this.hitButton.hidden = !Settings.roughContact;
    this.hitButton.style.display = this.hitButton.hidden ? "none" : "inline-flex";
    this.dom.style.cursor = "grab";
  }
  disable() {
    this.restoreEye(); this.active = false; this.target = null; this.dom.style.cursor = "";
    this.vx = this.vz = 0; this.bar.style.opacity = 0; this.hitButton.hidden = true; this.hitButton.style.display = "none";
  }

  kick(p = 0.2, t = 0.14) { this.kickT = t; this.kickP = p; }              // a camera jolt (an impact)

  attack() {
    if (this.active && !(this.attackCd > 0)) {
      this.onAttack?.();
      this.attackCd = 0.35;
    }
  }

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
    const p = THREE.MathUtils.clamp(this.pitch, -0.35, 0.25), cp = Math.cos(p);
    const f = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(p), -Math.cos(this.yaw) * cp);
    const head = eye.clone(); head.y += 0.15;
    let dist = 3.6;
    const col = this.getCollider(), feet = eye.y - 1.7;
    if (col) for (let d = 0.4; d <= dist; d += 0.2) {
      const q = head.clone().addScaledVector(f, -d);
      if (col.blocked(q.x, -q.z, 0.25, feet + 0.6, true)) { dist = Math.max(0.6, d - 0.3); break; }
    }
    this.dist = this.dist == null ? dist : Math.min(dist, this.dist + (dt || 0.016) * 4);   // in fast, out slowly
    // over the right shoulder, so what is in front of you is not hidden behind your own head
    head.x += Math.cos(this.yaw) * 0.5; head.z -= Math.sin(this.yaw) * 0.5;
    const pos = head.addScaledVector(f, -this.dist);
    if (this.kickT > 0) { this.kickT = Math.max(0, this.kickT - (dt || 0.016)); const k = this.kickT * this.kickP; pos.x += (Math.random() - 0.5) * k; pos.y += (Math.random() - 0.5) * k * 0.7; pos.z += (Math.random() - 0.5) * k; }
    pos.y = Math.max(pos.y, this.groundAt(pos) + 0.35);
    cam.position.copy(pos);
    cam.rotation.set(this.pitch - 0.12, this.yaw, 0, "YXZ");                  // your head a little below the centre
    this.viewPos = (this.viewPos || new THREE.Vector3()).copy(pos);
    this.viewed = true;
  }

  // You are not a cursor: what you ask for (a direction and a speed) is not what the body does at once.
  //   momentum: you speed up in ~0.3 s (a run: ~1.3 s) and stop in ~0.2 s, and turning at speed carries you wide
  //   wind: a run lasts ~30 s (~140 m, two blocks), then you can only walk until you've got half your breath back (~7 s of walking)
  //   ground: uphill and stairs slow you (a 30-degree stair: about a third slower); landing from a jump costs a step
  //   people: someone in the way ahead slows you to a shuffle (they step aside; you don't barge through)
  friction(dt, dx, dz, vw) {
    const cam = this.camera, k = vw / 1.6, C = THREE.MathUtils.clamp;      // (the first-person test speeds scale the same way)
    let vx = dx / dt, vz = dz / dt, want = Math.hypot(vx, vz);
    if (want > vw * 1.5 && this.exhausted) { vx *= vw / want; vz *= vw / want; want = vw; }   // out of breath: walk
    const running = want > vw * 1.5;
    this.stamina = C(this.stamina + (running ? -1 / 30 : want > 0.1 ? 1 / 14 : 1 / 7) * dt, 0, 1);
    if (this.stamina <= 0) this.exhausted = true; else if (this.exhausted && this.stamina > 0.5) this.exhausted = false;
    let m = 1 - C(this.slope, 0, 0.6) * 0.8;                                // uphill / stairs
    if (want > 0.1 && this.pedsNear && this.pedsNear(cam.position.x + vx / want * 0.9, -(cam.position.z + vz / want * 0.9), 0.85).length) m *= 0.6;
    if ((this.landT || 0) > 0) { m *= 0.55; this.landT -= dt; }             // the legs absorb a landing
    vx *= m; vz *= m;
    const cur = Math.hypot(this.vx, this.vz), tgt = Math.hypot(vx, vz);
    const step = (tgt > cur ? (running ? 3.5 : 7) : 9) * k * dt;           // m/s^2: a person's pick-up, a run's slower build, braking
    let ex = vx - this.vx, ez = vz - this.vz;
    const e = Math.hypot(ex, ez);
    if (e > step) { ex = ex / e * step; ez = ez / e * step; }
    this.vx += ex; this.vz += ez;
    if (tgt === 0 && Math.hypot(this.vx, this.vz) < 0.03) this.vx = this.vz = 0;
    // the wind bar
    const low = this.stamina < 0.98;
    this.bar.style.opacity = low ? 1 : 0;
    this.bar.firstChild.style.width = `${Math.round(this.stamina * 100)}%`;
    this.bar.firstChild.style.background = this.exhausted ? "#ff9f0a" : "#fff";
    return [this.vx * dt, this.vz * dt];
  }
  // cars are solid: slide out of any car body (a box [x, y, heading, half length, half width] in Blender local metres)
  pushOut(x, y) {
    for (const [bx, by, h, hl, hw, sp = 0] of this.blockers()) {
      const ox = x - bx, oy = y - by;
      if (ox * ox + oy * oy > (hl + 1.2) ** 2) continue;
      const c = Math.cos(h), s = Math.sin(h), along = ox * c + oy * s, side = -ox * s + oy * c, r = 0.35;
      const pa = hl + r - Math.abs(along), ps = hw + r - Math.abs(side);
      if (pa > 0 && ps > 0) {
        if (Math.abs(sp) > 1) this.bumped = true;                              // a moving car brushed you
        if (pa < ps) { const m = (along < 0 ? -1 : 1) * pa; x += c * m; y += s * m; }
        else { const m = (side < 0 ? -1 : 1) * ps; x += -s * m; y += c * m; }
      }
    }
    return [x, y];
  }

  update(dt, keys) {
    if (!this.active) return;
    this.hitButton.hidden = !Settings.roughContact;
    this.hitButton.style.display = this.hitButton.hidden ? "none" : "inline-flex";
    this.attackCd = Math.max(0, (this.attackCd || 0) - dt);
    this.restoreEye();
    const cam = this.camera;
    this.stunT = Math.max(0, (this.stunT || 0) - dt);
    if (this.stunT > 0) keys = {};
    const run = this.stunT > 0 ? false : keys.ShiftLeft || keys.ShiftRight || this.pad?.run;
    if (keys.KeyA || keys.ArrowLeft) this.yaw += dt * 1.6;
    if (keys.KeyD || keys.ArrowRight) this.yaw -= dt * 1.6;
    const P = this.stunT > 0 ? null : this.pad;              // controller: left stick walks / strafes, right stick looks
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
    const [vw, vr] = this.third ? [1.6, 4.6] : [5, 14];       // you can see yourself: a brisk walk (1.6 m/s: a 0.77 m leg breaks into a run near 1.9) and a fast run
    if (mv) { this.target = null; const sp = (run ? vr : vw) * dt * mv; dx = fx * sp; dz = fz * sp; }
    else if (P && (P.lx || P.ly)) {                          // analog walk: push further = walk faster
      this.target = null;
      const input = Math.hypot(P.lx, P.ly), sp = (run ? vr : vw) * dt * Math.min(1, input);
      dx = (fx * -P.ly + -fz * P.lx) * sp / input; dz = (fz * -P.ly + fx * P.lx) * sp / input;
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
    [dx, dz] = this.friction(dt, dx, dz, vw);
    if ((dx || dz) && this.blockedAhead) {          // statues, poles, kiosks are not in the footprint map
      const len = Math.hypot(dx, dz), dir = new THREE.Vector3(dx / len, 0, dz / len);
      if (this.blockedAhead(cam.position, dir, len + 0.5)) { dx = 0; dz = 0; this.vx = this.vz = 0; this.target = null; }
    }
    const x0 = cam.position.x, z0 = cam.position.z, intended = Math.hypot(dx, dz);
    if (dx || dz) {
      const col = this.getCollider();
      if (col) {
        const feet = cam.position.y - 1.7;
        let [nx, ny] = col.move(cam.position.x, -cam.position.z, dx, -dz, 0.35, feet + 0.4, true);   // on foot: piers walkable
        if (this.blockers) [nx, ny] = this.pushOut(nx, ny);                                          // cars are solid
        if (this.target && Math.hypot(nx - cam.position.x, -ny - cam.position.z) < 1e-4) this.target = null; // blocked
        // a person steps up a kerb or onto a pier deck (1.2 m), not onto a parked aircraft's wing or a ledge
        const ox = cam.position.x, oz = cam.position.z;
        cam.position.x = nx; cam.position.z = -ny;
        if (this.groundAt(cam.position) - feet > 1.35) { cam.position.x = ox; cam.position.z = oz; this.target = null; }
      } else { cam.position.x += dx; cam.position.z += dz; }
    }
    const ground = this.groundAt(cam.position);
    const stepLen = Math.hypot(dx, dz);                       // the slope under you, smoothed: what slows a climb
    if (stepLen > 0.004 && !(this.air > 0)) {                 // rise over run across the last ~metre (stairs are treads, not a ramp)
      const f = Math.exp(-stepLen / 1.0);
      this.rise = (this.rise || 0) * f + (ground - (this.g0 ?? ground)); this.run = (this.run || 0) * f + stepLen;
      this.slope = THREE.MathUtils.clamp(this.rise / Math.max(this.run, 0.4), -1, 1);
    } else this.slope *= 1 - Math.min(1, dt * 4);
    if (!(this.air > 0) && (this.g0 ?? ground) - ground > 0.12 && Math.hypot(this.vx, this.vz) > 3.5 && !(this.stumbleCd > 0)) {
      this.landT = Math.max(this.landT || 0, 0.18); this.stumbleCd = 0.8;     // running off a kerb or a step: the knees take it
    }
    this.g0 = ground;
    if (this.air > 0) {                                       // in the air: gravity, land on whatever is below
      this.vy -= 9.81 * dt;
      this.air = Math.max(0, cam.position.y - 1.7 + this.vy * dt - ground);
      cam.position.y = ground + 1.7 + this.air;
      if (this.air === 0) { this.vy = 0; this.landT = 0.3; }
    } else cam.position.y += ((ground + 1.7) - cam.position.y) * Math.min(1, dt * 10);
    // what your character does: speed over the ground, and the way you're going (or facing, standing still)
    if (this.bumped) {                                        // a car's side nudged you: a stumble, never a crash
      this.bumped = false;
      if (!((this.bumpCd || 0) > 0)) { this.landT = Math.max(this.landT || 0, 0.4); this.bumpCd = 1.2; this.onBump?.(); }
    }
    this.bumpCd = Math.max(0, (this.bumpCd || 0) - dt);
    this.stumbleCd = Math.max(0, (this.stumbleCd || 0) - dt);
    const actual = Math.hypot(cam.position.x - x0, cam.position.z - z0);       // what you really covered (a car or a wall stops you)
    if (intended > 0.004 && actual < intended * 0.3) { this.vx *= 0.5; this.vz *= 0.5; }   // pressed against something: no momentum
    const moved = actual / Math.max(dt, 1e-3);
    this.speed = (this.speed || 0) + (moved - (this.speed || 0)) * Math.min(1, dt * 8);
    if (Settings.roughContact && moved > 2 && this.hitNearby && !this.target && !(this.hitCd > 0)) {         // a shoulder-barge you chose (not the auto-walk to a bike): a stagger, never a knock-down
      const x = cam.position.x + dx / Math.max(intended, 1e-3) * 0.6;
      const y = -cam.position.z - dz / Math.max(intended, 1e-3) * 0.6;
      if (this.hitNearby(x, y, this.vx, -this.vz, Math.min(0.45, moved / 10))) this.hitCd = 0.8;
    }
    this.hitCd = Math.max(0, (this.hitCd || 0) - dt);
    const want = moved > 0.1 ? Math.atan2(dx, dz) : this.heading ?? this.yaw + Math.PI;
    let diff = ((want - (this.heading ?? want) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.heading = (this.heading ?? want) + diff * Math.min(1, dt * 10);
  }
}
