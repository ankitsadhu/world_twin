"""A Hudson River sightseeing boat at true size (the kind that runs from Pier 83 at W 42nd St).

  blender -b --factory-startup -P scripts/blender/vehicles/build_sightseeing_boat.py -- [out.glb] [render_prefix]

Modelled on the classic three-deck Midtown sightseeing boats: 50 m long, 9.8 m beam, 2.0 m draft, enclosed main deck,
enclosed upper deck with panoramic windows, open top deck with benches and a pilothouse forward. The name and livery
are made up (no real operator's branding).

Game contract (viewer/js/boat.js):
  * Z up, bow +Y (three.js -Z), origin on the waterline at mid-length (place it at the river surface, z = -1.8)
  * one object BOAT_body; the two side ad panels use material MAT_SLOT_boat.hudson.side (a sellable screen)
  * nav lights use M_Light_* materials; cabin glass M_Light_BoatCabin glows warm at night
"""
import bpy
import bmesh
import math
import os
import sys
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.join(ROOT, "export/vehicles/sightseeing_boat.glb")
PREFIX = argv[1] if len(argv) > 1 else os.path.join(ROOT, "renders/vehicles/sightseeing_boat")
NAME = "HUDSON SIGHTSEER"

L, B, DRAFT = 50.0, 9.8, 2.0          # length overall, beam, draft (m)
Y_ST, Y_BOW = -25.0, 22.7            # the raked stem adds ~2.3 m at deck level: 50.0 m overall

bpy.ops.wm.read_factory_settings(use_empty=True)
COLL = bpy.context.scene.collection


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def tex(h):                                       # sRGB-encoded floats, for writing into image pixels
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def mat(name, hexc, rough=0.4, metal=0.0, coat=0.0, emit=None, estr=3.0, alpha=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(hexc), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat:
        b.inputs["Coat Weight"].default_value = coat
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb(emit), 1)
        b.inputs["Emission Strength"].default_value = estr
    return m

M = {
    "white": mat("M_Boat_White", "#F2F3F1", 0.35, coat=0.4),
    "navy": mat("M_Boat_Navy", "#17305C", 0.35, coat=0.4),
    "red": mat("M_Boat_Antifoul", "#8E2A22", 0.7),
    "boot": mat("M_Boat_Boot", "#17305C", 0.4),
    "deck": mat("M_Boat_Deck", "#8C969C", 0.85),
    "teak": mat("M_Boat_Teak", "#9A6B43", 0.7),
    "rail": mat("M_Boat_Rail", "#E9EBEC", 0.3, metal=0.6),
    "glass": mat("M_Light_BoatCabin", "#1A2633", 0.06, emit="#FFD9A0", estr=1.2),
    "pglass": mat("M_Boat_PilotGlass", "#101820", 0.04),
    "wglass": mat("M_Boat_Wheelhouse_Glass", "#5E7A88", 0.03),
    "console": mat("M_Boat_Console", "#2B2F33", 0.5),
    "bench": mat("M_Boat_Bench", "#2F5F9E", 0.5),
    "black": mat("M_Boat_Black", "#151617", 0.6),
    "orange": mat("M_Boat_LifeRing", "#F26A1B", 0.5),
    "steel": mat("M_Boat_Steel", "#B9BEC2", 0.35, metal=0.8),
    "red_l": mat("M_Light_NavRed", "#FF2A1A", 0.1, emit="#FF2010", estr=4),
    "green_l": mat("M_Light_NavGreen", "#1AFF6A", 0.1, emit="#10FF50", estr=4),
    "white_l": mat("M_Light_NavWhite", "#FFFFFF", 0.1, emit="#FFFFFF", estr=4),
    "funnel": mat("M_Boat_Funnel", "#17305C", 0.4),
}


def obj(name, bm, mats, smooth=35):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    COLL.objects.link(o)
    for m in (mats if isinstance(mats, list) else [mats]):
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = True
    if smooth:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth))
        except Exception:
            pass
        o.select_set(False)
    return o


def loft(name, rings, mats, cap0=True, cap1=True, face_mat=None, smooth=35):
    bm = bmesh.new()
    R, N = len(rings), len(rings[0])
    V = [[bm.verts.new(p) for p in r] for r in rings]
    for i in range(R - 1):
        for k in range(N):
            f = bm.faces.new((V[i][k], V[i][(k + 1) % N], V[i + 1][(k + 1) % N], V[i + 1][k]))
            if face_mat:
                f.material_index = face_mat(k)
    for cap, i in ((cap0, 0), (cap1, R - 1)):
        if cap:
            c = bm.verts.new(sum((Vector(p) for p in rings[i]), Vector()) / N)
            for k in range(N):
                f = bm.faces.new((V[i][k], V[i][(k + 1) % N], c))
                if face_mat:
                    f.material_index = face_mat(k)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, mats, smooth)


def box(name, c, s, m, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=s, verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(c))
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
    return obj(name, bm, m, 30)


def tube(name, a, b, r, m, seg=8):
    a, b = Vector(a), Vector(b)
    d = (b - a)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bm.transform(Matrix.Translation((a + b) / 2) @ rot)
    return obj(name, bm, m, 0)


def cyl(name, c, r, h, m, seg=20, axis="z"):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h)
    if axis == "x":
        bm.transform(Matrix.Rotation(math.pi / 2, 4, "Y"))
    if axis == "y":
        bm.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(c))
    return obj(name, bm, m, 40)


# ---------------------------------------------------------------- hull
def half_beam(y):
    """plan shape: full beam amidships, a fine entry to the stem, a slightly narrower transom."""
    if y > 8:
        t = (y - 8) / (Y_BOW - 8)
        return B / 2 * max(0.012, math.sqrt(max(0.0, 1 - t ** 2.1)))
    if y < -18:
        t = (-18 - y) / 7.0
        return B / 2 * (1 - 0.08 * t * t)
    return B / 2


def sheer(y):                                        # deck edge height above the waterline: rises toward the bow
    t = (y - Y_ST) / L
    return 2.05 + 0.25 * t + 1.25 * max(0.0, t - 0.55) ** 2 / 0.2025


def hull_ring(y):
    b, zs = half_beam(y), sheer(y)
    keel = -DRAFT * (1 - 0.65 * max(0.0, (y - 14) / 11) ** 1.5) * (1 - 0.35 * max(0.0, (-20 - y) / 5))   # cut-up forefoot, aft rise
    # starboard half from the keel up to the deck edge: band-aligned points so paint bands follow straight lines
    pts = []
    for a in np.linspace(-math.pi / 2, 0, 9):                         # round-bilge bottom (superellipse quarter)
        c, s = math.cos(a), math.sin(a)
        pts.append((b * 0.985 * c ** (2 / 3.2), -0.45 + (keel + 0.45) * (-s) ** (2 / 3.2)))     # keel -> bilge at z -0.45
    side = [(-0.30, "boot0"), (0.25, "boot1"), (zs - 0.48, "stripe0"), (zs - 0.22, "stripe1"), (zs, "deck")]
    for z, tag in side:
        flare = 1 + 0.025 * max(0.0, z) / 3.0
        pts.append((b * flare, z))
    ring_s = pts                                                    # bottom centre -> deck edge (starboard)
    ring = [(x, z) for x, z in ring_s] + [(0.0, zs + 0.06)] + [(-x, z) for x, z in reversed(ring_s)]
    # raked stem: the higher the point, the further forward (bow sections only)
    out = []
    for x, z in ring:
        dy = max(0.0, (y - 18) / 7) * 0.55 * (z - keel)
        out.append(Vector((x, y + dy, z)))
    return out

def hull_mat(k):
    """face k joins ring points k and k+1: 0..8 bottom (to z -0.45), 9 -> -0.30, 10 -> +0.25, 11 / 12 the sheer stripe,
    13 the deck edge, 14 the crown, then the same mirrored to port (29 points)."""
    if k == 14:
        return 4
    kk = k if k <= 13 else 27 - k
    if k == 28 or kk <= 8:
        return 2                                                    # antifouling red below the boot top
    if kk == 9:
        return 3                                                    # navy boot top at the waterline
    if kk == 11:
        return 1                                                    # navy sheer stripe
    if kk == 13:
        return 4                                                    # deck
    return 0
ys = list(np.linspace(Y_ST, Y_BOW, 90))
hull = loft("HULL", [hull_ring(y) for y in ys], [M["white"], M["navy"], M["red"], M["boot"], M["deck"]], face_mat=hull_mat, smooth=40)

# bulwark rub rail (black fender strake) along the deck edge
fender = []
for y in np.linspace(Y_ST + 0.2, Y_BOW - 0.6, 70):
    b, zs = half_beam(y), sheer(y)
    fender.append((b * 1.03 + 0.08, y + max(0.0, (y - 18) / 7) * 0.55 * (zs - 0.6 + DRAFT), zs - 0.6))


def sweep(name, path_pts, r, m, closed=False, seg=8):
    rings = []
    P = [Vector(p) for p in path_pts]
    for i, p in enumerate(P):
        d = (P[min(len(P) - 1, i + 1)] - P[max(0, i - 1)]).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        s1 = d.cross(up).normalized()
        s2 = d.cross(s1).normalized()
        rings.append([p + s1 * math.cos(2 * math.pi * j / seg) * r + s2 * math.sin(2 * math.pi * j / seg) * r for j in range(seg)])
    return loft(name, rings, m, smooth=60)

for sx in (1, -1):
    sweep("FENDER", [(sx * x, y, z) for x, y, z in fender], 0.11, M["black"])


# ---------------------------------------------------------------- superstructure
def plan(y0, y1, hw, r_front, n=10):
    """rounded-front, square-back plan outline (counter-clockwise), y0 aft .. y1 front."""
    pts = [(hw, y0)]
    for a in np.linspace(0, math.pi / 2, n):                       # starboard front corner
        pts.append((hw - r_front + r_front * math.cos(a), y1 - r_front + r_front * math.sin(a)))
    for a in np.linspace(math.pi / 2, math.pi, n):
        pts.append((-hw + r_front + r_front * math.cos(a), y1 - r_front + r_front * math.sin(a)))
    pts.append((-hw, y0))
    return pts


def prism(name, outline, z0, z1, m, top=True):
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z0)) for x, y in outline]
    hi = [bm.verts.new((x, y, z1)) for x, y in outline]
    n = len(outline)
    for i in range(n):
        bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    bm.faces.new(list(reversed(lo)))
    if top:
        bm.faces.new(hi)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, m, 30)

D1 = sheer(0) - 0.05                     # main deck level (top of hull) amidships
# deck 1 (main): enclosed saloon
c1 = (-20.5, 14.0, 4.25, 3.6)
prism("CAB1", plan(*c1), D1, D1 + 2.55, M["white"])
prism("CAB1_roof", plan(-21.5, 14.6, 4.75, 4.0), D1 + 2.55, D1 + 2.75, M["white"])
D2 = D1 + 2.75
# deck 2: enclosed upper saloon (full width) with panoramic windows
c2 = (-18.5, 9.5, 4.55, 3.4)
prism("CAB2", plan(*c2), D2, D2 + 2.45, M["white"])
prism("CAB2_roof", plan(-19.2, 10.0, 4.75, 3.6), D2 + 2.45, D2 + 2.65, M["white"])
D3 = D2 + 2.65
# open deck surfaces (teak-coloured) on deck 2 forward/aft walk areas and the top deck
prism("TOPDECK", plan(-19.0, 9.8, 4.6, 3.5), D3 - 0.02, D3 + 0.01, M["deck"])
# pilothouse forward on the top deck
ph = (6.2, 9.4, 2.4, 1.0)
# pilothouse: a glass house (low walls, corner posts, a header band) so you can see out from the helm
def ring(name, outline, z0, z1, m):
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z0)) for x, y in outline]
    hi = [bm.verts.new((x, y, z1)) for x, y in outline]
    for i in range(len(outline)):
        bm.faces.new((lo[i], lo[(i + 1) % len(outline)], hi[(i + 1) % len(outline)], hi[i]))
    return obj(name, bm, m, 30)

PH_OUT = plan(*ph)
ring("PILOT_wall", PH_OUT, D3, D3 + 1.05, M["white"])
ring("PILOT_header", PH_OUT, D3 + 2.1, D3 + 2.3, M["white"])
PH_IN = list(reversed(plan(ph[0] + 0.08, ph[1] - 0.08, ph[2] - 0.08, ph[3] - 0.08)))   # inner faces, seen from the helm
ring("PILOT_wall_in", PH_IN, D3, D3 + 1.05, M["white"])
ring("PILOT_header_in", PH_IN, D3 + 2.1, D3 + 2.3, M["white"])
for k in range(0, len(PH_OUT), 3):                                  # window posts
    x, y = PH_OUT[k]
    box("PILOT_post", (x, y, D3 + 1.575), (0.09, 0.09, 1.06), M["white"])
# the helm: console across the front, a wheel and two radar / chart screens
box("CONSOLE", (0, ph[1] - 0.75, D3 + 0.5), (2.6, 0.55, 1.0), M["console"])
for sx_ in (-0.7, 0.7):
    box("SCREEN", (sx_, ph[1] - 0.95, D3 + 1.12), (0.5, 0.06, 0.34), M["pglass"])
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=0.33, radius2=0.33, depth=0.04)
bm.transform(Matrix.Rotation(math.radians(65), 4, "X"))
bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((0, ph[1] - 1.12, D3 + 1.12)))
obj("WHEEL", bm, M["steel"], 0)
prism("PILOT_roof", plan(6.0, 9.7, 2.6, 1.1), D3 + 2.3, D3 + 2.45, M["navy"])


# windows: dark (warm-lit at night) glass panels a centimetre proud of the walls
def windows(prefix, y_from, y_to, z0, z1, hw, w, gap, m, both=True):
    n = int((y_to - y_from + gap) // (w + gap))
    start = y_from + ((y_to - y_from) - (n * w + (n - 1) * gap)) / 2
    for i in range(n):
        yc = start + i * (w + gap) + w / 2
        for sx in ((1, -1) if both else (1,)):
            box(prefix, (sx * (hw + 0.012), yc, (z0 + z1) / 2), (0.02, w, z1 - z0), m, 0.0)
            box(prefix + "_frame", (sx * (hw + 0.006), yc, (z0 + z1) / 2), (0.016, w + 0.12, z1 - z0 + 0.12), M["steel"], 0.0)

windows("WIN1", -19.0, 10.0, D1 + 0.95, D1 + 2.15, 4.25, 1.55, 0.45, M["glass"])
windows("WIN2", -17.5, 6.5, D2 + 0.75, D2 + 2.20, 4.55, 2.25, 0.35, M["glass"])
# curved fronts: a glass band following the rounded front of each saloon
for (y0, y1, hw, rf), z0, z1, name in ((c1, D1 + 0.95, D1 + 2.15, "FRONT1"), (c2, D2 + 0.75, D2 + 2.2, "FRONT2")):
    out = [p for p in plan(y0, y1, hw + 0.015, rf, 12)[1:-1]]
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z0)) for x, y in out]
    hi = [bm.verts.new((x, y, z1)) for x, y in out]
    for i in range(len(out) - 1):
        bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
    obj(name, bm, M["glass"], 30)
# pilothouse glass all round
out = plan(ph[0], ph[1], ph[2] + 0.015, ph[3], 10)
bm = bmesh.new()
z0, z1 = D3 + 1.05, D3 + 2.1
lo = [bm.verts.new((x, y, z0)) for x, y in out]
hi = [bm.verts.new((x, y, z1)) for x, y in out]
n = len(out)
for i in range(n):
    bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
obj("PILOT_glass", bm, M["wglass"], 30)
# saloon doors aft (each deck)
for z0, yb in ((D1, c1[0]), (D2, c2[0])):
    box("DOOR", (0, yb - 0.012, z0 + 1.05), (1.6, 0.03, 2.1), M["pglass"])


# ---------------------------------------------------------------- railings
def railing(name, path, z0, h=1.07, post=1.5, closed=False):
    P = [Vector((x, y, z0)) for x, y in path]
    if closed:
        P.append(P[0])
    parts = []
    acc = 0.0
    for a, b in zip(P, P[1:]):
        seg = (b - a).length
        k = 0.0
        while k < seg:
            p = a.lerp(b, k / seg)
            parts.append(tube(name + "_post", p, p + Vector((0, 0, h)), 0.025, M["rail"], 6))
            k += post
    top = [p + Vector((0, 0, h)) for p in P]
    mid = [p + Vector((0, 0, h * 0.5)) for p in P]
    parts.append(sweep(name + "_top", top, 0.035, M["rail"], seg=6))
    parts.append(sweep(name + "_mid", mid, 0.015, M["rail"], seg=5))
    return parts

# top deck: all round
railing("RAIL3", [(x * 0.99, y) for x, y in plan(-19.0, 9.8, 4.6, 3.5, 8)], D3, closed=True)
# main deck: bow (open foredeck) and stern
bow = [(half_beam(y) * 0.97, y + max(0.0, (y - 18) / 7) * 0.55 * (sheer(y) + DRAFT)) for y in np.linspace(14.5, Y_BOW - 0.4, 12)]
bow_path = bow + [(0.0, Y_BOW + 0.55 * (sheer(Y_BOW) + DRAFT) - 0.6)] + [(-x, y) for x, y in reversed(bow)]
for p in railing("RAILB", bow_path, 0, 1.0):                     # built at z 0, then lifted onto the sheer
    for v in p.data.vertices:
        yy = v.co.y
        v.co.z += sheer(min(Y_BOW, yy)) - 0.02
for sx in (1, -1):
    railing("RAILS", [(sx * half_beam(Y_ST) * 0.97, -20.6), (sx * half_beam(Y_ST) * 0.97, Y_ST + 0.25), (0, Y_ST + 0.25)], sheer(Y_ST) - 0.02, 1.0)
# deck 2 aft open deck railing
railing("RAIL2", [(4.7, -18.6), (4.7, -19.1), (-4.7, -19.1), (-4.7, -18.6)], D2, 1.07)

# ---------------------------------------------------------------- top deck fittings
# rows of blue benches facing outboard-forward
for yb in np.arange(-17.0, 4.5, 2.4):
    for sx in (1, -1):
        box("BENCH", (sx * 2.4, yb, D3 + 0.45), (3.2, 0.45, 0.06), M["bench"])
        box("BENCH_back", (sx * 2.4, yb - 0.23, D3 + 0.75), (3.2, 0.05, 0.55), M["bench"])
        for lx in (-1.3, 1.3):
            box("BENCH_leg", (sx * 2.4 + lx, yb, D3 + 0.22), (0.06, 0.4, 0.44), M["steel"])
# exhaust stacks aft (navy, with a black cap)
for sx in (1, -1):
    cyl("STACK", (sx * 2.9, -17.6, D3 + 1.2), 0.38, 2.4, M["funnel"], 20)
    cyl("STACK_cap", (sx * 2.9, -17.6, D3 + 2.45), 0.40, 0.12, M["black"], 20)
# mast on the pilothouse roof: radar, masthead light, antennas
tube("MAST", (0, 7.6, D3 + 2.45), (0, 7.6, D3 + 5.2), 0.07, M["white"], 10)
box("RADAR", (0, 7.6, D3 + 4.2), (2.0, 0.14, 0.12), M["white"], 0.03)
cyl("RADAR_base", (0, 7.6, D3 + 4.05), 0.12, 0.2, M["black"], 12)
cyl("MASTHEAD", (0, 7.6, D3 + 5.3), 0.07, 0.18, M["white_l"], 10)
tube("VHF", (0.5, 7.0, D3 + 2.45), (0.5, 7.0, D3 + 5.6), 0.02, M["black"], 6)
# side lights on the pilothouse wings: red to port (-X), green to starboard (+X)
for sx, m_ in ((1, M["green_l"]), (-1, M["red_l"])):
    box("SIDELIGHT_screen", (sx * (ph[2] + 0.06), 7.4, D3 + 2.0), (0.08, 0.5, 0.3), M["black"])
    box("SIDELIGHT", (sx * (ph[2] + 0.13), 7.55, D3 + 2.0), (0.06, 0.16, 0.14), m_)
box("STERNLIGHT", (0, Y_ST - 0.05, sheer(Y_ST) + 0.9), (0.2, 0.08, 0.15), M["white_l"])
# life rings on the railings and life-raft canisters along the top deck
for sx in (1, -1):
    for yy in (-14.0, -3.0, 6.0):
        cyl("LIFERING", (sx * 4.66, yy, D3 + 0.62), 0.32, 0.09, M["orange"], 18, axis="x")
    for yy in (-10.0, 0.5):
        cyl("RAFT", (sx * 3.95, yy, D3 + 0.38), 0.32, 1.3, M["white"], 16, axis="y")
# bow: anchor and bitts; stern: flag pole
box("ANCHOR", (1.1, 21.0, sheer(21.0) - 0.9), (0.06, 0.55, 0.7), M["black"])
for sx in (1, -1):
    cyl("BITT", (sx * 2.6, 18.0, sheer(18.0) + 0.2), 0.12, 0.4, M["black"], 12)
    cyl("BITT", (sx * 3.6, -22.5, sheer(-22.5) + 0.2), 0.12, 0.4, M["black"], 12)
tube("FLAGPOLE", (0, Y_ST + 0.4, sheer(Y_ST)), (0, Y_ST - 0.6, sheer(Y_ST) + 3.6), 0.03, M["steel"], 6)

# US flag (stars and stripes painted into a small texture)
fw, fh = 240, 126
img = np.ones((fh, fw, 4), np.float32)
for i in range(13):
    rows = slice(int(fh - (i + 1) * fh / 13), int(fh - i * fh / 13))
    img[rows, :, :3] = tex("#B22234") if i % 2 == 0 else tex("#FFFFFF")
cw, ch = int(fw * 0.4), int(fh * 7 / 13)
img[fh - ch:, :cw, :3] = tex("#3C3B6E")
for r in range(9):
    for c in range(11 if r % 2 == 0 else 10):
        cx = int((c + (0.5 if r % 2 == 0 else 1.0)) * cw / 11.5)
        cy = fh - ch + int((r + 0.6) * ch / 9.6)
        img[max(0, cy - 1):cy + 2, max(0, cx - 1):cx + 2, :3] = 1.0
flag_img = bpy.data.images.new("T_Flag_US", fw, fh)
flag_img.pixels.foreach_set(img.ravel())
flag_img.pack()
fm = bpy.data.materials.new("M_Boat_Flag"); fm.use_nodes = True
t = fm.node_tree.nodes.new("ShaderNodeTexImage"); t.image = flag_img
fm.node_tree.links.new(t.outputs["Color"], fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
fm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
top = sheer(Y_ST) + 3.5
pole = Vector((0, Y_ST - 0.55, top))
corners = [pole + Vector((0, 0, -0.95)), pole + Vector((0, -1.8, -0.95)), pole + Vector((0, -1.8, 0)), pole]
vs = [bm.verts.new(c) for c in corners]
f = bm.faces.new(vs)
for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
    loop[uvl].uv = uv
flag = obj("FLAG", bm, fm, 0)

# ---------------------------------------------------------------- name on both bows + the transom, ad panels on the top deck sides
def text_decal(body, size, loc, rot_z, target, offset=0.01):
    cu = bpy.data.curves.new("TXT", "FONT")
    cu.body = body
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    to = bpy.data.objects.new("TXT", cu)
    COLL.objects.link(to)
    to.rotation_euler = (math.pi / 2, 0, rot_z)
    to.location = loc
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = to
    to.select_set(True)
    bpy.ops.object.convert(target="MESH")
    to = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm = bmesh.new(); bm.from_mesh(to.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=2, use_grid_fill=True)
    bm.to_mesh(to.data); bm.free()
    sw = to.modifiers.new("wrap", "SHRINKWRAP")
    sw.target = target
    sw.wrap_method = "NEAREST_SURFACEPOINT"
    sw.offset = offset
    bpy.ops.object.modifier_apply(modifier="wrap")
    to.select_set(False)
    to.data.materials.clear()
    to.data.materials.append(M["navy"])
    return to

for sx in (1, -1):
    yc = 12.0
    text_decal(NAME, 0.62, (sx * (half_beam(yc) + 0.6), yc, sheer(yc) - 0.95), math.pi / 2 if sx > 0 else -math.pi / 2, hull)
text_decal(NAME + "\nNEW YORK, NY", 0.42, (0, Y_ST - 0.6, sheer(Y_ST) - 0.9), 0.0, hull)        # faces aft, reads from behind

ad = bpy.data.materials.new("MAT_SLOT_boat.hudson.side")         # a sellable screen (see config/mobile_slots.json)
ad.use_nodes = True
ab = ad.node_tree.nodes["Principled BSDF"]
c = 512
cv = np.ones((64, c, 4), np.float32)
cv[:, :, :3] = tex("#0A84FF")
ad_img = bpy.data.images.new("T_Boat_AdPlaceholder", c, 64)
ad_img.pixels.foreach_set(cv.ravel()); ad_img.pack()
ti = ad.node_tree.nodes.new("ShaderNodeTexImage"); ti.image = ad_img
ad.node_tree.links.new(ti.outputs["Color"], ab.inputs["Base Color"])
ad.node_tree.links.new(ti.outputs["Color"], ab.inputs["Emission Color"])
ab.inputs["Emission Strength"].default_value = 1.0
ab.inputs["Roughness"].default_value = 0.4
for sx in (1, -1):
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    x = sx * 4.64
    y0, y1, z0, z1 = -13.6, -4.0, D3 - 0.12, D3 + 1.08                # vinyl banner on the top-deck railing, 9.6 x 1.2 m (8:1)
    vs = [bm.verts.new(p) for p in ((x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1))]
    if sx < 0:
        vs = [vs[1], vs[0], vs[3], vs[2]]
    f = bm.faces.new(vs)
    for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = uv
    obj("AD_SIDE", bm, ad, 0)
    box("AD_frame", (x - sx * 0.02, (y0 + y1) / 2, (z0 + z1) / 2), (0.03, y1 - y0 + 0.08, z1 - z0 + 0.08), M["navy"])

# ---------------------------------------------------------------- join + export
wg = M["wglass"]
wg.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.28
try:
    wg.surface_render_method = "BLENDED"
except Exception:
    wg.blend_method = "BLEND"
for m_ in bpy.data.materials:                    # one-sided surfaces (a camera inside the wheelhouse sees out)
    m_.use_backface_culling = m_.name not in ("M_Boat_Wheelhouse_Glass", "M_Boat_Flag")
bpy.ops.object.select_all(action="DESELECT")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = hull
bpy.ops.object.join()
body = bpy.context.active_object
body.name = body.data.name = "BOAT_body"
for u in body.data.uv_layers:
    u.active_render = True                                          # the flag / ad panel UVs (joined meshes lose the flag)
pts = [v.co for v in body.data.vertices]
mn = [min(p[i] for p in pts) for i in range(3)]
mx = [max(p[i] for p in pts) for i in range(3)]
tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
print("BOAT length %.2f m, beam %.2f m, keel %.2f .. top %.2f m, %d tris" % (mx[1] - mn[1], mx[0] - mn[0], mn[2], mx[2], tris))
os.makedirs(os.path.join(ROOT, "blender/vehicles"), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender/vehicles/sightseeing_boat.blend"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_draco_mesh_compression_enable=True, export_yup=True,
                          export_image_format="JPEG")
print("EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB")

if PREFIX:
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    scn.render.resolution_x, scn.render.resolution_y = 1600, 900
    wd = bpy.data.worlds.new("w"); scn.world = wd; wd.use_nodes = True
    wd.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.72, 0.85, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(130)); COLL.objects.link(sun)
    wm = mat("water", "#2A4A55", 0.15)
    bpy.ops.mesh.primitive_plane_add(size=400); bpy.context.active_object.data.materials.append(wm)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); COLL.objects.link(cam); scn.camera = cam
    cam.data.lens = 40
    M["glass"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.0   # daytime preview
    for nm, eye, look in (("34", (32, 42, 14), (0, 2, 3.5)), ("side", (70, -2, 4), (0, -2, 4)), ("rear", (-26, -46, 16), (0, -4, 4))):
        cam.location = eye
        cam.rotation_euler = (Vector(look) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = f"{PREFIX}_{nm}.png"
        bpy.ops.render.render(write_still=True)
