"""Build blender/library/materials.blend: the single source of truth for all city materials.

Rules that keep materials glTF-exportable:
  * Principled BSDF only; image textures wired straight into its sockets (no mapping nodes).
    Tiling is done in the UVs: every generator scales UVs by the material's `tile_m` property.
  * Packed ORM image (R=AO, G=rough, B=metal) through Separate Color, which the exporter understands.
  * Day/night: Emission Strength is driven by node group NG_TOD, which reads the `tod` custom property
    from the view layer / scene / world (Attribute node, type VIEW_LAYER). No drivers, no ID pointers,
    so materials append cleanly into any district. export_district.py freezes it to a constant.

Run inside Blender via run.py (sets __file__), or: blender -b -P build_library_materials.py
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402

LIB_DIR = C.project_path("blender", "library")
TEX = os.path.join(LIB_DIR, "textures")
GEN = os.path.join(TEX, "gen")


# ----------------------------------------------------------------------------- helpers
def load_image(path, non_color=False):
    name = os.path.basename(path)
    img = bpy.data.images.get(name) or bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return img


def new_material(name, **props):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (250, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    for k, v in props.items():
        mat[k] = v
    return mat, nt, bsdf


def tex_node(nt, img, loc, label=None):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    n.location = loc
    n.label = label or img.name
    return n


def ng_tod():
    """Node group: reads `tod` (0 noon .. 1 midnight) -> Night factor, Day factor (smooth)."""
    ng = bpy.data.node_groups.get("NG_TOD")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("NG_TOD", "ShaderNodeTree")
    ng.interface.new_socket("Night", in_out="OUTPUT", socket_type="NodeSocketFloat")
    ng.interface.new_socket("Day", in_out="OUTPUT", socket_type="NodeSocketFloat")
    n = ng.nodes
    out = n.new("NodeGroupOutput"); out.location = (600, 0)
    attr = n.new("ShaderNodeAttribute"); attr.attribute_type = "VIEW_LAYER"; attr.attribute_name = "tod"
    attr.location = (-400, 0)
    rng = n.new("ShaderNodeMapRange"); rng.interpolation_type = "SMOOTHSTEP"; rng.location = (-100, 0)
    rng.inputs["From Min"].default_value = 0.45
    rng.inputs["From Max"].default_value = 0.8
    inv = n.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
    inv.location = (250, -150)
    ng.links.new(attr.outputs["Fac"], rng.inputs["Value"])
    ng.links.new(rng.outputs["Result"], out.inputs["Night"])
    ng.links.new(rng.outputs["Result"], inv.inputs[1])
    ng.links.new(inv.outputs[0], out.inputs["Day"])
    return ng


def tod_strength(nt, bsdf, night, day, loc=(-250, -650)):
    """Emission Strength = day*Day + night*Night (via NG_TOD). Frozen to `night` on export."""
    g = nt.nodes.new("ShaderNodeGroup"); g.node_tree = ng_tod(); g.location = loc; g.label = "TOD"
    m1 = nt.nodes.new("ShaderNodeMath"); m1.operation = "MULTIPLY"; m1.inputs[1].default_value = night
    m2 = nt.nodes.new("ShaderNodeMath"); m2.operation = "MULTIPLY"; m2.inputs[1].default_value = day
    add = nt.nodes.new("ShaderNodeMath"); add.operation = "ADD"
    m1.location, m2.location, add.location = (loc[0] + 180, loc[1]), (loc[0] + 180, loc[1] - 160), (loc[0] + 360, loc[1])
    nt.links.new(g.outputs["Night"], m1.inputs[0])
    nt.links.new(g.outputs["Day"], m2.inputs[0])
    nt.links.new(m1.outputs[0], add.inputs[0])
    nt.links.new(m2.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], bsdf.inputs["Emission Strength"])
    nt.nodes.active = bsdf
    # tag so the exporter knows what constant to freeze to
    bsdf["tod_export_strength"] = night


# ----------------------------------------------------------------------------- material families
def pbr(name, tex_id, tile_m, family, rough_scale=None, normal_strength=1.0, metallic=0.0):
    mat, nt, bsdf = new_material(name, tile_m=tile_m, family=family, source=f"polyhaven:{tex_id}")
    d = tex_node(nt, load_image(f"{TEX}/{tex_id}_diff_2k.jpg"), (-500, 250), "BaseColor")
    r = tex_node(nt, load_image(f"{TEX}/{tex_id}_rough_2k.jpg", True), (-500, -50), "Roughness")
    n = tex_node(nt, load_image(f"{TEX}/{tex_id}_nor_gl_2k.jpg", True), (-500, -350), "Normal")
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-150, -350)
    nm.inputs["Strength"].default_value = normal_strength
    nt.links.new(d.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def flat(name, color, rough, family, metallic=0.0, emission=None, night=0.0, day=0.0):
    mat, nt, bsdf = new_material(name, tile_m=1.0, family=family)
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        tod_strength(nt, bsdf, night, day)
    return mat


def curtain_glass(name, tint, family="glass"):
    """Curtain wall atlas: 16 bays x 8 floors per UV tile (24 m x 32 m). Night = lit offices."""
    mat, nt, bsdf = new_material(name, tile_m=[24.0, 32.0], family=family)
    d = tex_node(nt, load_image(f"{GEN}/curtain_glass_diff.png"), (-700, 300), "BaseColor")
    orm = tex_node(nt, load_image(f"{GEN}/curtain_glass_orm.png", True), (-700, 0), "ORM")
    e = tex_node(nt, load_image(f"{GEN}/curtain_glass_emit.png"), (-700, -300), "NightWindows")
    tintn = nt.nodes.new("ShaderNodeMix"); tintn.data_type = "RGBA"; tintn.blend_type = "MULTIPLY"
    tintn.inputs["Factor"].default_value = 1.0
    tintn.inputs["B"].default_value = (*tint, 1)
    tintn.location = (-300, 300)
    sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-300, 0)
    nt.links.new(d.outputs["Color"], tintn.inputs["A"])
    nt.links.new(tintn.outputs["Result"], bsdf.inputs["Base Color"])
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nt.links.new(e.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Specular IOR Level"].default_value = 0.6
    tod_strength(nt, bsdf, night=1.0, day=0.0)
    return mat


def masonry_facade(name, atlas):
    """Punched-window masonry atlas: 8 bays x 4 floors per UV tile (16 m x 16 m). Night = lit rooms."""
    mat, nt, bsdf = new_material(name, tile_m=[16.0, 16.0], family="facade")
    d = tex_node(nt, load_image(f"{GEN}/{atlas}_diff.jpg"), (-700, 300), "BaseColor")
    orm = tex_node(nt, load_image(f"{GEN}/{atlas}_orm.jpg", True), (-700, 0), "ORM")
    n = tex_node(nt, load_image(f"{GEN}/{atlas}_nrm.jpg", True), (-700, -300), "Normal")
    e = tex_node(nt, load_image(f"{GEN}/{atlas}_emit.jpg"), (-700, -600), "NightWindows")
    sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-300, 0)
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-300, -300)
    nt.links.new(d.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(e.outputs["Color"], bsdf.inputs["Emission Color"])
    tod_strength(nt, bsdf, night=1.4, day=0.0)
    return mat


def storefront():
    """Ground-floor retail atlas: 4 variant rows of 16 m x 4.5 m. UV v = variant*0.25 + z/18."""
    mat, nt, bsdf = new_material("M_Storefront", tile_m=[16.0, 18.0], family="facade", rows=4, row_height_m=4.5)
    d = tex_node(nt, load_image(f"{GEN}/storefront_diff.jpg"), (-700, 300), "BaseColor")
    orm = tex_node(nt, load_image(f"{GEN}/storefront_orm.jpg", True), (-700, 0), "ORM")
    e = tex_node(nt, load_image(f"{GEN}/storefront_emit.jpg"), (-700, -300), "Interiors")
    sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-300, 0)
    nt.links.new(d.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nt.links.new(e.outputs["Color"], bsdf.inputs["Emission Color"])
    tod_strength(nt, bsdf, night=1.8, day=0.35)   # shops are lit in daytime too
    return mat


def shop_sign():
    """Indexed sign slots: same atlas as M_Storefront so unsold signs look identical, but a separate
    material so the game can swap its shader for an atlas lookup by the per-vertex _SLOT index."""
    old = bpy.data.materials.get("M_ShopSign")
    if old:
        bpy.data.materials.remove(old)
    mat = bpy.data.materials["M_Storefront"].copy()   # storefront() is built first in build()
    mat.name = "M_ShopSign"
    mat["family"] = "sign_slot"
    mat["is_sign_slot"] = True
    return mat


def wood_watertower():
    mat, nt, bsdf = new_material("M_Wood_WaterTower", tile_m=2.0, family="wood")
    d = tex_node(nt, load_image(f"{GEN}/watertower_wood_diff.jpg"), (-500, 200), "BaseColor")
    nt.links.new(d.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    return mat


def car_paint(name, color, metallic=0.0):
    """Automotive paint: base + clearcoat (exports as KHR_materials_clearcoat)."""
    mat, nt, bsdf = new_material(name, tile_m=1.0, family="vehicle")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = 0.32
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.03
    return mat


def car_glass():
    """Tinted auto glass: see-through so the interior reads (KHR_materials_transmission)."""
    mat, nt, bsdf = new_material("M_Car_Glass", tile_m=1.0, family="vehicle")
    bsdf.inputs["Base Color"].default_value = (0.12, 0.14, 0.15, 1)
    bsdf.inputs["Roughness"].default_value = 0.02
    bsdf.inputs["Transmission Weight"].default_value = 0.85
    bsdf.inputs["IOR"].default_value = 1.5
    return mat


def flag_us():
    mat, nt, bsdf = new_material("M_Flag_US", tile_m=1.0, family="cloth")
    d = tex_node(nt, load_image(f"{GEN}/us_flag.png"), (-500, 200), "Flag")
    nt.links.new(d.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    return mat


def street_signs():
    """Atlas of green NYC street-name blades; layout in textures/gen/street_signs.json."""
    mat, nt, bsdf = new_material("M_StreetSigns", tile_m=1.0, family="sign")
    d = tex_node(nt, load_image(f"{GEN}/street_signs.png"), (-500, 200), "Signs")
    nt.links.new(d.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.35
    return mat


def floodlit_stone(name, atlas):
    """Masonry atlas that is floodlit at night (crowns like the Paramount): stone glows warm after dusk."""
    mat = masonry_facade(name, atlas)
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    diff = next(n for n in nt.nodes if n.type == "TEX_IMAGE" and n.label == "BaseColor")
    warm = nt.nodes.new("ShaderNodeMix")
    warm.data_type = "RGBA"
    warm.blend_type = "MULTIPLY"
    warm.inputs["Factor"].default_value = 1.0
    warm.inputs["B"].default_value = (1.0, 0.62, 0.3, 1)
    for link in list(bsdf.inputs["Emission Color"].links):
        nt.links.remove(link)
    nt.links.new(diff.outputs["Color"], warm.inputs["A"])
    nt.links.new(warm.outputs["Result"], bsdf.inputs["Emission Color"])
    for link in list(bsdf.inputs["Emission Strength"].links):
        nt.links.remove(link)
    tod_strength(nt, bsdf, night=0.55, day=0.0)
    mat["family"] = "facade_floodlit"
    return mat


def led_slot_template():
    """Template for every sellable screen. slots_tool.py copies it per slot and swaps the image."""
    mat, nt, bsdf = new_material("M_LED_SlotTemplate", tile_m=1.0, family="led", is_slot_template=True)
    art = tex_node(nt, load_image(f"{GEN}/slot_placeholder_16x9.png"), (-500, -250), "SlotArt")
    bsdf.inputs["Base Color"].default_value = (0.01, 0.01, 0.012, 1)
    bsdf.inputs["Roughness"].default_value = 0.35
    nt.links.new(art.outputs["Color"], bsdf.inputs["Emission Color"])
    # LED walls read bright at noon and must not blow out at night
    tod_strength(nt, bsdf, night=2.2, day=7.0)
    return mat


def tkts_red_glass():
    mat, nt, bsdf = new_material("M_Glass_TKTSRed", tile_m=1.0, family="glass")
    bsdf.inputs["Base Color"].default_value = (0.42, 0.05, 0.04, 1)    # matte terracotta-red by day
    bsdf.inputs["Roughness"].default_value = 0.38
    bsdf.inputs["Transmission Weight"].default_value = 0.15
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.012, 0.015, 1)   # saturated: AgX turns hot reds pink
    tod_strength(nt, bsdf, night=1.1, day=0.15)
    return mat


def build():
    bpy.context.scene["tod"] = 0.0
    mats = [
        # ground
        pbr("M_Road_Asphalt", "asphalt_02", 3.0, "ground"),
        pbr("M_Sidewalk_Concrete", "concrete_pavement", 1.8, "ground"),
        pbr("M_Curb_Granite", "granite_tile", 2.3, "ground"),
        flat("M_Road_PaintWhite", (0.78, 0.78, 0.76), 0.55, "ground"),
        flat("M_Road_PaintYellow", (0.85, 0.62, 0.05), 0.55, "ground"),
        flat("M_Water_Hudson", (0.015, 0.035, 0.04), 0.06, "water"),
        # masonry facades
        pbr("M_Brick_Red", "red_brick_03", 1.0, "masonry"),
        pbr("M_Brick_Buff", "yellow_brick", 2.0, "masonry"),
        pbr("M_Stone_Limestone", "white_sandstone_bricks_03", 2.0, "masonry"),
        pbr("M_Stone_GraniteDark", "granite_tile", 2.3, "masonry"),
        masonry_facade("M_Facade_BrickRed", "facade_brick_red"),
        masonry_facade("M_Facade_BrickBuff", "facade_brick_buff"),
        masonry_facade("M_Facade_Limestone", "facade_limestone"),
        floodlit_stone("M_Facade_Limestone_Floodlit", "facade_limestone"),
        storefront(),
        shop_sign(),
        wood_watertower(),
        # glass / metal
        curtain_glass("M_Glass_CurtainDark", (1.0, 1.0, 1.0)),
        curtain_glass("M_Glass_CurtainBlue", (0.55, 0.75, 1.0)),
        curtain_glass("M_Glass_CurtainGreen", (0.6, 0.9, 0.8)),
        pbr("M_Metal_Steel", "metal_plate", 0.5, "metal", metallic=1.0),
        flat("M_Metal_Aluminium", (0.75, 0.76, 0.78), 0.3, "metal", metallic=1.0),
        flat("M_Paint_Black", (0.02, 0.02, 0.022), 0.45, "paint"),
        flat("M_Paint_DarkGrey", (0.06, 0.065, 0.07), 0.5, "paint"),
        flat("M_Roof_Membrane", (0.18, 0.18, 0.18), 0.9, "roof"),
        tkts_red_glass(),
        # emissive fixtures
        flat("M_Light_StreetWarm", (0.9, 0.9, 0.85), 0.3, "light", emission=(1.0, 0.78, 0.5), night=12.0, day=0.0),
        flat("M_Light_StoreSign", (0.9, 0.9, 0.9), 0.3, "light", emission=(1.0, 1.0, 1.0), night=5.0, day=1.5),
        # street furniture / vehicles
        flat("M_Paint_SignalYellow", (0.75, 0.55, 0.04), 0.45, "paint"),
        flat("M_Paint_NYCGreen", (0.02, 0.12, 0.06), 0.5, "paint"),
        flat("M_Paint_HydrantRed", (0.45, 0.04, 0.03), 0.4, "paint"),
        flat("M_Paint_TaxiYellow", (0.85, 0.6, 0.02), 0.22, "paint"),
        flat("M_Glass_Car", (0.01, 0.012, 0.015), 0.05, "glass"),
        flat("M_Rubber", (0.02, 0.02, 0.02), 0.85, "paint"),
        flat("M_Bronze", (0.25, 0.16, 0.08), 0.35, "metal", metallic=1.0),
        flat("M_Plant_Green", (0.04, 0.12, 0.03), 0.8, "plant"),
        flat("M_Light_SignalRed", (0.2, 0.0, 0.0), 0.2, "light", emission=(1.0, 0.05, 0.02), night=12.0, day=8.0),
        flat("M_Light_SignalGreen", (0.0, 0.15, 0.08), 0.2, "light", emission=(0.1, 1.0, 0.45), night=12.0, day=8.0),
        flat("M_Light_SignalOff", (0.03, 0.03, 0.03), 0.15, "light"),
        flat("M_Light_WalkHand", (0.2, 0.08, 0.0), 0.2, "light", emission=(1.0, 0.45, 0.05), night=8.0, day=5.0),
        flat("M_Light_SubwayGreen", (0.1, 0.4, 0.15), 0.2, "light", emission=(0.2, 1.0, 0.35), night=6.0, day=1.0),
        flat("M_Light_Headlight", (0.9, 0.9, 0.9), 0.1, "light", emission=(1.0, 0.95, 0.85), night=10.0, day=0.5),
        flat("M_Light_Taillight", (0.3, 0.0, 0.0), 0.2, "light", emission=(1.0, 0.02, 0.02), night=6.0, day=0.6),
        street_signs(),
        flag_us(),
        # vehicles (glTF: clearcoat + transmission extensions are exported)
        car_paint("M_Car_Paint_TaxiYellow", (0.93, 0.5, 0.0)),   # NYC cab yellow (amber, not lemon)
        car_paint("M_Car_Paint_White", (0.85, 0.86, 0.87)),
        car_paint("M_Car_Paint_Black", (0.02, 0.02, 0.025)),
        car_paint("M_Car_Paint_Silver", (0.55, 0.56, 0.58), metallic=0.8),
        car_paint("M_Car_Paint_Blue", (0.03, 0.08, 0.25), metallic=0.5),
        car_paint("M_Car_Paint_Red", (0.45, 0.02, 0.02), metallic=0.3),
        flat("M_Car_TrimBlack", (0.015, 0.015, 0.017), 0.55, "vehicle"),
        flat("M_Car_Chrome", (0.9, 0.9, 0.92), 0.08, "vehicle", metallic=1.0),
        car_glass(),
        flat("M_Car_InteriorFabric", (0.06, 0.06, 0.065), 0.9, "vehicle"),
        flat("M_Car_InteriorPlastic", (0.025, 0.025, 0.028), 0.6, "vehicle"),
        flat("M_Car_Tire", (0.018, 0.018, 0.018), 0.92, "vehicle"),
        flat("M_Car_Rim", (0.62, 0.63, 0.65), 0.25, "vehicle", metallic=1.0),
        flat("M_Car_Plate", (0.85, 0.82, 0.6), 0.4, "vehicle"),
        flat("M_Light_Turn", (0.3, 0.15, 0.0), 0.2, "light", emission=(1.0, 0.45, 0.0), night=2.0, day=0.3),
        flat("M_Light_TaxiTop", (0.9, 0.9, 0.85), 0.3, "light", emission=(1.0, 0.95, 0.8), night=4.0, day=1.2),
        led_slot_template(),
    ]
    for m in mats:
        m.asset_mark()
        m.asset_data.tags.new(m.get("family", "misc"), skip_if_exists=True)
        m.asset_generate_preview()
    return [m.name for m in mats]


def main():
    bpy.ops.wm.read_homefile(use_empty=True)
    names = build()
    os.makedirs(LIB_DIR, exist_ok=True)
    path = os.path.join(LIB_DIR, "materials.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, relative_remap=True)
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_mainfile()
    return {"saved": path, "materials": names}


result = main()
