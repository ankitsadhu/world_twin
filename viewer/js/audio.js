// Times Square soundscape, synthesised live with Web Audio (no audio files to download or license).
// Layers: traffic rumble, crowd murmur centred on the bowtie, 3D-positioned car horns, the odd distant
// siren, footsteps while walking, and wind once you are up above the rooftops. Everything follows
// the camera; it starts on the first click / key press (browser autoplay rules) and can be muted.
import * as THREE from "three";
import { Settings } from "./settings.js";
import { caption } from "./captions.js";

function noiseBuffer(ctx, kind = "pink", seconds = 4) {
  const n = ctx.sampleRate * seconds, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (kind === "pink") { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.05) * 1.6; }
    else d[i] = w;
  }
  return buf;
}

export class CityAudio {
  // carNear(): a real car's position near you (or null): horns only ever come from a car you could see
  constructor({ camera, crowdCount = () => 1500, isWalking = () => false, night = () => 0, carNear = () => null }) {
    this.carNear = carNear;
    Object.assign(this, { camera, crowdCount, isWalking, night });
    this.enabled = Settings.v.sound === true;              // asked once (null until then); the answer is remembered
    Settings.on((v, patch) => {
      if (patch && "volume" in patch && this.master) this.master.gain.setTargetAtTime(v.volume, this.ctx.currentTime, 0.2);
      if (patch && "sound" in patch && v.sound !== this.enabled) this.setEnabled(v.sound, true);
    });
    this.ctx = null; this.nextHorn = 2; this.nextSiren = 25; this.stepT = 0; this.lastPos = new THREE.Vector3();
    const start = () => { if (this.enabled) this.start(); };
    addEventListener("pointerdown", start, { once: true });
    addEventListener("keydown", start, { once: true });
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
    this.master.gain.setTargetAtTime(Settings.v.volume, ctx.currentTime, 1.5);   // fade in, never a jump scare
    this.bufs = { pink: noiseBuffer(ctx, "pink"), brown: noiseBuffer(ctx, "brown"), white: noiseBuffer(ctx, "white", 1) };
    const loop = (buf, ...chain) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random();
      let n = s; for (const c of chain) { n.connect(c); n = c; }
      s.start(0, Math.random() * 3); return n;
    };
    // traffic: low rumble + a hiss of tyres, louder at street level
    this.traffic = ctx.createGain(); this.traffic.connect(this.master);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380;
    loop(this.bufs.brown, lp).connect(this.traffic);
    const hiss = ctx.createBiquadFilter(); hiss.type = "bandpass"; hiss.frequency.value = 1400; hiss.Q.value = 0.4;
    const hg = ctx.createGain(); hg.gain.value = 0.05; loop(this.bufs.pink, hiss, hg).connect(this.traffic);
    // crowd murmur: pink noise through speech-like formants, slowly modulated, placed on the bowtie
    this.crowdGain = ctx.createGain();
    this.crowdPan = this.panner(new THREE.Vector3(-12, 1.6, -40), 60);
    this.crowdGain.connect(this.crowdPan);
    for (const [f, q, g] of [[420, 3, 0.5], [1150, 4, 0.35], [2500, 5, 0.18]]) {
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
      const gg = ctx.createGain(); gg.gain.value = g;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.7 + Math.random() * 2.5; lg.gain.value = g * 0.6;
      lfo.connect(lg).connect(gg.gain); lfo.start();
      loop(this.bufs.pink, bp, gg).connect(this.crowdGain);
    }
    // wind up high
    this.wind = ctx.createGain(); this.wind.gain.value = 0; this.wind.connect(this.master);
    const wf = ctx.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 500; wf.Q.value = 0.7;
    const wl = ctx.createOscillator(), wlg = ctx.createGain(); wl.frequency.value = 0.13; wlg.gain.value = 250; wl.connect(wlg).connect(wf.frequency); wl.start();
    loop(this.bufs.pink, wf).connect(this.wind);
  }

  panner(pos, ref = 10) {
    const p = this.ctx.createPanner();
    Object.assign(p, { panningModel: "HRTF", distanceModel: "inverse", refDistance: ref, maxDistance: 2000, rolloffFactor: 1.2 });
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.master); return p;
  }

  // a New York car horn: two detuned square-ish tones, sometimes a double honk, from a spot on the street
  horn(at = null) {
    const ctx = this.ctx, c = this.camera.position, t = ctx.currentTime;
    const along = Math.random() < 0.6, d = (Math.random() < 0.5 ? -1 : 1) * (25 + Math.random() * 110);
    const pos = at || new THREE.Vector3(c.x + (along ? (Math.random() - 0.5) * 20 : d), 1.2, c.z + (along ? d : (Math.random() - 0.5) * 20));
    caption("Car horn", { camera: this.camera, pos, key: "horn" });
    const p = this.panner(pos, 12), g = ctx.createGain(); g.connect(p); g.gain.value = 0;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.8; bp.connect(g);
    const base = 330 + Math.random() * 140;
    const oscs = [base, base * 1.26].map(f => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.connect(bp); o.start(t); return o; });
    let e = t; const loud = 0.16 + Math.random() * 0.12;
    for (let k = 0; k < (Math.random() < 0.35 ? 2 : 1); k++) {
      const len = 0.18 + Math.random() * (k ? 0.2 : 0.55);
      g.gain.setValueAtTime(0, e); g.gain.linearRampToValueAtTime(loud, e + 0.015);
      g.gain.setValueAtTime(loud, e + len); g.gain.linearRampToValueAtTime(0, e + len + 0.04); e += len + 0.12;
    }
    oscs.forEach(o => o.stop(e + 0.1));
    setTimeout(() => p.disconnect(), (e - t + 0.3) * 1000);
  }

  // a far-off siren wailing somewhere in Midtown
  siren() {
    const ctx = this.ctx, t = ctx.currentTime, c = this.camera.position, a = Math.random() * 6.28;
    const sp = new THREE.Vector3(c.x + Math.cos(a) * 500, 5, c.z + Math.sin(a) * 500);
    const p = this.panner(sp, 60);
    caption("Siren", { camera: this.camera, pos: sp, key: "siren", minGap: 20 });
    const g = ctx.createGain(); g.gain.value = 0; g.connect(p);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800; lp.connect(g);
    const o = ctx.createOscillator(); o.type = "triangle"; o.connect(lp);
    const dur = 7 + Math.random() * 5;
    for (let s = 0; s < dur; s += 2.6) { o.frequency.setValueAtTime(650, t + s); o.frequency.linearRampToValueAtTime(1350, t + s + 1.3); o.frequency.linearRampToValueAtTime(650, t + s + 2.6); }
    g.gain.linearRampToValueAtTime(0.35, t + 2); g.gain.linearRampToValueAtTime(0, t + dur);
    o.start(t); o.stop(t + dur + 0.1);
    setTimeout(() => p.disconnect(), (dur + 0.5) * 1000);
  }

  // a crash: a low body thump, a crunch of plastic and glass, scaled by how hard you hit
  crash(pos, strength = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime, p = this.panner(pos, 8);
    caption(strength > 0.5 ? "Crash" : "Bump", { camera: this.camera, pos, key: "crash", minGap: 1 });
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    og.gain.setValueAtTime(0.9 * strength, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(og).connect(p); o.start(t); o.stop(t + 0.5);
    const n = ctx.createBufferSource(); n.buffer = this.bufs.white;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1200;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.5 * strength, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18 + 0.25 * strength);
    n.connect(f).connect(ng).connect(p); n.start(t, Math.random(), 0.6);
    setTimeout(() => p.disconnect(), 1200);
  }

  step() {
    const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = this.bufs.white;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 180 + Math.random() * 120; f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random() * 0.8, 0.13);
  }

  // the ride: an electric motor whine + tyre roar that follow the car; inside the cab the city is muffled
  setCar(speed, pos) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.car) {
      const p = this.panner(pos, 6), g = ctx.createGain(); g.gain.value = 0; g.connect(p);
      const o = ctx.createOscillator(); o.type = "sawtooth"; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 6;
      o.connect(f).connect(g); o.start();
      const tg = ctx.createGain(); tg.gain.value = 0; tg.connect(p);
      const tf = ctx.createBiquadFilter(); tf.type = "lowpass"; tf.frequency.value = 700;
      const s = ctx.createBufferSource(); s.buffer = this.bufs.brown; s.loop = true; s.connect(tf).connect(tg); s.start();
      this.car = { p, g, o, f, tg };
    }
    const c = this.car;
    c.p.positionX.value = pos.x; c.p.positionY.value = 0.6; c.p.positionZ.value = pos.z;
    c.o.frequency.setTargetAtTime(120 + speed * 38, t, 0.1); c.f.frequency.setTargetAtTime(400 + speed * 90, t, 0.1);
    c.g.gain.setTargetAtTime(speed > 0.2 ? 0.035 + Math.min(0.06, speed * 0.004) : 0, t, 0.2);
    c.tg.gain.setTargetAtTime(Math.min(0.5, speed * 0.03), t, 0.2);
  }
  setCabin(v) { this.cabin = v; }
  // a prop plane: a low buzzing drone with the blade beat; one voice per plane (key), level 0..1 (0 = silent)
  setPlane(key, level, pos, ref = 10) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.planes = this.planes || {};
    if (!this.planes[key]) {
      if (!level) return;
      const p = this.panner(pos, ref), g = ctx.createGain(); g.gain.value = 0; g.connect(p);
      const o = ctx.createOscillator(); o.type = "sawtooth";
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 520;
      const beat = ctx.createGain(); beat.gain.value = 0.6;                  // tremolo at the blade rate
      const lfo = ctx.createOscillator(); lfo.frequency.value = 22; const ld = ctx.createGain(); ld.gain.value = 0.4;
      lfo.connect(ld).connect(beat.gain); lfo.start();
      o.connect(f).connect(beat).connect(g); o.start();
      this.planes[key] = { p, g, o, lfo };
    }
    const v = this.planes[key];
    v.p.positionX.value = pos.x; v.p.positionY.value = pos.y; v.p.positionZ.value = pos.z;
    v.o.frequency.setTargetAtTime(62 + level * 48, t, 0.2); v.lfo.frequency.setTargetAtTime(14 + level * 16, t, 0.2);
    v.g.gain.setTargetAtTime(level * 0.09, t, 0.3);
  }
  // the engine-order telegraph's bell when you ring a new order
  telegraph() {
    if (!this.ctx || !this.enabled || this.ctx.state !== "running") return;
    const ctx = this.ctx, t = ctx.currentTime, g = ctx.createGain(); g.gain.value = 0; g.connect(this.master);
    [1320, 2650, 3970].forEach((f, i) => { const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = [0.5, 0.25, 0.12][i]; o.connect(og).connect(g); o.start(t); o.stop(t + 1.2); });
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
  }

  // a ship's whistle: a deep two-tone chord (vessels 20-75 m long sound 140-350 Hz under COLREGs Annex III), one
  // prolonged blast; captioned even with the sound off
  shipHorn(pos, len = 1.8) {
    caption("Ship's horn", { camera: this.camera, pos, key: "shiphorn" });
    if (!this.ctx || !this.enabled || this.ctx.state !== "running") return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = this.panner(pos, 40), g = ctx.createGain(); g.gain.value = 0; g.connect(p);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700; lp.Q.value = 0.7; lp.connect(g);
    const oscs = [150, 188, 300].map((f, i) => { const o = ctx.createOscillator(); o.type = i === 2 ? "triangle" : "sawtooth";
      o.frequency.value = f; const og = ctx.createGain(); og.gain.value = i === 2 ? 0.25 : 0.5; o.connect(og).connect(lp); o.start(t); return o; });
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.12);
    g.gain.setValueAtTime(0.32, t + len); g.gain.linearRampToValueAtTime(0, t + len + 0.35);
    oscs.forEach(o => o.stop(t + len + 0.4));
    setTimeout(() => p.disconnect(), (len + 0.6) * 1000);
  }

  // a horn that means something (a car honking at you, your own horn): captioned even with the sound off
  hornAt(pos) {
    if (this.ctx && this.enabled && this.ctx.state === "running") this.horn(pos);
    else caption("Car horn", { camera: this.camera, pos, key: "horn" });
  }

  setEnabled(on, fromSettings = false) {
    this.enabled = on;
    if (!fromSettings) Settings.set({ sound: on });
    if (on) this.start(); else this.ctx?.suspend();
  }

  update(dt) {
    if (!this.ctx || !this.enabled || this.ctx.state !== "running") {   // silent: sirens still get a caption
      this.nextSiren -= dt;
      if (this.nextSiren < 0) { this.nextSiren = 45 + Math.random() * 70; caption("Siren", { key: "siren", minGap: 20 }); }
      return;
    }
    const ctx = this.ctx, cam = this.camera, L = ctx.listener, t = ctx.currentTime;
    const f = new THREE.Vector3(); cam.getWorldDirection(f);
    if (L.positionX) {
      L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
    const h = cam.position.y, street = 1 - THREE.MathUtils.smoothstep(h, 8, 260), night = this.night();
    const muffle = 1 - 0.65 * (this.cabin || 0);                      // closed cab windows
    this.traffic.gain.setTargetAtTime((0.1 + 0.32 * street) * (1 - 0.3 * night) * muffle, t, 0.3);
    this.crowdGain.gain.setTargetAtTime((0.25 + 0.75 * Math.min(1, this.crowdCount() / 1500)) * muffle, t, 0.5);
    this.wind.gain.setTargetAtTime(0.12 * THREE.MathUtils.smoothstep(h, 60, 400), t, 0.5);
    // events
    this.nextHorn -= dt; this.nextSiren -= dt;
    if (this.nextHorn < 0) {
      const car = street > 0.3 ? this.carNear() : null;      // no cars around (a quiet side street): no horn
      if (car) this.horn(car);
      this.nextHorn = (car ? 1.5 + Math.random() * 6 : 2) * (1 + night);
    }
    if (this.nextSiren < 0) { this.siren(); this.nextSiren = 45 + Math.random() * 70; }
    // footsteps when walking (from how far the camera actually moved)
    const moved = Math.hypot(cam.position.x - this.lastPos.x, cam.position.z - this.lastPos.z);
    this.lastPos.copy(cam.position);
    if (this.isWalking() && dt > 0 && moved / dt > 0.6 && moved / dt < 12) {
      this.stepT -= dt; if (this.stepT < 0) { this.step(); this.stepT = 0.52; }
    } else this.stepT = 0.1;
  }
}
