# Tours and buying

## Sightseeing tours (`viewer/js/tours.js`)

Open them from the menu: **Sightseeing tours** (top-left menu, or the pause menu).

| Tour | Mode | Gates | Par |
|---|---|---|---|
| Times Square on foot | walk / run | TKTS red steps → Father Duffy → 750 Seventh Ave → Marriott Marquis → Paramount Building → One Times Square | 8:50 |
| Midtown waterfront by boat | the Hudson Sightseer | USS Intrepid → cruise terminal (piers 88/90) → the Hudson off W 38th → tie up at Pier 83 | 12:31 |
| Hudson & Liberty by air | the Cessna | Hudson River Park → One WTC → Ellis Island → Statue of Liberty → back up the Hudson → land on the Intrepid | 9:10 |

**How a tour plays:**
- **Gates:** glowing rings in the sky, or beacons on the water and the street. The current gate is bright, the next one faint, and the route shows on the minimap.
- **Facts:** each gate shows a short, true fact about the landmark.
- **The clock:** starts when you get going.
- **Stars:** under par is 3★, within 30% of par is 2★, otherwise 1★. Your best time is saved in this browser.
- **Endings:**
  - a crash, or leaving the plane or the helm, ends the tour;
  - the air tour only finishes on a real landing roll;
  - the boat tour finishes when you tie up.

No money: rewards are times and stars.

## Buying screens and buildings (`viewer/js/plan.js`)

This is the only money in the game. It all happens in the business view (menu: **For businesses**).

**Screens and banners:** tap a highlighted screen.
- Choose:
  - **How long:** 1 week to 12 months. 1 week costs 1.15× the pro-rata rate; 3, 6 and 12 months are 5%, 10% and 15% off.
  - **Screen time:** exclusive, or in rotation (1 of 6 advertisers, 10 s every minute, 0.22× the price).
  - **Start date:** a week out at the earliest, for artwork approval.
- The price and estimated views update live. Then **Add to plan**.

**Buildings:** double-click (tap) a building.
- You see what you'd get: its screens (their rates), its shop signs ($1,500 a month each) and your name on the building, the map and search (height × $160 a month on Times Square, × $60 elsewhere).
- Choose a lease of 1 to 12 months.
- The building's own screens and signs are removed from the plan if you'd added them separately.
- The catalogue is `data/times_square/properties.json` (927 buildings).

**Your plan** (under "Exit business view"):
- The items, total, daily audience and a checkout form.
- **Placing an order:**
  - It creates an order number (`TS-xxxxxx`) saved under **Your orders**.
  - Then either:
    - `config/world.json` → `checkout.payment_link` (e.g. a Stripe Payment Link) opens with `client_reference_id` = the order number;
    - or, without a link, the order is emailed to `sales_contact` for an invoice.
- Prices are indicative and confirmed by the team before anything is charged.

**Before going live:**
- Set the real `sales_contact`.
- Optionally set a `checkout.payment_link`.
- Real-time availability and confirmed orders need a small server. Today orders live in the buyer's browser and in the sales email.
