# Characters (you, NPCs, other players)

## The cast

Three women from the character agent (`cloud_env-claude-peaceful-meitner-h1ryw4/assets`). The best-looking one is
you (`PLAYER` in `avatar.js`, no picker); the others are NPCs (`NPC_IDS`). The folder's third file
(`white_tshirt_woman_hair_fixed_v3.glb`, the old stylised one with the detached head) is not used.

| id | Role | Look | Game file |
|---|---|---|---|
| `leather` | **You** | Black top, leather trousers, gold necklace and earrings (realistic) | `export/characters/woman_leather.glb` |
| `jeans` | NPC | White tee, flared jeans (realistic) | `export/characters/woman_jeans.glb` |
| `leather_shorts` | You (outfit) | The same woman in leather shorts, mid-thigh (Settings › Controls › Outfit) | `export/characters/woman_leather_shorts.glb` |
| `jeans_hotpants` | NPC | The jeans woman in frayed denim hot pants | `export/characters/woman_jeans_hotpants.glb` |
| `red_dress` | NPC | Red strappy dress, tattoos, gold necklace (realistic; `~/Downloads/baddie_girl_red_dress (1).glb`) | `export/characters/woman_red_dress.glb` |

### Round 2 (2026-10-03 / 04 deliveries): Mei, Daniel, accessories, riding

| id | Role | Look | Game file |
|---|---|---|---|
| `mei` | NPC | East Asian woman, black bob, light linen A-line summer dress (tinted per person) | `export/characters/woman_mei.glb` (+ `_far`) |
| `daniel` | NPC (weight 2: about 3 in 10 people) | Latino man, early 30s, athletic, grey tee + straight jeans; built on the women's rig at x1.10, so the same procedural gait works | `export/characters/man_daniel.glb` (+ `_far`) |

- **Same pipeline:** `game_ready.py`. Their hair is already inside the budget, so it is **not** thinned like the first three
  women's 112k-triangle strand hair (> 40k polygons: thinned as before; 15k–40k: gentle trim of the ribbons; below that: kept).
  Mei: 31.8k tris near / 10.7k far. Daniel: 24.1k / 8.1k.
- **Accessories** (`acc_<kind>__<id>.glb`: the rig + the accessory only, skinned to the same 19 bones, so `Avatar.wear()` rebinds
  them to the avatar's skeleton by bone name and they follow every pose, riding included):
  - `sunglasses_aviator` (13 KB): about 1 in 4 NPCs; a Settings switch for you.
  - `cap_baseball` (0.4 MB): your Settings switch. The cap swaps `HAIR` for the file's `HAIR_CAP` (her hair cut just under the rim).
  - `jacket_denim` (1.4 MB): your Settings switch. Light denim, tinted mid-blue as in the artist's renders (`Avatar.ACC_TINT`).
  - Jacket and cap are loaded the first time they're switched on. Only `leather` has them in the game today
    (`export/characters/acc_*__leather.glb`); copy the others from `cloud_env/deliveries/` when more people become playable.
  - **Cosmetic only:** nothing to buy (money rule).
- **Riding:** `ride_pose_woman.glb` / `ride_pose_man.glb` hold the rig with the `Pose_Ride` action (hips on the seat, hands on
  the grips, feet on the pegs), authored in the bike's frame. See `vehicles.md` (Motorcycle).

## Outfit variants (`make_shorts.py`)

`scripts/blender/characters/make_shorts.py <in.glb> <out.glb> <z_mid> <rise>` turns trousers into shorts and keeps the
person, rig, cloth texture and skin weights:
- **The cut:** each leg is cut on a slant, higher at the outer hip like real shorts.
  - **Hot pants:** `0.735 0.30`, about 3 cm inseam; the cut edge reads as frayed denim.
  - **Shorts:** `0.60 0.08`, mid-thigh.
- **The hem:** the open seams are welded first, then the outside and lining rings are bridged into a closed hem.
- **The legs:** the bare legs are the character's own skin. `game_ready.py` keeps skin that nothing covers any more.
- **Next step:** run `game_ready.py` on the result.

## Making them game-ready

`scripts/blender/characters/game_ready.py <in.glb> <out.glb>` takes each from ~160k to ~34k triangles and from 4 MB to 0.8 MB:

- **Clean-up:** drops the stray helper Icosphere.
- **Hair:** 1,652 alpha-cut strands become 36% of the strands with a gentle collapse (112k → 13k tris). A hard decimate of every strand turns them into spikes.
- **Seams:** welds the clothes' open panel edges only (welding everything collapses a hem's inner/outer layers into torn patches). They are shells cut into panels with duplicate vertices, which tear into see-through slits when the legs swing.
- **Hidden skin:** deletes the skin under the clothes and shoes: a ray straight out along the skin's normal hits cloth within 6 cm, or the skin pokes through tight cloth directly beneath it (a plain nearest-point test also ate the skin beside thin dress straps, leaving black holes), keeping a band at the waistline and along the openings. Without this, skin pokes through behind the knees.
- **Detail removed:** drops the jeans' stitch threads (the normal map has them).
- **Reductions:** the body to 47%, the shoes to 45%; textures capped at 1024 px; Draco.

**Contract:**
- Mixamo 19-bone rig (Hips … RightHand) with the `Pose_ArmsDown` / `Pose_HandOnHip` poses;
- faces −Y in Blender (+Z in three.js), feet at 0;
- 1.63 m tall;
- ≤ 35k triangles.

## In the game: `viewer/js/avatar.js`

**One `Avatar` class for everyone.** Each frame, `set(x, y, z, heading, speedMs)` then `update(dt)`.

- **Gait:** procedural rotations about the body's own axes, layered on the rig's arms-down pose:
  - **Walk:** stride 1.45 m per cycle.
  - **Run:** above ~3 m/s; 2.6 m per cycle, deeper knees, bent elbows, forward lean.
  - **Standing:** breathing, weight shift, looking around.
- **Multiplayer:** a remote player is the same thing, an Avatar fed the network's position, heading and speed.

**You:**
- **Walking view:** third person (default) or first person; **V** switches.
- **Third person:**
  - The camera is 3.6 m behind your head and pulls in at walls.
  - You walk at 1.9 m/s and run at 4.6 m/s (Shift / L2), a person's speeds.
  - **Jump:** Space / gamepad Square. 3.5 m/s up under real gravity (~0.6 m high), your run speed carries through the air;
    in the air she tucks her legs and raises her arms, and her knees give on landing.
  - First person keeps the old Street View speeds.
  - The game logic still uses the camera as your eyes. `walk.applyView()` steps the camera back only to draw each frame, and `restoreEye()` puts it back.

**NPCs (`Npcs`): the city's people**
- **Who:** every character and outfit except the one you're wearing (`npcPool`), so your other outfit does show up.
  Switch outfit and anyone wearing your new one is replaced.
- **Variety:** each person gets their own clothing colour (dress, tee or top, denim shade; `TINTS`), so the same outfit
  isn't a crowd of twins.
- **How many:** the **People** slider in the menu (0–160). Until you move it, it follows the graphics setting:
  High 100, Balanced 50, Low 16. Later this is driven by the live number of players.
- **Where:** three in four on the bowtie (Broadway / 7th Ave, 42nd–47th St), the rest within ~320 m. They stroll
  straight lines that stay on the walkable plazas and sidewalks, then pause 3–12 s.
- **Cost:**
  - **Near / far:** each character has a near (~34k tris) and a far (~12k tris, 512 px) version, built with
    `game_ready.py … far`. The far one is bound to the same skeleton, so one pose drives both; it's used beyond 35 m.
  - **Draw calls:** each character is one skinned mesh, not ~19 objects.
  - **What's skipped:** people off-screen or beyond 300 m aren't drawn or posed; far ones are posed every other frame.
  - **Ground:** probed again only every 4 m walked.
  - **Measured:** 100 people at a steady 60 fps (36 in view on the bowtie).
- The old blocky stand-in crowd stays off (`crowd.setCount(0)`). Its walkable-sidewalk map still guides everyone.

## Next

- More bodies: men, older people, other skin tones.
- Accessories: glasses, masks, jackets.
- A real (mocap) walk later, with the same `set` / `update` interface.
- Sitting on the red steps.
- Getting in and out of cabs, seen in third person.
