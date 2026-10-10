// Missions on the map: every level / game lives at its own place in the city, as an amber flag on the map and minimap and a glowing ring in the
// world. Walk or ride into the ring and the game asks "Start?": one tap and you're in it. Done missions turn green. This is the "go somewhere"
// of the game: the whole map is used because each mission sits in a different zone.
import { makeBeacon } from "./beacon.js";
import * as THREE from "three";
const KEY = "ts.missions.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

// start: what happens when you say Start (the host gives these as functions); x, y are where the flag stands (null = found at run time)
export const MISSIONS = [
  { id: "m_ride", icon: "firstride", cat: "Chaos", name: "First Ride", zone: "The Crossroads", level: 1, x: 0, y: -5, pitch: "Ride, jump, near-miss, crash: your first chaos chain", start: "bike" },
  { id: "m_park_cross", icon: "ramp", cat: "Chaos", name: "Stunt Park", zone: "The Crossroads", level: 3, site: "cross", pitch: "Ramps and 29 things to smash on the plaza", start: "park" },
  { id: "m_park_hudson", icon: "ramp", cat: "Chaos", name: "Pier Jump", zone: "Hudson River Park", level: 3, site: "hudson", pitch: "Three kickers, small to big, over a wall of crates", start: "park" },
  { id: "m_park_back", icon: "ramp", cat: "Chaos", name: "Backstreet Bowl", zone: "Hell's Kitchen", level: 3, site: "back", pitch: "Four ramps round a bowling alley of barrels", start: "park" },
  { id: "m_park_east", icon: "ramp", cat: "Chaos", name: "East Side Stunts", zone: "Midtown East", level: 3, site: "east", pitch: "Two big ramps facing each other and a crate pyramid", start: "park" },
  { id: "m_park_gate", icon: "ramp", cat: "Chaos", name: "Park Gate Skatepark", zone: "Central Park's south edge", level: 3, site: "gate", pitch: "Kickers and a barrel pyramid by the park", start: "park" },
  { id: "m_taxi", icon: "taxi", cat: "Jobs", name: "Taxi Rush", zone: "Broadway", level: 4, x: 0, y: 314, pitch: "Crazy-Taxi fares between the theatres: tricks buy time", start: "taxi" },
  { id: "m_trial", icon: "trial", cat: "Racing", name: "Time Trial: Hell's Kitchen run", zone: "Hell's Kitchen Backstreets", level: 5, race: "hell", pitch: "Race your own ghost down the long avenues (T restarts)", start: "race" },
  { id: "m_kart", icon: "bolt", cat: "Racing", name: "Kart Dash", zone: "Midtown", level: 8, race: "midtown", pitch: "Boost pads, jump pads and cones around Midtown", start: "race" },
  { id: "m_crash", icon: "burst", cat: "Chaos", name: "Crash Junction", zone: "Midtown East", level: 6, junction: [273, 553], pitch: "Plough into the cross traffic: biggest pile-up wins", start: "crash" },
  { id: "m_spree", icon: "burst", cat: "Chaos", name: "Smash Spree", zone: "Midtown", level: 6, x: 200, y: -300, pitch: "60 seconds: hit everything you can and keep the chain alive", start: "spree" },
  { id: "m_heat", icon: "siren", cat: "Chaos", name: "East Run: Heat", zone: "Midtown East Run", level: 7, x: 739, y: 394, pitch: "Cruisers, roadblocks and police bikes: escape", start: "heat" },
  { id: "m_boat", icon: "sboat", cat: "Water", name: "Hudson Dash", zone: "Hudson River Park", level: 8, x: -1494, y: -193, boat: "dash", pitch: "A fast speedboat and boost pads on the water", start: "boat" },
  { id: "m_cross", icon: "sboat", cat: "Water", name: "Hudson Run: Chelsea to Hoboken", zone: "Chelsea and the Jersey shore", level: 8, x: -1700, y: -1500, boat: "crossing", pitch: "3.5 km down the river past Hoboken in the speedboat", start: "boat" },
  { id: "m_cpark", icon: "race", cat: "Racing", name: "Central Park Loop", zone: "Central Park", level: 5, race: "cpark", pitch: "A rally round the park: gates, find your own way", start: "race" },
  { id: "m_wall", icon: "race", cat: "Racing", name: "Wall Street Run", zone: "Lower Manhattan", level: 5, race: "wall", pitch: "Rally from the World Trade Center to the Battery", start: "race" },
  { id: "m_lib", icon: "sboat", cat: "Water", name: "Liberty Sprint", zone: "Statue of Liberty", level: 9, x: -394, y: -9108, boat: "liberty", pitch: "Race the speedboat around Liberty Island", start: "boat" },
  { id: "m_statue", icon: "plane", cat: "Sky", name: "Statue Fly-by", zone: "Statue of Liberty", level: 9, x: -644, y: -9040, pitch: "Fly the plane past Lady Liberty (within 150 m)", start: "fly" },
  { id: "m_air", icon: "plane", cat: "Sky", name: "Intrepid Landing", zone: "The Intrepid", level: 9, x: -1486, y: 23, pitch: "Fly it, land it on the carrier deck", start: "fly" },
  { id: "m_roof", icon: "chute", cat: "Sky", name: "Rooftop Drop", zone: "Midtown Rooftops", level: 9, x: 584, y: -249, pitch: "Parachute through gates onto a tower roof", start: "fly" },
  { id: "m_wolf", icon: "wolf", cat: "Collect", name: "Wolf Hunt", zone: "Everywhere", level: 1, x: 273, y: 631, pitch: "50 golden wolves hidden from Central Park to the Statue of Liberty", start: "wolf" },
];

// the voices: who sends you, what they say before, and what they say after (one line each; short, not preachy)
const BRIEFS = {
  m_ride: ["Dispatch", "Take the bike out. Ride it hard, jump something, then wreck it. We'll call it a test.", "Not bad. The city's yours."],
  m_wolf: ["Old Ray", "Fifty golden wolves are hidden from the park to the Statue. Find them all and you'll never need a map again.", "Every last one. Ray's buying."],
  m_park_cross: ["Dispatch", "Ramps and barrels in the plaza. Break things, nobody minds.", "That plaza will never be the same."],
  m_park_hudson: ["Jess", "Three kickers, one wall of crates. Small, medium, send it.", "Clean send. The crates are crying."],
  m_park_back: ["Jess", "Bowling night on the west side. You're the ball.", "Strike."],
  m_park_east: ["Marcus", "Two big ramps, one crate pyramid. You can guess the rest.", "Pyramid: gone."],
  m_park_gate: ["Jess", "A skatepark at the edge of the park. Locals will be watching.", "They clapped. Probably."],
  m_taxi: ["Rosa", "Theatre's letting out and everyone wants a cab. Beat the clock, tricks buy time.", "That's how you run a fare."],
  m_trial: ["Marcus", "The long avenues, empty and fast. Beat your own ghost.", "Your ghost is furious."],
  m_cpark: ["Dispatch", "Gates round the park. Find your own way.", "Nobody found a faster line."],
  m_wall: ["Rosa", "From the Trade Center to the Battery before the markets close.", "Made it before the bell."],
  m_crash: ["Marcus", "A junction at rush hour. Find the biggest mess you can make.", "Insurance will be calling."],
  m_spree: ["Marcus", "Sixty seconds. Lamps, crates, bins, wrecks: every hit inside three seconds of the last keeps the chain going.", "Chain broken? Not today."],
  m_heat: ["Dispatch", "Cause trouble and the cruisers come. Then lose them.", "They're still looking for you."],
  m_kart: ["Jess", "Boost pads, jump pads and cones round Midtown. Stay on the line.", "Pad after pad. Smooth."],
  m_boat: ["Captain Lou", "The river's quiet and the speedboat's fast. Hit the green pads.", "You're a natural on the water."],
  m_cross: ["Captain Lou", "Down the Hudson, past Hoboken, back before the ferry. Don't clip the piers.", "Jersey says thanks."],
  m_lib: ["Captain Lou", "A lap round Liberty Island. She's watching, so show off.", "Lady Liberty approves."],
  m_air: ["Tower", "Cleared to land on the carrier. Centreline, soft touch.", "Clean trap. Welcome aboard."],
  m_statue: ["Tower", "Pass by the Statue low enough to see her face.", "She waved. Pretty sure."],
  m_roof: ["Tower", "Jump, thread the gates, land on that roof.", "Textbook. Now do it again."],
};

export class Missions {
  // o: { scene, camera, ask(text, actions, opts), toast, pos: () => {x, y} | null, start: { bike(), park(), taxi(), race(id), crash(x, y), heat(), boat(), fly(), wolf() }, traffic: () => traffic, race: () => race, mapSets: () => [data...] }
  constructor(o) {
    Object.assign(this, o);
    this.done = load(); this.rings = new Map(); this.near = null; this.cool = new Map();
    this.active = (() => { try { return localStorage.getItem(KEY + ".active") || null; } catch { return null; } })();
    MISSIONS.sort((a, b) => a.level - b.level); MISSIONS.forEach((m, i) => { m.num = i + 1; });          // the suggested order: 1 is where to begin
    this.buildPanel();
    this.resolved = false;
    setInterval(() => this.tick(), 500);
    const loop = () => { requestAnimationFrame(loop); this.animate(); }; loop();                // the beacons animate every frame
    setTimeout(() => { this.siteGiveUp = true; }, 45000);                     // a park with no free patch is simply left out
  }

  // where each flag stands (race starts and junctions come from the live road grid)
  refreshSites(sites) { this.sites = sites; if (this.resolved) { this.resolved = false; } }

  resolve() {
    const T = this.traffic?.(), R = this.race?.();
    if (!T?.ready || !R) return false;
    const courses = R.courses();
    const sites = this.sites || [];
    for (const m of MISSIONS) {
      if (m.site) { const t = sites.find(x => x.id === m.site); if (!t) { m.x = m.y = null; continue; } m.x = t.cx - 12; m.y = t.cy; continue; }
      if (m.race) { const c = courses.find(c => c.id === m.race); if (!c) return false; [m.x, m.y] = c.pts[0]; }
      else if (m.junction) { [m.x, m.y] = m.junction; }
    }
    this.resolved = true; this.build();
    return true;
  }

  build() {
    const CATC = { Chaos: ["#ef4a2f", "💥"], Racing: ["#f59e0b", "🏁"], Jobs: ["#2e9e4f", "🚕"], Water: ["#00a3b4", "🚤"], Sky: ["#9b59d0", "✈️"], Collect: ["#d4a017", "🐾"] };
    const mk = m => makeBeacon({ color: CATC[m.cat]?.[0] || "#f59e0b", icon: CATC[m.cat]?.[1] || "★", label: m.num });
    for (const g of this.rings.values()) this.scene.remove(g); this.rings.clear();
    for (const m of MISSIONS) { if (m.x == null) continue; const g = mk(m); g.position.set(m.x, 0, -m.y); g.visible = false; this.scene.add(g); this.rings.set(m.id, g); }
    this.pins(); 
  }

  pins() {
    const markers = MISSIONS.filter(m => m.x != null).map(m => ({ id: m.id, icon: m.icon, label: `${m.num}. ${m.name} · ${m.cat} · level ${m.level}`, x: m.x, y: m.y, minS: 0.12, mission: true, name: m.name, cat: m.cat, level: m.level, zone: m.zone, pitch: m.pitch, num: m.num, done: !!this.done[m.id], active: this.active === m.id }));
    for (const d of this.mapSets() || []) if (d?.markers) { d.markers = d.markers.filter(x => !x.mission); d.markers.push(...markers.map(x => ({ ...x }))); }
  }

  // ---- one at a time: pick (track) a mission and it becomes your destination, with a pulsing pin and a chip showing the distance
  track(id) {
    this.active = this.active === id ? null : id;
    try { this.active ? localStorage.setItem(KEY + ".active", this.active) : localStorage.removeItem(KEY + ".active"); } catch { /* private mode */ }
    this.pins(); this.paintPanel();
  }
  next() { const m = MISSIONS.find(m => !this.done[m.id]); if (m) { this.active = null; this.track(m.id); } return m; }
  activeMission() { return MISSIONS.find(m => m.id === this.active && !this.done[m.id]) || null; }

  stats() { return { done: MISSIONS.filter(m => this.done[m.id]).length, total: MISSIONS.filter(m => m.x != null).length || MISSIONS.length }; }
  // a result card after a run: what happened, with Retry and Next mission
  result(text, retry) {
    this.ask?.(text, [["Retry", () => retry?.(), true], ["Next mission", () => this.next()]], { ms: 14000, key: "result" });
  }

  markDone(id) {
    if (this.done[id]) return;
    const B = BRIEFS[id]; if (B) this.toast?.(`${B[0]}: “${B[2]}”`);
    this.onChange?.(this.stats());
    this.done[id] = Date.now(); save(this.done);
    if (this.active === id) { this.active = null; try { localStorage.removeItem(KEY + ".active"); } catch { /* private mode */ } }
    this.pins(); this.paintPanel();
    const nx = MISSIONS.find(m => !this.done[m.id]);
    if (nx) this.ask?.(`Mission complete! Next up: ${nx.num}. ${nx.name}`, [["Track it", () => this.track(nx.id), true], ["Later", () => {}]], { ms: 9000, key: "mission_next" });
  }

  // ---- the picker: every game, grouped by kind, with its number, place and state; Track makes it your one destination, Go takes you there
  buildPanel() {
    const st = document.createElement("style");
    st.textContent = `#mpanel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;width:min(520px,calc(100% - 24px));max-height:78vh;overflow:auto;display:none;padding:14px 14px 10px;border-radius:18px;background:rgba(18,19,23,.94);color:#fff;border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(14px);font:500 14px system-ui,sans-serif}
      #mpanel h3{margin:0 0 6px;font-size:18px;display:flex;justify-content:space-between;align-items:center}#mpanel .cat{margin:12px 0 4px;font:700 11px system-ui;letter-spacing:.08em;text-transform:uppercase;opacity:.7}
      #mpanel .row{display:flex;align-items:center;gap:10px;padding:8px;border-radius:12px}#mpanel .row.on{background:rgba(245,158,11,.16);outline:1px solid rgba(245,158,11,.7)}
      #mpanel .b{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:17px;position:relative}
      #mpanel .b i{position:absolute;right:-5px;top:-5px;min-width:16px;height:16px;border-radius:8px;background:#111317;border:1.5px solid #fff;font:700 10px/13px system-ui;text-align:center;font-style:normal}
      #mpanel .t{flex:1;min-width:0}#mpanel .t b{display:block}#mpanel .t small{opacity:.65}
      #mpanel button{border:0;border-radius:9px;padding:6px 10px;font:600 12px system-ui;cursor:pointer;background:rgba(255,255,255,.14);color:#fff}#mpanel button.p{background:#f59e0b;color:#111}
      #mchip{position:fixed;left:12px;top:calc(130px + env(safe-area-inset-top));z-index:25;padding:5px 10px;border-radius:999px;background:rgba(245,158,11,.92);color:#111;font:700 12px system-ui,sans-serif;cursor:pointer;display:none;max-width:70vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;
    document.head.appendChild(st);
    this.panel = document.createElement("div"); this.panel.id = "mpanel"; this.panel.setAttribute("role", "dialog"); this.panel.setAttribute("aria-label", "Missions");
    this.chip = document.createElement("div"); this.chip.id = "mchip"; this.chip.title = "Missions (K)";
    document.body.append(this.panel, this.chip);
    this.chip.addEventListener("click", () => this.togglePanel());
    addEventListener("keydown", e => { if (e.code === "KeyK" && !e.repeat && e.target.tagName !== "INPUT") this.togglePanel(); if (e.code === "Escape") this.togglePanel(false); });
    this.panel.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.a === "close") return this.togglePanel(false);
      if (b.dataset.a === "next") { this.next(); return; }
      const id = b.dataset.id; if (!id) return;
      if (b.dataset.a === "track") this.track(id);
      if (b.dataset.a === "go") { this.togglePanel(false); this.go?.(id); }
    });
  }
  togglePanel(on) { const show = on ?? this.panel.style.display !== "block"; this.panel.style.display = show ? "block" : "none"; if (show) this.paintPanel(); }
  paintPanel() {
    if (!this.panel) return;
    if (this.panel.style.display === "block") {
      const CAT = { Chaos: ["#ef4a2f", "💥"], Racing: ["#f59e0b", "🏁"], Jobs: ["#2e9e4f", "🚕"], Water: ["#00838f", "🚤"], Sky: ["#8e44ad", "✈️"], Collect: ["#c79a12", "🐾"] };
      const cats = [...new Set(MISSIONS.map(m => m.cat))], doneN = MISSIONS.filter(m => this.done[m.id]).length;
      this.panel.innerHTML = `<h3>Missions <span style="font-size:12px;font-weight:600;opacity:.7">${doneN}/${MISSIONS.length} done</span> <span><button class="p" data-a="next">Next up</button> <button data-a="close">✕</button></span></h3>` + cats.map(c => `<div class="cat">${CAT[c][1]} ${c}</div>` + MISSIONS.filter(m => m.cat === c).map(m =>
        `<div class="row${this.active === m.id ? " on" : ""}"><span class="b" style="background:${this.done[m.id] ? "#2e9e4f" : CAT[c][0]}">${CAT[c][1]}<i>${this.done[m.id] ? "✓" : m.num}</i></span><span class="t"><b>${m.name}</b><small>${m.zone} · level ${m.level}</small></span><button data-a="track" data-id="${m.id}">${this.active === m.id ? "Tracking" : "Track"}</button><button class="p" data-a="go" data-id="${m.id}">Go</button></div>`).join("")).join("");
    }
    const a = this.activeMission(), p = this.pos?.();
    this.chip.style.display = a ? "block" : "none";
    if (a) { const d = p ? Math.hypot(a.x - p.x, a.y - p.y) : 0; this.chip.textContent = `▶ ${a.num}. ${a.name}${p ? " · " + (d < 1000 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1) + " km") : ""}`; }
  }
  

  tick() {
    if (!this.resolved) { if (!this.resolve()) return; }
    const p = this.pos?.(); if (!p) return;
    const busy = this.busy?.(); this.paintPanel();
    let near = null, nd = 14;
    for (const m of MISSIONS) {
      if (m.x == null) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y), g = this.rings.get(m.id);
      if (g) g.visible = d < 420 || this.active === m.id;
      if (!busy && d < nd && !(this.cool.get(m.id) > performance.now())) { nd = d; near = m; }
    }
    if (near && near !== this.near) {
      this.near = near;
      const B = BRIEFS[near.id];
      this.ask(B ? `${B[0]}: “${B[1]}”` : `${near.name}: ${near.pitch}`, [["Start", () => this.begin(near), true], ["Not now", () => { this.cool.set(near.id, performance.now() + 90000); }]], { ms: 12000, key: "mission_" + near.id });
    } else if (!near) this.near = null;
  }

  animate() {
    if (!this.resolved) return; const p = this.pos?.(); if (!p) return; const t = performance.now() / 1000;
    for (const m of MISSIONS) { const g = this.rings.get(m.id); if (g?.visible) g.userData.set(t, { active: this.active === m.id, done: !!this.done[m.id], dist: Math.hypot(m.x - p.x, m.y - p.y) }); }
  }

  begin(m) {
    this.cool.set(m.id, performance.now() + 30000); this.dismiss?.("mission_" + m.id);
    const s = this.start;
    if (m.start === "race") return s.race(m.race);
    if (m.start === "boat") return s.boat(m.boat || "dash");
    if (m.start === "crash") return s.crash(m.x, m.y);
    s[m.start]?.();
  }

  // fast travel (search "Where to?" and pick the mission): you appear at its flag on foot, or in the boat / plane for the water and sky ones
  travel(id) {
    const m = MISSIONS.find(x => x.id === id); if (!m || m.x == null) return;
    if (m.start === "boat") return this.start.boat(m.boat || "dash");
    if (m.start === "fly") return this.start.fly();
    this.start.teleport(m);
  }

  register(nav) {
    for (const m of MISSIONS) if (!nav.places.some(p => p.id === "mission_" + m.id)) nav.places.push({ id: "mission_" + m.id, name: m.name, sub: `${m.zone} · level ${m.level} · ${m.pitch}`, kind: "landmark", act: "mission:" + m.id, keywords: `mission ${m.zone} ${m.name} ${m.pitch}` });
  }
}
