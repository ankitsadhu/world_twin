// Crash Junction (Burnout's Crash Mode): X while driving drops you 170 m before a busy Midtown junction with a rush of cars crossing it.
// You have 30 s from the first hit to cause the biggest pile-up: every car you hit, and every car that gets hit by those cars, scores, and
// a long chain multiplies it. Banked into your chaos total with a medal. No people are involved: only cars (and the occasional cone).
import * as THREE from "three";
const KEY = "ts.crash.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

export class CrashJunction {
  // o: { ride, traffic: () => traffic, chaos, toast, onFinish({score, cars, pileups, medal}) }
  constructor(o) {
    Object.assign(this, o);
    this.best = load(); this.state = "idle"; this.t = 0; this.seen = new Map();
    this.build();
    addEventListener("keydown", e => { if (e.code === "KeyX" && !e.repeat && e.target.tagName !== "INPUT" && this.ride.state === "driving") this.toggle(); });
    setInterval(() => this.tick(0.1), 100);
  }

  junction() {
    const T = this.traffic?.(); if (!T?.avenues?.length) return null;
    if (this.forced) { const a = T.avenues.find(a => Math.abs(T.lanesOf(a, "ave")[2] - this.forced[0]) < 8), s = T.streets.find(s => Math.abs(s.y - this.forced[1]) < 8); if (a && s) return { a, s, ax: T.lanesOf(a, "ave")[2], d: 0 }; }
    const p = this.ride.car.position, x = p.x, y = -p.z;
    let best = null;
    for (const a of T.avenues) for (const s of T.streets) {
      const lanes = T.lanesOf(a, "ave"), ax = lanes[2];
      const d = Math.hypot(ax - x, s.y - y);
      if (d < 150 || d > 900) continue;                                     // not right on top of you, not across the city
      const sy0 = s.y - a.dir * 170;                                        // approach along the avenue's one-way direction
      if (!T.inBounds(ax, sy0) || !T.inBounds(ax, s.y) || !T.drivable(ax, sy0) || !T.drivable(ax, s.y)) continue;
      if (!best || d < best.d) best = { a, s, ax, d };
    }
    return best;
  }

  runAt(x, y) { this.forced = [x, y]; if (this.state === "idle") this.toggle(); }

  toggle() {
    if (this.state !== "idle") return this.stop("Crash run cancelled");
    const J = this.junction(), T = this.traffic?.();
    if (!J || !T?.ready) return this.toast?.("No junction near enough for a crash run: drive a little further");
    this.J = J; const a = J.a, s = J.s, lanes = T.lanesOf(a, "ave");
    // the rush: cars on the avenue flowing into the junction, and cross-street cars about to cross it
    const mk = (x, y, h, v) => {
      const type = T.pickType();
      const c = { id: ++T.nextId, x, y, h, v, type, alive: true, motorcycle: false, actor: null, turn: null, blocked: 0, lastCross: null, mode: "driving",
        vx: Math.cos(h) * v, vy: Math.sin(h) * v, omega: 0, hitT: 0, crashedT: 0, junctionCar: true, reckless: v + 3, hold: true };
      T.cars.push(c); return c;
    };
    for (const c of T.cars) if (c.alive && !c.pursuit && Math.hypot(c.x - lanes[2], c.y - s.y) < 150) c.alive = false;   // clear the box first
    const ah = a.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    for (let i = 0; i < 7; i++) mk(lanes[[0, 1, 3, 4, 1, 3, 0][i]], s.y - a.dir * (28 + i * 17), ah, 8);
    const sh = (s.dir || 1) > 0 ? 0 : Math.PI, slanes = T.lanesOf(s, "st"), sdir = (s.dir || 1);
    for (let i = 0; i < 8; i++) mk(lanes[2] - sdir * (96 + i * 9), slanes[i % slanes.length], sh, 10);        // timed to reach the junction as you do (~10 s)
    // you: 170 m up the avenue, pointing at the junction
    const r = this.ride; r.car.position.set(lanes[2], 0.2, -(s.y - a.dir * 170)); r.v = 0; r.setHeading(ah);
    this.ride.invincible = true; this.ride.damage = 0; this.ride.wrecked = false;
    this.state = "count"; this.t = -3; this.hitT = null; this.seen = new Map(); this.points = 0; this.chain = 0; this.pile = 0;
    this.toast?.(`Crash junction: hit the cars crossing the junction. 30 s from your first hit. X to quit`);
    this.paint();
  }

  stop(msg) { this.ride.invincible = false; this.state = "idle"; this.paint(); if (msg) this.toast?.(msg); }

  tick(dt) {
    if (this.state === "idle") return;
    const r = this.ride, T = this.traffic?.();
    if (r.state !== "driving") return this.stop("Crash run over: you left the vehicle");
    this.t += dt;
    if (this.state === "count") {
      r.v = 0;
      if (this.t >= 0) { this.state = "go"; this.t = 0; this.toast?.("GO!"); for (const c of this.traffic().cars) if (c.hold) { c.hold = false; c.v = c.reckless - 3; } }
    } else {
      // count every car that gets knocked about, and whether it was you or the pile-up that did it
      const p = r.car.position, px = p.x, py = -p.z;
      for (const c of T.cars) {
        if (!c.alive || c.pursuit || (c.mode !== "kicked" && c.mode !== "crashed")) continue;
        const near = Math.hypot(c.x - px, c.y - py) < 7 && Math.abs(r.v) > 2;
        const was = this.seen.get(c.id);
        if (was && !(was === "early" && near)) continue;                                      // already scored (a wreck from before you arrived scores when you plough into it)
        if (this.hitT == null && !near) { this.seen.set(c.id, "early"); continue; }        // they crashed before you arrived: not yours
        this.seen.set(c.id, near ? "hit" : "pile");
        if (this.hitT == null) this.hitT = this.t;
        this.chain++; const base = near ? 220 : 160, pts = Math.round(base * (1 + Math.min(6, this.chain) * 0.25));
        this.points += pts; if (!near) this.pile++;
        this.pop?.(near ? `HIT  +${pts}` : `PILE-UP!  +${pts}`);
      }
      if (this.hitT != null && this.t - this.hitT > 30) return this.finish();
      if (this.hitT == null && this.t > 40) return this.stop("Time's up: you never hit anything");
    }
    this.paint();
  }

  finish() {
    const cars = [...this.seen.values()].filter(v => v !== "early").length, score = this.points + cars * 100, medal = score >= 6000 ? "gold" : score >= 3500 ? "silver" : score >= 1800 ? "bronze" : "none";
    const prev = this.best.score || 0, pb = score > prev;
    if (pb) { this.best.score = score; save(this.best); }
    this.stop();
    this.chaos.s.total += score; this.chaos.s.best = Math.max(this.chaos.s.best, this.chaos.s.total);
    const text = (`Crash junction: ${cars} cars · ${this.pile} pile-ups · ${score.toLocaleString()} pts${medal !== "none" ? " · " + medal.toUpperCase() : ""}${pb ? " · NEW BEST" : ""}`);
    if (this.onResult) this.onResult(text, () => this.runAt(this.J.ax, this.J.s.y)); else this.toast?.(text);
    this.onFinish?.({ score, cars, pileups: this.pile, medal });
  }

  build() {
    this.el = document.createElement("div");
    this.el.style.cssText = "position:fixed;left:50%;top:calc(70px + env(safe-area-inset-top));transform:translateX(-50%);z-index:27;pointer-events:none;text-align:center;font:800 26px system-ui,sans-serif;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.7);display:none";
    document.body.appendChild(this.el);
  }
  paint() {
    if (this.state === "idle") { this.el.style.display = "none"; return; }
    this.el.style.display = "block";
    if (this.state === "count") { this.el.innerHTML = `<div style="font-size:64px">${Math.ceil(-this.t)}</div><div style="font-size:14px;opacity:.8">Crash junction: aim for the crossing traffic</div>`; return; }
    const left = this.hitT == null ? null : Math.max(0, 30 - (this.t - this.hitT));
    this.el.innerHTML = `<div>${this.points.toLocaleString()} <span style="font-size:15px;color:#ffd60a">${[...this.seen.values()].filter(v => v !== "early").length} cars</span></div><div style="font-size:14px;color:#ffd60a">${left == null ? "Hit something!" : `${left.toFixed(0)} s left`}${this.pile ? ` · ${this.pile} pile-ups` : ""} · X to quit</div>`;
  }
}
