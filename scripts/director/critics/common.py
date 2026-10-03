"""Shared context + report format for the Virtual World Director critics (headless; no bpy).

Every critic exposes `run(ctx) -> Report`. A Report has a 0-100 score split into sections and a list of
flags {level: ERROR|WARN|INFO, code, msg, target, fix, auto} that the Director ranks for the Engineer.
"""
import json
import math
import os
import sys
from dataclasses import asdict, dataclass, field

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "blender"))
import ts_common as C  # noqa: E402  (ts_common guards bpy behind HAS_BPY)


@dataclass
class Flag:
    level: str
    code: str
    msg: str
    target: str = ""
    fix: str = ""
    auto: bool = False          # Engineer may apply this without a human


@dataclass
class Report:
    critic: str
    sections: dict = field(default_factory=dict)     # name -> [score, max, note]
    flags: list = field(default_factory=list)
    extra: dict = field(default_factory=dict)

    def section(self, name, score, out_of, note=""):
        self.sections[name] = [round(max(0.0, min(out_of, score)), 1), out_of, note]

    def flag(self, level, code, msg, target="", fix="", auto=False):
        self.flags.append(Flag(level, code, msg, target, fix, auto))

    @property
    def score(self):
        got = sum(s[0] for s in self.sections.values())
        tot = sum(s[1] for s in self.sections.values()) or 1
        return round(100 * got / tot)

    def as_dict(self):
        return {"critic": self.critic, "score": self.score, "sections": self.sections,
                "flags": [asdict(f) for f in self.flags], "extra": self.extra}


class Ctx:
    """Lazy loader for every artifact the critics read."""

    def __init__(self, district_id):
        self.id = district_id
        self.district = C.load_district(district_id)
        self.world = C.load_world()
        self._cache = {}

    def _json(self, rel, default=None):
        if rel not in self._cache:
            p = C.project_path(rel)
            self._cache[rel] = json.load(open(p)) if os.path.exists(p) else default
        return self._cache[rel]

    @property
    def truth(self):
        return self._json(f"config/districts/{self.id}_truth.json", {})

    @property
    def slots(self):
        return self._json(self.district["outputs"]["slots"], {"slots": []})["slots"]

    @property
    def properties(self):
        return self._json(f"data/{self.id}/properties.json", {"properties": []})["properties"]

    @property
    def nav(self):
        return self._json(f"data/{self.id}/nav.json", {"spawns": {}, "paths": {}})

    @property
    def ground(self):
        return self._json(f"data/{self.id}/ground.json", {})

    @property
    def buildings(self):
        return self._json(f"data/{self.id}/buildings.json", {"buildings": []})["buildings"]

    @property
    def scene(self):
        return self._json(f"data/{self.id}/scene_report.json")

    @property
    def demo_brands(self):
        return self._json(f"data/{self.id}/demo_brands.json", {"hero": {}})

    def path(self, *p):
        return C.project_path(*p)

    def prop(self, obj_name):
        for p in self.properties:
            if p["object"] == obj_name:
                return p
        return None


def dist2(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))
