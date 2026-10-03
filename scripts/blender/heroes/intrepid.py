"""USS Intrepid (CV-11), the Essex-class carrier museum at Pier 86, built on its real flight-deck outline.

  blender -b --factory-startup -P scripts/blender/heroes/intrepid.py -- [out.glb] [render_prefix]

Real ship: 266 m (872 ft) long, 45 m across the flight deck with the angled deck, 28 m beam at the waterline; an
"Essex" island on the starboard side with its funnel and lattice mast; a hurricane bow. As a museum she carries ~25
aircraft on the flight deck (the A-12 Blackbird among them) and the Space Shuttle Enterprise in a pavilion on the aft
flight deck. Visitors come in from Pier 86 and ride elevators up to the flight deck.

The flight deck outline is the city's own footprint for the ship (export/times_square/collision2d.json, kind "ship"):
the bow is the narrow east end (toward 12th Ave), the stern faces the river, the angled deck juts out to port (north,
toward Pier 86), so the island is on the south side. Deck top at z 18.0 (the collider height), water at -1.8.
Coordinates: Blender local metres of the shared world frame (no transform needed in the viewer).
"""
import bpy
import bmesh
import json
import math
import os
import sys
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.join(ROOT, "export/times_square/intrepid.glb")
PREFIX = argv[1] if len(argv) > 1 else os.path.join(ROOT, "renders/heroes/intrepid")

DECK_Z, WATER = 18.0, -1.8
col = json.load(open(os.path.join(ROOT, "export/times_square/collision2d.json")))
FOOT = [tuple(p) for p in next(p for p in col["polys"] if p.get("kind") == "ship")["pts"]]
X0, X1 = min(p[0] for p in FOOT), max(p[0] for p in FOOT)       # stern (west) .. bow (east)
YC = 28.5                                                          # the axial (straight) deck's centreline

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
    "hull": mat("M_Ship_HazeGrey", "#7C8389", 0.6, 0.2),            # US Navy haze grey
    "deck": mat("M_Ship_FlightDeck", "#3A3D41", 0.85),               # non-skid deck
    "boot": mat("M_Ship_BootTop", "#16181A", 0.7),
    "white": mat("M_Ship_DeckWhite", "#E8E8E2", 0.6),
    "yellow": mat("M_Ship_DeckYellow", "#E0B12E", 0.6),
    "dark": mat("M_Ship_Opening", "#16191C", 0.9),
    "glass": mat("M_Light_ShipBridge", "#1E2A33", 0.1, emit="#FFD9A0", estr=0.8),
    "jet": mat("M_Ship_Aircraft", "#8E979E", 0.45, 0.4),
    "black": mat("M_Ship_Blackbird", "#151719", 0.5, 0.3),
    "tent": mat("M_Ship_Pavilion", "#F2F2EE", 0.7),
    "steel": mat("M_Ship_Mast", "#9AA1A7", 0.4, 0.7),
    "red_l": mat("M_Light_ShipRed", "#FF2A1A", 0.1, emit="#FF2010", estr=4.0),
}


def obj(name, bm, mats, smooth=0):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    COLL.objects.link(o)
    for m in (mats if isinstance(mats, list) else [mats]):
        me.materials.append(m)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth))
        except Exception:
            pass
        o.select_set(False)
    return o


def box(name, c, s, m, rz=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=s, verts=bm.verts)
    if rz:
        bm.transform(Matrix.Rotation(rz, 4, "Z"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(c))
    return obj(name, bm, m)


def prism(name, pts, z0, z1, m_side, m_top=None):
    bm = bmesh.new()
    a = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))
    if a < 0:
        pts = list(reversed(pts))
    lo = [bm.verts.new((x, y, z0)) for x, y in pts]
    hi = [bm.verts.new((x, y, z1)) for x, y in pts]
    n = len(pts)
    for i in range(n):
        bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    bm.faces.new(list(reversed(lo)))
    top = bm.faces.new(hi)
    top.material_index = 1 if m_top else 0
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    return obj(name, bm, [m_side, m_top] if m_top else m_side)


def deck_span(x):
    """the flight deck's y extent at x (from the footprint)."""
    ys = []
    for (x0, y0), (x1, y1) in zip(FOOT, FOOT[1:] + FOOT[:1]):
        if (x0 - x) * (x1 - x) <= 0 and x0 != x1:
            ys.append(y0 + (y1 - y0) * (x - x0) / (x1 - x0))
    return (min(ys), max(ys)) if len(ys) >= 2 else (YC - 1, YC + 1)


# ---------------------------------------------------------------- flight deck: the real outline, 1.2 m thick
prism("FLIGHT_DECK", FOOT, DECK_Z - 1.2, DECK_Z, M["hull"], M["deck"])

# ---------------------------------------------------------------- hull: 28 m beam at the waterline, flaring up to the
# hangar deck under the flight deck; a hurricane bow closed up to the flight deck; boot-top at the waterline
rings = []
N = 40
for i in range(N + 1):
    x = X0 + 1.5 + (X1 - X0 - 3.0) * i / N
    f = (x - X0) / (X1 - X0)                                         # 0 stern .. 1 bow
    lo, hi = deck_span(x)
    half_top = max(4.0, min(16.0, (hi - lo) / 2 - 1.0))
    half_wl = 14.0 * min(1.0, (1 - f) / 0.18 * 0.3 + 0.7) if f > 0.82 else 14.0          # the bow fines away
    if f > 0.82:
        half_wl = 14.0 * max(0.08, (1 - f) / 0.18) ** 0.7
        half_top = max(half_wl + 1.0, half_top * (0.55 + 0.45 * max(0.0, (1 - f) / 0.18)))
    if f < 0.04:
        half_wl *= 0.92
    z_top = DECK_Z - 1.2
    ring = [(YC - half_wl * 0.6, -8.5), (YC - half_wl, WATER - 0.4), (YC - half_wl, WATER + 0.8), (YC - half_top, 9.5),
            (YC - half_top, z_top), (YC + half_top, z_top), (YC + half_top, 9.5), (YC + half_wl, WATER + 0.8),
            (YC + half_wl, WATER - 0.4), (YC + half_wl * 0.6, -8.5)]
    rings.append([Vector((x, y, z)) for y, z in ring])
bm = bmesh.new()
V = [[bm.verts.new(p) for p in r] for r in rings]
K = len(rings[0])
for i in range(len(V) - 1):
    for k in range(K):
        f = bm.faces.new((V[i][k], V[i][(k + 1) % K], V[i + 1][(k + 1) % K], V[i + 1][k]))
        f.material_index = 1 if k in (1, 7) else 0                  # boot-top band at the waterline
for r in (V[0], V[-1]):
    bm.faces.new(r if r is V[-1] else list(reversed(r)))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
obj("HULL", bm, [M["hull"], M["boot"]])

# hangar-deck openings along both sides (the big roller-curtain bays) and the side elevator recess on the port side
for x in range(int(X0) + 30, int(X1) - 40, 26):
    lo, hi = deck_span(x)
    for side, yy in ((-1, YC - 15.9), (1, YC + 15.9)):
        box("HANGAR_BAY", (x, yy + side * 0.05, 13.0), (14.0, 0.2, 4.2), M["dark"])

# ---------------------------------------------------------------- deck markings: axial centreline, angled-deck lines,
# the bow's hull number, the deck-edge elevator outline
def strip(name, a, b, w, m, z=DECK_Z + 0.03):
    a, b = Vector((*a, z)), Vector((*b, z))
    d = (b - a)
    L = d.length
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(L, w, 0.04), verts=bm.verts)
    bm.transform(Matrix.Rotation(math.atan2(d.y, d.x), 4, "Z"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(a + b) / 2)
    return obj(name, bm, m)

for k in range(int((X1 - X0 - 20) / 12)):                          # dashed axial centreline
    x = X0 + 8 + k * 12
    strip("MARK_center", (x, YC), (x + 7, YC), 0.6, M["white"])
ang0, ang1 = (X0 + 6, YC + 2), (X0 + 160, 57.0)                    # the angled deck, aft-starboard to forward-port
for off in (-11.0, 11.0):
    a = Vector(ang0) + Vector((0, off)).copy()
    strip("MARK_angled_edge", (ang0[0], ang0[1] + off * 0.98), (ang1[0] - 6, ang1[1] + off * 0.98 - 9), 0.5, M["white"])
for k in range(10):
    t0, t1 = k / 10, k / 10 + 0.06
    a = (ang0[0] + (ang1[0] - ang0[0]) * t0, ang0[1] + (ang1[1] - 9 - ang0[1]) * t0)
    b = (ang0[0] + (ang1[0] - ang0[0]) * t1, ang0[1] + (ang1[1] - 9 - ang0[1]) * t1)
    strip("MARK_angled_center", a, b, 0.6, M["white"])
strip("MARK_foul_line", (X0 + 75, YC - 14), (X0 + 120, YC + 2), 0.4, M["yellow"])
for xe in (X0 + 190, X0 + 205):                                      # port deck-edge elevator outline
    strip("MARK_elevator", (xe, 44.0), (xe, 58.0), 0.35, M["yellow"])
# "11" on the bow end of the flight deck, read from aft
cu = bpy.data.curves.new("HULLNO", "FONT"); cu.body = "11"; cu.size = 14.0; cu.align_x = "CENTER"; cu.align_y = "CENTER"
to = bpy.data.objects.new("HULLNO", cu); COLL.objects.link(to)
to.location = (X1 - 32, YC, DECK_Z + 0.05); to.rotation_euler = (0, 0, -math.pi / 2)
bpy.context.view_layer.objects.active = to; to.select_set(True); bpy.ops.object.convert(target="MESH"); to = bpy.context.active_object
to.data.materials.clear(); to.data.materials.append(M["white"]); to.select_set(False)

# ---------------------------------------------------------------- the island (starboard, amidships): bridge decks,
# funnel, lattice mast with radars, hull number on its sides
IX0, IX1 = X0 + 140, X0 + 182                                        # ~42 m long
lo, hi = deck_span((IX0 + IX1) / 2)
IY0, IY1 = lo + 0.5, lo + 9.0
prism("ISLAND_base", [(IX0, IY0), (IX1 - 4, IY0), (IX1, IY0 + 3), (IX1, IY1), (IX0, IY1)], DECK_Z, DECK_Z + 9.0, M["hull"], M["hull"])
prism("ISLAND_bridge", [(IX0 + 10, IY0 + 0.6), (IX1 - 3, IY0 + 0.6), (IX1 + 1.0, IY0 + 3), (IX1 + 1.0, IY1 - 0.5), (IX0 + 10, IY1 - 0.5)],
      DECK_Z + 9.0, DECK_Z + 14.0, M["hull"], M["hull"])
box("ISLAND_bridge_windows", ((IX0 + IX1) / 2 + 6, (IY0 + IY1) / 2, DECK_Z + 12.6), (IX1 - IX0 - 14 + 2.2, IY1 - IY0 - 0.7, 1.3), M["glass"])
prism("ISLAND_pilothouse", [(IX0 + 18, IY0 + 1.6), (IX1 - 6, IY0 + 1.6), (IX1 - 6, IY1 - 1.4), (IX0 + 18, IY1 - 1.4)],
      DECK_Z + 14.0, DECK_Z + 17.5, M["hull"], M["hull"])
box("ISLAND_pilothouse_windows", ((IX0 + 18 + IX1 - 6) / 2, (IY0 + IY1) / 2, DECK_Z + 16.2), (IX1 - IX0 - 24 + 0.3, IY1 - IY0 - 2.6, 1.0), M["glass"])
# funnel: an oval, raked aft, capped black
bm = bmesh.new()
fx, fy = IX0 + 9, (IY0 + IY1) / 2
rings = []
for z, sx, sy, dx in ((DECK_Z + 9, 6.0, 3.6, 0), (DECK_Z + 18, 5.4, 3.2, -1.2), (DECK_Z + 22, 5.0, 3.0, -2.0)):
    rings.append([bm.verts.new((fx + dx + sx * math.cos(a), fy + sy * math.sin(a), z)) for a in [2 * math.pi * k / 20 for k in range(20)]])
for i in range(len(rings) - 1):
    for k in range(20):
        bm.faces.new((rings[i][k], rings[i][(k + 1) % 20], rings[i + 1][(k + 1) % 20], rings[i + 1][k]))
f = bm.faces.new(rings[-1]); f.material_index = 1
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
obj("FUNNEL", bm, [M["hull"], M["boot"]], 40)
# lattice mast (tripod) with a yard and the big bedspring air-search radar, a mast-head light
mx, my = IX0 + 24, (IY0 + IY1) / 2
for dx, dy in ((-2.5, -1.8), (-2.5, 1.8), (2.5, 0)):
    a, b = Vector((mx + dx, my + dy, DECK_Z + 17.5)), Vector((mx, my, DECK_Z + 38.0))
    d = b - a
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.35, radius2=0.25, depth=d.length)
    bm.transform(Matrix.Translation((a + b) / 2) @ Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4())
    obj("MAST_leg", bm, M["steel"])
box("MAST_yard", (mx, my, DECK_Z + 31.0), (1.0, 11.0, 0.4), M["steel"])
box("RADAR_bedspring", (mx + 1.2, my, DECK_Z + 34.5), (0.6, 9.0, 5.0), M["steel"])
box("RADAR_dish", (mx - 1.0, my, DECK_Z + 27.5), (0.4, 5.0, 2.4), M["steel"])
box("MAST_light", (mx, my, DECK_Z + 38.6), (0.5, 0.5, 0.8), M["red_l"])
for side in (IY0 - 0.06, IY1 + 0.06):                               # hull number on the island
    cu = bpy.data.curves.new("ISL11", "FONT"); cu.body = "11"; cu.size = 5.0; cu.align_x = "CENTER"; cu.align_y = "CENTER"
    t = bpy.data.objects.new("ISL11", cu); COLL.objects.link(t)
    t.location = (IX0 + 30, side, DECK_Z + 5.0); t.rotation_euler = (math.pi / 2, 0, 0 if side < YC else math.pi)
    bpy.context.view_layer.objects.active = t; t.select_set(True); bpy.ops.object.convert(target="MESH"); t = bpy.context.active_object
    t.data.materials.clear(); t.data.materials.append(M["white"]); t.select_set(False)

# ---------------------------------------------------------------- the Space Shuttle Enterprise pavilion (aft deck)
PX0, PX1 = X0 + 4, X0 + 62
bm = bmesh.new()
rings = []
for i in range(9):
    x = PX0 + (PX1 - PX0) * i / 8
    rr = []
    for k in range(17):
        a = math.pi * k / 16                                         # a pillow: a half-ellipse arch along the deck
        rr.append(bm.verts.new((x, YC - 13.0 * math.cos(a), DECK_Z + 17.0 * math.sin(a) * (0.9 + 0.1 * math.sin(math.pi * i / 8)))))
    rings.append(rr)
for i in range(8):
    for k in range(16):
        bm.faces.new((rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]))
for r in (rings[0], rings[-1]):
    bm.faces.new(r if r is rings[-1] else list(reversed(r)))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
obj("SHUTTLE_PAVILION", bm, M["tent"], 50)


# ---------------------------------------------------------------- display aircraft along the deck edges
def jet(name, x, y, heading, L=19.0, span=12.0, m=None, blackbird=False):
    m = m or M["jet"]
    parts = []
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=1.0 if not blackbird else 0.9, radius2=0.15, depth=L)
    bm.transform(Matrix.Rotation(math.pi / 2, 4, "Y"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 1.8))
    parts.append(obj(name + "_fuse", bm, m))
    wing = [(-L * 0.22, 0), (L * 0.18, 0), (-L * 0.05, span / 2), (-L * 0.2, span / 2)] if not blackbird else \
        [(-L * 0.45, 0), (L * 0.35, 0), (-L * 0.1, span / 2), (-L * 0.42, span / 2)]
    for sy in (1, -1):
        bm = bmesh.new()
        vs = [bm.verts.new((px, py * sy, 1.6)) for px, py in wing]
        bm.faces.new(vs if sy > 0 else list(reversed(vs)))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.25)
        parts.append(obj(name + "_wing", bm, m))
    for sy in (0.9, -0.9):                                          # twin fins
        bm = bmesh.new()
        vs = [bm.verts.new(p) for p in ((-L * 0.5, sy, 2.2), (-L * 0.32, sy, 2.2), (-L * 0.45, sy * 1.2, 5.0))]
        bm.faces.new(vs)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.2)
        parts.append(obj(name + "_fin", bm, m))
    for o in parts:
        o.data.transform(Matrix.Translation((x, y, DECK_Z)) @ Matrix.Rotation(heading, 4, "Z"))
    return parts

# port side (north) along the angled deck and starboard aft of the island, keeping the axial lane clear for take-off
for i, x in enumerate(range(int(X0 + 80), int(X0 + 170), 18)):
    jet(f"JET_port{i}", x, deck_span(x)[1] - 7.0, math.radians(-135))
for i, x in enumerate(range(int(X0 + 190), int(X1 - 30), 20)):
    jet(f"JET_bow{i}", x, deck_span(x)[0] + 6.0, math.radians(120))
jet("A12_BLACKBIRD", IX0 - 22, deck_span(IX0 - 22)[0] + 5.5, math.radians(160), L=32.7, span=16.9, m=M["black"], blackbird=True)

# ---------------------------------------------------------------- the visitor elevator tower on Pier 86 (port side)
EX, EY = X0 + 208, 49.5
box("ELEVATOR_tower", (EX, EY, 1.2 + (DECK_Z - 1.2) / 2 + 1.0), (5.0, 5.0, DECK_Z - 1.2 + 2.0), M["hull"])
box("ELEVATOR_glass", (EX, EY + 2.55, 1.2 + (DECK_Z + 2.0) / 2), (3.6, 0.1, DECK_Z - 1.0), M["glass"])
box("ELEVATOR_bridge", (EX, (EY + deck_span(EX)[1]) / 2 - 1.0, DECK_Z - 0.2), (3.0, abs(EY - deck_span(EX)[1]) + 2.0, 0.4), M["hull"])

# ---------------------------------------------------------------- join, export, previews
bpy.ops.object.select_all(action="DESELECT")
objs = [o for o in bpy.data.objects if o.type == "MESH"]
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
ship = bpy.context.active_object
ship.name = ship.data.name = "INTREPID"
pts = [v.co for v in ship.data.vertices]
print("INTREPID length %.1f m (real 266.3), deck width max %.1f, mast top %.1f m above water, %d tris, elevator at (%.1f, %.1f)" % (
    max(p.x for p in pts) - min(p.x for p in pts), max(p.y for p in pts) - min(p.y for p in pts), max(p.z for p in pts) - WATER,
    sum(len(p.vertices) - 2 for p in ship.data.polygons), EX, EY))
os.makedirs(os.path.join(ROOT, "blender/heroes"), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender/heroes/intrepid.blend"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_draco_mesh_compression_enable=True, export_yup=True)
print("EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB")
if PREFIX:
    os.makedirs(os.path.dirname(PREFIX), exist_ok=True)
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    scn.render.resolution_x, scn.render.resolution_y = 1600, 900
    wd = bpy.data.worlds.new("w"); scn.world = wd; wd.use_nodes = True
    wd.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.66, 0.8, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(150)); COLL.objects.link(sun)
    wm = mat("water", "#2A4A55", 0.15)
    bpy.ops.mesh.primitive_plane_add(size=2000, location=((X0 + X1) / 2, YC, WATER)); bpy.context.active_object.data.materials.append(wm)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); COLL.objects.link(cam); scn.camera = cam; cam.data.lens = 35
    cx = (X0 + X1) / 2
    for nm, eye, look in (("34", (cx + 220, YC - 200, 90), (cx, YC, 10)), ("deck", (X0 + 20, YC + 5, DECK_Z + 1.7), (X1, YC, DECK_Z + 3)),
                          ("side", (cx, YC - 330, 25), (cx, YC, 12))):
        cam.location = eye
        cam.rotation_euler = (Vector(look) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = f"{PREFIX}_{nm}.png"
        bpy.ops.render.render(write_still=True)
