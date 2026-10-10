"""Pre-deploy gate: run before publishing the viewer. Exits non-zero if anything would ship broken.

  .venv/bin/python scripts/tools/predeploy_check.py
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
problems, notes = [], []


def check(ok, msg):
    (notes if ok else problems).append(("OK  " if ok else "FAIL") + "  " + msg)


world = json.load(open(os.path.join(ROOT, "config/world.json")))
email = world.get("sales_contact", "")
check(bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", email or "")) and not email.endswith("example.com"),
      f"sales_contact is a real inbox (now: {email!r}); set it in config/world.json")

for d in world["districts"]:
    if not d.get("enabled"):
        continue
    for name, path in d.get("files", {}).get("chunks", {}).items():
        p = os.path.join(ROOT, path)
        check(os.path.exists(p) and os.path.getsize(p) > 1000, f"{d['id']}: {name}.glb present")
    exp = os.path.join(ROOT, "export", d["id"])
    for f in ("places.json", "slot_sales.json", "map.json", "map.png", "collision2d.json"):
        check(os.path.exists(os.path.join(exp, f)), f"{d['id']}: {f} present")
    slots = json.load(open(os.path.join(ROOT, "data", d["id"], "slots.json")))["count"]
    sales = len(json.load(open(os.path.join(exp, "slot_sales.json")))["slots"])
    mob = os.path.join(ROOT, "config", "mobile_slots.json")      # moving slots (the Hudson banner) are sold too
    mobile = len(json.load(open(mob)).get(d["id"], [])) if os.path.exists(mob) else 0
    check(slots + mobile == sales, f"{d['id']}: slot_sales.json in sync with slots.json + mobile_slots.json ({sales}/{slots}+{mobile})")

veh = os.path.join(ROOT, "export/vehicles/taxi.glb")
check(os.path.exists(veh) and os.path.getsize(veh) > 10000, "drivable cab export/vehicles/taxi.glb present")
for f in ("export/harbor/land.glb", "export/harbor/buildings.glb", "export/harbor/liberty.glb", "data/harbor/collide.json",
          "data/harbor/places.json", "export/vehicles/sightseeing_boat.glb", "data/times_square/piers.json"):
    fp = os.path.join(ROOT, f)
    check(os.path.exists(fp) and os.path.getsize(fp) > 1000, f"harbour / boat asset {f} present")
pl = os.path.join(ROOT, "export/vehicles/small_plane.glb")
check(os.path.exists(pl) and os.path.getsize(pl) > 10000, "plane export/vehicles/small_plane.glb present")

html = open(os.path.join(ROOT, "viewer/index.html")).read()
check("window.__dbg" not in html or "DEBUG = LOCAL &&" in html, "developer tools (window.__dbg, selftest, character views) are local-host only")
# nothing in the shipped viewer may offer to remove the character's clothing, in any build
bad = [f for f in [os.path.join(dp, fn) for dp, _, fns in os.walk(os.path.join(ROOT, "viewer")) for fn in fns if fn.endswith((".js", ".html"))]
       if re.search(r"remove[_ ]?cloth|hide[_ ]?cloth|undress|unclothed|\bnude\b|naked|strip[_ ]?cloth", open(f, errors="ignore").read(), re.I)]
check(not bad, "no option to remove or hide the character's clothing in the viewer" + (f" (found in {[os.path.relpath(b, ROOT) for b in bad]})" if bad else ""))
check(os.path.isdir(os.path.join(ROOT, "export_web")), "light asset tier built (python3 scripts/tools/make_web_assets.py)")
check("example.com" not in html, "no placeholder addresses hard-coded in the viewer")

rep = subprocess.run([os.path.join(ROOT, ".venv/bin/python"), "scripts/director/director.py", "--district", "times_square"],
                     cwd=ROOT, capture_output=True, text=True)
m = re.search(r"tasks: (\{.*\})", rep.stdout)
errors = eval(m.group(1)).get("ERROR", 0) if m else -1   # noqa: S307 (our own printed dict)
check(errors == 0, f"Director critics report no ERROR flags ({errors})")

print("\n".join(notes + problems))
print(f"\n{'READY TO DEPLOY' if not problems else f'{len(problems)} problem(s): not ready'}")
sys.exit(1 if problems else 0)
