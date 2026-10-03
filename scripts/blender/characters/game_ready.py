"""Make a realistic character (from the character agent's MakeHuman pipeline) game-ready for the city.

  Blender -b --factory-startup -P scripts/blender/characters/game_ready.py -- <in.glb> <out.glb>

Game contract (see docs/characters.md): Mixamo 19-bone rig kept as-is, facing -Y, feet at z 0, <= 35k triangles,
textures <= 1024 px, Draco. What changes: the stray helper Icosphere is dropped, the 112k-triangle strand hair is
decimated along its ribbons (alpha-cut, so it reads the same at street distance), the jeans' stitch threads go (the
normal map already has them) and the body is reduced where clothes hide it.
"""
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
src, dst = args[0], args[1]
FAR = len(args) > 2 and args[2] == "far"     # the far version (people beyond ~35 m): ~8k tris, 512 px textures
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

TARGET = {"DRESS": 0.7,  "BODY": 0.47, "SHOES05": 0.45, "JEANS_STITCHES": 0.0, "HIGHPOLYEYES": 0.5, "NECKLACE": 0.4,
          "EARRING_L": 0.25, "EARRING_R": 0.25}
if FAR:   # what can't be seen from 35 m goes: buttons, belt loops, pockets, lashes, earrings
    TARGET = {"DRESS": 0.3, "BODY": 0.16, "BOTTOM": 0.35, "TOP": 0.4, "SHOES05": 0.15, "JEANS_STITCHES": 0.0,
              "HIGHPOLYEYES": 0.3, "NECKLACE": 0.0, "EARRING_L": 0.0, "EARRING_R": 0.0, "BOTTOM_BUTTON": 0.0,
              "BOTTOM_POCKET_1": 0.0, "BOTTOM_POCKET_-1": 0.0, "BOTTOM_WAISTBAND": 0.4}
    TARGET.update({n: 0.0 for n in ("EYELASHES01", "EYELASHES03", "BOTTOM_LOOP_-0.035", "BOTTOM_LOOP_-0.1",
                                    "BOTTOM_LOOP_0.035", "BOTTOM_LOOP_0.1")})


def thin_hair(o, keep=0.36, ratio=0.3):
    """Strand hair: keep ~36% of the ribbons (picked at random, so evenly spread), then a gentle collapse on those
    (decimating all 1,652 ribbons hard instead turns them into spikes)."""
    import random
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    seen, kill, rng = set(), [], random.Random(7)
    for v in bm.verts:
        if v in seen:
            continue
        part, st = [], [v]
        while st:
            x = st.pop()
            if x in seen:
                continue
            seen.add(x); part.append(x); st += [e.other_vert(x) for e in x.link_edges]
        if rng.random() > keep:
            kill += part
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    m = o.modifiers.new("dec", "DECIMATE")
    m.ratio = ratio
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        bpy.ops.object.modifier_move_to_index(modifier="dec", index=0)
        bpy.ops.object.modifier_apply(modifier="dec")


def hide_covered_skin(body, covers, depth=0.06):
    """Delete the body's skin under the clothes and shoes (as MakeHuman's proxies do): when the legs bend, skin that the
    rig moves a little differently from the jeans would otherwise poke through the cloth. A body vertex goes when it lies
    behind (inside) a covering surface, within `depth` of it."""
    import bmesh
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree
    trees, edge_pts, waist = [], [], 9.0
    for c in covers:
        if c.name.startswith("BOTTOM"):                    # trousers: keep the skin up to 6 cm under the waistline
            waist = min(waist, max((c.matrix_world @ v.co).z for v in c.data.vertices) - 0.06)
        bm = bmesh.new()
        bm.from_mesh(c.data)
        bm.transform(c.matrix_world)
        bm.normal_update()
        trees.append(BVHTree.FromBMesh(bm))
        edge_pts += [v.co.copy() for v in bm.verts if v.is_boundary]      # waistband, hems, collar, shoe openings
        bm.free()
    kd = KDTree(len(edge_pts))
    for i, q in enumerate(edge_pts):
        kd.insert(q, i)
    kd.balance()
    bm = bmesh.new()
    bm.from_mesh(body.data)
    mw = body.matrix_world
    kill = []
    for v in bm.verts:
        p = mw @ v.co
        if p.z > waist and p.z < waist + 0.3:
            continue
        if edge_pts and kd.find(p)[2] < 0.025:              # keep skin along the openings: no gap under a waistband
            continue
        nrm = (mw.to_3x3() @ v.normal).normalized()
        for t in trees:
            # covered = straight out from the skin (along its normal) you hit cloth within `depth`; starting 1.5 cm
            # inside catches skin-tight cloth the body pokes through. (A nearest-point test also ate the skin
            # beside thin dress straps.)
            hit = t.ray_cast(p - nrm * 0.015, nrm, depth + 0.015)
            near = t.find_nearest(p, 0.03)
            poke = False
            if near[0] is not None:                          # skin poking through tight cloth (leather calves):
                d = p - near[0]                              # right under / through the cloth, not beside a strap
                along = d.dot(near[1])
                poke = along < 0.015 and (d - near[1] * along).length < 0.004
            if hit[0] is not None or poke:
                kill.append(v)
                break
    faces = {f for v in kill for f in v.link_faces if all(x in set(kill) for x in f.verts)}
    bmesh.ops.delete(bm, geom=list(faces), context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(body.data)
    bm.free()
    print(f"COVERED {len(faces)} body faces under {[c.name for c in covers]}")


def weld(o, dist=0.001):
    """The clothes are closed shells cut into panels with duplicate vertices along the seams; skinned separately, the
    copies drift apart when the legs swing and the seam opens into a see-through slit. Weld them (UVs stay per corner)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    n = len(bm.verts)
    # only open panel edges: welding everything also collapses a hem's inner and outer layers into torn geometry
    bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if v.is_boundary], dist=dist)
    print(f"WELD {o.name}: {n - len(bm.verts)} seam vertices")
    bm.to_mesh(o.data)
    bm.free()


for n in ("BOTTOM", "TOP", "DRESS"):
    if n in bpy.data.objects:
        weld(bpy.data.objects[n])
# the socks are part of the shoes and run up inside trouser legs: hidden, they poke through when the knee bends
shoes = bpy.data.objects.get("SHOES05")
if shoes and "BOTTOM" in bpy.data.objects:
    hide_covered_skin(shoes, [bpy.data.objects["BOTTOM"]], depth=0.05)
body = bpy.data.objects.get("BODY")
if body:
    hide_covered_skin(body, [bpy.data.objects[n] for n in ("BOTTOM", "TOP", "DRESS", "SHOES05") if n in bpy.data.objects])

for o in list(bpy.data.objects):
    if o.name == "HAIR" and o.type == "MESH":
        thin_hair(o, *((0.2, 0.22) if FAR else ()))
        continue
    if o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)
        continue
    if o.type != "MESH":
        continue
    r = TARGET.get(o.name)
    if r == 0.0:
        bpy.data.objects.remove(o)
        continue
    if r:
        m = o.modifiers.new("dec", "DECIMATE")
        m.ratio = r
        m.use_collapse_triangulate = True
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
            bpy.ops.object.modifier_move_to_index(modifier="dec", index=0)
            bpy.ops.object.modifier_apply(modifier="dec")
CAP = 512 if FAR else 1024
for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > CAP:
        k = CAP / max(w, h)
        img.scale(int(w * k), int(h * k))
tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
parts = ", ".join(f"{o.name} {sum(len(p.vertices) - 2 for p in o.data.polygons)}" for o in bpy.data.objects if o.type == "MESH")
# one skinned mesh per character (a few material groups) instead of ~19 objects: a crowd of them costs far fewer draws
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent and o.parent.type == "ARMATURE"]
if len(meshes) > 1:
    with bpy.context.temp_override(object=meshes[0], active_object=meshes[0], selected_objects=meshes,
                                   selected_editable_objects=meshes):
        bpy.ops.object.join()
    meshes[0].name = "CHARACTER"
print(f"GAMEREADY {src.split('/')[-1]} -> {tris} tris{' (far)' if FAR else ''}; {parts}")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_draco_mesh_compression_enable=True,
                          export_image_format="JPEG", export_jpeg_quality=85,
                          export_animations=True, export_skins=True)
