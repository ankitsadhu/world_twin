# Player vehicles: sourcing plan (on hold)

Shortlist of free models whose licence allows **commercial use with credit** (CC-BY 4.0). Non-commercial
("NC") models were excluded because the game sells ad space. Comparison sheet:
`references/vehicles/vehicle_candidates.jpg`, metadata: `references/vehicles/vehicle_candidates.json`.

| Role | Model | Author | Faces | Link |
|---|---|---|---|---|
| Taxi | 2021 Toyota RAV4 Hybrid (real NYC cab type; strip badges) | tonielpro520 | 172k | https://sketchfab.com/3d-models/2021-toyota-rav4-hybrid-de74fe4e98004c92b1103947597d1b53 |
| Car + traffic | Generic passenger car pack (brand-free) | Comrade1280 | 69k | https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5 |
| Bike | Classic Bicycle, LowPoly, game ready | by__Rx | 20k | https://sketchfab.com/3d-models/classic-bicycle-lowpoly-game-ready-da6507928c0c4a5c8776008cdb9f747e |
| Plane | FREE Cessna 172SP | NLM | 187k | https://sketchfab.com/3d-models/free-cessna-172sp-c9cadc2f026946da8cf9715a683739e9 |
| Plane (alt, lands on the Hudson) | SeaPlane Cessna 172 | KOG_THORNS | 6k | https://sketchfab.com/3d-models/seaplane-cessna-172-3924196d2ccf42c0ac8458d8f16a7910 |
| Ship | Ferry Concept (sightseeing ferry) | Gman The Cruise Dude | 206k | https://sketchfab.com/3d-models/ferry-concept-73b9556133704e73af6637a428bcb8f4 |

## When resumed
1. Download each model as **glTF** into `references/vehicles/<role>/` (a Sketchfab login is needed).
2. Pipeline per vehicle (Blender script, to be written as `scripts/blender/vehicles/adapt_vehicle.py`):
   - scale to real size, origin at ground contact, front = +Y (same convention as `car_gen.py`);
   - split animated parts: `WHEEL_*` (hub pivots), `DOOR_*` (hinge pivots), `STEER`, propeller, rudder;
   - add `SEAT_*`, `EXIT_*`, `CAM_*` empties; remove brand badges / names;
   - decimate to budget (car ≤ 40k, bike ≤ 15k, plane ≤ 30k, ship ≤ 40k tris), bake to the library materials;
   - add sellable slots: taxi topper (exists in `car_gen.py`), ferry hull banner, plane banner tow.
3. Credits: add every model to `CREDITS.md` (title, author, link, licence), shown in the game's credits screen.

Note on brands: CC-BY covers the 3D model's copyright, not car makers' trademarks. Remove logos and model
names; keep generic proportions.
