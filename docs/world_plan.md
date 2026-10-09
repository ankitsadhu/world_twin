# The world plan: one big city, eight places, each with its own game

Problem: everything we built (stunt park, taxi, race, chase) sits on the same few blocks of Times Square. The world is 2.7 km x 1.4 km of Midtown
(8 avenues, 18 streets, play area x -1750..960, y -720..740 in the local frame) with the Hudson and the Intrepid on the west edge. A player should
travel, and each place should be worth a trip and worth a clip. Each zone below has: one signature activity (a proven game format), one
photo spot people post, one reason to return, and content we can add later without new engine work.

## The eight zones (coordinates are local metres; Times Square is near 0,0; the Intrepid is the west end)
| # | Zone | Where | Signature game (proven format) | Photo / "insta" spot | Reason to return |
|---|------|-------|--------------------------------|----------------------|------------------|
| 1 | **The Crossroads** (Times Square) | x -300..300, y -250..150 | Stunt Park + chaos chain (Tony Hawk / Goat Sim), **New Year's Eve ball drop** | Red steps at night; ramp jump over the plaza with the screens behind | Daily stunt score; NYE / Halloween / Pride takeovers of the screens |
| 2 | **Broadway** (Theater District) | north of Times Sq, y 0..350, around 7th Ave & 49th | **Taxi rush** (Crazy Taxi): fares between theatres | Marquee lights at 7 pm curtain time; taxi in the rain | Fare streak leaderboard; "opening night" events that move the fare pickups |
| 3 | **Hell's Kitchen Backstreets** | west avenues x -1100..-550 (the long straight avenues) | **Street races + drift** (Need for Speed / Trackmania): time trials with ghosts | Long avenue at golden hour, speed trails | Weekly "track of the week", ghost of the world record |
| 4 | **Hudson River Park** (waterfront) | x -1750..-1400, y -700..700 | **Boat dash** + cycle path (Mario Kart on water, boost rings) | Sunset over the Hudson from the pier | Sunset challenge (best score only at golden hour), boat races |
| 5 | **The Intrepid** | x -1486, y 23 (Pier 86) | **Air show + landing** (Pilotwings): precision landing on the deck, formation fly-bys | Plane over the skyline, deck at dusk | **Fleet Week** event (formation flying, jet flyovers) |
| 6 | **Midtown Rooftops** | the towers around x 300..960 | **Rooftop parachute** (existing jump pads): gates, then land on pads | Free-fall view of the grid, rooftop sunrise | New pads and gate lines every week; time-of-day dependent wind |
| 7 | **Midtown East Run** | x 400..960 | **Heat / chase** (NFS / GTA): cruisers, roadblocks, bikes | Cruisers in the rain with lights reflecting on wet roads | Heat season ladder; "escape in under 2 minutes" daily |
| 8 | **The Park Gate** (north edge) | y 500..740 (Central Park is just beyond, x 198, y 1382) | **Explore / collect** (Pokemon GO): 100 nostalgic NYC spots, photo quests | A "postcard" mode at each spot | New spot packs monthly ("Movie locations", "Old New York") |
Later (the harbour is already modelled): **Liberty Harbour** (Statue of Liberty, Ellis Island, Governors Island): boat tours and a ferry ride, a Fleet-Week sail-past.

## Why this is easier to market
- **A place per hashtag.** #CrossroadsStunt, #BroadwayTaxi, #HudsonSunset, #IntrepidAirshow. Each zone has its own 15-second clip type.
- **It is real time.** The game already follows New York's clock, so a post can say "it is raining on the Hudson right now". Add real weather, and the world is a living thing people check.
- **Real dates.** NYE ball drop, Fleet Week, Thanksgiving parade route, Halloween: each is a built-in news hook and a reason to open the game on that day.
- **Instagram mode.** Photo mode with a 9:16 crop, golden-hour auto-time, a "Spot found" card ("Hudson Pier at sunset, 14 of 100"), watermarked with the URL.
- **Challenges that travel as links.** "Beat my 1:12 on Hell's Kitchen Run" opens the exact seed with my ghost. Wordle-style daily across all zones: one zone and one rule per day.

## New content without new engine work
All content is data (JSON in `config/`): a **challenge** = { zone, mode (race / fare / stunt / chase / collect), gates or pads, rules, medal times, season }.
Authoring tools we already have in code: race gates (`race.js`), pads and cones, props (`playzone.js`), fares (`fares.js`), pursuit stars (`heat.js`), parachute gates (`flight.js`).
- **Weekly drop:** one new challenge per zone (a JSON file + an optional prop set). Announce the zone of the week.
- **Seasons (8 weeks):** a theme, a leaderboard, 3 limited rewards that are cosmetic only (no money): vehicle skins, trails, plates.
- **Player-made tracks (later):** drop 8 gates on the map, test it, share a link (Trackmania's growth loop). Server only stores the gate list.
- **Event takeovers:** swap the screens' art and the props for a few days (the screens are already sellable inventory: sponsors can own an event).

## Build order (what to build next, in the order I would do it)
1. **Make the world feel travelled**: a map with zone names and a "go" button per zone, each zone's goal pin and a one-line pitch (the goal-waypoint system exists). Rename levels 1-10 to zones where it fits.
2. **Zone 3 Backstreets (races + ghosts)**: reuse races; add the ghost of your best run (record position every 0.1 s, replay as a translucent bike). Cheap, very shareable.
3. **Zone 4/5 Hudson + Intrepid**: speedboat (new model), boost rings on the water, an air-show formation challenge on the Intrepid. This opens the west half of the map.
4. **Instagram mode**: photo mode, golden-hour jump, 9:16 export, "Spot found" cards. Marketing starts working here.
5. **Zone 2 Broadway (taxi)** with a theatre-time clock and neon at night.
6. **Daily challenge + weekly drop pipeline** (the JSON challenge format above), then **seasons**.
7. **Zone 6-8** as content updates; Liberty Harbour after launch.

## Launch scope (honest)
Launch with zones 1-5 playable and the daily challenge; zones 6-8 and Liberty Harbour ship as the first four weekly drops.
That gives a launch story ("explore the whole west side by bike, boat and plane") and a content calendar for the first month.

## Correction: the world is 12 km long, not 2.7 km
The harbour data (`data/harbor/collide.json`) frames x -2800..2750, y -9750..2600 (local metres): Central Park at the top (y ~ +1400), Midtown in the
middle (y +740..-720), then Chelsea, the West Village, Tribeca, the World Trade Center (y -5500), Battery Park, the Battery (y -6600), Ellis and Governors
Islands (y -7900) and the Statue of Liberty (y -9108), with Hoboken / Jersey City across the Hudson (x < -1500) and Brooklyn east of the Narrows.
Land, piers and towers downtown are real (vehicles now drive there; water and towers are walls). Missions are spread over the whole length:
Midtown (11), Chelsea / Hoboken (Hudson Run, boat), Lower Manhattan (Wall Street Run), Central Park (Park Loop), Statue of Liberty (Liberty Sprint, Statue Fly-by),
and 20 of the 50 golden wolves are downtown and on the islands. Fast travel: search "Where to?" for any mission and you arrive at its flag with a bike (or a boat / plane).
