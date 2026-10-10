"""Makes the LIGHT asset tier: smaller copies of the district chunks for phones and slow connections.

  python3 scripts/tools/make_web_assets.py [--district times_square] [--district harbor]

Non-destructive by design: the originals in export/<district>/ are never touched. Light copies go to export_web/<district>/ and the game uses them only
when the asset tier is "light" (automatic on phones and Low graphics; or Settings > Display > Asset quality, or ?assets=light). "Full" (or ?assets=full)
always loads the originals, so full quality is one switch away. Delete export_web/ at any time and the game simply uses the originals.
Only the images inside each GLB are re-encoded (smaller WebP); geometry (Draco) is copied byte for byte.
"""
import argparse, io, json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from shrink_textures import read_glb, write_glb, ROOT

# longest side per chunk: (colour / emissive, normal / ORM). Roughly half of the full tier (see CAPS in shrink_textures.py).
LIGHT = {"hero": (1024, 512), "terrain": (1024, 512), "water": (512, 256), "props": (512, 256), "mid_n": (512, 256), "mid_s": (512, 256),
         "far": (256, 128), "land": (256, 128), "buildings": (256, 128), "liberty": (512, 256)}
QUALITY = 80

def light(src, dst, caps):
    j, buf = read_glb(src)
    views = [bytes(buf[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]) for v in j["bufferViews"]]
    for im in j.get("images", []):
        if "bufferView" not in im: continue
        img = Image.open(io.BytesIO(views[im["bufferView"]]))
        name = (im.get("name") or "").lower()
        cap = caps[1] if any(t in name for t in ("_nrm", "_nor_", "_normal", "_orm", "_rough")) else caps[0]
        if max(img.size) > cap:
            k = cap / max(img.size); img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
        if img.mode not in ("RGB", "RGBA"): img = img.convert("RGBA" if "A" in img.mode else "RGB")
        o = io.BytesIO(); img.save(o, "WEBP", quality=QUALITY, method=5)
        if len(o.getvalue()) < len(views[im["bufferView"]]):
            views[im["bufferView"]] = o.getvalue(); im["mimeType"] = "image/webp"
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    write_glb(dst, j, views)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--district", action="append")
    a = ap.parse_args(); tot0 = tot1 = 0
    for d in a.district or ["times_square", "harbor"]:
        for chunk, caps in LIGHT.items():
            s = os.path.join(ROOT, "export", d, chunk + ".glb")
            if not os.path.exists(s): continue
            t = os.path.join(ROOT, "export_web", d, chunk + ".glb"); light(s, t, caps)
            m0, m1 = os.path.getsize(s) / 1e6, os.path.getsize(t) / 1e6; tot0 += m0; tot1 += m1
            print(f"{d}/{chunk:10s} {m0:6.2f} -> {m1:6.2f} MB")
    print(f"TOTAL {tot0:.1f} -> {tot1:.1f} MB ({100 * tot1 / max(tot0, 1e-9):.0f}%)")
