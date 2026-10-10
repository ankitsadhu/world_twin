// A smoke test that runs inside the game: open  index.html?debug&selftest  in any browser (or a headless one in CI) and read the result from
// `window.__selftest` / the console line "SELFTEST PASS|FAIL". It plays the first minute for real: loads, Ride, drive, crowd, menu, missions, and checks the HUD rules.
// Add a check here whenever a bug is fixed that a player could hit again.
const wait = ms => new Promise(r => setTimeout(r, ms));
const key = (c, t) => window.dispatchEvent(new KeyboardEvent(t, { code: c, key: c, bubbles: true }));
const shown = e => { if (!e || !e.getClientRects().length) return false; const c = getComputedStyle(e); return c.visibility !== "hidden" && c.display !== "none" && +c.opacity > 0.02; };      // (offsetParent is null for fixed elements, so it cannot be used)

export async function run() {
  const d = window.__dbg, out = [], ok = (name, pass, detail = "") => out.push({ name, pass: !!pass, detail: String(detail) });
  try {
    for (let i = 0; i < 90 && !(d?.traffic?.ready && d?.npcs?.list?.length); i++) await wait(500);          // wait for the city
    ok("city loads: traffic and people exist", d?.traffic?.ready && d.npcs.list.length > 0, `npcs ${d?.npcs?.list?.length}`);
    await wait(1500);

    // HUD rules
    const chips = [...document.querySelectorAll("#hud-stack > *")].filter(shown);
    ok("HUD: at most two chips in the status stack", chips.length <= 2, chips.map(c => c.textContent.trim()).join(" | "));
    ok("HUD: no dock or zoom buttons", !shown(document.getElementById("dock")) && !shown(document.getElementById("zoom")));
    ok("HUD: no Shove button", ![...document.querySelectorAll("button")].some(b => /Shove/.test(b.textContent) && shown(b)));
    ok("HUD: Menu gear is reachable", shown(document.getElementById("gearbtn")));
    ok("HUD: Ride button is offered on foot", document.body.classList.contains("canride") || shown(document.getElementById("hopin")), document.body.className);
    const stray = [...document.querySelectorAll("#hud *, #hud-stack *")].filter(e => { const r = e.getBoundingClientRect(); return shown(e) && r.width > 0 && (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight); });
    ok("HUD: nothing is off-screen", stray.length === 0, stray.map(e => e.id || e.className).join(","));

    // the first minute
    d.ride.rideNearestBike(true);
    for (let i = 0; i < 20 && d.ride.state !== "driving"; i++) await wait(500);
    ok("Ride: the player is on a bike within 10 s", d.ride.state === "driving", d.ride.state);
    key("KeyW", "keydown"); await wait(3500); const v = Math.abs(d.ride.v); key("KeyW", "keyup");
    ok("Ride: W accelerates (speed > 3 m/s after 3.5 s)", v > 3, v.toFixed(1));
    ok("Ride: the vehicle bar is a pill with a speed", shown(document.getElementById("ridepanel")) && document.getElementById("ridepanel").classList.contains("drive"));

    // fps over 3 s
    let frames = 0; const t0 = performance.now(); await new Promise(res => { const f = () => { frames++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : res(); }; f(); });
    const fps = frames / 3; ok("Performance: at least 12 fps while riding", fps >= 12, fps.toFixed(1));

    // crowd director
    const T = d.population.target();
    ok("Crowd: the population director returns a sane target", T.n >= 6 && T.n <= 140, JSON.stringify(T));

    // menu and missions
    d.ride.getOut(); await wait(2500);
    document.getElementById("gearbtn").click(); await wait(400);
    ok("Menu: opens from the gear and has a Keys tab", d.pause.isOpen && !!document.querySelector('#pause [data-tab="Keys"]'));
    document.getElementById("pause-resume").click(); await wait(300);
    ok("Menu: closes", !d.pause.isOpen);
    const chip = document.querySelector('#hud-stack [role="button"]') || [...document.querySelectorAll("#hud-stack > *")].find(e => /Missions/.test(e.textContent));
    chip?.click(); await wait(400);
    const rows = document.querySelectorAll("#mpanel .row").length;
    ok("Missions: the chip opens a short list (3 rows, not 21)", rows > 0 && rows <= 3, rows);
    d.missions.togglePanel(false);

    // errors
    const errs = (window.__events || []).filter(e => e.n === "error" || e.n === "system_error");
    ok("No errors were reported during the run", errs.length === 0, errs.map(e => e.msg).join(" | ").slice(0, 300));
  } catch (e) { ok("the test itself ran to the end", false, e?.stack || e); }
  const fail = out.filter(o => !o.pass);
  window.__selftest = { pass: fail.length === 0, results: out };
  console.log(`SELFTEST ${fail.length ? "FAIL" : "PASS"} (${out.length - fail.length}/${out.length})`, JSON.stringify(fail.length ? fail : out.map(o => o.name)));
  document.title = `${fail.length ? "FAIL" : "PASS"} ${document.title}`;
  return window.__selftest;
}
