"""Cap texture sizes per chunk inside the exported GLBs (run after export_district.py).

Far buildings are only ever seen from hundreds of metres away, mid buildings from across an avenue,
and normal / ORM maps are far less visible than colour, so they don't need 2048 px. Geometry (Draco)
is copied byte-for-byte; only image buffers are re-encoded (WebP). Idempotent: images already at or
under the cap are left untouched.

  python3 scripts/tools/shrink_textures.py [--district times_square]
"""
import argparse
import io
import json
import os
import struct

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# longest side, per chunk: (colour / emissive, normal / ORM)
CAPS = {"hero": (2048, 1024), "terrain": (2048, 1024), "water": (1024, 512), "props": (1024, 512),
        "mid_n": (1024, 512), "mid_s": (1024, 512), "far": (512, 256),
        "land": (512, 256), "buildings": (512, 256), "liberty": (1024, 512)}           # harbor district (seen from afar)


def read_glb(path):
    b = open(path, "rb").read()
    jlen = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jlen])
    blen = struct.unpack("<I", b[20 + jlen:24 + jlen])[0]
    return j, bytearray(b[28 + jlen:28 + jlen + blen])


def write_glb(path, j, views):
    """views: list of bytes, one per bufferView, in order; rebuilds the single binary buffer."""
    out = bytearray()
    for i, data in enumerate(views):
        while len(out) % 4:
            out.append(0)
        j["bufferViews"][i]["byteOffset"] = len(out)
        j["bufferViews"][i]["byteLength"] = len(data)
        out += data
    while len(out) % 4:
        out.append(0)
    j["buffers"][0]["byteLength"] = len(out)
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(out), 0x004E4942) + out)


def shrink(path, caps):
    j, buf = read_glb(path)
    views = [bytes(buf[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]) for v in j["bufferViews"]]
    before, after, changed = 0, 0, 0
    for im in j.get("images", []):
        if "bufferView" not in im:
            continue
        data = views[im["bufferView"]]
        img = Image.open(io.BytesIO(data))
        before += img.width * img.height
        name = (im.get("name") or "").lower()
        secondary = any(t in name for t in ("_nrm", "_nor_", "_normal", "_orm", "_rough"))
        cap = caps[1] if secondary else caps[0]
        if max(img.size) <= cap:
            after += img.width * img.height
            continue
        k = cap / max(img.size)
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
        o = io.BytesIO()
        img.save(o, "WEBP", quality=92 if secondary else 88, method=5)
        views[im["bufferView"]] = o.getvalue()
        im["mimeType"] = "image/webp"
        after += img.width * img.height
        changed += 1
    if changed:
        write_glb(path, j, views)
    return before, after, changed


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--district", default="times_square")
    a = ap.parse_args()
    for chunk, caps in CAPS.items():
        p = os.path.join(ROOT, "export", a.district, chunk + ".glb")
        if not os.path.exists(p):
            continue
        mb0 = os.path.getsize(p) / 1e6
        b, af, n = shrink(p, caps)
        print(f"{chunk:8s} {n:3d} images resized  {b / 1e6:6.1f} -> {af / 1e6:6.1f} Mpx   {mb0:5.1f} -> {os.path.getsize(p) / 1e6:5.1f} MB")
