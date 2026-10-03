# Sightseeing boat

A three-deck Hudson River sightseeing boat at true size. It berths at Pier 83 (W 42nd St), where the real Midtown cruise
boats leave from. The name and livery are made up ("Hudson Sightseer"), with no real operator's branding.

| | Model | Typical Midtown sightseeing boat |
|---|---|---|
| Length overall | 50.0 m (52.4 m with the stern flag) | ~50 m (165 ft) |
| Beam | 9.8 m (10.5 m over fenders) | ~10 m |
| Draft | 2.0 m | ~2 m |
| Decks | enclosed main saloon, enclosed upper saloon, open top deck + pilothouse | same |

| File | What |
|---|---|
| `scripts/blender/vehicles/build_sightseeing_boat.py` | builds it. Hull: a loft with round bilge, raked stem and sheer, its paint bands following the hull lines. Also saloons with windows, pilothouse, railings, benches, stacks, mast and radar, nav lights, life rings, rafts, US flag, the name on the bows and transom, and two railing ad banners |
| `blender/vehicles/sightseeing_boat.blend` | editable scene |
| `export/vehicles/sightseeing_boat.glb` | game model: one object `BOAT_body`, ~40k tris, ~210 KB |
| `viewer/js/boat.js` | the cruise |
| `renders/vehicles/sightseeing_boat_*.png` | previews |

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/blender/vehicles/build_sightseeing_boat.py
```

**Contract:** Z up, bow +Y (three.js −Z), origin on the waterline at mid-length. The game puts it on the river surface (z = −1.8).

## The cruise (`viewer/js/boat.js`)

- **Route:** alongside Pier 83's south face, bow to the river. It casts off west, runs up the far lane (x ≈ −1726, clear of the Intrepid and Pier 86) to about W 56th, turns, and comes down the near lane (x ≈ −1690). Then it heads east along y −264, makes a U-turn clear of the stub piers, and glides west into the berth.
- **Length and timing:** 2.17 km, about 8.7 min at up to 5.2 m/s (~10 kn), slower through bends and in the harbour, then a 90 s stop at the pier.
- **Clearance:** the hull keeps at least 7.8 m from every pier (checked against the pier outlines).
- **Motion:** heavy-boat acceleration, a gentle swell (heave, roll, pitch), heel in turns, and a foam wake that fades with speed.
- **Day and night:** saloon windows (`M_Light_BoatCabin`) are dark glass by day and glow warm at night, via a rule in `DAY_RATIO` in index.html.
- **Ad space:** the two top-deck railing banners (`boat.hudson.side`, 9.6 × 1.2 m each, 8:1 art) are a screen like any other. Tapping one opens the sales sheet, and the boat idles while it's open. The listing lives in `config/mobile_slots.json` (estimated audience).

## Take the helm (`viewer/js/helm.js`)

Tap the boat, or press **⚓ Take the helm** on Pier 83's map card. If she's at her berth, you start alongside with the lines on.

| Control | Keyboard | Controller | Touch |
|---|---|---|---|
| Engine-order telegraph (Full astern … Stop … Full ahead) | W / S (X = Stop) | D-pad ▲▼ | ▲ ▼ |
| Rudder (hold; returns amidships when released) | A / D | left stick | ◀ ▶ |
| Ship's horn | H | □ | Horn |
| Chase / bridge view | C | R3 | View |
| Tie up / go ashore | F | ✕ | panel buttons |
| Leave the helm | panel | ○ | panel |

**Handling**, measured in still water with the game's own maths:

| Trial | Game | Real 50 m twin-screw passenger vessel |
|---|---|---|
| Top speed | 12.5 kn | 12–13 kn |
| Stop to 95 % of full ahead | 93 s | ~60–90 s |
| Crash stop (full ahead → full astern) | 149 m, 49 s | 2–4 boat lengths |
| Coast on Stop to 1 kn | 409 m | long, water drag only |
| Turning circle, full rudder at full speed | 147 m (2.9 lengths) | 2.5–4 lengths |
| Rudder hard over | 7 s (5°/s) | hydraulic steering, 3–6°/s |

- **Rudder:** steers with the water flowing past it, so the propeller wash helps at low speed ahead. Going astern it barely steers.
- **Tide:** the Hudson sets north on the flood (up to 1.4 kn) and south on the ebb (up to 1.8 kn), at full strength past the pier heads and about 15 % inside the slips. The cycle is a simulated 12 h 25 min one by New York time, not a live NOAA prediction.
- **Obstacles:**
  - the exact pier deck outlines (`data/times_square/piers.json`, baked by `scripts/blender/export_piers.py`);
  - the Intrepid;
  - the Manhattan bulkhead (the river outline from `nav.json`);
  - the New Jersey bulkhead at x ≈ −2740, the real Weehawken/Hoboken shore;
  - for now the river is closed about 2.2 km north and south, until the harbour is built.
- **Contact:** the hull slides along what it touches (fenders). A knock above ~0.9 m/s bounces her off with a rumble. No damage.
- **Tying up:** come within 3 m of a straight pier face at least 30 m long, nearly parallel and under 0.75 m/s. The crew warps her in over 3 s.
- **Going ashore:** puts you on that pier deck in Walk. "Leave the helm" elsewhere puts you in Explore above the boat. Either way she goes back on her timetable at Pier 83 once you're 260 m away, and stays tied up until then if you moored her.
- **Bridge view:** the eye is in the glass wheelhouse, 9.3 m above the water, behind the helm console.

## River to the horizon

The district's water mesh ends at x −1750, so from a boat or a plane you used to see a seam. `index.html` now draws the
Hudson's own water material on a 7.6 km disc that follows the camera and fades into the horizon haze. The district's
water mesh is hidden once it loads.

## Not yet

- Riding as a passenger ("Take the cruise", sitting on the top deck) isn't built yet. Taking the helm is.
- The water reflects the day/night street HDR, so trees show in the river. A sky-only reflection for water would be more true to life.
- The real Staten Island Ferry runs from Whitehall Terminal in Lower Manhattan. It belongs in a future harbour district.
