"""Spawns, navigation curves and review cameras for a district (idempotent).

SPAWN_* empties  : player / car / bike / plane / ship start points (+Y of the empty = forward)
NAV_roads        : car network curve (one poly spline per OSM way, width + oneway kept as extras)
NAV_bike_*       : bike-only plaza zone; NAV_water_*: sailable area; NAV_runway_*: take-off line
CAM_Photo*       : cameras matching the user's reference photos (lookdev only)
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402

# Times Square: positions in local metres (7th Ave x=0, W45th y=-5; see manifest landmarks_local)
TS_SPAWNS = {
    "SPAWN_player_DuffySquare": ((-18.0, 70.0, 0.16), 180.0),
    "SPAWN_car_7thAve_42nd": ((4.0, -300.0, 0.0), 0.0),
    "SPAWN_bike_BroadwayPlaza": ((22.0, -120.0, 0.16), 160.0),
    "SPAWN_plane_IntrepidDeck": ((-1486.0, -60.0, 18.05), 0.0),
    "SPAWN_ship_Pier83": ((-1560.0, -240.0, -1.8), 0.0),
}

# (location, look-at, lens mm) -- matched to reference photos 1..4
TS_CAMERAS = {
    "CAM_Photo1_750_7thAve": ((-6.0, 302.0, 1.7), (24.0, 334.0, 16.0), 20),
    "CAM_Photo2_Nasdaq": ((8.0, -128.0, 1.7), (60.0, -184.0, 30.0), 22),
    "CAM_Photo3_OneTimesSquare": ((-25.0, 140.0, 70.0), (16.0, -215.0, 40.0), 35),
    "CAM_Photo4_W49th": ((-1.0, 323.0, 1.7), (-24.0, 298.0, 9.0), 22),
    "CAM_Aerial_Overview": ((420.0, -900.0, 520.0), (-200.0, 40.0, 0.0), 35),
}


def _empty(name, coll, loc, heading_deg, kind):
    o = bpy.data.objects.get(name) or bpy.data.objects.new(name, None)
    C.link_only_to(o, coll)
    o.empty_display_type = "SINGLE_ARROW" if kind == "spawn" else "PLAIN_AXES"
    o.empty_display_size = 4.0
    o.location = loc
    # arrow points +Z by default: tilt to +Y then yaw by heading (0 = north/+Y)
    o.rotation_euler = (math.radians(-90), 0, math.radians(-heading_deg))
    o["spawn_type"] = name.split("_")[1]
    o["heading_deg"] = heading_deg
    return o


def _look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def _curve(name, coll, lines, z=0.05, **props):
    cu = bpy.data.curves.get(name) or bpy.data.curves.new(name, "CURVE")
    cu.splines.clear()
    cu.dimensions = "3D"
    for pts in lines:
        if len(pts) < 2:
            continue
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for p, (x, y) in zip(sp.points, pts):
            p.co = (x, y, z, 1.0)
    o = bpy.data.objects.get(name) or bpy.data.objects.new(name, cu)
    o.data = cu
    C.link_only_to(o, coll)
    C.set_props(o, **props)
    return o


def run(district_id="times_square"):
    d = C.load_district(district_id)
    prefix = d["prefix"]
    tree = C.ensure_district_tree(prefix)
    g = C.load_json(f"data/{district_id}/ground.json")
    nav = tree["NAV"]
    made = []
    for name, (loc, hdg) in TS_SPAWNS.items():
        made.append(_empty(name, nav, loc, hdg, "spawn").name)

    car = [r for r in g["nav_roads"] if r["highway"] not in ("pedestrian",)]
    o = _curve("NAV_roads", nav, [r["points"] for r in car], usage="car", count=len(car))
    o["road_meta"] = [{"name": r["name"], "w": r["width"], "oneway": r["oneway"]} for r in car][:2000]
    made.append(o.name)
    made.append(_curve("NAV_bike_BroadwayPlaza", nav, [p["exterior"] + p["exterior"][:1] for p in g["plazas"]],
                       z=0.2, usage="bike").name)
    made.append(_curve("NAV_water_Hudson", nav, [p["exterior"] + p["exterior"][:1] for p in g["water"]],
                       z=-1.8, usage="ship").name)
    ships = [s for s in g["ships"] if "Intrepid" in (s["name"] or "")]
    if ships:
        ys = [p[1] for p in ships[0]["exterior"]]
        xs = [p[0] for p in ships[0]["exterior"]]
        cx = sum(xs) / len(xs)
        made.append(_curve("NAV_runway_Intrepid", nav, [[(cx, min(ys) + 15), (cx, max(ys) - 5)]],
                           z=18.05, usage="plane", ceiling_m=d["vehicle_zones"]["plane"]["ceiling_m"]).name)

    for name, (loc, tgt, lens) in TS_CAMERAS.items():
        cam = bpy.data.objects.get(name) or bpy.data.objects.new(name, bpy.data.cameras.new(name))
        C.link_only_to(cam, tree["LOOKDEV"])
        cam.location = loc
        _look_at(cam, tgt)
        cam.data.lens = lens
        cam.data.clip_end = 6000
        made.append(name)
    bpy.context.scene.camera = bpy.data.objects["CAM_Photo3_OneTimesSquare"]
    return made


if __name__ == "__main__":
    print(run())
