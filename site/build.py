#!/usr/bin/env python3
"""Builds the neonblox.com marketing + legal site (plain static HTML, no framework) into site/dist.

  python3 build.py            build; unfinished business fields show as red TODO on the page
  python3 build.py --release  same, but FAIL if any TODO is left (run this before deploying or submitting to a payment reviewer)

Content lives in pages/*.html (fragments with {{business.x}} fields), the business facts in business.json, the look in assets/site.css.
"""
import json, re, shutil, sys, html, pathlib
ROOT = pathlib.Path(__file__).parent
B = json.loads((ROOT / "business.json").read_text())
RELEASE = "--release" in sys.argv
NAV = [("index", "Home"), ("buy", "Buy a slot"), ("how-it-works", "How it works"), ("about", "About"), ("contact", "Contact")]
LEGAL = [("privacy", "Privacy"), ("terms", "Terms"), ("refund-policy", "Refund policy"), ("delivery", "Delivery")]
TITLES = {"index": "Own a place in Times Square", "buy": "Buy a slot", "how-it-works": "How it works", "about": "About", "contact": "Contact",
          "privacy": "Privacy Policy", "terms": "Terms of Service", "refund-policy": "Refund and Cancellation Policy", "delivery": "Delivery Policy"}
todos = []

def field(m):
    key = m.group(1).strip(); v = B.get(key)
    if v is None: raise SystemExit(f"unknown business field: {key}")
    if str(v).upper() == "TODO": todos.append(key); return f'<span class="todo">[TODO: {key}]</span>'
    return html.escape(str(v))

def layout(slug, body):
    nav = "".join(f'<a href="{s}.html"{" aria-current=page" if s == slug else ""}>{t}</a>' for s, t in NAV)
    foot = "".join(f'<a href="{s}.html">{t}</a>' for s, t in LEGAL)
    title = TITLES[slug] + ("" if slug == "index" else f" | {B['brand']}")
    if slug == "index": title = f"{B['brand']}: {TITLES[slug]}"
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title><meta name="description" content="Play a real-scale Times Square in your browser, and own a permanent place in it: a billboard, a screen or a building.">
<link rel="stylesheet" href="assets/site.css"></head><body>
<header class="site"><div class="wrap"><a class="logo" href="index.html">NEON<b>BLOX</b></a><nav>{nav}<a href="play/">Play</a></nav></div></header>
<main>{body}</main>
<footer class="site"><div class="wrap"><div><strong>{html.escape(B['brand'])}</strong><br>{{{{business.legal_name}}}}<br>{{{{business.registered_address}}}}<br>
<a href="mailto:{B['support_email']}">{B['support_email']}</a> · {{{{business.phone}}}}</div>
<div class="cols">{foot}</div></div><div class="wrap" style="margin-top:14px"><span>© 2026 {html.escape(B['brand'])}. Times Square is a real place; this is an independent game and is not affiliated with or endorsed by any building, brand or owner shown in it.</span></div></footer></body></html>"""

def build():
    out = ROOT / "dist"; shutil.rmtree(out, ignore_errors=True); (out / "assets").mkdir(parents=True)
    shutil.copy(ROOT / "assets/site.css", out / "assets/site.css")
    for slug in TITLES:
        frag = (ROOT / "pages" / f"{slug}.html").read_text()
        page = layout(slug, frag if slug in ("index", "buy", "how-it-works", "about", "contact") else f'<div class="wrap"><article class="legal">{frag}</article></div>')
        page = re.sub(r"\{\{business\.([a-z_]+)\}\}", field, page)
        (out / f"{slug}.html").write_text(page)
    (out / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: https://{B['domain']}/sitemap.xml\n")
    (out / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f"<url><loc>https://{B['domain']}/{'' if s == 'index' else s + '.html'}</loc></url>" for s in TITLES) + "</urlset>")
    print(f"built {len(TITLES)} pages -> {out}")
    uniq = sorted(set(todos))
    if uniq:
        print("UNFINISHED business fields:", ", ".join(uniq))
        if RELEASE: raise SystemExit("release build refused: fill these in site/business.json")
    else: print("no TODOs left: ready to deploy")

build()
