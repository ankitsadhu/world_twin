"""Heroes: three bowtie towers.

* One Astor Plaza (1515 Broadway, BIN 1024714, 1972): white tower whose facade reads as tight vertical white
  fins over dark glass, a sloped/sheared crown topped by a tall fin; podium (Minskoff Theatre) wrapped in
  screens on the Broadway face and both street corners.
* 3 Times Square (BIN 1024686, 2001): blue-glass tower with a white metal frame grid and slender mast; the
  podium is a continuous, rounded-corner LED wall around 7th Ave x 42nd St.
* 1540 Broadway / Bertelsmann (BIN 1076844, 1990): dark glass tower stepping back toward the east, crowned
  by a spire; huge billboards on its Broadway podium facing the bowtie.
"""
import math
import os
import sys

import bmesh
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import ts_common as C  # noqa: E402
import slots_tool as S  # noqa: E402
import hero_common as H  # noqa: E402
from import_footprints import add_building, add_storefront  # noqa: E402

MATS = ["M_Glass_CurtainDark", "M_Roof_Membrane", "M_Facade_Limestone", "M_Paint_Black", "M_Metal_Aluminium",
        "M_Glass_CurtainBlue", "M_Storefront", "M_Paint_DarkGrey", "M_Light_StoreSign", "M_Metal_Steel"]
I = MATS.index


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def fins(bm, pts, z0, z1, spacing, depth, width, mat):
    """Vertical fins standing proud of each facade edge of a CCW polygon."""
    for a, b in zip(pts, pts[1:] + pts[:1]):
        L = math.dist(a, b)
        if L < spacing:
            continue
        dx, dy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        nx, ny = dy, -dx
        n = int(L // spacing)
        for k in range(1, n):
            t = k * L / n
            c = (a[0] + dx * t + nx * depth / 2, a[1] + dy * t + ny * depth / 2, (z0 + z1) / 2)
            S._box(bm, I(mat), c, (width, depth, z1 - z0), math.atan2(dy, dx))


def bands(bm, pts, zs, mat, proud=0.25, h=0.5):
    for z in zs:
        add_building(bm, bm.loops.layers.uv["UVMap"], H.scaled(pts, 1.0 + proud / 40), h, I(mat), I(mat), (1, 1),
                     (1, 1), z0=z)


def wrap_with_housing(bm, scoll, name, sid, path, z0, z1, building, tier="hero"):
    o = S.wrap(name, scoll, sid, path, z0, z1, tier=tier, building=building, aspect="4x1")
    for p in o.data.polygons:
        p.use_smooth = True
    for a, b in zip(path, path[1:]):
        L = math.dist(a, b)
        if L < 0.05:
            continue
        yaw = math.atan2(b[1] - a[1], b[0] - a[0])
        inward = (-(b[1] - a[1]) / L, (b[0] - a[0]) / L)
        S._box(bm, I("M_Paint_Black"), ((a[0] + b[0]) / 2 + inward[0] * 0.45, (a[1] + b[1]) / 2 + inward[1] * 0.45,
                                        (z0 + z1) / 2), (L + 0.1, 0.8, z1 - z0 + 0.8), yaw)
    return o


def glow(name, centre, normal, w, h, slot):
    import dress_billboards as D
    gcoll = C.ensure_collection("TS_LIGHTS_ScreenGlow", C.ensure_district_tree("TS")["LIGHTS"])
    D.glow_light(f"GLOW_{name}", gcoll, centre, normal, w, h, slot)


def arc(cx, cy, r, a0, a1, n=10):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


# ----------------------------------------------------------------------------- One Astor Plaza
def one_astor_plaza():
    OBJ, BIN = "BLD_TS_OneAstorPlaza", "1024714"
    tree = C.ensure_district_tree("TS")
    coll = C.ensure_collection("TS_HERO_OneAstorPlaza", tree["HERO"])
    scoll = C.ensure_collection("TS_SLOTS_OneAstorPlaza", tree["SLOTS"])
    H.retire_blockout("BLD_TS_MinskoffTheatre_1024714")
    podium = [(-108.1, -72.0), (-24.6, -75.1), (-23.6, -67.3), (-16.8, -69.3), (-17.1, -19.7), (-24.0, -22.1),
              (-25.0, -14.0), (-109.8, -18.5)]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    add_building(bm, uvl, podium, 30.0, I("M_Glass_CurtainDark"), I("M_Roof_Membrane"), (24, 32), (1, 1))
    add_storefront(bm, uvl, podium, I("M_Storefront"), 3)
    # tower slab: long side faces Broadway / the bowtie, white fins every 1.5 m
    tower = rect(-86.0, -46.0, -62.0, -28.0)
    add_building(bm, uvl, tower, 196.0 - 30.0, I("M_Glass_CurtainDark"), I("M_Roof_Membrane"), (24, 32), (1, 1),
                 z0=30.0)
    fins(bm, tower, 31.0, 196.0, 1.5, 0.55, 0.42, "M_Facade_Limestone")
    bands(bm, tower, [30.0, 195.4], "M_Facade_Limestone", h=0.8)
    # sheared crown: wedge rising toward the west, then the tall crown fin
    crown_h_e, crown_h_w = 6.0, 17.0
    v = [bm.verts.new(c) for c in ((-86, -62, 196), (-46, -62, 196), (-46, -28, 196), (-86, -28, 196),
                                   (-86, -62, 196 + crown_h_w), (-46, -62, 196 + crown_h_e),
                                   (-46, -28, 196 + crown_h_e), (-86, -28, 196 + crown_h_w))]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        face = bm.faces.new([v[i] for i in f])
        face.material_index = I("M_Facade_Limestone")
    S._box(bm, I("M_Facade_Limestone"), (-80.0, -45.0, 196 + crown_h_w + 9.0), (3.0, 30.0, 18.0), 0.0)
    made = []
    # podium screens: Broadway face (east) + both corners, wrapping like the real Astor Plaza boards
    path = [(-62.0, -76.0), (-24.0, -76.0), (-16.0, -70.0), (-16.2, -19.0), (-24.4, -13.3), (-62.0, -13.3)]
    made.append(wrap_with_housing(bm, scoll, "AD_TS_astor_wrap", "ts.1024714.wrap01", path, 7.0, 27.0, OBJ))
    made.append(S.flat("AD_TS_astor_crown", scoll, "ts.1024714.crown01", (-45.4, -45.0, 180.0), 22.0, 12.0,
                       yaw_deg=-90, kind="rooftop", tier="hero", building=OBJ, frame=bm,
                       frame_mat=I("M_Paint_Black")))
    H.finish(OBJ, bm, MATS, coll, [o.name for o in made], podium, 30.0, bld_id=BIN, bin=BIN, year=1972,
             display_name="One Astor Plaza", address="1515 Broadway, New York, NY")
    glow("astor_wrap", (-15.0, -45.0, 17.0), (1, 0), 40.0, 20.0, made[0])
    return OBJ, made


# ----------------------------------------------------------------------------- 3 Times Square
def three_times_square():
    OBJ, BIN = "BLD_TS_ThreeTimesSquare", "1024686"
    tree = C.ensure_district_tree("TS")
    coll = C.ensure_collection("TS_HERO_ThreeTimesSquare", tree["HERO"])
    scoll = C.ensure_collection("TS_SLOTS_ThreeTimesSquare", tree["SLOTS"])
    H.retire_blockout("BLD_TS_1024686")
    cx, cy, r = -29.0, -222.0, 12.6                      # rounded 7th Ave x 42nd St corner
    footprint = ([(-66.6, -175.6), (-61.9, -173.2), (-19.9, -173.4), (-16.5, -176.7), (-16.5, -191.1),
                  (-19.6, -191.1), (-19.6, -214.4)] + arc(cx, cy, r, 0, -90, 8)[1:-1] +
                 [(-38.3, -231.3), (-56.3, -230.7), (-56.2, -204.2), (-66.7, -204.1)])
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    add_building(bm, uvl, footprint, 36.0, I("M_Paint_DarkGrey"), I("M_Roof_Membrane"), (4, 4), (1, 1))
    add_storefront(bm, uvl, footprint, I("M_Storefront"), 0)
    # tower: blue glass, rounded SE corner continues up, white frame grid every 4.2 m / 9 m
    tw = ([(-60.0, -178.0), (-21.0, -178.0), (-21.0, -214.0)] + arc(-33.0, -214.0, 12.0, 0, -90, 8)[1:-1] +
          [(-33.0, -226.0), (-60.0, -226.0)])
    add_building(bm, uvl, tw, 150.0 - 36.0, I("M_Glass_CurtainBlue"), I("M_Roof_Membrane"), (24, 32), (1, 1),
                 z0=36.0)
    fins(bm, tw, 36.0, 150.0, 9.0, 0.45, 0.35, "M_Metal_Aluminium")
    bands(bm, tw, [36.0 + 4.2 * k for k in range(0, 28, 2)], "M_Metal_Aluminium", proud=0.3, h=0.35)
    # crown frame + mast
    add_building(bm, uvl, H.scaled(tw, 0.98), 6.0, I("M_Metal_Aluminium"), I("M_Roof_Membrane"), (2, 2), (1, 1),
                 z0=150.0)
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.9, radius2=0.25, depth=26.0,
                                matrix=Matrix.Translation((-42.0, -200.0, 156.0 + 13.0)))
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = I("M_Metal_Steel")
    made = []
    # continuous LED wall around the corner, 2 storeys up to the podium top
    path = ([(-16.0, -176.0), (-16.0, -191.0), (-19.0, -191.6), (-19.0, -214.0)] +
            arc(cx, cy, r + 0.7, 0, -90, 14)[1:-1] + [(-38.0, -232.0), (-56.0, -231.5)])
    path.reverse()                                          # wrap paths must run CCW (art faces outward)
    made.append(wrap_with_housing(bm, scoll, "AD_TS_3tsq_wrap", "ts.1024686.wrap01", path, 6.5, 33.5, OBJ))
    H.finish(OBJ, bm, MATS, coll, [o.name for o in made], footprint, 36.0, bld_id=BIN, bin=BIN, year=2001,
             display_name="3 Times Square", address="3 Times Square (7th Ave & W 42nd St), New York, NY")
    glow("3tsq_wrap_e", (-15.0, -198.0, 20.0), (1, 0), 30.0, 27.0, made[0])
    glow("3tsq_wrap_s", (-38.0, -233.0, 20.0), (0, -1), 24.0, 27.0, made[0])
    return OBJ, made


# ----------------------------------------------------------------------------- 1540 Broadway (Bertelsmann)
def bertelsmann():
    OBJ, BIN = "BLD_TS_1540Broadway", "1076844"
    tree = C.ensure_district_tree("TS")
    coll = C.ensure_collection("TS_HERO_1540Broadway", tree["HERO"])
    scoll = C.ensure_collection("TS_SLOTS_1540Broadway", tree["SLOTS"])
    H.retire_blockout("BLD_TS_1076844")
    footprint = [(13.7, 3.9), (70.2, 4.6), (69.7, 34.4), (80.7, 34.5), (80.2, 65.3), (44.4, 64.9), (44.4, 58.9),
                 (12.9, 58.6)]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    add_building(bm, uvl, footprint, 34.0, I("M_Glass_CurtainDark"), I("M_Roof_Membrane"), (24, 32), (1, 1))
    add_storefront(bm, uvl, footprint, I("M_Storefront"), 2)
    # setbacks stepping east, away from Broadway (as seen from the bowtie)
    tiers = [(rect(26.0, 76.0, 8.0, 61.0), 34.0, 118.0), (rect(34.0, 74.0, 12.0, 57.0), 118.0, 150.0),
             (rect(42.0, 70.0, 18.0, 51.0), 150.0, 168.0), (rect(48.0, 66.0, 24.0, 45.0), 168.0, 176.0)]
    for pts, z0, z1 in tiers:
        add_building(bm, uvl, pts, z1 - z0, I("M_Glass_CurtainDark"), I("M_Roof_Membrane"), (24, 32), (1, 1), z0=z0)
        bands(bm, pts, [z1 - 0.6], "M_Metal_Aluminium", h=0.6)
        fins(bm, pts, z0, z1, 6.0, 0.3, 0.3, "M_Paint_Black")
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=2.2, radius2=0.15, depth=42.0,
                                matrix=Matrix.Translation((57.0, 34.5, 176.0 + 21.0)))
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = I("M_Metal_Aluminium")
    made = []
    # giant Broadway-facing podium boards: one hero wall + corner wraps
    made.append(S.flat("AD_TS_1540_main", scoll, "ts.1076844.main01", (12.1, 31.0, 19.0), 44.0, 24.75, yaw_deg=90,
                       tier="hero", building=OBJ, frame=bm, frame_mat=I("M_Paint_Black"), aspect="16x9"))
    made.append(wrap_with_housing(bm, scoll, "AD_TS_1540_wrapS", "ts.1076844.wrap01",
                                  [(12.2, 7.0), (13.0, 3.2), (40.0, 3.2)], 6.0, 30.0, OBJ, tier="premium"))
    made.append(wrap_with_housing(bm, scoll, "AD_TS_1540_wrapN", "ts.1076844.wrap02",
                                  [(40.0, 59.6), (12.2, 59.3), (12.2, 55.0)], 6.0, 30.0, OBJ, tier="premium"))
    H.finish(OBJ, bm, MATS, coll, [o.name for o in made], footprint, 34.0, bld_id=BIN, bin=BIN, year=1990,
             display_name="1540 Broadway (Bertelsmann Building)", address="1540 Broadway, New York, NY")
    glow("1540_main", (12.0, 31.0, 19.0), (-1, 0), 44.0, 24.75, made[0])
    return OBJ, made


def run():
    out = {}
    for fn in (one_astor_plaza, three_times_square, bertelsmann):
        obj, made = fn()
        out[obj] = [m.name for m in made]
    return out


result = run()
