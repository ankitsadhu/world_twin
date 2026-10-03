"""Hero: Duffy Square: TKTS red steps + booth, Father Duffy statue & Celtic cross, George M. Cohan statue.

References (recent Instagram/Commons photos): 27 glowing red glass treads rising to the NORTH (people sit
facing south toward One Times Square), stainless handrails on both sides + two centre rails, glass side
balustrades, the ticket booth tucked under the high north end with its windows facing north, a zig-zag
red-rope queue in front of it, Father Duffy (bronze, granite pedestal, tall Celtic cross behind) just
north of the queue, George M. Cohan statue at the 46th St end, red vertical "tkts" banners on poles.
"""
import math
import os
import sys

import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import ts_common as C  # noqa: E402
import hero_common as H  # noqa: E402

OBJ = "BLD_TS_TKTSDuffySquare"
CX = -20.6                     # steps centre line (x), from the booth footprint (BIN 1085637)
Y0, N_STEPS, RISE, TREAD = 121.5, 27, 0.18, 0.62
W = 15.0                       # steps width
Y1 = Y0 + N_STEPS * TREAD      # top (north) edge
TOP = N_STEPS * RISE           # ~4.9 m
GROUND = 0.16                  # plaza surface height
MATS = ["M_Glass_TKTSRed", "M_Metal_Aluminium", "M_Car_Glass", "M_Paint_Black", "M_Stone_GraniteDark",
        "M_Bronze", "M_Light_StoreSign", "M_Paint_HydrantRed", "M_Metal_Steel", "M_Glass_CurtainDark", "M_Flag_US"]
FONT = "/System/Library/Fonts/Avenir Next.ttc"


def box(bm, i, c, s, rot=Matrix()):
    m = Matrix.Translation(c) @ rot @ Matrix.Diagonal((*s, 1))
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    for f in {f for v in r["verts"] for f in v.link_faces}:
        f.material_index = i
    return r


def cyl(bm, i, c, r, h, rot=Matrix(), segs=12, r2=None, smooth=True):
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r2 if r2 is not None else r,
                                depth=h, matrix=Matrix.Translation(c) @ rot)
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = i
        f.smooth = smooth


def sphere(bm, i, c, r, sub=2):
    res = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r, matrix=Matrix.Translation(c))
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = i
        f.smooth = True


def rail(bm, i, a, b, r=0.025):
    a, b = Vector(a), Vector(b)
    d = b - a
    rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    cyl(bm, i, (a + b) / 2, r, d.length, rot=rot, segs=8)


def figure(bm, i, base, height, facing_deg, robe=True, hat=False, coat=False):
    """Simplified standing bronze figure (reads correctly at plaza distance).
    coat=True: WWI chaplain in a knee-length trench coat with a helmet at his feet (Father Duffy)."""
    x, y, z = base
    rot = Matrix.Rotation(math.radians(facing_deg), 4, "Z")
    s = height / 1.85

    def P(dx, dy, dz):
        return Vector((x, y, z)) + rot @ Vector((dx * s, dy * s, dz * s))
    if coat:
        for dx in (-0.1, 0.1):                                                       # boots / legs
            cyl(bm, i, P(dx, 0, 0.27), 0.075 * s, 0.54 * s, segs=8)
        cyl(bm, i, P(0, 0, 0.82), 0.29 * s, 0.62 * s, segs=14, r2=0.22 * s)        # trench coat skirt
        box(bm, i, P(0, 0.0, 0.98), (0.47 * s, 0.29 * s, 0.07 * s), rot)            # belt
        sphere(bm, i, P(0.28, 0.12, 0.08), 0.13 * s, 1)                              # helmet at his feet
    elif robe:
        cyl(bm, i, P(0, 0, 0.5), 0.30 * s, 1.0 * s, segs=14, r2=0.21 * s)          # cassock / coat skirt
    else:
        for dx in (-0.1, 0.1):
            cyl(bm, i, P(dx, 0, 0.45), 0.08 * s, 0.9 * s, segs=8)
    box(bm, i, P(0, 0, 1.22), (0.44 * s, 0.26 * s, 0.6 * s), rot)                    # torso
    sphere(bm, i, P(0, 0, 1.66), 0.13 * s)                                           # head
    for dx, ang in ((-0.27, 12), (0.27, -12)):                                       # arms
        r = rot @ Matrix.Rotation(math.radians(ang), 4, "Y")
        cyl(bm, i, P(dx, 0.04, 1.2), 0.065 * s, 0.62 * s, rot=r, segs=8)
    if hat:
        cyl(bm, i, P(0, 0, 1.79), 0.17 * s, 0.03 * s, segs=14)
        cyl(bm, i, P(0, 0, 1.84), 0.11 * s, 0.1 * s, segs=14)


def run():
    tree = C.ensure_district_tree("TS")
    coll = C.ensure_collection("TS_HERO_DuffySquare", tree["HERO"])
    H.retire_blockout("BLD_TS_1085637")          # the booth's footprint in NYC data
    i = MATS.index
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")

    # ---- red glass steps: tread + riser per step, steel frame beneath
    for k in range(N_STEPS):
        y = Y0 + k * TREAD
        z = GROUND + (k + 1) * RISE
        box(bm, i("M_Glass_TKTSRed"), (CX, y + TREAD / 2, z - 0.025), (W, TREAD, 0.05))       # tread
        box(bm, i("M_Glass_TKTSRed"), (CX, y + 0.01, z - RISE / 2), (W, 0.02, RISE))          # riser
        box(bm, i("M_Metal_Aluminium"), (CX, y + 0.03, z + 0.002), (W, 0.05, 0.012))          # light nosing
    # solid underside / side cheeks (sloped) in dark steel
    slope = math.atan2(TOP, Y1 - Y0)
    L = math.hypot(TOP, Y1 - Y0)
    rot = Matrix.Rotation(slope, 4, "X")
    for sx in (-1, 1):
        box(bm, i("M_Paint_Black"), (CX + sx * (W / 2 + 0.15), (Y0 + Y1) / 2, GROUND + TOP / 2 - 0.2),
            (0.3, L, 0.5), rot)
        # glass balustrade + stainless handrail following the slope
        box(bm, i("M_Car_Glass"), (CX + sx * (W / 2 + 0.32), (Y0 + Y1) / 2, GROUND + TOP / 2 + 0.55),
            (0.03, L, 1.0), rot)
        rail(bm, i("M_Metal_Aluminium"), (CX + sx * (W / 2 + 0.32), Y0 - 0.3, GROUND + 1.05),
             (CX + sx * (W / 2 + 0.32), Y1, GROUND + TOP + 1.05), r=0.03)
    for dx in (-W / 6, W / 6):  # two centre handrails on posts
        rail(bm, i("M_Metal_Aluminium"), (CX + dx, Y0 - 0.3, GROUND + 0.95), (CX + dx, Y1 - 0.4, GROUND + TOP + 0.95))
        for k in range(0, N_STEPS, 4):
            y = Y0 + k * TREAD + 0.3
            z = GROUND + (k + 1) * RISE
            rail(bm, i("M_Metal_Aluminium"), (CX + dx, y, z), (CX + dx, y, z + 0.95 + 0.0), r=0.025)
    # top landing + rear glass parapet
    box(bm, i("M_Glass_TKTSRed"), (CX, Y1 + 0.6, GROUND + TOP - 0.03), (W, 1.2, 0.06))
    box(bm, i("M_Car_Glass"), (CX, Y1 + 1.2, GROUND + TOP + 0.55), (W + 0.6, 0.03, 1.1))
    rail(bm, i("M_Metal_Aluminium"), (CX - W / 2, Y1 + 1.2, GROUND + TOP + 1.1), (CX + W / 2, Y1 + 1.2, GROUND + TOP + 1.1), 0.03)

    # ---- ticket booth under the high north end, windows facing north
    by0 = Y1 - 7.0
    box(bm, i("M_Glass_CurtainDark"), (CX, (by0 + Y1) / 2 + 0.6, GROUND + 1.6), (W - 1.0, Y1 - by0, 3.2))
    for k in range(6):  # ticket windows (lit) along the north face
        x = CX - W / 2 + 1.6 + k * (W - 3.2) / 5
        box(bm, i("M_Light_StoreSign"), (x, Y1 + 1.12, GROUND + 1.55), (1.3, 0.04, 1.0))
        box(bm, i("M_Paint_Black"), (x, Y1 + 1.2, GROUND + 0.95), (1.5, 0.3, 0.08))           # counter
    box(bm, i("M_Paint_HydrantRed"), (CX, Y1 + 1.18, GROUND + 2.55), (W - 1.4, 0.06, 0.55))    # red fascia
    H.lettering(bm, "tkts", i("M_Light_StoreSign"), (CX, Y1 + 1.24, GROUND + 2.33), 0.0, 0.5, depth=0.04,
                font_path=FONT)

    # ---- queue: chrome stanchions + red ropes, three zig-zag lanes north of the windows
    for lane in range(4):
        y = Y1 + 3.0 + lane * 1.4
        xs = [CX - W / 2 + 1.0 + k * 2.2 for k in range(7)]
        for x in xs:
            cyl(bm, i("M_Metal_Aluminium"), (x, y, GROUND + 0.5), 0.03, 1.0, segs=8)
            cyl(bm, i("M_Metal_Aluminium"), (x, y, GROUND + 0.01), 0.17, 0.02, segs=12)
        for x0, x1 in zip(xs, xs[1:]):
            rail(bm, i("M_Paint_HydrantRed"), (x0, y, GROUND + 0.9), (x1, y, GROUND + 0.85), r=0.02)

    # ---- Father Duffy at the SOUTH foot of the steps, facing south, big Celtic cross right behind him
    dx, dy = CX, Y0 - 4.6
    box(bm, i("M_Stone_GraniteDark"), (dx, dy, GROUND + 0.15), (2.6, 2.6, 0.3))
    box(bm, i("M_Stone_GraniteDark"), (dx, dy, GROUND + 1.05), (1.7, 1.7, 1.5))
    H.lettering(bm, "FATHER DUFFY", i("M_Stone_GraniteDark"), (dx, dy - 0.87, GROUND + 1.25), math.pi, 0.17,
                depth=0.02, font_path=FONT)
    figure(bm, i("M_Bronze"), (dx, dy, GROUND + 1.8), 2.5, 180, robe=False, coat=True)
    cy_ = dy + 1.15                                       # cross slab stands between statue and steps
    box(bm, i("M_Stone_GraniteDark"), (dx, cy_, GROUND + 3.1), (1.25, 0.45, 6.2))                 # shaft
    box(bm, i("M_Stone_GraniteDark"), (dx, cy_, GROUND + 4.55), (3.1, 0.45, 1.1))                 # arms
    for k in range(20):  # ring: the four round voids show between ring, shaft and arms
        a0, a1 = 2 * math.pi * k / 20, 2 * math.pi * (k + 1) / 20
        rr = 1.12
        p0 = Vector((dx + rr * math.cos(a0), cy_, GROUND + 4.55 + rr * math.sin(a0)))
        p1 = Vector((dx + rr * math.cos(a1), cy_, GROUND + 4.55 + rr * math.sin(a1)))
        dd = p1 - p0
        box(bm, i("M_Stone_GraniteDark"), (p0 + p1) / 2, (dd.length + 0.06, 0.42, 0.28),
            Matrix.Rotation(-math.atan2(dd.z, dd.x), 4, "Y"))
    # ---- US flag on a tall pole in the plaza south of the steps (photo + user's night video)
    fx, fy = CX + 7.0, Y0 - 24.0
    cyl(bm, i("M_Paint_Black"), (fx, fy, GROUND + 0.4), 0.45, 0.8, segs=12)
    cyl(bm, i("M_Metal_Aluminium"), (fx, fy, GROUND + 9.4), 0.11, 17.2, segs=12, r2=0.06)
    sphere(bm, i("M_Metal_Aluminium"), (fx, fy, GROUND + 18.1), 0.16, 1)
    fw, fh, cols = 3.4, 1.8, 12
    for side, off in ((0, 0.0), (1, 0.006)):           # two sheets 6 mm apart = double-sided cloth
        verts = []
        for cidx in range(cols + 1):
            u = cidx / cols
            wave = 0.18 * math.sin(u * 5.5) * u + off
            verts.append((bm.verts.new((fx + 0.12 + u * fw, fy + wave, GROUND + 17.6 - fh)),
                          bm.verts.new((fx + 0.12 + u * fw, fy + wave, GROUND + 17.6))))
        for cidx in range(cols):
            (a, b), (c, d) = verts[cidx], verts[cidx + 1]
            quad = (a, c, d, b) if side == 0 else (b, d, c, a)
            f = bm.faces.new(quad)
            f.material_index = i("M_Flag_US")
            f.smooth = True
            u0, u1 = cidx / cols, (cidx + 1) / cols
            uvs = ((u0, 0), (u1, 0), (u1, 1), (u0, 1)) if side == 0 else ((u0, 1), (u1, 1), (u1, 0), (u0, 0))
            for loop, uv in zip(f.loops, uvs):
                loop[uvl].uv = uv
    # ---- George M. Cohan at the 46th St end, facing south down Broadway
    gx, gy = -16.0, 86.0
    box(bm, i("M_Stone_GraniteDark"), (gx, gy, GROUND + 0.9), (1.6, 1.6, 1.8))
    figure(bm, i("M_Bronze"), (gx, gy, GROUND + 1.8), 2.4, 180, robe=False, hat=True)

    # ---- red "tkts" banners on poles at the four corners of the steps
    for bx, byy in ((CX - W / 2 - 1.5, Y0 - 1.5), (CX + W / 2 + 1.5, Y0 - 1.5),
                    (CX - W / 2 - 1.5, Y1 + 2.0), (CX + W / 2 + 1.5, Y1 + 2.0)):
        cyl(bm, i("M_Metal_Aluminium"), (bx, byy, GROUND + 3.2), 0.07, 6.4, segs=10)
        box(bm, i("M_Paint_HydrantRed"), (bx, byy - 0.35, GROUND + 4.4), (0.04, 0.62, 2.8))
        H.lettering(bm, "tkts", i("M_Light_StoreSign"), (bx + 0.03, byy - 0.35, GROUND + 4.4), math.radians(-90),
                    0.38, depth=0.02, font_path=FONT)
        H.lettering(bm, "tkts", i("M_Light_StoreSign"), (bx - 0.03, byy - 0.35, GROUND + 4.4), math.radians(90),
                    0.38, depth=0.02, font_path=FONT)

    flag = i("M_Flag_US")
    for f in bm.faces:
        if f.material_index == flag:
            continue
        for loop in f.loops:
            loop[uvl].uv = (loop.vert.co.x + loop.vert.co.y, loop.vert.co.z)
    fp = [(CX - W / 2, Y0), (CX + W / 2, Y0), (CX + W / 2, Y1 + 1.2), (CX - W / 2, Y1 + 1.2)]
    H.finish(OBJ, bm, MATS, coll, [], fp, TOP, bld_id="duffy_square", bin="duffy_square", year=2008,
             display_name="TKTS Red Steps, Duffy Square", address="Duffy Square, Broadway & W 47th St, New York, NY")
    # stepped collider instead of a prism: a ramp the character can climb + sit on
    col = H.bpy.data.objects.get("COL_" + OBJ)
    if col:
        col["collider"] = "ramp"
        col["ramp"] = {"from": [CX, Y0, GROUND], "to": [CX, Y1, GROUND + TOP], "width": W}
        col["sit_surface"] = True
    H.marker_light("PL_TS_tkts_steps", (CX, (Y0 + Y1) / 2, GROUND + TOP + 2.0), 1800.0)
    return {"building": OBJ, "steps": N_STEPS, "top_m": round(TOP, 2), "y": [Y0, round(Y1, 2)]}


result = run()
