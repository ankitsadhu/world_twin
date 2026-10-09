# Frontend performance playbook: what the big web apps do, and what we adopt

Written 2026-10-04. The goal: **the world appears fast, runs at a steady 60 fps (≥ 30 on phones), and clicks never feel late**, on a budget (`architecture.md` §16: bandwidth is our biggest cost, so every MB saved is money saved).

## 0. Where we are today (measured, local, uncompressed)

| What | Today | Notes |
|---|---|---|
| First visit download | **~60 MB**, 155 requests | 38 MB glTF, 7.7 MB JSON, 5.8 MB HDR environment, 4.1 MB PNG, 1.8 MB JPG, 1.3 MB video, 0.8 MB JavaScript |
| JavaScript | 822 KB | Unbundled, unminified modules; three.js included |
| Build tooling | None | Plain ES modules served as-is |
| Compression | None locally | The CDN will add gzip/Brotli for text, not for binary |

Targets: **first view ≤ 3 s on desktop / ≤ 6 s on a mid-range phone over 4G**; **≤ 20 MB** first visit; **≤ 250 KB** initial JS; **≈ 0 MB** for a repeat visit; INP < 200 ms; 60 / 30 fps (architecture §13).

---

## 1. What the leaders do (public engineering write-ups) → what we take

### Figma (design tool rendering huge documents in the browser)
- **What they do:**
  - the editor core is **C++ compiled to WebAssembly**, rendering with their own **GPU renderer** (WebGL, and since 2025 **WebGPU**);
  - **custom tile-based rendering**: they don't use the DOM for the canvas;
  - **incremental loading** of large files (pages load on demand).
- **What we take:**
  - **the DOM is only for UI, never the world** (we already use canvas/WebGL for the world and the maps);
  - **load on demand**: the world streams by area, the same way Figma loads pages;
  - **WebGPU** as a future render path (three.js `WebGPURenderer`), with WebGL2 fallback.
  - We don't need WebAssembly for our own code: three.js is already the right level.

### Adobe Photoshop on the web
- **What they do:**
  - a desktop C++ app compiled to **WebAssembly with SIMD and threads**, which requires **cross-origin isolation** (COOP/COEP headers for `SharedArrayBuffer`);
  - the **Origin Private File System (OPFS)** for fast local storage of big files;
  - **service worker** caching of the large app bundle, so repeat launches are instant;
  - a lightweight web-component UI (Lit).
- **What we take:**
  - **service worker caching of the 3D content**, so a repeat visit downloads close to nothing;
  - **WebAssembly decoders in workers**: the meshopt / Basis / Draco decoders three.js already ships as Wasm;
  - the COOP/COEP headers **only if** we later need `SharedArrayBuffer`. They complicate embedding Stripe, so not now.

### Google Docs / Sheets, Microsoft Excel on the web
- **What they do:**
  - **canvas rendering instead of DOM** for huge grids (Google Docs moved to canvas-based rendering);
  - **virtualisation**: only the visible rows and cells exist; everything else is data.
- **What we take:**
  - **virtualise everything that's not visible**: the crowd, traffic and props outside the view aren't simulated or drawn at full detail (partly done: distance culling, far LOD);
  - **long lists in the UI** (search results, the owner's assets, admin tables) are virtualised as well.

### Notion
- **What they do:**
  - **SQLite compiled to WebAssembly, stored in OPFS**, as a local cache of the user's data. Notion reported ~20% faster page navigation;
  - lazy-loading blocks;
  - a heavily code-split app.
- **What we take:**
  - **a local cache of live data** (the catalog) in IndexedDB/OPFS, so the item card shows instantly even before the network answers. It's revalidated by ETag: stale-while-revalidate in the browser;
  - **code-splitting**: checkout, owner portal, settings and tours load only when opened.

### Mapbox GL JS / MapLibre (maps that stream the whole planet)
- **What they do:**
  - **vector tiles in a binary format** (MVT, protobuf), never big JSON;
  - a **tile pyramid / quadtree** loaded by **viewport and zoom**, with requests **cancelled when you move away**;
  - a **Web Worker pool** parses tiles and computes layout and label collision off the main thread, handing back **transferable `ArrayBuffer`s** with zero copy;
  - GPU-only drawing; a tile cache with eviction.
- **What we take** (big wins for our 7.7 MB of JSON and our minimap):
  - **binary instead of JSON** for nav, collision, places and slots (typed arrays or FlatBuffers/MessagePack, per tile);
  - **tile everything by area**: collision and nav for the area around you, not all of Midtown;
  - **a worker pool** for parsing, collision queries, traffic and crowd steering;
  - **cancel loads** that are no longer needed (`AbortController`) when you fly or teleport away;
  - **vector or tiled maps** for the big map instead of one large image per district.

### Google Earth / Cesium (3D cities on the web)
- **What they do:**
  - **3D Tiles (OGC)**: a hierarchy of tiles refined by **screen-space error** (load a finer tile only when the coarse one would look wrong at that distance);
  - **Draco / meshopt** geometry compression and **KTX2** textures;
  - progressive refinement: something coarse appears immediately, then sharpens.
- **What we take, the core of our streaming:**
  - our near/mid/far chunks become a **screen-space-error tile tree**;
  - the **landing view** gets a coarse version first (or a pre-rendered panorama), so a visitor sees Times Square in about a second and the detail streams in.

### Web games (Unity WebGL, PlayCanvas, Babylon.js, three.js titles)
- **What they do:**
  - **GPU texture compression** (Basis/KTX2: smaller downloads *and* 4–8× less GPU memory than PNG/JPG decoded to RGBA);
  - **instancing and batching** to keep draw calls low (three.js `InstancedMesh`, `BatchedMesh`);
  - **object pooling** (no garbage-collection spikes);
  - a **fixed-timestep simulation** with interpolated rendering;
  - **device tiers** and **dynamic resolution**;
  - audio sprites; a loading screen that is itself playable.
- **What we take:**
  - all of these; instancing, crowd LOD and adaptive quality are partly done already;
  - dynamic resolution driven by frame time (we already step quality down; make it continuous);
  - pooling for cars, people and particles;
  - a fixed-timestep sim for traffic and flight.

---

## 2. The playbook for us, in priority order

Each item: **gain → effort.** Items 1–6 are the launch set.

### Download and startup
1. **Compress the 3D models (meshopt) and textures (KTX2/Basis).** `gltfpack` / `gltf-transform`, run in the pipeline export step.
   - **Gain:** glTF 38 MB → ~12–15 MB, less GPU memory, faster decode.
   - **Effort:** small (a pipeline step + `KTX2Loader` / `MeshoptDecoder` in the client).
2. **Replace the 5.8 MB HDR environment** with a pre-filtered, compressed environment (KTX2 / RGBM PNG at 512–1k) or a baked sky.
   - **Gain:** −5 MB.
   - **Effort:** small.
3. **Brotli for all text and binary JSON** at the CDN; **binary formats** for nav, collision, places and slots, split **per tile**.
   - **Gain:** 7.7 MB JSON → ~1 MB, loaded only where needed.
   - **Effort:** medium.
4. **Bundle and minify JavaScript (Vite)**; code-split by feature; lazy-load the engine after the shell; tree-shake three.js.
   - **Gain:** 822 KB → ~250 KB initial.
   - **Effort:** small.
5. **Landing view first.**
   - Preload the landing chunk with `fetchpriority="high"` + `<link rel="preload">`.
   - Show a **pre-rendered panorama of the landing view** (~200 KB) instantly, then cross-fade to live 3D.
   - Defer everything not in view: the harbour, the Intrepid, characters, video ads until after the first frame.
   - **Gain:** perceived load ~1 s.
   - **Effort:** medium.
6. **A service worker + Cache API** for content (versioned by content hash; Workbox).
   - **Gain:** repeat visits ≈ 0 MB, instant start, and **lower CDN bills**.
   - **Effort:** small.
7. **Spatial streaming with screen-space error** (the 3D Tiles idea) on top of our chunks; cancel loads on teleport.
   - **Gain:** download proportional to where you are.
   - **Effort:** larger (post-launch).

### Runtime smoothness (frame rate)
8. **A frame budget scheduler.** All non-render work (parsing, building meshes, uploading textures, AI traffic) is **time-sliced** to ≤ 4–6 ms per frame, the way React's scheduler and Figma's renderer split work.
   - **Gain:** no load hitches.
   - **Effort:** medium.
9. **Workers.**
   - glTF / texture decode (three.js loaders already use Wasm workers);
   - collision queries, traffic and crowd steering in a worker (shared typed arrays);
   - **OffscreenCanvas** rendering in a worker as an option later, which leaves the main thread entirely free for UI.
   - **Gain:** INP and frame stability.
   - **Effort:** medium to large.
10. **Draw calls and GPU work.**
    - Instancing and `BatchedMesh`, texture atlases (storefronts already are), merged static geometry per chunk;
    - frustum culling plus **distance and occlusion culling** (big buildings hide what's behind them);
    - a shadow budget (only near the camera);
    - LOD everywhere, characters included (we have near/far).
    - **Gain:** stable 60 fps.
    - **Effort:** ongoing.
11. **Memory and garbage collection.**
    - Object pools; no per-frame allocations (reuse vectors and matrices);
    - dispose meshes and textures when chunks unload;
    - a **texture memory budget** per device tier: iOS Safari kills tabs that use too much memory.
    - **Gain:** no spikes or crashes.
    - **Effort:** small to medium.
12. **Device tiers plus dynamic resolution.**
    - Pick a tier on first load (GPU name, memory, cores, a short warm-up benchmark);
    - continuously adjust the render resolution by frame time;
    - detect **thermal throttling** on phones (sustained frame-time rise) and step down early.
    - **Gain:** smooth on weak devices.
    - **Effort:** small (we have auto-quality; extend it).
13. **A fixed-timestep simulation** (vehicles, flight, boat) with interpolation.
    - **Gain:** consistent physics at any frame rate; no "faster on fast PCs".
    - **Effort:** small.

### UI responsiveness (INP)
14. **React never runs per frame** (`data_flow.md` §4): Zustand selectors; the HUD writes straight to the DOM; `startTransition` for panels; virtualised lists; code-split modals.
15. **The map and minimap as canvas tiles** (Mapbox-style). Label placement is done in a worker and cached per zoom level.
16. **Local cache of live data** (Notion-style): the catalog in IndexedDB, shown instantly and revalidated in the background.

### Network and delivery
17. **HTTP/3 + Brotli** at the CDN; **content-hashed immutable** URLs (`max-age=1y`); `no-cache` only for HTML and manifests.
18. **Preconnect / early hints** to the CDN and API origin; one origin for app and API (no CORS preflight).
19. **Request prioritisation:** a small concurrency limit for content fetches (6–8 in flight) in priority order: landing → nearby → far → harbour.

---

## 3. Measuring (so it doesn't regress)

| What | How |
|---|---|
| Real users | `web-vitals` (LCP, INP, CLS) + our `perf` analytics events: frame-time histogram, load phases, device tier, GPU name, memory; per device class (architecture §7) |
| Main-thread jank | The Long Tasks / Long Animation Frames API, reported as events |
| GPU cost | `EXT_disjoint_timer_query_webgl2` where available; renderer `info.render.calls/triangles` in debug HUD |
| Lab, every pull request | Playwright on a fixed camera path (landing → Times Square walk → Hudson flight), recording fps p50/p95, longest frame, bytes downloaded, and request count. **The build fails if any of these regress by more than 10%**, or if budgets are exceeded |
| Pages | Lighthouse CI on the share and owner pages |
| Debugging | Chrome Performance panel, Spector.js (WebGL frame capture), the three.js renderer info |

## 4. Cost link (why this is also a money doc)

Bandwidth dominates the cloud bill (architecture §16):

| | Download per visit | CDN cost at 1M visits a month |
|---|---|---|
| Today | 60 MB | ~$3.4k |
| After items 1–4 | 20 MB | ~$1.4k |
| After the service worker (item 6) | Repeat visitors download almost nothing | Lower still |

**Items 1–6 are both the biggest speed win and the biggest cost win**, and they need **no new services**: they're pipeline and client changes only.
