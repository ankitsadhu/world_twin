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
| **Wind (stamina)** | A run (Shift) lasts ~12 s; then you can only walk until you've got half your breath back (~5 s of walking). A thin bar at the bottom of the screen shows it only while you're out of breath (amber when you're winded). |
| **Uphill and stairs** | Slower by up to ~25-30%: measured on the TKTS red steps, 1.9 m/s on the flat, 1.4-1.5 m/s on the steps. The slope is measured over the last metre of travel (stairs are treads, not a ramp). |
| **Crowds** | Someone in the way ahead slows you to 60% (they step aside; you don't barge through). |
| **Landing from a jump** | The legs absorb it: 55% speed for 0.3 s. |

All in `walk.js` `friction()`. The numbers are constants at the top of that function.

## Not done yet (ideas, in the same spirit)

- Cars yielding at crosswalks to people *waiting* to cross (today only people in the lane).
- A person nudged by a moving car's side mirror (a bump, never a crash: "GTA without crime").
- Tired breathing and footstep sounds that follow the body: stamina state, surface (pavement vs steps).
- Kerbs: a small stumble when running off a kerb; different footfalls on steps.
- Rain and wet roads slowing cars (and you).
