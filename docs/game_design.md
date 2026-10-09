# Game design: a real-world open game people share by themselves

Goal: gamers market this for us. Single player now (teams / multiplayer later), 10 levels, a leaderboard, vehicles
unlocked by playing (not bought), real nostalgic places, and a game that is fun to *record and share*.
Money rule is unchanged: the only money in the product is buying property/banners; XP, levels and unlocks are not money.

## What already works in other games (and why people share them)
| Proven mechanic | Where | What we take |
|---|---|---|
| "One more run": 60-120 s loops with a score | Crazy Taxi, Burnout Takedown, Subway Surfers | Timed jobs in the city (fares exist), always a next target 30 s away |
| Skill-chain score (combo multiplier, never-stop) | Tony Hawk, Burnout, Forza Horizon "Skill chain" | Near-misses, air time, drifts, wheelies, stunt jumps chain into one multiplier; crash breaks it |
| Crash as spectacle, slow-motion replay | Burnout Crash Mode, GTA, BeamNG | Auto slow-mo "crash cam" of the last 5 s, one tap to save as a clip |
| Heat / wanted escalation | GTA, Need for Speed Heat | Pursuit stars (already started: `pursuit.js`), escape = score bonus; no crime/violence language, brand-safe |
| Unlock the world by driving it | Forza Horizon festival, Assassin's Creed towers | Level gates open areas, vehicles and rides; "collect" landmark spots (Nostalgic places) |
| Collectibles with a place story | Pokemon GO, Assassin's Creed, Google Earth | 100 nostalgic NYC spots: be there at the real time of day / do the stunt there for a stamp |
| Daily shared seed + share card | Wordle, GeoGuessr daily | Daily route / challenge, identical for everyone, result shareable as an image |
| Ghosts and friend beats | Trackmania, Mario Kart | Race a friend's/world-record ghost (single player, async): no netcode needed |
| Photo / clip mode | Forza, Ghost of Tsushima, Gran Turismo | Photo mode + 15-30 s clip export, watermark with the URL and your rank |
| Short, clear levels | Mobile and web hits | 10 levels, each one an idea: new vehicle + new job + one new rule |

## The 10 levels (draft)
1. **Walk Times Square**: reach 3 landmarks, learn walk/run/stamina. Unlock: first bike.
2. **Delivery on foot / first fares**: timed drops. Unlock: scooter-class bike (slow, forgiving).
3. **Cruiser bike**: stunt jumps, near-miss chain. Unlock: cruiser.
4. **Taxi**: fare loop, traffic reads (signals, crosswalks). Unlock: taxi.
5. **Night run**: dark, rain, wet roads, lower grip. Unlock: sports car.
6. **Chase** (2-star): escape pursuit, heat decay. Unlock: pursuit car (visual only).
7. **Harbour**: boat and pier challenges. Unlock: boat.
8. **Sky**: plane/parachute, landing precision on the Intrepid. Unlock: plane.
9. **Rush hour**: densest traffic, multi-stop city route, combo cap lifts.
10. **Legend**: all areas, a long boss route, leaderboard season entry.
Each level = XP threshold + 1 clear objective, so progress is legible in one line on screen.

## Leaderboard (single player, minimal infra)
Score = chain points (never money). Per level and weekly "season". Store only: player id (anonymous),
level, score, seed, run hash. Submit with a replay seed so cheating is checkable; one table in the existing Postgres,
one endpoint in the API container (no new services, per the infra rule). Sort: weekly, all-time, friends via share link.

## Sharing loop (the marketing engine)
1. **Auto clip**: a rolling 30 s buffer (`canvas.captureStream` + `MediaRecorder`, webm/mp4) with a "Save clip" button on
   crash, big air, near-miss chain, level up. No server needed: download or Web Share API.
2. **Share card** after each run: map pin, score, vehicle, time of day, "beat my score" link (seed in URL).
3. **Daily challenge** link, same seed for everyone, one attempt shown on the share card.
4. **Photo mode** (pause, free camera, no HUD) for landmarks: nostalgic-place hunting is naturally screenshot-friendly.
5. **Streamer friendly**: no login, instant load, optional "streamer mode" (no music licensing issues, copyright-free radio).

## Physics that make moments clip-worthy
Real collisions (car-car, car-bike, bike-car), ejected rider, wrecks and tow (see plan: `collide.js`), air physics:
drag, downforce at speed, side wind, lift/fall for jumps, rain/wet surface grip, fall damage. People hits are the
"Rough contact" switch, off by default on the public site (brand safety for banner buyers).

## Speed feel (walking / running so it is never boring)
Walk 1.6 m/s, run 4.6 m/s are real. Make it fun without breaking realism:
- Adaptive pace: while a route/objective is far (>150 m) and the player holds Shift, ease run speed up to ~6 m/s
  ("jog assist"), always scaled by stamina; slow to real speed near people (crowd rule) and landmarks.
- Hips/torso lean forward with speed, arm swing and hip sway scale with speed (already IK gait; add lean ~ v^2/10 deg).
- Vehicle quick-travel is the main answer to boredom: bikes within 60 m, always visible on the map.

## Build order
1. Fix feel (camera, reverse, bikes/cars count) *(done this session: bike camera no longer flips, stronger reverse, spread traffic)*.
2. XP + levels + objectives + HUD + local save.
3. Clip recorder + share card + photo mode.
4. Leaderboard endpoint + weekly season.
5. Daily seed + ghosts.
6. Platform polish: sound, rain, wet-grip, nostalgic-places set.
