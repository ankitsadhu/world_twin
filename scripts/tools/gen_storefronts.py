"""A storefront atlas with 4x the variety of the original (review 2026-10-03: "every street repeats the same
SUBS / RAMEN / SHOES strip").

  .venv/bin/python scripts/tools/gen_storefronts.py   -> export/textures/storefront4_{diff,orm,emit}.jpg

Layout: 2 x 2 copies of the original storefront tile (16 m wide x 18 m = 4 variant rows of 4.5 m), so the buildings'
existing UVs still fit: the game picks one of the four copies per 16 m stretch of facade (viewer: storefront4.js).
That is 4 copies x 4 rows = 16 rows of shopfronts, ~60 shops, each row split its own way (one 8 m store and two
4 m shops, four 4 m shops, three 5.3 m shops...), with flat sign bands, striped fabric awnings or channel letters on
dark fascias, in several type styles. Generic businesses only: no real brands or logos.
The emit map lights the signs and shop interiors at night, as the original did.
"""
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "export", "textures")
PXM = 96                                   # px per metre: 16 m -> 1536 px; atlas 3072 x 3456
SUP = "/System/Library/Fonts/Supplemental/"
FONTS = [  # (path, index): bold sans, condensed, slab, serif, rounded-ish
    ("/System/Library/Fonts/HelveticaNeue.ttc", 1), (SUP + "Arial Bold.ttf", 0), (SUP + "Impact.ttf", 0),
    ("/System/Library/Fonts/Avenir Next Condensed.ttc", 2), (SUP + "Rockwell.ttc", 1), (SUP + "Georgia Bold.ttf", 0),
    (SUP + "Futura.ttc", 2), (SUP + "Trebuchet MS Bold.ttf", 0), (SUP + "GillSans.ttc", 1), (SUP + "Copperplate.ttc", 1),
]
WORDS = [
    "DELI & GROCERY", "PIZZA", "PHARMACY", "GIFTS", "CAFE", "BAGELS", "SHOES", "NAIL SALON", "THEATRE TICKETS",
    "SUBS", "BURGERS", "CANDY", "BANK", "OPTICAL", "SOUVENIRS", "RAMEN", "FLOWERS", "HOTEL", "SUSHI", "DINER",
    "WIRELESS", "JEWELRY", "BAR & GRILL", "WINE & SPIRITS", "HALAL GRILL", "COFFEE", "BAKERY", "BOOKS", "HARDWARE",
    "LAUNDROMAT", "BARBER", "TACOS", "DUMPLINGS", "ELECTRONICS", "TOYS", "PHOTO", "SPORTS BAR", "DRY CLEANERS",
    "STEAKHOUSE", "THAI KITCHEN", "PAWN & GOLD", "CHECK CASHING", "URGENT CARE", "PET SUPPLY", "FROZEN YOGURT",
    "NOODLE BAR", "LUGGAGE", "CAMERAS", "BEAUTY SUPPLY", "TAILOR", "GYM", "VINTAGE", "PIANO BAR", "OYSTERS",
    "CHOCOLATES", "TEA HOUSE", "GELATO", "BURRITOS", "FALAFEL", "RECORDS", "KEYS MADE", "TATTOO", "STATIONERY",
    "MATTRESS", "SMOOTHIES", "KARAOKE", "COMEDY CLUB", "SALAD BAR", "WATCH REPAIR", "COSTUMES",
]
SIGN = [(200, 30, 35), (20, 110, 60), (230, 180, 20), (15, 50, 130), (28, 28, 30), (180, 20, 120), (240, 240, 235),
        (210, 90, 20), (0, 140, 160), (95, 40, 120), (120, 20, 25), (30, 70, 45), (250, 205, 60), (60, 60, 64)]
FRAMES = [(40, 40, 42), (90, 92, 95), (25, 30, 28), (120, 30, 30), (200, 200, 195), (60, 45, 35), (150, 140, 120)]
INTERIORS = [(255, 235, 200), (240, 245, 255), (255, 220, 170), (230, 255, 240), (255, 240, 220)]
SPLITS = [[4, 4, 4, 4], [8, 4, 4], [4, 8, 4], [4, 4, 8], [16 / 3] * 3, [6, 5, 5], [8, 8], [5, 6, 5], [4, 6, 6]]


def fit(d, text, path_idx, max_w, max_h):
    path, idx = path_idx
    size = int(max_h)
    while size > 10:
        f = ImageFont.truetype(path, size, index=idx)
        l, t, r, b = d.textbbox((0, 0), text, font=f)
        if r - l <= max_w and b - t <= max_h:
            return f
        size = int(size * 0.92)
    return ImageFont.truetype(path, 10, index=idx)


def shop(dd, rd, ed, rng, x0, x1, top, RH, word):
    m = lambda v: int(v * PXM)
    frame = rng.choice(FRAMES)
    dd.rectangle([x0, top, x1, top + RH], fill=frame)
    style = rng.choices(["band", "awning", "letters"], [0.5, 0.25, 0.25])[0]
    sc = rng.choice(SIGN)
    sy0, sy1 = top + m(0.25), top + m(1.05)
    fnt_pick = rng.choice(FONTS)
    tc = (255, 255, 255) if sum(sc) < 450 else (20, 20, 20)
    if style == "band":
        dd.rectangle([x0 + m(0.12), sy0, x1 - m(0.12), sy1], fill=sc)
        ed.rectangle([x0 + m(0.12), sy0, x1 - m(0.12), sy1], fill=tuple(int(c * 0.5) for c in sc))
    elif style == "letters":                     # channel letters on a dark fascia
        sc = (24, 24, 26)
        tc = rng.choice([(255, 255, 255), (250, 210, 90), (240, 60, 60), (120, 210, 255)])
        dd.rectangle([x0 + m(0.05), sy0 - m(0.1), x1 - m(0.05), sy1], fill=sc)
    f = fit(dd, word, fnt_pick, (x1 - x0) - m(0.7), (sy1 - sy0) * 0.62)
    l, t, r, b = dd.textbbox((0, 0), word, font=f)
    tx, ty = (x0 + x1 - (r - l)) / 2 - l, (sy0 + sy1 - (b - t)) / 2 - t
    if style != "awning":
        dd.text((tx, ty), word, font=f, fill=tc)
        ed.text((tx, ty), word, font=f, fill=tc if style == "letters" else tuple(int(c * 0.9) for c in tc))
    # display glass, interior glow and merchandise
    gy0, gy1 = top + m(1.25), top + RH - m(0.45)
    interior = rng.choice(INTERIORS)
    wx0, wx1 = x0 + m(0.25), x1 - m(0.25)
    dd.rectangle([wx0, gy0, wx1, gy1], fill=(30, 34, 38))
    rd.rectangle([wx0, gy0, wx1, gy1], fill=12)
    for yy in range(gy0, gy1):
        k = 0.55 - 0.3 * (yy - gy0) / (gy1 - gy0)
        ed.line([wx0, yy, wx1, yy], fill=tuple(int(c * k) for c in interior))
    for _ in range(int((x1 - x0) / m(0.33))):
        bx = rng.randint(wx0, max(wx0 + 1, wx1 - m(0.4)))
        bw, bh = rng.randint(m(0.12), m(0.5)), rng.randint(m(0.3), m(1.5))
        col = tuple(rng.randint(60, 220) for _ in range(3))
        dd.rectangle([bx, gy1 - bh, bx + bw, gy1], fill=tuple(c // 3 for c in col))
        ed.rectangle([bx, gy1 - bh, bx + bw, gy1], fill=tuple(int(c * 0.7) for c in col))
    # mullions, door
    n = max(2, round((x1 - x0) / m(1.6)))
    for k in range(1, n):
        xx = x0 + k * (x1 - x0) // n
        dd.line([xx, gy0, xx, gy1], fill=frame, width=6)
    dx0 = x0 + (m(0.3) if rng.random() < 0.5 else (x1 - x0) - m(1.25))
    dd.rectangle([dx0, gy0 + m(0.2), dx0 + m(0.95), top + RH], fill=frame)
    dd.rectangle([dx0 + 8, gy0 + m(0.3), dx0 + m(0.95) - 8, top + RH - 10], fill=(35, 40, 44))
    ed.rectangle([dx0 + 8, gy0 + m(0.3), dx0 + m(0.95) - 8, top + RH - 10], fill=tuple(int(c * 0.8) for c in interior))
    dd.rectangle([x0, top + RH - m(0.45), x1, top + RH], fill=(70, 70, 72))                 # kick plate
    if style == "awning":                       # striped fabric awning with the name on its valance
        a, b2 = rng.choice(SIGN), rng.choice([(240, 240, 235), (30, 30, 30)])
        ay0, ay1 = top + m(0.2), top + m(1.35)
        stripe = m(0.3)
        for k, sx in enumerate(range(x0 + m(0.1), x1 - m(0.1), stripe)):
            col = a if k % 2 == 0 else b2
            dd.polygon([(sx, ay0), (min(sx + stripe, x1 - m(0.1)), ay0), (min(sx + stripe, x1 - m(0.1)) + m(0.05), ay1),
                        (sx + m(0.05), ay1)], fill=col)
        for yy in range(ay0, ay1, 3):            # shading: darker toward the top (it slopes away from you)
            k = 0.65 + 0.35 * (yy - ay0) / (ay1 - ay0)
        dd.rectangle([x0 + m(0.1), ay1 - m(0.32), x1 - m(0.1), ay1], fill=a)
        f2 = fit(dd, word, fnt_pick, (x1 - x0) - m(0.9), m(0.24))
        l, t, r, b = dd.textbbox((0, 0), word, font=f2)
        tc2 = (255, 255, 255) if sum(a) < 450 else (20, 20, 20)
        dd.text(((x0 + x1 - (r - l)) / 2 - l, ay1 - m(0.16) - (b - t) / 2 - t), word, font=f2, fill=tc2)
        ed.rectangle([x0 + m(0.25), ay1, x1 - m(0.25), ay1 + m(0.15)], fill=tuple(int(c * 0.35) for c in interior))


def main():
    rng = random.Random(77)
    TW, RH = 16 * PXM, int(4.5 * PXM)
    W, H = TW * 2, RH * 4 * 2
    diff, rough, emit = Image.new("RGB", (W, H)), Image.new("L", (W, H), 160), Image.new("RGB", (W, H), (0, 0, 0))
    dd, rd, ed = ImageDraw.Draw(diff), ImageDraw.Draw(rough), ImageDraw.Draw(emit)
    words = WORDS[:]
    rng.shuffle(words)
    for ty in range(2):
        for tx in range(2):
            for row in range(4):
                top = ty * RH * 4 + row * RH
                split = rng.choice(SPLITS)
                x = tx * TW
                for w in split:
                    x1 = x + int(w * PXM)
                    word = words.pop() if words else rng.choice(WORDS)
                    shop(dd, rd, ed, rng, x, x1, top, RH, word)
                    x = x1
    # light grime so the shops sit in the city
    grime = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(grime)
    for x in range(0, W, 9):
        gd.line([x, 0, x, H], fill=rng.randint(0, 28), width=rng.randint(2, 5))
    grime = grime.filter(ImageFilter.GaussianBlur(5))
    diff = Image.composite(Image.new("RGB", (W, H), (20, 18, 16)), diff, grime.point(lambda v: v // 2))
    emit = emit.filter(ImageFilter.GaussianBlur(2))
    orm = Image.merge("RGB", (Image.new("L", (W, H), 255), rough, Image.new("L", (W, H), 0)))
    os.makedirs(OUT, exist_ok=True)
    diff.save(os.path.join(OUT, "storefront4_diff.jpg"), quality=86)
    orm.save(os.path.join(OUT, "storefront4_orm.jpg"), quality=86)
    emit.save(os.path.join(OUT, "storefront4_emit.jpg"), quality=86)
    print("storefront4", (W, H), {n: os.path.getsize(os.path.join(OUT, f"storefront4_{n}.jpg")) // 1024 for n in ("diff", "orm", "emit")}, "KB")


if __name__ == "__main__":
    main()
