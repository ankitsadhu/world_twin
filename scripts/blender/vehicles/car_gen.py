"""Parametric car generator: lofted, subdivided body + separate doors, wheels, interior (LOD0) or a light
single-mesh traffic version (LOD1) from the same spec.

Convention (all vehicles): metres, Z up, front = +Y, origin on the ground at the car's centre,
left-hand drive (driver at -X). Animated parts are separate objects with their pivots placed for the game:
  DOOR_* : origin on the hinge (front edge), rotate about local Z
  WHEEL_*: origin at the hub, spin about local X; front wheels also steer about Z
  STEER  : steering wheel, origin at its hub, rotate about its local axis (extras["axis"])
Empties: SEAT_* (sit points, +Y facing), EXIT_* (where the character steps out), CAM_* (chase/hood cams).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import ts_common as C  # noqa: E402


# ----------------------------------------------------------------------------- specs
LINEAR = False   # set by build_vehicle from spec["linear"]: crisp modern bodies keep straight runs between keys


def _lerp_profile(pts, y):
    """Profile lookup between keys (pts sorted by y): smoothstep (soft surfaces) or linear (crisp lines)."""
    if y <= pts[0][0]:
        return pts[0][1]
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        if y <= y1:
            t = (y - y0) / (y1 - y0)
            if not LINEAR:
                t = t * t * (3 - 2 * t)  # smoothstep between keys -> softer surface
            return z0 + (z1 - z0) * t
    return pts[-1][1]


CROSSOVER = {  # compact SUV proportions (current NYC cab fleet type), generic design, no brand features
    "name": "Crossover", "L": 4.60, "W": 1.86, "wheel_r": 0.36, "wheel_w": 0.23,
    "axle_front": 1.37, "axle_rear": -1.32, "track_inset": 0.13, "arch_r": 0.46,
    "top": [(-2.30, 0.98), (-2.27, 1.10), (-2.16, 1.52), (-2.02, 1.65), (-1.6, 1.69), (0.30, 1.69),
            (0.55, 1.62), (1.08, 1.17), (1.55, 1.08), (2.05, 0.98), (2.26, 0.86), (2.30, 0.68)],
    "bottom": [(-2.30, 0.48), (-2.12, 0.34), (-1.9, 0.27), (1.95, 0.27), (2.18, 0.36), (2.30, 0.50)],
    "belt": [(-2.30, 1.06), (-1.9, 1.06), (0.0, 1.02), (1.10, 0.99), (2.30, 0.95)],
    "halfw": [(-2.30, 0.80), (-2.15, 0.90), (-1.9, 0.93), (1.85, 0.93), (2.15, 0.88), (2.30, 0.76)],
    # greenhouse (y ranges): roof front edge, windshield base, rear glass top/bottom, pillar positions
    "roof_front": 0.32, "cowl": 1.08, "rear_glass": (-2.16, -2.02),
    "side_windows": [(0.04, None), (-0.92, -0.14), (-1.86, -1.08)],   # None = follows A-pillar
    "b_pillar": (-0.14, 0.04),
    "doors": {"front": (-0.06, 0.92), "rear": (-0.98, -0.08)},
    "seats_front_y": 0.05, "seats_rear_y": -0.85, "dash_y": 0.78,
}

SEDAN = dict(CROSSOVER, **{
    "name": "Sedan", "L": 4.88, "W": 1.84, "wheel_r": 0.33, "axle_front": 1.43, "axle_rear": -1.40,
    "top": [(-2.44, 0.88), (-2.36, 1.02), (-2.0, 1.06), (-1.62, 1.12), (-1.05, 1.44), (0.25, 1.46),
            (0.55, 1.40), (1.12, 1.04), (1.7, 0.97), (2.25, 0.88), (2.40, 0.76), (2.44, 0.6)],
    "bottom": [(-2.44, 0.42), (-2.25, 0.26), (-2.0, 0.19), (2.05, 0.19), (2.3, 0.28), (2.44, 0.44)],
    "belt": [(-2.44, 0.98), (-1.9, 0.98), (0.0, 0.94), (1.10, 0.92), (2.44, 0.88)],
    "halfw": [(-2.44, 0.78), (-2.25, 0.88), (-1.9, 0.92), (1.9, 0.92), (2.2, 0.86), (2.44, 0.74)],
    "roof_front": 0.28, "cowl": 1.12, "rear_glass": (-1.62, -1.05),
    "side_windows": [(0.04, None), (-0.95, -0.14), (-1.25, -1.02)],
    "doors": {"front": (-0.06, 0.98), "rear": (-1.02, -0.08)},
    "seats_rear_y": -0.88,
})

# The NYC yellow cab: today's most common fleet type is a compact hybrid crossover (4.60 x 1.855 x 1.685 m, 2.69 m
# wheelbase, 18" wheels). Generic design, no brand features: upright tailgate, flat roof with black "floating" pillars,
# a long flat bonnet, squared wheel arches with black cladding, crisp shoulder and character lines.
NYC_CAB = dict(CROSSOVER, **{
    "name": "NYC cab", "L": 4.60, "W": 1.855, "wheel_r": 0.36, "wheel_w": 0.225,
    "axle_front": 1.37, "axle_rear": -1.32, "track_inset": 0.12, "arch_r": 0.47,
    "linear": True, "crisp": True, "subsurf": 0, "livery": True,
    "top": [(-2.30, 1.00), (-2.27, 1.08), (-2.22, 1.14), (-2.13, 1.58), (-2.03, 1.665), (-1.80, 1.685), (0.18, 1.685),
            (0.32, 1.66), (1.10, 1.11), (1.45, 1.075), (2.05, 1.02), (2.22, 0.99), (2.28, 0.94), (2.30, 0.86)],
    "bottom": [(-2.30, 0.44), (-2.24, 0.34), (-2.06, 0.26), (2.02, 0.26), (2.22, 0.32), (2.30, 0.40)],
    "belt": [(-2.30, 1.12), (-2.0, 1.13), (-1.2, 1.10), (0.0, 1.07), (1.10, 1.04), (2.30, 1.00)],
    "halfw": [(-2.30, 0.84), (-2.22, 0.905), (-2.0, 0.925), (1.90, 0.925), (2.18, 0.895), (2.30, 0.83)],
    "roof_front": 0.30, "cowl": 1.10, "rear_glass": (-2.15, -2.04),
    "side_windows": [(0.06, None), (-0.92, -0.12), (-1.90, -1.06)],
    "b_pillar": (-0.12, 0.06),
    "doors": {"front": (-0.05, 0.95), "rear": (-1.02, -0.07)},
    "creases": {1: 0.9, 2: 1.0, 3: 0.9, 4: 0.85, 6: 1.0, 7: 0.9, 9: 1.0},
})

# the crossover body without the cab livery (private SUVs in traffic), and a crisp mid-size sedan
SUV = dict(NYC_CAB, **{"name": "SUV", "livery": False})
SEDAN_CRISP = dict(SEDAN, **{
    "name": "Sedan", "linear": True, "crisp": True, "subsurf": 0, "arch_r": 0.43,
    "top": [(-2.44, 0.90), (-2.40, 0.98), (-2.18, 1.04), (-1.62, 1.10), (-1.05, 1.44), (0.25, 1.46),
            (0.55, 1.40), (1.12, 1.04), (1.75, 0.98), (2.30, 0.90), (2.40, 0.84), (2.44, 0.72)],
    "bottom": [(-2.44, 0.44), (-2.30, 0.30), (-2.08, 0.20), (2.08, 0.20), (2.32, 0.28), (2.44, 0.42)],
    "halfw": [(-2.44, 0.80), (-2.32, 0.89), (-2.0, 0.915), (1.95, 0.915), (2.30, 0.87), (2.44, 0.80)],
    "creases": {1: 0.9, 2: 1.0, 3: 0.9, 4: 0.85, 6: 1.0, 7: 0.9, 9: 1.0},
})

RING_HALF = 12   # points per half section


def section(spec, y):
    """Right-half section points (x, z) from bottom centre to roof centre, plus greenhouse factor g."""
    zt = _lerp_profile(spec["top"], y)
    zb = _lerp_profile(spec["bottom"], y)
    hw = _lerp_profile(spec["halfw"], y)
    # wheel arches lift the lower edge of the side (crisp bodies get clean boolean-cut arches instead)
    for ay in (() if spec.get("crisp") else (spec["axle_front"], spec["axle_rear"])):
        dy = y - ay
        if abs(dy) < spec["arch_r"]:
            zb = max(zb, spec["wheel_r"] + math.sqrt(spec["arch_r"] ** 2 - dy * dy) - 0.02)
    zbelt = min(_lerp_profile(spec["belt"], y), zt - 0.03)
    g = max(0.0, min(1.0, (zt - zbelt - 0.06) / 0.18))
    if spec.get("crisp"):
        # modern crossover: near-vertical sides with a slight tumblehome, a sharp shoulder at the beltline, a
        # character line at 45% height, black cladding up to 12 cm above the sill, a strongly tumbled-in greenhouse
        # and a flat roof with a defined edge
        lower = [(0.0, zb + 0.03), (hw * 0.55, zb), (hw * 0.93, zb + 0.01), (hw * 0.995, zb + 0.12),
                 (hw, zb + 0.45 * (zbelt - zb)), (hw * 0.99, zbelt - 0.035), (hw * 0.955, zbelt)]
        green = [(hw - 0.085, zbelt + 0.02), (hw - 0.15, zbelt + 0.6 * (zt - zbelt)),
                 (hw - 0.205, zt - 0.025), (hw * 0.62, zt), (0.0, zt + 0.012)]
        hood = [(hw * 0.92, zt - 0.02), (hw * 0.8, zt), (hw * 0.55, zt + 0.006), (hw * 0.3, zt + 0.01),
                (0.0, zt + 0.012)]
        upper = [(h[0] + (gr[0] - h[0]) * g, h[1] + (gr[1] - h[1]) * g) for gr, h in zip(green, hood)]
        return lower + upper, g, zbelt, zt, hw
    lower = [(0.0, zb + 0.05), (hw * 0.5, zb + 0.02), (hw * 0.9, zb), (hw, zb + 0.15 * (zbelt - zb)),
             (hw * 1.0, zb + 0.55 * (zbelt - zb)), (hw * 0.985, zbelt - 0.04), (hw * 0.96, zbelt)]
    green = [(hw - 0.10, zbelt + 0.03), (hw - 0.19, zbelt + 0.55 * (zt - zbelt)),
             (hw - 0.27, zt - 0.05), (hw * 0.55, zt), (0.0, zt + 0.015)]
    hood = [(hw * 0.88, zt - 0.015), (hw * 0.74, zt), (hw * 0.55, zt + 0.008), (hw * 0.3, zt + 0.014),
            (0.0, zt + 0.02)]
    upper = [(h[0] + (gr[0] - h[0]) * g, h[1] + (gr[1] - h[1]) * g) for gr, h in zip(green, hood)]
    return lower + upper, g, zbelt, zt, hw


def stations(spec, n):
    L = spec["L"]
    ys = [-L / 2 + L * i / (n - 1) for i in range(n)]
    return ys


# ----------------------------------------------------------------------------- body
def build_body(spec, n_stations, mats):
    """Lofted closed body. Returns bmesh with material indices assigned by region."""
    M = {m: i for i, m in enumerate(mats)}
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings, meta = [], []
    for y in stations(spec, n_stations):
        half, g, zbelt, zt, hw = section(spec, y)
        pts = half + [(-x, z) for x, z in reversed(half[1:-1])]      # closed ring, both sides
        rings.append([bm.verts.new((x, y, z)) for x, z in pts])
        meta.append((y, g, zbelt, zt, hw))
    n = len(rings[0])
    sw = spec["side_windows"]

    def a_pillar_y(z, zbelt, zt):
        t = (z - zbelt) / max(1e-3, zt - zbelt)
        return spec["cowl"] - t * (spec["cowl"] - spec["roof_front"]) - 0.07

    for i in range(len(rings) - 1):
        y = (meta[i][0] + meta[i + 1][0]) / 2
        g = min(meta[i][1], meta[i + 1][1])
        zbelt = (meta[i][2] + meta[i + 1][2]) / 2
        zt = (meta[i][3] + meta[i + 1][3]) / 2
        for k in range(n):
            q = (rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k])
            f = bm.faces.new(q)
            zc = sum(v.co.z for v in q) / 4
            kk = k if k < RING_HALF else (n - 1 - k)                   # mirror index onto right half
            mat = "paint"
            if zc < _lerp_profile(spec["bottom"], y) + 0.13:          # lower cladding / sills
                mat = "trim"
            if g > 0.5 and kk >= 7:                                    # greenhouse faces
                if kk >= 9 and (spec["roof_front"] < y < spec["cowl"] or
                                spec["rear_glass"][0] < y < spec["rear_glass"][1]):
                    mat = "glass"
                elif kk in (7, 8):
                    if spec["roof_front"] - 0.1 < y < spec["cowl"]:
                        mat = "trim" if y > a_pillar_y(zc, zbelt, zt) else mat
                    glass = False
                    for (y0, y1) in sw:
                        y1v = a_pillar_y(zc, zbelt, zt) if y1 is None else y1
                        if y0 < y < y1v:
                            glass = True
                    mat = "glass" if glass else ("trim" if spec["b_pillar"][0] < y < spec["b_pillar"][1]
                                                 or y < -1.0 else mat)
            f.material_index = M[{"paint": mats[0], "trim": mats[1], "glass": mats[2]}[mat]]
            if spec.get("livery"):     # side elevation for the livery texture, mirrored on the left so it reads right
                L = spec["L"]
                left = sum(v.co.x for v in q) < 0
                for loop in f.loops:                           # right side: top half; left side: bottom half
                    u = (loop.vert.co.y + L / 2) / L
                    v = (loop.vert.co.z - 0.20) / 1.60
                    loop[uvl].uv = (1 - u, v / 2) if left else (u, 0.5 + v / 2)
            else:
                for loop in f.loops:
                    loop[uvl].uv = (loop.vert.co.y, loop.vert.co.z)
    # character lines: crease the sill, beltline and roof-edge longitudinal edges (both sides) and the
    # end-panel boundaries so the subdivided body keeps crisp lines instead of looking inflated
    crease = bm.edges.layers.float.get("crease_edge") or bm.edges.layers.float.new("crease_edge")
    n_half = RING_HALF
    lines = spec.get("creases", {2: 0.75, 6: 0.9, 9: 0.8})
    for i in range(len(rings) - 1):
        for k, w in lines.items():
            for idx in (k, 2 * (n_half - 1) - k):
                e = bm.edges.get((rings[i][idx], rings[i + 1][idx]))
                if e:
                    e[crease] = w
    for ring in (rings[0], rings[-1]):
        for k in range(n):
            e = bm.edges.get((ring[k], ring[(k + 1) % n]))
            if e:
                e[crease] = 1.0 if spec.get("crisp") else 0.7
    # end caps (fans) -> grille/tailgate faces, paint
    for ring, sgn in ((rings[0], -1), (rings[-1], 1)):
        c = sum((v.co for v in ring), Vector()) / len(ring)
        if spec.get("crisp"):
            # a chamfered end: an inset ring 7 cm further out (a defined fascia / tailgate edge, not a pillow)
            inner = [bm.verts.new(c + (v.co - c) * 0.9 + Vector((0, 0.07 * sgn, 0))) for v in ring]
            for k in range(n):
                f = bm.faces.new((ring[k], ring[(k + 1) % n], inner[(k + 1) % n], inner[k]))
                f.material_index = M[mats[0]]
                e = bm.edges.get((inner[k], inner[(k + 1) % n]))
                if e:
                    e[crease] = 1.0
            f = bm.faces.new(inner if sgn > 0 else list(reversed(inner)))   # one flat n-gon: subdivides flat
            f.material_index = M[mats[0]]
            continue
        cv = bm.verts.new(c + Vector((0, 0.04 * sgn, 0)))
        for k in range(n):
            f = bm.faces.new((ring[k], ring[(k + 1) % n], cv))
            f.material_index = M[mats[0]]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def subdivide_object(obj, levels=2):
    if levels == 0:
        # crisp bodies: no subdivision; smooth shading only across gentle angles, so shoulder, character line,
        # sills and the end chamfers stay sharp edges instead of rounding into a pillow
        for p in obj.data.polygons:
            p.use_smooth = True
        with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32))
        return
    mod = obj.modifiers.new("Subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    mod.boundary_smooth = "PRESERVE_CORNERS"
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    bpy.data.meshes.remove(old)
    for p in me.polygons:
        p.use_smooth = True


def cut_arches(spec, body, coll):
    """Clean round wheel arches: a boolean cut through the body, then a black plastic arch flare around each opening
    and a wheel-well liner inside it (modern crossovers' squared black arch cladding)."""
    R = spec["arch_r"]
    hw0 = _lerp_profile(spec["halfw"], 0)
    for ay, sx in [(a, s) for a in (spec["axle_front"], spec["axle_rear"]) for s in (-1, 1)]:
        # one short cutter per wheel, from the side in: a full-width one bores a tunnel through the whole body
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=R, depth=0.7, location=(sx * (hw0 + 0.05), ay, spec["wheel_r"] + 0.02),
                                            rotation=(0, math.pi / 2, 0))
        cutter = bpy.context.active_object
        mod = body.modifiers.new("arch", "BOOLEAN")
        mod.operation = "DIFFERENCE"; mod.solver = "EXACT"; mod.object = cutter
        with bpy.context.temp_override(object=body, active_object=body, selected_objects=[body]):
            bpy.ops.object.modifier_apply(modifier="arch")
        bpy.data.objects.remove(cutter)
    p = Parts(["M_Car_TrimBlack"])
    hw = _lerp_profile(spec["halfw"], 0)
    for ay in (spec["axle_front"], spec["axle_rear"]):
        cz = spec["wheel_r"] + 0.02
        for sx in (-1, 1):
            # flare: a flat ring from 0 to 180 deg over the top, 6.5 cm wide, standing 2.5 cm proud of the side
            segs = 24
            ring_o, ring_i, ring_o2, ring_i2 = [], [], [], []
            for k in range(segs + 1):
                a = math.pi * k / segs
                cy, cz2 = math.cos(a), math.sin(a)
                for lst, rr, xo in ((ring_i, R, hw + 0.004), (ring_o, R + 0.065, hw + 0.004),
                                    (ring_i2, R, hw + 0.03), (ring_o2, R + 0.065, hw + 0.012)):
                    lst.append(p.bm.verts.new((sx * xo, ay + cy * rr, cz + cz2 * rr - (0.015 if k in (0, segs) else 0))))
            verts = []
            for k in range(segs):
                for quad in ((ring_i2[k], ring_o2[k], ring_o2[k + 1], ring_i2[k + 1]),     # face
                             (ring_i[k], ring_i2[k], ring_i2[k + 1], ring_i[k + 1]),       # inner lip
                             (ring_o2[k], ring_o[k], ring_o[k + 1], ring_o2[k + 1])):      # outer edge
                    p.bm.faces.new(quad if sx > 0 else tuple(reversed(quad)))
                verts += [ring_i[k], ring_o[k], ring_i2[k], ring_o2[k]]
            p._assign(verts + [ring_i[-1], ring_o[-1], ring_i2[-1], ring_o2[-1]], "M_Car_TrimBlack", True)
            # wheel-well liner: a half cylinder inside the arch, so you never see into the body
            liner = []
            rows = []
            for k in range(segs + 1):
                a = math.pi * k / segs
                rows.append([p.bm.verts.new((sx * x, ay + math.cos(a) * (R - 0.005), cz + math.sin(a) * (R - 0.005)))
                             for x in (hw - 0.45, hw + 0.02)])
            for k in range(segs):
                p.bm.faces.new((rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0]))
                liner += rows[k]
            p._assign(liner + rows[-1], "M_Car_TrimBlack", False)
    return p.to_object("ARCHES", coll, recalc=False)


# ----------------------------------------------------------------------------- parts
class Parts:
    """bmesh helpers that build into one bmesh with material names."""

    def __init__(self, mats):
        self.mats = mats
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def _assign(self, verts, mat, smooth=False):
        i = self.mats.index(mat)
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = i
            f.smooth = smooth
            for loop in f.loops:
                loop[self.uv].uv = (loop.vert.co.x + loop.vert.co.y, loop.vert.co.z)

    def box(self, c, s, mat, rot=Matrix(), bevel=0.0):
        m = Matrix.Translation(c) @ rot @ Matrix.Diagonal((*s, 1))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        if bevel:
            edges = list({e for v in r["verts"] for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=2, affect="EDGES", profile=0.5)
            verts = [v for v in self.bm.verts if v.is_valid and (v.co - Vector(c)).length < max(s) * 1.2]
            self._assign(verts, mat, True)
        else:
            self._assign(r["verts"], mat)

    def cyl(self, c, r, h, mat, axis=Matrix(), segs=16, smooth=True, r2=None):
        m = Matrix.Translation(c) @ axis
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segs, radius1=r, radius2=r2 or r, depth=h,
                                    matrix=m)
        self._assign(res["verts"], mat, smooth)

    def torus(self, c, R, r, mat, rot=Matrix(), seg=24, rseg=8):
        verts = []
        rows = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            row = []
            for j in range(rseg):
                b = 2 * math.pi * j / rseg
                p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
                row.append(self.bm.verts.new(Vector(c) + rot @ p))
            rows.append(row)
            verts += row
        for i in range(seg):
            for j in range(rseg):
                self.bm.faces.new((rows[i][j], rows[(i + 1) % seg][j], rows[(i + 1) % seg][(j + 1) % rseg],
                                   rows[i][(j + 1) % rseg]))
        self._assign(verts, mat, True)

    def lathe(self, profile, mat, segs=32, rot=Matrix(), c=(0, 0, 0)):
        """Revolve (radius, axial) profile around local X."""
        rings = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            rings.append([self.bm.verts.new(Vector(c) + rot @ Vector((ax, r * math.cos(a), r * math.sin(a))))
                          for r, ax in profile])
        for i in range(segs):
            for j in range(len(profile) - 1):
                self.bm.faces.new((rings[i][j], rings[i][j + 1], rings[(i + 1) % segs][j + 1],
                                   rings[(i + 1) % segs][j]))
        self._assign([v for r in rings for v in r], mat, True)

    def to_object(self, name, coll, origin=(0, 0, 0), recalc=True):
        if recalc:
            bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        bmesh.ops.translate(self.bm, verts=self.bm.verts, vec=-Vector(origin))
        return _bm_to_object(self.bm, name, coll, self.mats, origin)


def _bm_to_object(bm, name, coll, mats, origin=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    idx = [p.material_index for p in me.polygons]
    used = sorted(set(idx))
    for m in used:
        me.materials.append(C.get_material(mats[m]))
    remap = {o: n for n, o in enumerate(used)}
    for p, i in zip(me.polygons, idx):
        p.material_index = remap[i]
    o = bpy.data.objects.new(name, me)
    o.location = origin
    coll.objects.link(o)
    return o


def wheel(spec, name, coll, side, mats, segs=32, detailed=True):
    if spec.get("crisp") and detailed:
        return wheel_alloy(spec, name, coll, side, mats, segs)
    """Tyre (lathed, sidewall bulge) + 5-spoke alloy rim; origin at hub. side=+1 right (outer face +X)."""
    p = Parts(mats)
    R, W = spec["wheel_r"], spec["wheel_w"]
    rr = R * 0.68
    tyre = [(rr, -W / 2), (R - 0.03, -W / 2 - 0.005), (R - 0.008, -W / 2 + 0.02), (R, -W / 4), (R, W / 4),
            (R - 0.008, W / 2 - 0.02), (R - 0.03, W / 2 + 0.005), (rr, W / 2)]
    p.lathe(tyre, "M_Car_Tire", segs=segs)
    rim = [(0.0, side * (W / 2 - 0.05)), (rr * 0.3, side * (W / 2 - 0.035)), (rr, side * (W / 2 - 0.01)),
           (rr, -side * (W / 2 - 0.01)), (0.0, -side * (W / 2 - 0.03))]
    p.lathe(rim if side > 0 else list(reversed(rim)), "M_Car_Rim", segs=segs)
    if detailed:
        for k in range(5):  # spokes standing proud of the rim face
            a = 2 * math.pi * k / 5
            rot = Matrix.Rotation(a, 4, "X")
            c = rot @ Vector((side * (W / 2 - 0.015), 0, rr * 0.55))
            p.box(c, (0.03, 0.06, rr * 0.85), "M_Car_Rim", rot=rot)
        p.cyl((side * (W / 2 - 0.01), 0, 0), rr * 0.22, 0.03, "M_Car_Chrome",
              axis=Matrix.Rotation(math.pi / 2, 4, "Y"), segs=16)
    o = p.to_object(name, coll, recalc=False)
    return o


def wheel_alloy(spec, name, coll, side, mats, segs=48):
    """18-inch two-tone alloy: dark recessed dish, ten machined-silver split spokes, centre cap, tyre with sidewall."""
    p = Parts(mats + ["M_Car_TrimBlack"] if "M_Car_TrimBlack" not in mats else mats)
    R, W = spec["wheel_r"], spec["wheel_w"]
    rr = 0.229                                                # 18" rim radius
    o = side * (W / 2)
    tyre = [(rr + 0.01, -W / 2 + 0.01), (R - 0.035, -W / 2 - 0.004), (R - 0.01, -W / 2 + 0.025), (R, -W / 4),
            (R, W / 4), (R - 0.01, W / 2 - 0.025), (R - 0.035, W / 2 + 0.004), (rr + 0.01, W / 2 - 0.01)]
    p.lathe(tyre, "M_Car_Tire", segs=segs)
    # barrel and lip (silver), dish (dark) recessed 6 cm behind the lip
    lip = [(rr, side * (W / 2 - 0.012)), (rr - 0.012, side * (W / 2 - 0.02)), (rr - 0.02, side * (W / 2 - 0.035))]
    p.lathe(lip if side > 0 else list(reversed(lip)), "M_Car_Rim", segs=segs)
    dish = [(rr - 0.02, side * (W / 2 - 0.035)), (rr * 0.55, side * (W / 2 - 0.085)), (0.05, side * (W / 2 - 0.07)),
            (0.0, side * (W / 2 - 0.07))]
    p.lathe(dish if side > 0 else list(reversed(dish)), "M_Car_TrimBlack", segs=segs)
    for k in range(5):                                        # five split (V) spokes, machined face
        for d in (-0.13, 0.13):
            a = 2 * math.pi * k / 5 + d
            rot = Matrix.Rotation(a, 4, "X")
            c = rot @ Vector((side * (W / 2 - 0.045), 0, rr * 0.55))
            tilt = rot @ Matrix.Rotation(side * 0.12, 4, "Y")
            p.box(c, (0.035, 0.024, rr * 0.88), "M_Car_Rim", rot=tilt)
    p.cyl((side * (W / 2 - 0.05), 0, 0), 0.055, 0.03, "M_Car_Chrome", axis=Matrix.Rotation(math.pi / 2, 4, "Y"), segs=20)
    return p.to_object(name, coll, recalc=False)


# ----------------------------------------------------------------------------- attachments via ray casts
def _surface(bvh, origin, direction):
    loc, nrm, idx, dist = bvh.ray_cast(Vector(origin), Vector(direction).normalized())
    return loc, nrm


def attach_lights_and_trim(spec, body_obj, parts, taxi):
    me = body_obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    L = spec["L"]

    def stick(origin, direction, size, mat, out=0.006):
        loc, nrm = _surface(bvh, origin, direction)
        if loc is None:
            return None
        rot = nrm.to_track_quat("Y", "Z").to_matrix().to_4x4()
        parts.box(loc + nrm * out, size, mat, rot=rot)
        return loc, nrm

    if spec.get("crisp"):
        return attach_crisp(spec, bvh, parts, taxi, stick)
    for sx in (-1, 1):
        # headlights: slim LED units at the front corners; DRL strip + amber turn signal
        stick((sx * 0.62, 0, 0.84), (0, 1, 0), (0.42, 0.03, 0.09), "M_Light_Headlight")
        stick((sx * 0.70, 0, 0.78), (0, 1, 0), (0.16, 0.03, 0.04), "M_Light_Turn")
        # tail lights + reverse
        stick((sx * 0.66, 0, 1.0), (0, -1, 0), (0.34, 0.03, 0.09), "M_Light_Taillight")
        stick((sx * 0.55, 0, 0.55), (0, -1, 0), (0.12, 0.03, 0.04), "M_Light_Headlight")
        # side mirrors at the A-pillar base
        zb = _lerp_profile(spec["belt"], spec["cowl"] - 0.2) + 0.08
        loc, nrm = _surface(bvh, (0, spec["cowl"] - 0.22, zb), (sx, 0, 0)) or (None, None)
        if loc is not None:
            parts.box(loc + Vector((sx * 0.13, 0, 0.02)), (0.2, 0.1, 0.13), "M_Car_TrimBlack", bevel=0.02)
            parts.box(loc + Vector((sx * 0.06, 0.0, 0.0)), (0.08, 0.05, 0.05), "M_Car_TrimBlack")
        # door handles (front + rear doors)
        for y in (spec["doors"]["front"][0] + 0.18, spec["doors"]["rear"][0] + 0.2):
            stick((0, y, _lerp_profile(spec["belt"], y) - 0.08), (sx, 0, 0), (0.18, 0.02, 0.035), "M_Car_Chrome")
        # roof rails
        top_y0, top_y1 = -1.55, 0.15
        for y in (top_y0, top_y1):
            stick((sx * 0.62, y, 3.0), (0, 0, -1), (0.06, 0.08, 0.05), "M_Car_TrimBlack")
        mid = (top_y0 + top_y1) / 2
        loc, nrm = _surface(bvh, (sx * 0.62, mid, 3.0), (0, 0, -1))
        if loc is not None:
            parts.box(loc + Vector((0, 0, 0.055)), (0.045, top_y1 - top_y0, 0.03), "M_Car_TrimBlack")
    # full-width tail light bar, grille, lower intake, plates
    stick((0, 0, 1.0), (0, -1, 0), (1.0, 0.025, 0.035), "M_Light_Taillight")
    stick((0, 0, 0.68), (0, 1, 0), (1.05, 0.04, 0.22), "M_Car_TrimBlack")
    for k in range(5):
        stick((0, 0, 0.6 + k * 0.04), (0, 1, 0), (1.0, 0.05, 0.012), "M_Car_Chrome", out=0.02)
    stick((0, 0, 0.44), (0, 1, 0), (0.31, 0.02, 0.155), "M_Car_Plate")
    stick((0, 0, 0.72), (0, -1, 0), (0.31, 0.02, 0.155), "M_Car_Plate")
    if taxi:
        loc, nrm = _surface(bvh, (0, -0.35, 3.0), (0, 0, -1))
        if loc is not None:  # roof sign / ad topper: lit, sellable both sides
            parts.box(loc + Vector((0, 0, 0.05)), (0.06, 0.6, 0.06), "M_Car_TrimBlack")
            parts.box(loc + Vector((0, 0, 0.22)), (0.3, 1.05, 0.3), "M_Light_TaxiTop", bevel=0.03)
            return loc + Vector((0, 0, 0.22))
    return None


def attach_crisp(spec, bvh, parts, taxi, stick):
    """Modern car front and rear. Crossovers (the cab, SUVs): slim LED headlights over a big black trapezoid grille,
    fog-light pods, a silver skid plate; at the back two horizontal tail-light clusters joined by a black tailgate
    band, a tailgate window with wiper, a roof spoiler and roof rails. Sedans: the same language set lower, a trunk
    lid (no tailgate glass, rails or spoiler). Plus mirrors, handles and, on cabs, the roof sign (an ad topper)."""
    suv = spec["name"] != "Sedan"
    k = 1.0 if suv else 0.89                                  # sedans sit lower: lights and grille scale down
    for sx in (-1, 1):
        stick((sx * 0.60, 0, 0.90 * k), (0, 1, 0), (0.46, 0.03, 0.075), "M_Light_Headlight")   # slim LED headlight
        stick((sx * 0.60, 0, 0.855 * k), (0, 1, 0), (0.46, 0.035, 0.018), "M_Light_Turn")      # amber DRL/turn line
        stick((sx * 0.70, 0, 0.47 * k), (0, 1, 0), (0.14, 0.03, 0.05), "M_Light_Headlight")    # fog lamps
        stick((sx * 0.66, 0, 1.06 * k), (0, -1, 0), (0.42, 0.016, 0.09), "M_Light_Taillight", out=0.0)   # tail clusters
        stick((sx * 0.80, 0, 0.98 * k), (0, -1, 0), (0.12, 0.016, 0.2 * k), "M_Light_Taillight", out=0.0)  # wrap-round
        stick((sx * 0.58, 0, 0.48 * k), (0, -1, 0), (0.14, 0.03, 0.03), "M_Light_Taillight")   # bumper reflectors
        zb = _lerp_profile(spec["belt"], spec["cowl"] - 0.2) + 0.06                              # mirrors
        loc, nrm = _surface(bvh, (0, spec["cowl"] - 0.25, zb), (sx, 0, 0))
        if loc is not None:
            parts.box(loc + Vector((sx * 0.14, -0.02, 0.03)), (0.21, 0.11, 0.14), "M_Car_TrimBlack", bevel=0.025)
            parts.box(loc + Vector((sx * 0.05, 0.0, 0.0)), (0.08, 0.06, 0.05), "M_Car_TrimBlack")
        for y in (spec["doors"]["front"][0] + 0.2, spec["doors"]["rear"][0] + 0.22):          # door handles
            stick((0, y, _lerp_profile(spec["belt"], y) - 0.09), (sx, 0, 0), (0.17, 0.02, 0.03), "M_Car_TrimBlack")
        if suv:
            for y in (-1.75, 0.10):                                                             # roof rails
                stick((sx * 0.60, y, 3.0), (0, 0, -1), (0.05, 0.08, 0.05), "M_Car_TrimBlack")
            loc, nrm = _surface(bvh, (sx * 0.60, -0.82, 3.0), (0, 0, -1))
            if loc is not None:
                parts.box(loc + Vector((0, 0, 0.05)), (0.04, 1.85, 0.03), "M_Car_TrimBlack")
    stick((0, 0, 0.66 * k), (0, 1, 0), (1.18, 0.04, 0.34 * k), "M_Car_TrimBlack")              # grille
    for i in range(6):                                                                          # grille bars
        stick((0, 0, (0.52 + i * 0.052) * k), (0, 1, 0), (1.10, 0.05, 0.008), "M_Car_Rim", out=0.03)
    stick((0, 0, 0.36 * k), (0, 1, 0), (0.95, 0.04, 0.06), "M_Car_Rim")                          # skid plate
    stick((0, 0, 0.87 * k), (0, 1, 0), (0.62, 0.03, 0.03), "M_Car_TrimBlack")                    # upper grille bar
    stick((0, 0, 1.06 * k), (0, -1, 0), (0.86, 0.012, 0.05), "M_Car_TrimBlack", out=0.0)         # tail-light band
    stick((0, 0, 0.40 * k), (0, -1, 0), (1.25, 0.03, 0.10), "M_Car_TrimBlack")                   # rear diffuser
    stick((0, 0, 0.66 * k), (0, 1, 0), (0.33, 0.02, 0.10), "M_Car_Plate", out=0.06)             # plates
    stick((0, 0, 0.80 * k), (0, -1, 0), (0.31, 0.02, 0.155), "M_Car_Plate")
    if suv:
        # tailgate window (dark tinted glass in a black frame) and its wiper
        stick((0, 0, 1.36), (0, -1, 0), (1.30, 0.012, 0.36), "M_Car_TrimBlack", out=0.0)
        stick((0, 0, 1.37), (0, -1, 0), (1.20, 0.014, 0.30), "M_Car_Glass", out=0.004)
        stick((0.1, 0, 1.24), (0, -1, 0), (0.42, 0.02, 0.015), "M_Car_TrimBlack", out=0.02)
        loc, nrm = _surface(bvh, (0, -2.0, 3.0), (0, 0, -1))
        if loc is not None:                                                                     # roof spoiler
            parts.box(loc + Vector((0, -0.06, -0.005)), (1.24, 0.16, 0.035), "M_Car_TrimBlack", bevel=0.012)
    if taxi:
        loc, nrm = _surface(bvh, (0, -0.35, 3.0), (0, 0, -1))
        if loc is not None:
            parts.box(loc + Vector((0, 0, 0.05)), (0.06, 0.6, 0.06), "M_Car_TrimBlack")
            parts.box(loc + Vector((0, 0, 0.22)), (0.3, 1.05, 0.3), "M_Light_TaxiTop", bevel=0.03)
            return loc + Vector((0, 0, 0.22))
    return None


# ----------------------------------------------------------------------------- interior
def interior(spec, coll, taxi, mats):
    p = Parts(mats)
    W = spec["W"]
    fy, ry, dy = spec["seats_front_y"], spec["seats_rear_y"], spec["dash_y"]
    floor_z = _lerp_profile(spec["bottom"], 0) + 0.06
    p.box((0, -0.3, floor_z), (W - 0.2, 3.0, 0.04), "M_Car_InteriorFabric")             # carpet
    p.box((0, 0.35, floor_z + 0.12), (0.22, 1.1, 0.22), "M_Car_InteriorPlastic", bevel=0.03)  # tunnel/console
    for sx in (-1, 1):  # front bucket seats
        x = sx * 0.42
        p.box((x, fy, floor_z + 0.26), (0.52, 0.52, 0.16), "M_Car_InteriorFabric", bevel=0.05)
        rot = Matrix.Rotation(math.radians(-14), 4, "X")
        p.box((x, fy - 0.28, floor_z + 0.62), (0.5, 0.12, 0.62), "M_Car_InteriorFabric", rot=rot, bevel=0.05)
        p.box((x, fy - 0.36, floor_z + 1.0), (0.26, 0.1, 0.18), "M_Car_InteriorFabric", rot=rot, bevel=0.04)
    p.box((0, ry, floor_z + 0.25), (W - 0.36, 0.55, 0.16), "M_Car_InteriorFabric", bevel=0.05)  # rear bench
    rot = Matrix.Rotation(math.radians(-16), 4, "X")
    p.box((0, ry - 0.3, floor_z + 0.6), (W - 0.36, 0.13, 0.6), "M_Car_InteriorFabric", rot=rot, bevel=0.05)
    # dashboard: main slab + binnacle + centre screen (emissive) + vents
    p.box((0, dy, floor_z + 0.62), (W - 0.18, 0.38, 0.2), "M_Car_InteriorPlastic", bevel=0.05)
    p.box((0, dy + 0.12, floor_z + 0.42), (W - 0.24, 0.2, 0.3), "M_Car_InteriorPlastic", bevel=0.04)
    p.box((-0.42, dy - 0.12, floor_z + 0.76), (0.34, 0.12, 0.1), "M_Car_InteriorPlastic", bevel=0.03)
    p.box((0.0, dy - 0.17, floor_z + 0.8), (0.28, 0.02, 0.17), "M_Light_StoreSign")
    if taxi:  # partition with plexi window + rear-seat screen (a sellable "taxi TV" ad slot)
        p.box((0, -0.38, floor_z + 0.45), (W - 0.24, 0.04, 0.5), "M_Car_InteriorPlastic")
        p.box((0, -0.38, floor_z + 0.98), (W - 0.3, 0.012, 0.56), "M_Car_Glass")
        for sx in (-1, 1):
            p.box((sx * (W / 2 - 0.16), -0.38, floor_z + 0.98), (0.04, 0.05, 0.6), "M_Car_InteriorPlastic")
        p.box((0, -0.38, floor_z + 1.27), (W - 0.28, 0.05, 0.04), "M_Car_InteriorPlastic")
    o = p.to_object("INTERIOR", coll, recalc=False)
    # steering wheel as its own object (pivot at hub)
    s = Parts(mats)
    tilt = Matrix.Rotation(math.radians(-62), 4, "X")
    hub = Vector((-0.42, dy - 0.3, floor_z + 0.72))
    s.torus((0, 0, 0), 0.19, 0.018, "M_Car_InteriorPlastic", rot=tilt)
    for a in (0, 2.2, -2.2):
        r = tilt @ Matrix.Rotation(a, 4, "Z")
        s.box(r @ Vector((0, 0.09, 0)), (0.03, 0.18, 0.015), "M_Car_InteriorPlastic", rot=r)
    s.cyl((0, 0, 0), 0.055, 0.04, "M_Car_InteriorPlastic", axis=tilt, segs=12)
    s.cyl(tilt @ Vector((0, 0, -0.18)), 0.03, 0.35, "M_Car_InteriorPlastic", axis=tilt, segs=8)
    steer = s.to_object("STEER", coll, origin=(0, 0, 0), recalc=False)
    steer.location = hub
    steer["axis"] = list(tilt @ Vector((0, 0, 1)))
    screen = None
    if taxi:
        sp = Parts(["M_LED_SlotTemplate"])
        sp.box((0, -0.405, floor_z + 0.83), (0.24, 0.01, 0.15), "M_LED_SlotTemplate")
        screen = sp.to_object("AD_VEH_taxi_tv", coll, recalc=False)
    return o, steer, screen, floor_z


# ----------------------------------------------------------------------------- doors
def split_doors(spec, body, coll, mats_body):
    """Move side faces in each door's y-range into DOOR_* objects (hinge at the front edge), give
    them thickness with an inner trim panel (Solidify, material offset)."""
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    doors = []
    for side, sx in (("L", -1), ("R", 1)):
        for key, (y0, y1) in spec["doors"].items():
            sel = []
            for f in bm.faces:
                c = f.calc_center_median()
                hw = _lerp_profile(spec["halfw"], c.y)
                zt = _lerp_profile(spec["top"], c.y)
                if (y0 < c.y < y1 and sx * c.x > hw * 0.62 and
                        _lerp_profile(spec["bottom"], c.y) + 0.06 < c.z < zt - 0.07):
                    sel.append(f)
            if not sel:
                continue
            dbm = bmesh.new()
            uvl = dbm.loops.layers.uv.new("UVMap")
            src_uv = bm.loops.layers.uv.active                 # the doors keep the body's UVs (the livery's "TAXI")
            vmap = {}
            for f in sel:
                vs = []
                for v in f.verts:
                    if v not in vmap:
                        vmap[v] = dbm.verts.new(v.co)
                    vs.append(vmap[v])
                nf = dbm.faces.new(vs)
                nf.material_index = f.material_index
                nf.smooth = True
                if src_uv is not None:
                    for lo, ln in zip(f.loops, nf.loops):
                        ln[uvl].uv = lo[src_uv].uv
            bmesh.ops.delete(bm, geom=sel, context="FACES")
            hinge = Vector((sx * _lerp_profile(spec["halfw"], y1), y1, (_lerp_profile(spec["belt"], y1) + 0.45) / 2 + 0.3))
            bmesh.ops.translate(dbm, verts=dbm.verts, vec=-hinge)
            dme = bpy.data.meshes.new(f"DOOR_{side}_{key}")
            dbm.to_mesh(dme)
            dbm.free()
            for m in body.data.materials:
                dme.materials.append(m)
            dme.materials.append(C.get_material("M_Car_InteriorFabric"))
            d = bpy.data.objects.new(f"DOOR_{side}_{key}", dme)
            d.location = hinge
            coll.objects.link(d)
            sol = d.modifiers.new("Thickness", "SOLIDIFY")
            sol.thickness = 0.045
            sol.offset = -1.0
            sol.material_offset = len(body.data.materials)     # inner shell -> door card fabric
            sol.material_offset_rim = len(body.data.materials)
            dg = bpy.context.evaluated_depsgraph_get()
            new = bpy.data.meshes.new_from_object(d.evaluated_get(dg))
            d.modifiers.clear()
            d.data = new
            bpy.data.meshes.remove(dme)
            d["hinge_axis"] = [0, 0, 1]
            d["open_deg"] = 70.0 * (-sx)                            # swings outward
            doors.append(d)
    bm.to_mesh(me)
    bm.free()
    return doors


def body_shell(body):
    """Give the body panel thickness with an interior headliner on the inside (Solidify, material offset)."""
    n = len(body.data.materials)
    # one inner slot per outer material (solidify clamps the offset index to the last slot otherwise), so the
    # layer behind the glass can be told apart and removed below
    for _ in range(n):
        body.data.materials.append(C.get_material("M_Car_InteriorFabric"))
    sol = body.modifiers.new("Shell", "SOLIDIFY")
    sol.thickness = 0.03
    sol.offset = -1.0
    sol.material_offset = n
    sol.material_offset_rim = n
    dg = bpy.context.evaluated_depsgraph_get()
    new = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
    old = body.data
    body.modifiers.clear()
    body.data = new
    bpy.data.meshes.remove(old)
    # the windows must stay see-through from inside: drop the fabric layer solidify put behind the glass
    names = [m.name.split(".")[0] if m else "" for m in new.materials]
    if "M_Car_Glass" in names[:n]:
        inner_glass = names.index("M_Car_Glass") + n
        bm = bmesh.new()
        bm.from_mesh(new)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == inner_glass], context="FACES")
        bm.to_mesh(new)
        bm.free()


# ----------------------------------------------------------------------------- assembly
def build_vehicle(spec, paint, coll, lod=0, taxi=False):
    """LOD0: drivable / enterable (separate parts, interior). LOD1: traffic (one mesh, dark interior)."""
    # LOD1 glass is opaque dark trim: traffic cars have no interior to see through to
    global LINEAR
    LINEAR = bool(spec.get("linear"))
    names = [paint, "M_Car_TrimBlack", "M_Car_Glass" if lod == 0 else "M_Car_TrimBlack"]
    crisp = spec.get("crisp")
    bm = build_body(spec, (93 if crisp else 26) if lod == 0 else (41 if crisp else 16), names)
    body = _bm_to_object(bm, "BODY", coll, names)
    subdivide_object(body, levels=spec.get("subsurf", 2) if lod == 0 else (0 if crisp else 1))
    arches = cut_arches(spec, body, coll) if spec.get("crisp") else None
    parts = Parts(["M_Light_Headlight", "M_Light_Turn", "M_Light_Taillight", "M_Car_TrimBlack", "M_Car_Chrome",
                   "M_Car_Plate", "M_Light_TaxiTop", "M_Car_Rim", "M_Car_Glass"])
    topper = attach_lights_and_trim(spec, body, parts, taxi)
    trim = parts.to_object("TRIM", coll, recalc=False)
    objs = {"BODY": body, "TRIM": trim}
    if arches is not None:
        objs["ARCHES"] = arches
    hw = _lerp_profile(spec["halfw"], 0)
    wheel_x = hw - spec["track_inset"]
    for tag, y in (("F", spec["axle_front"]), ("R", spec["axle_rear"])):
        for sname, sx in (("L", -1), ("R", 1)):
            w = wheel(spec, f"WHEEL_{tag}{sname}", coll, sx, ["M_Car_Tire", "M_Car_Rim", "M_Car_Chrome"],
                      segs=32 if lod == 0 else 12, detailed=lod == 0)
            w.location = (sx * wheel_x, y, spec["wheel_r"])
            w["spin_axis"] = [1, 0, 0]
            w["steer"] = tag == "F"
            objs[w.name] = w
    if lod == 0:
        objs.update({d.name: d for d in split_doors(spec, body, coll, names)})
        body_shell(body)
        inter, steer, screen, floor_z = interior(spec, coll, taxi, ["M_Car_InteriorFabric", "M_Car_InteriorPlastic",
                                                                    "M_Light_StoreSign", "M_Car_Glass"])
        objs.update({"INTERIOR": inter, "STEER": steer})
        if screen is not None:
            C.set_props(screen, slot_id="veh.taxi.tv", kind="vehicle_screen", shape="flat", tier="standard",
                        width_m=0.24, height_m=0.15, aspect="16x9", default_art="slot_placeholder_16x9.png",
                        building="", status="available")
            objs["AD_VEH_taxi_tv"] = screen
        for nm, loc in (("SEAT_driver", (-0.42, spec["seats_front_y"], floor_z + 0.36)),
                        ("SEAT_front_passenger", (0.42, spec["seats_front_y"], floor_z + 0.36)),
                        ("SEAT_rear_left", (-0.45, spec["seats_rear_y"], floor_z + 0.35)),
                        ("SEAT_rear_right", (0.45, spec["seats_rear_y"], floor_z + 0.35)),
                        ("EXIT_left", (-1.5, spec["seats_front_y"], 0.0)),
                        ("EXIT_right", (1.5, spec["seats_front_y"], 0.0)),
                        ("CAM_chase", (0.0, -7.5, 2.6)), ("CAM_hood", (0.0, 0.9, 1.35))):
            e = bpy.data.objects.new(nm, None)
            e.location = loc
            e.empty_display_size = 0.25
            coll.objects.link(e)
            objs[nm] = e
    else:
        # LOD1: merge everything into one mesh for traffic instancing
        dark = Parts(["M_Car_InteriorPlastic"])
        # kept inside the cabin: behind the windshield base (cowl) and below the roof, so it never pokes through
        dark.box((0, -0.65, 0.9), (spec["W"] - 0.5, 2.3, 0.6), "M_Car_InteriorPlastic")
        objs["INTERIOR"] = dark.to_object("INTERIOR", coll, recalc=False)
    if topper is not None:
        objs["TRIM"]["taxi_topper"] = list(topper)
        if lod == 0:  # NYC cab toppers are two-sided ad boards: each side is a sellable fleet-wide slot
            import slots_tool
            for side, sx, yaw in (("L", -1, 90), ("R", 1, -90)):
                o = slots_tool.flat(f"AD_VEH_taxi_topper_{side}", coll, f"veh.taxi.topper_{side}",
                                    (topper[0] + sx * 0.156, topper[1], topper[2]), 1.0, 0.25, yaw_deg=yaw,
                                    kind="vehicle_topper", tier="standard", building="", aspect="4x1")
                objs[o.name] = o
    return objs
