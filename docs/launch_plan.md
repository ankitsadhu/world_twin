# Tomorrow: the best version of the first five games, then deploy

State today (2026-10-10): 20+ games and missions exist (16 on the map, 50 wolves, 3 boat courses, rallies, a taxi job...), `predeploy_check.py` says READY TO DEPLOY,
**45 files are uncommitted**, the first load is **~72 MB** (185 requests), and nothing has been played by a stranger yet.

## 0. First thing tomorrow (30 min): commit and protect
- Commit today's work in 5-6 logical commits (engine/physics, levels + missions, races + ghosts, boats + sky, world + map, docs/art briefs) and push `main`. Tag `pre-polish`.
- Player-facing text must not name other games (done for the welcome tile: "Crazy-Taxi" -> "Beat-the-clock"); keep the references in internal docs only (trademark risk).

## 1. The five to make excellent (and why these)
Pick the five that give: a front door, a viral moment, a reason to return, a thrill, and a reason to explore the big map.
| # | Game | Role | Why it earns a launch slot |
|---|---|---|---|
| 1 | **First Ride** (guided chaos run) | the front door | the first 60 seconds decide everything; chaos chain + crash highlight clip |
| 2 | **Stunt Park** | the viral moment | ramps and 29 props produce clips with no explanation needed |
| 3 | **Time Trial** (street race + ghost + daily seed) | the reason to return | ghost, instant restart, medals, leaderboard-ready: the Trackmania loop |
| 4 | **Heat** (police chase, 1-5 stars) | the thrill | escape moments, roadblocks, police bikes: GTA/NFS without crime |
| 5 | **Wolf Hunt** (50 golden wolves) | uses the whole 12 km map | "find them all" is its own marketing; cheap; sends people downtown, to the islands |
Next drops (week 2+, already built, polish later): Crash Junction, Taxi Rush, Kart Dash, Hudson/Liberty boats, Landing/Fly-by, Rooftop Drop.

## 2. "Best version" = this checklist, per game (definition of done)
1. **Feel**: controls, camera and collisions with no surprises (bike/car/walk, keyboard + gamepad + touch). No stuck states; Retry/Restart under 2 s.
2. **Clarity**: one line of objective on screen, a goal pin, a result card with medal/score.
3. **Juice**: sound stings, camera kick, slow-mo on the big moment, popups with points.
4. **Share**: auto-highlight clip offered at the best moment + a share image (score, medal, place) + "beat my score" link (same seed).
5. **Replay value**: medals, best time/score saved, daily variation, ghost where it fits.
6. **Performance**: 60 fps on a laptop, 30 on a mid phone; no hitch when the game starts.
7. **Analytics**: start, fail, complete, quit, time, score events.
8. **Tested**: 5 fresh players, silent observation, fix the top 3 issues.
Per game, the specific work:
- **First Ride**: make bike start camera smooth (no swing), clearer prompts with icons, guaranteed first crash moment (a taxi pulls out), auto slow-mo highlight, "Save clip" + result card, then the mission picker ("Next up").
- **Stunt Park**: bigger/cleaner ramps and a landing zone, a "trick score" (air, spin, smash chain) on screen, a quarter-pipe, props that reset instantly (R), a scoreboard of best run, camera that follows the jump.
- **Time Trial**: three tracks with clear gates, ghost of your best (done) + gate deltas (done) + medal times from real playtests, daily seed, world-record ghost (needs the leaderboard), "restart" button for touch.
- **Heat**: tune cruiser speed/spawn so 1-2 stars are winnable and 4-5 are scary, minimap blips for police, siren + lights readable by day, "busted" and "escaped" cards, no unfair roadblocks.
- **Wolf Hunt**: the real wolf mascot model (art brief exists), pickup VFX/sound, a compass hint toward the nearest, region milestones (Midtown 10, Downtown 10...), a completion reward (vehicle skin).

## 3. Tomorrow's schedule (one working day)
09:00 commit + push, baseline playtest recording of all five (30 min)
09:30-11:30 First Ride + Stunt Park polish
11:30-13:30 Time Trial + share card/result card (shared by all five)
14:30-16:00 Heat + Wolf Hunt
16:00-17:00 Performance pass on the first load and on a phone (see §4)
17:00-18:00 Playtest with 3 people, fix the worst issues, tag `rc-1`

## 4. Deploy plan
### 4.1 What ships (measured today)
Static site: `viewer/` (0.9 MB) + `export/` (56 MB) + `config/` + the used parts of `data/` (the viewer fetched ~5 MB from `data/`, not the 370 MB on disk)
+ `blender/library` (12 MB; the viewer loads props from it). **First load: 72 MB uncompressed, 185 requests.** That is too heavy for "playable in 8 s on 4G".
Before launch, in this order:
1. **Brotli/gzip everything text/glb** at the CDN (glb is already Draco in most files; json compresses ~10x).
2. **Stage the load**: show the hero view as soon as terrain + buildings (`times_square`, ~33 MB) arrive; stream harbour (8 MB + 3 MB data), characters (8 MB), vehicles (3 MB), props library in the background; the welcome card is playable once the city + bike are in.
3. Textures to **KTX2/WebP** (`export/textures` 1.8 MB is fine; `times_square` has the bulk: check `shrink_textures.py`).
4. Long cache for hashed files, **no-cache for `index.html`, `*.js`, `*.json`** (stale-module rule).
Target: first interactive < 10 s on 4G, < 3 s repeat visit (cached).
### 4.2 Hosting (GCP first, per `docs/architecture.md`)
- **Phase A (launch): static only.** Cloud Storage bucket + Cloud CDN behind an HTTPS load balancer (or Firebase Hosting for the shortest path; same cost class, fewer steps). Custom domain + managed cert. Nothing else running.
- **Phase B (after the first players): the one API container** (Cloud Run) + Postgres (Cloud SQL, smallest) for: leaderboard + daily seed, analytics ingest, checkout. Endpoints: `POST /events` (the analytics beacon), `GET/POST /scores`, `GET /daily`. Everything else stays static. (Money rule: only property/billboard purchase touches money.)
- Estimated cost: static ~ $5-20/month at launch traffic (CDN egress dominates: 72 MB x visitors, which is why §4.1 matters); Phase B ~ $25-45/month.
### 4.3 Steps
1. Create GCP project, bucket, CDN, domain, cert (or Firebase Hosting). Redirect www.
2. `python scripts/tools/predeploy_check.py` (passes now) + a new check: bundle size/requests budget, no `?debug` handle, no localhost URLs.
3. Build the publish folder (script): copy `viewer`, `export`, `config`, needed `data` + `blender/library`; hash filenames for assets; set headers; upload with `gsutil -m rsync`.
4. **Staging URL** first (password-less but unlisted); run the 8-point checklist on desktop Chrome/Safari/Firefox and an iPhone + a mid Android.
5. Analytics: set `window.__analyticsUrl` (already read by `analytics.js`) once `/events` exists; until then events stay in the browser.
6. Legal pages: privacy (anonymous id, analytics, local storage), terms, contact `support@neonblox.com` (set in `config/world.json`), cookie notice (only essential storage).
7. Monitoring: error reporting (window.onerror -> `/events`), uptime check, budget alert on the GCP billing account.
8. Kill switches by config: Rough contact default OFF on the public site (already), a `flags.json` that can disable a mission without a deploy.
9. Rollback: keep the previous bundle in `releases/<tag>/`; switching = repoint the bucket path / redeploy previous tag.
### 4.4 Rollout
Day 0 staging -> Day 1 five-person playtest -> Day 2 soft launch (100-300 people: r/WebGames, driving/GTA Discords, a TikTok/X clip of the Stunt Park) -> measure 7 days (first-crash %, session length, D1, clip shares) -> decision rule in `docs/game_design.md` -> weekly drop (one new mission per week from the next-five list).

## 5. Risks to watch
- 72 MB first load (biggest launch risk); phone performance unmeasured; autoplay/audio policies on iOS; MediaRecorder codecs on Safari (mp4) vs Chrome (webm); thousands of saved-state keys in localStorage (versioned keys, a Reset option); player-facing text containing other games' names; copyrighted music (none used).
