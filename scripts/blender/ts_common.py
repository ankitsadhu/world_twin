"""Shared helpers for the city pipeline.

Usable both inside Blender (bpy available) and from plain Python (geo/config helpers only).
Every district follows the same rules: metres, Z-up, fixed collection tree, fixed naming.
"""
import json
import math
import os

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

EARTH_R = 6378137.0

# Fixed collection tree for every district: suffix -> (exported?, description)
DISTRICT_COLLECTIONS = {
    "REF": (False, "reference images, footprint curves"),
    "TERRAIN": (True, "ground, sidewalks, curbs, plazas, roads, water"),
    "HERO": (True, "hand-modelled hero buildings, one child collection each"),
    "MID": (True, "procedural mid-ring buildings"),
    "FAR": (True, "extruded massing + skyline cards"),
    "PROPS": (True, "instanced street furniture"),
    "SLOTS": (True, "AD_/SHOP_ sellable slot meshes"),
    "LIGHTS": (True, "LIGHT_ emissive fixtures + PL_ light markers"),
    "COLLISION": (True, "COL_ proxies, exported separately"),
    "NAV": (True, "spawns, road/bike/ship/flight splines"),
    "LOOKDEV": (False, "review cameras and lighting rigs"),
}

OBJECT_PREFIXES = ("BLD_", "AD_", "SHOP_", "COL_", "LIGHT_", "PL_", "SPAWN_", "NAV_",
                   "TER_", "PROP_", "REF_", "CAM_", "RIG_", "FAR_", "MID_")

SLOT_SHAPES = ("flat", "curved", "wrap", "anamorphic")
SLOT_KINDS = ("billboard", "storefront", "rooftop")
SLOT_TIERS = ("hero", "premium", "standard")


# ----------------------------------------------------------------------------- config
def project_path(*parts):
    return os.path.join(PROJECT_ROOT, *parts)


def load_json(rel_path):
    with open(project_path(rel_path)) as f:
        return json.load(f)


def save_json(rel_path, data):
    path = project_path(rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def load_world():
    return load_json("config/world.json")


def load_district(district_id):
    return load_json(f"config/districts/{district_id}.json")


# ----------------------------------------------------------------------------- geo
def geo_to_local(lat, lon, anchor, rotation_deg=0.0):
    """Lat/lon -> local metres (x east-ish, y north-ish) on a tangent plane at `anchor`,
    then rotated CCW by `rotation_deg` so a city grid can be axis-aligned."""
    lat0, lon0 = anchor["lat"], anchor["lon"]
    x = math.radians(lon - lon0) * EARTH_R * math.cos(math.radians(lat0))
    y = math.radians(lat - lat0) * EARTH_R
    if rotation_deg:
        a = math.radians(rotation_deg)
        x, y = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
    return x, y


def district_projector(district):
    anchor, rot = district["geo_anchor"], district.get("grid_rotation_deg", 0.0)
    return lambda lat, lon: geo_to_local(lat, lon, anchor, rot)


def district_world_offset(district, world):
    """Offset of a geo-placed district's origin relative to the world origin (unrotated ENU)."""
    if district.get("placement") != "geo":
        return district.get("world_offset", [0.0, 0.0, 0.0])
    x, y = geo_to_local(district["geo_anchor"]["lat"], district["geo_anchor"]["lon"], world["world_origin"])
    return [x, y, 0.0]


# ----------------------------------------------------------------------------- blender
try:
    import bpy  # noqa: F401
    HAS_BPY = True
except ImportError:
    HAS_BPY = False


def coll_name(prefix, suffix):
    return f"{prefix}_{suffix}"


def ensure_collection(name, parent=None):
    import bpy
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if coll.name not in parent.children:
        parent.children.link(coll)
    return coll


def ensure_district_tree(prefix):
    """Create the fixed collection tree for a district. Returns {suffix: collection}."""
    import bpy
    root = ensure_collection(prefix)
    out = {"ROOT": root}
    for suffix, (exported, desc) in DISTRICT_COLLECTIONS.items():
        c = ensure_collection(coll_name(prefix, suffix), root)
        c["exported"] = exported
        c["description"] = desc
        out[suffix] = c
    # non-exported helpers stay visible but never render
    for suffix in ("REF", "LOOKDEV"):
        out[suffix].hide_render = True
    out["COLLISION"].hide_viewport = False
    return out


def link_only_to(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


def set_props(id_block, **props):
    for k, v in props.items():
        id_block[k] = v


def new_mesh_object(name, coll, verts, faces, **props):
    import bpy
    old = bpy.data.objects.get(name)
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    set_props(obj, **props)
    return obj


def get_material(name):
    """Fetch a library material by name (appended into this file). Raises if missing."""
    import bpy
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    lib = project_path("blender", "library", "materials.blend")
    with bpy.data.libraries.load(lib, link=False) as (src, dst):
        if name not in src.materials:
            raise KeyError(f"material {name} not in library")
        dst.materials = [name]
    return bpy.data.materials[name]


def refresh_library_materials():
    """Re-append every library material used in this file and remap users (after a library rebuild).
    Slot materials (MAT_SLOT_*) are per-slot copies and are left alone."""
    import bpy
    lib = project_path("blender", "library", "materials.blend")
    with bpy.data.libraries.load(lib, link=False) as (src, _):
        names = [n for n in src.materials if n in bpy.data.materials]
    if not names:
        return []
    old = {n: bpy.data.materials[n] for n in names}
    for m in old.values():
        m.name = m.name + "__old"
    with bpy.data.libraries.load(lib, link=False) as (src, dst):
        dst.materials = names
    for n, m in old.items():
        m.user_remap(bpy.data.materials[n])
        bpy.data.materials.remove(m)
    return names


def tri_count(obj):
    if obj.type != "MESH":
        return 0
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)
