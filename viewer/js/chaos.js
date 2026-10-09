// The Chaos chain (Tony Hawk's combo / Burnout's takedown chain): while you drive, near-misses, air time, big crashes and speed
// add points to a running chain whose multiplier climbs with every new trick; 4 s of nothing and the chain banks to your score,
// a crash into something solid costs the multiplier. The score is what the leaderboard will rank; the best chain is what you clip.
// It watches the game (every frame it samples ride + traffic), so no other module needs to know it exists.
import * as THREE from "three";
const KEY = "ts.chaos.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

export class Chaos {
  // o: { ride, traffic: () => traffic, onBest(chain), toast }
  constructor(o) {
    Object.assign(this, o);
    this.s = { total: 0, best: 0, bestChain: 0, ...(load() || {}) };
    this.listeners = [];
    this.chain = 0; this.mult = 1; this.idle = 0; this.air = 0; this.near = new Map(); this.lastCrash = 0;
    this.build();
    setInterval(() => this.tick(0.1), 100);
  }

  active() { return this.ride.state === "driving" && this.ride.car?.visible; }

  tick(dt) {
    const r = this.ride;
    if (r.onBump !== this.wrapped) { const prev = r.onBump; this.wrapped = r.onBump = s => { prev?.(s); this.crash(s); }; }   // whoever sets onBump last, we sit on top
    if (!this.active()) { if (this.chain > 0) this.bank("Left the vehicle"); this.paint(); return; }
    const v = Math.abs(r.v), tr = this.traffic?.();
    // near-miss: pass within ~1.6 m of a moving car or person-sized obstacle at speed, without touching it
    if (tr?.ready && v > 8) {
      const p = r.car.position, x = p.x, y = -p.z;
      for (const c of tr.cars) {
        if (!c.alive) continue;
        const d = Math.hypot(c.x - x, c.y - y), key = c.id;
        if (d < 2.0 && d > 1.0 + (c.motorcycle ? 0 : 0.6)) { const t = this.near.get(key) || 0; if (!t) this.near.set(key, performance.now()); }
        else if (this.near.has(key) && d > 4) {                              // passed it and is clear again: that was a near miss
          const t0 = this.near.get(key); this.near.delete(key);
          if (performance.now() - t0 < 2500 && performance.now() - this.lastCrash > 1500) { this.nearCount = (this.nearCount || 0) + 1; this.add(40 + v * 3, "Near miss", "near"); }
        }
      }
    }
    // air time (bike jump): points per second airborne, a landing bonus on touch-down
    if (r.bikeAir > 0) this.air += dt;
    else if (this.air > 0.35) { this.add(Math.round(this.air * 220), `Air ${this.air.toFixed(1)} s`, "air", this.air); this.air = 0; }
    else this.air = 0;
    this.idle += dt;
    if (this.chain > 0 && this.idle > 4) this.bank("Banked");
    this.paint();
  }

  add(points, label, kind = label, extra = 0) {
    this.onTrick?.(kind, points, extra);
    for (const f of this.listeners) f(kind, points, extra);
    this.mult = Math.min(10, this.mult + 0.5);
    this.chain += Math.round(points * this.mult);
    this.idle = 0; this.popText(`${label}  +${Math.round(points * this.mult)}`);
  }

  // a crash: big impacts are spectacle (points), but the chain's multiplier drops
  crash(s) {
    if (!this.active() || s < 0.15) return;
    this.lastCrash = performance.now();
    for (const f of this.listeners) f("crashHit", s, 0);
    if (s > 0.35) this.bigCrashes = (this.bigCrashes || 0) + 1;
    this.add(Math.round(60 + s * 500), s > 0.6 ? "BIG CRASH" : "Crash");
    this.mult = Math.max(1, this.mult * 0.5);
    this.onBigMoment?.(s);
  }

  bank(why) {
    if (this.chain <= 0) return;
    const n = Math.round(this.chain); this.s.bestChainSession = Math.max(this.s.bestChainSession || 0, n);
    this.s.total += n; if (n > this.s.bestChain) { this.s.bestChain = n; this.onBest?.(n); }
    this.s.best = Math.max(this.s.best, this.s.total);
    save(this.s);
    this.popText(`${why}: ${n.toLocaleString()} pts`, true);
    this.chain = 0; this.mult = 1; this.idle = 0;
  }

  build() {
    const st = document.createElement("style");
    st.textContent = `#chaos{position:fixed;left:50%;top:calc(120px + env(safe-area-inset-top));transform:translateX(-50%);z-index:27;text-align:center;pointer-events:none;font:800 28px system-ui,sans-serif;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.6);display:none}
      #chaos .m{font-size:15px;color:#ffd60a;letter-spacing:.06em}#chaos .bar{width:140px;height:5px;margin:6px auto 0;border-radius:3px;background:rgba(255,255,255,.25);overflow:hidden}#chaos .bar i{display:block;height:100%;background:#ffd60a}
      #chaospop{position:fixed;left:50%;top:calc(200px + env(safe-area-inset-top));transform:translateX(-50%);z-index:27;pointer-events:none;font:800 20px system-ui,sans-serif;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.7);opacity:0;transition:opacity .25s,transform .25s}
      #chaospop.on{opacity:1;transform:translateX(-50%) scale(1.08)}#chaospop.bank{color:#30d158}`;
    document.head.appendChild(st);
    this.el = document.createElement("div"); this.el.id = "chaos"; this.el.innerHTML = `<div class="n"></div><div class="m"></div><div class="bar"><i></i></div>`;
    this.pop = document.createElement("div"); this.pop.id = "chaospop";
    document.body.append(this.el, this.pop);
  }
  popText(t, bank = false) {
    this.pop.textContent = t; this.pop.classList.toggle("bank", bank); this.pop.classList.add("on");
    clearTimeout(this.pt); this.pt = setTimeout(() => this.pop.classList.remove("on"), 1300);
  }
  paint() {
    const on = this.active() && this.chain > 0;
    this.el.style.display = on ? "block" : "none";
    if (!on) return;
    this.el.querySelector(".n").textContent = Math.round(this.chain).toLocaleString();
    this.el.querySelector(".m").textContent = `CHAOS x${this.mult.toFixed(1)}`;
    this.el.querySelector(".bar i").style.width = `${Math.max(0, 100 - this.idle / 4 * 100)}%`;
  }
}
