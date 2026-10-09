# Real-world rules: how people, cars and bikes behave around each other

The aim: nothing should feel like a cursor or a ghost. Physical, human, predictable. One place to see every rule, its numbers
and where it lives, so they can be tuned (and so a new rule goes in the same spirit).

## People and cars

| Rule | How it works | Code |
|---|---|---|
| **Cars brake for anyone in their lane** | NPCs and you on foot count as obstacles. A car stops about 5 m (bumper to person); someone suddenly closer than 5.5 m triggers emergency braking (~1.6 g). Only people actually in the car's path count (lateral < 1.7 m): the pavement is safe. Before this, cars drove straight through you at full speed (measured: 11 m/s, no braking). | `traffic.js` `followLimit` (`people`, `pedGap`) |
| **Cars and bikes are solid to you** | You slide out of any car body (a 4.6 x 2 m box) or parked bike; you can't walk through them. | `walk.js` `pushOut`, fed by `index.html` `walk.blockers` |
| **Your car / bike stops for people** | (already there) it brakes hard, no crash. | `ride.js` `drive` |
| **Pressed against something, you stop** | The avatar's animation follows the distance really covered, not the one asked for, so it doesn't keep stepping in place against a car or wall. | `walk.js` `update` |

## The human body (on foot)

You are not a cursor: what you ask for is not what the body does at once.

| Rule | Numbers |
|---|---|
| **Momentum** | You pick up speed in ~0.3 s (a run builds over ~1.3 s) and stop in ~0.2 s. Turning at speed carries you wide. |
| **Wind (stamina)** | A run (Shift) lasts ~30 s (about 140 m: two blocks); then you can only walk until you've got half your breath back (~7 s of walking). A thin bar at the bottom of the screen shows it only while you're out of breath (amber when you're winded). |
| **Uphill and stairs** | Slower by up to ~25-30%: measured on the TKTS red steps, 1.9 m/s on the flat, 1.4-1.5 m/s on the steps. The slope is measured over the last metre of travel (stairs are treads, not a ramp). |
| **Crowds** | Someone in the way ahead slows you to 60% (they step aside; you don't barge through). |
| **Landing from a jump** | The legs absorb it: 55% speed for 0.3 s. |

All in `walk.js` `friction()`. The numbers are constants at the top of that function.

### Added in round 2

| Rule | How it works | Code |
|---|---|---|
| **Cars ease past people crossing** | Someone in the next lane or at the edge of the street (within 4.5 m of the car's line, less than 16 m ahead) caps the car at 3.5 m/s plus a little for distance, tightening as it passes. In its own lane: it stops (above). Pavement people don't count. | `traffic.js` `followLimit` (`slow`) |
| **Cars ready to stop for people waiting at a crosswalk** | Someone standing within ~2 m of a crosswalk on the pavement caps cars heading that way at 6 m/s (~13 mph) while within 24 m, as a driver covers the brake. Measured: a car 18 m before a crosswalk is capped at 6 m/s with a person waiting; unaffected by people mid-block. Traffic still flows (54-65 of 80 cars moving, average 7-9 m/s, with 70 NPCs). | `traffic.js` `atCrosswalk`, `followLimit` |
| **A passing car's side nudges you** | If a *moving* car (> 1 m/s) overlaps you, you're pushed out and stumble: 40% speed for 0.4 s, and a dull thump. Never a crash ("GTA without crime"); once per 1.2 s. | `walk.js` `pushOut` / `bumped`, `index.html` `walk.onBump` |
| **Running off a kerb or a step** | A drop of more than 12 cm while running (> 3.5 m/s): the knees take it, 0.18 s at 55% speed (once per 0.8 s). | `walk.js` |
| **Footsteps follow your body** | Cadence follows your stride (a walk is about a metre a step, a run about 1.45 m: 0.53 s at a walk, 0.32 s at a run; it used to be a fixed 0.52 s). The surface changes the tread: road (softer, lower), pavement, steps (brighter, with a second tick as the other foot follows). A run is a harder heel strike. | `audio.js` `step`, `index.html` `audio.body` |
| **Breathing** | When winded (and while the wind is under half) a soft intake and release every ~0.55-1 s, louder the more tired you are. | `audio.js` `breath` |

## Not done yet (ideas, in the same spirit)

- Rain and wet roads (there is no weather yet): longer braking, slipperier steps, a different tread.
- Cars flowing around you when you stand in a lane (today they wait behind you, and honk after a few seconds).

## Gait (legs and arms): `avatar.js` `gait()`

Measured before/after on the avatar (ankle tracked in the body's frame, `gait()` test harness):

| | Before | After |
|---|---|---|
| Planted foot sliding along the ground (walk) | 1.4 m/s (skating) | 0.5 m/s: only the heel-to-toe roll of the ankle |
| Planted foot sliding (run, 4.6 m/s) | 2.8 m/s | ~1.3 m/s: the ankle rolling over the ball of the foot |
| Cadence at a 1.6 m/s walk | ~157 steps/min (hurried) | 124 steps/min |
| Cadence at a 4.6 m/s run | 212 steps/min | 181 steps/min |
| Pelvis bob | none (a fixed wobble) | 3-5 cm walking, 8 cm running |

- **Stride follows speed:** `strideOf(v) = 0.75 + 0.5 v` metres per cycle (two steps); a foot is down 62% of the cycle walking, 34% running.
- **Feet are planted:** each leg is solved with two-bone IK (`solveLeg`) so the stance foot stays where it lands while the body passes over it; the heel lifts before toe-off; the swinging foot rises 7 cm walking and 20 cm running.
- **The pelvis** drops as low as the legs need (the bob) and floats up in a run's flight phase; it sways over the standing foot.
- **Arms** swing against the legs (each arm goes back as its own side's leg goes forward); the elbows bend from ~14 degrees walking to ~88 running; the hands relax.
- **Trunk:** the shoulders turn against the hips, the head stays level, a forward lean that grows with speed (2 to 12 degrees) and with acceleration, and a bank into turns.
- **Speeds:** walk 1.6 m/s (was 1.9: a 0.77 m leg breaks into a run near 1.9), run 4.6 m/s (10 mph: a fast run, left as it was).
- Idle, jumping and landing keep the old pose; moving from 0.2 to 0.6 m/s blends between the two.

## Ground and gravity: everything stands on the real ground (`groundmap.js`)

Reported: bike (and some car) wheels buried in the ground, and people walking above the ground. Both came from not knowing
how high the ground is:

| What was wrong | Cause | Fix |
|---|---|---|
| **Bike wheels buried 13 cm** (and any vehicle parked or ridden on a pavement) | Vehicles were placed at a fixed height of 0.03 m, but a pavement is 0.16 m above the road (the kerb) | Every vehicle gets its height from the ground under its wheels, and its **pitch and roll** from where the axles are (`ride.js` `settle`): nose dips as the front wheel drops off a kerb, rises as it climbs one; a car also rolls over a crown or a kerb. Verified: riding a bike off the kerb, y 0.19 -> 0.03 m, nose down ~5 degrees; a taxi driven at a kerb rises 7 cm and pitches up 3 degrees. |
| **People walking above the ground** | Each NPC found its ground height with a ray from 3 m up, only every 4 m walked. The ray hit *anything*: a car roof (1.4 m), a bike seat (0.94 m), a signboard, and the NPC then walked on at that height for the next 4 m | The ground is now a baked **height map** (1 m cells over Midtown, built in ~0.1 s from the terrain meshes and the TKTS steps) read every frame: one array lookup, no raycast; heights ease so a kerb is a step, not a teleport. The walker's own ground ray no longer hits vehicles either. Verified: 21 of 21 visible NPCs exactly on the pavement height. |

- **Heights found in the map:** roads 0, road markings 0.02, pavement and plazas 0.16 (kerb), pier deck 1.2, the red steps up to 2.9 m and beyond.
- **Traffic cars** read the same map (they were already fine on the road: model lowest point 0).
- **Bike model:** both wheels have the same 0.33 m radius and sit at 0; nothing wrong with the model.
- **Still simple:** cars don't suspension-bounce; people don't fall off edges (the walker's step limit blocks anything over 1.35 m); things don't float or sink in water (boats and the harbour are separate).

Cost: the bake is 47-137 ms once, 4.4 MB of memory (one byte per square metre, 2 cm steps); a lookup is negligible.
