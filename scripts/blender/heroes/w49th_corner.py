"""Hero: low corner building, SW corner of 7th Ave x W 49th St (merges lots 1024777/1024778/1024786).

Reference (user photo 4): 4-storey building whose upper floors are wrapped by a rounded corner LED screen,
two rooftop billboards on steel legs above it, sandwich-shop storefront at street level, "W 49 St" sign.
"""
import math
import os
import sys

import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import ts_common as C  # noqa: E402
import slots_tool as S  # noqa: E402
import hero_common as H  # noqa: E402
from import_footprints import add_building  # noqa: E402

BINS = ("1024777", "1024778", "1024786")
OBJ = "BLD_TS_W49thCorner"
KEY = "w49"
ROOF = 14.5
X0, X1, Y0, Y1 = -39.0, -17.7, 286.6, 304.2      # merged footprint (7th Ave face at X1, 49th St face at Y1)
FOOTPRINT = [(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)]
CR = 2.6                                          # rounded corner radius of the screen
MATS = ["M_Facade_BrickBuff", "M_Roof_Membrane", "M_Paint_Black", "M_Metal_Steel", "M_Glass_CurtainBlue",
        "M_Stone_GraniteDark", "M_Metal_Aluminium"]


def run():
    tree = C.ensure_district_tree("TS")
    coll = C.ensure_collection("TS_HERO_W49thCorner", tree["HERO"])
    scoll = C.ensure_collection("TS_SLOTS_W49thCorner", tree["SLOTS"])
    H.retire_blockout(*[f"BLD_TS_{b}" for b in BINS])
    i = MATS.index
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    add_building(bm, uvl, FOOTPRINT, ROOF, i("M_Facade_BrickBuff"), i("M_Roof_Membrane"), (16, 16), (1, 1))
    # ground-floor shopfront glazing (slightly proud) + granite base + parapet cap
    add_building(bm, uvl, H.scaled(FOOTPRINT, 1.01), 4.2, i("M_Glass_CurtainBlue"), i("M_Paint_Black"),
                 (12, 16), (1, 1), z0=0.3)
    add_building(bm, uvl, H.scaled(FOOTPRINT, 1.012), 0.3, i("M_Stone_GraniteDark"), i("M_Stone_GraniteDark"),
                 (2.3, 2.3), (1, 1))
    add_building(bm, uvl, H.scaled(FOOTPRINT, 1.01), 0.5, i("M_Metal_Aluminium"), i("M_Metal_Aluminium"),
                 (1, 1), (1, 1), z0=ROOF)

    made = []
    # rounded corner LED wrap on the upper floors: 7th Ave face (going north) -> corner arc -> 49th St face
    off = 0.6
    ex, ny = X1 + off, Y1 + off
    arc_c = (ex - CR, ny - CR)
    path = [(ex, Y0 + 3.0)] + [(arc_c[0] + CR * math.cos(math.radians(a)), arc_c[1] + CR * math.sin(math.radians(a)))
                               for a in range(0, 91, 10)] + [(X0 + 2.0, ny)]
    sz0, sz1 = 5.0, 13.6
    made.append(S.wrap(f"AD_TS_{KEY}_wrap1", scoll, f"ts.{KEY}.wrap1", path, sz0, sz1, tier="hero",
                       building=OBJ, aspect="4x1").name)
    for o in (scoll.objects[f"AD_TS_{KEY}_wrap1"],):
        for p in o.data.polygons:
            p.use_smooth = True
    # screen housing / top & bottom bezels following the same path, just behind it
    for a, b in zip(path, path[1:]):
        L = math.dist(a, b)
        yaw = math.atan2(b[1] - a[1], b[0] - a[0])
        inward = (-(b[1] - a[1]) / L, (b[0] - a[0]) / L)
        mid = ((a[0] + b[0]) / 2 + inward[0] * 0.35, (a[1] + b[1]) / 2 + inward[1] * 0.35)
        S._box(bm, i("M_Paint_Black"), (mid[0], mid[1], (sz0 + sz1) / 2), (L + 0.05, 0.6, sz1 - sz0 + 0.6), yaw)
    # two rooftop billboards on steel legs, one over each street face (photo 4: twin rooftop boards)
    legs = 2.5
    for k, (cx, cy, yaw_d) in enumerate(((X1 - 1.0, Y0 + 9.0, -90), (X0 + 10.5, Y1 - 1.0, 0))):
        w, h = 11.0, 5.5
        zc = ROOF + legs + h / 2
        made.append(S.flat(f"AD_TS_{KEY}_roof{k + 1}", scoll, f"ts.{KEY}.roof{k + 1}", (cx, cy, zc), w, h,
                           yaw_deg=yaw_d, kind="rooftop", tier="premium", building=OBJ, frame=bm,
                           frame_mat=i("M_Paint_Black"), aspect="2x1").name)
        yaw = math.radians(yaw_d)
        fwd = (-math.sin(yaw), math.cos(yaw))
        right = (-math.cos(yaw), -math.sin(yaw))
        for s in (-0.35, 0.0, 0.35):           # legs + diagonal braces behind the board
            lx, ly = cx + right[0] * w * s - fwd[0] * 1.2, cy + right[1] * w * s - fwd[1] * 1.2
            S._box(bm, i("M_Metal_Steel"), (lx, ly, ROOF + (legs + h) / 2), (0.25, 0.25, legs + h), yaw)
            S._box(bm, i("M_Metal_Steel"), (lx - fwd[0] * 1.5, ly - fwd[1] * 1.5, ROOF + legs / 2 + 0.6),
                   (0.18, 3.2, 0.18), yaw)
        # catwalk with rail along the bottom of each board
        S._box(bm, i("M_Metal_Steel"), (cx + fwd[0] * 0.3, cy + fwd[1] * 0.3, ROOF + legs - 0.6), (w + 0.6, 1.0, 0.12), yaw)
    # storefront signs (sandwich shop on 49th St, second shop on 7th Ave)
    made.append(S.flat(f"SHOP_TS_{KEY}_01", scoll, f"ts.{KEY}.shop01", (-28.0, Y1 + 0.45, 4.0), 12.0, 1.3,
                       kind="storefront", tier="standard", building=OBJ, aspect="8x1").name)
    made.append(S.flat(f"SHOP_TS_{KEY}_02", scoll, f"ts.{KEY}.shop02", (X1 + 0.45, 293.0, 4.0), 10.0, 1.3,
                       yaw_deg=-90, kind="storefront", tier="standard", building=OBJ, aspect="8x1").name)
    H.finish(OBJ, bm, MATS, coll, made, FOOTPRINT, ROOF, bld_id="+".join(BINS), bin=BINS[0], year=1925,
             display_name="7th Ave & W 49th St corner", address="SW corner of 7th Ave & W 49th St, New York, NY")
    H.marker_light("PL_TS_w49_corner", (X1 + 10, Y1 + 10, 9.0), 1500.0)
    return {"building": OBJ, "slots": made}


result = run()
