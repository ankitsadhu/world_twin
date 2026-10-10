# Pricing and revenue: what we actually have to sell

> **2026-10-10 decision: slots are sold for 1 YEAR only (single payment, no refunds, exclusive, renewal offered to the holder). Everything below that says "permanent" is superseded; the §10 launch prices are NOT yet confirmed as 1-year prices.**
>
> **Launch plan: start at §10.** The prices in §2–§6 are the **target** prices, where an item ends up once demand is proven. We launch far lower and let the algorithm in §10 raise prices as things sell.

Updated 2026-10-04. The facts this is built on:
- **A sale is permanent.** The buyer owns the location forever (one payment).
- **The inventory is small and limited.** We sell banners, screens, billboards and important buildings, not every shop sign.
- **The site is new**: no traffic yet, and the domain is coming soon.

Every money figure is an **estimate**. Inventory comes from `export/times_square/slot_sales.json` and `data/times_square/properties.json`. Landing-view visibility was measured in the game: from the landing camera, a ray is cast to 9 points on every screen. The comparable is a 2D digital-twin world with unlimited plots (real data, Aug 27 – Oct 3, 2026).

Money rule (memory): the only things anyone pays for are banners, screens and buildings. There's no wallet, in-game earnings or inventory.

## 1. The inventory: 249 things, ever

| Group | Count | What it is |
|---|---|---|
| **A. Moving and landmark banners** | **2** today (+3 to build) | Plane banner over the Hudson, Hudson sightseeing boat banners; to build: Statue of Liberty banners (§2) |
| **B. Landing-view screens** | **27** | The screens every visitor sees first, at the top of the red steps (§3) |
| **C. Other Times Square screens** | **83** | The rest of the 110 boards: 1 Landmark, 4 Premium, 46 Standard, 32 Value |
| **D. Important buildings** | **137** | Named landmark buildings: 74 on the Times Square frontage, 63 in Midtown |
| **Total** | **249** (+3) | Each sold once, permanently |

Storefront signs (15,478 on the map) are **not** for sale. Neither are unnamed buildings.

## 2. Group A: the highest value (unique, they move, they're everywhere)

These go past landmarks, appear in the tours, and are seen from all over the game. Each is one of a kind.

| Banner | Status | Where it's seen | Sale |
|---|---|---|---|
| **Plane banner**: 30 × 7.5 m tow over the Hudson (`sky.hudson.banner`) | Exists | From the river, the Intrepid, the West Side, the air tour | **Auction, reserve $5,000** |
| **Sightseeing boat banners**: 2 × 9.6 m railing banners (`boat.hudson.side`) | Exists | Pier 83, the Hudson, the boat tour, the Statue of Liberty run | **Auction, reserve $3,000** |
| **Statue of Liberty ferry banner** | To build | Liberty Island, the harbour, the air and boat tours | Auction, reserve $4,000 |
| **Liberty loop plane banner**: a second tow circling the Statue | To build | Every visitor who goes to Liberty | Auction, reserve $5,000 |
| **Intrepid flight-deck banner** | To build | Every flight: take-off and landing | Auction, reserve $3,000 |

They're auctioned because there's only one of each, so the market should set the price.

## 3. Group B: the landing view (the first thing every visitor sees)

The site opens at the top of the TKTS red steps, looking at One Times Square. Measured from that camera:

| Visible on landing | Slots | Price (permanent) |
|---|---|---|
| **Fully visible (100%)** | 1540 Broadway main billboard (44 × 24.8 m); Nasdaq rooftop sign 1; One Times Square ad04, ad05, ad08 | **$2,999 each** (5) |
| **Mostly visible (44–78%)** | Marriott Marquis wraparound (125.7 × 24 m); One Times Square ad01, ad02, ad03, ad06, ad07, ad09, **ad10 (Landmark)**; 7th Ave & 43rd blade; 7th Ave & 44th up03, up04; 1540 Broadway wrap02 | **$1,499 each** (12) |
| **Partly visible (11–33%)** | 3 Times Square wraparound (Landmark); One Astor Plaza wraparound; 1540 Broadway wrap01; 7th Ave & 44th wrap01, wrap02, up12; 7th Ave & 46th wrap01; Nasdaq rooftop sign 2; One Times Square ad12, ad13 | **$799 each** (10) |

The landing view is the website's front page. Every visit sees it, so these are the best-value screens after Group A. If demand is strong, the 5 fully visible ones could also go to auction at launch.

## 4. Groups C and D

| Item | Count | Price (permanent) |
|---|---|---|
| Other screens, Landmark | 1 | $1,499 |
| Other screens, Premium | 4 | $999 |
| Other screens, Standard | 46 | $399 |
| Other screens, Value | 32 | $199 |
| **Frontage buildings** (named, e.g. One Times Square, 4 Times Square/Nasdaq, Marriott Marquis, Paramount) | 74 | $999 + $10/m of height, max $3,999 (avg ≈ $1,636) |
| **Midtown buildings** (named, e.g. RCA Building, New York Times Building, Worldwide Plaza) | 63 | $499 + $4/m of height, max $1,499 (avg ≈ $799) |

A building gives you your name on it and on the map, permanently. Its screens are sold separately, so a building buyer can also buy the screens on it.

## 5. What it all adds up to

| Group | Sold out (at asking / reserve) |
|---|---|
| A. Banners today (plane + boat) | $8,000 + whatever the auctions add |
| A. Banners to build (Liberty ferry, Liberty plane, Intrepid deck) | $12,000 + auction upside |
| B. Landing view (27) | $40,973 |
| C. Other screens (83) | $30,217 |
| D. Important buildings (137) | $171,402 |
| **Total, everything sold** | **≈ $250,600 today, ≈ $262,600 with the 3 new banners**, before any auction premium |

The comparable made $33.9k in its first 38 days selling unlimited $22 plots. We have **249 items at an average of about $1,000**: fewer buyers, each paying more. That's the opposite model, and it depends on people valuing scarcity, real Times Square, and being seen.

## 6. Year one (new site, no audience yet)

| Scenario | What sells | Year 1 |
|---|---|---|
| **Conservative** | The 2 existing banners at reserve; 40% of landing screens; 15% of other screens; 10% of buildings | **≈ $46k** |
| **Base** | All 5 banners at reserve; 75% of landing; 40% of other screens; 30% of buildings | **≈ $114k** |
| **Upside** | Everything sold; Group A auctions at 2× reserve | **≈ $290k** |

**Planning range for year one: ≈ $50k–$115k.** The lifetime ceiling is ≈ $260k plus auction premiums, unless we add new inventory.

## 7. How to raise the ceiling (your decisions)

Because sales are permanent and the inventory is small, more income only comes from more things worth owning:
1. **More moving and landmark banners.** They're the highest value per item, and each one is a small build:
   - the Liberty ferry, the Liberty plane loop and the Intrepid deck;
   - later, maybe a blimp, a tour helicopter, or the Staten Island Ferry.
2. **Make more of the inventory visible on landing.** Rotating the landing camera, or a short intro flyover, would put more screens "on the front page" and raise their value.
3. **New districts**: each one a new limited release, for example Wall Street or the Brooklyn Bridge. This works with the capped game area: districts get added deliberately.
4. **Resale between owners with a fee** (for example 10%). It's a later feature, and it needs terms and payouts.

## 8. Before launch

- **Domain**, then Stripe payment links on it (`checkout.payment_link` in `config/world.json`). Set the no-cache headers.
- **Real sales inbox** (`sales_contact` is still the sales@example.com placeholder). It's needed for the auctions.
- **Visibly sold:** a sold item shows "Owned by …" in the world and on the map, and can never be bought again.
- **Terms:**
  - what "permanent" means (for example "for the life of the service");
  - content rules;
  - artwork is reviewed before it goes live, and owners can change their artwork later.
- **Launch moment:** the comparable peaked 2–3 weeks after launch. Run the Group A auctions in that window.

## 9. Product changes (not built yet)

`viewer/js/plan.js` currently sells **rentals** (1 week – 12 months, rotation) at **real-world media rates**: $2.4M a month for the screens. It needs to become one-time permanent purchases at the prices above:
- one price per item;
- auctions for Group A;
- a "landing view" label on Group B;
- owner records;
- artwork review.

The real-world rate can stay as a "real value" label next to our price.

---

## 10. Launch strategy (go-live next week)

**There's no proof yet that people will pay. So:**
1. launch cheap;
2. sell in **parts** (small batches);
3. let an **algorithm** raise prices as each part sells;
4. keep the best items locked until there are visitor numbers to show.

A cheap sale is permanent, so only the less important items are sold cheaply.

### 10.1 What's on sale in Part 1 (40 items)

| # | Items | Count | Launch price |
|---|---|---|---|
| 1 | Value screens (lowest score): Lyceum Theatre blade, Lunt-Fontanne Theatre wraparound, 7th Ave & 48th St billboards and wraparounds, 7th Ave & 43rd/44th St small wraparounds | 10 | **$29–$39** |
| 2 | Standard screens (lowest score): One Astor Plaza rooftop sign, Morgan Stanley Building billboard, DoubleTree billboard, 750 Seventh Ave ribbons (rib1, rib3), 7th Ave & 43rd billboards (up06, up10), 7th Ave & 46th wraparound, Embassy Theatre billboard, 7th Ave & 49th corner storefront screen | 10 | **$59–$69** |
| 3 | Landing view, *partly visible*: 7th Ave & 44th up12, wrap01, wrap02; 7th Ave & 46th wrap01; One Times Square ad13 (the thin wraparound ribbon) | 5 | **$89–$109** |
| 4 | Broadway theatres (frontage): Broadhurst, Shubert, Ethel Barrymore, Saint James, Big Apple Hostel | 5 | **$149–$159** |
| 5 | Named Midtown buildings: British Empire Building, Harvard Club, Royalton Hotel, Iroquois Hotel, Emerson Building, Algonquin Hotel, Mansfield Hotel, Fifth Avenue Tower, Paragon Building, Princeton Club | 10 | **$59–$69** (by height) |
| | **Part 1 total** | **40** | **≈ $2,900 if it sells out** (plus the in-part price steps) |

**Locked until later parts:**
- the 5 fully visible landing screens;
- the Marriott Marquis wraparound and the rest of One Times Square;
- the 3 Times Square and Astor Plaza Landmark wraparounds;
- famous buildings: One Times Square, 4 Times Square (Nasdaq), Bank of America Tower, Paramount, New York Public Library, RCA Building, New York Times Building;
- **the plane and boat banners** (and the Liberty banners when they're built).

**Exact item IDs:** to be generated into `data/times_square/launch_parts.json` by the algorithm script, using the selection rule in 10.2.

### 10.2 The price algorithm (spec to implement)

Every item has a **launch price `L`** and a **target price `T`**. `T` is the §3–§4 price; for auctions, the reserve.

Launch price, rounded **up** to the next "9" ending ($29, $39 … $99, $109 … $149, $159 …). The weakest item in a group pays exactly `Base`; better ones pay up to about 2×:
```
L(item) = round9up(Base[group] × w(item))
Base: screen Value $29 · Standard $59 · Premium $149 · Landmark $299
      landing-view screen $79 · building Midtown $49 · building frontage $149
w(screen)   = (1 + 0.6 × (score − band_min) / (band_max − band_min)) × (1 + landing_visibility)
              landing_visibility ∈ [0, 1], measured in-game; 0 off the landing view
w(building) = 1 + clamp((height_m − 20) / 100, 0, 1)            1.0 (20 m and below) … 2.0 (120 m and above)
```

Current price, while an item is on sale:
```
price(item) = min(T, L × G(part) × S(sold_in_part))
S(n) = 1 + 0.03 × n, capped at 1.30       each sale in the same part adds 3% → urgency ("next price in 2 sales")
G(1) = 1
G(k+1) = G(k) × m, where m depends on how fast part k sold out:
           sold out ≤ 7 days  → m = 1.6
           ≤ 14 days          → m = 1.4
           ≤ 30 days          → m = 1.2
           > 30 days          → m = 1.0 (hold; the next part opens only when this one is ≥ 80% sold)
```

Rules:
- **A price never goes down.** Early buyers must never see their location sold cheaper later. If things don't sell, the price holds and the next part waits.
- **Show the next price.** The item card shows the price now, the "next price $X in N sales", and "N left in Part 1".
- **When a part opens:** Part k+1 opens when Part k is ≥ 80% sold, **or** 21 days have passed *and* the visitor gate for that part is met (10.4).
- **Who goes first:** the picker fills each part with the lowest-`w` unsold items first, keeping the high-`w` ones for later parts. Part 1 above is its output.
- **Auctions** (plane banner, boat banner, Liberty banners, landing hero screens): open bidding for 7 days, starting at `max(L × G, $199)`, with a soft close (a bid in the last hour extends it by an hour). The reserve rises with `G`, the same as fixed prices.

### 10.3 The parts, in order

| Part | When | What | Price level |
|---|---|---|---|
| **1** | Launch week | The 40 items in 10.1 | Launch prices (`G = 1`) |
| **2** | Part 1 ≥ 80% sold | ~40 more: other Standard and Premium screens, landing *mostly visible* (One Times Square ad01–ad10, 7th Ave & 44th up03/up04, blade13), more named buildings | × `m` from Part 1's speed |
| **3** | Part 2 ≥ 80% sold **and** visitor gate B | The 5 fully visible landing screens, the Marriott Marquis wraparound, Landmark screens, the famous frontage buildings | Higher; the hero 5 can go to auction |
| **4** | The New Year's Eve event (Dec 31) | **Plane banner, boat banner**, the Liberty banners (if built), the remaining famous buildings | **Auctions** |

### 10.4 Do we show visitor numbers? When?

**We track from day 1, but only show numbers once they help us.** Small numbers on the screen hurt sales: "12 visitors" makes a $99 billboard look worthless.

| From | What buyers see | Gate |
|---|---|---|
| **Day 1** | Scarcity and activity only: "Owned by …", "7 of 40 left in Part 1", "last sold 3 h ago", "next price $X in N sales" | None. It's always true, even with low traffic. |
| **Gate A** | Site-wide: "**X visitors this week**" | ≥ 1,000 unique visitors in the last 7 days |
| **Gate B** (before Part 3) | Per screen: "**seen by X visitors this month**" and average seconds in view | That screen ≥ 500 viewers in 30 days, *and* site-wide ≥ 5,000 visitors a month |
| **For auctions and brands** | A small stats sheet: visitors, top screens, time on site, countries | Gate B |

Rules:
- **Our numbers only.** Never show the real Times Square audience as ours. The real-world rate stays a clearly labelled "real-world value" note.
- **Tracking is to build:** privacy-friendly, aggregate only (no personal data):
  - visits and unique visitors per day;
  - per-screen seconds-in-view, from the game's camera (screens already know when they're on screen);
  - how many people open the buy sheet;
  - checkouts.

### 10.5 Marketing

**The hook:** *"I built a real Times Square from real data. Walk it, drive a cab, fly a plane over the Hudson to the Statue of Liberty, and own a billboard in it. Forever."* It's the Million Dollar Homepage idea, in 3D, in Times Square.

**This week (before go-live):**
- **Setup:** domain; Stripe live; analytics; the real sales inbox.
- **Waitlist / claim list:** visitors leave an email and the item they want, and get first access to Part 1. People on the list are the first buyers.
- **3 teaser clips** (15–30 s, vertical):
  1. walking up the red steps at night as the screens light up;
  2. catapulting off the Intrepid and flying past Liberty;
  3. "I put my name on a Times Square billboard".
- **Owner share kit:**
  - after buying, the owner gets an auto-made image and clip of *their* billboard in the scene;
  - a link that opens the site looking at their billboard;
  - "Owned by @them" credit.

  Every buyer becomes a promoter.

**Launch week:**
- **Show HN.** The tech story (OSM, Blender pipeline, three.js, real data) does well there.
- **Product Hunt.**
- **Reddit:** r/InternetIsBeautiful, r/SideProject, r/nyc, r/threejs, r/gamedev, r/proceduralgeneration.
- **X / LinkedIn:** a build-in-public thread with the clips.
- **TikTok / Reels / Shorts:** the clips, one a day.
- **Post every sale in public** (with the owner's permission): "Part 1: 23 of 40 sold".

**Weeks 2–8:**
- **"Part 1 sold out in N days" posts:** proof, and the reason Part 2 costs more.
- **Direct outreach:**
  - indie brands, AI / crypto / dev-tool startups and creators who like novelty billboards;
  - NYC small businesses on the actual blocks, whose real shop is in the twin.
- **Moments:**
  - **Halloween (Oct 31):** a night/spooky screen takeover.
  - **New Year's Eve (Dec 31):** the ball drop at One Times Square, the biggest Times Square moment of the year. That's when the plane banner, boat banner and hero screens go to auction (Part 4).
- **Small paid tests ($100–300, Reddit / TikTok)**, only after organic posts prove a buyer will pay. Then spend more where the cost per sale is below the average sale.

### 10.6 What to measure and decide each week

| Metric | Healthy sign | If not |
|---|---|---|
| Visitors/day | Growing week on week | More clips and posts; re-post with a better hook |
| Buy-sheet opens / visitors | ≥ 3% | Make "own a billboard" clearer on landing (button, prices visible) |
| Checkouts / buy-sheet opens | ≥ 5% | Prices too high for now: hold the price and add social proof. **Never cut prices.** |
| Part sell-through speed | Sold out ≤ 14 days | Slow the next part (algorithm `m = 1.0`) |
| Shares per buyer | ≥ 1 | Improve the share kit |

### 10.7 Risks to cover in the terms

- **What "permanent" means:** for example "for the life of the service". Keeping that promise means keeping the site and domain up for good.
- **Real building names and real brands.** It's a virtual representation. Owners' artwork must not impersonate the real building's owner or other trademarks, and is reviewed before going live.
- **Refunds:** before artwork goes live, yes; after, no. Any artwork change is reviewed.

### 10.8 Build list for go-live (in this order)

1. **Launch picker and parts:** `data/times_square/launch_parts.json` (Part 1 items, `L`, `T`, weights), plus the algorithm in a small server endpoint or a static JSON updated after each sale.
2. **Checkout:** a one-time permanent purchase replaces the rental flow in `plan.js`. A Stripe payment link per item (or a checkout session), with `client_reference_id` = the item ID.
3. **Ownership:**
   - an owner record per item;
   - "Owned by …" in the world and on the map;
   - sold items locked for good.
4. **Item card:** the scarcity signals from 10.4 (price now, next price, N left in this part, last sold).
5. **Tracking:** analytics plus per-screen time in view, for the visitor gates.
6. **Waitlist form and owner share kit.**
