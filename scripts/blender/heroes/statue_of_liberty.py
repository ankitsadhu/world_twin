"""The Statue of Liberty at true size, on its pedestal, foundation and Fort Wood (Liberty Island).

  blender -b --factory-startup -P scripts/blender/heroes/statue_of_liberty.py -- [out.glb] [render_prefix]

Dimensions are the National Park Service's published statistics:
  ground (base of the foundation) to tip of torch   92.99 m (305 ft 1 in)
  foundation 19.81 m (65 ft) + granite pedestal 27.13 m (89 ft) + statue base to torch tip 46.05 m (151 ft 1 in)
  heel to top of head 33.86 m, head chin to cranium 5.26 m, ear to ear 3.05 m, nose 1.48 m, right arm 12.8 m,
  right arm thickness 3.66 m, waist 10.67 m, tablet 7.19 x 4.14 x 0.61 m, index finger 2.44 m
  Fort Wood: an 11-pointed star fort around the foundation.
The copper figure is a sculpted-by-code approximation: its silhouette, proportions and drapery read true from a boat or
a plane (100 m+); up close it's simplified (no fingers or fine facial detail).

Model frame: Z up, origin at the centre of the foundation on the ground, the statue faces +Y. The game rotates it to
face the Narrows (bearing ~135 deg) when placing it on Liberty Island.
Materials: M_Light_LibertyFlood (copper; glows as if floodlit at night), M_Light_LibertyTorch (the gilded flame, lit at
night), M_Liberty_Granite (pedestal), M_Liberty_FortStone, M_Liberty_Concrete (foundation), M_Liberty_Lawn, M_Liberty_Paving.
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
OUT = argv[0] if argv else os.path.join(ROOT, "export/harbor/liberty.glb")
PREFIX = argv[1] if len(argv) > 1 else os.path.join(ROOT, "renders/harbor/liberty")

FOUND_H, PED_H, STATUE_H = 19.81, 27.13, 46.05
Z_PED = FOUND_H                    # top of the foundation / base of the pedestal
Z_FIG = FOUND_H + PED_H            # statue base (the plinth the figure stands on)

bpy.ops.wm.read_factory_settings(use_empty=True)
COLL = bpy.context.scene.collection


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mat(name, hexc, rough=0.6, metal=0.0, emit=None, estr=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(hexc), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb(emit), 1)
        b.inputs["Emission Strength"].default_value = estr
    m.use_backface_culling = True
    return m

M = {
    "copper": mat("M_Light_LibertyFlood", "#84B3A0", 0.62, 0.15, emit="#9FD4BE", estr=0.9),   # verdigris patina
    "copper_dk": mat("M_Light_LibertyFloodShade", "#5E8E7C", 0.7, 0.15, emit="#7FB8A2", estr=0.6),
    "flame": mat("M_Light_LibertyTorch", "#E3B34C", 0.28, 1.0, emit="#FFC95A", estr=6.0),      # gold leaf
    "granite": mat("M_Liberty_Granite", "#BDB2A2", 0.75),                                       # Stony Creek granite
    "granite_dk": mat("M_Liberty_GraniteShade", "#9C9284", 0.8),
    "concrete": mat("M_Liberty_Concrete", "#AFA79B", 0.85),
    "fort": mat("M_Liberty_FortStone", "#A39A8C", 0.85),
    "lawn": mat("M_Liberty_Lawn", "#5F7D45", 0.95),
    "paving": mat("M_Liberty_Paving", "#C9C2B6", 0.8),
    "dark": mat("M_Liberty_Window", "#1B2126", 0.4),
}


def obj(name, bm, m, smooth=40):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    COLL.objects.link(o)
    for x in (m if isinstance(m, list) else [m]):
        me.materials.append(x)
    for p in me.polygons:
        p.use_smooth = smooth > 0
    if smooth:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth))
        except Exception:
            pass
        o.select_set(False)
    return o


def loft(name, rings, m, cap0=True, cap1=True, smooth=50, face_mat=None):
    bm = bmesh.new()
    R, N = len(rings), len(rings[0])
    V = [[bm.verts.new(p) for p in r] for r in rings]
    for i in range(R - 1):
        for k in range(N):
            f = bm.faces.new((V[i][k], V[i][(k + 1) % N], V[i + 1][(k + 1) % N], V[i + 1][k]))
            if face_mat:
                f.material_index = face_mat(i, k)
    for cap, i in ((cap0, 0), (cap1, R - 1)):
        if cap:
            c = bm.verts.new(sum((Vector(p) for p in rings[i]), Vector()) / N)
            for k in range(N):
                bm.faces.new((V[i][k], V[i][(k + 1) % N], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, m, smooth)


def block(name, cx, cy, z0, z1, w0, w1, m, d0=None, d1=None, smooth=0):
    """a square / rectangular frustum: width w0 -> w1 (x), depth d0 -> d1 (y), from z0 to z1."""
    d0 = d0 or w0
    d1 = d1 or w1
    r = []
    for z, w, d in ((z0, w0, d0), (z1, w1, d1)):
        r.append([Vector((cx + sx * w / 2, cy + sy * d / 2, z)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    return loft(name, r, m, smooth=smooth)


def tube(name, pts, radii, m, seg=16, smooth=50, cap=True):
    """a swept tube through points with per-point radius."""
    P = [Vector(p) for p in pts]
    rings = []
    for i, p in enumerate(P):
        d = (P[min(len(P) - 1, i + 1)] - P[max(0, i - 1)]).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
        s1 = d.cross(up).normalized()
        s2 = d.cross(s1).normalized()
        r = radii[i]
        rr = r if isinstance(r, (tuple, list)) else (r, r)
        rings.append([p + s1 * math.cos(2 * math.pi * k / seg) * rr[0] + s2 * math.sin(2 * math.pi * k / seg) * rr[1] for k in range(seg)])
    return loft(name, rings, m, cap0=cap, cap1=cap, smooth=smooth)


def ellipsoid(name, c, r, m, seg=(32, 20), smooth=60):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)
    bmesh.ops.scale(bm, vec=r, verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(c))
    return obj(name, bm, m, smooth)


# ================================================================ Fort Wood and the island ground
def star(n, r_out, r_in, rot=0.0):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rot + math.pi * i / n
        pts.append((r * math.sin(a), r * math.cos(a)))
    return pts


def prism_ring(name, outer, inner, z0, z1, m, top_m=None):
    """a wall ring between two closed outlines (same point count), from z0 to z1, with a flat top."""
    bm = bmesh.new()
    n = len(outer)
    ob = [bm.verts.new((x, y, z0)) for x, y in outer]
    ot = [bm.verts.new((x, y, z1)) for x, y in outer]
    ib = [bm.verts.new((x, y, z0)) for x, y in inner]
    it = [bm.verts.new((x, y, z1)) for x, y in inner]
    gap = set()                                                    # the sally port: the way in, under the front point
    for i in range(n):
        j = (i + 1) % n
        mx, my = (outer[i][0] + outer[j][0]) / 2, (outer[i][1] + outer[j][1]) / 2
        if abs(math.atan2(mx, my)) < math.radians(17):
            gap.add(i)
    for i in range(n):
        j = (i + 1) % n
        if i in gap:
            if (i - 1) % n not in gap:
                bm.faces.new((ob[i], ib[i], it[i], ot[i]))         # the passage's side walls, at its two ends
            if j not in gap:
                bm.faces.new((ib[j], ob[j], ot[j], it[j]))
            continue
        bm.faces.new((ob[i], ob[j], ot[j], ot[i]))                 # outer wall
        bm.faces.new((ib[j], ib[i], it[i], it[j]))                 # inner wall (faces the parade)
        f = bm.faces.new((ot[i], ot[j], it[j], it[i]))             # terreplein
        f.material_index = 1 if top_m else 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, [m, top_m] if top_m else m, 0)


ROT = math.pi / 11                                       # a star point straight ahead (+Y), like the sally port
outer = star(11, 50.0, 38.0, ROT)                     # ~100 m point to point
inner = [(x * 0.78, y * 0.78) for x, y in star(11, 48.5, 37.0, ROT)]
prism_ring("FORT_WOOD", outer, inner, 0.0, 6.4, M["fort"], M["lawn"])
# the parade (paved) inside the walls and a wide plaza round the outside of the star
bm = bmesh.new()
vs = [bm.verts.new((x, y, 0.05)) for x, y in inner]
bm.faces.new(vs)
obj("PARADE", bm, M["paving"], 0)

# ================================================================ foundation (stepped concrete) and the granite pedestal
# foundation: 27.7 m (91 ft) square at the base, 20.3 m (66.5 ft) at the top, in three steps
block("FOUND_1", 0, 0, 0.0, 7.0, 27.7, 26.2, M["concrete"])
block("FOUND_2", 0, 0, 7.0, 13.6, 24.6, 23.1, M["concrete"])
block("FOUND_3", 0, 0, 13.6, FOUND_H, 21.6, 20.3, M["concrete"])
# pedestal (Richard Morris Hunt): rusticated base, tapering shaft with corner piers, loggia level, disc frieze,
# cornice and the parapet gallery round the statue's feet
Z = Z_PED
block("PED_base", 0, 0, Z, Z + 3.2, 18.9, 18.3, M["granite"])
block("PED_shaft", 0, 0, Z + 3.2, Z + 16.6, 16.6, 15.0, M["granite"])
for sx in (-1, 1):                                       # corner piers (quoins)
    for sy in (-1, 1):
        block("PED_pier", sx * 7.2, sy * 7.2, Z + 3.2, Z + 16.6, 2.6, 2.2, M["granite_dk"])
block("PED_band", 0, 0, Z + 16.6, Z + 17.4, 16.4, 16.4, M["granite_dk"])
block("PED_loggia", 0, 0, Z + 17.4, Z + 22.6, 15.2, 15.2, M["granite"])
for k in range(4):                                       # a recessed loggia with two columns on every face
    a = k * math.pi / 2
    c, s = math.cos(a), math.sin(a)
    rot = Matrix.Rotation(a, 4, "Z")
    o = block("PED_loggia_bay", 0, 7.35, Z + 18.0, Z + 22.2, 6.6, 6.6, M["dark"], 0.4, 0.4)
    o.data.transform(rot)
    for cx in (-1.4, 1.4):
        o = tube("PED_column", [(cx, 7.75, Z + 18.0), (cx, 7.75, Z + 22.2)], [0.42, 0.36], M["granite"], 12, 30)
        o.data.transform(rot)
    for j in range(10):                                  # the frieze discs (40 in all)
        x = -6.3 + j * 1.4
        o = tube("PED_disc", [(x, 7.86, Z + 23.5), (x, 8.02, Z + 23.5)], [0.52, 0.52], M["granite_dk"], 14, 0)
        o.data.transform(rot)
block("PED_frieze", 0, 0, Z + 22.6, Z + 24.5, 15.7, 15.7, M["granite"])
block("PED_cornice", 0, 0, Z + 24.5, Z + 25.4, 15.9, 17.4, M["granite_dk"])
block("PED_parapet", 0, 0, Z + 25.4, Z + PED_H, 15.6, 15.6, M["granite"])
block("PED_plinth", 0, 0.4, Z_FIG, Z_FIG + 0.8, 11.6, 11.2, M["granite"], 10.6, 10.2)


# ================================================================ the copper figure
# heights are measured from the statue base (heel level) Z_FIG. Sections of the robed body: (z, half-width, half-depth,
# centre x, centre y). She faces +Y; her right side is +X.
SECTIONS = [                                                # a slender, straight-hanging robe (waist 10.67 m across)
    (0.6, 4.75, 4.15, 0.0, 0.2), (2.5, 4.45, 3.85, 0.0, 0.2), (7.0, 4.2, 3.6, 0.05, 0.15), (12.0, 4.15, 3.5, 0.1, 0.25),
    (16.0, 4.45, 3.5, 0.05, 0.15), (18.0, 5.33, 3.45, 0.0, 0.05), (20.5, 4.5, 3.15, 0.0, 0.0), (23.5, 4.3, 2.95, 0.0, 0.15),
    (25.4, 4.55, 2.75, 0.05, 0.05), (26.5, 4.1, 2.45, 0.1, -0.05), (27.4, 2.3, 1.9, 0.05, 0.05), (28.1, 1.25, 1.3, 0.0, 0.2),
    (29.0, 1.12, 1.22, 0.0, 0.25),
]
N_AROUND = 72


def body_point(z, a, w, d, cx, cy):
    """the robe: an ellipse with drapery folds (vertical folds below, a diagonal palla over the left shoulder,
    the right knee pushing the robe forward)."""
    x, y = w * math.sin(a), d * math.cos(a)
    r = 1.0
    if z < 17:                                            # deep vertical folds of the stola, softer higher up
        amp = 0.11 * (1 - z / 24) * (1 + 0.5 * math.sin(a * 3.0 + 0.7))
        r += amp * (abs(math.sin(a * 7 + 0.4 * math.sin(a * 5))) * 2 - 1)     # rounded ridges, sharp troughs
    elif z < 26:                                          # finer folds over the bodice
        r += 0.035 * math.sin(a * 11 + z * 0.2)
    # the palla: a heavy diagonal drape from the left shoulder across the chest to the right hip
    u = (x + 5.0) * 0.55 + (z - 14.0)                     # distance along the diagonal band
    if 0 < z < 27 and y > -1.0:
        r += 0.05 * math.exp(-((u - 9.5) / 1.6) ** 2) + 0.035 * math.exp(-((u - 6.5) / 1.2) ** 2)
    if 8 < z < 15 and x > 0.5 and y > 0:                  # right knee, bent and forward
        r += 0.07 * math.exp(-((z - 11.5) / 2.0) ** 2) * min(1.0, x / 2.0)
    return Vector((cx + x * r, cy + y * r, Z_FIG + z))


def interp_sections(z):
    zs = [s[0] for s in SECTIONS]
    cols = list(zip(*SECTIONS))
    return [float(np.interp(z, zs, cols[i])) for i in range(1, 5)]

rings = []
for z in np.concatenate([np.linspace(0.6, 26.8, 70), np.linspace(27.2, 29.0, 6)]):
    w, d, cx, cy = interp_sections(z)
    rings.append([body_point(z, 2 * math.pi * k / N_AROUND, w, d, cx, cy) for k in range(N_AROUND)])
loft("FIGURE_body", rings, M["copper"], cap0=True, cap1=False, smooth=60)
# the robe's hem spreading onto the plinth, the toes of the left foot peeping out at the front
ellipsoid("FIGURE_hem", (0, 0.25, Z_FIG + 0.65), (5.3, 4.65, 0.7), M["copper_dk"], (48, 10))
ellipsoid("FIGURE_toe", (-1.6, 4.45, Z_FIG + 0.9), (0.75, 1.2, 0.55), M["copper"], (16, 8))

# ---- head (5.26 m chin to cranium, 3.05 m ear to ear) with the face, hair and the crown
HZ = Z_FIG + 33.86 - 2.63                                  # head centre (top of head at heel + 33.86 m)
ellipsoid("HEAD", (0, 0.25, HZ), (1.52, 1.85, 2.63), M["copper"], (36, 24))
ellipsoid("HAIR_bun", (0, -1.25, HZ - 0.9), (1.25, 1.0, 1.3), M["copper_dk"], (20, 12))
for sx in (-1, 1):                                          # hair waves at the temples
    ellipsoid("HAIR_side", (sx * 1.3, -0.2, HZ - 0.2), (0.45, 1.3, 1.5), M["copper_dk"], (14, 10))
ellipsoid("NOSE", (0, 1.9, HZ - 0.1), (0.26, 0.24, 0.74), M["copper"], (12, 10))         # 1.48 m, a straight classical nose
ellipsoid("BROW", (0, 1.95, HZ + 0.62), (1.1, 0.22, 0.2), M["copper"], (16, 8))
for sx in (-1, 1):                                          # eyes: shallow recesses read as shadow
    ellipsoid("EYE", (sx * 0.5, 2.02, HZ + 0.28), (0.38, 0.06, 0.16), M["copper_dk"], (12, 6))
# crown: a diadem with 25 windows and seven rays (the seven seas and continents)
DZ = HZ + 1.15
dia = []
for z, sc in ((DZ - 0.35, 1.0), (DZ + 0.75, 1.04)):
    dia.append([Vector((1.68 * sc * math.sin(2 * math.pi * k / 48), 0.2 + 2.0 * sc * math.cos(2 * math.pi * k / 48), z)) for k in range(48)])
loft("CROWN_diadem", dia, M["copper"], cap0=False, cap1=True, smooth=45)
for j in range(25):                                         # the 25 observation windows across the front
    a = math.radians(-62 + j * (124 / 24))
    p = Vector((1.72 * math.sin(a), 0.2 + 2.04 * math.cos(a), DZ + 0.2))
    n = Vector((math.sin(a), math.cos(a), 0)).normalized()
    tube("CROWN_window", [p, p + n * 0.05], [(0.08, 0.2), (0.08, 0.2)], M["dark"], 6, 0)
for j in range(7):                                          # rays: up to 2.7 m, fanned in the plane of the face
    phi = math.radians(-81 + j * 27)
    base = Vector((1.55 * math.sin(phi), 0.35 + 0.2 * math.cos(phi), DZ + 0.75 + 0.35 * math.cos(phi)))
    dirv = Vector((math.sin(phi), -0.22, math.cos(phi))).normalized()
    L = 2.75 if abs(phi) < 1.0 else 2.45
    bm = bmesh.new()
    side = dirv.cross(Vector((0, 1, 0))).normalized()
    up2 = dirv.cross(side).normalized()
    b0 = [base + side * sx * 0.32 + up2 * sy * 0.22 for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    vs = [bm.verts.new(p) for p in b0]
    tip = bm.verts.new(base + dirv * L)
    for i in range(4):
        bm.faces.new((vs[i], vs[(i + 1) % 4], tip))
    bm.faces.new(list(reversed(vs)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj("CROWN_ray", bm, M["copper"], 0)

# ---- right arm, raised with the torch (12.8 m, 3.66 m thick at the shoulder; the sleeve falls back down the arm)
SH_R = Vector((4.55, 0.1, Z_FIG + 26.3))
ELB = SH_R + Vector((0.95, 0.35, 5.7))
WRI = ELB + Vector((0.55, 0.55, 5.2))
tube("ARM_R_upper", [SH_R + Vector((-0.6, 0, -0.9)), SH_R, SH_R.lerp(ELB, 0.5), ELB], [1.95, 1.83, 1.55, 1.15], M["copper"], 20)
# the sleeve has slid down the raised arm and bunches round the shoulder in soft folds
for f, rr in ((0.12, (2.05, 1.7, 1.6)), (0.32, (1.85, 1.6, 1.45)), (0.52, (1.6, 1.45, 1.2))):
    ellipsoid("SLEEVE_R", SH_R.lerp(ELB, f) + Vector((0.15, -0.35, -0.2)), rr, M["copper_dk"], (20, 12))
tube("ARM_R_fore", [ELB, ELB.lerp(WRI, 0.5), WRI], [1.1, 0.95, 0.72], M["copper"], 18)
HAND = WRI + Vector((0.18, 0.2, 1.1))
ellipsoid("HAND_R", HAND, (1.05, 0.95, 1.55), M["copper"], (16, 12))           # grips the handle (5.0 m hand)
# torch: handle, cup with its flared rim and balcony, gilded flame; tip at statue base + 46.05 m
T_AX = (WRI - ELB).normalized().lerp(Vector((0, 0, 1)), 0.6).normalized()
T0 = HAND - T_AX * 1.0
T_TIP = Vector((HAND.x + 0.4, HAND.y + 0.35, Z_FIG + STATUE_H))
T_AX = (T_TIP - T0).normalized()
Lt = (T_TIP - T0).length
def tp(f):
    return T0 + T_AX * (Lt * f)
tube("TORCH_handle", [tp(0.0), tp(0.30)], [0.55, 0.62], M["copper_dk"], 16)
cup = [tp(0.30), tp(0.40), tp(0.50), tp(0.58), tp(0.62)]
tube("TORCH_cup", cup, [0.65, 0.95, 1.35, 1.75, 1.95], M["copper"], 24, 40)
tube("TORCH_balcony", [tp(0.585), tp(0.615)], [2.25, 2.25], M["copper_dk"], 32, 0)
for j in range(16):                                          # balcony railing posts
    a = 2 * math.pi * j / 16
    side = T_AX.cross(Vector((1, 0, 0))).normalized()
    side2 = T_AX.cross(side).normalized()
    p = tp(0.615) + side * math.cos(a) * 2.2 + side2 * math.sin(a) * 2.2
    tube("TORCH_rail", [p, p + T_AX * 0.9], [0.05, 0.05], M["copper_dk"], 6, 0, cap=False)
# the flame: ribbed, gilded, tapering to the tip
fl = []
for i, f in enumerate(np.linspace(0, 1, 12)):
    z = tp(0.63 + 0.37 * f)
    r = 1.15 * math.sin(math.pi * min(1.0, 0.18 + f * 0.95)) ** 0.8 * (1 - f) ** 0.25 + 0.02
    side = T_AX.cross(Vector((1, 0, 0))).normalized(); side2 = T_AX.cross(side).normalized()
    ring = []
    for k in range(24):
        a = 2 * math.pi * k / 24 + f * 0.9                     # a slight twist, like a flame licking up
        rr = r * (1 + 0.12 * math.sin(a * 6))
        ring.append(z + side * math.cos(a) * rr + side2 * math.sin(a) * rr)
    fl.append(ring)
loft("TORCH_flame", fl, M["flame"], cap0=True, cap1=True, smooth=55)

# ---- left arm, bent, holding the tablet (7.19 x 4.14 x 0.61 m) against her side
SH_L = Vector((-4.5, 0.0, Z_FIG + 26.0))
ELB_L = SH_L + Vector((-1.15, 0.6, -5.4))
HND_L = ELB_L + Vector((0.2, 2.0, 1.6))
tube("ARM_L_upper", [SH_L, SH_L.lerp(ELB_L, 0.5), ELB_L], [1.75, 1.5, 1.2], M["copper"], 18)
tube("ARM_L_fore", [ELB_L, HND_L], [1.1, 0.8], M["copper"], 16)
ellipsoid("HAND_L", HND_L, (0.85, 1.1, 0.8), M["copper"], (14, 10))
# the tablet: long side up, leaning back against the arm and shoulder, its face turned outward-forward
long_ax = Vector((0.18, -0.38, 0.91)).normalized()
face_n = Vector((-0.86, 0.42, 0.0)).normalized()
wide_ax = long_ax.cross(face_n).normalized()
face_n = wide_ax.cross(long_ax).normalized()
TC = HND_L + Vector((-0.55, -0.5, 0.0)) + long_ax * 2.9
bm = bmesh.new()
corners = []
for sl in (-1, 1):
    for sw in (-1, 1):
        for st in (-1, 1):
            corners.append(TC + long_ax * sl * 3.595 + wide_ax * sw * 2.07 + face_n * st * 0.305)
vs = [bm.verts.new(c) for c in corners]
for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
    bm.faces.new([vs[i] for i in f])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.08, segments=2, affect="EDGES")
obj("TABLET", bm, M["copper"], 30)
# the inscription JULY IV MDCCLXXVI (July 4, 1776), raised letters on the tablet's face
cu = bpy.data.curves.new("INSCR", "FONT")
cu.body = "JULY IV\nMDCCLXXVI"
cu.size = 0.55
cu.align_x = "CENTER"
cu.align_y = "CENTER"
cu.extrude = 0.04
to = bpy.data.objects.new("INSCR", cu)
COLL.objects.link(to)
basis = Matrix((wide_ax, long_ax, face_n)).transposed()
to.matrix_world = Matrix.Translation(TC + face_n * 0.33) @ basis.to_4x4()
bpy.context.view_layer.objects.active = to
to.select_set(True)
bpy.ops.object.convert(target="MESH")
to = bpy.context.active_object
to.data.materials.clear(); to.data.materials.append(M["copper_dk"])
to.select_set(False)

# ================================================================ join (two materials groups so night lighting works) + export
bpy.ops.object.select_all(action="DESELECT")
allm = [o for o in bpy.data.objects if o.type == "MESH"]
for o in allm:
    o.select_set(True)
bpy.context.view_layer.objects.active = allm[0]
bpy.ops.object.convert(target="MESH")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
lib = bpy.context.active_object
lib.name = lib.data.name = "LIBERTY"
pts = [v.co for v in lib.data.vertices]
fig = [v.co for v in lib.data.vertices if v.co.z > Z_FIG - 0.01]
print("LIBERTY ground->torch tip %.2f m (NPS 92.99), statue base->tip %.2f m (NPS 46.05), %d tris" % (
    max(p.z for p in pts), max(p.z for p in pts) - Z_FIG, sum(len(p.vertices) - 2 for p in lib.data.polygons)))
head_top = max(p.z for p in pts if abs(p.x) < 1.6 and -2 < p.y < 2.4 and p.z < HZ + 3.5 and p.z > HZ)
print("LIBERTY heel->top of head %.2f m (NPS 33.86)" % (HZ + 2.63 - Z_FIG))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
os.makedirs(os.path.join(ROOT, "blender/heroes"), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender/heroes/statue_of_liberty.blend"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_draco_mesh_compression_enable=True, export_yup=True)
print("EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB")

if PREFIX:
    os.makedirs(os.path.dirname(PREFIX), exist_ok=True)
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    scn.render.resolution_x, scn.render.resolution_y = 1100, 1400
    for m in bpy.data.materials:                             # daytime preview: no floodlight glow
        b = m.node_tree.nodes.get("Principled BSDF") if m.node_tree else None
        if b and m.name.startswith("M_Light_LibertyFlood"):
            b.inputs["Emission Strength"].default_value = 0.0
    wd = bpy.data.worlds.new("w"); scn.world = wd; wd.use_nodes = True
    wd.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.68, 0.85, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(45), 0, math.radians(200)); COLL.objects.link(sun)
    wm = mat("water", "#2A4A55", 0.15)
    bpy.ops.mesh.primitive_plane_add(size=1200, location=(0, 0, -1.8)); bpy.context.active_object.data.materials.append(wm)
    bpy.ops.mesh.primitive_cylinder_add(radius=150, depth=1.9, location=(0, 0, -0.95), vertices=64)
    bpy.context.active_object.data.materials.append(M["lawn"])
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); COLL.objects.link(cam); scn.camera = cam
    for nm, eye, look, lens in (("front", (25, 175, 40), (0, 0, 48), 50), ("34", (120, 120, 60), (0, 0, 50), 45),
                                ("close", (14, 40, 72), (0, 0, 76), 40)):
        cam.location = eye; cam.data.lens = lens
        cam.rotation_euler = (Vector(look) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = f"{PREFIX}_{nm}.png"
        bpy.ops.render.render(write_still=True)
