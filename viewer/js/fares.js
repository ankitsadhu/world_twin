// Cab fares: the game's first job loop (GTA's taxi missions, minus the crime).
// In a cab you're driving, "Take fares" (J): someone waits at a curb nearby with a yellow beacon; pull up beside them
// and stop, they get in and name a real Midtown place; drive there before the clock runs out. Each trip is rated 1-5
// stars (late or bumpy rides cost stars); your driver rating, trips and on-time streak are saved in this browser.
// No money here: the only money in this game is buying property and billboards (product rule, 2026-10-03).
import * as THREE from "three";
import { Avatar, npcPool } from "./avatar.js";

const KEY = "ts.fares";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };
const LINES = [                                                          // what people say getting in (no crime, no drama)
  "Hi! {d}, please.", "{d}. I'm running a little late.", "Could you take me to {d}?", "{d}, thanks. Scenic route's fine.",
  "{d} please. First time in New York!", "Hey! {d}, and step on it if you can.",
];

export class Fares {
  // o: { ride, nav, scene, camera, loader, root, getCrowd, groundAt, toast, playerId: () => id }
  constructor(o) {
    Object.assign(this, o);
    this.stats = { trips: 0, stars: 0, streak: 0, best: 0, ...(load() || {}) };
    this.active = false; this.job = null; this.rng = Math.random;
    this.buildDOM();
    addEventListener("keydown", e => {
      if (e.code === "KeyJ" && !e.repeat && e.target.tagName !== "INPUT" && !document.body.classList.contains("flying")) this.toggle();
    });
  }

  get canDrive() { return this.ride.state === "driving"; }                    // any vehicle: a bike takes a passenger on the back
  rating() { return this.stats.trips ? this.stats.stars / this.stats.trips : 0; }

  buildDOM() {
    const css = document.createElement("style");
    css.textContent = `
      #farehud { position: fixed; left: 50%; top: calc(122px + env(safe-area-inset-top));   /* under the message cards */ transform: translateX(-50%); z-index: 26;
        display: none; align-items: center; gap: var(--s3); padding: var(--s2) var(--s4); max-width: calc(100% - 32px); box-sizing: border-box; }
      #farehud .score { font-weight: var(--w-bold); color: var(--accent); white-space: nowrap; }
      #farehud .tx { font-size: var(--t-caption); color: var(--ink); }
      #farehud .clock { font-variant-numeric: tabular-nums; font-weight: var(--w-bold); white-space: nowrap; }
      #farehud .clock.late { color: var(--danger, #ff453a); }`;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML("beforeend", `<div id="farehud" class="ui-surface" role="status" aria-live="polite">
      <span class="score"></span><span class="tx"></span><span class="clock"></span></div>`);
    this.hud = document.getElementById("farehud");
  }

  toggle() {
    if (this.active) return this.stop("Off duty. " + this.summary());
    if (!this.canDrive) return this.toast?.("Take the wheel of a bike or car first, then J for fares.");
    this.active = true;
    this.toast?.("On duty: find your first passenger (yellow beacon).");
    this.ride.render?.();                                      // the panel's button now says "Off duty"
    this.next();
  }
  summary() { return `${this.stats.trips} trips · ${this.rating().toFixed(1)}★ driver rating · best on-time streak ${this.stats.best}`; }

  stop(msg) {
    this.active = false;
    this.clearJob();
    this.hud.style.display = "none";
    if (this.ride.state === "driving") this.ride.render?.();
    if (msg) this.toast?.(msg);
  }
  clearJob() {
    if (this.job?.who) { if (this.ride.passenger === this.job.who) this.ride.unseatPassenger(); this.job.who.object.removeFromParent(); }
    if (this.job?.left) this.scene.remove(this.job.left.object);
    this.job = null;
    this.nav.setWaypoint?.(null);
  }

  // a curb (sidewalk next to a drivable road) 180-450 m away; a real place 500-1700 m from there to go to
  async next() {
    const roads = this.ride.roads;
    const c = this.ride.car.position, cx = c.x, cy = -c.z;
    let pick = null;
    for (let k = 0; k < 40 && !pick; k++) {
      const a = this.rng() * 6.283, r = 180 + this.rng() * 270;
      const pts = roads.projectAll(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1);
      const p = pts?.[0];
      if (!p) continue;
      const curb = this.curbNear(p.x, p.y);
      if (curb) pick = { road: p, curb };
    }
    const places = (this.nav.places || []).filter(q => (q.kind === "landmark" || q.kind === "intersection") && q.x > -1700 && q.x < 900 && q.y > -680 && q.y < 700);
    const far = pick && places.filter(q => { const d = Math.hypot(q.x - pick.curb[0], q.y - pick.curb[1]); return d > 500 && d < 1700; });
    if (!pick || !far?.length) { this.toast?.("No fares around here right now. Drive on and try again (J)."); this.active = false; return; }
    const dest = far[Math.floor(this.rng() * far.length)];
    const pool = npcPool(this.playerId?.());
    const who = await Avatar.create(this.loader, this.root, pool[Math.floor(this.rng() * pool.length)], { far: true, rng: this.rng }).catch(() => null);
    if (!this.active) { if (who) this.scene.remove(who.object); return; }
    const [px, py] = pick.curb, g = this.groundAt(new THREE.Vector3(px, 3, -py));
    const face = Math.atan2(pick.road.x - px, -(pick.road.y - py));           // facing the road, arm out for a cab
    if (who) { who.set(px, g, -py, face, 0); who.update(0.016); this.scene.add(who.object); }
    this.job = { stage: "pickup", who, curb: pick.curb, dest, t0: performance.now(), crashes: 0 };
    this.nav.setWaypoint?.({ id: "fare", name: "Passenger", kind: "point", x: px, y: py });
    this.hud.style.display = "flex";
    this.draw();
  }

  curbNear(x, y) {
    const W = this.getCrowd?.()?.walk;
    if (!W) return [x, y];
    for (let r = 4; r <= 16; r += 2) for (let k = 0; k < 8; k++) {
      const a = k / 8 * 6.283, cx = x + Math.cos(a) * r, cy = y + Math.sin(a) * r;
      if (W.at(cx, cy) === 1) return [cx, cy];
    }
    return null;
  }

  // Crazy Taxi: tricks buy time. A near miss +1.5 s, air time +2 s per second airborne (max 5 s), a big crash costs nothing but the chain
  trick(kind, points, extra) {
    const J = this.job; if (!this.active || J?.stage !== "ride") return;
    const sec = kind === "near" ? 1.5 : kind === "air" ? Math.min(5, extra * 2) : 0;
    if (!sec) return;
    J.bonus += sec; J.tricks++;
    this.flash?.(`+${sec.toFixed(1)} s`);
  }

  // a crash during a trip (ride.onBump hooks in here): the trip's stars suffer
  bump(s) { if (this.job?.stage === "ride" && s > 0.25) this.job.crashes++; }

  update(dt) {
    if (!this.active) return;
    if (!this.canDrive) {                                     // left the cab / handed over the wheel: off duty
      if (this.ride.state !== "driving") return this.stop("Off duty (you left the driver's seat). " + this.summary());
    }
    const J = this.job;
    if (!J) return;
    const c = this.ride.car.position, x = c.x, y = -c.z, v = Math.abs(this.ride.v);
    if (J.who) J.who.update(dt);
    if (J.stage === "pickup") {
      const d = Math.hypot(x - J.curb[0], y - J.curb[1]);
      if (d < 11 && v < 1.2) {                                // pulled up beside them: they get in
        if (J.who) this.ride.seatPassenger(J.who);                                   // they climb on / in
        const dist = this.routeLength(J.curb, [J.dest.x, J.dest.y]);
        Object.assign(J, { stage: "ride", start: [x, y], dist, limit: dist / 11 + 22, bonus: 0, tricks: 0, t0: performance.now() });
        this.nav.setWaypoint?.(J.dest);
        this.toast?.(`"${LINES[Math.floor(this.rng() * LINES.length)].replace("{d}", J.dest.name)}"`);
      }
    } else if (J.stage === "ride") {
      const d = Math.hypot(x - J.dest.x, y - J.dest.y);
      if (d < 45 && v < 1.2) this.dropOff();
      else if (J.limit + J.bonus - (performance.now() - J.t0) / 1000 < -8) {            // Crazy Taxi: out of time, the passenger bails
        this.stats.streak = 0; save(this.stats);
        this.toast?.("Time's up! The passenger got out. No fare");
        this.clearJob(); setTimeout(() => this.active && !this.job && this.next(), 2000);
        return;
      }
    }
    this.draw();
  }

  routeLength(a, b) {
    const R = this.ride.roads, p = R.projectAll(a[0], a[1], 1)?.[0], q = R.projectAll(b[0], b[1], 1)?.[0];
    const pts = p && q ? R.route(p, q) : null;
    if (!pts) return Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.3;
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }

  dropOff() {
    const J = this.job, secs = (performance.now() - J.t0) / 1000, late = secs > J.limit + J.bonus;
    const stars = Math.max(1, Math.min(5, Math.round(5 - J.crashes * 0.8 - (late ? 1.5 : 0))));
    const streak = late ? 0 : this.stats.streak + 1;
    Object.assign(this.stats, { trips: this.stats.trips + 1, stars: this.stats.stars + stars, streak, best: Math.max(this.stats.best, streak) });
    save(this.stats);
    const spare = Math.max(0, Math.round(J.limit + J.bonus - secs));
    const score = Math.round(J.dist * 0.35 + spare * 25 + J.tricks * 60) * (late ? 0 : 1 + Math.min(4, streak - 1) * 0.25);   // Crazy Taxi: speed + tricks, a streak multiplies it
    this.stats.score = (this.stats.score || 0) + score; this.onScore?.(score, { late, spare, tricks: J.tricks, streak });
    this.toast?.(`${"★".repeat(stars)}${"☆".repeat(5 - stars)}  ${late ? "Late" : `On time, ${spare} s to spare`}${J.crashes ? ` · ${J.crashes} bump${J.crashes > 1 ? "s" : ""}` : ""}${streak > 1 ? ` · ${streak} on time in a row` : ""}${late ? "" : ` · ${Math.round(score).toLocaleString()} pts`}`);
    const gone = this.ride.unseatPassenger();                                          // they step out beside you, then are gone
    if (gone) { J.who = null; setTimeout(() => gone.object.removeFromParent(), 4000); }
    this.clearJob();
    setTimeout(() => this.active && !this.job && this.next(), 2500);
  }

  draw() {
    const J = this.job;
    this.hud.querySelector(".score").textContent = this.stats.trips ? `${this.rating().toFixed(1)}★` : "New driver";
    const tx = this.hud.querySelector(".tx"), clock = this.hud.querySelector(".clock");
    if (!J) { tx.textContent = "Looking for a fare…"; clock.textContent = ""; return; }
    if (J.stage === "pickup") {
      const c = this.ride.car.position, d = Math.hypot(c.x - J.curb[0], -c.z - J.curb[1]);
      tx.textContent = `Pick up your passenger · ${d < 1000 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1) + " km"} · stop beside them`;
      clock.textContent = "";
    } else {
      const left = J.limit + (J.bonus || 0) - (performance.now() - J.t0) / 1000;
      tx.textContent = `To ${J.dest.name}${J.crashes ? ` · ${J.crashes} bump${J.crashes > 1 ? "s" : ""}` : ""}`;
      clock.textContent = left > 0 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}` : "late";
      clock.classList.toggle("late", left < 15);
    }
  }

  // the minimap / map route while on a fare (same shape as ride.mapInfo)
  mapInfo() {
    const J = this.job;
    if (!this.active || !J) return null;
    const c = this.ride.car.position, x = c.x, y = -c.z, tgt = J.stage === "pickup" ? J.curb : [J.dest.x, J.dest.y];
    const now = performance.now();
    if (!J.route || now - (J.routeT || 0) > 2000) {
      const R = this.ride.roads, p = R.projectAll(x, y, 1)?.[0], q = R.projectAll(tgt[0], tgt[1], 1)?.[0];
      J.route = (p && q && R.route(p, q)) || [[x, y], tgt]; J.routeT = now;
    }
    return { car: [x, y], route: J.route };
  }
}
