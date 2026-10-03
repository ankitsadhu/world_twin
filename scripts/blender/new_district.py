"""Create a new district: .blend with the fixed collection tree, lookdev rig, and a manifest stub.

Inside Blender:  new_district.create("central_park", "CP", "Central Park", lat, lon)
CLI:             blender -b -P new_district.py -- central_park CP "Central Park" 40.7829 -73.9654
Existing manifests are never overwritten; an existing .blend is opened, not replaced.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402
import lookdev  # noqa: E402


def manifest_stub(district_id, prefix, name, lat, lon):
    return {
        "schema_version": 1, "id": district_id, "prefix": prefix, "name": name,
        "placement": "geo", "geo_anchor": {"lat": lat, "lon": lon},
        "grid_rotation_deg": 0.0, "world_offset": [0.0, 0.0, 0.0],
        "blend_file": f"blender/districts/{district_id}/{district_id}.blend",
        "bounds_geo": {"south": lat - 0.004, "west": lon - 0.005, "north": lat + 0.004, "east": lon + 0.005},
        "tiers": {}, "chunks": ["hero", "mid", "far"], "spawns": {}, "vehicle_zones": {},
        "lod_distances_m": {"hero": 400, "mid": 900, "far": 3000},
        "outputs": {"export_dir": f"export/{district_id}", "slots": f"data/{district_id}/slots.json",
                    "footprints": f"data/{district_id}/footprints.geojson"},
    }


def register_in_world(district_id):
    world = C.load_world()
    if not any(d["id"] == district_id for d in world["districts"]):
        world["districts"].append({"id": district_id, "manifest": f"config/districts/{district_id}.json",
                                   "enabled": False})
        C.save_json("config/world.json", world)


def create(district_id, prefix, name, lat, lon):
    man_rel = f"config/districts/{district_id}.json"
    if not os.path.exists(C.project_path(man_rel)):
        C.save_json(man_rel, manifest_stub(district_id, prefix, name, lat, lon))
    district = C.load_district(district_id)
    register_in_world(district_id)
    blend = C.project_path(district["blend_file"])
    if os.path.exists(blend):
        bpy.ops.wm.open_mainfile(filepath=blend)
    else:
        bpy.ops.wm.read_homefile(use_empty=True)
    scene = bpy.context.scene
    scene.name = district_id
    scene["district_id"] = district_id
    scene["prefix"] = district["prefix"]
    tree = C.ensure_district_tree(district["prefix"])
    lookdev.setup_render(scene)
    lookdev.ensure_sun(tree["LOOKDEV"])
    lookdev.set_time(0.0, district["prefix"])
    os.makedirs(os.path.dirname(blend), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend, relative_remap=True)
    return {"blend": blend, "collections": [c.name for c in tree["ROOT"].children]}


if __name__ == "__main__" and "--" in sys.argv:
    a = sys.argv[sys.argv.index("--") + 1:]
    print(create(a[0], a[1], a[2], float(a[3]), float(a[4])))
