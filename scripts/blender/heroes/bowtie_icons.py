"""Heroes: the bowtie icons seen in the user's night video.

* Paramount Building (1501 Broadway, BIN 1024706): limestone "wedding cake" setbacks, clock tower with four
  faces, illuminated glass globe on top, crown floodlit at night, LED screens wrapping the Broadway base.
* Marriott Marquis (1535 Broadway, BIN 1024727): keeps its blockout tower, gains the giant (~100 m)
  continuous screen wrapping the Broadway frontage and both corners (one hero slot).
* 1551 Broadway (west side of Duffy Square, BINs 1088568/1024741/1024749): low store whose roof carries a tall
  screen tower facing Duffy Square + a tall vertical corner blade sign (brand-free, sellable).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import ts_common as C  # noqa: E402
import slots_tool as S  # noqa: E402
import hero_common as H  # noqa: E402
from import_footprints import add_building, add_storefront  # noqa: E402

FONT = "/System/Library/Fonts/Avenir Next.ttc"


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _glow(name, centre, normal, w, h, slot):
    import dress_billboards as D
    gcoll = C.ensure_collection("TS_LIGHTS_ScreenGlow", C.ensure_district_tree("TS")["LIGHTS"])
    D.glow_light(f"GLOW_{name}", gcoll, centre, normal, w, h, slot)


# ----------------------------------------------------------------------------- Paramount
def paramount():
    OBJ, BIN = "BLD_TS_ParamountBuilding", "1024706"
    MATS = ["M_Facade_Limestone", "M_Roof_Membrane", "M_Facade_Limestone_Floodlit", "M_Storefront", "M_Paint_Black",
            "M_Light_StoreSign", "M_Metal_Aluminium", "M_Bronze", "M_ShopSign"]
    i = MATS.index
    tree = C.ensure_district_tree("TS")
    coll = C.ensure_collection("TS_HERO_Paramount", tree["HERO"])
    scoll = C.ensure_collection("TS_SLOTS_Paramount", tree["SLOTS"])
    H.retire_blockout("BLD_TS_1024706")
    footprint = [(-79.6, -154.7), (-16.9, -154.7), (-17.1, -93.5), (-79.8, -93.4), (-79.8, -105.4),
                 (-75.0, -105.4), (-75.6, -110.4), (-75.3, -116.1), (-76.5, -121.8), (-76.5, -144.3),
                 (-79.7, -144.3)]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    # podium (theatre + offices) to ~34 m, then setbacks centred on the Broadway frontage
    add_building(bm, uvl, footprint, 34.0, i("M_Facade_Limestone"), i("M_Roof_Membrane"), (16, 16), (1, 1))
    tiers = [(-58, -17, -151, -97, 34, 62, "M_Facade_Limestone"),
             (-54, -20, -147, -101, 62, 78, "M_Facade_Limestone"),
             (-50, -24, -141, -107, 78, 90, "M_Facade_Limestone_Floodlit"),
             (-44.5, -29.5, -133, -115, 90, 108, "M_Facade_Limestone_Floodlit")]
    for x0, x1, y0, y1, z0, z1, m in tiers:
        add_building(bm, uvl, rect(x0, x1, y0, y1), z1 - z0, i(m), i("M_Roof_Membrane"), (16, 16), (1, 1), z0=z0)
        add_building(bm, uvl, rect(x0 - 0.35, x1 + 0.35, y0 - 0.35, y1 + 0.35), 0.6, i("M_Facade_Limestone"),
                     i("M_Facade_Limestone"), (2, 2), (1, 1), z0=z1 - 0.6)          # cornice at each setback
    # stepped pyramid roof over the clock tower
    cx, cy = -37.0, -124.0
    for k, (hw, hd) in enumerate(((7.0, 8.5), (5.5, 6.8), (4.0, 5.0), (2.6, 3.2), (1.4, 1.6))):
        add_building(bm, uvl, rect(cx - hw, cx + hw, cy - hd, cy + hd), 1.8, i("M_Facade_Limestone_Floodlit"),
                     i("M_Facade_Limestone_Floodlit"), (8, 8), (1, 1), z0=108 + k * 1.8)
    # the globe: glass sphere glowing at night, on a short drum
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=1.3, radius2=1.3, depth=1.2,
                                matrix=Matrix.Translation((cx, cy, 117.6)))
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = i("M_Bronze")
    res = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=2.3, matrix=Matrix.Translation((cx, cy, 120.4)))
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = i("M_Light_StoreSign")
        f.smooth = True
    # four clock faces (lit dials, bronze hands at ~10:10) on the clock tower
    for nx, ny, (fx, fy) in ((1, 0, (-29.4, cy)), (-1, 0, (-44.6, cy)), (0, 1, (cx, -114.9)), (0, -1, (cx, -133.1))):
        yaw = math.atan2(-nx, ny)
        rot = Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
        dial = bmesh.ops.create_circle(bm, cap_ends=True, segments=32, radius=3.0,
                                       matrix=Matrix.Translation((fx + nx * 0.05, fy + ny * 0.05, 100.0)) @ rot)
        for f in {f for v in dial["verts"] for f in v.link_faces}:
            f.material_index = i("M_Light_StoreSign")
        for ang, ln in ((math.radians(-60), 2.3), (math.radians(60), 1.6)):
            hrot = Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(ang, 4, "Y")
            c = Vector((fx + nx * 0.12, fy + ny * 0.12, 100.0)) + hrot @ Vector((0, 0, ln / 2))
            m = Matrix.Translation(c) @ hrot @ Matrix.Diagonal((0.18, 0.08, ln, 1))
            r = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            for f in {f for v in r["verts"] for f in v.link_faces}:
                f.material_index = i("M_Bronze")
    # storefront + base screens on the Broadway (east) face, wrapping both corners
    add_storefront(bm, uvl, footprint, i("M_Storefront"), 2, sign_idx=None)
    made = []
    path = [(-40.0, -155.5), (-16.4, -155.5), (-16.2, -92.7), (-40.0, -92.7)]
    made.append(S.wrap("AD_TS_paramount_base", scoll, "ts.1024706.base01", path, 6.0, 20.0, tier="hero",
                       building=OBJ, aspect="4x1"))
    for (a, b) in zip(path, path[1:]):
        L = math.dist(a, b)
        yaw = math.atan2(b[1] - a[1], b[0] - a[0])
        inward = (-(b[1] - a[1]) / L, (b[0] - a[0]) / L)
        S._box(bm, i("M_Paint_Black"), ((a[0] + b[0]) / 2 + inward[0] * 0.4, (a[1] + b[1]) / 2 + inward[1] * 0.4, 13.0),
               (L + 0.6, 0.6, 14.6), yaw)
    # central vertical marquee blade on the Broadway face
    made.append(S.flat("AD_TS_paramount_blade", scoll, "ts.1024706.blade01", (-14.8, -124.0, 31.0), 3.4, 20.0,
                       yaw_deg=-90, tier="hero", building=OBJ, frame=bm, frame_mat=i("M_Paint_Black"), aspect="9x16"))
    H.finish(OBJ, bm, MATS, coll, [o.name for o in made], footprint, 34.0, bld_id=BIN, bin=BIN, year=1927,
             display_name="Paramount Building", address="1501 Broadway, New York, NY")
    _glow("paramount_base", (-16.0, -124.0, 13.0), (1, 0), 30.0, 14.0, made[0])
    H.marker_light("PL_TS_paramount_globe", (cx, cy, 121.0), 600.0)
    return OBJ, made


# ----------------------------------------------------------------------------- Marriott Marquis screen
def marquis_screen():
    OBJ = "BLD_TS_MarquisScreen"
    tree = C.ensure_district_tree("TS")
    coll = C.ensure_collection("TS_HERO_MarriottMarquis", tree["HERO"])
    scoll = C.ensure_collection("TS_SLOTS_MarriottMarquis", tree["SLOTS"])
    MATS = ["M_Paint_Black", "M_Metal_Aluminium"]
    bm = bmesh.new()
    bm.loops.layers.uv.new("UVMap")
    # CCW: 45th St face going east -> chamfered corner -> Broadway frontage going north -> 46th St face west
    off = 2.2
    path = [(-62.0, 4.6 - off), (-30.0, 4.6 - off), (-24.2 + off * 0.5, 9.0), (-34.5 + off, 60.5),
            (-39.0, 64.0 + off), (-62.0, 64.0 + off)]
    z0, z1 = 8.0, 32.0
    slot = S.wrap("AD_TS_marquis_wrap", scoll, "ts.1024727.wrap01", path, z0, z1, tier="hero",
                  building="BLD_TS_NewYorkMarriottMarquisHotel_1024727", aspect="4x1")
    for p in slot.data.polygons:
        p.use_smooth = True
    for (a, b) in zip(path, path[1:]):  # structure behind, lips top/bottom
        L = math.dist(a, b)
        yaw = math.atan2(b[1] - a[1], b[0] - a[0])
        inward = (-(b[1] - a[1]) / L, (b[0] - a[0]) / L)
        mid = ((a[0] + b[0]) / 2 + inward[0] * 0.7, (a[1] + b[1]) / 2 + inward[1] * 0.7)
        S._box(bm, 0, (mid[0], mid[1], (z0 + z1) / 2), (L + 0.8, 1.2, z1 - z0 + 1.2), yaw)
        for z in (z0 - 0.5, z1 + 0.5):
            S._box(bm, 1, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z), (L + 1.2, 0.6, 0.25), yaw)
    host = bpy.data.objects.get("BLD_TS_NewYorkMarriottMarquisHotel_1024727")
    H.finish(OBJ, bm, MATS, coll, [slot.name], rect(-62, -24, 2, 67), z1, bld_id="1024727.screen", bin="1024727",
             year=2019, display_name="Marriott Marquis giant screen", address="1535 Broadway, New York, NY")
    o = bpy.data.objects[OBJ]
    o["buyable"] = False
    if host:
        o.parent = host
    _glow("marquis_a", (-29.0, 25.0, 20.0), (0.98, 0.19), 40.0, 24.0, slot)
    _glow("marquis_b", (-33.0, 48.0, 20.0), (0.98, 0.19), 30.0, 24.0, slot)
    return OBJ, [slot]


# ----------------------------------------------------------------------------- 1551 Broadway screen tower
def duffy_west_tower():
    OBJ = "BLD_TS_1551Broadway"
    BINS = ("1088568", "1024741", "1024749")
    tree = C.ensure_district_tree("TS")
    coll = C.ensure_collection("TS_HERO_1551Broadway", tree["HERO"])
    scoll = C.ensure_collection("TS_SLOTS_1551Broadway", tree["SLOTS"])
    H.retire_blockout(*[f"BLD_TS_{b}" for b in BINS])
    MATS = ["M_Glass_CurtainDark", "M_Roof_Membrane", "M_Storefront", "M_Paint_Black", "M_Metal_Steel", "M_ShopSign"]
    i = MATS.index
    footprint = [(-73.4, 98.1), (-46.5, 98.0), (-54.9, 131.6), (-73.3, 131.7)]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    add_building(bm, uvl, footprint, 16.0, i("M_Glass_CurtainDark"), i("M_Roof_Membrane"), (24, 32), (1, 1))
    add_storefront(bm, uvl, footprint, i("M_Storefront"), 1)
    made = []
    # podium wrap (east face along Broadway + both street corners)
    path = [(-66.0, 97.3), (-45.6, 97.3), (-54.2, 132.4), (-66.0, 132.4)]
    made.append(S.wrap("AD_TS_1551_wrap", scoll, "ts.1551bway.wrap01", path, 5.0, 14.5, tier="premium",
                       building=OBJ, aspect="4x1"))
    # screen tower on the roof facing Duffy Square (east, perpendicular to Broadway diagonal)
    ax, ay, bx, by = -46.5, 98.0, -54.9, 131.6
    L = math.hypot(bx - ax, by - ay)
    nx, ny = (by - ay) / L, -(bx - ax) / L
    yaw = math.degrees(math.atan2(-nx, ny))
    mx, my = (ax + bx) / 2 - nx * 3.0, (ay + by) / 2 - ny * 3.0
    made.append(S.flat("AD_TS_1551_tower", scoll, "ts.1551bway.tower01", (mx, my, 33.0), 28.0, 31.0, yaw_deg=yaw,
                       tier="hero", building=OBJ, frame=bm, frame_mat=i("M_Paint_Black"), aspect="1x1"))
    for t in (-0.42, 0.0, 0.42):  # steel legs/bracing behind the tower screen
        px = mx - nx * 2.0 + (bx - ax) / L * 28 * t
        py = my - ny * 2.0 + (by - ay) / L * 28 * t
        S._box(bm, i("M_Metal_Steel"), (px, py, 26.0), (0.5, 0.5, 20.0), math.radians(yaw))
    # tall vertical blade sign at the 47th St corner (the famous vertical store sign position)
    made.append(S.flat("AD_TS_1551_blade", scoll, "ts.1551bway.blade01", (-52.4, 134.0, 31.0), 4.0, 34.0,
                       yaw_deg=yaw + 30, tier="hero", building=OBJ, frame=bm, frame_mat=i("M_Paint_Black"),
                       aspect="9x16"))
    H.finish(OBJ, bm, MATS, coll, [o.name for o in made], footprint, 16.0, bld_id="+".join(BINS), bin=BINS[1],
             year=2010, display_name="1551 Broadway (Duffy Square west)", address="1551 Broadway, New York, NY")
    _glow("1551_tower", (mx, my, 33.0), (nx, ny), 28.0, 31.0, made[1])
    return OBJ, made


def run():
    out = {}
    for fn in (paramount, marquis_screen, duffy_west_tower):
        obj, made = fn()
        out[obj] = [m.name for m in made]
    return out


result = run()
