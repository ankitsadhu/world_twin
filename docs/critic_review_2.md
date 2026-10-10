# Critic review 2: a GTA-style review after playing it (2026-10-10)

Played from a fresh browser: Play button -> bike -> ride, jump, crash -> map, mission list, mobile width. Hands-on; audio could not be heard in this session,
so audio points are marked "to verify". Scores are out of 10 against what a GTA/Forza-class reviewer would expect from a free browser game.

## Scorecard
| Area | Score | One line |
|---|---|---|
| First 60 seconds | 6.5 | on a bike in 5 s, prompts clear; but the first lane is a sidewalk with lamp posts, camera swings, three UI layers fight at the bottom |
| Controls and camera | 5.5 | arcade-OK; camera is far and flat, no speed feel (FOV, blur, lines), no look-back, no handbrake/drift |
| Vehicle feel and damage | 5 | jumps now follow the flight path and poles bend; no visible vehicle damage, no engine feel, one bike model, few cars |
| World and life | 6 | beautiful real layout and a 12 km map; but only Midtown has traffic, crowds and furniture life, downtown/harbour are empty |
| People | 4 | mannequin models, 7 looks, stiff faces; hits and falls are readable but not convincing; nobody reacts with voice or gesture beyond a grunt |
| Missions and structure | 6 | 16 missions with their own pins and good variety; but two progression systems (10 levels AND 16 missions AND wolves) confuse |
| Reward and progression | 4 | points only; no unlocks you can feel, no new vehicles, no cosmetic payoff; levels feel like counters |
| Audio | ? | stings and a grunt exist; engine, ambience mix and music untested |
| Visual polish | 6 | strong city, lighting and Times Square screens; UI and VFX (skid, smoke, sparks, dust) are thin |
| UI / UX | 4 | web-app look (pills, small type), stacking overlaps, truncated buttons, broken on a phone; see section 2 |
| Performance | 6 | 78-120 fps on a Mac, 72 MB first load, phones unmeasured |
| Shareability | 6.5 | clip recorder and highlights are the right idea; no share card yet, no ghost links |
Overall: **5.5 to 6 / 10**, a strong prototype with a lot of games and not yet one game that feels finished.

## 1. Pointers (what a critic would write), most important first
1. **Pick one spine.** There are three parallel progressions: 10 levels, 16 missions, 50 wolves. Players cannot tell what "winning" is. Make the missions the levels:
   completing a mission unlocks the next flag and a reward; the level chip becomes "Missions 3/16". Keep wolves as the side collection.
2. **Rewards that feel physical.** Every completion should unlock something visible: a new vehicle (second bike, car, speedboat skin), a colour, a trail. Today it is points.
3. **A real first lane.** The first ride starts on a sidewalk with lamp posts. Start on a road, a straight avenue with traffic coming, a guaranteed near-miss and a ramp, then the crash replay.
4. **Camera.** Pull it closer, add speed FOV, a subtle shake at speed, a look-back key, a drift/handbrake. A vehicle game lives or dies on the camera.
5. **Make the vehicle react.** Visible damage (dents, smoke, sparks, a cracked headlight), skid marks and tyre smoke, engine note tied to speed, a rider that leans and braces.
6. **People look like mannequins.** Seven looks, no faces, same walk. Needs the art brief (faces, clips, hand bones) and 15+ body/outfit combos. Until then keep people at a distance and in groups.
7. **Voices and reactions.** Honks, shouts, "hey!", people looking up at sirens, crowds parting for sirens, phones raised at a crash.
8. **The big map is empty past Midtown.** Add traffic and a thin crowd downtown and on the islands, or the 12 km feels fake. Re-use the same systems with lower density.
9. **One bike model, few cars.** Add 2-3 more bikes (sport, scooter) and 3-4 car types to drive (sports, truck, van, police). Vehicle choice is a core GTA pleasure.
10. **Police variety.** Cruisers and bikes only; add a helicopter spotlight at 4-5 stars and clearer wanted UI (the stars read as web chips).
11. **Mission framing.** Each mission is a 2-minute loop with no characters. Add a one-line briefing by a named character and a closing line; a mission card with the objective and the reward.
12. **Fail states.** Added for races, boat races, chases and fares; also add them for Crash Junction (never hit anything), Time Trial (missed gate), and make every fail a clear card with Retry.
13. **Audio is half the game.** Engine, wind, tyre, impact, siren Doppler, a radio you can switch (royalty-free), crowd murmur; needs a mix pass and sliders.
14. **Wolf Hunt**: the placeholder gem must become the mascot, with a pickup flourish and a compass that points to the nearest.
15. **Performance and load**: 72 MB first load; stage the load and compress. Phones untested.
16. **Brand safety**: names of other games stay out of player-facing text; "Rough contact" default off on the public site.

## 2. UI critique (what is wrong, what changes)
Observed problems (desktop and phone):
- **Fighting layers at the bottom**: tutorial prompt, controls strip and the vehicle panel stack on top of each other; on a phone the prompt is hidden behind the panel.
- **Top-left clutter**: district menu, level chip, wolf chip and mission chip are separate pills with different styles and no alignment.
- **The search bar owns the top** while you are driving; it belongs to the explore mode, not to a vehicle game.
- **Truncated buttons**: "Park & get out" and the repaint button are cut off at phone widths.
- **Notices cover gameplay**: the toast lane sits over the minimap and the chaos meter on a phone.
- **Web-app look**: dark rounded pills at 12-14 px; the speed is small; no strong game identity (colour, icon set, bold numerals).
- **Chaos / heat / race HUDs** are styled inline, so they do not share spacing, type scale or safe areas with the rest.
Changes made in this pass (see `viewer/css/hud.css` and `viewer/js/hudlayout.js`): a single HUD layout with named zones (top-left status stack, top-centre objective/score,
top-right heat, bottom-centre vehicle bar with the tutorial prompt reserved above it, bottom-right hints), one visual language (glass panels, bold numerals, 8-pt spacing),
the search bar shrinks while you play, buttons wrap instead of truncating, and safe-area padding on phones.
Still to do: on-screen touch controls with a proper thumb layout, a larger speedometer with a rev ring, a pause/settings screen restyle, a mission result card.
