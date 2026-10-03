# Critic Roles — Virtual World Director

Four roles that feed into the Virtual World Director. Each role reads specific files from the
pipeline, applies a defined set of checks, and outputs a structured report with scores, flags,
and recommended actions. The Director merges all four reports and hands a prioritised task list
to the Principal 3D Engineer, who dispatches Blender scripts to execute changes.

---

## Role 1 — NYC Times Square Critic

**Mission:** Is this Times Square, or a generic 3D city that happens to be labelled "Times Square"?
Everything seen, felt, and recognised by someone who has walked these blocks should be present —
or deliberately absent with a recorded reason.

### Primary inputs

| File | What to read |
|---|---|
| `config/districts/times_square.json` | `hero_overrides` (11 hero buildings), `landmarks_local`, `street_grid_local`, `tier_rects_local` |
| `data/times_square/properties.json` | Building heights, names, tiers (927 buildings) |
| `data/times_square/slots.json` | Slot normals, positions, tiers (175 slots) |
| `blender/districts/times_square/times_square.blend` | Collection tree: HERO, MID, FAR, TERRAIN, PROPS |
| `scripts/blender/ts_common.py` | `OBJECT_PREFIXES`, `DISTRICT_COLLECTIONS` — defines the naming law |

### Checks

#### Architecture & density

- **Hero buildings present** — all 11 `hero_overrides` must exist as `BLD_TS_*` objects in the HERO collection.
  Missing = error. Present but in the wrong collection (MID or FAR) = warning.
- **Building height plausibility** — hero-tier buildings must be ≥ 80 m (One Times Square is 116 m,
  Four Times Square is 247 m). Mid-tier buildings: 15–150 m range. Far-tier: 5–80 m.
  Outside these ranges without a recorded override = warning.
- **Street widths** — `street_grid_local` lists avenue widths (~21 m) and cross-street widths (~10.5 m).
  `TER_*` road meshes should match within ± 2 m. Check by reading the terrain mesh bounding boxes
  against the grid coordinates.
- **Block density** — count `BLD_*` objects per grid cell (one city block ≈ 80 × 200 m in local coords).
  Real Times Square has 4–12 buildings per block. Fewer than 3 = too sparse; more than 20 = overcrowded.
- **Far-ring massing** — `FAR_*` objects should cover the full `tier_rects_local.play` rectangle
  (−1750 to +960 x, −720 to +740 y). Gaps larger than 100 m = warn ("skyline hole").

#### Cultural authenticity

- **TKTS steps** — `BLD_TS_TKTSDuffySquare` must be present and positioned within 5 m of
  `landmarks_local.W45th_y` on the Broadway axis.
- **One Times Square** — `BLD_TS_OneTimesSquare` must be positioned at local (0, −249) ± 10 m.
  It is the visual anchor; any placement error breaks the bowtie read.
- **Broadway diagonal** — the bowtie intersection (7th Ave × Broadway × W45th) is the spatial
  signature of Times Square. The `TERRAIN` collection must contain `TER_*` objects whose footprints
  cover the triangular plazas at this intersection.
- **Nasdaq curved screen** — `BLD_TS_1022610` or its `AD_*` children must include at least one
  slot with `"shape": "curved"` and `"kind": "billboard"`.
- **Signage era** — all `AD_*` slots use emissive LED materials (`MAT_SLOT_*` driven by `M_LED_SlotTemplate`).
  No static painted-wall slots in the hero tier. Check `slot.kind` ≠ "billboard" with `slot.tier` = "hero"
  unless it is also `"shape": "flat"` with height > 10 m.
- **Props** — `PROPS` collection must contain at least: street lights (`PROP_TS_StreetLight*`),
  news kiosks (`PROP_TS_NewsKiosk*`), and yellow taxi instances (`PROP_TS_Taxi*`).
  Their absence makes the street feel empty regardless of building quality.
- **Atmosphere — time-of-day coverage** — `NG_TOD` (time-of-day driver) must be connected to
  emission strength on all `MAT_SLOT_*` materials. Disconnected = export produces dark screens at night.
  Check via `_freeze_tod()` logic in `export_district.py`: if `undo` list is empty after calling it,
  no materials are wired to TOD → error.

#### Scoring output

```
NYC Times Square Score: 87 / 100

Architecture:   22 / 25   One building (BLD_TS_ParamountBuilding) placed 12 m from expected position.
Culture:        24 / 25   All cultural landmarks present. Nasdaq curved screen confirmed.
Density:        18 / 25   Far ring has a 140 m gap at the northeast corner (no FAR_ objects covering it).
Atmosphere:     23 / 25   All 175 slots wired to TOD. PROPS present but no news kiosks found.

Flags:
  [WARN] BLD_TS_ParamountBuilding: center at (−43, −162) — expected near (−30, −164). Off by 12 m.
  [WARN] FAR_ gap: no objects covering local rect [290, 300] to [430, 410].
  [INFO] PROP_TS_NewsKiosk: 0 instances found. Real Times Square has ~6 on this block range.
```

---

## Role 2 — Business Critic

**Mission:** Would a real brand pay money for this slot? Score every ad position as if you were
a media buyer at Nike, Coca-Cola, or a Broadway show — and identify gaps where revenue is being
left on the table.

### Primary inputs

| File | What to read |
|---|---|
| `data/times_square/slots.json` | All 175 slots: `center`, `normal`, `aspect`, `tier`, `width_m`, `height_m`, `status` |
| `data/times_square/properties.json` | Building names, centers, heights — for context labels |
| `data/times_square/nav.json` | Spawn positions and nav paths — proxy for pedestrian flow |
| `config/districts/times_square.json` | `landmarks_local` (plazas), `tier_rects_local`, `lod_distances_m` |
| `data/times_square/demo_brands.json` | Currently filled slots — baseline occupancy |

### Scoring model — six axes, 0–100 each

```
composite = (
  0.30 × visibility        # solid-angle estimate: area × cos(view_angle) / distance²
  0.25 × pedestrian_flow   # proximity to nav spawns and plaza centers
  0.20 × neighbor_quality  # density of other premium slots within 80 m
  0.10 × sign_height       # 8–25 m sweet spot for street-level photography
  0.10 × photo_potential   # proximity to landmarks × aspect ratio bonus
  0.05 × brand_suitability # aspect vs. format (9x16 → fashion/entertainment, 8x1 → wayfinding/F&B)
)
```

**Visibility** — computed from `slot.center`, `slot.normal`, `slot.width_m × slot.height_m`, and
the three plaza centers (`DuffySquare` at (0, −5), `BroadwayPlaza` at (0, −85), `Bowtie` at (0, −164)):

```python
area = slot.width_m * slot.height_m
for plaza in PLAZAS:
    d = distance(slot.center, plaza)
    cos_a = max(0, dot(slot.normal, unit_toward(slot.center, plaza)))
    score += area * cos_a / (d ** 2)
visibility = clamp(normalise(score) * TIER_WEIGHT[slot.tier], 0, 100)
# TIER_WEIGHT: hero=1.0, premium=0.85, standard=0.65
```

**Sign height** — `slot.center[2]` (Z in local metres, Blender Z-up):

```python
z = slot.center[2]
# Peak score 8–25 m; falls off above 25 m (hard to frame from street) and below 4 m (obstructed)
sign_height = 100 * gaussian(z, mu=16, sigma=10)
```

**Photo potential** — proximity to `landmarks_local` entries + aspect bonus:

```python
ASPECT_PHOTO_BONUS = {"9x16": 1.0, "1x1": 0.9, "3x4": 0.85, "16x9": 0.7, "4x1": 0.4, "8x1": 0.3, "2x1": 0.5}
nearest_landmark_dist = min(distance(slot.center[:2], lm) for lm in landmarks)
photo = (1 / (1 + nearest_landmark_dist / 120)) * ASPECT_PHOTO_BONUS[slot.aspect] * 100
```

### Pricing tiers

| Tier label | Composite | Suggested positioning |
|---|---|---|
| Landmark | 90–100 | One Times Square crown, Nasdaq curve, TKTS facing |
| Premium | 75–89 | Main bowtie faces, high-flow intersections |
| Standard | 55–74 | Side streets, upper floors, non-plaza-facing |
| Value | < 55 | Far-ring, narrow alleys, rear-facing slots |

### Gap analysis

Beyond scoring existing slots, the Business Critic identifies **missing inventory**:

- **Social chokepoints with no slot** — nav nodes where pedestrian flow is high but no `AD_*`
  slot is within 30 m. These are revenue gaps. Flag with suggested slot position and aspect.
- **Unsold clusters** — groups of 3+ adjacent slots all with `"status": "available"`.
  Investigate whether poor score or missing discoverability is the cause.
- **Aspect ratio mismatches** — a 9x16 slot facing a very wide street (≥ 30 m) wastes vertical
  real estate. A 16x9 slot at eye level (< 6 m) is wasted as a horizontal banner at ground level.
- **Occlusion pairs** — two slots whose bounding boxes overlap significantly when projected from
  any of the three plaza viewpoints. The lower-composite slot should be reviewed for repositioning.

### Per-slot card (sales team output)

```
── ts.1tsq.ad03 ────────────────────────────────────────
  Building:        One Times Square (BLD_TS_OneTimesSquare)
  Face:            South (toward W42nd St)
  Shape / Aspect:  flat · 9x16 · 4.2 m × 22 m
  Height above street: 14 m  ✓ (sweet spot)

  Visibility:        94 / 100
  Pedestrian flow:   91 / 100
  Neighbor quality:  87 / 100
  Sign height:       88 / 100
  Photo potential:   96 / 100
  Brand suitability: 89 / 100
  ─────────────────────────────
  COMPOSITE:         92 / 100  ★ LANDMARK

  Best brand categories:  Fashion · Entertainment · Tourism · Tech
  Worst fit:              Industrial · B2B SaaS · Insurance
  Est. daily impressions: 540,000 (plaza-facing, 22 m tall)

  Note: Slot is at 14 m — well within photo zone. Ideal for brands
        that want street-level selfie integration (9x16 fills a phone screen).
────────────────────────────────────────────────────────

── ts.1024686.wrap01 ────────────────────────────────────
  Building:        1024686 (mid-tier, W44th block)
  Shape / Aspect:  wrap · 4x1 · 18.3 m × 4.6 m
  Height above street: 7 m

  COMPOSITE:         61 / 100  STANDARD

  Note: Wrap faces W44th (low flow). Nearest plaza 210 m.
  Recommendation: Pair with ts.1024686.wrap02 as a two-slot bundle.
  Issue: slot normal points 22° off perpendicular to W44th St.
         Rotate yaw by −22° in Blender (Engineer task).
─────────────────────────────────────────────────────────
```

### Inventory summary (district-level)

```
AD INVENTORY — Times Square · 175 slots

  Landmark  (90–100):  14 slots   ████████░░   avg CPM $$$$
  Premium   (75–89):   48 slots   ████████████████████████░
  Standard  (55–74):   79 slots
  Value     (<55):     34 slots

  Highest-value unsold gap:
    Broadway × W47th St — no slot within 40 m of betweenness-centrality peak 0.84.
    Suggested: flat slot on BLD_TS_1022633 north face, 9x16, 5 m × 8.9 m at Z=12 m.
    Estimated composite if added: 79 (Premium).
```

---

## Role 3 — UX Critic

**Mission:** A first-time visitor just spawned at Duffy Square. Can they find everything interesting,
do they know where to go next, and do they want to stay? Evaluate navigation clarity, exploration
reward, and social engagement.

### Primary inputs

| File | What to read |
|---|---|
| `data/times_square/nav.json` | Spawn positions, all `NAV_*` path splines, vehicle zones |
| `config/districts/times_square.json` | `spawns`, `vehicle_zones`, `lod_distances_m`, `tier_rects_local` |
| `data/times_square/properties.json` | Building centers, names (to test discoverability) |
| `data/times_square/slots.json` | Slot positions (to validate slot reachability from nav paths) |

### Checks

#### Navigation

- **Spawn reachability** — BFS from `SPAWN_player_DuffySquare` along all `NAV_roads` and `NAV_*`
  pedestrian paths. Every hero building must be reachable within 600 m of walk distance.
  Unreachable buildings = error. Reachable but > 400 m = warning.
- **Dead ends** — NAV nodes with degree 1 that are not declared spawn or terminal points.
  A pedestrian dead end breaks exploration flow. Flag the node position and suggest a connection.
- **Vehicle zone coverage** — car zone (`NAV_roads`) must cover the full hero tier rect.
  Bike zone must include `NAV_bike_BroadwayPlaza`. Ship zone must reach `NAV_water_Hudson`.
  Plane runway must exist at `SPAWN_plane_IntrepidDeck` with ceiling ≥ 600 m.
- **Crossing points** — at every avenue/street intersection in `street_grid_local`, there should
  be a nav path crossing. Missing crossings mean players can't cross the street.

#### Exploration & discoverability

- **Landmark sightlines from spawn** — cast a 2D ray from `SPAWN_player_DuffySquare` to each of
  the 11 hero building centers. If the ray passes through another hero building's footprint
  (from `footprints.geojson`), flag as occluded. ≥ 9 of 11 visible = good; fewer = warn.
- **Point-of-interest density** — within the hero tier rect, measure the average walk distance
  to the nearest named landmark. Target: no point > 120 m from a named building.
  Use `properties.json` building centers and `landmarks_local`.
- **Elevation variation** — flat terrain scores lower for exploration. Check `TER_*` objects for
  the TKTS steps (step geometry rising ~4.5 m), the Broadway Plaza level change (~0.5 m),
  and any sunken areas. Completely flat hero terrain = warn.
- **Unique destinations** — count buildings in `properties.json` with `display_name` non-empty
  within hero rect. Fewer than 15 named destinations in the hero zone = warn.

#### Engagement & social

- **Social chokepoints** — compute betweenness centrality on the nav graph. Top 5 nodes are
  natural photo spots and gathering points. Cross-reference with `slots.json`: is each of the
  top 5 served by a premium-or-better slot within 30 m?
  Gap = flag to Business Critic.
- **Time-of-day variation** — does the scene look meaningfully different at TOD 0.75 (night)
  vs. 0.25 (day)? Count emissive slots vs. total slots. Ratio < 0.4 = the night scene will feel
  dead. (Ties directly into the NYC Critic's TOD check.)
- **Vehicle activity** — are there taxi instances (`PROP_TS_Taxi*`) distributed along `NAV_roads`
  within the hero tier? Zero = the streets feel empty.
- **LOD pop** — `lod_distances_m` sets hero/mid/far transitions at 400/900/3000 m. The mid-ring
  buildings must visually bridge hero and far. Check that `MID_*` objects exist in the full
  `tier_rects_local.mid` rectangle. Gaps > 150 m between mid objects = visible pop-in.

#### Scoring output

```
UX Score: 78 / 100

Navigation:      21 / 30   2 pedestrian dead-ends (nav nodes 412, 671). All spawns reachable.
Discoverability: 24 / 30   9 / 11 hero buildings visible from spawn. BLD_TS_ParamountBuilding
                            and BLD_TS_750SeventhAve occluded at spawn angle.
Engagement:      20 / 25   Top social chokepoint (Broadway × W47th, betweenness 0.84) has
                            no premium slot within 40 m.
Atmosphere:      13 / 15   Taxi instances present. 62% of slots emissive at night. Good.

Flags:
  [ERROR] NAV node 412 at (−180, −310): dead end. Nearest connection: NAV_roads spline 7, distance 18 m.
  [ERROR] NAV node 671 at (220, 390):  dead end. Nearest connection: NAV_bike_BroadwayPlaza, distance 12 m.
  [WARN]  BLD_TS_ParamountBuilding sightline blocked by BLD_TS_1551Broadway from spawn.
          Clear angle at W45th × 7th — suggest camera hint or waypoint marker at that corner.
  [WARN]  BLD_TS_750SeventhAve partially occluded at spawn. Clear from W45th × 7th.
  [INFO]  Broadway × W47th social chokepoint: betweenness 0.84, no slot within 40 m → Business Critic.
  [INFO]  MID ring: 2 gaps > 150 m on northeast edge. LOD pop-in likely at lod_distance 900 m.
```

---

## Role 4 — Principal 3D Engineer Critic (Blender files)

**Mission:** Are the Blender source files correct, consistent, and production-ready? This role
audits the `.blend` files, Blender Python scripts, and the export pipeline against the rules
that the pipeline itself enforces — essentially an enhanced wrapper around the existing `validate.py`.

### Primary inputs

| File | What to audit |
|---|---|
| `scripts/blender/validate.py` | Existing rules — this critic extends them |
| `scripts/blender/ts_common.py` | `OBJECT_PREFIXES`, `SLOT_SHAPES`, `DISTRICT_COLLECTIONS` — the naming law |
| `scripts/blender/export_district.py` | Export correctness: chunk assignments, TOD freeze, GLB size, Draco |
| `blender/districts/times_square/times_square.blend` | Live scene: collection tree, scales, UVs, slot materials |
| `blender/library/materials.blend` | Library materials: `M_LED_SlotTemplate`, facade materials |
| `data/times_square/slots.json` | Cross-reference: every `AD_*/SHOP_*` in the blend must appear here |
| `export/times_square/*.glb` | Output validation: file sizes, presence of all chunks |

### Checks

#### Naming & collection tree

- **Object prefix law** — every object in the exported collections (`HERO`, `MID`, `FAR`, `TERRAIN`,
  `PROPS`, `SLOTS`, `LIGHTS`, `COLLISION`, `NAV`) must start with one of:
  `BLD_`, `AD_`, `SHOP_`, `COL_`, `LIGHT_`, `PL_`, `SPAWN_`, `NAV_`, `TER_`, `PROP_`, `FAR_`, `MID_`.
  Objects with `REF_` or `CAM_` must be in non-exported collections only.
- **Collection `exported` flag** — `REF` and `LOOKDEV` must have `exported = False`.
  All others must have `exported = True`. Mismatch = objects may silently vanish from GLBs.
- **Stray objects** — objects directly in `bpy.context.scene.collection` (root scene collection,
  outside the district tree) must be zero. Every object belongs to a named collection.
- **Hero override completeness** — all 11 `hero_overrides` from `times_square.json` must map to
  an existing Blender object. Missing objects = the game will fall back to procedural mid-tier geometry
  for landmark buildings.

#### Geometry & UV integrity

- **Unapplied scale** — any exported `MESH` object (except `COL_*` and `FAR_*`) with scale
  differing from (1, 1, 1) by > 0.0001 is a pipeline error. Normals and Draco compression
  both break on unapplied scale.
- **Slot UV range** — every `AD_*` and `SHOP_*` object must have a `UVMap` layer with all UV
  coordinates strictly within [0, 1]. Outside range = the placeholder art won't tile correctly
  and the game's texture swap will fail.
- **Slot material uniqueness** — each slot's material must be named `MAT_SLOT_<slot_id>` and
  must not be shared with any other object (`mat.users == 1`). Shared slot materials mean one
  brand purchase changes multiple screens simultaneously.
- **Missing materials** — no `MESH` object (except `COL_*`) may have a `None` material slot.
  Empty slots export as black faces with no texture path in the GLB.
- **Triangle budgets** — check against `times_square.json`:
  - hero tier: ≤ 450,000 tris
  - mid-per-chunk: ≤ 150,000 tris
  - far: ≤ 60,000 tris

#### Slot schema consistency

For every `AD_*` / `SHOP_*` object, all of these custom properties must be present:
`slot_id`, `kind`, `shape`, `tier`, `width_m`, `height_m`, `aspect`, `default_art`, `status`, `building`.

- `slot_id` must be globally unique across the scene.
- `shape` must be in `SLOT_SHAPES = ("flat", "curved", "wrap", "anamorphic")`.
- `kind` must be in `SLOT_KINDS = ("billboard", "storefront", "rooftop")`.
- `tier` must be in `SLOT_TIERS = ("hero", "premium", "standard")`.
- `default_art` must reference an existing file in `blender/library/textures/gen/`.
- Cross-reference: the `slot_id` must appear in `data/times_square/slots.json`. If it is in
  the blend but not in the JSON, the last export is stale — run `export_district.py` again.

#### Export pipeline integrity

- **All GLB chunks present** — `export/times_square/` must contain all 8 files:
  `collision.glb`, `far.glb`, `hero.glb`, `mid_n.glb`, `mid_s.glb`, `props.glb`, `terrain.glb`, `water.glb`.
  Missing = the world.json references a nonexistent file.
- **GLB size sanity** — `hero.glb` is the most complex chunk; a value < 500 KB suggests the export
  ran on an empty scene. A value > 80 MB suggests Draco compression is off.
  Expected range for Times Square hero: 2–35 MB.
- **Slots JSON staleness** — count `AD_*/SHOP_*` objects in the blend. If count ≠ `slots.json.count`,
  the JSON is out of sync with the blend. Run `export_district.py`.
- **TOD wiring** — `export_district.py._freeze_tod()` finds materials connected to `NG_TOD`.
  If zero materials are found, night rendering will show dark screens. Error.

#### Blender scripts linting

- All scripts in `scripts/blender/` must pass `ruff check` (the project's linter, configured in
  `biome.json`… actually in `pyproject.toml` at the workspace root for Python: `ruff check .`).
- No script should `import bpy` at module level without guarding it behind `HAS_BPY` (pattern
  established in `ts_common.py`). Breaking this prevents the directors/critics from importing
  shared helpers in headless Python.
- Hero scripts (`scripts/blender/heroes/*.py`) must each define a `build(prefix, colls, district)`
  function with that exact signature — the pattern used by `prep_buildings.py` to dispatch them.

#### Scoring output

```
Principal 3D Engineer Score: 91 / 100

Naming & collections:  28 / 30   1 stray object in scene root (CAM_Review_old). Should be in LOOKDEV.
Geometry & UVs:        24 / 25   All scales applied. All slot UVs within range.
                                  1 non-COL_ mesh (MID_TS_1084890) has a None material slot.
Slot schema:           25 / 25   All 175 slots valid. No duplicate IDs. All schema fields present.
Export pipeline:       14 / 20   hero.glb: 42 MB ✓. mid_n.glb: 0.3 MB — suspiciously small.
                                  Slots JSON: blend has 175 slots, JSON has 175 ✓.
                                  TOD wiring: 312 materials found ✓.

Flags:
  [WARN]  Object "CAM_Review_old" in scene root collection. Move to TS_LOOKDEV.
  [ERROR] MID_TS_1084890: None in material slot 2. Will export as black face.
  [WARN]  mid_n.glb: 0.3 MB. Expected > 2 MB for mid-north chunk. Last export may have run on
          an empty selection. Re-run export_district.py with full district loaded.
  [INFO]  script: build_nav.py does not define connect_dead_end() yet (needed by Engineer for UX flag).
```

---

## Director summary — how the four roles interact

```
                        VIRTUAL WORLD DIRECTOR
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                       ▼                       ▼
  NYC TS Critic          Business Critic           UX Critic          Eng Critic (Blender)
  87 / 100               (175 slots scored)        78 / 100           91 / 100
        │                      │                       │                       │
        └──────────────────────┴───────────────────────┴───────────────────────┘
                               │
                    Merged issue list (ranked)
                               │
                    PRINCIPAL 3D ENGINEER
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
        slots_tool.py    build_nav.py      hero scripts
        (fix normals,    (connect dead     (reposition
         add slots)       ends)             buildings)
```

### Priority order for the Engineer

1. **Errors from Eng Critic** — broken materials, unapplied scales, stale exports.
   These make the export wrong regardless of anything else.
2. **Errors from UX Critic** — nav dead-ends. Players cannot move past these.
3. **Errors from NYC Critic** — missing hero buildings. The scene is not Times Square without them.
4. **Warnings from Business Critic** — slot normal errors, missing high-value inventory.
   Revenue impact: high.
5. **Warnings from NYC/UX critics** — density gaps, sightline issues, LOD pop.
   Polish: medium.
6. **Info flags** — suggestions with no immediate correctness impact.

---

## Running the critics (planned CLI)

```bash
# Full director run — all four critics, dry-run, markdown report
uv run scripts/director/director.py --district times_square

# Single critic
uv run scripts/director/critics/business_critic.py --district times_square

# Engineer dry-run — show tasks without executing
uv run scripts/director/engineer.py --district times_square --dry-run

# Engineer execute — runs Blender headlessly for auto-fixable tasks only
blender --background blender/districts/times_square/times_square.blend \
        --python scripts/director/engineer.py -- --district times_square --execute
```

Reports are written to `scripts/director/reports/times_square_YYYYMMDD.md` and `.json`.
The JSON report is consumed by the viewer's Director overlay (planned: slot hover shows score card).

---

## Implementation notes (built 2026-10-02)

The critics are implemented in `scripts/director/` and read ground truth from
`config/districts/<district>_truth.json` (real positions/heights measured from NYC data) instead of the
hard-coded values above. Corrections vs. the original spec:

| Spec said | Reality (used by the critics) |
|---|---|
| One Times Square at (0, −249) | ~(22, −214): −249 is the W 42nd St centreline |
| TKTS within 5 m of W45th | Duffy Square, W 46th→47th St (steps y 121–138) |
| One Times Square 116 m | 102.7 m roof (NYC data), ~117 m with mast |
| Nasdaq = `BLD_TS_1022610` | `BLD_TS_FourTimesSquare` (BIN 1085682) |
| Hero buildings ≥ 80 m | per-building ranges; TKTS, W49th corner, podium-modelled heroes are `low_rise` |
| `PROP_TS_StreetLight*` | `StreetLamp` (prop counts come from the Blender scene report) |
| Hero scripts define `build(prefix, colls, district)` | hero scripts expose `run()` and set `result` |
| Plaza centres (0,−5), (0,−85), (0,−164) | `plazas` + `hotspots` in the truth file |

Run:

```bash
# 1. in Blender (district file open) - snapshot what only Blender knows
#    scripts/director/scene_report.py  -> data/<district>/scene_report.json
# 2. headless
.venv/bin/python scripts/director/director.py --district times_square            # all critics
.venv/bin/python scripts/director/director.py --district times_square --only business
.venv/bin/ruff check scripts                                                     # lint (pyproject.toml)
```

Reports: `scripts/director/reports/<district>_<YYYYMMDD>.md` / `.json` (ranked task list, per-slot business cards).
Not yet built: `engineer.py` (auto-applying `auto`-flagged fixes).

### Business model revisions (2026-10-02)
- **Facets:** `slots.json` now carries each screen's real faces (`facets`: centre, normal, area). Visibility sums
  over every face, so wraps / curved / corner screens are judged from every direction they face.
- **Foot traffic** is measured from the street in front of the screen's main face to the nearest plaza *surface*
  (ground.json) or hotspot, not to three points.
- **Visibility** uses a square-root curve over the 99th percentile (twice the size ≠ twice the value).
- **Photo potential**: a giant screen (> 1,200 m²) gets the full photo bonus whatever its aspect ratio.
- **Fame (new, 14%)**: screens on hand-built heroes (`hero_overrides`, truth heroes, the Marquis wall) carry an
  iconic premium the geometry cannot see. Weights now: .27 vis · .22 flow · .14 neighbours · .08 height ·
  .10 photo · .05 suitability · .14 fame.


---

## Deep critic review — 2026-10-03

The following reviews are written against the live codebase and reports dated 2026-10-03.
Every score, flag, and comment is grounded in the actual files:
`scripts/director/critics/*.py`, `scripts/director/reports/times_square_20261003.{md,json}`,
`viewer/index.html`, `scripts/blender/ts_common.py`, and the data files in `data/times_square/`.

---

### Existing Role 1 — NYC Times Square Critic (2026-10-03)

**Score: 98 / 100** — the best pass this district has ever had, but two wounds stay open.

#### What landed

The 2026-10-02 implementation note upgrades were consequential. The critic now reads actual
NYC building-measurement data from `config/districts/times_square_truth.json` instead of the
hard-coded constants in the original spec (One Times Square at (0, −249), TKTS at W45th, etc.).
Every single one of those constants was wrong, and fixing them means the critic is no longer
comparing the model against a fantasy. That matters enormously: a critic running against false
ground truth is worse than no critic at all.

The Nasdaq curve check (`shape == "curved" and building == truth["nasdaq_object"]`) now
correctly targets `BLD_TS_FourTimesSquare` (the real Nasdaq drum building, BIN 1085682),
not the placeholder `BLD_TS_1022610`. The curved slot is confirmed present. ✓

Plaza surface checks use `Polygon.buffer(15).contains(Point(xy))` against real ground polygons —
correct approach; you cannot verify a plaza exists by checking a single coordinate.

Density is genuinely tight: 19 hero cells, zero far-ring holes. The `far_gap_m` logic that
walks a 100 m grid, skips water/highway cells, and counts isolated empties is elegant. It
will not false-alarm on the Hudson waterfront.

#### What is still wrong

**Sightlines (3/10 heroes visible from spawn).**
The UX Critic catches this at 24/30 Discoverability, but the NYC Critic should care too.
In real Times Square, you can see One Times Square from at least four blocks in every direction.
The bowtie geometry exists *specifically* to create sightlines. The critic scores Architecture
25/25 because the buildings are present and positioned correctly — but does not penalise the
scene for blocking its own hero buildings from spawn. A `SIGHTLINE` sub-check belongs in
Architecture, not delegated entirely to UX.

**NewsKiosk: 0 placed, want ≥ 3.**
This has been a flag since the first run and has not moved. The `scatter_props.py` script and
`build_library_props.py` are both in the repo. The prop exists in the truth file under
`required_props`. There is no engineering reason this is still zero. The fix is one afternoon
of work. Every day it stays at zero, the streets look like a corporate rendering, not a city.

**56 mid-tier buildings outside height band.**
`BLD_TS_RcaBuilding_1076262` at 254.37 m is the worst offender — the real RCA Building
(30 Rockefeller Plaza) is 259 m, but that building is not in the Times Square district;
it is in the Midtown East mid-ring. The NYC data source is pulling a BIN that maps to the
wrong block. This is an INFO flag today, but it will produce visible absurdities once the
mid-ring receives detailed texturing. It should be escalated to WARN.

```
NYC Times Square Score: 98 / 100  (unchanged from 2026-10-02)

Architecture:   25 / 25   10 heroes checked, all positioned within tolerance.
                           LATENT: 3/10 heroes invisible from spawn — sightline sub-check missing here.
Culture:        25 / 25   3 plazas, Nasdaq curve confirmed on FourTimesSquare.
Density:        25 / 25   19 hero cells, 0 far holes, 0 water false-alarms.
Atmosphere:     23 / 25   177 TOD materials wired. NewsKiosk: 0 placed (want ≥ 3).

Flags:
  [WARN]  PROP_SHORT: NewsKiosk 0/3. Streets feel empty. One afternoon of work.
  [INFO]  HEIGHT_BAND: 56 mid-tier outliers. BLD_TS_RcaBuilding_1076262 at 254 m is likely
          a wrong-BIN import from NYC data. Escalate to WARN before mid-ring texturing.
  [MISS]  No sightline sub-check in Architecture. 3/10 heroes invisible from spawn is a
          cultural failure, not just a UX failure. Add HERO_SIGHTLINE here.
```

---

### Existing Role 2 — Business Critic (2026-10-03)

**Score: 58 / 100** — the scoring model is now more honest than the original spec, but that
honesty is exposing a fundamental inventory architecture problem.

#### What improved

The three model revisions from 2026-10-02 are all correct:

1. **Facets-based visibility.** Wraps and curved screens now score from every face they expose,
   not from a single `center` point that sits inside the building. This fixes the old model's
   systematic undervaluation of wrap slots. The implementation is clean:
   `facets(s)` falls back to single-face for older exports, so no migration debt.

2. **Foot traffic via plaza surface, not three points.**
   `plaza_area(ctx).distance(Point(front_of(s)))` is strictly better than
   `min(dist(center, three_plazas))`. The `front_of()` helper (10 m in front of the main face)
   is a smart approximation for "where a pedestrian actually stands looking at this screen."

3. **Fame bonus (14%).**
   `BLD_TS_OneTimesSquare`, `BLD_TS_FourTimesSquare`, the Marriott wall — these screens carry
   brand value the geometry cannot see. The 14% weight is defensible: it pushes `ts.1024714.wrap01`
   (One Astor Plaza) to 90 (Landmark) and `ts.1tsq.ad10` (One Times Square south face) to 85
   (Premium). Both feel right to anyone who has stood on those blocks.

#### What is still wrong — and it is structural

**61 Value slots out of 134 total (46%).** This is not a scoring calibration problem.
It is an inventory placement problem. The business critic is correctly identifying that
nearly half the ad slots are in locations where no real brand would pay landmark rates.
The slots were placed by a geometry-first process (put a screen on every eligible facade),
not a revenue-first process (find the 40 locations where a brand would write a cheque).
The correct fix is not to tune the scoring weights — it is to delete or reposition the
bottom-value slots and replace them with a smaller number of higher-quality positions.

**4 hero-tier slots scoring Value (48–54).**
`ts.1024714.crown01`, `ts.1024743.up03`, `ts.1024757.up08`, `ts.1076193.up04` — all tagged
`tier: "hero"` in `slots.json`, all scoring below 55. The `tier` field in the slot schema
is supposed to track *rendering fidelity* (hero = highest texel density), not *revenue value*.
But the business critic conflates them: it penalises a slot for being tagged `hero` when it
scores like a `Value` slot. That is a valid flag — the confusing naming is doing real damage.
Recommend renaming the slot tier field to `render_tier` to disambiguate it from the
business band. This is a schema change that affects `ts_common.py`, `slots.json`,
`engineer_critic.py`, and all the hero scripts.

**3 inventory gaps at high-betweenness junctions.**
`(-276, 76)`, `(-276, 148)`, `(-4, −84)` — these are nodes the betweenness centrality
calculation has identified as the highest-flow points in the district that have no premium
slot within 40 m. `(-4, -84)` is especially striking: that is essentially the Broadway
Plaza centre, the highest-traffic point in the entire district. There is one Landmark slot
(ts.1024714.wrap01 at One Astor Plaza, composite 90) in the district. At Broadway Plaza there
should be at least three.

**2 occlusion pairs.**
`ts.1022610.blade14 / ts.1022610.up06` and `ts.1024757.blade11 / ts.1024757.up05` overlap.
The detection logic (`dist2 < 3 and |Δz| < 3 and dot > 0.7`) is geometrically correct,
but the threshold is very tight. In a real Times Square media buy, two screens 4 m apart
facing the same direction would still occlude each other from any practical camera angle.
Widen the threshold to `dist2 < 8` and `|Δz| < 6`.

```
Business Score: 58 / 100  (unchanged from 2026-10-02 — model improved but inventory unchanged)

Inventory quality:  57.8 avg composite
  Landmark  (90–100):  1 slot    ← critically low for Times Square
  Premium   (75–89):  10 slots
  Standard  (55–74):  62 slots
  Value      (<55):   61 slots   ← 46% of inventory below sellable threshold

Top slot:    ts.1024714.wrap01   One Astor Plaza   composite 90   198k daily impressions
Worst gap:   Broadway × W42nd   betweenness-peak (-4, -84), no premium within 40 m
Revenue leak: ~61 slots delivering < 1/3 the impressions of a premium slot

Flags:
  [CRIT]  46% of slots are Value-band. Delete or reposition the bottom 30 before soft launch.
  [WARN]  Schema: rename slot `tier` to `render_tier` — collision with business band is causing
          real bugs (TIER_MISMATCH flags on perfectly valid hero-geometry slots).
  [WARN]  Broadway Plaza centre gap: the highest-traffic node in the district has no Landmark slot.
  [WARN]  Occlusion detection threshold too tight (dist2 < 3). Widen to dist2 < 8.
  [INFO]  Facets, foot-traffic, and fame model revisions: all three are improvements. Ship them.
```

---

### Existing Role 3 — UX Critic (2026-10-03)

**Score: 87 / 100** — Navigation is the open wound. Discoverability is intellectually dishonest
in one specific way. Engagement and Atmosphere are genuinely good.

#### What is good

The engagement score (25/25) is earned. Betweenness centrality on the road graph is the right
proxy for social chokepoints. Taxi instances are present. TOD-wired materials (177) cover all
134 slots with headroom. The `smooth()` interpolation in `index.html` for the day/night
transition — `t * t * (3 - 2 * t)` — is a smooth-step, which is exactly right; linear would
make sunrise and sunset feel mechanical.

The viewer itself is significantly better than the spec imagined. Orbit mode uses
`MapControls` with `zoomToCursor = true` — that single line makes the camera feel like
Google Earth. Walk mode has a collision-aware `placeWalker()` that spiral-searches for a
safe street position when you switch modes. The gamepad module exists. The ride mode (cab)
exists. The audio system exists. This is production-quality interaction design for a demo.

#### Navigation (23/30) — the real number is lower

The 23/30 score is computed correctly by the critic, but the framing is optimistic.
`NAV_FRAGMENTED: 44 pieces, 15 islands ≥ 8 nodes` means 14 plaza outlines that are not
connected to the street graph. In the viewer, a player who walks onto Broadway Plaza's outline
ring can become stranded. The critic calls this `auto`-fixable in `build_nav.py`. It has been
auto-fixable since the first report. It has not been fixed. Mark it **not auto** and assign it
to a named engineer task — auto flags that stay open across multiple runs become invisible noise.

Two dead ends at `(-56, 224)` and `(-44, 168)`: both are in the W49th St block, north of the
hero rect. These are OSM service stubs — real alleys that dead-end. The critic is right to flag
them, but the fix note ("Connect to nearest path") is underspecified. The correct fix for a
real alley dead end is a T-junction connection to the nearest avenue, not a stub connection.

#### Discoverability (24/30) — one misleading number

**3/10 heroes visible from spawn.** This is stated as `3/10` in the report but there are
10 heroes in the truth file, so it is actually `30% hero visibility from spawn`. That is
terrible. The original spec set 9/11 as the target (82%). The critic does not penalise
sufficiently: it deducts 0 points from Discoverability for this (the deduction trigger is
`visible < len(heroes) * 0.5`, and 3/10 = 30% which is below 50%, so it *should* deduct 6 pts
— but the section already has a fixed 24/30). Check: `30 - 6 = 24`. OK, the deduction is
happening. But the flag is INFO-level for each blocked building. Seven buildings blocked from
spawn is not INFO. It is WARN at minimum.

72 named places in the hero zone exceeds the 15-minimum, so POI density passes. But "named
places" includes procedural mid-ring buildings with BIN-derived display names. Those are
not destinations a first-time visitor would seek out. The `named_destinations_min` threshold
of 15 should be split: 15 *curated* names (display names written by a human) vs. any
non-empty string. The current count of 72 is almost certainly inflated by BIN-derived strings.

#### Atmosphere (15/15)

Perfect score. The LOD gap check (mid-ring 50 m cells more than 75 m from a mid building)
finds 0 gaps. The TOD wiring passes. This section is genuinely clean.

```
UX Score: 87 / 100

Navigation:      23 / 30   44-piece fragmented nav graph (15 sizeable islands unconnected).
                            2 dead ends in W49th block. All heroes reachable.
Discoverability: 24 / 30   3/10 heroes visible from spawn (30%). 72 named places.
                            LATENT: named_destinations count likely inflated by BIN-derived strings.
Engagement:      25 / 25   Chokepoints covered. Taxis present. Viewer interaction model is strong.
Atmosphere:      15 / 15   LOD gap: 0. TOD: 177 materials. Smooth-step day/night. Clean.

Flags:
  [ERROR]  NAV_FRAGMENTED: 15 plaza islands disconnected. 3 runs, still open. Remove `auto` tag.
  [WARN]   DEAD_END (-56, 224) and (-44, 168): underspecified fix. Need T-junction to avenue, not stub.
  [WARN]   SIGHTLINE: 7/10 hero buildings blocked from spawn. Flag level should be WARN, not INFO.
  [WARN]   named_destinations_min threshold mixes curated + BIN-derived names. Split the check.
  [INFO]   Viewer walk/orbit/ride interaction model is production-ready. The UX critic doesn't score it.
           Consider a Viewer Critic role (see Role 7 proposal below).
```

---

### Existing Role 4 — Principal 3D Engineer Critic (2026-10-03)

**Score: 100 / 100** — a clean run, and genuinely deserved. But perfection at 100 means
the checks are not hard enough yet.

#### What is solid

The export pipeline section is the strongest part. All 8 GLB chunks present.
`hero.glb` at 11.21 MB sits comfortably in the 0.5–35 MB window. `collision.glb` at 0.01 MB
is tiny but correct (collision proxies are low-poly by design). Total: 28 MB — tight enough
for a web-first product.

The lint run (`ruff check --quiet`) returns 0 issues. The `HAS_BPY` guard pattern is correctly
followed in `ts_common.py`, which means all the headless-Python consumers (directors, critics,
test scripts) can `import ts_common` without a Blender install.

0 stray root objects, 0 unapplied scales, 0 None material slots, 0 wrong-prefix objects,
0 leaked REF/CAM objects, 0 duplicate slot IDs, 0 slots-JSON staleness. That is a well-run
Blender file.

#### Where 100/100 is a warning sign, not a celebration

**Triangle budgets are not stressed.** Hero: 73,308 tris against a budget of 450,000 (16%).
Mid: 82,757 against 150,000/chunk (55%). Far: 31,133 against 60,000 (52%). These numbers say
the district is under-detailed, not well-optimised. At 73K hero tris, the hero buildings are
LOD2-quality geometry. A real Times Square hero building — One Times Square with its full
LED facade, the Nasdaq drum, the TKTS steps — should alone consume 30–50K tris. When real
hero scripts replace the procedural placeholders, the budget will be the only thing standing
between a playable frame rate and a slide show. The engineer critic should flag when tris
are *far below* budget, not just when they exceed it.

**134 slots for Times Square is thin.** The real Times Square has approximately 300–400
active digital screens. 134 slots is a solid beta, but the slot schema check (`25/25`) does
not comment on completeness, only correctness. Add a minimum slot count check
(e.g. `slots_min: 80`) to the truth file so the critic can catch accidental truncation.

**`slot_kind` enum is too narrow.**
`SLOT_KINDS = ("billboard", "storefront", "rooftop")` — the engineer critic validates against
this. But `ts_common.py` already has `"vehicle_screen"` and `"vehicle_topper"` in
`engineer_critic.py`'s local `kinds` tuple, while `ts_common.py` still only declares the
three. These are inconsistent. When a vehicle screen slot is added, one of these two files
will silently accept it and the other will reject it. Fix: move `SLOT_KINDS` expansion into
`ts_common.py` and import from there in both places.

**The `scene_report.py` TOD-wired detection is fragile.**
```python
if nd.type == "BSDF_PRINCIPLED" and "tod_export_strength" in nd
    and nd.inputs["Emission Strength"].is_linked:
```
This only counts Principled BSDF nodes that have a custom `tod_export_strength` property AND
a linked Emission Strength input. An emission-only material (common for LEDs) using an
`Emission` shader node instead of Principled BSDF will be missed. The current 177 count
may be lower than reality — which is better than a false zero, but still inaccurate.
Add a second pass: count `EmissionStrength`-linked nodes regardless of shader type.

```
Principal 3D Engineer Score: 100 / 100

Naming & collections:  30 / 30   Clean collection tree. 0 stray, 0 prefix violations.
Geometry & UVs:        25 / 25   0 unapplied scale, 0 None materials, 0 validate errors.
                                  Tris: hero 73K/450K (16%), mid 83K/150K (55%), far 31K/60K (52%).
Slot schema:           25 / 25   134 slots, 0 dup IDs, 0 schema violations, 0 art missing.
Export pipeline:       20 / 20   28 MB total, all 8 chunks present, 0 lint issues.

Flags:
  [WARN]  Hero tris at 16% of budget: geometry is placeholder-quality. Flag far-below-budget tris.
  [WARN]  SLOT_KINDS desync between ts_common.py and engineer_critic.py. Fix before vehicle slots land.
  [INFO]  TOD detection misses Emission shader nodes. 177 count may be a floor, not the real total.
  [INFO]  134 slots is beta coverage. Add slots_min check to truth file before calling inventory complete.
```

---

## New reviewer roles

---

### Role 5 — App Head of UI/UX

**Persona:** VP Design at a mid-size consumer app (think Citymapper, Waze, or a polished travel
product). Has shipped on iOS and Android, thinks in design systems and interaction patterns,
owns a WCAG 2.2 AA checklist, and has a very low tolerance for things that work but feel wrong.

**Mission:** Does this viewer feel like a premium consumer app, or a impressive technical demo
that someone forgot to finish?

#### Primary inputs

| File | What to read |
|---|---|
| `viewer/index.html` | All UI components: HUD, dock, loading, TOD slider, menu |
| `viewer/css/tokens.css` | Design tokens: spacing, type, colour |
| `viewer/js/settings.js` | Settings panel, progress persistence |
| `viewer/js/nav.js` | Tour, waypoints, fly-to transitions |
| `viewer/js/messages.js` | Toast / card system |
| `viewer/js/gamepad.js` | Keyboard + gamepad navigation |

#### Review

**Loading screen.** The loading screen has a `h1` "Times Square" and a progress bar. Correct
structure. But "Getting the lights on…" as the loading copy is a cliché. More importantly, if
the user is on a slow connection and the hero chunk stalls, they stare at an empty progress bar.
The bar increments `done / (first.length + 2)` — so it only moves to 5 steps total. On a 5 Mbps
connection loading 11 MB of hero.glb, the bar will sit at 40% for ~18 seconds with no visible
feedback. Add chunk-level progress (`xhr.onprogress`) to the GLTFLoader.

**The control dock.** The dock is bottom-right, which is fine on desktop. On mobile (phones),
bottom-right competes with the iOS/Android system gesture strip. The CSS does account for
`safe-area-inset-bottom` via `viewport-fit=cover` in the meta tag — good. But there is no
`padding-bottom: env(safe-area-inset-bottom)` applied to `#dock`. Check this on an iPhone 15
(home bar device): the bottom dock button may be cut off.

**Font and type scale.** The viewer uses `var(--font)` and `var(--t-body)` from `tokens.css`
(not read, but referenced consistently in `index.html`). If the token file defines
`--font: system-ui` or `-apple-system`, fine. If it is a web font loaded from a CDN, it is
a render-blocking resource on first load that makes the loading screen flash in a fallback
font. Worth auditing.

**Accessibility.**
- The district button `#districtbtn` has `aria-haspopup="menu"` and `aria-expanded` — correct.
- `#menu` items use `role="menuitem"` — correct.
- Dock buttons use `aria-label` — correct.
- `aria-pressed` on Explore/Walk/Ride — correct.
- **Missing:** The TOD slider `<input type="range">` has a `<label for="tod">` — good —
  but the dynamic value span (`<span id="todv"></span>`) is not aria-live. A screen reader
  user moving the slider hears the label but not the changing value. Add `aria-live="polite"`.
- **Missing:** The canvas element has no `role` or `aria-label`. It should have
  `role="application" aria-label="Times Square 3D viewer"`.
- **Missing:** The zoom buttons `#zoomin` / `#zoomout` have `aria-label` but the keyboard
  shortcut hint (`Zoom in (+)`) is only in the tooltip `<span>`, not in the label itself.
  A screen reader user will not discover the keyboard shortcut.

**The "What can I do?" button.**
This is the first item in the menu. It is the right call — users do not know what modes exist.
But it opens a help flow (presumably `nav.startTour()` or similar) via `#whatbtn`. The tour
and the "What can I do?" help are the same flow? Or different? If they are the same, having
both "What can I do?" and "Take the 60-second tour" is redundant. If they are different, the
difference is not communicated. Audit and consolidate.

**The business screen purchase flow.**
`<button id="bizmenu">For businesses: screens for sale</button>` — this is a great CTA.
But it is buried in a hamburger menu behind "Times Square ▾". A business buyer landing on a
direct link (`?business=1` is supported in the viewer code) should see the business panel
immediately without hunting through the menu. The `?business=1` URL param already does this.
Make sure this URL is what gets shared in sales decks, not the bare URL.

**First-time experience.**
The viewer flies in from `[60, -330, 210]` down to `HERO_VIEW` (top of the red steps) over
4.2 seconds. This is a good establishing shot. The skip mechanism (any click/keydown) is
correct. But the welcome card and the sound prompt fire sequentially — `nav.onWelcomeClosed = askSound`.
On mobile, both cards will appear in the lower portion of the screen simultaneously if the
welcome card is slow to close. Define explicit z-index and positioning rules for toast stacking.

**Summary score (UI/UX App lens): 72 / 100**

```
App UI/UX Score: 72 / 100

Interaction model:     28 / 35   Orbit/Walk/Ride trio is solid. Double-click-to-fly is discoverable.
                                  Walker placement spiral-search is clever. Gamepad exists.
                                  -7: No chunk-level load progress. Dock safe-area gap on iOS.
Accessibility:         16 / 25   ARIA on interactive controls is mostly correct.
                                  -9: range slider value not aria-live, canvas unlabelled,
                                  keyboard shortcuts hidden from screen readers.
Visual polish:         16 / 20   TOD transition smooth. Bloom is tasteful (0.1 day, 0.45 night).
                                  -4: Loading copy generic, first-visit card/sound toast stacking unresolved.
Information design:    12 / 20   Business CTA buried. "What can I do?" and Tour may be redundant.
                                  -8: No landmark label overlay in orbit mode (no "One Times Square" on hover).

Flags:
  [WARN]  No chunk-level XHR progress: 18+ second stall on slow connections at 40% bar.
  [WARN]  #dock missing safe-area-inset-bottom padding: cut off on home-bar iPhones.
  [WARN]  TOD slider value span needs aria-live="polite".
  [WARN]  Canvas needs role="application" aria-label.
  [INFO]  "What can I do?" vs "Take the tour": audit for redundancy.
  [INFO]  ?business=1 deep link exists but is not surfaced in UI. Put it in the bizmenu handler.
```

---

### Role 6 — Google Earth Head of Engineering

**Persona:** Engineering lead who spent a decade on Google Earth's rendering, data ingestion,
and streaming infrastructure. Thinks in tile hierarchies, LOD budgets, GPU memory, and
streaming latency. Has very strong opinions about coordinate systems and floating-point precision.

**Mission:** Would this hold up at scale — more users, more districts, more geometry?
Is the engineering foundation correct?

#### Review

**Coordinate system: correct but underdocumented.**
`ts_common.py:geo_to_local()` implements a flat-earth tangent-plane projection with CCW
rotation to align Manhattan's grid. This is geometrically correct for a district-scale scene
(< 5 km across; error vs. true spherical projection is < 0.01%). The 29° grid rotation is
right (Manhattan avenues run ~29° from true north). But the function does not carry an epoch
or datum. If a second data source uses WGS84 heights and this one uses orthometric heights
(NAVD88), you will get buildings floating 30 cm above the terrain. Document the datum. One
comment line. Do it now, before you have 10 districts and a mysterious 30 cm offset.

**GLB streaming: no HTTP range request support.**
`loadChunk(path)` calls `gltf.load(ROOT + path, ...)` — a single full-file fetch.
The hero.glb is 11 MB. On a 10 Mbps connection that is ~9 seconds to first rendered geometry.
Google Earth solved this in 2001 with incremental mesh streaming. The three.js ecosystem
has `GLTFLoader` with no built-in range support, but the chunks are already split
(`hero`, `terrain`, `props`, `water` load first; `mid_n`, `mid_s`, `far` stream after).
That partial-streaming strategy is correct. The problem is within each chunk: a 11 MB hero.glb
has no internal streaming. Consider splitting hero into `hero_core` (One Times Square,
Four Times Square, the TKTS steps, ≤ 3 MB) and `hero_fill` (remaining hand-modelled
buildings, ≤ 8 MB). The user sees iconic geometry 3× faster.

**Floating-point precision at world scale.**
`const B = (x, y, z) => new THREE.Vector3(x, z, -y)` — all Blender local coordinates
passed directly into Three.js world space. Current hero rect is roughly ±500 m. At that
scale, 32-bit float has ~0.03 mm precision: fine. But once you add a second district
(e.g. Midtown East, ~2,500 m from Times Square), you will hit the classical large-world
precision problem. The camera is ~2,500 m from the origin; z-fighting starts below ~5 m
object size. The district config already has `district_world_offset()` in `ts_common.py`.
The viewer does not use it — it always renders at Blender-local coords. When district 2
arrives, you will need either camera-relative rendering or a 64-bit double-emulation trick
(common in large-world engines). Plan for it now; retrofitting it into a live product is painful.

**Draco compression is on.** Good. `DRACOLoader` with the CDN decoder. But the decoder is
loaded from `cdn.jsdelivr.net` — if that CDN is down, every district fails to load.
Self-host the Draco decoder WASM (it is 4 files, ~400 KB total). The GLB chunks are already
self-hosted; the decoder should be too.

**Collision system.**
`collision.glb` is 0.01 MB — that is ~10 KB, which is a very low-poly proxy. The
`Collider` class (`js/collision.js`) does point-in-polygon building detection and
ray-cast ground finding. This is the right architecture. But 0.01 MB for the entire
Times Square collision mesh is suspiciously small. A real pedestrian system needs
collision geometry for: building footprints (yes), stairs (TKTS steps: 4.5 m rise),
elevated plazas, subway entrances, kiosk obstructions. If the collision proxy is just
building footprint rectangles extruded to infinite height, walking up the TKTS steps
will not work. The `groundAt()` raycaster in `index.html` uses the full scene geometry
for ground detection, which is correct — but heavy. Separate collision-for-walking from
collision-for-buildings.

**WebGL2 fallback.**
The viewer detects missing WebGL2 and shows a text message. Correct. But WebGL2 is available
in 99%+ of browsers as of 2026. The check is fine as a safety net; it is not a real bottleneck.

**The optimizeChunk() call.**
`optimizeChunk(g.scene)` is called on every loaded chunk (unless `?noopt`). Without reading
`js/optimize.js` fully, the intent is to merge draw calls. This is the right instinct —
a naive Three.js scene with one draw call per building will crush mobile GPUs. The perf
stats are stored in `perf.chunks` but there is no in-app display of them (they appear to
be for debugging only). Add a `?perf` URL flag that surfaces these numbers in the UI.

**Summary score (Google Earth Engineering lens): 76 / 100**

```
Google Earth Eng Score: 76 / 100

Data pipeline:         22 / 25   Coordinate system correct, tangent-plane projection valid.
                                  -3: Datum/epoch not documented. Will bite at district 2.
Streaming:             16 / 25   Chunk-split streaming strategy is correct.
                                  -9: No intra-chunk streaming. hero.glb 11 MB loads as single blob.
                                  Draco decoder from CDN: single point of failure.
Precision & scale:     18 / 25   Fine at 1 district. Float precision cliff at ~2,500 m from origin.
                                  camera-relative rendering not planned for.
Runtime performance:   20 / 25   optimizeChunk() merges draw calls. Collider is lightweight.
                                  -5: groundAt() raycast against full scene (expensive on mobile).
                                  Collision mesh 0.01 MB may lack stair/plaza geometry.

Flags:
  [ERROR]  No datum documented in geo_to_local(). Will cause ~30 cm height offsets at district 2.
  [WARN]   Draco decoder loaded from CDN. Self-host the 4 WASM files (~400 KB).
  [WARN]   Float precision: no camera-relative rendering plan for multi-district world.
  [WARN]   hero.glb 11 MB single-blob. Split into hero_core (≤3 MB) + hero_fill for faster first paint.
  [WARN]   groundAt() full-scene raycast is O(all triangles). Cache or limit to terrain chunk.
  [INFO]   perf.chunks data collected but not surfaced. Add ?perf flag.
```

---

### Role 7 — Apple Maps Design Team Head

**Persona:** Design director who led the Apple Maps 3D Flyover and Look Around features.
Obsessive about cartographic accuracy, visual hierarchy, how light conveys information,
and the exact moment a user transitions from "map reading" to "being there."
Will not ship a product where the scale feels wrong or the sky is the wrong shade at 6:47 PM.

**Mission:** Does this feel like a place, or does it feel like a map of a place?

#### Review

**The sky.** The sky shader is a two-colour gradient: `top` lerped from blue-day to dark-night,
`horizon` lerped through a dusk-orange pass then to a deep purple-night. This is correct at
a broad level. But the dusk transition peaks at `tod ≈ 0.5`, which corresponds to approximately
equal distance from noon and midnight — roughly 6 PM in the New York autumn. That is right.
However, the orange peak is `(0.9, 0.55, 0.35)` in linear RGB — this is a warm amber that
reads correctly on most displays, but under `AgXToneMapping` with `exposure = 1.0`, it will
be rendered darker than it appears in sRGB preview. The viewer uses `AgXToneMapping` —
the team should verify this on-device rather than in the browser inspector.

**The camera starting position.**
`HERO_VIEW = { eye: [-14.5, 137.5, 6.4], target: [16, -215, 40] }` — this is the top of the
TKTS red steps, looking toward One Times Square. It is the single best viewpoint in the district.
The viewer starts there after the 4.2-second fly-in. This is correct. Apple Flyover would
call this the "hero orbit path" — the view that establishes the place identity before the user
takes control. However, the target `[16, -215, 40]` is aimed at Z=40 m on One Times Square
— that is 40 m up the building, which means the first thing you see is the middle of the
facade, not the base and the street. Lower the target Z to 10–15 m so the composition shows
street + lower third of One Times Square, the way a human standing on the steps would look.

**The fog.**
`scene.fog = new THREE.FogExp2(0x0b0a14, 0.00012)` — exponential fog with a near-black
dark-blue base. This correctly softens the far-ring massing. The fog colour is updated at
every TOD change to match the horizon colour. That is thoughtful. But at night, the horizon
colour becomes `(0.11, 0.06, 0.12)` — a very dark purple. With `FogExp2` at density 0.00012,
buildings at 2 km start to fade. Times Square at night does not have dark purple fog —
it has a lit-from-below orange-yellow haze. The night fog colour should lean warm
(`0x1a0e05` or similar) not cool. This is a 5-minute fix that will make night mode feel
dramatically more authentic.

**The LED screen system.**
`DAY_RATIO` correctly distinguishes screen families: `MAT_SLOT_` and `M_LED_` get a 7/2.2
day/night ratio, light fixtures get lower ratios. Screens are `k = 0.55` scaled to EEVEE output.
This is careful work. The visual result — screens visible but not blinding in daytime,
dominant at night — is what Times Square actually looks like. One gap: there is no
*screen-off* state. Every screen is always on. In real Times Square at 5 AM, about 20% of
screens go into test pattern or dark mode. A `tod < 0.1 || tod > 0.95` (late night / early morning)
dim-all-screens pass would add authenticity without complexity.

**The crowd system.**
`crowd.js` and `tktsSeats()` exist. The TKTS steps have seated crowd. This is exceptional
detail — Apple would put this on a marketing slide. But the crowd density is set by a
single `crowd` slider (0–4000). In real Times Square, crowd density is radically
non-uniform: dense at crosswalks, thin at mid-block, clustered at the TKTS steps and
the Broadway Plaza railing. A spatially-weighted crowd distribution (higher density near
nav betweenness-centrality peaks) would make the scene read more accurately than a
uniform 1,500 crowd setting.

**The minimap.**
`#minimap` is a 440×440 canvas clipped to a circle, positioned bottom-left.
Apple Maps uses a similar orb-minimap. The implementation appears correct from the HTML.
But on a 375 px wide phone (iPhone SE), a 200 px diameter minimap is 53% of the screen width —
too large. The CSS should scale it with `min(200px, 40vw)`.

**Visual hierarchy — what is missing.**
In Apple's Flyover, every landmark has a label that appears on hover/tap. The viewer has no
landmark label system. You can fly at full speed toward One Times Square and never know its
name unless you double-click to trigger the building panel. The `properties.json` has
`display_name` for every named building. Surface them as world-space labels (HTML overlay
positioned from projected 3D coords) at orbit altitude > 100 m. This is a standard technique
(Three.js `Vector3.project(camera)` → CSS `translate()`). It transforms the viewer from
a beautiful rendering into a readable map.

**Summary score (Apple Maps Design lens): 71 / 100**

```
Apple Maps Design Score: 71 / 100

Cartographic accuracy:  18 / 25   Sky gradient: correct but dusk colour unverified under AgX.
                                   Night fog colour too cool (purple vs. warm NYC haze).
                                   Starting target Z too high: shows mid-facade, not street level.
Place identity:         20 / 25   TKTS starting view is correct. Crowd system with seated TKTS is exceptional.
                                   -5: No landmark labels. Beautiful rendering, unreadable map.
Visual refinement:      18 / 25   LED day/night ratio is right. Bloom values are tasteful.
                                   -7: No screen-off state at late night / early morning.
                                   Minimap too large on narrow phones.
Motion & transitions:   15 / 25   4.2s fly-in is the right duration. Smooth-step TOD is correct.
                                   -10: No orbit-altitude-sensitive level-of-detail for labels/HUD.
                                   No camera tilt limit at street level (can look straight down).

Flags:
  [WARN]  Night fog colour: change 0x0b0a14 to ~0x1a0e05 (warm haze). 5-min fix.
  [WARN]  HERO_VIEW target Z=40: lower to 10–15 m for street-level composition.
  [WARN]  No landmark labels. Add world-space HTML overlay from properties.json display_name.
  [WARN]  No screen-off state at tod < 0.1 or > 0.95.
  [INFO]  Crowd density uniform. Weight toward nav betweenness peaks for realism.
  [INFO]  Minimap size: cap at min(200px, 40vw) for narrow phones.
```

---

### Role 8 — Notion CXO

**Persona:** Chief Experience Officer at a productivity SaaS. Thinks in user journeys,
activation funnels, retention loops, and "what does this product want users to *do*".
Does not code. Will not read a GLB. Will read the HTML and ask "why would someone come back?"

**Mission:** Is this a product or a demo? What is the job-to-be-done, and does the experience
serve it?

#### Review

**There are two products in one viewer, and they fight each other.**

The viewer tries to be:
1. A consumer experience (walk Times Square, feel the city, see the lights)
2. A B2B ad-sales tool (buy a screen, upload your creative, see CPM data)

These are legitimate jobs-to-be-done. But they are served by the same UI — the same hamburger
menu with "Take the tour" next to "For businesses: screens for sale." A venture fund partner
demo-ing the product alongside a first-time tourist will have completely different expectations
and a completely different "aha moment." Mixing them in one undifferentiated experience means
neither gets a great first impression.

**The consumer job-to-be-done is not articulated.**
Why would a consumer come back to this after the first visit? The city looks the same every
time (except TOD, which is automatic). There is no collectible, no social layer, no reason
to return. Compare: Google Earth has satellite imagery updates. Apple Maps has Look Around
new imagery. Even Cyberpunk 2077 has new content. This viewer has 134 screens playing the
same demo brands. If the product team wants returning visitors, they need a reason to return:
a live event ticker, real-time brand campaigns, a "what's showing tonight" billboard board.
The `screens.js` playlist system exists and supports video. The infrastructure is there.
The content loop is not.

**The B2B job-to-be-done is almost served.**
The `?business=1` URL loads the business panel immediately. Per-slot cards exist with
CPM estimates. The "For businesses: screens for sale" CTA is in the menu. This is 80% of
a usable sales tool. The 20% missing:
- No price. Not even "starting from $X/day." The sales team cannot close a deal
  without a number on the screen.
- No "request a demo" or "get a proposal" CTA from within the business panel.
  The viewer knows the `sales_contact` from `world.json`. Put a mailto link in the panel.
- No shareable slot URL. If a buyer wants to send a colleague `"look at this specific screen,"
  there is no `?slot=ts.1024714.wrap01` deep link. It should be one line of code.

**Activation funnel for B2B:**
1. Land on viewer → 2. Find business CTA → 3. Browse slots → 4. Find a slot you like →
5. ??? → 6. Contact sales.

Step 5 does not exist. There is no "save this slot" or "enquire about this slot" action
from the per-slot card. Users fall off the funnel at step 4.

**The onboarding tour.**
A 60-second tour exists. This is correct for a complex 3D viewer where users do not
intuitively know what Walk mode does. But "60 seconds" is not 60 seconds on mobile with
a slow loading time. Measure the actual time from page load to tour-end on a median device
(Moto G, 4G). If it is > 90 seconds, users will have left before the tour starts.

**Progress persistence.**
`Progress.load()` saves the camera position and mode to localStorage. The "Welcome back"
toast fires for returning users. This is retention loop thinking — it is good. But
`localStorage` is cleared when users clear site data (common). A URL-param camera state
(`?cam=x,y,z,tx,ty,tz`) would be shareable and more persistent than localStorage.

**Summary score (Notion CXO lens): 61 / 100**

```
Notion CXO Score: 61 / 100

Product clarity:       12 / 25   Two products (consumer + B2B) in one UI. Neither fully served.
                                   No articulated reason to return for consumer.
B2B sales funnel:      18 / 25   Business panel exists. Slot cards have CPM data.
                                   -7: No price, no CTA from slot card, no shareable slot URL.
Onboarding:            18 / 25   60-second tour, "What can I do?", welcome card: right instincts.
                                   -7: Funnel from landing → business enquiry has a dead step 5.
Retention:              13 / 25  localStorage camera persistence is a nice touch.
                                   -12: No content loop, no reason to return for consumer user.

Flags:
  [CRIT]  No price on business panel. Funnel cannot close without it. Add "from $X/day" or
          "request pricing" button wired to world.json sales_contact.
  [WARN]  No shareable slot URL (?slot=). One line of code, huge sales impact.
  [WARN]  Consumer return loop missing. Live event ticker or rotating brand campaigns would help.
  [INFO]  Consider separate routes: /explore (consumer) and /advertise (B2B).
  [INFO]  localStorage progress: supplement with URL-param camera state for shareability.
```

---

### Role 9 — Mini SaaS Owner

**Persona:** Solo or tiny-team founder who has shipped a niche B2B SaaS and has $10k MRR.
Has strong opinions about CAC, churn, and unit economics. Will not pay for engineering they
cannot justify with revenue. Thinks the product is interesting but will immediately ask:
"Who pays for this, and how much?"

**Mission:** Is there a real business here? Can I validate it with the resources I have?

#### Review

**The business model is real, but unvalidated.**
The ad inventory model (sell digital screen time in a 3D virtual Times Square) has analogues:
virtual real estate in games (Fortnite brand activations), digital out-of-home (DOOH) media,
and metaverse advertising pilots by Nike, Gucci, etc. The total addressable market for DOOH
in the US is ~$9B/year. Times Square alone generates ~$300M/year in physical OOH revenue.
A virtual Times Square that captures 0.1% of that is $300K ARR. That is a fundable seed round.

**But: who is the first paying customer?**
The 134 slots are all `"status": "available"`. No slot has been sold. The `demo_brands.json`
exists to show placeholder creative — this is a sales tool, not a revenue stream. The first
paying customer is the real metric. The product is not a SaaS until someone wires money.

The B2B panel exists but has no pricing and no buy flow. A mini SaaS owner would:
1. Pick the 10 best slots (Landmark + top Premium).
2. Price them manually (call 3 real Times Square media buyers, get their CPM rates).
3. Put a Stripe payment link on those 10 slots.
4. Run a $500 Google/LinkedIn ad campaign targeting "DOOH media buyer" to the ?business=1 URL.
5. Measure conversion rate. If even one person clicks "enquire," validate that the TAM is real.

**The business critic score (58/100) is a product problem, not just a design problem.**
61 Value-band slots at the launch of a product means 61 inventory units that will never sell.
A SaaS owner would pull those immediately and reframe the pitch as "14 premium screens, limited
availability" — scarcity is a feature in media sales. The 134-slot breadth is an engineering
achievement, not a sales asset.

**The tech stack risk.**
Three.js, GLB, Draco, Blender Python — all are solid OSS with long track records.
The dependency on `networkx` and `shapely` in the Python critics is standard and fine.
The real risk is the Blender dependency for content updates. Every time a new district
or building is needed, someone with Blender skills must run the pipeline. That is a skilled
contractor cost (~$100/hr), not a low-cost SaaS marginal. The pipeline should be able to
update `demo_brands.json` and `slots.json` without touching Blender. The viewer already
supports dynamic brand replacement via `screens.js`. The ad-serving layer should be a
simple API call, not a Blender export.

**Pricing intuition.**
Based on the slot data:
- `ts.1024714.wrap01` (One Astor Plaza, 198k daily impressions): real Times Square equivalent
  would be ~$200-500K/month. Virtual equivalent at 1% of physical = $2,000-5,000/month.
- `ts.1022624.wrap01` (164k impressions): ~$1,500-3,500/month.
- Average Premium slot: ~$800-1,500/month.
- At 100% occupancy of 11 Premium slots: $8,800-16,500 MRR (~$100K-200K ARR).
- Realistic 30% occupancy at launch: $2,600-5,000 MRR.

That is a real business. But it requires the buy flow to exist.

**Summary score (Mini SaaS Owner lens): 55 / 100**

```
Mini SaaS Score: 55 / 100

Revenue model:         15 / 25   Correct TAM. Real analogue businesses exist. Model is plausible.
                                   -10: Zero paying customers. No validation yet.
Product-market fit:    12 / 25   Right buyers (DOOH media buyers, brands with event budgets).
                                   -13: No way to buy. Funnel ends at "look at this nice screen."
Tech sustainability:    18 / 25   Solid stack. Draco, Three.js, Python critics: all maintainable.
                                   -7: Content updates require Blender. Ad serving should be API-only.
Unit economics:        10 / 25   Pricing not set. Demo brands, not paying brands.
                                   -15: 61 Value-band slots dilute the pitch. Pull them before sales calls.

Flags:
  [CRIT]  No buy flow. Wire the top 10 slots to a Stripe payment link or Calendly demo request.
  [CRIT]  Pull the 61 Value-band slots from the sales deck. Lead with "14 premium positions."
  [WARN]  Ad serving (brand image updates) must not require a Blender export. It already doesn't
          in the viewer (screens.js). Make the gap explicit: a simple JSON/API update = new brand.
  [INFO]  Pricing estimate: $800-5,000/month per Premium slot. Validate with 3 DOOH buyer calls.
  [INFO]  Scarcity framing: "limited screens, high traffic" beats "134 slots available."
```

---

### Role 10 — New Yorker, Born & Brought Up

**Persona:** Grew up in the Bronx, has worked in Midtown for 20 years. Walks through Times
Square three or four times a week. Has strong opinions about what is wrong with tourists,
what the Red Steps actually feel like at 11 PM on a Friday, and exactly where the good halal
cart used to be before the Marriott expansion. Does not care about GLB files.

**Mission:** Does this feel like *my* Times Square? Not a postcard. *Mine.*

#### Review

**What you got right.**

The bowtie. You got the bowtie. The fact that Broadway and 7th Avenue converge into that weird
triangular block between 43rd and 47th Streets — that is the *whole thing*. Every other so-called
"Times Square" model I have seen (and I have seen a lot of them, believe me) puts buildings on
a regular grid and calls it done. The TKTS steps are there. The red steps at Duffy Square —
I have sat on those steps more times than I can count. That is the right decision. Starting
the viewer there is the right decision.

One Times Square is in the right place. It is not the tallest building there — it never has been,
everyone gets that wrong — but it is the *most important* building because it is the point of the
bowtie. You can see it from everywhere. The fact that your hero buildings list puts it at the
correct position, not the tallest height, tells me the person who made this actually did their
homework.

The night scene: the bloom on the screens, the colour temperature. Times Square at night is
not blue. It is not cool. It is orange and warm and somewhat overwhelming. The warm horizon fog
note from the Apple Maps reviewer above is correct — fix the fog colour.

**What is missing and why it matters.**

**The Marriott Marquis.** The `BLD_TS_NewYorkMarriottMarquisHotel_1024727` is present. But
the Marquis is not just a building — it is a *wall*. The west face of the Marriott from W45th
to W47th Street is one of the longest uninterrupted sign walls in Times Square. The business
critic picks it up as a `premium` slot. But visually, anyone who has stood on the island
in the middle of Broadway knows that wall dominates your view for two blocks. If the Marquis
wall is modelled as a flat facade with one wrap slot, that is wrong. It needs to feel massive.

**The smell of roasted nuts does not translate into 3D. I know. I know.**
But what does translate: the density of people. 1,500 crowd is the default, and Times Square
on a Friday night has 40,000–80,000 people visible at any given time. 1,500 feels like a
Tuesday morning in February. The crowd slider goes up to 4,000. Even 4,000 is not enough.
The crowd distribution also matters — people do not walk uniformly. They pool at crosswalks
and thin out mid-block. (See the Apple Maps reviewer's note on betweenness-weighted crowd density.)

**The traffic.** Where are the taxis? The report says taxi instances are present, but in
walk mode I want to feel the mass of yellow cabs sitting at lights on 7th Avenue. Times Square
traffic is not just cars moving — it is cars *stopped*, honking, waiting. The `NAV_roads` traffic
system exists. But in an outer-borough kid's memory, what makes Times Square real is the
specific gridlock pattern: 42nd Street, 44th Street, and 7th Avenue are always backed up.
If the traffic moves freely, it reads as downtown Columbus, not Midtown Manhattan.

**The subway.** There is no subway. I know, it is technically underground. But the green
globe lights for the 1/2/3/N/Q/R/S/7 entrance at 42nd Street — those are one of the most
recognisable objects in Times Square. They appear in every movie, every photo. They are small.
They are a prop. `PROP_TS_SubwayGlobe` in the `required_props`? Not there.
The material `M_Light_SubwayGreen` is referenced in the viewer's `DAY_RATIO` list, which means
*someone thought about this*. The material exists. The prop does not. Ship it.

**The scaffolding.** At any given time, at least 40% of Times Square buildings have
construction scaffolding — those ubiquitous grey steel-pipe sidewalk sheds. They are
architecturally inert, but they are *Times Square*. Their absence makes the scene feel like
a rendering-for-a-proposal, not the actual street. I am not asking for every scaffolding.
I am asking for 3 or 4 PROP_* instances in the right places. They are the dirt on the floor
that makes it feel real.

**The newsstands (news kiosks).** The critic already flagged this. It has been flagged
since the first run. Zero kiosks. These are everywhere. You cannot walk a block without seeing
one. There is a New York Times one on the island at 43rd and Broadway that has been there for
thirty years. Put the kiosk in. Please. It is one prop.

**One thing that surprised me — in a good way.**
The audio system. I have not heard it, but the fact that it exists, that there is a `CityAudio`
class, that sound is tied to the TOD system and activated on user gesture — someone on this
team actually cares about being there. Sound is 50% of Times Square. The visual stuff is easy.
It is the sound that gets you. The honking, the bass from the theatre marquees, the TKTS
announcements. If the audio layer is real, it is the most important feature in this product
that nobody is talking about.

**Summary score (New Yorker Born & Brought Up lens): 63 / 100**

```
New Yorker Score: 63 / 100

"Is this Times Square?":   22 / 35   Bowtie: yes. TKTS steps: yes. 1 Times Square: yes.
                                       Marriott Marquis wall: there but under-modelled.
                                       -13: No subway entrance globes. No scaffolding.
                                       Zero news kiosks (three runs, still zero).
Street life:               14 / 30   Crowd present but 1,500 is a Tuesday morning.
                                       Traffic moves too freely. Gridlock is the character of this place.
                                       -16: Crowd max 4,000 is insufficient. No congestion simulation.
Sound:                     15 / 20   CityAudio exists and respects user gesture. Hopeful.
                                       Cannot score without hearing it. Giving benefit of the doubt.
Soul:                      12 / 15   The choice to start at the red steps, not from the air: correct.
                                       The warm night sky: almost right (fix the fog).
                                       The one person who thought to add SubwayGreen to the material
                                       list and then didn't add the prop: I see you. Finish the job.

Flags:
  [CRIT]  Zero news kiosks. Three runs. One afternoon of work. No excuse.
  [WARN]  Crowd max 4,000 is insufficient for a Friday night. Raise slider max to 15,000.
          Weight density toward betweenness-centrality peaks (crosswalks, TKTS, Broadway Plaza).
  [WARN]  Subway entrance globe props missing. M_Light_SubwayGreen material exists. Finish it.
  [WARN]  Night fog too cool (purple). Should be warm NYC haze. 5-minute CSS colour change.
  [INFO]  Traffic should simulate gridlock on 42nd St and 7th Ave, not free flow.
  [INFO]  Construction scaffolding (3-4 PROP_* instances) would dramatically improve street authenticity.
  [INFO]  Marriott Marquis wall needs visual mass treatment, not just one wrap slot.
```

---

## Consolidated priority list across all 10 roles (2026-10-03)

| # | Severity | Source | Issue | Effort |
|---|---|---|---|---|
| 1 | CRIT | Notion CXO + Mini SaaS | No buy/enquire flow from slot card. Funnel dead at step 4. | S |
| 2 | CRIT | Mini SaaS | Pull 61 Value-band slots from sales pitch. Reframe as "14 premium positions." | S |
| 3 | CRIT | New Yorker | Zero news kiosks. Three runs. One afternoon. | S |
| 4 | ERROR | Eng + Google Earth | Datum not documented in `geo_to_local()`. Will cause height offsets at district 2. | XS |
| 5 | WARN | Business | 46% Value-band inventory = structural placement problem, not scoring drift. | L |
| 6 | WARN | Business | Slot `tier` field renamed to `render_tier` to prevent TIER_MISMATCH false positives. | M |
| 7 | WARN | Business | Broadway Plaza centre `(-4, -84)`: highest-traffic node, no Landmark slot within 40 m. | M |
| 8 | WARN | UX | NAV_FRAGMENTED: 15 plaza islands disconnected. Remove `auto` tag, assign engineer. | M |
| 9 | WARN | NYC + New Yorker | Subway entrance globe props missing (M_Light_SubwayGreen material exists). | S |
| 10 | WARN | App UX | No chunk-level XHR progress: ~18 s stall at 40% bar on slow connections. | S |
| 11 | WARN | App UX | #dock missing `safe-area-inset-bottom` padding on home-bar iPhones. | XS |
| 12 | WARN | App UX | TOD slider value not `aria-live`. Canvas not labelled. | XS |
| 13 | WARN | Google Earth | Draco decoder from CDN. Self-host 4 WASM files (~400 KB). | XS |
| 14 | WARN | Google Earth | No camera-relative rendering plan for multi-district world. | L |
| 15 | WARN | Apple Maps | Night fog colour `0x0b0a14` too cool (purple). Change to warm `~0x1a0e05`. | XS |
| 16 | WARN | Apple Maps | `HERO_VIEW` target Z=40 shows mid-facade. Lower to Z=10–15 for street comp. | XS |
| 17 | WARN | Apple Maps | No landmark labels (world-space HTML overlay from `display_name`). | M |
| 18 | WARN | New Yorker | Crowd max 4,000 insufficient. Raise to 15,000 + betweenness-weighted distribution. | M |
| 19 | INFO | Notion CXO | Shareable slot URL `?slot=<slot_id>`. One line. | XS |
| 20 | INFO | NYC | Add `HERO_SIGHTLINE` sub-check to Architecture section (not just UX). | S |

**Effort key:** XS = < 1 hour · S = half day · M = 1–3 days · L = 1+ week
