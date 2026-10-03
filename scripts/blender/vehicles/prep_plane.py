"""Turn the downloaded small propeller plane into a game asset.

The source file lies on its side (wings vertical, nose along +X). This stands it upright on its wheels, turns the
nose to +Y (the vehicle convention: three.js -Z is forward), merges the 68 parts into one mesh per material, and keeps
the propeller (blades, hub, spinner) as a separate object named PROPELLER, pivoting on the engine axis so the game can
spin it.

  blender -b --factory-startup -P scripts/blender/vehicles/prep_plane.py -- <in.glb> <out.glb> [render_prefix]
"""
import bpy, sys, math
from mathutils import Matrix, Vector

src, out = sys.argv[sys.argv.index("--") + 1:][:2]
prefix = (sys.argv[sys.argv.index("--") + 1:] + [None, None, None])[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
fix = Matrix.Rotation(math.pi / 2, 4, "Z") @ Matrix.Rotation(-math.pi / 2, 4, "X")   # upright, nose to +Y
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.data = o.data.copy()
    o.data.transform(fix @ mw)
    o.matrix_world = Matrix.Identity(4)
for o in [o for o in bpy.data.objects if o.type != "MESH"]:
    bpy.data.objects.remove(o)
# wheels on the ground, centred between the main gear
pts = [v.co for o in meshes for v in o.data.vertices]
zmin = min(p.z for p in pts)
mains = [v.co for o in meshes if o.name.startswith("Main_tire") for v in o.data.vertices]
cx = sum(p.x for p in mains) / len(mains); cy = sum(p.y for p in mains) / len(mains)
for o in meshes:
    o.data.transform(Matrix.Translation((-cx, -cy, -zmin)))


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    return o

prop_parts = [o for o in meshes if o.name.startswith("Propeller")]
body_parts = [o for o in meshes if o not in prop_parts]
prop = join(prop_parts, "PROPELLER")
body = join(body_parts, "PLANE_body")
# propeller pivot: centre of the spinner/hub on the engine axis
ps = [v.co for v in prop.data.vertices]
pc = Vector((sum(p.x for p in ps) / len(ps), max(p.y for p in ps) - 0.02, sum(p.z for p in ps) / len(ps)))
hub = [v.co for v in prop.data.vertices]
prop.data.transform(Matrix.Translation(-pc))
prop.location = pc
prop.parent = body
for m in bpy.data.materials:                      # readable material names
    b = m.node_tree.nodes.get("Principled BSDF") if m.node_tree else None
    if b:
        b.inputs["Roughness"].default_value = 0.45
        if "Metallic" in b.inputs and m.name in ("mat_115130145",):
            b.inputs["Metallic"].default_value = 0.4
names = {"mat_232238244": "plane_white", "mat_2891154": "plane_blue", "mat_115130145": "plane_metal",
         "mat_284868": "plane_glass", "mat_193555": "plane_dark", "mat_2084845": "plane_red", "mat_3517095": "plane_green",
         "mat_222529": "plane_blade", "mat_24018345": "plane_yellow", "mat_303338": "plane_tire"}
for m in bpy.data.materials:
    m.name = names.get(m.name, m.name)
for o in (body, prop):
    o.data.update()
bb = [v.co for v in body.data.vertices]
print("PLANE size L=%.2f span=%.2f h=%.2f  prop pivot %s  tris %d" % (
    max(p.y for p in bb) - min(p.y for p in bb), max(p.x for p in bb) - min(p.x for p in bb), max(p.z for p in bb),
    tuple(round(a, 2) for a in pc), sum(len(p.vertices) - 2 for o in (body, prop) for p in o.data.polygons)))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_draco_mesh_compression_enable=True, export_yup=True)
if prefix:
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = 1200, 700
    w = bpy.data.worlds.new("w"); scn.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.84, 0.9, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3.5
    sun.rotation_euler = (0.8, 0.1, 0.9); scn.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=60)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scn.collection.objects.link(cam); scn.camera = cam
    for nm, d in (("34", (1.0, 1.1, 0.55)), ("side", (1, 0.0, 0.12))):
        c = Vector((0, 0.3, 1.0)); cam.location = c + Vector(d).normalized() * 12
        cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = f"{prefix}_{nm}.png"
        bpy.ops.render.render(write_still=True)
