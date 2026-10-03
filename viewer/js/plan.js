// Buying in the city: the only money in this game (product rule, 2026-10-03). Businesses book screens and banners,
// or take a whole building (its screens + shop signs, and its name on the map), into a plan, then check out.
//   Screens: duration (1 week .. 12 months), exclusive or in rotation (1 of 6 advertisers, 10 s every minute), start
//   date; the price follows the screen's indicative monthly rate with term discounts.
//   Buildings (business view: double-click / tap a building): what you get and an indicative monthly lease.
//   Checkout: company and contact details -> an order (number, items, total) saved in this browser, then either the
//   configured payment link (config/world.json checkout.payment_link, e.g. a Stripe Payment Link) or an invoice
//   request to sales (sales_contact). Prices are indicative until confirmed; nothing is charged in the game itself.
import { money, fmt } from "./business.js";

const KEY_PLAN = "ts.plan", KEY_ORDERS = "ts.orders";
const get = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const DURATIONS = [["1w", "1 week", 0.25], ["1m", "1 month", 1], ["3m", "3 months", 3], ["6m", "6 months", 6], ["12m", "12 months", 12]];
const DISCOUNT = { "1w": 1.15, "1m": 1, "3m": 0.95, "6m": 0.9, "12m": 0.85 };   // short = premium, long = cheaper
const SHARES = [["exclusive", "Exclusive (your ad only)", 1], ["rotation", "In rotation (1 of 6, 10 s per minute)", 0.22]];
const usd = n => "$" + Math.round(n).toLocaleString("en-US");
const day = d => d.toISOString().slice(0, 10);

export class Plan {
  // o: { business, nav, root, district, toast, setSlotImage }
  constructor(o) {
    Object.assign(this, o);
    this.items = get(KEY_PLAN);
    this.orders = get(KEY_ORDERS);
    this.props = [];
    fetch(`${o.root}data/${o.district}/properties.json`).then(r => r.json()).then(d => { this.props = d.properties; }).catch(() => {});
    this.buildDOM();
    this.hookSheet();
    this.sync();
  }

  // ---------------------------------------------------------------- DOM
  buildDOM() {
    const css = document.createElement("style");
    css.textContent = `
      #planbtn { position: fixed; top: calc(var(--s4) + 50px); right: var(--s4); z-index: 12; display: none; }   /* under "Exit business view" */
      body.biz #planbtn { display: inline-flex; gap: var(--s2); align-items: center; }
      #planbtn b { background: var(--accent); color: #000; border-radius: 10px; padding: 0 7px; font-size: var(--t-caption); }
      #sh-book { border: 1px solid var(--glass-border); border-radius: var(--r-control); padding: var(--s3); margin-bottom: var(--s3); }
      #sh-book label { display: block; font-size: var(--t-caption); color: var(--ink-3); margin: var(--s2) 0 4px; }
      #sh-book select, #sh-book input, .plan-f input, .plan-f select { width: 100%; box-sizing: border-box; }
      #sh-book .price { display: flex; justify-content: space-between; align-items: baseline; margin-top: var(--s3); }
      #sh-book .price b { font-size: var(--t-title); }
      .plan-panel { position: fixed; top: 116px; right: var(--s4); width: 400px; max-height: calc(100vh - 112px); overflow: auto; z-index: 36;
        padding: var(--s5); display: none; box-sizing: border-box; }
      .plan-panel h2 { font-size: var(--t-title); margin: 0 0 var(--s1); }
      .plan-panel .sub { color: var(--ink-2); font-size: var(--t-caption); margin: 0 0 var(--s4); }
      .plan-panel .it { display: flex; gap: var(--s3); align-items: flex-start; padding: var(--s3) 0; border-top: 1px solid var(--glass-border); }
      .plan-panel .it .nm { flex: 1; font-weight: var(--w-semibold); }
      .plan-panel .it small { display: block; color: var(--ink-3); font-weight: 400; }
      .plan-panel .tot { display: flex; justify-content: space-between; padding: var(--s3) 0; border-top: 1px solid var(--glass-border);
        font-weight: var(--w-bold); font-size: var(--t-headline); }
      .plan-panel .x { position: absolute; top: var(--s3); right: var(--s3); }
      .plan-f { display: flex; flex-direction: column; gap: var(--s2); }
      .plan-panel .fine { color: var(--ink-3); font-size: var(--t-caption); margin: var(--s3) 0 0; }
      .plan-panel .ok { text-align: center; padding: var(--s4) 0; }
      .plan-panel .ok b { display: block; font-size: var(--t-title); margin-bottom: var(--s2); }
      @media (max-width: 640px) { .plan-panel { top: auto; bottom: 0; left: 0; right: 0; width: auto; max-height: 80vh;
        border-radius: var(--r-surface) var(--r-surface) 0 0; } #planbtn { top: auto; bottom: 68px; right: var(--s4); } }`;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML("beforeend", `
      <button id="planbtn" class="ui-btn ui-surface" title="Your plan: screens and buildings you're booking">Your plan <b id="plancount">0</b></button>
      <aside id="planpanel" class="plan-panel ui-surface" aria-label="Your plan"></aside>
      <aside id="proppanel" class="plan-panel ui-surface" aria-label="Building"></aside>`);
    document.getElementById("planbtn").onclick = () => this.openPlan();
  }

  // the screen sheet: a booking box replaces the old "send a request" form
  hookSheet() {
    const cta = document.getElementById("sh-cta");
    cta.insertAdjacentHTML("beforebegin", `<div id="sh-book">
      <label for="bk-dur">How long</label><select id="bk-dur" class="ui-input">${DURATIONS.map(([k, t]) => `<option value="${k}"${k === "1m" ? " selected" : ""}>${t}</option>`).join("")}</select>
      <label for="bk-share">Screen time</label><select id="bk-share" class="ui-input">${SHARES.map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select>
      <label for="bk-start">Starts</label><input id="bk-start" type="date" class="ui-input">
      <div class="price"><span style="color:var(--ink-2)" id="bk-what"></span><b id="bk-price"></b></div></div>`);
    cta.textContent = "Add to plan";
    cta.onclick = () => this.addScreen();
    document.getElementById("sh-form").style.display = "none";
    const start = document.getElementById("bk-start");
    const min = new Date(Date.now() + 7 * 864e5);               // a week to get artwork approved and scheduled
    start.min = day(min); start.value = day(min);
    for (const id of ["bk-dur", "bk-share", "bk-start"]) document.getElementById(id).oninput = () => this.quote();
    const open = this.business.open.bind(this.business);
    this.business.open = id => { open(id); this.quote(); };
  }

  screenPrice(s, dur, share) {
    const months = DURATIONS.find(d => d[0] === dur)[2], f = SHARES.find(x => x[0] === share)[2];
    return s.price_month_usd * months * DISCOUNT[dur] * f;
  }
  quote() {
    const s = this.business.current;
    if (!s) return;
    const dur = document.getElementById("bk-dur").value, share = document.getElementById("bk-share").value;
    document.getElementById("bk-price").textContent = usd(this.screenPrice(s, dur, share));
    const months = DURATIONS.find(d => d[0] === dur)[2];
    const reach = s.daily_audience * months * 30 * SHARES.find(x => x[0] === share)[2];
    document.getElementById("bk-what").textContent = `~${fmt(Math.round(reach))} views (est.)`;
    const inPlan = this.items.some(i => i.id === s.slot_id);
    document.getElementById("sh-cta").textContent = inPlan ? "Update in plan" : "Add to plan";
  }

  addScreen() {
    const s = this.business.current;
    if (!s) return;
    const dur = document.getElementById("bk-dur").value, share = document.getElementById("bk-share").value;
    const item = { type: "screen", id: s.slot_id, name: s.title, dur, share, start: document.getElementById("bk-start").value,
      price: Math.round(this.screenPrice(s, dur, share)), audience: s.daily_audience };
    this.items = this.items.filter(i => i.id !== item.id).concat(item);
    this.save();
    this.toast?.(`Added to your plan: ${s.title}`);
    this.quote();
  }

  // ---------------------------------------------------------------- buildings
  // business view: tapping a building opens what it offers (nearest catalogue entry to the footprint's centre)
  onBuilding(b) {
    if (!this.business.on || !this.props.length) return false;
    let best = null, bd = 40;
    for (const p of this.props) {
      const d = Math.hypot(p.center[0] - b.x, p.center[1] - b.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return false;
    this.openProperty(best, b.name);
    return true;
  }
  propertyPrice(p) {
    const screens = p.hero_slots.reduce((a, id) => a + (this.business.sales?.get(id)?.price_month_usd || 0), 0);
    const signs = p.sign_slots.length * 1500;
    const name = (p.height_m || 30) * (p.tier === "hero" ? 160 : 60);   // your name on the building and the map
    return { screens, signs, name, total: Math.round(screens + signs + name) };
  }
  openProperty(p, fallbackName) {
    this.business.close?.();
    const name = p.display_name || fallbackName || "Building";
    const pr = this.propertyPrice(p), inPlan = this.items.some(i => i.id === p.property_id);
    const el = document.getElementById("proppanel");
    el.innerHTML = `<button class="ui-btn x" data-a="x" aria-label="Close">✕</button>
      <span class="ui-chip biz">${p.tier === "hero" ? "Times Square frontage" : "Midtown"}</span>
      <h2 style="margin-top:var(--s2)">${name}</h2><p class="sub">${Math.round(p.height_m || 0)} m tall${p.address ? " · " + p.address : ""}</p>
      ${p.hero_slots.length ? `<div class="it"><span class="nm">${p.hero_slots.length} screen${p.hero_slots.length === 1 ? "" : "s"}<small>Every screen on the building carries your brand</small></span><span>${usd(pr.screens)}</span></div>` : ""}
      ${p.sign_slots.length ? `<div class="it"><span class="nm">${p.sign_slots.length} shop sign${p.sign_slots.length === 1 ? "" : "s"}<small>The storefront signs at street level</small></span><span>${usd(pr.signs)}</span></div>` : ""}
      <div class="it"><span class="nm">Your name on the building<small>On the map, in search, on its card</small></span><span>${usd(pr.name)}</span></div>
      <div class="tot"><span>Per month (indicative)</span><span>${usd(pr.total)}</span></div>
      <label class="fine" for="pp-dur" style="display:block">Lease</label>
      <select id="pp-dur" class="ui-input" style="width:100%">${DURATIONS.slice(1).map(([k, t]) => `<option value="${k}"${k === "12m" ? " selected" : ""}>${t}</option>`).join("")}</select>
      <button class="ui-btn primary" data-a="add" style="width:100%;margin-top:var(--s3)">${inPlan ? "Update in plan" : "Add building to plan"}</button>
      <p class="fine">Prices are estimates; final terms are confirmed by our team before anything is charged.</p>`;
    el.style.display = "block";
    el.querySelector('[data-a="x"]').onclick = () => { el.style.display = "none"; };
    el.querySelector('[data-a="add"]').onclick = () => {
      const dur = el.querySelector("#pp-dur").value, months = DURATIONS.find(d => d[0] === dur)[2];
      const own = new Set([...p.hero_slots, ...p.sign_slots]);  // its screens come with it: not twice in the plan
      this.items = this.items.filter(i => i.id !== p.property_id && !own.has(i.id)).concat({ type: "building", id: p.property_id, name, dur, start: day(new Date(Date.now() + 14 * 864e5)),
        price: Math.round(pr.total * months * DISCOUNT[dur]), audience: p.hero_slots.reduce((a, id) => a + (this.business.sales?.get(id)?.daily_audience || 0), 0) });
      this.save(); this.toast?.(`Added to your plan: ${name}`);
      el.style.display = "none";
    };
  }

  // ---------------------------------------------------------------- the plan and checkout
  save() { put(KEY_PLAN, this.items); this.sync(); }
  sync() { document.getElementById("plancount").textContent = this.items.length; if (document.getElementById("planpanel").style.display === "block") this.openPlan(); }
  total() { return this.items.reduce((a, i) => a + i.price, 0); }

  openPlan() {
    const el = document.getElementById("planpanel"), dur = k => DURATIONS.find(d => d[0] === k)?.[1] || k;
    el.innerHTML = `<button class="ui-btn x" data-a="x" aria-label="Close">✕</button><h2>Your plan</h2>
      <p class="sub">${this.items.length ? `${this.items.length} item${this.items.length > 1 ? "s" : ""} · ~${fmt(this.items.reduce((a, i) => a + (i.audience || 0), 0))} people pass them daily` : "Add screens (tap a highlighted screen) or buildings (double-click one) in the business view."}</p>
      ${this.items.map((i, k) => `<div class="it"><span class="nm">${i.name}<small>${i.type === "building" ? "Building lease" : (i.share === "rotation" ? "In rotation" : "Exclusive")} · ${dur(i.dur)} from ${i.start}</small></span>
        <span>${usd(i.price)}<br><button class="ui-btn" data-rm="${k}" style="min-height:26px;font-size:var(--t-caption);margin-top:4px">Remove</button></span></div>`).join("")}
      ${this.items.length ? `<div class="tot"><span>Total (indicative)</span><span>${usd(this.total())}</span></div>
        <form class="plan-f" id="planform" autocomplete="on">
          <input class="ui-input" name="company" placeholder="Company" required aria-label="Company">
          <input class="ui-input" name="name" placeholder="Your name" required aria-label="Your name">
          <input class="ui-input" name="email" type="email" placeholder="Work email" required aria-label="Work email">
          <input class="ui-input" name="website" placeholder="Website (for your logo)" aria-label="Website">
          <button class="ui-btn primary" type="submit">${this.paymentLink ? "Continue to payment" : "Place order (invoice)"}</button></form>
        <p class="fine">${this.paymentLink ? "You'll pay securely on the next page." : "Our team confirms availability and sends an invoice within one business day. Nothing is charged until you approve it."}</p>` : ""}
      ${this.orders.length ? `<h2 style="font-size:var(--t-headline);margin-top:var(--s4)">Your orders</h2>${this.orders.slice().reverse().map(o =>
        `<div class="it"><span class="nm">${o.id}<small>${o.items.length} item${o.items.length > 1 ? "s" : ""} · ${o.date} · ${o.status}</small></span><span>${usd(o.total)}</span></div>`).join("")}` : ""}`;
    el.style.display = "block";
    el.querySelector('[data-a="x"]').onclick = () => { el.style.display = "none"; };
    el.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { this.items.splice(+b.dataset.rm, 1); this.save(); });
    const f = el.querySelector("#planform");
    if (f) f.onsubmit = e => { e.preventDefault(); this.checkout(new FormData(f)); };
  }

  checkout(form) {
    const id = "TS-" + Date.now().toString(36).toUpperCase().slice(-6);
    const order = { id, date: day(new Date()), status: this.paymentLink ? "awaiting payment" : "requested", total: this.total(), items: this.items,
      company: form.get("company"), name: form.get("name"), email: form.get("email"), website: form.get("website") };
    this.orders.push(order); put(KEY_ORDERS, this.orders);
    const lines = [`Order ${id}`, `Company: ${order.company}`, `Contact: ${order.name} <${order.email}>`, `Website: ${order.website || "-"}`, "",
      ...order.items.map(i => `- ${i.name} (${i.type === "building" ? "building lease" : i.share}, ${i.dur} from ${i.start}): ${usd(i.price)}`),
      "", `Total (indicative): ${usd(order.total)}`];
    if (this.paymentLink) {
      const u = new URL(this.paymentLink);
      u.searchParams.set("client_reference_id", id);
      if (order.email) u.searchParams.set("prefilled_email", order.email);
      window.open(u.toString(), "_blank", "noopener");
    } else if (this.salesContact) {
      location.href = `mailto:${this.salesContact}?subject=${encodeURIComponent(`Order ${id}: ${order.company}`)}&body=${encodeURIComponent(lines.join("\n"))}`;
    }
    this.items = []; put(KEY_PLAN, this.items); document.getElementById("plancount").textContent = 0;
    const el = document.getElementById("planpanel");
    el.innerHTML = `<button class="ui-btn x" data-a="x" aria-label="Close">✕</button><div class="ok"><b>Order ${id} placed</b>
      <span style="color:var(--ink-2)">${this.paymentLink ? "Finish payment in the new tab. " : this.salesContact ? "Your email app opened with the order for our sales team. " : "It's saved under Your orders. "}We confirm availability and artwork within one business day.</span></div>`;
    el.querySelector('[data-a="x"]').onclick = () => { el.style.display = "none"; };
  }
}
