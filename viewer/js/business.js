// Two audiences, two experiences.
//   Visitors: a clean city. Tapping a billboard shows a quiet "available for your brand" prompt.
//   Businesses ("For businesses"): available screens glow, and each opens a sales sheet with a live preview of
//   their own logo on the real screen, audience, an indicative price, artwork spec and one action: Put your brand here.
import * as THREE from "three";
import { ICON } from "./icons.js";

export const fmt = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`;
export const money = n => n >= 1000 ? `$${(n / 1000).toFixed(n >= 1e5 ? 0 : 1)}K` : `$${n}`;

export class Business {
  constructor({ root, district, nav, setSlotImage, slotMeshes, setDemo, salesContact, camera, ask }) {
    Object.assign(this, { root, district, nav, setSlotImage, slotMeshes, setDemo, salesContact, camera, ask });
    addEventListener("resize", () => this.offsetView());
    this.on = false;
    this.current = null;
    this.outlines = [];
    this.buildDOM();
    fetch(`${root}export/${district}/slot_sales.json`).then(r => r.json()).then(d => {
      this.sales = new Map(d.slots.map(s => [s.slot_id, s]));
      this.note = d.pricing_note;
    });
  }

  buildDOM() {
    const css = document.createElement("style");
    css.textContent = `
      #bizbtn { position: fixed; top: var(--s4); right: var(--s4); z-index: 12; }
      #bizbtn { display: none; }                                  /* visitors never see it; business view shows "Exit" */
      body.biz #bizbtn { display: inline-flex; align-items: center; background: var(--biz); color: var(--biz-ink); }
      #sheet { position: fixed; top: 116px; right: var(--s4); width: 380px; max-height: calc(100vh - 148px); overflow: auto;
        z-index: 35; padding: var(--s5); display: none; }
      #sheet .grab { display: none; position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 96px; height: 22px; border: none;
        background: none; cursor: pointer; padding: 0; }
      #sheet .grab::after { content: ""; display: block; width: 36px; height: 5px; margin: 8px auto 0; border-radius: 3px; background: var(--ink-3); }
      #sheet .eyebrow { display: flex; gap: var(--s2); margin-bottom: var(--s3); }
      #sheet h2 { font-size: var(--t-title); font-weight: var(--w-bold); margin: 0 0 var(--s1); line-height: 1.2; }
      #sheet .sub { color: var(--ink-2); font-size: var(--t-body); margin: 0 0 var(--s4); }
      #sheet .stats { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s2); margin-bottom: var(--s4); }
      #sheet .stat { background: var(--fill); border-radius: var(--r-control); padding: var(--s3); }
      #sheet .stat b { display: block; font-size: var(--t-large); font-weight: var(--w-bold); line-height: 1.1; }
      #sheet .stat span { color: var(--ink-3); font-size: var(--t-caption); }
      #sheet .try { border: 1px dashed var(--glass-border); border-radius: var(--r-control); padding: var(--s3); margin-bottom: var(--s4); }
      #sheet .try p { margin: 0 0 var(--s2); color: var(--ink-2); font-size: var(--t-caption); }
      #sheet .row { display: flex; gap: var(--s2); }
      #sheet .row > * { flex: 1; }
      #sheet .close { position: absolute; top: var(--s3); right: var(--s3); width: 36px; min-height: 36px; padding: 0; border-radius: 18px; display: grid; place-items: center; }
      #sheet details { margin-top: var(--s4); color: var(--ink-3); font-size: var(--t-caption); }
      #sheet details dl { display: grid; grid-template-columns: 110px 1fr; gap: var(--s1) var(--s2); margin: var(--s2) 0 0; }
      #sheet details dd { margin: 0; color: var(--ink-2); word-break: break-all; }
      #sheet .cta { width: 100%; margin-top: var(--s2); font-size: var(--t-headline); }
      #sheet .fine { color: var(--ink-3); font-size: var(--t-caption); margin: var(--s2) 0 0; text-align: center; }
      #sheet form { display: none; flex-direction: column; gap: var(--s2); margin-top: var(--s2); }
      #sheet form.open { display: flex; }
      #sheet .done { display: none; text-align: center; padding: var(--s4) 0; }
      #toast { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); z-index: 35; display: none; align-items: center;
        gap: var(--s3); padding: var(--s2) var(--s2) var(--s2) var(--s4); font-size: var(--t-body); }
      @media (max-width: 640px) {
        /* Apple Maps-style bottom sheet: opens at half height so the screen stays visible above it; tap the grabber or scroll for more */
        #sheet { top: auto; bottom: 0; right: 0; left: 0; width: auto; max-height: 44vh; border-radius: var(--r-surface) var(--r-surface) 0 0;
          padding-top: var(--s5); transition: max-height .25s ease; overscroll-behavior: contain; }
        #sheet.full { max-height: 86vh; }
        #sheet .grab { display: block; }
        #bizbtn { top: auto; bottom: var(--s4); right: 120px; }
      }`;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML("beforeend", `
      <button id="bizbtn" class="ui-btn ui-surface" title="See and book screens for your brand">For businesses</button>
      <div id="toast" class="ui-surface"><span>This screen can carry your brand.</span>
        <button class="ui-btn primary" id="toastgo">See details</button><button class="ui-btn" id="toastx" aria-label="Dismiss">${ICON.close}</button></div>
      <aside id="sheet" class="ui-surface" aria-label="Screen details"><button class="grab" aria-label="Show more details"></button>
        <button class="ui-btn close" id="sheetx" aria-label="Close">${ICON.close}</button>
        <div class="eyebrow"><span class="ui-chip good" id="sh-status">Available</span><span class="ui-chip biz" id="sh-band"></span></div>
        <h2 id="sh-title"></h2><p class="sub" id="sh-sub"></p>
        <div class="stats">
          <div class="stat"><b id="sh-aud"></b><span>people pass daily (est.)</span></div>
          <div class="stat"><b id="sh-price"></b><span>per month (indicative)</span></div>
        </div>
        <div class="try"><p>See your brand on this screen: upload a logo, artwork or a short video.</p>
          <div class="row"><button class="ui-btn" id="sh-upload">Upload…</button><button class="ui-btn" id="sh-reset">Reset</button></div>
          <input type="file" id="sh-file" accept="image/*,video/mp4,video/webm" hidden></div>
        <button class="ui-btn primary cta" id="sh-cta">Put your brand here</button>
        <form id="sh-form" autocomplete="on">
          <input class="ui-input" name="company" placeholder="Company" required aria-label="Company">
          <input class="ui-input" name="website" placeholder="Website (for your logo)" aria-label="Website">
          <input class="ui-input" name="email" type="email" placeholder="Work email" required aria-label="Work email">
          <button class="ui-btn primary" type="submit">Send request</button>
        </form>
        <div class="done" id="sh-done"><b>Request ready.</b><br><span style="color:var(--ink-2)">Your email app opened with the details. Our team replies within one business day.</span></div>
        <p class="fine" id="sh-fine"></p>
        <details><summary>Artwork & technical details</summary><dl id="sh-tech"></dl></details>
      </aside>`);
    const $ = id => document.getElementById(id);
    this.$ = $;
    $("bizbtn").onclick = () => this.setMode(!this.on);
    $("sheetx").onclick = () => this.close();
    $("toastx").onclick = () => { $("toast").style.display = "none"; };
    $("toastgo").onclick = () => { $("toast").style.display = "none"; this.setMode(true); this.open(this.pending); };
    $("sh-upload").onclick = () => $("sh-file").click();
    $("sh-file").onchange = e => {
      const f = e.target.files[0];
      if (f && this.current) { this.setSlotImage(this.current.slot_id, URL.createObjectURL(f) + (f.type.startsWith("video") ? "#video" : "")); this.frame(this.current); }
    };
    $("sh-reset").onclick = () => this.current && this.setSlotImage(this.current.slot_id, null, true);
    $("sh-cta").onclick = () => { $("sh-form").classList.add("open"); $("sh-cta").style.display = "none"; $("sh-form").company.focus(); };
    $("sh-form").onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.target), s = this.current;
      const body = [`Screen: ${s.title} (${s.slot_id})`, `Size: ${s.size}, faces ${s.faces}`,
        `Indicative: ${money(s.price_month_usd)}/month, ~${fmt(s.daily_audience)} people/day`, "",
        `Company: ${f.get("company")}`, `Website: ${f.get("website")}`, `Email: ${f.get("email")}`].join("\n");
      location.href = `mailto:${this.salesContact}?subject=${encodeURIComponent("Screen request: " + s.title)}&body=${encodeURIComponent(body)}`;
      e.target.classList.remove("open"); $("sh-done").style.display = "block";
    };
    const sheet = $("sheet");
    sheet.querySelector(".grab").onclick = () => { sheet.classList.toggle("full"); setTimeout(() => this.offsetView(), 260); };
    sheet.addEventListener("scroll", () => { if (sheet.scrollTop > 24 && !sheet.classList.contains("full")) sheet.classList.add("full"); });
    addEventListener("keydown", e => { if (e.key === "Escape" && this.current && e.target.tagName !== "INPUT") this.close(); });
  }

  // ---------------------------------------------------------------- modes
  setMode(on) {
    this.on = on;
    this.$("bizbtn").classList.toggle("on", on);
    document.body.classList.toggle("biz", on);
    this.$("bizbtn").textContent = on ? "Exit business view" : "For businesses";
    this.nav.showAds = on;                       // search includes ad spots; minimap/map show slot dots
    if (!this.outlines.length) this.makeOutlines();
    for (const o of this.outlines) o.visible = on;
    if (!on) this.close();
    else this.nav.tip?.("biz", "Tap any highlighted screen, here or on the map, to see it and its price");
  }

  refreshOutlines() { if (this.outlines.length) { this.makeOutlines(); for (const o of this.outlines) o.visible = this.on; } }

  makeOutlines() {                                 // glowing frame around every sellable screen (idempotent)
    const mat = this.outlineMat || new THREE.LineBasicMaterial({ color: 0x64d2ff, transparent: true, opacity: 0.9, depthTest: true });
    this.outlineMat = mat;
    this.outlined ??= new Set();
    for (const m of this.slotMeshes()) {
      if (this.outlined.has(m)) continue;
      this.outlined.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), mat);
      e.visible = false; e.renderOrder = 5;
      m.add(e);
      this.outlines.push(e);
    }
  }

  update(t) { if (this.on && this.outlineMat) this.outlineMat.opacity = 0.45 + 0.45 * Math.sin(t * 3); }

  // ---------------------------------------------------------------- tapping a screen
  onScreen(slotId) {
    if (!this.sales?.has(slotId)) return;
    if (this.on) return this.open(slotId);
    this.pending = slotId;                         // visitors: a quiet prompt, never a data table
    if (this.ask) return this.ask("This screen can carry your brand.", [["See details", () => { this.setMode(true); this.open(slotId); }, true]],
      { ms: 6000, key: "screen" });
    this.$("toast").style.display = "flex";
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { this.$("toast").style.display = "none"; }, 6000);
  }

  open(slotId) {
    const s = this.sales.get(slotId);
    if (!s) return;
    const $ = this.$;
    this.current = s;
    $("sh-status").textContent = s.status === "available" ? "Available" : "Booked";
    $("sh-band").textContent = s.band;
    $("sh-title").textContent = s.title;
    $("sh-sub").textContent = `${s.size} · faces ${s.faces} · ${s.height_above_street_m} m above the street`;
    $("sh-aud").textContent = fmt(s.daily_audience);
    $("sh-price").textContent = money(s.price_month_usd);
    $("sh-fine").textContent = `Best for ${s.best_for}. Prices are estimates; final pricing confirmed by our team.`;
    $("sh-tech").innerHTML = [["Artwork", `${s.artwork.px[0]} × ${s.artwork.px[1]} px (${s.artwork.aspect})`],
      ["Formats", s.artwork.formats.join(", ")], ["Screen type", s.kind], ["Slot ID", s.slot_id]]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    $("sh-form").classList.remove("open"); $("sh-cta").style.display = ""; $("sh-done").style.display = "none";
    $("sheet").classList.remove("full"); $("sheet").scrollTop = 0;
    $("sheet").style.display = "block";
    this.offsetView();
    this.frame(s);
  }

  frame(s) {                                         // a clear, computed view of the screen (falls back to the exported one)
    const v = this.viewFor?.(s.slot_id) || s.view;
    if (v) this.nav.flyTo({ ...v, name: s.title, kind: "ad" }, { duration: 1.4 });
  }

  close() { this.current = null; this.$("sheet").style.display = "none"; this.offsetView(); }

  // keep the framed screen in the uncovered part of the view (side sheet on desktop, bottom sheet on phones)
  offsetView() {
    const cam = this.camera, W = innerWidth, H = innerHeight, sh = this.$("sheet");
    if (!this.current) { cam.clearViewOffset(); return; }
    if (W > 640) cam.setViewOffset(W, H, (sh.offsetWidth + 16) / 2, 0, W, H);
    else cam.setViewOffset(W, H, 0, Math.min(sh.offsetHeight, H * 0.72) / 2, W, H);
  }
}
