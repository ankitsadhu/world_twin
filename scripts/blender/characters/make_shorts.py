"""Turn a character's trousers into shorts: same person, same rig, same cloth (UVs, texture, skin weights).

  Blender -b --factory-startup -P scripts/blender/characters/make_shorts.py -- <in.glb> <out.glb> <z_mid> <rise>

Each leg is cut by its own slanted plane: z_mid at the middle of the thigh (x = +-0.085 m), rising `rise` m per metre
towards the outer hip, like real shorts (higher at the side seam than at the inseam). The cloth is a thin two-layer
shell (outside + lining), so each cut leaves two rings per leg; they are bridged into a closed hem.
The bare legs are the character's own MakeHuman skin (game_ready.py keeps skin that nothing covers any more).

Lengths used (woman 1.63 m, crotch ~0.76 m):
  hot pants   z_mid 0.715, rise 0.20  -> ~4 cm inseam, ~7 cm at the side
  shorts      z_mid 0.600, rise 0.08  -> mid-thigh, ~16 cm inseam
"""
import sys

import bmesh
import bpy

args = sys.argv[sys.argv.index("--") + 1:]
src, dst, z_mid, rise = args[0], args[1], float(args[2]), float(args[3])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)


def cut(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    # weld the panels' open seam edges first (as game_ready.py does), or the seam joins the hem ring and leaves a notch
    bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if v.is_boundary], dist=0.001)
    for s in (1, -1):                        # left leg (x > 0), right leg (x < 0)
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(s * 0.085, 0, z_mid),
                               plane_no=(-s * rise, 0, 1), clear_inner=True)
    # the hem: pair the outside ring with the lining ring of each leg, bridge them
    bnd = [e for e in bm.edges if e.is_boundary]
    seen, loops = set(), []
    for e in bnd:
        if e in seen:
            continue
        comp, st = [], [e]
        while st:
            x = st.pop()
            if x in seen:
                continue
            seen.add(x); comp.append(x)
            for v in x.verts:
                st += [y for y in v.link_edges if y.is_boundary and y not in seen]
        pts = [v.co for ed in comp for v in ed.verts]
        c = sum(pts, start=pts[0] * 0) / len(pts)
        loops.append((comp, c))
    bridged = 0
    used = set()
    for i, (a, ca) in enumerate(loops):
        if i in used or ca.z > z_mid + 0.12:          # only the new leg openings, not the waist
            continue
        j = min((k for k in range(len(loops)) if k != i and k not in used), key=lambda k: (loops[k][1] - ca).length, default=None)
        if j is None or (loops[j][1] - ca).length > 0.02:
            continue
        try:
            bmesh.ops.bridge_loops(bm, edges=a + loops[j][0])
            used |= {i, j}
            bridged += 1
        except Exception as ex:  # noqa: BLE001 - an unbridged hem is still fine (the cloth renders double-sided)
            print("HEM not bridged:", ex)
    bm.to_mesh(o.data)
    bm.free()
    print(f"SHORTS {o.name}: cut at {z_mid} (+{rise}/m to the side), {len(loops)} rings, {bridged} hems bridged")


for name in ("BOTTOM", "JEANS_STITCHES"):
    if name in bpy.data.objects:
        cut(bpy.data.objects[name])
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animations=True, export_skins=True)
