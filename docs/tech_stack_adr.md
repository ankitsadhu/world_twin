# ADR: client tech stack and delivery for a no-lag browser game (2026-10-10)

Context: neonblox.com, single-player today, multiplayer later, GCP first (free credits for 3 months), Terraform kept ready, portable to AWS/Azure (`architecture.md` §3). The game is a real-scale city with traffic, crowds and vehicles; players notice dropped frames and long loads far more than anything else.

## What "lag" means here, and where it comes from
| Kind | Cause in this game | Fix lives in |
|---|---|---|
| Slow start | 72 MB / 185 requests before play | asset pipeline + CDN (section 3) |
| Frame drops | main-thread JS (traffic, 100 NPCs, props physics, dents) + draw calls + GPU fill on phones | budgets, workers, LOD (section 2) |
| Hitches | garbage collection, shader compiles, model loads mid-play | pooling, pre-warm, staged loading |
| Input lag | frame time, plus a server round trip once multiplayer exists | client prediction, region (section 4) |

Today there is no server in the play loop, so single-player has **no network lag at all**. Everything is local frame time and load time. Keep it that way as long as possible.

## 1. Decisions

| Layer | Decision | Why |
|---|---|---|
| Engine | **Keep three.js.** Do not rewrite in Unity/Godot/Babylon/PlayCanvas. | 12 k lines of working game code on it; a WebGL2 build today, WebGPU renderer path later (three supports both); smallest download of the options (Unity WebGL builds start at 10 to 30 MB of runtime). |
| Language | **Move to TypeScript**, module by module, starting with new files and the shared types (vehicle, NPC, mission). | The bugs we hit (init order, renamed DOM ids, wrong property names) are what types catch. No runtime cost. |
| Build | **Vite** (ESM, hashed filenames, code splitting, brotli at build). | Replaces hand-served files; gives cache-safe hashed URLs so we can turn caching on; splits the shell from the rest. |
| Assets | glTF with **meshopt or Draco** geometry, **KTX2/Basis** textures, one atlas per district chunk, LODs. | Cuts download and GPU memory roughly 4 to 8x on textures; mid phones keep far more in memory. |
| Physics | **Keep our own** vehicle model and obstacle index. Add **Rapier (WASM)** only if rigid-body props or ragdolls become a bottleneck. | Custom code is cheap and tuned; Rapier adds ~1 MB and a worker boundary we do not need yet. |
| Simulation | Run **traffic AI and NPC simulation in a Web Worker**, with `SharedArrayBuffer` position buffers; main thread only renders and applies. | The biggest main-thread cost after rendering; frees the frame for 60 fps on phones. Needs `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers (set at the CDN). |
| Rendering | Instancing for everything repeated (already for traffic, crowd far LOD); **`OffscreenCanvas` in a worker is optional later**, not now. | Draw calls and shader cost dominate on phones, not JS. |
| Audio | Keep Web Audio; load audio after first input (browsers need the gesture anyway). | |
| State | A small typed event bus plus plain objects; **no framework** for the HUD (the HUD is ~10 elements). | A UI framework would cost bytes and frame time for no gain. |
| Telemetry | Keep the analytics funnel; add frame-time and long-task percentiles (p50/p95 fps, load time) by device class. | The only way to know a real player is lagging. |

## 2. Frame budget (the thing that actually prevents lag)
Targets: **60 fps desktop, 30 fps floor on a mid phone (about 4 years old), thermal-stable for 10 minutes.**
- Per frame at 60 fps = 16.6 ms: render <= 8 ms, simulation <= 4 ms, UI + audio <= 1 ms, headroom 3 ms.
- Current desktop numbers (`?perf`, 2026-10-10): 119 fps; render 3.8 ms, walk 1.8 ms, camera view 1.2 ms, minimap 0.8 ms, traffic 0.35 ms. Desktop is fine. **No phone numbers yet; this is the first thing to measure.**
- Automatic quality (already present) steps resolution and effects down on slow frames; extend it to crowd size and traffic count (the population director reads the same signal).
- Pre-warm shaders and the first vehicle model before "Play" so the first jump is smooth; never load a model synchronously mid-drive.

## 3. Delivery (load time)
- Target: **playable shell under 8 MB** (engine, HUD, one district chunk near spawn, one bike, low-res textures); stream the rest after first input.
- Brotli everywhere; HTTP/3; immutable cache for hashed files; `no-cache` only for `index.html` and the manifest (existing rule).
- **CDN choice (money matters).** GCP egress and Cloud CDN are billed by the GB; a 72 MB first load times thousands of players adds up fast. Put **Cloudflare (free plan) in front of the GCS bucket** as the CDN: free egress, global PoPs, and it keeps us portable. Cloud CDN stays an option.
- Service worker caches the shell and the district chunks so the second visit starts in about a second.

## 4. Backend and multiplayer (later)
- Now: the existing plan stands: **one API container (Cloud Run), one Postgres, one bucket + CDN.** Single-player needs only analytics, ownership and orders.
- Cloud SQL is the one thing not covered by "free"; use the smallest instance, or a managed free-tier Postgres, behind the same connection string (portable).
- Multiplayer is a different workload: stateful game servers, not Cloud Run. When it comes: **WebSocket (then WebTransport) game servers**, authoritative at 20 to 30 Hz with client prediction and interpolation, one region (us-east, near New York) first. Candidates: Colyseus or Nakama on a small VM/GKE node; Agones if we need fleets. Do not build it before single-player retention is proven (`launch_plan.md`).

## 5. Terraform shape (keep it ready, apply later)
```
infra/
  modules/   bucket_cdn   (GCS bucket, backend bucket, headers)    cloud_run (API image, min instances 0)
             postgres     (Cloud SQL smallest, private IP)          dns       (neonblox.com records)
             secrets      (Secret Manager)                          monitoring (uptime, error-rate alert)
  gcp/       main.tf uses the modules; variables: project, region, domain, env
  aws/ azure/   same module names, other providers (stubs, not applied)
```
Rules: remote state in a bucket; one workspace per env (`staging`, `prod`); nothing created by hand in the console; the build id (git SHA) is a variable so a deploy is "new bucket prefix + switch".

## 6. Order of work
1. Measure on two real phones (load time, fps, heat) with `?perf` and the smoke test. (This decides how aggressive everything below must be.)
2. Vite + hashed assets + brotli; split the shell from district chunks; KTX2/meshopt pass on the heaviest assets.
3. Terraform for the bucket, CDN headers, DNS and the API container; deploy staging to a GCP subdomain.
4. Move traffic and NPC simulation into a worker (behind a flag; compare `?perf` before and after).
5. TypeScript for new modules and the shared types; convert old modules when touched.
6. Frame-time and load-time telemetry by device class; set alerts.

## 7. What we are deliberately not doing
- Rewriting the game in another engine.
- A UI framework for the HUD.
- A game server before there is a reason to have two players in one world.
- Always-on services beyond the three in `architecture.md` without a written cost.
