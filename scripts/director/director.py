"""Virtual World Director: runs the four critics, merges + ranks their flags, writes reports.

Usage (project venv):
  .venv/bin/python scripts/director/director.py --district times_square
  .venv/bin/python scripts/director/director.py --district times_square --only business
Before running, refresh the Blender snapshot: run scripts/director/scene_report.py inside Blender.
Reports: scripts/director/reports/<district>_<YYYYMMDD>.md and .json (the viewer can overlay the JSON).
"""
import argparse
import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "critics"))
import business_critic  # noqa: E402
import engineer_critic  # noqa: E402
import nyc_critic  # noqa: E402
import ux_critic  # noqa: E402
from common import Ctx  # noqa: E402

CRITICS = {"engineer": engineer_critic, "ux": ux_critic, "nyc": nyc_critic, "business": business_critic}
# priority order from docs/critic_roles.md
RANK = [("engineer", "ERROR"), ("ux", "ERROR"), ("nyc", "ERROR"), ("business", "WARN"), ("business", "ERROR"),
        ("nyc", "WARN"), ("ux", "WARN"), ("engineer", "WARN"), ("nyc", "INFO"), ("ux", "INFO"),
        ("business", "INFO"), ("engineer", "INFO")]


def rank(key, level):
    return RANK.index((key, level)) if (key, level) in RANK else len(RANK)


def markdown(district, reports, tasks):
    out = [f"# Director report: {district}", f"_{datetime.datetime.now():%Y-%m-%d %H:%M}_", "",
           "| Critic | Score |", "|---|---|"]
    out += [f"| {r['critic']} | **{r['score']} / 100** |" for r in reports.values()]
    for r in reports.values():
        out += ["", f"## {r['critic']}: {r['score']} / 100", ""]
        out += [f"- **{k}** {v[0]:g} / {v[1]}" + (f": {v[2]}" if v[2] else "") for k, v in r["sections"].items()]
    biz = reports.get("business")
    if biz and biz["extra"].get("cards"):
        out += ["", "### Ad inventory", "", f"Bands: {biz['extra']['bands']}", "",
                "| Slot | Building | Aspect | z | Composite | Band | Est. daily impressions |", "|---|---|---|---|---|---|---|"]
        for c in biz["extra"]["cards"][:15]:
            out.append(f"| {c['slot_id']} | {c['building']} | {c['aspect']} | {c['z_m']} | {c['composite']} | "
                       f"{c['band']} | {c['est_daily_impressions']:,} |")
    out += ["", "## Engineer task list (ranked)", ""]
    for i, t in enumerate(tasks, 1):
        auto = " `auto`" if t["auto"] else ""
        out.append(f"{i}. **[{t['level']}] {t['critic']} · {t['code']}**{auto}: {t['msg']}"
                   + (f"  \n   → {t['fix']}" if t["fix"] else ""))
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--district", default="times_square")
    ap.add_argument("--only", choices=list(CRITICS))
    a = ap.parse_args()
    ctx = Ctx(a.district)
    reports = {}
    for key, mod in CRITICS.items():
        if a.only and key != a.only:
            continue
        reports[key] = mod.run(ctx).as_dict()
    tasks = []
    for key, r in reports.items():
        for f in r["flags"]:
            tasks.append({"critic": key, **f})
    tasks.sort(key=lambda t: (rank(t["critic"], t["level"]), t["code"]))
    out_dir = os.path.join(HERE, "reports")
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.join(out_dir, f"{a.district}_{datetime.date.today():%Y%m%d}")
    with open(stem + ".json", "w") as fh:
        json.dump({"district": a.district, "reports": reports, "tasks": tasks}, fh, indent=1)
    with open(stem + ".md", "w") as fh:
        fh.write(markdown(a.district, reports, tasks))
    for r in reports.values():
        print(f"{r['critic']:<24} {r['score']:>3} / 100   " +
              "  ".join(f"{k} {v[0]:g}/{v[1]}" for k, v in r["sections"].items()))
    lv = {}
    for t in tasks:
        lv[t["level"]] = lv.get(t["level"], 0) + 1
    print(f"tasks: {lv}  ->  {stem}.md")


if __name__ == "__main__":
    main()
