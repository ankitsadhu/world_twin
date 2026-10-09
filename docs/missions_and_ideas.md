# Missions on the map, and the next games to build (proven on PlayStation and Roblox)

## Built: every game has a place on the map
Amber flag on the map and minimap, a glowing ring in the world; walk or ride in, tap "Start". Done missions turn green (`viewer/js/missions.js`).
| Mission | Level | Zone / place | Based on |
|---|---|---|---|
| First Ride | 1-2 | The Crossroads (Times Sq) | Burnout / Tony Hawk |
| Stunt Park | 3 | Times Square plaza | Tony Hawk / Goat Simulator |
| Taxi Rush | 4 | Broadway (7th Ave & 49th) | Crazy Taxi |
| Time Trial: Hell's Kitchen run | 5 | West avenues | Trackmania (ghost, instant restart) |
| Crash Junction | 6 | Midtown East junction | Burnout Crash Mode |
| East Run: Heat | 7 | Midtown East | Need for Speed / GTA |
| Kart Dash | 8 | Midtown loop | Mario Kart |
| Hudson Dash | 8 | Pier 83 | Mario Kart on water |
| Intrepid Landing | 9 | Intrepid | Pilotwings |
| Rooftop Drop | 9 | East towers | Pilotwings / Just Cause |
| Wolf Hunt | 1+ | Everywhere (30 gold wolves) | Spider-Man backpacks / Astro Bot / Roblox collectibles |

## Next games, in priority order (each uses the whole map, each is proven)
Must-have (cheap, big payoff, all reuse what exists):
1. **Courier** (Death Stranding / Postmates-style): pick up a parcel at one zone, deliver across the map; crashes damage the parcel, tricks add bonus. Extends the fare code. Gives a reason to cross the whole city.
2. **Catch the Runner** (Roblox tag / "Catch me if you can"): an NPC grabs your hat and runs; chase them through the crowd and across the city. Reuses NPC flee logic, brand-safe, funny, perfect for clips.
3. **Licence tests** (Gran Turismo): 10 short skill tests spread around the city (brake test, slalom, parallel park, drift circle, wheelie hold). Medals unlock vehicle skins. Tiny, repeatable, shareable times.
4. **Viewpoint towers** (Horizon / Assassin's Creed / Far Cry): 8 rooftops that unlock the map for that area and a free "photo pose" once you reach them (parachute up-and-down loop with the jump pads).
Good-to-have:
5. **Obby** (Roblox, the most played genre): a parkour course of ramps and jump pads along the Hudson piers and on rooftops; fall = instant retry. Needs platform collision.
6. **Photo quests** (Ghost of Tsushima / Spider-Man): "take a photo of the Intrepid at sunset"; pairs with Instagram mode.
7. **Flash mob / emote spot** (Fortnite / Roblox): a circle on the plaza where emotes attract a crowd; needs dance animations (art brief).
8. **Hide and Seek** (Roblox): hide among the crowd while bots search.
9. **Delivery drone / rooftop rings** (Pilotwings, Spyro): fly through ring chains between zones.
10. **Seasonal events** (Fortnite): NYE ball drop, Fleet Week, Halloween: limited-time missions at the same flags.
Do not build: tycoon / simulators with in-game money (product rule: money is only for buying property and billboards); crime missions (brand safety).

## Rule for every new mission
One flag, one zone, a 2-minute loop, medals, a replay clip, a share card, and a daily/weekly variation (same data-driven file as the challenges in `docs/world_plan.md`).

## The game catalogue and the marker legend (what each pin means)
Every game type has its own symbol and colour on the map and minimap; the small black number on a pin is its place in the suggested order (1 = start here), a green tick means done,
and the pin you are tracking pulses. Press K (or Menu > Missions) for the list: **Track** makes one mission your destination (a chip shows the distance, the red pin and beacon lead you),
**Go** fast-travels, **Next up** picks the first one you have not done.
| Colour | Kind | Symbol | Games |
|---|---|---|---|
| Red | Chaos | chevrons / ramp / impact star / siren | First Ride, Stunt Park, Crash Junction, East Run: Heat |
| Amber | Racing | chequered flag / stopwatch / bolt | Time Trial (ghost), Kart Dash (boost pads), Wall Street Run, Central Park Loop (rallies) |
| Green | Jobs | taxi | Taxi Rush (and the Courier to come) |
| Teal | Water | speedboat | Hudson Dash, Hudson Run (Chelsea-Hoboken), Liberty Sprint |
| Purple | Sky | plane / parachute | Intrepid Landing, Statue Fly-by, Rooftop Drop |
| Gold | Collect | paw | Wolf Hunt (50) |
Planned next (same legend, new symbols): Courier (green, parcel), Catch the Runner (red, running figure), Licence tests (amber, cone), Viewpoint towers (purple, binoculars), Photo quests (gold, camera).
