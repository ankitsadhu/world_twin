// The cruiser motorcycle (export/vehicles/motorbike_cruiser.glb, from the character agent's Blender build): a V-twin
// chopper with a rigid hierarchy: BIKE > FRAME_BODY, STEER (the fork, on its raked axis) > FORK / HANDLEBARS / HEADLIGHT /
// FRONT_FENDER / WHEEL_FRONT, WHEEL_REAR, KICKSTAND; anchors SEAT_ANCHOR, FOOT_L/R, GRIP_L/R; COL_* collision proxies
// (hidden). Facing +Z, feet on y = 0, 1.65 m wheelbase, wheel radius 0.335 m.
// This module only knows the bike itself (parts, lean, steer, kickstand, the rider on it); ride.js drives it.
import * as THREE from "three";
import { makeBlob } from "./shadow.js";

const WHEEL_R = 0.335, WHEELBASE = 1.65;
const PARKED_LEAN = -0.14;                                          // the "Parked" action: 8 degrees onto the kickstand (left)
const STAND_DOWN = new THREE.Quaternion(0, 0, 0, 1);
const STAND_UP = new THREE.Quaternion(0.143, 0.553, -0.763, 0.301);   // the end of the "Stand_Up" action: folded away
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
// the paints a cruiser comes in (the tank and the front fender; chrome, leather and rubber stay as they are)
export const PAINTS = [                                      // best-looking first: the street takes colours from the top of this list
  { name: "Candy red", hex: 0xc9142b }, { name: "Midnight black", hex: 0x16171c }, { name: "Racing blue", hex: 0x1668d6 }, { name: "Pearl white", hex: 0xf2f3f5 },
  { name: "Sunset orange", hex: 0xf06a14 }, { name: "British green", hex: 0x1d5a3a }, { name: "Teal", hex: 0x0f9d9a }, { name: "Lemon yellow", hex: 0xf2c80f },
  { name: "Violet", hex: 0x6c3bd1 }, { name: "Gunmetal", hex: 0x4a505c }, { name: "Hot pink", hex: 0xe8398f }, { name: "Army green", hex: 0x5c6b3c },
];
export const BIKE = { wheelbase: WHEELBASE, wheelR: WHEEL_R, type: "Cruiser" };

export class Bikes {
  constructor({ loader, root, registerMaterial }) {
    Object.assign(this, { loader, root, registerMaterial });
    this.ready = this.load();
  }

  async load() {
    const L = f => this.loader.loadAsync(this.root + f);
    const [g, wc, mc] = await Promise.all([L("export/vehicles/motorbike_cruiser.glb"),
      L("export/characters/ride_pose_woman.glb"), L("export/characters/ride_pose_man.glb")]);
    g.scene.traverse(o => {
      if (/^COL_/.test(o.name)) { o.visible = false; return; }          // collision proxies: never drawn
      if (!o.isMesh) return;
      o.castShadow = true; o.userData.ride = true;
      for (const m of [].concat(o.material)) {
        if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = 0.35; m.depthWrite = false; }
        this.registerMaterial?.(m);
      }
    });
    this.tpl = g.scene;
    this.clips = { woman: wc.animations.find(a => a.name === "Pose_Ride"), man: mc.animations.find(a => a.name === "Pose_Ride") };
  }

  // a new bike: { group (position = on the ground, rotation = heading), model (BIKE: leans), parts, kind: "bike" }
  make() {
    const group = new THREE.Group(); group.name = "RIDE_cruiser";
    const model = this.tpl.clone(true); group.add(model);
    const parts = { wheels: [], doors: {}, steer: null, seat: {}, cam: {}, fork: null, stand: null };
    model.traverse(o => {
      const n = o.name || "";
      if (n === "WHEEL_FRONT" || n === "WHEEL_REAR") parts.wheels.push({ o, front: false, base: o.quaternion.clone() });
      if (n === "STEER") parts.fork = { o, base: o.quaternion.clone() };
      if (n === "KICKSTAND") parts.stand = { o };
    });
    group.add(makeBlob(0.7, 2.2));                                    // contact shadow
    const v = { group, model, parts, kind: "bike", type: BIKE.type, lean: PARKED_LEAN, stand: 0, rider: null, paint: 0 };
    (this.all ||= []).push(v);
    this.autoPaint(v);                                                          // the best colour nobody nearby is wearing
    this.pose(v, 0, 0, 0);
    return v;
  }

  // a bike that comes into view takes the best-looking colour that no other visible bike (parked or in traffic) is wearing,
  // so you never see two the same on one street. A bike you repainted yourself keeps your colour.
  autoPaint(v) {
    if (v.userPaint) return;
    const used = new Set();
    for (const o of this.all || []) if (o !== v && o.group.visible && o.group.parent) used.add(o.paint);
    const idx = PAINTS.findIndex((_, i) => !used.has(i));
    if (idx >= 0 && idx !== v.paint) this.repaint(v, idx);
  }

  // every few seconds: where two visible bikes wear the same colour, the farther one (if it is over 25 m away, so nobody sees it change) takes another
  dedupe(cam) {
    if (performance.now() < (this.nextDedupe || 0)) return;
    this.nextDedupe = performance.now() + 1500;
    const vis = (this.all || []).filter(o => o.group.visible && o.group.parent && !o.userPaint).map(o => [o, Math.hypot(o.group.position.x - cam.x, o.group.position.z - cam.z)]).sort((a, b) => a[1] - b[1]);
    const seen = new Set();
    for (const [o, d] of vis) {
      if (!seen.has(o.paint)) { seen.add(o.paint); continue; }
      if (d < 25) continue;
      const idx = PAINTS.findIndex((_, i) => !seen.has(i));
      if (idx >= 0) { this.repaint(o, idx); seen.add(idx); }
    }
  }

  // paint the tank and fender (M_Paint is its own copy per bike, so the others don't change)
  repaint(v, idx) {
    idx = ((idx % PAINTS.length) + PAINTS.length) % PAINTS.length; v.paint = idx;
    v.model.traverse(o => {
      if (!o.isMesh) return;
      const own = [].concat(o.material).map(m => {
        if (m.name !== "M_Paint") return m;
        if (!m.userData.own) { const c = m.clone(); c.userData.own = true; c.name = "M_Paint"; this.registerMaterial?.(c); m = c; }
        m.color.setHex(PAINTS[idx].hex); return m;
      });
      o.material = Array.isArray(o.material) ? own : own[0];
    });
    return PAINTS[idx];
  }

  // stand: 0 = on the kickstand (parked, leaning), 1 = folded away and upright (ridden); steer: bar angle; lean: roll (rad)
  pose(v, stand, steer, lean) {
    v.stand = stand;
    const { fork, stand: ks } = v.parts;
    if (fork) fork.o.quaternion.copy(fork.base).multiply(new THREE.Quaternion().setFromAxisAngle(Y, -steer));
    if (ks) ks.o.quaternion.copy(STAND_DOWN).slerp(STAND_UP, stand);
    v.model.quaternion.setFromAxisAngle(Z, THREE.MathUtils.lerp(PARKED_LEAN, lean, stand));
  }

  // put somebody on it: their skeleton at the bike's origin (the pose is authored in the bike's frame), Pose_Ride on
  mount(v, avatar) {
    if (!avatar) return;
    v.rider = avatar;
    avatar.object.userData.mountParent = avatar.object.parent;
    v.model.add(avatar.object);
    avatar.object.position.set(0, 0, 0); avatar.object.rotation.set(0, 0, 0);
    avatar.object.visible = true;
    avatar.setRide(this.clips[avatar.id === "daniel" ? "man" : "woman"]);
  }
  dismount(v) {
    const a = v.rider;
    if (!a) return;
    v.rider = null;
    a.setRide(null);
    const home = a.object.userData.mountParent;
    if (home) home.add(a.object); else v.model.remove(a.object);
    a.object.visible = false;
  }
}
