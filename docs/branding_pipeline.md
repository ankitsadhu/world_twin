# Branding pipeline: from a company's website to pixels in the city

The 3D files never contain a buyer's brand. They ship with placeholders and **slot IDs**. Brands are applied at
runtime from data, so a sale goes live without re-exporting anything and the scheme scales to any number of districts.

## 1. What can be sold (all listed in `data/<district>/*.json`)

| Level | Source file | Geometry in the GLB | How the game applies the brand |
|---|---|---|---|
| **Property** (a whole building) | `properties.json` | `BLD_*` node, extras `buyable`, `display_name` | Building label/map pin; bundles all of its slots below |
| **Hero slot** (billboards, curved / wrap / anamorphic screens, crown signs) | `slots.json` | its own `AD_*` mesh + material `MAT_SLOT_<id>`, UV 0..1 | Replace that material's `emissiveMap` (image or **video**) |
| **Shop-sign slot** (every storefront sign, thousands) | `sign_slots.json` | faces with material `M_ShopSign` inside `BLD_*` meshes, per-vertex attribute `_SLOT` = index + 1 | One shared shader: look up `_SLOT` in a **sign atlas** (below); unsold signs keep `default_uv` |
| **Storefront slot** (`SHOP_*` on hero buildings) | `slots.json` | like hero slots | like hero slots |

Each slot record has an `aspect` (16x9, 9x16, 1x1, 4x1, 2x1, 3x4, 8x1), a size in metres, a world `center` and
`normal` (Blender Z-up local metres; game = `(x, z, -y)`), `tier`, and `status`.

## 2. Getting a logo from a website (backend job)

1. Buyer enters a URL. Fetch the site server-side and pick logo candidates in this order:
   `<link rel="icon" type="image/svg+xml">`, then `apple-touch-icon`, then the largest icon in the web app
   manifest, then `og:image`. Optionally use a brand API (e.g. Brandfetch) behind a feature flag.
2. **The buyer confirms or uploads their own file.** Always offer this: auto-fetched logos are a suggestion, never
   final. Check that they own the domain with a DNS TXT record or an email to the domain.
3. Moderation: queue for review, NSFW/trademark checks, and no impersonation.
4. Render each slot's art at its aspect ratio: logo fitted inside the safe area (90%), background colour taken from
   the site's `theme-color` or the dominant logo colour, optional tagline. Output WebP + KTX2 (UASTC) at
   1024 px on the long side for hero slots and 256x64 for shop signs.

## 3. Runtime data the game loads

```jsonc
// GET /api/districts/times_square/brands   (cached by CDN, invalidated on each sale)
{
  "hero": { "ts.1tsq.ad03": { "image": "https://cdn/.../ad03.ktx2", "video": null, "link": "https://acme.com",
                              "name": "Acme" } },
  "signs": { "atlas": ["https://cdn/.../signs_0.ktx2"],          // 4096 px pages, 256x64 cells (1024 per page)
             "cells": { "1532": [0, 17] } },                       // sign index -> [page, cell]
  "properties": { "times_square.1022581": { "owner": "Acme", "label": "Acme Tower", "link": "https://acme.com" } }
}
```

- **Hero slots:** load the texture and assign it to `MAT_SLOT_<id>.emissiveMap`. Clicks raycast to `AD_*` and read
  `slot_id` from `userData` (glTF extras), then open `link`.
- **Shop signs:** one `ShaderMaterial` for `M_ShopSign` reads attribute `_SLOT`. A small data texture maps
  index to atlas cell (or -1 for unsold, which falls back to the baked default UV). Clicks raycast the building
  mesh, read the hit face's `_SLOT` and map it to a `slot_id`.
- **Property labels:** HTML/CSS2D labels anchored at `properties.json` `center`. They only show when nearby.

## 4. Why this scales

- New sale = a data change and one image upload. **No 3D re-export.**
- 10,000+ shop signs = 1 material, 1–2 atlas pages, zero extra draw calls.
- New district = new manifest, run the pipeline, and the same JSON schema works with no game code changes.
- Slot IDs are stable (`<district>.<building bin>.<slot>`). Rebuilding the geometry keeps ownership intact
  because IDs derive from NYC BINs and hero script keys, not from object order.
