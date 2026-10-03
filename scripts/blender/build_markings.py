"""Road markings: NYC high-visibility ladder crosswalks, stop bars, dashed avenue lane lines.

Placement is driven by the manifest grid (avenue x / street y in local metres) and every bar is
ray-cast onto the road mesh, so nothing is painted on plazas, sidewalks or buildings.
"""
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402

Z = 0.012
BAR_W, BAR_GAP, XWALK_LEN = 0.6, 0.6, 3.6
LANE_W = 3.4


def _on_road(scene, dg, road, x, y):
    hit, loc, n, i, obj, m = scene.ray_cast(dg, Vector((x, y, 5.0)), Vector((0, 0, -1)))
    return hit and obj == road


def _quad(bm, x0, y0, x1, y1):
    vs = [bm.verts.new((x, y, Z)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
    bm.faces.new(vs)


def run(district_id="times_square"):
    d = C.load_district(district_id)
    grid = d["street_grid_local"]
    tree = C.ensure_district_tree(d["prefix"])
    scene = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    road = bpy.data.objects[f"TER_{d['prefix']}_Roads"]
    bm = bmesh.new()
    bars = 0

    def bar(x0, y0, x1, y1):
        nonlocal bars
        if _on_road(scene, dg, road, (x0 + x1) / 2, (y0 + y1) / 2):
            _quad(bm, x0, y0, x1, y1)
            bars += 1

    for ax, aw in grid["avenues"]:
        for sy, sw in grid["streets"]:
            # crosswalks across the avenue (north + south of the street), bars run along the avenue (y)
            for side in (-1, 1):
                yc = sy + side * (sw / 2 + 1.2 + XWALK_LEN / 2)
                x = ax - aw / 2 + 0.4
                while x + BAR_W < ax + aw / 2:
                    bar(x, yc - XWALK_LEN / 2, x + BAR_W, yc + XWALK_LEN / 2)
                    x += BAR_W + BAR_GAP
                # stop bar before the crosswalk
                ys = yc + side * (XWALK_LEN / 2 + 1.2)
                bar(ax - aw / 2 + 0.3, ys - 0.3, ax + aw / 2 - 0.3, ys + 0.3)
            # crosswalks across the street (east + west of the avenue), bars run along the street (x)
            for side in (-1, 1):
                xc = ax + side * (aw / 2 + 1.2 + XWALK_LEN / 2)
                y = sy - sw / 2 + 0.4
                while y + BAR_W < sy + sw / 2:
                    bar(xc - XWALK_LEN / 2, y, xc + XWALK_LEN / 2, y + BAR_W)
                    y += BAR_W + BAR_GAP
        # dashed lane lines along the avenue between intersections (3 m dash, 9 m gap)
        ys = sorted(grid["streets"])
        for (y0, w0), (y1, w1) in zip(ys, ys[1:]):
            start, end = y0 + w0 / 2 + 9.0, y1 - w1 / 2 - 9.0
            lanes = int(aw // LANE_W)
            for k in range(1, lanes):
                lx = ax - aw / 2 + k * aw / lanes
                y = start
                while y + 3.0 < end:
                    bar(lx - 0.07, y, lx + 0.07, y + 3.0)
                    y += 12.0

    name = f"TER_{d['prefix']}_Markings"
    me = bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
    me.clear_geometry()
    me.materials.clear()
    me.materials.append(C.get_material("M_Road_PaintWhite"))
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for loop in f.loops:
            loop[uvl].uv = (loop.vert.co.x, loop.vert.co.y)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.get(name) or bpy.data.objects.new(name, me)
    obj.data = me
    C.link_only_to(obj, tree["TERRAIN"])
    C.set_props(obj, surface="markings", chunk="terrain")
    return {"bars": bars, "tris": C.tri_count(obj)}


if __name__ == "__main__":
    print(run())
