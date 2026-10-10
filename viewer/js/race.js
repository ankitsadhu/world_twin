// Street race (Need for Speed): R while driving starts a checkpoint race through real Midtown blocks. 3-2-1, then glowing gates one after
// another around a loop of avenues and streets against the clock; bronze / silver / gold by time, your best saved per course.
// Traffic stays live, so the line you take through it is the game. Press R again to quit.
import * as THREE from "three";
const KEY = "ts.race.v1", GKEY = "ts.ghost.v1";
const loadG = () => { try { return JSON.parse(localStorage.getItem(GKEY)) || {}; } catch { return {}; } };
const saveG = v => { try { localStorage.setItem(GKEY, JSON.stringify(v)); } catch { /* private mode: no ghost */ } };
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

export class Race {
  // o: { ride, traffic: () => traffic, scene, toast, onFinish({ id, ms, medal }) }
  constructor(o) {
    Object.assign(this, o);
    this.best = load(); this.ghosts = loadG(); this.state = "idle"; this.cp = 0; this.t = 0; this.course = null; this.idx = 0;
    this.build();
    addEventListener("keydown", e => {
      if (e.code === "KeyT" && !e.repeat && this.state !== "idle" && e.target.tagName !== "INPUT") { this.start(this.course, true); return; }   // Trackmania: instant restart
      if (e.code === "KeyR" && !e.repeat && e.target.tagName !== "INPUT" && this.ride.state === "driving") this.toggle();
    });
    setInterval(() => this.tick(0.05), 50);
  }

  // loops around real blocks: corners at avenue x street intersections, a gate every ~110 m along each edge
  // courses with explicit gates (downtown, Central Park: anywhere with no street grid of our own): start at pts[0], finish at the last gate
  addCourse(c) {
    let len = 0; for (let i = 1; i < c.pts.length; i++) len += Math.hypot(c.pts[i][0] - c.pts[i - 1][0], c.pts[i][1] - c.pts[i - 1][1]);
    this.extra = [...(this.extra || []).filter(e => e.id !== c.id), { gold: len / 19, silver: len / 15, bronze: len / 11, ...c, len, noProps: true }];
  }

  courses() {
    const T = this.traffic?.(); if (!T?.avenues?.length) return [];
    return [...this.gridCourses(T), ...(this.extra || [])];
  }
  gridCourses(T) {
    const A = [...T.avenues].sort((a, b) => a.x - b.x), S = [...T.streets].sort((a, b) => a.y - b.y);
    const mk = (id, name, a0, a1, s0, s1) => {
      const xa = A[a0]?.x, xb = A[a1]?.x, ya = S[s0]?.y, yb = S[s1]?.y;
      if ([xa, xb, ya, yb].some(v => v == null)) return null;
      const corners = [[xa, ya], [xb, ya], [xb, yb], [xa, yb]], pts = [];
      for (let i = 0; i < 4; i++) {
        const [x0, y0] = corners[i], [x1, y1] = corners[(i + 1) % 4], n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 110));
        for (let k = 0; k < n; k++) pts.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
      }
      pts.push(pts[0]);                                                          // back through the start gate
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return { id, name, pts, len, gold: len / 19, silver: len / 15, bronze: len / 11 };
    };
    return [mk("sprint", "Broadway sprint", 3, 4, 8, 11), mk("midtown", "Midtown loop", 2, 5, 6, 12), mk("grand", "Grand tour", 1, 6, 3, 14), mk("hell", "Hell's Kitchen run", 0, 1, 7, 13)].filter(Boolean);
  }

  startCourse(id) { const c = this.courses().find(c => c.id === id); if (c && this.ride.state === "driving") { this.stop(); this.start(c); return true; } return false; }

  toggle() {
    if (this.state !== "idle") return this.stop("Race cancelled");
    const list = this.courses();
    if (!list.length) return this.toast?.("The race courses are still loading");
    // nearest course start to you; pressing R again after a finish picks the next one
    const p = this.ride.car.position, x = p.x, y = -p.z;
    this.idx = (this.idx + 1) % list.length;
    const c = list.map((c, i) => [c, Math.hypot(c.pts[0][0] - x, c.pts[0][1] - y), i]).sort((a, b) => a[1] - b[1])[0][0];
    this.start(this.lastId === c.id && list.length > 1 ? list[this.idx] : c);
  }

  // ---- Mario Kart / Fall Guys: boost pads (speed), jump pads (bikes hop), and slalom cones (a knock costs 1.5 s)
  padTexture() {
    if (this.padTex) return this.padTex;
    const c = document.createElement("canvas"); c.width = 128; c.height = 256; const g = c.getContext("2d");
    g.fillStyle = "#06240f"; g.fillRect(0, 0, 128, 256); g.strokeStyle = "#45ff8a"; g.lineWidth = 16; g.lineCap = "round";
    for (let i = 0; i < 3; i++) { const y = 200 - i * 70; g.beginPath(); g.moveTo(24, y); g.lineTo(64, y - 40); g.lineTo(104, y); g.stroke(); }
    return this.padTex = new THREE.CanvasTexture(c);
  }
  buildProps(course) {
    this.props = []; if (course.noProps) return; const P = course.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[i + 1], len = Math.hypot(x1 - x0, y1 - y0); if (len < 50) continue;
      const h = Math.atan2(y1 - y0, x1 - x0), ux = Math.cos(h), uy = Math.sin(h), px = -uy, py = ux;
      const at = (f, side = 0) => [x0 + ux * len * f + px * side, y0 + uy * len * f + py * side];
      const kind = i % 2 ? "jump" : "boost", [bx, by] = at(0.38);
      const mat = new THREE.MeshBasicMaterial({ map: this.padTexture(), color: kind === "jump" ? 0xffc400 : 0xffffff, toneMapped: false, transparent: true, opacity: 0.95 });
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 9), mat);
      pad.rotation.order = "YXZ"; pad.rotation.set(-Math.PI / 2, h - Math.PI / 2, 0); pad.position.set(bx, 0.07, -by); pad.raycast = () => {}; pad.userData.traffic = true; pad.renderOrder = 3;
      this.scene.add(pad); this.props.push({ kind, x: bx, y: by, mesh: pad, t: 0 });
      for (let k = 0; k < 4; k++) {                                              // a slalom of cones after the pad
        const [cx, cy] = at(0.52 + k * 0.045 * (110 / len + 0.3), (k % 2 ? 3.2 : -3.2));
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0x331000 }));
        cone.position.set(cx, 0.45, -cy); cone.raycast = () => {}; cone.userData.traffic = true; cone.castShadow = true; this.scene.add(cone);
        this.props.push({ kind: "cone", x: cx, y: cy, mesh: cone, hit: false, vx: 0, vy: 0, vz: 0 });
      }
    }
  }
  clearProps() { for (const o of this.props || []) this.scene.remove(o.mesh); this.props = []; }
  tickProps(dt) {
    const r = this.ride, p = r.car.position, x = p.x, y = -p.z;
    for (const o of this.props || []) {
      if (o.kind === "cone") {
        if (o.hit) { o.mesh.position.x += o.vx * dt; o.mesh.position.z -= o.vy * dt; o.vz -= 9.8 * dt; o.mesh.position.y = Math.max(0.2, o.mesh.position.y + o.vz * dt); o.mesh.rotation.x += 8 * dt; o.mesh.rotation.z += 5 * dt; continue; }
        if (Math.hypot(o.x - x, o.y - y) < 1.5 && this.state === "go") {
          o.hit = true; o.vx = Math.cos(r.heading) * Math.max(6, Math.abs(r.v)) * 0.9; o.vy = Math.sin(r.heading) * Math.max(6, Math.abs(r.v)) * 0.9; o.vz = 5;
          this.t += 1.5; r.v *= 0.9; this.pop?.("Cone!  +1.5 s");
        }
      } else if (this.state === "go" && Math.hypot(o.x - x, o.y - y) < 4.5 && !(o.t > performance.now())) {
        o.t = performance.now() + 2500;
        r.boostT = o.kind === "boost" ? 2.2 : 1.2;
        if (o.kind === "jump") r.jumpBike?.();
        this.pop?.(o.kind === "boost" ? "BOOST!" : "JUMP!"); this.onBoost?.(o.kind);
        this.audio?.punch?.(p.clone(), true);
      }
    }
  }

  kind() { return this.ride.vehicle?.kind === "bike" ? "bike" : "car"; }
  // ---- the ghost: your best run on this course, in this kind of vehicle, replayed as a translucent shape you race against
  makeGhost(trace) {
    this.dropGhost();
    const bike = this.kind() === "bike";
    const m = new THREE.Mesh(new THREE.BoxGeometry(bike ? 2.1 : 4.4, bike ? 1.3 : 1.2, bike ? 0.6 : 1.9), new THREE.MeshBasicMaterial({ color: 0x7ad1ff, transparent: true, opacity: 0.38, depthWrite: false, toneMapped: false }));
    m.raycast = () => {}; m.userData.traffic = true; m.renderOrder = 4; this.scene.add(m); this.ghostMesh = m; this.ghostTrace = trace;
  }
  dropGhost() { if (this.ghostMesh) this.scene.remove(this.ghostMesh); this.ghostMesh = null; this.ghostTrace = null; }
  ghostAt(t) {                                                                          // [x, y, h] at time t (s): the trace holds 10 samples a second
    const T = this.ghostTrace, i = Math.floor(t * 10), n = T.length / 3;
    if (i < 0 || i >= n - 1) return null;
    const f = t * 10 - i, a = i * 3, b = a + 3;
    let dh = T[b + 2] - T[a + 2]; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    return [T[a] + (T[b] - T[a]) * f, T[a + 1] + (T[b + 1] - T[a + 1]) * f, T[a + 2] + dh * f];
  }

  start(course, quick = false) {
    this.clearProps(); this.buildProps(course);
    const G = this.ghosts[course.id]?.[this.kind()];
    if (G) this.makeGhost(G.trace); else this.dropGhost();
    this.rec = []; this.recT = 0; this.gateT = [];
    this.course = course; this.lastId = course.id; this.cp = 1; this.t = quick ? -1 : -3; this.state = "count"; this.clearGates();
    const [x, y] = course.pts[0], [nx, ny] = course.pts[1], h = Math.atan2(ny - y, nx - x);
    const r = this.ride; r.car.position.set(x, 0.2, -y); r.v = 0; r.setHeading(h);
    this.makeGate(1); this.makeGate(2);
    this.toast?.(`${course.name}: ${Math.round(course.len)} m · gold ${this.fmt(course.gold * 1000)}`);
    this.paint();
  }

  stop(msg) { this.state = "idle"; this.clearGates(); this.clearProps(); this.dropGhost(); this.paint(); if (msg) this.toast?.(msg); }
  fmt(ms) { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`; }

  makeGate(i) {
    const P = this.course.pts[i]; if (!P) return;
    const g = new THREE.Group(), next = this.course.pts[i + 1] || this.course.pts[i - 1], h = Math.atan2(next[1] - P[1], next[0] - P[0]);
    const col = i === this.cp ? 0xffd60a : 0x4da3ff;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.35, 8, 40), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
    ring.rotation.y = Math.PI / 2; ring.position.y = 6; ring.raycast = () => {};
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 90, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false }));
    beam.position.y = 45; beam.raycast = () => {};
    g.add(ring, beam); g.position.set(P[0], 0, -P[1]); g.rotation.y = -h + Math.PI; g.userData.gate = i;
    this.scene.add(g); (this.gates ||= []).push(g);
  }
  clearGates() { for (const g of this.gates || []) this.scene.remove(g); this.gates = []; }

  tick(dt) {
    if (this.state === "idle") return;
    if (this.ride.state !== "driving") return this.stop("Race over: you left the vehicle");
    this.t += dt;
    const r = this.ride, p = r.car.position;
    if (r.wrecked) return this.fail("Wrecked: race over");                                  // a real game ends the run when you total the vehicle
    if (this.state === "go" && this.t > (this.course.bronze || 120) * 2.5) return this.fail("Too slow: race over");
    this.tickProps(dt);
    if (this.state === "count") {
      r.v = 0;                                                                       // held on the line until GO
      if (this.t >= 0) { this.state = "go"; this.t = 0; this.toast?.("GO!"); }
    } else {
      this.recT += dt;
      if (this.recT >= 0.1) { this.recT -= 0.1; this.rec.push(+p.x.toFixed(1), +(-p.z).toFixed(1), +this.ride.heading.toFixed(2)); }       // 10 samples a second
      if (this.ghostMesh) {
        const g = this.ghostAt(this.t);
        if (g) { this.ghostMesh.visible = true; this.ghostMesh.position.set(g[0], (this.ride.ground?.h(g[0], g[1]) ?? 0) + 0.8, -g[1]); this.ghostMesh.rotation.y = g[2]; }
        else this.ghostMesh.visible = false;
      }
      const P = this.course.pts[this.cp];
      if (Math.hypot(P[0] - p.x, P[1] + p.z) < 13) {
        this.gateT[this.cp] = this.t;
        const G0 = this.ghosts[this.course.id]?.[this.kind()];
        if (G0?.gateT?.[this.cp] != null) { const dlt = this.t - G0.gateT[this.cp]; this.pop?.(`${dlt <= 0 ? "-" : "+"}${Math.abs(dlt).toFixed(2)} vs ghost`); }
        this.cp++;
        this.gates.filter(g => g.userData.gate < this.cp).forEach(g => this.scene.remove(g)); this.gates = this.gates.filter(g => g.userData.gate >= this.cp);
        if (this.cp >= this.course.pts.length) return this.finish();
        this.makeGate(this.cp + 1);
        for (const g of this.gates) if (g.userData.gate === this.cp) g.children.forEach(m => m.material.color.setHex(0xffd60a));
      }
    }
    this.paint();
  }

  fail(msg) { this.stop(); this.toast?.(`${msg} · press R to try again`); this.onFail?.({ id: this.lastId }); }

  finish() {
    const ms = this.t * 1000, c = this.course, s = ms / 1000;
    const medal = s <= c.gold ? "gold" : s <= c.silver ? "silver" : s <= c.bronze ? "bronze" : "none";
    const prev = this.best[c.id], pb = !prev || ms < prev;
    if (pb) { this.best[c.id] = ms; save(this.best); }
    const kind = this.kind(), G = this.ghosts[c.id]?.[kind], beatGhost = !!G && ms < G.ms, firstRun = !G;
    if (!G || ms < G.ms) { (this.ghosts[c.id] ||= {})[kind] = { ms, trace: this.rec, gateT: this.gateT.map(v => v == null ? null : +v.toFixed(2)) }; saveG(this.ghosts); }   // your best run becomes the ghost
    this.stop();
    this.toast?.(`${c.name}: ${this.fmt(ms)}${pb ? " · NEW BEST" : ""}${medal !== "none" ? ` · ${medal.toUpperCase()}` : ""}${beatGhost ? ` · beat your ghost by ${((G.ms - ms) / 1000).toFixed(2)} s` : firstRun ? " · ghost saved: race it next time (T to restart)" : ""}`);
    this.onFinish?.({ id: c.id, ms, medal, pb, beatGhost });
  }

  build() {
    this.el = document.createElement("div");
    this.el.style.cssText = "position:fixed;left:50%;top:calc(70px + env(safe-area-inset-top));transform:translateX(-50%);z-index:27;pointer-events:none;text-align:center;font:800 26px system-ui,sans-serif;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.7);display:none";
    document.body.appendChild(this.el);
  }
  paint() {
    if (this.state === "idle") { this.el.style.display = "none"; return; }
    this.el.style.display = "block";
    const c = this.course;
    if (this.state === "count") { const n = Math.ceil(-this.t); this.el.innerHTML = `<div style="font-size:64px">${n}</div><div style="font-size:14px;opacity:.8">${c.name}</div>`; return; }
    const best = this.best[c.id];
    this.el.innerHTML = `<div>${this.fmt(this.t * 1000)}</div><div style="font-size:14px;color:#ffd60a">Gate ${this.cp} / ${c.pts.length - 1}${best ? ` · best ${this.fmt(best)}` : ""} · T restart · R quit${this.ghostMesh ? " · racing your ghost" : ""}</div>`;
  }
}
