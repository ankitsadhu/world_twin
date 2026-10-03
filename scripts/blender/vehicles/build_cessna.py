"""A Cessna 172S Skyhawk at true size, built from real dimensions (the plane you fly + the Hudson banner tow).

  blender -b --factory-startup -P scripts/blender/vehicles/build_cessna.py -- [out.glb] [render_prefix]

Real numbers (Cessna 172S POH): span 11.00 m, length 8.28 m, height 2.72 m, wing area 16.2 m^2, root chord 1.63 m,
tip chord 1.12 m, dihedral 1.73 deg, NACA 2412 wing, prop 1.90 m (75 in), main-gear track 2.53 m, wheelbase ~1.65 m,
tailplane span 3.45 m. 15x6.00-6 main tyres, 5.00-5 nose tyre, wheel fairings.

Game contract (same as the old model, so viewer/js/flight.js keeps working):
  * Z up, nose +Y (three.js -Z), wheels on z = 0, origin between the main wheels
  * two objects: PLANE_body and PROPELLER (child, spinner + blades, pivot on the engine axis; spins about local Y)
  * lights use M_Light_* materials (the viewer dims them by day), paint is one livery texture on the fuselage

The fuselage is a loft of measured cross-sections; the livery (windows, stripes, door and panel lines, cowl inlets) is
painted into a texture per pixel from the same section maths, so edges are crisp at any distance. Wings and tail are
lofted airfoils with real hinge gaps for flaps, ailerons, elevators and rudder.
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
OUT = argv[0] if argv else os.path.join(ROOT, "export/vehicles/small_plane.glb")
PREFIX = argv[1] if len(argv) > 1 else os.path.join(ROOT, "renders/vehicles_cessna172")
REG = "N172GT"                                   # fictional registration

bpy.ops.wm.read_factory_settings(use_empty=True)
COLL = bpy.context.scene.collection


# ---------------------------------------------------------------- materials
def mat(name, color, rough=0.4, metal=0.0, coat=0.0, emit=None, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.05
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 4.0
    return m

def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

M = {
    "white": mat("M_Plane_White", srgb("#F3F3EF"), 0.32, coat=0.5),
    "navy": mat("M_Plane_Navy", srgb("#1D3B6E"), 0.35, coat=0.5),
    "red": mat("M_Plane_Red", srgb("#B3262E"), 0.35, coat=0.5),
    "tyre": mat("M_Plane_Tyre", srgb("#1B1B1C"), 0.85),
    "hub": mat("M_Plane_Hub", srgb("#BFC3C7"), 0.35, metal=0.8),
    "chrome": mat("M_Plane_Chrome", srgb("#D8DADC"), 0.15, metal=1.0),
    "steel": mat("M_Plane_GearLeg", srgb("#ECECE8"), 0.35, coat=0.3),
    "black": mat("M_Plane_Black", srgb("#141516"), 0.6),
    "prop": mat("M_Plane_Prop", srgb("#2A2C2E"), 0.45, metal=0.3),
    "tip": mat("M_Plane_PropTip", srgb("#F2F2F2"), 0.4),
    "rubber": mat("M_Plane_Rubber", srgb("#262626"), 0.7),
    "lens": mat("M_Plane_Lens", srgb("#EAF2FF"), 0.05, emit=(1.0, 0.97, 0.9)),
    "red_l": mat("M_Light_NavRed", srgb("#FF2A1A"), 0.1, emit=(1.0, 0.05, 0.02)),
    "green_l": mat("M_Light_NavGreen", srgb("#1AFF6A"), 0.1, emit=(0.02, 1.0, 0.25)),
    "white_l": mat("M_Light_NavWhite", srgb("#FFFFFF"), 0.1, emit=(1.0, 1.0, 1.0)),
    "beacon": mat("M_Light_Beacon", srgb("#FF2010"), 0.1, emit=(1.0, 0.08, 0.02)),
    "exhaust": mat("M_Plane_Exhaust", srgb("#5A4A3E"), 0.6, metal=0.7),
}


def obj(name, bm, material, smooth=40):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    COLL.objects.link(o)
    if isinstance(material, list):
        for m in material:
            me.materials.append(m)
    elif material is not None:
        me.materials.append(material)
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


def loft(name, rings, material, cap0=True, cap1=True, uv=None, closed=True, smooth=40):
    """rings: list of equal-length point lists (each a closed loop). uv(i, k) -> (u, v) optional."""
    bm = bmesh.new()
    lay = bm.loops.layers.uv.new("UVMap")
    R, N = len(rings), len(rings[0])
    V = [[bm.verts.new(p) for p in r] for r in rings]
    for i in range(R - 1):
        for k in range(N if closed else N - 1):
            k1 = (k + 1) % N
            f = bm.faces.new((V[i][k], V[i][k1], V[i + 1][k1], V[i + 1][k]))
            if uv:
                for loop, (ii, kk) in zip(f.loops, ((i, k), (i, k + 1), (i + 1, k + 1), (i + 1, k))):
                    loop[lay].uv = uv(ii, kk)
    for cap, i in ((cap0, 0), (cap1, R - 1)):
        if cap:
            c = bm.verts.new(sum((Vector(p) for p in rings[i]), Vector()) / N)
            for k in range(N):
                bm.faces.new((V[i][k], V[i][(k + 1) % N], c) if i == R - 1 else (V[i][(k + 1) % N], V[i][k], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, material, smooth)


def revolve(name, prof, axis_pt, axis, material, seg=40, smooth=50):
    """prof: [(r, a)] around an axis ('x' or 'y') through axis_pt."""
    rings = []
    for r, a in prof:
        ring = []
        for j in range(seg):
            t = 2 * math.pi * j / seg
            if axis == "x":
                ring.append(Vector(axis_pt) + Vector((a, r * math.cos(t), r * math.sin(t))))
            else:
                ring.append(Vector(axis_pt) + Vector((r * math.cos(t), a, r * math.sin(t))))
        rings.append(ring)
    return loft(name, rings, material, smooth=smooth)


def tube(name, a, b, r0, r1, material, seg=14, flat=1.0):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((0, 1, 0))
    s1 = d.cross(up).normalized()
    s2 = d.cross(s1).normalized()
    rings = []
    for t in (0.0, 0.5, 1.0):
        c, r = a.lerp(b, t), r0 + (r1 - r0) * t
        rings.append([c + s1 * math.cos(2 * math.pi * j / seg) * r + s2 * math.sin(2 * math.pi * j / seg) * r * flat for j in range(seg)])
    return loft(name, rings, material)


# ---------------------------------------------------------------- fuselage: measured sections (y, half-width, top, bottom, centre, n_top, n_bottom)
ST = [
    (2.300, 0.165, 1.385, 1.055, 1.22, 2.0, 2.0),    # cowl lip round the spinner
    (2.275, 0.330, 1.470, 0.950, 1.22, 2.2, 2.2),
    (2.200, 0.440, 1.520, 0.880, 1.21, 2.4, 2.4),
    (2.050, 0.500, 1.550, 0.840, 1.20, 2.6, 2.6),
    (1.800, 0.520, 1.570, 0.820, 1.20, 2.7, 2.7),
    (1.450, 0.530, 1.600, 0.800, 1.22, 2.8, 2.8),    # firewall, windshield base
    (1.250, 0.550, 1.720, 0.790, 1.25, 2.6, 3.0),
    (1.000, 0.570, 1.880, 0.780, 1.28, 2.4, 3.2),
    (0.800, 0.580, 1.980, 0.780, 1.30, 2.6, 3.2),    # windshield top meets the wing leading edge
    (0.300, 0.590, 2.000, 0.780, 1.30, 3.0, 3.2),
    (-0.300, 0.590, 2.000, 0.800, 1.30, 3.0, 3.2),
    (-0.850, 0.565, 1.980, 0.850, 1.30, 2.8, 3.0),   # wing trailing edge
    (-1.300, 0.520, 1.880, 0.920, 1.32, 2.6, 2.8),
    (-1.800, 0.450, 1.770, 0.990, 1.34, 2.4, 2.5),
    (-2.400, 0.370, 1.660, 1.060, 1.35, 2.3, 2.3),
    (-3.000, 0.290, 1.580, 1.120, 1.36, 2.2, 2.2),
    (-3.600, 0.215, 1.510, 1.180, 1.36, 2.1, 2.1),
    (-4.200, 0.150, 1.460, 1.230, 1.35, 2.0, 2.0),
    (-4.800, 0.095, 1.420, 1.270, 1.345, 2.0, 2.0),
    (-5.250, 0.050, 1.395, 1.300, 1.345, 2.0, 2.0),
    (-5.450, 0.015, 1.370, 1.320, 1.345, 2.0, 2.0),
]


def catmull(P, n):
    """dense samples through the station table (each column interpolated against y)."""
    P = np.array(P)
    out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(0, i - 1)], P[i], P[i + 1], P[min(len(P) - 1, i + 2)]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    return np.array(out)

DENSE = catmull(ST, 24)
DENSE = DENSE[np.argsort(-DENSE[:, 0])]
Y0, Y1 = DENSE[0, 0], DENSE[-1, 0]                # nose, tail


def sect(y):
    """section parameters at y (linear between dense samples)."""
    ys = DENSE[::-1, 0]
    return [np.interp(y, ys, DENSE[::-1, c]) for c in range(1, 7)]


def ring_pt(w, zt, zb, zc, nt, nb, th):
    s, c = np.sin(th), np.cos(th)
    x = w * np.sign(s) * np.abs(s) ** (2 / ((nt + nb) / 2))
    n = np.where(c >= 0, nt, nb)
    hz = np.where(c >= 0, zt - zc, zc - zb)
    z = zc + hz * np.sign(c) * np.abs(c) ** (2 / n)
    return x, z


NR = 72                                           # points round each ring
FUS_N = 150                                       # rings nose -> tail
ys = np.linspace(Y0, Y1, FUS_N)
rings = []
for y in ys:
    w, zt, zb, zc, nt, nb = sect(y)
    th = np.linspace(0, 2 * np.pi, NR, endpoint=False)
    x, z = ring_pt(w, zt, zb, zc, nt, nb, th)
    rings.append([Vector((float(x[k]), float(y), float(z[k]))) for k in range(NR)])
U = lambda i, k: ((Y0 - ys[i]) / (Y0 - Y1), k / NR)
fus = loft("FUS", rings, None, cap0=False, cap1=True, uv=U, smooth=89)

# ---------------------------------------------------------------- the livery texture (painted per pixel from the same maths)
TW, TH = 4096, 1024
uu = (np.arange(TW) + 0.5) / TW
vv = (np.arange(TH) + 0.5) / TH
Yp = Y0 - uu * (Y0 - Y1)
TH_ = vv * 2 * np.pi
S = np.array([sect(y) for y in Yp])               # TW x 6
w, zt, zb, zc, nt, nb = [S[:, i][None, :] for i in range(6)]
th = TH_[:, None]
X, Z = ring_pt(w, zt, zb, zc, nt, nb, th)
Yg = np.broadcast_to(Yp[None, :], X.shape)
side = np.abs(np.sin(th)) * np.ones_like(X)       # 1 = flank, 0 = top / belly
top = np.cos(th) * np.ones_like(X)                # +1 top, -1 belly
px = 0.004                                        # ~4 mm per pixel


def aa(d):                                        # signed distance (m) -> coverage
    return np.clip(0.5 - d / px, 0, 1)


def rrect(cy, cz, hy, hz, r):
    qy, qz = np.abs(Yg - cy) - hy + r, np.abs(Z - cz) - hz + r
    return np.hypot(np.maximum(qy, 0), np.maximum(qz, 0)) + np.minimum(np.maximum(qy, qz), 0) - r


white, glass, navy, red = np.array(srgb("#F3F3EF")), np.array([0.018, 0.026, 0.036]), np.array(srgb("#1D3B6E")), np.array(srgb("#B3262E"))
seal, line, inlet = np.array([0.03, 0.03, 0.03]), np.array(srgb("#9A9C9E")), np.array([0.01, 0.01, 0.012])
col = np.ones(X.shape + (3,)) * white
rough = np.full(X.shape, 0.30)


def paint(cov, c, r=None):
    global col, rough
    cov = cov[..., None]
    col = col * (1 - cov) + np.asarray(c) * cov
    if r is not None:
        rough[:] = rough * (1 - cov[..., 0]) + r * cov[..., 0]


flank = np.clip((side - 0.45) / 0.1, 0, 1)
# stripes: a navy sweep from the cowl under the windows, rising up the tail cone; a red pinstripe above it
mid = np.where(Yg > -0.9, 1.10, 1.10 + (-0.9 - Yg) * 0.026)
band = np.clip((side - 0.25) / 0.1, 0, 1) * np.clip((2.12 - Yg) / 0.02, 0, 1)   # stops short of the cowl face
paint(aa(np.abs(Z - mid) - 0.052) * band, navy)
paint(aa(np.abs(Z - (mid + 0.078)) - 0.011) * band, red)
# windows (with black rubber seals) -------------------------------------------------
dwin = []
d = rrect(0.38, 1.675, 0.40, 0.255, 0.07)                                      # front door window
d = np.maximum(d, (Yg - (0.95 - (Z - 1.42) * 0.45)))                            # raked front edge (windshield post)
dwin.append(np.where(flank > 0, d, 9))
dwin.append(np.where(flank > 0, rrect(-0.49, 1.675, 0.39, 0.235, 0.07), 9))    # rear side window
d = rrect(-1.34, 1.66, 0.36, 0.22, 0.08)
d = np.maximum(d, Z - (1.90 + (Yg + 0.98) * 0.30))                             # aft quarter window, top falls aft
dwin.append(np.where(flank > 0, d, 9))
ws = np.maximum(np.maximum(1.335 - Yg, Yg - 0.84) * -1, 0)                     # windshield: between y 0.84 and 1.335
dws = np.maximum(np.maximum(Yg - 1.335, 0.84 - Yg), np.maximum(1.62 - Z, side - 0.83))
dwin.append(dws)
dwin.append(np.maximum(np.maximum(Yg - (-0.93), -1.62 - Yg), np.maximum(-top + 0.55, side - 0.62)))   # rear roof window
dW = np.minimum.reduce(dwin)
paint(aa(dW - 0.012), seal, 0.6)
paint(aa(dW), glass, 0.04)
# door outline, door handle, cowl seams, oil door, tail-cone panel lines
door = rrect(0.40, 1.38, 0.47, 0.60, 0.09)
paint(aa(np.abs(door) - 0.0016) * flank, line)
paint(aa(rrect(-0.02, 1.32, 0.05, 0.012, 0.01)) * flank, np.array([0.55, 0.56, 0.58]), 0.2)
for yl in (1.45, -1.85, -3.30):
    paint(aa(np.abs(Yg - yl) - 0.0012), line)
paint(aa(np.abs(rrect(1.80, 1.57, 0.12, 0.03, 0.02)) - 0.0012) * (top > 0.8), line)    # oil door on top of the cowl
# cowl air inlets either side of the spinner, and the lower cowl outlet
front = np.clip((Yg - 2.235) / 0.01, 0, 1)               # only on the forward-facing cowl face
for sx in (1, -1):
    d = np.hypot((X - sx * 0.26) / 1.0, (Z - 1.16) / 0.8) - 0.07
    paint(aa(d) * front, inlet, 0.9)
paint(aa(rrect(2.0, 0.86, 0.10, 0.06, 0.03)) * (top < -0.9), inlet, 0.9)

img = bpy.data.images.new("T_Cessna_Livery", TW, TH, alpha=False)
enc = np.where(col <= 0.0031308, col * 12.92, 1.055 * np.power(np.clip(col, 0, 1), 1 / 2.4) - 0.055)   # linear -> sRGB pixels
rgba = np.concatenate([enc, np.ones(X.shape + (1,))], axis=2).astype(np.float32)
img.pixels.foreach_set(rgba.ravel())
img.file_format = "JPEG"
img.pack()
orm = bpy.data.images.new("T_Cessna_ORM", TW // 2, TH // 2, alpha=False, is_data=True)
r2 = rough[::2, ::2]
o_rgba = np.stack([np.ones_like(r2), r2, np.zeros_like(r2), np.ones_like(r2)], axis=2).astype(np.float32)
orm.pixels.foreach_set(o_rgba.ravel())
orm.file_format = "PNG"
orm.colorspace_settings.name = "Non-Color"
orm.pack()

paint_m = bpy.data.materials.new("M_Plane_Livery")
paint_m.use_nodes = True
nt_ = paint_m.node_tree
b = nt_.nodes["Principled BSDF"]
t1 = nt_.nodes.new("ShaderNodeTexImage"); t1.image = img
t2 = nt_.nodes.new("ShaderNodeTexImage"); t2.image = orm
sep = nt_.nodes.new("ShaderNodeSeparateColor")
nt_.links.new(t1.outputs["Color"], b.inputs["Base Color"])
nt_.links.new(t2.outputs["Color"], sep.inputs["Color"])
nt_.links.new(sep.outputs["Green"], b.inputs["Roughness"])
nt_.links.new(sep.outputs["Blue"], b.inputs["Metallic"])
b.inputs["Coat Weight"].default_value = 0.5
b.inputs["Coat Roughness"].default_value = 0.05
fus.data.materials.append(paint_m)

# a dark disc closing the cowl behind the spinner
bm = bmesh.new()
c0 = Vector((0, ST[0][0] - 0.01, ST[0][4]))
vs = [bm.verts.new(c0 + Vector((0.165 * math.cos(a), 0, 0.165 * math.sin(a)))) for a in np.linspace(0, 2 * np.pi, 32, endpoint=False)]
bm.faces.new(vs)
obj("COWL_back", bm, M["black"], 0)


# ---------------------------------------------------------------- airfoils
def naca4(m, p, t, x):
    yt = 5 * t * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4)
    if m == 0:
        yc, dy = np.zeros_like(x), np.zeros_like(x)
    else:
        yc = np.where(x < p, m / p ** 2 * (2 * p * x - x ** 2), m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x ** 2))
        dy = np.where(x < p, 2 * m / p ** 2 * (p - x), 2 * m / (1 - p) ** 2 * (p - x))
    a = np.arctan(dy)
    return x - yt * np.sin(a), yc + yt * np.cos(a), x + yt * np.sin(a), yc - yt * np.cos(a)


def foil(m, p, t, c0, c1, n=26):
    """closed outline of the airfoil between chord fractions c0..c1 (a flat spar face at c1, a rounded hinge nose at c0)."""
    if c0 <= 0:
        x = (1 - np.cos(np.linspace(0, np.pi / 2, n))) * c1        # dense at the leading edge
    else:
        x = np.linspace(c0 + 0.02, c1, n)
    xu, yu, xl, yl = naca4(m, p, t, x)
    up = list(zip(xu[::-1], yu[::-1]))
    lo = list(zip(xl[1:], yl[1:]))
    pts = up + lo if c0 <= 0 else up + [(c0 + 0.006, (yu[0] + yl[0]) / 2)] + lo
    return pts                                                        # (chord fraction, thickness/chord)


def section(pts, le, chord, z, twist, x):
    out = []
    ct, st = math.cos(twist), math.sin(twist)
    for cx, cz in pts:
        dx, dz = (cx - 0.25) * chord, cz * chord                      # twist about the quarter chord
        yy = le - 0.25 * chord - (dx * ct + dz * st)
        zz = z + (dz * ct - dx * st)
        out.append(Vector((x, yy, zz)))
    return out


def mirror(o):
    me = o.data
    for v in me.vertices:
        v.co.x = -v.co.x
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    return o


# ---------------------------------------------------------------- wings (high wing, constant-chord centre, tapered outer panels)
DIH = math.radians(1.73)
TE_Y, ROOT_C, TIP_C, ROOT_Z = -0.83, 1.63, 1.12, 2.005
X_ROOT, X_BREAK, X_TIP = 0.0, 2.55, 5.42                              # the tip cap adds the last 8 cm (span 11.0 m)


def wing_at(x):
    c = ROOT_C if x <= X_BREAK else ROOT_C + (TIP_C - ROOT_C) * (x - X_BREAK) / (X_TIP - X_BREAK)
    tw = math.radians(1.5 - 3.0 * max(0.0, x - X_BREAK) / (X_TIP - X_BREAK))   # washout: 1.5 deg root, -1.5 tip
    return TE_Y + c, c, ROOT_Z + x * math.tan(DIH), tw


def wing_part(name, c0, c1, xa, xb, material, steps=6, caps=(True, True)):
    pts = foil(0.02, 0.4, 0.12, c0, c1)
    rings = []
    for x in np.linspace(xa, xb, steps):
        le, c, z, tw = wing_at(x)
        rings.append(section(pts, le, c, z, tw, x))
    return loft(name, rings, material, cap0=caps[0], cap1=caps[1], smooth=35)


parts = []
CTRL = []                                         # moving surfaces: (object, name, hinge point A, hinge point B)


def wing_hinge(xa, xb, ch):
    """two points on a wing hinge line (chord fraction ch, mid-thickness), right wing."""
    out = []
    for x in (xa, xb):
        le, c, z, tw = wing_at(x)
        out.append(section([(ch, 0.0136)], le, c, z, tw, x)[0])
    return out

for sx in (1, -1):
    ps = [wing_part("WING_box_in", 0.0, 0.70, 0.0, 2.62, M["white"], 8),           # inner box (ahead of the flap)
          wing_part("WING_flap", 0.72, 1.0, 0.62, 2.60, M["white"], 4),
          wing_part("WING_box_out", 0.0, 0.72, 2.62, X_TIP, M["white"], 8),
          wing_part("WING_aileron", 0.74, 1.0, 2.68, 5.10, M["white"], 5),
          wing_part("WING_tipfill", 0.72, 1.0, 5.12, X_TIP, M["white"], 3),
          wing_part("WING_rootfill", 0.70, 1.0, 0.0, 0.62, M["white"], 3)]
    # rounded tip cap: the tip section shrinks into a soft lip
    pts = foil(0.02, 0.4, 0.12, 0.0, 1.0, 30)
    le, c, z, tw = wing_at(X_TIP)
    rings = []
    for f, dx in ((1.0, 0.0), (0.93, 0.035), (0.75, 0.065), (0.42, 0.08)):
        cc = c * (0.55 + 0.45 * f)
        sec = section([(p[0], p[1] * f) for p in pts], le - (c - cc) * 0.3, cc, z + 0.004, tw, X_TIP + dx)
        rings.append(sec)
    ps.append(loft("WING_tip", rings, M["white"], cap0=False, cap1=True, smooth=50))
    # nav light lens on the tip leading edge: red on the left (port), green on the right (starboard)
    le, c, z, tw = wing_at(X_TIP)
    lp = Vector((X_TIP + 0.055, le - 0.10, z + 0.03))
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.035)
    bmesh.ops.translate(bm, verts=bm.verts, vec=lp)
    ps.append(obj("NAV", bm, M["green_l"] if sx > 0 else M["red_l"], 0))
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.022)   # white strobe aft
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((X_TIP + 0.06, TE_Y + 0.12, z + 0.03)))
    ps.append(obj("STROBE", bm, M["white_l"], 0))
    # wing strut: streamlined, from the lower fuselage to the front spar
    le, c, z, tw = wing_at(2.55)
    a, bpt = Vector((0.50, 0.32, 0.96)), Vector((2.50, le - 0.30 * c, z - 0.01))
    ps.append(tube("STRUT", a, bpt, 0.052, 0.046, M["white"], 16, flat=0.36))
    ps = [p for p in ps if p]
    if sx < 0:
        for p in ps:
            mirror(p)
            if p.name.startswith("NAV"):
                p.data.materials[0] = M["red_l"]
    side = "R" if sx > 0 else "L"                                     # starboard / port
    for o, nm, (xa, xb, ch) in ((ps[1], "FLAP", (0.62, 2.60, 0.735)), (ps[3], "AILERON", (2.68, 5.10, 0.755))):
        a, b = wing_hinge(xa, xb, ch)
        if sx < 0:
            a, b = Vector((-a.x, a.y, a.z)), Vector((-b.x, b.y, b.z))
        CTRL.append((o, f"{nm}_{side}", a, b))
    parts += ps

# fuel caps (both wings) and the landing light in the left leading edge
for sx in (1, -1):
    le, c, z, tw = wing_at(1.95)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=18, radius1=0.042, radius2=0.038, depth=0.012)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((sx * 1.95, le - 0.40, z + 0.118)))
    parts.append(obj("FUELCAP", bm, M["hub"], 0))
le, c, z, tw = wing_at(1.30)
bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=8, radius=0.06)
bmesh.ops.scale(bm, vec=(1.6, 0.35, 0.8), verts=bm.verts)
bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((-1.30, le + 0.004, z + 0.035)))
parts.append(obj("LANDING_LIGHT", bm, M["lens"], 0))
# pitot tube under the left wing
le, c, z, tw = wing_at(3.30)
parts.append(tube("PITOT", (-3.30, le - 0.20, z - 0.02), (-3.30, le + 0.18, z - 0.10), 0.008, 0.007, M["chrome"], 8))

# ---------------------------------------------------------------- tail: tailplane + elevators, fin + rudder, dorsal fin
def tail_at(x):                                    # tailplane: x from root 0 to tip 1.725
    f = x / 1.725
    le = -4.38 - 0.30 * f
    c = 1.30 - 0.45 * f
    return le, c, 1.345, 0.0

for sx in (1, -1):
    tp = []
    for name, c0, c1, n in (("HTAIL", 0.0, 0.56, 5), ("ELEVATOR", 0.58, 1.0, 5)):
        pts = foil(0, 0, 0.09, c0, c1)
        rings = []
        for x in np.linspace(0.10 if name == "HTAIL" else 0.16, 1.62, n):
            le, c, z, tw = tail_at(x)
            rings.append(section(pts, le, c, z, 0.0, x))
        tp.append(loft(name, rings, M["white"], smooth=35))
    pts = foil(0, 0, 0.09, 0.0, 1.0, 24)
    le, c, z, tw = tail_at(1.62)
    rings = [section([(p[0], p[1] * f) for p in pts], le - (c - c * (0.6 + 0.4 * f)) * 0.3, c * (0.6 + 0.4 * f), z, 0, 1.62 + dx)
             for f, dx in ((1.0, 0.0), (0.85, 0.045), (0.5, 0.09), (0.2, 0.105))]
    tp.append(loft("HTAIL_tip", rings, M["white"], cap0=False, smooth=50))
    if sx < 0:
        for p in tp:
            mirror(p)
    hp = []
    for x in (0.16, 1.62):
        le, c, z, tw = tail_at(x)
        q = section([(0.595, 0.0)], le, c, z, 0.0, x)[0]
        hp.append(Vector((q.x * sx, q.y, q.z)))
    CTRL.append((tp[1], "ELEVATOR_" + ("R" if sx > 0 else "L"), hp[0], hp[1]))
    parts += tp


def fin_rings(c0, c1, heights, le_f, te_f, n=24):
    pts = foil(0, 0, 0.10, c0, c1, n)
    rings = []
    for zz in heights:
        le, te = le_f(zz), te_f(zz)
        c = le - te
        ring = []
        for cx, cz in pts:
            ring.append(Vector((cz * c, le - cx * c, zz)))
        rings.append(ring)
    return rings

hinge = lambda zz: -5.06 - (zz - 1.35) * 0.06
fin_le = lambda zz: float(np.interp(zz, [1.40, 1.58, 1.74, 1.95, 2.70], [-2.70, -3.30, -3.85, -4.25, -5.02]))
rudder_te = lambda zz: hinge(zz) - 0.64 * max(0.06, (1 - max(0.0, (zz - 1.95) / 0.78) ** 2.2)) ** 0.5
Hs = [1.40, 1.58, 1.74, 1.95, 2.13, 2.15, 2.27, 2.29, 2.45, 2.60, 2.70]
fin = loft("VTAIL", fin_rings(0.0, 1.0, Hs, fin_le, lambda zz: hinge(zz) + 0.015), M["white"], smooth=35)
rH = [1.37, 1.6, 1.95, 2.13, 2.15, 2.27, 2.29, 2.45, 2.58, 2.68, 2.72]
rud = loft("RUDDER", fin_rings(0.0, 1.0, rH, lambda zz: hinge(zz) - 0.012, rudder_te), M["white"], smooth=35)
parts += [fin, rud]
CTRL.append((rud, "RUDDER", Vector((0, hinge(1.37) - 0.03, 1.37)), Vector((0, hinge(2.72) - 0.03, 2.72))))
# a navy band across fin and rudder (faces between the 2.15 and 2.27 rings) and a red pinstripe below it
for o, hs in ((fin, Hs), (rud, rH)):
    o.data.materials.append(M["navy"]); o.data.materials.append(M["red"])
    for p in o.data.polygons:
        zc_ = p.center.z
        if 2.15 < zc_ < 2.27:
            p.material_index = 1
        elif 2.13 < zc_ < 2.15:
            p.material_index = 2
# rotating beacon on the fin tip, white tail light at the tail cone
bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.035, radius2=0.025, depth=0.07)
bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((0, fin_le(2.70) - 0.12, 2.735)))
parts.append(obj("BEACON", bm, M["beacon"], 0))
bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.025)
bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((0, rudder_te(1.40) - 0.01, 1.40)))
parts.append(obj("TAIL_LIGHT", bm, M["white_l"], 0))

# ---------------------------------------------------------------- landing gear
TRACK, AXLE_Z, R_MAIN, R_NOSE = 2.53 / 2, 0.215, 0.215, 0.19


def wheel(cx, cy, cz, r, w, name):
    prof = [(r * 0.50, -w / 2), (r * 0.80, -w / 2 - 0.004), (r * 0.95, -w / 2 + 0.004), (r, -w / 2 + 0.03), (r, w / 2 - 0.03),
            (r * 0.95, w / 2 - 0.004), (r * 0.80, w / 2 + 0.004), (r * 0.50, w / 2)]
    t = revolve(name + "_tyre", prof, (cx, cy, cz), "x", M["tyre"], 36, 55)
    h = revolve(name + "_hub", [(0.0, -w / 2 + 0.01), (r * 0.5, -w / 2 + 0.01), (r * 0.5, w / 2 - 0.01), (0.0, w / 2 - 0.01)], (cx, cy, cz), "x", M["hub"], 24, 30)
    return [t, h]


def pant(cx, cy, cz, L, W, H, name):
    """teardrop wheel fairing with an opening under the tyre."""
    rings = []
    for t in np.linspace(0, 1, 16):
        yy = cy + L * 0.42 - t * L
        s = math.sin(math.pi / 2 * t / 0.38) ** 0.55 if t < 0.38 else max(0.03, (1 - t) / 0.62) ** 1.15   # round nose, long tail
        ring = []
        for j in range(24):
            a = 2 * math.pi * j / 24
            ring.append(Vector((cx + W / 2 * s * math.sin(a), yy, cz + H / 2 * max(s, 0.08) * math.cos(a) + (0.03 * t if t > 0.5 else 0))))
        rings.append(ring)
    o = loft(name, rings, M["white"], smooth=50)
    bm = bmesh.new(); bm.from_mesh(o.data)                         # the slot the tyre shows through
    dead = [f for f in bm.faces if f.calc_center_median().z < cz - H * 0.40 and abs(f.calc_center_median().y - cy) < 0.22]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(o.data); bm.free()
    return o

for sx in (1, -1):
    parts += wheel(sx * TRACK, 0.0, AXLE_Z, R_MAIN, 0.15, "MAIN")
    parts.append(pant(sx * TRACK, 0.0, AXLE_Z + 0.03, 0.98, 0.25, 0.50, "PANT"))
    # tubular spring-steel leg: from the belly out and down to the axle (inboard of the fairing)
    parts.append(tube("LEG", (sx * 0.40, 0.02, 0.83), (sx * (TRACK - 0.12), 0.0, AXLE_Z + 0.10), 0.034, 0.026, M["steel"], 12))
    # boarding step on the leg
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(0.11, 0.09, 0.012), verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((sx * 0.86, 0.10, 0.55)))
    parts.append(obj("STEP", bm, M["rubber"], 0))
NOSE_Y = 1.66
parts += wheel(0.0, NOSE_Y, R_NOSE, R_NOSE, 0.125, "NOSEW")
parts.append(pant(0.0, NOSE_Y, R_NOSE + 0.03, 0.74, 0.20, 0.44, "NOSEPANT"))
parts.append(tube("OLEO", (0.0, NOSE_Y - 0.06, 0.90), (0.0, NOSE_Y, R_NOSE + 0.20), 0.045, 0.045, M["white"], 14))
parts.append(tube("OLEO_chrome", (0.0, NOSE_Y, R_NOSE + 0.28), (0.0, NOSE_Y, R_NOSE + 0.08), 0.03, 0.03, M["chrome"], 12))
parts.append(tube("TORQUE_LINK", (0.0, NOSE_Y + 0.07, R_NOSE + 0.34), (0.0, NOSE_Y + 0.07, R_NOSE + 0.14), 0.012, 0.012, M["hub"], 6))
# exhaust stub under the right side of the cowl
parts.append(tube("EXHAUST", (0.20, 2.02, 0.86), (0.24, 1.86, 0.74), 0.028, 0.028, M["exhaust"], 12))

# ---------------------------------------------------------------- antennas
parts.append(tube("COM_ANT", (0.0, -0.95, 1.99), (0.0, -1.18, 2.30), 0.016, 0.006, M["black"], 8, flat=0.35))
parts.append(tube("COM_ANT2", (0.0, -1.55, 1.83), (0.0, -1.72, 2.08), 0.014, 0.005, M["black"], 8, flat=0.35))
bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=8, radius=0.05)
bmesh.ops.scale(bm, vec=(1, 1.3, 0.35), verts=bm.verts)
bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((0.0, -0.20, 2.205)))
parts.append(obj("GPS_ANT", bm, M["white"], 0))
parts.append(tube("BELLY_ANT", (0.0, -2.2, 1.07), (0.0, -2.45, 0.80), 0.006, 0.004, M["black"], 6))

# ---------------------------------------------------------------- registration on both sides of the tail cone (FAA-style block letters)
reg_objs = []
for sx in (1, -1):
    cu = bpy.data.curves.new("REG", "FONT")
    cu.body = REG
    cu.size = 0.17
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    to = bpy.data.objects.new("REG", cu)
    COLL.objects.link(to)
    yc, zc_ = -3.25, 1.37
    w_, zt_, zb_, zcc, nt_s, nb_s = sect(yc)
    to.rotation_euler = (math.pi / 2, 0, math.pi / 2 if sx > 0 else -math.pi / 2)   # reads nose-to-tail... left to right from outside
    to.location = (sx * (sect(yc + 0.6)[0] + 0.08), yc, zc_)       # start fully outside the skin, then wrap onto it
    bpy.context.view_layer.objects.active = to
    to.select_set(True)
    bpy.ops.object.convert(target="MESH")
    to = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm = bmesh.new(); bm.from_mesh(to.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=3, use_grid_fill=True)
    bm.to_mesh(to.data); bm.free()
    sw = to.modifiers.new("wrap", "SHRINKWRAP")
    sw.target = fus
    sw.wrap_method = "NEAREST_SURFACEPOINT"
    sw.offset = 0.005
    bpy.ops.object.modifier_apply(modifier="wrap")
    to.select_set(False)
    to.data.materials.clear()
    to.data.materials.append(M["navy"])
    reg_objs.append(to)
parts += reg_objs

# ---------------------------------------------------------------- propeller: spinner + two twisted blades (75 in)
PROP_Y, PROP_Z = 2.36, 1.22
spin = revolve("SPINNER", [(0.165, 0.0), (0.162, 0.05)] + [(0.162 * (1 - t ** 1.6) ** 0.62, 0.05 + t * 0.21) for t in np.linspace(0.08, 1.0, 12)],
               (0, ST[0][0] - 0.005, PROP_Z), "y", M["white"], 40, 60)
blades = []
for k in (0, 1):
    rings = []
    R = 0.95
    for r in np.linspace(0.10, R, 18):
        f = (r - 0.10) / (R - 0.10)
        c = 0.085 + 0.09 * math.sin(math.pi * min(1.0, f * 1.1)) ** 0.8 - 0.02 * f
        if f > 0.92:
            c *= math.sqrt(max(0.05, 1 - ((f - 0.92) / 0.08) ** 2))
        beta = math.radians(38 - 24 * f)
        pts = foil(0.04, 0.3, 0.14 - 0.08 * f, 0.0, 1.0, 14)
        ring = []
        for cx, cz in pts:
            u, v = (cx - 0.35) * c, cz * c                            # chord along x (rotation), thickness along y (axis)
            x = u * math.cos(beta) - v * math.sin(beta)
            yv = u * math.sin(beta) + v * math.cos(beta)
            ring.append(Vector((x, PROP_Y + 0.04 + yv, PROP_Z + r)))
        rings.append(ring)
    bo = loft("BLADE", rings, [M["prop"], M["tip"]], smooth=40)
    for p in bo.data.polygons:
        if p.center.z - PROP_Z > 0.84:
            p.material_index = 1
    if k:
        rot = Matrix.Translation((0, 0, PROP_Z)) @ Matrix.Rotation(math.pi, 4, "Y") @ Matrix.Translation((0, 0, -PROP_Z))
        bo.data.transform(rot)
    blades.append(bo)

# ---------------------------------------------------------------- join, pivot, export
def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    return o

moving = [c[0] for c in CTRL]
body = join([fus] + [o for o in bpy.data.objects if o.type == "MESH" and o not in blades and o is not spin and o is not fus
                     and o not in moving], "PLANE_body")
# control surfaces: own objects, origin on the hinge line, hinge direction stored for the game (glTF extras)
for o, nm, a, b in CTRL:
    ax = (b - a).normalized()
    if ax.x < -0.5 or (abs(ax.x) < 0.5 and ax.z < 0):
        ax = -ax                                   # wings / tail: +X ; rudder: +Z  (one sign convention for the game)
    mid = (a + b) / 2
    o.data.transform(Matrix.Translation(-mid))
    o.location = mid
    o.name = o.data.name = nm
    o.parent = body
    o["hinge_axis"] = [round(ax.x, 5), round(ax.y, 5), round(ax.z, 5)]
prop = join([spin] + blades, "PROPELLER")
piv = Vector((0, PROP_Y, PROP_Z))
prop.data.transform(Matrix.Translation(-piv))
prop.location = piv
prop.parent = body

bpy.context.view_layer.update()
bb = [o.matrix_world @ v.co for o in [body, prop] + moving for v in o.data.vertices]
mn = [min(p[i] for p in bb) for i in range(3)]
mx = [max(p[i] for p in bb) for i in range(3)]
tris = sum(len(p.vertices) - 2 for o in [body, prop] + moving for p in o.data.polygons)
print("CESSNA span %.2f m, length %.2f m, height %.2f m, %d tris" % (mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], tris))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender/vehicles/cessna172.blend"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_draco_mesh_compression_enable=True, export_yup=True, export_extras=True,
                          export_image_format="JPEG", export_jpeg_quality=88)
print("EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB")

# ---------------------------------------------------------------- previews
if PREFIX:
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    scn.render.resolution_x, scn.render.resolution_y = 1600, 900
    scn.view_settings.view_transform = "AgX"
    wd = bpy.data.worlds.new("w"); scn.world = wd; wd.use_nodes = True
    bg = wd.node_tree.nodes["Background"]
    sky = wd.node_tree.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"; sky.sun_elevation = math.radians(35); sky.sun_rotation = math.radians(140)
    except Exception:
        pass
    wd.node_tree.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.35
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(140)); COLL.objects.link(sun)
    gm = mat("ground", (0.32, 0.33, 0.34), 0.8)
    bpy.ops.mesh.primitive_plane_add(size=80); bpy.context.active_object.data.materials.append(gm)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); COLL.objects.link(cam); scn.camera = cam
    cam.data.lens = 50
    for nm, eye, look in (("34", (7.5, 9.0, 3.6), (0, -0.6, 1.2)), ("side", (13.5, -1.4, 1.4), (0, -1.4, 1.3)),
                          ("rear", (-6.5, -12.0, 4.2), (0, -1.0, 1.4)), ("front", (0.0, 12.0, 1.5), (0, 0, 1.35))):
        cam.location = eye
        cam.rotation_euler = (Vector(look) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = f"{PREFIX}_{nm}.png"
        bpy.ops.render.render(write_still=True)
