// Heat (Need for Speed / GTA, without the crime): reckless driving builds a heat meter; at one star the cruisers come for you, more stars
// bring more and faster ones. Escape (open an 85 m gap and hold it 10 s) for a big bonus that grows with the stars; get tagged and the chain
// is lost (no other penalty). Heat cools by itself when you drive clean. All the "crime" is traffic stunts: near misses, crashes and top speed.
export class Heat {
  // o: { ride, chaos, pursuit: () => Pursuit, toast }
  constructor(o) {
    Object.assign(this, o);
    this.heat = 0; this.maxStars = 0; this.cool = 0; this.fast = 0; this.grace = 0;
    this.chaos.listeners.push((k, a) => this.onEvent(k, a));
    this.build();
    setInterval(() => this.tick(0.2), 200);
  }
  get stars() { return Math.min(5, Math.ceil(this.heat - 0.001)); }
  active() { return this.ride.state === "driving"; }

  onEvent(kind, a) {
    if (this.ride.invincible || this.suppress?.()) return;                                          // the crash run is its own game: no police
    if (!this.active() || this.pursuit()?.active) return;
    if (kind === "crashHit") this.add(a > 0.6 ? 1.0 : 0.6);            // a big smash is serious, a bump is not
    else if (kind === "near") this.add(0.12);
    else if (kind === "air") this.add(0.25);
  }
  add(h) { this.heat = Math.min(5, this.heat + h); this.cool = 8; this.maxStars = Math.max(this.maxStars, this.stars); }

  tick(dt) {
    const P = this.pursuit();
    if (!P) return;
    if (!this.active()) { this.heat = Math.max(0, this.heat - 0.3 * dt); this.paint(); return; }
    const v = Math.abs(this.ride.v);
    this.fast = v > 24 ? this.fast + dt : 0;
    if (this.fast > 3) { this.add(0.1 * dt * 5 / 5); }                        // flat out for a while draws attention
    this.grace = Math.max(0, this.grace - dt);
    if (P.active) { this.cool = 8; }
    else {
      this.cool = Math.max(0, this.cool - dt);
      if (this.cool <= 0) this.heat = Math.max(0, this.heat - 0.06 * dt);       // ~17 s per star when you drive clean
      if (this.heat >= 1 && this.grace <= 0) {                                  // the cruisers move in
        const st = this.stars;
        if (P.start(st)) this.toast?.(`WANTED ${"★".repeat(st)}  Lose them: open a gap and hold it`);
        else this.grace = 5;
      }
    }
    this.paint();
  }

  // pursuit ended: escaped = bonus by stars; caught = the chain is gone
  onEnd(state, stars) {
    const C = this.chaos;
    if (state === "escaped") {
      const pts = 400 * stars * stars;
      C.s.total += pts; C.s.best = Math.max(C.s.best, C.s.total);
      C.popText(`ESCAPED ${"★".repeat(stars)}  +${pts.toLocaleString()}`, true);
      this.toast?.(`Escaped! +${pts.toLocaleString()} points`);
    } else if (state === "caught") {
      C.chain = 0; C.mult = 1;
      this.toast?.("Caught! The chain is lost. No other penalty");
    }
    this.heat = 0; this.cool = 0; this.grace = 6;
    this.paint();
  }

  build() {
    this.el = document.createElement("div"); this.el.className = "heathud";
    this.el.style.cssText = "position:fixed;right:70px;top:calc(70px + env(safe-area-inset-top));z-index:27;pointer-events:none;font:800 22px system-ui,sans-serif;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.7);display:none;text-align:right";
    document.body.appendChild(this.el);
  }
  paint() {
    const P = this.pursuit(), on = (this.heat > 0.05 || P?.active) && this.active();
    this.el.style.display = on ? "block" : "none";
    if (!on) return;
    const st = P?.active ? (P.stars || this.stars) : this.stars, frac = this.heat - Math.floor(this.heat - 0.001);
    const chase = P?.active, flash = chase && Math.floor(performance.now() / 350) % 2;
    const stars = Array.from({ length: 5 }, (_, i) => `<span style="color:${i < st ? (flash ? "#ff453a" : "#4da3ff") : "rgba(255,255,255,.3)"}">★</span>`).join("");
    this.el.innerHTML = `${stars}<div style="font-size:12px;font-weight:600;opacity:.9">${chase ? (P.status.split("·").slice(1).join("·").trim() || "Cruisers chasing") : `Heat ${Math.round(this.heat / 5 * 100)} %`}</div>`;
    if (!chase) this.el.style.opacity = String(0.6 + 0.4 * Math.min(1, frac + 0.3));
  }
}
