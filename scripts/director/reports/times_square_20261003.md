# Director report: times_square
_2026-10-03 11:10_

| Critic | Score |
|---|---|
| Principal 3D Engineer | **100 / 100** |
| UX | **87 / 100** |
| NYC Times Square | **98 / 100** |
| Business | **61 / 100** |

## Principal 3D Engineer: 100 / 100

- **Naming & collections** 30 / 30
- **Geometry & UVs** 25 / 25
- **Slot schema** 25 / 25: 110 slots
- **Export pipeline** 20 / 20: 26 MB total

## UX: 87 / 100

- **Navigation** 23 / 30: 2020 nav nodes
- **Discoverability** 24 / 30: 3/10 heroes visible from spawn, 72 named places
- **Engagement** 25 / 25: chokepoints, vehicles
- **Atmosphere** 15 / 15: 181 TOD materials

## NYC Times Square: 98 / 100

- **Architecture** 25 / 25: 10 heroes checked
- **Culture** 25 / 25: 3 plazas, Nasdaq curve
- **Density** 25 / 25: 19 hero cells, 0 far holes
- **Atmosphere** 23 / 25: TOD wiring, street props

## Business: 61 / 100

- **Inventory quality** 61.2 / 100: avg composite 61; bands {'Landmark': 3, 'Premium': 10, 'Standard': 64, 'Value': 33}

### Ad inventory

Bands: {'Landmark': 3, 'Premium': 10, 'Standard': 64, 'Value': 33}

| Slot | Building | Aspect | z | Composite | Band | Est. daily impressions |
|---|---|---|---|---|---|---|
| ts.1024686.wrap01 | BLD_TS_ThreeTimesSquare | 4x1 | 20.0 | 93 | Landmark | 168,442 |
| ts.1tsq.ad10 | BLD_TS_OneTimesSquare | 16x9 | 15.4 | 92 | Landmark | 167,512 |
| ts.1024706.base01 | BLD_TS_ParamountBuilding | 4x1 | 13.0 | 91 | Landmark | 145,715 |
| ts.1024714.wrap01 | BLD_TS_OneAstorPlaza | 4x1 | 17.0 | 89 | Premium | 198,000 |
| ts.1024727.wrap01 | BLD_TS_NewYorkMarriottMarquisHotel_1024727 | 4x1 | 20.0 | 85 | Premium | 165,482 |
| ts.1551bway.tower01 | BLD_TS_1551Broadway | 1x1 | 33.0 | 85 | Premium | 145,035 |
| ts.1551bway.wrap01 | BLD_TS_1551Broadway | 4x1 | 9.8 | 84 | Premium | 137,633 |
| ts.4tsq.ad01 | BLD_TS_FourTimesSquare | 16x9 | 31.5 | 82 | Premium | 113,562 |
| ts.4tsq.ad02 | BLD_TS_FourTimesSquare | 4x1 | 13.4 | 77 | Premium | 87,297 |
| ts.1076844.wrap02 | BLD_TS_1540Broadway | 4x1 | 18.0 | 76 | Premium | 69,123 |
| ts.1076844.main01 | BLD_TS_1540Broadway | 16x9 | 19.0 | 75 | Premium | 54,233 |
| ts.1076844.wrap01 | BLD_TS_1540Broadway | 4x1 | 18.0 | 75 | Premium | 112,225 |
| ts.1tsq.ad01 | BLD_TS_OneTimesSquare | 1x1 | 88.5 | 75 | Premium | 29,550 |
| ts.1551bway.blade01 | BLD_TS_1551Broadway | 9x16 | 31.0 | 74 | Standard | 48,793 |
| ts.4tsq.ad03 | BLD_TS_FourTimesSquare | 1x1 | 20.5 | 74 | Standard | 37,925 |

## Engineer task list (ranked)

1. **[WARN] business · INVENTORY_GAP**: Busy junction (-276, 76) (betweenness 0.14) has no premium slot within 40 m  
   → Add a 9x16 or 16x9 slot on the nearest facade facing this junction
2. **[WARN] business · INVENTORY_GAP**: Busy junction (-276, 148) (betweenness 0.13) has no premium slot within 40 m  
   → Add a 9x16 or 16x9 slot on the nearest facade facing this junction
3. **[WARN] business · INVENTORY_GAP**: Busy junction (-4, -84) (betweenness 0.12) has no premium slot within 40 m  
   → Add a 9x16 or 16x9 slot on the nearest facade facing this junction
4. **[WARN] business · OCCLUSION_PAIR**: ts.1022610.blade14 and ts.1022610.up06 overlap  
   → Remove or move the lower-scoring slot
5. **[WARN] business · OCCLUSION_PAIR**: ts.1024757.blade11 and ts.1024757.up05 overlap  
   → Remove or move the lower-scoring slot
6. **[WARN] business · TIER_MISMATCH**: ts.1024757.up08 (BLD_TS_1024757) tagged hero but scores 50 (Value)  
   → Re-tier to standard or reposition toward a plaza
7. **[WARN] nyc · PROP_SHORT**: NewsKiosk: 0 placed, want >= 3  
   → Add to scripts/blender/build_library_props.py + scatter_props.py
8. **[WARN] ux · DEAD_END** `auto`: Nav dead end at (-56.0, 224.0)  
   → Connect to nearest path (build_nav.py)
9. **[WARN] ux · DEAD_END** `auto`: Nav dead end at (-44.0, 168.0)  
   → Connect to nearest path (build_nav.py)
10. **[WARN] ux · NAV_FRAGMENTED** `auto`: Nav graph has 44 pieces; 15 islands of >= 8 nodes (e.g. plaza outlines) are not joined to the street network  
   → Link each plaza ring to the nearest road node in build_nav.py
11. **[INFO] nyc · HEIGHT_BAND**: 56 mid-tier buildings outside plausible height band (e.g. BLD_TS_RcaBuilding_1076262 254.37 m); source is NYC data, verify before overriding
12. **[INFO] nyc · SPARSE_BLOCKS**: 2/19 hero blocks have < 3 buildings (large single-building blocks such as the Marriott are real)
13. **[INFO] ux · SIGHTLINE**: BLD_TS_FourTimesSquare hidden from spawn by BLD_TS_1022610 (+1)  
   → Waypoint/minimap star helps; landmarks above the blocker still read
14. **[INFO] ux · SIGHTLINE**: BLD_TS_750SeventhAve hidden from spawn by BLD_TS_1022686 (+5)  
   → Waypoint/minimap star helps; landmarks above the blocker still read
15. **[INFO] ux · SIGHTLINE**: BLD_TS_W49thCorner hidden from spawn by BLD_TS_1087187 (+2)  
   → Waypoint/minimap star helps; landmarks above the blocker still read
16. **[INFO] ux · SIGHTLINE**: BLD_TS_ParamountBuilding hidden from spawn by BLD_TS_MinskoffTheatre_1024714 (+1)  
   → Waypoint/minimap star helps; landmarks above the blocker still read
17. **[INFO] ux · SIGHTLINE**: BLD_TS_1551Broadway hidden from spawn by BLD_TS_1088568 (+0)  
   → Waypoint/minimap star helps; landmarks above the blocker still read
18. **[INFO] ux · SIGHTLINE**: BLD_TS_OneAstorPlaza hidden from spawn by BLD_TS_NewYorkMarriottMarquisHotel_1024727 (+0)  
   → Waypoint/minimap star helps; landmarks above the blocker still read
19. **[INFO] ux · SIGHTLINE**: BLD_TS_ThreeTimesSquare hidden from spawn by BLD_TS_1024706 (+1)  
   → Waypoint/minimap star helps; landmarks above the blocker still read
20. **[INFO] business · UNSOLD**: 110/110 slots available (pre-launch: expected)
21. **[INFO] engineer · LINT**: ruff: 2 issues (e.g. scripts/tools/prep_harbor.py:10:8: F401 [*] `json` imported but unused)  
   → ruff check --fix scripts
