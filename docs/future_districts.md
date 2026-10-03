# Future districts: where the twin goes after Times Square

Written 2026-10-04. **Scope note:** these get built **only if Times Square sells** (see `pricing_and_revenue.md` §10.6 for the signals). Each city is a new **limited release**: its own sellable inventory, sold in parts like Times Square. Architecture for adding a city: `architecture.md` §5.

## Selection criteria

What made Times Square sellable, and what each new place needs:
1. **Signature screens or landmarks** people would pay to put their name on: the inventory.
2. **Global name recognition.** "I own a billboard in ___" has to mean something.
3. **Something that moves** to carry a banner: boats, planes, ferries, trains. These are our highest-value items (Times Square: the Hudson plane, the sightseeing boat).
4. **Open map data quality.** Our pipeline is OpenStreetMap → Blender → three.js; weak or restricted data means manual modelling.
5. **Buyer market**: language, purchasing power, novelty culture.

## The top 10

| # | Place | Signature screens / landmarks | Moving banners | Open data | Buyer market |
|---|---|---|---|---|---|
| 1 | **Piccadilly Circus, London** | Piccadilly Lights (the big curved screen), Leicester Square, Shaftesbury Ave theatres | Thames river boats, London Eye, Big Ben nearby | Excellent | English, high spend |
| 2 | **Las Vegas Strip** | The Sphere, Fremont Street canopy screen, casino marquees and boards | Helicopter tours, the Bellagio fountains, the High Roller wheel | Excellent | US, novelty-friendly |
| 3 | **Shibuya Crossing, Tokyo** | The scramble crossing, Q-Front screen, the screens around the crossing | Trains (Yamanote line), buses | Very good | Global icon, Japan |
| 4 | **Shinjuku, Tokyo** | Cross Shinjuku 3D cat billboard, Kabukicho neon | Trains, night sky | Very good | Pair with Shibuya as one Tokyo release |
| 5 | **Downtown Dubai** | Burj Khalifa LED facade shows, Dubai Fountain, Sheikh Zayed Rd | Abra boats on the Creek, seaplanes | Good | Wealthy buyers, "own the Burj screen" |
| 6 | **Victoria Harbour, Hong Kong** | Skyline light show, Causeway Bay screens | **Star Ferry**, harbour junk boats | Good | The closest match to our Hudson + Liberty setup |
| 7 | **Dotonbori, Osaka** | Glico Running Man sign, giant food signs | Canal tour boats | Very good | Very photogenic at night |
| 8 | **Yonge–Dundas Square, Toronto** (Sankofa Square since 2024) | Canada's Times Square-style screens | CN Tower, harbour ferries | Excellent | English; small build |
| 9 | **Gangnam / COEX, Seoul** | K-Pop Square's 3D wave screen | Han River cruises | **Restricted**: South Korea limits map data export | Huge K-pop fan base |
| 10 | **The Bund / Lujiazui, Shanghai** | LED skyscraper facades across the Huangpu | Huangpu river cruises | **Weak**: OSM coverage is thin in China, and there are map-data legal limits | Spectacular, but the hardest to build and sell |

## Recommended order (if Times Square works)

1. **London: Piccadilly Circus + Leicester Square + the Thames.**
   - It's the strongest English-speaking market after the US.
   - The data is excellent.
   - The Thames gives us the boat and plane banners that are our best sellers.
2. **Las Vegas Strip.** It has the most screens per metre of anywhere, and US buyers who already know us.
3. **Tokyo: Shibuya + Shinjuku as one release.** It's the global icon, and the crossing is perfect for walk mode.
4. **Dubai Downtown.** Wealthy buyers and the Burj facade as a hero item.

Then Hong Kong, Osaka, Toronto. Seoul and Shanghai only with a data plan (licensed data or manual modelling).

## What each new district needs (the checklist)

The same steps we did for Times Square + the harbour. `architecture.md` §5 has the code layout.

1. **City package:** anchor lat/lon, grid rotation, timezone, currency, bounds (a capped play area, like NYC).
2. **Fetch + prep:** OSM buildings, roads, water, parks; footprints; places and labels.
3. **Build:** Blender district build, hero buildings hand-finished, export with LOD chunks; map + minimap layers.
4. **Inventory (catalog):**
   - screens, buildings and moving banners, each with a **permanent asset ID**;
   - scores; landing-view visibility measured in-game.
5. **Landing view** chosen: what every visitor sees first is the most valuable screen real estate.
6. **Gameplay hooks:** walk; one vehicle (cab / tuk-tuk / black cab); one moving vehicle with a banner (boat, plane or ferry); one tour.
7. **Pricing:** Part 1 picked by the algorithm (lowest weights first). Prices in the city's currency.
8. **Legal:** OSM attribution, landmark and trademark review of what we sell by name, local ad rules.
9. **Launch moment:** each city has one, for example London New Year's Eve fireworks, Tokyo Shibuya Halloween, Dubai New Year's Burj show.

## Rough effort per city (from our NYC experience)

| Phase | NYC took | Expected for the next city |
|---|---|---|
| Data fetch + prep | Days (Overpass is slow; cache raw downloads) | 2–3 days |
| Build + LOD + maps | About 2 weeks with iteration | ~1 week (the pipeline is reusable once cities are packages) |
| Hero landmarks (hand detail) | Ongoing | 1–2 weeks for 5–10 hero buildings |
| Catalog + pricing + landing view | 1–2 days | 1–2 days |
| Moving banner + vehicle + tour | Several days | 3–5 days |

The first new city is the real test of the multi-city architecture. Choose London to prove it.
