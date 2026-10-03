"""Generate procedural library textures with Pillow (run with system python3, not Blender).

Outputs to blender/library/textures/gen/:
  curtain_glass_diff.png / _orm.png / _emit.png   16 bays x 8 floors facade atlas (1 tile = 24 m x 32 m)
  slot_placeholder_<aspect>.png                    "ad space available" art per standard aspect
  led_pixel_mask.png                               small tileable RGB sub-pixel mask (lookdev only)

glTF ORM convention: R = occlusion, G = roughness, B = metallic.
"""
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "blender", "library", "textures", "gen")
FONT_BOLD = "/System/Library/Fonts/Avenir Next.ttc"

# facade atlas geometry: bay 1.5 m wide, floor 4.0 m tall, 128 px/bay -> ~85 px/m
BAYS_X, FLOORS_Y = 16, 8
BAY_PX, FLOOR_PX = 128, 256
MULLION_PX, SPANDREL_PX = 6, 46

SLOT_ASPECTS = {"16x9": (1920, 1080), "9x16": (1080, 1920), "1x1": (1536, 1536),
                "4x1": (2048, 512), "2x1": (2048, 1024), "3x4": (1152, 1536), "8x1": (2048, 256)}


def font(size, index=1):
    try:
        return ImageFont.truetype(FONT_BOLD, size, index=index)
    except OSError:
        return ImageFont.load_default(size)


def curtain_glass(seed=7):
    rng = random.Random(seed)
    W, H = BAYS_X * BAY_PX, FLOORS_Y * FLOOR_PX
    diff = Image.new("RGB", (W, H))
    orm = Image.new("RGB", (W, H))
    emit = Image.new("RGB", (W, H), (0, 0, 0))
    dd, od, ed = ImageDraw.Draw(diff), ImageDraw.Draw(orm), ImageDraw.Draw(emit)
    warm = [(255, 214, 160), (255, 226, 185), (255, 200, 140)]
    cool = [(210, 230, 255), (235, 242, 255), (190, 215, 255)]
    for fy in range(FLOORS_Y):
        floor_lit = rng.random() < 0.85  # some floors entirely dark
        for bx in range(BAYS_X):
            x0, y0 = bx * BAY_PX, fy * FLOOR_PX
            # spandrel (opaque band) + mullion frame
            dd.rectangle([x0, y0, x0 + BAY_PX, y0 + FLOOR_PX], fill=(52, 56, 60))
            od.rectangle([x0, y0, x0 + BAY_PX, y0 + FLOOR_PX], fill=(255, 110, 230))
            gx0, gy0 = x0 + MULLION_PX, y0 + SPANDREL_PX
            gx1, gy1 = x0 + BAY_PX - MULLION_PX, y0 + FLOOR_PX - MULLION_PX
            # glass: dark tinted with per-pane variation + blinds (lighter band from top)
            v = rng.randint(-6, 6)
            dd.rectangle([gx0, gy0, gx1, gy1], fill=(18 + v, 24 + v, 30 + v))
            blind = rng.choice([0, 0, 0, 0.15, 0.3, 0.55, 0.9])
            if blind:
                by = gy0 + int((gy1 - gy0) * blind)
                dd.rectangle([gx0, gy0, gx1, by], fill=(70 + v, 72 + v, 70 + v))
            od.rectangle([gx0, gy0, gx1, gy1], fill=(255, 12, 0))
            # night: lit office windows, ~30% overall, clustered per floor
            if floor_lit and rng.random() < 0.38:
                col = rng.choice(warm if rng.random() < 0.6 else cool)
                k = rng.uniform(0.55, 1.0)
                col = tuple(int(c * k) for c in col)
                ed.rectangle([gx0, gy0, gx1, gy1], fill=col)
                if blind:  # blinds dim the upper part of the lit pane
                    ed.rectangle([gx0, gy0, gx1, gy0 + int((gy1 - gy0) * blind)],
                                 fill=tuple(int(c * 0.35) for c in col))
    emit = emit.filter(ImageFilter.GaussianBlur(1.2))
    diff.save(os.path.join(OUT, "curtain_glass_diff.png"))
    orm.save(os.path.join(OUT, "curtain_glass_orm.png"))
    emit.save(os.path.join(OUT, "curtain_glass_emit.png"))


def slot_placeholder(aspect, size):
    W, H = size
    img = Image.new("RGB", size)
    d = ImageDraw.Draw(img)
    # deep vertical gradient
    for y in range(H):
        t = y / max(1, H - 1)
        d.line([(0, y), (W, y)], fill=(int(14 + 30 * t), int(18 + 10 * t), int(48 + 70 * (1 - t))))
    # subtle diagonal grid
    step = max(32, min(W, H) // 12)
    for i in range(-H, W, step):
        d.line([(i, 0), (i + H, H)], fill=(40, 46, 96), width=2)
    # frame
    m = max(8, min(W, H) // 40)
    d.rectangle([m, m, W - m, H - m], outline=(255, 196, 0), width=max(3, m // 2))
    short = min(W, H)
    lines = [("AD SPACE", int(short * 0.20), (255, 196, 0)),
             ("YOUR BRAND HERE", int(short * 0.10), (255, 255, 255)),
             (f"{aspect.replace('x', ':')} · available", int(short * 0.06), (170, 180, 230))]
    if H < W / 3:  # very wide strips: single line
        lines = [("AD SPACE · YOUR BRAND HERE", int(H * 0.42), (255, 255, 255))]
    total = sum(s * 1.25 for _, s, _ in lines)
    y = (H - total) / 2
    for text, s, col in lines:
        f = font(s, index=1 if s > 40 else 0)
        while d.textlength(text, font=f) > W * 0.86 and s > 8:
            s = int(s * 0.9)
            f = font(s)
        x = (W - d.textlength(text, font=f)) / 2
        d.text((x, y), text, font=f, fill=col)
        y += s * 1.25
    img.save(os.path.join(OUT, f"slot_placeholder_{aspect}.png"))


PH = os.path.join(ROOT, "blender", "library", "textures")

# Masonry facade atlases: 2048 px = 16 m (128 px/m); 8 bays x 2 m, 4 floors x 4 m per tile
MASONRY = {
    # name: (polyhaven id, source tile metres, trim rgb (sills/lintels), frame rgb, seed)
    "facade_brick_red": ("red_brick_03", 1.0, (196, 188, 170), (235, 232, 222), 11),
    "facade_brick_buff": ("yellow_brick", 2.0, (180, 170, 150), (60, 62, 64), 12),
    "facade_limestone": ("white_sandstone_bricks_03", 2.0, (205, 198, 182), (52, 56, 60), 13),
}
PXM = 128


def _tiled(path, tile_m, size, mode="RGB"):
    src = Image.open(path).convert(mode)
    t = max(8, int(tile_m * PXM))
    src = src.resize((t, t), Image.LANCZOS)
    out = Image.new(mode, (size, size))
    for y in range(0, size, t):
        for x in range(0, size, t):
            out.paste(src, (x, y))
    return out


def masonry_atlas(name, tex_id, tile_m, trim, frame, seed):
    S = 16 * PXM
    rng = random.Random(seed)
    diff = _tiled(f"{PH}/{tex_id}_diff_2k.jpg", tile_m, S)
    rough = _tiled(f"{PH}/{tex_id}_rough_2k.jpg", tile_m, S, "L")
    nrm = _tiled(f"{PH}/{tex_id}_nor_gl_2k.jpg", tile_m, S)
    emit = Image.new("RGB", (S, S), (0, 0, 0))
    dd, rd, nd, ed = (ImageDraw.Draw(i) for i in (diff, rough, nrm, emit))
    m = lambda v: int(v * PXM)
    warm = [(255, 205, 140), (255, 220, 170), (255, 190, 120), (230, 230, 255)]
    for fl in range(4):
        floor_top = S - fl * m(4.0)          # image y grows downward; v=0 is the bottom of the tile
        lit_floor = rng.random() < 0.8
        for bay in range(8):
            x0 = bay * m(2.0) + m(0.45)
            x1 = x0 + m(1.1)
            y1 = floor_top - m(0.9)           # sill height
            y0 = y1 - m(2.0)                  # window head
            # lintel + sill (stone trim)
            dd.rectangle([x0 - m(0.12), y0 - m(0.2), x1 + m(0.12), y0], fill=trim)
            dd.rectangle([x0 - m(0.08), y1, x1 + m(0.08), y1 + m(0.1)], fill=trim)
            rd.rectangle([x0 - m(0.12), y0 - m(0.2), x1 + m(0.12), y1 + m(0.1)], fill=170)
            # reveal shadow, frame, glass (two sashes)
            dd.rectangle([x0, y0, x1, y1], fill=(28, 26, 24))
            fpx = 6
            dd.rectangle([x0 + 3, y0 + 3, x1 - 3, y1 - 3], fill=frame)
            gv = rng.randint(-8, 8)
            glass = (24 + gv, 30 + gv, 36 + gv)
            mid = (y0 + y1) // 2
            dd.rectangle([x0 + 3 + fpx, y0 + 3 + fpx, x1 - 3 - fpx, mid - fpx // 2], fill=glass)
            dd.rectangle([x0 + 3 + fpx, mid + fpx // 2, x1 - 3 - fpx, y1 - 3 - fpx], fill=glass)
            blind = rng.choice([0, 0, 0.2, 0.35, 0.5, 0.8])
            if blind:
                dd.rectangle([x0 + 3 + fpx, y0 + 3 + fpx, x1 - 3 - fpx, y0 + int((y1 - y0) * blind)],
                             fill=(150 + gv, 140 + gv, 120 + gv))
            rd.rectangle([x0 + 3 + fpx, y0 + 3 + fpx, x1 - 3 - fpx, y1 - 3 - fpx], fill=14)
            nd.rectangle([x0, y0, x1, y1], fill=(128, 128, 255))
            if rng.random() < 0.18:  # window AC unit, very NYC
                ax0, ay0 = x0 + m(0.2), mid + m(0.05)
                dd.rectangle([ax0, ay0, ax0 + m(0.7), ay0 + m(0.42)], fill=(170, 170, 165))
                dd.line([ax0, ay0 + m(0.15), ax0 + m(0.7), ay0 + m(0.15)], fill=(120, 120, 118), width=3)
                rd.rectangle([ax0, ay0, ax0 + m(0.7), ay0 + m(0.42)], fill=120)
            if lit_floor and rng.random() < 0.3:
                col = rng.choice(warm)
                k = rng.uniform(0.5, 1.0)
                col = tuple(int(c * k) for c in col)
                ed.rectangle([x0 + 3 + fpx, y0 + 3 + fpx + int((y1 - y0) * blind), x1 - 3 - fpx, y1 - 3 - fpx],
                             fill=col)
                if blind:
                    ed.rectangle([x0 + 3 + fpx, y0 + 3 + fpx, x1 - 3 - fpx, y0 + int((y1 - y0) * blind)],
                                 fill=tuple(int(c * 0.45) for c in col))
        # floor-line string course every 4 floors is too regular; add one belt course per tile bottom
    dd.rectangle([0, S - m(0.25), S, S], fill=trim)
    # soot / weathering gradient: darker toward the top of each tile + subtle vertical streaks
    grime = Image.new("L", (S, S), 0)
    gd = ImageDraw.Draw(grime)
    for x in range(0, S, 7):
        a = rng.randint(0, 40)
        gd.line([x, 0, x, rng.randint(S // 4, S)], fill=a, width=rng.randint(2, 6))
    grime = grime.filter(ImageFilter.GaussianBlur(6))
    diff = Image.composite(Image.new("RGB", (S, S), (20, 18, 16)), diff, grime.point(lambda v: v // 2))
    emit = emit.filter(ImageFilter.GaussianBlur(1.0))
    orm = Image.merge("RGB", (Image.new("L", (S, S), 255), rough, Image.new("L", (S, S), 0)))
    diff.save(os.path.join(OUT, f"{name}_diff.jpg"), quality=90)
    orm.save(os.path.join(OUT, f"{name}_orm.jpg"), quality=92)
    nrm.save(os.path.join(OUT, f"{name}_nrm.jpg"), quality=92)
    emit.save(os.path.join(OUT, f"{name}_emit.jpg"), quality=90)


SHOP_WORDS = ["DELI", "PIZZA", "PHARMACY", "GIFTS", "CAFE", "BAGELS", "SHOES", "NAILS", "THEATRE TIX",
              "SUBS", "BURGERS", "CANDY", "BANK", "OPTICAL", "SOUVENIRS", "RAMEN", "FLOWERS", "HOTEL", "SUSHI",
              "DINER", "WIRELESS", "JEWELRY", "BAR & GRILL", "LIQUORS"]
SIGN_COLS = [(200, 30, 35), (20, 110, 60), (230, 180, 20), (15, 50, 130), (30, 30, 30), (180, 20, 120),
             (240, 240, 235), (210, 90, 20), (0, 140, 160)]


def storefront_atlas(seed=21):
    """4 rows (variants) x 16 m wide x 4.5 m tall ground floors, 4 shops of 4 m each per row.
    diff / orm / emit (night: lit interiors + sign boxes). 128 px/m -> 2048 x 2304."""
    rng = random.Random(seed)
    W, RH = 16 * PXM, int(4.5 * PXM)
    H = RH * 4
    diff = Image.new("RGB", (W, H))
    rough = Image.new("L", (W, H), 160)
    emit = Image.new("RGB", (W, H), (0, 0, 0))
    dd, rd, ed = ImageDraw.Draw(diff), ImageDraw.Draw(rough), ImageDraw.Draw(emit)
    m = lambda v: int(v * PXM)
    words = SHOP_WORDS[:]
    rng.shuffle(words)
    for row in range(4):
        top = row * RH
        for s in range(4):
            x0, x1 = s * m(4.0), (s + 1) * m(4.0)
            frame = rng.choice([(40, 40, 42), (90, 92, 95), (25, 30, 28), (120, 30, 30), (200, 200, 195)])
            # pilaster / frame
            dd.rectangle([x0, top, x1, top + RH], fill=frame)
            # sign band 0.8 m at the top
            sc = rng.choice(SIGN_COLS)
            sy0, sy1 = top + m(0.25), top + m(1.05)
            dd.rectangle([x0 + m(0.15), sy0, x1 - m(0.15), sy1], fill=sc)
            word = words.pop() if words else rng.choice(SHOP_WORDS)
            f = font(int(m(0.5)), 1)
            while dd.textlength(word, font=f) > m(3.4):
                f = font(int(f.size * 0.9), 1)
            tc = (255, 255, 255) if sum(sc) < 450 else (20, 20, 20)
            tx = x0 + (m(4.0) - dd.textlength(word, font=f)) / 2
            dd.text((tx, sy0 + m(0.1)), word, font=f, fill=tc)
            ed.rectangle([x0 + m(0.15), sy0, x1 - m(0.15), sy1], fill=tuple(int(c * 0.55) for c in sc))
            ed.text((tx, sy0 + m(0.1)), word, font=f, fill=tc)
            # display windows + door
            gy0, gy1 = top + m(1.25), top + RH - m(0.45)
            door_left = rng.random() < 0.5
            dx0 = x0 + (m(0.3) if door_left else m(2.75))
            interior = rng.choice([(255, 235, 200), (240, 245, 255), (255, 220, 170), (230, 255, 240)])
            for wx0, wx1 in ((x0 + m(0.25), x1 - m(0.25)),):
                dd.rectangle([wx0, gy0, wx1, gy1], fill=(30, 34, 38))
                rd.rectangle([wx0, gy0, wx1, gy1], fill=12)
                # interior: soft overall glow brightest near the ceiling, then shelves/merchandise
                for yy in range(gy0, gy1):
                    k = 0.55 - 0.3 * (yy - gy0) / (gy1 - gy0)
                    ed.line([wx0, yy, wx1, yy], fill=tuple(int(c * k) for c in interior))
                for _ in range(12):
                    bx = rng.randint(wx0, wx1 - m(0.4))
                    bw = rng.randint(m(0.15), m(0.5))
                    bh = rng.randint(m(0.3), m(1.4))
                    col = tuple(rng.randint(60, 220) for _ in range(3))
                    dd.rectangle([bx, gy1 - bh, bx + bw, gy1], fill=tuple(c // 3 for c in col))
                    ed.rectangle([bx, gy1 - bh, bx + bw, gy1], fill=tuple(int(c * 0.7) for c in col))
            # mullions + door
            for k in range(1, 3):
                xx = x0 + k * m(4.0) // 3
                dd.line([xx, gy0, xx, gy1], fill=frame, width=6)
            dd.rectangle([dx0, gy0 + m(0.2), dx0 + m(0.95), top + RH], fill=frame)
            dd.rectangle([dx0 + 8, gy0 + m(0.3), dx0 + m(0.95) - 8, top + RH - 10], fill=(35, 40, 44))
            ed.rectangle([dx0 + 8, gy0 + m(0.3), dx0 + m(0.95) - 8, top + RH - 10], fill=tuple(int(c * 0.8) for c in interior))
            # kick plate + roller-shutter box above the glass
            dd.rectangle([x0, top + RH - m(0.45), x1, top + RH], fill=(70, 70, 72))
            dd.rectangle([x0 + m(0.1), sy1 + m(0.02), x1 - m(0.1), gy0 - m(0.02)], fill=(55, 56, 58))
    emit = emit.filter(ImageFilter.GaussianBlur(2))
    orm = Image.merge("RGB", (Image.new("L", (W, H), 255), rough, Image.new("L", (W, H), 0)))
    diff.save(os.path.join(OUT, "storefront_diff.jpg"), quality=90)
    orm.save(os.path.join(OUT, "storefront_orm.jpg"), quality=92)
    emit.save(os.path.join(OUT, "storefront_emit.jpg"), quality=90)


def wood_planks(seed=5):
    """Weathered vertical cedar staves for rooftop water towers (1 tile = 2 m x 2 m)."""
    rng = random.Random(seed)
    S = 512
    img = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(img)
    x = 0
    while x < S:
        w = rng.randint(22, 34)
        base = rng.randint(70, 105)
        col = (base + 18, base + 6, base - 12)
        d.rectangle([x, 0, x + w, S], fill=col)
        for _ in range(30):
            yy = rng.randint(0, S)
            d.line([x + rng.randint(0, w), yy, x + rng.randint(0, w), yy + rng.randint(20, 120)],
                   fill=tuple(c - rng.randint(5, 20) for c in col), width=1)
        d.line([x, 0, x, S], fill=(35, 30, 25), width=2)
        x += w
    for y in (S // 5, S // 2, 4 * S // 5):   # steel hoops
        d.rectangle([0, y, S, y + 6], fill=(40, 38, 36))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(os.path.join(OUT, "watertower_wood_diff.jpg"), quality=90)


STREET_SIGNS = ["5 Av", "6 Av", "7 Av", "8 Av", "9 Av", "10 Av", "Broadway", "Madison Av"] + \
               [f"W {n} St" for n in range(37, 56)]
SIGN_W, SIGN_H, SIGN_COLS_N = 512, 96, 4


def street_sign_atlas():
    """NYC street-name blades: white text on green, thin white border. Grid of 4 columns.
    Index i -> u in [col/4, (col+1)/4], v rows from the top. Layout written to street_signs.json."""
    import json
    rows = (len(STREET_SIGNS) + SIGN_COLS_N - 1) // SIGN_COLS_N
    img = Image.new("RGB", (SIGN_W * SIGN_COLS_N, SIGN_H * rows), (0, 0, 0))
    d = ImageDraw.Draw(img)
    layout = {}
    for i, name in enumerate(STREET_SIGNS):
        c, r = i % SIGN_COLS_N, i // SIGN_COLS_N
        x0, y0 = c * SIGN_W, r * SIGN_H
        d.rectangle([x0, y0, x0 + SIGN_W - 1, y0 + SIGN_H - 1], fill=(14, 92, 52))
        d.rectangle([x0 + 6, y0 + 6, x0 + SIGN_W - 7, y0 + SIGN_H - 7], outline=(235, 235, 230), width=3)
        f = font(60, 0)
        while d.textlength(name, font=f) > SIGN_W - 40:
            f = font(int(f.size * 0.92), 0)
        d.text((x0 + (SIGN_W - d.textlength(name, font=f)) / 2, y0 + 12), name, font=f, fill=(245, 245, 240))
        W, H = img.size
        layout[name] = [x0 / W, 1 - (y0 + SIGN_H) / H, (x0 + SIGN_W) / W, 1 - y0 / H]  # u0, v0, u1, v1
    img.save(os.path.join(OUT, "street_signs.png"))
    with open(os.path.join(OUT, "street_signs.json"), "w") as fh:
        json.dump(layout, fh, indent=1)


def us_flag():
    """US flag (public domain design), 1.9:1, 13 stripes, 50 stars, for the Duffy Square flagpole."""
    W, H = 1520, 800
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    sh = H / 13
    for k in range(13):
        if k % 2 == 0:
            d.rectangle([0, k * sh, W, (k + 1) * sh], fill=(178, 34, 52))
    cw, ch = W * 0.4, sh * 7
    d.rectangle([0, 0, cw, ch], fill=(60, 59, 110))
    for r in range(9):
        cols = 6 if r % 2 == 0 else 5
        for c in range(cols):
            x = cw / 12 * (2 * c + 1 + (r % 2))
            y = ch / 10 * (r + 1)
            d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=(255, 255, 255))
    img.save(os.path.join(OUT, "us_flag.png"))


DEMO_BRANDS = [  # fictional names only; used for lookdev renders, never exported
    ("NOVALOOP", "Ship faster.", (255, 70, 90), (40, 10, 60)),
    ("brightfin", "Money, simplified", (20, 220, 160), (5, 30, 40)),
    ("ORBITAL", "Cloud for the curious", (90, 140, 255), (8, 10, 30)),
    ("Sunday", "Coffee that cares", (255, 190, 40), (90, 30, 10)),
    ("KITE", "Fly anywhere", (255, 255, 255), (230, 40, 40)),
    ("helio", "Solar for every roof", (255, 230, 0), (10, 60, 120)),
    ("PIXELWAVE", "Stream it all", (240, 80, 255), (20, 0, 40)),
    ("greenroot", "Fresh. Local. Now.", (120, 230, 80), (10, 50, 20)),
    ("ATLAS", "Maps for makers", (0, 200, 255), (0, 20, 40)),
    ("mellow", "Sleep better tonight", (200, 170, 255), (30, 20, 70)),
]


def demo_ad(i, aspect, size):
    name, tag, fg, bg = DEMO_BRANDS[i % len(DEMO_BRANDS)]
    W, H = size
    img = Image.new("RGB", size, bg)
    d = ImageDraw.Draw(img)
    rng = random.Random(i * 31 + len(aspect))
    for _ in range(6):  # soft blobs
        r = rng.randint(min(W, H) // 4, max(W, H) // 2)
        x, y = rng.randint(0, W), rng.randint(0, H)
        col = tuple(min(255, int(c * rng.uniform(0.4, 0.9) + b * 0.3)) for c, b in zip(fg, bg))
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    img = img.filter(ImageFilter.GaussianBlur(min(W, H) // 10))
    d = ImageDraw.Draw(img)
    short = min(W, H)
    s1 = int(short * (0.28 if H < W / 3 else 0.22))
    f1 = font(s1, 1)
    while d.textlength(name, font=f1) > W * 0.85:
        s1 = int(s1 * 0.9)
        f1 = font(s1, 1)
    tx = (W - d.textlength(name, font=f1)) / 2
    ty = H * (0.32 if H >= W / 3 else 0.2)
    d.text((tx + 4, ty + 4), name, font=f1, fill=(0, 0, 0))
    d.text((tx, ty), name, font=f1, fill=fg)
    if H >= W / 3:
        s2 = int(s1 * 0.38)
        f2 = font(s2, 0)
        d.text(((W - d.textlength(tag, font=f2)) / 2, ty + s1 * 1.3), tag, font=f2, fill=(255, 255, 255))
    img.save(os.path.join(OUT, f"demo_ad_{i:02d}_{aspect}.png"))


def led_pixel_mask():
    img = Image.new("RGB", (6, 6), (0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 1, 4], fill=(255, 40, 40))
    d.rectangle([2, 0, 3, 4], fill=(40, 255, 40))
    d.rectangle([4, 0, 5, 4], fill=(40, 40, 255))
    img.resize((48, 48), Image.NEAREST).save(os.path.join(OUT, "led_pixel_mask.png"))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    curtain_glass()
    for nm, args in MASONRY.items():
        masonry_atlas(nm, *args)
    storefront_atlas()
    wood_planks()
    street_sign_atlas()
    us_flag()
    for a, s in SLOT_ASPECTS.items():
        slot_placeholder(a, s)
        for i in range(len(DEMO_BRANDS)):
            demo_ad(i, a, (s[0] // 2, s[1] // 2))
    led_pixel_mask()
    print("wrote", sorted(os.listdir(OUT)))
