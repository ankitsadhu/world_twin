"""Hero: 4 Times Square (Condé Nast / Nasdaq MarketSite), 151 W 42nd St. Replaces blockout BLD_TS_1085682.

Reference (user photo 2): the Nasdaq MarketSite cylinder at the Broadway x 43rd St corner, a curved LED
drum ~37 m tall above a 2-storey glass studio, logo band at its foot; glass tower behind with setbacks,
crown signs near the top (~225 m roof per NYC data), a second rounded corner at Broadway x 42nd St.
"""
import math
import os
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import ts_common as C  # noqa: E402
import slots_tool as S  # noqa: E402
from import_footprints import add_building  # noqa: E402

BIN = "1085682"
OBJ = "BLD_TS_FourTimesSquare"
KEY = "4tsq"
ROOF = 224.6

FOOTPRINT = [(124.8, -173.6), (124.5, -232.4), (95.3, -232.2), (95.3, -234.6), (72.7, -234.4), (68.2, -233.1),
             (64.3, -230.3), (62.5, -228.1), (60.9, -224.6), (49.5, -184.7), (49.4, -181.7), (49.6, -180.2),
             (50.5, -178.2), (51.9, -176.4), (54.4, -174.7), (57.2, -173.9)]
NASDAQ_C = (58.2, -182.2)       # cylinder centre (corner arc of the footprint)
NASDAQ_R = 10.6                 # drum radius: proud of both building lines by ~2.5 m
NASDAQ_ARC = (20.0, 250.0)      # degrees CCW from +X: 43rd St side -> Broadway side
SW_C, SW_R, SW_ARC = (72.5, -224.6), 10.2, (165.0, 285.0)   # rounded Broadway x 42nd corner

# setback tiers: (z_from, z_to, scale toward centroid)
TIERS = [(0.0, 152.0, 1.0), (152.0, 196.0, 0.88), (196.0, ROOF, 0.74)]

MATS = ["M_Glass_CurtainDark", "M_Roof_Membrane", "M_Metal_Steel", "M_Paint_Black", "M_Metal_Aluminium",
        "M_Glass_CurtainBlue", "M_Stone_GraniteDark", "M_Paint_DarkGrey"]


def _scaled(pts, k):
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in pts]


def _drum(bm, uvl, centre, r, z0, z1, mat_idx, segs=40, cap=True, tile=(4.0, 4.0)):
    """Closed cylinder (walls + top cap) with metre-scaled UVs."""
    ring = [(centre[0] + r * math.cos(2 * math.pi * i / segs), centre[1] + r * math.sin(2 * math.pi * i / segs))
            for i in range(segs)]
    n0 = len(bm.faces)
    add_building(bm, uvl, ring, z1 - z0, mat_idx, mat_idx, tile, tile, z0=z0)
    bm.faces.ensure_lookup_table()
    for k in range(n0, len(bm.faces)):
        bm.faces[k].smooth = len(bm.faces[k].verts) == 4


def build(bm, uvl):
    i = MATS.index
    # tower tiers (glass curtain wall), each tier inset toward the centroid
    for z0, z1, k in TIERS:
        add_building(bm, uvl, _scaled(FOOTPRINT, k), z1 - z0, i("M_Glass_CurtainDark"), i("M_Roof_Membrane"),
                     (24.0, 32.0), (1.0, 1.0), z0=z0)
    # granite plinth (street level) slightly proud of the glass
    add_building(bm, uvl, _scaled(FOOTPRINT, 1.004), 4.5, i("M_Stone_GraniteDark"), i("M_Roof_Membrane"),
                 (2.3, 2.3), (1.0, 1.0))
    # spandrel/floor bands every 4 m on the lower tier read as horizontal metal fins
    for z in range(8, 152, 16):
        add_building(bm, uvl, _scaled(FOOTPRINT, 1.006), 0.35, i("M_Metal_Aluminium"), i("M_Metal_Aluminium"),
                     (1.0, 1.0), (1.0, 1.0), z0=float(z))
    # Nasdaq drum: glass studio 0-8 m, dark LED body 8-44.6 m, metal crown ring to 46.5 m
    _drum(bm, uvl, NASDAQ_C, NASDAQ_R - 0.4, 0.0, 8.2, i("M_Glass_CurtainBlue"), tile=(12.0, 16.0))
    _drum(bm, uvl, NASDAQ_C, NASDAQ_R - 0.15, 8.2, 44.8, i("M_Paint_Black"))
    _drum(bm, uvl, NASDAQ_C, NASDAQ_R + 0.25, 44.8, 46.6, i("M_Metal_Aluminium"))
    _drum(bm, uvl, NASDAQ_C, NASDAQ_R + 0.35, 7.9, 8.4, i("M_Metal_Aluminium"))   # drip ring over the studio
    # SW corner drum (Broadway x 42nd) carrying the second curved screen
    _drum(bm, uvl, SW_C, SW_R - 0.15, 9.0, 31.5, i("M_Paint_Black"))
    _drum(bm, uvl, SW_C, SW_R + 0.2, 31.5, 32.6, i("M_Metal_Aluminium"))
    # crown: mechanical box + lattice mast (antenna) on the top tier
    top = _scaled(FOOTPRINT, 0.74)
    cx = sum(p[0] for p in top) / len(top)
    cy = sum(p[1] for p in top) / len(top)
    add_building(bm, uvl, _scaled(top, 0.55), 9.0, i("M_Paint_DarkGrey"), i("M_Roof_Membrane"), (4.0, 4.0),
                 (1.0, 1.0), z0=ROOF)
    for dx, dy in ((-1.6, -1.6), (1.6, -1.6), (1.6, 1.6), (-1.6, 1.6)):
        S._box(bm, i("M_Metal_Steel"), (cx + dx, cy + dy, ROOF + 9 + 30), (0.35, 0.35, 60.0), 0.0)
    for z in range(4, 60, 6):
        S._box(bm, i("M_Metal_Steel"), (cx, cy, ROOF + 9 + z), (3.6, 3.6, 0.25), 0.0)
    return (cx, cy)


def run():
    tree = C.ensure_district_tree("TS")
    coll = C.ensure_collection("TS_HERO_FourTimesSquare", tree["HERO"])
    scoll = C.ensure_collection("TS_SLOTS_FourTimesSquare", tree["SLOTS"])
    old = bpy.data.objects.get("BLD_TS_CondeNast_1085682")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    mats = [C.get_material(n) for n in MATS]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    crown_xy = build(bm, uvl)
    i_black = MATS.index("M_Paint_Black")
    made = []
    # Nasdaq drum: upper hero screen + lower logo band (sold separately, as at the real MarketSite)
    made.append(S.curved(f"AD_TS_{KEY}_ad01", scoll, f"ts.{KEY}.ad01", NASDAQ_C, NASDAQ_R, *NASDAQ_ARC,
                         18.6, 44.4, segments=40, tier="hero", building=OBJ).name)
    made.append(S.curved(f"AD_TS_{KEY}_ad02", scoll, f"ts.{KEY}.ad02", NASDAQ_C, NASDAQ_R, *NASDAQ_ARC,
                         8.8, 18.0, segments=40, tier="hero", building=OBJ).name)
    # Broadway x 42nd corner curve
    made.append(S.curved(f"AD_TS_{KEY}_ad03", scoll, f"ts.{KEY}.ad03", SW_C, SW_R, *SW_ARC, 10.0, 31.0,
                         segments=24, tier="hero", building=OBJ).name)
    # Broadway face (diagonal, faces WNW) flat screen between the two drums
    ax, ay, bx, by = 60.9, -224.6, 49.5, -184.7
    mx, my = (ax + bx) / 2, (ay + by) / 2
    L = math.hypot(bx - ax, by - ay)
    ox, oy = (by - ay) / L, -(bx - ax) / L          # CCW footprint edge -> outward is its right side
    face_yaw = math.degrees(math.atan2(-ox, oy))    # slots_tool.flat: yaw 0 faces +Y, fwd = (-sin, cos)
    made.append(S.flat(f"AD_TS_{KEY}_ad04", scoll, f"ts.{KEY}.ad04", (mx + ox * 0.9, my + oy * 0.9, 24.0), 16.0,
                       21.3, yaw_deg=face_yaw, tier="premium", building=OBJ, frame=bm, frame_mat=i_black).name)
    # crown signs, one per side of the top tier (rooftop kind), facing N, W, S, E
    top = _scaled(FOOTPRINT, 0.74)
    xs, ys = [p[0] for p in top], [p[1] for p in top]
    cx, cy = crown_xy
    for k, (pos, yaw_d) in enumerate((((cx, max(ys) + 0.6), 0), ((min(xs) + 3.0, cy), 90),
                                      ((cx, min(ys) - 0.6), 180), ((max(xs) + 0.6, cy), -90))):
        made.append(S.flat(f"AD_TS_{KEY}_crown{k + 1}", scoll, f"ts.{KEY}.crown{k + 1}", (pos[0], pos[1], 208.0),
                           14.0, 14.0, yaw_deg=yaw_d, kind="rooftop", tier="hero", building=OBJ,
                           frame=bm, frame_mat=i_black).name)
    # 43rd St storefront sign (photo 2: red stair-front sign right of the drum) + Broadway shop
    made.append(S.flat(f"SHOP_TS_{KEY}_01", scoll, f"ts.{KEY}.shop01", (82.0, -173.4, 6.2), 12.0, 3.0,
                       kind="storefront", tier="standard", building=OBJ, frame=bm, frame_mat=i_black,
                       aspect="4x1").name)
    made.append(S.flat(f"SHOP_TS_{KEY}_02", scoll, f"ts.{KEY}.shop02", (mx + ox * 0.6, my + oy * 0.6, 3.4), 10.0,
                       2.5, yaw_deg=face_yaw, kind="storefront", tier="standard", building=OBJ, aspect="4x1").name)

    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    me = bpy.data.meshes.get(OBJ) or bpy.data.meshes.new(OBJ)
    me.clear_geometry()
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.get(OBJ) or bpy.data.objects.new(OBJ, me)
    obj.data = me
    C.link_only_to(obj, coll)
    C.set_props(obj, bld_id=BIN, bin=BIN, tier="hero", height_m=ROOF, year=1999, style="hero", source="manual",
                buyable=True, chunk="hero", blockout=False, display_name="4 Times Square (Nasdaq)",
                address="151 W 42nd St, New York, NY")
    for n in made:
        bpy.data.objects[n].parent = obj
    # collision: footprint prism to the top tier + drum
    cbm = bmesh.new()
    cuv = cbm.loops.layers.uv.new("UVMap")
    add_building(cbm, cuv, FOOTPRINT, ROOF, 0, 0, (1, 1), (1, 1))
    cme = bpy.data.meshes.get("COL_" + OBJ) or bpy.data.meshes.new("COL_" + OBJ)
    cme.clear_geometry()
    cbm.to_mesh(cme)
    cbm.free()
    col = bpy.data.objects.get("COL_" + OBJ) or bpy.data.objects.new("COL_" + OBJ, cme)
    col.data = cme
    C.link_only_to(col, tree["COLLISION"])
    col.display_type = "WIRE"
    col.hide_render = True
    col["collider"] = "prism"
    col["building"] = OBJ
    e = bpy.data.objects.get("PL_TS_4tsq_nasdaq") or bpy.data.objects.new("PL_TS_4tsq_nasdaq", None)
    C.link_only_to(e, tree["LIGHTS"])
    e.location = (NASDAQ_C[0] - 16, NASDAQ_C[1] + 10, 25.0)
    e["light_power_w"] = 3000.0
    e["night_only"] = True
    return {"building": OBJ, "tris": C.tri_count(obj), "slots": made}


result = run()
