// The launch funnel, kept forever: landed -> first input -> first ride -> first crash -> clip saved -> shared, plus level-ups and session length.
// Anonymous id only. Events are batched in this browser and posted with sendBeacon to config `analytics_url` when it is set (our one API
// container); until then they just accumulate locally (window.__events in debug) so nothing is lost the day the endpoint goes live.
const KEY = "ts.events.v1", ID = "ts.anon";
const uid = () => { try { let v = localStorage.getItem(ID); if (!v) { v = crypto.randomUUID(); localStorage.setItem(ID, v); } return v; } catch { return "anon"; } };
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v.slice(-500))); } catch { /* private mode */ } };

export const Analytics = {
  url: null, t0: performance.now(), once: new Set(), q: [],
  init(url) {
    this.url = url || null;
    this.q = read();
    this.track("session_start", { w: innerWidth, h: innerHeight, touch: matchMedia("(pointer: coarse)").matches, ref: document.referrer ? new URL(document.referrer).host : "", lang: navigator.language });
    addEventListener("pointerdown", () => this.first("first_input"), { once: true });
    addEventListener("keydown", () => this.first("first_input"), { once: true });
    addEventListener("pagehide", () => { this.track("session_end", { s: Math.round((performance.now() - this.t0) / 1000) }); this.flush(); });
    setInterval(() => this.flush(), 20000);
  },
  first(name, data) { if (this.once.has(name)) return; this.once.add(name); this.track(name, { ...data, at: Math.round((performance.now() - this.t0) / 1000) }); },
  track(name, data = {}) {
    const e = { n: name, t: Date.now(), id: uid(), ...data };
    this.q.push(e); write(this.q);
    if (location.search.includes("debug")) (window.__events ||= []).push(e);
  },
  flush() {
    if (!this.url || !this.q.length) return;
    const body = JSON.stringify(this.q);
    if (navigator.sendBeacon?.(this.url, new Blob([body], { type: "application/json" }))) { this.q = []; write(this.q); }
  },
};
