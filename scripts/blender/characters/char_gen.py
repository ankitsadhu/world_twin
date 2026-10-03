"""Parametric stylised character generator: one JSON spec -> a smooth, rigged, game-ready character.

  blender -b --factory-startup -P scripts/blender/characters/char_gen.py -- config/characters/<id>.json

Writes blender/characters/<id>.blend (collection CHAR_<id>), export/characters/<id>.glb (skinned, with poses as
actions) and renders/characters/<id>_front.png / _34.png to compare with the reference image.

Everything is built from the same skeleton, so a new character is a new spec: proportions, skin, face, hair style,
top, bottoms and shoes are presets with colours. Conventions: metres, Z up, the character faces -Y (glTF +Z),
feet on the ground at the origin, A-pose rest. Bones use Mixamo names (Hips, Spine, LeftArm, ...) so standard
animations retarget onto it.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


# ----------------------------------------------------------------------------- materials
def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def material(name, hexcol, rough=0.6, alpha=1.0, sss=0.0, emit=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*srgb(hexcol), 1)
    b.inputs["Roughness"].default_value = rough
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = (0.9, 0.35, 0.2)
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb(hexcol), 1)
        b.inputs["Emission Strength"].default_value = emit
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    return m


# ----------------------------------------------------------------------------- small helpers
class Builder:
    def __init__(self, spec):
        self.spec = spec
        self.id = spec["id"]
        self.coll = bpy.data.collections.new(f"CHAR_{self.id}")
        bpy.context.scene.collection.children.link(self.coll)
        self.objs = {}
        self.s = spec.get("height", 1.68) / 1.68           # everything below is laid out for a 1.68 m character

    def obj_from_bm(self, name, bm, mat, smooth=True):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = smooth
        me.materials.append(mat)
        o = bpy.data.objects.new(name, me)
        self.coll.objects.link(o)
        self.objs[name] = o
        return o

    def bake(self, o, name=None):
        """Apply all modifiers / convert a curve: returns a plain mesh object (same name)."""
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        mats = list(o.data.materials) if hasattr(o.data, "materials") else []
        nm = name or o.name
        bpy.data.objects.remove(o, do_unlink=True)
        for m in mats:
            if m and m.name not in [x.name for x in me.materials if x]:
                me.materials.append(m)
        for p in me.polygons:
            p.use_smooth = True
        n = bpy.data.objects.new(nm, me)
        self.coll.objects.link(n)
        self.objs[nm] = n
        return n

    def ellipsoid(self, name, c, r, mat, seg=(32, 24)):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)
        bmesh.ops.scale(bm, vec=Vector(r), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
        return self.obj_from_bm(name, bm, mat)

    def tube(self, name, pts, radii, mat, res=6, wave=None):
        """A smooth tube along points (used for hair locks, brows, smile, seams...)."""
        cu = bpy.data.curves.new(name, "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = 1.0
        cu.bevel_resolution = 3
        cu.resolution_u = res
        cu.use_fill_caps = True
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(pts) - 1)
        for bp, p, r in zip(sp.bezier_points, pts, radii):
            bp.co = Vector(p)
            bp.handle_left_type = bp.handle_right_type = "AUTO"
            bp.radius = r
        o = bpy.data.objects.new(name, cu)
        self.coll.objects.link(o)
        o.data.materials.append(mat)
        return self.bake(o)


# ----------------------------------------------------------------------------- the skeleton (shared by body, clothes, rig)
def skeleton(spec):
    """Joint positions for a 1.68 m stylised character in A-pose, scaled to the spec height."""
    s = spec.get("height", 1.68) / 1.68
    b = spec.get("body", {})
    sh = b.get("shoulder_width", 0.33) / 2
    hs = b.get("head_scale", 1.18)
    a = math.radians(55)                                       # A-pose: arms 55 degrees below horizontal
    arm = Vector((math.cos(a), 0.0, -math.sin(a)))
    J = {
        "pelvis": (0, 0, 0.90), "waist": (0, 0, 1.01), "chest": (0, 0, 1.17), "neck": (0, 0, 1.30), "neck_top": (0, 0, 1.37),
        "head": (0, 0, 1.36 + 0.108 * hs),
    }
    for side, k in (("L", 1), ("R", -1)):
        S = Vector((k * sh, 0, 1.275))
        E = S + Vector((k * arm.x, 0, arm.z)) * 0.245
        W = E + Vector((k * arm.x, 0, arm.z)) * 0.225
        H = W + Vector((k * arm.x, 0, arm.z)) * 0.135
        J.update({f"clav_{side}": (k * 0.05, 0.0, 1.27), f"shoulder_{side}": tuple(S), f"elbow_{side}": tuple(E),
                  f"wrist_{side}": tuple(W), f"hand_{side}": tuple(H),
                  f"hip_{side}": (k * 0.085, 0, 0.87), f"knee_{side}": (k * 0.09, 0.0, 0.47), f"ankle_{side}": (k * 0.095, 0.01, 0.085),
                  f"toe_{side}": (k * 0.1, -0.11, 0.03)})
    return {k: Vector(v) * s for k, v in J.items()}


# body segments: (a, b, radius at a, radius at b) for region labelling and weights
SEGMENTS = [("pelvis", "waist"), ("waist", "chest"), ("chest", "neck"), ("neck", "neck_top")] + \
    [(f"{a}_{s}", f"{b}_{s}") for s in "LR" for a, b in (("clav", "shoulder"), ("shoulder", "elbow"), ("elbow", "wrist"),
                                                          ("wrist", "hand"), ("hip", "knee"), ("knee", "ankle"), ("ankle", "toe"))]


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / (ab.length_squared or 1)))
    return (p - (a + ab * t)).length, t


# ----------------------------------------------------------------------------- body
def build_body(B, J, mats):
    """Skin-modifier body from the skeleton graph, subdivided smooth."""
    s = B.s
    names = ["pelvis", "waist", "chest", "neck", "neck_top"]
    radii = {"pelvis": 0.135, "waist": 0.105, "chest": 0.125, "neck": 0.047, "neck_top": 0.045}
    edges = [("pelvis", "waist"), ("waist", "chest"), ("chest", "neck"), ("neck", "neck_top")]
    for sd in "LR":
        for n, r in (("clav", 0.06), ("shoulder", 0.048), ("elbow", 0.034), ("wrist", 0.026), ("hand", 0.014),
                     ("hip", 0.085), ("knee", 0.05), ("ankle", 0.034), ("toe", 0.03)):
            names.append(f"{n}_{sd}")
            radii[f"{n}_{sd}"] = r
        edges += [("chest", f"clav_{sd}"), (f"clav_{sd}", f"shoulder_{sd}"), (f"shoulder_{sd}", f"elbow_{sd}"),
                  (f"elbow_{sd}", f"wrist_{sd}"), (f"wrist_{sd}", f"hand_{sd}"),
                  ("pelvis", f"hip_{sd}"), (f"hip_{sd}", f"knee_{sd}"), (f"knee_{sd}", f"ankle_{sd}"), (f"ankle_{sd}", f"toe_{sd}")]
    idx = {n: i for i, n in enumerate(names)}
    me = bpy.data.meshes.new("BODY_src")
    me.from_pydata([J[n] for n in names], [(idx[a], idx[b]) for a, b in edges], [])
    o = bpy.data.objects.new("BODY", me)
    B.coll.objects.link(o)
    o.modifiers.new("Skin", "SKIN")
    for n, i in idx.items():
        o.data.skin_vertices[0].data[i].radius = (radii[n] * s, radii[n] * s)
    o.data.skin_vertices[0].data[idx["pelvis"]].use_root = True
    sub = o.modifiers.new("Sub", "SUBSURF")
    sub.levels = sub.render_levels = 2
    o.data.materials.append(mats["skin"])
    o = B.bake(o, "BODY")
    # shape: a flatter torso (front-back), a little waist, rounder hips
    hips, waist = B.spec["body"].get("hips", 0.15), B.spec["body"].get("waist", 0.115)
    for v in o.data.vertices:
        z = v.co.z / s
        if 0.82 < z < 1.32 and abs(v.co.x) < 0.2 * s:
            v.co.y *= 0.74
        if 0.84 < z < 0.98:                                     # hips
            v.co.x *= 1 + (hips - 0.135) * 3 * max(0, 1 - abs(z - 0.9) / 0.08)
        if 0.96 < z < 1.08:                                     # waist
            v.co.x *= 1 - (0.125 - waist) * 2.5 * max(0, 1 - abs(z - 1.02) / 0.06)
    return o


def label_faces(o, J):
    """Nearest skeleton segment for every face: torso / arm / leg regions for clothes and weights."""
    lab = []
    for p in o.data.polygons:
        c = p.center
        best, bt, bd = None, 0, 1e9
        for a, b in SEGMENTS:
            d, t = seg_dist(c, J[a], J[b])
            if d < bd:
                bd, best, bt = d, (a, b), t
        lab.append((best, bt))
    return lab


def cloth_from_body(B, body, J, name, keep, push, mat, solid=0.006, edge_fix=None):
    """A garment = the body faces it covers, pushed out along the normals and given thickness."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    lab = label_faces(body, J)
    dead = [f for f in bm.faces if not keep(lab[f.index], f.calc_center_median())]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.normal_update()
    if edge_fix:                                                    # straighten the cut edges (hem, neckline, sleeves)
        for v in bm.verts:
            if v.is_boundary:
                edge_fix(v)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * push(v.co)
    o = B.obj_from_bm(name, bm, mat)
    if solid:
        m = o.modifiers.new("Thick", "SOLIDIFY")
        m.thickness = solid
        m.offset = 1.0
        o = B.bake(o)
    return o


def build_hands(B, J, mats):
    s = B.s
    for sd, sx in (("L", 1), ("R", -1)):
        W, H = J[f"wrist_{sd}"], J[f"hand_{sd}"]
        d = (H - W).normalized()                                   # along the fingers
        across = Vector((0, 1, 0))                                 # fingers sit front-to-back (palm toward the thigh)
        out = d.cross(across).normalized() * sx                    # back of the hand faces away from the body
        palm_c = W + d * 0.038 * s
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=12, radius=1.0)
        rot = Matrix((across, d, out)).transposed()                # local x = across, y = along, z = thickness
        bmesh.ops.transform(bm, matrix=Matrix.Translation(palm_c) @ rot.to_4x4() @ Matrix.Diagonal((0.026 * s, 0.036 * s, 0.013 * s, 1)),
                            verts=bm.verts)
        B.obj_from_bm(f"HAND_PALM_{sd}", bm, mats["skin"])
        base = palm_c + d * 0.03 * s
        for i, off in enumerate((-0.017, -0.006, 0.005, 0.015)):    # four fingers, slightly curled toward the palm
            ln = (0.043, 0.05, 0.047, 0.038)[i] * s
            a = base + across * off * s
            b = a + d * ln * 0.55 - out * 0.004 * s
            c2 = a + d * ln - out * 0.012 * s
            B.tube(f"HAND_FINGER_{sd}{i}", [a, b, c2], [0.0078 * s, 0.007 * s, 0.006 * s], mats["skin"], res=4)
        t0 = palm_c - across * 0.022 * s + d * 0.005 * s           # the thumb, from the front of the palm
        B.tube(f"HAND_THUMB_{sd}", [t0, t0 - across * 0.012 * s + d * 0.022 * s - out * 0.006 * s, t0 - across * 0.008 * s + d * 0.04 * s - out * 0.012 * s],
               [0.0088 * s, 0.0078 * s, 0.0065 * s], mats["skin"], res=4)


# ----------------------------------------------------------------------------- head and face
def build_head(B, J, mats):
    s, hs = B.s, B.spec["body"].get("head_scale", 1.18)
    c = J["head"]
    r = Vector((0.112, 0.112, 0.124)) * hs * s
    head = B.ellipsoid("HEAD", c, r, mats["skin"], (40, 30))
    for v in head.data.vertices:                                 # rounder cheeks, softer chin
        dz = (v.co.z - c.z) / r.z
        if dz < 0:
            k = 1 - 0.13 * (dz * dz)
            v.co.x = c.x + (v.co.x - c.x) * k
            v.co.y = c.y + (v.co.y - c.y) * (1 - 0.08 * dz * dz)
    return head, c, r


def on_face(c, r, x, z, push=0.0015):
    """A point on the front of the head ellipsoid (upper half is undeformed) and its normal."""
    u = (x - c.x) / r.x
    w = (z - c.z) / r.z
    q = max(0.0, 1 - u * u - w * w)
    y = c.y - r.y * math.sqrt(q)
    p = Vector((x, y, z))
    n = Vector(((p.x - c.x) / (r.x * r.x), (p.y - c.y) / (r.y * r.y), (p.z - c.z) / (r.z * r.z))).normalized()
    return p + n * push, n


def disc(B, name, center, normal, rx, rz, mat, seg=24, lift=0.0):
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=seg, radius=1.0)
    bmesh.ops.scale(bm, vec=Vector((rx, rz, 1)), verts=bm.verts)
    zax = normal.normalized()                                   # disc faces along the normal; its local Y stays "up"
    xax = Vector((0, 0, 1)).cross(zax).normalized() if abs(zax.z) < 0.95 else Vector((1, 0, 0))
    yax = zax.cross(xax)
    rot = Matrix((xax, yax, zax)).transposed().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(center + normal * lift) @ rot, verts=bm.verts)
    bm.normal_update()
    return B.obj_from_bm(name, bm, mat)


def build_face(B, c, r, mats):
    f = B.spec["face"]
    s, hs = B.s, B.spec["body"].get("head_scale", 1.18)
    k = s * hs
    ez = c.z - 0.012 * k
    for side, sx in (("L", 1), ("R", -1)):
        x = c.x + sx * 0.043 * k
        p, n = on_face(c, r, x, ez, 0.002)
        disc(B, f"EYE_{side}", p, n, 0.0175 * k, 0.025 * k, mats["eye"])                   # big dark oval eyes
        hp, hn = on_face(c, r, x + sx * 0.006 * k, ez + 0.009 * k, 0.0035)
        disc(B, f"EYE_HL_{side}", hp, hn, 0.0055 * k, 0.0062 * k, mats["eye_hl"], 16)      # the white highlight
        if f.get("lashes", True):                                                           # a little flick at the outer corner
            a, _ = on_face(c, r, x + sx * 0.015 * k, ez + 0.018 * k, 0.003)
            b, _ = on_face(c, r, x + sx * 0.024 * k, ez + 0.026 * k, 0.003)
            B.tube(f"LASH_{side}", [a, b], [0.0028 * k, 0.0012 * k], mats["eye"])
        bz = ez + 0.045 * k                                                                 # brows: soft arcs
        pts = [on_face(c, r, x + sx * dx * k, bz + dz * k, 0.002)[0] for dx, dz in ((-0.02, -0.003), (0.0, 0.004), (0.022, 0.0))]
        B.tube(f"BROW_{side}", pts, [0.004 * k, 0.0048 * k, 0.0028 * k], mats["brow"])
        bp, bn = on_face(c, r, c.x + sx * 0.068 * k, c.z - 0.052 * k, 0.002)
        disc(B, f"BLUSH_{side}", bp, bn, 0.019 * k, 0.012 * k, mats["blush"])
        B.ellipsoid(f"EAR_{side}", c + Vector((sx * r.x * 0.97, 0.004, -0.02 * k)), Vector((0.012, 0.02, 0.028)) * k, mats["skin"], (16, 12))
    np_, nn = on_face(c, r, c.x, c.z - 0.045 * k, -0.002)
    B.ellipsoid("NOSE", np_ + nn * 0.004, Vector((0.009, 0.008, 0.008)) * k, mats["skin"], (16, 12))
    pts = [on_face(c, r, c.x + dx * k, c.z - 0.083 * k + dz * k, 0.0015)[0] for dx, dz in ((-0.018, 0.004), (0.0, -0.0035), (0.018, 0.004))]
    B.tube("SMILE", pts, [0.0018 * k, 0.0026 * k, 0.0018 * k], mats["lips"])


# ----------------------------------------------------------------------------- hair presets
def build_hair_sculpted(B, J, c, r, mats):
    """Long wavy hair as ONE soft, clay-like volume: metaball blobs along wavy lock paths fuse into a smooth mass,
    a negative blob carves the face opening, a side-swept fringe comes from a side part, and faint vertical
    grooves suggest strands. Reads like the sculpted hair in stylised 3D illustrations."""
    h = B.spec["hair"]
    s = B.s
    k = s * B.spec["body"].get("head_scale", 1.18)
    mb = bpy.data.metaballs.new("HAIR_mb")
    mb.resolution = 0.011 * k
    mb.render_resolution = 0.011 * k
    mb.threshold = 0.6

    def blob(p, rad, neg=False, size=None):
        e = mb.elements.new()
        e.co = Vector(p)
        e.radius = rad
        if size:
            e.type = "ELLIPSOID"
            e.size_x, e.size_y, e.size_z = size
        e.use_negative = neg
        e.stiffness = 2.0
        return e
    # the crown and back of the head
    # (a metaball's visible surface sits well inside its nominal size, so the crown is oversized on purpose and the
    # exact face cut below sets the hairline)
    # visible surface ~ 0.67 x nominal size (threshold 0.6, stiffness 2): sized so the shell sits ~1 cm outside the head
    blob(c + Vector((0, 0.006 * k, 0.012 * k)), 1.0, size=(r.x * 1.6, r.y * 1.76, r.z * 1.72))      # covers top + sides
    blob(c + Vector((0, 0.045 * k, -0.06 * k)), 1.0, size=(r.x * 1.62, r.y * 1.35, r.z * 1.45))      # the back, to the nape
    end = h.get("end_height", 0.60) * 1.68 * s
    shx = J["shoulder_L"].x
    # wavy lengths: front locks fall over the shoulders, the back curtain falls straight behind
    paths = []
    for sx in (1, -1):
        for dy, dx in ((-0.022, 0.0), (-0.004, 0.02), (0.016, 0.036)):
            paths.append(("front", sx, dy, dx))
    for x in (-0.085, -0.05, -0.015, 0.02, 0.055, 0.085):
        paths.append(("back", 1, 0.0, x))
    for n, (kind, sx, dy, dx) in enumerate(paths):
        m = 24
        for j in range(m):
            t = j / (m - 1)
            if kind == "front":
                z = c.z + 0.06 * k - t * (c.z + 0.06 * k - (end + 0.03 * k))             # emerges from inside the crown
                x = sx * (r.x * 0.78 + dx * k * min(1.0, t * 3) + min(1.0, t * 1.4) * max(0.0, shx - r.x * 0.82 - 0.015 * k) + 0.018 * k * t)
                y = c.y + dy * k - 0.05 * k * min(1.0, t * 1.6)                         # drapes over the FRONT of the shoulder
                rad = (0.014 + 0.009 * min(1.0, t * 3) - 0.011 * t) * k             # slim at the temple, fuller below
            else:
                z = c.z - 0.01 * k - t * (c.z - 0.01 * k - end)
                x = dx * k * (0.75 + 0.35 * min(1.0, t * 1.3))
                y = c.y + r.y * 0.62 + 0.03 * k * min(1.0, t * 2)
                rad = (0.036 - 0.012 * t) * k
            wave = math.sin(t * math.pi * 2.6 + (n % 4) * 0.5) * 0.024 * k * min(1.0, t * 1.4)   # soft S-waves
            blob((x + wave * (sx if kind == "front" else 1), y, z), rad * (1.7 if kind == "front" else 1.75))
    # carve the face: a negative blob in front of it (forehead below the fringe down to the chin)
    o = bpy.data.objects.new("HAIR_mass", mb)
    B.coll.objects.link(o)
    o = B.bake(o, "HAIR")
    # the face opening: an exact cut (hairline a little above the brows, down past the chin, ear to ear)
    part_x = -0.02 * k if h.get("part", "side") == "side" else 0.0

    def hair_line(x):                                            # centre/side part: curtain-like sweep to the temples
        u = min(1.0, abs(x - part_x) / (r.x * 0.82))
        return c.z + 0.064 * k - 0.046 * k * u ** 1.6               # forehead highest at the part, hair lower at the temples
    bm = bmesh.new()
    bm.from_mesh(o.data)
    dead = []
    for f in bm.faces:
        q = f.calc_center_median()
        u = (q.x - c.x) / (r.x * 0.86)
        in_face = q.y < c.y - r.y * 0.3 and u * u < 1 and c.z - r.z * 1.05 < q.z < hair_line(q.x)
        under_chin = abs(q.x - c.x) < r.x * 0.55 and q.y < J["neck"].y - 0.01 * k and J["neck"].z - 0.02 * k < q.z < c.z - r.z * 0.8
        if in_face or under_chin:                                    # face and throat only: not the locks below
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    # a clean hairline: relax the cut edge along itself (removes the saw-tooth of deleted faces)
    for _ in range(24):
        new = {}
        for v in bm.verts:
            if not v.is_boundary:
                continue
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                new[v] = v.co * 0.4 + (nb[0].co + nb[1].co) * 0.3
        for v, co in new.items():
            v.co = co
    bm.to_mesh(o.data)
    bm.free()
    o.data.materials.clear()
    o.data.materials.append(mats["hair"])
    # faint strand grooves + keep it light for the game
    tex = bpy.data.textures.new("HAIR_grooves", "WOOD")
    tex.wood_type = "BANDNOISE"
    tex.noise_scale = 0.05
    tex.turbulence = 2.0
    d = o.modifiers.new("Grooves", "DISPLACE")
    d.texture = tex
    d.texture_coords = "OBJECT" if False else "LOCAL"
    d.strength = 0.004 * k
    d.mid_level = 0.5
    sm = o.modifiers.new("Soft", "LAPLACIANSMOOTH")              # smooths without shrinking the volume
    sm.iterations = 6
    sm.lambda_factor = 0.8
    sm.use_volume_preserve = True
    dec = o.modifiers.new("Light", "DECIMATE")
    dec.ratio = 0.35
    o = B.bake(o, "HAIR")
    if h.get("fringe", False) is False:
        return o
    # optional side-swept fringe ("fringe": true in the spec)
    fm = bpy.data.metaballs.new("HAIR_fringe_mb")
    fm.resolution = fm.render_resolution = 0.009 * k
    fm.threshold = 0.6
    part_x = -0.035 * k if h.get("part", "side") == "side" else 0.0
    for i in range(16):
        t = i / 15
        x = part_x + t * 0.19 * k
        z = c.z + r.z * (0.76 - 0.36 * t * t)                     # from the part, sweeping down to the temple
        p, _ = on_face(c, r * 1.0, max(-r.x * 0.97, min(r.x * 0.97, x)), z, 0.0)
        e = fm.elements.new()
        e.co = p
        e.radius = (0.02 - 0.007 * t) * k * 1.6
        e.stiffness = 2.0
    fo = bpy.data.objects.new("HAIR_fringe", fm)
    B.coll.objects.link(fo)
    fo = B.bake(fo, "HAIR_FRINGE")
    fo.data.materials.clear()
    fo.data.materials.append(mats["hair"])
    return o


def build_hair(B, J, c, r, mats):
    h = B.spec["hair"]
    style = h.get("style", "long_wavy")
    if style == "long_wavy" and h.get("sculpted", True):
        return build_hair_sculpted(B, J, c, r, mats)
    s = B.s
    k = s * B.spec["body"].get("head_scale", 1.18)
    cap = B.ellipsoid("HAIR_CAP", c + Vector((0, 0.006, 0.012 * k)), r * 1.075, mats["hair"], (40, 30))
    bm = bmesh.new()
    bm.from_mesh(cap.data)
    dead = []
    for f in bm.faces:                                           # open the face; the back reaches the nape
        p = f.calc_center_median()
        front = p.y < c.y - r.y * 0.25
        if (front and p.z < c.z + 0.055 * k) or (p.z < c.z - 0.06 * k and p.y < c.y + r.y * 0.2) or p.z < c.z - 0.12 * k:
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(cap.data)
    bm.free()
    sol = cap.modifiers.new("T", "SOLIDIFY")
    sol.thickness = 0.008 * k
    B.bake(cap)
    # side-swept fringe from a side part
    part = c + Vector((-0.035 * k if h.get("part", "side") == "side" else 0, 0, 0))
    for i in range(5):
        x0 = part.x + (i - 1) * 0.012 * k
        pts = [on_face(c, r * 1.07, x0, c.z + r.z * 0.92, 0.004)[0],
               on_face(c, r * 1.07, x0 + 0.03 * k, c.z + r.z * 0.62, 0.006)[0],
               on_face(c, r * 1.07, x0 + 0.06 * k + i * 0.008 * k, c.z + r.z * 0.30 - i * 0.004 * k, 0.006)[0]]
        B.tube(f"HAIR_FRINGE_{i}", pts, [0.022 * k, 0.019 * k, 0.008 * k], mats["hair"])
    if style == "long_wavy":
        end = h.get("end_height", 0.60) * 1.68 * s                # where the ends fall (absolute height)
        shx = J["shoulder_L"].x
        locks = []
        for sx in (1, -1):                                         # face-framing locks, over the shoulders, in front
            for i, (dy, dx) in enumerate(((-0.03, -0.006), (-0.008, 0.01), (0.018, 0.02))):
                locks.append(("front", sx, dy, dx, i))
        for i, x in enumerate((-0.135, -0.1, -0.06, -0.02, 0.02, 0.06, 0.1, 0.135)):  # the back: a straight, slightly wavy curtain
            locks.append(("back", 1, 0.0, x, i))
        for n, (kind, sx, dy, dx, i) in enumerate(locks):
            pts, rad = [], []
            m = 9
            for j in range(m):
                t = j / (m - 1)
                if kind == "front":
                    z = c.z + 0.075 * k - t * (c.z + 0.075 * k - (end + 0.04 * k))             # starts hidden inside the cap
                    x = sx * (r.x * (0.8 + 0.2 * min(1.0, t * 5)) + dx * k + min(1.0, t * 1.4) * max(0.0, shx - r.x * 0.97 - 0.02 * k))
                    y = c.y + (dy * k) - (0.012 * k) * min(1.0, t * 1.6)                         # just over the shoulder
                else:
                    z = c.z + 0.02 * k - t * (c.z + 0.02 * k - end)
                    x = dx * k * (0.55 + 0.75 * min(1.0, t * 1.3))                              # follows the head, then the back
                    y = c.y + r.y * 0.78 + 0.035 * k * min(1.0, t * 2)
                wave = math.sin(t * math.pi * 3.2 + n * 1.7) * 0.012 * k * min(1.0, t * 1.5)
                pts.append(Vector((x + wave * (sx if kind == "front" else 1), y, z)))
                rad.append((0.026 if kind == "front" else 0.04) * k * (1 - 0.45 * t) + 0.005 * k)
            B.tube(f"HAIR_LOCK_{n}", pts, rad, mats["hair_hl"] if n % 4 == 1 else mats["hair"], res=5)
    elif style == "bob":
        for i, deg in enumerate(range(70, 300, 16)):
            th = math.radians(deg)
            dx, dy = math.sin(th), -math.cos(th)
            pts = [c + Vector((dx * r.x * 1.05, dy * r.y * 1.05, 0.06 * k)), c + Vector((dx * r.x * 1.2, dy * r.y * 1.15, -0.05 * k)),
                   c + Vector((dx * r.x * 1.15, dy * r.y * 1.1, -0.12 * k))]
            B.tube(f"HAIR_LOCK_{i}", pts, [0.035 * k, 0.03 * k, 0.012 * k], mats["hair"])
    elif style == "ponytail":
        base = c + Vector((0, r.y * 1.05, 0.04 * k))
        pts = [base + Vector((0, 0.02 * k * j, -0.09 * k * j + 0.01 * k * math.sin(j))) for j in range(5)]
        B.tube("HAIR_TAIL", pts, [0.04 * k, 0.045 * k, 0.038 * k, 0.025 * k, 0.008 * k], mats["hair"])


# ----------------------------------------------------------------------------- clothes and shoes
def build_clothes(B, body, J, mats):
    s = B.s
    top, bot = B.spec["top"], B.spec["bottom"]
    crop_z = (1.075 if top.get("crop") else 0.93) * s
    jeans_top = (1.035 if bot.get("rise", "high") == "high" else 0.95) * s
    sleeve = 0.11 if top.get("sleeve", "short") == "short" else 0.5
    torso = {("pelvis", "waist"), ("waist", "chest"), ("chest", "neck")}

    def tee_keep(lb, c):
        (a, b), t = lb
        if (a, b) in torso or a.startswith("clav"):
            return crop_z < c.z < J["neck"].z - 0.004 * s
        if a.startswith("shoulder"):
            return t * 0.245 < sleeve
        return False
    def tee_edges(v):
        p = v.co
        if p.z < crop_z + 0.04 * s and abs(p.x) < 0.2 * s:                         # the crop hem: level
            p.z = crop_z + 0.004 * s
        elif p.z > J["neck"].z - 0.09 * s and abs(p.x) < 0.17 * s:                  # crew neckline + shoulder line: a neat curve
            p.z = min(p.z, J["neck"].z - 0.008 * s - 0.045 * s * (abs(p.x) / (0.17 * s)) ** 2)
        else:                                                                       # sleeve ends: square to the arm
            sd = "L" if p.x > 0 else "R"
            S, E = J[f"shoulder_{sd}"], J[f"elbow_{sd}"]
            ax = (E - S).normalized()
            t = (p - S).dot(ax)
            if t > sleeve * 0.6 * s:
                v.co = p + ax * (sleeve * s - t)
    tee = cloth_from_body(B, body, J, "TOP", tee_keep, lambda p: 0.007 * s, mats["top"], edge_fix=tee_edges)
    nz = J["neck"].z
    for v in tee.data.vertices:                                     # a clean crew neck (the shoulders keep their shape)
        if abs(v.co.x) < 0.1 * s:
            v.co.z = min(v.co.z, nz - 0.004 * s - 0.022 * s * (abs(v.co.x) / (0.1 * s)) ** 2)

    def jeans_keep(lb, c):
        (a, b), t = lb
        if (a, b) == ("pelvis", "waist") or a == "waist":
            return c.z < jeans_top
        return a.startswith("hip") or a.startswith("knee") or (a == "pelvis")
    wide = bot.get("type", "wide_jeans") == "wide_jeans"

    def jeans_push(p):
        base = 0.009 * s
        if p.z < 0.8 * s and wide:                                 # wide legs: flare toward the floor
            t = min(1.0, (0.8 * s - p.z) / (0.7 * s))
            return base + 0.034 * s * t ** 0.7
        return base
    def jeans_edges(v):
        if v.co.z > jeans_top - 0.05 * s:                                           # waistline: level
            v.co.z = jeans_top
    jeans = cloth_from_body(B, body, J, "BOTTOM", jeans_keep, jeans_push, mats["bottom"], solid=0.007 * s, edge_fix=jeans_edges)
    # hems reach the shoes: extend each open leg bottom down to just above the ground
    bm = bmesh.new()
    bm.from_mesh(jeans.data)
    edges = [e for e in bm.edges if e.is_boundary and all(v.co.z < 0.2 * s for v in e.verts)]
    if edges:
        ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
        new = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
        for v in new:
            v.co.z = 0.085 * s
            d = Vector((v.co.x - math.copysign(0.095 * s, v.co.x), v.co.y, 0))
            v.co += d.normalized() * 0.01 * s if d.length > 1e-6 else Vector()
    bm.to_mesh(jeans.data)
    bm.free()
    # remove the body skin hidden under the clothes (no poke-through when animated, fewer triangles)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    lab = label_faces(body, J)
    bm.faces.ensure_lookup_table()
    dead = []
    for f in bm.faces:
        (a, b), t = lab[f.index]
        c = f.calc_center_median()
        under_top = (((a, b) in torso or a.startswith("clav")) and crop_z + 0.02 * s < c.z < J["neck"].z - 0.03 * s) or \
            (a.startswith("shoulder") and t * 0.245 < sleeve - 0.03)
        under_jeans = c.z < jeans_top - 0.02 * s and ((a, b) == ("pelvis", "waist") or a.startswith("hip") or a.startswith("knee")
                                                       or a.startswith("ankle") or a == "pelvis")
        if under_top or under_jeans:
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(body.data)
    bm.free()
    # details: crew collar, sleeve hems, waistband, button, belt loops, pockets, seams
    k = s
    nk = J["neck"]

    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=0.052 * k, radius2=0.048 * k, depth=0.014 * k)
    bmesh.ops.translate(bm, vec=nk + Vector((0, -0.004 * k, -0.006 * k)), verts=bm.verts)
    o = B.obj_from_bm("TOP_COLLAR", bm, mats["top"])
    o.modifiers.new("T", "SOLIDIFY").thickness = 0.005 * k
    B.bake(o)
    wb = jeans_top - 0.018 * s
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=48, radius1=0.128 * k, radius2=0.128 * k, depth=0.032 * k)
    bmesh.ops.scale(bm, vec=Vector((1.0, 0.76, 1)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((0, 0, wb)), verts=bm.verts)
    o = B.obj_from_bm("BOTTOM_WAISTBAND", bm, mats["bottom"])
    o.modifiers.new("T", "SOLIDIFY").thickness = 0.006 * k
    B.bake(o)
    front_y = -0.128 * 0.76 * k - 0.006 * k
    B.ellipsoid("BOTTOM_BUTTON", Vector((0, front_y - 0.003 * k, wb)), Vector((0.007, 0.004, 0.007)) * k, mats["button"], (16, 10))
    for x in (-0.1, -0.035, 0.035, 0.1):
        B.tube(f"BOTTOM_LOOP_{x}", [Vector((x * k, front_y - 0.002 * k, wb + 0.016 * k)), Vector((x * k, front_y - 0.002 * k, wb - 0.018 * k))],
               [0.0035 * k, 0.0035 * k], mats["bottom"])
    for sx in (1, -1):                                             # front pocket curves + outer leg seams
        pts = [Vector((sx * 0.105 * k, front_y + 0.012 * k, wb - 0.012 * k)), Vector((sx * 0.085 * k, front_y + 0.006 * k, wb - 0.05 * k)),
               Vector((sx * 0.05 * k, front_y + 0.002 * k, wb - 0.06 * k))]
        B.tube(f"BOTTOM_POCKET_{sx}", pts, [0.0022 * k] * 3, mats["seam"])
    # sneakers
    for sd, sx in (("L", 1), ("R", -1)):
        a = J[f"ankle_{sd}"]
        sole = bmesh.new()
        bmesh.ops.create_cube(sole, size=1.0)
        bmesh.ops.scale(sole, vec=Vector((0.092, 0.25, 0.036)) * k, verts=sole.verts)
        bmesh.ops.translate(sole, vec=Vector((a.x, a.y - 0.05 * k, 0.018 * k)), verts=sole.verts)
        o = B.obj_from_bm(f"SHOE_SOLE_{sd}", sole, mats["sole"])
        bv = o.modifiers.new("B", "BEVEL")
        bv.width = 0.014 * k
        bv.segments = 4
        B.bake(o)
        B.ellipsoid(f"SHOE_{sd}", Vector((a.x, a.y - 0.055 * k, 0.065 * k)), Vector((0.05, 0.122, 0.055)) * k, mats["shoe"], (24, 16))
        for i in range(3):
            y = a.y - 0.07 * k - i * 0.02 * k
            B.tube(f"SHOE_LACE_{sd}{i}", [Vector((a.x - 0.018 * k, y, 0.095 * k - i * 0.009 * k)), Vector((a.x + 0.018 * k, y, 0.095 * k - i * 0.009 * k))],
                   [0.0025 * k, 0.0025 * k], mats["sole"])
    return tee, jeans


# ----------------------------------------------------------------------------- rig
BONES = [  # (name, head joint, tail joint, parent)
    ("Hips", "pelvis", "waist", None), ("Spine", "waist", "chest", "Hips"), ("Spine1", "chest", "neck", "Spine"),
    ("Neck", "neck", "neck_top", "Spine1"), ("Head", "neck_top", "head", "Neck"),
] + [b for s, S in (("L", "Left"), ("R", "Right")) for b in (
    (f"{S}Shoulder", "chest", f"shoulder_{s}", "Spine1"), (f"{S}Arm", f"shoulder_{s}", f"elbow_{s}", f"{S}Shoulder"),
    (f"{S}ForeArm", f"elbow_{s}", f"wrist_{s}", f"{S}Arm"), (f"{S}Hand", f"wrist_{s}", f"hand_{s}", f"{S}ForeArm"),
    (f"{S}UpLeg", f"hip_{s}", f"knee_{s}", "Hips"), (f"{S}Leg", f"knee_{s}", f"ankle_{s}", f"{S}UpLeg"),
    (f"{S}Foot", f"ankle_{s}", f"toe_{s}", f"{S}Leg"))]


def build_rig(B, J):
    arm = bpy.data.armatures.new(f"RIG_{B.id}")
    rig = bpy.data.objects.new(f"RIG_{B.id}", arm)
    B.coll.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for name, h, t, parent in BONES:
        b = arm.edit_bones.new(name)
        b.head, b.tail = J[h], J[t]
        if name == "Head":
            b.tail = J["head"] + Vector((0, 0, 0.12 * B.s))
        if name.endswith("Shoulder"):
            b.head = Vector((math.copysign(0.02 * B.s, J[t].x), 0, J["chest"].z + 0.07 * B.s))
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
        eb[name] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def bind(B, rig, J, rigid_head):
    """Weights: rigid parts to one bone, skin and cloth by distance to the nearest two bones (same side only)."""
    segs = []
    for name, h, t, _ in BONES:
        a = Vector(J[h]) if not name.endswith("Shoulder") else Vector((math.copysign(0.02 * B.s, J[t].x), 0, J["chest"].z + 0.07 * B.s))
        segs.append((name, a, Vector(J[t]) if name != "Head" else J["head"] + Vector((0, 0, 0.12 * B.s))))
    for o in list(B.coll.objects):
        if o.type != "MESH":
            continue
        o.parent = rig
        md = o.modifiers.new("Armature", "ARMATURE")
        md.object = rig
        groups = {n: o.vertex_groups.new(name=n) for n, _, _, _ in BONES}
        nm = o.name
        if any(nm.startswith(p) for p in rigid_head):
            groups["Head"].add([v.index for v in o.data.vertices], 1.0, "REPLACE")
            continue
        if nm.startswith("HAND_"):
            side = "Left" if nm.endswith("L") or "_L" in nm[-3:] else "Right"
            groups[f"{side}Hand"].add([v.index for v in o.data.vertices], 1.0, "REPLACE")
            continue
        if nm.startswith("SHOE"):
            side = "Left" if nm.endswith("L") or "_L" in nm else "Right"
            groups[f"{side}Foot"].add([v.index for v in o.data.vertices], 1.0, "REPLACE")
            continue
        for v in o.data.vertices:
            p = v.co
            cands = []
            for n, a, b in segs:
                if (n.startswith("Left") and p.x < -0.03 * B.s) or (n.startswith("Right") and p.x > 0.03 * B.s):
                    continue
                d, _ = seg_dist(p, a, b)
                cands.append((d, n))
            cands.sort()
            (d1, n1), (d2, n2) = cands[0], cands[1]
            w1, w2 = 1 / (d1 ** 4 + 1e-7), 1 / (d2 ** 4 + 1e-7)
            if d2 > d1 * 2.2:
                w2 = 0
            tot = w1 + w2
            groups[n1].add([v.index], w1 / tot, "REPLACE")
            if w2:
                groups[n2].add([v.index], w2 / tot, "ADD")


def ik_pose(rig, upper, fore, target, pole):
    """Two-bone IK, analytic, in armature space: aim upper + fore so the hand ends at target."""
    pb_u, pb_f = rig.pose.bones[upper], rig.pose.bones[fore]
    S = rig.data.bones[upper].head_local.copy()
    a, b = rig.data.bones[upper].length, rig.data.bones[fore].length
    T = Vector(target)
    d = min((T - S).length, a + b - 1e-4)
    axis = (T - S).normalized()
    cos_s = (a * a + d * d - b * b) / (2 * a * d)
    side = (Vector(pole) - S)
    side = (side - axis * side.dot(axis)).normalized()
    E = S + axis * (a * cos_s) + side * (a * math.sqrt(max(0, 1 - cos_s * cos_s)))
    W = S + axis * d
    for pb, h, t in ((pb_u, S, E), (pb_f, E, W)):
        bone = pb.bone
        rest = bone.matrix_local.to_3x3()
        cur_dir = rest.col[1].normalized()
        q = cur_dir.rotation_difference((t - h).normalized())
        m = (q.to_matrix() @ rest).to_4x4()
        m.translation = h
        pb.matrix = m
        bpy.context.view_layer.update()


def make_pose(rig, name, J, s):
    rig.animation_data_create()
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion()
    bpy.context.view_layer.update()
    if name == "Pose_HandOnHip":
        ik_pose(rig, "LeftArm", "LeftForeArm", J["hip_L"] + Vector((0.06 * s, -0.035 * s, 0.16 * s)), J["shoulder_L"] + Vector((0.4, 0.3, -0.05)))
        ik_pose(rig, "RightArm", "RightForeArm", J["hip_R"] + Vector((-0.115 * s, -0.01 * s, -0.04 * s)), J["shoulder_R"] + Vector((-0.2, 0.3, -0.3)))
        rig.pose.bones["Head"].rotation_quaternion = Quaternion(Vector((0, 1, 0)), math.radians(-4))
    elif name == "Pose_ArmsDown":
        for side, sx in (("Left", 1), ("Right", -1)):
            ik_pose(rig, f"{side}Arm", f"{side}ForeArm", J[f"hip_{side[0]}"] + Vector((sx * 0.1 * s, 0.0, -0.05 * s)),
                    J[f"shoulder_{side[0]}"] + Vector((sx * 0.1, 0.4, -0.3)))
    for pb in rig.pose.bones:
        pb.keyframe_insert("rotation_quaternion", frame=1)
        pb.keyframe_insert("location", frame=1)
    return act


# ----------------------------------------------------------------------------- main
def main(spec_path):
    spec = json.load(open(os.path.join(ROOT, spec_path) if not os.path.isabs(spec_path) else spec_path))
    bpy.ops.wm.read_homefile(use_empty=True)
    B = Builder(spec)
    J = skeleton(spec)
    f, h = spec["face"], spec["hair"]
    mats = {
        "skin": material(f"M_{B.id}_Skin", spec["body"]["skin"], 0.55, sss=0.15),
        "eye": material(f"M_{B.id}_Eye", f.get("eye_color", "#1E1714"), 0.25),
        "eye_hl": material(f"M_{B.id}_EyeHighlight", "#FFFFFF", 0.2, emit=0.6),
        "brow": material(f"M_{B.id}_Brow", f.get("brows", "#4E3020"), 0.7),
        "lips": material(f"M_{B.id}_Lips", f.get("lips", "#D9776E"), 0.5),
        "blush": material(f"M_{B.id}_Blush", f.get("blush", "#F2A8A0"), 0.6, alpha=0.55),
        "hair": material(f"M_{B.id}_Hair", h["color"], 0.45),
        "hair_hl": material(f"M_{B.id}_HairHighlight", h.get("highlight", h["color"]), 0.45),
        "top": material(f"M_{B.id}_Top", spec["top"]["color"], 0.8),
        "bottom": material(f"M_{B.id}_Bottom", spec["bottom"]["color"], 0.85),
        "seam": material(f"M_{B.id}_Seam", spec["bottom"].get("seam", spec["bottom"]["color"]), 0.85),
        "button": material(f"M_{B.id}_Button", "#E8E8EA", 0.3),
        "shoe": material(f"M_{B.id}_Shoe", spec["shoes"]["color"], 0.5),
        "sole": material(f"M_{B.id}_Sole", spec["shoes"].get("sole", "#E6E6E6"), 0.6),
    }
    body = build_body(B, J, mats)
    build_hands(B, J, mats)
    head, c, r = build_head(B, J, mats)
    build_face(B, c, r, mats)
    build_hair(B, J, c, r, mats)
    build_clothes(B, body, J, mats)
    rig = build_rig(B, J)
    bind(B, rig, J, rigid_head=("HEAD", "EYE", "LASH", "BROW", "BLUSH", "EAR", "NOSE", "SMILE", "HAIR"))
    acts = [make_pose(rig, "Pose_ArmsDown", J, B.s), make_pose(rig, "Pose_HandOnHip", J, B.s)]
    for a in acts:
        a.use_fake_user = True
    pose = {"hand_on_hip": "Pose_HandOnHip"}.get(spec.get("pose"), "Pose_ArmsDown")
    rig.animation_data.action = bpy.data.actions[pose]
    bpy.context.scene.frame_set(1)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in B.coll.objects if o.type == "MESH")
    rig["char_id"] = B.id
    rig["spec"] = json.dumps(spec)
    # save + export
    out_blend = os.path.join(ROOT, "blender", "characters", f"{B.id}.blend")
    os.makedirs(os.path.dirname(out_blend), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=out_blend)
    out_glb = os.path.join(ROOT, "export", "characters", f"{B.id}.glb")
    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    for o in bpy.data.objects:
        o.select_set(o.name in B.coll.objects)
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", use_selection=True, export_skins=True,
                              export_animations=True, export_animation_mode="ACTIONS", export_apply=False,
                              export_yup=True, export_draco_mesh_compression_enable=True, export_extras=True)
    render(B, os.path.join(ROOT, "renders", "characters", B.id))
    print(f"CHAR {B.id}: {len(B.coll.objects)} objects, {tris} tris -> {out_glb} ({os.path.getsize(out_glb) // 1024} KB)")


def render(B, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    scn = bpy.context.scene
    cam = bpy.data.objects.new("PREVIEW_cam", bpy.data.cameras.new("PREVIEW_cam"))
    scn.collection.objects.link(cam)
    cam.data.lens = 85
    w = bpy.data.worlds.new("PREVIEW_w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.9, 0.91, 1)
    scn.world = w
    for e, rot in ((3.0, (0.95, 0.15, 0.35)), (1.2, (1.3, -0.4, -2.3))):
        L = bpy.data.objects.new("PREVIEW_light", bpy.data.lights.new("PREVIEW_light", "SUN"))
        scn.collection.objects.link(L)
        L.rotation_euler = rot
        L.data.energy = e
    scn.render.engine = "BLENDER_EEVEE"
    scn.render.resolution_x, scn.render.resolution_y = 520, 1100
    scn.view_settings.view_transform = "Standard"
    hgt = B.spec.get("height", 1.68)
    for ang, tag in ((0, "front"), (math.radians(30), "34")):
        d = hgt * 3.1
        cam.location = (math.sin(ang) * d, -math.cos(ang) * d, hgt * 0.53)
        cam.rotation_euler = (Vector((0, 0, hgt * 0.5)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scn.camera = cam
        scn.render.filepath = f"{out}_{tag}.png"
        bpy.ops.render.render(write_still=True)
    for o in list(scn.collection.objects):
        if o.name.startswith("PREVIEW_"):
            bpy.data.objects.remove(o, do_unlink=True)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(args[0] if args else "config/characters/white_tshirt_woman.json")
