// XP, levels and objectives (single player; saved in this browser). Levels are objective-driven: finish a level's three
// objectives and the next opens. XP is the running score (what a leaderboard will rank). No money anywhere: only property and
// billboards cost money (product rule), so unlocks are vehicles / areas, never purchases.
// It watches the game instead of hooking into it: every 250 ms it samples where you are, in what, and how fast.
const KEY = "ts.progress.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const store = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

// metric: walk / run / bike / drive (metres), air (s on a bike jump), fly (s), sail (m), trips, escapes, landmarks, top (m/s)
export const LEVELS = [
  { name: "Walk and run", game: "Pokemon GO", unlock: "Motorcycles", goals: [["walk", 300, "Walk 300 m"], ["run", 100, "Run 100 m"], ["landmarks", 3, "Visit 3 landmarks"]] },
  { name: "Joyride", game: "Burnout", unlock: "Longer rides", goals: [["bike", 1000, "Ride a bike 1 km"], ["near", 5, "Make 5 near misses"], ["top", 15, "Reach 15 m/s (54 km/h)"]] },
  { name: "Stunt park", game: "Tony Hawk / Goat Simulator", unlock: "Stunt chains", park: true, goals: [["air", 5, "Get 5 s of air (ramps at the Stunt Park, Times Square)"], ["smashed", 15, "Smash 15 props at the Stunt Park"], ["chain", 1500, "Land a 1,500-point chain"]] },
  { name: "Taxi rush", game: "Crazy Taxi", unlock: "Fare jobs", goals: [["trips", 3, "Finish 3 fares (J while driving)"], ["fareScore", 1500, "Earn 1,500 fare points (near misses and air time buy time)"], ["drive", 3000, "Drive 3 km"]] },
  { name: "Time trial", game: "Trackmania", unlock: "Fast cars", goals: [["races", 1, "Finish a street race (press R while driving)"], ["ghostWins", 1, "Beat your own ghost (T restarts instantly)"], ["top", 21, "Reach 21 m/s (76 km/h) in a car"]] },
  { name: "Crash junction", game: "Burnout Crash Mode", unlock: "Heavy trucks", goals: [["junctions", 1, "Finish a Crash Junction run (X while driving)"], ["pileups", 6, "Cause 6 cars to pile up (cars hitting cars)"], ["chain", 5000, "Land a 5,000-point chain"]] },
  { name: "Heat", game: "Need for Speed", unlock: "Heat bonuses", goals: [["escapes", 2, "Escape 2 police chases"], ["stars", 3, "Reach 3 stars of heat (crash, near-miss, go fast)"], ["trips", 2, "Finish 2 fares"]] },
  { name: "Harbour dash", game: "Mario Kart", unlock: "Speedboat", goals: [["boatRaces", 1, "Finish the Hudson Dash in the speedboat (🚤 Speedboat race)"], ["boosts", 8, "Hit 8 boost pads (street or water)"], ["races", 3, "Finish 3 races (R while driving or in the boat)"]] },
  { name: "Sky", game: "Pilotwings", unlock: "All-vehicle free roam", goals: [["fly", 60, "Fly the plane for 60 s (Fly a plane)"], ["landings", 1, "Land on the Intrepid"], ["jumpPad", 1, "Parachute onto the target pad (J while flying high)"]] },
  { name: "Mayhem", game: "Goat Simulator", unlock: "Season leaderboard", goals: [["score", 25000, "Bank 25,000 chaos points"], ["smashed", 60, "Smash 60 props"], ["escapes", 2, "Escape 2 more chases"], ["fly", 120, "Fly 2 min"], ["sail", 1500, "Sail 1.5 km"], ["landmarks", 12, "Visit 12 new landmarks"], ["wolves", 10, "Find 10 golden wolves (Wolf Hunt)"]] },
];
const XP = { m: 0.1, landmark: 50, trip: 40, escape: 150, goal: 100, air: 5, level: 250 };   // per metre moved (any way) / event

export class Progress {
  // o: { getPos: () => {x, y, z, mode, kind} (local metres), nav, fares, pursuit, ride, toast }
  constructor(o) {
    Object.assign(this, o);
    const s = load() || {};
    this.s = { level: 1, xp: 0, m: {}, base: {}, seen: [], escapes: 0, ...s };
    for (const k of ["walk", "run", "bike", "drive", "air", "fly", "sail", "trips", "escapes", "landmarks", "top", "near", "crashes", "chain", "score", "races", "fareScore", "stars", "boosts", "smashed", "landings", "jumpPad", "junctions", "pileups", "boatRaces", "ghostWins", "wolves"]) this.s.m[k] ??= 0;
    this.s.base = { ...this.s.m, ...this.s.base };                 // the totals when this level began
    this.last = null; this.lastPursuit = null; this.dirty = 0;
    this.build();
    setInterval(() => this.tick(0.25), 250);
  }

  get level() { return Math.min(this.s.level, LEVELS.length); }
  get done() { return this.s.level > LEVELS.length; }
  value(k) { return k === "top" || k === "chain" || k === "stars" ? this.s.m[k] : this.s.m[k] - (this.s.base[k] || 0); }   // best-of metrics are absolute per level; the rest count from level start   // top speed is absolute; the rest count from level start

  add(k, n) { this.s.m[k] += n; }
  xp(n) { this.s.xp += n; }

  tick(dt) {
    const p = this.getPos?.();
    if (!p || document.body.classList.contains("loading")) return;
    const m = this.s.m;
    if (this.last) {
      const d = Math.hypot(p.x - this.last.x, p.y - this.last.y);
      if (d < 40) {                                              // a jump this big is a teleport: ignore
        const v = d / dt;
        if (p.mode === "walk") { this.add("walk", d); if (v > 3) this.add("run", d); this.xp(d * XP.m); }
        else if (p.mode === "ride") {
          const k = p.kind === "bike" ? "bike" : "drive";
          if (p.driving) { this.add(k, d); this.xp(d * XP.m * 0.4); m.top = Math.max(m.top, v); }
          if (p.air) { this.add("air", dt); this.xp(XP.air * dt); }
        } else if (p.mode === "boat") { this.add("sail", d); this.xp(d * XP.m * 0.4); }
      }
      if (p.mode === "fly") { this.add("fly", dt); this.xp(dt); }
    }
    this.last = p;
    // landmarks: be within 35 m of one (at street/sea/low level) once
    if (p.z < (p.mode === "fly" ? 400 : 80)) for (const pl of this.nav.places) {
      if (pl.kind !== "landmark" || pl.x == null || this.s.seen.includes(pl.id)) continue;
      if (Math.hypot(pl.x - p.x, pl.y - p.y) < 35) { this.s.seen.push(pl.id); this.add("landmarks", 1); this.xp(XP.landmark); this.say(`Visited ${pl.name}  +${XP.landmark} XP`); }
    }
    const fs = this.fares?.stats?.score ?? 0;
    if (this.fsSeen == null) this.fsSeen = fs;
    if (fs > this.fsSeen) { this.add("fareScore", fs - this.fsSeen); this.fsSeen = fs; }
    const tr = this.fares?.stats?.trips ?? 0;
    if (this.tripsSeen == null) this.tripsSeen = tr;
    if (tr > this.tripsSeen) { this.add("trips", tr - this.tripsSeen); this.xp(XP.trip * (tr - this.tripsSeen)); this.tripsSeen = tr; }
    const ps = this.getPursuit?.()?.state;
    if (ps === "escaped" && this.lastPursuit !== "escaped") { this.add("escapes", 1); this.xp(XP.escape); this.say(`Escaped!  +${XP.escape} XP`); }
    this.lastPursuit = ps;
    if (this.heat) m.stars = Math.max(m.stars, this.heat.maxStars || 0);
    const C = this.chaos;                                                      // the chaos chain feeds four metrics
    if (C) {
      const d = (k, now) => { const last = this.cs?.[k] ?? now; if (now > last) this.s.m[k] += now - last; (this.cs ||= {})[k] = now; };
      d("near", C.nearCount || 0); d("crashes", C.bigCrashes || 0); d("score", C.s.total);
      m.chain = Math.max(m.chain, C.s.bestChainSession || 0);
    }
    this.check();
    if (++this.dirty % 8 === 0) store(this.s);
    this.paint();
  }

  check() {
    if (this.done) return;
    const L = LEVELS[this.level - 1];
    for (let i = 0; i < L.goals.length; i++) {
      const [k, n, label] = L.goals[i], ok = this.value(k) >= n;
      if (ok && !(this.s.ticked ||= {})[this.level + ":" + i]) { this.s.ticked[this.level + ":" + i] = 1; this.xp(XP.goal * this.level); this.say(`✓ ${label}  +${XP.goal * this.level} XP`); }
    }
    if (L.goals.every(([k, n]) => this.value(k) >= n)) {
      this.xp(XP.level * this.level);
      import("./analytics.js").then(({ Analytics }) => Analytics.track("level_up", { level: this.s.level + 1 }));
      this.s.level++; this.s.m.top = 0; this.s.m.chain = 0; this.s.m.stars = 0; if (this.heat) this.heat.maxStars = 0; if (this.chaos) this.chaos.s.bestChainSession = 0; this.s.base = { ...this.s.m };
      store(this.s);
      if (this.done) this.say("Legend! You finished every level");
      else this.say(`Level ${this.s.level - 1} complete → Level ${this.s.level}: ${LEVELS[this.s.level - 1].name}. Unlocked: ${L.unlock}`, 6500);
    }
  }

  // the place the current level wants you to go: the nearest landmark you have not visited yet (while that goal is unmet)
  nextGoalPlace() {
    if (this.done || !this.last) return null;
    const L = LEVELS[this.level - 1];
    if (L.park && L.goals.some(([k, n]) => this.value(k) < n)) {                         // the Stunt Park level sends you to the park
      const sp = this.nav.places.find(p => p.id === "stuntpark");
      if (sp) return { id: "goal_stuntpark", name: "Goal: Stunt Park", x: sp.x, y: sp.y, kind: "goal", sub: "ramps and props" };
    }
    const g = L.goals.find(([k, n]) => k === "landmarks" && this.value(k) < n);
    if (!g) return null;
    const harbour = /harbour|sky/i.test(L.name);
    let best = null, bd = Infinity;
    for (const pl of this.nav.places) {
      if (pl.kind !== "landmark" || pl.x == null || this.s.seen.includes(pl.id)) continue;
      const inMid = pl.x > -1750 && pl.x < 960 && pl.y > -720 && pl.y < 740;
      if (!harbour && !inMid) continue;                                             // Midtown levels send you to Midtown places
      const d = Math.hypot(pl.x - this.last.x, pl.y - this.last.y);
      if (d < bd) { bd = d; best = pl; }
    }
    return best && { id: "goal_lm_" + best.id, name: "Goal: " + best.name, x: best.x, y: best.y, kind: "goal", sub: g[2] };
  }

  say(t, ms) { this.toast?.(t, ms); }

  // ---- HUD: a small chip (level + XP) that opens the objectives
  build() {
    const st = document.createElement("style");
    st.textContent = `#prog{position:fixed;left:12px;top:calc(60px + env(safe-area-inset-top));z-index:25;font:600 12px system-ui,sans-serif;color:#fff;max-width:250px}
      #prog .chip{display:flex;gap:8px;align-items:center;padding:6px 10px;border-radius:999px;background:rgba(20,20,24,.72);border:1px solid rgba(255,255,255,.2);cursor:pointer;backdrop-filter:blur(8px);width:max-content}
      #prog .lv{background:#ffd60a;color:#111;border-radius:999px;padding:1px 7px;font-weight:800}
      #prog .card{display:none;margin-top:6px;padding:10px 12px;border-radius:14px;background:rgba(20,20,24,.82);border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(8px)}
      #prog.open .card{display:block}
      #prog .g{margin:6px 0 0;font-weight:500}#prog .g.ok{opacity:.55;text-decoration:line-through}
      #prog .bar{height:4px;border-radius:2px;background:rgba(255,255,255,.2);margin-top:3px;overflow:hidden}#prog .bar i{display:block;height:100%;background:#30d158}`;
    document.head.appendChild(st);
    this.el = document.createElement("div"); this.el.id = "prog";
    this.el.innerHTML = `<div class="chip" role="button" tabindex="0" aria-label="Level and objectives"></div><div class="card"></div>`;
    document.body.appendChild(this.el);
    const chip = this.el.querySelector(".chip");
    chip.addEventListener("click", () => { this.el.classList.toggle("open"); chip.blur(); });
    chip.addEventListener("keydown", e => e.stopPropagation());
    this.chip = chip; this.card = this.el.querySelector(".card");
  }

  paint() {
    if (this.missionStats) {                                                       // one spine: the chip counts missions, not levels
      const st = this.missionStats(), sg = `${st.done}/${st.total}|${Math.round(this.s.xp)}`;
      if (sg !== this._sig) { this._sig = sg; this.chip.innerHTML = `<span class="lv">${st.done}/${st.total}</span> Missions · ${Math.round(this.s.xp).toLocaleString()} XP`; }
      return;
    }
    const sig = `${this.s.level}|${Math.round(this.s.xp)}|${Math.round(this.value(LEVELS[this.level - 1].goals[0][0]))}|${this.el.classList.contains("open")}`;
    if (sig === this._sig) return; this._sig = sig;
    const L = LEVELS[this.level - 1];
    this.chip.innerHTML = this.done ? `<span class="lv">MAX</span>${Math.round(this.s.xp).toLocaleString()} XP` : `<span class="lv">Lv ${this.level}</span>${L.name} · ${Math.round(this.s.xp).toLocaleString()} XP`;
    if (!this.el.classList.contains("open")) return;
    this.card.innerHTML = this.done ? "All levels complete." : `<b>Level ${this.level}: ${L.name}</b>` + L.goals.map(([k, n, label]) => {
      const v = Math.min(n, this.value(k)), ok = v >= n;
      return `<div class="g${ok ? " ok" : ""}">${label}<div class="bar"><i style="width:${(v / n * 100).toFixed(0)}%"></i></div></div>`;
    }).join("") + `<div class="g" style="opacity:.7">Unlocks: ${L.unlock}</div>`;
  }
}
