// Planes: the small prop plane (export/vehicles/small_plane.glb, prepared by scripts/blender/vehicles/prep_plane.py)
//   * a banner plane loops up and down the Hudson all day towing a sponsor banner (a sellable ad slot: sky.hudson.banner)
//   * a plane parked on the USS Intrepid deck you can fly: take off down the deck, fly anywhere around New York, land at
//     a real airport (Teterboro, LaGuardia, Newark: js/region.js) and take off again from there
// Arcade flight, no crashes in the GTA sense: touch a building, the ground or the water and you're put back where you took off.
// Coordinates: Blender local metres (x east, y north, z up); three.js = (x, z, -y). The model's nose is three.js -Z.
import * as THREE from "three";
import { Settings } from "./settings.js";
import { inputDevice, onInputChange, prompt } from "./gamepad.js";

const B = (x, y, z) => new THREE.Vector3(x, z, -y);
// the Intrepid's flight deck (the hull footprint in collision2d is 18 m tall and runs east-west, bow to the west)
const DECK = { x: -1382, y: 32, z: 18, h: Math.PI };        // parked forward (the bow is the east end), nose aft: the take-off run goes west, out over the river
const SHORE_X = -1342;                                         // west of this is the Hudson (TER_TS_Water_Hudson)
const VR = 30, STALL = 25, CRUISE = 46, FAST = 68, SLOW = 31;  // m/s: rotate, stall, cruise, boost, slow (landing)
const CEILING = 600;                                           // config/districts/times_square.json vehicle_zones.plane
// (the Intrepid's deck as a runway, kept for take-off; landing there is not offered) from the west, over the Hudson, heading east up the deck (the stern is the west end):
// touchdown 25 m in from the stern, a 3.5 deg glide path, the final approach starting 1.1 km out over the river
const GLIDE = Math.tan(THREE.MathUtils.degToRad(3.5)), FINAL = 1100;
const DECK_GLIDE = Math.tan(THREE.MathUtils.degToRad(9));   // the Intrepid: a steep carrier approach over 12th Avenue
const MPH = 2.237, FT = 3.281;
// the banner tow: a long oval over the river, clear of the piers and the carrier
const LOOP = { x0: -1700, x1: -1575, y0: -600, y1: 600, z: 150, v: 38 };
export const BANNER_SLOT = "sky.hudson.banner";

export class Flight {
  constructor(o) {
    // o: { root, scene, camera, dom, loader, getCollider, setMode, getMode, registerMaterial, screens, demoArt, audio,
    //      pickables, onBoard, onLeave, isNight }
    Object.assign(this, o);
    this.state = "idle";                 // idle | ready (in it, on the deck) | roll (takeoff / landing roll) | air
    this.ctl = { left: 0, right: 0, up: 0, down: 0, fast: 0, slow: 0 };
    this.look = { yaw: 0, drag: null, idle: 0 };
    this.p = { x: DECK.x, y: DECK.y, z: DECK.z, h: DECK.h, pitch: 0, roll: 0, v: 0 };
    this.jump = null;
    this.rooftopSites = null;
    this.bannerS = 0;
    this.buildDOM();
    this.bindInput();
    this.ready = this.load();
  }

  get active() { return this.state !== "idle"; }
  get flying() { return this.state === "air"; }

  // ---------------------------------------------------------------- models
  async load() {
    const [g, canopy] = await Promise.all([
      this.loader.loadAsync(`${this.root}export/vehicles/small_plane.glb`),
      this.loader.loadAsync(`${this.root}export/characters/parachute.glb`),
    ]);
    g.scene.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => this.registerMaterial?.(m)); });
    this.tpl = g.scene;
    this.canopyTpl = canopy.scene;
    this.canopyTpl.traverse(o => { if (o.isMesh) { o.castShadow = true; o.raycast = () => {}; } });
    const make = name => {
      const grp = new THREE.Group(); grp.name = name;
      const m = this.tpl.clone(true); grp.add(m);
      grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
      grp.userData.prop = grp.getObjectByName("PROPELLER");
      this.scene.add(grp);
      return grp;
    };
    this.plane = make("FLY_plane");                               // yours, parked on the Intrepid
    this.plane.traverse(o => { if (o.isMesh) o.userData.flyPlane = true; });
    // control surfaces (exported with their hinge line as an axis, see build_cessna.py): they follow your inputs
    this.surf = {};
    this.plane.traverse(o => {
      const a = o.userData.hinge_axis;
      if (a) this.surf[o.name] = { o, base: o.quaternion.clone(), axis: new THREE.Vector3(a[0], a[2], -a[1]).normalize() };
    });
    this.defl = { ail: 0, ele: 0, rud: 0, flap: 0 };
    this.place(this.plane, this.p);
    this.tow = make("SKY_banner_plane");                          // the banner plane over the river
    this.buildBanner();
  }

  place(grp, p) {
    grp.position.copy(B(p.x, p.y, p.z));
    grp.rotation.set(p.pitch || 0, p.h - Math.PI / 2, p.roll || 0, "YXZ");
  }

  // a 30 x 7.5 m vinyl banner on a 40 m tow line; both faces read the right way round
  buildBanner() {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 256;
    const x = c.getContext("2d");
    x.fillStyle = "#fbfbf7"; x.fillRect(0, 0, 1024, 256);
    x.fillStyle = "#0a84ff"; x.font = "800 112px -apple-system, Helvetica, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText("YOUR BRAND HERE", 512, 132);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;   // screens load art unflipped (glTF style)
    const mat = new THREE.MeshStandardMaterial({ name: "MAT_SLOT_" + BANNER_SLOT, color: 0x202020, emissive: 0xffffff,
      emissiveIntensity: 1.6, emissiveMap: tex, roughness: 0.9, side: THREE.FrontSide });
    this.registerMaterial?.(mat);
    this.screens?.add(BANNER_SLOT, mat);
    const art = this.demoArt?.("4x1") || [];
    if (art.length) this.screens?.setPlaylist(BANNER_SLOT, art);
    const geo = new THREE.PlaneGeometry(30, 7.5);
    const uv = geo.attributes.uv;                                       // glTF-style UVs (v down), so uploaded art isn't upside down
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const ban = new THREE.Group(); ban.name = "SKY_banner"; ban.userData.slot_id = BANNER_SLOT;
    const a = new THREE.Mesh(geo, mat); a.rotation.y = Math.PI / 2;     // faces +X (the banner runs along -Z, its length)
    const b = new THREE.Mesh(geo, mat); b.rotation.y = -Math.PI / 2;
    ban.add(a, b);
    this.pickables?.push(a, b);
    this.scene.add(ban);
    this.banner = ban;
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x333333 }));
    this.scene.add(this.line);
  }

  // the oval: straight north along the far side, round the top, south along the near side
  loopAt(s) {
    const { x0, x1, y0, y1, z } = LOOP, r = (x1 - x0) / 2, L = y1 - y0, P = 2 * L + 2 * Math.PI * r;
    s = ((s % P) + P) % P;
    if (s < L) return { x: x0, y: y0 + s, z, h: Math.PI / 2 };
    s -= L;
    if (s < Math.PI * r) { const a = Math.PI - s / r; return { x: x0 + r + r * Math.cos(a), y: y1 + r * Math.sin(a), z, h: a - Math.PI / 2 }; }
    s -= Math.PI * r;
    if (s < L) return { x: x1, y: y1 - s, z, h: -Math.PI / 2 };
    s -= L;
    const a = -s / r; return { x: x0 + r + r * Math.cos(a), y: y0 + r * Math.sin(a), z, h: a - Math.PI / 2 };
  }

  // a clear view of the banner right now (for the sales sheet): from the Manhattan shore side, a little below, with the
  // tow plane and the banner both in frame
  bannerView() {
    if (!this.banner) return null;
    const a = this.loopAt(this.bannerS - 20), b = this.loopAt(this.bannerS - 75);
    const tx = (a.x + b.x) / 2 + 40, ty = (a.y + b.y) / 2;    // aim a bit ahead: it keeps flying while the camera moves
    return { eye: [tx + 150, ty - 40, LOOP.z - 40], target: [tx - 40, ty, LOOP.z - 5] };
  }

  // ---------------------------------------------------------------- UI
  buildDOM() {
    const css = document.createElement("style");
    css.textContent = `
      #flypanel { position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 30; display: none;
        align-items: center; gap: var(--s3); padding: var(--s2) var(--s3); max-width: calc(100% - 32px); box-sizing: border-box; flex-wrap: wrap; justify-content: center; }
      #flypanel h3 { margin: 0; font-size: var(--t-body); font-weight: var(--w-semibold); white-space: nowrap; }
      #flypanel .stats { display: flex; gap: var(--s3); align-items: baseline; color: var(--ink-2); font-size: var(--t-caption); white-space: nowrap; }
      #flypanel .big { font-size: var(--t-title); font-weight: var(--w-bold); color: var(--ink); }
      #flypanel .ui-btn { min-height: 36px; font-size: var(--t-caption); padding: 0 var(--s3); white-space: nowrap; }
      #flypanel .help { flex-basis: 100%; text-align: center; margin: 0; color: var(--ink-3); font-size: var(--t-caption); }
      #flypad { position: fixed; inset: auto 0 0 0; z-index: 29; display: none; pointer-events: none; }
      #flypad button { pointer-events: auto; position: absolute; width: 68px; height: 68px; border-radius: 34px; border: none; color: var(--ink);
        background: var(--glass); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); font: var(--w-bold) 15px var(--font);
        touch-action: none; user-select: none; -webkit-user-select: none; }
      #flypad button.on { background: var(--accent); color: var(--accent-ink); }
      #flyveil { position: fixed; inset: 0; z-index: 60; background: #000; opacity: 0; pointer-events: none; transition: opacity .35s; }
      #flychip { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 28; display: none; align-items: center; gap: var(--s2); box-shadow: var(--shadow); }
      #flychip kbd { font: var(--w-semibold) var(--t-caption) var(--font); background: rgba(0,0,0,.15); border-radius: 6px; padding: 2px 6px; }
      body[data-input="touch"] #flypanel { bottom: auto; top: calc(64px + env(safe-area-inset-top)); }   /* thumbs own the bottom */
      @media (max-width: 640px) { body[data-input="touch"] #flypanel { left: 16px; transform: none; max-width: calc(100% - 150px); justify-content: flex-start; } }
      body[data-input="touch"] #flychip kbd, body[data-input="touch"] #flypanel .help { display: none; }
      body.flying #zoom, body.flying [data-t], body.flying #wpchip, body.flying #hopin { display: none !important; }`;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML("beforeend", `
      <div id="flypanel" class="ui-surface" role="status" aria-live="polite"></div>
      <div id="flyveil" aria-hidden="true"></div>
      <button id="flychip" class="ui-btn primary" aria-label="Fly this plane">✈ Fly this plane<kbd>${prompt("interact")}</kbd></button>
      <div id="flypad" aria-hidden="true">
        <button data-c="left" style="left:16px;bottom:calc(var(--fp-b) + 0px)">◀</button>
        <button data-c="right" style="left:96px;bottom:calc(var(--fp-b) + 0px)">▶</button>
        <button data-c="slow" style="left:56px;bottom:calc(var(--fp-b) + 80px);width:56px;height:56px;font-size:13px">Slow</button>
        <button data-c="down" style="right:16px;bottom:calc(var(--fp-b) + 0px)">▼</button>
        <button data-c="up" style="right:16px;bottom:calc(var(--fp-b) + 80px)">▲</button>
        <button data-c="fast" style="right:96px;bottom:calc(var(--fp-b) + 40px);width:56px;height:56px;font-size:13px">Fast</button>
      </div>`);
    this.panel = document.getElementById("flypanel");
    this.chip = document.getElementById("flychip");
    this.chip.onclick = () => this.board();
    onInputChange(() => { this.chip.querySelector("kbd").textContent = prompt("interact"); if (this.active) this.render(); });
    const pad = document.getElementById("flypad");
    pad.style.setProperty("--fp-b", "calc(84px + env(safe-area-inset-bottom))");   // above the phone tab bar
    pad.querySelectorAll("button").forEach(b => {
      const k = b.dataset.c, on = v => e => { e.preventDefault(); this.ctl[k] = v; b.classList.toggle("on", !!v); if (v && k === "up") this.takeOff(); };
      b.addEventListener("pointerdown", on(1)); b.addEventListener("pointerup", on(0));
      b.addEventListener("pointercancel", on(0)); b.addEventListener("pointerleave", on(0));
    });
  }

  render() {
    const P = this.panel, s = this.state, touch = inputDevice() === "touch";
    document.body.classList.toggle("flying", this.active);
    document.getElementById("flypad").style.display = this.active && touch ? "block" : "none";
    if (!this.active) { P.style.display = "none"; return; }
    P.style.display = "flex";
    const at = this.base?.r.code && this.base.r.code !== "INT" ? this.base.r.name : "the Intrepid deck";
    const title = s === "ready" ? `On ${at.startsWith("the") ? at : "the runway at " + at}` : s === "roll" ? (this.landing ? "Landed" : "Taking off")
      : s === "jumpFree" || s === "jumpCanopy" ? `Skydrop · ${this.jump?.target?.label || "Rooftop challenge"}`
      : this.auto ? "Landing: autopilot" : this.approachOn ? "Approach: follow the rings" : "Flying";
    const act = s === "ready" ? `<button class="ui-btn primary" data-a="go">Take off</button><button class="ui-btn" data-a="out">Get out</button>`
      : s === "jumpFree" ? `<button class="ui-btn primary" data-a="deploy">Deploy parachute · Space</button><button class="ui-btn" data-a="abort">Restart</button>`
      : s === "jumpCanopy" ? `<span class="ui-btn">Gate ${Math.min(this.jump?.gate || 0, 3)}/3 · land on the pad</span><button class="ui-btn" data-a="abort">Restart</button>`
      : s === "air" ? (this.auto ? `<button class="ui-btn" data-a="manual">Take over</button>`
        : this.chooser ? this.airports().map(r => `<button class="ui-btn primary" data-land="${r.code}">${r.name.replace(/ (Liberty )?(International )?Airport$/, "")} · ${this.distTo(r)}</button>`).join("") + `<button class="ui-btn" data-a="nochoose">✕</button>`
        : `<select class="ui-btn" id="fly-roof" aria-label="Rooftop landing target"></select><button class="ui-btn primary" data-a="jump" ${this.jumpReady() ? "" : "disabled"}>Jump · J</button><button class="ui-btn" data-a="land">${this.airports().length ? "Land at…" : "Land on the Intrepid"}</button><button class="ui-btn" data-a="home" title="Skip the landing: back where you took off">Skip</button>`)
      : `<button class="ui-btn" data-a="out" ${this.p.v > 2 ? "disabled" : ""}>Get out</button>`;
    const help = inputDevice() === "pad" ? "Left stick: turn and climb · R2 faster · L2 slower · ✕ take off · ○ get out"
      : "W / ↑ climb · S / ↓ descend · A D turn · Shift faster · Space slower";
    const landHelp = s === "jumpFree" ? "Freefall · steer with A/D · Space opens the canopy early (automatic in 2.2 seconds)"
      : s === "jumpCanopy" ? `Steer with A/D · ${Math.max(0, Math.round((this.jump?.z || 0) - (this.jump?.target?.z || 0)))} m above the target`
      : s === "air" ? "Build altitude above the chosen rooftop, then jump. Fly through all three gates before landing."
      : this.auto ? "The autopilot flies the approach and lands · any flight key takes over"
      : this.approachOn ? "Fly through the gold rings down to the runway: slow (Space), wings level, gentle descent" : help;
    P.innerHTML = `<h3>✈ ${title}</h3><div class="stats"><span><span class="big" id="fly-spd">0</span> mph</span>
      <span><span class="big" id="fly-alt">0</span> ft</span>${s === "air" ? `<span id="fly-home" style="color:var(--ink-2)"></span>` : ""}</div>
      <div class="acts" style="display:flex;gap:var(--s2)">${act}</div>
      ${s !== "air" || this.helpT > 0 || this.auto || this.approachOn || this.rooftopSites?.length ? `<p class="help">${landHelp}</p>` : ""}`;
    P.querySelectorAll("[data-a]").forEach(b => b.onclick = () => this.action(b.dataset.a));
    P.querySelectorAll("[data-land]").forEach(b => b.onclick = () => this.startLanding(b.dataset.land));
    const roof = P.querySelector("#fly-roof");
    if (roof) {
      for (const [i, site] of (this.rooftopSites || []).entries()) roof.add(new Option(site.label, String(i)));
      roof.value = String(this.selectedRoof || 0);
      roof.onchange = () => { this.selectedRoof = Number(roof.value); this.render(); };
    }
    const helpEl = P.querySelector(".help");
    if (s === "air" && helpEl) helpEl.textContent = landHelp;
  }

  action(a) {
    if (a === "go") this.takeOff();
    if (a === "out") this.getOut();
    if (a === "jump") this.startJump();
    if (a === "deploy") this.deployCanopy();
    if (a === "abort") this.abortJump();
    if (a === "home") this.reset("Skipped");
    if (a === "land") { if (this.airports().length) { this.chooser = true; this.render(); } else this.startLanding("INT"); }
    if (a === "nochoose") { this.chooser = false; this.render(); }
    if (a === "manual") { this.auto = null; this.approachOn = true; this.render(); this.toast?.("You have control: follow the gold rings down to the runway."); }
  }

  // the map line while flying: you -> the destination you set (a straight line: planes don't use roads)
  mapInfo() {
    const wp = this.nav?.waypoint;
    if (!this.active || !wp) return null;
    const x = this.jump ? this.jump.x : this.p.x, y = this.jump ? this.jump.y : this.p.y;
    return { car: [x, y], route: [[x, y], [wp.x, wp.y]] };
  }

  jumpReady() {
    const site = this.rooftopSites?.[this.selectedRoof || 0];
    return this.state === "air" && !!site && this.p.z > Math.max(80, site.z + 25);
  }

  buildRooftopSites() {
    const col = this.getCollider();
    if (!col) return;
    const inside = (pts, x, y) => {
      let hit = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    const clearance = (pts, x, y) => Math.min(...pts.map((q, i) => {
      const r = pts[(i + 1) % pts.length], dx = r[0] - q[0], dy = r[1] - q[1];
      const t = THREE.MathUtils.clamp(((x - q[0]) * dx + (y - q[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      return Math.hypot(x - q[0] - t * dx, y - q[1] - t * dy);
    }));
    const candidates = col.polys.filter(p => p.kind === "building").map(p => {
      const [x0, y0, x1, y1] = p.box, x = (x0 + x1) / 2, y = (y0 + y1) / 2;
      const edge = clearance(p.pts, x, y);
      return { poly: p, x, y, edge, area: (x1 - x0) * (y1 - y0) };
    }).filter(c => c.poly.h > 20 && c.poly.h < 300 && c.x > -450 && c.x < 450 && c.y > -360 && c.y < 460
      && c.edge >= 6.5 && inside(c.poly.pts, c.x, c.y));
    if (!candidates.length) { this.rooftopSites = []; return; }
    const small = candidates.filter(c => c.poly.h < 140).sort((a, b) => a.area - b.area)[0];
    const named = name => candidates.find(c => c.poly.name === name);
    const chosen = [
      small && { ...small, label: "Small rooftop · tight target" },
      named("Minskoff Theatre") && { ...named("Minskoff Theatre"), label: "Minskoff Theatre" },
      named("New York Marriott Marquis Hotel") && { ...named("New York Marriott Marquis Hotel"), label: "Marriott Marquis" },
    ].filter(Boolean);
    this.rooftopSites = chosen.map((c, i) => {
      const radius = i === 0 ? 3.6 : Math.min(7.5, c.edge * 0.72);
      const group = new THREE.Group();
      group.name = `SKY_rooftop_${i}`;
      group.position.set(c.x, c.poly.h + 0.14, -c.y);
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.22, 32),
        new THREE.MeshStandardMaterial({ color: 0x18a98b, emissive: 0x075c48, emissiveIntensity: 1.4, roughness: 0.5 }));
      disk.position.y = 0; disk.castShadow = true; disk.receiveShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.24, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0x77ffe1, toneMapped: false }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.16; ring.raycast = () => {};
      group.add(disk, ring); this.scene.add(group);
      return { x: c.x, y: c.y, z: c.poly.h + 0.25, radius, label: c.label, group };
    });
    if (this.rooftopSites.length) this.render();
  }

  // an unsteered jump from `alt`: free fall (gravity, ~12 m/s forward) for 2.2 s, then the canopy (7.2 m/s down, 11 m/s forward) to the roof height
  jumpProfile(alt, roofZ) {
    const pts = []; let z = alt, fall = 0, t = 0, d = 0;
    while (z > roofZ + 1.2 && t < 200) {
      const dt = 0.05; t += dt;
      if (t < 2.2) fall = Math.min(45, fall + 9.81 * dt); else fall += (7.2 - fall) * Math.min(1, dt * 2.2);
      z -= fall * dt; d += (t < 2.2 ? 12 : 11) * dt; pts.push({ t, z, d });
    }
    return { T: t, D: d, pts };
  }

  startJump() {
    if (!this.jumpReady()) {
      this.toast?.("Climb higher than the rooftop before jumping");
      return;
    }
    const avatar = this.getPlayer?.();
    if (!avatar) {
      this.toast?.("Your skydiver is still getting ready · try again in a moment");
      return;
    }
    const target = this.rooftopSites[this.selectedRoof || 0];
    // You exit over the target's approach, not wherever the plane happens to be (often over the Hudson, miles away and outside the
    // challenge area): a canopy glides ~11 m/s forward for 7.2 m/s down, so the drop point is placed where that glide reaches the pad
    // with ~25 % to spare, at the plane's bearing from the pad, high enough to be fun (at least 190 m above the roof).
    const from = Math.atan2(this.p.y - target.y, this.p.x - target.x), alt = Math.max(this.p.z, target.z + 190);
    const glide = this.jumpProfile(alt, target.z).D * 0.92;                         // a little short: you can hold on with Shift (+4 m/s)
    const start = { x: target.x + Math.cos(from) * glide, y: target.y + Math.sin(from) * glide, z: alt };
    const heading = from + Math.PI;                                                   // facing the pad
    const rig = new THREE.Group();
    rig.name = "SKY_parachute"; rig.userData.parachute = true;
    rig.scale.setScalar(0.72);
    rig.add(this.canopyTpl.clone(true));
    this.scene.add(rig);
    this.jumpRig = rig;
    this.jump = { avatar, target, x: start.x, y: start.y, z: start.z, heading,
      yaw: heading + Math.PI / 2, elapsed: 0, fall: 0, speed: 12, gate: 0, gates: [] };
    this.addJumpGates(start, target);
    this.state = "jumpFree";
    this.camSnap = true;
    this.ctl = { left: 0, right: 0, up: 0, down: 0, fast: 0, slow: 0 };
    avatar.contact(false);
    avatar.object.userData.parachute = true;
    this.setMode("parachute");
    this.render();
    this.toast?.(`Jump! Aim for the ${target.label} pad and fly through all three gates.`);
  }

  addJumpGates(start, target) {
    this.clearJumpGates();
    const j = this.jump, prof = this.jumpProfile(start.z, target.z);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd60a, toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false });
    const fwd = new THREE.Vector3();
    for (const u of [0.3, 0.55, 0.8]) {                                           // gates on the path an unsteered glide takes to the pad
      const k = Math.min(prof.pts.length - 2, Math.floor(prof.pts.length * u)), P = prof.pts[k], Q = prof.pts[k + 1];
      const hx = start.x + (target.x - start.x) * (P.d / prof.D), hy = start.y + (target.y - start.y) * (P.d / prof.D);
      const gate = new THREE.Mesh(new THREE.TorusGeometry(9, 0.45, 8, 32), mat);
      gate.position.set(hx, P.z, -hy);
      fwd.set(target.x - start.x, Q.z - P.z, -(target.y - start.y)).normalize();
      gate.lookAt(gate.position.clone().add(fwd));
      gate.raycast = () => {}; this.scene.add(gate); j.gates.push(gate);
    }
  }

  clearJumpGates() {
    for (const gate of this.jump?.gates || []) {
      this.scene.remove(gate); gate.geometry.dispose(); gate.material.dispose();
    }
    if (this.jump) this.jump.gates = [];
  }

  cancelJump() {
    this.clearJumpGates();
    if (this.jumpRig) { this.scene.remove(this.jumpRig); this.jumpRig = null; }
    if (this.jump?.avatar) {
      this.jump.avatar.contact(true);
      delete this.jump.avatar.object.userData.parachute;
    }
    this.jump = null;
  }

  deployCanopy() {
    if (this.state !== "jumpFree" || !this.jump) return;
    this.state = "jumpCanopy";                                       // the opening shock: the fall rate eases down (updateJump), no jolt
    this.jumpRig.visible = true;
    this.render();
    this.toast?.("Canopy open · steer toward the glowing rooftop");
  }

  updateJump(dt) {
    const j = this.jump;
    if (!j) return;
    const I = this.input();
    j.elapsed += dt;
    if (this.state === "jumpFree") {
      j.fall = Math.min(45, j.fall + 9.81 * dt);
      if (j.elapsed > 2.2 || j.z < j.target.z + 24 || I.slow > 0.1) this.deployCanopy();
    }
    if (this.state === "jumpCanopy") {
      j.heading += I.turn * 0.72 * dt;
      j.speed += THREE.MathUtils.clamp((11 + I.fast * 4 - j.speed), -2 * dt, 2 * dt);
      j.fall += (7.2 - I.climb * 1.8 - j.fall) * Math.min(1, dt * 2.2);
    }
    j.x += Math.cos(j.heading) * j.speed * dt;
    j.y += Math.sin(j.heading) * j.speed * dt;
    j.z -= j.fall * dt;
    j.yaw = j.heading + Math.PI / 2;
    const wx = j.x, wz = -j.y;
    j.avatar.set(wx, j.z, wz, j.yaw, j.speed, Math.max(0, j.z - j.target.z));
    j.avatar.update(dt);
    if (this.state === "jumpFree") {
      j.avatar.rot("LeftArm", ["z", -38]); j.avatar.rot("RightArm", ["z", 38]);
      j.avatar.rot("LeftUpLeg", ["x", -18]); j.avatar.rot("RightUpLeg", ["x", -18]);
    } else {
      j.avatar.rot("LeftArm", ["z", -18]); j.avatar.rot("RightArm", ["z", 18]);
    }
    if (this.jumpRig?.visible) {
      this.jumpRig.position.set(wx, j.z, wz); this.jumpRig.rotation.y = j.yaw;
    }
    const gate = j.gates[j.gate];
    if (gate && gate.position.distanceTo(new THREE.Vector3(wx, j.z + 2, wz)) < 11) {
      gate.material = new THREE.MeshBasicMaterial({ color: 0x42ffb0, toneMapped: false });
      j.gate++;
      if (j.gate === 3) this.toast?.("All three aerial gates · line up the rooftop landing");
    }
    if (!this.jumpUiT || j.elapsed - this.jumpUiT > 0.25) { this.jumpUiT = j.elapsed; this.render(); }
    if (this.state === "jumpFree" && j.elapsed > 2.2) this.deployCanopy();

    const col = this.getCollider(), roof = col?.buildingAt(j.x, j.y, 0.5);
    let surface = roof ? roof.h + 0.25 : -1.8;
    if (!roof && j.z < 125) {
      const ground = this.groundAt?.(new THREE.Vector3(j.x, Math.max(50, j.z + 20), -j.y));
      if (Number.isFinite(ground)) surface = ground;
    }
    if (j.z <= surface + 1.15) {
      if (surface < -0.5) { this.failJump("Splash! The river is not a landing zone"); return; }
      this.finishJump(surface);
      return;
    }
    if (!roof && col?.blocked(j.x, j.y, 0.45, j.z - 0.8)) {
      this.failJump("Too close to a building · try the rooftop route again");
      return;
    }
    if (j.x < -1750 || j.x > 960 || j.y < -720 || j.y > 740) {
      this.failJump("Outside the rooftop challenge area");
      return;
    }
    this.followJump(dt);
    const alt = document.getElementById("fly-alt");
    if (alt) alt.textContent = Math.max(0, Math.round((j.z - surface) * FT / 10) * 10);
    const sp = document.getElementById("fly-spd");
    if (sp) sp.textContent = Math.round(j.speed * MPH);
  }

  followJump(dt) {
    const j = this.jump;
    if (!j) return;
    const behind = new THREE.Vector3(-Math.cos(j.heading) * 15, 6, Math.sin(j.heading) * 15);
    const want = new THREE.Vector3(j.x, j.z, -j.y).add(behind);
    const a = this.camSnap ? 1 : 1 - Math.exp(-dt * 4);
    this.camSnap = false;
    this.camera.position.lerp(want, a);
    this.camera.lookAt(j.x, j.z + 1, -j.y);
  }

  finishJump(surface) {
    const j = this.jump, target = j.target, d = Math.hypot(j.x - target.x, j.y - target.y);
    const landedOnPad = d <= target.radius;
    const success = landedOnPad && j.gate === 3;
    const message = success ? `Perfect rooftop landing · all 3 gates · ${Math.round(j.elapsed)} seconds · ${Math.round(d)} m from the centre`
      : landedOnPad ? `Rooftop landing · ${j.gate}/3 gates · try for a cleaner run`
        : `Safe rooftop touchdown · ${j.gate}/3 gates · target was ${target.label}`;
    j.avatar.set(j.x, surface, -j.y, j.yaw, 0, 0);
    j.avatar.contact(true);
    delete j.avatar.object.userData.parachute;
    this.clearJumpGates();
    if (this.jumpRig) { this.scene.remove(this.jumpRig); this.jumpRig = null; }
    this.jump = null;
    this.state = "idle";
    this.audio?.setPlane?.("you", 0, this.plane.position);
    this.render();
    const jp = (landedOnPad ? 800 : 150) + j.gate * 300 + (success ? 500 : 0) - Math.round(Math.min(400, d * 6));
    this.onJumpDone?.({ success, landedOnPad, near: d <= Math.max(10, target.radius), gates: j.gate, d, points: Math.max(0, jp) });
    this.onParachuteLand?.({ x: j.x, y: j.y, z: surface, yaw: j.yaw });
    this.toast?.(message);
  }

  failJump(message) {
    this.cancelJump();
    this.state = "ready";
    this.setMode("fly");
    this.reset(message);
  }

  abortJump() {
    this.failJump("Challenge restarted");
  }

  bindInput() {
    const keys = { KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
      ShiftLeft: "fast", ShiftRight: "fast", Space: "slow" };
    addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT") return;
      if (e.code === "KeyJ" && !e.repeat && this.state === "air") { this.startJump(); return; }
      if (e.code === "Space" && this.state === "jumpFree") { this.deployCanopy(); e.preventDefault(); return; }
      if (this.active && keys[e.code]) {
        this.ctl[keys[e.code]] = 1; e.preventDefault();
        if (this.auto && !e.repeat && ["up", "down", "left", "right"].includes(keys[e.code])) this.action("manual");
        if (keys[e.code] === "up" || keys[e.code] === "fast") this.takeOff();
      }
      if (e.code === "KeyF" && !e.repeat) {
        if (this.active && this.state !== "air" && this.p.v < 2) this.getOut();
        else if (!this.active && this.near) this.board();
      }
    });
    addEventListener("keyup", e => { if (keys[e.code]) this.ctl[keys[e.code]] = 0; });
    this.dom.addEventListener("pointerdown", e => { if (this.active) this.look.drag = [e.clientX, e.clientY]; });
    addEventListener("pointermove", e => {
      if (!this.look.drag) return;
      const { k } = Settings.lookScale();
      this.look.yaw -= (e.clientX - this.look.drag[0]) * 0.005 * k;
      this.look.drag = [e.clientX, e.clientY]; this.look.idle = 0;
    });
    addEventListener("pointerup", () => { this.look.drag = null; });
  }

  // ---------------------------------------------------------------- getting in and out
  veil(on) { document.getElementById("flyveil").style.opacity = on ? "1" : "0"; return new Promise(r => setTimeout(r, on ? 380 : 0)); }

  isPlane(obj) { while (obj) { if (obj.userData.flyPlane) return true; obj = obj.parent; } return false; }

  // home: from the menu / search / the Intrepid's card - the museum's Cessna on the deck, wherever you left it last
  async board({ home = false } = {}) {
    await this.ready;
    if (home && this.base && this.state !== "air") {
      this.base = null;
      if (this.active) { this.park(); this.camSnap = true; this.state = "ready"; this.render(); return; }
    }
    if (this.active) return;
    this.onBoard?.();                                               // out of any car first
    await this.veil(true);
    this.park();
    this.state = "ready"; this.helpT = 10;
    this.setMode("fly");
    this.camSnap = true;
    this.render();
    this.veil(false);
  }

  // parked at your base: the Intrepid, or the start of the runway you last landed on, facing down it
  park() {
    const B = this.base;
    if (B && B.r.code !== "INT") {
      const { T, u } = this.frame(B.r, B.fromA);
      Object.assign(this.p, { x: T[0] + u[0] * 40, y: T[1] + u[1] * 40, z: B.r.z, h: Math.atan2(u[1], u[0]), pitch: 0, roll: 0, v: 0 });
    } else Object.assign(this.p, { x: DECK.x, y: DECK.y, z: DECK.z, h: DECK.h, pitch: 0, roll: 0, v: 0 });
    this.landing = false; this.place(this.plane, this.p);
  }

  takeOff() { if (this.state === "ready") { this.state = "roll"; this.landing = false; this.render(); } }

  // out of the plane: you can't walk on the carrier deck, so you look down on it (Explore) with the plane in view
  async getOut() {
    if (!this.active || this.state === "air") return;
    this.state = "idle"; this.ctl = { left: 0, right: 0, up: 0, down: 0, fast: 0, slow: 0 };
    this.audio?.setPlane?.("you", 0, this.plane.position);
    this.render();
    this.onLeave?.(this.p);
  }

  // ---------------------------------------------------------------- runways and landing
  // where you can land: the Intrepid's deck, from the east (over 12th Avenue, a steep 9-degree carrier approach that
  // clears every building; the Space Shuttle pavilion on the stern rules out the west), rolling west and stopping well
  // short of the pavilion. The real airports (js/region.js) are only offered if a region is wired in - it isn't: the
  // game area is Midtown + the harbour.
  runways() {
    this.overDeck(0, 0);
    const [x0, y0, x1, y1] = this.ship?.box || [-1632, 0, -1355, 60], yc = (y0 + y1) / 2;
    const deck = { code: "INT", name: "USS Intrepid", a: [x1 - 2, yc], b: [x0 + 2, yc], w: 26, z: DECK.z, len: x1 - x0 - 4, oneWay: true, glide: DECK_GLIDE,
      fact: "Back aboard the Intrepid, Pier 86." };
    const air = (this.region?.airports || []).flatMap(A => A.runways.map(r => ({ ...r, code: A.code, name: A.name, fact: A.fact })));
    return [deck, ...air];
  }
  dist(r) { return Math.hypot((r.a[0] + r.b[0]) / 2 - this.p.x, (r.a[1] + r.b[1]) / 2 - this.p.y); }
  distTo(r) { const d = this.dist(r); return d < 1000 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1) + " km"; }
  airports() { return this.places().filter(r => r.code !== "INT").sort((a, b) => this.dist(a) - this.dist(b)); }
  places() {                                         // landing places, one per airport (+ the Intrepid)
    const seen = new Map();
    for (const r of this.runways()) if (!seen.has(r.code)) seen.set(r.code, r);
    return [...seen.values()];
  }
  frame(r, fromA = true) {                           // a runway direction: threshold T, unit vector u (landing / take-off way)
    const [a, b] = fromA ? [r.a, r.b] : [r.b, r.a], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { T: a, u: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], L };
  }
  onRunway(x, y) {
    if (this.overDeck(x, y)) return this.runways()[0];
    for (const r of this.runways().slice(1)) {
      const { T, u, L } = this.frame(r), dx = x - T[0], dy = y - T[1], s = dx * u[0] + dy * u[1], c = -dx * u[1] + dy * u[0];
      if (s > -5 && s < L + 5 && Math.abs(c) < r.w / 2 + 4) return r;
    }
    return null;
  }
  runway() {                                         // the Intrepid's touchdown point and centreline (kept for callers)
    const r = this.runways()[0];
    return { tx: r.a[0] - 23, yc: r.a[1] };
  }
  // the gold rings down the glide path of the runway you're landing on (also when you fly it yourself)
  showApproach(on, target) {
    if (this.rings) { this.scene.remove(this.rings); this.rings = null; }
    if (!on || !target) return;
    const { T, u } = target;
    this.rings = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false });
    const aim = new THREE.Vector3(T[0] + u[0] * 400, target.z + 2, -(T[1] + u[1] * 400));
    for (const d of [1100, 850, 620, 420, 250, 110]) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(d > 600 ? 26 : 18, 0.9, 8, 40), mat);
      m.position.set(T[0] - u[0] * d, target.z + 3 + (d + target.aim) * (target.r.glide || GLIDE), -(T[1] - u[1] * d));
      m.lookAt(aim);
      m.traverse(o => { o.raycast = () => {}; });
      this.rings.add(m);
    }
    this.scene.add(this.rings);
  }
  // pick the landing place: the Intrepid (from the west) or the runway end of an airport whose approach is nearest you
  approachFor(code) {
    const p = this.p, opts = [];
    for (const r of this.runways()) {
      if (r.code !== code) continue;
      for (const fromA of r.oneWay ? [true] : [true, false]) {
        const f = this.frame(r, fromA), aim = r.code === "INT" ? 23 : 80;       // touchdown zone past the threshold
        const fix = [f.T[0] - f.u[0] * FINAL, f.T[1] - f.u[1] * FINAL];
        opts.push({ r, fromA, ...f, z: r.z, aim, fix, d: Math.hypot(fix[0] - p.x, fix[1] - p.y) });
      }
    }
    return opts.sort((a, b) => a.d - b.d)[0];
  }
  startLanding(code = "INT") {
    if (this.state !== "air") return;
    const t = this.approachFor(code);
    if (!t) return;
    const p = this.p, G = t.r.glide || GLIDE;
    const zFix = t.z + 3 + (FINAL + t.aim) * G;
    const legs = [];
    const overMidtown = p.x > -1750 && p.x < 960 && p.y > -720 && p.y < 740;
    const dx = p.x - t.T[0], dy = p.y - t.T[1], along = -(dx * t.u[0] + dy * t.u[1]), cross = Math.abs(-dx * t.u[1] + dy * t.u[0]);
    const onFinal = along > 150 && cross < 150 && Math.abs(p.z - (t.z + 3 + (along + t.aim) * G)) < 40;   // already on the way down
    if (onFinal) legs.push(null);
    else if (t.d > 1500 || (overMidtown && p.z < 480)) {               // far off, or low among the towers: up and round, high
      const TOP = 520;                                             // over every Midtown tower (Central Park Tower: 472 m)
      if (p.z < TOP - 40 && !overMidtown)                          // climb over the Hudson first, never through the towers
        legs.push({ x: -1950, y: THREE.MathUtils.clamp(p.y, -2500, 900), z: TOP, r: 260 });
      else if (p.z < TOP - 40)                                     // among the towers: straight up where you are first
        legs.push({ x: p.x + Math.cos(p.h) * 400, y: p.y + Math.sin(p.h) * 400, z: TOP, r: 1e9 });
      // join the glide path where it is at that height (east of Midtown for the deck), then just ride it down: no
      // circling to lose height among the towers
      const k = Math.max(FINAL, (TOP - t.z - 3) / G - t.aim), lead = [t.T[0] - t.u[0] * k, t.T[1] - t.u[1] * k];
      legs.push({ x: lead[0], y: lead[1], z: TOP, r: 220 });
    } else legs.push({ x: t.fix[0], y: t.fix[1], z: zFix, r: 130 });
    this.auto = legs[0] === null ? { legs: [], final: true, t } : { legs, final: false, t };
    this.target = t; this.approachOn = true; this.chooser = false;
    this.showApproach(true, t);
    this.render();
    this.toast?.(`Autopilot: flying you to ${t.r.name}${t.r.ref ? ", runway " + t.r.ref.split("/")[t.fromA ? 0 : 1] : ""}. Any flight key takes over.`);
  }
  // steer toward the next leg, then down the glide path; returns the inputs a pilot would give
  autopilot() {
    const p = this.p, A = this.auto, t = A.t;
    const steer = h => { let d = h - p.h; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return THREE.MathUtils.clamp(d * 2.2, -1, 1); };
    if (!A.final) {
      const L = A.legs[0];
      const d = Math.hypot(L.x - p.x, L.y - p.y);
      const ok = Math.abs(L.z - p.z) < 45;
      let turn = d < L.r && !ok ? 0.7 : steer(Math.atan2(L.y - p.y, L.x - p.x));   // circle until at the right height
      if (L.z - p.z > 60) turn *= 0.45;                            // well below it: climb first, turn gently
      if (L.r > 1e8) turn = 0;                                     // "straight up": wings level, just climb
      const climb = THREE.MathUtils.clamp((L.z - p.z) / 25, -1, 1);
      if (d < L.r && ok) { A.legs.shift(); if (!A.legs.length) A.final = true; }
      return { turn, climb, slow: 0 };
    }
    // final: in the runway's frame - along-track s (negative before the threshold), cross-track c
    const dx = p.x - t.T[0], dy = p.y - t.T[1], sAl = dx * t.u[0] + dy * t.u[1], c = -dx * t.u[1] + dy * t.u[0];
    const dist = Math.max(0, t.aim - sAl);
    const zWant = sAl > t.aim - 15 ? t.z - 1 : t.z + 0.5 + dist * (t.r.glide || GLIDE);     // at the touchdown zone: put it down
    const turn = steer(Math.atan2(t.u[1], t.u[0]) + Math.atan2(-c, 220)) * (dist < 60 ? 0.3 : 1);
    const climb = THREE.MathUtils.clamp((zWant - p.z) / 6, -0.8, 0.6);
    return { turn, climb, slow: 1 };
  }

  // touched something: no wreck, just a fade and back to the deck, ready to go again
  async reset(msg = "Too close! You touched something") {
    if (this.resetting) return;
    this.resetting = true;
    this.onBump?.();
    await this.veil(true);
    this.park(); this.state = "ready"; this.camSnap = true; this.look.yaw = 0;
    this.auto = null; this.approachOn = false; this.target = null; this.chooser = false; this.showApproach(false);
    this.render();
    const at = this.base?.r.code && this.base.r.code !== "INT" ? this.base.r.name : "the Intrepid";
    this.toast?.(`${msg} · back at ${at}`);
    await this.veil(false);
    this.resetting = false;
  }

  // ---------------------------------------------------------------- the world under you
  overDeck(x, y) {
    const col = this.getCollider();
    if (this.ship === undefined && col) this.ship = [...col.near(-1490, 30, 20)].map(i => col.polys[i]).find(p => p.kind === "ship") || null;
    const [x0, y0, x1, y1] = this.ship?.box || [-1632, 0, -1355, 60];
    return x >= x0 + 2 && x <= x1 - 2 && y >= y0 + 4 && y <= y1 - 4;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.tpl) return;
    this.updateBanner(dt);
    if (!this.rooftopSites) this.buildRooftopSites();
    // walking near the parked plane (or looking down on it from close by): offer to fly it
    if (!this.active) {
      const c = this.camera.position, d = Math.hypot(c.x - this.plane.position.x, c.z - this.plane.position.z);
      // on foot you have to be up on the flight deck beside it (the Intrepid's elevator takes you there); from the
      // air (Explore) a tap on it from close by is the shortcut
      const m = this.getMode();
      this.near = m === "walk" ? c.y > 15 && d < 30 : m !== "ride" && d < 110 && c.y < 120;
      this.chip.style.display = this.near ? "flex" : "none";
      return;
    }
    this.chip.style.display = "none";
    if (this.state === "jumpFree" || this.state === "jumpCanopy") {
      this.updateJump(dt);
      return;
    }
    if (this.helpT > 0 && this.state === "air") { this.helpT -= dt; if (this.helpT <= 0) this.render(); }
    if (!this.resetting) this.fly(dt);
    this.place(this.plane, this.p);
    this.moveSurfaces(dt);
    const prop = this.plane.userData.prop;
    if (prop) prop.rotation.z += dt * (this.state === "ready" ? 25 : 70);
    this.audio?.setPlane?.("you", this.state === "ready" ? 0.35 : 0.6 + 0.4 * Math.min(1, this.p.v / FAST), this.plane.position, 6);
    const sp = document.getElementById("fly-spd"), al = document.getElementById("fly-alt");
    if (sp) sp.textContent = Math.round(this.p.v * MPH);
    if (al) al.textContent = Math.max(0, Math.round((this.p.z - (this.onRunway(this.p.x, this.p.y)?.z ?? 0)) * FT / 10) * 10);
    const home = document.getElementById("fly-home");
    if (home) {                                                 // where you can land, always: the nearest place
      const t = this.target?.r || this.airports()[0] || this.runways()[0];
      if (t) home.textContent = `✈ ${t.code === "INT" ? "Intrepid" : t.code} ${this.distTo(t)}`;
    }
    const jumpButton = this.panel.querySelector('[data-a="jump"]');
    if (jumpButton) jumpButton.disabled = !this.jumpReady();
    this.follow(dt);
  }

  // yoke and pedals -> ailerons, elevators, rudder; flaps 10 deg for takeoff, 30 deg when you slow down to land
  moveSurfaces(dt) {
    const e = this.eff || { turn: 0, climb: 0 }, D = this.defl, slow = this.input().slow > 0.1;
    const flap = this.state === "air" ? (slow ? 0.52 : this.climbOut > 0 ? 0.17 : 0) : this.state === "roll" ? (this.landing ? 0.52 : 0.17) : 0;
    const want = { ail: e.turn * 0.3, ele: -e.climb * 0.35, rud: -e.turn * 0.35, flap };
    for (const k in D) D[k] += (want[k] - D[k]) * Math.min(1, dt * (k === "flap" ? 1.2 : 8));   // flaps run slowly, like the real motor
    const set = (n, a) => { const s = this.surf[n]; if (s) s.o.quaternion.copy(s.base).multiply(new THREE.Quaternion().setFromAxisAngle(s.axis, a)); };
    set("AILERON_R", D.ail); set("AILERON_L", -D.ail);                 // roll left: left aileron up, right aileron down
    set("ELEVATOR_R", D.ele); set("ELEVATOR_L", D.ele);                // climb: trailing edges up
    set("RUDDER", D.rud);                                              // turn left: rudder to the left
    set("FLAP_R", D.flap); set("FLAP_L", D.flap);
  }

  input() {
    const c = this.ctl, P = this.pad;
    const turn = P && Math.abs(P.lx) > 0.1 ? -P.lx : (c.left ? 1 : 0) - (c.right ? 1 : 0);
    const climb = P && Math.abs(P.ly) > 0.1 ? -P.ly : (c.up ? 1 : 0) - (c.down ? 1 : 0);
    const fast = Math.max(c.fast, P?.r2 || 0), slow = Math.max(c.slow, P?.l2 || 0);
    return { turn, climb, fast, slow };
  }

  fly(dt) {
    const p = this.p, I = this.input(), col = this.getCollider();
    this.eff = { turn: 0, climb: 0 };
    if (this.state === "ready") { p.v = 0; return; }
    if (this.state === "roll") {                                    // on the deck: takeoff run, or the landing roll
      if (this.landing) {
        p.v = Math.max(0, p.v - 9 * dt);
        if (p.v === 0) { this.state = "ready"; this.landing = false; this.park(); this.camSnap = true; this.render(); return; }   // taxi to the start
      } else p.v += (this.overDeck(p.x, p.y) ? 16 : 6.5) * dt;   // the Intrepid's catapult flings you off the deck (~40 m)
      p.h += I.turn * 0.25 * dt * Math.min(1, p.v / 5);
      this.eff = { turn: I.turn, climb: I.climb };
      p.roll *= Math.exp(-dt * 6);
      p.x += Math.cos(p.h) * p.v * dt; p.y += Math.sin(p.h) * p.v * dt;
      const rw = this.onRunway(p.x, p.y);
      if (rw) p.z = rw.z;
      p.pitch += ((this.landing ? 0 : p.v > VR - 4 ? 0.12 : 0) - p.pitch) * Math.min(1, dt * 3);
      if (!this.landing && p.v >= VR) { this.state = "air"; this.climbOut = 4; this.render(); }   // rotate and lift off
      else if (!rw) { p.z -= 2; if (!this.landing && p.v > STALL) { this.state = "air"; this.climbOut = 4; this.render(); } else this.reset("Off the end of the runway! Back to the start"); }
      return;
    }
    // ---- in the air
    let { turn, climb } = I;
    let slowIn = I.slow;
    if (this.auto) ({ turn, climb, slow: slowIn } = this.autopilot(dt));
    const [bx0, by0, bx1, by1] = [-1750, -720, 960, 740];       // stay over the region (or Midtown + the harbour): drift back
    const H = this.harbor, inHarbor = H?.frame && H.inFrame(p.x, p.y), R = this.region;
    const rb = R?.box, outR = rb ? R.edgeOut(p.x, p.y) : null;   // the area's real (tilted) edges
    const out = this.auto ? -1 : rb ? outR : inHarbor || this.approachOn ? -1 : Math.max(bx0 - p.x, p.x - bx1, by0 - p.y, p.y - by1);
    if (rb && !this.auto && outR > -1500 && outR <= 0 && !this.edgeWarned) {      // a warning first, while it's still your turn to make
      this.edgeWarned = true;
      this.toast?.("Edge of the flying area ahead (the city's limits on the map). Turn back, or pick “Land at…”");
    } else if (rb && outR < -2500) this.edgeWarned = false;
    if (out > (rb ? 0 : 150)) {
      const want = Math.atan2(-p.y, -300 - p.x); let dh = want - p.h;
      while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      turn = THREE.MathUtils.clamp(dh * 2, -1, 1);
      if (!this.warned) { this.warned = true; this.toast?.("Edge of the flying area: the autopilot is turning you back toward Manhattan"); }
    } else this.warned = false;
    this.eff = { turn, climb };
    const target = slowIn > 0.1 ? SLOW : I.fast > 0.1 && !this.auto ? FAST : CRUISE;
    p.v += THREE.MathUtils.clamp(target - p.v, -5 * dt, 4 * dt) - 9.8 * Math.sin(p.pitch) * dt * 0.35;
    p.v = THREE.MathUtils.clamp(p.v, 18, 75);
    p.roll += (turn * 0.65 - p.roll) * Math.min(1, dt * 2.5);
    let pt = climb * 0.3;
    if (this.climbOut > 0) { this.climbOut -= dt; pt = Math.max(pt, 0.2); }   // just off the deck: climb away first
    if (p.v < STALL) pt = Math.min(pt, -0.12);                       // too slow: the nose drops by itself
    if (p.z >= CEILING && pt > 0) pt = 0;
    this.lastPitch = p.pitch;                                           // the pitch you arrived with (for the touchdown's sink rate)
    p.pitch += (pt - p.pitch) * Math.min(1, dt * 2);
    p.h += 9.8 * Math.tan(p.roll) / Math.max(p.v, 20) * dt;
    const hv = p.v * Math.cos(p.pitch);
    p.x += Math.cos(p.h) * hv * dt; p.y += Math.sin(p.h) * hv * dt;
    p.z = Math.min(CEILING, p.z + p.v * Math.sin(p.pitch) * dt);
    // touching down / touching anything
    const rw = this.onRunway(p.x, p.y), deck = rw?.code === "INT", z0 = rw?.z ?? 0;
    if (rw && !(this.climbOut > 0) && climb <= 0 && p.z < z0 + 4) p.z -= 1.6 * dt;   // low over a runway: settle onto it
    if (deck && p.z < z0 - 1.5) return this.reset("Too low! Into the Intrepid's side");   // into the hull
    if (rw && p.z <= z0 + 0.3 && !(this.climbOut > 0)) {
      if (p.v < 44 && p.pitch > -0.22 && Math.abs(p.roll) < 0.35) {   // a landing
        p.z = z0; p.pitch = 0; this.state = "roll"; this.landing = true;
        this.base = { r: rw, fromA: Math.cos(p.h) * (rw.b[0] - rw.a[0]) + Math.sin(p.h) * (rw.b[1] - rw.a[1]) > 0 };
        let was = this.auto ? `The autopilot landed you at ${rw.name}` : `Nice landing at ${rw.name}`;
        if (rw.code === "INT") {                                       // Pilotwings: graded on the centreline, the touchdown spot, the sink rate and the bank
          const R0 = this.runway(), lat = Math.abs(p.y - R0.yc), long = Math.abs(p.x - R0.tx), sink = Math.max(0, -p.v * Math.sin(this.lastPitch ?? p.pitch)), bank = Math.abs(p.roll);
          const raw = Math.max(0, Math.round(1000 - lat * 55 - long * 7 - sink * 110 - bank * 300)), pts = this.auto ? Math.min(raw, 250) : raw, grade = this.auto ? "Auto" : raw >= 850 ? "A" : raw >= 650 ? "B" : raw >= 450 ? "C" : "D";   // the autopilot gets you down, but the points are for flying it yourself
          was = `Landing grade ${grade} · ${pts} pts · ${lat.toFixed(1)} m off the line, ${long.toFixed(0)} m from the wire`;
          this.onLanding?.({ grade, points: pts, lat, long, sink });
        }
        this.auto = null; this.approachOn = false; this.target = null; this.showApproach(false); this.render();
        this.toast?.(rw.code === "INT" ? was : `${was}. ${rw.fact}`);
        return;
      }
      return this.reset("Too hard a landing!");
    }
    const overHarbor = H?.frame && H.inFrame(p.x, p.y) && !(p.x > bx0 && p.x < bx1 && p.y > by0 && p.y < by1);
    const inMidtown = p.x > bx0 && p.x < bx1 && p.y > by0 && p.y < by1;
    const ground = overHarbor ? (H.isLand(p.x, p.y) || H.isPier(p.x, p.y) ? 0 : -1.8)
      : inMidtown ? (p.x < SHORE_X ? -1.8 : 0) : R?.isLand?.(p.x, p.y) ? -0.35 : -1.8;      // beyond: the region's land or water
    if (overHarbor && p.z < H.topAt(p.x, p.y) + 1) return this.reset();   // a Lower Manhattan tower, or the Statue
    if (!inMidtown && !overHarbor && !rw && R?.topAt && p.z < R.topAt(p.x, p.y) + 1) return this.reset("You flew into a building!");
    if (!rw && p.z <= ground + 1.2) return this.reset(ground < -1 ? "Splash! Into the water" : "Too low! You hit the ground");
    // Midtown's buildings: its own collider. (Not outside Midtown: there the walking collider calls all water and
    // everything past the harbour's edge "blocked" at any height, which ended every flight at Midtown's edge. The
    // harbour's towers and the Statue are checked above; the world's edge turns you back gently.)
    const inMid = p.x > bx0 && p.x < bx1 && p.y > by0 && p.y < by1;
    if (col && !deck && inMid && col.blocked(p.x, p.y, 4, p.z - 0.5)) return this.reset();
  }

  follow(dt) {
    const cam = this.camera, pl = this.plane, L = this.look;
    L.idle += dt;
    if (this.pad && this.pad.rx) { L.yaw -= this.pad.rx * dt * 2.2; L.idle = 0; }
    if (!L.drag && L.idle > 2) L.yaw *= Math.exp(-dt * 1.5);
    const h = this.p.h - Math.PI / 2 + L.yaw;                       // three.js yaw behind the plane
    const air = this.state === "air";
    const off = new THREE.Vector3(0, air ? 6 : 4, air ? 24 : 16).applyAxisAngle(new THREE.Vector3(0, 1, 0), h);
    const want = pl.position.clone().add(off);
    want.y = Math.max(want.y, pl.position.y + 1.5, (this.p.x < SHORE_X ? 1 : 2));
    const col = this.getCollider();                                    // never inside a tower: pull in toward the plane
    const midtown = x => x.x > -1750 && x.x < 960 && -x.z > -720 && -x.z < 740;   // the collider only knows Midtown
    if (col && midtown(want)) for (let k = 0; k < 8 && col.blocked(want.x, -want.z, 1, want.y); k++) want.lerp(pl.position, 0.3);
    const a = this.camSnap ? 1 : 1 - Math.exp(-dt * 4);
    this.camSnap = false;
    cam.position.lerp(want, a);
    const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.p.h - Math.PI / 2);
    cam.up.set(0, 1, 0);
    cam.lookAt(pl.position.clone().addScaledVector(fwd, 20).add(new THREE.Vector3(0, 2, 0)));
  }

  updateBanner(dt) {
    if (!this.tow) return;
    const night = this.isNight?.() || 0;
    const show = night < 0.6;                                         // banner tows fly in daylight
    this.tow.visible = this.banner.visible = this.line.visible = show;
    if (!show) { this.audio?.setPlane?.("tow", 0, this.tow.position, 40); return; }
    if (!this.holdBanner?.()) this.bannerS += LOOP.v * dt;          // holds still while a buyer looks at it in the sales sheet
    const q = this.loopAt(this.bannerS), q2 = this.loopAt(this.bannerS + 6);
    let dh = q2.h - q.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    this.place(this.tow, { ...q, pitch: 0, roll: THREE.MathUtils.clamp(dh * 3, -0.5, 0.5) });
    const prop = this.tow.userData.prop; if (prop) prop.rotation.z += dt * 70;
    // the banner trails 40 m behind on the path, its length along the path, a little lower
    const b0 = this.loopAt(this.bannerS - 40), b1 = this.loopAt(this.bannerS - 70);
    const mid = B((b0.x + b1.x) / 2, (b0.y + b1.y) / 2, LOOP.z - 6);
    this.banner.position.copy(mid);
    this.banner.rotation.set(0, Math.atan2(b1.x - b0.x, -(b1.y - b0.y)), 0);   // its length (local Z) along the line b0 -> b1
    const lead = B(b0.x, b0.y, LOOP.z - 6), tail = this.tow.position.clone().add(new THREE.Vector3(0, 0.6, 0))
      .add(new THREE.Vector3(0, 0, 5.6).applyQuaternion(this.tow.quaternion));   // the tail, 5.6 m behind the main wheels
    const pos = this.line.geometry.attributes.position;
    pos.setXYZ(0, tail.x, tail.y, tail.z); pos.setXYZ(1, lead.x, lead.y, lead.z); pos.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
    this.audio?.setPlane?.("tow", 0.7, this.tow.position, 40);
  }
}
