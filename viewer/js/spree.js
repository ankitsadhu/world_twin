// Smash Spree: 60 seconds to hit as many things as you can (street furniture, crates, barrels, wrecks). Every hit inside 3 s of the last one grows the chain,
// and the chain multiplies the score. Hits are read from the chaos meter's own "smash" and "Crash" events, so anything that scores there counts here.
const KEY = "ts.spree.v1", LEN = 60, GAP = 3;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

export class SmashSpree {
  // o: { ride, chaos, toast, onFinish({score, hits, chain, medal}) }
  constructor(o) {
    Object.assign(this, o);
    this.best = load(); this.state = "idle"; this.t = 0; this.hits = 0; this.chain = 0; this.maxChain = 0; this.points = 0; this.lastHit = -99;
    const add = this.chaos.add.bind(this.chaos);
    this.chaos.add = (pts, label, kind = label, extra = 0) => { const r = add(pts, label, kind, extra); if (this.state === "go" && (kind === "smash" || label === "Crash" || label === "BIG CRASH")) this.hit(pts); return r; };
    this.build(); setInterval(() => this.tick(0.1), 100);
  }
  start() {
    if (this.ride.state !== "driving") return this.toast?.("Get on a bike or in a car first, then start the spree");
    if (this.state !== "idle") return;
    this.state = "go"; this.t = 0; this.hits = 0; this.chain = 0; this.maxChain = 0; this.points = 0; this.lastHit = -99;
    this.ride.invincible = true; this.ride.damage = 0; this.ride.wrecked = false;
    this.toast?.("Smash Spree: hit as many things as you can in 60 s. Keep the chain alive: a hit every 3 s");
    this.paint();
  }
  hit(pts) {
    this.chain = this.t - this.lastHit <= GAP ? this.chain + 1 : 1; this.lastHit = this.t; this.hits++; this.maxChain = Math.max(this.maxChain, this.chain);
    const gain = Math.round(Math.max(40, pts) * (1 + Math.min(this.chain - 1, 8) * 0.25)); this.points += gain;
    this.chaos.popText?.(this.chain > 1 ? `CHAIN x${this.chain}  +${gain}` : `HIT  +${gain}`);
  }
  tick(dt) {
    if (this.state !== "go") return;
    if (this.ride.state !== "driving") return this.stop("Spree over: you left the vehicle");
    this.t += dt; if (this.t - this.lastHit > GAP) this.chain = 0;
    if (this.t >= LEN) return this.finish();
    this.paint();
  }
  stop(msg) { this.ride.invincible = false; this.state = "idle"; this.paint(); if (msg) this.toast?.(msg); }
  finish() {
    const score = this.points, medal = this.hits >= 45 ? "gold" : this.hits >= 28 ? "silver" : this.hits >= 14 ? "bronze" : "none", pb = score > (this.best.score || 0);
    if (pb) { this.best.score = score; save(this.best); }
    const hits = this.hits, chain = this.maxChain; this.stop();
    this.chaos.s.total += score; this.chaos.s.best = Math.max(this.chaos.s.best, this.chaos.s.total);
    const text = `Smash Spree: ${hits} hits · best chain x${chain} · ${score.toLocaleString()} pts${medal !== "none" ? " · " + medal.toUpperCase() : ""}${pb ? " · NEW BEST" : ""}`;
    if (this.onResult) this.onResult(text, () => this.start()); else this.toast?.(text);
    this.onFinish?.({ score, hits, chain, medal });
  }
  build() {
    this.el = document.createElement("div");
    this.el.style.cssText = "position:fixed;left:50%;top:calc(70px + env(safe-area-inset-top));transform:translateX(-50%);z-index:27;pointer-events:none;text-align:center;font:800 26px system-ui,sans-serif;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.7);display:none";
    document.body.appendChild(this.el);
  }
  paint() {
    if (this.state === "idle") { this.el.style.display = "none"; return; }
    this.el.style.display = "block";
    this.el.innerHTML = `<div>${this.points.toLocaleString()} <span style="font-size:15px;color:#ffd60a">${this.hits} hits</span></div><div style="font-size:14px;color:#ffd60a">${Math.max(0, LEN - this.t).toFixed(0)} s left${this.chain > 1 ? ` · chain x${this.chain}` : ""}</div>`;
  }
}
