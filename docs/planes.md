# Planes

One plane model does two jobs:

1. **Banner tow over the Hudson:** an ad space you can sell.
2. **A plane you can fly** from the USS Intrepid deck.

The model is a **Cessna 172S Skyhawk at true size**, built from its real dimensions by a Blender script (no downloaded mesh).

| | Model | Real C172S |
|---|---|---|
| Wingspan | 11.02 m | 11.00 m |
| Length | 8.29 m | 8.28 m |
| Height (fin + beacon) | 2.77 m | 2.72 m |
| Wing | NACA 2412, 1.63 m root chord, 1.12 m tip chord, 1.73° dihedral, washout | same |
| Prop | 1.90 m, 2 twisted blades | 75 in (1.90 m) |
| Main gear track | 2.53 m | 2.53 m |

| File | What |
|---|---|
| `scripts/blender/vehicles/build_cessna.py` | builds it: fuselage loft from measured sections, airfoil wings and tail with real hinge gaps, gear with wheel fairings, livery texture, lights, antennas, registration N172GT |
| `blender/vehicles/cessna172.blend` | editable scene |
| `export/vehicles/small_plane.glb` | game model (name kept so the viewer needs no change): ~50k tris, ~330 KB, Draco + JPEG livery |
| `export/characters/parachute.glb` | supplied canopy, lines and harness used by the rooftop skydive |
| `renders/vehicles/cessna172_*.png` | previews; `_scale.png` sets it beside a 1.68 m person and a metre ruler |
| `viewer/js/flight.js` | banner tow + flying |
| `config/mobile_slots.json` | the banner's sales listing (estimates) |
| `references/vehicles/small_propeller_plane_source.glb`, `scripts/blender/vehicles/prep_plane.py` | the first (downloaded) plane, superseded |

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/blender/vehicles/build_cessna.py -- export/vehicles/small_plane.glb renders/vehicles/cessna172
```

**Livery:** windows (with rubber seals), the navy sweep and red pinstripe, door and panel lines, the oil door and the cowl inlets are painted per pixel into one 4096 × 1024 texture, using the same section maths as the fuselage. Edges stay crisp up close. Paint and glass get different roughness from an ORM map, plus a clear coat. To change the colours or the tail number, edit the top of the script and rebuild.

**Game contract:**
- Z up, nose +Y (three.js −Z), wheels on z = 0, origin between the main wheels.
- `PLANE_body` + `PROPELLER`. The propeller is the spinner plus the blades, pivots on the engine axis, and spins about its local Y.
- Nav, strobe and beacon lights use `M_Light_*` materials, so the viewer dims them by day.
- **Moving surfaces:** `AILERON_L/R`, `FLAP_L/R`, `ELEVATOR_L/R` and `RUDDER` are separate child objects with their origin on the hinge line. Each stores its hinge direction (Blender coords) in the glTF extras as `hinge_axis`. Wing and tail axes point +X and the rudder's points up, so a positive angle means trailing edge down (or to the right, for the rudder).

**Controls on the plane** (`moveSurfaces` in flight.js, smoothed):

| Input | Surface | Max |
|---|---|---|
| turn left / right | ailerons opposite (left one up for a left roll) + rudder the same way | 17° / 20° |
| climb / descend | both elevators, trailing edge up to climb | 20° |
| take-off run, first 4 s of climb-out | flaps 10° | |
| slow (Space / L2) or landing roll | flaps 30°, running slowly like the real flap motor | |

## Banner tow (`sky.hudson.banner`)

- **Route:** a 150 m high oval over the river (x −1700…−1575, y −600…600), clear of the piers and the carrier.
- **Banner:** 30 × 7.5 m on a 40 m tow line. Both faces read the right way round.
- **Day only:** it flies in daylight and is hidden at night, as real banner tows are.
- **Selling it:** the banner is a normal screen slot, so tapping it opens the business prompt and sales sheet. Upload previews and playlists work like any other screen. While its sheet is open, the plane holds still so the buyer can see their banner.
- **Price:** comes from `config/mobile_slots.json` on the same CPM curve as the screens. `build_slot_sales.py` appends it to `slot_sales.json`, and `predeploy_check.py` counts it.
- **Not checked:** the audience figure (60k/day: Hudson River Park, the West Side Highway, the Intrepid) is an estimate, labelled as one.

## Flying

| How | |
|---|---|
| Get in | tap the plane on the Intrepid deck, the "Fly this plane" chip when near, or **✈ Fly a plane** on the Intrepid's map card |
| Take off | Take off button, W / ↑ / Shift, ✕ on a controller, ▲ on touch. It climbs out by itself for 4 s |
| Fly | W/↑ climb, S/↓ descend, A/D turn (banks), Shift faster, Space slower. Controller: left stick, R2/L2. Touch: ◀ ▶ ▲ ▼ Fast Slow |
| Land | come in slow (Space) and low over the deck; it settles and rolls to a stop |
| Get out | on the deck when stopped. You go to Explore over the deck, because the carrier deck isn't walkable |
| Back to the Intrepid | button in the air (or ○) |

- **Limits:** the height limit is 600 m (from `vehicle_zones.plane.ceiling_m`). If you wander more than 150 m outside the district, the plane turns back toward Midtown.
- **No crashes:** touching a tower, the street, the river or the hull fades to black and puts you back on the deck with a light message ("Too low!", "Splash!").
- **Speeds:** take off at 30 m/s, stall at 25, cruise at 46, fast is 68.
- **Deck position:** the deck is the collider polygon with `kind: "ship"` (18 m high). The plane parks at (−1382, 30), nose west.

## Skydrop rooftop challenge

While airborne, choose a rooftop and jump with **J** (or the Jump button). Build enough altitude to clear the selected roof first. The
first part is a short freefall; Space opens the provided parachute early, otherwise it deploys automatically. A/D (or the left stick)
steers the canopy. Fly through the three gold gates and land on the glowing pad for a perfect run.

- The small-target pad is placed on a real Midtown roof with enough footprint for a safe landing; the other pads mark the Minskoff
  Theatre and Marriott Marquis rooftops. Pads sit just above the baked roof height and are walkable after landing.
- A safe landing elsewhere on a rooftop is still playable, but scores as a miss. Hitting a building side or landing in the river
  fades back to the plane for another attempt.
- The routes and pads are created from the city's building-footprint collision data, so the challenge follows the real rooftops
  instead of treating every inaccessible roof as a valid target.

### Known gaps

- `SPAWN_plane_IntrepidDeck` in `times_square.blend` sits at y = −60, which is off the ship. `flight.js` uses its own deck spot. The blend file's empty should move to (−1382, 30, 18).
- Windows are painted glass, not see-through: there's no cabin interior yet. That's the next step if a cockpit view is wanted.

## The Intrepid, as a visitor gets around it

What the real museum is like (and what the game does):
- **The carrier:** USS Intrepid (CV-11), an Essex-class carrier, is a museum moored at Pier 86. It's 266 m long, its deck is 18 m up, its bow points at 12th Ave and its angled deck juts toward Pier 86.
- **Getting aboard:** visitors walk out along Pier 86 and take elevators or stairs up to the flight deck.
- **Cars:** they never go aboard; you drive or ride to 12th Ave and walk.
- **Flying:** nothing takes off from the real ship. Flying the Cessna off the deck is a game liberty.

In the game:
- **Model:** `scripts/blender/heroes/intrepid.py` builds `export/times_square/intrepid.glb` on the ship's own footprint from the city data. It has:
  - the hull, with its 28 m waterline beam, hangar bays and black boot-top;
  - the flight deck, with its centreline, angled-deck lines, elevator outline and "11";
  - the island on the starboard side, with its bridge, funnel, tripod mast, radars and "11";
  - display jets and the A-12 Blackbird;
  - the Space Shuttle pavilion on the aft deck;
  - the visitor elevator tower on Pier 86.

  The viewer hides the district's plain footprint block for the ship and loads this instead (~3k tris, 26 KB).
- **Getting there (`viewer/js/intrepid.js`):**
  - Walk out along Pier 86 (piers are walkable on foot). At the tower, "⬆ Elevator to the flight deck" (E) takes you up.
  - On deck, the deck edge stops you, as the deck-edge netting would. A person steps up 1.35 m at most, so the parked aircraft and the island block you.
  - "✈ Fly this plane" (F) is offered on deck, and "⬇ Elevator down to Pier 86" (E) takes you back down.
- **Take-off:** the plane parks forward at (−1382, 32) and runs aft, out over the river, along a lane kept clear of the display aircraft.
