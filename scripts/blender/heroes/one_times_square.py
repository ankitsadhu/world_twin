"""Hero: One Times Square (1475 Broadway). Replaces blockout BLD_TS_1022581.

Real-world reference: 25-storey wedge between 7th Ave (west) and Broadway (east), 42nd -> 43rd St,
roof ~102.7 m (NYC data), ball mast on top (~110 m incl. mast). The north tip is only ~6.7 m wide; the
famous billboard stack hangs on a steel frame cantilevered in front of it (~23 m wide), with angled
wings, catwalks between tiers, the news ticker wrapping the base, and a storefront at street level.
Slot layout follows the user's photo 3 (top -> bottom): crown sign, band, centre tower + 2 wings,
centre + 2 sides, horizontal band, lower wide screen, ticker, storefront. Plus 42nd St and 7th Ave faces.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import ts_common as C  # noqa: E402
import slots_tool as S  # noqa: E402
from import_footprints import add_building, _tile  # noqa: E402

BIN = "1022581"
OBJ = "BLD_TS_OneTimesSquare"
KEY = "1tsq"
ROOF = 102.7
CROWN = 97.0                       # setback crown starts here
FRONT_Y = -189.6                   # plane of the north billboard stack (building tip at y=-192.4)
CX = 22.2                          # stack centre line (x)
STACK_W = 23.0

# footprint (local metres), CCW. West face on 7th Ave (x~12.8), diagonal east face along Broadway.
FOOTPRINT = [(12.75, -235.01), (31.82, -235.22), (20.57, -192.42), (13.9, -192.35), (13.7, -217.39), (12.89, -217.38)]

# north-face slots: (id, centre_x, z_bottom, width, height, yaw_deg, tier)
NORTH_SLOTS = [
    ("ad01", CX, 81.5, 14.0, 14.0, 0, "hero"),       # crown sign (photo: Prudential)
    ("ad02", CX, 70.5, 16.0, 9.0, 0, "hero"),        # band (photo: Xinhua)
    ("ad03", CX, 47.0, 12.0, 21.3, 0, "hero"),       # centre tower (photo: Samsung)
    ("ad04", CX - 9.6, 51.0, 7.0, 12.4, 28, "premium"),   # left wing (photo: Green Giant)
    ("ad05", CX + 9.6, 51.0, 7.0, 12.4, -28, "premium"),  # right wing (photo: Green Giant)
    ("ad06", CX, 27.5, 13.0, 17.3, 0, "hero"),       # centre (photo: Coca-Cola)
    ("ad07", CX + 10.0, 30.5, 7.5, 7.5, -24, "premium"),  # right (photo: M&M's)
    ("ad08", CX - 9.8, 30.5, 6.0, 8.0, 24, "premium"),    # left
    ("ad09", CX, 23.0, 23.0, 2.9, 0, "premium"),     # horizontal band (photo: Hyundai)
    ("ad10", CX, 9.0, 23.0, 12.9, 0, "hero"),        # lower wide screen
]


def _material(name):
    return C.get_material(name)


def build_core(bm, uvl, mats):
    """Tower: dark clad shaft to the crown, limestone setback crown, parapet + roof."""
    add_building(bm, uvl, FOOTPRINT, CROWN, mats.index("M_Paint_DarkGrey"), mats.index("M_Roof_Membrane"),
                 (4.0, 4.0), (1.0, 1.0))
    # crown: footprint inset 1.0 m (shrink toward centroid)
    cx = sum(p[0] for p in FOOTPRINT) / len(FOOTPRINT)
    cy = sum(p[1] for p in FOOTPRINT) / len(FOOTPRINT)
    inset = [(cx + (x - cx) * 0.9, cy + (y - cy) * 0.94) for x, y in FOOTPRINT]
    add_building(bm, uvl, inset, ROOF - CROWN, mats.index("M_Stone_Limestone"), mats.index("M_Roof_Membrane"),
                 (2.0, 2.0), (1.0, 1.0), z0=CROWN)
    # mechanical bulkhead on the roof
    bulk = [(cx - 3, cy - 6), (cx + 3, cy - 6), (cx + 3, cy + 4), (cx - 3, cy + 4)]
    add_building(bm, uvl, bulk, 4.5, mats.index("M_Paint_DarkGrey"), mats.index("M_Roof_Membrane"),
                 (4.0, 4.0), (1.0, 1.0), z0=ROOF)


def build_catwalks(frame, idx_steel, idx_black):
    """Catwalk slabs + guard rails under each tier of the north stack (they read strongly at night)."""
    for z in (8.4, 22.5, 26.8, 46.2, 69.8, 80.8):
        S._box(frame, idx_steel, (CX, FRONT_Y + 0.4, z), (STACK_W + 1.5, 1.4, 0.18), 0.0)
        S._box(frame, idx_black, (CX, FRONT_Y + 1.05, z + 1.05), (STACK_W + 1.5, 0.06, 0.06), 0.0)  # top rail
        S._box(frame, idx_black, (CX, FRONT_Y + 1.05, z + 0.55), (STACK_W + 1.5, 0.04, 0.04), 0.0)  # mid rail
        for i in range(13):
            x = CX - (STACK_W + 1.5) / 2 + i * (STACK_W + 1.5) / 12
            S._box(frame, idx_black, (x, FRONT_Y + 1.05, z + 0.55), (0.06, 0.06, 1.1), 0.0)
    # vertical steel spine behind the stack, tying every tier to the building tip
    for x in (CX - 8, CX, CX + 8):
        S._box(frame, idx_steel, (x, FRONT_Y - 1.4, 50.0), (0.6, 2.2, 92.0), 0.0)


def build_mast(bm, uvl, mats):
    """Flagpole mast + NYE ball (12 ft geodesic sphere) on the roof."""
    cx = sum(p[0] for p in FOOTPRINT) / len(FOOTPRINT)
    cy = sum(p[1] for p in FOOTPRINT) / len(FOOTPRINT) + 8
    ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.45, radius2=0.3, depth=23.0,
                                matrix=__import__("mathutils").Matrix.Translation((cx, cy, ROOF + 4.5 + 11.5)))
    for f in {f for v in ret["verts"] for f in v.link_faces}:
        f.material_index = mats.index("M_Metal_Aluminium")
    ball = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.85,
                                      matrix=__import__("mathutils").Matrix.Translation((cx, cy, ROOF + 4.5 + 23.0 + 1.0)))
    for f in {f for v in ball["verts"] for f in v.link_faces}:
        f.material_index = mats.index("M_Light_StoreSign")
        f.smooth = True
    return (cx, cy)


def run():
    tree = C.ensure_district_tree("TS")
    coll = C.ensure_collection("TS_HERO_OneTimesSquare", tree["HERO"])
    slots_coll = C.ensure_collection("TS_SLOTS_OneTimesSquare", tree["SLOTS"])
    # retire the blockout
    old = bpy.data.objects.get("BLD_TS_1022581")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)

    mat_names = ["M_Paint_DarkGrey", "M_Roof_Membrane", "M_Stone_Limestone", "M_Metal_Steel", "M_Paint_Black",
                 "M_Metal_Aluminium", "M_Light_StoreSign", "M_Glass_CurtainDark", "M_Light_StreetWarm"]
    mats = [_material(n) for n in mat_names]

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    build_core(bm, uvl, mat_names)
    ball_xy = build_mast(bm, uvl, mat_names)
    # storefront glazing band on the 3 street faces (0.3 .. 4.6 m), glass + dark mullions via glass atlas
    add_building(bm, uvl, [(x + (0.05 if x < 20 else -0.05), y) for x, y in FOOTPRINT], 4.3,
                 mat_names.index("M_Glass_CurtainDark"), mat_names.index("M_Paint_Black"), (24.0, 32.0), (1.0, 1.0),
                 z0=0.3)

    frame = bm  # bezels/back boxes/catwalks go into the same building mesh (one draw call per material)
    i_black, i_steel = mat_names.index("M_Paint_Black"), mat_names.index("M_Metal_Steel")
    made = []
    for sid, x, z0, w, h, yaw, tier in NORTH_SLOTS:
        y = FRONT_Y + (abs(yaw) / 28.0) * 1.2  # wings step forward slightly
        o = S.flat(f"AD_TS_{KEY}_{sid}", slots_coll, f"ts.{KEY}.{sid}", (x, y, z0 + h / 2), w, h, yaw_deg=yaw,
                   tier=tier, building=OBJ, frame=frame, frame_mat=i_black)
        made.append(o.name)
    build_catwalks(frame, i_steel, i_black)

    # 42nd St (south) face: big portrait screen facing -Y
    o = S.flat(f"AD_TS_{KEY}_ad11", slots_coll, f"ts.{KEY}.ad11", (22.3, -236.0, 52.0), 17.0, 22.7, yaw_deg=180,
               tier="hero", building=OBJ, frame=frame, frame_mat=i_black)
    made.append(o.name)
    # 7th Ave (west) face: tall screen facing -X
    o = S.flat(f"AD_TS_{KEY}_ad12", slots_coll, f"ts.{KEY}.ad12", (11.9, -214.0, 40.0), 16.0, 21.3, yaw_deg=90,
               tier="premium", building=OBJ, frame=frame, frame_mat=i_black)
    made.append(o.name)
    # news ticker: wraps Broadway face -> north tip -> 7th Ave face at 5.0-7.6 m (CCW = reads left to right)
    ticker_path = [(32.4, -235.9), (20.9, -191.8), (13.3, -191.8), (13.1, -217.9), (12.3, -217.9), (12.2, -234.0)]
    o = S.wrap(f"AD_TS_{KEY}_ad13", slots_coll, f"ts.{KEY}.ad13", ticker_path, 5.0, 7.6, tier="premium",
               building=OBJ, aspect="8x1")
    made.append(o.name)
    # ticker housing (black band behind)
    for (a, b) in zip(ticker_path, ticker_path[1:]):
        L = math.dist(a, b)
        if L < 0.5:
            continue
        yaw = math.atan2(b[1] - a[1], b[0] - a[0])
        inward = (-(b[1] - a[1]) / L, (b[0] - a[0]) / L)  # left of a CCW path = into the building
        mid = ((a[0] + b[0]) / 2 + inward[0] * 0.3, (a[1] + b[1]) / 2 + inward[1] * 0.3, 6.3)
        S._box(frame, i_black, mid, (L, 0.5, 3.2), yaw)
    # street-level storefront sign (SHOP slot) on the north tip
    o = S.flat(f"SHOP_TS_{KEY}_01", slots_coll, f"ts.{KEY}.shop01", (17.2, -191.6, 3.6), 6.4, 1.2,
               kind="storefront", tier="standard", building=OBJ, aspect="4x1")
    made.append(o.name)

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
    C.set_props(obj, bld_id=BIN, bin=BIN, tier="hero", height_m=ROOF, year=1904, style="hero",
                source="manual", buyable=True, chunk="hero", blockout=False, display_name="One Times Square",
                address="1475 Broadway, New York, NY")
    for name in made:
        bpy.data.objects[name].parent = obj
    # collision proxy: simple footprint prism
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
    col["collider"] = "box_prism"
    col["building"] = OBJ
    # night marker lights for the game (ball + stack wash)
    for nm, loc, power in (("PL_TS_1tsq_ball", (ball_xy[0], ball_xy[1], ROOF + 28.5), 800.0),
                           ("PL_TS_1tsq_stack", (CX, FRONT_Y + 12.0, 40.0), 2500.0)):
        e = bpy.data.objects.get(nm) or bpy.data.objects.new(nm, None)
        C.link_only_to(e, tree["LIGHTS"])
        e.location = loc
        e["light_power_w"] = power
        e["night_only"] = True
    return {"building": OBJ, "tris": C.tri_count(obj), "slots": made}


result = run()
