// The population director: how many people walk the city is decided by the game, not the player.
//   target = base[quality] x area density x time of day x what you are doing, clamped to [min, max]
// A busy plaza at dusk on foot gets a crowd; a stunt course, a race, or a flight over the harbour gets almost none; a phone gets fewer than a desktop.
// The number then eases towards the target in small steps and only out of sight (Npcs.trim), so nobody pops in or out in front of you.
// Every tunable is in config/population.json. The pool of characters is whoever exists (npcPool): adding a character never changes the budget.
const DEFAULTS = {
  base: { low: 16, balanced: 50, high: 100 }, mobile_scale: 0.6, min: 6, max: 140,
  area: { points: [[0, 1.35], [300, 1.35], [1000, 1.0], [3000, 0.7], [9000, 0.4]] },
  time: { points: [[0, 1.0], [0.3, 1.1], [0.5, 1.2], [0.75, 0.9], [1, 0.65]] },
  activity: { walking: 1, exploring: 0.8, riding: 0.75, chase: 0.6, course: 0.35, water: 0, air: 0 },
  retune_seconds: 2, max_step: 4, step_seconds: 3,
};
const curve = (pts, x) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts[pts.length - 1][1]; };

export class Population {
  // o: { npcs: () => Npcs, quality: () => "low"|"balanced"|"high", mobile: () => bool, state: () => ({ x, y, tod, activity }), forced?: number }
  constructor(o) {
    Object.assign(this, o);
    this.cfg = DEFAULTS; this.current = null; this.t = 0; this.stepT = 0; this.last = 0;
    fetch((this.root || "../") + "config/population.json").then(r => r.json()).then(c => { this.cfg = { ...DEFAULTS, ...c }; }).catch(() => {});      // data over code; the defaults stand if it is missing
  }

  // what the city should hold right now, and why (the breakdown is for the debug overlay and for tuning)
  target() {
    const C = this.cfg, S = this.state(), q = this.quality(), base = (C.base[q] ?? C.base.balanced) * (this.mobile() ? C.mobile_scale : 1);
    const area = curve(C.area.points, Math.hypot(S.x, S.y)), time = curve(C.time.points, S.tod), act = C.activity[S.activity] ?? 1;
    const n = Math.round(Math.min(C.max, Math.max(this.forced ?? C.min, (this.forced ?? base * area * time * act))));
    return { n, base, area, time, act, activity: S.activity };
  }

  update(dt) {
    const N = this.npcs?.(); if (!N) return;
    this.t += dt; this.stepT += dt;
    if (this.t < this.cfg.retune_seconds) return; this.t = 0;
    const T = this.last = this.target();
    if (this.current == null) { this.current = N.list.length || T.n; }
    if (T.n === this.current || this.stepT < this.cfg.step_seconds) return; this.stepT = 0;
    const d = Math.sign(T.n - this.current) * Math.min(this.cfg.max_step, Math.abs(T.n - this.current));
    this.current += d; N.setCount(this.current);
  }
}
