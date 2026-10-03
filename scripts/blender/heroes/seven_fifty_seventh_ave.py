"""Hero: 750 Seventh Avenue (7th Ave, W 49th -> W 50th St, east side). Replaces blockout BLD_TS_1084667.

Reference (user photo 1): a dark glass tower with spiralling setbacks; at the 7th Ave x 49th St corner a
podium wrapped by a continuous LED ribbon, a big 3D-illusion corner screen (the pink "box") above it,
"750" lettering on the podium wall, and a deli storefront with awning at street level.
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

BIN = "1084667"
OBJ = "BLD_TS_750SeventhAve"
KEY = "750"
ROOF = 161.1
PODIUM = 16.0
FOOTPRINT = [(87.8, 378.4), (87.9, 353.4), (86.2, 353.4), (86.2, 329.1), (85.4, 329.1), (85.5, 324.3),
             (13.8, 324.3), (13.7, 383.5), (85.1, 383.5), (85.1, 378.4)]
CORNER = (13.2, 323.7)          # screen corner, 0.6 m proud of the 7th Ave x 49th building corner
# spiral setbacks: (z0, z1, scale, anchor corner)
TIERS = [(PODIUM, 105.0, 0.86, (87.8, 383.5)), (105.0, 135.0, 0.70, (87.8, 324.3)),
         (135.0, ROOF, 0.55, (13.7, 383.5))]
MATS = ["M_Glass_CurtainDark", "M_Roof_Membrane", "M_Stone_GraniteDark", "M_Paint_Black", "M_Metal_Aluminium",
        "M_Glass_CurtainBlue", "M_Paint_DarkGrey", "M_Light_StoreSign"]
FONT = "/System/Library/Fonts/Avenir Next.ttc"


def run():
    tree = C.ensure_district_tree("TS")
    coll = C.ensure_collection("TS_HERO_750SeventhAve", tree["HERO"])
    scoll = C.ensure_collection("TS_SLOTS_750SeventhAve", tree["SLOTS"])
    H.retire_blockout("BLD_TS_1084667")
    i = MATS.index
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")

    # podium: granite base course, storefront glazing, dark spandrel body
    add_building(bm, uvl, H.scaled(FOOTPRINT, 1.003), 0.6, i("M_Stone_GraniteDark"), i("M_Roof_Membrane"),
                 (2.3, 2.3), (1, 1))
    add_building(bm, uvl, FOOTPRINT, 4.6, i("M_Glass_CurtainBlue"), i("M_Roof_Membrane"), (12.0, 16.0), (1, 1),
                 z0=0.6)
    add_building(bm, uvl, FOOTPRINT, PODIUM - 5.2, i("M_Glass_CurtainDark"), i("M_Roof_Membrane"), (24.0, 32.0),
                 (1, 1), z0=5.2)
    for z in (5.0, 11.8, PODIUM - 0.4):  # metal cornice / belt lines
        add_building(bm, uvl, H.scaled(FOOTPRINT, 1.006), 0.45, i("M_Metal_Aluminium"), i("M_Metal_Aluminium"),
                     (1, 1), (1, 1), z0=z)
    # tower with spiral setbacks
    for z0, z1, k, anchor in TIERS:
        add_building(bm, uvl, H.scaled(FOOTPRINT, k, anchor), z1 - z0, i("M_Glass_CurtainDark"),
                     i("M_Roof_Membrane"), (24.0, 32.0), (1, 1), z0=z0)
        add_building(bm, uvl, H.scaled(FOOTPRINT, k * 1.004, anchor), 0.6, i("M_Metal_Aluminium"),
                     i("M_Metal_Aluminium"), (1, 1), (1, 1), z0=z1 - 0.6)
    # rooftop mechanical screen
    top = H.scaled(FOOTPRINT, 0.55, TIERS[-1][3])
    add_building(bm, uvl, H.scaled(top, 0.6), 7.0, i("M_Paint_DarkGrey"), i("M_Roof_Membrane"), (4, 4), (1, 1),
                 z0=ROOF)

    made = []
    # LED ribbon around the corner, sold as 4 segments (west face, corner wrap, two on 49th St)
    rz0, rz1 = 6.0, 11.4
    made.append(S.wrap(f"AD_TS_{KEY}_rib1", scoll, f"ts.{KEY}.rib1", [(13.2, 362.0), (13.2, 340.0)], rz0, rz1,
                       tier="premium", building=OBJ, aspect="4x1").name)
    made.append(S.wrap(f"AD_TS_{KEY}_rib2", scoll, f"ts.{KEY}.rib2", [(13.2, 339.6), CORNER, (29.6, 323.7)],
                       rz0, rz1, tier="hero", building=OBJ, aspect="4x1").name)
    made.append(S.wrap(f"AD_TS_{KEY}_rib3", scoll, f"ts.{KEY}.rib3", [(30.0, 323.7), (52.0, 323.7)], rz0, rz1,
                       tier="premium", building=OBJ, aspect="4x1").name)
    made.append(S.wrap(f"AD_TS_{KEY}_rib4", scoll, f"ts.{KEY}.rib4", [(52.4, 323.7), (74.4, 323.7)], rz0, rz1,
                       tier="standard", building=OBJ, aspect="4x1").name)
    # ribbon housing (behind the strip) + top/bottom lips
    for (a, b) in (((13.75, 362.5), (13.75, 324.3)), ((13.75, 324.3), (75.0, 324.3))):
        L = math.dist(a, b)
        yaw = math.atan2(b[1] - a[1], b[0] - a[0])
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        S._box(bm, i("M_Paint_Black"), (mid[0], mid[1], (rz0 + rz1) / 2), (L, 0.9, rz1 - rz0 + 0.5), yaw)
        for z in (rz0 - 0.3, rz1 + 0.3):
            S._box(bm, i("M_Metal_Aluminium"), (mid[0], mid[1], z), (L + 1.2, 1.6, 0.18), yaw)

    # anamorphic corner screen above the ribbon (photo 1: the pink 3D box)
    az0, az1 = 13.0, 33.0
    made.append(S.anamorphic(f"AD_TS_{KEY}_3d01", scoll, f"ts.{KEY}.3d01", CORNER, (0, -1), 13.0, (1, 0), 13.0,
                             az0, az1, tier="hero", building=OBJ, aspect="2x1").name)
    # its housing: an L-shaped box rising above the podium roof
    # housing sits strictly behind both wings (starts 0.15 m inside the corner so it never pokes through)
    S._box(bm, i("M_Paint_Black"), (CORNER[0] + 0.95, CORNER[1] + 7.25, (az0 + az1) / 2), (1.6, 13.9, az1 - az0 + 0.8), 0)
    S._box(bm, i("M_Paint_Black"), (CORNER[0] + 7.25, CORNER[1] + 0.95, (az0 + az1) / 2), (13.9, 1.6, az1 - az0 + 0.8), 0)
    S._box(bm, i("M_Paint_DarkGrey"), (CORNER[0] + 7.5, CORNER[1] + 7.5, (PODIUM + az1) / 2),
           (13.0, 13.0, az1 - PODIUM), 0)
    S._box(bm, i("M_Metal_Aluminium"), (CORNER[0] + 7.0, CORNER[1] + 7.0, az1 + 0.5), (15.0, 15.0, 0.3), 0)

    # "750" lettering on the 7th Ave podium wall, north of the ribbon (photo 1 left of the screens)
    H.lettering(bm, "750", i("M_Light_StoreSign"), (13.25, 370.0, 7.4), math.radians(90), 4.2, depth=0.25,
                font_path=FONT)

    # deli storefront: sign slot + awning on 49th St near the corner, second shop on 7th Ave
    made.append(S.flat(f"SHOP_TS_{KEY}_01", scoll, f"ts.{KEY}.shop01", (26.0, 323.2, 4.3), 14.0, 1.1,
                       yaw_deg=180, kind="storefront", tier="standard", building=OBJ, aspect="8x1").name)
    S._box(bm, i("M_Paint_Black"), (26.0, 322.2, 3.55), (14.4, 2.2, 0.25), 0)          # awning canopy
    made.append(S.flat(f"SHOP_TS_{KEY}_02", scoll, f"ts.{KEY}.shop02", (13.1, 350.0, 4.3), 12.0, 1.1,
                       yaw_deg=90, kind="storefront", tier="standard", building=OBJ, aspect="8x1").name)
    S._box(bm, i("M_Paint_Black"), (12.1, 350.0, 3.55), (12.4, 2.2, 0.25), math.radians(90))

    H.finish(OBJ, bm, MATS, coll, made, FOOTPRINT, ROOF, bld_id=BIN, bin=BIN, year=1989,
             display_name="750 Seventh Avenue", address="750 7th Ave, New York, NY")
    H.marker_light("PL_TS_750_corner", (CORNER[0] - 12, CORNER[1] - 12, 18.0), 2500.0)
    return {"building": OBJ, "slots": made}


result = run()
