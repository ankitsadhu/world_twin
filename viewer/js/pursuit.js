import * as THREE from "three";

const ESCAPE_DISTANCE = 85;
const ESCAPE_SECONDS = 10;
const TAG_DISTANCE = 5.5;
const TAG_SECONDS = 1.2;

export class Pursuit {
  constructor({ ride, traffic }) {
    this.ride = ride;
    this.traffic = traffic;
    this.state = "idle";
    this.clearFor = 0;
    this.taggedFor = 0;
    this.sirenIn = 0;
    this.status = "Optional challenge · escape two cruisers by opening an 85 m gap for 10 seconds.";
  }

  get active() { return this.state === "active"; }

  start(stars = 2) {
    if (!this.traffic?.ready || this.ride.state !== "driving") return false;
    this.stars = stars;
    const car = this.ride.car.position;
    if (!this.traffic.startPursuit({ x: car.x, y: -car.z, h: this.ride.heading }, stars >= 5 ? 4 : stars >= 3 ? 3 : 2, 16 + stars * 2, { bikes: stars >= 4 ? 2 : 0, blocks: stars >= 5 ? 3 : stars >= 4 ? 2 : stars >= 3 ? 1 : 0 })) return false;
    this.state = "active";
    this.clearFor = 0;
    this.taggedFor = 0;
    this.sirenIn = 0;
    this.status = `Wanted ${"★".repeat(stars)} · ${this.traffic.pursuitCars.filter(c => !c.blockade).length} units responding${stars >= 3 ? " · roadblocks ahead" : ""} · open an 85 m gap and hold it for 10 seconds.`;
    return true;
  }

  finish(state, status) {
    const was = this.state;
    this.state = state;
    this.status = status;
    this.traffic.clearPursuit();
    this.ride.render();
    if (was === "active") this.onEnd?.(state, this.stars || 2);
  }

  update(dt) {
    if (!this.active) return;
    if (this.ride.state !== "driving" || !this.ride.inCar) {
      this.finish("ended", "Challenge ended · you left the vehicle.");
      return;
    }

    if (this.ride.wrecked) { this.finish("caught", "Wrecked: busted. The chain is lost"); return; }
    const car = this.ride.car.position;
    const target = { x: car.x, y: -car.z, h: this.ride.heading };
    this.traffic.setPursuitTarget(target);
    const cruisers = this.traffic.pursuitCars.filter(c => !c.blockade);
    this.traffic.refreshRoadblocks?.(target);
    if (!cruisers.length) {
      this.finish("ended", "Challenge ended · no cruisers available.");
      return;
    }

    const nearest = cruisers.reduce((best, cruiser) => Math.min(best, Math.hypot(cruiser.x - target.x, cruiser.y - target.y)), Infinity);
    this.taggedFor = nearest < TAG_DISTANCE ? this.taggedFor + dt : 0;
    this.clearFor = nearest > ESCAPE_DISTANCE ? this.clearFor + dt : 0;
    if (this.taggedFor >= TAG_SECONDS) {
      this.finish("caught", "Caught · no damage or penalty. Try another route.");
      return;
    }
    if (this.clearFor >= ESCAPE_SECONDS) {
      this.finish("escaped", "Escaped · challenge complete!");
      return;
    }

    const remaining = Math.max(0, Math.ceil(ESCAPE_SECONDS - this.clearFor));
    this.status = nearest > ESCAPE_DISTANCE
      ? `Wanted ${"★".repeat(this.stars || 2)} · keep your ${ESCAPE_DISTANCE} m gap for ${remaining}s.`
      : `Wanted ${"★".repeat(this.stars || 2)} · ${Math.round(nearest)} m behind · lose them by ${ESCAPE_DISTANCE} m.`;
    const status = document.getElementById("pursuit-status");
    if (status) status.textContent = this.status;

    this.sirenIn -= dt;
    if (this.sirenIn <= 0) {
      const cruiser = cruisers.reduce((best, current) =>
        Math.hypot(current.x - target.x, current.y - target.y) < Math.hypot(best.x - target.x, best.y - target.y) ? current : best);
      this.traffic.audio?.sirenAt?.(new THREE.Vector3(cruiser.x, 1.2, -cruiser.y));
      this.sirenIn = 5;
    }
  }
}
