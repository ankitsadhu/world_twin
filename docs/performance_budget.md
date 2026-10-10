# Performance budget (a core feature, checked, not hoped for)

"No lag, fast" is a product requirement. Every change is measured against these numbers; the in-page smoke test (`?debug&selftest`) already fails below 12 fps while riding, and `?perf` shows milliseconds per system.

## Targets
| Metric | Target | Measured 2026-10-10 (desktop, local) |
|---|---|---|
| Time to playable (cold, 4G) | < 8 s | not measured on a network; local DOMContentLoaded 1.1 s |
| First-load size | < 8 MB shell, rest streamed | **71.3 MB, 195 requests** (GLB 40.9, HDR 11.7, JSON 8.7, PNG 3.9, JS 2.5) |
| Frame rate | 60 fps desktop, 30 fps floor on a mid phone | 119 to 120 fps desktop; **phone not measured** |
| Frame cost | render <= 8 ms, simulation <= 4 ms | render 3.5 ms, walk 1.0, camera view 1.0, traffic 0.4, minimap 0.8 (now 30 Hz) |
| Hitches | no frame > 50 ms in play | not measured; add long-task logging |
| Memory (30 min) | flat | not measured; soak test to write |

## Done
- Only the sky for the current time of day is loaded before the first frame (6 MB); the other (6 MB) streams in behind it.
- Minimap redraws at 30 Hz instead of every frame.
- Frame loop guarded and timed per system (`?perf`).

## Biggest wins still available (in order)
1. **Models: 41 MB of GLB.** hero.glb 9.5 MB, harbor buildings 5.6, terrain 5.6, mid_n 3.6, mid_s 2.9. Meshopt/Draco compression and splitting by distance; load the harbour and downtown only when you go there.
2. **Textures to KTX2 (Basis).** About 4 to 8x smaller on the GPU as well as on the wire.
3. **HDR skies 2K -> 1K and a compressed format** (the two skies are 12 MB for lighting that is blurred anyway).
4. **JSON 8.7 MB:** the harbour collision data is 3 MB; load it when the player nears the harbour, and quantise it.
5. **Brotli + HTTP/3 + immutable hashed files** at the CDN (needs the Vite build).
6. **Walk and camera-view cost (about 1 ms each):** look for per-frame raycasts and allocations.
7. Move traffic and NPC simulation to a worker once the phone numbers show the main thread is the limit.

## Rule for every new feature
Add its cost to `?perf` (a named system), and keep it inside the table above. A feature that does not fit is built cheaper or not shipped.
