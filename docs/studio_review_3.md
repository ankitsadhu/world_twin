# Studio review 3: the whole game, UI/UX and engineering (2026-10-10)

Written as a producer's review for a launch decision. Evidence is from this session's playtests in the Browser pane (desktop and a 375 px phone), the code (`viewer/index.html` 1,620 lines, 55 modules, 12.3 k lines of JS), and `docs/launch_plan.md`. Where something was not tested, it says so.

## 1. Verdict

**Not launch-ready; ready for a closed playtest.** The world, the crowd, the vehicles and the first minute are now genuinely strong for a browser game. What stops a public launch is not features: it is the first load (72 MB), no automated tests, one 1,600-line entry file holding most of the wiring, and no stranger has played it yet.

| Area | Score | One line |
|---|---|---|
| First minute (Play -> bike -> first crash) | 7/10 | Instant, readable, funny. Tutorial text is still two layers deep. |
| Core loop (missions, chaos chain, unlocks) | 6/10 | 21 missions, medals, paint unlocks. No reason yet to come back tomorrow. |
| UI/UX | 7/10 | After this week's passes: 2-button dock, one chip pair, pill vehicle bar, touch layout. Still some legacy hotkeys. |
| Controls | 7/10 | Strafe on foot, drag to turn the explore camera, touch stick. Gamepad and reverse not retested. |
| Visual quality | 7/10 | Night look is the hero. Day looks flat. People and bike detail are the weak spot. |
| Engineering health | 5/10 | Works, fast to iterate, fragile to change (see section 4). |
| Performance / load | 4/10 | 72 MB first load; no staged loading; unknown on a mid phone. |
| Live-ops readiness | 3/10 | Analytics funnel exists; no error reporting, kill switches, or QA automation. |

## 2. UI/UX review (what a player sees)

### Done this week (and why)
- One home per action: Missions (top-left chip, or K), Menu (dock), Map (the minimap), Ride (one big button on foot). Removed: Map, Missions, Sound, Garage, Explore, Walk and Ride buttons from the dock; the district menu; zoom and turn buttons outside Explore; the Shove button; XP in the chip; the "welcome back" toast; the People slider; the time-of-day slider.
- The world decides, not the player: crowd size (`config/population.json`), time of day (real New York clock; `?time=` for QA).
- Vehicle bar is one pill: speed, Repaint, Get off. Touch driving: glass buttons, big Go, minimap moved up.
- A Keys tab in the Menu so nothing has to be memorised.

### Still wrong (prioritised)
1. **Tutorial layers.** "Hold W to ride", the nav hint line, and the first toast can all appear together. One prompt at a time, in one place. (P1)
2. **Legacy hotkeys** (X, J, T, E) have no on-screen entry and are not in the Keys list. Either remove them or fold them into the mission start. R now retries a race. (P2)
3. **V** means first/third person on foot and nothing while riding (C is look-back). Pick one camera key. (P2)
4. **Result card and retry** are good on desktop; not checked on a phone. (P1)
5. **Empty-state copy**: the missions list shows 21 rows at once. Group by "next up" and "done", show 3 by default. (P2)
6. **Accessibility**: captions are off by default now (right), but there is no colour-blind check on the beacons (category colours: red, amber, green, teal, purple, gold). Add icons-only mode. (P3)
7. **Zoom + / -** in Explore duplicate wheel and pinch. Remove. (P3)
8. **Dock with two buttons** (View, Menu) is no longer a dock. Fold View into the Menu and drop the rail, or make Explore a mission-hub screen. (P2)

### Principles to keep (use as a review checklist for every new feature)
- Nothing on screen that the player cannot act on or does not need in the next 10 seconds.
- One entry point per feature; shortcuts are additions, never the only way.
- State belongs to the game (crowd, time, difficulty), not to sliders. Settings are for the device and for accessibility only.
- Every new HUD element needs a rule for when it is hidden.

## 3. Game design review

- **Core fantasy** is clear and marketable: "GTA world without crime", real Times Square scale, night neon, a bike under you in one click.
- **Strongest moments**: first jump off a ramp, a lamp-post bending, a pile-up in Crash Junction, a police helicopter. These are the clips. Keep clip capture one tap away (F8 exists; the post-moment prompt is the thing to test).
- **Weakest**: no *reason* to play session two. Missions are a checklist. Needed: a daily seed (one challenge, same for everyone), a ghost to beat (Time Trial has it), and a weekly leaderboard. All are in `docs/launch_plan.md` and none are built.
- **Economy rule** (only money is property/billboards) is clean and should stay; it keeps the game honest and the sales story simple.
- **Danger**: 21 missions of mixed quality dilutes the five that matter. Ship the five best (First Ride, Stunt Park, Time Trial, Heat, Wolf Hunt) polished; hide the rest behind "coming soon" until each has a result card, a retry and a share.
- **Hitting people** (Rough contact) is off on the public site by default. Keep it that way for launch; it is the one feature that can change the age rating and the platform review.

## 4. Engineering review

### What is good
- Config-as-data has started (`config/world.json`, `config/population.json`); modules are mostly single-purpose classes (`fx`, `furniture`, `dent`, `spree`, `population`, `beacon`).
- Pooled particles (700 points), instanced crowd, spatial indexes for obstacles, a ground height-map: the right performance primitives.
- Analytics funnel and saved state are wrapped in try/catch (private mode safe).
- A debug handle (`window.__dbg`, only with `?debug`) makes the game scriptable in the Browser pane. Keep it; it is our de-facto test harness.

### Risks (ordered by launch impact)
1. **First load 72 MB / 185 requests, uncompressed.** No staged loading. Target: playable shell < 8 MB, the rest streamed after first input. Serve brotli; `.glb` already Draco where possible; textures to KTX2. (P0)
2. **No automated tests.** Every change this week was verified by hand in a browser tab. Minimum: a headless smoke test (load, press Play, drive 10 s, assert no console errors and a non-zero speed), run on every commit. Then one test per mission start/finish. (P0)
3. **`index.html` is the wiring.** 1,620 lines, a long chain of top-level `const`s whose order matters (we hit TDZ errors three times this month). Move wiring to a small `bootstrap.js` with an explicit module list and dependency order; no module should read another module's variable by name. (P1)
4. **Global mutable state via `Settings.v.*` and DOM ids** (`document.getElementById("ridepill")`...). A renamed id silently breaks a feature. Introduce a tiny `ui.js` registry. (P1)
5. **Memory/GC on long sessions**: dent geometry clones per vehicle (bounded by vehicle count, but never freed), NPC spawn/trim churn, toast/DOM nodes. Add a 30-minute soak test with `performance.memory` logging. (P1)
6. **Frame time budget is not measured in the product.** `Settings.quality = auto` steps down by FPS; there is no per-system timing (traffic, NPCs, particles, shadows). Add a `?debug` overlay with ms per system. (P1)
7. **Observability**: errors go to the console only. Add `window.onerror` + unhandled rejection reporting to the analytics beacon with build id and device class. (P1)
8. **Saved-state versioning**: keys `ts.*.v1` exist; there is no migration path or global reset. A bad save can brick a returning player. (P2)
9. **Security/privacy**: no secrets in the client (good); analytics endpoint and privacy page not final. The sales/support inbox is set (`support@neonblox.com` in `config/world.json`). (P1, blocking for deploy)
10. **Hosting**: no-cache for html/js/json is required (memory note) or players run stale modules. Add a build hash to module URLs so caching can be turned on safely later. (P1)

### Things I changed this week that need follow-up
- Dents clone geometry per vehicle on first hit; fine at current counts, but re-check if many parked bikes get hit in one session.
- The touch walking stick and long-press hit were verified with synthetic events only. Needs a real-device pass.
- The population director eases the crowd using the live count; it does not yet use measured frame time.

## 5. Plan

**This week (closed playtest build)**
1. Real-device pass on one iPhone and one mid Android: load time, touch stick, driving buttons, thermal after 10 minutes. 
2. Smoke test in CI (headless browser).
3. One tutorial prompt at a time.
4. Error reporting to the analytics beacon.

**Next two weeks (soft launch)**
5. Staged loading and compression to a < 8 MB shell.
6. Ship the five best missions only; polish result card, retry and share on each.
7. Daily challenge + ghost-to-beat link.
8. `bootstrap.js` refactor of the wiring; per-system frame timings.

**Before public launch**
9. Privacy page, kill switches (Rough contact, vehicles), domain and hosting with no-cache headers.
10. 5 strangers, silent playtest, measure: seconds to first laugh, where they quit, session length (target median > 3 min, D1 > 15 %).

## 6. Decision needed from you
1. Ship five missions or all 21? (Recommendation: five.)
2. Keep Rough contact off on the public site at launch? (Recommendation: yes.)
3. Is a native-feeling phone experience a launch requirement, or desktop first and phone as a follow-up? This changes the loading budget and the touch work.

## 7. Status after "fix everything" (same day)

Done and verified (Browser pane, `?debug&selftest`: 16/16 pass):
- One prompt at a time: the notice lane is silent during the tutorial.
- The dock and zoom buttons are gone; View lives in the Menu, Menu is the gear in the search bar on every device.
- The missions list shows "Next up" (3) with the other 18 one tap away.
- Frame loop hardening: next frame is scheduled first, every system runs in a guard (reports once, switches itself off after 30 errors), `?perf` shows ms per system. First readings (desktop, 119 fps): render 3.8 ms, walk 1.8, camera view 1.2, minimap 0.8, traffic 0.35; the walk and camera-view numbers are worth a look.
- Error reporting: uncaught errors and rejected promises go to the analytics funnel with build id and device class (capped at 20 per session).
- In-page smoke test (`js/selftest.js`) covering the first minute and the HUD rules; a CI wrapper (`scripts/tools/smoke.mjs`) written but not run (Playwright is not installed here).

Not done, and why:
- **72 MB first load / staged loading / compression:** needs the asset pipeline (KTX2, Draco, brotli, a split shell) and a hosting decision. Largest remaining launch risk.
- **Real-device pass (iPhone + mid Android):** needs hardware. Touch stick, long-press hit and driving buttons were tested with synthetic events only.
- **`bootstrap.js` refactor of the 1,600-line wiring:** a large mechanical change that deserves its own branch and the smoke test as a safety net (now it exists).
- **Privacy page, kill switches, domain:** the sales inbox is already set (`support@neonblox.com`); the domain and the analytics endpoint are still open.
- **Legacy hotkeys (X, J, T, E) and the V key:** left working, not advertised; decide whether to remove.
