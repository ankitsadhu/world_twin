"""Paint the yellow cab's side livery (generic NYC style, no official logos) as a texture for the car generator.

  .venv/bin/python scripts/tools/make_taxi_livery.py   -> data/vehicles/taxi_livery.png

The texture holds both side elevations, stacked: the right side in the top half (u = (y + L/2) / L, rear at u = 0),
the left side in the bottom half drawn mirrored (front at u = 0), so on both sides the lettering reads correctly AND
sits on the right panel; car_gen.py maps the paint faces the same way. On each side, at real places and sizes:
  * "TAXI" on both front doors, 16 cm capitals, black
  * a four-character medallion-style number (fictional) on the rear quarter panel, 9 cm
  * a fare decal panel on the rear doors (black lines on white, small type)
  * a thin black pinstripe along the bodyside character line
Everything else is cab yellow, baked into the texture (sRGB 236,168,0: NYC "taxi yellow" as it reads under the
game's AgX tone mapping; the material's base colour factor stays white).
"""
import os

from PIL import Image, ImageDraw, ImageFont

L, Z0, ZH = 4.60, 0.20, 1.60            # body length and the side's height range (metres)
W, H = 2944, 1024                         # 640 px per metre along, 640 px per metre up
YELLOW = (236, 168, 0)
FONT_B = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"


def main():
    top, bottom = side(False), side(True)
    img = Image.new("RGB", (W, 2 * H), YELLOW)
    img.paste(top, (0, 0)); img.paste(bottom, (0, H))
    out = os.path.join(os.path.dirname(__file__), "..", "..", "data", "vehicles", "taxi_livery.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out)
    print("livery ->", os.path.abspath(out), img.size)


def side(left):
    """One side's elevation; the left side is laid out mirrored (front on the left of the image)."""
    def px(y, z):
        u = (y + L / 2) / L
        return (1 - u if left else u) * W, (1 - (z - Z0) / ZH) * H
    img = Image.new("RGB", (W, H), YELLOW)
    d = ImageDraw.Draw(img)
    # pinstripe on the character line (z ~0.80 m), door gaps leave it broken naturally on the doors
    _, yb = px(0, 0.80)
    xa, xb = sorted((px(-2.05, 0)[0], px(1.95, 0)[0]))
    d.rectangle([xa, yb - 3, xb, yb + 3], fill=(18, 18, 18))
    # "TAXI" on the front door (y -0.06..0.92 -> centre 0.43), cap height 16 cm, centred at z 0.66
    f = ImageFont.truetype(FONT_B, int(0.16 * H / ZH * 1.38))
    cx, cy = px(0.43, 0.66)
    d.text((cx, cy), "TAXI", font=f, fill=(15, 15, 15), anchor="mm")
    # medallion-style number on the rear quarter (fictional)
    f2 = ImageFont.truetype(FONT_B, int(0.09 * H / ZH * 1.38))
    cx, cy = px(-1.72, 0.92)
    d.text((cx, cy), "7J24", font=f2, fill=(15, 15, 15), anchor="mm")
    # fare decal on the rear door (y -0.98..-0.08): white panel, black border and lines of small type
    (xa, y0), (xb, y1) = px(-0.78, 0.92), px(-0.28, 0.56)
    x0, x1 = sorted((xa, xb))
    d.rectangle([x0, y0, x1, y1], fill=(250, 250, 248), outline=(20, 20, 20), width=4)
    fs = ImageFont.truetype(FONT_B, 26)
    fr = ImageFont.truetype(FONT, 20)
    d.text(((x0 + x1) / 2, y0 + 26), "RATE OF FARE", font=fs, fill=(20, 20, 20), anchor="mm")
    lines = ["Initial charge  $3.00", "Per 1/5 mile  $0.70", "Per minute slow  $0.70", "Night / peak surcharges apply"]
    for i, t in enumerate(lines):
        d.text((x0 + 18, y0 + 58 + i * 34), t, font=fr, fill=(30, 30, 30), anchor="lm")
    return img


if __name__ == "__main__":
    main()
