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


## Motorcycle: the cruiser (2026-10-04)

`export/vehicles/motorbike_cruiser.glb` (39k tris, Draco; the artist's 7k far version is not in the repo: take it from `cloud_env/deliveries/2026-10-04/` if bikes ever join the traffic), from the character agent's
Blender build (`cloud_env/tools/build_motorcycle.py`). An original V-twin chopper, no brand marks. Facing +Z, wheelbase 1.65 m,
wheel radius 0.335 m.

- **Rig (rigid hierarchy):** `BIKE` > `FRAME_BODY` (> `BADGE`), `STEER` (the fork, on its 30-degree rake) > `FORK`, `HANDLEBARS`,
  `HEADLIGHT`, `FRONT_FENDER`, `WHEEL_FRONT`; `WHEEL_REAR`; `KICKSTAND`; anchors `SEAT_ANCHOR`, `PILLION_ANCHOR`, `FOOT_L/R`,
  `GRIP_L/R`; collision proxies `COL_*` (**hidden in game**: drawn they are a huge black slab).
- **Actions:** `Parked` (8 degrees onto the kickstand), `Stand_Up` (kickstand folds away), `Steer_Sweep`. The game poses the parts
  itself (`js/bike.js`): the stand folds as you mount, the bars turn, the bike leans into turns.
- **In the game** (`js/bike.js` + `ride.js`): five cruisers stand at the curb (`BIKE_SPOTS`: two by the walking start on 8th Ave).
  Walk up, **F: Hop on**. The rider is you (your avatar, `Pose_Ride`, parented to the bike so it leans with it); **F** gets off.
  - **Handling** (`BIKE_H` vs `CAR_H`): 6 m/s2, 27 m/s top (60 mph), quicker steering, a narrower body (it fits gaps a car can't),
    lean = steering x speed. Same collisions with buildings, people (it stops for them), parked cars and traffic.
  - **Not saved with your progress:** bikes always respawn at their spots.
  - **Chase camera only** (closer and lower than the car's); the cab-only features (fares, inside view) don't apply.
