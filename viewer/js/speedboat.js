// The speedboat and the Hudson Dash (Mario Kart on water): a fast arcade boat on the open Hudson, with a checkpoint race around the river
// against the clock. Green boost pads on the water give a burst of speed; gates must be taken in order; bronze / silver / gold by time.
// The boat here is a placeholder built from primitives (docs/prompts/agent_prompt_speedboat.txt asks for the real model).
// Keys: W throttle · S brake / reverse · A D steer · R start the race (again to quit) · F leave the boat.
import * as THREE from "three";

const WATER = -1.8;                                         // the Hudson's surface
const COURSES = {                                              // open water; each loop is checked against the harbour's shoreline when it is built
  dash: { name: "Hudson Dash", pts: [[-1700, -350], [-1700, -100], [-1800, 150], [-2000, 330], [-2250, 300], [-2350, 50], [-2250, -200], [-2000, -330], [-1800, -390]], gold: 28, silver: 22, bronze: 17 },
  crossing: { name: "Hudson Run: Chelsea to Hoboken", pts: [[-1700, -1500], [-1800, -2000], [-1900, -2600], [-1850, -3200], [-1780, -3615], [-1980, -3300], [-1990, -2900], [-1900, -2300], [-1750, -1800]], gold: 30, silver: 24, bronze: 18 },
  liberty: { name: "Liberty Sprint", pts: [[-394, -9108], [-427, -8983], [-519, -8891], [-644, -8858], [-769, -8891], [-882, -8970], [-919, -9108], [-861, -9233], [-769, -9325], [-644, -9358], [-519, -9325], [-427, -9233]], gold: 27, silver: 21, bronze: 16 },
};
const COURSE = COURSES.dash.pts;
const KEY = "ts.boatrace.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

export class SpeedBoat {
  // o: { scene, camera, helm, audio, toast, setMode, getMode, onLeave({x,y,h}), onFinish({ms, medal}), onBoost(), pop(text) }
  constructor(o) {
    Object.assign(this, o);
    this.active = false; this.x = -1620; this.y = -330; this.h = Math.PI / 2; this.v = 0; this.vl = 0; this.steer = 0; this.boostT = 0; this.shake = 0;
    this.ctl = { up: 0, down: 0, left: 0, right: 0 };
    this.race = { state: "idle", t: 0, cp: 1 }; this.best = load();
    this.group = this.buildBoat(); this.group.visible = false; this.scene.add(this.group);
    this.buildWake(); this.buildHud(); this.bindInput();
  }

  // ---------------------------------------------------------------- the boat: a 7.5 m sport boat, bow toward +Z
  buildBoat() {
    const g = new THREE.Group(); g.name = "RIDE_speedboat"; g.userData.ride = true;
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.35, metalness: 0.1 }), stripe = new THREE.MeshStandardMaterial({ color: 0x0a84ff, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x20232a, roughness: 0.6 }), wood = new THREE.MeshStandardMaterial({ color: 0xa8743c, roughness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.35, roughness: 0.05 });
    const sh = new THREE.Shape();                                              // plan outline (x across, y = -length so the bow ends up at +z)
    const half = [[1.1, 3.75], [1.2, 1.5], [1.0, -1.0], [0.5, -2.8], [0, -3.75]];
    sh.moveTo(-half[0][0], half[0][1]); for (const [x, y] of half) sh.lineTo(x, y); for (const [x, y] of [...half].reverse().slice(1)) sh.lineTo(-x, y); sh.closePath();
    const hullG = new THREE.ExtrudeGeometry(sh, { depth: 0.85, bevelEnabled: false }); hullG.rotateX(-Math.PI / 2);
    const hull = new THREE.Mesh(hullG, white); hull.position.y = -0.1; hull.castShadow = true; g.add(hull);
    const stripeG = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false }); stripeG.rotateX(-Math.PI / 2);
    const st = new THREE.Mesh(stripeG, stripe); st.position.y = 0.38; st.scale.set(1.012, 1, 1.004); g.add(st);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 4.0), wood); deck.position.set(0, 0.76, -0.6); g.add(deck);
    const wind = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.7), glass); wind.position.set(0, 1.2, 0.9); wind.rotation.x = -0.45; g.add(wind);
    for (const z of [-0.2, -1.6]) { const seat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 0.6), dark); seat.position.set(0, 1.0, z); g.add(seat); }
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 20), dark); wheel.position.set(-0.3, 1.25, 0.55); wheel.rotation.x = -0.9; g.add(wheel);
    const eng = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.5), dark); eng.position.set(0, 0.6, -3.9); g.add(eng);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 1.2, 6), dark); bow.position.set(0, 1.0, 3.2); bow.rotation.x = Math.PI / 2; g.add(bow);
    for (const o of g.children) o.raycast = () => {};
    return g;
  }
  buildWake() {
    const N = 140; this.wakeN = N; this.wakeAge = new Float32Array(N).fill(99); this.wakeI = 0;
    this.wakePos = new Float32Array(N * 3); this.wakeCol = new Float32Array(N * 3); this.wakeVel = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(this.wakePos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(this.wakeCol, 3));
    const c = document.createElement("canvas"); c.width = c.height = 64; const g2 = c.getContext("2d"), gr = g2.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.6, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);   // a soft round puff, not a square
    this.wake = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true }));
    this.wake.frustumCulled = false; this.wake.raycast = () => {}; this.wake.userData.traffic = true; this.scene.add(this.wake);
  }

  // ---------------------------------------------------------------- getting in and out
  spawn() {                                                 // open water at the course start, pointing up the course
    const [sx, sy] = (this.def?.pts || COURSE)[0]; this.x = sx + 40; this.y = sy - 30; this.h = Math.PI / 2; this.v = 0; this.vl = 0;
    if (this.helm.hits(this.x, this.y)) { this.x = -2100; this.y = -100; }
  }
  async board(id = "dash") {
    this.def = COURSES[id] || COURSES.dash; this.courseId = id;
    if (this.active) { this.leave(true); }
    this.onBoard?.();
    this.spawn(); this.active = true; this.group.visible = true; this.camSnap = true; this.setMode("boat");
    this.hud.style.display = "block"; this.paintHud();
    this.toast?.(`Speedboat: W go · A D steer · R to race the ${this.def.name} · F to leave`);
  }
  leave(quiet) {
    if (!this.active) return;
    this.stopRace(); this.active = false; this.group.visible = false; this.hud.style.display = "none"; this.ctl = { up: 0, down: 0, left: 0, right: 0 };
    if (!quiet) this.onLeave?.({ x: this.x, y: this.y, h: this.h });
  }
  forceOut() { if (this.active) this.leave(true); }

  bindInput() {
    const keys = { KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right" };
    addEventListener("keydown", e => {
      if (!this.active || e.target.tagName === "INPUT") return;
      if (keys[e.code]) { this.ctl[keys[e.code]] = 1; e.preventDefault(); }
      if (e.code === "KeyR" && !e.repeat) this.toggleRace();
      if (e.code === "KeyF" && !e.repeat) this.leave();
    });
    addEventListener("keyup", e => { if (keys[e.code]) this.ctl[keys[e.code]] = 0; });
  }

  // ---------------------------------------------------------------- physics (arcade: a planing hull that slides a little in turns)
  update(dt) {
    if (!this.active) return;
    const c = this.ctl, gas = c.up ? 1 : 0, brake = c.down ? 1 : 0, steerIn = (c.left ? 1 : 0) - (c.right ? 1 : 0);
    const vmax = this.boostT > 0 ? 38 : 25;
    if (gas) this.v += (this.boostT > 0 ? 14 : 9) * dt; else if (brake) this.v -= (this.v > 0.5 ? 12 : 5) * dt; else this.v -= Math.sign(this.v) * Math.min(Math.abs(this.v), (1.2 + this.v * 0.05) * dt);
    this.v = THREE.MathUtils.clamp(this.v, -6, vmax); if (this.v > vmax) this.v -= 20 * dt;
    if (this.boostT > 0) this.boostT -= dt;
    this.steer += (steerIn - this.steer) * Math.min(1, dt * 4);
    const turn = this.steer * (0.35 + 0.65 * Math.min(1, Math.abs(this.v) / 8)) * 0.9;           // rad/s: turns bite once planing
    const dh = turn * dt * Math.sign(this.v || 1); this.h += dh;
    this.vl += (-this.steer * this.v * 0.18 - this.vl) * Math.min(1, dt * 3);                    // slides outward in a hard turn
    let nx = this.x + (Math.cos(this.h) * this.v - Math.sin(this.h) * this.vl) * dt, ny = this.y + (Math.sin(this.h) * this.v + Math.cos(this.h) * this.vl) * dt;
    const hit = this.helm.hullHit(nx, ny, this.h);
    if (hit) {                                                                                  // shore or pier: bounce off, lose speed, shake
      if (Math.abs(this.v) > 3) { this.shake = 0.3 + Math.min(0.7, Math.abs(this.v) / 25); this.audio?.crash?.(new THREE.Vector3(this.x, 0, -this.y), Math.min(1, Math.abs(this.v) / 20), "concrete"); this.onBump?.(Math.min(1, Math.abs(this.v) / 20)); if (this.race.state === "go") this.bumps = (this.bumps || 0) + 1; }
      this.v *= -0.35; this.vl = 0; nx = this.x; ny = this.y;
    }
    this.x = nx; this.y = ny;
    const t = performance.now() / 1000, plane = Math.min(1, Math.abs(this.v) / 14);
    const roll = THREE.MathUtils.clamp(this.steer * Math.abs(this.v) * 0.012, -0.35, 0.35), pitch = -(0.04 + 0.11 * plane) + Math.sin(t * 3) * 0.01 * (1 - plane);
    this.group.position.set(this.x, WATER + 0.25 + Math.sin(t * 2.2) * 0.04 + plane * 0.12, -this.y);
    this.group.rotation.order = "YXZ"; this.group.rotation.set(pitch, this.h + Math.PI / 2, roll);
    this.updateWake(dt);
    this.followCamera(dt);
    this.updateRace(dt);
  }

  updateWake(dt) {
    const sp = Math.abs(this.v);
    if (sp > 2) for (let k = 0; k < 2; k++) {                                                   // spray from the stern and the bow's quarter waves
      const i = this.wakeI = (this.wakeI + 1) % this.wakeN, side = Math.random() < 0.5 ? -1 : 1, back = 3.4 + Math.random();
      const fx = Math.cos(this.h), fy = Math.sin(this.h), rx = -fy, ry = fx;
      this.wakePos[i * 3] = this.x - fx * back + rx * side * (0.5 + Math.random()); this.wakePos[i * 3 + 1] = WATER + 0.2; this.wakePos[i * 3 + 2] = -(this.y - fy * back + ry * side * (0.5 + Math.random()));
      this.wakeVel[i * 3] = rx * side * 1.2; this.wakeVel[i * 3 + 1] = 0.8 + Math.random() * 1.2; this.wakeVel[i * 3 + 2] = -ry * side * 1.2; this.wakeAge[i] = 0;
    }
    for (let i = 0; i < this.wakeN; i++) {
      this.wakeAge[i] += dt; const a = this.wakeAge[i];
      if (a > 1.6) { this.wakePos[i * 3 + 1] = -50; continue; }
      this.wakePos[i * 3] += this.wakeVel[i * 3] * dt; this.wakePos[i * 3 + 2] += this.wakeVel[i * 3 + 2] * dt; this.wakeVel[i * 3 + 1] -= 4 * dt;
      this.wakePos[i * 3 + 1] = Math.max(WATER + 0.05, this.wakePos[i * 3 + 1] + this.wakeVel[i * 3 + 1] * dt);
      const f = Math.min(1, a / 1.6); this.wakeCol[i * 3] = 1 - f * 0.7; this.wakeCol[i * 3 + 1] = 1 - f * 0.55; this.wakeCol[i * 3 + 2] = 1 - f * 0.4;
    }
    this.wake.geometry.attributes.position.needsUpdate = true; this.wake.geometry.attributes.color.needsUpdate = true;
  }

  followCamera(dt) {
    const fx = Math.cos(this.h), fy = Math.sin(this.h), cam = this.camera;
    const want = new THREE.Vector3(this.x - fx * 13, WATER + 5.2 + Math.abs(this.v) * 0.05, -(this.y - fy * 13));
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt); want.x += (Math.random() - 0.5) * this.shake * 0.6; want.y += (Math.random() - 0.5) * this.shake * 0.4; }
    if (this.camSnap) { cam.position.copy(want); this.camSnap = false; } else cam.position.lerp(want, 1 - Math.exp(-dt * 5));
    cam.lookAt(this.x + fx * 9, WATER + 1.2, -(this.y + fy * 9));
  }

  // ---------------------------------------------------------------- the Hudson Dash
  toggleRace() { this.race.state === "idle" ? this.startRace() : this.stopRace("Race cancelled"); }
  startRace() {
    const R = this.race; this.clearRaceProps();
    const COURSE = this.def.pts, [x0, y0] = COURSE[0], [x1, y1] = COURSE[1];
    this.x = x0; this.y = y0 - 30; this.h = Math.atan2(y1 - y0, x1 - x0); this.v = 0; this.vl = 0; this.camSnap = true;
    Object.assign(R, { state: "count", t: -3, cp: 1 });
    this.course = [...COURSE, COURSE[0]]; this.len = this.course.reduce((s, p, i, a) => i ? s + Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0, 0);
    this.gold = this.len / this.def.gold, this.silver = this.len / this.def.silver, this.bronze = this.len / this.def.bronze;
    this.buildProps(); this.makeGate(1); this.makeGate(2);
    this.setGoal();
    this.toast?.(`${this.def.name}: ${(this.len / 1000).toFixed(1)} km · gold ${this.fmt(this.gold * 1000)} · green pads give a boost`);
  }
  stopRace(msg) { const R = this.race; if (R.state === "idle") return; R.state = "idle"; this.clearRaceProps(); this.nav?.setWaypoint?.(null); if (msg) this.toast?.(msg); this.paintHud(); }
  fmt(ms) { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`; }
  setGoal() { const P = this.course[Math.min(this.race.cp, this.course.length - 1)]; this.nav?.setWaypoint?.({ id: "goal_boatgate", name: `Gate ${Math.min(this.race.cp, this.course.length - 1)}/${this.course.length - 1}`, x: P[0], y: P[1], kind: "goal" }); }

  padTexture() {
    if (this.padTex) return this.padTex;
    const c = document.createElement("canvas"); c.width = 128; c.height = 128; const g = c.getContext("2d");
    g.fillStyle = "rgba(0,60,25,0.85)"; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill(); g.strokeStyle = "#45ff8a"; g.lineWidth = 12; g.lineCap = "round";
    for (let i = 0; i < 2; i++) { const y = 92 - i * 36; g.beginPath(); g.moveTo(34, y); g.lineTo(64, y - 28); g.lineTo(94, y); g.stroke(); }
    return this.padTex = new THREE.CanvasTexture(c);
  }
  buildProps() {                                                                 // a boost pad on the middle of every leg
    this.props = [];
    for (let i = 0; i < this.course.length - 1; i++) {
      const [x0, y0] = this.course[i], [x1, y1] = this.course[i + 1], h = Math.atan2(y1 - y0, x1 - x0), px = (x0 + x1) / 2, py = (y0 + y1) / 2;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), new THREE.MeshBasicMaterial({ map: this.padTexture(), transparent: true, toneMapped: false, depthWrite: false }));
      m.rotation.order = "YXZ"; m.rotation.set(-Math.PI / 2, h - Math.PI / 2, 0); m.position.set(px, WATER + 0.12, -py); m.raycast = () => {}; m.userData.traffic = true; m.renderOrder = 3;
      this.scene.add(m); this.props.push({ x: px, y: py, mesh: m, t: 0 });
    }
  }
  makeGate(i) {
    const P = this.course[i]; if (!P) return;
    const next = this.course[i + 1] || this.course[i - 1], h = Math.atan2(next[1] - P[1], next[0] - P[0]), g = new THREE.Group();
    const col = i === this.race.cp ? 0xffd60a : 0x4da3ff;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 0.4, 8, 40), new THREE.MeshBasicMaterial({ color: col, toneMapped: false })); ring.rotation.y = Math.PI / 2; ring.position.y = 5; ring.raycast = () => {};
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 90, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false })); beam.position.y = 45; beam.raycast = () => {};
    g.add(ring, beam); g.position.set(P[0], WATER, -P[1]); g.rotation.y = -h + Math.PI; g.userData.gate = i; g.traverse(o => { o.userData.traffic = true; });
    this.scene.add(g); (this.gates ||= []).push(g);
  }
  clearRaceProps() { for (const g of this.gates || []) this.scene.remove(g); this.gates = []; for (const p of this.props || []) this.scene.remove(p.mesh); this.props = []; }

  updateRace(dt) {
    const R = this.race; if (R.state === "idle") { this.paintHud(); return; }
    R.t += dt;
    if (R.state === "go" && (R.t > this.bronze * 2.5 || (this.bumps || 0) > 8)) { this.bumps = 0; this.stopRace(R.t > this.bronze * 2.5 ? "Too slow: race over · press R to try again" : "Too many collisions: race over · press R to try again"); return; }
    if (R.state === "count") { this.v = 0; if (R.t >= 0) { R.state = "go"; R.t = 0; this.pop?.("GO!"); } this.paintHud(); return; }
    for (const p of this.props) if (Math.hypot(p.x - this.x, p.y - this.y) < 7 && !(p.t > performance.now())) { p.t = performance.now() + 3000; this.boostT = 2.4; this.v = Math.min(38, this.v + 6); this.pop?.("BOOST!"); this.onBoost?.(); }
    const P = this.course[R.cp];
    if (Math.hypot(P[0] - this.x, P[1] - this.y) < 16) {
      R.cp++;
      this.gates = this.gates.filter(g => { if (g.userData.gate < R.cp) { this.scene.remove(g); return false; } return true; });
      if (R.cp >= this.course.length) return this.finishRace();
      this.makeGate(R.cp + 1); for (const g of this.gates) if (g.userData.gate === R.cp) g.children.forEach(m => m.material.color.setHex(0xffd60a));
      this.setGoal();
    }
    this.paintHud();
  }
  finishRace() {
    const R = this.race, ms = R.t * 1000, s = R.t, medal = s <= this.gold ? "gold" : s <= this.silver ? "silver" : s <= this.bronze ? "bronze" : "none";
    const prev = this.best[this.courseId], pb = !prev || ms < prev; if (pb) { this.best[this.courseId] = ms; save(this.best); }
    this.stopRace(); const text = (`${this.def.name}: ${this.fmt(ms)}${pb ? " · NEW BEST" : ""}${medal !== "none" ? " · " + medal.toUpperCase() : ""}`);
    if (this.onResult) this.onResult(text, () => this.board(this.courseId).then(() => this.startRace())); else this.toast?.(text);
    this.onFinish?.({ ms, medal, pb, course: this.courseId });
  }

  buildHud() {
    this.hud = document.createElement("div");
    this.hud.style.cssText = "position:fixed;left:50%;top:calc(70px + env(safe-area-inset-top));transform:translateX(-50%);z-index:27;pointer-events:none;text-align:center;font:800 24px system-ui,sans-serif;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.7);display:none";
    document.body.appendChild(this.hud);
  }
  paintHud() {
    if (!this.active) return;
    const R = this.race, mph = Math.round(Math.abs(this.v) * 2.237);
    if (R.state === "count") { this.hud.innerHTML = `<div style="font-size:64px">${Math.ceil(-R.t)}</div><div style="font-size:14px;opacity:.8">${this.def.name}</div>`; return; }
    this.hud.innerHTML = R.state === "idle"
      ? `<div style="font-size:15px;font-weight:600">${mph} mph · R to race the ${this.def.name}${this.best[this.courseId] ? " · best " + this.fmt(this.best[this.courseId]) : ""}</div>`
      : `<div>${this.fmt(R.t * 1000)}</div><div style="font-size:14px;color:#ffd60a">Gate ${R.cp} / ${this.course.length - 1} · ${mph} mph${this.boostT > 0 ? " · BOOST" : ""} · R to quit</div>`;
  }
}
