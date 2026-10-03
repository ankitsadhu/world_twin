"""Dress the Times Square bowtie with billboards, Times Square style (idempotent).

For every non-hand-built building near the Broadway / 7th Ave corridor, street-facing facade edges are
found by ray casts. Edges facing the bowtie get:
  * a podium LED wrap (continuous across corners), 4.8 m -> ~15 m  (NYC zoning mandates lit signage here)
  * stacked upper screens (16:9 on long faces, 9:16 on narrow ones) up to ~60 m
  * tall vertical blade signs on street corners
Every screen is a sellable slot (slots_tool) with a black bezel/back box in a per-building
SIGN_<bld>_frames mesh, plus a coloured GLOW_ area light (lookdev only) so screens light the plaza at night.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402
import slots_tool as S  # noqa: E402

BOWTIE_Y = (-262.0, 250.0)      # 42nd St (south side) -> 48th St
CORRIDOR_DIST = 95.0            # how far from the Broadway/7th corridor a facade may be
PODIUM = (4.8, 15.0)


def corridor_x(y):
    """x of the bowtie centre line: midway between 7th Ave (x=0) and Broadway at this y."""
    pts = [(-331, 71.6), (-164, 27.6), (-85, 15.4), (155, -50.9), (234, -63.7), (314, -79.1)]
    if y <= pts[0][0]:
        bx = pts[0][1]
    elif y >= pts[-1][0]:
        bx = pts[-1][1]
    else:
        for (y0, x0), (y1, x1) in zip(pts, pts[1:]):
            if y0 <= y <= y1:
                bx = x0 + (x1 - x0) * (y - y0) / (y1 - y0)
                break
    return bx / 2.0


class Probe:
    def __init__(self, prefix):
        self.scene = bpy.context.scene
        self.dg = bpy.context.evaluated_depsgraph_get()
        self.road = {bpy.data.objects[f"TER_{prefix}_{n}"] for n in ("Roads", "Plazas", "Sidewalks")}

    def ray(self, o, d, dist):
        hit, loc, n, i, obj, m = self.scene.ray_cast(self.dg, Vector(o), Vector(d).normalized(), distance=dist)
        return (obj, loc) if hit else (None, None)

    def street_facing(self, mid, nrm, z=6.0):
        """Open street in front of this facade: nothing within 14 m, and street surface below."""
        o = Vector((mid[0] + nrm[0] * 0.6, mid[1] + nrm[1] * 0.6, z))
        obj, _ = self.ray(o, (nrm[0], nrm[1], 0), 14.0)
        if obj is not None and obj not in self.road:
            return False
        below, _ = self.ray((mid[0] + nrm[0] * 6, mid[1] + nrm[1] * 6, 50), (0, 0, -1), 80)
        return below in self.road


def _edges(outline):
    pts = [tuple(p) for p in outline]
    area = 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))
    if area < 0:
        pts.reverse()
    out = []
    for a, b in zip(pts, pts[1:] + pts[:1]):
        L = math.dist(a, b)
        if L < 1e-3:
            continue
        n = ((b[1] - a[1]) / L, -(b[0] - a[0]) / L)   # outward for CCW
        out.append((a, b, L, n))
    return out


def _avg_color(img):
    try:
        px = img.pixels[:]
        n = len(px) // 4
        step = max(1, n // 4000)
        r = sum(px[i * 4] for i in range(0, n, step)) / len(range(0, n, step))
        g = sum(px[i * 4 + 1] for i in range(0, n, step)) / len(range(0, n, step))
        b = sum(px[i * 4 + 2] for i in range(0, n, step)) / len(range(0, n, step))
        return (r, g, b)
    except Exception:
        return (1.0, 0.8, 0.9)


def glow_light(name, coll, centre, normal, w, h, slot_obj):
    """Lookdev-only area light in front of a screen, tinted by its current art (night only)."""
    light = bpy.data.lights.get(name) or bpy.data.lights.new(name, "AREA")
    light.shape = "RECTANGLE"
    light.size, light.size_y = w, h
    light.energy = 90.0 * w * h          # LED walls spill a lot of coloured light onto the plaza
    img = None
    for m in slot_obj.data.materials:
        for nd in m.node_tree.nodes:
            if nd.type == "TEX_IMAGE":
                img = nd.image
    light.color = _avg_color(img) if img else (1, 0.8, 0.9)
    o = bpy.data.objects.get(name) or bpy.data.objects.new(name, light)
    C.link_only_to(o, coll)
    n = Vector((normal[0], normal[1], 0)).normalized()
    o.location = Vector(centre) + n * 1.2
    aim = (n + Vector((0, 0, -0.45))).normalized()                 # outward and down onto the street
    o.rotation_euler = aim.to_track_quat("-Z", "Y").to_euler()     # area lights emit along local -Z
    o["glow_for"] = slot_obj.name
    return o


def run(district_id="times_square", seed=11):
    d = C.load_district(district_id)
    prefix = d["prefix"]
    tree = C.ensure_district_tree(prefix)
    rng = random.Random(seed)
    probe = Probe(prefix)
    scoll = C.ensure_collection(f"{prefix}_SLOTS_Bowtie", tree["SLOTS"])
    fcoll = C.ensure_collection(f"{prefix}_HERO_Signage", tree["HERO"])
    gcoll = C.ensure_collection(f"{prefix}_LIGHTS_ScreenGlow", tree["LIGHTS"])   # renders; game reads as light hints
    for c in (scoll, fcoll, gcoll):                                 # idempotent rebuild
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    data = {b["obj"]: b for b in C.load_json(f"data/{district_id}/buildings.json")["buildings"]}
    skip = set(d.get("signage_overrides", []))     # buildings whose signage is hand-built in a hero script
    stats = {"buildings": 0, "wrap": 0, "upper": 0, "blade": 0}

    for obj in list(bpy.data.collections[f"{prefix}_HERO_Blockout"].objects):
        b = data.get(obj.name)
        if b is None or b["bin"] in skip:
            continue
        cx, cy = b["centroid"]
        if not (BOWTIE_Y[0] < cy < BOWTIE_Y[1]) or abs(cx - corridor_x(cy)) > CORRIDOR_DIST:
            continue
        h = b["height_m"]
        if h < 8.0:
            continue
        key = b["bin"]
        edges = _edges(b["outline"])
        facing = []
        for a, bb, L, n in edges:
            mid = ((a[0] + bb[0]) / 2, (a[1] + bb[1]) / 2)
            to_c = (corridor_x(mid[1]) - mid[0], 0.0)
            bowtie = (n[0] * (1 if to_c[0] > 0 else -1) > 0.35) or abs(n[1]) > 0.8 and abs(mid[0] - corridor_x(mid[1])) < 45
            if L >= 4.0 and probe.street_facing(mid, n):
                facing.append((a, bb, L, n, bowtie))
        if not facing:
            continue
        fbm = bmesh.new()
        made = []
        n_slot = 0

        def sid(kind):
            nonlocal n_slot
            n_slot += 1
            return f"ts.{key}.{kind}{n_slot:02d}"

        # podium wrap: chain consecutive facing edges into continuous strips 0.45 m proud
        z0, z1 = PODIUM[0], min(PODIUM[1], h - 1.0)
        chains, cur = [], []
        for e in facing:
            if cur and math.dist(cur[-1][1], e[0]) < 0.05:
                cur.append(e)
            else:
                if cur:
                    chains.append(cur)
                cur = [e]
        if cur:
            chains.append(cur)
        for ch in chains:
            path = []
            for a, bb, L, n, _ in ch:
                path.append((a[0] + n[0] * 0.45, a[1] + n[1] * 0.45))
            a, bb, L, n, _ = ch[-1]
            path.append((bb[0] + n[0] * 0.45, bb[1] + n[1] * 0.45))
            total = sum(math.dist(p, q) for p, q in zip(path, path[1:]))
            if total < 6.0 or z1 - z0 < 3.0:
                continue
            nm = f"AD_TS_{key}_wrap{len(made) + 1}"
            o = S.wrap(nm, scoll, sid("wrap"), path, z0, z1, tier="premium", building=obj.name)
            made.append(o)
            stats["wrap"] += 1
            for (a, bb, L, n, _) in ch:                         # housing + lips behind the strip
                mid = ((a[0] + bb[0]) / 2 + n[0] * 0.15, (a[1] + bb[1]) / 2 + n[1] * 0.15)
                yaw = math.atan2(bb[1] - a[1], bb[0] - a[0])
                S._box(fbm, 0, (mid[0], mid[1], (z0 + z1) / 2), (L + 0.6, 0.55, z1 - z0 + 0.5), yaw)
            seg = ch[len(ch) // 2]
            glow_light(f"GLOW_{nm}", gcoll, (((seg[0][0] + seg[1][0]) / 2), (seg[0][1] + seg[1][1]) / 2,
                                             (z0 + z1) / 2), seg[3], min(seg[2], 30), z1 - z0, o)
        # upper screens on bowtie-facing faces
        for a, bb, L, n, bowtie in facing:
            if not bowtie or h < 24 or L < 6.0:
                continue
            zb = PODIUM[1] + 1.5
            ztop = min(h - 3.0, 62.0)
            if L >= 18.0:
                w = min(L - 2.0, 34.0)
                hh = w * 9 / 16
            else:
                w = min(L - 1.5, 14.0)
                hh = min(w * 16 / 9, ztop - zb)
            k = 0
            while zb + hh <= ztop and k < 4:
                mid = ((a[0] + bb[0]) / 2 + n[0] * 0.7, (a[1] + bb[1]) / 2 + n[1] * 0.7)
                yaw = math.degrees(math.atan2(-n[0], n[1]))
                nm = f"AD_TS_{key}_up{len(made) + 1}"
                o = S.flat(nm, scoll, sid("up"), (mid[0], mid[1], zb + hh / 2), w, hh, yaw_deg=yaw,
                           tier="hero" if k == 0 and L >= 18 else "premium", building=obj.name, frame=fbm,
                           frame_mat=0)
                made.append(o)
                stats["upper"] += 1
                glow_light(f"GLOW_{nm}", gcoll, (mid[0], mid[1], zb + hh / 2), n, w, hh, o)
                zb += hh + rng.uniform(0.8, 2.0)
                k += 1
                if rng.random() < 0.15:                       # not every facade is screens all the way up
                    break
        # vertical blade signs on corners between two facing edges
        for (a1, b1, L1, n1, bt1), (a2, b2, L2, n2, bt2) in zip(facing, facing[1:]):
            if math.dist(b1, a2) > 0.05 or not (bt1 or bt2) or h < 30:
                continue
            nx, ny = n1[0] + n2[0], n1[1] + n2[1]
            nl = math.hypot(nx, ny) or 1
            nx, ny = nx / nl, ny / nl
            cxk, cyk = b1[0] + nx * 1.6, b1[1] + ny * 1.6
            bh = min(h - PODIUM[1] - 4, 26.0)
            if bh < 10:
                continue
            nm = f"AD_TS_{key}_blade{len(made) + 1}"
            yaw = math.degrees(math.atan2(-nx, ny))
            o = S.flat(nm, scoll, sid("blade"), (cxk, cyk, PODIUM[1] + 2 + bh / 2), 3.2, bh, yaw_deg=yaw,
                       tier="premium", building=obj.name, frame=fbm, frame_mat=0, aspect="9x16")
            made.append(o)
            stats["blade"] += 1
        if not made:
            fbm.free()
            continue
        me = bpy.data.meshes.new(f"SIGN_{key}_frames")
        fbm.to_mesh(me)
        fbm.free()
        me.materials.append(C.get_material("M_Paint_Black"))
        fo = bpy.data.objects.new(f"BLD_TS_{key}_signframes", me)
        C.link_only_to(fo, fcoll)
        C.set_props(fo, tier="hero", chunk="hero", buyable=False, part_of=obj.name)
        for o in made:
            o.parent = obj
        fo.parent = obj
        stats["buildings"] += 1
    return stats


if __name__ == "__main__":
    print(run())
