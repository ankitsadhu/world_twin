// The first minute: the first time someone rides a bike, one short prompt at a time until they have gone, jumped, threaded
// traffic and crashed (the moment worth a clip). No menu, no reading: each step finishes by doing the thing. Saved so it never repeats.
const KEY = "ts.onboard.v1";
const done = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
const finish = () => { try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ } };

export class Onboard {
  // o: { ride, chaos, clip, touch: () => bool }
  constructor(o) {
    Object.assign(this, o);
    this.step = done() ? -1 : 0; this.t = 0; this.lastChain = 0;
    this.el = document.createElement("div"); this.el.id = "onboard";
    this.el.style.cssText = "position:fixed;left:50%;bottom:calc(120px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:28;max-width:calc(100% - 32px);padding:12px 20px;border-radius:16px;background:rgba(20,20,24,.82);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.25);color:#fff;font:700 18px system-ui,sans-serif;text-align:center;display:none;pointer-events:none";
    document.body.appendChild(this.el);
    if (this.step >= 0) setInterval(() => this.tick(0.1), 100);
  }
  say(t, sub = "") {
    const h = document.getElementById("hint"); if (h) h.style.visibility = "hidden";        // one instruction at a time: the controls strip waits
    this.el.innerHTML = t + (sub ? `<div style="font:500 13px system-ui;opacity:.75;margin-top:4px">${sub}</div>` : ""); this.el.style.display = "block"; }
  next() { this.step++; this.t = 0; this.lastChain = this.chaos.chain; this.lastNear = this.chaos.nearCount || 0; }
  tick(dt) {
    const r = this.ride, C = this.chaos;
    if (this.step < 0) return;
    if (!(r.state === "driving" && r.vehicle?.kind === "bike")) { this.el.style.display = "none"; document.getElementById("hint")?.style.removeProperty("visibility"); return; }   // only on a bike you are riding
    this.t += dt;
    const touch = this.touch?.(), go = touch ? "Hold GO" : "Hold W";
    switch (this.step) {
      case 0: this.say(`${go} to ride`, touch ? "◀ ▶ to steer" : "A / D to steer"); if (Math.abs(r.v) > 8) this.next(); break;
      case 1: this.say(touch ? "Tap HOP to jump!" : "Press SPACE to jump!", "Go fast first: you need speed to get air"); if (r.bikeAir > 0) this.next(); if (this.t > 25) this.next(); break;
      case 2: this.say("Thread between the cars", "Close passes build your CHAOS chain"); if ((C.nearCount || 0) > this.lastNear || this.t > 25) this.next(); break;
      case 3: this.say("Now crash into something!", "Big impacts are the fun part"); if (C.lastCrash && performance.now() - C.lastCrash < 3000) this.next(); if (this.t > 40) this.next(); break;
      case 4: this.say("That's chaos 🔥", this.clip ? "Press F8 any time to record a clip and share it" : ""); if (this.t > 6) { this.step = -1; finish(); this.el.style.display = "none"; document.getElementById("hint")?.style.removeProperty("visibility"); this.onDone?.(); } break;
    }
  }
}
