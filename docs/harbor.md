# New York Harbor

From Midtown's southern edge (~W 31st St) to below the Statue of Liberty. It covers:
- the Hudson down past Lower Manhattan;
- the Jersey City and Hoboken waterfront;
- the edge of Brooklyn;
- Governors, Ellis and Liberty Islands.

It uses the same local frame as Times Square (anchor 40.758, −73.9855; grid rotated 29°), so nothing is offset.

| Step | Command | Output |
|---|---|---|
| NYC building footprints, surveyed roof heights (NYC Open Data 5zhs-2jue) | `python3 scripts/blender/fetch_footprints.py harbor` | `data/harbor/footprints.geojson` |
| OSM coastline, piers, New Jersey buildings (mirror: maps.mail.ru) | `python3 scripts/blender/fetch_harbor_osm.py harbor` | `data/harbor/osm.json` |
| NYC borough boundaries clipped to the shoreline (NYC Open Data gthc-hcne) | `curl …/gthc-hcne.geojson` | `data/harbor/boroughs.geojson` |
| Land, buildings, piers, collision, landmarks | `.venv/bin/python scripts/tools/prep_harbor.py harbor` | `data/harbor/harbor.json`, `collide.json`, `places.json` |
| Meshes | `blender -b --factory-startup -P scripts/blender/build_harbor.py` | `export/harbor/land.glb`, `buildings.glb` |
| Statue of Liberty | `blender -b --factory-startup -P scripts/blender/heroes/statue_of_liberty.py` | `export/harbor/liberty.glb` |
| Texture caps | `.venv/bin/python scripts/tools/shrink_textures.py --district harbor` | (in place) |

## What's real

- **Land:**
  - New York side (12.8 km²): NYC's official borough boundaries, clipped to the shoreline. These include Liberty, Ellis and Governors Islands.
  - New Jersey (15.6 km²): the district box cut along OpenStreetMap's complete New Jersey coastline. Manhattan's OSM coastline has gaps here, which is why it isn't used.
  - The islands are lawn green. Everything stands on a concrete seawall down into the water.
- **Buildings:**
  - 11,055 NYC footprints at their surveyed roof heights, plus 6,154 New Jersey buildings from OSM (height tags, or 3.2 m per floor).
  - Facade styles follow the same era and height rules as Times Square, with the same materials, including lit windows at night.
  - Low buildings more than 450 m inland are left out; you can't see them from the water or the air.
  - The result is about 291k triangles in 118 merged cells.
- **One World Trade Center:** the footprint data stops at the roof ring (429.3 m). A spire is added up to the true 541.3 m (1,776 ft), with a beacon.
- **Piers:** 133 OSM piers over the water, decks at +1.2 m.
- **Statue of Liberty:** National Park Service dimensions.
  - Ground to torch tip 92.99 m; foundation 19.81 m, granite pedestal 27.13 m, statue 46.05 m.
  - Heel to top of head 33.86 m; head 5.26 m.
  - Fort Wood's 11-pointed star, the pedestal's loggias and 40-disc frieze, the crown's 25 windows and 7 rays, the tablet (7.19 × 4.14 m, "JULY IV MDCCLXXVI"), and the gilded flame.
  - Position: the centre of her pedestal's footprint in NYC's data. She faces the Narrows (bearing ~135°).
  - At night she's floodlit and the torch glows (`M_Light_LibertyFlood`, `M_Light_LibertyTorch` in `DAY_RATIO`).

## In the game

- **Loading:** the harbour streams in after Midtown: 4.4 MB (land 0.3, buildings 4.0, statue 0.1).
- **Frame rate:** 60 fps measured over Times Square, over the river and at the Statue.
- **Search:** the Statue of Liberty, Ellis Island, Governors Island, The Battery, One World Trade Center, Exchange Place, the Hoboken waterfront and Pier 25.
- **Boat (helm.js):**
  - It treats the real shorelines and harbour piers as land and piers, and Liberty Island is solid.
  - You can now drive from Pier 83 to the Statue: about 9 km, roughly 25 minutes at full ahead.
  - The south edge of the district is the edge of the map for now.
- **Plane (flight.js):**
  - It can fly anywhere over Midtown and the harbour.
  - Harbour towers (`collide.json` footprints as rotated rectangles with heights) and the Statue count as obstacles.
- **Rendering:**
  - Camera far plane 16 km, with the near plane growing with altitude.
  - The sky dome is drawn first.
  - The river disc is 14 km across and fades into haze by ~11 km.
- **Water reflections:** the river reflects only the real sky (a cube shot of the sky dome, re-shot as the light changes): a bright sheen by day, dark water at night. It never reflects the lighting photo, which would put a street or a waterfront in the open harbour.

## Not yet

- The full map and minimap only cover Times Square; the harbour shows as dark there.
- Streets aren't modelled in the harbour: the land is a flat surface between buildings. It's fine from the water and the air, but it isn't walkable.
- No Staten Island Ferry or Statue ferries yet. The Narrows (Verrazzano Bridge) are outside the district.
- The Statue's figure is shaped by code. Its silhouette and proportions are true, but fingers and fine facial detail are simplified.
