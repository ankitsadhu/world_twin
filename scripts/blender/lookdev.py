"""Day / blue-hour / night lookdev rig. Review-only: lives in <PREFIX>_LOOKDEV, never exported.

set_time(tod) drives everything from one number (0 = noon, 1 = midnight):
  scene["tod"]  -> material emission via NG_TOD (windows, LED slots, street lights)
  world         -> blends day / blue-hour / night HDRIs
  sun           -> elevation + strength + colour
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402

HDRI = {"day": "wide_street_01_2k.hdr", "blue": "shanghai_riverside_2k.hdr", "night": "shanghai_bund_2k.hdr"}
WORLD_NAME = "W_Lookdev_TOD"
SUN_NAME = "RIG_Sun"


def _env(nt, key, loc):
    path = C.project_path("blender", "library", "hdri", HDRI[key])
    img = bpy.data.images.get(HDRI[key]) or bpy.data.images.load(path, check_existing=True)
    n = nt.nodes.new("ShaderNodeTexEnvironment")
    n.image = img
    n.location = loc
    n.label = key
    return n


def ensure_world():
    """One world with three HDRIs mixed by two factors (set from Python in set_time).

    HDRIs only *light* the scene; camera rays see a procedural sky (street-level HDRIs have their own
    ground at the horizon, which looks wrong over a city). The game mirrors this split at runtime.
    """
    w = bpy.data.worlds.get(WORLD_NAME)
    if w and "BG_Cam" in w.node_tree.nodes:
        return w
    if w:
        bpy.data.worlds.remove(w)
    w = bpy.data.worlds.new(WORLD_NAME)
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld"); out.location = (900, 0)
    bg = nt.nodes.new("ShaderNodeBackground"); bg.name = "BG"; bg.location = (700, 0)
    day, blue, night = _env(nt, "day", (0, 300)), _env(nt, "blue", (0, 0)), _env(nt, "night", (0, -300))
    m1 = nt.nodes.new("ShaderNodeMix"); m1.data_type = "RGBA"; m1.name = "MixDayBlue"; m1.location = (350, 150)
    m2 = nt.nodes.new("ShaderNodeMix"); m2.data_type = "RGBA"; m2.name = "MixBlueNight"; m2.location = (520, 0)
    nt.links.new(day.outputs["Color"], m1.inputs["A"])
    nt.links.new(blue.outputs["Color"], m1.inputs["B"])
    nt.links.new(m1.outputs["Result"], m2.inputs["A"])
    nt.links.new(night.outputs["Color"], m2.inputs["B"])
    nt.links.new(m2.outputs["Result"], bg.inputs["Color"])
    # camera-visible sky: physical sky by day, fading to a light-polluted Manhattan night sky
    sky = nt.nodes.new("ShaderNodeTexSky"); sky.name = "Sky"; sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_disc = False; sky.location = (0, -600)
    grad_coord = nt.nodes.new("ShaderNodeTexCoord"); grad_coord.location = (-400, -900)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); sep.location = (-200, -900)
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.name = "NightRamp"; ramp.location = (0, -900)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.055, 0.035, 0.05, 1)    # orange-purple glow at horizon
    ramp.color_ramp.elements[1].position = 0.35
    ramp.color_ramp.elements[1].color = (0.004, 0.006, 0.016, 1)   # deep blue overhead
    m3 = nt.nodes.new("ShaderNodeMix"); m3.data_type = "RGBA"; m3.name = "MixSkyNight"; m3.location = (350, -700)
    bgc = nt.nodes.new("ShaderNodeBackground"); bgc.name = "BG_Cam"; bgc.location = (550, -600)
    lp = nt.nodes.new("ShaderNodeLightPath"); lp.location = (500, 300)
    ms = nt.nodes.new("ShaderNodeMixShader"); ms.location = (800, 0)
    nt.links.new(grad_coord.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(sky.outputs["Color"], m3.inputs["A"])
    nt.links.new(ramp.outputs["Color"], m3.inputs["B"])
    nt.links.new(m3.outputs["Result"], bgc.inputs["Color"])
    nt.links.new(lp.outputs["Is Camera Ray"], ms.inputs["Fac"])
    nt.links.new(bg.outputs["Background"], ms.inputs[1])
    nt.links.new(bgc.outputs["Background"], ms.inputs[2])
    out.location = (1000, 0)
    nt.links.new(ms.outputs["Shader"], out.inputs["Surface"])
    return w


def ensure_sun(coll):
    sun = bpy.data.objects.get(SUN_NAME)
    if sun is None:
        sun = bpy.data.objects.new(SUN_NAME, bpy.data.lights.new(SUN_NAME, "SUN"))
        coll.objects.link(sun)
    sun.data.angle = math.radians(0.53)
    return sun


def _smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def set_time(tod, prefix="TS"):
    scene = bpy.context.scene
    scene["tod"] = float(tod)
    for vl in scene.view_layers:  # NG_TOD reads view layer first
        vl["tod"] = float(tod)
    coll = bpy.data.collections.get(f"{prefix}_LOOKDEV") or scene.collection
    w = ensure_world()
    scene.world = w
    nt = w.node_tree
    to_blue = _smooth(0.25, 0.55, tod)
    to_night = _smooth(0.55, 0.8, tod)
    nt.nodes["MixDayBlue"].inputs["Factor"].default_value = to_blue
    nt.nodes["MixBlueNight"].inputs["Factor"].default_value = to_night
    nt.nodes["BG"].inputs["Strength"].default_value = 1.0 - 0.75 * to_night
    sun = ensure_sun(coll)
    # Sun elevation: 62 deg at noon -> -5 deg at tod 0.65 (below horizon after). Azimuth SSW over the grid.
    elev = math.radians(62 - 103 * min(tod, 0.65))
    azim = math.radians(200 + 60 * tod)
    sun.rotation_euler = (math.pi / 2 - elev, 0, azim)
    sun.data.energy = max(0.0, 4.5 * (1 - _smooth(0.35, 0.62, tod)))
    warm = _smooth(0.2, 0.55, tod)
    sun.data.color = (1.0, 1.0 - 0.25 * warm, 1.0 - 0.5 * warm)
    sun.hide_render = sun.data.energy <= 0.0
    sky = nt.nodes["Sky"]
    sky.sun_elevation = max(elev, math.radians(-4))
    sky.sun_rotation = azim
    nt.nodes["MixSkyNight"].inputs["Factor"].default_value = _smooth(0.5, 0.75, tod)
    nt.nodes["BG_Cam"].inputs["Strength"].default_value = 0.35 * (1 - to_night) + 1.0 * to_night
    glow = _smooth(0.45, 0.8, tod)  # screen glow area lights only matter after dusk
    for o in bpy.data.objects:
        if o.name.startswith("GLOW_") and o.type == "LIGHT":
            o.hide_render = glow < 0.05
            o.data["base_energy"] = o.data.get("base_energy", o.data.energy)
            o.data.energy = o.data["base_energy"] * glow
    for m in bpy.data.materials:  # force emission re-evaluation in viewport
        m.update_tag()
    return {"tod": tod, "sun_energy": sun.data.energy, "to_blue": to_blue, "to_night": to_night}


def setup_render(scene=None):
    scene = scene or bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    ee = scene.eevee
    for attr, val in (("use_raytracing", True), ("use_shadows", True), ("use_bloom", True),
                      ("taa_render_samples", 64), ("use_fast_gi", True)):
        if hasattr(ee, attr):
            setattr(ee, attr, val)
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.render.film_transparent = False
